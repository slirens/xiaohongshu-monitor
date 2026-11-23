#!/bin/bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
output="${1:?Usage: bash macos/build-dmg.sh OUTPUT_DIRECTORY VERSION}"
version="${2:?Provide a release version such as 1.4.0}"
arch="$(uname -m)"
[[ "$(uname -s)" == Darwin && ( "$arch" == arm64 || "$arch" == x86_64 ) ]]
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
mkdir -p "$output"
output="$(cd "$output" && pwd)"

stage="$(mktemp -d "${TMPDIR:-/tmp}/xhs-dmg-build.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
payload="$stage/payload"
bash "$root/macos/build.sh" "$payload" "$version"
ln -s /Applications "$payload/Applications"

image="$output/xiaohongshu-monitor-v$version-macos-$arch.dmg"
hdiutil create -srcfolder "$payload" -volname "Xiaohongshu Monitor" -fs HFS+ -format UDZO "$image"
