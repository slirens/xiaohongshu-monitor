#!/usr/bin/env bash
set -euo pipefail

repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
output=${1:-"$repo/dist/linux"}
version=${2:-1.0.1}
app_id=xiaohongshu-monitor

[[ $(uname -s) == Linux && $(dpkg --print-architecture) == amd64 ]] ||
  { echo 'Build on an amd64 Linux distribution with dpkg.' >&2; exit 1; }
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
  { echo 'Use a version in x.y.z form.' >&2; exit 1; }
node_binary=$(readlink -f "$(command -v node)")
[[ $(node -p process.arch) == x64 ]] ||
  { echo 'An x64 Node.js runtime is required.' >&2; exit 1; }
node_license=$(dirname "$node_binary")/../LICENSE
if [[ ! -f $node_license ]]; then
  echo 'Use the official Node.js binary distribution with its bundled LICENSE.' >&2
  exit 1
fi

stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
payload=$stage/package
app=$payload/opt/$app_id
install -d "$app/runtime" "$payload/DEBIAN"
install -m 0644 "$repo/monitor.mjs" "$repo/report-template.mjs" "$repo/linux/app.py" "$repo/cover.png" \
  "$repo/package.json" "$repo/package-lock.json" "$repo/报告生成模板.md" "$app/"
install -m 0755 "$node_binary" "$app/runtime/node"
"$(dirname "$node_binary")/npm" ci --prefix "$app" --omit=dev --ignore-scripts --no-audit --no-fund

install -Dm0755 "$repo/linux/launcher" "$payload/usr/bin/$app_id"
install -Dm0644 "$repo/linux/$app_id.desktop" "$payload/usr/share/applications/$app_id.desktop"
install -Dm0644 "$repo/cover.png" "$payload/usr/share/pixmaps/$app_id.png"
install -Dm0644 "$repo/LICENSE" "$payload/usr/share/doc/$app_id/copyright"
install -Dm0644 "$node_license" "$payload/usr/share/doc/$app_id/Node-LICENSE.txt"

cat > "$payload/DEBIAN/control" <<EOF
Package: $app_id
Version: $version
Architecture: amd64
Section: utils
Priority: optional
Maintainer: Xiaohongshu Monitor contributors <slirens@users.noreply.github.com>
Homepage: https://github.com/slirens/xiaohongshu-monitor
Depends: python3 (>= 3.10), python3-tk, xdg-utils, libc6 (>= 2.28), libstdc++6, google-chrome-stable | microsoft-edge-stable | chromium
Recommends: fonts-noto-cjk, libnotify-bin
Installed-Size: $(du -sk "$payload" | cut -f1)
Description: Search Xiaohongshu notes and export Excel reports
 Desktop tool for keyword and publication-date monitoring, with optional
 AI analysis and Markdown report templates.
EOF

mkdir -p -- "$output"
dpkg-deb --root-owner-group -Zxz --build "$payload" \
  "$output/${app_id}-v${version}-linux-amd64.deb"
