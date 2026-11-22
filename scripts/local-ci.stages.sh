# Stage definitions for the shared verified-release-kit runner.
LOCAL_CI_NAME="fantastic-pi-mobile"
LOCAL_CI_DESCRIPTION="Mirrors .github/workflows/ci.yml (bridge + android jobs on ubuntu-latest)."
LOCAL_CI_STAGES=(bridge android)
LOCAL_CI_DEFAULT_STAGES=(bridge android)

stage_bridge() {
  node_min 24
  require npm ""
  ( cd bridge && npm ci --ignore-scripts && npm test )
}

stage_android() {
  # Java 17 + Android SDK (platform-tools, android-35, build-tools 35.0.0).
  require java "Java 17 (e.g. temurin via sdkman/apt) — java -version should print \"17\""
  java -version 2>&1 | grep -qE '"17([.]|")' || _fail 'Java 17 required (java -version does not report "17")'
  [ -n "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ] || command -v sdkmanager >/dev/null 2>&1 \
    || _fail "Android SDK not found — install it (ANDROID_HOME or sdkmanager on PATH; sdkmanager 'platform-tools' 'platforms;android-35' 'build-tools;35.0.0')"
  ./gradlew assembleDebug lintDebug testDebugUnitTest
}
