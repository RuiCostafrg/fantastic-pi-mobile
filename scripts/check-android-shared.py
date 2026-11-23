#!/usr/bin/env python3
"""B08 isolated Android SQLite/HTTP verification; optional explicitly agreed visible UI.
Never reads normal app data, .env or production bridge state. Installs only identity-
verified reliability APKs and removes them only if absent before invocation.
"""
import argparse
import hashlib
import json
from pathlib import Path
import select
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = 'dev.fantasticpimobile.reliability'


def run(*args, timeout=120):
    p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if p.returncode:
        raise RuntimeError(f'{args[0]} failed ({p.returncode}): {p.stdout}{p.stderr}')
    return p.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serial', required=True)
    parser.add_argument('--ui', action='store_true', help='Also run separately authorized visible fixture Activity checks')
    parser.add_argument('--method', help='One focused headless regression method')
    args = parser.parse_args()
    adb = lambda *parts: run('adb', '-s', args.serial, *parts)
    assert adb('get-state').strip() == 'device'
    print('Authorized device:', adb('shell', 'getprop', 'ro.product.model').strip(), flush=True)
    aapt = Path.home() / '.local/android-sdk/aapt2-source/build/aapt2'
    outputs = ROOT / 'app/build/outputs/apk'
    packages = [PACKAGE, PACKAGE + '.test']
    apks = [outputs / 'debug/app-debug.apk', outputs / 'androidTest/debug/app-debug-androidTest.apk']
    for package, apk in zip(packages, apks):
        assert json.loads((apk.parent / 'output-metadata.json').read_text())['applicationId'] == package
        assert run(str(aapt), 'dump', 'badging', str(apk)).splitlines()[0].startswith("package: name='" + package + "'")
        print('Verified', package, hashlib.sha256(apk.read_bytes()).hexdigest(), flush=True)
    manifest = run(str(aapt), 'dump', 'xmltree', str(apks[1]), '--file', 'AndroidManifest.xml')
    assert 'androidx.test.runner.AndroidJUnitRunner' in manifest and f'="{PACKAGE}"' in manifest
    before = set(adb('shell', 'pm', 'list', 'packages', PACKAGE).splitlines())
    absent = {p: 'package:' + p not in before for p in packages}
    results = Path(tempfile.mkdtemp(prefix='b08-android-evidence-'))
    print('Evidence:', results, flush=True)
    try:
        for package, apk in zip(packages, apks):
            assert 'Success' in adb('install', '--no-streaming', *([] if absent[package] else ['-r']), str(apk))
        if not args.method:
            output = adb('shell', 'am', 'instrument', '-w', '-r', '-e', 'class',
                         'dev.fantasticpimobile.ConversationCacheTest,dev.fantasticpimobile.HistoryTest,dev.fantasticpimobile.ProjectHistoryTest',
                         PACKAGE + '.test/androidx.test.runner.AndroidJUnitRunner')
            (results / 'b07-data.log').write_text(output)
            assert 'OK (19 tests)' in output and output.count('INSTRUMENTATION_STATUS_CODE: 0') == 19, output
            print('PASS: existing Android SQLite data tests 19/19', flush=True)
        methods = [args.method] if args.method else [
            'discoversCompletedAndArchivedRemoteWorkWithoutChangingOrganizationOrCreatingLocalJobs',
            'lostAcceptanceReopensAndRecoversSameSavedRequestWithoutRedispatch',
            'lostImportReceiptRetainsUnresolvedOriginalRowsAndNeverSendsThem',
            'staleLifecycleCallbacksAndReplacedOrDowngradedOwnerCannotAdoptOrSubmit',
            'lostApprovalResponseIsNotReplayedAndStopTargetsOnlyExactRun',
            'unknownSchemaFeedRetainsConflictWithoutAdvancingAndRecoversFromOriginalCursor',
            'localContentConflictRetainsBothSidesAfterPageTransactionRollsBack',
            'competingRemoteAdmissionRemainsDiscoverableWhileSameIdOutboxWaits',
            'immutableImportConflictRemainsBlockedAfterReopen',
            'sameUrlRePairInvalidatesHealthBeforeAnyAdoptionOrDispatch',
            'sharedReviewLostResponseRecoversOriginalOperationAndPreservesSavedJson']
        cases = [('SharedConversationsTest#' + m, m) for m in methods]
        if args.ui:
            cases.extend([('SharedConversationsUiTest', 'visible-fixture'),
                          ('ProjectPickerUiTest', 'legacy-project-picker-ui'),
                          ('LiveStatusUiTest', 'legacy-live-status-ui')])
        for class_name, name in cases:
            directory = Path(tempfile.mkdtemp(prefix='b08-disposable-owner-'))
            process = None
            try:
                repo = directory / 'repo'; repo.mkdir()
                run('git', '-C', str(repo), 'init', '-b', 'trunk')
                run('git', '-C', str(repo), 'config', 'user.name', 'Fixture')
                run('git', '-C', str(repo), 'config', 'user.email', 'fixture@example.invalid')
                (repo / 'base.txt').write_text('B08 fixture base\n')
                run('git', '-C', str(repo), 'add', '.')
                run('git', '-C', str(repo), 'commit', '-m', 'Fixture base')
                (repo / 'staged.txt').write_text('Preserve staging\n')
                run('git', '-C', str(repo), 'add', 'staged.txt')
                original = [run('git', '-C', str(repo), 'rev-parse', 'HEAD'), run('git', '-C', str(repo), 'diff', '--cached', '--binary')]
                with (results / (name + '-owner.log')).open('w') as log:
                    process = subprocess.Popen(['node', str(ROOT / 'bridge/test/android-shared-fixture.js'), str(directory / 'state'), str(repo)],
                                               cwd=ROOT / 'bridge', stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, text=True, bufsize=1)
                    assert select.select([process.stdout], [], [], 30)[0], 'Fixture readiness timeout'
                    ready = json.loads(process.stdout.readline())
                    assert ready['ready'] and ready['pid'] == process.pid
                    output = adb('shell', 'am', 'instrument', '-w', '-r', '-e', 'class', 'dev.fantasticpimobile.' + class_name,
                                 '-e', 'endpoint', ready['endpoint'], '-e', 'projectId', ready['projectId'],
                                 PACKAGE + '.test/androidx.test.runner.AndroidJUnitRunner')
                    (results / (name + '.log')).write_text(output)
                    process.stdin.write('{"command":"snapshot"}\n'); process.stdin.flush()
                    assert select.select([process.stdout], [], [], 15)[0]
                    counts = json.loads(process.stdout.readline())
                    (results / (name + '-counts.json')).write_text(json.dumps(counts, indent=2))
                    assert 'OK (' in output and 'FAILURES!!!' not in output and 'INSTRUMENTATION_FAILED' not in output and 'INSTRUMENTATION_STATUS_CODE: -' not in output, output
                    assert len(counts['dispatches']) == len(set(counts['dispatches'])), 'Duplicate dispatch'
                    assert len(counts['replies']) == len(set(counts['replies'])), 'Duplicate approval delivery'
                    assert not any(i.startswith('old-') for i in counts['dispatches']), 'Imported unresolved request executed'
                    if name.startswith('lostAcceptance'):
                        assert len(counts['dispatches']) == 4 and len(counts['dropped']) == 1 and len(counts['submissions']) == 1, counts
                    if name.startswith('lostImport'):
                        assert len(counts['dispatches']) == 3 and len(counts['imports']) == 1 and len(counts['dropped']) == 1, counts
                    if name.startswith('sharedReview'):
                        assert len(counts['reviewSubmissions']) == 1 and len(counts['dropped']) == 1, counts
                    if name.startswith('lostApproval'):
                        assert counts['replies'] == ['remote-approval-run'] and len(counts['dropped']) == 1, counts
                    assert original == [run('git', '-C', str(repo), 'rev-parse', 'HEAD'), run('git', '-C', str(repo), 'diff', '--cached', '--binary')]
                    print('PASS:', name, '(actual SQLite/HTTP + no duplicate dispatch + source HEAD/staging preserved)', flush=True)
                    process.stdin.write('{"command":"close"}\n'); process.stdin.flush()
                    assert process.wait(timeout=30) == 0
            finally:
                if process and process.poll() is None:
                    # Only the exact subprocess created by this test; never a production owner.
                    process.terminate(); process.wait(timeout=30)
                shutil.rmtree(directory)
    finally:
        cleanup_errors = []
        for package in reversed(packages):
            if absent[package]:
                try:
                    present = set(adb('shell', 'pm', 'list', 'packages', PACKAGE).splitlines())
                    if 'package:' + package in present:
                        assert 'Success' in adb('uninstall', package)
                except Exception as error:
                    cleanup_errors.append(str(error))
        after = set(adb('shell', 'pm', 'list', 'packages', PACKAGE).splitlines())
        assert after == before and not cleanup_errors, 'Fixture cleanup incomplete: ' + '; '.join(cleanup_errors)
        print('Fixture package presence restored; normal app/data/production bridge untouched', flush=True)


if __name__ == '__main__':
    main()
