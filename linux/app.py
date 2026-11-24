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
from tkinter import font as tkfont


APP_ROOT = Path(__file__).resolve().parent
PROVIDERS = ("OpenAI", "Claude", "Gemini", "DeepSeek", "Kimi", "GLM", "Qwen")
REPORT_PREFIXES = ("已生成 Excel：", "Excel report: ")
SHANGHAI = timezone(timedelta(hours=8))
PROGRESS_LINES = (
    "开始关键词 ", "正在打开", "正在后台启动", "扫描「", "读笔记 ", "分析 ", "正在生成 Excel",
    "Starting keyword ", "Opening ", "Starting browser ", "Scanning ", "Reading note ",
    "Analyzing ", "Generating Excel",
)
SURFACE, SIDEBAR, FIELD = "#fafcfe", "#e9f2fb", "#f3f7fb"
INK, MUTED, EDGE = "#243248", "#54637a", "#d6e0ee"
ACCENT, FOCUS, HALO = "#235bc2", "#4474cb", "#e2ebfa"


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


class Monitor:
    def __init__(self, window, home, verify=False):
        self.window = window
        self.home = home
        self.verify = verify
        self.templates = home / "templates"
        self.worker = None
        self.prepared_worker = None
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
        self.window.geometry("1000x620")
        self.window.minsize(735, 505)
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

    def entry_group(self, parent, label, value, row, column, *, secret=False):
        group = ttk.Frame(parent, style="Card.TFrame")
        group.grid(row=row, column=column, sticky="ew", padx=(0, 8) if column == 0 else (8, 0), pady=(0, 12))
        ttk.Label(group, text=label, style="Card.TLabel").pack(anchor="w", pady=(0, 5))
        entry = ttk.Entry(group, textvariable=value, show="•" if secret else "", cursor="xterm")
        entry.pack(fill="x")
        return group

    def build_view(self):
        theme = ttk.Style(self.window)
        theme.theme_use("clam")
        families = set(tkfont.families())
        default_font = tkfont.nametofont("TkDefaultFont")
        preferred = ("Noto Sans CJK SC", "Noto Sans SC") if UI_LANG == "zh-CN" else ("Noto Sans", "DejaVu Sans")
        family = next((candidate for candidate in preferred if candidate in families), default_font.actual("family"))
        default_font.configure(family=family, size=10, weight="normal")
        theme.configure("TFrame", background=SURFACE)
        theme.configure("TLabel", background=SURFACE, foreground=INK)
        theme.configure("Title.TLabel", font=(family, 22))
        theme.configure("Muted.TLabel", foreground=MUTED)
        theme.configure("Card.TFrame", background=SURFACE)
        theme.configure("Card.TLabel", background=SURFACE)
        theme.configure("Side.TFrame", background=SIDEBAR)
        theme.configure("Side.TLabel", background=SIDEBAR, font=(family, 12))
        theme.configure("TButton", padding=(12, 8), background=SURFACE,
                        foreground=INK, bordercolor=EDGE, lightcolor=SURFACE, darkcolor=SURFACE)
        theme.map("TButton", background=[("active", FIELD)], bordercolor=[("focus", FOCUS)])
        theme.configure("Link.TButton", padding=(5, 5), foreground=ACCENT, borderwidth=0,
                        bordercolor=SURFACE, lightcolor=SURFACE, darkcolor=SURFACE)
        theme.configure("Primary.TButton", foreground="white", background=ACCENT, borderwidth=0,
                        bordercolor=ACCENT, lightcolor=ACCENT, darkcolor=ACCENT)
        theme.map("Primary.TButton", background=[("disabled", "#788da9"), ("active", "#2e68ce")])
        for style in ("TEntry", "TCombobox"):
            theme.configure(style, padding=(10, 8), bordercolor=EDGE, fieldbackground=FIELD,
                            lightcolor=FIELD, darkcolor=FIELD, foreground=INK)
            theme.map(style, bordercolor=[("focus", FOCUS), ("active", "#93add0")],
                      fieldbackground=[("focus", "white"), ("readonly", FIELD)])

        shell = ttk.Frame(self.window)
        shell.pack(fill="both", expand=True)
        sidebar = ttk.Frame(shell, style="Side.TFrame", padding=(25, 48))
        sidebar.pack(side="left", fill="y")
        try:
            self.cover = tk.PhotoImage(file=str(APP_ROOT / "cover.png"))
        except tk.TclError:
            self.cover = None
        if self.cover is not None:
            width, height = self.cover.width(), self.cover.height()
            radius = min(14, width // 2, height // 2)
            for y in range(radius):
                for x in range(radius):
                    if (radius - x - .5) ** 2 + (radius - y - .5) ** 2 > radius ** 2:
                        for sx, sy in ((x, y), (width - x - 1, y), (x, height - y - 1),
                                       (width - x - 1, height - y - 1)):
                            self.cover.transparency_set(sx, sy, True)
            ttk.Label(sidebar, image=self.cover, style="Side.TLabel").pack(anchor="w", pady=(0, 17))
        ttk.Label(sidebar, text=APP_NAME, style="Side.TLabel").pack(anchor="w")

        content = ttk.Frame(shell, padding=(38, 32, 35, 22))
        content.pack(side="left", fill="both", expand=True)
        self.build_footer(content)
        form_frame = ttk.Frame(content)
        form_frame.pack(fill="both", expand=True)
        viewport = tk.Canvas(form_frame, highlightthickness=0, background=SURFACE)
        scrollbar = ttk.Scrollbar(form_frame, orient="vertical", command=viewport.yview)
        viewport.configure(yscrollcommand=scrollbar.set)
        viewport.pack(side="left", fill="both", expand=True)
        panel = ttk.Frame(viewport)
        panel_id = viewport.create_window(0, 0, window=panel, anchor="nw")

        def resize_panel(_=None):
            viewport.itemconfigure(panel_id, width=viewport.winfo_width())
            viewport.configure(scrollregion=viewport.bbox("all"))
            if panel.winfo_reqheight() > viewport.winfo_height():
                scrollbar.pack(side="right", fill="y", before=viewport)
            else:
                scrollbar.pack_forget()

        panel.bind("<Configure>", resize_panel)
        viewport.bind("<Configure>", resize_panel)
        for target in (panel, viewport):
            target.bind("<Button-4>", lambda _: viewport.yview_scroll(-2, "units"))
            target.bind("<Button-5>", lambda _: viewport.yview_scroll(2, "units"))
        ttk.Label(panel, text=t("新建监控任务", "New monitoring task"), style="Title.TLabel").pack(anchor="w")
        ttk.Label(panel, text=t("按关键词和日期采集笔记，导出 Excel 报告。",
                               "Collect notes by keyword and date, then export an Excel report."),
                  style="Muted.TLabel", wraplength=440).pack(anchor="w", pady=(6, 24))

        card = ttk.Frame(panel, style="Card.TFrame")
        card.pack(fill="x")
        card.columnconfigure((0, 1), weight=1, uniform="dates")
        ttk.Label(card, text=t("关键词", "Keywords"), style="Card.TLabel").grid(
            row=0, columnspan=2, sticky="w", pady=(0, 7))
        well = tk.Frame(card, background=SURFACE, cursor="xterm")
        well.grid(row=1, columnspan=2, sticky="ew", pady=(0, 18))
        outline = tk.Canvas(well, background=SURFACE, highlightthickness=0, cursor="xterm")
        outline.place(x=0, y=0, relwidth=1, relheight=1)
        self.keyword = tk.Text(well, width=1, height=1, wrap="word", font="TkDefaultFont",
                               background=FIELD, foreground=INK, insertbackground=INK,
                               padx=0, pady=1, highlightthickness=0, borderwidth=0, cursor="xterm")
        self.keyword.pack(fill="x", padx=13, pady=12)
        placeholder = tk.Label(well, text=t("多个关键词用空格分隔，例如 宝山 硚口",
                                           "Separate keywords with spaces, e.g. 宝山 硚口"),
                               anchor="w", background=FIELD, foreground=MUTED, cursor="xterm",
                               padx=0, pady=0)
        outline_hover = False

        def draw_keyword(_=None):
            width, height = well.winfo_width(), well.winfo_height()
            if width < 24 or height < 24:
                return
            focused = self.window.focus_get() == self.keyword
            color = "white" if focused or outline_hover else FIELD
            outline.delete("surface")
            corners = (
                2, 12, 2, 2, 12, 2, width - 12, 2, width - 2, 2, width - 2, 12,
                width - 2, height - 12, width - 2, height - 2, width - 12, height - 2,
                12, height - 2, 2, height - 2, 2, height - 12,
            )
            if focused:
                outline.create_polygon(*corners, smooth=True, splinesteps=16, fill="", outline=HALO,
                                       width=4, tags="surface")
            outline.create_polygon(
                *corners, smooth=True, splinesteps=16,
                fill=color, outline=FOCUS if focused else "#93add0" if outline_hover else EDGE,
                width=1.4 if focused else 1, tags="surface",
            )
            self.keyword.configure(background=color)
            placeholder.configure(background=color)

        def sync_keyword(_=None):
            if self.keyword.get("1.0", "end-1c"):
                placeholder.place_forget()
            else:
                placeholder.place(x=13, y=12, relwidth=1, width=-26)
            lines = int(self.keyword.tk.call(self.keyword._w, "count", "-update", "-displaylines", "1.0", "end") or 1)
            height = min(6, max(1, lines))
            if int(self.keyword.cget("height")) != height:
                self.keyword.configure(height=height)

        def changed(_):
            if self.keyword.edit_modified():
                self.keyword.edit_modified(False)
                sync_keyword()

        def hover(active):
            nonlocal outline_hover
            outline_hover = active
            draw_keyword()

        def focus_keyword(event):
            self.keyword.focus_set()
            x = event.x_root - self.keyword.winfo_rootx()
            y = event.y_root - self.keyword.winfo_rooty()
            self.keyword.mark_set("insert", f"@{x},{y}")
            return "break"

        for target in (well, outline, placeholder, self.keyword):
            target.bind("<Enter>", lambda _: hover(True))
            target.bind("<Leave>", lambda _: hover(False))
        for target in (outline, placeholder):
            target.bind("<Button-1>", focus_keyword)
        well.bind("<Configure>", draw_keyword)
        self.keyword.bind("<FocusIn>", draw_keyword)
        self.keyword.bind("<FocusOut>", lambda _: self.window.after_idle(draw_keyword))
        self.keyword.bind("<<Modified>>", changed)
        self.keyword.bind("<Configure>", sync_keyword)
        self.keyword.bind("<Tab>", lambda _: self.keyword.tk_focusNext().focus_set() or "break")
        self.keyword.bind("<Shift-Tab>", lambda _: self.keyword.tk_focusPrev().focus_set() or "break")
        if self.window.tk.call("tk", "windowingsystem") == "x11":
            self.keyword.bind("<ISO_Left_Tab>", lambda _: self.keyword.tk_focusPrev().focus_set() or "break")
        sync_keyword()
        today = datetime.now(SHANGHAI).date().isoformat()
        self.start_date = tk.StringVar(value=today)
        self.end_date = tk.StringVar(value=today)
        self.entry_group(card, t("开始日期", "Start date"), self.start_date, 2, 0)
        self.entry_group(card, t("结束日期", "End date"), self.end_date, 2, 1)

        self.advanced_button = ttk.Button(panel, command=self.toggle_options)
        self.advanced_button.pack(fill="x", pady=(5, 8))
        self.options = ttk.Frame(panel, style="Card.TFrame", padding=(0, 10, 0, 2))
        self.options.columnconfigure((0, 1), weight=1, uniform="options")
        self.sort = tk.StringVar(value=next(iter(SORT_OPTIONS)))
        self.screens = tk.StringVar(value=BOTTOM)
        self.provider = tk.StringVar(value=PROVIDERS[0])
        self.model = tk.StringVar()
        self.key = tk.StringVar()
        self.endpoint = tk.StringVar()
        self.template = tk.StringVar(value=BUILTIN)
        self.option_select(t("网页排序", "Sort order"), self.sort, tuple(SORT_OPTIONS), 0, 0)
        self.option_select(t("划屏数量（也可输入数字）", "Screen count (or type a number)"),
                           self.screens, (BOTTOM, "1", "2", "3", "4"), 0, 1, editable=True)
        provider = self.option_select(t("AI 服务商", "AI provider"), self.provider, PROVIDERS, 1, 0)
        provider.bind("<<ComboboxSelected>>", self.provider_changed)
        self.entry_group(self.options, t("模型（可选）", "Model (optional)"), self.model, 1, 1)
        self.entry_group(self.options, t("API 密钥（仅本次使用）", "API key (this run only)"), self.key, 2, 0, secret=True)
        self.template_picker = self.option_select(t("报告生成模板", "Report template"), self.template, (), 2, 1)
        self.refresh_templates()
        ttk.Button(self.options, text=t("导入 Markdown…", "Import Markdown…"), command=self.import_template).grid(
            row=3, column=1, sticky="e", padx=(8, 0), pady=(0, 12))
        self.endpoint_group = self.entry_group(self.options, t("百炼兼容接口（可选）", "DashScope endpoint (optional)"),
                                               self.endpoint, 3, 0)
        self.endpoint_group.grid_remove()
        self.sort.trace_add("write", self.update_options_label)
        self.screens.trace_add("write", self.update_options_label)
        self.update_options_label()

    def build_footer(self, parent):
        self.details = ttk.Frame(parent)
        ttk.Label(self.details, text=t("任务日志", "Activity log"), style="Muted.TLabel").pack(anchor="w", pady=(0, 6))
        log_scroll = ttk.Scrollbar(self.details, orient="vertical")
        log_scroll.pack(side="right", fill="y")
        self.log = tk.Text(self.details, width=1, height=7, wrap="word", font="TkDefaultFont",
                           background=FIELD, foreground=INK, padx=10, pady=8, relief="flat", state="disabled",
                           highlightthickness=1, highlightbackground=EDGE, yscrollcommand=log_scroll.set)
        log_scroll.configure(command=self.log.yview)
        self.log.pack(fill="both", expand=True)

        self.footer = ttk.Frame(parent)
        self.footer.pack(side="bottom", fill="x", pady=(12, 0))
        tk.Frame(self.footer, height=1, background=EDGE).pack(fill="x", pady=(0, 13))
        self.running_actions = ttk.Frame(self.footer)
        actions = ttk.Frame(self.footer)
        actions.pack(fill="x")
        self.actions = actions
        self.status = tk.StringVar(value=t("准备就绪", "Ready"))
        self.run = ttk.Button(actions, text=t("开始监控", "Start monitoring"), command=self.start, style="Primary.TButton")
        self.run.pack(side="right")
        self.report_button = ttk.Button(actions, text=t("打开报告目录", "Open reports"), command=self.open_reports)
        self.report_button.pack(side="right", padx=(0, 8))
        self.stop_button = ttk.Button(self.running_actions, text=t("停止任务", "Stop"), command=self.stop)
        self.stop_button.pack(side="right")
        self.background_button = ttk.Button(self.running_actions, text=t("后台执行", "Run in background"),
                                            command=self.background)
        self.background_button.pack(side="right", padx=(0, 8))
        tk.Label(actions, text="●", background=SURFACE, foreground=FOCUS, font=("TkDefaultFont", 7),
                 padx=0).pack(side="left", padx=(0, 6))
        self.status_label = ttk.Label(actions, textvariable=self.status, style="Muted.TLabel", wraplength=170)
        self.status_label.pack(side="left")
        self.details_button = ttk.Button(actions, text=t("任务详情", "Task details"),
                                         command=self.toggle_details, style="Link.TButton")
        self.details_button.pack(side="left", padx=(8, 0))

    def toggle_details(self):
        if self.details.winfo_manager():
            self.details.pack_forget()
            self.details_button.configure(text=t("任务详情", "Task details"))
        else:
            self.details.pack(side="bottom", fill="x", before=self.footer, pady=(10, 0))
            self.details_button.configure(text=t("收起详情", "Hide details"))

    def option_select(self, label, variable, values, row, column, editable=False):
        group = ttk.Frame(self.options, style="Card.TFrame")
        group.grid(row=row, column=column, sticky="ew", padx=(0, 8) if column == 0 else (8, 0), pady=(0, 12))
        ttk.Label(group, text=label, style="Card.TLabel").pack(anchor="w", pady=(0, 5))
        picker = ttk.Combobox(group, textvariable=variable, values=values,
                              state="normal" if editable else "readonly", width=18)
        picker.pack(fill="x")
        return picker

    def update_options_label(self, *_):
        title = t("收起更多设置", "Hide settings") if self.options.winfo_manager() else t("更多设置", "More settings")
        self.advanced_button.configure(text=f"{title}     ·     {self.sort.get()} · {self.screens.get()}")

    def toggle_options(self):
        if self.options.winfo_manager():
            self.options.pack_forget()
        else:
            self.options.pack(fill="x", after=self.advanced_button)
        self.update_options_label()

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

    def start(self, source=""):
        if self.worker is not None:
            return
        keyword = self.keyword.get("1.0", "end-1c").strip()
        if not keyword:
            self.status.set(t("请输入至少一个关键词。", "Enter at least one keyword."))
            self.keyword.focus_set()
            return
        try:
            start = date_value(self.start_date.get())
            end = date_value(self.end_date.get())
        except ValueError:
            self.status.set(t("请输入有效日期，格式为 YYYY-MM-DD。", "Enter valid dates in YYYY-MM-DD format."))
            return
        if start > end:
            self.status.set(t("结束日期不能早于开始日期。", "The end date cannot be earlier than the start date."))
            return
        screens = self.screens.get().strip()
        if screens == BOTTOM:
            count = "bottom"
        elif re.fullmatch(r"[0-9]{1,5}", screens) and 1 <= int(screens) <= 10000:
            count = int(screens)
        else:
            self.status.set(t("划屏请输入 1 至 10000 的整数，或选择「下拉到底」。",
                              "Enter a screen count from 1 to 10,000 or select Scroll to bottom."))
            return
        selected = self.template.get()
        request = {
            "keyword": keyword, "start": start.isoformat(), "end": end.isoformat(),
            "sort": SORT_OPTIONS[self.sort.get()], "screens": count, "source": source,
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
        self.run.configure(state="disabled")
        self.stop_button.configure(state="normal")
        self.running_actions.pack(fill="x", before=self.actions, pady=(0, 8))
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
        self.log.see("end")
        self.log.configure(state="disabled")

    def set_progress(self, value):
        self.status.set(value)
        self.window.title(f"{APP_NAME} · {value}")

    def show_prompt(self, text):
        self.window.deiconify()
        self.set_progress(t("等待网页操作", "Waiting for browser interaction"))
        self.log_line(text)
        dialog = self.dialog = tk.Toplevel(self.window)
        dialog.title(t("继续网页操作", "Continue in the browser"))
        dialog.transient(self.window)
        dialog.resizable(False, False)
        panel = ttk.Frame(dialog, padding=18)
        panel.pack()
        ttk.Label(panel, text=text, wraplength=385, justify="left").pack(anchor="w")
        buttons = ttk.Frame(panel)
        buttons.pack(fill="x", pady=(14, 0))
        ttk.Button(buttons, text=t("结束任务", "End task"), command=self.stop).pack(side="right")

        def answer():
            self.dismiss_prompt()
            self.worker.send(json.dumps("继续", ensure_ascii=False))
            self.set_progress(t("继续监控…", "Resuming monitoring…"))

        okay = ttk.Button(buttons, text=t("继续", "Continue"), command=answer)
        okay.pack(side="right", padx=8)
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
        self.run.configure(state="normal")
        self.running_actions.pack_forget()
        if self.closing:
            self.release_prepared_worker()
            self.window.destroy()
            return
        if self.cancelled:
            message = t("任务已停止", "Task stopped")
        elif self.report is not None and self.report.is_file():
            message = t("已导出报告", "Report exported")
            if code != 0:
                message += t(" · 部分关键词失败", " · Some keywords failed")
            elif self.warning:
                message += f" · {self.warning}"
        else:
            message = t("运行未完成，请查看日志", "Monitoring did not finish. See the activity log.")
            if not self.details.winfo_manager():
                self.toggle_details()
        self.set_progress(message)
        notify = shutil.which("notify-send")
        if self.minimized and notify and not self.verify:
            try:
                subprocess.Popen([notify, "--app-name", APP_NAME, message], stdout=subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL)
            except OSError:
                pass
        if not self.verify:
            self.window.after_idle(self.prepare_worker)

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
