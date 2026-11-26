#!/usr/bin/env bash
# On an Android emulator: test the release APK (when this run built one) with tests/android/release.mjs, then run
# the device test (tests/android/run.mjs) on the test build. Usage: android_e2e.sh <release apk> <test apk> <output dir>
set -u
APK="$1"; TEST_APK="$2"; OUT="$3"; PKG=com.bradcowdrey.cowdreypdf
mkdir -p "$OUT"
adb shell settings put global hide_error_dialogs 1 2>/dev/null
# The emulator image's setup app can stop responding while the emulator is busy; its "isn't responding" window
# would cover the app, so it is turned off.
adb shell pm disable-user --user 0 com.google.android.googlesdksetup 2>&1 | tail -1
adb shell cmd uimode night yes
# What the emulator's networks are doing (for runs where none comes up)
netinfo() {
  echo "network: wifi: $(adb shell cmd wifi status 2>&1 | head -3 | tr '\n' ' ' | cut -c1-200)"
  echo "network: radio: $(adb shell dumpsys telephony.registry 2>/dev/null | grep -m2 -oE 'mDataConnectionState=[-0-9]+|mVoiceRegState=[^ ,]+|mDataRegState=[^ ,]+' | tr '\n' ' ')"
  echo "network: emulator: $(adb emu gsm status 2>&1 | tr '\n' ' ' | cut -c1-200)"
  echo "network: addresses: $(adb shell ip -o -4 addr 2>&1 | awk '{print $2, $4}' | tr '\n' ' ')"
}
# Starts the emulator's networks again: the modem registered, data and Wi-Fi on, the emulator's Wi-Fi joined.
netkick() {
  adb emu gsm voice home > /dev/null 2>&1; adb emu gsm data home > /dev/null 2>&1; adb emu network speed full > /dev/null 2>&1
  adb shell cmd connectivity airplane-mode enable; sleep 3; adb shell cmd connectivity airplane-mode disable
  adb shell svc data enable; adb shell svc wifi enable; sleep 2
  adb shell cmd wifi connect-network AndroidWifi open > /dev/null 2>&1
  echo "network: started again (modem, airplane mode, data, Wi-Fi)"
}
# The network, for the timestamp scenario: on, no private DNS (DNS over TLS can fail on the emulator), and logged.
adb shell settings put global private_dns_mode off
adb shell svc wifi enable; adb shell svc data enable
# The emulator's mobile network can take a while to come up, or not come up at all (run 21: no network after a minute):
# after half a minute, airplane mode is turned on and off, which starts the radio again.
# The network is up when Android has an active default network and names resolve. A reply to ping isn't needed (the
# internet's ICMP replies may not come back to the emulator), so the bare "PING freetsa.org (…)" line counts for names,
# but only with a default network: in run 51 that line came with "Active default network: none", and the emulator
# then had no network for 7 minutes. If it never comes up the tests still run: the scenarios that need the network
# wait for it themselves and say "no network".
UP=""
for i in $(seq 1 36); do
  DEF=$(adb shell dumpsys connectivity 2>/dev/null | grep -m1 'Active default network' | tr -d '\r')
  N=$(adb shell ping -c 1 -W 3 freetsa.org 2>&1 | head -2 | tr '\n' ' ')
  if [[ -n "$DEF" && "$DEF" != *none* ]] && echo "$N" | grep -q 'bytes from\|PING '; then
    UP=yes; echo "network: up ($DEF; names resolve: $N)"; break
  fi
  echo "network: not yet ($N; ${DEF:-Active default network: not listed})"
  if [[ $i == 1 || $i == 12 || $i == 24 ]]; then netinfo; fi
  if [[ $i == 6 || $i == 18 || $i == 30 ]]; then netkick; fi
  sleep 5
done
[[ -n "$UP" ]] || echo "network: still not up after $i tries; the tests run anyway (the scenarios that need it wait for it themselves)"
echo "network: by address: $(adb shell ping -c 1 -W 3 8.8.8.8 2>&1 | sed -n 2p)"
echo "network: dns $(adb shell getprop net.dns1) / $(adb shell dumpsys connectivity 2>/dev/null | grep -m2 -oE 'DnsAddresses: \[[^]]*\]' | tr '\n' ' ')"
adb shell dumpsys connectivity 2>/dev/null | grep -m3 -E 'Active default network|NetworkAgentInfo\{' | cut -c1-300
if [[ -f "$APK" ]]; then
  # The release APK, as users get it: opened with a PDF, a field typed into and saved through Android's save dialog
  # (tests/android/release.mjs, with taps only: its web view can't be driven from outside). It uninstalls itself.
  timeout 15m node tests/android/release.mjs "$APK" "$OUT" "$TEST_APK"
  echo "release test exit code $?"
else
  echo "no release APK in this run (quick run): device test only"
fi
# (never more than 100 minutes: each scenario has its own limit too)
timeout 100m node tests/android/run.mjs "$TEST_APK" "$OUT"
echo "device test exit code $?"
adb logcat -d > "$OUT/logcat-full.log" 2>/dev/null
grep -E "ConnectivityService|NetworkMonitor|WifiService|WifiClientModeImpl|SupplicantStaIfaceHal|DataNetwork|DataNetworkController|RILJ|ServiceStateTracker|netd|DnsResolver" "$OUT/logcat-full.log" | grep -viE "verbose|refreshing" | head -300 > "$OUT/network.txt"
grep -iE "chromium|console|tauri|cowdrey|AndroidRuntime|FATAL|RustStdoutStderr" "$OUT/logcat-full.log" | tail -400 > "$OUT/logcat.txt"
exit 0
