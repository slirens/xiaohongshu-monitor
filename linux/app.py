import argparse
from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
from queue import Empty, Queue
import re
import shutil
import signal
import subprocess
from threading import Thread
from time import monotonic
import tkinter as tk
from tkinter import filedialog, messagebox, ttk


APP_ROOT = Path(__file__).resolve().parent
APP_NAME = "小红书舆情监控"
PROVIDERS = ("OpenAI", "Claude", "Gemini", "DeepSeek", "Kimi", "GLM", "Qwen")
BOTTOM = "下拉到底"
BUILTIN = "使用内置模板"
REPORT_PREFIX = "已生成 Excel："
TIME_CHOICES = ("一天内", "一周内", "半年内")
SHANGHAI = timezone(timedelta(hours=8))
PROGRESS_LINES = (
    "开始关键词 ", "正在打开", "正在后台启动", "扫描「", "读笔记 ", "分析 ", "正在生成 Excel",
)


def data_home():
    default = Path.home() / ".local" / "share"
    base = Path(os.environ.get("XDG_DATA_HOME", ""))
    return (base if base.is_absolute() else default) / "xiaohongshu-monitor"


def date_value(value):
    value = value.strip()
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise ValueError
    return date.fromisoformat(value)


class Worker:
    def __init__(self, home, request, key):
        self.events = Queue()
        env = {**os.environ, "XHS_MONITOR_HOME": str(home)}
        env.pop("OPENAI_API_KEY", None)
        env.pop("XHS_AI_KEY", None)
        if key:
            env["XHS_AI_KEY"] = key
        self.process = subprocess.Popen(
            [str(APP_ROOT / "runtime" / "node"), str(APP_ROOT / "monitor.mjs"), "--desktop"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace", bufsize=1, env=env, cwd=home,
            start_new_session=True,
        )
        Thread(target=self.read, daemon=True).start()
        self.send(json.dumps(request, ensure_ascii=False))

    def read(self):
        with self.process.stdout as output:
            for line in output:
                self.events.put(("line", line.rstrip("\r\n")))
        code = self.process.wait()
        try:
            self.process.stdin.close()
        finally:
            self.events.put(("exit", code))

    def send(self, line):
        try:
            self.process.stdin.write(line + "\n")
            self.process.stdin.flush()
        except (BrokenPipeError, OSError, ValueError):
            pass

    def kill(self):
        if self.process.poll() is not None:
            return
        try:
            os.killpg(self.process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


class Monitor:
    def __init__(self, window, home, verify=False):
        self.window = window
        self.home = home
        self.verify = verify
        self.templates = home / "templates"
        self.worker = None
        self.dialog = None
        self.report = None
        self.result = None
        self.progress_history = []
        self.cancelled = False
        self.closing = False
        self.minimized = False
        self.warning = ""
        self.last_progress = ""
        self.window.title(APP_NAME)
        self.window.geometry("660x590")
        self.window.minsize(545, 455)
        self.window.protocol("WM_DELETE_WINDOW", self.close)
        self.window.bind("<Map>", self.restore)
        self.build_view()

    def entry_group(self, parent, label, value, row, column, *, secret=False):
        group = ttk.Frame(parent, style="Card.TFrame")
        group.grid(row=row, column=column, sticky="ew", padx=(0, 8) if column == 0 else (8, 0), pady=(0, 12))
        ttk.Label(group, text=label, style="Card.TLabel").pack(anchor="w", pady=(0, 5))
        entry = ttk.Entry(group, textvariable=value, show="•" if secret else "")
        entry.pack(fill="x", ipady=5)
        return group

    def build_view(self):
        theme = ttk.Style(self.window)
        theme.theme_use("clam")
        theme.configure("TFrame", background="#f3f5f8")
        theme.configure("TLabel", background="#f3f5f8", foreground="#17212c")
        theme.configure("Title.TLabel", font=("TkDefaultFont", 20, "bold"))
        theme.configure("Muted.TLabel", foreground="#526477")
        theme.configure("Card.TFrame", background="white")
        theme.configure("Card.TLabel", background="white")
        theme.configure("TButton", padding=(10, 7))
        theme.configure("Primary.TButton", foreground="white", background="#0768e7", borderwidth=0)
        theme.map("Primary.TButton", background=[("disabled", "#516982"), ("active", "#0057c7")])
        theme.configure("TEntry", bordercolor="#929eaa")
        content = ttk.Frame(self.window, padding=24)
        content.pack(fill="both", expand=True)
        ttk.Label(content, text=APP_NAME, style="Title.TLabel").pack(anchor="w")

        card = ttk.Frame(content, style="Card.TFrame", padding=(16, 13, 16, 2))
        card.pack(fill="x", pady=(16, 10))
        card.columnconfigure((0, 1), weight=1, uniform="dates")
        ttk.Label(card, text="关键词", style="Card.TLabel").grid(row=0, columnspan=2, sticky="w", pady=(0, 5))
        self.keyword = tk.Text(card, height=2, wrap="word", font="TkDefaultFont",
                               background="#f4f6fa", foreground="#17212c", insertbackground="#17212c",
                               padx=9, pady=6, highlightthickness=1, highlightbackground="#929eaa",
                               highlightcolor="#0768e7", borderwidth=0)
        self.keyword.grid(row=1, columnspan=2, sticky="ew")
        self.keyword.bind("<Tab>", lambda _: self.keyword.tk_focusNext().focus_set() or "break")
        ttk.Label(card, text="空格分隔多个关键词，例如 宝山 硚口", style="Card.TLabel").grid(
            row=2, columnspan=2, sticky="w", pady=(4, 12))
        today = datetime.now(SHANGHAI).date().isoformat()
        self.start_date = tk.StringVar(value=today)
        self.end_date = tk.StringVar(value=today)
        self.entry_group(card, "开始日期 YYYY-MM-DD", self.start_date, 3, 0)
        self.entry_group(card, "结束日期 YYYY-MM-DD", self.end_date, 3, 1)

        self.advanced_button = ttk.Button(content, text="更多设置", command=self.toggle_options)
        self.advanced_button.pack(fill="x", pady=(0, 4))
        self.options = ttk.Frame(content, style="Card.TFrame", padding=(16, 12, 16, 2))
        self.options.columnconfigure((0, 1), weight=1, uniform="options")
        self.sort = tk.StringVar(value="最新")
        self.screens = tk.StringVar(value=BOTTOM)
        self.provider = tk.StringVar(value=PROVIDERS[0])
        self.model = tk.StringVar()
        self.key = tk.StringVar()
        self.endpoint = tk.StringVar()
        self.template = tk.StringVar(value=BUILTIN)
        self.option_select("网页排序", self.sort, ("最新", "综合"), 0, 0)
        self.option_select("划屏数量（也可输入数字）", self.screens, (BOTTOM, "1", "2", "3", "4"), 0, 1, editable=True)
        provider = self.option_select("AI 服务商", self.provider, PROVIDERS, 1, 0)
        provider.bind("<<ComboboxSelected>>", self.provider_changed)
        self.entry_group(self.options, "模型（可选）", self.model, 1, 1)
        self.entry_group(self.options, "API 密钥（仅本次使用）", self.key, 2, 0, secret=True)
        self.template_picker = self.option_select("报告生成模板", self.template, (), 2, 1)
        self.refresh_templates()
        ttk.Button(self.options, text="导入 Markdown…", command=self.import_template).grid(
            row=3, column=1, sticky="e", padx=(8, 0), pady=(0, 12))
        self.endpoint_group = self.entry_group(self.options, "百炼兼容接口（可选）", self.endpoint, 3, 0)
        self.endpoint_group.grid_remove()

        self.status = tk.StringVar(value="准备就绪")
        self.status_label = ttk.Label(content, textvariable=self.status, style="Muted.TLabel")
        self.status_label.pack(anchor="w", pady=(9, 6))
        self.status_label.bind("<Configure>", lambda _: self.status_label.configure(
            wraplength=max(250, content.winfo_width() - 48)))
        actions = ttk.Frame(content)
        actions.pack(fill="x", pady=(0, 11))
        ttk.Button(actions, text="打开报告目录", command=self.open_reports).pack(side="left")
        self.run = ttk.Button(actions, text="开始监控", command=self.start, style="Primary.TButton")
        self.run.pack(side="right")
        self.stop_button = ttk.Button(actions, text="停止任务", command=self.stop, state="disabled")
        self.stop_button.pack(side="right", padx=8)
        self.background_button = ttk.Button(actions, text="后台执行", command=self.background, state="disabled")
        self.background_button.pack(side="right")

        pane = ttk.Frame(content)
        pane.pack(fill="both", expand=True)
        ttk.Label(pane, text="任务日志").pack(anchor="w", pady=(0, 5))
        scrollbar = ttk.Scrollbar(pane, orient="vertical")
        scrollbar.pack(side="right", fill="y")
        self.log = tk.Text(pane, height=4, wrap="word", font="TkDefaultFont",
                           padx=9, pady=8, relief="flat", state="disabled",
                           yscrollcommand=scrollbar.set)
        scrollbar.configure(command=self.log.yview)
        self.log.pack(fill="both", expand=True)
        self.keyword.focus_set()

    def option_select(self, label, variable, values, row, column, editable=False):
        group = ttk.Frame(self.options, style="Card.TFrame")
        group.grid(row=row, column=column, sticky="ew", padx=(0, 8) if column == 0 else (8, 0), pady=(0, 12))
        ttk.Label(group, text=label, style="Card.TLabel").pack(anchor="w", pady=(0, 5))
        picker = ttk.Combobox(group, textvariable=variable, values=values,
                              state="normal" if editable else "readonly", width=18)
        picker.pack(fill="x", ipady=5)
        return picker

    def toggle_options(self):
        if self.options.winfo_manager():
            self.options.pack_forget()
            self.advanced_button.configure(text="更多设置")
        else:
            self.options.pack(fill="x", before=self.status_label, pady=(2, 0))
            self.window.update_idletasks()
            height = min(self.window.winfo_screenheight() - 90, max(self.window.winfo_height(), 768))
            if height > self.window.winfo_height():
                self.window.geometry(f"{self.window.winfo_width()}x{height}")
            self.advanced_button.configure(text="收起更多设置")

    def provider_changed(self, _):
        self.model.set("")
        self.key.set("")
        self.endpoint.set("")
        if self.provider.get() == "Qwen":
            self.endpoint_group.grid()
        else:
            self.endpoint_group.grid_remove()

    def refresh_templates(self):
        names = sorted(path.stem for path in self.templates.glob("*.md") if path.is_file())
        self.template_picker.configure(values=[BUILTIN, *names])

    def import_template(self):
        names = filedialog.askopenfilenames(
            parent=self.window, title="导入报告生成模板",
            filetypes=[("Markdown", "*.md"), ("全部文件", "*")],
        )
        for name in names:
            try:
                source = Path(name)
                if source.suffix.lower() != ".md" or source.stat().st_size > 48003:
                    raise ValueError("请选择不超过 12,000 个字符的 Markdown 文件。")
                markdown = source.read_text(encoding="utf-8-sig")
                if not markdown.strip():
                    raise ValueError("报告模板文件为空。")
                validate = """
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
const { parseReportTemplate } = await import(pathToFileURL(process.argv[1]));
try { parseReportTemplate(readFileSync(0, 'utf8'), process.argv[2]); }
catch (error) { console.error(error.message); process.exitCode = 1; }
"""
                checked = subprocess.run(
                    [str(APP_ROOT / "runtime" / "node"), "--input-type=module", "-e", validate,
                     str(APP_ROOT / "report-template.mjs"), source.name],
                    input=markdown, text=True, encoding="utf-8", capture_output=True, timeout=10,
                )
                if checked.returncode:
                    raise ValueError(checked.stderr.strip() or "报告模板无法读取。")
                self.templates.mkdir(parents=True, exist_ok=True, mode=0o700)
                stem = source.stem.encode("utf-8")[:200].decode("utf-8", "ignore")
                stem = f"{stem}（导入）" if stem == BUILTIN else stem
                index = 1
                while True:
                    target = self.templates / (f"{stem}.md" if index == 1 else f"{stem} ({index}).md")
                    try:
                        with target.open("x", encoding="utf-8") as copy:
                            copy.write(markdown)
                    except FileExistsError:
                        if target.read_text(encoding="utf-8") != markdown:
                            index += 1
                            continue
                    self.refresh_templates()
                    self.template.set(target.stem)
                    break
            except (OSError, ValueError, subprocess.TimeoutExpired) as error:
                messagebox.showerror("无法导入模板", str(error), parent=self.window)

    def start(self, source=""):
        if self.worker is not None:
            return
        keyword = self.keyword.get("1.0", "end-1c").strip()
        if not keyword:
            self.status.set("请输入至少一个关键词。")
            self.keyword.focus_set()
            return
        try:
            start = date_value(self.start_date.get())
            end = date_value(self.end_date.get())
        except ValueError:
            self.status.set("请输入有效日期，格式为 YYYY-MM-DD。")
            return
        if start > end:
            self.status.set("结束日期不能早于开始日期。")
            return
        screens = self.screens.get().strip()
        if screens == BOTTOM:
            count = "bottom"
        elif re.fullmatch(r"[0-9]{1,5}", screens) and 1 <= int(screens) <= 10000:
            count = int(screens)
        else:
            self.status.set("划屏请输入 1 至 10000 的整数，或选择「下拉到底」。")
            return
        selected = self.template.get()
        request = {
            "keyword": keyword, "start": start.isoformat(), "end": end.isoformat(),
            "sort": self.sort.get(), "screens": count, "source": source,
            "template": "" if selected == BUILTIN else str(self.templates / (selected + ".md")),
            "provider": self.provider.get(), "model": self.model.get().strip(),
            "endpoint": self.endpoint.get().strip(),
        }
        try:
            self.home.mkdir(parents=True, exist_ok=True, mode=0o700)
            self.worker = Worker(self.home, request, self.key.get().strip())
        except OSError as error:
            self.status.set("无法启动监控。")
            self.log_line(str(error))
            return
        self.key.set("")
        self.report = None
        self.result = None
        self.cancelled = False
        self.warning = self.last_progress = ""
        self.progress_history.clear()
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")
        self.run.configure(state="disabled")
        self.stop_button.configure(state="normal")
        self.background_button.configure(state="normal")
        self.set_progress("正在启动监控…")
        self.window.after(50, self.poll)

    def poll(self):
        for _ in range(100):
            try:
                event, value = self.worker.events.get_nowait()
            except Empty:
                break
            if event == "exit":
                self.finished(value)
                return
            self.receive(value)
        self.window.after(50, self.poll)

    def receive(self, line):
        if line.startswith("UI_ASK "):
            if not self.cancelled:
                self.show_prompt(json.loads(line[7:]))
            return
        if line.startswith("UI_PROGRESS "):
            line = line.removeprefix("UI_PROGRESS ")
            self.last_progress = line
            if self.verify:
                self.progress_history.append(line)
            if not self.cancelled:
                self.set_progress(line)
        elif line.startswith("UI_ANALYSIS_WARNING "):
            line = line.removeprefix("UI_ANALYSIS_WARNING ")
            self.warning = line
        elif line.startswith(REPORT_PREFIX):
            self.report = Path(line.removeprefix(REPORT_PREFIX))
        elif line.startswith(PROGRESS_LINES) and not self.cancelled:
            self.set_progress(line)
        self.log_line(line)

    def log_line(self, line):
        self.log.configure(state="normal")
        self.log.insert("end", line + "\n")
        if int(self.log.index("end").split(".")[0]) > 2500:
            self.log.delete("1.0", "501.0")
        self.log.see("end")
        self.log.configure(state="disabled")

    def set_progress(self, value):
        self.status.set(value)
        self.window.title(f"{APP_NAME} · {value}")

    def show_prompt(self, text):
        self.window.deiconify()
        self.set_progress("等待网页操作")
        self.log_line(text)
        dialog = self.dialog = tk.Toplevel(self.window)
        dialog.title("继续网页操作")
        dialog.transient(self.window)
        dialog.resizable(False, False)
        panel = ttk.Frame(dialog, padding=18)
        panel.pack()
        ttk.Label(panel, text=text, wraplength=385, justify="left").pack(anchor="w")
        response = tk.StringVar(value="继续")
        time_prompt = "同名时间选项" in text
        if time_prompt:
            response.set("")
            options = ("不限",) if "此日期可使用不限" in text else TIME_CHOICES
            picker = ttk.Combobox(panel, values=options, state="readonly", textvariable=response)
            picker.pack(fill="x", pady=(10, 0))
        buttons = ttk.Frame(panel)
        buttons.pack(fill="x", pady=(14, 0))
        ttk.Button(buttons, text="结束任务", command=self.stop).pack(side="right")

        def answer():
            self.dismiss_prompt()
            self.worker.send(json.dumps(response.get(), ensure_ascii=False))
            self.set_progress("继续监控…")

        okay = ttk.Button(buttons, text="已应用" if time_prompt else "继续", command=answer)
        okay.pack(side="right", padx=8)
        if time_prompt:
            okay.configure(state="disabled")
            picker.bind("<<ComboboxSelected>>", lambda _: okay.configure(state="normal"))
            picker.focus_set()
        else:
            okay.focus_set()
        dialog.protocol("WM_DELETE_WINDOW", self.stop)
        dialog.grab_set()

    def dismiss_prompt(self):
        if self.dialog:
            self.dialog.destroy()
            self.dialog = None

    def stop(self):
        if not self.worker or self.cancelled:
            return
        self.cancelled = True
        self.dismiss_prompt()
        self.worker.send("UI_CANCEL")
        self.stop_button.configure(state="disabled")
        self.set_progress("正在停止…")
        task = self.worker
        self.window.after(8000, lambda: task.kill() if self.worker is task else None)

    def background(self):
        if self.worker:
            self.minimized = True
            self.worker.send("UI_BACKGROUND")
            self.window.iconify()

    def restore(self, event):
        if event.widget == self.window and self.minimized:
            self.minimized = False
            if self.worker and self.dialog is None:
                self.worker.send("UI_FOREGROUND")

    def finished(self, code):
        self.dismiss_prompt()
        self.worker = None
        self.result = code
        self.run.configure(state="normal")
        self.stop_button.configure(state="disabled")
        self.background_button.configure(state="disabled")
        if self.closing:
            self.window.destroy()
            return
        if self.cancelled:
            message = "任务已停止"
        elif self.report is not None and self.report.is_file():
            message = "已导出报告"
            if code != 0:
                message += " · 部分关键词失败"
            elif self.warning:
                message += f" · {self.warning}"
        else:
            message = "运行未完成，请查看日志"
        self.set_progress(message)
        notify = shutil.which("notify-send")
        if self.minimized and notify and not self.verify:
            try:
                subprocess.Popen([notify, "--app-name", APP_NAME, message], stdout=subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL)
            except OSError:
                pass

    def open_reports(self):
        try:
            folder = self.home / "reports"
            folder.mkdir(parents=True, exist_ok=True, mode=0o700)
            subprocess.Popen(["xdg-open", str(folder)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError as error:
            self.log_line(str(error))
            self.status.set("无法打开报告目录。")

    def close(self):
        if not self.worker:
            self.window.destroy()
        elif messagebox.askyesno("退出程序", "停止正在运行的任务并退出？", parent=self.window):
            self.closing = True
            self.stop()


def verify_app(app, fixture):
    assert app.sort.get() == "最新" and app.screens.get() == BOTTOM
    app.keyword.insert("1.0", "宝山 硚口")
    app.start_date.set("2026-11-23")
    app.end_date.set("2026-11-23")
    app.start(str(Path(fixture).resolve(strict=True)))
    if app.worker is None:
        raise RuntimeError(app.status.get())
    deadline = monotonic() + 30
    while app.worker and monotonic() < deadline:
        app.window.update()
        app.window.tk.call("after", 25)
    if app.worker:
        app.worker.kill()
        raise RuntimeError("Linux desktop verification timed out")
    if app.result != 0 or app.report is None or not app.report.is_file():
        raise RuntimeError(app.log.get("1.0", "end-1c"))
    assert [progress.split()[0] for progress in app.progress_history] == ["1/2", "2/2"]
    print(app.report, flush=True)


def main():
    parser = argparse.ArgumentParser(prog="xiaohongshu-monitor")
    parser.add_argument("--verify", nargs=2, metavar=("FIXTURE", "HOME"), help=argparse.SUPPRESS)
    args = parser.parse_args()
    window = tk.Tk()
    if args.verify:
        fixture, home = args.verify
        window.withdraw()
        app = Monitor(window, Path(home).resolve(), verify=True)
        try:
            verify_app(app, fixture)
        finally:
            window.destroy()
    else:
        app = Monitor(window, data_home())
        window.mainloop()


if __name__ == "__main__":
    main()
