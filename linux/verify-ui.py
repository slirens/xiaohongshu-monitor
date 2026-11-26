"""Exercise the installed or source Tk interface with an isolated fixture."""

import argparse
from ctypes import CDLL, POINTER, Structure, c_char_p, c_int, c_uint, c_ulong, c_void_p, string_at
from pathlib import Path
from struct import pack
import sys
from tempfile import TemporaryDirectory
import tkinter as tk
from tkinter import ttk
import zlib


class XImage(Structure):
    _fields_ = (
        ("width", c_int), ("height", c_int), ("xoffset", c_int), ("format", c_int),
        ("data", c_void_p), ("byte_order", c_int), ("bitmap_unit", c_int),
        ("bitmap_bit_order", c_int), ("bitmap_pad", c_int), ("depth", c_int),
        ("bytes_per_line", c_int), ("bits_per_pixel", c_int), ("red_mask", c_ulong),
        ("green_mask", c_ulong), ("blue_mask", c_ulong),
    )


def capture(window, path):
    """Save the actual X11 client area, including any visible modal child."""
    lib = CDLL("libX11.so.6")
    lib.XOpenDisplay.argtypes, lib.XOpenDisplay.restype = [c_char_p], c_void_p
    lib.XDefaultRootWindow.argtypes, lib.XDefaultRootWindow.restype = [c_void_p], c_ulong
    lib.XGetImage.argtypes = [c_void_p, c_ulong, c_int, c_int, c_uint, c_uint, c_ulong, c_int]
    lib.XGetImage.restype = POINTER(XImage)
    lib.XDestroyImage.argtypes = [POINTER(XImage)]
    lib.XCloseDisplay.argtypes = [c_void_p]
    display = lib.XOpenDisplay(None)
    if not display:
        raise RuntimeError("An X11 display is required for Linux screenshot capture.")
    try:
        w, h = window.winfo_width(), window.winfo_height()
        image = lib.XGetImage(display, lib.XDefaultRootWindow(display), window.winfo_rootx(),
                              window.winfo_rooty(), w, h, c_ulong(-1), 2)
        if not image:
            raise RuntimeError("X11 could not capture the application window.")
        try:
            pixels = image.contents
            assert (pixels.bits_per_pixel, pixels.byte_order, pixels.red_mask, pixels.green_mask, pixels.blue_mask
                    ) == (32, 0, 0xff0000, 0x00ff00, 0x0000ff), "Use a 24-bit X11 fixture display."
            data = string_at(pixels.data, pixels.bytes_per_line * h)
            rows = bytearray((3 * w + 1) * h)
            for y in range(h):
                source = y * pixels.bytes_per_line
                rgba = data[source:source + 4 * w]
                start = y * (3 * w + 1) + 1
                stop = start + 3 * w
                rows[start:stop:3] = rgba[2::4]
                rows[start + 1:stop:3] = rgba[1::4]
                rows[start + 2:stop:3] = rgba[0::4]
        finally:
            lib.XDestroyImage(image)
    finally:
        lib.XCloseDisplay(display)

    def chunk(kind, body):
        return pack(">I", len(body)) + kind + body + pack(">I", zlib.crc32(kind + body))

    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


class FixtureWorker:
    def __init__(self):
        self.commands = []

    def send(self, command):
        self.commands.append(command)
        return True


def descendants(parent):
    for child in parent.winfo_children():
        yield child
        yield from descendants(child)


def check(app, ui, screenshot_folder, report):
    window = app.window
    viewport = app.viewport
    window.update()
    window.focus_force()

    def check_display(state, width, height):
        window.update()
        assert (window.winfo_width(), window.winfo_height()) == (width, height)
        assert app._is_compact == (width < 620)
        if not app._is_compact:
            assert app.footer.winfo_height() == 58
            assert app.body.winfo_width() == 600
            assert app.body.winfo_rootx() - viewport.winfo_rootx() == (width - 600) // 2
        if state == "FA-03":
            assert app.settings_back.winfo_rooty() >= viewport.winfo_rooty(), "Settings Back must be visible."
            assert app.ai_hint.winfo_rooty() + app.ai_hint.winfo_height() <= viewport.winfo_rooty() + viewport.winfo_height()
        for widget in list(descendants(window)):
            if not isinstance(widget, ttk.Button) or not widget.winfo_viewable() or widget.winfo_toplevel() != window:
                continue
            assert widget.winfo_width() >= widget.winfo_reqwidth(), (state, widget.cget("text"), widget.winfo_width(),
                                                                     widget.winfo_reqwidth())
        if screenshot_folder is not None:
            capture(window, screenshot_folder / f"{state}-{ui.UI_LANG}.png")
        print(f"PASS {state} {ui.UI_LANG} {width}x{height}", flush=True)

    def fill_terms(terms):
        app.keyword.delete("1.0", "end")
        app.keyword.insert("1.0", terms)
        window.update()
        assert app.keyword.get("1.0", "end-1c") == terms

    assert app.run.instate(["disabled"])
    terms = "宝山 硚口"
    fill_terms(terms)
    assert app.run.instate(["!disabled"])
    app.keyword.focus_set()
    check_display("FA-01", 1080, 660)

    keep = " ".join(f"term{i}" for i in range(200))
    fill_terms(keep)
    assert app.keyword.cget("height") == 6
    fill_terms(terms)

    app.apply_previous_report(report, {"keywords": terms.split(), "start": "2026-11-23"})
    app.refresh_report_selection()
    assert app.previous_report == report and app.change_report.winfo_manager()
    check_display("FA-02", 1080, 660)

    app.toggle_options()
    app.provider.set("Qwen")
    app.provider_changed(None)
    assert app.endpoint_entry.instate(["!disabled"])
    app.provider.set("OpenAI")
    app.provider_changed(None)
    assert app.endpoint_entry.instate(["disabled"])
    app.screens.set("0")
    assert app.screen_picker.instate(["invalid"]) and app.run.instate(["disabled"])
    app.screens.set(ui.BOTTOM)
    check_display("FA-03", 1080, 660)

    app.new_task()
    assert app.previous_report is None
    app.start_date.set("2026-11-25")
    app.end_date.set("2026-11-24")
    app.start()
    assert app.worker is None and app.run.instate(["disabled"])
    assert app.date_fields[0].instate(["invalid"]) and app.keyword_group.border == "#dc1437"
    check_display("FA-04", 1080, 660)

    def run_fixture():
        app.worker = FixtureWorker()
        app.cancelled, app.report, app.warning = False, None, ""
        app.open_running_view(compact=False)
        lines = (
            ui.t("开始关键词 1/2：宝山", "Starting keyword 1/2: Bao Shan"),
            "UI_PROGRESS " + ui.t("1/2 已处理 · 「宝山」完成", "1/2 processed · “Bao Shan” completed"),
            ui.t("开始关键词 2/2：硚口", "Starting keyword 2/2: Qiao Kou"),
        )
        for line in lines:
            app.receive(line)
        assert app._progress_counts == (1, 2, 0)

    run_fixture()
    text = ui.t("请在浏览器中完成登录。", "Complete sign-in in the browser.")
    app.show_prompt(text)
    assert app.dialog.grab_current() == app.dialog
    check_display("FA-05", 1080, 660)
    login = app.dialog
    next(button for button in descendants(login) if isinstance(button, ttk.Button)
         and button.cget("style") == "Primary.TButton").invoke()
    assert app.worker.commands == ['"继续"']
    check_display("FA-06", 1080, 660)
    window.geometry("880x590+22+22")
    check_display("FA-09", 880, 590)
    window.geometry("1080x660+22+22")
    window.minsize(290, 180)
    window.geometry("440x285+22+22")
    check_display("FA-10", 440, 285)
    window.geometry("290x180+22+22")
    check_display("FA-10-minimum", 290, 180)
    window.geometry("440x285+22+22")
    window.update()
    app.show_prompt(text)
    check_display("FA-11", 440, 285)
    app.dismiss_prompt()
    app.update_progress_view()
    app.compact_stop.invoke()
    assert app.stop_dialog is not None and "UI_CANCEL" not in app.worker.commands
    check_display("FA-12", 440, 285)
    for button in descendants(app.stop_dialog):
        if isinstance(button, ttk.Button) and button.cget("style") == "Primary.TButton":
            button.invoke()
            break
    assert app.cancelled and app.worker.commands[-1] == "UI_CANCEL"
    app.finished(1)
    assert app.result_title.cget("text") == ui.t("任务已停止", "Task stopped")
    window.minsize(880, 590)
    window.geometry("1080x660+22+22")
    window.update()

    run_fixture()
    app.receive("UI_PROGRESS " + ui.t("2/2 已处理 · 「硚口」完成", "2/2 processed · “Qiao Kou” completed"))
    app.report = report
    app.finished(0)
    assert app.open_report_button.instate(["!disabled"])
    check_display("FA-07", 1080, 660)

    for state, total in (("FA-07b-summary-fallback", 7), ("FA-07c-summary-fallback", 200)):
        run_fixture()
        app.update_progress_view(ui.t(f"开始关键词 1/{total}：首词", f"Starting keyword 1/{total}: first"))
        for index in range(1, total + 1):
            if index == 1:
                app._progress_counts = (0, 0, 0)
            app.receive("UI_PROGRESS " + ui.t(f"{index}/{total} 已处理 · 「首词」完成",
                                               f"{index}/{total} processed · “Term” completed"))
        assert app._progress_counts == (total, total, 0)
        app.report = report
        app.finished(0)
        check_display(state, 1080, 660)

    run_fixture()
    app.receive("UI_PROGRESS " + ui.t("2/2 已处理 · 「硚口」失败", "2/2 processed · “Qiao Kou” failed"))
    app.receive("UI_ANALYSIS_WARNING " + ui.t("AI 分析未完整", "AI analysis is incomplete"))
    app.report = report
    app.finished(1)
    assert app._progress_counts == (2, 2, 1) and app.warning_group.winfo_manager()
    check_display("FA-08", 1080, 660)
    app.report = None
    app.show_results(ui.t("运行未完成，请查看日志", "Monitoring did not finish. See the activity log."))
    assert app.open_report_button.instate(["disabled"]) and app.details.winfo_manager()
    app.new_task()
    assert app.previous_report is None and app.page == "setup"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-root", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--screenshots", type=Path)
    parser.add_argument("--report", type=Path, required=True, help="Path to an Excel report generated by the fixture run")
    args = parser.parse_args()
    assert args.report.is_file()
    if args.screenshots:
        args.screenshots.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(args.app_root.resolve(strict=True)))
    import app as ui

    window = tk.Tk()
    try:
        with TemporaryDirectory(prefix="xhs-linux-verify-ui-") as home:
            app = ui.Monitor(window, Path(home), verify=True)
            check(app, ui, args.screenshots, args.report)
    finally:
        window.destroy()


if __name__ == "__main__":
    main()
