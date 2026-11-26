using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

internal sealed partial class Desktop
{
    private readonly Timer activityTimer = new Timer { Interval = 33 };
    private readonly Stopwatch activityClock = Stopwatch.StartNew();

    private void InitializeActivity()
    {
        activityTimer.Tick += delegate { UpdateActivity(); };
        FormClosed += delegate { activityTimer.Dispose(); };
    }

    private void UpdateActivity()
    {
        if (IsDisposed) return;
        bool active = running && !cancelRequested && pendingPrompt == null;
        double phase = active && SystemInformation.UIEffectsEnabled ? (activityClock.ElapsedMilliseconds % 1600) / 1600.0 : 0.5;
        if (f1aProgressBar != null && f1aProgressBar.Visible) f1aProgressBar.UpdatePhase(phase);
        if (f1aCompactBar != null && f1aCompactBar.Visible) f1aCompactBar.UpdatePhase(phase);
    }

    private sealed class F1AProgressBar : Panel
    {
        private double phase = 0.5;
        internal F1AProgressBar() { DoubleBuffered = true; AccessibleRole = AccessibleRole.ProgressBar; }
        internal void UpdatePhase(double value) { if (phase != value) { phase = value; Invalidate(); } }

        protected override void OnPaint(PaintEventArgs args)
        {
            base.OnPaint(args);
            if (Width < 4 || Height < 2) return;
            args.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (var track = RoundedPath(new RectangleF(0, 0, Width, Height), Height / 2f))
            using (var rail = new SolidBrush(FieldEdge)) {
                args.Graphics.FillPath(rail, track);
                args.Graphics.SetClip(track);
                int span = Math.Max(30, Width * 3 / 7);
                int left = (int)((Width + span) * phase) - span;
                using (var gradient = new LinearGradientBrush(new Rectangle(left, 0, span, Height), FieldEdge, FieldEdge,
                    LinearGradientMode.Horizontal)) {
                    gradient.InterpolationColors = new ColorBlend {
                        Colors = new[] { FieldEdge, FocusEdge, FieldEdge },
                        Positions = new[] { 0f, 0.55f, 1f }
                    };
                    args.Graphics.FillRectangle(gradient, left, 0, span, Height);
                }
            }
        }
    }

    private Button F1ABackgroundButton()
    {
        var button = MakeButton(Ui("后台执行", "Run in background"), false);
        button.Image = F1AImage("tray", 15);
        button.TextImageRelation = TextImageRelation.ImageBeforeText;
        button.Width = English ? 157 : 130;
        button.Click += delegate { if (running) HideToTray(); };
        button.Enabled = running;
        return button;
    }

    private Button F1AStopButton()
    {
        var stop = MakeButton(Ui("停止任务", "Stop task"), false);
        stop.Image = F1AImage("stop", 15);
        stop.TextImageRelation = TextImageRelation.ImageBeforeText;
        stop.Click += delegate { ConfirmStop(false); };
        stop.Enabled = running && !cancelRequested;
        return stop;
    }

    private void CreateCompactView()
    {
        compactView = new TableLayoutPanel { Dock = DockStyle.Fill, Visible = false, ColumnCount = 2, RowCount = 6,
            Padding = new Padding(18, 6, 18, 8), Margin = Padding.Empty };
        compactView.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        compactView.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        foreach (int height in new[] { 38, 35, 5, 4 }) compactView.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
        compactView.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        compactView.RowStyles.Add(new RowStyle(SizeType.Absolute, 43));

        var mark = new PictureBox { Image = F1AImage("logo", 18), SizeMode = PictureBoxSizeMode.Zoom, Dock = DockStyle.Left, Width = 18 };
        var heading = F1AText(Ui("监控进度", "Monitoring progress"), Ink, 8);
        heading.Font = HeadingFont(10);
        var identity = new Panel { Dock = DockStyle.Fill, Margin = Padding.Empty };
        identity.Controls.Add(heading);
        identity.Controls.Add(mark);
        mark.BringToFront();
        compactView.Controls.Add(identity, 0, 0);
        var details = MakeButton(Ui("任务详情 ›", "Task details ›"), false);
        details.BackColor = Color.White;
        details.Anchor = AnchorStyles.Right;
        details.Width = English ? 109 : 88;
        details.Click += delegate {
            RestoreSetupView();
            ShowF1APage(f1aRunPage, 1);
        };
        compactView.Controls.Add(details, 1, 0);
        compactProgress = F1AText("", Ink);
        compactProgress.Font = HeadingFont(12);
        compactView.Controls.Add(compactProgress, 0, 1);
        compactView.SetColumnSpan(compactProgress, 2);
        f1aCompactBar = new F1AProgressBar { Dock = DockStyle.Fill, Margin = Padding.Empty };
        compactView.Controls.Add(f1aCompactBar, 0, 3);
        compactView.SetColumnSpan(f1aCompactBar, 2);
        var background = F1ABackgroundButton();
        var stop = F1AStopButton();
        background.Enabled = stop.Enabled = true;
        background.Dock = stop.Dock = DockStyle.Fill;
        background.Margin = new Padding(0, 4, 4, 4);
        stop.Margin = new Padding(4, 4, 0, 4);
        compactView.Controls.Add(background, 0, 5);
        compactView.Controls.Add(stop, 1, 5);
        Controls.Add(compactView);
    }

    private Form F1ADialog(string title, string message, string acceptText, string dismissText, bool destructive)
    {
        var dialog = new Form { Text = title, ClientSize = new Size(380, 200), StartPosition = FormStartPosition.CenterParent,
            Font = Font, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false,
            ShowInTaskbar = false, BackColor = Color.White, ForeColor = Ink, Icon = Icon };
        var body = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3, Padding = new Padding(18) };
        body.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));
        body.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        body.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
        var heading = F1AText(title, Ink);
        heading.Font = HeadingFont(13);
        body.Controls.Add(heading, 0, 0);
        var description = F1AText(message, Muted);
        description.TextAlign = ContentAlignment.TopLeft;
        body.Controls.Add(description, 0, 1);
        var buttons = F1AActions(FlowDirection.RightToLeft);
        buttons.Dock = DockStyle.Fill;
        var accept = MakeButton(acceptText, true);
        accept.DialogResult = DialogResult.OK;
        if (destructive) accept.AccessibleDescription = Ui("确认停止后无法撤销", "Confirms stopping this run");
        buttons.Controls.Add(accept);
        dialog.AcceptButton = accept;
        if (dismissText != null) {
            var cancel = MakeButton(dismissText, false);
            cancel.Width = English ? 145 : 117;
            cancel.DialogResult = DialogResult.Cancel;
            buttons.Controls.Add(cancel);
            dialog.CancelButton = cancel;
            if (destructive) dialog.Shown += delegate { cancel.Focus(); };
        }
        body.Controls.Add(buttons, 0, 2);
        dialog.Controls.Add(body);
        return dialog;
    }

    private sealed class F1AShade : Form
    {
        internal F1AShade(Rectangle bounds)
        {
            Bounds = bounds;
            StartPosition = FormStartPosition.Manual;
            BackColor = Ink;
            Opacity = 0.14;
            ShowInTaskbar = false;
            FormBorderStyle = FormBorderStyle.None;
        }

        protected override bool ShowWithoutActivation { get { return true; } }
    }
}
