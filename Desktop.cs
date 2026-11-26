using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyVersion("1.1.1.0")]
[assembly: AssemblyFileVersion("1.1.1.0")]
[assembly: AssemblyInformationalVersion("1.1.1")]

internal sealed partial class Desktop : Form
{
    private const int KeywordHeight = 50;
    private static readonly Color Ink = Color.FromArgb(30, 26, 27);
    private static readonly Color Muted = Color.FromArgb(111, 108, 109);
    private static readonly Color Accent = Color.FromArgb(220, 20, 55);
    private static readonly Color Canvas = Color.White;
    private static readonly Color Surface = Color.White;
    private static readonly Color FieldFill = Color.FromArgb(239, 239, 239);
    private static readonly Color FieldEdge = Color.FromArgb(232, 232, 232);
    private static readonly Color FocusEdge = Color.FromArgb(255, 36, 66);
    private static bool English { get { return CultureInfo.CurrentUICulture.TwoLetterISOLanguageName != "zh"; } }
    private static string Ui(string chinese, string english) { return English ? english : chinese; }
    private readonly TextBox keyword = new TextBox();
    private Panel keywordWell;
    private string reportTemplate = "";
    private readonly TextBox secret = new TextBox();
    private readonly ComboBox aiProvider = new ComboBox();
    private readonly TextBox aiModel = new TextBox();
    private readonly TextBox qwenEndpoint = new TextBox();
    private readonly TextBox log = new TextBox();
    private readonly DateField start = new DateField();
    private readonly DateField end = new DateField();
    private readonly ComboBox order = new ComboBox();
    private readonly ComboBox screens = new ComboBox();
    private readonly Label status = new Label();

    private readonly Button run = MakeButton(Ui("开始监控", "Start monitoring"), true);
    private readonly Button open = MakeButton(Ui("打开报告目录", "Open reports"), false);
    private readonly Button importReport = MakeButton(Ui("继续监控…", "Continue monitoring…"), false);
    private readonly Button exportDiagnostics = MakeButton(Ui("导出诊断日志", "Export diagnostics"), false);
    private readonly NotifyIcon tray = new NotifyIcon();
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private readonly string home = AppDomain.CurrentDomain.BaseDirectory;
    private readonly string diagnosticsFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "XhsMonitor", "diagnostics");
    private string latestDiagnosticsFile;
    private string report;
    private string continuationReport = "";
    private string latestContinuationReport;
    private bool importingReport;
    private bool running;
    private bool cancelRequested;
    private bool exitRequested;
    private Process activeWorker;
    private Task<Process> preparedWorker;
    private Form pendingPrompt;
    private Control setupView;
    private TableLayoutPanel compactView;
    private Label compactProgress;
    private Rectangle setupBounds, browserBounds;
    private Size setupMinimum;

    private Action refreshReportHeader;

    [STAThread]
    private static int Main(string[] args)
    {
        bool verifyLayout = args.Length == 2 && args[0] == "--verify-ui";
        if (verifyLayout) {
            if (args[1] != "en" && args[1] != "zh-CN") return 9;
            CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo(args[1]);
        }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using (var window = new Desktop())
        {
            if (verifyLayout) return window.VerifyLayout();
            if (args.Length == 2 && args[0] == "--verify")
                return window.Verify(args[1]);
            window.Shown += delegate { window.PrepareBrowserWorker(); };
            window.FormClosed += delegate { window.ReleasePreparedWorker(); };
            Application.Run(window);
            return 0;
        }
    }

    private Desktop()
    {
        Text = Ui("小红书舆情监控", "Xiaohongshu Monitor");
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(1080, 660);
        MinimumSize = new Size(880, 590);
        AutoScaleMode = AutoScaleMode.Dpi;
        using (var installed = new System.Drawing.Text.InstalledFontCollection())
        {
            bool hasNoto = installed.Families.Any(family => family.Name == "Noto Sans SC");
            Font = new Font(hasNoto ? "Noto Sans SC" : "Microsoft YaHei UI", 10);
        }
        ForeColor = Ink;
        BackColor = Canvas;

        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        tray.Icon = Icon ?? SystemIcons.Application;
        tray.Text = Ui("小红书舆情监控", "Xiaohongshu Monitor");
        var trayMenu = new ContextMenuStrip();
        trayMenu.Items.Add(Ui("打开主窗口", "Open main window"), null, delegate { RestoreWindow(); });
        var latest = trayMenu.Items.Add(Ui("打开最新报告", "Open latest report"), null, delegate {
            string path = LatestReport();
            if (path == null) return;
            try { Process.Start(new ProcessStartInfo(path) { UseShellExecute = true }); }
            catch (Exception error) { MessageBox.Show(error.Message, Ui("无法打开报告", "Could not open report")); }
        });
        trayMenu.Items.Add(Ui("打开报告目录", "Open reports"), null, delegate { OpenReportFolder(); });
#if DISTRIBUTION
        trayMenu.Items.Add("重试联网授权", null, async delegate { RestoreWindow(); await RefreshLicense(); });
#endif
        trayMenu.Items.Add(new ToolStripSeparator());
        var stopTask = trayMenu.Items.Add(Ui("停止当前任务", "Stop current task"), null, delegate { ConfirmStop(false); });
        trayMenu.Items.Add(Ui("退出", "Quit"), null, delegate { ConfirmStop(true); });
        trayMenu.Opening += delegate {
            latest.Enabled = LatestReport() != null;
            stopTask.Enabled = running && !cancelRequested;
        };
        tray.ContextMenuStrip = trayMenu;
        tray.DoubleClick += delegate { RestoreWindow(); };
        tray.BalloonTipClicked += delegate { RestoreWindow(); };
        FormClosed += delegate { tray.Visible = false; tray.Dispose(); trayMenu.Dispose(); };
        Resize += delegate { if (WindowState == FormWindowState.Minimized) HideToTray(); };
        BuildF1AView();
        var templates = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList,
            AccessibleName = Ui("报告模板选择", "Report template selection") };
        templates.Items.Add(Ui("使用内置模板", "Use built-in template"));
        templates.SelectedIndex = 0;
        var browse = MakeButton(Ui("导入模板…", "Import template…"), false);
        var tooltip = new ToolTip();
        FormClosed += delegate { tooltip.Dispose(); };
        string library = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "XhsMonitor", "templates");
        templates.SelectedIndexChanged += delegate {
            reportTemplate = templates.SelectedIndex > 0 ? Path.Combine(library, templates.Text + ".md") : "";
        };
        try {
            if (Directory.Exists(library))
                foreach (string path in Directory.GetFiles(library, "*.md").OrderBy(Path.GetFileNameWithoutExtension))
                    templates.Items.Add(Path.GetFileNameWithoutExtension(path));
        } catch (IOException error) {
            AppendLog(Ui("无法读取模板库：", "Could not read the template library: ") + error.Message);
        } catch (UnauthorizedAccessException error) {
            AppendLog(Ui("无法读取模板库：", "Could not read the template library: ") + error.Message);
        }
        browse.Click += delegate {
            using (var picker = new OpenFileDialog { Filter = Ui("Markdown 模板|*.md", "Markdown templates|*.md"), CheckFileExists = true, Multiselect = true }) {
                if (picker.ShowDialog(this) != DialogResult.OK) return;
                string selected = null;
                var errors = new List<string>();
                foreach (string path in picker.FileNames) {
                    try {
                        string name = ImportTemplate(path, library);
                        if (!templates.Items.Contains(name)) templates.Items.Add(name);
                        if (selected == null) selected = name;
                    } catch (Exception error) {
                        errors.Add(Path.GetFileName(path) + "：" + error.Message);
                    }
                }
                if (selected != null) templates.SelectedItem = selected;
                if (errors.Count > 0) MessageBox.Show(this, String.Join(Environment.NewLine, errors), Ui("部分模板无法导入", "Some templates could not be imported"));
            }
        };
        tooltip.SetToolTip(screens, Ui("默认下拉到底。也可直接输入正整数，例如 3，包含首屏。", "Scroll to the bottom by default, or enter a positive number including the first screen."));
        tooltip.SetToolTip(start, Ui("北京时间，包含开始当天。", "China time. The start date is included."));
        tooltip.SetToolTip(end, Ui("北京时间，包含结束当天。", "China time. The end date is included."));

        secret.UseSystemPasswordChar = true;
        secret.AccessibleName = Ui("所选服务的 AI API 密钥", "API key for the selected provider");
        tooltip.SetToolTip(secret, Ui("填写所选服务商签发的密钥。留空则仅导出笔记明细。", "Enter the key from the selected provider. Leave blank to export notes without AI analysis."));
        aiProvider.DropDownStyle = ComboBoxStyle.DropDownList;
        aiProvider.Items.AddRange(new object[] { "OpenAI", "Claude", "Gemini", "DeepSeek", "Kimi", "GLM", "Qwen" });
        aiProvider.SelectedIndex = 0;
        qwenEndpoint.Enabled = false;
        tooltip.SetToolTip(qwenEndpoint, Ui("使用阿里云百炼控制台的 OpenAI 兼容接口地址。留空使用中国内地旧版地址。", "Use the OpenAI-compatible endpoint from the Model Studio console. Leave blank for the default mainland China endpoint."));
        aiProvider.SelectedIndexChanged += delegate {
            secret.Clear();
            aiModel.Clear();
            qwenEndpoint.Enabled = aiProvider.Text == "Qwen";
        };

        BuildF1ASettings(templates, browse);
        latestDiagnosticsFile = TaskDiagnostics.Latest(diagnosticsFolder);
        exportDiagnostics.Enabled = latestDiagnosticsFile != null;
        tooltip.SetToolTip(exportDiagnostics, Ui("将最近一次任务的诊断保存为本地文件。", "Save diagnostics from the latest run as a local file."));
        exportDiagnostics.Click += delegate { ExportDiagnostics(); };
        open.Click += delegate { OpenReportFolder(); };
        run.Click += async delegate { await StartReport(); };
        refreshReportHeader();
        RefreshF1AValidation();

        FormClosing += delegate(object sender, FormClosingEventArgs args) {
            if (running) {
                args.Cancel = true;
                HideToTray();
            }
        };
        AcceptButton = run;
#if DISTRIBUTION
        InitializeLicensing();
#endif
    }

    private static string ImportTemplate(string path, string library)
    {
        if (!String.Equals(Path.GetExtension(path), ".md", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException(Ui("请选择 .md 文件。", "Choose a Markdown (.md) file."));
        string markdown = File.ReadAllText(path, new UTF8Encoding(false, true)).Trim();
        if (markdown.Length > 12000) throw new InvalidDataException(Ui("模板不能超过 12,000 个字符。", "A template must be 12,000 characters or fewer."));
        foreach (string section in new[] { "总结", "总表", "日期" }) {
            if (!System.Text.RegularExpressions.Regex.IsMatch(markdown, @"^#{1,6}[ \t]+" + section + @"[ \t]*\r?$",
                System.Text.RegularExpressions.RegexOptions.Multiline))
                throw new InvalidDataException(Ui("模板须包含「总结」「总表」「日期」三个标题。", "The template must include the headings 总结, 总表, and 日期."));
        }
        Directory.CreateDirectory(library);
        string stem = Path.GetFileNameWithoutExtension(path);
        for (int index = 1; ; index++) {
            string name = index == 1 ? stem : stem + " (" + index + ")";
            if (name == "使用内置模板" || name == "Use built-in template") continue;
            string target = Path.Combine(library, name + ".md");
            if (File.Exists(target)) {
                if (File.ReadAllText(target).Trim() == markdown) return name;
                continue;
            }
            using (var file = new FileStream(target, FileMode.CreateNew, FileAccess.Write))
            using (var writer = new StreamWriter(file, new UTF8Encoding(false))) writer.Write(markdown);
            return name;
        }
    }

    private sealed class ReportMetadata
    {
        public string[] keywords { get; set; }
        public string start { get; set; }
        public string error { get; set; }
    }

    private async Task ImportPreviousReport(Action refresh)
    {
        if (running || importingReport) return;
        string path = continuationReport.Length == 0 ? latestContinuationReport : null;
        bool automatic = File.Exists(path);
        if (!automatic) using (var picker = new OpenFileDialog { Title = Ui("导入上次监控报告", "Import the previous monitoring report"),
            Filter = Ui("Excel 工作簿|*.xlsx", "Excel workbook|*.xlsx"), CheckFileExists = true }) {
            picker.InitialDirectory = Path.Combine(home, "reports");
            picker.FileName = Path.GetFileName(continuationReport);
            if (picker.ShowDialog(this) != DialogResult.OK) return;
            path = picker.FileName;
        }
        importingReport = true;
        importReport.Enabled = false;
        run.Enabled = false;
        refresh();
        try {
            ReportMetadata metadata = await ReadPreviousReport(path);
            if (IsDisposed) return;
            ApplyPreviousReport(path, metadata);
        } catch (Exception error) {
            if (automatic) latestContinuationReport = null;
            if (!IsDisposed) MessageBox.Show(this, error.Message, Ui("无法导入上次报告", "Could not import the previous report"));
        } finally {
            importingReport = false;
            if (!IsDisposed) {
                importReport.Enabled = true;
#if DISTRIBUTION
                run.Enabled = licenseAllowed;
#else
                run.Enabled = true;
#endif
                refresh();
            }
        }
    }

    private Task<ReportMetadata> ReadPreviousReport(string path)
    {
        return Task.Run(async delegate {
            using (var worker = StartWorker(inspectReport: path)) {
                worker.StandardInput.Close();
                var read = Task.WhenAll(worker.StandardOutput.ReadToEndAsync(), worker.StandardError.ReadToEndAsync());
                if (await Task.WhenAny(read, Task.Delay(30000)) != read) {
                    StopIdleWorker(worker);
                    throw new TimeoutException(Ui("读取报告超时。", "Reading the report timed out."));
                }
                string result = (await read)[0];
                var metadata = String.IsNullOrWhiteSpace(result) ? null : new JavaScriptSerializer().Deserialize<ReportMetadata>(result);
                if (metadata == null || !String.IsNullOrEmpty(metadata.error)) throw new InvalidDataException(metadata == null
                    ? Ui("无法读取这份报告。", "Could not read this report.") : metadata.error);
                return metadata;
            }
        });
    }

    private void ApplyPreviousReport(string path, ReportMetadata metadata)
    {
        continuationReport = path;
        keyword.Text = String.Join(" ", metadata.keywords ?? new string[0]);
        DateTime today = DateTime.UtcNow.AddHours(8).Date;
        DateTime suggested;
        bool hasStart = DateTime.TryParseExact(metadata.start, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out suggested)
            && suggested >= DateTimePicker.MinimumDateTime && suggested <= today;
        start.SetDate(hasStart ? suggested : today);
        end.SetDate(today);
        status.Text = String.IsNullOrWhiteSpace(keyword.Text)
            ? Ui("报告已导入，请补填关键词。", "Report imported. Enter the keywords.") :
            !hasStart ? Ui("报告已导入，请确认搜索日期。", "Report imported. Check the search dates.") :
            Ui("报告已导入，可增删关键词。", "Report imported. Add or remove keywords.");
        keyword.Focus();
        keyword.SelectionStart = keyword.TextLength;
    }

    private async Task StartReport()
    {
        if (running || importingReport) return;
#if DISTRIBUTION
        if (!licenseAllowed) return;
#endif
        DateTime from, to;
        if (string.IsNullOrWhiteSpace(keyword.Text) || !start.TryRead(out from) || !end.TryRead(out to) || from > to) {
            MessageBox.Show(this, Ui("请输入关键词，并确认开始日期不晚于结束日期。", "Enter keywords and make sure the start date is on or before the end date."), Text);
            if (string.IsNullOrWhiteSpace(keyword.Text)) keyword.Focus();
            return;
        }
        object screenCount = ParseScreenCount();
        if (screenCount == null) {
            MessageBox.Show(this, Ui("划屏数量请输入正整数，例如 3，或选择「下拉到底」。", "Enter a positive screen count, or choose Scroll to bottom."), Text);
            return;
        }
        running = true;
        ResetF1AProgress();
        activityTimer.Start();
#if DISTRIBUTION
        BeginDiagnostic();
#endif
        cancelRequested = false;
        run.Enabled = false;


        log.Clear();
        report = null;
        SetLiveProgress(Ui("正在启动浏览器…", "Starting the browser…"));
        ShowCompactView();
        string key = secret.Text.Trim();
        secret.Clear();
        exportDiagnostics.Enabled = false;
        latestDiagnosticsFile = null;
        TaskDiagnostics diagnostics = TaskDiagnostics.Begin(diagnosticsFolder, Application.ProductVersion);
        int? workerExitCode = null;
        string diagnosticOutcome = "failed", diagnosticError = null;
        try {
            using (var worker = await AcquireWorker(diagnostics)) {
                if (cancelRequested) {
                    StopIdleWorker(worker);
                    diagnosticOutcome = "stopped";
                    status.Text = Ui("任务已停止", "Task stopped");
                    return;
                }
                activeWorker = worker;
                if (diagnostics != null) diagnostics.DesktopEvent("worker_started");
                Send(worker, keyword.Text.Trim(), from, to, reportTemplate, order.SelectedIndex == 0 ? "最新" : "综合", key: key);
                if (diagnostics != null) diagnostics.DesktopEvent("worker_request_sent");
                Task errors = Task.Run(async delegate {
                    string line;
                    while ((line = await worker.StandardError.ReadLineAsync()) != null)
                        if (!line.StartsWith("MONO_WASM:") && !line.StartsWith(TaskDiagnostics.WorkerPrefix, StringComparison.Ordinal)) PostLog(line);
                });
                string message, lastProgress = null, analysisWarning = null;
                while ((message = await worker.StandardOutput.ReadLineAsync()) != null) {
                    if (message.StartsWith(TaskDiagnostics.WorkerPrefix, StringComparison.Ordinal)) {
                        if (diagnostics != null) diagnostics.WorkerEvent(message.Substring(TaskDiagnostics.WorkerPrefix.Length));
                        ObserveF1ACount(message.Substring(TaskDiagnostics.WorkerPrefix.Length));
                    } else if (message.StartsWith("UI_ASK ")) {
                        if (cancelRequested) continue;
                        string answer = PromptUser(json.Deserialize<string>(message.Substring(7)));
                        if (cancelRequested) continue;
                        worker.StandardInput.WriteLine(AsciiJson(answer));
                        worker.StandardInput.Flush();
                    } else if (message.StartsWith("UI_ANALYSIS_WARNING ")) {
                        analysisWarning = message.Substring("UI_ANALYSIS_WARNING ".Length);
                        AppendLog(analysisWarning);
                        f1aAnalysisWarning = analysisWarning;
                    } else if (message.StartsWith("UI_PROGRESS ")) {
                        string batchProgress = message.Substring("UI_PROGRESS ".Length);
                        lastProgress = batchProgress;
                        ObserveF1ATerm(batchProgress, false);
                        SetLiveProgress(batchProgress);
                        AppendLog(batchProgress);
                        // The final batch notification replaces the last item notification.
                        string[] counts = batchProgress.Split(new[] { '/', ' ' }, StringSplitOptions.RemoveEmptyEntries);
                        if (counts.Length >= 2 && counts[0] != counts[1])
                            Notify(Ui("关键词监控进度", "Keyword progress"), batchProgress, ToolTipIcon.Info);
                    } else if (!message.StartsWith("Inspect result written")) {
                        string prefix = Ui("已生成 Excel：", "Excel report: ");
                        if (message.StartsWith(prefix)) report = message.Substring(prefix.Length);
                        AppendLog(message);
                        ObserveF1ATerm(message, true);
                        if (message.StartsWith(Ui("扫描「", "Scanning ")) || message.StartsWith(Ui("读笔记 ", "Reading notes ")) ||
                            message.StartsWith(Ui("开始关键词 ", "Starting keyword ")) || message.StartsWith(Ui("正在生成 Excel", "Generating Excel")) ||
                            message.StartsWith(Ui("分析 ", "Analyzing ")) || message.StartsWith(Ui("正在打开", "Opening ")))
                            SetLiveProgress(message);
                    }
                }
                await errors;
                await Task.Run((Action)worker.WaitForExit);
                workerExitCode = worker.ExitCode;
                bool reportExists = File.Exists(report);
                bool succeeded = workerExitCode == 0 && reportExists;
                diagnosticOutcome = succeeded ? "completed" : cancelRequested ? "stopped" : reportExists ? "partial" : "failed";
#if DISTRIBUTION
                EndDiagnostic(succeeded ? "completed" : cancelRequested ? "stopped" : "failed");
#endif
                status.Text = succeeded ? Ui("已导出 · ", "Exported · ") + (analysisWarning ?? lastProgress) : cancelRequested ? Ui("任务已停止", "Task stopped") :
                    reportExists ? Ui("部分关键词失败 · 已导出报告", "Report exported with some keyword failures") : Ui("运行结束，请查看日志", "Run ended. Check the log.");
                if (!exitRequested) {
                    Notify(succeeded ? (analysisWarning == null ? Ui("舆情报告已生成", "Report ready") : Ui("已导出 · AI 分析未完整", "Exported with partial AI analysis")) : cancelRequested ? Ui("监控任务已停止", "Monitoring stopped") : Ui("监控任务未完成", "Monitoring did not finish"),
                        succeeded ? (analysisWarning ?? lastProgress ?? Ui("点击通知返回程序，或从托盘打开报告目录。", "Click to open the app, or open reports from the system tray.")) : Ui("点击通知查看执行日志。", "Click to see the task log."),
                        (succeeded && analysisWarning == null) || cancelRequested ? ToolTipIcon.Info : ToolTipIcon.Warning);
                }
            }
        } catch (Exception ex) {
            diagnosticOutcome = cancelRequested ? "stopped" : "failed";
            diagnosticError = ex is FileNotFoundException ? "file_missing" : ex is IOException ? "io_error" : "desktop_error";
#if DISTRIBUTION
            EndDiagnostic(cancelRequested ? "stopped" : "failed");
#endif
            AppendLog(ex.Message);
            status.Text = Ui("启动或运行失败", "The task could not start or finish");
            if (!exitRequested) Notify(Ui("监控任务未完成", "Monitoring did not finish"), Ui("点击通知查看执行日志。", "Click to see the task log."), ToolTipIcon.Warning);
        } finally {
            if (diagnostics != null) {
                diagnostics.Finish(diagnosticOutcome, workerExitCode, diagnosticError);
                latestDiagnosticsFile = diagnostics.FilePath;
                exportDiagnostics.Enabled = File.Exists(latestDiagnosticsFile);
            }
            activeWorker = null;
            running = false;
            activityTimer.Stop();
            UpdateActivity();
            run.Enabled = true;
#if DISTRIBUTION
            run.Enabled = licenseAllowed;
#endif

            if (File.Exists(report)) {
                latestContinuationReport = report;
                if (continuationReport.Length != 0) continuationReport = report;
                refreshReportHeader();
            }
            RestoreSetupView();
            if (!exitRequested) RenderF1AResult(diagnosticOutcome);
            if (exitRequested) Close();
            else PrepareBrowserWorker();
        }
    }

    private void PrepareBrowserWorker()
    {
        if (preparedWorker != null || running || IsDisposed) return;
        preparedWorker = Task.Run(() => {
            try { return StartWorker(warmBrowser: true); }
            catch (IOException) { return null; }
            catch (UnauthorizedAccessException) { return null; }
            catch (InvalidOperationException) { return null; }
            catch (System.ComponentModel.Win32Exception) { return null; }
        });
    }

    private async Task<Process> AcquireWorker(TaskDiagnostics diagnostics)
    {
        var pending = preparedWorker;
        preparedWorker = null;
        if (pending != null) {
            var worker = await pending;
            if (worker != null && !worker.HasExited) {
                if (diagnostics != null) diagnostics.DesktopEvent("worker_prestarted");
                return worker;
            }
            if (worker != null) worker.Dispose();
        }
        return await Task.Run(() => StartWorker(diagnostics: diagnostics));
    }

    private void ReleasePreparedWorker()
    {
        var pending = preparedWorker;
        preparedWorker = null;
        if (pending != null) {
            pending.ContinueWith(task => {
                using (var worker = task.Result) StopIdleWorker(worker);
            },
                System.Threading.CancellationToken.None, TaskContinuationOptions.OnlyOnRanToCompletion,
                TaskScheduler.Default);
        }
    }

    private static void StopIdleWorker(Process worker)
    {
        if (worker == null) return;
        try {
            worker.StandardInput.Close();
            if (!worker.WaitForExit(150)) worker.Kill();
        } catch (IOException) { }
        catch (InvalidOperationException) { }
        catch (System.ComponentModel.Win32Exception) { }
    }

    [DllImport("shlwapi.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int AssocQueryStringW(uint flags, uint kind, string association, string extra,
        StringBuilder value, ref uint capacity);

    private static string DefaultBrowserExecutable()
    {
        const uint protocolAssociation = 0x00001000;
        const uint executableString = 2;
        foreach (string protocol in new[] { "https", "http" }) {
            uint capacity = 0;
            if (AssocQueryStringW(protocolAssociation, executableString, protocol, null, null, ref capacity) != 1 ||
                capacity == 0 || capacity > 32768) continue;
            var value = new StringBuilder((int)capacity);
            if (AssocQueryStringW(protocolAssociation, executableString, protocol, null, value, ref capacity) != 0) continue;
            string path = value.ToString();
            if (Path.IsPathRooted(path) && Path.GetExtension(path).Equals(".exe", StringComparison.OrdinalIgnoreCase)) return path;
        }
        return null;
    }

    private Process StartWorker(bool warmBrowser = false, TaskDiagnostics diagnostics = null, string inspectReport = null)
    {
        var preparation = Stopwatch.StartNew();
        string runtime = FindRuntime();
        var execution = new ProcessStartInfo(runtime) {
            WorkingDirectory = home, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        };
        execution.EnvironmentVariables["XHS_MONITOR_HOME"] = home;
        execution.EnvironmentVariables["XHS_UI_LANG"] = English ? "en" : "zh-CN";
        execution.EnvironmentVariables["XHS_TASK_DIAGNOSTICS"] = "1";
        execution.EnvironmentVariables.Remove("XHS_DEFAULT_BROWSER_EXE");
        execution.EnvironmentVariables.Remove("XHS_AI_KEY");
        execution.EnvironmentVariables.Remove("OPENAI_API_KEY");
        string workerPath = Path.Combine(home, "runtime", "monitor.mjs");
        bool temporary = false;
        try {
            using (var resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("monitor.mjs"))
            using (var buffer = new MemoryStream()) {
                resource.CopyTo(buffer);
                byte[] embedded = buffer.ToArray();
                if (!WorkerFileMatches(workerPath, embedded)) {
                    workerPath = Path.Combine(Path.GetTempPath(), "xhs-monitor-" + Guid.NewGuid().ToString("N") + ".mjs");
                    temporary = true;
                    File.WriteAllBytes(workerPath, embedded);
                }
            }
            if (diagnostics != null) diagnostics.DesktopEvent(temporary ? "worker_prepared_temp" : "worker_prepared_installed", preparation.ElapsedMilliseconds);
            execution.Arguments = "\"" + workerPath + "\"" + (inspectReport != null
                ? " --inspect-report \"" + inspectReport + "\"" : " --desktop" + (warmBrowser ? " --warm-browser-driver" : ""));
            var worker = new Process { StartInfo = execution, EnableRaisingEvents = true };
            if (temporary) worker.Exited += delegate { TryDelete(workerPath); };
            if (!worker.Start()) throw new InvalidOperationException(Ui("未能启动采集程序。", "Could not start the collection process."));
            return worker;
        } catch {
            if (temporary) TryDelete(workerPath);
            throw;
        }
    }

    private static bool WorkerFileMatches(string path, byte[] embedded)
    {
        try {
            var file = new FileInfo(path);
            return file.Exists && file.Length == embedded.Length && File.ReadAllBytes(path).SequenceEqual(embedded);
        } catch (IOException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
    }

    private void Send(Process worker, string term, DateTime from, DateTime to, string template, string sort, string source = "", string key = "")
    {
        var bounds = browserBounds.IsEmpty ? null : new { left = browserBounds.Left, top = browserBounds.Top,
            width = browserBounds.Width, height = browserBounds.Height };
        var request = new { keyword = term, start = DateText(from), end = DateText(to), source, template, sort = sort,
            continueReport = continuationReport,
            screens = ParseScreenCount(), browserBounds = bounds, provider = aiProvider.Text,
            model = aiModel.Text.Trim(), endpoint = qwenEndpoint.Enabled ? qwenEndpoint.Text.Trim() : "",
            apiKey = key, defaultBrowserExecutable = DefaultBrowserExecutable() ?? "", startInBackground = !Visible };
        // ASCII-only JSON keeps the initial message independent of the Windows input code page.
        worker.StandardInput.WriteLine(AsciiJson(request));
        worker.StandardInput.Flush();
    }

    private string PromptUser(string message)
    {
        bool signIn = message.StartsWith("小红书需要登录或完成网页验证", StringComparison.Ordinal) ||
            message.StartsWith("Xiaohongshu requires sign-in or verification.", StringComparison.Ordinal);
        RestoreWindow();
        SetLiveProgress(signIn ? Ui("等待小红书登录", "Waiting for Xiaohongshu sign-in") :
            Ui("等待网页操作", "Waiting for browser input"));
        AppendLog(message);
        string title = signIn ? Ui("登录小红书", "Sign in to Xiaohongshu") : Ui("继续网页操作", "Continue in the browser");
        bool browserChoice = message.StartsWith("后台采集需要打开浏览器") || message.StartsWith("Background collection needs a browser window");
        string accept = browserChoice ? Ui("打开浏览器", "Open browser") : Ui("继续", "Continue");
        string dismiss = signIn ? Ui("结束任务", "End task") : browserChoice ? Ui("结束", "End") : null;
        using (var dialog = F1ADialog(title, message, accept, dismiss, false)) {
            DialogResult result = ShowPrompt(dialog);
            if (signIn && result != DialogResult.OK) {
                if (!cancelRequested) StopWorker(false);
                return "";
            }
            SetLiveProgress(Ui("正在继续监控…", "Resuming monitoring…"));
            return (browserChoice || signIn) && result == DialogResult.OK ? "继续" : "";
        }
    }

    private DialogResult ShowPrompt(Form dialog)
    {
        pendingPrompt = dialog;
        UpdateActivity();
        try {
            if (!Visible) return dialog.ShowDialog(this);
            using (var shade = new F1AShade(RectangleToScreen(ClientRectangle))) {
                shade.Show(this);
                try { return dialog.ShowDialog(shade); }
                finally { shade.Close(); }
            }
        } finally {
            pendingPrompt = null;
            UpdateActivity();
        }
    }

    private void ConfirmStop(bool exit)
    {
        if (!running) {
            if (exit) Close();
            return;
        }
        if (cancelRequested) {
            if (exit) exitRequested = true;
            return;
        }
        string message = exit ? Ui("任务仍在运行。停止任务并退出程序？", "Stop the running task and quit?") : Ui("停止当前任务？", "Stop the current task?");
        using (var dialog = F1ADialog(message, "", Ui("停止任务", "Stop task"), Ui("继续运行", "Keep running"), true)) {
            if (ShowPrompt(dialog) != DialogResult.OK) return;
        }
        StopWorker(exit);
    }

    private void StopWorker(bool exit)
    {
        cancelRequested = true;
        UpdateActivity();
        exitRequested = exit;
        status.Text = Ui("正在停止任务…", "Stopping the task…");
        try {
            if (activeWorker != null && !activeWorker.HasExited) {
                activeWorker.StandardInput.WriteLine("UI_CANCEL");
                activeWorker.StandardInput.Flush();
            }
        } catch (IOException) {
            // A worker that has already closed its input is finishing.
        } catch (InvalidOperationException) {
            // The worker exited while the confirmation was open.
        }
        if (pendingPrompt != null) pendingPrompt.Close();
    }

    private string LatestReport()
    {
        string folder = Path.Combine(home, "reports");
        try {
            if (File.Exists(report)) return report;
            if (!Directory.Exists(folder)) return null;
            return new DirectoryInfo(folder).EnumerateFiles("舆情_*.xlsx")
                .OrderByDescending(file => file.LastWriteTimeUtc).Select(file => file.FullName).FirstOrDefault();
        } catch (IOException) { return null; }
        catch (UnauthorizedAccessException) { return null; }
    }

    private void HideToTray()
    {
        if (running) SendWindowCommand("UI_BACKGROUND");
        tray.Visible = true;
        Hide();
        UpdateActivity();
    }

    private void RestoreWindow()
    {
        if (running) SendWindowCommand("UI_FOREGROUND");
        Show();
        WindowState = FormWindowState.Normal;
        Activate();
        UpdateActivity();
    }

    private object ParseScreenCount()
    {
        string value = screens.Text.Trim();
        if (value == Ui("下拉到底", "Scroll to bottom")) return "bottom";
        int count;
        value = System.Text.RegularExpressions.Regex.Replace(value, @"\s*(屏|screens?)$", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        return Int32.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out count) && count > 0 ? (object)count : null;
    }

    private void SendWindowCommand(string command)
    {
        try {
            if (activeWorker == null || activeWorker.HasExited) return;
            activeWorker.StandardInput.WriteLine(command);
            activeWorker.StandardInput.Flush();
        } catch (IOException) { }
        catch (InvalidOperationException) { }
    }

    private void ShowCompactView()
    {
        setupBounds = Bounds;
        setupMinimum = MinimumSize;
        Rectangle area = Screen.FromControl(this).WorkingArea;
        int width = Math.Min(440, Math.Max(320, area.Width / 3));
        browserBounds = new Rectangle(area.Left, area.Top, Math.Max(320, area.Width - width - 8), area.Height);
        WindowState = FormWindowState.Normal;
        MinimumSize = new Size(290, 180);
        ShowF1APage(f1aRunPage, 1);
        Bounds = new Rectangle(area.Right - width, area.Top, width, Math.Min(285, area.Height));
        setupView.Visible = false;
        compactView.Visible = true;
        compactView.BringToFront();
        UpdateActivity();
    }

    private void RestoreSetupView()
    {
        compactView.Visible = false;
        setupView.Visible = true;
        MinimumSize = setupMinimum;
        if (!setupBounds.IsEmpty) Bounds = setupBounds;
        tray.Text = Ui("小红书舆情监控", "Xiaohongshu Monitor");
    }

    private void SetLiveProgress(string message)
    {
        status.Text = message;
        if (f1aRunMessage != null) f1aRunMessage.Text = message;
        compactProgress.Text = message;
        tray.Text = message.Length > 62 ? message.Substring(0, 62) + "…" : message;
    }

    private void Notify(string title, string message, ToolTipIcon icon)
    {
        tray.Visible = true;
        tray.ShowBalloonTip(5000, title, message, icon);
    }

    private void OpenReportFolder()
    {
        try {
            string folder = Path.Combine(home, "reports");
            Directory.CreateDirectory(folder);
            Process.Start(new ProcessStartInfo(folder) { UseShellExecute = true });
        } catch (Exception error) {
            MessageBox.Show(this, error.Message, Ui("无法打开报告目录", "Could not open the reports folder"));
        }
    }

    private void ExportDiagnostics()
    {
        string source = latestDiagnosticsFile;
        if (!File.Exists(source)) {
            exportDiagnostics.Enabled = false;
            return;
        }
        using (var dialog = new SaveFileDialog {
            Title = Ui("导出诊断日志", "Export diagnostics"),
            Filter = Ui("诊断日志 (*.jsonl)|*.jsonl", "Diagnostic log (*.jsonl)|*.jsonl"),
            DefaultExt = "jsonl", AddExtension = true, FileName = Path.GetFileName(source)
        }) {
            if (dialog.ShowDialog(this) != DialogResult.OK) return;
            try {
                if (!String.Equals(source, dialog.FileName, StringComparison.OrdinalIgnoreCase))
                    File.Copy(source, dialog.FileName, true);
            } catch (IOException) { ShowDiagnosticsExportError(); }
            catch (UnauthorizedAccessException) { ShowDiagnosticsExportError(); }
        }
    }

    private void ShowDiagnosticsExportError()
    {
        MessageBox.Show(this, Ui("无法保存诊断日志，请选择可写入的文件夹。", "The diagnostics could not be saved. Choose a writable folder."),
            Ui("导出诊断日志", "Export diagnostics"), MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }

    private sealed class TaskDiagnostics
    {
        public const string WorkerPrefix = "UI_DIAG ";
        private const int MaxRecordSize = 2048;
        private const int MaxFileSize = 256 * 1024;
        private const int FileLimit = 15;
        private static readonly Regex Filename = new Regex(@"\Arun-[0-9]{8}T[0-9]{13}Z-[a-f0-9]{32}\.jsonl\z");
        private static readonly Regex FieldName = new Regex(@"\A[a-z][A-Za-z0-9]{0,34}\z");
        private static readonly Regex Code = new Regex(@"\A[a-z][a-z0-9_]{0,34}\z");
        private static readonly Regex DateValue = new Regex(@"\A[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z)?\z");
        private static readonly HashSet<string> SensitiveFields = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
            "apiKey", "authorization", "body", "content", "cookie", "deviceId", "ip", "keyword", "message", "path", "profile", "title", "url"
        };
        private static readonly Encoding Utf8 = new UTF8Encoding(false);
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 2 * MaxRecordSize, RecursionLimit = 3 };
        private readonly StreamWriter writer;
        private int writtenBytes;
        private bool writeFailed, truncated;

        private TaskDiagnostics(string path)
        {
            FilePath = path;
            writer = new StreamWriter(new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read), Utf8) {
                NewLine = "\n", AutoFlush = true
            };
        }

        public string FilePath { get; private set; }

        public static TaskDiagnostics Begin(string folder, string version)
        {
            TaskDiagnostics diagnostic;
            string id = Guid.NewGuid().ToString("N");
            string suffix = DateTime.UtcNow.ToString("yyyyMMdd'T'HHmmssfffffff'Z'", CultureInfo.InvariantCulture) + "-" + id;
            try {
                Directory.CreateDirectory(folder);
                diagnostic = new TaskDiagnostics(Path.Combine(folder, "run-" + suffix + ".jsonl"));
            } catch (IOException) { return null; }
            catch (UnauthorizedAccessException) { return null; }

            diagnostic.Append(new { timestamp = Now(), emitter = "desktop", @event = "run_started", schemaVersion = 1,
                runId = id, appVersion = version, architecture = Environment.Is64BitProcess ? "x64" : "x86",
                locale = CultureInfo.CurrentUICulture.Name }, MaxFileSize);
            try {
                foreach (FileInfo old in Files(folder).Skip(FileLimit)) TryDelete(old.FullName);
            } catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            return diagnostic;
        }

        public static string Latest(string folder)
        {
            try {
                FileInfo latest = Files(folder).FirstOrDefault(file => file.Length > 0);
                return latest == null ? null : latest.FullName;
            }
            catch (IOException) { return null; }
            catch (UnauthorizedAccessException) { return null; }
        }

        private static IEnumerable<FileInfo> Files(string folder)
        {
            return new DirectoryInfo(folder).EnumerateFiles("run-*.jsonl")
                .Where(file => Filename.IsMatch(file.Name) && (file.Attributes & FileAttributes.ReparsePoint) == 0)
                .OrderByDescending(file => file.Name, StringComparer.Ordinal);
        }

        public void DesktopEvent(string eventCode, long? elapsedMs = null)
        {
            Append(new { timestamp = Now(), emitter = "desktop", @event = eventCode, elapsedMs }, MaxFileSize - MaxRecordSize);
        }

        public void WorkerEvent(string line)
        {
            if (truncated || writeFailed || line.Length > MaxRecordSize) return;
            Dictionary<string, object> record;
            try { record = json.Deserialize<Dictionary<string, object>>(line); }
            catch (ArgumentException) { return; }
            catch (InvalidOperationException) { return; }
            catch (FormatException) { return; }

            object code, date;
            if (record == null || !record.TryGetValue("event", out code) || !(code is string) || !Code.IsMatch((string)code) ||
                !record.TryGetValue("timestamp", out date) || !(date is string) || !DateValue.IsMatch((string)date) ||
                record.Any(field => !FieldName.IsMatch(field.Key) || SensitiveFields.Contains(field.Key) || !IsSafeValue(field.Value))) return;
            record["emitter"] = "worker";
            if (!Append(record, MaxFileSize - 2 * MaxRecordSize) && !writeFailed) {
                truncated = true;
                DesktopEvent("trace_truncated");
            }
        }

        private static bool IsSafeValue(object value)
        {
            var text = value as string;
            return value == null || value is int || value is long || value is bool ||
                (text != null && (Code.IsMatch(text) || DateValue.IsMatch(text)));
        }

        public void Finish(string outcome, int? exitCode, string errorCategory)
        {
            Append(new { timestamp = Now(), emitter = "desktop", @event = "run_ended", outcome, exitCode, errorCategory }, MaxFileSize);
            try { writer.Dispose(); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }

        private bool Append(object record, int limit)
        {
            if (writeFailed) return false;
            string line = json.Serialize(record);
            int size = Utf8.GetByteCount(line) + 1;
            if (size > limit - writtenBytes) return false;
            try {
                writer.WriteLine(line);
                writtenBytes += size;
                return true;
            } catch (IOException) { writeFailed = true; }
            catch (UnauthorizedAccessException) { writeFailed = true; }
            return false;
        }

        private static string Now() { return DateTimeOffset.Now.ToString("o", CultureInfo.InvariantCulture); }
    }

    private int Verify(string path)
    {
        int layout = VerifyLayout();
        if (layout != 0) return layout;
        using (var worker = StartWorker()) {
            var day = new DateTime(2026, 11, 21);
            Send(worker, "之禾 咖啡", day, day, Path.Combine(home, "报告生成模板.md"), "最新", path);
            var errors = worker.StandardError.ReadToEndAsync();
            string result = worker.StandardOutput.ReadToEnd();
            worker.WaitForExit();
            string prefix = Ui("已生成 Excel：", "Excel report: ");
            string[] outputs = result.Split('\n').Where(line => line.StartsWith(prefix)).ToArray();
            bool firstRun = worker.ExitCode == 0 && outputs.Length == 1 &&
                outputs.All(line => File.Exists(line.Substring(prefix.Length).Trim())) &&
                result.Contains("UI_PROGRESS 1/2") && result.Contains("UI_PROGRESS 2/2");
            if (!firstRun) return 1;
            try {
                string previous = LatestReport();
                if (previous != outputs[0].Substring(prefix.Length).Trim()) return 11;
                var metadata = ReadPreviousReport(previous).GetAwaiter().GetResult();
                ApplyPreviousReport(previous, metadata);
                refreshReportHeader();
                if (keyword.Text != "之禾 咖啡" || run.Text != Ui("开始续查", "Run follow-up")) return 12;
                DateTime date;
                DateTime today = DateTime.UtcNow.AddHours(8).Date;
                return start.TryRead(out date) && date == (day <= today ? day : today) ? 0 : 13;
            } catch (Exception) { return 14; }
        }
    }

    private int VerifyLayout()
    {
        if (Text != Ui("小红书舆情监控", "Xiaohongshu Monitor") ||
            run.Text != Ui("开始监控", "Start monitoring") ||
            !importReport.Text.StartsWith(Ui("继续监控", "Continue monitoring"), StringComparison.Ordinal) ||
            start.AccessibleName != Ui("开始日期", "Start date")) return 9;
        DateTime selected;
        if (!start.TryRead(out selected) || selected != DateTime.UtcNow.AddHours(8).Date) return 10;
        var initialSize = Size;
        ShowCompactView();
        if (Width >= initialSize.Width || browserBounds.Right > Left || Height > 285) return 7;
        RestoreSetupView();
        if (Size != initialSize) return 8;
        if (screens.Text != Ui("下拉到底", "Scroll to bottom")) return 2;
        screens.Text = "3";
        if (!Object.Equals(ParseScreenCount(), 3)) return 6;
        keyword.CreateControl();
        int originalHeight = keywordWell.Height;
        keyword.Text = String.Join(" ", Enumerable.Repeat("之禾羊绒衫", 170));
        if (keywordWell.Height <= originalHeight || keyword.ScrollBars != ScrollBars.Vertical) return 3;
        keyword.Clear();
        if (keywordWell.Height != originalHeight) return 4;
        return 0;
    }

    private string FindRuntime()
    {
        if (home.IndexOf("360zip$Temp", StringComparison.OrdinalIgnoreCase) >= 0)
            throw new IOException(Ui("程序正在 360 压缩的临时目录运行。请先将整个 ZIP 解压到普通文件夹，再打开解压后的 EXE。", "The app is running in a temporary archive folder. Extract the full package before opening the executable."));
        string runtime = Path.Combine(home, "runtime");
        string node = Path.Combine(runtime, "node.exe");
        if (File.Exists(node) && File.Exists(Path.Combine(runtime, "node_modules", "exceljs", "package.json")) &&
            File.Exists(Path.Combine(runtime, "node_modules", "playwright", "package.json"))) return node;
        throw new FileNotFoundException(Ui("运行组件缺失。请重新安装程序，或完整解压发行包并保留程序同级的 runtime 文件夹。", "Runtime components are missing. Reinstall the app or extract the full package with its runtime folder."));
    }

    private static void TryDelete(string path) { try { File.Delete(path); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
    private string AsciiJson(object value) { return string.Concat(json.Serialize(value).Select(c => c > 127 ? "\\u" + ((int)c).ToString("x4") : c.ToString())); }
    private void PostLog(string line) { if (!IsDisposed) BeginInvoke(new Action<string>(AppendLog), line); }
    private void AppendLog(string line) {
#if DISTRIBUTION
        ObserveDiagnosticStage(line);
#endif
        log.AppendText(line + Environment.NewLine);
    }
    private static string DateText(DateTime date) { return date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture); }
    private static Label Caption(string text, Color color) { return new Label { Text = text, ForeColor = color, AutoSize = true }; }
    private Font HeadingFont(float size) {
        if (Font.Name == "Noto Sans SC") {
            var medium = new Font("Noto Sans SC Medium", size);
            if (medium.Name == "Noto Sans SC Medium") return medium;
            medium.Dispose();
        }
        if (Font.Name == "Segoe UI") return new Font("Segoe UI Semibold", size);
        return new Font(Font.FontFamily, size, FontStyle.Regular);
    }
    private static Button MakeButton(string text, bool primary) {
        var button = new Button { Text = text, Width = 130, Height = 34, FlatStyle = FlatStyle.Flat,
            BackColor = primary ? Accent : FieldFill, ForeColor = primary ? Color.White : Ink };
        button.FlatAppearance.BorderSize = 0;
        button.FlatAppearance.BorderColor = FieldEdge;
        button.FlatAppearance.MouseOverBackColor = primary ? Color.FromArgb(226, 30, 64) : Color.FromArgb(246, 246, 246);
        button.FlatAppearance.MouseDownBackColor = primary ? Color.FromArgb(184, 17, 46) : FieldEdge;
        if (primary) button.EnabledChanged += delegate { button.BackColor = button.Enabled ? Accent : FieldFill; };
        Round(button, 9);
        return button;
    }
    private static TableLayoutPanel Card(int columns) {
        var card = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = columns, Padding = new Padding(16),
            BackColor = Color.White, Margin = Padding.Empty };
        Round(card, 17);
        return card;
    }
    private static GraphicsPath RoundedPath(RectangleF bounds, float radius) {
        var path = new GraphicsPath();
        float d = Math.Min(radius * 2, Math.Min(bounds.Width, bounds.Height));
        path.AddArc(bounds.Left, bounds.Top, d, d, 180, 90);
        path.AddArc(bounds.Right - d, bounds.Top, d, d, 270, 90);
        path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
        path.AddArc(bounds.Left, bounds.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
    private static void Round(Control control, int radius) {
        Action apply = delegate {
            int width = control.Width, height = control.Height;
            int diameter = Math.Min(radius * 2, Math.Min(width, height));
            if (diameter < 2) return;
            using (var path = RoundedPath(new RectangleF(0, 0, width, height), radius)) {
                var old = control.Region;
                control.Region = new Region(path);
                if (old != null) old.Dispose();
            }
        };
        control.Resize += delegate { apply(); };
        apply();
    }
    private class FieldWell : Panel
    {
        protected readonly TextBox Editor;
        private Label hint;
        private Color fill = FieldFill;
        private bool error;
        internal bool HasError {
            get { return error; }
            set { if (error != value) { error = value; Invalidate(); } }
        }
        internal event EventHandler ValueChanged {
            add { Editor.TextChanged += value; }
            remove { Editor.TextChanged -= value; }
        }

        internal FieldWell(TextBox editor)
        {
            Editor = editor;
            Height = editor.Multiline ? KeywordHeight : 42;
            BackColor = Surface;
            ForeColor = Ink;
            Cursor = Cursors.IBeam;
            Padding = new Padding(14, editor.Multiline ? 13 : 11, 14, 8);
            Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            Margin = new Padding(0, 2, 0, 0);
            DoubleBuffered = true;
            Editor.BorderStyle = BorderStyle.None;
            Editor.BackColor = fill;
            Editor.Dock = DockStyle.Fill;
            Controls.Add(Editor);
            Watch(Editor);
            Watch(this);
            VisibleChanged += delegate { RefreshAppearance(); };
            MouseDown += delegate(object sender, MouseEventArgs args) { FocusEditor(args.Location); };
        }

        protected void Watch(Control control)
        {
            control.MouseEnter += delegate { RefreshAppearance(); };
            control.MouseLeave += delegate { RefreshAppearance(); };
            control.GotFocus += delegate { RefreshAppearance(); };
            control.LostFocus += delegate { RefreshAppearance(); };
        }

        internal void SetHint(Label caption)
        {
            hint = caption;
            hint.Location = new Point(Padding.Left + 4, Padding.Top);
            hint.Cursor = Cursors.IBeam;
            hint.MouseDown += delegate(object sender, MouseEventArgs args) { FocusEditor(new Point(hint.Left + args.X, hint.Top + args.Y)); };
            Watch(hint);
            Controls.Add(hint);
            hint.BringToFront();
            RefreshAppearance();
        }

        private bool Hovered { get { return IsHandleCreated && ClientRectangle.Contains(PointToClient(System.Windows.Forms.Cursor.Position)); } }

        internal void RefreshAppearance()
        {
            fill = ContainsFocus || Hovered ? Color.White : BackColor == GroupFill ? GroupFill : FieldFill;
            if (Editor.BackColor != fill) Editor.BackColor = fill;
            if (hint != null) {
                hint.BackColor = fill;
                hint.Visible = Editor.TextLength == 0;
            }
            Invalidate();
        }

        private void FocusEditor(Point point)
        {
            Editor.Focus();
            if (Editor.TextLength == 0) return;
            int index = Editor.GetCharIndexFromPosition(new Point(Math.Max(0, point.X - Editor.Left), Math.Max(0, point.Y - Editor.Top)));
            Point position = Editor.GetPositionFromCharIndex(index);
            if (index == Editor.TextLength - 1 && point.X - Editor.Left > position.X + 7) index++;
            Editor.Select(index, 0);
        }

        protected override void OnPaint(PaintEventArgs args)
        {
            base.OnPaint(args);
            if (Width < 8 || Height < 8) return;
            args.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (var path = RoundedPath(new RectangleF(2, 2, Width - 5, Height - 5), 10))
            using (var brush = new SolidBrush(fill))
            using (var border = new Pen(error ? Accent : ContainsFocus ? FocusEdge : Hovered ? Muted : FieldEdge)) {
                if (ContainsFocus && !error) using (var halo = new Pen(Color.FromArgb(41, FocusEdge), 3)) args.Graphics.DrawPath(halo, path);
                args.Graphics.FillPath(brush, path);
                args.Graphics.DrawPath(border, path);
            }
        }
    }

    private sealed class DateField : FieldWell
    {
        internal DateField() : base(new TextBox { MaxLength = 10 })
        {
            Height = 37;
            BackColor = GroupFill;
            Padding = new Padding(14, 9, 43, 7);
            Editor.Text = DateText(DateTime.UtcNow.AddHours(8).Date);
            var calendarButton = new Button { Size = new Size(25, 25), FlatStyle = FlatStyle.Flat,
                Anchor = AnchorStyles.Top | AnchorStyles.Right, Cursor = Cursors.Hand, BackColor = Color.Transparent,
                AccessibleName = Ui("打开日历", "Open calendar") };
            calendarButton.FlatAppearance.BorderSize = 0;
            calendarButton.FlatAppearance.MouseOverBackColor = FieldFill;
            calendarButton.FlatAppearance.MouseDownBackColor = FieldEdge;
            calendarButton.Paint += delegate(object sender, PaintEventArgs args) {
                args.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                using (var pen = new Pen(Muted, 1.1f))
                using (var border = RoundedPath(new RectangleF(5, 7, 14, 12), 2)) {
                    args.Graphics.DrawPath(pen, border);
                    args.Graphics.DrawLine(pen, 5, 11, 19, 11);
                    args.Graphics.DrawLine(pen, 9, 5, 9, 9);
                    args.Graphics.DrawLine(pen, 15, 5, 15, 9);
                }
            };
            calendarButton.Click += delegate { OpenCalendar(); };
            Editor.KeyDown += delegate(object sender, KeyEventArgs args) {
                if (args.Alt && args.KeyCode == Keys.Down) { args.SuppressKeyPress = true; OpenCalendar(); }
            };
            Watch(calendarButton);
            Controls.Add(calendarButton);
            calendarButton.BringToFront();
            SizeChanged += delegate { calendarButton.Location = new Point(Width - 37, (Height - 25) / 2); };
            calendarButton.Location = new Point(Width - 37, (Height - 25) / 2);
        }

        internal bool TryRead(out DateTime value) {
            return DateTime.TryParseExact(Editor.Text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out value)
                && value >= DateTimePicker.MinimumDateTime && value <= DateTimePicker.MaximumDateTime;
        }

        internal void SetDate(DateTime value) { Editor.Text = DateText(value); }

        private void OpenCalendar()
        {
            var calendar = new MonthCalendar { MaxSelectionCount = 1 };
            DateTime value;
            if (TryRead(out value)) calendar.SetDate(value);
            var popup = new ToolStripDropDown { Padding = Padding.Empty };
            var container = new ToolStripControlHost(calendar) { Padding = Padding.Empty, Margin = Padding.Empty };
            popup.Items.Add(container);
            calendar.DateSelected += delegate(object sender, DateRangeEventArgs args) {
                Editor.Text = DateText(args.Start);
                popup.Close();
            };
            popup.Closed += delegate { popup.Dispose(); };
            popup.Show(this, new Point(0, Height));
        }
    }
}
