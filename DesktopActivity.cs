using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal sealed partial class Desktop
{
    private readonly Timer activityTimer = new Timer { Interval = 115 };
    private PictureBox activityPicture;
    private Bitmap activityCover;
    private Bitmap[] pawFrames;
    private Icon[] activityIcons;
    private Icon staticWindowIcon;
    private Icon staticTrayIcon;
    private int activityFrame;

    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr handle);

    private void InitializeActivity(PictureBox picture)
    {
        activityPicture = picture;
        activityCover = (Bitmap)picture.Image;
        activityTimer.Tick += delegate {
            if (running && !cancelRequested && pendingPrompt == null) activityFrame = (activityFrame + 1) % 24;
            UpdateActivity();
        };
        FormClosed += delegate {
            activityTimer.Stop();
            activityTimer.Dispose();
            Icon = staticWindowIcon;
            tray.Icon = staticTrayIcon;
            if (pawFrames != null) foreach (Bitmap frame in pawFrames) if (frame != null) frame.Dispose();
            if (activityIcons != null) foreach (Icon icon in activityIcons) if (icon != null) icon.Dispose();
            activityPicture.Image = null;
            activityCover.Dispose();
        };
    }

    private void UpdateActivity()
    {
        if (activityPicture == null || IsDisposed || tray.Icon == null) return;
        if (staticTrayIcon == null) {
            staticWindowIcon = Icon;
            staticTrayIcon = tray.Icon;
        }
        bool active = running && !cancelRequested && pendingPrompt == null;
        if (!active) activityFrame = 0;
        if (active && Visible) {
            if (pawFrames == null) pawFrames = new Bitmap[8];
            int index = activityFrame % pawFrames.Length;
            if (pawFrames[index] == null) {
                double phase = (1 - Math.Cos(index * 2 * Math.PI / pawFrames.Length)) / 2;
                pawFrames[index] = CreatePawFrame(activityCover, phase);
            }
            activityPicture.Image = pawFrames[index];
        } else {
            activityPicture.Image = activityCover;
        }
        bool animateWindow = active && compactView.Visible;
        bool animateTray = active && !Visible;
        Icon frameIcon = null;
        if (animateWindow || animateTray) {
            if (activityIcons == null) {
                activityIcons = new[] {
                    CreateActivityIcon(activityCover, Color.FromArgb(71, 142, 255)),
                    CreateActivityIcon(activityCover, Color.FromArgb(166, 117, 255)),
                    CreateActivityIcon(activityCover, Color.FromArgb(50, 217, 189)),
                };
            }
            frameIcon = activityIcons[(activityFrame / 2) % activityIcons.Length];
        }
        var windowIcon = animateWindow ? frameIcon : staticWindowIcon;
        var trayIcon = animateTray ? frameIcon : staticTrayIcon;
        if (Icon != windowIcon) Icon = windowIcon;
        if (tray.Icon != trayIcon) tray.Icon = trayIcon;
    }

    private static Bitmap CreatePawFrame(Bitmap cover, double phase)
    {
        var frame = new Bitmap(cover);
        WarpPaw(cover, frame, 0.30, 0.49, -1, phase);
        WarpPaw(cover, frame, 0.76, 0.50, 1, phase);
        return frame;
    }

    private static void WarpPaw(Bitmap source, Bitmap target, double horizontal, double vertical, int direction, double phase)
    {
        double cx = source.Width * horizontal, cy = source.Height * vertical;
        double rx = source.Width * 0.11, ry = source.Height * 0.15;
        for (int y = Math.Max(0, (int)(cy - ry)); y <= Math.Min(source.Height - 1, cy + ry); y++) {
            for (int x = Math.Max(0, (int)(cx - rx)); x <= Math.Min(source.Width - 1, cx + rx); x++) {
                double dx = x - cx, dy = y - cy;
                double fade = Math.Max(0, 1 - dx * dx / (rx * rx) - dy * dy / (ry * ry));
                if (fade <= 0) continue;
                double motion = phase * fade * fade;
                int sx = (int)Math.Round(x - motion * (direction * source.Width * 0.025 + dx * 0.18));
                int sy = (int)Math.Round(y + motion * (source.Height * 0.035 - dy * 0.18));
                target.SetPixel(x, y, source.GetPixel(sx, sy));
            }
        }
    }

    private static Icon CreateActivityIcon(Bitmap cover, Color color)
    {
        using (var bitmap = new Bitmap(32, 32))
        using (var graphics = Graphics.FromImage(bitmap))
        using (var ring = new Pen(color, 3)) {
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            using (var clip = new GraphicsPath()) {
                clip.AddEllipse(3, 3, 26, 26);
                graphics.SetClip(clip);
                graphics.DrawImage(cover, 2, 2, 28, 28);
                graphics.ResetClip();
            }
            graphics.DrawEllipse(ring, 2, 2, 27, 27);
            IntPtr handle = bitmap.GetHicon();
            try { return (Icon)Icon.FromHandle(handle).Clone(); }
            finally { DestroyIcon(handle); }
        }
    }
}
