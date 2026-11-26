#!/usr/bin/env bash
set -euo pipefail

proof="${1:?Provide evidence path}"
output="${2:?Provide asset path}"
kit="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
stage="$(mktemp -d "${RUNNER_TEMP:-/tmp}/xhs-f-preview.XXXXXXXX")"
mkdir -p -- "$proof" "$output" "$stage/frontend"
. /etc/os-release
test "$VERSION_ID" = 22.04
cp /etc/os-release "$proof/os-release"
cp -a "$kit/linux/src-tauri" "$stage/"
cp "$kit/frontend/"{index.html,app.css,app.mjs} "$stage/frontend/"
mkdir -p "$stage/src-tauri/icons"
convert -size 96x96 xc:'#4F46B8' -font DejaVu-Sans-Bold -pointsize 60 \
  -fill white -gravity center -annotate +0-1 F "PNG32:$stage/src-tauri/icons/icon.png"

export RUSTUP_TOOLCHAIN=1.100.0
cd "$stage/src-tauri"
npx --yes --package @tauri-apps/cli@2.12.6 tauri build --ci --bundles deb -- --locked 2>&1 | tee "$proof/build.log"
bundles=(target/release/bundle/deb/*.deb)
[[ ${#bundles[@]} == 1 && -f ${bundles[0]} ]]
deb="$stage/preview.deb"
cp "${bundles[0]}" "$deb"
test "$(dpkg-deb -f "$deb" Architecture)" = amd64
test "$(dpkg-deb -f "$deb" Version)" = 1.0.9
sudo apt-get install -y "$deb"
binary=/usr/bin/xiaohongshu-monitor-f-preview
test -x "$binary"
ldd "$binary" > "$proof/ldd.txt"
if grep -q 'not found' "$proof/ldd.txt"; then exit 1; fi

export PROOF="$proof" GDK_BACKEND=x11 WEBKIT_DISABLE_COMPOSITING_MODE=1 NO_AT_BRIDGE=1
xvfb-run -a --server-args="-screen 0 1280x960x24 -nolisten tcp" bash -eu <<'SMOKE'
openbox --sm-disable > "$PROOF/openbox.log" 2>&1 &
wm_pid=$!
dbus-run-session -- /usr/bin/xiaohongshu-monitor-f-preview > "$PROOF/run.log" 2>&1 &
app_pid=$!
trap 'kill "$app_pid" "$wm_pid" 2>/dev/null || true' EXIT
for attempt in {1..100}; do
  grep -qx 'F_PREVIEW_WEBVIEW main Finished' "$PROOF/run.log" && break
  kill -0 "$app_pid" 2>/dev/null || break
  sleep 0.2
done
grep -qx 'F_PREVIEW_WEBVIEW main Finished' "$PROOF/run.log"
window=$(timeout 20 xdotool search --sync --name '^XHS Monitor F Preview$' | tail -1)
xdotool windowmap --sync "$window"
xdotool windowactivate --sync "$window"
import -window "$window" "$PROOF/preview.png"
identify -format '%f %wx%h\n' "$PROOF/preview.png"
SMOKE
dpkg-deb -f "$deb" Package Version Architecture Depends > "$proof/package.txt"
install -m 0644 "$deb" "$output/xiaohongshu-monitor-v1.0.9-preview.1-linux-amd64.deb"
