"""Bounded same-phone power metadata sampler, independent of ADB after startup.

The shared trace contains only boot uptime, wakefulness and Termux wake-lock
presence. It is not a background service or an Android survival mechanism.
"""
import math
from pathlib import Path
import shlex
import shutil
import subprocess
import time
import uuid


def boottime():
    return time.clock_gettime(time.CLOCK_BOOTTIME)


class ObservationUnavailable(RuntimeError):
    """Insufficient measurement evidence, not proof that work stopped."""


class PowerEvidence:
    def __init__(self, path, clock=boottime):
        self.path = Path(path)
        self.clock = clock
        self.seen = 0
        self.last_uptime = None
        self.strict = False
        self.latest = None

    def read(self):
        try:
            content = self.path.read_text()
        except OSError as error:
            raise ObservationUnavailable('Power trace unavailable') from error
        # A concurrent append may have an incomplete final line.
        lines = content.split('\n')[:-1]
        if not lines or len(lines) > 2048:
            raise ObservationUnavailable('No bounded power evidence')
        rows = []
        for line in lines:
            fields = line.split('\t')
            try:
                uptime = float(fields[0])
                state, held = fields[1:]
            except (ValueError, IndexError) as error:
                raise ObservationUnavailable('Malformed power evidence') from error
            if not math.isfinite(uptime) or uptime <= 0 or state not in ['Awake', 'Asleep', 'Dozing', 'Dreaming'] or held not in ['0', '1']:
                raise ObservationUnavailable('Invalid or unknown power evidence')
            if rows and uptime <= rows[-1][0]:
                raise ObservationUnavailable('Nonmonotonic power evidence')
            rows.append((uptime, state, held == '1'))
        age = self.clock() - rows[-1][0]
        if age < -2 or age >= 8:
            raise ObservationUnavailable('Stale power trace or different boot clock')
        if len(rows) < self.seen or (self.seen and rows[self.seen - 1][0] != self.last_uptime):
            raise ObservationUnavailable('Power trace was truncated or replaced')
        if self.strict:
            previous = self.last_uptime
            for uptime, state, held in rows[self.seen:]:
                if uptime - previous >= 8:
                    raise ObservationUnavailable('Gap in device power samples')
                if state != 'Asleep':
                    raise AssertionError('Screen woke during measurement')
                if not held:
                    raise AssertionError('Termux wake lock missing during measurement')
                previous = uptime
        self.seen = len(rows)
        self.last_uptime = rows[-1][0]
        self.latest = (rows[-1][1] == 'Asleep', rows[-1][2])
        return self.latest

    def begin(self):
        if self.latest != (True, True):
            raise ObservationUnavailable('Fresh Asleep and wake-lock evidence required')
        self.strict = True


# Runs as the authorized Android shell user. No raw dumps, UI text or secrets
# are retained. dumpsys has its own bounded timeout; the loop has a boot-clock
# deadline, a sample cap, and a local stop-file gate.
MONITOR_SCRIPT = r'''#!/system/bin/sh
out=$1
seconds=$2
reason=unexpected-exit
finish() {
  printf '%s\n' "$reason" > "$out/exit-reason"
  printf 'done\n' > "$out/done"
  rm -f "$0"
}
trap finish EXIT
trap 'reason=signal-hup; exit 129' HUP
trap 'reason=signal-int; exit 130' INT
trap 'reason=signal-term; exit 143' TERM
read up ignored < /proc/uptime
start=${up%.*}
count=0
while :; do
  if [ -e "$out/stop" ]; then reason=stop-requested; break; fi
  if [ "$count" -ge 600 ]; then reason=sample-limit; break; fi
  read up ignored < /proc/uptime
  if [ "$(( ${up%.*} - start ))" -ge "$seconds" ]; then reason=deadline; break; fi
  # Stream the dump: Android's external printf cannot accept a >128 KiB
  # single argument. Never buffer the entire power log in a shell argument.
  /system/bin/dumpsys -t 3 power 2>/dev/null | /system/bin/awk '
    BEGIN { state="Unknown"; held=0 }
    /^[[:space:]]*mWakefulness=/ { split($0, a, "="); state=a[2]; gsub(/[[:space:]]/, "", state) }
    /PARTIAL_WAKE_LOCK/ && /com[.]termux[.]app[.]TermuxService/ { held=1 }
    END { getline up < "/proc/uptime"; split(up, t, " "); printf "%s\t%s\t%s\n", t[1], state, held }
  ' >> "$out/samples.tsv" || { reason=sample-write-failed; break; }
  count=$((count + 1))
  /system/bin/sleep 1 || { reason=sleep-failed; break; }
done
'''


EXIT_REASONS = frozenset({'stop-requested', 'sample-limit', 'deadline',
    'sample-write-failed', 'sleep-failed', 'unexpected-exit',
    'signal-hup', 'signal-int', 'signal-term'})


class SharedPowerObserver:
    def __init__(self, serial, private_directory, *, shared_parent=Path('/storage/emulated/0/Download'), clock=boottime, runner=subprocess.run):
        self.serial = serial
        self.private = Path(private_directory)
        self.clock = clock
        self.runner = runner
        identifier = uuid.uuid4().hex
        self.shared = Path(shared_parent) / ('.pi-pocket-power-' + identifier)
        self.remote_script = '/data/local/tmp/pi-pocket-power-' + identifier + '.sh'
        self.samples = self.shared / 'samples.tsv'
        self.evidence = PowerEvidence(self.samples, clock)

    def _adb(self, *args, **kwargs):
        try:
            return self.runner(['adb', '-s', self.serial, *args], check=True, capture_output=True, text=True, timeout=10, **kwargs)
        except (subprocess.SubprocessError, OSError) as error:
            raise ObservationUnavailable('ADB unavailable while starting device sampler') from error

    def start(self):
        if self._adb('get-state').stdout.strip() != 'device':
            raise ObservationUnavailable('Authorized explicit device required')
        # Reading a fresh shell-written file on this host is also the same-phone
        # capability check. A remote ADB host cannot silently use this adapter.
        try:
            self.shared.mkdir(mode=0o700)
        except OSError as error:
            raise ObservationUnavailable('Same-phone shared metadata directory unavailable') from error
        remote = shlex.quote(self.remote_script)
        self._adb('shell', 'cat > ' + remote + ' && chmod 700 ' + remote, input=MONITOR_SCRIPT)
        launch = '/system/bin/nohup /system/bin/sh ' + remote + ' ' + shlex.quote(str(self.shared)) + ' 420 </dev/null >/dev/null 2>&1 &'
        self._adb('shell', launch)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                self.read()
                return
            except ObservationUnavailable:
                time.sleep(.2)
        raise ObservationUnavailable('Detached sampler did not produce readable same-phone evidence')

    def read(self):
        # Fresh final rows do not prove a sampler is still observing. Never
        # accept a known-completed trace as current screen-off evidence.
        if (self.shared / 'done').exists():
            try:
                reason = (self.shared / 'exit-reason').read_text().strip()
            except OSError:
                reason = 'unknown'
            if reason not in EXIT_REASONS:
                reason = 'unknown'
            raise ObservationUnavailable('Device sampler stopped (' + reason + ')')
        return self.evidence.read()

    def begin(self):
        self.evidence.begin()

    def close(self):
        if not self.shared.exists():
            return True
        (self.shared / 'stop').touch()
        deadline = time.monotonic() + 6
        while time.monotonic() < deadline and not (self.shared / 'done').exists():
            time.sleep(.1)
        if self.samples.exists():
            shutil.copyfile(self.samples, self.private / 'power-samples.tsv')
            (self.private / 'power-samples.tsv').chmod(0o600)
        if (self.shared / 'done').exists():
            # Fixed-size/allowlisted diagnostic metadata only; never archive
            # arbitrary remote contents as an explanation.
            try:
                reason = (self.shared / 'exit-reason').read_text().strip()
            except OSError:
                reason = 'unknown'
            destination = self.private / 'power-exit-reason.txt'
            destination.write_text((reason if reason in EXIT_REASONS else 'unknown') + '\n')
            destination.chmod(0o600)
            shutil.rmtree(self.shared)
            return True
        # Do not remove a directory while an uncertain sampler may still write.
        # Its 420-second deadline remains; retain metadata for later cleanup.
        return False
