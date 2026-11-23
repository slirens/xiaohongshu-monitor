# Xiaohongshu Monitor

[简体中文](README.md) · English

A desktop app for Windows and macOS that collects Xiaohongshu notes by keyword and publication date and exports Excel reports using Markdown templates. It supports OpenAI, Claude, Gemini, DeepSeek, Kimi, GLM, and Qwen.

## Download

- [macOS 14 or later · Apple silicon and Intel · Safari](https://github.com/slirens/xiaohongshu-monitor/releases). Packages are published after Safari verification passes.
- [Windows x64 portable edition](https://github.com/slirens/xiaohongshu-monitor/releases/tag/v1.0.0)

## Permitted use and platform restrictions

**For lawful, noncommercial use only.** The source code is available for noncommercial purposes such as learning, research, and testing. Use for unlawful activities or commercial gain is prohibited. Before using the app, ensure you are authorized to access and process the content and comply with applicable laws and Xiaohongshu's rules.

**Automated browsing may trigger Xiaohongshu's account safeguards.** The platform may flag this activity as unusual, issue an account warning, request verification, or restrict access. According to the platform's account notice, repeated violations may affect account privileges and traffic. If you receive a warning or encounter a restriction, stop the task and follow the platform's instructions.

## Build and run

### macOS

Download the ZIP for your Mac's processor, extract it, and open the app. In Safari Settings → Advanced, enable features for web developers. In Develop → Developer Settings, enable **Allow JavaScript from Apple Events**. Allow the app to control Safari when macOS asks, then follow the app's prompt to sign in.

To build from source, install the Xcode Command Line Tools and the official Node.js 24 LTS distribution with npm. Run `bash macos/build.sh` from the repository root. The app is built in `macos-output`, and reports are stored in `~/Library/Application Support/Xiaohongshu Monitor/reports`.

### Windows

1. Install Node.js 24 LTS with npm and have Microsoft Edge or Google Chrome available on Windows x64.
2. Open PowerShell in the repository directory and run `pwsh -File .\build.ps1`.
3. Launch `小红书舆情监控v1.exe` and keep the adjacent `runtime` folder in place.

Sign in when the app opens its browser window. Separate keywords with spaces. For AI analysis, select a provider in More Settings and enter its API key. Enabling AI analysis sends note excerpts and the data needed for the report summary to the selected provider.

## Templates and reports

Start with `报告生成模板.md`. Keep the section headings `总结` (Summary), `总表` (Overview), and `日期` (By date). Reports and browser sessions are stored locally.

## License

The project is available under the PolyForm Noncommercial License 1.0.0. See [LICENSE](LICENSE).
