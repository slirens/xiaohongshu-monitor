## 更新 · What's new

- 自动筛选依次应用排序和发布时间。Windows 和 Linux 在常规点击超时后重开浮层并重试。筛选失败时跳过该关键词，并继续处理其余关键词。
- Windows 执行窗口左上角和托盘图标共用运行中的动画帧。新增 360 安全浏览器、360 极速浏览器和极速浏览器 X 的默认浏览器识别与启动支持。
- Excel 组件改在导出时加载。筛选异常可在 Windows 诊断日志中查看点击阶段、拦截原因及超时后浮层和按钮的状态。
- Automatic filtering applies sorting and publication time in order. Windows and Linux reopen the filter menu and retry when a normal click times out. A failed filter skips that keyword and lets the rest of the batch continue.
- The Windows task-window and tray icons share the same running animation. Windows can detect and launch 360 Secure Browser, 360 Extreme Browser, and 360 Extreme Browser X as the default browser.
- The Excel component loads at export time. Windows diagnostics record the filter action, timeout cause, and the menu and control state observed afterward.

## 下载 · Download

| 系统 · Platform | 安装包 · Package |
| --- | --- |
| Windows | [Setup x64](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.6/xiaohongshu-monitor-v1.0.6-windows-x64-setup.exe) · [Setup x86](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.6/xiaohongshu-monitor-v1.0.6-windows-x86-setup.exe) |
| macOS | [DMG Apple Silicon](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.6/xiaohongshu-monitor-v1.0.6-macos-arm64.dmg) · [DMG Intel x64](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.6/xiaohongshu-monitor-v1.0.6-macos-x86_64.dmg) |
| Linux | [DEB x64](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.6/xiaohongshu-monitor-v1.0.6-linux-amd64.deb) |
| 鸿蒙电脑 · HarmonyOS PC | [华为浏览器扩展 ZIP · HUAWEI Browser extension](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.6/xiaohongshu-monitor-v1.0.6-harmonyos-browser.zip) |

### 安装说明

- **Windows**：64 位 Windows 选择 Setup x64，32 位 Windows 选择 Setup x86。使用 Microsoft Edge 或 Google Chrome。安装后可从开始菜单打开，并通过系统设置卸载。
- **macOS**：打开对应芯片的 DMG，将应用拖入「应用程序」。需要 macOS 14 或更新版本。首次运行时需允许应用控制 Safari。详细步骤见仓库 README。
- **Linux**：已验证 Ubuntu 22.04 和 24.04 x64。先安装 Google Chrome，再用软件安装器打开 DEB。
- **鸿蒙电脑**：解压 ZIP，在华为浏览器加载包含 `manifest.json` 的文件夹。

Windows 安装程序未做 Authenticode 签名。macOS 应用使用临时签名，未经过 Apple 公证。系统首次打开时可能提示安全确认。

### Installation

- **Windows** — choose Setup x64 on 64-bit Windows or Setup x86 on 32-bit Windows. Use Microsoft Edge or Google Chrome. Launch from the Start menu and uninstall through Windows Settings.
- **macOS** — open the DMG for your processor and drag the app to Applications. Requires macOS 14 or later. On first launch, grant permission to control Safari. See the repository README for the Safari setup steps.
- **Linux** — verified on Ubuntu 22.04 and 24.04 x64. Install Google Chrome, then open the DEB in your software installer.
- **HarmonyOS PC** — extract the ZIP and load the folder containing `manifest.json` in HUAWEI Browser.

The Windows installers are Authenticode-unsigned. The macOS apps are ad-hoc signed and have not been notarized by Apple. Your operating system may show a security prompt on first launch.

仅限合法、非商业使用。自动化浏览可能触发平台限制。 For lawful, noncommercial use only. Automated browsing may trigger platform restrictions.
