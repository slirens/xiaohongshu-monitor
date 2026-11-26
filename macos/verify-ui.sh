#!/bin/bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
output="${1:?Usage: bash macos/verify-ui.sh SCREENSHOT_DIRECTORY}"
stage="$(mktemp -d "${TMPDIR:-/tmp}/xhs-macos-ui.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$output"
output="$(cd "$output" && pwd)"
XHS_VERIFY_UI=1 bash "$root/macos/build.sh" "$stage"
binary="$stage/Xiaohongshu Monitor.app/Contents/MacOS/XiaohongshuMonitor"

for language in zh-CN en; do
  XHS_FIXTURE_LANGUAGE="$language" "$binary" --capture-f1a "$output"
  for card in FA-01 FA-02 FA-03 FA-04 FA-05 FA-06 FA-07 FA-07b FA-07c FA-08; do
    test -s "$output/$card-$language-regular.png"
    test -s "$output/$card-$language-minimum.png"
  done
  test -s "$output/FA-09-$language-minimum.png"
  for card in FA-10 FA-11 FA-12; do
    test -s "$output/$card-$language-compact.png"
  done
done
