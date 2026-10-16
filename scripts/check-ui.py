#!/usr/bin/env python3
"""Read-only on-device assertions. Run with Pi Pocket's main screen visible.

python scripts/check-ui.py unpaired
python scripts/check-ui.py done --contains Benfica
Uses adb's selected/default device (ANDROID_SERIAL is supported).
Never prints conversation text, tokens, or the UI tree.
"""
import argparse
import subprocess
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('state', choices=['unpaired', 'done', 'cancelled'])
parser.add_argument('--contains', default='')
args = parser.parse_args()
subprocess.run(['adb', 'shell', 'uiautomator', 'dump', '/sdcard/pi-pocket-check.xml'], check=True, stdout=subprocess.DEVNULL)
xml = subprocess.check_output(['adb', 'exec-out', 'cat', '/sdcard/pi-pocket-check.xml'])
nodes = list(ET.fromstring(xml).iter('node'))
assert any(n.get('package') == 'dev.pipocket' for n in nodes), 'Pi Pocket not visible'
texts = [n.get('text', '') for n in nodes]
buttons = [n for n in nodes if n.get('class') == 'android.widget.Button']
if args.state == 'unpaired':
    assert not any('PI · SENDING' in text for text in texts), 'Unpaired request misleadingly shown as SENDING'
    assert any(n.get('text', '').upper() == 'PAIR BRIDGE' and n.get('enabled') == 'true' for n in buttons), 'No enabled pairing action'
else:
    # Message cards are separate TextViews; inspect the last visible Pi card.
    transcripts = [text for text in texts if text.startswith('PI · ')]
    latest = transcripts[-1].rsplit('PI · ', 1)[-1] if transcripts else ''
    assert latest.startswith(args.state.upper() + '\n'), 'Latest request has not reached expected state'
    assert args.contains.casefold() in latest.casefold(), 'Expected answer missing from latest request'
    assert any(n.get('text', '').upper() == 'SEND' and n.get('enabled') == 'true' for n in buttons), 'Send not re-enabled'
print('PASS:', args.state)
