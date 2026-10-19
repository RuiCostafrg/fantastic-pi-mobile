#!/usr/bin/env python3
"""Explicit, same-device debug-app migration; never deletes the old installation.

Install the new normal app AND matching test APK first, but do not launch them.
Run with --serial EXACT_AUTHORIZED_SERIAL --confirmed. Backups contain private
history and must remain under the ignored bridge/data directory. Pairing input
travels through subprocess pipes and app-private files, never argv or logs.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tarfile
import time
import xml.etree.ElementTree as ET

OLD = 'dev.pipocket'  # Source identity only; never uninstall/clear it.
NEW = 'dev.fantasticpimobile'
ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serial', required=True)
    parser.add_argument('--confirmed', action='store_true', required=True)
    parser.add_argument('--quarantine-pending', action='store_true',
                        help='Preserve uncertain request IDs/text, but import their status as interrupted; never replay')
    args = parser.parse_args()
    os.umask(0o077)

    def adb(*command, data=None):
        result = subprocess.run(['adb', '-s', args.serial, *command], input=data,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if result.returncode:
            raise RuntimeError('ADB migration step failed; inspect privately, never print raw app data')
        return result.stdout

    def archive(package):
        return adb('exec-out', 'run-as', package, 'tar', '-cf', '-', 'databases', 'shared_prefs')

    def files(raw):
        result = {}
        with tarfile.open(fileobj=io.BytesIO(raw)) as tar:
            for member in tar:
                if member.isdir():
                    continue
                if not member.isfile() or member.name.startswith('/') or '..' in Path(member.name).parts:
                    raise RuntimeError('Unexpected app archive member')
                result[member.name.removeprefix('./')] = tar.extractfile(member).read()
        return result

    # Refuse to merge/overwrite a populated target, including after a partial run.
    adb('shell', 'run-as', NEW, 'sh', '-c',
                  "'test ! -d databases || test -z \"$(ls -A databases)\"'")
    adb('shell', 'am', 'force-stop', OLD)
    adb('shell', 'am', 'force-stop', NEW)
    backup = ROOT / 'bridge/data/maintenance-backups' / ('android-package-migration-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()))
    backup.mkdir(parents=True, mode=0o700, exist_ok=False)
    raw = archive(OLD)
    (backup / 'old-app.tar').write_bytes(raw)
    old = files(raw)
    if 'databases/pocket.sqlite' not in old:
        raise RuntimeError('Source history database missing; no empty migration allowed')
    # Read only the backed-up database and any WAL, not the live source.
    dbdir = backup / 'database-check'
    dbdir.mkdir(mode=0o700)
    for name, value in old.items():
        if name.startswith('databases/pocket.sqlite'):
            (dbdir / Path(name).name).write_bytes(value)
    db = sqlite3.connect('file:' + str(dbdir / 'pocket.sqlite') + '?mode=ro', uri=True)
    try:
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('Source database integrity check failed')
        pending = db.execute("SELECT id FROM jobs WHERE status IN ('sending','queued','running')").fetchall()
        if pending and not args.quarantine_pending:
            raise RuntimeError('Source has uncertain/active requests; inspect before migrating')
        counts = {table: db.execute('SELECT count(*) FROM ' + table).fetchone()[0] for table in ('sessions', 'jobs')}
        quarantined_database = None
        if pending:
            target = backup / 'quarantined-history.sqlite'
            migrated_db = sqlite3.connect(target)
            try:
                db.backup(migrated_db)
                migrated_db.execute("UPDATE jobs SET status='interrupted', progress='Package migration: uncertain request preserved without replay. Review before sending a new request.', pending='' WHERE status IN ('sending','queued','running')")
                migrated_db.commit()
                assert migrated_db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
            finally:
                migrated_db.close()
            quarantined_database = target.read_bytes()
    finally:
        db.close()
    endpoint = 'http://127.0.0.1:8787'
    if 'shared_prefs/connection.xml' in old:
        prefs = ET.fromstring(old['shared_prefs/connection.xml'])
        endpoint = next((node.text for node in prefs if node.get('name') == 'endpoint'), endpoint)
    migrated = {}
    for name, value in old.items():
        if name.startswith('databases/pocket.sqlite'):
            if quarantined_database is None:
                migrated[name.replace('pocket.sqlite', 'fantastic-pi-mobile.sqlite')] = value
            elif name == 'databases/pocket.sqlite':
                migrated['databases/fantastic-pi-mobile.sqlite'] = quarantined_database
        elif name.startswith('shared_prefs/') and not Path(name).name.startswith('connection.xml'):
            migrated[name] = value
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w') as tar:
        for name, value in migrated.items():
            member = tarfile.TarInfo(name)
            member.size = len(value)
            member.mode = 0o600
            tar.addfile(member, io.BytesIO(value))
    adb('shell', 'run-as', NEW, 'mkdir', '-p', 'databases', 'shared_prefs', 'files')
    adb('exec-in', 'run-as', NEW, 'tar', '-xf', '-', data=stream.getvalue())
    restored = files(archive(NEW))
    if any(restored.get(name) != value for name, value in migrated.items()):
        raise RuntimeError('Restored history/preferences mismatch; do not launch the target')
    # Node parses the trusted private .env; capture output directly in memory.
    result = subprocess.run(['node', '--env-file=.env', '-e',
                             "process.stdout.write(JSON.stringify({token:process.env.FANTASTIC_PI_MOBILE_TOKEN}))"],
                            cwd=ROOT / 'bridge', stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    token = json.loads(result.stdout).get('token')
    if not isinstance(token, str) or len(token) < 32:
        raise RuntimeError('Trusted bridge pairing configuration unavailable')
    pairing = json.dumps({'endpoint': endpoint, 'token': token}).encode()
    adb('shell', '-T', 'run-as', NEW, 'sh', '-c', "'umask 077; cat > files/migration-pairing.json'", data=pairing)
    if adb('exec-out', 'run-as', NEW, 'cat', 'files/migration-pairing.json') != pairing:
        adb('shell', 'run-as', NEW, 'rm', '-f', 'files/migration-pairing.json')
        raise RuntimeError('Private pairing transfer verification failed')
    try:
        output = adb('shell', 'am', 'instrument', '-w', '-e', 'migration', 'confirmed', '-e', 'class',
                     'dev.fantasticpimobile.MigrationPairingTest', NEW + '.test/androidx.test.runner.AndroidJUnitRunner')
        if b'OK (1 test)' not in output or b'FAILURES' in output:
            raise RuntimeError('Pairing import did not pass; inspect privately')
    finally:
        adb('shell', 'run-as', NEW, 'rm', '-f', 'files/migration-pairing.json')
    manifest = {'sourcePackage': OLD, 'targetPackage': NEW, 'counts': counts,
                'copiedFiles': {name: hashlib.sha256(value).hexdigest() for name, value in migrated.items()},
                'verifiedTransferBeforeLaunch': True, 'pairingReencrypted': True,
                'quarantinedRequestIds': [row[0] for row in pending]}
    (backup / 'verification.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'migrated': True, **counts, 'verifiedTransferBeforeLaunch': True,
                      'quarantinedRequests': len(pending), 'pairingReencrypted': True, 'oldAppRetained': True}))


if __name__ == '__main__':
    main()
