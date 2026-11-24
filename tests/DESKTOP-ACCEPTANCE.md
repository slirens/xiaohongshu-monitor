# 桌面版发布验收 / Desktop release acceptance

以 Computer Use 在安装后的程序界面执行的真实任务作为交互验收基准。自动化测试覆盖可重复的失败分支和报表结构。

1. 记录安装包版本、系统、默认浏览器、窗口大小和显示缩放。使用同一关键词、日期和划屏配置对照已通过的版本。
2. 分别用正常窗口和窄窗口启动任务。若需扫码或验证，由测试人员在浏览器完成。
3. 在实际的网页浮层检查排序和发布时间是否选中。覆盖「最新」和「一天内」，记录点击超时是否触发回退及任务是否继续。
4. 核对 Excel 中的日期、条数和原文链接。记录启动按钮按下到首个浏览器窗口出现的时间，并对照诊断日志。
5. 比较 ZIP 和安装包时，记录两者内嵌脚本的哈希。使用相同浏览器和登录条件复测。

Use Computer Use to check the real workflow in the installed app. Keep automated fixtures for repeatable failure cases and workbook structure.

1. Record the installer version, OS, default browser, window size, and display scaling. Use the same keyword, dates, and scroll settings as the known-good build.
2. Start the task in both regular and narrow windows. The tester completes any sign-in or verification in the browser.
3. Confirm the actual sorting and publication-time selections in the website menu. Exercise Latest and Past day, and note whether an expired click triggers a successful retry.
4. Check workbook dates, counts, and original post links. Time the interval from Start to the first browser window and compare it with diagnostics.
5. Compare ZIP and installer builds using their embedded worker hashes and the same browser and sign-in conditions.
