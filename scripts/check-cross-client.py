#!/usr/bin/env python3
"""B10 only: headless reliability Android <-> real B09 terminal, independent fake-RPC owner.
No normal app, visible UI, production controller/config, providers or phone settings.
"""
import argparse
import hashlib
import json
from pathlib import Path
import select
import secrets
import shutil
import signal
import subprocess
import tempfile
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = 'dev.fantasticpimobile.reliability'


def run(*args, timeout=120):
    p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if p.returncode:
        raise RuntimeError(f'{args[0]} failed ({p.returncode}): {p.stdout}{p.stderr}')
    return p.stdout


class Peer:
    def __init__(self, argv, log, close_command='detach'):
        self.close_command = close_command
        self.p = subprocess.Popen(argv, cwd=ROOT / 'bridge', stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, text=True, bufsize=1)

    def next(self):
        assert select.select([self.p.stdout], [], [], 30)[0], 'Process response deadline'
        line = self.p.stdout.readline()
        assert line, 'Process exited without reply'
        return json.loads(line)

    def call(self, **command):
        self.p.stdin.write(json.dumps(command) + '\n'); self.p.stdin.flush()
        return self.next()

    def stop(self):
        if self.p.poll() is None:
            try:
                self.p.stdin.write(json.dumps({'command': self.close_command}) + '\n'); self.p.stdin.flush()
                self.p.wait(timeout=30)
            except (BrokenPipeError, subprocess.TimeoutExpired):
                self.p.terminate(); self.p.wait(timeout=30)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serial', required=True)
    args = parser.parse_args()
    adb = lambda *a: run('adb', '-s', args.serial, *a)
    assert adb('get-state').strip() == 'device'
    print('Device:', adb('shell', 'getprop', 'ro.product.model').strip(), flush=True)
    outputs = ROOT / 'app/build/outputs/apk'
    apks = [outputs / 'debug/app-debug.apk', outputs / 'androidTest/debug/app-debug-androidTest.apk']
    packages = [PACKAGE, PACKAGE + '.test']
    aapt = str(Path.home() / '.local/android-sdk/aapt2-source/build/aapt2')
    for apk, package in zip(apks, packages):
        assert json.loads((apk.parent / 'output-metadata.json').read_text())['applicationId'] == package
        assert run(aapt, 'dump', 'badging', str(apk)).splitlines()[0].startswith("package: name='" + package + "'")
        print('Verified APK', package, hashlib.sha256(apk.read_bytes()).hexdigest(), flush=True)
    manifest = run(aapt, 'dump', 'xmltree', str(apks[1]), '--file', 'AndroidManifest.xml')
    assert 'androidx.test.runner.AndroidJUnitRunner' in manifest and f'="{PACKAGE}"' in manifest
    print('Verified runner: androidx.test.runner.AndroidJUnitRunner ->', PACKAGE, flush=True)
    before = set(adb('shell', 'pm', 'list', 'packages', PACKAGE).splitlines())
    print('Prior fixture packages:', sorted(before), flush=True)
    # Never replace a pre-existing fixture or its pairing/data. Presence remains unchanged.
    assert not before, 'Existing reliability package: refusing to replace fixture state'
    evidence = Path(tempfile.mkdtemp(prefix='b10-evidence-'))
    base = Path(tempfile.mkdtemp(prefix='b10-disposable-'))
    print('Evidence:', evidence, flush=True)
    token = secrets.token_hex(32)
    token_path = base / 'token'; token_path.write_text(token); token_path.chmod(0o600)
    owner = client = None
    peers = []
    try:
        roots = [base / 'a', base / 'b']
        def git(root, *a): return run('git', '-C', str(root), *a)
        for root in roots:
            root.mkdir(); git(root, 'init', '-b', 'trunk')
            git(root, 'config', 'user.name', 'Fixture'); git(root, 'config', 'user.email', 'fixture@example.invalid')
            (root / 'context.txt').write_text(''); git(root, 'add', '.'); git(root, 'commit', '-m', 'B10 fixture')
            (root / 'staged.txt').write_text('KEEP B10 STAGING\n'); git(root, 'add', 'staged.txt')
        originals = [(git(r, 'rev-parse', 'HEAD'), git(r, 'diff', '--cached', '--binary')) for r in roots]
        with (evidence / 'owner.log').open('w') as ownerlog, (evidence / 'terminal.log').open('w') as clientlog:
            owner = Peer(['node', str(ROOT / 'bridge/test/b10-owner-fixture.js'), str(base / 'state'), *map(str, roots), str(token_path)], ownerlog, close_command='close'); peers.append(owner)
            ready = owner.next(); assert ready['ready'] and ready['pid'] == owner.p.pid
            for apk in apks: assert 'Success' in adb('install', '--no-streaming', str(apk))
            # Secret goes only through stdin into the isolated app's private sandbox.
            transferred = subprocess.run(['adb', '-s', args.serial, 'shell', 'run-as', PACKAGE, 'sh', '-c',
                                          "'umask 077; mkdir -p files; cat > files/b10-token'"],
                                         input=token, capture_output=True, text=True, timeout=15)
            assert transferred.returncode == 0, 'Private fixture credential transfer failed'
            database = 'b10-' + str(uuid.uuid4()) + '.sqlite'
            def absent():
                adb('shell', 'am', 'force-stop', PACKAGE)
                # pidof's exit 1 means absent, unlike the checked command helper.
                p = subprocess.run(['adb', '-s', args.serial, 'shell', 'pidof', PACKAGE], capture_output=True, text=True, timeout=15)
                assert p.returncode == 1 and not p.stdout.strip(), 'Android fixture process still present'
            def android(method, **extra):
                options = {'endpoint': ready['endpoint'], 'projectId': ready['projectId'], 'projectB': ready['projectB'], 'database': database, **extra}
                command = ['shell', 'am', 'instrument', '-w', '-r', '-e', 'class', 'dev.fantasticpimobile.CrossClientContinuityTest#' + method]
                for k, v in options.items(): command += ['-e', k, v]
                output = adb(*command, PACKAGE + '.test/androidx.test.runner.AndroidJUnitRunner')
                (evidence / (method + '.log')).write_text(output)
                assert 'OK (1 test)' in output and 'INSTRUMENTATION_STATUS_CODE: -' not in output, output
                absent()
                print('PASS Android process:', method, flush=True)
            def snapshot(name):
                s = owner.call(command='snapshot'); (evidence / (name + '.json')).write_text(json.dumps(s, indent=2)); return s
            def waitjob(id, status):
                for _ in range(150):
                    s = owner.call(command='snapshot')
                    if s['jobs'].get(id, {}).get('status') == status: return s['jobs'][id]
                    time.sleep(.1)
                raise AssertionError('Job deadline ' + id)
            def ok(result):
                assert result.get('ok'), result
                return result['result']
            def terminal(name='terminal'):
                directory = base / name; directory.mkdir(mode=0o700, exist_ok=True)
                config = directory / 'config.json'; config.write_text(json.dumps({'endpoint': ready['endpoint'], 'token': token, 'pageSize': 1})); config.chmod(0o600)
                p = Peer(['node', str(ROOT / 'scripts/conversation-client.mjs'), '--config', str(config)], clientlog); peers.append(p)
                assert p.next() == {'ready': True}
                return p
            android('androidSendsFirstTurn')
            initial = snapshot('android-first')
            first = next(iter(initial['jobs'].values()))
            def tree_identity(job):
                tree = Path(job['workspace']['path'])
                return {'manifest': Path(str(tree) + '.json').read_text(), 'head': git(tree, 'rev-parse', 'HEAD'), 'branch': git(tree, 'symbolic-ref', 'HEAD')}
            first_tree = tree_identity(first)
            assert first['text'] == 'ANDROID_A' and first['sessionId'] == 'b10-chat-a' and first['projectId'] == ready['projectId']
            client = terminal()
            opened = ok(client.call(command='open', conversationId='b10-chat-a'))
            assert opened['records'][0]['id'] == first['id']
            # Project B is independently active before the next A turn.
            import urllib.request
            headers = {'Authorization': 'Bearer ' + token, 'X-Conversation-Schema': '1', 'X-Conversation-Owner': ready['ownerId'], 'Content-Type': 'application/json'}
            request = urllib.request.Request(ready['endpoint'] + '/v1/jobs', data=json.dumps({'requestId': 'b10-project-b-run', 'conversationId': 'b10-chat-b', 'projectId': ready['projectB'], 'text': 'HOLD_B'}).encode(), headers=headers)
            with urllib.request.urlopen(request, timeout=10) as response: assert response.status == 202
            waitjob('b10-project-b-run', 'running')
            sent = ok(client.call(command='send', conversationId='b10-chat-a', text='TERMINAL_A'))
            runid = sent['id']; waitjob(runid, 'running')
            ok(client.call(command='detach')); assert client.p.wait(timeout=15) == 0
            absent()
            before_release = snapshot('detached-running')
            assert before_release['jobs'][runid]['status'] == 'running'
            owner.call(command='offline')
            android('androidOfflineReopenRetainsOriginalEvidence')
            absent(); owner.call(command='release', id=runid)
            completed = waitjob(runid, 'done') # Both clients absent; even HTTP is offline.
            assert completed['.b10-dispatches'] == 'ANDROID_A\nTERMINAL_A\n'
            contexts = [json.loads(x) for x in completed['.b10-contexts'].splitlines()]
            assert contexts == [{'text': 'ANDROID_A', 'previous': ''}, {'text': 'TERMINAL_A', 'previous': 'ANDROID_A\n'}]
            assert completed['workspace'] == first['workspace']
            assert tree_identity(completed) == first_tree
            owner.call(command='online')
            android('androidReopensAfterTerminalCompletion', terminalRun=runid)
            live = snapshot('reconciled')
            assert live['jobs']['b10-project-b-run']['status'] == 'running'
            assert live['jobs']['b10-project-b-run']['workspace']['cwd'] != completed['workspace']['cwd']
            assert live['jobs']['b10-project-b-run']['.b10-dispatches'] == 'HOLD_B\n'
            saved_trees = {id: tree_identity(job) for id, job in live['jobs'].items()}
            # Quiesce B explicitly before testing orderly idle owner reopen.
            client = terminal()
            ok(client.call(command='stop', conversationId='b10-chat-b', projectId=ready['projectB'], runId='b10-project-b-run', confirm='b10-project-b-run'))
            waitjob('b10-project-b-run', 'cancelled'); ok(client.call(command='detach')); client.p.wait(timeout=15)
            assert owner.call(command='reopen')['ownerId'] == ready['ownerId']
            android('androidReconcilesDuplicatePagesAfterOwnerReopen')
            final = snapshot('final')
            assert len(final['launches']) == 3 and len({x['id'] for x in final['launches']}) == 3
            assert final['ownerId'] == ready['ownerId']
            for id, job in final['jobs'].items():
                assert job['projectId'] == (ready['projectB'] if id == 'b10-project-b-run' else ready['projectId'])
            assert [(git(r, 'rev-parse', 'HEAD'), git(r, 'diff', '--cached', '--binary')) for r in roots] == originals
            assert all((r / 'context.txt').read_text() == '' for r in roots)
            # Worktree identity and dirty marker bytes survive owner reopen.
            for id, job in live['jobs'].items():
                assert final['jobs'][id]['workspace'] == job['workspace']
                assert tree_identity(final['jobs'][id]) == saved_trees[id]
                assert final['jobs'][id]['.b10-dispatches'] == job['.b10-dispatches']
            (evidence / 'worktree-identities.json').write_text(json.dumps(saved_trees, indent=2))
            # A genuinely lost Android acceptance, followed by process absence and
            # SQLite reopen in another process. Recovery must GET the original ID.
            loss_database = 'b10-loss-' + str(uuid.uuid4()) + '.sqlite'
            owner.call(command='drop')
            android('androidLosesSendResponseBeforeProcessLoss', database=loss_database)
            lost_android = snapshot('android-lost-acceptance')
            lost_android_job = next(j for j in lost_android['jobs'].values() if j['sessionId'] == 'b10-lost-a')
            android('androidRecoversOriginalSendAfterProcessLoss', database=loss_database, lostAndroidRun=lost_android_job['id'])
            recovered_android = snapshot('android-original-id-recovered')
            assert recovered_android['submissions'].count(lost_android_job['id']) == 1
            assert len([x for x in recovered_android['launches'] if x['id'] == lost_android_job['id']]) == 1
            assert lost_android_job['id'] in recovered_android['dropped']
            # Separate simultaneous-send case: both independent client requests reach
            # the proxy barrier before either can be admitted. One run, two durable IDs.
            def post(path, body):
                request = urllib.request.Request(ready['endpoint'] + path, data=json.dumps(body).encode(), headers=headers)
                with urllib.request.urlopen(request, timeout=15) as response: return json.load(response)
            post('/v1/conversations', {'conversationId': 'b10-race', 'projectId': ready['projectId']})
            client = terminal('race-terminal')
            ok(client.call(command='open', conversationId='b10-race'))
            owner.call(command='barrier', kind='send')
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(android, 'androidCompetesWithTerminalSend', database='b10-race-' + str(uuid.uuid4()) + '.sqlite')
                result = client.call(command='send', conversationId='b10-race', text='RACE_A')
                future.result(timeout=120)
            raced = snapshot('simultaneous-send')
            attempts = [r['body']['requestId'] for r in raced['requests'] if r['path'] == '/v1/jobs' and r['body']['conversationId'] == 'b10-race']
            assert len(attempts) == 2 and len(set(attempts)) == 2
            admitted = [j for j in raced['jobs'].values() if j['sessionId'] == 'b10-race']
            assert len(admitted) == 1 and admitted[0]['id'] in attempts
            racejob = waitjob(admitted[0]['id'], 'running')
            assert len([x for x in raced['launches'] if x['id'] in attempts]) == 1
            ok(client.call(command='stop', conversationId='b10-race', projectId=ready['projectId'], runId=racejob['id'], confirm=racejob['id']))
            waitjob(racejob['id'], 'cancelled')
            ok(client.call(command='detach')); client.p.wait(timeout=15)
            # Separate lost Send response: real B09 intent survives exit, GET original
            # ID recovers without POST; Android discovers the admitted remote run.
            client = terminal('lost-terminal'); owner.call(command='drop')
            lost = client.call(command='send', conversationId='b10-chat-a', text='APPROVE_A')
            assert not lost['ok']
            saved = json.loads((base / 'lost-terminal/conversation-state.json').read_text())
            lostid = next(iter(saved['outbox']))
            ok(client.call(command='detach')); client.p.wait(timeout=15)
            approval = waitjob(lostid, 'running')
            for _ in range(100):
                approval = owner.call(command='snapshot')['jobs'][lostid]
                if approval.get('approvalOccurrenceId'): break
                time.sleep(.1)
            assert approval['approvalOccurrenceId']
            client = terminal('lost-terminal')
            # Old completed-run Stop must not cancel this later same-chat approval.
            ok(client.call(command='stop', conversationId='b10-chat-a', projectId=ready['projectId'], runId=first['id'], confirm=first['id']))
            assert owner.call(command='snapshot')['jobs'][lostid]['status'] == 'running'
            recovered = ok(client.call(command='recover'))
            assert recovered['sends'][0]['id'] == lostid
            # Race answers on this exact run; first winner's complete HTTP response
            # is dropped after the durable claim/delivery. Both clients retain IDs.
            owner.call(command='barrier', kind='approval'); owner.call(command='drop')
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(android, 'androidCompetesWithTerminalApproval', approvalChat='b10-chat-a')
                answer = client.call(command='answer', conversationId='b10-chat-a', projectId=ready['projectId'], runId=lostid,
                                     approvalId=approval['approvalOccurrenceId'], answer={'confirmed': True})
                future.result(timeout=120)
            assert not answer['ok'] # Loser conflict or winner's deliberately lost response.
            waitjob(lostid, 'done')
            ok(client.call(command='detach')); client.p.wait(timeout=15)
            client = terminal('lost-terminal')
            ok(client.call(command='recover'))
            ok(client.call(command='detach')); client.p.wait(timeout=15)
            android('androidReopensAfterApprovalRaceWithoutReplay', approvalChat='b10-chat-a')
            raced = snapshot('approval-race-lost-response')
            assert len(raced['jobs'][lostid]['.b10-replies'].splitlines()) == 1
            answer_requests = [r for r in raced['requests'] if '/approvals/' in r['path']]
            assert len(answer_requests) == 2
            assert len({r['body']['responseId'] for r in answer_requests}) == 2
            assert raced['submissions'].count(lostid) == 1
            assert len([x for x in raced['launches'] if x['id'] == lostid]) == 1
            assert lostid in raced['dropped'] and len(raced['dropped']) == 3
            assert [(git(r, 'rev-parse', 'HEAD'), git(r, 'diff', '--cached', '--binary')) for r in roots] == originals
            (evidence / 'summary.json').write_text(json.dumps({'androidPhases': 9, 'dispatches': len(raced['launches']), 'ownerReopen': True, 'sourceHeadAndStagingPreserved': True, 'simultaneousSends': 2, 'approvalPosts': 2, 'approvalDeliveries': 1}, indent=2))
            print('PASS B10 primary continuity: original IDs/context/worktrees, detached offline completion, Android reconcile, B isolation, idle reopen', flush=True)
            owner.p.stdin.write('{"command":"close"}\n'); owner.p.stdin.flush(); assert owner.p.wait(timeout=30) == 0
    finally:
        errors = []
        for p in reversed(peers):
            try: p.stop()
            except Exception as error: errors.append(str(error))
        for package in reversed(packages):
            try:
                present = adb('shell', 'pm', 'list', 'packages', PACKAGE).splitlines()
                if 'package:' + package in present: assert 'Success' in adb('uninstall', package)
            except Exception as error: errors.append(str(error))
        after = set(adb('shell', 'pm', 'list', 'packages', PACKAGE).splitlines())
        print('Final fixture packages:', sorted(after), flush=True)
        assert after == before and not errors, 'Fixture cleanup failed: ' + '; '.join(errors)
        shutil.rmtree(base)
        print('Fixture packages restored absent; disposable processes/repositories removed', flush=True)


if __name__ == '__main__':
    def interrupted(signum, frame):
        raise KeyboardInterrupt('Bounded B10 run interrupted; restoring fixture presence')
    signal.signal(signal.SIGTERM, interrupted)
    main()
