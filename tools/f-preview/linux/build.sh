#!/usr/bin/env bash
set -euo pipefail

export LC_ALL=C.UTF-8
expected=$(tr -d '\r\n' < /toolchain/tauri-cli-sha256.txt)
printf '%s  %s\n' "$expected" /toolchain/tauri-cli.tgz | sha256sum -c -
cli_path=$(tar -tzf /toolchain/tauri-cli.tgz | grep -xE '(\./)?cargo-tauri')
tar -xOzf /toolchain/tauri-cli.tgz "$cli_path" > "$CARGO_HOME/bin/cargo-tauri"
chmod +x "$CARGO_HOME/bin/cargo-tauri"
rustc --version
cargo tauri --version

mkdir -p /app/frontend /publish/evidence
cp -a /source/src-tauri /app/
cp /frontend/index.html /frontend/app.css /frontend/app.mjs /app/frontend/
sha256sum /app/frontend/{index.html,app.css,app.mjs} > /publish/evidence/frontend.sha256
mkdir -p /app/src-tauri/icons
convert -size 96x96 xc:'#4F46B8' -font DejaVu-Sans-Bold -pointsize 60 \
  -fill white -gravity center -annotate +0-1 F PNG32:/app/src-tauri/icons/icon.png

cd /app/src-tauri
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-3}"
cargo tauri build --ci --bundles deb -- --locked
debs=(target/release/bundle/deb/*.deb)
[[ ${#debs[@]} == 1 && -f ${debs[0]} ]]
output=/publish/xiaohongshu-monitor-v1.0.9-preview.1-linux-amd64.deb
install -m 0644 "${debs[0]}" "$output"
dpkg-deb -f "$output" Package Version Architecture Depends Description | tee /publish/evidence/control.txt
dpkg-deb --contents "$output" > /publish/evidence/contents.txt
sha256sum "$output" | tee /publish/evidence/package.sha256
