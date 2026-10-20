#!/usr/bin/env python3
"""Headless step-08 Android/HTTP lifecycle verification, separate fixture APK only.

Requires already installed, identity-verified -PreliabilityTests=true APKs and an
explicit authorized ADB serial. No Activities, production config/journal, provider,
network/IME/lock changes or real default-branch merges. Force-stops ONLY the fixture.
"""
import argparse
import json
from pathlib import Path
import select
import shutil
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "dev.fantasticpimobile.reliability"
TOKEN = "project-lifecycle-fixture-only-token-0000"
IDS = ["lifecycle-project-a", "lifecycle-project-b", "lifecycle-cancel-b"]


def run(*command):
    result = subprocess.run(command, capture_output=True, text=True, timeout=90)
    if result.returncode:
        raise RuntimeError(f"Command failed: {command[0]} (exit {result.returncode})")
    return result.stdout


def wait(predicate, label):
    until = time.monotonic() + 25
    while time.monotonic() < until:
        value = predicate()
        if value:
            return value
        time.sleep(.05)
    raise AssertionError("Timed out: " + label)


class Fixture:
    def __init__(self, directory, roots):
        self.log = open(directory / "bridge.log", "w")
        self.process = subprocess.Popen(
            ["node", str(ROOT / "bridge/test/project-lifecycle-fixture.js"), str(directory / "state"), *map(str, roots)],
            cwd=ROOT / "bridge", stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=self.log, text=True, bufsize=1)
        self.ready = self.reply()
        assert self.ready["ready"] and self.ready["pid"] == self.process.pid
        self.endpoint = self.ready["endpoint"]

    def reply(self):
        if not select.select([self.process.stdout], [], [], 25)[0]:
            raise AssertionError("Fixture control timed out")
        line = self.process.stdout.readline()
        if not line:
            raise AssertionError("Fixture exited unexpectedly")
        return json.loads(line)

    def control(self, command):
        self.process.stdin.write(json.dumps({"command": command}) + "\n")
        self.process.stdin.flush()
        return self.reply()

    def request(self, path):
        request = urllib.request.Request(self.endpoint + path, headers={"Authorization": "Bearer " + TOKEN})
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.load(response)

    def close(self):
        try:
            if self.process.poll() is None:
                assert self.control("close")["closed"]
            assert self.process.wait(timeout=25) == 0
        finally:
            self.log.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", required=True)
    args = parser.parse_args()
    adb = lambda *parts: run("adb", "-s", args.serial, *parts)
    for package in [PACKAGE, PACKAGE + ".test"]:
        assert adb("shell", "pm", "path", package).startswith("package:"), "Install verified fixture APKs first"
    directory = Path(tempfile.mkdtemp(prefix="mobile-project-lifecycle-"))
    fixture = None
    success = False
    try:
        roots = [directory / "a", directory / "b"]
        indexes = []
        for root in roots:
            root.mkdir()
            run("git", "-C", str(root), "init", "-b", "trunk")
            run("git", "-C", str(root), "config", "user.name", "Lifecycle fixture")
            run("git", "-C", str(root), "config", "user.email", "fixture@example.invalid")
            (root / "file.txt").write_text("base\n")
            run("git", "-C", str(root), "add", ".")
            run("git", "-C", str(root), "commit", "-m", "base")
            (root / "keep.txt").write_text("source staging\n")
            run("git", "-C", str(root), "add", "keep.txt")
            indexes.append(run("git", "-C", str(root), "diff", "--cached", "--binary"))
        fixture = Fixture(directory, roots)

        def stopped():
            adb("shell", "am", "force-stop", PACKAGE)
            # pidof's empty result has status 1, so normalize only that absence.
            assert not adb("shell", "sh", "-c", "'pidof " + PACKAGE + " || true'").strip(), "Client still alive"
            assert fixture.process.poll() is None, "Client exit stopped independent worker"

        def instrument(phase):
            output = adb("shell", "am", "instrument", "-w", "-r", "-e", "class", "dev.fantasticpimobile.ProjectLifecycleTest",
                         "-e", "phase", phase, "-e", "endpoint", fixture.endpoint,
                         "-e", "projectA", fixture.ready["projects"][0], "-e", "projectB", fixture.ready["projects"][1],
                         PACKAGE + ".test/androidx.test.runner.AndroidJUnitRunner")
            (directory / (phase + ".log")).write_text(output)
            if "OK (1 test)" not in output or "FAILURES" in output:
                raise AssertionError("Headless fixture phase " + phase + " failed:\n" + output)
            print("PASS: Android client phase " + phase, flush=True)
            stopped()

        stopped()
        instrument("submit")
        live = wait(lambda: (snapshot if (snapshot := fixture.control("snapshot"))["jobs"][IDS[0]] and
                            snapshot["jobs"][IDS[0]]["pending"] == "approval-a" and
                            snapshot["jobs"][IDS[1]] and snapshot["jobs"][IDS[1]]["dispatches"] == "HOLD_B\n" else None),
                    "two independent dispatched worktrees")
        assert live["launches"] == IDS[:2]
        assert IDS[0] in live["dropped"], "Acceptance response was not actually dropped"
        assert live["jobs"][IDS[0]]["projectId"] == fixture.ready["projects"][0]
        assert live["jobs"][IDS[1]]["projectId"] == fixture.ready["projects"][1]
        fixture.control("offline")
        # No Android process and no live HTTP connection: stdin alone releases the peer.
        fixture.control("release-b")
        done = wait(lambda: (s if (s := fixture.control("snapshot"))["jobs"][IDS[1]]["status"] == "done" else None),
                    "completion after Android client process exit")
        assert done["jobs"][IDS[1]]["answer"] == "RESULT_HOLD_B"
        assert done["jobs"][IDS[0]]["status"] == "running" and done["jobs"][IDS[0]]["pending"] == "approval-a"
        instrument("offline")
        fixture.control("recover"); fixture.control("online"); fixture.control("drop-review")
        instrument("recover")
        after = fixture.control("snapshot")
        assert after["launches"] == IDS
        assert "lifecycle-review-b" in after["dropped"], "Review acceptance response was not actually dropped"
        other = after["jobs"][IDS[1]]["sessionId"]
        review = wait(lambda: (op if (op := fixture.request("/v1/sessions/" + other + "/actions/lifecycle-review-b"))["status"] == "done" else None),
                      "uncertain review completion")
        assert review["projectId"] == fixture.ready["projects"][1]
        fixture.control("recover")
        instrument("verify")
        final = fixture.control("snapshot")
        assert final["launches"] == IDS, "Reconnect replayed dispatched work"
        assert [final["jobs"][id]["status"] for id in IDS] == ["done", "done", "cancelled"]
        paths = [Path(final["jobs"][id]["cwd"]) for id in IDS]
        assert len(set(paths)) == 3
        for path, text, id in zip(paths, ["CONFIRM_A", "HOLD_B", "CANCEL_B"], IDS):
            assert (path / "file.txt").read_text() == text + "\n"
            assert final["jobs"][id]["dispatches"] == text + "\n", "Duplicate/crossed dispatch"
        assert (paths[1] / ".fixture-review-dispatches").read_text() == "once\n", "Review replayed"
        assert not (paths[0] / ".fixture-review-dispatches").exists()
        for root, index in zip(roots, indexes):
            assert (root / "file.txt").read_text() == "base\n"
            assert run("git", "-C", str(root), "diff", "--cached", "--binary") == index
        assert fixture.process.poll() is None
        print("PASS: independent worker, two projects, dropped responses, exact-ID recovery, approval/cancel/review ownership, preserved drafts/selection/results, no replay/cross-writes", flush=True)
        success = True
    finally:
        try:
            adb("shell", "am", "force-stop", PACKAGE)
        finally:
            if fixture is not None:
                fixture.close()
            if success:
                shutil.rmtree(directory)
            else:
                print("Fixture failed; disposable evidence retained at " + str(directory), flush=True)


if __name__ == "__main__":
    main()
