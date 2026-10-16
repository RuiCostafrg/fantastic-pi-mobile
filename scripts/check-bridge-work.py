#!/usr/bin/env python3
"""Isolated real-tmux test; opt-in passive screen-off observation, never UI actions."""
import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.request
import urllib.error
from power_observer import ObservationUnavailable, SharedPowerObserver

ROOT = Path(__file__).resolve().parents[1]


def report(options, phase, **fields):
    value = {**getattr(options, '_report_state', {}), 'phase': phase, 'at': time.time(), **fields}
    options._report_state = value
    print(json.dumps(value), flush=True)
    if options.report:
        path = Path(options.report)
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(value) + '\n')
        temporary.replace(path)


def main(options):
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix='pocket-tmux-') as temporary:
        base = Path(temporary)
        checkout = base / 'checkout'
        (checkout / 'scripts').mkdir(parents=True)
        (checkout / 'bridge').mkdir()
        for name in ['bridge-work', 'bridge-work.mjs']:
            shutil.copy2(ROOT / 'scripts' / name, checkout / 'scripts' / name)
        shutil.copytree(ROOT / 'bridge/src', checkout / 'bridge/src')
        (checkout / 'bridge/node_modules').symlink_to(ROOT / 'bridge/node_modules', target_is_directory=True)
        (checkout / 'bridge/package.json').write_text('{"type":"module"}')
        fake = base / 'fake-pi.mjs'
        shutil.copy2(ROOT / 'bridge/test/fake-pi.js', fake)
        repo = base / 'repo'
        repo.mkdir()
        def command(*args, **kwargs):
            return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs).stdout.strip()
        command('git', '-C', str(repo), 'init', '-b', 'main')
        command('git', '-C', str(repo), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'Fixture')
        with socket.socket() as port_socket:
            port_socket.bind(('127.0.0.1', 0))
            port = port_socket.getsockname()[1]
        token = 'isolated-harmless-token-' * 3
        node = shutil.which('node')
        # Node itself can be PI_BIN; PI_ARGS supplies the fake peer before RPC flags.
        (checkout / 'bridge/.env').write_text('\n'.join([
            'PI_POCKET_TOKEN=' + token, 'PI_WORKSPACE=' + str(repo),
            'PI_DEFAULT_BRANCH=main', 'PORT=' + str(port), 'PI_BIN=' + node,
            "PI_ARGS='" + json.dumps([str(fake)]) + "'", 'PI_MAX_CONCURRENT=8',
        ]) + '\n')
        os.chmod(checkout / 'bridge/.env', 0o600)
        socket_path = str(base / 'tmux.sock')
        env = {k: v for k, v in os.environ.items() if not k.startswith('PI_') and k not in ['TMUX', 'PORT']}
        env['TMUX'] = socket_path + ',0,0'
        tmux = lambda *args: command('tmux', '-S', socket_path, *args, env=env)
        workflow = lambda *args: subprocess.run([str(checkout / 'scripts/bridge-work'), *args], env=env, text=True, capture_output=True, timeout=25)
        def api(path, body=None, expected=200):
            request = urllib.request.Request('http://127.0.0.1:' + str(port) + path,
                data=None if body is None else json.dumps(body).encode(),
                headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
            try:
                with urllib.request.urlopen(request, timeout=5) as response:
                    assert response.status == expected
                    return json.load(response)
            except urllib.error.HTTPError as error:
                assert error.code == expected, error.code
                return json.load(error)
        def until(check):
            for _ in range(200):
                if check():
                    return
                time.sleep(.05)
            raise AssertionError('Timed out waiting for fixture')
        def run_ok(*args):
            result = workflow(*args)
            assert result.returncode == 0, (args, result.stdout, result.stderr)
            assert token not in result.stdout + result.stderr
            return result
        power_observer = None
        try:
            tmux('-f', '/dev/null', 'new-session', '-d', '-s', 'work', '-n', 'untouched')
            original = tmux('list-panes', '-t', 'work:untouched', '-F', '#{pane_id} #{pane_pid}')
            run_ok('start')
            state = json.loads(run_ok('status').stdout)
            assert state['ready'] and state['state'] == 'verified'
            assert state['storage']['idle'] and len(state['window']) == 1 and state['tmuxAvailable']
            # Change only the disposable controller's config, not the live fixture
            # server's environment. Status must report uncertainty without mutation.
            config_path = checkout / 'bridge/.env'
            original_config = config_path.read_text()
            owner_pid = state['owner']['pid']
            try:
                config_path.write_text(original_config.replace(token, 'wrong-isolated-token-' * 3))
                unavailable = json.loads(run_ok('status').stdout)
                assert not unavailable['ready'] and unavailable['reason'] == 'health-authentication-failed'
                config_path.write_text(original_config.replace('PORT=' + str(port), 'PORT=1'))
                unavailable = json.loads(run_ok('status').stdout)
                assert not unavailable['ready'] and unavailable['reason'] == 'health-unavailable'
                config_path.write_text(original_config + 'PI_POCKET_TMUX_SESSION=missing_fixture_session\n')
                outside_tmux = json.loads(run_ok('status').stdout)
                assert outside_tmux['ready'] and outside_tmux['tmuxAvailable'] is False
            finally:
                config_path.write_text(original_config)
            assert api('/health')['processId'] == owner_pid
            assert not api('/v1/maintenance')['admissionsPaused']
            assert workflow('start').returncode != 0, 'Duplicate launch must fail'
            # Real queued/running fake-RPC work and pending approval block stop.
            api('/v1/jobs', {'requestId': 'fixture-approval', 'sessionId': 'chat', 'text': 'confirm'}, 202)
            until(lambda: api('/v1/jobs/fixture-approval').get('pending'))
            assert workflow('stop').returncode != 0
            assert api('/v1/maintenance')['admissionsPaused']
            api('/v1/jobs', {'requestId': 'blocked-new-job', 'text': 'hello'}, 429)
            api('/v1/jobs/fixture-approval/ui', {'id': 'dialog', 'confirmed': False})
            until(lambda: api('/v1/jobs/fixture-approval')['status'] == 'done')
            run_ok('resume')
            workspace = api('/v1/jobs/fixture-approval')['workspace']
            if options.screen_off_serial:
                # Two independent fake Pi children retain approvals while a third
                # chat performs a real harmless review command. No fixture APK.
                for n in range(2):
                    api('/v1/jobs', {'requestId': 'screen-approval-' + str(n), 'sessionId': 'approval' + str(n), 'text': 'confirm'}, 202)
                    until(lambda n=n: api('/v1/jobs/screen-approval-' + str(n)).get('pending'))
                private = Path(options.report).resolve().parent
                power_observer = SharedPowerObserver(options.screen_off_serial, private)
                power_observer.start()
                if power_observer.read() != (False, True):
                    raise ObservationUnavailable('Keep the screen awake and shared Termux wake lock held while arming')
                power = power_observer.read
                clock = lambda: time.clock_gettime(time.CLOCK_BOOTTIME)
                report(options, 'waiting-for-screen-off', target_seconds=options.off_seconds, wait_timeout_seconds=300,
                       observer='detached-same-phone-metadata', continuous_adb_required=False)
                deadline = clock() + 300
                while True:
                    asleep, held = power()
                    if asleep:
                        break
                    if clock() >= deadline:
                        raise ObservationUnavailable('No screen-off observed within five minutes')
                    time.sleep(1)
                assert held, 'Termux wake lock not observed at screen-off'
                power_observer.begin()
                off_started = previous_sample = clock()
                report(options, 'observing-screen-off', target_seconds=options.off_seconds)
            revision = api('/v1/sessions/chat/changes')['revision']
            action = {'operationId': 'fixture-shell-action', 'action': 'test', 'revision': revision,
                      'command': 'printf once >> dispatch-marker; sleep 5; printf complete >> completion-marker' if options.screen_off_serial else 'printf once >> dispatch-marker; sleep 2'}
            api('/v1/sessions/chat/actions', action, 202)
            if options.screen_off_serial:
                completed_while_off = False
                samples = 0
                max_sample_gap = 0
                while True:
                    asleep, held = power()
                    now = clock()
                    gap = now - previous_sample
                    max_sample_gap = max(max_sample_gap, gap)
                    if gap >= 8:
                        raise ObservationUnavailable('Observation gap too long to establish sampled screen-off')
                    previous_sample = now
                    assert asleep, 'Screen woke before the observation finished'
                    assert held, 'Termux wake lock missing during screen-off observation'
                    samples += 1
                    for n in range(2):
                        pending = api('/v1/jobs/screen-approval-' + str(n))
                        assert pending['status'] == 'running' and pending['pending']['id'] == 'dialog'
                    operation = api('/v1/sessions/chat/actions/fixture-shell-action')
                    if operation['status'] == 'done':
                        assert operation['result']['test']['exitCode'] == 0
                        assert (Path(workspace['cwd']) / 'completion-marker').read_text() == 'complete'
                        completed_while_off = True
                    assert operation['status'] not in ['failed', 'cancelled', 'interrupted'], 'Fixture review failed'
                    if now - off_started >= options.off_seconds:
                        assert completed_while_off, 'No completion observed while screen off'
                        break
                    time.sleep(1)
                report(options, 'screen-off-observation-passed', observed_seconds=round(now - off_started, 2), samples=samples,
                       max_sample_gap_seconds=round(max_sample_gap, 2), shell_completed_while_off=True, parallel_approvals_preserved=2, termux_wake_lock_observed=True)
                for n in range(2):
                    api('/v1/jobs/screen-approval-' + str(n) + '/ui', {'id': 'dialog', 'confirmed': False})
                    until(lambda n=n: api('/v1/jobs/screen-approval-' + str(n))['status'] == 'done')
            else:
                until(lambda: api('/v1/sessions/chat/actions/fixture-shell-action')['status'] == 'running')
                assert workflow('stop').returncode != 0, 'Review must block stop'
                until(lambda: api('/v1/sessions/chat/actions/fixture-shell-action')['status'] == 'done')
            db_path = checkout / 'bridge/data/assistant.sqlite'
            def persisted_records():
                with sqlite3.connect('file:' + str(db_path) + '?mode=ro', uri=True) as db:
                    return db.execute('select id,record from tasks order by id').fetchall()
            before = persisted_records()
            run_ok('stop')
            assert not (checkout / 'bridge/data/bridge.lock').exists()
            stopped = json.loads(run_ok('status').stdout)
            assert stopped['state'] == 'unavailable' and not stopped['ready']
            assert stopped['reason'] == 'storage-lock-missing' and stopped['storage'] is None
            # Observe the real fixture's lifecycle, not a mocked logger. Lock
            # release can precede the final event, so wait for the log boundary.
            def lifecycle():
                events = []
                for line in (checkout / 'bridge/data/bridge.log').read_text().splitlines():
                    try:
                        entry = json.loads(line)
                    except ValueError:
                        continue
                    if entry.get('event', '').startswith('bridge.'):
                        events.append(entry)
                return events
            until(lambda: any(e['event'] == 'bridge.closed' for e in lifecycle()))
            events = lifecycle()
            assert [e['event'] for e in events] == ['bridge.listening', 'bridge.shutdown', 'bridge.closed']
            assert all(e['pid'] == owner_pid for e in events)
            assert events[1]['status'] == 'SIGTERM'
            assert token not in json.dumps(events)
            backups = list((checkout / 'bridge/data/maintenance-backups').iterdir())
            assert len(backups) == 1 and (backups[0] / 'assistant.sqlite').exists()
            tmux('kill-window', '-t', 'work:pocket-bridge')  # Only the disposable exited window.
            run_ok('start')
            assert persisted_records() == before
            assert api('/v1/jobs/fixture-approval')['workspace'] == workspace
            assert api('/v1/sessions/chat/actions', action, 202)['status'] == 'done'
            assert (Path(workspace['cwd']) / 'dispatch-marker').read_text() == 'once'
            assert tmux('list-panes', '-t', 'work:untouched', '-F', '#{pane_id} #{pane_pid}') == original
            run_ok('stop')
            report(options, 'passed', screen_off_test=bool(options.screen_off_serial),
                   tmux_workflow=True, backup_restart=True, exact_id_non_replay=True, existing_pane_preserved=True)
            print('PASS: isolated tmux start/status, duplicate refusal, approval/review idle guards, pause/resume, backup, restart, exact-ID non-replay and untouched existing pane')
        finally:
            # Only the isolated fixture server/socket can be touched here.
            owner = checkout / 'bridge/data/bridge.lock'
            if owner.exists():
                try:
                    os.kill(int(owner.read_text()), 15)
                    until(lambda: not owner.exists())
                except (ProcessLookupError, ValueError):
                    pass
            subprocess.run(['tmux', '-S', socket_path, 'kill-server'], capture_output=True)
            if power_observer is not None:
                cleaned = power_observer.close()
                prior_phase = getattr(options, '_report_state', {}).get('phase', 'cleanup')
                report(options, prior_phase, power_sampler_cleaned=cleaned,
                       power_sampler_pending_directory=None if cleaned else str(power_observer.shared))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--screen-off-serial', help='Opt in: passively observe this authorized device; user turns screen off/unlocks')
    parser.add_argument('--off-seconds', type=int, default=30)
    parser.add_argument('--report', help='Private JSON progress/result path; required for the manual screen-off scenario')
    options = parser.parse_args()
    if not 5 <= options.off_seconds <= 120:
        parser.error('--off-seconds must be 5 through 120')
    if options.screen_off_serial and not options.report:
        parser.error('--report is required with --screen-off-serial')
    try:
        main(options)
    except Exception as error:
        phase = 'inconclusive' if isinstance(error, ObservationUnavailable) else 'failed'
        report(options, phase, error_type=type(error).__name__)
        raise
