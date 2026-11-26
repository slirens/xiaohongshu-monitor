#!/usr/bin/env bash
set -euo pipefail

frontend="${1:?Usage: bash run-macos.sh FRONTEND EVIDENCE EXPECTED_ARCH ASSETS}"
evidence="${2:?Provide the evidence directory}"
expected_arch="${3:?Provide arm64 or x86_64}"
assets="${4:?Provide the assets directory}"
[[ $(uname -s) == Darwin && $(uname -m) == "$expected_arch" ]]
[[ $(node -p 'process.versions.node.split(".")[0]') == 24 ]]
kit="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
stage="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/xhs-macos-probe.XXXXXXXX")"
mkdir -p -- "$evidence"
mkdir -p -- "$assets"
evidence="$(cd -- "$evidence" && pwd)"
assets="$(cd -- "$assets" && pwd)"
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
  app="$stage/XHS Monitor F Preview.app"
  ditto "$mount/XHS Monitor F Preview.app" "$app"
  plist="$app/Contents/Info.plist"
  test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")" = com.xhsmonitor.preview
  test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist")" = 1.0.9
  executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")"
  binary="$app/Contents/MacOS/$executable"
  test "$(lipo -archs "$binary")" = "$expected_arch"
  codesign --verify --deep --strict "$app"
  printf 'DMG copied, signature and native architecture verified: %s\n' "$expected_arch"
} > "$evidence/dmg.log" 2>&1

run_preview() {
  local expected="$1" log="$2"
  shift 2
  "$binary" "$@" > "$log" 2>&1 &
  pid=$!
  for ((attempt = 0; attempt < 120; attempt++)); do
    if grep -Fq "$expected" "$log"; then
      cat "$log"
      kill "$pid"
      wait "$pid" 2>/dev/null || true
      pid=
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null || grep -Fq 'WEBVIEW_FAILED ' "$log"; then break; fi
    sleep 0.25
  done
  cat "$log" >&2
  printf 'The installed F preview did not reach %s on %s\n' "$expected" "$expected_arch" >&2
  return 1
}

run_preview 'PREVIEW_READY main' "$evidence/normal.log"
run_preview 'WEBVIEW_READY main ' "$evidence/webview.log" --verify-preview
grep -Fq '"fixture":"shared-f"' "$evidence/webview.log"
cp "$dmg" "$assets/xiaohongshu-monitor-v1.0.9-preview.1-macos-$expected_arch.dmg"
