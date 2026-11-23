import AppKit
import SwiftUI
import UniformTypeIdentifiers

private let providers = ["OpenAI", "Claude", "Gemini", "DeepSeek", "Kimi", "GLM", "Qwen"]
private let reportHome = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("Xiaohongshu Monitor", isDirectory: true)
private let resources = Bundle.main.resourceURL!

private func worker(home: URL, key: String = "") -> Process {
    let task = Process()
    task.executableURL = resources.appendingPathComponent("runtime/node")
    task.arguments = [resources.appendingPathComponent("monitor.mjs").path, "--desktop"]
    var env = ProcessInfo.processInfo.environment
    env["XHS_MONITOR_HOME"] = home.path
    env.removeValue(forKey: "XHS_AI_KEY")
    env.removeValue(forKey: "OPENAI_API_KEY")
    if !key.isEmpty { env["XHS_AI_KEY"] = key }
    task.environment = env
    return task
}

private struct Prompt: Identifiable {
    let id = UUID()
    let text: String
    var chooseTime: Bool { text.contains("同名时间选项") }
    var timeOptions: [String] { text.contains("此日期可使用不限") ? ["不限"] : ["一天内", "一周内", "半年内"] }
}

@MainActor
private final class Monitor: ObservableObject {
    @Published var status = "准备就绪"
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
            status = "启动失败 · " + error.localizedDescription
            return
        }
        commands = input.fileHandleForWriting
        running = true
        stopped = false
        report = false
        analysisWarning = false
        status = "正在打开 Safari…"
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
            status = "等待网页操作"
            return
        }
        if line.hasPrefix("UI_ANALYSIS_WARNING ") { analysisWarning = true }
        if line.hasPrefix("已生成 Excel：") { report = true }
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
        if stopped { status = "任务已停止" }
        else if !report { status = "运行失败，请查看任务日志" }
        else if code != 0 { status = "部分关键词失败 · 已导出报告" }
        else { status = analysisWarning ? "报告已导出 · AI 分析未完整" : "报告已生成" }
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
        status = "正在停止…"
    }

    func command(_ message: String) {
        try? commands?.write(contentsOf: Data((message + "\n").utf8))
    }
}

@MainActor
private struct MonitorView: View {
    @StateObject private var monitor = Monitor()
    @State private var keyword = ""
    @State private var start = Date()
    @State private var end = Date()
    @State private var sort = "最新"
    @State private var screens = "下拉到底"
    @State private var provider = "OpenAI"
    @State private var model = ""
    @State private var key = ""
    @State private var endpoint = ""
    @State private var template = ""
    @State private var logOpen = false
    @State private var chosenTime = ""
    private let zone = TimeZone(identifier: "Asia/Shanghai")!

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 16) {
                    if let image = NSImage(contentsOf: resources.appendingPathComponent("cover.png")) {
                        Image(nsImage: image).resizable().aspectRatio(contentMode: .fit).frame(width: 82, height: 78)
                            .clipShape(RoundedRectangle(cornerRadius: 12)).accessibilityHidden(true)
                    }
                    VStack(alignment: .leading) {
                        Text("小红书舆情监控").font(.largeTitle.weight(.semibold))
                        Text("使用 Safari 搜索笔记并导出 Excel。").foregroundStyle(.secondary)
                    }
                }
                GroupBox {
                    VStack(spacing: 12) {
                        TextField("关键词（空格分隔，例如：宝山 硚口）", text: $keyword, axis: .vertical).lineLimit(1...5)
                        HStack {
                            DatePicker("开始日期", selection: $start, displayedComponents: .date)
                            Spacer()
                            DatePicker("结束日期", selection: $end, displayedComponents: .date)
                        }.environment(\.timeZone, zone)
                    }.padding(6)
                }
                DisclosureGroup("更多设置") {
                    Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 12) {
                        GridRow {
                            Picker("网页排序", selection: $sort) {
                                Text("最新").tag("最新")
                                Text("综合").tag("综合")
                            }
                            TextField("划屏（下拉到底或数字）", text: $screens)
                        }
                        GridRow {
                            Picker("AI 服务商", selection: $provider) {
                                ForEach(providers, id: \.self) { Text($0) }
                            }
                            TextField("模型（可选）", text: $model)
                        }
                        GridRow {
                            SecureField("API 密钥（可选）", text: $key)
                            Button(template.isEmpty ? "选择 Markdown 报告规则…" : URL(fileURLWithPath: template).lastPathComponent) { chooseTemplate() }
                        }
                        if provider == "Qwen" {
                            GridRow { TextField("百炼兼容接口地址（可选）", text: $endpoint).gridCellColumns(2) }
                        }
                        if !template.isEmpty { GridRow { Button("恢复内置模板") { template = "" } } }
                    }.padding(.top, 10)
                }.onChange(of: provider) { _, _ in model = ""; key = "" }
                Divider()
                Text(monitor.status).textSelection(.enabled)
                HStack {
                    Button("打开报告目录") { openReports() }
                    Spacer()
                    if monitor.running {
                        Button("最小化") {
                            monitor.command("UI_BACKGROUND")
                            NSApp.keyWindow?.miniaturize(nil)
                        }
                        Button("停止任务") { monitor.stop() }
                    } else {
                        Button("开始监控") { startTask() }.buttonStyle(.borderedProminent)
                            .disabled(keyword.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
                DisclosureGroup("任务日志", isExpanded: $logOpen) {
                    ScrollView {
                        Text(monitor.log).font(.system(.caption, design: .monospaced))
                            .frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
                    }.frame(height: 160)
                }
            }.padding(24)
        }
        .textFieldStyle(.roundedBorder)
        .frame(minWidth: 610, minHeight: 430)
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didDeminiaturizeNotification)) { _ in
            if monitor.prompt == nil { monitor.command("UI_FOREGROUND") }
        }
        .sheet(item: $monitor.prompt, onDismiss: { chosenTime = "" }) { prompt in
            VStack(alignment: .leading, spacing: 18) {
                Text("需要在 Safari 操作").font(.headline)
                Text(prompt.text).fixedSize(horizontal: false, vertical: true)
                if prompt.chooseTime {
                    Picker("已应用的发布时间", selection: $chosenTime) {
                        Text("请选择").tag("")
                        ForEach(prompt.timeOptions, id: \.self) { Text($0) }
                    }
                }
                HStack {
                    Button("停止任务", role: .cancel) { monitor.stop() }
                    Spacer()
                    Button("继续") { monitor.answer(prompt.chooseTime ? chosenTime : "继续") }
                        .buttonStyle(.borderedProminent).disabled(prompt.chooseTime && chosenTime.isEmpty)
                }
            }.padding(24).frame(width: 450).interactiveDismissDisabled()
        }
    }

    private func chooseTemplate() {
        let dialog = NSOpenPanel()
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
        guard first <= last else { monitor.status = "结束日期不能早于开始日期"; return }
        let entered = screens.trimmingCharacters(in: .whitespacesAndNewlines)
        let count: Any
        if entered == "下拉到底" { count = "bottom" }
        else if let number = Int(entered), (1...10000).contains(number) { count = number }
        else { monitor.status = "划屏请输入正整数，或填写「下拉到底」。"; return }
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
        if CommandLine.arguments.count == 4, CommandLine.arguments[1] == "--verify" {
            let task = worker(home: URL(fileURLWithPath: CommandLine.arguments[3], isDirectory: true))
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
        WindowGroup("小红书舆情监控") { MonitorView() }.defaultSize(width: 720, height: 560)
    }
}
