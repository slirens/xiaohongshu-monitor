## 鸿蒙电脑 · 华为浏览器扩展预览

扩展在华为浏览器中创建独立采集标签页，沿用当前浏览器的小红书登录状态。支持多个关键词依次运行、网页发布时间筛选、原文链接和 Excel 导出。可以选用 OpenAI、Claude、Gemini、DeepSeek、Kimi、GLM 或 Qwen，并上传 Markdown 模板生成关键词总结。

### 下载与安装

| 系统 | 下载 |
| --- | --- |
| 鸿蒙电脑 | [华为浏览器扩展 ZIP](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.2.0/xiaohongshu-monitor-v1.2.0-harmonyos-browser.zip) |
| Windows | [ZIP x64](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.0/xiaohongshu-monitor-v1.0.0-windows-x64-portable.zip) · [ZIP x86](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.0/xiaohongshu-monitor-v1.0.0-windows-x86-portable.zip) |
| macOS | [ZIP Apple Silicon](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.1.0/xiaohongshu-monitor-v1.1.0-macos-arm64.zip) · [ZIP Intel x64](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.1.0/xiaohongshu-monitor-v1.1.0-macos-x86_64.zip) |

1. 使用 HarmonyOS 6.0 或更新版本及华为浏览器 5.1.10.300 或更新版本。 [版本要求](https://consumer.huawei.com/cn/support/content/zh-cn16055938/)
2. 解压 ZIP。在华为浏览器进入「管理扩展程序」，开启开发者模式，加载含有 `manifest.json` 的目录。 [华为安装说明](https://consumer.huawei.com/cn/support/content/zh-cn16082289/)
3. 从扩展图标打开监控工作台，输入关键词和日期后开始。遇到登录提示时，在采集标签页处理，再回到工作台继续。

### 验证范围

从最终 ZIP 解压后，在 Chromium 的独立配置中加载扩展，使用本地测试网页验证模拟登录提示、两个关键词、发布时间筛选、原文跳转、标签页关闭和 Excel 下载。七家 AI 接口经模拟响应验证。鸿蒙电脑上的安装、实际小红书登录与在线采集仍待实测。可用 `SHA256SUMS.txt` 校验下载。

仅限合法、非商业使用。自动化浏览可能触发平台验证或访问限制。启用 AI 时，部分标题和正文会发送给所选服务商。

## HarmonyOS PC · HUAWEI Browser extension preview

The extension uses a dedicated Xiaohongshu tab in the current browser profile. It processes keywords in sequence, applies publication-date filters, captures original note links, and exports Excel reports. Optional AI summaries support seven providers and Markdown templates.

Use HarmonyOS 6.0 or later and HUAWEI Browser 5.1.10.300 or later. Extract the extension ZIP, enable Developer mode in Manage extensions, and load the folder containing `manifest.json`. Open the monitoring workspace from the extension toolbar. [Huawei installation instructions](https://consumer.huawei.com/cn/support/content/zh-cn16082289/)

The final ZIP was extracted and tested in Chromium with local fixtures for the sign-in prompt, multi-keyword search, date filtering, note redirects, tab cleanup, and Excel downloads. AI integrations were tested with simulated responses. Installation on a HarmonyOS PC and live Xiaohongshu sessions remain to be verified.

For lawful, noncommercial use only. Automated browsing may trigger platform restrictions. With AI enabled, selected note excerpts are sent to the chosen provider.
