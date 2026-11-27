#!/bin/bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
output="${1:-$root/macos-output}"
version="${2:-1.1.2}"
arch="$(uname -m)"
node="$(command -v node)"
node_license="$(dirname "$node")/../LICENSE"
app="$output/Xiaohongshu Monitor.app"
resources="$app/Contents/Resources"
runtime="$resources/runtime"
build_work="$(mktemp -d "${TMPDIR:-/tmp}/xhs-mac-build.XXXXXX")"
trap 'rm -rf "$build_work"' EXIT

[[ "$(uname -s)" == Darwin ]]
[[ "$("$node" -p 'process.versions.node.split(".")[0]')" == 24 ]]
test -f "$node_license"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
test ! -e "$app" || { printf '%s\n' "Choose an empty output directory." >&2; exit 1; }
mkdir -p "$runtime" "$app/Contents/MacOS"
cp "$root/macos/Info.plist" "$app/Contents/Info.plist"
for language in en zh-Hans; do
  mkdir -p "$resources/$language.lproj"
  cp "$root/macos/$language.lproj/InfoPlist.strings" "$resources/$language.lproj/"
  plutil -lint "$resources/$language.lproj/InfoPlist.strings"
done
plutil -replace CFBundleShortVersionString -string "$version" "$app/Contents/Info.plist"
plutil -replace CFBundleVersion -string "$version" "$app/Contents/Info.plist"
cp "$root/monitor.mjs" "$root/safari.mjs" "$root/report-template.mjs" "$root/continuation.mjs" \
  "$root/engagement.mjs" "$root/报告生成模板.md" "$root/LICENSE" "$resources/"
logo="$root/design/v2/logo"
cp "$logo/xhs-monitor-logo-128.png" "$resources/xhs-monitor-logo.png"
swift "$root/macos/make-app-icon.swift" "$logo/xhs-monitor-logo-1024.png" "$build_work/XhsMonitor.iconset"
iconutil -c icns "$build_work/XhsMonitor.iconset" -o "$resources/XhsMonitor.icns"
"$node" "$root/macos/generate-icons.mjs" "$root/design/v2/icons" "$build_work/FAIcons.swift"
cp "$root/package.json" "$root/package-lock.json" "$runtime/"
cp "$node_license" "$runtime/LICENSE.node"
cp "$node" "$runtime/node"
npm ci --prefix "$runtime" --omit=dev --ignore-scripts --no-audit --no-fund

swift_flags=(-parse-as-library -target "$arch-apple-macos14.0" -O)
if [[ "${XHS_VERIFY_UI:-0}" == 1 ]]; then swift_flags+=(-D F1A_UI_VERIFICATION); fi
swiftc "${swift_flags[@]}" "$root/macos/App.swift" "$build_work/FAIcons.swift" \
  -o "$app/Contents/MacOS/XiaohongshuMonitor"
plutil -lint "$app/Contents/Info.plist"
codesign --force --sign - "$runtime/node"
codesign --force --sign - "$app"
codesign --verify --deep --strict "$app"
