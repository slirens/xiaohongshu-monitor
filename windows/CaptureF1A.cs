using System;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal static class CaptureF1A
{
    private static Type desktop;
    private const BindingFlags Instance = BindingFlags.Instance | BindingFlags.NonPublic;
    [DllImport("user32.dll")]
    private static extern bool PrintWindow(IntPtr window, IntPtr deviceContext, uint flags);

    [STAThread]
    private static int Main(string[] args)
    {
        CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo(args[1]);
        Directory.CreateDirectory(args[2]);
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        desktop = Assembly.LoadFrom(args[0]).GetType("Desktop", true);
        using (var window = (Form)Activator.CreateInstance(desktop, true)) {
            window.MaximizeBox = false;
            window.FormBorderStyle = FormBorderStyle.FixedSingle;
            window.Show();
            string fixture = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N") + ".xlsx");
            File.WriteAllBytes(fixture, new byte[0]);
            try {
                foreach (var size in new[] { new Size(1080, 660), new Size(880, 590) }) {
                    RestoreSize(window, size);
                    string folder = Path.Combine(args[2], size.Width + "x" + size.Height, args[1]);
                    Directory.CreateDirectory(folder);
                    Capture(window, folder, fixture, size);
                }
            } finally { File.Delete(fixture); }
        }
        return 0;
    }

    private static void Capture(Form window, string folder, string fixture, Size size)
    {
        bool english = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName != "zh";
        var terms = Field<TextBox>(window, "keyword");
        var start = Field<Control>(window, "start");
        var end = Field<Control>(window, "end");
        Call(window, "ResetF1ATask");
        terms.Text = english ? "Museum Park" : "博物馆 公园";
        terms.Focus();
        CaptureBitmap(window, folder, "FA-01");
        Set(window, "continuationReport", fixture);
        Field<Action>(window, "refreshReportHeader")();
        CaptureBitmap(window, folder, "FA-02");
        Call(window, "ShowF1APage", Field<Control>(window, "f1aSettingsPage"), 0);
        CaptureBitmap(window, folder, "FA-03");
        Call(window, "ShowF1APage", Field<Control>(window, "f1aSetupPage"), 0);
        Call(start, "SetDate", DateTime.Today.AddDays(1));
        Call(end, "SetDate", DateTime.Today);
        CaptureBitmap(window, folder, "FA-04");
        if (Field<Button>(window, "run").Enabled) throw new InvalidOperationException("Invalid date left Start enabled.");
        Call(start, "SetDate", DateTime.Today);

        Set(window, "running", true);
        Call(window, "ResetF1AProgress");
        Replay(window, english, 2, 1);
        Call(window, "ObserveF1ATerm", english ? "Starting keyword 2/2: Park" : "开始关键词 2/2：公园", true);
        Call(window, "SetLiveProgress", english ? "Scanning Park · Screen 2" : "扫描「公园」 · 第 2 屏");
        Call(window, "ShowF1APage", Field<Control>(window, "f1aRunPage"), 1);
        CaptureBitmap(window, folder, window.ClientSize.Width == 880 ? "FA-09" : "FA-06");
        Prompt(window, english, false, folder, "FA-05", size);
        RestoreSize(window, size);
        Call(window, "ShowCompactView");
        Size compactSize = new Size(440, 245);
        window.ClientSize = compactSize;
        var compact = Field<Control>(window, "compactView");
        window.PerformLayout();
        compact.PerformLayout();
        compact.Refresh();
        if (!compact.Visible || Field<Control>(window, "setupView").Visible || compact.Width != compactSize.Width)
            throw new InvalidOperationException("The compact window did not render at the requested size.");
        CaptureBitmap(compact, folder, "FA-10");
        Prompt(window, english, false, folder, "FA-11", compactSize);
        Prompt(window, english, true, folder, "FA-12", compactSize);
        Call(window, "RestoreSetupView");
        RestoreSize(window, size);

        Set(window, "running", false);
        Set(window, "report", fixture);
        Call(window, "ResetF1AProgress");
        Replay(window, english, 2, 2);
        Call(window, "RenderF1AResult", "completed");
        CaptureBitmap(window, folder, "FA-07");
        Call(window, "ResetF1AProgress");
        Replay(window, english, 200, 200, 2);
        Call(window, "RenderF1AResult", "completed");
        CaptureBitmap(window, folder, "FA-07b");
        Field<Button>(window, "f1aExpandResult").PerformClick();
        if (Field<ListView>(window, "f1aResults").VirtualListSize != 201)
            throw new InvalidOperationException("The 200-keyword result list did not expand into two groups.");
        Call(window, "F1AUpdateStickyGroup", 0);
        if (!Field<Label>(window, "f1aResultGroup").Text.Contains(english ? "Failed" : "失败"))
            throw new InvalidOperationException("The failed group was not shown first.");
        CaptureBitmap(window, folder, "FA-07c");
        Field<TextBox>(window, "f1aResultFilter").Text = "19";
        if (Field<ListView>(window, "f1aResults").VirtualListSize != 12)
            throw new InvalidOperationException("Keyword filtering used an incorrect result set.");
        var resizedList = Field<ListView>(window, "f1aResults");
        var outdatedRow = new RetrieveVirtualItemEventArgs(199);
        typeof(ListView).GetMethod("OnRetrieveVirtualItem", Instance).Invoke(resizedList, new object[] { outdatedRow });
        if (outdatedRow.Item.SubItems.Count != resizedList.Columns.Count)
            throw new InvalidOperationException("A native redraw from the previous virtual size lost a column.");
        Call(window, "ResetF1AProgress");
        Replay(window, english, 3, 3, 2);
        Set(window, "f1aAnalysisWarning", english ? "AI analysis did not finish" : "AI 分析未完整");
        Call(window, "RenderF1AResult", "partial");
        CaptureBitmap(window, folder, "FA-08");
        Set(window, "report", null);
    }

    private static void Replay(Form window, bool english, int total, int count, int failure = 0)
    {
        for (int i = 1; i <= count; i++) {
            string word = (english ? "Keyword " : "关键词 ") + i;
            string number = i + "/" + total;
            Call(window, "ObserveF1ATerm", english ? "Starting keyword " + number + ": " + word : "开始关键词 " + number + "：" + word, true);
            if (failure != i)
                Call(window, "ObserveF1ACount", "{\"event\":\"keyword_finished\",\"keywordIndex\":" + i + ",\"matched\":" + i + "}");
            Call(window, "ObserveF1ATerm", english ? number + " processed · “" + word + "” " + (i == failure ? "failed" : "completed")
                : number + " 已处理 · 「" + word + "」" + (i == failure ? "失败" : "完成"), false);
        }
    }

    private static void Prompt(Form window, bool english, bool stop, string folder, string name, Size expected)
    {
        string heading = stop ? (english ? "Stop the current task?" : "停止当前任务？") : (english ? "Sign in to Xiaohongshu" : "登录小红书");
        string detail = stop ? "" : (english ? "Complete verification in the browser, then continue." : "请在浏览器完成登录或验证，再返回继续。");
        string accept = stop ? (english ? "Stop task" : "停止任务") : (english ? "Continue" : "继续");
        string dismiss = stop ? (english ? "Keep running" : "继续运行") : (english ? "End task" : "结束任务");
        using (var dialog = (Form)Call(window, "F1ADialog", heading, detail, accept, dismiss, stop)) {
            dialog.Shown += delegate {
                if (window.ClientSize != expected) window.ClientSize = expected;
                Control owner = expected.Width == 440 ? Field<Control>(window, "compactView") : (Control)window;
                using (var bitmap = Draw(owner)) {
                    using (var child = Draw(dialog))
                    using (var painter = Graphics.FromImage(bitmap))
                    {
                        painter.DrawImageUnscaled(child, (bitmap.Width - child.Width) / 2, (bitmap.Height - child.Height) / 2);
                    }
                    bitmap.Save(Path.Combine(folder, name + ".png"));
                }
                dialog.Close();
            };
            dialog.ShowDialog(window);
        }
    }

    private static Bitmap Draw(Control window)
    {
        window.Update();
        var bitmap = new Bitmap(window.ClientSize.Width, window.ClientSize.Height);
        using (var painter = Graphics.FromImage(bitmap)) {
            painter.Clear(Color.White);
            IntPtr target = painter.GetHdc();
            try {
                if (!PrintWindow(window.Handle, target, 3)) throw new InvalidOperationException("Could not capture the window.");
            } finally { painter.ReleaseHdc(target); }
        }
        return bitmap;
    }

    private static void RestoreSize(Form window, Size size)
    {
        window.WindowState = FormWindowState.Normal;
        window.ClientSize = size;
        window.Location = Screen.PrimaryScreen.WorkingArea.Location;
        Application.DoEvents();
        window.ClientSize = size;
    }

    private static void CaptureBitmap(Control window, string folder, string name)
    {
        using (var image = Draw(window)) image.Save(Path.Combine(folder, name + ".png"));
    }

    private static T Field<T>(object instance, string name) { return (T)desktop.GetField(name, Instance).GetValue(instance); }
    private static void Set(object instance, string name, object value) { desktop.GetField(name, Instance).SetValue(instance, value); }
    private static object Call(object instance, string name, params object[] arguments) {
        return instance.GetType().GetMethod(name, Instance | BindingFlags.Public).Invoke(instance, arguments);
    }
}
