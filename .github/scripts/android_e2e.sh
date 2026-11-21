#!/usr/bin/env bash
# On an Android emulator: launch the release APK once (when this run built one), then run the device test
# (tests/android/run.mjs) on the test build. Usage: android_e2e.sh <release apk> <test apk> <output dir>
set -u
APK="$1"; TEST_APK="$2"; OUT="$3"; PKG=com.bradcowdrey.cowdreypdf
mkdir -p "$OUT"
adb shell settings put global hide_error_dialogs 1 2>/dev/null
adb shell cmd uimode night yes
if [[ -f "$APK" ]]; then
  adb install -r "$APK" > /dev/null && echo "release APK installed"
  adb shell dumpsys package "$PKG" | grep -m1 versionName | sed 's/^ */release version: /'
  adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 > /dev/null 2>&1 && echo "release APK launched"
  sleep 20
  adb exec-out screencap -p > "$OUT/00-release-launch-dark.png"
  if adb shell pidof "$PKG" > /dev/null; then echo "release APK still running: yes"; else echo "release APK still running: NO"; fi
  adb uninstall "$PKG" > /dev/null && echo "release APK uninstalled (the test build uses the same package)"
else
  echo "no release APK in this run (quick run): device test only"
fi
node tests/android/run.mjs "$TEST_APK" "$OUT"
echo "device test exit code $?"
adb logcat -d > "$OUT/logcat-full.log" 2>/dev/null
grep -iE "chromium|console|tauri|cowdrey|AndroidRuntime|FATAL|RustStdoutStderr" "$OUT/logcat-full.log" | tail -400 > "$OUT/logcat.txt"
exit 0
