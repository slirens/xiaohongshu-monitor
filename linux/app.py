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
from f1a import FULL_MINIMUM, FULL_SIZE, MonitorView


APP_ROOT = Path(__file__).resolve().parent
PROVIDERS = ("OpenAI", "Claude", "Gemini", "DeepSeek", "Kimi", "GLM", "Qwen")
REPORT_PREFIXES = ("已生成 Excel：", "Excel report: ")
SHANGHAI = timezone(timedelta(hours=8))
PROGRESS_LINES = (
    "开始关键词 ", "正在打开", "正在后台启动", "扫描「", "读笔记 ", "分析 ", "正在生成 Excel",
    "Starting keyword ", "Opening ", "Starting browser ", "Scanning ", "Reading note ",
    "Analyzing ", "Generating Excel",
)


def system_language(environment):
    name = next((environment.get(key) for key in ("LC_ALL", "LC_MESSAGES", "LANG") if environment.get(key)), "")
    return "zh-CN" if re.split(r"[_\-.@]", name.lower(), maxsplit=1)[0] == "zh" else "en"


UI_LANG = system_language(os.environ)


def t(chinese, english):
    return chinese if UI_LANG == "zh-CN" else english


APP_NAME = t("小红书舆情监控", "Xiaohongshu Monitor")
BOTTOM = t("下拉到底", "Scroll to bottom")
BUILTIN = t("使用内置模板", "Built-in template")
SORT_OPTIONS = {t("最新", "Latest"): "最新", t("综合", "Relevance"): "综合"}


def data_home():
    default = Path.home() / ".local" / "share"
    base = Path(os.environ.get("XDG_DATA_HOME", ""))
    return (base if base.is_absolute() else default) / "xiaohongshu-monitor"


def date_value(value):
    value = value.strip()
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise ValueError
    return date.fromisoformat(value)


def latest_report(home):
    try:
        return max((path for path in (home / "reports").glob("舆情_*.xlsx") if path.is_file()),
                   key=lambda path: path.stat().st_mtime, default=None)
    except OSError:
        return None


class Worker:
    def __init__(self, home, *, warm_browser=False):
        self.events = Queue()
        env = {**os.environ, "XHS_MONITOR_HOME": str(home), "XHS_UI_LANG": UI_LANG}
        env.pop("OPENAI_API_KEY", None)
        env.pop("XHS_AI_KEY", None)
        command = [str(APP_ROOT / "runtime" / "node"), str(APP_ROOT / "monitor.mjs"), "--desktop"]
        if warm_browser:
            command.append("--warm-browser-driver")
        self.process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace", bufsize=1, env=env, cwd=home,
            start_new_session=True,
        )
        Thread(target=self.read, daemon=True).start()

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
            return False
        return True

    def close_idle(self):
        try:
            self.process.stdin.close()
        except OSError:
            pass
        try:
            self.process.wait(timeout=0.15)
        except subprocess.TimeoutExpired:
            self.kill()

    def kill(self):
        if self.process.poll() is not None:
            return
        try:
            os.killpg(self.process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


class Monitor(MonitorView):
    def __init__(self, window, home, verify=False):
        self.window = window
        self.home = home
        self.verify = verify
        self.templates = home / "templates"
        self.worker = None
        self.prepared_worker = None
        self.dialog = None
        self.stop_dialog = None
        self.report = None
        self.previous_report = None
        self.last_report = latest_report(home)
        self.importing_report = False
        self.result = None
        self.progress_history = []
        self.cancelled = False
        self.closing = False
        self.minimized = False
        self.warning = ""
        self.last_progress = ""
        self.window.title(APP_NAME)
        self.window.geometry(f"{FULL_SIZE[0]}x{FULL_SIZE[1]}")
        self.window.minsize(*FULL_MINIMUM)
        self.ui, self.app_name, self.bottom = t, APP_NAME, BOTTOM
        self.parse_date, self.sort_options, self.providers = date_value, SORT_OPTIONS, PROVIDERS
        self.today = lambda: datetime.now(SHANGHAI).date()
        self.status = tk.StringVar(value=t("准备就绪", "Ready"))
        self.run_counts = tk.StringVar()
        self.start_date = tk.StringVar(value=self.today().isoformat())
        self.end_date = tk.StringVar(value=self.today().isoformat())
        self.sort = tk.StringVar(value=next(iter(SORT_OPTIONS)))
        self.screens = tk.StringVar(value=BOTTOM)
        self.provider = tk.StringVar(value=PROVIDERS[0])
        self.model = tk.StringVar()
        self.key = tk.StringVar()
        self.endpoint = tk.StringVar()
        self.template = tk.StringVar(value=BUILTIN)
        self.window.protocol("WM_DELETE_WINDOW", self.close)
        self.window.bind("<Map>", self.restore)
        self.build_view()
        if not self.verify:
            self.window.after_idle(self.prepare_worker)

    def prepare_worker(self):
        if self.worker or self.prepared_worker or self.closing:
            return
        try:
            self.home.mkdir(parents=True, exist_ok=True, mode=0o700)
            self.prepared_worker = Worker(self.home, warm_browser=True)
        except OSError:
            # Launch normally if preparing an idle worker is unavailable.
            pass

    def acquire_worker(self, request):
        line = json.dumps(request, ensure_ascii=False)
        prepared = self.prepared_worker
        self.prepared_worker = None
        if prepared is not None and prepared.process.poll() is not None:
            prepared.close_idle()
            prepared = None
        worker = prepared if prepared is not None else Worker(self.home)
        if worker.send(line):
            return worker
        # An unsuccessful flush may have sent enough to start the task already.
        worker.close_idle()
        raise OSError(t("运行组件未能接收任务。", "The monitor worker could not receive the task."))

    def release_prepared_worker(self):
        if self.prepared_worker is not None:
            self.prepared_worker.close_idle()
            self.prepared_worker = None

    def provider_changed(self, _):
        self.model.set("")
        self.key.set("")
        self.endpoint.set("")
        self.endpoint_entry.configure(state="normal" if self.provider.get() == "Qwen" else "disabled")

    def refresh_templates(self):
        names = sorted(path.stem for path in self.templates.glob("*.md") if path.is_file())
        self.template_picker.configure(values=[BUILTIN, *names])

    def import_template(self):
        names = filedialog.askopenfilenames(
            parent=self.window, title=t("导入报告生成模板", "Import report templates"),
            filetypes=[("Markdown", "*.md"), (t("全部文件", "All files"), "*")],
        )
        for name in names:
            try:
                source = Path(name)
                if source.suffix.lower() != ".md" or source.stat().st_size > 48003:
                    raise ValueError(t("请选择不超过 12,000 个字符的 Markdown 文件。",
                                       "Choose a Markdown file with no more than 12,000 characters."))
                markdown = source.read_text(encoding="utf-8-sig")
                if not markdown.strip():
                    raise ValueError(t("报告模板文件为空。", "The report template is empty."))
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
                    raise ValueError(checked.stderr.strip() or t("报告模板无法读取。", "The report template could not be read."))
                self.templates.mkdir(parents=True, exist_ok=True, mode=0o700)
                stem = source.stem.encode("utf-8")[:200].decode("utf-8", "ignore")
                if stem in ("使用内置模板", "Built-in template"):
                    stem += t("（导入）", " (imported)")
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
                messagebox.showerror(t("无法导入模板", "Could not import template"), str(error), parent=self.window)

    def refresh_report_selection(self):
        continuing = bool(self.previous_report)
        self.task_title.configure(text=t("继续监控", "Continue monitoring") if continuing else
                                  t("新建监控任务", "New monitoring task"))
        self.task_intro.configure(text=t("从上次报告取回关键词，可修改后继续检索。",
                                         "Restore keywords from a previous report and edit them before searching.") if continuing else
                                  t("按关键词和日期采集小红书笔记，导出 Excel 报告。",
                                    "Collect Xiaohongshu notes by keyword and date, then export an Excel report."))
        if continuing:
            if not self.report_group.winfo_manager():
                self.report_group.pack(fill="x", before=self.keyword_group, pady=(0, 12))
            self.report_label.configure(text=self._shorten(self.previous_report.name, 370))
        else:
            self.report_group.pack_forget()
        available = "disabled" if self.worker or self.importing_report else "normal"
        self.continue_button.configure(style="Current.TButton" if continuing else "Segment.TButton",
                                       text=t("正在读取…", "Reading…") if self.importing_report else
                                       t("继续监控…", "Continue monitoring…"), state=available)
        self.reset_task.configure(style="Segment.TButton" if continuing else "Current.TButton", state=available)
        self.change_report.configure(state=available)
        self.run.configure(text=t("开始续查", "Run follow-up") if continuing else t("开始监控", "Start monitoring"))
        self._update_validation()

    def new_task(self):
        if self.worker or self.importing_report:
            return
        self.previous_report = None
        self._read_errors = False
        self.keyword.delete("1.0", "end")
        today = datetime.now(SHANGHAI).date().isoformat()
        self.start_date.set(today)
        self.end_date.set(today)
        self.status.set(t("准备就绪", "Ready"))
        self.show_page("setup")
        self.refresh_report_selection()
        self.keyword.focus_set()

    def continue_from_result(self):
        if self.worker or self.importing_report:
            return
        self.previous_report = None
        self.show_page("setup")
        self.refresh_report_selection()
        self.import_previous_report()

    def import_previous_report(self):
        if self.worker or self.importing_report:
            return
        path = self.last_report if not self.previous_report else None
        automatic = bool(path and path.is_file())
        if not automatic:
            current = self.previous_report or self.last_report
            selected = filedialog.askopenfilename(
                parent=self.window, title=t("导入上次监控报告", "Import the previous monitoring report"),
                filetypes=[(t("Excel 工作簿", "Excel workbook"), "*.xlsx")],
                initialdir=str(current.parent if current else self.home / "reports"),
                initialfile=current.name if current else "",
            )
            if not selected:
                return
            path = Path(selected)
        self.importing_report = True
        self.refresh_report_selection()
        result = Queue(maxsize=1)

        def inspect():
            try:
                checked = subprocess.run(
                    [str(APP_ROOT / "runtime" / "node"), str(APP_ROOT / "monitor.mjs"), "--inspect-report", str(path)],
                    text=True, encoding="utf-8", capture_output=True, timeout=30,
                    env={**os.environ, "XHS_UI_LANG": UI_LANG},
                )
                metadata = json.loads(checked.stdout)
                if metadata.get("error"):
                    raise ValueError(metadata["error"])
                if checked.returncode:
                    raise ValueError(t("无法读取这份报告。", "Could not read this report."))
                result.put((metadata, None))
            except (OSError, ValueError, subprocess.TimeoutExpired) as error:
                result.put((None, str(error)))

        def complete():
            try:
                metadata, error = result.get_nowait()
            except Empty:
                self.window.after(50, complete)
                return
            self.importing_report = False
            if metadata is None:
                if automatic:
                    self.last_report = None
                if self.verify:
                    self.status.set(error)
                else:
                    messagebox.showerror(t("无法导入上次报告", "Could not import the previous report"), error,
                                         parent=self.window)
            else:
                self.apply_previous_report(path, metadata)
            self.refresh_report_selection()

        Thread(target=inspect, daemon=True).start()
        self.window.after(50, complete)

    def apply_previous_report(self, path, metadata):
        self.previous_report = path
        terms = metadata.get("keywords") or []
        self.keyword.delete("1.0", "end")
        self.keyword.insert("1.0", " ".join(terms))
        today = datetime.now(SHANGHAI).date()
        try:
            suggested = date_value(metadata.get("start") or "")
            valid_start = suggested <= today
        except ValueError:
            valid_start = False
        self.start_date.set((suggested if valid_start else today).isoformat())
        self.end_date.set(today.isoformat())
        self.status.set(t("报告已导入，可增删关键词。", "Report imported. Add or remove keywords.") if terms and valid_start else
                        t("报告已导入，请确认关键词和日期。", "Report imported. Check the keywords and dates."))
        self.keyword.mark_set("insert", "end-1c")
        self.keyword.focus_set()

    def start(self, source=""):
        if self.worker is not None or self.importing_report:
            return
        (keyword, start, end, count), (key_error, date_error, screen_error, _) = self.validate_form()
        if key_error or date_error or screen_error:
            self._read_errors = True
            self._update_validation()
            self.status.set(key_error or date_error or screen_error)
            if key_error:
                self.keyword.focus_set()
            elif screen_error:
                self.show_page("settings")
                self.screen_picker.focus_set()
            return
        selected = self.template.get()
        request = {
            "keyword": keyword, "start": start.isoformat(), "end": end.isoformat(),
            "sort": SORT_OPTIONS[self.sort.get()], "screens": count, "source": source,
            "continueReport": str(self.previous_report) if self.previous_report else "",
            "template": "" if selected == BUILTIN else str(self.templates / (selected + ".md")),
            "provider": self.provider.get(), "model": self.model.get().strip(),
            "endpoint": self.endpoint.get().strip(), "apiKey": self.key.get().strip(),
            "startInBackground": self.minimized,
        }
        try:
            self.home.mkdir(parents=True, exist_ok=True, mode=0o700)
            self.worker = self.acquire_worker(request)
        except OSError as error:
            self.status.set(t("无法启动监控。", "Could not start monitoring."))
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
        self.refresh_report_selection()
        self.open_running_view(compact=not self.verify)
        self.set_progress(t("正在启动监控…", "Starting monitoring…"))
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
        elif line.startswith(REPORT_PREFIXES):
            prefix = next(prefix for prefix in REPORT_PREFIXES if line.startswith(prefix))
            self.report = Path(line.removeprefix(prefix))
        elif line.startswith(PROGRESS_LINES) and not self.cancelled:
            self.set_progress(line)
        self.log_line(line)

    def log_line(self, line):
        self.log.configure(state="normal")
        self.log.insert("end", line + "\n")
        if int(self.log.index("end").split(".")[0]) > 2500:
            self.log.delete("1.0", "501.0")
        if self._log_pinned:
            self.log.see("end")
        self.log.configure(state="disabled")

    def set_progress(self, value):
        self.status.set(value)
        if self.page == "running":
            self.update_progress_view(value)
        self.window.title(f"{APP_NAME} · {value}")

    def show_prompt(self, text):
        self.window.deiconify()
        self.dismiss_prompt()
        self.set_progress(t("等待网页操作", "Waiting for browser interaction"))
        self.log_line(text)
        dialog = self.dialog = tk.Toplevel(self.window)
        title = t("继续网页操作", "Continue in the browser")
        dialog.title(title)
        dialog.transient(self.window)
        dialog.resizable(False, False)
        width = min(380, max(250, self.window.winfo_width() - 20))
        dialog.minsize(width, 0)
        panel = ttk.Frame(dialog, padding=20)
        panel.pack(fill="both", expand=True)
        logo = self._logo(32)
        if logo:
            ttk.Label(panel, image=logo).pack(anchor="w", pady=(0, 8))
        ttk.Label(panel, text=title, style="Medium.TLabel").pack(anchor="w")
        ttk.Label(panel, text=text, style="Muted.TLabel", wraplength=width - 40, justify="left").pack(
            anchor="w", pady=(8, 0))
        buttons = ttk.Frame(panel)
        buttons.pack(fill="x", pady=(14, 0))

        def answer():
            if not self.worker or self.cancelled:
                return
            self.dismiss_prompt()
            self.worker.send(json.dumps("继续", ensure_ascii=False))
            self.set_progress(t("继续监控…", "Resuming monitoring…"))

        okay = self._button(buttons, t("继续", "Continue"), answer, kind="Primary.TButton")
        okay.pack(side="right")
        self._button(buttons, t("结束任务", "End task"), self.confirm_stop).pack(side="right", padx=(0, 8))
        self.center_dialog(dialog)
        okay.focus_set()
        dialog.protocol("WM_DELETE_WINDOW", self.confirm_stop)
        dialog.bind("<Escape>", lambda _: self.confirm_stop())
        dialog.grab_set()
        self.update_progress_view()

    def dismiss_prompt(self):
        if self.stop_dialog:
            self.stop_dialog.destroy()
            self.stop_dialog = None
        if self.dialog:
            self.dialog.destroy()
            self.dialog = None

    def confirm_stop(self):
        if not self.worker or self.cancelled or self.stop_dialog:
            return
        dialog = self.stop_dialog = tk.Toplevel(self.window)
        title = t("停止当前任务？", "Stop the current task?")
        dialog.title(title)
        dialog.transient(self.dialog or self.window)
        dialog.resizable(False, False)
        panel = ttk.Frame(dialog, padding=16)
        panel.pack()
        ttk.Label(panel, text=title, style="Medium.TLabel").pack(anchor="w")
        buttons = ttk.Frame(panel)
        buttons.pack(fill="x", pady=(10, 0))

        def keep_running():
            dialog.destroy()
            self.stop_dialog = None
            if self.dialog:
                self.dialog.grab_set()

        self._button(buttons, t("停止任务", "Stop task"), self.stop, kind="Primary.TButton").pack(side="right")
        keep = self._button(buttons, t("继续运行", "Keep running"), keep_running)
        keep.pack(side="right", padx=(0, 8))
        self.center_dialog(dialog)
        dialog.protocol("WM_DELETE_WINDOW", keep_running)
        dialog.bind("<Escape>", lambda _: keep_running())
        dialog.grab_set()
        keep.focus_set()

    def stop(self):
        if not self.worker or self.cancelled:
            return
        self.cancelled = True
        self.dismiss_prompt()
        self.worker.send("UI_CANCEL")
        self.stop_button.state(["disabled"])
        self.compact_stop.state(["disabled"])
        self.set_progress(t("正在停止…", "Stopping…"))
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
        if self.closing:
            self.release_prepared_worker()
            self.window.destroy()
            return
        if self.cancelled:
            message = t("任务已停止", "Task stopped")
        elif self.report is not None and self.report.is_file():
            self.last_report = self.report
            if self.previous_report:
                self.previous_report = self.report
            message = t("已导出报告", "Report exported")
            if code != 0:
                message += t(" · 部分关键词失败", " · Some keywords failed")
            elif self.warning:
                message += f" · {self.warning}"
        else:
            message = t("运行未完成，请查看日志", "Monitoring did not finish. See the activity log.")
        self.set_progress(message)
        self.show_results(message)
        self.refresh_report_selection()
        notify = shutil.which("notify-send")
        if self.minimized and notify and not self.verify:
            try:
                subprocess.Popen([notify, "--app-name", APP_NAME, message], stdout=subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL)
            except OSError:
                pass
        if not self.verify:
            self.window.after_idle(self.prepare_worker)

    def open_report(self):
        if self.report is None or not self.report.is_file():
            return
        try:
            subprocess.Popen(["xdg-open", str(self.report)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError as error:
            self.log_line(str(error))
            self.result_title.configure(text=t("无法打开报告。", "Could not open the report."))

    def open_reports(self):
        try:
            folder = self.home / "reports"
            folder.mkdir(parents=True, exist_ok=True, mode=0o700)
            subprocess.Popen(["xdg-open", str(folder)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError as error:
            self.log_line(str(error))
            self.status.set(t("无法打开报告目录。", "Could not open the reports folder."))

    def close(self):
        if not self.worker:
            self.closing = True
            self.release_prepared_worker()
            self.window.destroy()
        elif messagebox.askyesno(t("退出程序", "Quit"),
                                 t("停止正在运行的任务并退出？", "Stop the running task and quit?"),
                                 parent=self.window):
            self.closing = True
            self.stop()


def verify_app(app, fixture):
    assert SORT_OPTIONS[app.sort.get()] == "最新" and app.screens.get() == BOTTOM
    prior_files = set(app.home.iterdir()) if app.home.exists() else set()
    app.prepare_worker()
    prepared = app.prepared_worker
    assert prepared is not None
    app.prepare_worker()
    assert app.prepared_worker is prepared
    deadline = monotonic() + 30
    while True:
        event, value = prepared.events.get(timeout=max(0, deadline - monotonic()))
        if event != "line" or not value.startswith("UI_DIAG "):
            raise RuntimeError("The idle Linux worker emitted unexpected output")
        diagnostic = json.loads(value.removeprefix("UI_DIAG "))["event"]
        if diagnostic == "browser_driver_ready":
            break
        assert diagnostic == "worker_ready"
    assert set(app.home.iterdir()) == prior_files
    app.keyword.insert("1.0", "宝山 硚口")
    app.start_date.set("2026-11-23")
    app.end_date.set("2026-11-23")
    app.start(str(Path(fixture).resolve(strict=True)))
    if app.worker is None:
        raise RuntimeError(app.status.get())
    assert app.worker is prepared and app.prepared_worker is None
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
    first = app.report
    assert app.last_report == first and latest_report(app.home) == first
    app.import_previous_report()
    deadline = monotonic() + 30
    while app.importing_report and monotonic() < deadline:
        app.window.update()
        app.window.tk.call("after", 25)
    assert app.previous_report == first and not app.importing_report, app.status.get()
    assert app.keyword.get("1.0", "end-1c") == "宝山 硚口"
    app.keyword.delete("1.0", "end")
    app.keyword.insert("1.0", "宝山 新增词")
    app.start_date.set("2026-11-23")
    app.end_date.set("2026-11-23")
    app.start(str(Path(fixture).resolve(strict=True)))
    assert app.worker is not None, app.status.get()
    deadline = monotonic() + 30
    while app.worker and monotonic() < deadline:
        app.window.update()
        app.window.tk.call("after", 25)
    assert app.worker is None and app.result == 0 and app.report.is_file(), app.status.get()
    assert app.report != first and first.is_file() and app.previous_report == app.report
    app.new_task()
    app.import_previous_report()
    deadline = monotonic() + 30
    while app.importing_report and monotonic() < deadline:
        app.window.update()
        app.window.tk.call("after", 25)
    assert app.keyword.get("1.0", "end-1c") == "宝山 新增词", app.status.get()
    print(app.report, flush=True)


def main():
    parser = argparse.ArgumentParser(prog="xiaohongshu-monitor")
    parser.add_argument("--verify", nargs=2, metavar=("FIXTURE", "HOME"), help=argparse.SUPPRESS)
    args = parser.parse_args()
    window = tk.Tk()
    if args.verify:
        fixture, home = args.verify
        os.environ["XHS_TASK_DIAGNOSTICS"] = "1"
        window.withdraw()
        app = Monitor(window, Path(home).resolve(), verify=True)
        try:
            verify_app(app, fixture)
        finally:
            app.release_prepared_worker()
            if app.worker is not None:
                app.worker.kill()
            window.destroy()
    else:
        app = Monitor(window, data_home())
        try:
            window.mainloop()
        finally:
            app.release_prepared_worker()


if __name__ == "__main__":
    main()
