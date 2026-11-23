# 小红书舆情监控

简体中文 · [English](README.en.md)

## 使用范围与平台风险

**仅限合法、非商业使用。** 本项目公开源码，供个人学习、研究和测试等非商业用途。严禁用于违法活动或商业营利。使用前，请确认你有权访问及处理相关内容，并遵守适用法律和小红书的平台规则。

**自动化浏览可能触发账号安全措施。** 小红书可能将自动化浏览识别为异常行为，发出账号警告、要求验证或限制访问。根据平台提示，多次违规可能影响账号权益和流量。收到警告或遇到限制时，请停止任务并按平台指引处理。

Windows 和 macOS 桌面程序。按关键词和发布日期采集笔记，用 Markdown 模板导出 Excel。支持 OpenAI、Claude、Gemini、DeepSeek、Kimi、GLM 与 Qwen。

## 下载

| 系统 | 下载 | 发布说明 |
| --- | --- | --- |
| Windows | [Portable x64](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.0/xiaohongshu-monitor-v1.0.0-windows-x64-portable.zip) · [Portable x86](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.0/xiaohongshu-monitor-v1.0.0-windows-x86-portable.zip) | [v1.0.0](https://github.com/slirens/xiaohongshu-monitor/releases/tag/v1.0.0) |
| macOS | [ZIP Apple Silicon](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.1.0/xiaohongshu-monitor-v1.1.0-macos-arm64.zip) · [ZIP Intel x64](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.1.0/xiaohongshu-monitor-v1.1.0-macos-x86_64.zip) | [v1.1.0](https://github.com/slirens/xiaohongshu-monitor/releases/tag/v1.1.0) |

Windows x86 版需要已安装适用于系统的 Microsoft Edge 或 Google Chrome。macOS 版要求 macOS 14 或更新版本，并使用 Safari。

## 构建与运行

### macOS

从 Release 下载对应芯片的 ZIP，解压后打开应用。在 Safari「设置 → 高级」显示网页开发者功能，然后在「开发 → 开发者设置」打开「允许来自 Apple 事件的 JavaScript」。在 macOS 的权限提示中允许应用控制 Safari。按应用提示在监控窗口完成登录。

从源码构建需要 macOS、Xcode Command Line Tools 和官方 Node.js 24 LTS（含 npm）。在仓库根目录执行 `bash macos/build.sh`，应用生成在 `macos-output`。报告生成在 `~/Library/Application Support/Xiaohongshu Monitor/reports`。

### Windows

从上表下载对应架构的 ZIP，完整解压，打开 `小红书舆情监控v1.exe`。保留同级的 `runtime` 文件夹。

从源码构建时，安装 Microsoft Edge 或 Google Chrome，准备对应架构的 Node.js（含 npm），然后在仓库目录执行以下命令。

- x64 使用 Node.js 24 LTS，执行 `pwsh -File .\build.ps1`。
- x86 使用 Node.js 22 LTS 的 32 位版本，执行 `pwsh -File .\build.ps1 -Architecture x86 -OutputDirectory .\dist\windows-x86 -Node "C:\tools\node-x86\node.exe"`。将示例中的 Node.js 路径换成实际路径。

首次运行在程序打开的浏览器窗口完成登录。多个关键词用空格分隔。需要 AI 分析时，在「更多设置」选择服务商并输入相应 API 密钥。开启 AI 分析会向所选平台发送笔记片段及报告总结所需的数据。

## 模板与输出

从 `报告生成模板.md` 开始，保留「总结」「总表」「日期」三个标题，修改总结口径。程序把报告写入本机 `reports`。浏览器会话保存在本机的专用会话目录。

## 发布前检查

公开仓库只收录源码和示例模板。便携发布包单独构建，并附所分发依赖的许可证。

## 许可证

本项目采用 PolyForm Noncommercial License 1.0.0，见 [LICENSE](LICENSE)。
