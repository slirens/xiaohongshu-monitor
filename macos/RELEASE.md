## macOS 版

小红书舆情监控现可在 macOS 14 或更新系统上使用 Safari。支持按关键词和发布日期监测笔记、将多个关键词写入同一份 Excel 的独立工作表，以及使用 Markdown 模板和主流 AI API 生成报告。

| 设备 | 下载文件 |
| --- | --- |
| Apple 芯片（M 系列） | `xiaohongshu-monitor-v1.1.0-macos-arm64.zip` |
| Intel 芯片 | `xiaohongshu-monitor-v1.1.0-macos-x86_64.zip` |
| Windows x64 | [v1.0.0 Windows 便携版](https://github.com/slirens/xiaohongshu-monitor/releases/tag/v1.0.0) |

1. 解压并打开 `Xiaohongshu Monitor.app`。应用内置运行组件。
2. 在 Safari「设置 → 高级」显示网页开发者功能，再在「开发 → 开发者设置」打开「允许来自 Apple 事件的 JavaScript」。启动监控时，在 macOS 权限提示里允许应用控制 Safari。
3. 如需登录或验证，请在应用打开的 Safari 窗口手动完成，再回应用继续。

此版本使用临时签名，尚未获得 Apple 公证。下载包可用 `SHA256SUMS.txt` 校验。GitHub Actions 使用本地网页验证 Safari 筛选、帖子跳转和前后台操作，使用模拟笔记验证 Excel 导出。真实小红书扫码和线上采集需在使用者的 Safari 环境完成。

仅限合法、非商业使用。自动化浏览可能触发小红书的账号安全措施。

## macOS edition

Xiaohongshu Monitor now runs on macOS 14 or later with Safari. It supports keyword and publication-date filters, separate sheets for multiple keywords in one Excel workbook, and reports using Markdown templates and supported AI APIs.

Download the `macos-arm64.zip` asset for Apple silicon or `macos-x86_64.zip` for Intel. The [Windows portable edition](https://github.com/slirens/xiaohongshu-monitor/releases/tag/v1.0.0) remains available.

1. Extract the ZIP and open `Xiaohongshu Monitor.app`. Runtime components are bundled.
2. In Safari Settings → Advanced, enable features for web developers. In Develop → Developer Settings, enable **Allow JavaScript from Apple Events**. When prompted by macOS, allow the app to control Safari.
3. If Safari requests sign-in or verification, complete it manually, then return to the app and continue.

The app is ad hoc signed and has not been notarized by Apple. Verify the ZIP against `SHA256SUMS.txt`. GitHub Actions tests Safari filtering, note redirects, and window controls against a local fixture and checks Excel export with sample notes. Real Xiaohongshu sign-in and collection depend on the user's Safari session.

For lawful, noncommercial use only. Automated browsing can trigger Xiaohongshu's account safeguards.
