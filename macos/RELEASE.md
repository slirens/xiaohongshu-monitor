## macOS v1.1.2

- 继续监控支持直接读取 Excel 内的续查数据，更快恢复历史报告中的关键词与日期。兼容旧报告。
- 恢复按首个关键词、发起日期、关键词数量和发起时分秒命名。日期与时间均为北京时间，例如 `宝山_2026-11-23_2词_003000.xlsx`。

| 平台 | 下载 |
| --- | --- |
| Apple 芯片 | [DMG Apple Silicon](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.1.2/xiaohongshu-monitor-v1.1.2-macos-arm64.dmg) |
| Intel | [DMG Intel x64](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.1.2/xiaohongshu-monitor-v1.1.2-macos-x86_64.dmg) |

1. 在 macOS 14 或更新版本打开 DMG，将应用拖入「应用程序」。
2. 在 Safari「设置 → 高级」显示网页开发者功能，然后在「开发 → 开发者设置」打开「允许来自 Apple 事件的 JavaScript」。macOS 询问时，允许应用控制 Safari。
3. Safari 请求登录或验证时，在应用打开的窗口中完成操作，再回到监控界面继续。

应用采用临时签名，首次打开可能需要系统安全确认。可用发布页的 `SHA256SUMS.txt` 校验 DMG。

仅限合法、非商业使用。自动化浏览可能触发平台警告或限制，影响账号权益和流量。

## macOS v1.1.2 · English

- Follow-up monitoring reads the history data embedded in Excel files directly to restore keywords and dates faster. Older reports are supported.
- Filenames once again include the first keyword, the launch date, the keyword count, and the launch time. The date and time use Beijing time, as in `宝山_2026-11-23_2词_003000.xlsx`.

1. On macOS 14 or later, open the [Apple Silicon DMG](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.1.2/xiaohongshu-monitor-v1.1.2-macos-arm64.dmg) or [Intel x64 DMG](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.1.2/xiaohongshu-monitor-v1.1.2-macos-x86_64.dmg) and drag the app to Applications.
2. In Safari Settings → Advanced, enable features for web developers. In Develop → Developer Settings, enable **Allow JavaScript from Apple Events**. When prompted, allow the app to control Safari.
3. If Safari requests sign-in or verification, complete it in the window opened by the app, then return to the monitoring interface to continue.

The app uses ad hoc signing. macOS may ask for security confirmation when you first open it. Verify the DMG using `SHA256SUMS.txt` on the release page.

For lawful, non-commercial use only. Automated browsing may trigger platform warnings or restrictions and affect account privileges and reach.
