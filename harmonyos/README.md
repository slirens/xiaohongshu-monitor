# 鸿蒙电脑华为浏览器扩展

扩展在鸿蒙电脑的华为浏览器里打开独立采集标签页。支持多个关键词依次执行、按网页发布时间和目标日期筛选、保留跳转后的笔记原文地址，以及导出包含总结、总表、日期和关键词的 Excel 报告。

## 安装与运行

1. 确认电脑已安装 HarmonyOS 6.0 或更新版本，华为浏览器为 5.1.10.300 或更新版本。 [华为浏览器扩展版本要求](https://consumer.huawei.com/cn/support/content/zh-cn16055938/)
2. 解压扩展 ZIP。在华为浏览器菜单进入「管理扩展程序」，开启开发者模式，点击「加载已解压的扩展程序」，选择包含 `manifest.json` 的目录。 [华为浏览器安装说明](https://consumer.huawei.com/cn/support/content/zh-cn16082289/)
3. 点击小红书舆情监控扩展，打开监控工作台。按提示在独立采集标签页完成小红书登录，再返回工作台继续。扩展使用浏览器当前配置的登录状态。
4. 使用空格分隔关键词，设置起止日期，点击「开始监控」。可以打开采集标签页检查状态。工作台需保持打开。完成后下载 Excel。

「最新」排序与「下拉到底」同时启用时，看到早于开始日期的笔记后，扩展会扫完当前屏并结束该关键词的划屏。开始日期当天纳入结果。超过「半年内」覆盖范围时，该组合可使用网页发布时间的「不限」档位。

「更多设置」支持上传 Markdown 报告规则。参照包内的 `报告生成模板.md`，填写分析规则并编辑 `report-schema` 中的字段、总结段落、工作表和列。没有 API 密钥也可按模板导出。

启用 AI 后，扩展会申请所选服务商的访问权限，发送笔记标题和正文片段用于单篇分析，再使用最多 20 条样本生成关键词总结。API 密钥随任务结束清除，报告保存在下载的 Excel 中。

仅限合法、非商业使用。自动化浏览可能触发小红书的账号警告、验证或访问限制。遇到限制请停止任务，并按平台指引处理。

## 构建

在仓库根目录使用 Node.js 24 运行 `node harmonyos/build.mjs`。输出位于 `harmonyos/output`，可将输出目录加载到浏览器。可通过命令行参数另选一个新的输出目录。

## HarmonyOS PC extension

This edition runs in HUAWEI Browser on a HarmonyOS PC. It uses a dedicated site tab and exports Excel workbooks with summary, overview, date, and keyword sheets.

Huawei requires HarmonyOS 6.0 or later and HUAWEI Browser 5.1.10.300 or later for browser extensions. Extract the ZIP, enable Developer mode in Manage extensions, and use Load unpacked to select the folder containing `manifest.json`. [Huawei installation instructions](https://consumer.huawei.com/cn/support/content/zh-cn16082289/)

Choose the monitoring workspace from the extension toolbar. Sign in to Xiaohongshu when prompted, return to the workspace, and keep it open while monitoring. Upload a Markdown report template to set analysis instructions and the workbook layout, including with AI disabled. When AI is enabled, the selected service provider receives note excerpts for analysis and up to 20 samples per keyword for the summary. The extension clears the API key at the end of each task.
