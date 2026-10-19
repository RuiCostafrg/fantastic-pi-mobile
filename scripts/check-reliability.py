#!/usr/bin/env python3
"""Same-phone (Termux) lifecycle matrix using only the isolated reliability APK.

Build/install with -PreliabilityTests=true first. Requires an explicit authorized
ADB serial; never touches dev.fantasticpimobile, its pairing, bridge, or databases.
No global network/battery/IME settings are changed. No models or microphone.
"""
import argparse
from contextlib import contextmanager
import json
from pathlib import Path
import select
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "dev.fantasticpimobile.reliability"
TOKEN = "pocket-reliability-fixture-only-token"


def run(*command):
    result = subprocess.run(command, capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise RuntimeError(f"Command failed: {command[0]} (exit {result.returncode})")
    return result.stdout


def wait(predicate, label, seconds=15):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.1)
    raise AssertionError("Timed out: " + label)


@contextmanager
def private_directory():
    directory = tempfile.mkdtemp(prefix="pocket-lifecycle-")
    try:
        yield directory
    except BaseException:
        # Keep evidence and storage locks if shutdown failed; never blindly delete a live journal.
        print("Fixture failure: private diagnostic state retained at " + directory, flush=True)
        raise
    else:
        shutil.rmtree(directory)


class Fixture:
    def __init__(self, directory, repo, port):
        self.log = open(directory / "fixture.log", "a")
        self.process = subprocess.Popen(
            ["node", str(ROOT / "bridge/test/reliability-fixture.js"), str(directory / "data"), str(repo), str(port)],
            cwd=ROOT / "bridge", stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=self.log, text=True, bufsize=1,
        )
        self.url = f"http://127.0.0.1:{port}"
        assert self.reply().get("ready")

    def reply(self):
        if not select.select([self.process.stdout], [], [], 20)[0]:
            raise AssertionError("Fixture response timed out")
        line = self.process.stdout.readline()
        if not line:
            raise AssertionError("Fixture exited unexpectedly (private diagnostic log retained until cleanup)")
        return json.loads(line)

    def control(self, command):
        self.process.stdin.write(json.dumps({"command": command}) + "\n")
        self.process.stdin.flush()
        return self.reply()

    def request(self, path, body=None):
        request = urllib.request.Request(self.url + path,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.load(response)

    def status(self, job):
        return self.control("snapshot")["jobs"]["fixture-" + job].get("status")

    def approve(self):
        self.request("/v1/jobs/fixture-approval/ui", {"id": "dialog", "confirmed": False})
        wait(lambda: self.status("approval") == "done", "bridge completion")

    def close(self):
        try:
            if self.process.poll() is None:
                assert self.control("close").get("closed")
            assert self.process.wait(timeout=20) == 0
        finally:
            self.log.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--scenario", choices=["background", "lock", "force-stop", "offline", "restart", "review-restart", "all"], default="all")
    parser.add_argument("--allow-nonsecure-lock", action="store_true", help="Authorize sleep/wake; verify no secure lock before use")
    args = parser.parse_args()
    adb = lambda *parts: run("adb", "-s", args.serial, *parts)
    assert PACKAGE in adb("shell", "pm", "path", PACKAGE), "Install isolated APK first"
    scenarios = ["background", "lock", "force-stop", "offline", "restart", "review-restart"] if args.scenario == "all" else [args.scenario]
    if "lock" in scenarios and not args.allow_nonsecure_lock:
        if args.scenario == "lock":
            parser.error("Lock testing requires --allow-nonsecure-lock after checking device lock status")
        scenarios.remove("lock")
        print("SKIP: secure/user-assisted lock test (no credential or lock settings changed)", flush=True)

    def instrument(phase, endpoint, approval="running", parallel="running"):
        output = adb("shell", "am", "instrument", "-w", "-r", "-e", "class", "dev.fantasticpimobile.ReliabilityFixtureTest",
            "-e", "phase", phase, "-e", "endpoint", endpoint, "-e", "approval", approval, "-e", "parallel", parallel,
            PACKAGE + ".test/androidx.test.runner.AndroidJUnitRunner")
        if "OK (1 test)" not in output or "FAILURES" in output:
            # Only fixture assertions can be printed; never collect production UI/logs.
            raise AssertionError("Fixture instrumentation failed:\n" + output)

    def launch():
        adb("shell", "am", "start", "-W", "-n", PACKAGE + "/dev.fantasticpimobile.MainActivity")
        time.sleep(5)  # >3 real foreground polling intervals; final SQLite assertions are authoritative.

    try:
        with private_directory() as temp:
            root = Path(temp)
            for scenario in scenarios:
                directory = root / scenario
                directory.mkdir()
                repo = directory / "repo"
                repo.mkdir()
                run("git", "init", "-b", "main", str(repo))
                run("git", "-C", str(repo), "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "Fixture")
                with socket.socket() as sock:
                    sock.bind(("127.0.0.1", 0))
                    port = sock.getsockname()[1]
                fixture = Fixture(directory, repo, port)
                sleeping = False
                try:
                    adb("shell", "am", "force-stop", PACKAGE)
                    instrument("seed", fixture.url)
                    launch()
                    wait(lambda: fixture.control("snapshot")["jobs"]["fixture-approval"]["pending"], "pending approval")
                    wait(lambda: fixture.status("parallel") == "running", "parallel job")
                    wait(lambda: len(fixture.control("snapshot")["launches"]) == 2, "both RPC dispatches")
                    # Server dispatch alone is not proof that the app has received running/pending.
                    # These GET observations come only from the app; Python readiness uses stdin.
                    def app_has_polled():
                        reads = fixture.control("snapshot")["reads"]
                        return all(reads.get(id, {}).get("count", 0) >= 2 and reads.get(id, {}).get("status") == "running"
                            for id in ("fixture-approval", "fixture-parallel")) and reads["fixture-approval"]["pending"]
                    wait(app_has_polled, "foreground app polls of both live jobs")
                    time.sleep(0.3)
                    before = fixture.control("snapshot")["launches"]
                    assert sorted(before) == ["fixture-approval", "fixture-parallel"]
                    approval, parallel = "done", "running"
                    if scenario == "background":
                        adb("shell", "input", "keyevent", "KEYCODE_HOME")
                        fixture.approve()
                    elif scenario == "lock":
                        adb("shell", "input", "keyevent", "KEYCODE_SLEEP")
                        sleeping = True
                        fixture.approve()
                        time.sleep(3)
                        adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
                        adb("shell", "wm", "dismiss-keyguard")
                        sleeping = False
                    elif scenario == "force-stop":
                        adb("shell", "am", "force-stop", PACKAGE)
                        fixture.approve()
                        assert fixture.status("parallel") == "running"
                    elif scenario == "offline":
                        fixture.control("offline")
                        time.sleep(5)
                        # Verify retained IDs/approval/selection while the actual HTTP listener is down.
                        # Persisted state/IDs are checked here; foreground freshness/approval
                        # wording is covered by LiveStatusUiTest (it must not be persisted as progress).
                        instrument("verify", fixture.url)
                        fixture.control("online")
                        fixture.approve()
                    elif scenario == "restart":
                        fixture.close()
                        fixture = Fixture(directory, repo, port)
                        approval = parallel = "interrupted"
                        wait(lambda: fixture.status("approval") == "interrupted" and fixture.status("parallel") == "interrupted", "interrupted without replay")
                        assert fixture.control("snapshot")["launches"] == []
                    elif scenario == "review-restart":
                        # Finish/cancel model jobs before admitting a real harmless shell test.
                        fixture.approve()
                        fixture.request("/v1/jobs/fixture-parallel/cancel", {})
                        wait(lambda: fixture.status("parallel") == "cancelled", "cancellation")
                        snapshot = fixture.request("/v1/sessions/pocket/changes")
                        marker = Path(snapshot["workspace"]["cwd"]) / ".fixture-review-starts"
                        body = {"operationId": "fixture-test-action", "action": "test", "revision": snapshot["revision"], "command": "printf 'dispatch\\n' >> .fixture-review-starts; sleep 30"}
                        fixture.request("/v1/sessions/pocket/actions", body)
                        wait(lambda: marker.exists() and marker.read_text() == "dispatch\n", "real shell test dispatch")
                        fixture.close()
                        fixture = Fixture(directory, repo, port)
                        wait(lambda: fixture.request("/v1/sessions/pocket/actions/fixture-test-action")["status"] == "interrupted", "test interruption")
                        # Same confirmed operation ID must return the interruption, not run sleep again.
                        assert fixture.request("/v1/sessions/pocket/actions", body)["status"] == "interrupted"
                        time.sleep(0.5)
                        assert marker.read_text() == "dispatch\n", "Repository test was replayed"
                        assert fixture.control("snapshot")["launches"] == []
                        parallel = "cancelled"
                    launch()
                    instrument("verify", fixture.url, approval, parallel)
                    if scenario not in ("restart", "review-restart"):
                        assert fixture.control("snapshot")["launches"] == before, "Reconnection duplicated a model launch"
                    print("PASS: " + scenario + " (state, stable IDs, selected chat, draft, pairing, no replay)", flush=True)
                finally:
                    if sleeping:
                        adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
                        adb("shell", "wm", "dismiss-keyguard")
                    adb("shell", "am", "force-stop", PACKAGE)
                    fixture.close()
    finally:
        # Never force-stop com.termux: the agent and live bridge are in that process domain.
        adb("shell", "am", "force-stop", PACKAGE)


if __name__ == "__main__":
    main()
