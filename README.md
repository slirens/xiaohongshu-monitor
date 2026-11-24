# 小红书舆情监控

简体中文 · [English](README.en.md)

## 使用范围与平台风险

**仅限合法、非商业使用。** 本项目公开源码，供个人学习、研究和测试等非商业用途。严禁用于违法活动或商业营利。使用前，请确认你有权访问及处理相关内容，并遵守适用法律和小红书的平台规则。

**自动化浏览可能触发账号安全措施。** 小红书可能将自动化浏览识别为异常行为，发出账号警告、要求验证或限制访问。根据平台提示，多次违规可能影响账号权益和流量。收到警告或遇到限制时，请停止任务并按平台指引处理。

提供 Windows、macOS、Linux 桌面版和鸿蒙电脑华为浏览器扩展预览版。按关键词和发布日期采集笔记，用 Markdown 模板导出 Excel。支持 OpenAI、Claude、Gemini、DeepSeek、Kimi、GLM 与 Qwen。

## 下载

| 系统 | 下载 | 发布说明 |
| --- | --- | --- |
| Windows | [Setup x64](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.7/xiaohongshu-monitor-v1.0.7-windows-x64-setup.exe) · [Setup x86](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.7/xiaohongshu-monitor-v1.0.7-windows-x86-setup.exe) | [v1.0.7](https://github.com/slirens/xiaohongshu-monitor/releases/tag/v1.0.7) |
| macOS | [DMG Apple Silicon](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.7/xiaohongshu-monitor-v1.0.7-macos-arm64.dmg) · [DMG Intel x64](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.7/xiaohongshu-monitor-v1.0.7-macos-x86_64.dmg) | [v1.0.7](https://github.com/slirens/xiaohongshu-monitor/releases/tag/v1.0.7) |
| Linux | [DEB x64](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.7/xiaohongshu-monitor-v1.0.7-linux-amd64.deb) | [v1.0.7](https://github.com/slirens/xiaohongshu-monitor/releases/tag/v1.0.7) |
| 鸿蒙电脑 | [华为浏览器扩展 ZIP（预览）](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.7/xiaohongshu-monitor-v1.0.7-harmonyos-browser.zip) | [v1.0.7](https://github.com/slirens/xiaohongshu-monitor/releases/tag/v1.0.7) |

Windows 版要求 Windows 10 或更新版本，支持 Microsoft Edge、Google Chrome 和 360 系列浏览器的 Chromium 极速模式。macOS 版要求 macOS 14 或更新版本，并使用 Safari。

界面采用浅雾蓝配色，并按系统显示语言自动选择简体中文或英文。鸿蒙电脑扩展跟随华为浏览器的界面语言。

Windows 安装程序未做 Authenticode 签名。macOS 应用使用临时签名，未经过 Apple 公证。首次打开时，系统可能提示安全确认。

## 构建与运行

### Linux

在 Ubuntu 22.04 或 24.04 桌面版（x64）安装 Google Chrome 后，用软件安装器打开 DEB，或执行 `sudo apt install ./xiaohongshu-monitor-v1.0.7-linux-amd64.deb`。安装后从应用菜单打开「小红书舆情监控」，首次采集在程序打开的浏览器窗口完成登录。报告默认保存在 `~/.local/share/xiaohongshu-monitor/reports`。

如果系统里已安装版本号更高的旧版，APT 会提示确认降级。

从源码构建需要 amd64 Linux、`dpkg-deb` 和官方 Node.js 24 LTS（含 npm）。在仓库目录执行 `bash linux/build-deb.sh`。

### 鸿蒙电脑

解压扩展 ZIP，在华为浏览器的「管理扩展程序」加载含有 `manifest.json` 的文件夹。使用 HarmonyOS 6.0 或更新版本及华为浏览器 5.1.10.300 或更新版本。详细操作和源码构建命令见鸿蒙电脑扩展说明。 [安装与构建](harmonyos/README.md)

### macOS

打开对应芯片的 DMG，将应用拖入「应用程序」。在 Safari「设置 → 高级」显示网页开发者功能，然后在「开发 → 开发者设置」打开「允许来自 Apple 事件的 JavaScript」。在 macOS 的权限提示中允许应用控制 Safari。按应用提示在监控窗口完成登录。

从源码构建需要 macOS、Xcode Command Line Tools 和官方 Node.js 24 LTS（含 npm）。在仓库根目录执行 `bash macos/build.sh`，应用生成在 `macos-output`。报告生成在 `~/Library/Application Support/Xiaohongshu Monitor/reports`。

### Windows

64 位 Windows 下载 Setup x64，32 位 Windows 下载 Setup x86。运行安装程序，再从开始菜单打开「小红书舆情监控」。可通过 Windows「设置 → 应用」卸载。

从源码构建时，安装 Microsoft Edge 或 Google Chrome，准备对应架构的 Node.js（含 npm），然后在仓库目录执行以下命令。

- x64 使用 Node.js 24 LTS，执行 `pwsh -File .\build.ps1`。
- x86 使用 Node.js 22 LTS 的 32 位版本，执行 `pwsh -File .\build.ps1 -Architecture x86 -OutputDirectory .\dist\windows-x86 -Node "C:\tools\node-x86\node.exe"`。将示例中的 Node.js 路径换成实际路径。

首次运行在程序打开的浏览器窗口完成登录。多个关键词用空格分隔。需要 AI 分析时，在「更多设置」选择服务商并输入相应 API 密钥。开启 AI 分析会向所选平台发送笔记片段及报告总结所需的数据。

## 日期范围和划屏

v1.0.7 支持按开始日期停止划屏。选择「最新」和「下拉到底」时，发现一条发布日期早于开始日期的笔记后，程序完成当前屏的扫描并结束该关键词的划屏。开始日期当天仍纳入。开始日期超出「半年内」的覆盖范围时，这个组合使用网页发布时间的「不限」档位。

## 模板与输出

v1.0.7 支持结构化模板。从 [报告生成模板.md](报告生成模板.md) 复制一份，在「分析规则」写下 AI 需要遵循的证据和判断口径，再修改 `report-schema` 代码块中的 JSON。

- `analysisFields` 定义单篇笔记的输出字段、列名和判断要求。字段支持文本、布尔值及枚举。
- `summarySections` 定义总结的标题、顺序和写作要求。
- `sheets` 定义工作表的顺序、名称和列。工作表类型为 `summary`、`overview`、`date` 或 `keyword`。内置列键为 `keyword`、`date`、`title`、`body`、`url`、`analysis_status`、`date_label`。其余列使用 `analysisFields` 定义的字段键。

工作表和列由程序生成。AI 返回不符合字段规则时，相关分析标记为未完成，已采集笔记仍可导出。关闭 AI 后也可使用模板布局。保留「总结」「总表」「日期」三个标题的旧模板可继续使用默认布局。

桌面版将报告写入本机 `reports`。浏览器扩展直接下载 Excel 文件。

## 发布前检查

公开仓库只收录源码和示例模板。发布包单独构建，并附所分发依赖的许可证。

## 许可证

本项目采用 PolyForm Noncommercial License 1.0.0，见 [LICENSE](LICENSE)。
