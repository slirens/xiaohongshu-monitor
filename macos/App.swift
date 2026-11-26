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

    static let system: Self = {
        #if F1A_UI_VERIFICATION
        if let language = ProcessInfo.processInfo.environment["XHS_FIXTURE_LANGUAGE"] { return Self(preferredLanguage: language) }
        #endif
        return Self(preferredLanguage: Locale.preferredLanguages.first ?? "en")
    }()
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

private func latestReport(in home: URL) -> URL? {
    let folder = home.appendingPathComponent("reports", isDirectory: true)
    let keys: Set<URLResourceKey> = [.isRegularFileKey, .contentModificationDateKey]
    let files = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: Array(keys),
                                                              options: .skipsHiddenFiles)
    return files?.compactMap { file -> (URL, Date)? in
        guard file.lastPathComponent.hasPrefix("舆情_"), file.pathExtension == "xlsx",
              let values = try? file.resourceValues(forKeys: keys), values.isRegularFile == true else { return nil }
        return (file, values.contentModificationDate ?? .distantPast)
    }.max { $0.1 < $1.1 }?.0
}

private struct ReportMetadata: Decodable, Sendable {
    let keywords: [String]?
    let start: String?
    let error: String?
}

private func inspectReport(_ report: URL) throws -> ReportMetadata {
    let task = worker(home: reportHome)
    task.arguments = [resources.appendingPathComponent("monitor.mjs").path, "--inspect-report", report.path]
    task.standardInput = FileHandle.nullDevice
    task.standardError = FileHandle.nullDevice
    let output = Pipe()
    task.standardOutput = output
    try task.run()
    let timeout = DispatchWorkItem { if task.isRunning { task.terminate() } }
    DispatchQueue.global().asyncAfter(deadline: .now() + 30, execute: timeout)
    defer { timeout.cancel() }
    let data = output.fileHandleForReading.readDataToEndOfFile()
    task.waitUntilExit()
    guard let metadata = try? JSONDecoder().decode(ReportMetadata.self, from: data) else {
        throw CocoaError(.fileReadCorruptFile, userInfo: [NSLocalizedDescriptionKey:
            text("无法读取这份报告。", "Could not read this report.")])
    }
    return metadata
}

private struct Prompt: Identifiable {
    let id = UUID()
    let text: String
}

private enum TaskOutcome: Equatable {
    case success, partial, analysisWarning, failure, stopped
}

@MainActor
private final class Monitor: ObservableObject {
    @Published var status = text("准备就绪", "Ready")
    @Published var log = ""
    @Published var running = false
    @Published var prompt: Prompt?
    @Published private(set) var outcome: TaskOutcome?
    @Published private(set) var processed = 0
    @Published private(set) var total = 0
    @Published private(set) var awaitingStop = false
    private var commands: FileHandle?
    private var stopped = false
    private(set) var report: URL?
    @Published private(set) var analysisWarning = false
    private static let keywordStart = #/^Starting keyword ([0-9]+)\/([0-9]+): .+$/#
    private static let keywordStartChinese = #/^开始关键词 ([0-9]+)\/([0-9]+)：.+$/#
    private static let keywordFinished = #/^([0-9]+)\/([0-9]+) processed · “.+” (?:completed|failed)$/#
    private static let keywordFinishedChinese = #/^([0-9]+)\/([0-9]+) 已处理 · 「.+」(?:完成|失败)$/#

    func start(_ request: [String: Any], key: String) {
        let task = worker(home: reportHome, key: key)
        let input = Pipe(), output = Pipe()
        task.standardInput = input
        task.standardOutput = output
        task.standardError = output
        outcome = nil
        processed = 0
        total = 0
        awaitingStop = false
        report = nil
        do {
            try FileManager.default.createDirectory(at: reportHome, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: request)
            try task.run()
            try input.fileHandleForWriting.write(contentsOf: data + Data([10]))
        } catch {
            if task.isRunning { task.terminate() }
            status = text("启动失败 · ", "Could not start · ") + error.localizedDescription
            outcome = .failure
            return
        }
        commands = input.fileHandleForWriting
        running = true
        stopped = false
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
        if let prefix = ["已生成 Excel：", "Excel report: "].first(where: { line.hasPrefix($0) }) {
            report = URL(fileURLWithPath: String(line.dropFirst(prefix.count)))
        }
        let message = line.replacingOccurrences(of: "^UI_(?:PROGRESS|ANALYSIS_WARNING) ", with: "", options: .regularExpression)
        if let match = message.wholeMatch(of: Self.keywordStart) ?? message.wholeMatch(of: Self.keywordStartChinese),
           let index = Int(match.1), let expected = Int(match.2),
           index == processed + 1, index <= expected, (total == 0 || expected == total) {
            total = expected
        }
        if line.hasPrefix("UI_PROGRESS "),
           let match = message.wholeMatch(of: Self.keywordFinished) ?? message.wholeMatch(of: Self.keywordFinishedChinese),
           let index = Int(match.1), let expected = Int(match.2),
           index == processed + 1, index <= expected, expected == total {
            processed = index
        }
        log += message + "\n"
        if log.count > 50000 { log = String(log.suffix(40000)) }
        if !stopped { status = message }
    }

    private func finish(_ code: Int32) {
        running = false
        prompt = nil
        awaitingStop = false
        try? commands?.close()
        commands = nil
        if stopped {
            status = text("任务已停止", "Task stopped")
            outcome = .stopped
        }
        else if report == nil {
            status = text("运行失败，请查看任务日志", "Run failed. See Task details.")
            outcome = .failure
        }
        else if code != 0 {
            status = text("部分关键词失败 · 已导出报告", "Some keywords failed. Report exported.")
            outcome = .partial
        }
        else {
            status = analysisWarning
                ? text("报告已导出 · AI 分析未完整", "Report exported. AI analysis incomplete.")
                : text("报告已生成", "Report exported")
            outcome = analysisWarning ? .analysisWarning : .success
        }
        NSApp.dockTile.badgeLabel = stopped ? nil : (report != nil && code == 0 && !analysisWarning ? "✓" : "!")
    }

    func answer(_ value: String) {
        if let encoded = try? JSONEncoder().encode(value) { try? commands?.write(contentsOf: encoded + Data([10])) }
        prompt = nil
    }

    func stop() {
        guard running, !stopped else { return }
        stopped = true
        awaitingStop = true
        command("UI_CANCEL")
        prompt = nil
        status = text("正在停止…", "Stopping…")
    }

    func command(_ message: String) {
        try? commands?.write(contentsOf: Data((message + "\n").utf8))
    }

    func editTask() {
        if !running { outcome = nil }
    }

    #if F1A_UI_VERIFICATION
    func loadFixture(_ fixture: UIFixture) {
        guard fixture.isRun else { return }
        running = true
        for index in 0..<fixture.total {
            let term = text("示例 \(index + 1)", "Fixture \(index + 1)")
            receive(text("开始关键词 \(index + 1)/\(fixture.total)：\(term)",
                         "Starting keyword \(index + 1)/\(fixture.total): \(term)"))
            if index == 0 || fixture.hasReport {
                let failure = fixture == .warning && index == 1
                receive(text("UI_PROGRESS \(index + 1)/\(fixture.total) 已处理 · 「\(term)」\(failure ? "失败" : "完成")",
                             "UI_PROGRESS \(index + 1)/\(fixture.total) processed · “\(term)” \(failure ? "failed" : "completed")"))
            }
        }
        if fixture.waitsForLogin {
            receive(text("UI_ASK \"登录后继续监控。\"", "UI_ASK \"Sign in to continue monitoring.\""))
        } else if fixture.hasReport {
            if fixture == .warning { receive(text("UI_ANALYSIS_WARNING 分析未完整", "UI_ANALYSIS_WARNING Analysis incomplete")) }
            receive(text("已生成 Excel：", "Excel report: ") + UIFixture.report.path)
            finish(fixture == .warning ? 1 : 0)
        } else {
            receive(text("正在采集笔记", "Collecting notes"))
        }
    }
    #endif
}

private enum FA {
    static let window = Color.white
    static let ink = rgb(0x1E1A1B)
    static let secondary = rgb(0x6F6C6D)
    static let tertiary = rgb(0x838182)
    static let separator = rgb(0xE8E8E8)
    static let fill = rgb(0xEFEFEF)
    static let grouped = rgb(0xF7F7F7)
    static let brand = rgb(0xFF2442)
    static let accent = rgb(0xDC1437)
    static let success = rgb(0x167A44)
    static let standard = Animation.timingCurve(0.32, 0.72, 0, 1, duration: 0.25)
    static let fast = Animation.easeOut(duration: 0.15)
    static let spring = Animation.spring(duration: 0.35, bounce: 0.18)
    static let logo = NSImage(contentsOf: resources.appendingPathComponent("xhs-monitor-logo.png"))

    private static func rgb(_ hex: Int) -> Color {
        Color(red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255)
    }
}

private struct FALogo: View {
    let size: CGFloat

    var body: some View {
        Group {
            if let image = FA.logo {
                Image(nsImage: image).resizable().interpolation(.high)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

private extension FAIcon {
    func label(_ size: CGFloat = 15, color: Color = FA.tertiary) -> some View {
        stroke(color, style: StrokeStyle(lineWidth: size * 1.6 / 24, lineCap: .round, lineJoin: .round))
            .frame(width: size, height: size).accessibilityHidden(true)
    }
}

private struct FASuccessMark: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drawn = false

    var body: some View {
        FAIcon.check.trim(from: 0, to: drawn || reduceMotion ? 1 : 0)
            .stroke(FA.success, style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
            .frame(width: 24, height: 24)
            .accessibilityHidden(true)
            .onAppear {
                withAnimation(reduceMotion ? nil : FA.spring) { drawn = true }
            }
    }
}

private struct FAButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary, plain, segment(selected: Bool) }
    var kind: Kind = .secondary

    func makeBody(configuration: Configuration) -> some View {
        StyledContent(kind: kind, configuration: configuration)
    }

    private struct StyledContent: View {
        let kind: Kind
        let configuration: Configuration
        @State private var hovered = false
        @Environment(\.isEnabled) private var enabled
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        private var palette: (fill: Color, ink: Color, height: CGFloat, padding: CGFloat) {
            switch kind {
            case .primary:
                return (enabled ? FA.accent : FA.fill, enabled ? .white : FA.secondary, 34, 16)
            case .secondary:
                return (FA.fill, enabled ? FA.ink : FA.secondary, 34, 14)
            case .plain:
                return (.clear, enabled ? FA.secondary : FA.tertiary, 32, 3)
            case .segment(let selected):
                return (selected ? .white : .clear, selected ? FA.ink : FA.secondary, 25, 11)
            }
        }

        var body: some View {
            configuration.label
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(palette.ink)
                .lineLimit(1)
                .padding(.horizontal, palette.padding)
                .frame(minHeight: palette.height)
                .background(palette.fill, in: RoundedRectangle(cornerRadius: 8))
                .overlay {
                    if case .segment(true) = kind {
                        RoundedRectangle(cornerRadius: 8).strokeBorder(FA.separator)
                    } else if enabled && hovered {
                        RoundedRectangle(cornerRadius: 8).fill(
                            kind.isPlain ? FA.ink.opacity(0.045) : FA.window.opacity(0.04))
                    }
                }
                .contentShape(RoundedRectangle(cornerRadius: 8))
                .scaleEffect(!reduceMotion && configuration.isPressed ? 0.97 : 1)
                .animation(FA.fast, value: configuration.isPressed)
                .onHover { hovered = $0 }
        }
    }
}

private extension FAButtonStyle.Kind {
    var isPlain: Bool {
        if case .plain = self { return true }
        return false
    }
}

private struct FAWindowReader: NSViewRepresentable {
    let resolve: (NSWindow) -> Void

    func makeNSView(context: Context) -> NativeView {
        let view = NativeView(frame: .zero)
        view.resolve = resolve
        return view
    }

    func updateNSView(_ nsView: NativeView, context: Context) {
        nsView.resolve = resolve
    }

    final class NativeView: NSView {
        var resolve: ((NSWindow) -> Void)?

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if let window {
                DispatchQueue.main.async { [weak self, weak window] in
                    if let window { self?.resolve?(window) }
                }
            }
        }
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
    @State private var previousReport: URL?
    @State private var lastReport = latestReport(in: reportHome)
    @State private var importingReport = false
    @State private var settingsOpen = false
    @State private var logOpen = false
    @State private var confirmStop = false
    @State private var compact = false
    @State private var fullFrame: NSRect?
    @State private var window: NSWindow?
    @State private var formTouched = false
    @FocusState private var keywordFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var currentStage
    private let zone = TimeZone(identifier: "Asia/Shanghai")!

    init() { }

    #if F1A_UI_VERIFICATION
    init(fixture: UIFixture) {
        let state = Monitor()
        state.loadFixture(fixture)
        _monitor = StateObject(wrappedValue: state)
        _keyword = State(initialValue: fixture == .invalid ? "" : text("示例一 示例二", "Fixture-A Fixture-B"))
        _start = State(initialValue: fixture == .invalid ? Date(timeIntervalSince1970: 1_800_086_400) :
            Date(timeIntervalSince1970: 1_800_000_000))
        _end = State(initialValue: Date(timeIntervalSince1970: 1_800_000_000))
        _previousReport = State(initialValue: fixture == .followUp ? UIFixture.report : nil)
        _formTouched = State(initialValue: fixture == .invalid)
        _settingsOpen = State(initialValue: fixture == .settings)
        _logOpen = State(initialValue: fixture == .running || fixture == .login)
        _compact = State(initialValue: fixture.isCompact)
        _confirmStop = State(initialValue: fixture == .compactStop)
    }
    #endif

    private var sortLabel: String { sort == "最新" ? text("最新", "Latest") : text("综合", "Relevance") }
    private var screensLabel: String {
        if let number = screenCount as? Int {
            return text("\(number) 屏", "\(number) \(number == 1 ? "screen" : "screens")")
        }
        return text("下拉到底", "Scroll to bottom")
    }
    private var screenCount: Any? {
        let entered = screens.trimmingCharacters(in: .whitespacesAndNewlines)
        if entered.isEmpty || entered == "下拉到底" || entered.caseInsensitiveCompare("Scroll to bottom") == .orderedSame {
            return "bottom"
        }
        return Int(entered).flatMap { (1...10000).contains($0) ? $0 : nil }
    }
    private var screenError: String { text("划屏请输入正整数，或留空下拉到底。", "Enter a screen count from 1 to 10,000, or leave it blank.") }
    private var noKeywords: Bool { keyword.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var dateInvalid: Bool { dateFormatter.string(from: start) > dateFormatter.string(from: end) }
    private var canStart: Bool { !noKeywords && !dateInvalid && screenCount != nil && !importingReport }
    private var stage: Int { monitor.running ? 2 : monitor.outcome == nil ? 1 : 3 }
    private var taskTitle: String {
        previousReport == nil ? text("新建监控任务", "New monitoring task") : text("继续监控", "Continue monitoring")
    }
    private var progressLabel: String {
        if monitor.total == 0 { return text("正在准备任务", "Preparing the task") }
        return text("已处理 \(monitor.processed) / \(monitor.total) 个关键词",
                    "Processed \(monitor.processed) of \(monitor.total) keywords")
    }

    var body: some View {
        ZStack(alignment: .center) {
            Group {
                if compact { compactTask }
                else { fullWindow }
            }
            .disabled(monitor.prompt != nil || confirmStop)
            .accessibilityHidden(monitor.prompt != nil || confirmStop)
            if let prompt = monitor.prompt, !confirmStop {
                modalBackground
                browserPrompt(prompt)
                    .transition(.opacity)
            } else if confirmStop {
                if compact {
                    VStack { Spacer(); stopPanel.padding(18) }.transition(.opacity)
                } else {
                    modalBackground
                    stopPanel.frame(maxWidth: 380).transition(.opacity)
                }
            }
        }
        .foregroundStyle(FA.ink)
        .tint(FA.accent)
        .background(FA.window)
        .preferredColorScheme(.light)
        .environment(\.locale, AppLanguage.system.locale)
        .frame(minWidth: compact ? 290 : 880, minHeight: compact ? 180 : 590)
        .background(FAWindowReader { window = $0 })
        .animation(FA.fast, value: monitor.prompt?.id)
        .animation(FA.fast, value: confirmStop)
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didDeminiaturizeNotification)) { _ in
            if monitor.prompt == nil { monitor.command("UI_FOREGROUND") }
        }
        .onChange(of: provider) { _, _ in model = ""; key = "" }
        .onChange(of: monitor.running) { _, running in
            if running {
                if let current = window, !current.styleMask.contains(.fullScreen) { setCompact(true) }
            } else {
                setCompact(false)
                confirmStop = false
                if let report = monitor.report {
                    lastReport = report
                    if previousReport != nil { previousReport = report }
                }
            }
        }
    }

    private var fullWindow: some View {
        VStack(spacing: 0) {
            toolbar
            Spacer(minLength: 0).frame(height: 0)
            ScrollView {
                Group {
                    if monitor.running { execution.transition(pageTransition) }
                    else if monitor.outcome != nil { result.transition(pageTransition) }
                    else if settingsOpen { advancedSettings.transition(pageTransition) }
                    else { taskForm.transition(pageTransition) }
                }
                .frame(maxWidth: 600, alignment: .leading)
                .padding(.top, settingsOpen ? 19 : 35)
                .padding(.bottom, 16)
                .frame(maxWidth: .infinity)
            }
            .defaultScrollAnchor(.top)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .animation(reduceMotion ? FA.fast : FA.standard, value: stage)
            Text(text("仅限合法、非商业使用。自动化浏览可能触发平台警告或限制，影响账号权益和流量。",
                      "For lawful, non-commercial use only. Automated browsing may trigger platform warnings or restrictions and affect account privileges and reach."))
                .font(.system(size: 12))
                .foregroundStyle(FA.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 20)
                .padding(.vertical, 10)
            footer
        }
    }

    private var toolbar: some View {
        ZStack {
            HStack(spacing: 2) {
                ForEach(1...3, id: \.self) { index in
                    HStack(spacing: 5) {
                        if index < stage { FAIcon.check.label(12) }
                        else {
                            Text("\(index)").font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(index == stage ? FA.brand : FA.secondary)
                        }
                        Text(stageLabel(index))
                            .font(.system(size: 13, weight: index == stage ? .semibold : .medium))
                    }
                    .foregroundStyle(index == stage ? FA.ink : FA.secondary)
                    .padding(.horizontal, 11)
                    .frame(height: 28)
                    .background {
                        if index == stage {
                            RoundedRectangle(cornerRadius: 7).fill(FA.window)
                                .matchedGeometryEffect(id: "stage", in: currentStage)
                        }
                    }
                    .accessibilityLabel(stageLabel(index))
                    .accessibilityAddTraits(index == stage ? .isSelected : [])
                }
            }
            .padding(2)
            .background(FA.fill, in: RoundedRectangle(cornerRadius: 9))
            .animation(reduceMotion ? nil : FA.standard, value: stage)
            HStack(spacing: 8) {
                FALogo(size: 22)
                Text(text("小红书舆情监控", "Xiaohongshu Monitor"))
                    .font(.system(size: 13, weight: .semibold))
                Spacer()
                Button(action: {}) { FAIcon.exportFile.label(16) }
                    .buttonStyle(FAButtonStyle(kind: .plain))
                    .accessibilityLabel(text("导出诊断日志", "Export diagnostics"))
                    .help(text("当前 macOS 版提供任务日志。", "The macOS edition provides the task log."))
                    .disabled(true)
            }
            .padding(.horizontal, 20)
        }
        .frame(height: 52)
        .overlay(alignment: .bottom) { rule }
    }

    private func stageLabel(_ index: Int) -> String {
        switch index {
        case 1: return text("设置任务", "Set up")
        case 2: return text("执行监控", "Monitor")
        default: return text("导出结果", "Results")
        }
    }

    private var taskForm: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 7) {
                heading(taskTitle)
                Text(previousReport == nil
                    ? text("按关键词和日期采集笔记，导出 Excel 报告。", "Collect notes by keyword and date, then export an Excel report.")
                    : text("从上次报告取回关键词，可修改后继续检索。", "Restore keywords from the previous report and edit them before searching."))
                    .font(.system(size: 13)).foregroundStyle(FA.secondary)
            }
            HStack(spacing: 2) {
                Button(text("新建监控", "New monitoring")) { if previousReport != nil { newTask() } }
                    .buttonStyle(FAButtonStyle(kind: .segment(selected: previousReport == nil)))
                    .accessibilityAddTraits(previousReport == nil ? .isSelected : [])
                Button(reportButtonLabel) { if previousReport == nil { importPreviousReport() } }
                    .buttonStyle(FAButtonStyle(kind: .segment(selected: previousReport != nil)))
                    .accessibilityAddTraits(previousReport != nil ? .isSelected : [])
            }
            .padding(2)
            .background(FA.fill, in: RoundedRectangle(cornerRadius: 9))
            .disabled(importingReport)
            if let file = previousReport { previousReportRow(file) }
            VStack(alignment: .leading, spacing: 7) {
                keywordRow
                if formTouched && noKeywords {
                    errorHint(text("请输入关键词", "Enter a keyword."))
                } else {
                    Text(previousReport == nil
                        ? text("多个关键词用空格分隔，每个关键词依次检索。", "Separate keywords with spaces. Each keyword runs in order.")
                        : text("报告已导入，可增删关键词。", "Report imported. Add or remove keywords."))
                        .font(.system(size: 12)).foregroundStyle(FA.secondary).padding(.horizontal, 16)
                }
            }
            VStack(alignment: .leading, spacing: 7) {
                VStack(spacing: 0) {
                    dateRow(text("开始日期", "Start date"), selection: $start, hasError: dateInvalid)
                    insetRule
                    dateRow(text("结束日期", "End date"), selection: $end)
                }
                .background(FA.grouped, in: RoundedRectangle(cornerRadius: 12))
                if dateInvalid { errorHint(text("结束日期不能早于开始日期", "End date must be on or after the start date.")) }
                else {
                    Text(text("北京时间，包含开始和结束当天", "Beijing time, including both dates"))
                        .font(.system(size: 12)).foregroundStyle(FA.secondary).padding(.horizontal, 16)
                }
            }
            Button {
                changeSettings(true)
            } label: {
                HStack(spacing: 9) {
                    Text(text("更多设置", "More settings"))
                    Spacer()
                    Text("\(sortLabel) · \(screensLabel) · \(template.isEmpty ? text("内置模板", "Built-in template") : URL(fileURLWithPath: template).lastPathComponent)")
                        .foregroundStyle(FA.secondary).lineLimit(1).truncationMode(.middle)
                    FAIcon.chevron.label()
                }
                .font(.system(size: 13)).padding(.horizontal, 16).frame(minHeight: 44)
                .background(FA.grouped, in: RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
            if monitor.status != text("准备就绪", "Ready") {
                Text(monitor.status).font(.system(size: 12)).foregroundStyle(FA.secondary).textSelection(.enabled)
            }
            if logOpen { taskDetails }
        }
    }

    private var keywordRow: some View {
        let invalid = formTouched && noKeywords
        let shape = RoundedRectangle(cornerRadius: 11)
        let terms = keyword.split(whereSeparator: \.isWhitespace)
        return HStack(alignment: .center, spacing: 12) {
            Text(text("关键词", "Keywords")).font(.system(size: 13)).foregroundStyle(FA.secondary)
            ZStack(alignment: .leading) {
                TextField(text("多个关键词用空格分隔，例如 宝山 硚口",
                               "Separate keywords with spaces, for example coffee tea"), text: $keyword, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.system(size: 13))
                    .lineLimit(1...5)
                    .focused($keywordFocused)
                    .opacity(!keywordFocused && !terms.isEmpty ? 0 : 1)
                    .accessibilityLabel(text("关键词", "Keywords"))
                if !keywordFocused && !terms.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(Array(terms.prefix(5).enumerated()), id: \.offset) { _, term in
                            Text(String(term)).lineLimit(1)
                                .padding(.horizontal, 9).padding(.vertical, 4)
                                .background(FA.fill, in: Capsule())
                        }
                        if terms.count > 5 {
                            Text("+\(terms.count - 5)").foregroundStyle(FA.secondary)
                        }
                    }
                    .font(.system(size: 13)).lineLimit(1)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                    .transition(.opacity)
                }
            }
            .animation(FA.fast, value: keywordFocused)
            if invalid { FAIcon.alert.label(16, color: FA.accent) }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(minHeight: 48)
        .background(keywordFocused || invalid ? FA.window : FA.grouped, in: shape)
        .overlay {
            if invalid || keywordFocused {
                shape.strokeBorder(invalid ? FA.accent : FA.brand)
                    .allowsHitTesting(false)
            }
        }
        .overlay {
            if keywordFocused && !invalid {
                shape.stroke(FA.brand.opacity(0.16), lineWidth: 3).padding(-2).allowsHitTesting(false)
            }
        }
        .contentShape(shape)
        .simultaneousGesture(TapGesture().onEnded { keywordFocused = true })
        .onChange(of: keywordFocused) { _, focused in
            if !focused { formTouched = true }
        }
    }

    private func previousReportRow(_ file: URL) -> some View {
        HStack(spacing: 10) {
            FAIcon.doc.label(16)
            Text(file.lastPathComponent).font(.system(size: 13)).lineLimit(1).truncationMode(.middle).help(file.lastPathComponent)
            Spacer(minLength: 10)
            Button(importingReport ? text("正在读取…", "Reading…") : text("更换报告…", "Change report…")) { importPreviousReport() }
                .buttonStyle(FAButtonStyle(kind: .plain)).disabled(importingReport)
        }
        .padding(.horizontal, 16).frame(minHeight: 44)
        .background(FA.grouped, in: RoundedRectangle(cornerRadius: 12))
    }

    private func errorHint(_ label: String) -> some View {
        Text(label).font(.system(size: 12)).foregroundStyle(FA.accent).padding(.horizontal, 16)
    }

    private func dateRow(_ label: String, selection: Binding<Date>, hasError: Bool = false) -> some View {
        HStack(spacing: 10) {
            Text(label).font(.system(size: 13))
            Spacer()
            DatePicker(label, selection: selection, displayedComponents: .date)
                .datePickerStyle(.compact)
                .labelsHidden()
                .monospacedDigit()
                .environment(\.timeZone, zone)
                .foregroundStyle(hasError ? FA.accent : FA.ink)
            if hasError { FAIcon.alert.label(16, color: FA.accent) }
        }
        .padding(.horizontal, 16).frame(minHeight: 44)
    }

    private var advancedSettings: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                changeSettings(false)
            } label: {
                HStack(spacing: 4) { FAIcon.back.label(14); Text(taskTitle) }
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(FA.secondary)
                    .frame(minHeight: 23)
            }
            .buttonStyle(.plain)
            heading(text("更多设置", "More settings"))
            settingsGroup(text("采集", "Collection")) {
                settingRow(text("网页排序", "Sort order")) {
                    HStack(spacing: 2) {
                        sortOption("最新", text("最新", "Latest"))
                        sortOption("综合", text("综合", "Relevance"))
                    }
                    .padding(2).background(FA.fill, in: RoundedRectangle(cornerRadius: 8))
                }
                insetRule
                settingRow(text("划屏数量", "Screen count"), hasError: screenCount == nil) {
                    HStack(spacing: 10) {
                        TextField(text("输入正整数", "Enter a positive integer"), text: $screens)
                            .textFieldStyle(.plain).multilineTextAlignment(.trailing)
                            .accessibilityLabel(text("自定义划屏数量", "Custom screen count"))
                        Menu(screensLabel) {
                            Button(text("下拉到底", "Scroll to bottom")) { screens = "" }
                            ForEach(1...4, id: \.self) { number in
                                Button(text("\(number) 屏", "\(number) \(number == 1 ? "screen" : "screens")")) { screens = "\(number)" }
                            }
                        }
                        .menuStyle(.borderlessButton)
                        .tint(FA.ink)
                        .fixedSize()
                    }
                }
                if screenCount == nil { errorHint(screenError).padding(.vertical, 5) }
            }
            settingsGroup(text("报告", "Report")) {
                settingRow(text("报告生成模板", "Report template")) {
                    Menu(template.isEmpty ? text("使用内置模板", "Use built-in template")
                         : URL(fileURLWithPath: template).lastPathComponent) {
                        Button(text("恢复内置模板", "Restore built-in template")) { template = "" }
                            .disabled(template.isEmpty)
                        Button(text("导入模板…", "Import template…")) { chooseTemplate() }
                    }
                    .menuStyle(.borderlessButton)
                    .tint(FA.ink)
                    .frame(maxWidth: 270, alignment: .trailing)
                    .lineLimit(1).truncationMode(.middle)
                }
                insetRule
                settingRow(text("导入模板…", "Import template…")) {
                    Button {
                        chooseTemplate()
                    } label: {
                        Text(text(".md · 须含「总结」「总表」「日期」或报告架构",
                                  ".md · required headings or a report schema"))
                    }
                    .buttonStyle(FAButtonStyle(kind: .plain))
                    .accessibilityLabel(text("导入模板…", "Import template…"))
                }
            }
            settingsGroup(text("AI 分析（可选）", "AI analysis (optional)")) {
                settingRow(text("AI 服务商", "AI provider")) {
                    Picker(text("AI 服务商", "AI provider"), selection: $provider) {
                        ForEach(providers, id: \.self) { Text($0) }
                    }.labelsHidden().fixedSize()
                }
                insetRule
                settingRow(text("模型", "Model")) {
                    TextField(text("留空使用默认", "Leave blank for default"), text: $model)
                        .textFieldStyle(.plain).multilineTextAlignment(.trailing)
                        .accessibilityLabel(text("模型（可选）", "Model (optional)"))
                }
                insetRule
                settingRow(text("API 密钥", "API key")) {
                    SecureField(text("未填写", "Not entered"), text: $key)
                        .textFieldStyle(.plain).multilineTextAlignment(.trailing)
                        .accessibilityLabel(text("API 密钥（可选）", "API key (optional)"))
                }
                insetRule
                settingRow(text("Qwen 接口地址", "Qwen endpoint")) {
                    TextField(provider == "Qwen"
                        ? text("百炼兼容接口地址（可选）", "DashScope-compatible URL (optional)")
                        : text("仅选择 Qwen 时可用", "Available when Qwen is selected"), text: $endpoint)
                        .textFieldStyle(.plain).multilineTextAlignment(.trailing)
                        .accessibilityLabel(text("Qwen 接口地址", "Qwen endpoint"))
                        .disabled(provider != "Qwen")
                }
            }
            Text(text("留空密钥则仅导出笔记明细", "Leave the API key blank to export note details only."))
                .foregroundStyle(FA.secondary).font(.system(size: 12)).padding(.horizontal, 16)
        }
    }

    private func settingsGroup<Content: View>(_ label: String, @ViewBuilder contents: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label).font(.system(size: 12)).foregroundStyle(FA.secondary).padding(.horizontal, 16)
            VStack(spacing: 0, content: contents)
                .background(FA.grouped, in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private func settingRow<Content: View>(_ label: String, hasError: Bool = false,
                                           @ViewBuilder contents: () -> Content) -> some View {
        HStack(spacing: 10) {
            Text(label).font(.system(size: 13))
            Spacer(minLength: 12)
            contents().font(.system(size: 13))
            if hasError { FAIcon.alert.label(15, color: FA.accent) }
        }
        .padding(.horizontal, 16).frame(minHeight: 38)
        .overlay {
            if hasError { RoundedRectangle(cornerRadius: 8).strokeBorder(FA.accent).allowsHitTesting(false) }
        }
    }

    private func sortOption(_ value: String, _ label: String) -> some View {
        Button(label) { sort = value }
            .buttonStyle(FAButtonStyle(kind: .segment(selected: sort == value)))
            .accessibilityAddTraits(sort == value ? .isSelected : [])
    }

    private var footer: some View {
        HStack(spacing: 9) {
            if !settingsOpen { reportDirectoryButton }
            if monitor.running || monitor.outcome != nil {
                Button(logOpen ? text("收起详情", "Hide details") : text("任务详情", "Task details")) {
                    logOpen.toggle()
                }
                .buttonStyle(FAButtonStyle(kind: .plain))
            }
            Spacer(minLength: 7)
            if monitor.running {
                Button(text("紧凑窗", "Compact window")) { setCompact(true) }.buttonStyle(FAButtonStyle())
                backgroundButton
                stopButton
            } else if monitor.outcome != nil {
                Button(text("新建监控", "New monitoring")) { newTask() }.buttonStyle(FAButtonStyle())
                Button(text("继续监控…", "Continue monitoring…")) {
                    monitor.editTask()
                    settingsOpen = false
                    previousReport = nil
                    importPreviousReport()
                }.buttonStyle(FAButtonStyle()).disabled(importingReport)
                if let report = monitor.report {
                    Button(text("打开报告", "Open report")) {
                        NSWorkspace.shared.open(report)
                        NSApp.dockTile.badgeLabel = nil
                    }.buttonStyle(FAButtonStyle(kind: .primary))
                }
            } else if settingsOpen {
                Button(text("完成", "Done")) { changeSettings(false) }.buttonStyle(FAButtonStyle())
                    .keyboardShortcut(.defaultAction)
            } else {
                Button(previousReport == nil ? text("开始监控", "Start monitoring") : text("开始续查", "Run follow-up")) {
                    startTask()
                }
                .buttonStyle(FAButtonStyle(kind: .primary)).keyboardShortcut(.defaultAction)
                .disabled(!canStart)
            }
        }
        .padding(.horizontal, 20)
        .frame(height: 58)
        .overlay(alignment: .top) { rule }
    }

    private var reportDirectoryButton: some View {
        Button(action: openReports) {
            HStack(spacing: 6) { FAIcon.folder.label(); Text(text("打开报告目录", "Open reports")) }
        }
        .buttonStyle(FAButtonStyle(kind: .plain))
    }

    private var backgroundButton: some View {
        Button {
            monitor.command("UI_BACKGROUND")
            (window ?? NSApp.keyWindow)?.miniaturize(nil)
        } label: {
            HStack(spacing: 5) { FAIcon.tray.label(15, color: FA.ink); Text(text("后台执行", "Run in background")) }
        }
        .buttonStyle(FAButtonStyle())
    }

    private var stopButton: some View {
        Button {
            confirmStop = true
        } label: {
            HStack(spacing: 5) { FAIcon.stop.label(15, color: FA.ink); Text(text("停止任务", "Stop task")) }
        }
        .buttonStyle(FAButtonStyle())
        .disabled(monitor.awaitingStop)
    }

    private var execution: some View {
        VStack(alignment: .leading, spacing: 11) {
            heading(monitor.prompt == nil ? text("正在采集笔记", "Collecting notes") : text("等待小红书登录", "Waiting for Xiaohongshu sign-in"))
            liveStatus
            Text(progressLabel).font(.system(size: 13)).foregroundStyle(FA.secondary).monospacedDigit()
            progressTrack.padding(.top, 4).padding(.bottom, 8)
            if logOpen { taskDetails }
        }
    }

    private var liveStatus: some View {
        HStack(spacing: 8) {
            Circle().fill(FA.brand).frame(width: 8, height: 8).accessibilityHidden(true)
            Text(monitor.status).font(.system(size: 14, weight: .semibold))
                .lineLimit(2).help(monitor.status)
        }
        .accessibilityElement(children: .combine)
    }

    private var result: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center, spacing: 16) {
                Group {
                    if monitor.outcome == .success { FASuccessMark() }
                    else { FAIcon.alert.label(24, color: resultColor) }
                }
                .frame(width: 48, height: 48)
                .background(resultColor.opacity(0.09), in: Circle())
                VStack(alignment: .leading, spacing: 5) {
                    heading(monitor.status)
                    if monitor.total > 0 {
                        Text(progressLabel).font(.system(size: 13)).foregroundStyle(FA.secondary)
                    }
                }
            }
            if let report = monitor.report {
                HStack(spacing: 13) {
                    FAIcon.doc.label(22, color: FA.ink)
                        .frame(width: 44, height: 44)
                        .background(FA.window, in: RoundedRectangle(cornerRadius: 10))
                    VStack(alignment: .leading, spacing: 5) {
                        Text(report.lastPathComponent).font(.system(size: 14, weight: .semibold))
                            .lineLimit(1).truncationMode(.middle).help(report.lastPathComponent)
                        Text(text("Excel 工作簿 · 报告目录", "Excel workbook · Reports folder"))
                            .foregroundStyle(FA.secondary).font(.system(size: 12))
                    }
                    Spacer()
                }
                .padding(.horizontal, 16).frame(minHeight: 72)
                .background(FA.grouped, in: RoundedRectangle(cornerRadius: 12))
            }
            if monitor.analysisWarning {
                HStack(spacing: 9) {
                    FAIcon.alert.label(15)
                    Text(text("AI 分析未完整", "AI analysis incomplete"))
                    Spacer()
                    Text(text("已导出互动统计与模板布局", "Engagement and template layout exported"))
                        .foregroundStyle(FA.secondary).lineLimit(2)
                }
                .font(.system(size: 13)).padding(.horizontal, 16).frame(minHeight: 44)
                .background(FA.grouped, in: RoundedRectangle(cornerRadius: 12))
            }
            if logOpen { taskDetails }
        }
    }

    private var resultColor: Color {
        switch monitor.outcome {
        case .success: return FA.success
        case .stopped, .none: return FA.secondary
        default: return FA.accent
        }
    }

    private var compactTask: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 7) {
                FALogo(size: 18)
                Text(text("监控进度", "Monitoring progress")).font(.system(size: 13, weight: .semibold))
                Spacer(minLength: 4)
                Button {
                    setCompact(false)
                } label: { FAIcon.updown.label(15) }
                    .buttonStyle(FAButtonStyle(kind: .plain))
                    .help(text("展开任务进度", "Expand monitoring progress"))
                    .accessibilityLabel(text("展开任务进度", "Expand monitoring progress"))
                if monitor.prompt != nil { FAIcon.alert.label(13, color: FA.accent) }
                else { Circle().fill(FA.brand).frame(width: 7, height: 7).accessibilityHidden(true) }
                Text(monitor.prompt == nil ? text("运行中", "Running") : text("等待登录", "Waiting for sign-in"))
                    .font(.system(size: 12)).foregroundStyle(FA.secondary)
            }
            Text(monitor.status).font(.system(size: 17, weight: .semibold))
                .lineLimit(2).help(monitor.status)
            Text(progressLabel).font(.system(size: 12)).foregroundStyle(FA.secondary).monospacedDigit()
            progressTrack
            Spacer(minLength: 4)
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                backgroundButton
                stopButton
                Spacer(minLength: 0)
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
    }

    private var progressTrack: some View {
        GeometryReader { geometry in
            let fraction = monitor.total == 0 ? 0 : CGFloat(monitor.processed) / CGFloat(monitor.total)
            ZStack(alignment: .leading) {
                Capsule().fill(FA.fill)
                if fraction > 0 { Capsule().fill(FA.brand).frame(width: geometry.size.width * fraction) }
                if monitor.running && !monitor.awaitingStop && monitor.prompt == nil && !reduceMotion {
                    TimelineView(.animation(minimumInterval: 1.0 / 20)) { context in
                        let position = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.6) / 1.6
                        LinearGradient(colors: [.clear, FA.brand, .clear], startPoint: .leading, endPoint: .trailing)
                            .frame(width: geometry.size.width * 0.45)
                            .offset(x: geometry.size.width * (position * 1.45 - 0.45))
                    }
                }
            }.clipShape(Capsule())
        }
        .frame(height: 4)
        .accessibilityLabel(progressLabel)
    }

    private var taskDetails: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(text("执行日志", "Execution log")).font(.system(size: 12)).foregroundStyle(FA.secondary)
                .padding(.horizontal, 16)
            ScrollViewReader { proxy in
                ScrollView {
                    Text(monitor.log.isEmpty ? text("任务日志将在运行后显示。", "Task logs appear after starting a run.") : monitor.log)
                        .font(.system(size: 12, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                    Color.clear.frame(height: 1).id("latest")
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
                .frame(height: 108)
                .background(FA.grouped, in: RoundedRectangle(cornerRadius: 12))
                .defaultScrollAnchor(.bottom)
                .safeAreaInset(edge: .bottom, alignment: .trailing, spacing: 0) {
                    Button(text("回到最新", "Jump to latest")) { proxy.scrollTo("latest", anchor: .bottom) }
                        .buttonStyle(FAButtonStyle(kind: .plain))
                        .padding(.horizontal, 13)
                }
            }
        }
    }

    private var modalBackground: some View {
        FA.ink.opacity(0.18).accessibilityHidden(true)
    }

    private func browserPrompt(_ prompt: Prompt) -> some View {
        let mayBeLogin = prompt.text.contains("登录") || prompt.text.lowercased().contains("sign in")
        return VStack(alignment: .leading, spacing: compact ? 7 : 10) {
            if !compact { FALogo(size: 36) }
            Text(mayBeLogin ? text("登录小红书", "Sign in to Xiaohongshu") : text("需要在 Safari 操作", "Action needed in Safari"))
                .font(.system(size: 16, weight: .semibold)).accessibilityAddTraits(.isHeader)
            ScrollView {
                Text(prompt.text).font(.system(size: 13)).foregroundStyle(FA.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
            }
            .frame(maxHeight: compact ? 52 : 72)
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                Button(text("结束任务", "End task")) { confirmStop = true }
                    .buttonStyle(FAButtonStyle())
                Button(text("继续", "Continue")) { monitor.answer("继续") }
                    .buttonStyle(FAButtonStyle(kind: .primary)).keyboardShortcut(.defaultAction)
            }
        }
        .padding(compact ? 14 : 20)
        .frame(maxWidth: 380)
        .background(FA.window, in: RoundedRectangle(cornerRadius: 15))
        .shadow(color: FA.ink.opacity(0.18), radius: 20, x: 0, y: 9)
        .padding(.horizontal, compact ? 15 : 0)
    }

    private var stopPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(text("停止当前任务？", "Stop the current task?"))
                .font(.system(size: 14, weight: .semibold)).accessibilityAddTraits(.isHeader)
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                Button(text("继续运行", "Keep running")) { confirmStop = false }
                    .buttonStyle(FAButtonStyle()).keyboardShortcut(.cancelAction)
                Button(text("停止任务", "Stop task")) {
                    confirmStop = false
                    monitor.stop()
                }
                .buttonStyle(FAButtonStyle(kind: .primary))
            }
        }
        .padding(14)
        .background(compact ? FA.grouped : FA.window, in: RoundedRectangle(cornerRadius: 12))
    }

    private var rule: some View { FA.separator.frame(height: 1) }
    private var insetRule: some View { rule.padding(.leading, 16) }

    private func heading(_ title: String) -> some View {
        Text(title).font(.system(size: 26, weight: .semibold)).accessibilityAddTraits(.isHeader)
    }

    private var pageTransition: AnyTransition {
        reduceMotion ? .opacity : .asymmetric(insertion: .offset(x: 24, y: 0).combined(with: .opacity), removal: .opacity)
    }

    private func changeSettings(_ expanded: Bool) {
        withAnimation(reduceMotion ? FA.fast : FA.standard) {
            settingsOpen = expanded
        }
    }

    private func setCompact(_ requested: Bool) {
        guard requested != compact, let frameWindow = window else { return }
        if requested {
            guard let screen = frameWindow.screen ?? NSScreen.main else { return }
            let bounds = screen.visibleFrame
            fullFrame = frameWindow.frame
            compact = true
            let width = min(440, max(320, bounds.width / 3))
            let contentRect = NSRect(x: 0, y: 0, width: width, height: 285)
            let size = frameWindow.frameRect(forContentRect: contentRect).size
            let target = NSRect(x: bounds.maxX - size.width, y: bounds.maxY - size.height,
                                width: size.width, height: size.height)
            DispatchQueue.main.async {
                frameWindow.contentMinSize = NSSize(width: 290, height: 180)
                frameWindow.setFrame(target, display: true, animate: !reduceMotion)
            }
        } else {
            compact = false
            if let frame = fullFrame {
                DispatchQueue.main.async {
                    frameWindow.contentMinSize = NSSize(width: 880, height: 590)
                    frameWindow.setFrame(frame, display: true, animate: !reduceMotion)
                }
            }
            fullFrame = nil
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

    private var reportButtonLabel: String {
        if importingReport { return text("正在读取…", "Reading…") }
        return lastReport == nil ? text("继续监控…", "Continue monitoring…") : text("继续监控", "Continue monitoring")
    }

    private func newTask() {
        previousReport = nil
        keyword = ""
        start = Date()
        end = Date()
        monitor.editTask()
        monitor.status = text("准备就绪", "Ready")
        settingsOpen = false
        logOpen = false
        formTouched = false
        keywordFocused = true
    }

    private func importPreviousReport() {
        let file: URL
        let automatic: Bool
        if previousReport == nil, let lastReport, FileManager.default.fileExists(atPath: lastReport.path) {
            file = lastReport
            automatic = true
        } else {
            let dialog = NSOpenPanel()
            dialog.title = text("导入上次监控报告", "Import the previous monitoring report")
            dialog.prompt = text("导入", "Import")
            dialog.directoryURL = (previousReport ?? lastReport)?.deletingLastPathComponent() ??
                reportHome.appendingPathComponent("reports", isDirectory: true)
            dialog.allowsMultipleSelection = false
            if let workbook = UTType(filenameExtension: "xlsx") { dialog.allowedContentTypes = [workbook] }
            guard dialog.runModal() == .OK, let selected = dialog.url else { return }
            file = selected
            automatic = false
        }
        importingReport = true
        DispatchQueue.global(qos: .userInitiated).async {
            let result = Result { try inspectReport(file) }
            DispatchQueue.main.async {
                importingReport = false
                switch result {
                case .success(let metadata) where metadata.error == nil:
                    previousReport = file
                    let terms = metadata.keywords ?? []
                    keyword = terms.joined(separator: " ")
                    let today = Date()
                    let suggested = metadata.start.flatMap(dateFormatter.date(from:)).flatMap { $0 <= today ? $0 : nil }
                    start = suggested ?? today
                    end = today
                    monitor.status = terms.isEmpty || suggested == nil ?
                        text("报告已导入，请确认关键词和日期。", "Report imported. Check the keywords and dates.") :
                        text("报告已导入，可增删关键词。", "Report imported. Add or remove keywords.")
                    keywordFocused = true
                case .success(let metadata):
                    if automatic { lastReport = nil }
                    monitor.status = metadata.error ?? text("导入失败", "Import failed")
                case .failure(let error):
                    if automatic { lastReport = nil }
                    monitor.status = error.localizedDescription
                }
            }
        }
    }

    private func openReports() {
        let folder = reportHome.appendingPathComponent("reports", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            NSWorkspace.shared.open(folder)
            NSApp.dockTile.badgeLabel = nil
        } catch { monitor.status = error.localizedDescription }
    }

    private var dateFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = zone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }

    private func startTask() {
        formTouched = true
        let formatter = dateFormatter
        let first = formatter.string(from: start), last = formatter.string(from: end)
        guard first <= last else {
            monitor.status = text("结束日期不能早于开始日期", "End date must be on or after the start date.")
            return
        }
        guard let count = screenCount else {
            monitor.status = screenError
            return
        }
        guard !noKeywords, !importingReport, !monitor.running else { return }
        keywordFocused = false
        monitor.start(["keyword": keyword, "start": first, "end": last, "sort": sort, "screens": count,
            "template": template, "provider": provider, "model": model, "endpoint": endpoint,
            "continueReport": previousReport?.path ?? ""], key: key)
        key = ""
        logOpen = true
    }
}

#if F1A_UI_VERIFICATION
private enum UIFixture: String, CaseIterable {
    case new = "FA-01", followUp = "FA-02", settings = "FA-03", invalid = "FA-04", login = "FA-05", running = "FA-06"
    case exported = "FA-07", manyResults = "FA-07b", expandedFallback = "FA-07c", warning = "FA-08", narrow = "FA-09"
    case compactRunning = "FA-10", compactLogin = "FA-11", compactStop = "FA-12"

    static let report = URL(fileURLWithPath: "/tmp/xhs-fixture-report.xlsx")
    var isCompact: Bool { self == .compactRunning || self == .compactLogin || self == .compactStop }
    var waitsForLogin: Bool { self == .login || self == .compactLogin }
    var hasReport: Bool { self == .exported || self == .manyResults || self == .expandedFallback || self == .warning }
    var isRun: Bool { isCompact || waitsForLogin || hasReport || self == .running || self == .narrow }
    var total: Int { self == .manyResults || self == .expandedFallback ? 8 : 2 }
}

// The fixture viewport can be wider than a hosted runner's virtual display.
private final class FixtureWindow: NSWindow {
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        frameRect
    }
}

@MainActor
private func captureFixtures(to destination: URL) throws {
    try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    app.finishLaunching()
    for (size, suffix) in [(NSSize(width: 1080, height: 660), "regular"),
                           (NSSize(width: 880, height: 590), "minimum")] {
        for fixture in UIFixture.allCases where
            (fixture.isCompact ? suffix == "regular" : fixture != .narrow || suffix == "minimum") {
            let dimensions = fixture.isCompact ? NSSize(width: 440, height: 285) : size
            let controller = NSHostingController(rootView: MonitorView(fixture: fixture))
            let window = FixtureWindow(contentRect: NSRect(origin: .zero, size: dimensions),
                                       styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            window.title = text("小红书舆情监控", "Xiaohongshu Monitor")
            window.isReleasedWhenClosed = false
            window.contentViewController = controller
            window.contentMinSize = dimensions
            window.contentMaxSize = dimensions
            window.makeKeyAndOrderFront(nil)
            window.setContentSize(dimensions)
            RunLoop.main.run(until: Date().addingTimeInterval(0.40))
            let rendered = controller.view
            rendered.layoutSubtreeIfNeeded()
            guard abs(rendered.bounds.width - dimensions.width) < 1,
                  abs(rendered.bounds.height - dimensions.height) < 1 else {
                let actual = rendered.bounds.size
                let screenSize = window.screen?.visibleFrame.size
                throw CocoaError(.fileWriteUnknown, userInfo: [NSLocalizedDescriptionKey:
                    "Unexpected UI dimensions for \(fixture.rawValue): \(actual), expected \(dimensions), display \(String(describing: screenSize))."])
            }
            guard let bitmap = rendered.bitmapImageRepForCachingDisplay(in: rendered.bounds) else {
                throw CocoaError(.fileWriteUnknown, userInfo: [NSLocalizedDescriptionKey:
                    "Could not render \(fixture.rawValue) at \(dimensions) with backing scale \(window.backingScaleFactor)."])
            }
            rendered.cacheDisplay(in: rendered.bounds, to: bitmap)
            guard let data = bitmap.representation(using: .png, properties: [:]) else { throw CocoaError(.fileWriteUnknown) }
            let zoom = Int(window.backingScaleFactor)
            print("\(fixture.rawValue) \(AppLanguage.system.rawValue) \(Int(dimensions.width))x\(Int(dimensions.height)) @\(zoom)x\(fixture == .manyResults || fixture == .expandedFallback ? " aggregate fallback" : "")")
            let fileName = "\(fixture.rawValue)-\(AppLanguage.system.rawValue)-\(fixture.isCompact ? "compact" : suffix).png"
            try data.write(to: destination.appendingPathComponent(fileName), options: .atomic)
            window.close()
        }
    }
}
#endif

@main
@MainActor
struct XiaohongshuMonitor: App {
    init() {
        #if F1A_UI_VERIFICATION
        if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--capture-f1a" {
            do {
                try captureFixtures(to: URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true))
                exit(0)
            } catch {
                FileHandle.standardError.write(Data(error.localizedDescription.utf8))
                exit(1)
            }
        }
        #endif
        if CommandLine.arguments.contains("--verify-localization") {
            let english = AppLanguage(preferredLanguage: "en-US")
            let chinese = AppLanguage(preferredLanguage: "zh-Hant-TW")
            guard english.text("准备就绪", "Ready") == "Ready",
                  chinese.text("准备就绪", "Ready") == "准备就绪",
                  worker(home: reportHome, language: english).environment?["XHS_UI_LANG"] == "en",
                  worker(home: reportHome, language: chinese).environment?["XHS_UI_LANG"] == "zh-CN" else { exit(1) }
            print("Verified Chinese and English language selection for the app and worker.")
            exit(0)
        }
        if CommandLine.arguments.count == 4, CommandLine.arguments[1] == "--verify" {
            let home = URL(fileURLWithPath: CommandLine.arguments[3], isDirectory: true)
            let task = worker(home: home, language: .chinese)
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
                guard task.terminationStatus == 0, let report = latestReport(in: home) else { exit(1) }
                let metadata = try inspectReport(report)
                guard metadata.keywords == ["宝山", "硚口"], metadata.start == "2026-11-23" else { exit(1) }
                exit(0)
            } catch {
                FileHandle.standardError.write(Data(error.localizedDescription.utf8))
                exit(1)
            }
        }
    }
    var body: some Scene {
        WindowGroup(text("小红书舆情监控", "Xiaohongshu Monitor")) { MonitorView() }
            .defaultSize(width: 1080, height: 660)
    }
}
