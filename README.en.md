# Xiaohongshu Monitor

[简体中文](README.md) · English

A desktop tool for Windows, macOS, and Linux, with a preview extension for HUAWEI Browser on HarmonyOS PCs. It collects Xiaohongshu notes by keyword and publication date and exports Excel reports using Markdown templates. It supports OpenAI, Claude, Gemini, DeepSeek, Kimi, GLM, and Qwen.

## Download

| Platform | Downloads | Release notes |
| --- | --- | --- |
| Windows | [Setup x64](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.8/xiaohongshu-monitor-v1.0.8-windows-x64-setup.exe) · [Setup x86](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.8/xiaohongshu-monitor-v1.0.8-windows-x86-setup.exe) | [v1.0.8](https://github.com/slirens/xiaohongshu-monitor/releases/tag/v1.0.8) |
| macOS | [DMG Apple Silicon](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.8/xiaohongshu-monitor-v1.0.8-macos-arm64.dmg) · [DMG Intel x64](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.8/xiaohongshu-monitor-v1.0.8-macos-x86_64.dmg) | [v1.0.8](https://github.com/slirens/xiaohongshu-monitor/releases/tag/v1.0.8) |
| Linux | [DEB x64](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.8/xiaohongshu-monitor-v1.0.8-linux-amd64.deb) | [v1.0.8](https://github.com/slirens/xiaohongshu-monitor/releases/tag/v1.0.8) |
| HarmonyOS PC | [HUAWEI Browser extension ZIP (preview)](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.8/xiaohongshu-monitor-v1.0.8-harmonyos-browser.zip) | [v1.0.8](https://github.com/slirens/xiaohongshu-monitor/releases/tag/v1.0.8) |

The Windows edition requires Windows 10 or later and supports Microsoft Edge, Google Chrome, and the Chromium engine in 360 browsers. The macOS edition requires macOS 14 or later and uses Safari.

The pale-blue interface follows the system display language. It uses Simplified Chinese for Chinese locales and English otherwise. The HarmonyOS extension follows your browser interface language.

The Windows installers are Authenticode-unsigned. The macOS apps are ad-hoc signed and have not been notarized by Apple. Your operating system may show a security prompt on first launch.

## Permitted use and platform restrictions

**For lawful, noncommercial use only.** The source code is available for noncommercial purposes such as learning, research, and testing. Use for unlawful activities or commercial gain is prohibited. Before using the app, ensure you are authorized to access and process the content and comply with applicable laws and Xiaohongshu's rules.

**Automated browsing may trigger Xiaohongshu's account safeguards.** The platform may flag this activity as unusual, issue an account warning, request verification, or restrict access. According to the platform's account notice, repeated violations may affect account privileges and traffic. If you receive a warning or encounter a restriction, stop the task and follow the platform's instructions.

## Build and run

### Linux

On Ubuntu 22.04 or 24.04 Desktop (x64), install Google Chrome, then open the DEB with your software installer or run `sudo apt install ./xiaohongshu-monitor-v1.0.8-linux-amd64.deb`. Open **Xiaohongshu Monitor** from the applications menu and sign in when the dedicated browser opens on the first run. Reports are saved to `~/.local/share/xiaohongshu-monitor/reports` by default.

APT will ask for downgrade confirmation if a previously released package with a higher version number is installed.

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

## Continue monitoring

Choose **Continue monitoring** to load the latest report, or select another Excel report. You can add or remove restored keywords and adjust the dates. The app searches the edited list, revisits accessible notes associated with those keywords, and saves new findings and engagement changes in a new workbook. History for removed keywords stays in the report.

The summary retains each update by run date. The overview and publication-date sheets show the prior and current likes, saves, and comments, along with the absolute and percentage changes. Comparisons use counts available in both runs. A zero baseline keeps the absolute change and leaves the percentage blank. When AI analysis is enabled, the report summary also uses the new findings and engagement changes.

## Date range and scrolling

With Latest sorting and Scroll to bottom selected, the app finishes scanning the current screen and stops scrolling that keyword once it sees a note published before the start date. Notes on the start date remain eligible. If the start date is outside the six-month preset, this combination uses the site's unrestricted publication-date option.

## Built-in analysis framework

[Download the built-in Markdown template](https://github.com/slirens/xiaohongshu-monitor/releases/download/v1.0.8/analysis-template.md) · [View source](报告生成模板.md)

| Level | Built-in framework |
| --- | --- |
| Individual notes | Use the title and body to assess relevance, sentiment and topic, then write a one-sentence summary. Distinguish firsthand accounts, opinions and claims that need verification. |
| Summary | Describe the scope and sample size, then summarize themes, risks and open questions. Continued runs append discoveries and changes by run date. |
| Overview and detail | Deduplicate the overview by note, group date sheets by publication date and view each keyword separately. Details contain the note URL and previous counts, current counts, absolute changes and percentage changes for likes, saves and comments. |

### How to customize and import the template

1. Download the template and save a copy as a `.md` file. Start with the text under `分析规则` (Analysis rules) and `总结` (Summary). For example, ask for a separate section on after-sales complaints with source links and current status. The JSON can stay as it is when you only want to change the focus of the analysis.
2. To change AI output, edit `analysisFields` for note-level fields and `summarySections` for summary sections in the `report-schema` JSON. Edit `title` and `instruction` and keep the corresponding `key`. Note fields support `text`, `boolean` and `enum`. List enum choices in `values`.
3. To change workbook columns, reorder the relevant `columns` in `sheets`. Available worksheet kinds are `summary`, `overview`, `date` and `keyword`. For example, move `comments_delta` and `comments_rate` after `title` to display comment changes beside titles. Add a new analysis field to a sheet by placing its `key` in that sheet's `columns`.
4. Save the Markdown in UTF-8. Keep a valid JSON object with `"version": 1` inside the `report-schema` block. Import and select the file under **More settings → Report template**, and enter your AI service's API key to run template-guided analysis.

The app calculates engagement changes from observed counts. The `likes`, `saves` and `comments` columns hold the current values. Each supports `_previous`, `_delta` and `_rate` suffixes for previous values, absolute changes and percentage changes. The app exports engagement figures and follows the workbook layout with AI disabled. Older templates with the `总结`, `总表` and `日期` headings use the default layout.

Desktop reports are written to the local `reports` folder. The browser extension downloads the workbook directly.

## License

The project is available under the PolyForm Noncommercial License 1.0.0. See [LICENSE](LICENSE).
