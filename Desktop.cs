using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal sealed partial class Desktop : Form
{
    private const int KeywordHeight = 44;
    private const int KeywordRowHeight = 85;
    private const int SettingsHeight = 227;
    private const int AdvancedCollapsedHeight = 63;
    private const int AdvancedExpandedHeight = 378;
    private static readonly Color Ink = Color.FromArgb(29, 43, 54);
    private static readonly Color Muted = Color.FromArgb(99, 114, 124);
    private static readonly Color Accent = Color.FromArgb(8, 100, 238);
    private static readonly Color Canvas = Color.FromArgb(245, 247, 251);
    private readonly TextBox keyword = new TextBox();
    private Panel keywordWell;
    private string reportTemplate = "";
    private readonly TextBox secret = new TextBox();
    private readonly ComboBox aiProvider = new ComboBox();
    private readonly TextBox aiModel = new TextBox();
    private readonly TextBox qwenEndpoint = new TextBox();
    private readonly TextBox log = new TextBox();
    private readonly DateTimePicker start = DateInput();
    private readonly DateTimePicker end = DateInput();
    private readonly ComboBox order = new ComboBox();
    private readonly ComboBox screens = new ComboBox();
    private readonly Label status = new Label();
    private readonly ProgressBar progress = new ProgressBar();
    private readonly Button run = MakeButton("开始监控 ›", true);
    private readonly Button open = MakeButton("打开报告目录", false);
    private readonly NotifyIcon tray = new NotifyIcon();
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private readonly string home = AppDomain.CurrentDomain.BaseDirectory;
    private string report;
    private bool running;
    private bool cancelRequested;
    private bool exitRequested;
    private Process activeWorker;
    private Form pendingPrompt;
    private Control setupView;
    private TableLayoutPanel compactView;
    private Label compactProgress;
    private Rectangle setupBounds, browserBounds;
    private Size setupMinimum;
    private Action showTaskDetails;

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using (var window = new Desktop())
        {
            if (args.Length == 2 && args[0] == "--verify")
                return window.Verify(args[1]);
            Application.Run(window);
            return 0;
        }
    }

    private Desktop()
    {
        Text = "小红书舆情监控";
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(1080, 750);
        MinimumSize = new Size(850, 640);
        AutoScaleMode = AutoScaleMode.Dpi;
        using (var installed = new System.Drawing.Text.InstalledFontCollection())
        {
            bool hasNoto = installed.Families.Any(family => family.Name == "Noto Sans SC");
            Font = new Font(hasNoto ? "Noto Sans SC" : "Microsoft YaHei UI", 10);
        }
        ForeColor = Ink;
        BackColor = Canvas;

        var shell = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(30), ColumnCount = 2, RowCount = 1 };
        shell.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 300));
        shell.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        Controls.Add(shell);
        setupView = shell;
        CreateCompactView();
        var sidebar = Card(1);
        sidebar.BackColor = Color.FromArgb(244, 236, 230);
        sidebar.Margin = new Padding(0, 0, 25, 0);
        sidebar.RowStyles.Add(new RowStyle(SizeType.Absolute, 286));
        sidebar.RowStyles.Add(new RowStyle(SizeType.Absolute, 51));
        sidebar.RowStyles.Add(new RowStyle(SizeType.Absolute, 57));
        sidebar.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        shell.Controls.Add(sidebar, 0, 0);
        using (var resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("cover.png"))
        using (var cover = Image.FromStream(resource))
        {
            var picture = new PictureBox { Image = new Bitmap(cover), SizeMode = PictureBoxSizeMode.Zoom, Dock = DockStyle.Fill, Margin = Padding.Empty };
            Round(picture, 13);
            sidebar.Controls.Add(picture, 0, 0);
            InitializeActivity(picture);
        }
        var sideTitle = Caption("小红书舆情监控", Ink);
        sideTitle.Font = HeadingFont(15);
        sideTitle.Anchor = AnchorStyles.Left;
        sidebar.Controls.Add(sideTitle, 0, 1);
        var sideNote = Caption("完成后通过 Windows 通知提醒。", Muted);
        sideNote.MaximumSize = new Size(230, 0);
        sidebar.Controls.Add(sideNote, 0, 2);
        var page = new TableLayoutPanel { Dock = DockStyle.Fill, AutoScroll = true, Margin = Padding.Empty, RowCount = 6, ColumnCount = 1 };
        page.RowStyles.Add(new RowStyle(SizeType.Absolute, 70));
        page.RowStyles.Add(new RowStyle(SizeType.Absolute, SettingsHeight));
        page.RowStyles.Add(new RowStyle(SizeType.Absolute, AdvancedCollapsedHeight));
        page.RowStyles.Add(new RowStyle(SizeType.Absolute, 72));
        page.RowStyles.Add(new RowStyle(SizeType.Absolute, 56));
        page.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        shell.Controls.Add(page, 1, 0);
        var header = new Panel { Dock = DockStyle.Fill, Margin = Padding.Empty };
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        tray.Icon = Icon ?? SystemIcons.Application;
        tray.Text = "小红书舆情监控";
        var trayMenu = new ContextMenuStrip();
        trayMenu.Items.Add("打开主窗口", null, delegate { RestoreWindow(); });
        var latest = trayMenu.Items.Add("打开最新报告", null, delegate {
            string path = LatestReport();
            if (path == null) return;
            try { Process.Start(new ProcessStartInfo(path) { UseShellExecute = true }); }
            catch (Exception error) { MessageBox.Show(error.Message, "无法打开报告"); }
        });
        trayMenu.Items.Add("打开报告目录", null, delegate { OpenReportFolder(); });
#if DISTRIBUTION
        trayMenu.Items.Add("重试联网授权", null, async delegate { RestoreWindow(); await RefreshLicense(); });
#endif
        trayMenu.Items.Add(new ToolStripSeparator());
        var stopTask = trayMenu.Items.Add("停止当前任务", null, delegate { ConfirmStop(false); });
        trayMenu.Items.Add("退出", null, delegate { ConfirmStop(true); });
        trayMenu.Opening += delegate {
            latest.Enabled = LatestReport() != null;
            stopTask.Enabled = running && !cancelRequested;
        };
        tray.ContextMenuStrip = trayMenu;
        tray.DoubleClick += delegate { RestoreWindow(); };
        tray.BalloonTipClicked += delegate { RestoreWindow(); };
        FormClosed += delegate { tray.Visible = false; tray.Dispose(); trayMenu.Dispose(); };
        Resize += delegate { if (WindowState == FormWindowState.Minimized) HideToTray(); };
        var title = Caption("新建监控任务", Ink);
        title.Font = HeadingFont(23);
        title.Location = new Point(20, 0);
        var subtitle = Caption("填写关键词，点击「开始监控」进入并排运行界面。", Muted);
        subtitle.Location = new Point(20, 42);
        header.Controls.AddRange(new Control[] { title, subtitle });
        page.Controls.Add(header, 0, 0);

        var settings = Card(2);
        settings.Padding = new Padding(20, 15, 20, 15);
        settings.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        settings.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        settings.Font = new Font(Font.FontFamily, 11.5f);
        settings.RowStyles.Add(new RowStyle(SizeType.Absolute, KeywordRowHeight));
        settings.RowStyles.Add(new RowStyle(SizeType.Absolute, 80));
        settings.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        page.Controls.Add(settings, 0, 1);

        keyword.AccessibleName = "关键词";
        keyword.Multiline = true;
        keyword.WordWrap = true;
        keyword.AcceptsReturn = true;
        keywordWell = (Panel)AddStack(settings, "关键词", keyword, 0, 0, 2);
        var keywordHint = Caption("多个关键词用空格分隔，例如：宝山 硚口", Muted);
        keywordHint.BackColor = keywordWell.BackColor;
        keywordHint.Location = new Point(12, 10);
        keywordWell.Controls.Add(keywordHint);
        keywordHint.BringToFront();
        keywordHint.Click += delegate { keyword.Focus(); };
        AddStack(settings, "开始日期", start, 0, 1, 1);
        AddStack(settings, "结束日期", end, 1, 1, 1);
        var keywordHelp = Caption("多个关键词用空格分隔。", Muted);
        keywordHelp.Anchor = AnchorStyles.Left;
        keywordHelp.Margin = Padding.Empty;
        settings.Controls.Add(keywordHelp, 0, 2);
        settings.SetColumnSpan(keywordHelp, 2);
        order.DropDownStyle = ComboBoxStyle.DropDownList;
        order.Items.AddRange(new object[] { "最新", "综合" });
        order.SelectedIndex = 0;
        screens.DropDownStyle = ComboBoxStyle.DropDown;
        screens.Items.AddRange(new object[] { "1 屏", "2 屏", "3 屏", "4 屏", "下拉到底" });
        screens.SelectedIndex = 4;
        screens.AccessibleName = "划屏数量";
        screens.BackColor = Color.FromArgb(238, 244, 255);
        screens.ForeColor = Accent;
        var advancedToggle = MakeButton("›   更多设置 · 最新排序 / 下拉到底（可输入屏数）", false);
        advancedToggle.Dock = DockStyle.Fill;
        advancedToggle.Margin = new Padding(0, 2, 0, 3);
        advancedToggle.TextAlign = ContentAlignment.MiddleLeft;
        var advancedCard = Card(1);
        advancedCard.Margin = new Padding(0, 10, 0, 0);
        advancedCard.Padding = new Padding(20, 5, 20, 10);
        advancedCard.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
        advancedCard.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        advancedCard.Controls.Add(advancedToggle, 0, 0);
        page.Controls.Add(advancedCard, 0, 2);
        var advanced = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2,
            RowCount = 4, Visible = false, Margin = Padding.Empty, Font = settings.Font };
        advanced.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        advanced.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        for (int row = 0; row < 3; row++) advanced.RowStyles.Add(new RowStyle(SizeType.Absolute, 77));
        advanced.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        advancedCard.Controls.Add(advanced, 0, 1);
        bool adjustingKeyword = false;
        Action layoutKeyword = delegate {
            if (adjustingKeyword) return;
            adjustingKeyword = true;
            try {
                keywordHint.Visible = keyword.TextLength == 0;
                int lines = keyword.TextLength == 0 ? 1 : keyword.GetLineFromCharIndex(keyword.TextLength - 1) + 1;
                if (keyword.Text.EndsWith("\n")) lines++;
                int extra = Math.Max(0, Math.Min(5, lines) - 1) * keyword.Font.Height;
                var scrollbars = lines > 5 ? ScrollBars.Vertical : ScrollBars.None;
                if (keyword.ScrollBars != scrollbars) keyword.ScrollBars = scrollbars;
                ResizeKeywordField(extra, keywordWell, settings, page);
            } finally { adjustingKeyword = false; }
        };
        keyword.TextChanged += delegate { layoutKeyword(); };
        keyword.SizeChanged += delegate { layoutKeyword(); };
        AddStack(advanced, "网页排序", order, 0, 0, 1);
        AddStack(advanced, "划屏数量（可输入数字）", screens, 1, 0, 1);
        Action refreshAdvanced = delegate {
            advancedToggle.Text = advanced.Visible ? "⌄   更多设置" : "›   更多设置 · " + order.Text + "排序 / " + screens.Text + "（可输入屏数）";
        };
        order.SelectedIndexChanged += delegate { refreshAdvanced(); };
        screens.TextChanged += delegate { refreshAdvanced(); };
        advancedToggle.Click += delegate {
            bool expanded = !advanced.Visible;
            advanced.Visible = expanded;
            page.RowStyles[2].Height = expanded ? AdvancedExpandedHeight : AdvancedCollapsedHeight;
            page.AutoScrollMinSize = expanded ? new Size(0, 70 + (int)page.RowStyles[1].Height + AdvancedExpandedHeight + 128) : Size.Empty;
            refreshAdvanced();
        };

        var input = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, Margin = Padding.Empty };
        input.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        input.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 112));
        input.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        var templates = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList,
            Anchor = AnchorStyles.Left | AnchorStyles.Right, Margin = new Padding(0, 0, 8, 0),
            AccessibleName = "报告模板选择" };
        templates.Items.Add("使用内置模板");
        templates.SelectedIndex = 0;
        var browse = MakeButton("导入模板…", false);
        browse.Anchor = AnchorStyles.Left | AnchorStyles.Right;
        browse.Margin = Padding.Empty;
        browse.Height = templates.PreferredHeight;
        templates.SizeChanged += delegate {
            if (browse.Height != templates.Height) browse.Height = templates.Height;
        };
        var tooltip = new ToolTip();
        string library = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "XhsMonitor", "templates");
        templates.SelectedIndexChanged += delegate {
            reportTemplate = templates.SelectedIndex > 0 ? Path.Combine(library, templates.Text + ".md") : "";
        };
        tooltip.SetToolTip(templates, "选择内置规则或已导入的 Markdown 模板。开始监控前校验分析规则、工作表与列。");
        try {
            if (Directory.Exists(library)) {
                foreach (string path in Directory.GetFiles(library, "*.md").OrderBy(Path.GetFileNameWithoutExtension))
                    templates.Items.Add(Path.GetFileNameWithoutExtension(path));
            }
        } catch (IOException error) {
            AppendLog("无法读取模板库：" + error.Message);
        } catch (UnauthorizedAccessException error) {
            AppendLog("无法读取模板库：" + error.Message);
        }
        browse.Click += delegate {
            using (var picker = new OpenFileDialog { Filter = "Markdown 模板|*.md", CheckFileExists = true, Multiselect = true }) {
                if (picker.ShowDialog(this) != DialogResult.OK) return;
                string selected = null;
                var errors = new System.Collections.Generic.List<string>();
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
                if (errors.Count > 0) MessageBox.Show(this, String.Join(Environment.NewLine, errors), "部分模板无法导入");
            }
        };
        input.Controls.Add(templates, 0, 0);
        input.Controls.Add(browse, 1, 0);
        AddStack(advanced, "报告生成模板", input, 0, 1, 1);
        tooltip.SetToolTip(screens, "默认下拉到底。也可直接输入正整数，例如 3，包含首屏。");
        tooltip.SetToolTip(start, "北京时间，包含开始当天。");
        tooltip.SetToolTip(end, "北京时间，包含结束当天。");

        secret.UseSystemPasswordChar = true;
        secret.AccessibleName = "所选服务的 AI API 密钥";
        tooltip.SetToolTip(secret, "填写所选服务商签发的密钥。留空则仅导出笔记明细。");
        aiProvider.DropDownStyle = ComboBoxStyle.DropDownList;
        aiProvider.Items.AddRange(new object[] { "OpenAI", "Claude", "Gemini", "DeepSeek", "Kimi", "GLM", "Qwen" });
        aiProvider.SelectedIndex = 0;
        AddStack(advanced, "AI 服务商", aiProvider, 1, 1, 1);
        AddStack(advanced, "模型（留空使用默认）", aiModel, 0, 2, 1);
        AddStack(advanced, "API 密钥（可选）", secret, 1, 2, 1);
        AddStack(advanced, "Qwen 接口地址（可选）", qwenEndpoint, 0, 3, 2);
        qwenEndpoint.Enabled = false;
        tooltip.SetToolTip(qwenEndpoint, "使用阿里云百炼控制台的 OpenAI 兼容接口地址。留空使用中国内地旧版地址。");
        aiProvider.SelectedIndexChanged += delegate {
            secret.Clear();
            aiModel.Clear();
            qwenEndpoint.Enabled = aiProvider.Text == "Qwen";
        };

        var results = new Panel { Dock = DockStyle.Fill, BackColor = Color.White,
            Margin = new Padding(0, 12, 0, 8), Padding = new Padding(16, 8, 12, 8) };
        Round(results, 16);
        page.Controls.Add(results, 0, 3);
        status.Text = "●  准备就绪 · 运行时可点击「后台执行」";
        status.ForeColor = Muted;
        status.Dock = DockStyle.Fill;
        status.TextAlign = ContentAlignment.MiddleLeft;
        status.Margin = Padding.Empty;
        status.AutoEllipsis = true;
        var statusRow = new TableLayoutPanel { Dock = DockStyle.Fill, Margin = Padding.Empty, ColumnCount = 2, RowCount = 1 };
        statusRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        statusRow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 112));
        statusRow.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        var detailToggle = MakeButton("任务详情  ›", false);
        detailToggle.Dock = DockStyle.Fill;
        detailToggle.Margin = Padding.Empty;
        detailToggle.FlatAppearance.BorderSize = 0;
        detailToggle.ForeColor = Accent;
        advancedToggle.FlatAppearance.BorderSize = 0;
        advancedToggle.BackColor = Color.White;
        statusRow.Controls.Add(status, 0, 0);
        statusRow.Controls.Add(detailToggle, 1, 0);
        results.Controls.Add(statusRow);
        var details = Card(1);
        details.Visible = false;
        details.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        details.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        details.RowStyles.Add(new RowStyle(SizeType.Absolute, 12));
        page.Controls.Add(details, 0, 5);
        showTaskDetails = delegate {
            if (advanced.Visible) advancedToggle.PerformClick();
            details.Visible = true;
            detailToggle.Text = "收起任务详情";
        };
        detailToggle.Click += delegate {
            details.Visible = !details.Visible;
            detailToggle.Text = details.Visible ? "收起任务详情" : "任务详情  ›";
            if (details.Visible && advanced.Visible) advancedToggle.PerformClick();
        };
#if DISTRIBUTION
        InstallDiagnosticButton(details);
#endif
        log.Dock = DockStyle.Fill;
        log.Multiline = true;
        log.ReadOnly = true;
        log.ScrollBars = ScrollBars.Vertical;
        log.BackColor = Canvas;
        log.BorderStyle = BorderStyle.FixedSingle;
        log.AccessibleName = "执行进度";
        if (log.TextLength == 0) log.Text = "运行后可在这里查看采集与导出进度。";
        details.Controls.Add(log, 0, 1);
        progress.Dock = DockStyle.Fill;
        progress.Visible = false;
        details.Controls.Add(progress, 0, 2);
        var actions = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft, WrapContents = false };
        actions.Margin = Padding.Empty;
        run.Margin = new Padding(8, 4, 0, 0);
        open.Margin = new Padding(0, 4, 0, 0);
        open.Click += delegate { OpenReportFolder(); };
        run.Click += async delegate { await StartReport(); };
        actions.Controls.Add(run);
        actions.Controls.Add(open);
        page.Controls.Add(actions, 0, 4);
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
            throw new InvalidDataException("请选择 .md 文件。");
        string markdown = File.ReadAllText(path, new UTF8Encoding(false, true)).Trim();
        if (markdown.Length > 12000) throw new InvalidDataException("模板不能超过 12,000 个字符。");
        foreach (string section in new[] { "总结", "总表", "日期" }) {
            if (!System.Text.RegularExpressions.Regex.IsMatch(markdown, @"^#{1,6}[ \t]+" + section + @"[ \t]*\r?$",
                System.Text.RegularExpressions.RegexOptions.Multiline))
                throw new InvalidDataException("模板须包含「总结」「总表」「日期」三个标题。");
        }
        Directory.CreateDirectory(library);
        string stem = Path.GetFileNameWithoutExtension(path);
        for (int index = 1; ; index++) {
            string name = index == 1 ? stem : stem + " (" + index + ")";
            if (name == "使用内置模板") continue;
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

    private async Task StartReport()
    {
        if (running) return;
#if DISTRIBUTION
        if (!licenseAllowed) return;
#endif
        if (string.IsNullOrWhiteSpace(keyword.Text) || start.Value.Date > end.Value.Date) {
            MessageBox.Show(this, "请输入关键词，并确认开始日期不晚于结束日期。", Text);
            if (string.IsNullOrWhiteSpace(keyword.Text)) keyword.Focus();
            return;
        }
        object screenCount = ParseScreenCount();
        if (screenCount == null) {
            MessageBox.Show(this, "划屏数量请输入正整数，例如 3，或选择「下拉到底」。", Text);
            return;
        }
        running = true;
        activityTimer.Start();
#if DISTRIBUTION
        BeginDiagnostic();
#endif
        cancelRequested = false;
        run.Enabled = false;
        progress.Visible = true;
        progress.Style = ProgressBarStyle.Marquee;
        log.Clear();
        report = null;
        SetLiveProgress("正在启动浏览器…");
        ShowCompactView();
        string key = secret.Text.Trim();
        secret.Clear();
        try {
            using (var worker = StartWorker(key)) {
                activeWorker = worker;
                Send(worker, keyword.Text.Trim(), start.Value.Date, end.Value.Date, reportTemplate, order.Text);
                Task errors = Task.Run(async delegate {
                    string line;
                    while ((line = await worker.StandardError.ReadLineAsync()) != null)
                        if (!line.StartsWith("MONO_WASM:")) PostLog(line);
                });
                string message, lastProgress = null, analysisWarning = null;
                while ((message = await worker.StandardOutput.ReadLineAsync()) != null) {
                    if (message.StartsWith("UI_ASK ")) {
                        if (cancelRequested) continue;
                        string answer = PromptUser(json.Deserialize<string>(message.Substring(7)));
                        if (cancelRequested) continue;
                        worker.StandardInput.WriteLine(AsciiJson(answer));
                        worker.StandardInput.Flush();
                    } else if (message.StartsWith("UI_ANALYSIS_WARNING ")) {
                        analysisWarning = message.Substring("UI_ANALYSIS_WARNING ".Length);
                        AppendLog(analysisWarning);
                    } else if (message.StartsWith("UI_PROGRESS ")) {
                        string batchProgress = message.Substring("UI_PROGRESS ".Length);
                        lastProgress = batchProgress;
                        SetLiveProgress(batchProgress);
                        AppendLog(batchProgress);
                        // The final batch notification replaces the last item notification.
                        string[] counts = batchProgress.Split(new[] { '/', ' ' }, StringSplitOptions.RemoveEmptyEntries);
                        if (counts.Length >= 2 && counts[0] != counts[1])
                            Notify("关键词监控进度", batchProgress, ToolTipIcon.Info);
                    } else if (!message.StartsWith("Inspect result written")) {
                        const string prefix = "已生成 Excel：";
                        if (message.StartsWith(prefix)) report = message.Substring(prefix.Length);
                        AppendLog(message);
                        if (message.StartsWith("扫描「") || message.StartsWith("读笔记 ") ||
                            message.StartsWith("开始关键词 ") || message.StartsWith("正在生成 Excel") ||
                            message.StartsWith("分析 ") || message.StartsWith("正在打开"))
                            SetLiveProgress(message);
                    }
                }
                await errors;
                await Task.Run((Action)worker.WaitForExit);
                bool succeeded = worker.ExitCode == 0 && File.Exists(report);
#if DISTRIBUTION
                EndDiagnostic(succeeded ? "completed" : cancelRequested ? "stopped" : "failed");
#endif
                status.Text = succeeded ? "已导出 · " + (analysisWarning ?? lastProgress) : cancelRequested ? "任务已停止" :
                    File.Exists(report) ? "部分关键词失败 · 已导出报告" : "运行结束，请查看日志";
                if (!exitRequested) {
                    Notify(succeeded ? (analysisWarning == null ? "舆情报告已生成" : "已导出 · AI 分析未完整") : cancelRequested ? "监控任务已停止" : "监控任务未完成",
                        succeeded ? (analysisWarning ?? lastProgress ?? "点击通知返回程序，或从托盘打开报告目录。") : "点击通知查看执行日志。",
                        (succeeded && analysisWarning == null) || cancelRequested ? ToolTipIcon.Info : ToolTipIcon.Warning);
                }
            }
        } catch (Exception ex) {
#if DISTRIBUTION
            EndDiagnostic(cancelRequested ? "stopped" : "failed");
#endif
            AppendLog(ex.Message);
            status.Text = "启动或运行失败";
            if (!exitRequested) Notify("监控任务未完成", "点击通知查看执行日志。", ToolTipIcon.Warning);
        } finally {
            activeWorker = null;
            running = false;
            activityTimer.Stop();
            UpdateActivity();
            run.Enabled = true;
#if DISTRIBUTION
            run.Enabled = licenseAllowed;
#endif
            progress.Visible = false;
            RestoreSetupView();
            if (!cancelRequested && !File.Exists(report)) showTaskDetails();
            if (exitRequested) Close();
        }
    }

    private Process StartWorker(string key)
    {
        string runtime = FindRuntime();
        var execution = new ProcessStartInfo(runtime) {
            WorkingDirectory = home, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        };
        execution.EnvironmentVariables["XHS_MONITOR_HOME"] = home;
        execution.EnvironmentVariables.Remove("XHS_AI_KEY");
        if (!string.IsNullOrEmpty(key)) execution.EnvironmentVariables["XHS_AI_KEY"] = key;
        string workerPath = Path.Combine(Path.GetTempPath(), "xhs-monitor-" + Guid.NewGuid().ToString("N") + ".mjs");
        try {
            using (var resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("monitor.mjs"))
            using (var file = File.Create(workerPath)) resource.CopyTo(file);
            execution.Arguments = "\"" + workerPath + "\" --desktop";
            var worker = new Process { StartInfo = execution, EnableRaisingEvents = true };
            worker.Exited += delegate { TryDelete(workerPath); };
            if (!worker.Start()) throw new InvalidOperationException("未能启动采集程序。");
            return worker;
        } catch {
            TryDelete(workerPath);
            throw;
        }
    }

    private void Send(Process worker, string term, DateTime from, DateTime to, string template, string sort, string source = "")
    {
        var bounds = browserBounds.IsEmpty ? null : new { left = browserBounds.Left, top = browserBounds.Top,
            width = browserBounds.Width, height = browserBounds.Height };
        var request = new { keyword = term, start = DateText(from), end = DateText(to), source, template, sort = sort,
            screens = ParseScreenCount(), browserBounds = bounds, provider = aiProvider.Text,
            model = aiModel.Text.Trim(), endpoint = qwenEndpoint.Enabled ? qwenEndpoint.Text.Trim() : "" };
        // ASCII-only JSON keeps the initial message independent of the Windows input code page.
        worker.StandardInput.WriteLine(AsciiJson(request));
        worker.StandardInput.Flush();
    }

    private string PromptUser(string message)
    {
        RestoreWindow();
        SetLiveProgress("等待网页操作");
        AppendLog(message);
        using (var dialog = new Form { Text = "继续网页操作", Width = 530, Height = 218, StartPosition = FormStartPosition.CenterParent, Font = Font, MaximizeBox = false, MinimizeBox = false }) {
            var caption = new Label { Text = message, Left = 22, Top = 18, Width = 465, Height = 56 };
            bool needsText = message.Contains("同名时间选项");
            bool browserChoice = message.StartsWith("后台采集需要打开浏览器");
            var ok = MakeButton(browserChoice ? "打开浏览器" : "继续", true);
            ok.SetBounds(380, 115, 106, 34);
            ok.DialogResult = DialogResult.OK;
            if (needsText) {
                caption.Height = 68;
                var presets = new ComboBox { Left = 22, Top = 90, Width = 465, DropDownStyle = ComboBoxStyle.DropDownList };
                if (message.Contains("此日期可使用不限")) presets.Items.Add("不限");
                else presets.Items.AddRange(new object[] {"一天内", "一周内", "半年内"});
                ok.Top = 127;
                ok.Text = "已应用";
                ok.Enabled = false;
                presets.SelectedIndexChanged += delegate { ok.Enabled = presets.SelectedIndex >= 0; };
                var endTask = MakeButton("结束任务", false);
                endTask.SetBounds(260, 127, 106, 34);
                endTask.DialogResult = DialogResult.Cancel;
                dialog.CancelButton = endTask;
                dialog.Controls.Add(presets);
                dialog.Controls.AddRange(new Control[] { caption, endTask, ok });
                dialog.AcceptButton = ok;
                string chosen = ShowPrompt(dialog) == DialogResult.OK ? presets.Text.Trim() : "";
                SetLiveProgress("正在继续监控…");
                return chosen;
            }
            dialog.Controls.AddRange(new Control[] { caption, ok });
            dialog.AcceptButton = ok;
            if (browserChoice) {
                var stop = MakeButton("结束", false);
                stop.SetBounds(260, 115, 106, 34);
                stop.DialogResult = DialogResult.Cancel;
                dialog.Controls.Add(stop);
                dialog.CancelButton = stop;
            }
            DialogResult result = ShowPrompt(dialog);
            SetLiveProgress("正在继续监控…");
            return browserChoice && result == DialogResult.OK ? "继续" : "";
        }
    }

    private DialogResult ShowPrompt(Form dialog)
    {
        pendingPrompt = dialog;
        UpdateActivity();
        try { return dialog.ShowDialog(this); }
        finally { pendingPrompt = null; }
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
        string message = exit ? "任务仍在运行。停止任务并退出程序？" : "停止当前任务？";
        if (MessageBox.Show(message, Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
        StopWorker(exit);
    }

    private void StopWorker(bool exit)
    {
        cancelRequested = true;
        UpdateActivity();
        exitRequested = exit;
        status.Text = "正在停止任务…";
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
        if (value == "下拉到底") return "bottom";
        int count;
        if (value.EndsWith("屏")) value = value.Substring(0, value.Length - 1).Trim();
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

    private void CreateCompactView()
    {
        compactView = Card(1);
        compactView.Visible = false;
        compactView.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        compactView.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        compactView.RowStyles.Add(new RowStyle(SizeType.Absolute, 51));
        var title = Caption("监控进度", Ink);
        title.Font = HeadingFont(17);
        compactView.Controls.Add(title, 0, 0);
        compactProgress = new Label { Dock = DockStyle.Fill, ForeColor = Ink, AutoEllipsis = true };
        compactView.Controls.Add(compactProgress, 0, 1);
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft, WrapContents = false };
        var background = MakeButton("后台执行", true);
        var stop = MakeButton("停止任务", false);
        background.Click += delegate { HideToTray(); };
        stop.Click += delegate { ConfirmStop(false); };
        buttons.Controls.Add(background);
        buttons.Controls.Add(stop);
        compactView.Controls.Add(buttons, 0, 2);
        Controls.Add(compactView);
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
        Bounds = new Rectangle(area.Right - width, area.Top, width, Math.Min(285, area.Height));
        setupView.Visible = false;
        compactView.Visible = true;
        compactView.BringToFront();
    }

    private void RestoreSetupView()
    {
        compactView.Visible = false;
        setupView.Visible = true;
        MinimumSize = setupMinimum;
        if (!setupBounds.IsEmpty) Bounds = setupBounds;
        tray.Text = "小红书舆情监控";
    }

    private void SetLiveProgress(string message)
    {
        status.Text = message;
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
            MessageBox.Show(this, error.Message, "无法打开报告目录");
        }
    }

    private int Verify(string path)
    {
        var initialSize = Size;
        ShowCompactView();
        if (Width >= initialSize.Width || browserBounds.Right > Left || Height > 285) return 7;
        RestoreSetupView();
        if (Size != initialSize) return 8;
        using (var moved = CreatePawFrame(activityCover, 1))
            if (!Enumerable.Range(0, moved.Width * moved.Height).Where(i => i % 7 == 0)
                .Any(i => moved.GetPixel(i % moved.Width, i / moved.Width) != activityCover.GetPixel(i % moved.Width, i / moved.Width))) return 5;
        if (screens.Text != "下拉到底") return 2;
        screens.Text = "3";
        if (!Object.Equals(ParseScreenCount(), 3)) return 6;
        keyword.CreateControl();
        int originalHeight = keywordWell.Height;
        keyword.Text = String.Join(" ", Enumerable.Repeat("之禾羊绒衫", 170));
        if (keywordWell.Height <= originalHeight || keyword.ScrollBars != ScrollBars.Vertical) return 3;
        keyword.Clear();
        if (keywordWell.Height != originalHeight) return 4;
        using (var worker = StartWorker("")) {
            var day = new DateTime(2026, 11, 21);
            Send(worker, "之禾 咖啡", day, day, Path.Combine(home, "报告生成模板.md"), "最新", path);
            var errors = worker.StandardError.ReadToEndAsync();
            string result = worker.StandardOutput.ReadToEnd();
            worker.WaitForExit();
            const string prefix = "已生成 Excel：";
            string[] outputs = result.Split('\n').Where(line => line.StartsWith(prefix)).ToArray();
            return worker.ExitCode == 0 && outputs.Length == 1 &&
                outputs.All(line => File.Exists(line.Substring(prefix.Length).Trim())) &&
                result.Contains("UI_PROGRESS 1/2") && result.Contains("UI_PROGRESS 2/2") ? 0 : 1;
        }
    }

    private string FindRuntime()
    {
        if (home.IndexOf("360zip$Temp", StringComparison.OrdinalIgnoreCase) >= 0)
            throw new IOException("程序正在 360 压缩的临时目录运行。请先将整个 ZIP 解压到普通文件夹，再打开解压后的 EXE。");
        string runtime = Path.Combine(home, "runtime");
        string node = Path.Combine(runtime, "node.exe");
        if (File.Exists(node) && File.Exists(Path.Combine(runtime, "node_modules", "exceljs", "package.json")) &&
            File.Exists(Path.Combine(runtime, "node_modules", "playwright", "package.json"))) return node;
        throw new FileNotFoundException("运行组件缺失。请重新安装程序，或完整解压发行包并保留程序同级的 runtime 文件夹。");
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
    private static DateTimePicker DateInput() {
        DateTime today = DateTime.UtcNow.AddHours(8).Date;
        return new DateTimePicker { Format = DateTimePickerFormat.Custom, CustomFormat = "yyyy-MM-dd", Value = today };
    }
    private static Label Caption(string text, Color color) { return new Label { Text = text, ForeColor = color, AutoSize = true }; }
    private Font HeadingFont(float size) {
        if (Font.Name == "Noto Sans SC") {
            var medium = new Font("Noto Sans SC Medium", size);
            if (medium.Name == "Noto Sans SC Medium") return medium;
            medium.Dispose();
        }
        return new Font(Font.FontFamily, size, FontStyle.Bold);
    }
    private static Button MakeButton(string text, bool primary) {
        var button = new Button { Text = text, Width = 130, Height = 38, FlatStyle = FlatStyle.Flat,
            BackColor = primary ? Accent : Color.White, ForeColor = primary ? Color.White : Ink };
        button.FlatAppearance.BorderSize = 0;
        if (!primary) button.BackColor = Color.FromArgb(236, 241, 249);
        Round(button, 9);
        return button;
    }
    private static TableLayoutPanel Card(int columns) {
        var card = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = columns, Padding = new Padding(16),
            BackColor = Color.White, Margin = Padding.Empty };
        Round(card, 17);
        return card;
    }
    private static void Round(Control control, int radius) {
        Action apply = delegate {
            int width = control.Width, height = control.Height;
            int diameter = Math.Min(radius * 2, Math.Min(width, height));
            if (diameter < 2) return;
            using (var path = new GraphicsPath()) {
                path.AddArc(0, 0, diameter, diameter, 180, 90);
                path.AddArc(width - diameter, 0, diameter, diameter, 270, 90);
                path.AddArc(width - diameter, height - diameter, diameter, diameter, 0, 90);
                path.AddArc(0, height - diameter, diameter, diameter, 90, 90);
                path.CloseFigure();
                var old = control.Region;
                control.Region = new Region(path);
                if (old != null) old.Dispose();
            }
        };
        control.Resize += delegate { apply(); };
        apply();
    }
    private static void ResizeKeywordField(int extra, Panel well, TableLayoutPanel settings, TableLayoutPanel page) {
        if (well.Height != KeywordHeight + extra) well.Height = KeywordHeight + extra;
        if (settings.RowStyles[0].Height != KeywordRowHeight + extra) settings.RowStyles[0].Height = KeywordRowHeight + extra;
        int height = SettingsHeight + extra;
        if (page.RowStyles[1].Height != height) page.RowStyles[1].Height = height;
    }
    private static Control AddStack(TableLayoutPanel grid, string name, Control control, int column, int row, int span) {
        var margin = span == 2 ? Padding.Empty : column == 0 ? new Padding(0, 0, 7, 0) : new Padding(7, 0, 0, 0);
        var field = new TableLayoutPanel { Dock = DockStyle.Fill, Margin = margin, RowCount = 2, ColumnCount = 1 };
        field.RowStyles.Add(new RowStyle(SizeType.Absolute, 29));
        field.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        var label = Caption(name, Ink);
        label.Anchor = AnchorStyles.Left;
        control.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
        control.Margin = new Padding(0, 2, 0, 0);
        Control input = control;
        if (control is TableLayoutPanel) {
            control.Height = 34;
        }
        if (control is TextBox) {
            control.BackColor = Color.FromArgb(239, 242, 249);
            ((TextBox)control).BorderStyle = BorderStyle.None;
            bool multiline = ((TextBox)control).Multiline;
            var well = new Panel { Height = multiline ? KeywordHeight : 34, BackColor = control.BackColor,
                Padding = multiline ? new Padding(10, 10, 10, 7) : new Padding(10, 5, 10, 4),
                Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right, Margin = new Padding(0, 2, 0, 0) };
            control.Dock = DockStyle.Fill;
            well.Controls.Add(control);
            Round(well, 8);
            input = well;
        }
        field.Controls.Add(label, 0, 0);
        field.Controls.Add(input, 0, 1);
        grid.Controls.Add(field, column, row);
        grid.SetColumnSpan(field, span);
        return input;
    }
}
