using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Windows.Forms;

internal sealed partial class Desktop
{
    private static readonly Color GroupFill = Color.FromArgb(247, 247, 247);
    private static readonly Color Success = Color.FromArgb(22, 122, 68);
    private static readonly Color Tertiary = Color.FromArgb(131, 129, 130);
    private static readonly Regex F1AStartTerm = new Regex(@"^(?:开始关键词 |Starting keyword )([1-9]\d*)/([1-9]\d*)(?:：|: )(.*)$");
    private static readonly Regex F1AFinishTerm = new Regex(@"^([1-9]\d*)/([1-9]\d*)(?: 已处理 · 「(.*)」(完成|失败)| processed · “(.*)” (completed|failed))$");
    private readonly SortedDictionary<int, F1ATerm> f1aTerms = new SortedDictionary<int, F1ATerm>();
    private readonly Dictionary<int, int> f1aNoteCounts = new Dictionary<int, int>();
    private readonly Dictionary<string, Image> f1aImages = new Dictionary<string, Image>();
    private readonly Label[] f1aSteps = new Label[3];
    private TableLayoutPanel f1aSetupPage, f1aSettingsPage, f1aRunPage, f1aResultPage;
    private Panel f1aViewport;
    private RowStyle f1aNoticeRow;
    private FlowLayoutPanel f1aFooterStart, f1aFooterEnd;
    private Label f1aRunMessage, f1aRunSummary, f1aKeywordHint, f1aDateHint, f1aScreenHint;
    private Label f1aReportName, f1aResultTitle, f1aResultMeta;
    private Button f1aAdvanced, f1aOpenResult, f1aExpandResult, f1aResultFollow, f1aResultNew;
    private F1AVirtualList f1aRunList, f1aResults;
    private TextBox f1aResultFilter;
    private readonly Button[] f1aStateButtons = new Button[3];
    private Label f1aResultGroup;
    private RowStyle f1aResultGroupRow;
    private int f1aResultSelection;
    private Control f1aResultFilters;
    private List<F1ATerm> f1aRunRows = new List<F1ATerm>(), f1aResultRows = new List<F1ATerm>();
    private F1AProgressBar f1aProgressBar, f1aCompactBar;
    private string f1aAnalysisWarning;
    private int f1aTotal;
    private bool f1aExpanded, f1aKeywordsEdited;

    private sealed class F1ATerm
    {
        internal readonly int Index;
        internal readonly string Name;
        internal string Outcome;
        internal bool IsGroup { get { return Index == 0; } }
        internal F1ATerm(int index, string name) { Index = index; Name = name; }
    }

    private void BuildF1AView()
    {
        var shell = new TableLayoutPanel { Dock = DockStyle.Fill, Margin = Padding.Empty, ColumnCount = 1, RowCount = 4 };
        shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 53));
        shell.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        f1aNoticeRow = new RowStyle(SizeType.Absolute, 36);
        shell.RowStyles.Add(f1aNoticeRow);
        shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 58));
        setupView = shell;
        Controls.Add(shell);
        var toolbar = new Panel { Dock = DockStyle.Fill, Margin = Padding.Empty };
        toolbar.Paint += delegate(object sender, PaintEventArgs args) {
            using (var pen = new Pen(FieldEdge)) args.Graphics.DrawLine(pen, 0, toolbar.Height - 1, toolbar.Width, toolbar.Height - 1);
        };
        shell.Controls.Add(toolbar, 0, 0);

        var mark = new PictureBox { Image = F1AImage("logo"), SizeMode = PictureBoxSizeMode.Zoom, Bounds = new Rectangle(20, 15, 22, 22) };
        var name = F1AText(Text, Ink);
        name.Font = HeadingFont(9.5f);
        name.Dock = DockStyle.None;
        name.SetBounds(50, 0, 190, 52);
        var stages = new TableLayoutPanel { Width = English ? 364 : 294, Height = 32, ColumnCount = 3, RowCount = 1,
            BackColor = FieldFill, Padding = new Padding(2), Margin = Padding.Empty };
        Round(stages, 8);
        for (int i = 0; i < f1aSteps.Length; i++) {
            stages.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.3333f));
            f1aSteps[i] = F1AText("", Muted);
            f1aSteps[i].TextAlign = ContentAlignment.MiddleCenter;
            stages.Controls.Add(f1aSteps[i], i, 0);
        }
        exportDiagnostics.Text = "";
        exportDiagnostics.AccessibleName = Ui("导出诊断日志", "Export diagnostics");
        exportDiagnostics.Width = exportDiagnostics.Height = 34;
        exportDiagnostics.Image = F1AImage("export", 17);
        exportDiagnostics.BackColor = Color.White;
        Action placeToolbar = delegate {
            stages.Location = new Point((toolbar.ClientSize.Width - stages.Width) / 2, 10);
            exportDiagnostics.Location = new Point(toolbar.ClientSize.Width - 53, 9);
        };
        toolbar.Controls.AddRange(new Control[] { mark, name, stages, exportDiagnostics });
        toolbar.Layout += delegate { placeToolbar(); };
        placeToolbar();

        f1aViewport = new Panel { Dock = DockStyle.Fill, Margin = Padding.Empty, AutoScroll = true };
        f1aViewport.Layout += delegate {
            foreach (Control page in f1aViewport.Controls) {
                if (page.Width != 600) page.Width = 600;
                int left = Math.Max(8, (f1aViewport.ClientSize.Width - page.Width) / 2);
                if (page.Left != left) page.Left = left;
            }
        };
        f1aViewport.Resize += delegate { SizeF1AResults(); };
        shell.Controls.Add(f1aViewport, 0, 1);
        var notice = F1AText(Ui("仅限合法、非商业使用。自动化浏览可能触发平台警告或限制，影响账号权益和流量。",
            "For lawful, non-commercial use only. Automated browsing may trigger platform warnings or restrictions and affect account privileges and reach."), Muted);
        notice.TextAlign = ContentAlignment.MiddleCenter;
        notice.Font = new Font(Font.FontFamily, 8.5f);
        shell.Controls.Add(notice, 0, 2);
        var footer = new Panel { Dock = DockStyle.Fill, Padding = new Padding(20, 11, 20, 9), Margin = Padding.Empty };
        footer.Paint += delegate(object sender, PaintEventArgs args) {
            using (var pen = new Pen(FieldEdge)) args.Graphics.DrawLine(pen, 0, 0, footer.Width, 0);
        };
        f1aFooterStart = F1AActions(FlowDirection.LeftToRight);
        f1aFooterEnd = F1AActions(FlowDirection.RightToLeft);
        f1aFooterStart.Dock = DockStyle.Left;
        f1aFooterEnd.Dock = DockStyle.Right;
        footer.Controls.AddRange(new Control[] { f1aFooterStart, f1aFooterEnd });
        shell.Controls.Add(footer, 0, 3);

        open.Text = Ui("打开报告目录", "Open reports");
        open.Image = F1AImage("folder", 15);
        open.TextImageRelation = TextImageRelation.ImageBeforeText;
        open.BackColor = Color.White;
        run.Width = English ? 146 : 118;
        importReport.Width = English ? 166 : 116;
        status.ForeColor = Muted;
        status.Text = Ui("准备就绪", "Ready");
        status.Dock = DockStyle.Fill;
        status.TextAlign = ContentAlignment.MiddleLeft;
        status.AutoEllipsis = true;
        log.Dock = DockStyle.Fill;
        log.Margin = new Padding(14, 8, 14, 8);
        log.Multiline = true;
        log.ReadOnly = true;
        log.ScrollBars = ScrollBars.Vertical;
        log.BackColor = GroupFill;
        log.BorderStyle = BorderStyle.None;
        log.AccessibleName = Ui("执行日志", "Execution log");
        log.Text = Ui("运行后可在这里查看采集与导出进度。", "Collection and export progress will appear here.");
        latestContinuationReport = LatestReport();
        BuildF1ASetup();
        BuildF1ARunning();
        BuildF1AResult();
        CreateCompactView();
        InitializeActivity();
        ShowF1APage(f1aSetupPage, 0);
        FormClosed += delegate { foreach (Image value in f1aImages.Values) value.Dispose(); };
    }

    private void BuildF1ASetup()
    {
        f1aSetupPage = F1APage();
        var heading = F1AText("", Ink);
        heading.Font = HeadingFont(20);
        F1AAdd(f1aSetupPage, heading, 46);
        var intro = F1AText("", Muted);
        F1AAdd(f1aSetupPage, intro, 27);
        var modes = F1AActions(FlowDirection.LeftToRight);
        modes.Dock = DockStyle.Left;
        modes.BackColor = FieldFill;
        Round(modes, 8);
        var resetTask = MakeButton(Ui("新建监控", "New task"), false);
        resetTask.Width = English ? 97 : 91;
        resetTask.Height = importReport.Height = 29;
        resetTask.Click += delegate { ResetF1ATask(); };
        importReport.Click += async delegate { await ImportPreviousReport(refreshReportHeader); };
        modes.Controls.Add(resetTask);
        modes.Controls.Add(importReport);
        F1AAdd(f1aSetupPage, modes, 33);
        F1ASpace(f1aSetupPage, 14);
        var selected = F1AText("", Ink);
        var change = MakeButton(Ui("更换报告…", "Change report…"), false);
        change.Width = English ? 142 : 109;
        change.AccessibleName = Ui("更换报告", "Change report");
        change.Click += async delegate { await ImportPreviousReport(refreshReportHeader); };
        var reportRow = F1ARow(selected, change, 15);
        int reportRowIndex = F1AAdd(f1aSetupPage, reportRow, 0);
        var reportTip = new ToolTip();
        FormClosed += delegate { reportTip.Dispose(); };

        keyword.AccessibleName = Ui("关键词", "Keywords");
        keyword.Multiline = true;
        keyword.WordWrap = true;
        keyword.AcceptsReturn = true;
        var keywordInput = new F1AKeywordWell(keyword) { Padding = new Padding(18, 14, 14, 8), Dock = DockStyle.Fill };
        keywordWell = keywordInput;
        keywordInput.SetHint(Caption(Ui("关键词", "Keywords"), Tertiary));
        int keywordIndex = F1AAdd(f1aSetupPage, keywordWell, KeywordHeight);
        f1aKeywordHint = F1AText("", Muted, 16);
        F1AAdd(f1aSetupPage, f1aKeywordHint, 29);
        F1ASpace(f1aSetupPage, 8);

        start.AccessibleName = Ui("开始日期", "Start date");
        end.AccessibleName = Ui("结束日期", "End date");
        var dateGroup = F1AGroup();
        AddF1ARow(dateGroup, start.AccessibleName, start, 180, 44);
        AddF1ARow(dateGroup, end.AccessibleName, end, 180, 44);
        F1AAdd(f1aSetupPage, dateGroup, 88);
        f1aDateHint = F1AText("", Muted, 16);
        F1AAdd(f1aSetupPage, f1aDateHint, 30);
        F1ASpace(f1aSetupPage, 10);
        f1aAdvanced = MakeButton("", false);
        f1aAdvanced.AccessibleName = Ui("更多设置", "More settings");
        f1aAdvanced.TextAlign = ContentAlignment.MiddleLeft;
        f1aAdvanced.Padding = new Padding(14, 0, 10, 0);
        f1aAdvanced.BackColor = GroupFill;
        f1aAdvanced.Dock = DockStyle.Fill;
        f1aAdvanced.Click += delegate { ShowF1APage(f1aSettingsPage, 0); };
        F1AAdd(f1aSetupPage, f1aAdvanced, 44);
        F1AAdd(f1aSetupPage, status, 29);

        refreshReportHeader = delegate {
            bool continuing = continuationReport.Length != 0;
            heading.Text = continuing ? Ui("继续监控", "Continue monitoring") : Ui("新建监控任务", "New monitoring task");
            intro.Text = continuing
                ? Ui("从上次报告取回关键词，可修改后继续检索。", "Restore keywords from the previous report and edit them before searching.")
                : Ui("按关键词和日期采集笔记，导出 Excel 报告。", "Collect notes by keyword and date, then export an Excel report.");
            selected.Text = continuing ? Path.GetFileName(continuationReport) : "";
            reportTip.SetToolTip(selected, selected.Text);
            reportTip.SetToolTip(importReport, latestContinuationReport == null ? "" : Path.GetFileName(latestContinuationReport));
            f1aSetupPage.RowStyles[reportRowIndex].Height = continuing ? 59 : 0;
            reportRow.Visible = continuing;
            resetTask.BackColor = continuing ? FieldFill : Color.White;
            importReport.BackColor = continuing ? Color.White : FieldFill;
            importReport.Text = importingReport ? Ui("正在读取…", "Reading…") : Ui("继续监控…", "Continue monitoring…");
            change.Enabled = !importingReport;
            resetTask.Enabled = !importingReport;
            f1aResultFollow.Enabled = !importingReport;
            run.Text = continuing ? Ui("开始续查", "Run follow-up") : Ui("开始监控", "Start monitoring");
            RefreshF1AValidation();
        };
        bool measuring = false;
        Action resize = delegate {
            if (measuring) return;
            measuring = true;
            try {
                keywordInput.RefreshAppearance();
                int lines = keyword.TextLength == 0 ? 1 : keyword.GetLineFromCharIndex(keyword.TextLength - 1) + 1;
                if (keyword.Text.EndsWith("\n", StringComparison.Ordinal)) lines++;
                var scrollbars = lines > 5 ? ScrollBars.Vertical : ScrollBars.None;
                if (keyword.ScrollBars != scrollbars) keyword.ScrollBars = scrollbars;
                f1aSetupPage.RowStyles[keywordIndex].Height = KeywordHeight + Math.Max(0, Math.Min(5, lines) - 1) * keyword.Font.Height;
            } finally { measuring = false; }
        };
        keyword.TextChanged += delegate { f1aKeywordsEdited = true; resize(); RefreshF1AValidation(); };
        keyword.SizeChanged += delegate { resize(); };
        start.ValueChanged += delegate { RefreshF1AValidation(); };
        end.ValueChanged += delegate { RefreshF1AValidation(); };
    }

    private void BuildF1ASettings(ComboBox templates, Button browse)
    {
        f1aSettingsPage = F1APage();
        var back = MakeButton(Ui("‹  设置任务", "‹  Task setup"), false);
        back.Anchor = AnchorStyles.Left;
        back.BackColor = Color.White;
        back.Click += delegate { ShowF1APage(f1aSetupPage, 0); };
        F1AAdd(f1aSettingsPage, back, 34);
        var heading = F1AText(Ui("更多设置", "More settings"), Ink);
        heading.Font = HeadingFont(18);
        F1AAdd(f1aSettingsPage, heading, 44);

        order.DropDownStyle = ComboBoxStyle.DropDownList;
        order.Items.AddRange(new object[] { Ui("最新", "Latest"), Ui("综合", "Most relevant") });
        order.SelectedIndex = 0;
        var sortButtons = F1AActions(FlowDirection.LeftToRight);
        var newest = MakeButton((string)order.Items[0], false);
        var relevant = MakeButton((string)order.Items[1], false);
        newest.Width = English ? 80 : 50;
        relevant.Width = English ? 111 : 50;
        newest.Click += delegate { order.SelectedIndex = 0; };
        relevant.Click += delegate { order.SelectedIndex = 1; };
        sortButtons.Controls.AddRange(new Control[] { newest, relevant });
        screens.DropDownStyle = ComboBoxStyle.DropDown;
        screens.Items.AddRange(new object[] { Ui("1 屏", "1 screen"), Ui("2 屏", "2 screens"), Ui("3 屏", "3 screens"), Ui("4 屏", "4 screens"), Ui("下拉到底", "Scroll to bottom") });
        screens.SelectedIndex = 4;
        screens.AccessibleName = Ui("划屏数量", "Screen count");
        F1AAdd(f1aSettingsPage, F1AText(Ui("采集", "Collection"), Muted, 16), 26);
        var collection = F1AGroup();
        AddF1ARow(collection, Ui("网页排序", "Sort results"), sortButtons, English ? 200 : 111, 38);
        AddF1ARow(collection, Ui("划屏数量", "Screen count"), screens, English ? 155 : 132, 38);
        F1AAdd(f1aSettingsPage, collection, 76);
        f1aScreenHint = F1AText("", Muted, 16);
        F1AAdd(f1aSettingsPage, f1aScreenHint, 24);

        F1AAdd(f1aSettingsPage, F1AText(Ui("报告", "Report"), Muted, 16), 22);
        var reportGroup = F1AGroup();
        AddF1ARow(reportGroup, Ui("报告生成模板", "Report template"), templates, 260, 38);
        AddF1ARow(reportGroup, Ui("Markdown · 须含「总结」「总表」「日期」", "Markdown · Includes 总结, 总表, 日期"), browse, English ? 154 : 132, 38);
        F1AAdd(f1aSettingsPage, reportGroup, 76);
        F1ASpace(f1aSettingsPage, 10);
        F1AAdd(f1aSettingsPage, F1AText(Ui("AI 分析（可选）", "AI analysis (optional)"), Muted, 16), 26);
        var ai = F1AGroup();
        AddF1ARow(ai, Ui("AI 服务商", "AI provider"), aiProvider, 160, 38);
        AddF1ARow(ai, Ui("模型（留空使用默认）", "Model (optional)"), new FieldWell(aiModel), 290, 38);
        AddF1ARow(ai, Ui("API 密钥（可选）", "API key (optional)"), new FieldWell(secret), 290, 38);
        AddF1ARow(ai, Ui("Qwen 接口地址（可选）", "Qwen endpoint (optional)"), new FieldWell(qwenEndpoint), 290, 38);
        F1AAdd(f1aSettingsPage, ai, 152);
        F1AAdd(f1aSettingsPage, F1AText(Ui("留空密钥则仅导出笔记明细。", "Leave the key blank to export notes without AI analysis."), Muted, 16), 29);
        Action summarize = delegate {
            newest.BackColor = order.SelectedIndex == 0 ? Color.White : FieldFill;
            relevant.BackColor = order.SelectedIndex == 1 ? Color.White : FieldFill;
            string templateName = templates.SelectedIndex == 0 ? Ui("内置模板", "Built-in template") : templates.Text;
            string summary = order.Text + " · " + screens.Text + " · " + templateName + "  ›";
            f1aAdvanced.Text = Ui("更多设置", "More settings");
            f1aAdvanced.AccessibleDescription = summary;
            f1aAdvanced.Invalidate();
        };
        f1aAdvanced.Paint += delegate(object sender, PaintEventArgs args) {
            TextRenderer.DrawText(args.Graphics, f1aAdvanced.AccessibleDescription, Font,
                new Rectangle(155, 0, Math.Max(1, f1aAdvanced.Width - 170), f1aAdvanced.Height), Muted,
                TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine);
        };
        order.SelectedIndexChanged += delegate { summarize(); };
        screens.TextChanged += delegate { summarize(); RefreshF1AValidation(); };
        templates.SelectedIndexChanged += delegate { summarize(); };
        summarize();
    }

    private void RefreshF1AValidation()
    {
        if (f1aScreenHint == null || f1aKeywordHint == null) return;
        DateTime from, to;
        bool hasTerms = !string.IsNullOrWhiteSpace(keyword.Text);
        bool validDates = start.TryRead(out from) && end.TryRead(out to) && from <= to;
        bool validScreens = ParseScreenCount() != null;
        ((FieldWell)keywordWell).HasError = f1aKeywordsEdited && !hasTerms;
        start.HasError = end.HasError = !validDates;
        f1aKeywordHint.Text = ((FieldWell)keywordWell).HasError ? Ui("⊗  请输入关键词。", "⊗  Enter at least one keyword.")
            : continuationReport.Length == 0
                ? Ui("多个关键词用空格分隔，例如：宝山 硚口", "Separate keywords with spaces, e.g. Baoshan Qiaokou")
                : Ui("报告已导入，可增删关键词。", "Report imported. Add or remove keywords.");
        f1aDateHint.Text = validDates ? Ui("北京时间，包含开始与结束当天。", "China time, including both dates.")
            : Ui("⊗  请确认开始日期不晚于结束日期。", "⊗  Use valid dates with the start on or before the end.");
        f1aScreenHint.Text = validScreens ? Ui("1–4 屏，或输入正整数。", "Choose 1–4 screens or enter a positive integer.")
            : Ui("⊗  划屏数量请输入正整数，或选择「下拉到底」。", "⊗  Enter a positive screen count or choose Scroll to bottom.");
        run.Enabled = !running && !importingReport && hasTerms && validDates && validScreens;
#if DISTRIBUTION
        run.Enabled = run.Enabled && licenseAllowed;
#endif
    }

    private void ResetF1ATask()
    {
        if (running || importingReport) return;
        continuationReport = "";
        keyword.Clear();
        f1aKeywordsEdited = false;
        DateTime today = DateTime.UtcNow.AddHours(8).Date;
        start.SetDate(today);
        end.SetDate(today);
        status.Text = Ui("准备就绪", "Ready");
        refreshReportHeader();
        ShowF1APage(f1aSetupPage, 0);
        keyword.Focus();
    }

    private void BuildF1ARunning()
    {
        f1aRunPage = F1APage();
        var heading = F1AText(Ui("正在采集笔记", "Collecting notes"), Ink);
        heading.Font = HeadingFont(20);
        F1AAdd(f1aRunPage, heading, 46);
        f1aRunMessage = F1AText("", Ink);
        f1aRunSummary = F1AText("", Muted);
        F1AAdd(f1aRunPage, f1aRunMessage, 29);
        F1AAdd(f1aRunPage, f1aRunSummary, 25);
        f1aProgressBar = new F1AProgressBar { Dock = DockStyle.Fill, Margin = Padding.Empty };
        F1ASpace(f1aRunPage, 10);
        F1AAdd(f1aRunPage, f1aProgressBar, 4);
        F1ASpace(f1aRunPage, 18);
        F1AAdd(f1aRunPage, F1AText(Ui("关键词", "Keywords"), Muted, 16), 25);
        f1aRunList = F1AList(() => f1aRunRows);
        F1AAdd(f1aRunPage, f1aRunList, 110);
        F1ASpace(f1aRunPage, 13);
        F1AAdd(f1aRunPage, F1AText(Ui("执行日志", "Execution log"), Muted, 16), 26);
        var logWell = new Panel { Dock = DockStyle.Fill, BackColor = GroupFill, Padding = new Padding(14, 10, 14, 10), Margin = Padding.Empty };
        Round(logWell, 12);
        logWell.Controls.Add(log);
        F1AAdd(f1aRunPage, logWell, 122);
    }

    private void BuildF1AResult()
    {
        f1aResultPage = F1APage();
        f1aResultTitle = F1AText("", Ink);
        f1aResultTitle.Font = HeadingFont(18);
        F1AAdd(f1aResultPage, f1aResultTitle, 42);
        f1aResultMeta = F1AText("", Muted);
        F1AAdd(f1aResultPage, f1aResultMeta, 45);
        f1aReportName = F1AText("", Ink);
        F1AAdd(f1aResultPage, F1ARow(f1aReportName, null, 16), 44);
        F1ASpace(f1aResultPage, 14);
        f1aResultFilter = new TextBox { AccessibleName = Ui("筛选关键词", "Filter keywords"), BackColor = FieldFill };
        f1aResultFilter.TextChanged += delegate { RefreshF1AResults(); };
        var states = F1AActions(FlowDirection.LeftToRight);
        string[] labels = { Ui("全部", "All"), Ui("失败", "Failed"), Ui("完成", "Completed") };
        for (int i = 0; i < labels.Length; i++) {
            int selected = i;
            var segment = MakeButton(labels[i], false);
            segment.Width = English ? (i == 2 ? 124 : 78) : 82;
            segment.Height = 28;
            segment.Margin = new Padding(2, 0, 0, 0);
            segment.Click += delegate { f1aResultSelection = selected; RefreshF1AResults(); };
            f1aStateButtons[i] = segment;
            states.Controls.Add(segment);
        }
        var filterWell = new FieldWell(f1aResultFilter) { Padding = new Padding(12, 9, 8, 4) };
        filterWell.SetHint(Caption(Ui("筛选关键词", "Filter keywords"), Tertiary));
        var filters = new TableLayoutPanel { Dock = DockStyle.Fill, BackColor = GroupFill, ColumnCount = 2, RowCount = 1,
            Margin = Padding.Empty, Padding = new Padding(5, 0, 5, 0) };
        filters.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        filters.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, English ? 286 : 252));
        filters.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        filterWell.Dock = DockStyle.Fill;
        states.Anchor = AnchorStyles.Right;
        filters.Controls.Add(filterWell, 0, 0);
        filters.Controls.Add(states, 1, 0);
        f1aResultFilters = filters;
        F1AAdd(f1aResultPage, f1aResultFilters, 38);
        f1aResults = F1AList(() => f1aResultRows);
        f1aResults.FirstVisibleChanged += F1AUpdateStickyGroup;
        var resultList = new TableLayoutPanel { Dock = DockStyle.Fill, BackColor = GroupFill, Margin = Padding.Empty,
            ColumnCount = 1, RowCount = 2 };
        f1aResultGroupRow = new RowStyle(SizeType.Absolute, 0);
        resultList.RowStyles.Add(f1aResultGroupRow);
        resultList.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        f1aResultGroup = F1AText("", Muted, 13);
        f1aResultGroup.BackColor = FieldFill;
        resultList.Controls.Add(f1aResultGroup, 0, 0);
        resultList.Controls.Add(f1aResults, 0, 1);
        Round(resultList, 12);
        F1AAdd(f1aResultPage, resultList, 220);
        f1aExpandResult = MakeButton("", false);
        f1aExpandResult.Width = English ? 200 : 170;
        f1aExpandResult.Anchor = AnchorStyles.Right;
        f1aExpandResult.Click += delegate { f1aExpanded = !f1aExpanded; RefreshF1AResults(); };
        F1AAdd(f1aResultPage, f1aExpandResult, 42);
        f1aOpenResult = MakeButton(Ui("打开报告", "Open report"), true);
        f1aOpenResult.Click += delegate {
            if (!File.Exists(report)) return;
            try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(report) { UseShellExecute = true }); }
            catch (Exception error) { MessageBox.Show(this, error.Message, Ui("无法打开报告", "Could not open report")); }
        };
        f1aResultNew = MakeButton(Ui("新建监控", "New task"), false);
        f1aResultNew.Click += delegate { ResetF1ATask(); };
        f1aResultFollow = MakeButton(Ui("继续监控…", "Continue monitoring…"), false);
        f1aResultFollow.Width = English ? 166 : 117;
        f1aResultFollow.Click += async delegate {
            continuationReport = "";
            ShowF1APage(f1aSetupPage, 0);
            refreshReportHeader();
            await ImportPreviousReport(refreshReportHeader);
        };
    }

    private void ShowF1APage(TableLayoutPanel page, int step)
    {
        if (page == null) return;
        f1aViewport.SuspendLayout();
        foreach (Control item in f1aViewport.Controls) item.Visible = item == page;
        f1aNoticeRow.Height = page == f1aSettingsPage ? 0 : 36;
        f1aViewport.AutoScroll = page != f1aResultPage;
        page.Visible = true;
        f1aViewport.ResumeLayout(true);
        f1aViewport.AutoScrollPosition = Point.Empty;
        page.Top = 0;
        SizeF1AResults();
        string[] steps = { Ui("设置任务", "Task setup"), Ui("执行监控", "Monitoring"), Ui("导出结果", "Export results") };
        for (int i = 0; i < steps.Length; i++) {
            f1aSteps[i].Text = (i < step ? "✓ " : (i + 1).ToString(CultureInfo.CurrentCulture) + "  ") + steps[i];
            f1aSteps[i].ForeColor = i == step ? Ink : Muted;
            f1aSteps[i].BackColor = i == step ? Color.White : FieldFill;
        }
        RemoveFooterCommands(f1aFooterStart);
        RemoveFooterCommands(f1aFooterEnd);
        if (page == f1aSettingsPage) {
            var done = MakeButton(Ui("完成", "Done"), false);
            done.Click += delegate { ShowF1APage(f1aSetupPage, 0); };
            f1aFooterEnd.Controls.Add(done);
        } else if (step == 0) {
            f1aFooterStart.Controls.Add(open);
            f1aFooterEnd.Controls.Add(run);
        } else if (step == 1) {
            f1aFooterEnd.Controls.Add(F1AStopButton());
            f1aFooterEnd.Controls.Add(F1ABackgroundButton());
        } else {
            f1aFooterStart.Controls.Add(open);
            f1aFooterEnd.Controls.Add(f1aOpenResult);
            f1aFooterEnd.Controls.Add(f1aResultFollow);
            f1aFooterEnd.Controls.Add(f1aResultNew);
        }
        AcceptButton = page == f1aSetupPage && !running ? run : null;
    }

    private void RemoveFooterCommands(FlowLayoutPanel panel)
    {
        foreach (Control item in panel.Controls.Cast<Control>().ToArray()) {
            panel.Controls.Remove(item);
            if (item != open && item != run && item != f1aOpenResult && item != f1aResultFollow && item != f1aResultNew)
                item.Dispose();
        }
    }

    private void ResetF1AProgress()
    {
        f1aTerms.Clear();
        f1aNoteCounts.Clear();
        f1aAnalysisWarning = null;
        f1aTotal = 0;
        RefreshF1ARunning();
    }

    private void ObserveF1ACount(string line)
    {
        if (!line.Contains("\"keyword_finished\"") || line.Length > 4096) return;
        Dictionary<string, object> data;
        try { data = json.Deserialize<Dictionary<string, object>>(line); }
        catch (ArgumentException) { return; }
        catch (InvalidOperationException) { return; }
        object kind, index, matched;
        if (data != null && data.TryGetValue("event", out kind) && Equals(kind, "keyword_finished") &&
            data.TryGetValue("keywordIndex", out index) && index is int && (int)index > 0 &&
            data.TryGetValue("matched", out matched) && matched is int && (int)matched >= 0)
            f1aNoteCounts[(int)index] = (int)matched;
    }

    private void ObserveF1ATerm(string line, bool started)
    {
        Match match = (started ? F1AStartTerm : F1AFinishTerm).Match(line);
        int number, total;
        if (!match.Success || !Int32.TryParse(match.Groups[1].Value, out number) ||
            !Int32.TryParse(match.Groups[2].Value, out total) || number > total ||
            (f1aTotal != 0 && total != f1aTotal)) return;
        string termName = English && !started ? match.Groups[5].Value : match.Groups[3].Value;
        F1ATerm current;
        if (!f1aTerms.TryGetValue(number, out current)) f1aTerms[number] = current = new F1ATerm(number, termName);
        if (current.Name != termName) return;
        if (!started) {
            string result = match.Groups[English ? 6 : 4].Value;
            current.Outcome = result == "完成" || result == "completed" ? "done" : "failed";
        }
        f1aTotal = total;
        RefreshF1ARunning();
    }

    private void RefreshF1ARunning()
    {
        int completed = f1aTerms.Values.Count(term => term.Outcome != null);
        f1aRunSummary.Text = f1aTotal == 0 ? Ui("正在准备任务…", "Preparing the task…")
            : String.Format(Ui("已处理 {0} / {1} 个关键词", "Processed {0} of {1} keywords"), completed, f1aTotal);
        f1aRunRows = f1aTerms.Values.ToList();
        SizeF1AList(f1aRunList, f1aRunRows.Count);
    }

    private void RenderF1AResult(string outcome)
    {
        bool available = File.Exists(report);
        f1aResultTitle.Text = outcome == "stopped" ? Ui("任务已停止", "Task stopped")
            : available ? Ui("Excel 报告已生成", "Excel report ready") : Ui("监控任务未完成", "Monitoring did not finish");
        f1aReportName.Text = available ? Path.GetFileName(report) : Ui("未生成 Excel 报告", "No Excel report was generated");
        int failed = f1aTerms.Values.Count(term => term.Outcome == "failed");
        int complete = f1aTerms.Values.Count(term => term.Outcome == "done");
        var counts = f1aTerms.Values.Where(term => term.Outcome == "done").Select(term => (long)F1AMatched(term)).ToArray();
        long? count = counts.Length != 0 && counts.All(value => value >= 0) ? (long?)counts.Sum() : null;
        string summary = f1aTotal == 0 ? status.Text : String.Format(Ui("已完成 {0} 个关键词 · 失败 {1} 个", "Completed {0} keywords · {1} failed"), complete, failed);
        if (count.HasValue) summary += String.Format(Ui(" · {0} 条关键词匹配", " · {0} keyword matches"), count.Value);
        f1aResultMeta.Text = string.IsNullOrEmpty(f1aAnalysisWarning) ? summary : summary + " · " + f1aAnalysisWarning;
        f1aResultMeta.AccessibleDescription = status.Text;
        f1aOpenResult.Enabled = available;
        f1aExpanded = false;
        f1aResultFilter.Clear();
        f1aResultSelection = 0;
        RefreshF1AResults();
        ShowF1APage(f1aResultPage, 2);
        {
            var details = MakeButton(Ui("执行日志", "Execution log"), false);
            details.Click += delegate {
                ShowF1APage(f1aRunPage, 1);
                var back = MakeButton(Ui("返回结果", "Back to results"), false);
                back.Click += delegate { ShowF1APage(f1aResultPage, 2); };
                f1aFooterEnd.Controls.Add(back);
            };
            f1aFooterStart.Controls.Add(details);
        }
    }

    private void RefreshF1AResults()
    {
        if (f1aResults == null || f1aExpandResult == null) return;
        bool many = f1aTotal >= 7;
        var failed = f1aTerms.Values.Where(term => term.Outcome == "failed").ToArray();
        var completed = f1aTerms.Values.Where(term => term.Outcome == "done")
            .OrderByDescending(term => F1AMatched(term)).ThenBy(term => term.Index).ToArray();
        if (many && !f1aExpanded) {
            f1aResultRows = failed.Take(3).Concat(completed.Where(term => F1AMatched(term) >= 0).Take(3)).ToList();
        } else {
            string filter = f1aResultFilter.Text.Trim();
            f1aResultRows = new List<F1ATerm>();
            if (f1aResultSelection != 2) AddF1AResultGroup(failed, filter, Ui("失败", "Failed"));
            if (f1aResultSelection != 1) AddF1AResultGroup(completed, filter, Ui("完成", "Completed"));
        }
        int[] counts = { failed.Length + completed.Length, failed.Length, completed.Length };
        string[] labels = { Ui("全部", "All"), Ui("失败", "Failed"), Ui("完成", "Completed") };
        for (int i = 0; i < f1aStateButtons.Length; i++) {
            var button = f1aStateButtons[i];
            button.Text = labels[i] + " " + counts[i];
            button.BackColor = f1aResultSelection == i ? Color.White : FieldFill;
            button.AccessibleDescription = f1aResultSelection == i ? Ui("已选中", "Selected") : "";
        }
        f1aResultFilters.Visible = many && f1aExpanded;
        f1aResultGroup.Visible = f1aExpanded;
        f1aResultGroupRow.Height = f1aExpanded ? 26 : 0;
        if (f1aResultRows.Count == 0) f1aResultGroup.Text = Ui("没有匹配的关键词。", "No matching keywords.");
        f1aResultPage.RowStyles[4].Height = many && f1aExpanded ? 38 : 0;
        f1aExpandResult.Visible = many;
        f1aExpandResult.Text = f1aExpanded ? Ui("收起", "Collapse")
            : String.Format(Ui("显示全部 {0} 个关键词 ›", "Show all {0} keywords ›"), f1aTotal);
        SizeF1AList(f1aResults, f1aResultRows.Count);
        if (f1aResultRows.Count > 0) f1aResults.EnsureVisible(0);
        F1AUpdateStickyGroup(0);
        SizeF1AResults();
    }

    private void AddF1AResultGroup(IEnumerable<F1ATerm> group, string filter, string caption)
    {
        var visible = group.Where(term => term.Name.IndexOf(filter, StringComparison.CurrentCultureIgnoreCase) >= 0).ToArray();
        if (visible.Length == 0) return;
        if (f1aExpanded && f1aResultRows.Count != 0)
            f1aResultRows.Add(new F1ATerm(0, caption + " · " + visible.Length));
        f1aResultRows.AddRange(visible);
    }

    private void F1AUpdateStickyGroup(int topIndex)
    {
        if (!f1aExpanded || topIndex < 0 || topIndex >= f1aResultRows.Count) return;
        var top = f1aResultRows[topIndex];
        if (top.IsGroup) { f1aResultGroup.Text = top.Name; return; }
        int groupCount = f1aResultRows.Count(term => term.Outcome == top.Outcome);
        f1aResultGroup.Text = (top.Outcome == "failed" ? Ui("失败", "Failed") : Ui("完成", "Completed")) + " · " + groupCount;
    }

    private void SizeF1AResults()
    {
        if (f1aResultPage == null || f1aResultPage.RowStyles.Count < 7) return;
        int rows = Math.Max(1, f1aResultRows.Count);
        int listHeight = rows * 36 + 4 + (f1aExpanded ? 26 : 0);
        int fixedRows = (int)f1aResultPage.RowStyles.Cast<RowStyle>().Where((style, index) => index != 5).Sum(style => style.Height);
        int room = Math.Max(80, f1aViewport.ClientSize.Height - fixedRows - f1aResultPage.Padding.Vertical);
        f1aResultPage.RowStyles[5].Height = Math.Min(listHeight, Math.Min(room, 286));
    }

    private int F1AMatched(F1ATerm term)
    {
        int value;
        return f1aNoteCounts.TryGetValue(term.Index, out value) ? value : -1;
    }

    private F1AVirtualList F1AList(Func<List<F1ATerm>> source)
    {
        var list = new F1AVirtualList { Dock = DockStyle.Fill, Margin = Padding.Empty, BorderStyle = BorderStyle.None,
            BackColor = GroupFill, ForeColor = Ink, FullRowSelect = true, MultiSelect = false, HeaderStyle = ColumnHeaderStyle.None,
            View = View.Details, VirtualMode = true, AccessibleName = Ui("关键词状态", "Keyword states") };
        var rowImages = new ImageList { ImageSize = new Size(7, 34) };
        list.SmallImageList = rowImages;
        var image = new Bitmap(7, 34);
        rowImages.Images.Add(image);
        list.Disposed += delegate { rowImages.Dispose(); image.Dispose(); };
        list.Columns.Add(Ui("关键词", "Keyword"));
        list.Columns.Add(Ui("状态", "Status"), 165, HorizontalAlignment.Right);
        list.Resize += delegate { list.Columns[0].Width = Math.Max(80, list.ClientSize.Width - 185); };
        list.RetrieveVirtualItem += delegate(object sender, RetrieveVirtualItemEventArgs args) {
            var rows = source();
            if (args.ItemIndex < 0 || args.ItemIndex >= rows.Count) {
                args.Item = new ListViewItem(new[] { "", "" });
                return;
            }
            F1ATerm item = rows[args.ItemIndex];
            if (item.IsGroup) {
                args.Item = new ListViewItem(new[] { item.Name, "" }) { BackColor = FieldFill, ForeColor = Muted, ImageIndex = 0 };
                return;
            }
            string symbol = item.Outcome == "done" ? "✓  " : item.Outcome == "failed" ? "×  " : "◌  ";
            int count = F1AMatched(item);
            string note = item.Outcome == "failed" ? Ui("失败 · 见日志", "Failed · See log")
                : item.Outcome == null ? Ui("执行中", "Running")
                    : count >= 0 ? String.Format(Ui("已完成 · {0} 条", count == 1 ? "Done · {0} note" : "Done · {0} notes"), count)
                        : Ui("已完成", "Done");
            args.Item = new ListViewItem(new[] { symbol + item.Name, note }, 0) { UseItemStyleForSubItems = false };
            args.Item.SubItems[1].ForeColor = Muted;
        };
        return list;
    }

    private sealed class F1AVirtualList : ListView
    {
        private const int FirstListViewRow = 0x1000 + 39;
        internal event Action<int> FirstVisibleChanged;

        [DllImport("user32.dll", EntryPoint = "SendMessageW")]
        private static extern IntPtr SendListMessage(IntPtr handle, int message, IntPtr wParam, IntPtr lParam);

        protected override void WndProc(ref Message message)
        {
            base.WndProc(ref message);
            if (FirstVisibleChanged != null && IsHandleCreated && VirtualListSize > 0 &&
                (message.Msg == 0x115 || message.Msg == 0x20A || message.Msg == 0x101))
                FirstVisibleChanged(SendListMessage(Handle, FirstListViewRow, IntPtr.Zero, IntPtr.Zero).ToInt32());
        }
    }

    private static void SizeF1AList(ListView list, int count)
    {
        list.VirtualListSize = count;
        list.Invalidate();
    }

    private TableLayoutPanel F1APage()
    {
        var page = F1AGroup();
        page.BackColor = Color.White;
        page.Padding = new Padding(0, 16, 0, 8);
        page.Width = 600;
        page.MinimumSize = new Size(600, 0);
        page.Visible = false;
        f1aViewport.Controls.Add(page);
        return page;
    }

    private static TableLayoutPanel F1AGroup()
    {
        var table = new TableLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, ColumnCount = 1,
            Margin = Padding.Empty, BackColor = GroupFill };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        return table;
    }

    private static int F1AAdd(TableLayoutPanel table, Control item, int height)
    {
        int row = table.RowCount++;
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
        item.Margin = Padding.Empty;
        if (item.Dock == DockStyle.None && item.Anchor == (AnchorStyles.Top | AnchorStyles.Left)) item.Dock = DockStyle.Fill;
        table.Controls.Add(item, 0, row);
        return row;
    }

    private static void F1ASpace(TableLayoutPanel table, int height)
    {
        table.RowCount++;
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
    }

    private static Label F1AText(string text, Color color, int inset = 0)
    {
        return new Label { Text = text, ForeColor = color, Dock = DockStyle.Fill, AutoEllipsis = true, Margin = Padding.Empty,
            Padding = new Padding(inset, 0, 0, 0), TextAlign = ContentAlignment.MiddleLeft, UseMnemonic = false };
    }

    private static FlowLayoutPanel F1AActions(FlowDirection direction)
    {
        return new FlowLayoutPanel { WrapContents = false, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink,
            FlowDirection = direction, Margin = Padding.Empty };
    }

    private static Panel F1ARow(Control leading, Control trailing, int inset)
    {
        var row = new Panel { Dock = DockStyle.Fill, Margin = Padding.Empty, Padding = new Padding(inset, 0, inset, 0), BackColor = GroupFill };
        leading.Dock = DockStyle.Fill;
        row.Controls.Add(leading);
        if (trailing != null) {
            var end = new Panel { Dock = DockStyle.Right, Width = Math.Max(trailing.Width, 112), Margin = Padding.Empty };
            trailing.Anchor = AnchorStyles.None;
            end.Resize += delegate { trailing.Location = new Point(end.Width - trailing.Width, (end.Height - trailing.Height) / 2); };
            end.Controls.Add(trailing);
            row.Controls.Add(end);
            end.BringToFront();
        }
        Round(row, 12);
        return row;
    }

    private void AddF1ARow(TableLayoutPanel group, string caption, Control field, int width, int height)
    {
        field.Width = width;
        if (field is FieldWell) field.Height = Math.Min(37, height - 3);
        if (string.IsNullOrEmpty(field.AccessibleName)) field.AccessibleName = caption;
        var row = F1ARow(F1AText(caption, Ink), field, 16);
        row.Region = null;
        if (group.RowCount != 0) row.Paint += delegate(object sender, PaintEventArgs args) {
            using (var pen = new Pen(FieldEdge)) args.Graphics.DrawLine(pen, 16, 0, row.Width, 0);
        };
        F1AAdd(group, row, height);
        group.Dock = DockStyle.Fill;
        Round(group, 12);
    }

    private Image F1AImage(string name, int size = 22)
    {
        Image result;
        string key = name + size;
        if (f1aImages.TryGetValue(key, out result)) return result;
        using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("f1a." + name + ".png")) {
            if (stream == null) return null;
            using (var source = Image.FromStream(stream)) result = new Bitmap(source, size, size);
        }
        f1aImages[key] = result;
        return result;
    }

    private sealed class F1AKeywordWell : FieldWell
    {
        private readonly Panel chips = new Panel { TabStop = false, BackgroundImageLayout = ImageLayout.None };

        internal F1AKeywordWell(TextBox editor) : base(editor)
        {
            chips.AccessibleRole = AccessibleRole.None;
            chips.Cursor = Cursors.IBeam;
            chips.BackColor = FieldFill;
            chips.Paint += DrawChips;
            chips.MouseDown += delegate {
                Editor.Focus();
                Editor.SelectionStart = Editor.TextLength;
            };
            Controls.Add(chips);
            chips.BringToFront();
            Editor.Enter += delegate { RefreshChips(); };
            Editor.Leave += delegate { RefreshChips(); };
            Editor.TextChanged += delegate { RefreshChips(); };
            Layout += delegate { RefreshChips(); };
        }

        private void RefreshChips()
        {
            if (chips == null || !IsHandleCreated) return;
            chips.Bounds = Editor.Bounds;
            chips.Visible = !Editor.Focused && !string.IsNullOrWhiteSpace(Editor.Text)
                && Editor.ScrollBars == ScrollBars.None;
            if (chips.Visible) chips.Invalidate();
        }

        private void DrawChips(object sender, PaintEventArgs args)
        {
            args.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            int x = 0, y = 0;
            int lineHeight = Editor.Font.Height + 5;
            foreach (Match token in Regex.Matches(Editor.Text, @"\S+")) {
                int width = Math.Min(chips.Width, TextRenderer.MeasureText(token.Value, Editor.Font).Width + 15);
                if (x != 0 && x + width > chips.Width) { x = 0; y += lineHeight + 2; }
                if (y >= chips.Height || width < 4) break;
                var bounds = new Rectangle(x, y, width, lineHeight);
                using (var shape = RoundedPath(bounds, 8))
                using (var back = new SolidBrush(Color.White)) args.Graphics.FillPath(back, shape);
                TextRenderer.DrawText(args.Graphics, token.Value, Editor.Font, bounds, Ink,
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter |
                    TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
                x += width + 5;
            }
        }
    }
}
