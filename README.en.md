# Xiaohongshu Monitor

[简体中文](README.md) · English

A desktop tool for Windows, macOS, and Linux, with a preview extension for HUAWEI Browser on HarmonyOS PCs. It collects Xiaohongshu notes by keyword and publication date and exports Excel reports using Markdown templates. It supports OpenAI, Claude, Gemini, DeepSeek, Kimi, GLM, and Qwen.

## Download

| Platform | Downloads | Release notes |
| --- | --- | --- |
| Windows | [Setup x64](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.4.0/xiaohongshu-monitor-v1.4.0-windows-x64-setup.exe) · [Setup x86](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.4.0/xiaohongshu-monitor-v1.4.0-windows-x86-setup.exe) | [v1.4.0](https://github.com/slirens/xiaohongshu-monitor/releases/tag/v1.4.0) |
| macOS | [DMG Apple Silicon](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.4.0/xiaohongshu-monitor-v1.4.0-macos-arm64.dmg) · [DMG Intel x64](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.4.0/xiaohongshu-monitor-v1.4.0-macos-x86_64.dmg) | [v1.4.0](https://github.com/slirens/xiaohongshu-monitor/releases/tag/v1.4.0) |
| Linux | [DEB x64](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.3.0/xiaohongshu-monitor-v1.3.0-linux-amd64.deb) | [v1.3.0](https://github.com/slirens/xiaohongshu-monitor/releases/tag/v1.3.0) |
| HarmonyOS PC | [HUAWEI Browser extension ZIP (preview)](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.2.0/xiaohongshu-monitor-v1.2.0-harmonyos-browser.zip) | [v1.2.0](https://github.com/slirens/xiaohongshu-monitor/releases/tag/v1.2.0) |

The Windows edition requires Windows 10 or later and uses Microsoft Edge or Google Chrome. The macOS edition requires macOS 14 or later and uses Safari.

The Windows installers are Authenticode-unsigned. The macOS apps are ad-hoc signed and have not been notarized by Apple. Your operating system may show a security prompt on first launch.

## Permitted use and platform restrictions

**For lawful, noncommercial use only.** The source code is available for noncommercial purposes such as learning, research, and testing. Use for unlawful activities or commercial gain is prohibited. Before using the app, ensure you are authorized to access and process the content and comply with applicable laws and Xiaohongshu's rules.

**Automated browsing may trigger Xiaohongshu's account safeguards.** The platform may flag this activity as unusual, issue an account warning, request verification, or restrict access. According to the platform's account notice, repeated violations may affect account privileges and traffic. If you receive a warning or encounter a restriction, stop the task and follow the platform's instructions.

## Build and run

### Linux

On Ubuntu 22.04 or 24.04 Desktop (x64), install Google Chrome, then open the DEB with your software installer or run `sudo apt install ./xiaohongshu-monitor-v1.3.0-linux-amd64.deb`. Open **Xiaohongshu Monitor** from the applications menu and sign in when the dedicated browser opens on the first run. Reports are saved to `~/.local/share/xiaohongshu-monitor/reports` by default.

To build from source, use amd64 Linux, `dpkg-deb`, and the official Node.js 24 LTS distribution with npm. Run `bash linux/build-deb.sh` from the repository root.

### HarmonyOS PC

Extract the ZIP and load the folder containing `manifest.json` from Manage extensions in HUAWEI Browser. Use HarmonyOS 6.0 or later and HUAWEI Browser 5.1.10.300 or later. [Installation and build instructions](harmonyos/README.md)

### macOS

Open the DMG for your Mac's processor and drag the app to Applications. In Safari Settings → Advanced, enable features for web developers. In Develop → Developer Settings, enable **Allow JavaScript from Apple Events**. Allow the app to control Safari when macOS asks, then follow the app's prompt to sign in.

To build from source, install the Xcode Command Line Tools and the official Node.js 24 LTS distribution with npm. Run `bash macos/build.sh` from the repository root. The app is built in `macos-output`, and reports are stored in `~/Library/Application Support/Xiaohongshu Monitor/reports`.

### Windows

Download Setup x64 for 64-bit Windows or Setup x86 for 32-bit Windows. Run the installer, then launch **Xiaohongshu Monitor** from the Start menu. Uninstall it from Settings → Apps.

To build from source, have Microsoft Edge or Google Chrome available and use Node.js with npm for the target architecture. Run the command for your architecture from the repository directory.

- Use Node.js 24 LTS for x64 and run `pwsh -File .\build.ps1`.
- Use 32-bit Node.js 22 LTS for x86 and run `pwsh -File .\build.ps1 -Architecture x86 -OutputDirectory .\dist\windows-x86 -Node "C:\tools\node-x86\node.exe"`. Replace the example Node.js path with your own.

Sign in when the app opens its browser window. Separate keywords with spaces. For AI analysis, select a provider in More Settings and enter its API key. Enabling AI analysis sends note excerpts and the data needed for the report summary to the selected provider.

## Date range and scrolling

Windows and macOS v1.4.0 and Linux v1.3.0 support stopping at the start date. With Latest sorting and Scroll to bottom selected, the app finishes scanning the current screen and stops scrolling that keyword once it sees a note published before the start date. Notes on the start date remain eligible. If the start date is outside the six-month preset, this combination uses the site's unrestricted publication-date option.

## Templates and reports

Windows and macOS v1.4.0 and Linux v1.3.0 support structured templates. Copy [the sample Markdown template](报告生成模板.md), write your analysis criteria under `分析规则`, and edit the JSON in the `report-schema` block.

- `analysisFields` defines each note's output keys, column headings, and instructions. It supports text, boolean, and enum fields.
- `summarySections` defines summary headings, order, and instructions.
- `sheets` defines worksheet order, names, and columns. Available kinds are `summary`, `overview`, `date`, and `keyword`. Built-in column keys are `keyword`, `date`, `title`, `body`, `url`, `analysis_status`, and `date_label`. Add analysis columns using their declared field keys.

The app builds the workbook from this layout. If an AI result fails field validation, the report marks that analysis incomplete and retains the collected notes. The same layout works with AI disabled. Older templates with the `总结`, `总表`, and `日期` headings use the default layout.

Desktop reports are written to the local `reports` folder. The browser extension downloads the workbook directly.

## License

The project is available under the PolyForm Noncommercial License 1.0.0. See [LICENSE](LICENSE).
