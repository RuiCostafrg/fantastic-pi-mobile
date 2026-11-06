# Local CI — `gh-signoff` (Linux only)

Run the CI checks on your own machine and post green `signoff/<stage>` commit
statuses with [basecamp/gh-signoff](https://github.com/basecamp/gh-signoff).

Use it when free Actions minutes run out — or as a fast pre-push gate. The GitHub
Actions workflows stay untouched; this lane covers **Linux only**.

## Setup (Linux)

```bash
gh auth login
gh extension install basecamp/gh-signoff
```

Toolchains:
- `bridge`: Node ≥ 24
- `android`: Java 17 + Android SDK (`sdkmanager 'platform-tools' 'platforms;android-35' 'build-tools;35.0.0'`), `ANDROID_HOME` set

## Usage

```bash
scripts/local-ci.sh                # stages: bridge android
scripts/local-ci.sh bridge         # run selected stages only
scripts/local-ci.sh --no-signoff   # checks only, no statuses posted
```

Push your commits first: `gh signoff` only attests pushed work. Failing stages post
a red `signoff/<stage>` status automatically.

## Optional: make sign-off a merge requirement

```bash
gh signoff install bridge android
gh signoff uninstall
```

## Notes

- The debug APK artifact produced by `assembleDebug` lands in
  `app/build/outputs/apk/debug/app-debug.apk` — same artifact Actions produced.
