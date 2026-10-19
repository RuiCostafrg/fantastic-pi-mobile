# Optional Fantastic Pi Mobile host adapter for pi-droid

This external plugin delegates to `scripts/bridge-work`. It is **not enabled by
installation**, does not select an Android device, and never starts/stops a bridge
on initialization, heartbeat or unload. It requires a host-local Fantastic Pi Mobile checkout,
Node >=22.19, Linux/Termux procfs, and the existing tmux setup. A remote pi-droid
host cannot manage a bridge on the selected phone through this adapter.

## Explicit opt-in

From the pi-droid checkout, install this local package (only when desired):

```sh
npm install /absolute/path/to/fantastic-pi-mobile/plugins/pi-droid-fantastic-pi-mobile
```

Then manually add a plugin entry to pi-droid's `config/default.json`:

```json
{
  "plugins": {
    "fantastic-pi-mobile": {
      "enabled": true,
      "package": "@pi-droid/plugin-fantastic-pi-mobile",
      "checkout": "/absolute/path/to/fantastic-pi-mobile",
      "session": "work",
      "window": "fantastic-pi-mobile-bridge"
    }
  }
}
```

Merge this with existing configuration; do not replace other entries. Rebuild or
reload pi-droid using its normal workflow. No live configuration is changed by
this implementation. Session must already exist; names accept letters, digits,
underscore and hyphen. Changing names does not move an existing bridge.

Actions: `fantastic-pi-mobile.status`, `fantastic-pi-mobile.start`,
`fantastic-pi-mobile.pause`, `fantastic-pi-mobile.resume`, `fantastic-pi-mobile.stop`. Status accepts `{}`; mutations require `{ "confirmed": true }`
and declare `requiresApproval: true` for pi-droid's interactive approval gate.
Direct library callers must obtain human consent themselves. There is no `run`,
legacy stop, force, stale-lock cleanup, restore, restart or replay action.

The launcher loads trusted private `.env`; token/config values are not plugin
parameters. Inherited `PI_*`, `FANTASTIC_PI_MOBILE_*`, `PORT` and `NODE_OPTIONS`
are removed before launch.
Status returns a whitelist of owner/storage/gate metadata, never raw health,
stdout/stderr or environment values. Errors, timeout and cancellation of the
calling tool do **not** authorize retry: a controller action may have happened.
The pi-droid plugin interface has no abort signal; the bounded subprocess may
continue until completion/120-second timeout after a caller disconnects. Plugin
unload never kills it or the bridge. Inspect status before any further mutation.

A successful `fantastic-pi-mobile.status` inspection is not necessarily readiness. Check
`data.ready`; `getStatus().ready` is false for unavailable/unverified owners.
Those inspections expose only `ready`, `state` and an allowlisted reason, not
partial owner/storage evidence or arbitrary diagnostic strings. They never
assert that previously dispatched work has stopped.

All safety transactions remain in Fantastic Pi Mobile: authenticated maintenance, model AND
review idleness, read-only Durable checks, identity rechecks, online backup,
SIGTERM and lock-release wait. A refused stop can leave admissions paused;
resume explicitly. Unknown/stale owner refuses, without deleting the lock.

Private backups follow [bridge-work.md](../../docs/bridge-work.md): launcher
umask 077, private directories/files; contain secrets, sessions and source.
Retention is manual; no automatic prune/delete or independent Git archive is
promised. Existing shared tmux wake-lock hooks remain the sole owner. No power,
security, pairing, network or Android background mechanism is introduced.

## Verification

```sh
cd plugins/pi-droid-fantastic-pi-mobile && npm test
# From Fantastic Pi Mobile root, optional isolated host regression (no production state):
python scripts/check-bridge-work.py
```

The plugin contract uses a disposable synthetic launcher, never production
`.env`, tmux or ADB. The real-tmux harness retains the authoritative backup,
restart and exact-ID non-replay assertions. Physical screen-off and full APK
lifecycle acceptance are separate and are not established by these tests.
