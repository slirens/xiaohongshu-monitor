## 更新 · What's new

### 中文

- **继续监控读取提速**。Windows、macOS 和 Linux 在选择「继续监控」后，优先从 Excel 直接读取续查数据，缩短恢复关键词和日期的等待。旧格式报告仍可导入。
- **恢复 Excel 文件名规则**。四个平台按「首个关键词_发起日期_关键词数_发起时间」命名，例如 `宝山_2026-11-24_2词_173050.xlsx`。日期和时分秒取自任务发起时的北京时间。桌面版遇到同一秒重名时追加 `_02`、`_03` 等序号。

### English

- **Faster report loading when continuing monitoring.** On Windows, macOS, and Linux, Continue monitoring reads the saved continuation data directly where supported, so keywords and dates load faster. Older report formats can still be imported.
- **Restored Excel file naming.** All four platforms include the first keyword, run date, keyword count, and run start time, as in `宝山_2026-11-24_2词_173050.xlsx`. The date and time use Beijing time at the start of the run. Desktop apps append `_02`, `_03`, and so on for duplicate names.

## 下载 · Download

| 类别 · Category | 下载项 · Download |
| --- | --- |
| Windows | [Setup x64](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.1.2/xiaohongshu-monitor-v1.1.2-windows-x64-setup.exe) · [Setup x86](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.1.2/xiaohongshu-monitor-v1.1.2-windows-x86-setup.exe) |
| macOS | [DMG Apple Silicon](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.1.2/xiaohongshu-monitor-v1.1.2-macos-arm64.dmg) · [DMG Intel x64](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.1.2/xiaohongshu-monitor-v1.1.2-macos-x86_64.dmg) |
| Linux | [DEB x64](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.1.2/xiaohongshu-monitor-v1.1.2-linux-amd64.deb) |
| 鸿蒙电脑 · HarmonyOS PC | [华为浏览器扩展 ZIP · HUAWEI Browser extension](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.1.2/xiaohongshu-monitor-v1.1.2-harmonyos-browser.zip) |
| 舆情分析模板 · Analysis template | [Markdown](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.1.2/analysis-template.md) |

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
