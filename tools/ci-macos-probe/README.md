# macOS WKWebView 与 Safari 独立验证素材

这套验证使用 F 原型的 `index.html`、`app.css`、`app.mjs`。`frontend/` 保存三份输入。`prepare.mjs` 在新建目录中复制原型，并为入口加一层仅测试使用的脚本 `probe.mjs`。该脚本读取浏览器真实布局，依次验证设置、续查、执行、登录提示、采集和结果阶段，然后由本机 Tauri 命令写入 `WEBVIEW_READY` 证明。原型用固定样例，Safari 测试另外使用仓库现有的本机回环夹具。

## GitHub Actions 中使用

仅在隔离分支 `verify/f-webview` 将本目录的 `frontend/`、`src-tauri/`、`prepare.mjs`、`probe.mjs` 和 `run-macos.sh` 放入 `tools/ci-macos-probe/`。将 `macos-tauri-safari-verify.yml` 放入 `.github/workflows/`。祖先源码保留 `macos/verify-safari.mjs` 及 `npm ci` 所需的锁定文件。工作流使用只读仓库权限，可随分支推送触发，也包含手动触发配置。Actions 上传工具、构建、镜像核验和进程日志，安装包留在临时运行环境。

- `macos-15` 验证 arm64，`macos-15-intel` 验证 x86_64。均使用 Node 24.14.0，官方 Rust stable 和 Tauri CLI 2.12.6。Rust 核心及构建插件版本固定，每次解析得到的完整锁文件纳入证据。
- DMG 通过 Tauri CLI 生成，确认摘要、只读挂载、应用标识、Mach-O 架构和临时签名，随后从临时目录启动复制出的应用。只有实际 WebView 回传共享原型的状态证据，测试才通过。签名使用 ad-hoc 身份，公证和系统安全确认留待发行验证。
- Safari WebDriver 每个平台单独执行 `node macos/verify-safari.mjs --webdriver`，保留原始退出码、日志和 Actions 步骤 outcome。步骤失败或跳过时记为未验证。生产程序用的 Apple Events 首次授权未由这些步骤覆盖。
- 本地可以先跑 `node verify-prepare.mjs` 核对输入哈希、暂存内容与隔离 Chromium 中的测试动作。这一步的 IPC 是测试替身。

## 在对应架构的 Mac 上运行

```bash
rustup toolchain install stable --profile minimal --no-self-update
bash run-macos.sh ./frontend ./macos-evidence "$(uname -m)"
```

构建脚本将临时文件与安装程序分隔。在原生 macOS 上实际运行前，DMG、WKWebView 与 Safari WebDriver 的结论均保留为待实测。[Tauri DMG 指南](https://v2.tauri.app/distribute/dmg/) · [临时签名](https://v2.tauri.app/distribute/sign/macos/#ad-hoc-signing) · [GitHub macOS 运行器](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
