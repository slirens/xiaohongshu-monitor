## macOS 版

小红书舆情监控现可在 macOS 14 或更新系统上使用 Safari。支持按关键词和发布日期监测笔记、将多个关键词写入同一份 Excel 的独立工作表，以及使用 Markdown 模板和主流 AI API 生成报告。

| 系统 / Platform | 下载 / Downloads | 发布说明 / Release notes |
| --- | --- | --- |
| macOS | [ZIP Apple Silicon](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.1.0/xiaohongshu-monitor-v1.1.0-macos-arm64.zip) · [ZIP Intel x64](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.1.0/xiaohongshu-monitor-v1.1.0-macos-x86_64.zip) | [v1.1.0](https://github.com/slirens/xiaohongshu-monitor/releases/tag/v1.1.0) |
| Windows | [Portable x64](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.0/xiaohongshu-monitor-v1.0.0-windows-x64-portable.zip) · [Portable x86](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.0/xiaohongshu-monitor-v1.0.0-windows-x86-portable.zip) | [v1.0.0](https://github.com/slirens/xiaohongshu-monitor/releases/tag/v1.0.0) |

1. 解压并打开 `Xiaohongshu Monitor.app`。应用内置运行组件。
2. 在 Safari「设置 → 高级」显示网页开发者功能，再在「开发 → 开发者设置」打开「允许来自 Apple 事件的 JavaScript」。启动监控时，在 macOS 权限提示里允许应用控制 Safari。
3. 如需登录或验证，请在应用打开的 Safari 窗口手动完成，再回应用继续。

此版本采用临时签名，尚未获得 Apple 公证。可用 `SHA256SUMS.txt` 校验下载包。

Apple 芯片和 Intel 版均已通过打包和多关键词 Excel 导出测试。Safari WebDriver 在两种架构上通过了模拟登录提示、日期筛选和帖子原文跳转测试。托管环境的 Apple Events 授权检查返回 `-1744`，需要用户在 Mac 上批准应用控制 Safari。首次授权、小红书扫码登录和真实采集仍需在可交互的 Mac 上验证。 [GitHub Actions 测试记录](https://github.com/slirens/xiaohongshu-monitor/actions/runs/45169733992)

仅限合法、非商业使用。自动化浏览可能触发小红书的账号安全措施。

## macOS edition

Xiaohongshu Monitor now runs on macOS 14 or later with Safari. It supports keyword and publication-date filters, separate sheets for multiple keywords in one Excel workbook, and reports using Markdown templates and supported AI APIs.

Choose **ZIP Apple Silicon** for an M-series Mac or **ZIP Intel x64** for an Intel Mac. The download table also lists the Windows packages.

1. Extract the ZIP and open `Xiaohongshu Monitor.app`. Runtime components are bundled.
2. In Safari Settings → Advanced, enable features for web developers. In Develop → Developer Settings, enable **Allow JavaScript from Apple Events**. When prompted by macOS, allow the app to control Safari.
3. If Safari requests sign-in or verification, complete it manually, then return to the app and continue.

The app uses ad hoc signing, with Apple notarization outstanding. Verify the ZIP against `SHA256SUMS.txt`.

The Apple silicon and Intel builds passed packaging and multi-keyword Excel export checks. Safari WebDriver verified the simulated sign-in prompt, date filtering, and redirects to the original note on both architectures. The hosted Apple Events permission check returned `-1744`, which requires a user to approve Safari control. First-time authorization, QR-code sign-in, and live Xiaohongshu collection still require verification on an interactive Mac. [GitHub Actions test results](https://github.com/slirens/xiaohongshu-monitor/actions/runs/45169733992)

For lawful, noncommercial use only. Automated browsing can trigger Xiaohongshu's account safeguards.
