import AppKit
import SwiftUI
import UniformTypeIdentifiers

private let providers = ["OpenAI", "Claude", "Gemini", "DeepSeek", "Kimi", "GLM", "Qwen"]
private let reportHome = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("Xiaohongshu Monitor", isDirectory: true)
private let resources = Bundle.main.resourceURL!

private enum AppLanguage: String {
    case chinese = "zh-CN"
    case english = "en"

    init(preferredLanguage: String) {
        self = Locale(identifier: preferredLanguage).language.languageCode?.identifier == "zh" ? .chinese : .english
    }

    static let system = Self(preferredLanguage: Locale.preferredLanguages.first ?? "en")
    var locale: Locale { Locale(identifier: rawValue) }

    func text(_ chinese: String, _ english: String) -> String {
        self == .chinese ? chinese : english
    }
}

private func text(_ chinese: String, _ english: String) -> String {
    AppLanguage.system.text(chinese, english)
}

private func worker(home: URL, key: String = "", language: AppLanguage = .system) -> Process {
    let task = Process()
    task.executableURL = resources.appendingPathComponent("runtime/node")
    task.arguments = [resources.appendingPathComponent("monitor.mjs").path, "--desktop"]
    var env = ProcessInfo.processInfo.environment
    env["XHS_MONITOR_HOME"] = home.path
    env["XHS_UI_LANG"] = language.rawValue
    env.removeValue(forKey: "XHS_AI_KEY")
    env.removeValue(forKey: "OPENAI_API_KEY")
    if !key.isEmpty { env["XHS_AI_KEY"] = key }
    task.environment = env
    return task
}

private struct Prompt: Identifiable {
    let id = UUID()
    let text: String
    var chooseTime: Bool { text.contains("同名时间选项") || text.contains("same publication time option") }
    var timeOptions: [String] {
        if text.contains("此日期可使用不限") || text.contains("Any time covers this range") { return ["不限"] }
        return ["一天内", "一周内", "半年内"]
    }
}

@MainActor
private final class Monitor: ObservableObject {
    @Published var status = text("准备就绪", "Ready")
    @Published var log = ""
    @Published var running = false
    @Published var prompt: Prompt?
    private var commands: FileHandle?
    private var stopped = false
    private var report = false
    private var analysisWarning = false

    func start(_ request: [String: Any], key: String) {
        let task = worker(home: reportHome, key: key)
        let input = Pipe(), output = Pipe()
        task.standardInput = input
        task.standardOutput = output
        task.standardError = output
        do {
            try FileManager.default.createDirectory(at: reportHome, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: request)
            try task.run()
            try input.fileHandleForWriting.write(contentsOf: data + Data([10]))
        } catch {
            if task.isRunning { task.terminate() }
            status = text("启动失败 · ", "Could not start · ") + error.localizedDescription
            return
        }
        commands = input.fileHandleForWriting
        running = true
        stopped = false
        report = false
        analysisWarning = false
        status = text("正在打开 Safari…", "Opening Safari…")
        log = ""
        NSApp.dockTile.badgeLabel = nil
        let reader = output.fileHandleForReading
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var buffer = Data()
            while let chunk = try? reader.read(upToCount: 4096), !chunk.isEmpty {
                buffer.append(chunk)
                while let newline = buffer.firstIndex(of: 10) {
                    let line = String(decoding: buffer[..<newline], as: UTF8.self)
                    buffer.removeSubrange(...newline)
                    DispatchQueue.main.async { self?.receive(line) }
                }
            }
            if !buffer.isEmpty {
                let line = String(decoding: buffer, as: UTF8.self)
                DispatchQueue.main.async { self?.receive(line) }
            }
            task.waitUntilExit()
            let code = task.terminationStatus
            DispatchQueue.main.async { self?.finish(code) }
        }
    }

    private func receive(_ line: String) {
        if line.hasPrefix("UI_ASK "), let message = try? JSONDecoder().decode(String.self, from: Data(line.dropFirst(7).utf8)) {
            if stopped { return }
            NSApp.activate(ignoringOtherApps: true)
            NSApp.windows.first(where: { $0.isMiniaturized })?.deminiaturize(nil)
            prompt = Prompt(text: message)
            status = text("等待网页操作", "Waiting for Safari")
            return
        }
        if line.hasPrefix("UI_ANALYSIS_WARNING ") { analysisWarning = true }
        if line.hasPrefix("已生成 Excel：") || line.hasPrefix("Excel report: ") { report = true }
        let message = line.replacingOccurrences(of: "^UI_(?:PROGRESS|ANALYSIS_WARNING) ", with: "", options: .regularExpression)
        log += message + "\n"
        if log.count > 50000 { log = String(log.suffix(40000)) }
        if !stopped { status = message }
    }

    private func finish(_ code: Int32) {
        running = false
        prompt = nil
        try? commands?.close()
        commands = nil
        if stopped { status = text("任务已停止", "Task stopped") }
        else if !report { status = text("运行失败，请查看任务日志", "Run failed. See Task details.") }
        else if code != 0 { status = text("部分关键词失败 · 已导出报告", "Some keywords failed. Report exported.") }
        else {
            status = analysisWarning
                ? text("报告已导出 · AI 分析未完整", "Report exported. AI analysis incomplete.")
                : text("报告已生成", "Report exported")
        }
        NSApp.dockTile.badgeLabel = stopped ? nil : (report && code == 0 && !analysisWarning ? "✓" : "!")
    }

    func answer(_ value: String) {
        if let encoded = try? JSONEncoder().encode(value) { try? commands?.write(contentsOf: encoded + Data([10])) }
        prompt = nil
    }

    func stop() {
        guard running, !stopped else { return }
        stopped = true
        command("UI_CANCEL")
        prompt = nil
        status = text("正在停止…", "Stopping…")
    }

    func command(_ message: String) {
        try? commands?.write(contentsOf: Data((message + "\n").utf8))
    }
}

private enum MistBlue {
    static let canvas = Color(red: 250/255, green: 252/255, blue: 254/255)
    static let sidebarTop = Color(red: 239/255, green: 246/255, blue: 253/255)
    static let sidebarBottom = Color(red: 223/255, green: 235/255, blue: 248/255)
    static let field = Color(red: 243/255, green: 247/255, blue: 251/255)
    static let outline = Color(red: 214/255, green: 224/255, blue: 238/255)
    static let hover = Color(red: 147/255, green: 173/255, blue: 208/255)
    static let line = Color(red: 221/255, green: 229/255, blue: 239/255)
    static let ink = Color(red: 36/255, green: 50/255, blue: 72/255)
    static let muted = Color(red: 84/255, green: 99/255, blue: 122/255)
    static let accent = Color(red: 35/255, green: 91/255, blue: 194/255)
    static let focus = Color(red: 68/255, green: 116/255, blue: 203/255)
}

private struct FieldSurface<Content: View>: View {
    let isFocused: Bool
    let content: Content
    @State private var hovered = false

    init(isFocused: Bool = false, @ViewBuilder content: () -> Content) {
        self.isFocused = isFocused
        self.content = content()
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 11)
        content
            .background(isFocused || hovered ? Color.white : MistBlue.field, in: shape)
            .overlay {
                shape.strokeBorder(isFocused ? MistBlue.focus : hovered ? MistBlue.hover : MistBlue.outline)
                    .allowsHitTesting(false)
            }
            .overlay {
                if isFocused {
                    shape.stroke(MistBlue.focus.opacity(0.17), lineWidth: 3).padding(-2).allowsHitTesting(false)
                }
            }
            .contentShape(shape)
            .onHover { hovered = $0 }
    }
}

@MainActor
private struct MonitorView: View {
    @StateObject private var monitor = Monitor()
    @State private var keyword = ""
    @State private var start = Date()
    @State private var end = Date()
    @State private var sort = "最新"
    @State private var screens = ""
    @State private var provider = "OpenAI"
    @State private var model = ""
    @State private var key = ""
    @State private var endpoint = ""
    @State private var template = ""
    @State private var settingsOpen = false
    @State private var logOpen = false
    @State private var chosenTime = ""
    @FocusState private var keywordFocused: Bool
    private let zone = TimeZone(identifier: "Asia/Shanghai")!
    private static let cover = NSImage(contentsOf: resources.appendingPathComponent("cover.png"))

    private var sortLabel: String { sort == "最新" ? text("最新", "Latest") : text("综合", "Relevance") }

    private var screensLabel: String {
        let entered = screens.trimmingCharacters(in: .whitespacesAndNewlines)
        if let number = Int(entered), (1...10000).contains(number) {
            return text("\(number) 屏", "\(number) \(number == 1 ? "screen" : "screens")")
        }
        return text("下拉到底", "Scroll to bottom")
    }

    var body: some View {
        GeometryReader { geometry in
            HStack(spacing: 0) {
                sidebar.frame(width: min(266, max(200, geometry.size.width * 0.245)))
                MistBlue.line.frame(width: 1)
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        taskForm
                        Spacer(minLength: 30)
                        footer
                        if logOpen { taskDetails }
                    }
                    .frame(minHeight: max(0, geometry.size.height - 72))
                    .padding(.horizontal, 38)
                    .padding(.top, 45)
                    .padding(.bottom, 27)
                }
                .background(MistBlue.canvas)
            }
        }
        .foregroundStyle(MistBlue.ink)
        .tint(MistBlue.accent)
        .preferredColorScheme(.light)
        .environment(\.locale, AppLanguage.system.locale)
        .frame(minWidth: 820, minHeight: 510)
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didDeminiaturizeNotification)) { _ in
            if monitor.prompt == nil { monitor.command("UI_FOREGROUND") }
        }
        .sheet(item: $monitor.prompt, onDismiss: { chosenTime = "" }) { prompt in
            browserPrompt(prompt)
        }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let cover = Self.cover {
                Image(nsImage: cover)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .accessibilityHidden(true)
            }
            Text(text("小红书舆情监控", "Xiaohongshu Monitor"))
                .font(.system(size: 16, weight: .medium))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 23)
        .padding(.top, 39)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(LinearGradient(colors: [MistBlue.sidebarTop, MistBlue.sidebarBottom],
            startPoint: .topLeading, endPoint: .bottomTrailing))
    }

    private var taskForm: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 7) {
                Text(text("新建监控任务", "New monitoring task"))
                    .font(.system(size: 29, weight: .medium))
                    .accessibilityAddTraits(.isHeader)
                Text(text("按关键词和日期采集笔记，导出 Excel 报告。",
                    "Collect notes by keyword and date, then export an Excel report."))
                    .font(.system(size: 14))
                    .foregroundStyle(MistBlue.muted)
            }
            .padding(.bottom, 9)
            VStack(alignment: .leading, spacing: 8) {
                fieldLabel(text("关键词", "Keywords"))
                FieldSurface(isFocused: keywordFocused) {
                    TextField(text("多个关键词用空格分隔，例如 宝山 硚口",
                        "Separate keywords with spaces, for example coffee tea"), text: $keyword, axis: .vertical)
                        .textFieldStyle(.plain)
                        .font(.system(size: 15))
                        .lineLimit(1...6)
                        .focused($keywordFocused)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 11)
                        .frame(maxWidth: .infinity, minHeight: 51, alignment: .leading)
                        .accessibilityLabel(text("关键词", "Keywords"))
                }
                .simultaneousGesture(TapGesture().onEnded { keywordFocused = true })
                .onHover { entered in
                    (entered ? NSCursor.iBeam : NSCursor.arrow).set()
                }
            }
            HStack(alignment: .top, spacing: 18) {
                dateField(text("开始日期", "Start date"), selection: $start)
                dateField(text("结束日期", "End date"), selection: $end)
            }
            advancedSettings
        }
    }

    private func fieldLabel(_ label: String) -> some View {
        Text(label).font(.system(size: 14, weight: .medium))
    }

    private func dateField(_ label: String, selection: Binding<Date>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            fieldLabel(label)
            FieldSurface {
                DatePicker(label, selection: selection, displayedComponents: .date)
                    .datePickerStyle(.compact)
                    .labelsHidden()
                    .monospacedDigit()
                    .environment(\.timeZone, zone)
                    .frame(maxWidth: .infinity, minHeight: 46, alignment: .leading)
                    .padding(.horizontal, 14)
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private var advancedSettings: some View {
        DisclosureGroup(isExpanded: $settingsOpen) {
            VStack(alignment: .leading, spacing: 13) {
                Divider().overlay(MistBlue.line)
                Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 13) {
                    GridRow {
                        Picker(text("网页排序", "Sort order"), selection: $sort) {
                            Text(text("最新", "Latest")).tag("最新")
                            Text(text("综合", "Relevance")).tag("综合")
                        }
                        TextField(text("下拉到底或输入屏数", "Scroll to bottom or enter a screen count"), text: $screens)
                            .accessibilityLabel(text("划屏数量", "Screen count"))
                    }
                    GridRow {
                        Picker(text("AI 服务商", "AI provider"), selection: $provider) {
                            ForEach(providers, id: \.self) { Text($0) }
                        }
                        TextField(text("模型（可选）", "Model (optional)"), text: $model)
                    }
                    GridRow {
                        SecureField(text("API 密钥（可选）", "API key (optional)"), text: $key)
                        Button(template.isEmpty ? text("选择 Markdown 报告规则…", "Choose Markdown template…")
                            : URL(fileURLWithPath: template).lastPathComponent) { chooseTemplate() }
                    }
                    if provider == "Qwen" {
                        GridRow {
                            TextField(text("百炼兼容接口地址（可选）", "DashScope-compatible URL (optional)"), text: $endpoint)
                                .gridCellColumns(2)
                        }
                    }
                    if !template.isEmpty {
                        GridRow { Button(text("恢复内置模板", "Restore built-in template")) { template = "" } }
                    }
                }
                .textFieldStyle(.roundedBorder)
            }
            .padding(.top, 13)
        } label: {
            HStack {
                Text(text("更多设置", "More settings"))
                Spacer(minLength: 8)
                Text("\(sortLabel) · \(screensLabel)")
                    .font(.system(size: 13))
                    .foregroundStyle(MistBlue.muted)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .frame(minHeight: 48)
        .background(Color.white.opacity(0.55), in: RoundedRectangle(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(MistBlue.line).allowsHitTesting(false) }
        .onChange(of: provider) { _, _ in model = ""; key = "" }
    }

    private var footer: some View {
        VStack(spacing: 17) {
            MistBlue.line.frame(height: 1)
            HStack(spacing: 10) {
                Circle().fill(MistBlue.focus.opacity(0.68)).frame(width: 6, height: 6).accessibilityHidden(true)
                Text(monitor.status)
                    .font(.system(size: 13))
                    .foregroundStyle(MistBlue.muted)
                    .lineLimit(1).help(monitor.status).textSelection(.enabled)
                Button(logOpen ? text("收起详情", "Hide details") : text("任务详情", "Task details")) {
                    logOpen.toggle()
                }
                .buttonStyle(.link)
                .fixedSize(horizontal: true, vertical: false)
                Spacer(minLength: 7)
                Button(text("打开报告目录", "Open reports")) { openReports() }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .fixedSize(horizontal: true, vertical: false)
                if monitor.running {
                    Button(text("最小化", "Minimize")) {
                        monitor.command("UI_BACKGROUND")
                        NSApp.keyWindow?.miniaturize(nil)
                    }.buttonStyle(.bordered).buttonBorderShape(.capsule)
                    Button(text("停止任务", "Stop task")) { monitor.stop() }
                        .buttonStyle(.bordered).buttonBorderShape(.capsule)
                } else {
                    Button(text("开始监控", "Start monitoring")) { startTask() }
                        .buttonStyle(.borderedProminent)
                        .buttonBorderShape(.capsule)
                        .disabled(keyword.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }.controlSize(.large)
        }
    }

    private var taskDetails: some View {
        ScrollView {
            Text(monitor.log.isEmpty ? text("任务日志将在运行后显示。", "Task logs appear after starting a run.") : monitor.log)
                .font(.system(size: 12, design: .monospaced))
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
                .padding(13)
        }
        .frame(height: 160)
        .background(MistBlue.field, in: RoundedRectangle(cornerRadius: 11))
        .padding(.top, 17)
    }

    private func browserPrompt(_ prompt: Prompt) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(text("需要在 Safari 操作", "Action needed in Safari")).font(.headline)
            Text(prompt.text).fixedSize(horizontal: false, vertical: true)
            if prompt.chooseTime {
                Picker(text("已应用的发布时间", "Publication time applied"), selection: $chosenTime) {
                    Text(text("请选择", "Select a time option")).tag("")
                    ForEach(prompt.timeOptions, id: \.self) { Text(timeOptionLabel($0)).tag($0) }
                }
            }
            HStack {
                Button(text("停止任务", "Stop task"), role: .cancel) { monitor.stop() }
                Spacer()
                Button(text("继续", "Continue")) { monitor.answer(prompt.chooseTime ? chosenTime : "继续") }
                    .buttonStyle(.borderedProminent).disabled(prompt.chooseTime && chosenTime.isEmpty)
            }
        }.padding(24).frame(width: 470).interactiveDismissDisabled()
    }

    private func timeOptionLabel(_ option: String) -> String {
        switch option {
        case "不限": text(option, "Any time")
        case "一天内": text(option, "Past day")
        case "一周内": text(option, "Past week")
        case "半年内": text(option, "Past six months")
        default: option
        }
    }

    private func chooseTemplate() {
        let dialog = NSOpenPanel()
        dialog.title = text("选择 Markdown 报告规则", "Choose a Markdown report template")
        dialog.prompt = text("选择", "Choose")
        dialog.allowsMultipleSelection = false
        if let markdown = UTType(filenameExtension: "md") { dialog.allowedContentTypes = [markdown] }
        if dialog.runModal() == .OK, let file = dialog.url { template = file.path }
    }

    private func openReports() {
        let folder = reportHome.appendingPathComponent("reports", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            NSWorkspace.shared.open(folder)
            NSApp.dockTile.badgeLabel = nil
        } catch { monitor.status = error.localizedDescription }
    }

    private func startTask() {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = zone
        formatter.dateFormat = "yyyy-MM-dd"
        let first = formatter.string(from: start), last = formatter.string(from: end)
        guard first <= last else {
            monitor.status = text("结束日期不能早于开始日期", "End date must be on or after the start date.")
            return
        }
        let entered = screens.trimmingCharacters(in: .whitespacesAndNewlines)
        let count: Any
        if entered.isEmpty || entered == "下拉到底" || entered.caseInsensitiveCompare("Scroll to bottom") == .orderedSame {
            count = "bottom"
        } else if let number = Int(entered), (1...10000).contains(number) {
            count = number
        } else {
            monitor.status = text("划屏请输入正整数，或留空下拉到底。", "Enter a screen count from 1 to 10,000, or leave it blank.")
            return
        }
        monitor.start(["keyword": keyword, "start": first, "end": last, "sort": sort, "screens": count,
            "template": template, "provider": provider, "model": model, "endpoint": endpoint], key: key)
        key = ""
        logOpen = true
    }
}

@main
@MainActor
struct XiaohongshuMonitor: App {
    init() {
        if CommandLine.arguments.contains("--verify-localization") {
            let english = AppLanguage(preferredLanguage: "en-US")
            let chinese = AppLanguage(preferredLanguage: "zh-Hant-TW")
            let prompt = Prompt(text: "Select the same publication time option. Any time covers this range.")
            guard english.text("准备就绪", "Ready") == "Ready",
                  chinese.text("准备就绪", "Ready") == "准备就绪",
                  worker(home: reportHome, language: english).environment?["XHS_UI_LANG"] == "en",
                  prompt.chooseTime, prompt.timeOptions == ["不限"] else { exit(1) }
            print("Verified Chinese and English language selection and the worker prompt contract.")
            exit(0)
        }
        if CommandLine.arguments.count == 4, CommandLine.arguments[1] == "--verify" {
            let task = worker(home: URL(fileURLWithPath: CommandLine.arguments[3], isDirectory: true), language: .chinese)
            let input = Pipe()
            task.standardInput = input
            do {
                try task.run()
                let data = try JSONSerialization.data(withJSONObject: [
                    "keyword": "宝山 硚口", "start": "2026-11-23", "end": "2026-11-23", "sort": "最新",
                    "screens": 1, "source": CommandLine.arguments[2], "provider": "OpenAI",
                ])
                try input.fileHandleForWriting.write(contentsOf: data + Data([10]))
                try input.fileHandleForWriting.close()
                task.waitUntilExit()
                exit(task.terminationStatus)
            } catch {
                FileHandle.standardError.write(Data(error.localizedDescription.utf8))
                exit(1)
            }
        }
    }
    var body: some Scene {
        WindowGroup(text("小红书舆情监控", "Xiaohongshu Monitor")) { MonitorView() }
            .defaultSize(width: 1060, height: 620)
    }
}
