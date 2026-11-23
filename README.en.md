# Xiaohongshu Monitor

[简体中文](README.md) · English

A Windows desktop app that collects Xiaohongshu notes by keyword and publication date and exports Excel reports using Markdown templates. It supports OpenAI, Claude, Gemini, DeepSeek, Kimi, GLM, and Qwen.

## Permitted use and platform restrictions

**For lawful, noncommercial use only.** The source code is available for noncommercial purposes such as learning, research, and testing. Use for unlawful activities or commercial gain is prohibited. Before using the app, ensure you are authorized to access and process the content and comply with applicable laws and Xiaohongshu's rules.

**Automated browsing may trigger Xiaohongshu's account safeguards.** The platform may flag this activity as unusual, issue an account warning, request verification, or restrict access. According to the platform's account notice, repeated violations may affect account privileges and traffic. If you receive a warning or encounter a restriction, stop the task and follow the platform's instructions.

## Build and run

1. Install Node.js 24 LTS with npm and have Microsoft Edge or Google Chrome available on Windows x64.
2. Open PowerShell in the repository directory and run `pwsh -File .\build.ps1`.
3. Launch `小红书舆情监控v1.exe` and keep the adjacent `runtime` folder in place.

Sign in when the app opens its browser window. Separate keywords with spaces. For AI analysis, select a provider in More Settings and enter its API key. Enabling AI analysis sends note excerpts and the data needed for the report summary to the selected provider.

## Templates and reports

Start with `报告生成模板.md`. Keep the section headings `总结` (Summary), `总表` (Overview), and `日期` (By date). Reports and browser sessions are stored locally.

## License

The project is available under the PolyForm Noncommercial License 1.0.0. See [LICENSE](LICENSE).
