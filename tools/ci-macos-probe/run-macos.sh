#!/usr/bin/env bash
set -euo pipefail

frontend="${1:?Usage: bash run-macos.sh FRONTEND EVIDENCE EXPECTED_ARCH}"
evidence="${2:?Provide the evidence directory}"
expected_arch="${3:?Provide arm64 or x86_64}"
[[ $(uname -s) == Darwin && $(uname -m) == "$expected_arch" ]]
[[ $(node -p 'process.versions.node.split(".")[0]') == 24 ]]
kit="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
stage="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/xhs-macos-probe.XXXXXXXX")"
mkdir -p -- "$evidence"
evidence="$(cd -- "$evidence" && pwd)"
mount="$stage/dmg-mount"
pid=
mounted=false
cleanup() {
  if [[ -n $pid ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  if "$mounted"; then hdiutil detach "$mount" || return 1; fi
  if [[ $stage == */xhs-macos-probe.* && -d $stage ]]; then rm -rf -- "$stage"; fi
}
trap cleanup EXIT

node "$kit/prepare.mjs" "$frontend" "$stage"
cp "$stage/shared-assets.json" "$evidence/shared-assets.json"
export RUSTUP_TOOLCHAIN=stable
export CARGO_TARGET_DIR="$stage/target"
{
  sw_vers
  uname -m
  node --version
  rustc --version
  cargo --version
  npx --yes --package @tauri-apps/cli@2.12.6 tauri --version
} > "$evidence/toolchain.log"

cd "$stage/src-tauri"
cargo generate-lockfile
cp Cargo.lock "$evidence/Cargo.lock"
npx --yes --package @tauri-apps/cli@2.12.6 tauri build --debug --ci --bundles dmg -- --locked 2>&1 | tee "$evidence/build.log"
dmg_files=( "$CARGO_TARGET_DIR"/debug/bundle/dmg/*.dmg )
[[ ${#dmg_files[@]} == 1 && -f ${dmg_files[0]} ]]
dmg="${dmg_files[0]}"
mkdir -- "$mount"

{
  shasum -a 256 "$dmg"
  hdiutil verify "$dmg"
  hdiutil attach -readonly -nobrowse -mountpoint "$mount" "$dmg"
  mounted=true
  test "$(readlink "$mount/Applications")" = /Applications
  app="$stage/XHS Tauri macOS Probe.app"
  ditto "$mount/XHS Tauri macOS Probe.app" "$app"
  plist="$app/Contents/Info.plist"
  test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")" = local.xhs.tauri.macosprobe
  executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")"
  binary="$app/Contents/MacOS/$executable"
  test "$(lipo -archs "$binary")" = "$expected_arch"
  codesign --verify --deep --strict "$app"
  printf 'DMG copied, signature and native architecture verified: %s\n' "$expected_arch"
} > "$evidence/dmg.log" 2>&1

"$binary" > "$evidence/webview.log" 2>&1 &
pid=$!
for ((attempt = 0; attempt < 80; attempt++)); do
  if grep -Fq 'WEBVIEW_READY main ' "$evidence/webview.log"; then
    cat "$evidence/webview.log"
    exit 0
  fi
  if ! kill -0 "$pid" 2>/dev/null || grep -Fq 'WEBVIEW_FAILED ' "$evidence/webview.log"; then break; fi
  sleep 0.25
done
cat "$evidence/webview.log" >&2
printf 'Failed to receive the bundled WKWebView readiness proof for %s\n' "$expected_arch" >&2
exit 1
