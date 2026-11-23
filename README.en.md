# Xiaohongshu Monitor

[简体中文](README.md) · English

A desktop app for Windows and macOS that collects Xiaohongshu notes by keyword and publication date and exports Excel reports using Markdown templates. It supports OpenAI, Claude, Gemini, DeepSeek, Kimi, GLM, and Qwen.

## Download

| Platform | Downloads | Release notes |
| --- | --- | --- |
| Windows | [ZIP x64](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.0/xiaohongshu-monitor-v1.0.0-windows-x64-portable.zip) · [ZIP x86](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.0/xiaohongshu-monitor-v1.0.0-windows-x86-portable.zip) | [v1.0.0](https://github.com/slirens/xiaohongshu-monitor/releases/tag/v1.0.0) |
| macOS | [ZIP Apple Silicon](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.1.0/xiaohongshu-monitor-v1.1.0-macos-arm64.zip) · [ZIP Intel x64](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.1.0/xiaohongshu-monitor-v1.1.0-macos-x86_64.zip) | [v1.1.0](https://github.com/slirens/xiaohongshu-monitor/releases/tag/v1.1.0) |

The Windows x86 edition requires a compatible installation of Microsoft Edge or Google Chrome. The macOS edition requires macOS 14 or later and uses Safari.

## Permitted use and platform restrictions

**For lawful, noncommercial use only.** The source code is available for noncommercial purposes such as learning, research, and testing. Use for unlawful activities or commercial gain is prohibited. Before using the app, ensure you are authorized to access and process the content and comply with applicable laws and Xiaohongshu's rules.

**Automated browsing may trigger Xiaohongshu's account safeguards.** The platform may flag this activity as unusual, issue an account warning, request verification, or restrict access. According to the platform's account notice, repeated violations may affect account privileges and traffic. If you receive a warning or encounter a restriction, stop the task and follow the platform's instructions.

## Build and run

### macOS

Download the ZIP for your Mac's processor, extract it, and open the app. In Safari Settings → Advanced, enable features for web developers. In Develop → Developer Settings, enable **Allow JavaScript from Apple Events**. Allow the app to control Safari when macOS asks, then follow the app's prompt to sign in.

To build from source, install the Xcode Command Line Tools and the official Node.js 24 LTS distribution with npm. Run `bash macos/build.sh` from the repository root. The app is built in `macos-output`, and reports are stored in `~/Library/Application Support/Xiaohongshu Monitor/reports`.

### Windows

Download the ZIP for your architecture, extract it in full, and launch `小红书舆情监控v1.exe`. Keep the adjacent `runtime` folder in place.

To build from source, have Microsoft Edge or Google Chrome available and use Node.js with npm for the target architecture. Run the command for your architecture from the repository directory.

- Use Node.js 24 LTS for x64 and run `pwsh -File .\build.ps1`.
- Use 32-bit Node.js 22 LTS for x86 and run `pwsh -File .\build.ps1 -Architecture x86 -OutputDirectory .\dist\windows-x86 -Node "C:\tools\node-x86\node.exe"`. Replace the example Node.js path with your own.

Sign in when the app opens its browser window. Separate keywords with spaces. For AI analysis, select a provider in More Settings and enter its API key. Enabling AI analysis sends note excerpts and the data needed for the report summary to the selected provider.

## Templates and reports

Start with `报告生成模板.md`. Keep the section headings `总结` (Summary), `总表` (Overview), and `日期` (By date). Reports and browser sessions are stored locally.

## License

The project is available under the PolyForm Noncommercial License 1.0.0. See [LICENSE](LICENSE).
