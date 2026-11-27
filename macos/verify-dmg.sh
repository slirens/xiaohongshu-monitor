#!/bin/bash
set -euo pipefail

image="${1:?Usage: bash macos/verify-dmg.sh IMAGE ARCH VERSION}"
arch="${2:?Provide arm64 or x86_64}"
version="${3:?Provide the expected bundle version}"
[[ "$(uname -s)" == Darwin && "$(uname -m)" == "$arch" ]]

stage="$(mktemp -d "${TMPDIR:-/tmp}/xhs-dmg-verify.XXXXXX")"
mount="$stage/mount"
mounted=false
cleanup() {
  if "$mounted"; then
    hdiutil detach "$mount" || return 1
  fi
  rm -rf "$stage"
}
trap cleanup EXIT
mkdir "$mount"

hdiutil verify "$image"
hdiutil attach -readonly -nobrowse -mountpoint "$mount" "$image"
mounted=true
test "$(readlink "$mount/Applications")" = /Applications

mkdir "$stage/Applications"
app="$stage/Applications/Xiaohongshu Monitor.app"
ditto "$mount/Xiaohongshu Monitor.app" "$app"
binary="$app/Contents/MacOS/XiaohongshuMonitor"
runtime="$app/Contents/Resources/runtime"
codesign --verify --deep --strict "$app"
test "$(plutil -extract CFBundleShortVersionString raw "$app/Contents/Info.plist")" = "$version"
test "$(plutil -extract CFBundleVersion raw "$app/Contents/Info.plist")" = "$version"
test "$(lipo -archs "$binary")" = "$arch"
test "$(lipo -archs "$runtime/node")" = "$arch"
test -f "$app/Contents/Resources/en.lproj/InfoPlist.strings"
test -f "$app/Contents/Resources/zh-Hans.lproj/InfoPlist.strings"
test "$(plutil -extract CFBundleIconFile raw "$app/Contents/Info.plist")" = XhsMonitor.icns
test -s "$app/Contents/Resources/XhsMonitor.icns"
test -s "$app/Contents/Resources/xhs-monitor-logo.png"
test ! -e "$app/Contents/Resources/cover.png"
"$binary" --verify-localization

fixture="$stage/notes.json"
printf '%s\n' '[{"title":"测试笔记","body":"宝山 硚口 桌面报告测试","date":"2026-11-23","url":"https://www.xiaohongshu.com/explore/0123456789abcdef01234567"}]' > "$fixture"
"$binary" --verify "$fixture" "$stage/verify"
test -d "$stage/verify/reports" || { printf '%s\n' 'The app verification worker produced no report directory.' >&2; exit 1; }
"$runtime/node" - "$runtime" "$stage/verify/reports" <<'JS'
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Workbook } = require(path.join(process.argv[2], "node_modules/exceljs"));
const reports = process.argv[3];

async function verifyReports() {
  const files = fs.readdirSync(reports);
  assert.equal(files.length, 1);
  assert.equal(files[0], "宝山_2026-11-23_2词_003000.xlsx");
  const workbook = new Workbook();
  await workbook.xlsx.readFile(path.join(reports, files[0]));
  assert.deepEqual(workbook.worksheets.filter(sheet => sheet.state === "visible").map(sheet => sheet.name),
    ["总结", "总表", "2026-11-23", "宝山", "硚口"]);
  assert.equal(workbook.getWorksheet("_xhs_continuation").state, "veryHidden");
  for (const keyword of ["宝山", "硚口"]) {
    const sheet = workbook.getWorksheet(keyword);
    assert.equal(sheet.getCell("B2").value, "测试笔记");
    assert.equal(sheet.getCell("D2").hyperlink, "https://www.xiaohongshu.com/explore/0123456789abcdef01234567");
  }
}

verifyReports().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
JS
