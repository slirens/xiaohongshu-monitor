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

[assembly: AssemblyVersion("1.0.7.0")]
[assembly: AssemblyFileVersion("1.0.7.0")]
[assembly: AssemblyInformationalVersion("1.0.7")]

internal sealed partial class Desktop : Form
{
    private const int KeywordHeight = 50;
    private const int KeywordRowHeight = 88;
    private const int SettingsHeight = 171;
    private const int AdvancedCollapsedHeight = 62;
    private const int AdvancedExpandedHeight = 378;
    private static readonly Color Ink = Color.FromArgb(36, 50, 72);
    private static readonly Color Muted = Color.FromArgb(84, 99, 122);
    private static readonly Color Accent = Color.FromArgb(35, 91, 194);
    private static readonly Color Canvas = Color.FromArgb(230, 237, 247);
    private static readonly Color Surface = Color.FromArgb(250, 252, 254);
    private static readonly Color FieldFill = Color.FromArgb(243, 247, 251);
    private static readonly Color FieldEdge = Color.FromArgb(214, 224, 238);
    private static readonly Color FocusEdge = Color.FromArgb(68, 116, 203);
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
    private readonly ProgressBar progress = new ProgressBar();
    private readonly Button run = MakeButton(Ui("开始监控", "Start monitoring"), true);
    private readonly Button open = MakeButton(Ui("打开报告目录", "Open reports"), false);
    private readonly Button exportDiagnostics = MakeButton(Ui("导出诊断日志", "Export diagnostics"), false);
    private readonly NotifyIcon tray = new NotifyIcon();
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private readonly string home = AppDomain.CurrentDomain.BaseDirectory;
    private readonly string diagnosticsFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "XhsMonitor", "diagnostics");
    private string latestDiagnosticsFile;
    private string report;
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
    private Action showTaskDetails;

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

        var host = new Panel { Dock = DockStyle.Fill, Padding = new Padding(18), BackColor = Canvas };
        var shell = new TableLayoutPanel { Dock = DockStyle.Fill, BackColor = Surface, ColumnCount = 2, RowCount = 1 };
        shell.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 263));
        shell.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        Round(shell, 22);
        host.Controls.Add(shell);
        Controls.Add(host);
        setupView = host;
        CreateCompactView();
        var sidebar = new TableLayoutPanel { Dock = DockStyle.Fill, Margin = Padding.Empty, ColumnCount = 1, RowCount = 3,
            BackColor = Color.FromArgb(228, 239, 250), Padding = new Padding(23, 39, 23, 20) };
        sidebar.RowStyles.Add(new RowStyle(SizeType.Absolute, 207));
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
        var sideTitle = Caption(Ui("小红书舆情监控", "Xiaohongshu Monitor"), Ink);
        sideTitle.Font = HeadingFont(13);
        sideTitle.Anchor = AnchorStyles.Left;
        sidebar.Controls.Add(sideTitle, 0, 1);
        sidebar.Controls.Add(new Panel { Dock = DockStyle.Fill, Margin = Padding.Empty }, 0, 2);
        var page = new TableLayoutPanel { Dock = DockStyle.Fill, BackColor = Surface, AutoScroll = true,
            Padding = new Padding(32, 37, 32, 18), Margin = Padding.Empty, RowCount = 6, ColumnCount = 1 };
        page.RowStyles.Add(new RowStyle(SizeType.Absolute, 83));
        page.RowStyles.Add(new RowStyle(SizeType.Absolute, SettingsHeight));
        page.RowStyles.Add(new RowStyle(SizeType.Absolute, AdvancedCollapsedHeight));
        page.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        page.RowStyles.Add(new RowStyle(SizeType.Absolute, 69));
        page.RowStyles.Add(new RowStyle(SizeType.Absolute, 0));
        shell.Controls.Add(page, 1, 0);
        var header = new Panel { Dock = DockStyle.Fill, Margin = Padding.Empty };
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
        var title = Caption(Ui("新建监控任务", "New monitoring task"), Ink);
        title.Font = HeadingFont(21);
        title.Location = new Point(0, 0);
        var subtitle = Caption(Ui("按关键词和日期采集笔记，导出 Excel 报告。", "Collect notes by keyword and date, then export an Excel report."), Muted);
        subtitle.Location = new Point(0, 40);
        header.Controls.AddRange(new Control[] { title, subtitle });
        page.Controls.Add(header, 0, 0);

        var settings = new TableLayoutPanel { Dock = DockStyle.Fill, BackColor = Surface, Margin = Padding.Empty,
            ColumnCount = 2, RowCount = 2 };
        settings.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        settings.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        settings.Font = new Font(Font.FontFamily, 10.5f);
        settings.RowStyles.Add(new RowStyle(SizeType.Absolute, KeywordRowHeight));
        settings.RowStyles.Add(new RowStyle(SizeType.Absolute, 83));
        page.Controls.Add(settings, 0, 1);

        keyword.AccessibleName = Ui("关键词", "Keywords");
        keyword.Multiline = true;
        keyword.WordWrap = true;
        keyword.AcceptsReturn = true;
        keywordWell = (Panel)AddStack(settings, Ui("关键词", "Keywords"), keyword, 0, 0, 2);
        var keywordHint = Caption(Ui("多个关键词用空格分隔，例如：宝山 硚口", "Separate keywords with spaces, e.g. Baoshan Qiaokou"), Muted);
        ((FieldWell)keywordWell).SetHint(keywordHint);
        AddStack(settings, Ui("开始日期", "Start date"), start, 0, 1, 1);
        AddStack(settings, Ui("结束日期", "End date"), end, 1, 1, 1);
        order.DropDownStyle = ComboBoxStyle.DropDownList;
        order.Items.AddRange(new object[] { Ui("最新", "Latest"), Ui("综合", "Most relevant") });
        order.SelectedIndex = 0;
        screens.DropDownStyle = ComboBoxStyle.DropDown;
        screens.Items.AddRange(new object[] { Ui("1 屏", "1 screen"), Ui("2 屏", "2 screens"), Ui("3 屏", "3 screens"), Ui("4 屏", "4 screens"), Ui("下拉到底", "Scroll to bottom") });
        screens.SelectedIndex = 4;
        screens.AccessibleName = Ui("划屏数量", "Screen count");
        screens.BackColor = FieldFill;
        screens.ForeColor = Ink;
        var advancedToggle = MakeButton(Ui("›   更多设置", "›   More settings"), false);
        advancedToggle.Dock = DockStyle.Fill;
        advancedToggle.Margin = new Padding(0, 2, 0, 3);
        advancedToggle.Padding = new Padding(10, 0, 0, 0);
        advancedToggle.TextAlign = ContentAlignment.MiddleLeft;
        advancedToggle.Paint += delegate(object sender, PaintEventArgs args) {
            string summary = order.Text + "  ·  " + screens.Text;
            int left = Math.Min(172, advancedToggle.Width / 2);
            TextRenderer.DrawText(args.Graphics, summary, Font,
                new Rectangle(left, 0, Math.Max(1, advancedToggle.Width - left - 13), advancedToggle.Height), Muted,
                TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine);
        };
        var advancedCard = Card(1);
        advancedCard.Margin = new Padding(0, 8, 0, 0);
        advancedCard.BackColor = Surface;
        advancedCard.Padding = new Padding(0, 2, 0, 7);
        advancedCard.RowStyles.Add(new RowStyle(SizeType.Absolute, 46));
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
                ((FieldWell)keywordWell).RefreshAppearance();
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
        AddStack(advanced, Ui("网页排序", "Sort results"), order, 0, 0, 1);
        AddStack(advanced, Ui("划屏数量（可输入数字）", "Screen count (editable)"), screens, 1, 0, 1);
        Action refreshAdvanced = delegate {
            advancedToggle.Text = advanced.Visible ? Ui("⌄   更多设置", "⌄   More settings") : Ui("›   更多设置", "›   More settings");
            advancedToggle.AccessibleDescription = order.Text + " · " + screens.Text;
            advancedToggle.Invalidate();
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
            AccessibleName = Ui("报告模板选择", "Report template selection") };
        templates.Items.Add(Ui("使用内置模板", "Use built-in template"));
        templates.SelectedIndex = 0;
        var browse = MakeButton(Ui("导入模板…", "Import…"), false);
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
        tooltip.SetToolTip(templates, Ui("选择内置规则或已导入的 Markdown 模板。开始监控前校验分析规则、工作表与列。", "Select built-in rules or an imported Markdown template. Report rules, sheets, and columns are validated before monitoring."));
        try {
            if (Directory.Exists(library)) {
                foreach (string path in Directory.GetFiles(library, "*.md").OrderBy(Path.GetFileNameWithoutExtension))
                    templates.Items.Add(Path.GetFileNameWithoutExtension(path));
            }
        } catch (IOException error) {
            AppendLog(Ui("无法读取模板库：", "Could not read the template library: ") + error.Message);
        } catch (UnauthorizedAccessException error) {
            AppendLog(Ui("无法读取模板库：", "Could not read the template library: ") + error.Message);
        }
        browse.Click += delegate {
            using (var picker = new OpenFileDialog { Filter = Ui("Markdown 模板|*.md", "Markdown templates|*.md"), CheckFileExists = true, Multiselect = true }) {
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
                if (errors.Count > 0) MessageBox.Show(this, String.Join(Environment.NewLine, errors), Ui("部分模板无法导入", "Some templates could not be imported"));
            }
        };
        input.Controls.Add(templates, 0, 0);
        input.Controls.Add(browse, 1, 0);
        AddStack(advanced, Ui("报告生成模板", "Report template"), input, 0, 1, 1);
        tooltip.SetToolTip(screens, Ui("默认下拉到底。也可直接输入正整数，例如 3，包含首屏。", "Scroll to the bottom by default, or enter a positive number including the first screen."));
        tooltip.SetToolTip(start, Ui("北京时间，包含开始当天。", "China time. The start date is included."));
        tooltip.SetToolTip(end, Ui("北京时间，包含结束当天。", "China time. The end date is included."));

        secret.UseSystemPasswordChar = true;
        secret.AccessibleName = Ui("所选服务的 AI API 密钥", "API key for the selected provider");
        tooltip.SetToolTip(secret, Ui("填写所选服务商签发的密钥。留空则仅导出笔记明细。", "Enter the key from the selected provider. Leave blank to export notes without AI analysis."));
        aiProvider.DropDownStyle = ComboBoxStyle.DropDownList;
        aiProvider.Items.AddRange(new object[] { "OpenAI", "Claude", "Gemini", "DeepSeek", "Kimi", "GLM", "Qwen" });
        aiProvider.SelectedIndex = 0;
        AddStack(advanced, Ui("AI 服务商", "AI provider"), aiProvider, 1, 1, 1);
        AddStack(advanced, Ui("模型（留空使用默认）", "Model (optional)"), aiModel, 0, 2, 1);
        AddStack(advanced, Ui("API 密钥（可选）", "API key (optional)"), secret, 1, 2, 1);
        AddStack(advanced, Ui("Qwen 接口地址（可选）", "Qwen endpoint (optional)"), qwenEndpoint, 0, 3, 2);
        qwenEndpoint.Enabled = false;
        tooltip.SetToolTip(qwenEndpoint, Ui("使用阿里云百炼控制台的 OpenAI 兼容接口地址。留空使用中国内地旧版地址。", "Use the OpenAI-compatible endpoint from the Model Studio console. Leave blank for the default mainland China endpoint."));
        aiProvider.SelectedIndexChanged += delegate {
            secret.Clear();
            aiModel.Clear();
            qwenEndpoint.Enabled = aiProvider.Text == "Qwen";
        };

        var results = new Panel { Dock = DockStyle.Fill, BackColor = Surface, Margin = Padding.Empty,
            Padding = new Padding(0, 12, 0, 5) };
        results.Paint += delegate(object sender, PaintEventArgs args) {
            using (var line = new Pen(FieldEdge)) args.Graphics.DrawLine(line, 0, 1, results.Width, 1);
        };
        page.Controls.Add(results, 0, 4);
        status.Text = Ui("●  准备就绪", "●  Ready");
        status.ForeColor = Muted;
        status.Dock = DockStyle.Fill;
        status.TextAlign = ContentAlignment.MiddleLeft;
        status.Margin = Padding.Empty;
        status.AutoEllipsis = true;
        var statusRow = new TableLayoutPanel { Dock = DockStyle.Fill, Margin = Padding.Empty, ColumnCount = 3, RowCount = 1 };
        statusRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        statusRow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, English ? 101 : 89));
        statusRow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, English ? 276 : 257));
        statusRow.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        var detailToggle = MakeButton(Ui("任务详情", "Task details"), false);
        detailToggle.Dock = DockStyle.Fill;
        detailToggle.Margin = Padding.Empty;
        detailToggle.FlatAppearance.BorderSize = 0;
        detailToggle.ForeColor = Accent;
        detailToggle.BackColor = Surface;
        advancedToggle.BackColor = Surface;
        statusRow.Controls.Add(status, 0, 0);
        statusRow.Controls.Add(detailToggle, 1, 0);
        results.Controls.Add(statusRow);
        var details = Card(1);
        details.Visible = false;
        int diagnosticRow = 0;
#if DISTRIBUTION
        details.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        diagnosticRow = 1;
#endif
        details.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        details.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        details.RowStyles.Add(new RowStyle(SizeType.Absolute, 12));
        page.Controls.Add(details, 0, 5);
        Action<bool> toggleDetails = delegate(bool visible) {
            if (visible && advanced.Visible) advancedToggle.PerformClick();
            page.RowStyles[3].SizeType = visible ? SizeType.Absolute : SizeType.Percent;
            page.RowStyles[3].Height = visible ? 12 : 100;
            page.RowStyles[5].SizeType = visible ? SizeType.Percent : SizeType.Absolute;
            page.RowStyles[5].Height = visible ? 100 : 0;
            details.Visible = visible;
            detailToggle.Text = visible ? Ui("收起任务详情", "Hide details") : Ui("任务详情", "Task details");
        };
        showTaskDetails = delegate { toggleDetails(true); };
        detailToggle.Click += delegate { toggleDetails(!details.Visible); };
#if DISTRIBUTION
        InstallDiagnosticButton(details);
#endif
        latestDiagnosticsFile = TaskDiagnostics.Latest(diagnosticsFolder);
        exportDiagnostics.Anchor = AnchorStyles.Right;
        exportDiagnostics.Width = English ? 160 : 144;
        exportDiagnostics.Height = 32;
        exportDiagnostics.Margin = new Padding(0, 0, 0, 4);
        exportDiagnostics.Enabled = latestDiagnosticsFile != null;
        tooltip.SetToolTip(exportDiagnostics, Ui("将最近一次任务的诊断保存为本地文件。", "Save diagnostics from the latest run as a local file."));
        exportDiagnostics.Click += delegate { ExportDiagnostics(); };
        details.Controls.Add(exportDiagnostics, 0, diagnosticRow);
        log.Dock = DockStyle.Fill;
        log.Multiline = true;
        log.ReadOnly = true;
        log.ScrollBars = ScrollBars.Vertical;
        log.BackColor = Canvas;
        log.BorderStyle = BorderStyle.FixedSingle;
        log.AccessibleName = Ui("执行进度", "Task progress");
        if (log.TextLength == 0) log.Text = Ui("运行后可在这里查看采集与导出进度。", "Collection and export progress will appear here.");
        details.Controls.Add(log, 0, diagnosticRow + 1);
        progress.Dock = DockStyle.Fill;
        progress.Visible = false;
        details.Controls.Add(progress, 0, diagnosticRow + 2);
        var actions = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft, WrapContents = false };
        actions.Margin = Padding.Empty;
        run.Width = English ? 139 : 118;
        open.Width = English ? 121 : 125;
        run.Margin = new Padding(8, 4, 0, 0);
        open.Margin = new Padding(0, 4, 0, 0);
        open.Click += delegate { OpenReportFolder(); };
        run.Click += async delegate { await StartReport(); };
        actions.Controls.Add(run);
        actions.Controls.Add(open);
        statusRow.Controls.Add(actions, 2, 0);
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

    private async Task StartReport()
    {
        if (running) return;
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
                    } else if (message.StartsWith("UI_ASK ")) {
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
                            Notify(Ui("关键词监控进度", "Keyword progress"), batchProgress, ToolTipIcon.Info);
                    } else if (!message.StartsWith("Inspect result written")) {
                        string prefix = Ui("已生成 Excel：", "Excel report: ");
                        if (message.StartsWith(prefix)) report = message.Substring(prefix.Length);
                        AppendLog(message);
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
            progress.Visible = false;
            RestoreSetupView();
            if (!cancelRequested && !File.Exists(report)) showTaskDetails();
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

    private Process StartWorker(bool warmBrowser = false, TaskDiagnostics diagnostics = null)
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
            execution.Arguments = "\"" + workerPath + "\" --desktop" + (warmBrowser ? " --warm-browser-driver" : "");
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
        using (var dialog = new Form { Text = title, Width = 550, Height = 257, StartPosition = FormStartPosition.CenterParent, Font = Font, MaximizeBox = false, MinimizeBox = false, BackColor = Surface }) {
            var caption = new Label { Text = message, Left = 22, Top = 18, Width = 485, Height = 84 };
            bool browserChoice = message.StartsWith("后台采集需要打开浏览器") || message.StartsWith("Background collection needs a browser window");
            var ok = MakeButton(browserChoice ? Ui("打开浏览器", "Open browser") : Ui("继续", "Continue"), true);
            ok.SetBounds(390, 158, 116, 34);
            ok.DialogResult = DialogResult.OK;
            dialog.Controls.AddRange(new Control[] { caption, ok });
            dialog.AcceptButton = ok;
            if (browserChoice || signIn) {
                var stop = MakeButton(signIn ? Ui("结束任务", "End task") : Ui("结束", "End"), false);
                stop.SetBounds(258, 158, 122, 34);
                stop.DialogResult = DialogResult.Cancel;
                dialog.Controls.Add(stop);
                dialog.CancelButton = stop;
            }
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
        string message = exit ? Ui("任务仍在运行。停止任务并退出程序？", "Stop the running task and quit?") : Ui("停止当前任务？", "Stop the current task?");
        if (MessageBox.Show(message, Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
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

    private void CreateCompactView()
    {
        compactView = Card(1);
        compactView.Visible = false;
        compactView.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        compactView.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        compactView.RowStyles.Add(new RowStyle(SizeType.Absolute, 51));
        var title = Caption(Ui("监控进度", "Monitoring progress"), Ink);
        title.Font = HeadingFont(17);
        compactView.Controls.Add(title, 0, 0);
        compactProgress = new Label { Dock = DockStyle.Fill, ForeColor = Ink, AutoEllipsis = true };
        compactView.Controls.Add(compactProgress, 0, 1);
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft, WrapContents = false };
        var background = MakeButton(Ui("后台执行", "Run in background"), true);
        var stop = MakeButton(Ui("停止任务", "Stop task"), false);
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
            return worker.ExitCode == 0 && outputs.Length == 1 &&
                outputs.All(line => File.Exists(line.Substring(prefix.Length).Trim())) &&
                result.Contains("UI_PROGRESS 1/2") && result.Contains("UI_PROGRESS 2/2") ? 0 : 1;
        }
    }

    private int VerifyLayout()
    {
        if (Text != Ui("小红书舆情监控", "Xiaohongshu Monitor") ||
            run.Text != Ui("开始监控", "Start monitoring") ||
            start.AccessibleName != Ui("开始日期", "Start date")) return 9;
        DateTime selected;
        if (!start.TryRead(out selected) || selected != DateTime.UtcNow.AddHours(8).Date) return 10;
        var initialSize = Size;
        ShowCompactView();
        if (Width >= initialSize.Width || browserBounds.Right > Left || Height > 285) return 7;
        RestoreSetupView();
        if (Size != initialSize) return 8;
        using (var moved = CreatePawFrame(activityCover, 1))
            if (!Enumerable.Range(0, moved.Width * moved.Height).Where(i => i % 7 == 0)
                .Any(i => moved.GetPixel(i % moved.Width, i / moved.Width) != activityCover.GetPixel(i % moved.Width, i / moved.Width))) return 5;
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
        var button = new Button { Text = text, Width = 130, Height = 38, FlatStyle = FlatStyle.Flat,
            BackColor = primary ? Accent : Surface, ForeColor = primary ? Color.White : Ink };
        button.FlatAppearance.BorderSize = primary ? 0 : 1;
        button.FlatAppearance.BorderColor = FieldEdge;
        button.FlatAppearance.MouseOverBackColor = primary ? Color.FromArgb(47, 106, 206) : FieldFill;
        button.FlatAppearance.MouseDownBackColor = primary ? Color.FromArgb(30, 78, 171) : FieldEdge;
        Round(button, 18);
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
        label.Margin = Padding.Empty;
        if (string.IsNullOrEmpty(control.AccessibleName)) control.AccessibleName = name;
        control.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
        control.Margin = new Padding(0, 2, 0, 0);
        Control input = control;
        if (control is TableLayoutPanel) {
            control.Height = 34;
        }
        if (control is TextBox) input = new FieldWell((TextBox)control);
        field.Controls.Add(label, 0, 0);
        field.Controls.Add(input, 0, 1);
        grid.Controls.Add(field, column, row);
        grid.SetColumnSpan(field, span);
        return input;
    }

    private class FieldWell : Panel
    {
        protected readonly TextBox Editor;
        private Label hint;
        private Color fill = FieldFill;

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
            fill = ContainsFocus || Hovered ? Color.White : FieldFill;
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
            using (var border = new Pen(ContainsFocus ? FocusEdge : Hovered ? Color.FromArgb(147, 173, 208) : FieldEdge)) {
                if (ContainsFocus) using (var halo = new Pen(Color.FromArgb(33, FocusEdge), 4)) args.Graphics.DrawPath(halo, path);
                args.Graphics.FillPath(brush, path);
                args.Graphics.DrawPath(border, path);
            }
        }
    }

    private sealed class DateField : FieldWell
    {
        internal DateField() : base(new TextBox { MaxLength = 10 })
        {
            Height = 46;
            Padding = new Padding(14, 12, 43, 7);
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
