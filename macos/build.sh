#!/bin/bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
output="${1:-$root/macos-output}"
version="${2:-1.0.8}"
arch="$(uname -m)"
node="$(command -v node)"
node_license="$(dirname "$node")/../LICENSE"
app="$output/Xiaohongshu Monitor.app"
resources="$app/Contents/Resources"
runtime="$resources/runtime"

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
  "$root/engagement.mjs" "$root/cover.png" "$root/报告生成模板.md" "$root/LICENSE" "$resources/"
cp "$root/package.json" "$root/package-lock.json" "$runtime/"
cp "$node_license" "$runtime/LICENSE.node"
cp "$node" "$runtime/node"
npm ci --prefix "$runtime" --omit=dev --ignore-scripts --no-audit --no-fund

swiftc -parse-as-library -target "$arch-apple-macos14.0" -O "$root/macos/App.swift" \
  -o "$app/Contents/MacOS/XiaohongshuMonitor"
plutil -lint "$app/Contents/Info.plist"
codesign --force --sign - "$runtime/node"
codesign --force --sign - "$app"
codesign --verify --deep --strict "$app"
