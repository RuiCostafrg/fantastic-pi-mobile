"""Deterministic observer regression tests: no device, UI, tmux or provider."""
import importlib.util
import json
from pathlib import Path
import subprocess
import shlex
import shutil
import tempfile
import time
from types import SimpleNamespace
import unittest
from power_observer import MONITOR_SCRIPT, ObservationUnavailable, PowerEvidence, SharedPowerObserver


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.path = Path(self.temporary.name) / 'samples.tsv'
        self.now = 100.0
        self.reader = PowerEvidence(self.path, lambda: self.now)

    def tearDown(self):
        self.temporary.cleanup()

    def write(self, text):
        self.path.write_text(text)

    def test_fresh_evidence_and_partial_write(self):
        self.write('99.0\tAwake\t1\n100.0\tAs')
        self.assertEqual(self.reader.read(), (False, True))
        self.write('99.0\tAwake\t1\n100.0\tAsleep\t1\n')
        self.assertEqual(self.reader.read(), (True, True))
        self.reader.begin()

    def test_missing_stale_foreign_clock_and_invalid_evidence(self):
        for content in [None, '', '90.0\tAsleep\t1\n', '110.0\tAsleep\t1\n',
                        '100.0\tUnknown\t0\n', 'nan\tAsleep\t1\n',
                        '100.0\tAsleep\t1\n99.0\tAsleep\t1\n']:
            with self.subTest(content=content):
                if content is not None:
                    self.write(content)
                with self.assertRaises(ObservationUnavailable):
                    self.reader.read()

    def test_every_intervening_sample_checked_not_just_latest(self):
        self.write('100.0\tAsleep\t1\n')
        self.reader.read()
        self.reader.begin()
        self.now = 103
        self.write('100.0\tAsleep\t1\n101.0\tAwake\t1\n102.0\tAsleep\t1\n')
        with self.assertRaisesRegex(AssertionError, 'woke'):
            self.reader.read()

    def test_gaps_and_missing_wake_lock_refuse_success(self):
        for next_line, now, error in [('109.0\tAsleep\t1\n', 109, ObservationUnavailable), ('101.0\tAsleep\t0\n', 101, AssertionError)]:
            with self.subTest(next_line=next_line):
                self.now = 100
                reader = PowerEvidence(self.path, lambda: self.now)
                self.write('100.0\tAsleep\t1\n')
                reader.read()
                reader.begin()
                self.now = now
                self.write('100.0\tAsleep\t1\n' + next_line)
                with self.assertRaises(error):
                    reader.read()

    def test_truncated_trace_is_not_accepted(self):
        self.write('99.0\tAsleep\t1\n100.0\tAsleep\t1\n')
        self.reader.read()
        self.reader.begin()
        self.write('100.0\tAsleep\t1\n')
        with self.assertRaises(ObservationUnavailable):
            self.reader.read()

    def test_finished_sampler_cannot_report_fresh_power_evidence(self):
        private = Path(self.temporary.name) / 'private'
        private.mkdir()
        observer = SharedPowerObserver('synthetic-device', private,
            shared_parent=Path(self.temporary.name), clock=lambda: self.now)
        observer.shared.mkdir()
        observer.samples.write_text('100.0\tAwake\t1\n')
        self.assertEqual(observer.read(), (False, True))
        (observer.shared / 'done').write_text('done\n')
        (observer.shared / 'exit-reason').write_text('signal-term\n')
        with self.assertRaisesRegex(ObservationUnavailable, 'sampler stopped.*signal-term'):
            observer.read()
        self.assertTrue(observer.close())
        self.assertEqual((private / 'power-exit-reason.txt').read_text(), 'signal-term\n')

    def test_transport_loss_after_start_does_not_call_adb_again(self):
        private = Path(self.temporary.name) / 'private'
        private.mkdir()
        calls = []
        def adb_run(args, **kwargs):
            calls.append(args)
            if args[-1] == 'get-state':
                return SimpleNamespace(stdout='device\n')
            if 'nohup' in args[-1]:
                observer.samples.write_text('100.0\tAwake\t1\n')
            return SimpleNamespace(stdout='')
        observer = SharedPowerObserver('synthetic-device', private, shared_parent=Path(self.temporary.name), clock=lambda: self.now, runner=adb_run)
        observer.start()
        count = len(calls)
        # Exact original failure: any additional ADB subprocess now fails.
        observer.runner = lambda *a, **k: (_ for _ in ()).throw(subprocess.CalledProcessError(1, ['adb', 'shell', 'dumpsys', 'power']))
        observer.samples.write_text('100.0\tAwake\t1\n101.0\tAsleep\t1\n')
        self.now = 101
        self.assertEqual(observer.read(), (True, True))
        observer.begin()
        observer.samples.write_text('100.0\tAwake\t1\n101.0\tAsleep\t1\n102.0\tAsleep\t1\n')
        self.now = 102
        self.assertEqual(observer.read(), (True, True))
        self.assertEqual(len(calls), count)
        (observer.shared / 'done').write_text('done\n')
        self.assertTrue(observer.close())
        self.assertTrue((private / 'power-samples.tsv').exists())
        self.assertFalse(observer.shared.exists())

    def test_deployed_sampler_handles_power_dump_over_android_exec_argument_limit(self):
        directory = Path(self.temporary.name)
        dump = directory / 'dump.txt'
        dump.write_text('  mWakefulness=Awake\n' + "  PARTIAL_WAKE_LOCK 'com.termux.app.TermuxService'\n" + 'metadata-only\n' * 18000)
        mock_dump = directory / 'dumpsys'
        mock_dump.write_text('#!/bin/sh\nexec cat ' + shlex.quote(str(dump)) + '\n')
        mock_dump.chmod(0o700)
        mock_sleep = directory / 'sleep'
        mock_sleep.write_text('#!/bin/sh\ntouch ' + shlex.quote(str(directory / 'stop')) + '\n')
        mock_sleep.chmod(0o700)
        uptime = directory / 'uptime'
        uptime.write_text('100.0 200.0\n')
        script = MONITOR_SCRIPT.replace('/proc/uptime', str(uptime)).replace('/system/bin/dumpsys', str(mock_dump)).replace('/system/bin/awk', shutil.which('awk')).replace('/system/bin/sleep', str(mock_sleep)).replace('/system/bin/grep', shutil.which('grep'))
        # Android mksh invokes external printf: reproduce that exact argv-size
        # seam instead of accidentally hiding it behind bash's builtin printf.
        script = script.replace('#!/system/bin/sh\n', '#!/bin/bash\nprintf() { command ' + shlex.quote(shutil.which('printf')) + ' "$@"; }\n', 1)
        path = directory / 'monitor.sh'
        path.write_text(script)
        subprocess.run(['bash', str(path), str(directory), '5'], check=True, capture_output=True, text=True, timeout=8)
        evidence = PowerEvidence(directory / 'samples.tsv', lambda: 100.0)
        self.assertEqual(evidence.read(), (False, True))
        self.assertEqual((directory / 'exit-reason').read_text(), 'stop-requested\n')
        self.assertTrue((directory / 'done').exists())
        self.assertFalse(path.exists())

    def test_real_sampler_signal_records_exit_instead_of_silent_disappearance(self):
        directory = Path(self.temporary.name)
        mock_dump = directory / 'dumpsys'
        mock_dump.write_text('#!/bin/sh\nprintf "  mWakefulness=Awake\\n"\n')
        mock_dump.chmod(0o700)
        script = MONITOR_SCRIPT.replace('/system/bin/dumpsys', str(mock_dump)).replace(
            '/system/bin/awk', shutil.which('awk')).replace('/system/bin/sleep', shutil.which('sleep'))
        path = directory / 'monitor.sh'
        path.write_text(script)
        process = subprocess.Popen(['bash', str(path), str(directory), '20'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 5
            while not (directory / 'samples.tsv').exists():
                self.assertIsNone(process.poll(), 'Sampler exited before first sample')
                self.assertLess(time.monotonic(), deadline, 'Sampler did not start')
                time.sleep(.02)
            process.terminate()
            self.assertEqual(process.wait(timeout=5), 143)
            self.assertEqual((directory / 'exit-reason').read_text(), 'signal-term\n')
            self.assertTrue((directory / 'done').exists())
            self.assertFalse(path.exists())
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)

    def test_final_report_keeps_observation_metrics_without_reusing_old_file(self):
        spec = importlib.util.spec_from_file_location('fixture', Path(__file__).with_name('check-bridge-work.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        output = Path(self.temporary.name) / 'result.json'
        output.write_text('{"old_success":true}')
        options = SimpleNamespace(report=str(output))
        module.report(options, 'observed', observed_seconds=30, samples=31)
        module.report(options, 'passed', exact_id_non_replay=True)
        value = json.loads(output.read_text())
        self.assertEqual(value['observed_seconds'], 30)
        self.assertNotIn('old_success', value)


if __name__ == '__main__':
    unittest.main()
