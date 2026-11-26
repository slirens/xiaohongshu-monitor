"""Tk presentation for the F+1A monitoring flow."""

import calendar
from datetime import date
from pathlib import Path
import re
import tkinter as tk
from tkinter import font as tkfont, ttk


WHITE, INK = "#ffffff", "#1e1a1b"
MUTED, TERTIARY = "#6f6c6d", "#838182"
EDGE, FILL, GROUP = "#e8e8e8", "#efefef", "#f7f7f7"
BRAND, ACCENT, SUCCESS = "#ff2442", "#dc1437", "#167a44"
HALO = "#ffdcdf"
FULL_SIZE = (1080, 660)
FULL_MINIMUM = (880, 590)
COMPACT_MINIMUM = (290, 180)
CONTENT_WIDTH = 600
COMPACT_BREAKPOINT = 620
DONE_LINE = re.compile(r"^(\d+)/(\d+) (?:已处理 · 「.+」(完成|失败)|processed · “.+” (completed|failed))$")
START_LINE = re.compile(r"^(?:开始关键词 |Starting keyword )(\d+)/(\d+)[:：]")


def rounded(canvas, w, h, color, *, r=12, x=0, y=0, outline="", width=1):
    return canvas.create_polygon(
        x, y + r, x, y, x + r, y, w + x - r, y, w + x, y, w + x, y + r,
        w + x, h + y - r, w + x, h + y, w + x - r, h + y, x + r, h + y,
        x, h + y, x, h + y - r, smooth=True, splinesteps=16, fill=color, outline=outline, width=width,
    )


class Group(tk.Frame):
    """Rounded group background with native widgets and inset separators."""

    def __init__(self, parent, *, color=GROUP, outer=WHITE, inset=16, radius=12, padding=2):
        super().__init__(parent, background=outer)
        self.color = color
        self.border = ""
        self.radius = radius
        self.background_layer = tk.Canvas(self, background=outer, highlightthickness=0, takefocus=False)
        self.background_layer.place(relwidth=1, relheight=1)
        self.inner = tk.Frame(self, background=color)
        self.inner.pack(fill="both", expand=True, padx=inset, pady=padding)
        self.bind("<Configure>", self.paint)

    def paint(self, _=None):
        canvas = self.background_layer
        w, h = self.winfo_width(), self.winfo_height()
        if min(w, h) < 12:
            return
        canvas.delete("group")
        r = min(self.radius, h // 2 - 2)
        if self.border == BRAND:
            item = rounded(canvas, w - 3, h - 3, "", r=r, x=1, y=1, outline=HALO, width=3)
            canvas.addtag_withtag("group", item)
        item = rounded(canvas, w - 5, h - 5, self.color, r=r, x=2, y=2, outline=self.border)
        canvas.addtag_withtag("group", item)


class ProgressTrack(tk.Canvas):
    def __init__(self, parent):
        super().__init__(parent, background=WHITE, height=4, highlightthickness=0, takefocus=False)
        self.completed, self.total = 0, 1
        self.bind("<Configure>", self.paint)

    def update_progress(self, completed, total):
        self.completed, self.total = completed, max(1, total)
        self.paint()

    def paint(self, _=None):
        width = self.winfo_width()
        self.delete("track")
        self.create_line(2, 2, width - 2, 2, width=4, capstyle="round", fill=FILL, tags="track")
        if self.completed:
            extent = max(2, min(width - 2, width * self.completed / self.total))
            self.create_line(2, 2, extent, 2, width=4, capstyle="round", fill=BRAND, tags="track")


class MonitorView:
    def build_view(self):
        self.page = "setup"
        self._is_compact = False
        self._full_geometry = None
        self._log_pinned = True
        self._read_errors = False
        self._progress_counts = (0, 0, 0)
        self._images = {}
        self._configure_styles()
        self.window.configure(background=WHITE)
        self.window.rowconfigure(0, weight=1)
        self.window.columnconfigure(0, weight=1)
        self.full = ttk.Frame(self.window)
        self.full.grid(row=0, column=0, sticky="nsew")
        self.full.rowconfigure(2, weight=1)
        self.full.columnconfigure(0, weight=1)
        self._build_header()
        self._build_footer()

        self.viewport = tk.Canvas(self.full, background=WHITE, highlightthickness=0, takefocus=False)
        self.viewport.grid(row=2, column=0, sticky="nsew")
        self.body = ttk.Frame(self.viewport)
        self.body.columnconfigure(0, weight=1)
        self.body_id = self.viewport.create_window(0, 0, window=self.body, anchor="n")
        self.viewport.bind("<Configure>", self._resize_body)
        self.body.bind("<Configure>", self._resize_body)
        self.window.bind("<Button-4>", lambda e: self._scroll_page(e, -2), add="+")
        self.window.bind("<Button-5>", lambda e: self._scroll_page(e, 2), add="+")
        self.window.bind("<MouseWheel>", lambda e: self._scroll_page(e, -int(e.delta / 60)), add="+")
        self.window.bind("<Configure>", self._window_resized, add="+")
        self.window.bind("<FocusIn>", self._scroll_to_focus, add="+")
        self.window.bind("<Control-b>", self._keyboard_background)
        self.window.bind("<Control-period>", self._keyboard_stop)
        self.window.bind("<Return>", self._keyboard_start)
        self.window.bind("<Escape>", self._keyboard_back)

        self.pages = {name: ttk.Frame(self.body) for name in ("setup", "settings", "running", "result")}
        self._build_setup(self.pages["setup"])
        self._build_settings(self.pages["settings"])
        self._build_running(self.pages["running"])
        self._build_result(self.pages["result"])
        self._build_compact()
        self.refresh_report_selection()
        self.show_page("setup")

    def _configure_styles(self):
        theme = ttk.Style(self.window)
        theme.theme_use("clam")
        families = set(tkfont.families())
        default = tkfont.nametofont("TkDefaultFont")
        preferred = ("Noto Sans CJK SC", "Noto Sans SC", "Noto Sans", "DejaVu Sans")
        family = next((item for item in preferred if item in families), default.actual("family"))
        default.configure(family=family, size=-13, weight="normal")
        self._family = family
        theme.configure("TFrame", background=WHITE)
        theme.configure("TLabel", background=WHITE, foreground=INK)
        theme.configure("Title.TLabel", font=(family, -25, "bold"))
        theme.configure("SubTitle.TLabel", font=(family, -21, "bold"))
        theme.configure("Medium.TLabel", font=(family, -16, "bold"))
        theme.configure("Muted.TLabel", foreground=MUTED)
        theme.configure("Caption.TLabel", foreground=MUTED, font=(family, -12))
        theme.configure("Error.TLabel", foreground=ACCENT, font=(family, -12))
        theme.configure("Group.TLabel", background=GROUP)
        theme.configure("GroupMuted.TLabel", background=GROUP, foreground=MUTED)
        theme.configure("Group.TFrame", background=GROUP)
        theme.configure("Segment.TFrame", background=FILL)
        theme.configure("TEntry", padding=(6, 4), fieldbackground=WHITE, bordercolor=EDGE,
                        lightcolor=WHITE, darkcolor=WHITE, foreground=INK, insertcolor=INK)
        theme.map("TEntry", bordercolor=[("invalid", ACCENT), ("focus", BRAND)], fieldbackground=[("disabled", GROUP)])
        theme.configure("Date.TEntry", padding=3, fieldbackground=GROUP, bordercolor=GROUP,
                        lightcolor=GROUP, darkcolor=GROUP, foreground=INK)
        theme.map("Date.TEntry", bordercolor=[("invalid", ACCENT), ("focus", BRAND)])
        theme.configure("TCombobox", fieldbackground=WHITE, foreground=INK,
                        padding=(6, 3), lightcolor=WHITE, darkcolor=WHITE, bordercolor=EDGE, arrowsize=12)
        theme.map("TCombobox", fieldbackground=[("readonly", WHITE)], bordercolor=[("focus", BRAND), ("invalid", ACCENT)])
        for name, fill, hover, fg, row_color, pad in (
            ("TButton", FILL, "#e8e8e8", INK, WHITE, (13, 7)),
            ("Compact.TButton", FILL, "#e8e8e8", INK, WHITE, (3, 7)),
            ("Primary.TButton", ACCENT, "#c81232", WHITE, WHITE, (16, 7)),
            ("Link.TButton", WHITE, FILL, MUTED, WHITE, (5, 6)),
            ("GroupLink.TButton", GROUP, FILL, MUTED, GROUP, (6, 4)),
            ("Segment.TButton", FILL, EDGE, MUTED, FILL, (10, 5)),
            ("Current.TButton", WHITE, GROUP, INK, FILL, (10, 5)),
            ("SortCurrent.TButton", WHITE, WHITE, INK, GROUP, (10, 4)),
            ("Sort.TButton", GROUP, FILL, MUTED, GROUP, (10, 4)),
        ):
            element = name.replace(".", "") + "F1ASurface"
            normal_image = self._button_image(fill, row_color)
            hovered_image = self._button_image(hover, row_color)
            focused_image = self._button_image(fill, row_color, focus=True)
            disabled_image = self._button_image(FILL if name.startswith("Primary") else fill, row_color)
            theme.element_create(element, "image", normal_image, ("disabled", disabled_image),
                                 ("focus", focused_image), ("active", hovered_image), border=9, padding=0, sticky="nsew")
            theme.layout(name, [(element, {"sticky": "nsew", "children": [
                ("Button.padding", {"sticky": "nsew", "children": [
                    ("Button.label", {"sticky": "nsew"}),
                ]}),
            ]})])
            theme.configure(name, padding=pad, foreground=fg, background=row_color, borderwidth=0)
            theme.map(name, foreground=[("disabled", TERTIARY)])
        self._asset_root = Path(__file__).resolve().parent / "assets"
        if not self._asset_root.is_dir():
            self._asset_root = Path(__file__).resolve().parents[1] / "design" / "v2"
        icon = self._logo(64)
        if icon:
            self.window.iconphoto(True, icon)

    def _button_image(self, color, background, *, focus=False):
        image = tk.PhotoImage(master=self.window, width=19, height=19)
        image.put(background, to=(0, 0, 19, 19))
        if focus:
            for y, start in enumerate((5, 3, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 3, 5)):
                image.put(HALO, to=(start, y, 19 - start, y + 1))
        for y, start in enumerate((6, 4, 3, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 3, 4, 6)):
            if focus and (y < 2 or y > 16):
                continue
            start = max(start, 2) if focus else start
            if focus:
                image.put(BRAND, to=(start, y, 19 - start, y + 1))
                if 2 < y < 16:
                    image.put(color, to=(start + 1, y, 18 - start, y + 1))
            else:
                image.put(color, to=(start, y, 19 - start, y + 1))
        self._images[str(image)] = image
        return image

    def _image(self, path, scale):
        key = (path, scale)
        if key not in self._images:
            try:
                raw = tk.PhotoImage(master=self.window, file=str(path))
                self._images[key] = raw.subsample(scale) if scale > 1 else raw
            except tk.TclError:
                self._images[key] = None
        return self._images[key]

    def _logo(self, size, scale=1):
        return self._image(self._asset_root / "logo" / f"xhs-monitor-logo-{size}.png", scale)

    def _icon(self, name):
        return self._image(self._asset_root / "icons" / "png" / f"{name}.png", 3)

    def _button(self, parent, label, command=None, *, kind="TButton", icon=None, **kwargs):
        image = self._icon(icon) if icon else None
        return ttk.Button(parent, text=label, command=command, style=kind, image=image or "", compound="left", **kwargs)

    def _build_header(self):
        header = ttk.Frame(self.full, height=52, padding=(20, 0))
        header.grid(row=0, column=0, sticky="ew")
        header.grid_propagate(False)
        header.rowconfigure(0, weight=1)
        header.columnconfigure((0, 2), uniform="header", weight=1)
        brand = ttk.Frame(header)
        brand.grid(row=0, column=0, sticky="w")
        logo = self._logo(64, 3)
        if logo:
            ttk.Label(brand, image=logo).pack(side="left", padx=(0, 8))
        ttk.Label(brand, text=self.app_name, font=(self._family, -13, "bold")).pack(side="left")
        segments = Group(header, color=FILL, inset=2, radius=9)
        segments.grid(row=0, column=1)
        names = (self.ui("设置任务", "Set up task"), self.ui("执行监控", "Run monitoring"),
                 self.ui("导出结果", "Export results"))
        self.steps = []
        for name in names:
            step = tk.Frame(segments.inner, background=FILL)
            step.pack(side="left", padx=1, pady=1)
            marker = tk.Label(step, background=FILL, foreground=MUTED, padx=0, pady=0)
            marker.pack(side="left", padx=(8, 4), pady=5)
            label = ttk.Label(step, text=name, background=FILL, foreground=MUTED)
            label.pack(side="left", padx=(0, 8))
            self.steps.append((step, marker, label))
        export = self._button(header, "" if self._icon("export") else "↑", kind="Link.TButton", icon="export")
        export.state(["disabled"])
        export.grid(row=0, column=2, sticky="e")
        tk.Frame(self.full, height=1, background=EDGE).grid(row=1, column=0, sticky="ew")

    def _build_footer(self):
        self.notice = ttk.Label(self.full, style="Caption.TLabel", justify="center", text=self.ui(
            "仅限合法、非商业使用。自动化浏览可能触发平台警告或限制，影响账号权益和流量。",
            "For lawful, non-commercial use only. Automated browsing may trigger platform warnings or restrictions and affect account privileges and reach.",
        ))
        self.notice.grid(row=3, column=0, pady=(8, 10))
        tk.Frame(self.full, height=1, background=EDGE).grid(row=4, column=0, sticky="ew")
        self.footer = ttk.Frame(self.full, height=58, padding=(20, 12))
        self.footer.grid(row=5, column=0, sticky="ew")
        self.footer.pack_propagate(False)
        self.actions = {name: ttk.Frame(self.footer) for name in ("setup", "settings", "running", "result")}
        setup = self.actions["setup"]
        self.run = self._button(setup, self.ui("开始监控", "Start monitoring"), self.start, kind="Primary.TButton")
        self.run.pack(side="right")
        self._reports_button(setup).pack(side="left")
        self._button(self.actions["settings"], self.ui("完成", "Done"), lambda: self.show_page("setup")).pack(side="right")
        live = self.actions["running"]
        self.stop_button = self._button(live, self.ui("停止任务", "Stop task"), self.confirm_stop, icon="stop")
        self.stop_button.pack(side="right")
        self.background_button = self._button(live, self.ui("后台执行", "Run in background"), self.background, icon="tray")
        self.background_button.pack(side="right", padx=(0, 8))
        result = self.actions["result"]
        self._reports_button(result).pack(side="left")
        self.details_button = self._button(result, self.ui("执行日志", "Activity log"), self.toggle_details, kind="Link.TButton")
        self.details_button.pack(side="left", padx=(7, 0))
        self.open_report_button = self._button(result, self.ui("打开报告", "Open report"), self.open_report, kind="Primary.TButton")
        self.open_report_button.pack(side="right")
        self.result_continue = self._button(result, self.ui("继续监控…", "Continue monitoring…"), self.continue_from_result)
        self.result_continue.pack(side="right", padx=(0, 8))
        self._button(result, self.ui("新建监控", "New monitoring"), self.new_task).pack(side="right", padx=(0, 8))

    def _reports_button(self, parent):
        return self._button(parent, self.ui("打开报告目录", "Open reports folder"),
                            self.open_reports, kind="Link.TButton", icon="folder")

    def _section(self, panel, name, margin=12):
        ttk.Label(panel, text=name, style="Caption.TLabel").pack(anchor="w", padx=16, pady=(margin, 4))
        group = Group(panel)
        group.pack(fill="x")
        return group

    def _row(self, group, label=None, *, height=40, separator=False):
        if separator:
            tk.Frame(group.inner, height=1, background=EDGE).pack(fill="x")
        row = ttk.Frame(group.inner, style="Group.TFrame", height=height)
        row.pack(fill="x")
        row.pack_propagate(False)
        if label:
            ttk.Label(row, text=label, style="Group.TLabel").pack(side="left")
        return row

    def _build_setup(self, panel):
        self.task_title = ttk.Label(panel, style="Title.TLabel")
        self.task_title.pack(anchor="w", pady=(30, 4))
        self.task_intro = ttk.Label(panel, style="Muted.TLabel")
        self.task_intro.pack(anchor="w", pady=(0, 15))
        modes = Group(panel, color=FILL, inset=2, radius=9)
        modes.pack(anchor="w", pady=(0, 15))
        self.reset_task = self._button(modes.inner, self.ui("新建监控", "New monitoring"), self.new_task, kind="Current.TButton")
        self.reset_task.pack(side="left")
        self.continue_button = self._button(modes.inner, self.ui("继续监控…", "Continue monitoring…"),
                                            self.import_previous_report, kind="Segment.TButton")
        self.continue_button.pack(side="left")
        self.report_group = Group(panel)
        report_row = self._row(self.report_group)
        self.change_report = self._button(report_row, self.ui("更换报告…", "Change report…"), self.import_previous_report,
                                           kind="GroupLink.TButton")
        self.change_report.pack(side="right")
        file_icon = self._icon("doc")
        self.report_label = ttk.Label(report_row, style="Group.TLabel", image=file_icon or "", compound="left", anchor="w")
        self.report_label.pack(side="left", fill="x", expand=True, padx=(0, 5))

        self.keyword_group = Group(panel, padding=10)
        self.keyword_group.pack(fill="x")
        self.keyword_group.inner.columnconfigure(1, weight=1)
        self.keyword_caption = ttk.Label(self.keyword_group.inner, text=self.ui("关键词", "Keywords"),
                                        style="GroupMuted.TLabel")
        self.keyword_caption.grid(row=0, column=0, sticky="nw", padx=(0, 14), pady=4)
        self.keyword = tk.Text(self.keyword_group.inner, width=1, height=1, wrap="word", font="TkDefaultFont",
                               background=GROUP, foreground=INK, insertbackground=INK,
                               padx=0, pady=3, highlightthickness=0, borderwidth=0, cursor="xterm")
        self.keyword.grid(row=0, column=1, sticky="ew")
        self.keyword.tag_configure("keyword", background=FILL)
        self.keyword_placeholder = tk.Label(self.keyword, text="", background=GROUP, foreground=TERTIARY, cursor="xterm")
        self.keyword_placeholder.bind("<Button-1>", lambda _: self.keyword.focus_set())
        self.keyword.bind("<<Modified>>", self._keyword_modified)
        self.keyword.bind("<Configure>", self._layout_keyword)
        self.keyword.bind("<FocusIn>", lambda _: self._paint_keyword())
        self.keyword.bind("<FocusOut>", lambda _: self.window.after_idle(self._paint_keyword))
        self.keyword.bind("<Tab>", lambda _: self.keyword.tk_focusNext().focus_set() or "break")
        for sequence in ("<Shift-Tab>", "<ISO_Left_Tab>"):
            self.keyword.bind(sequence, lambda _: self.keyword.tk_focusPrev().focus_set() or "break")
        self.keyword_hint = ttk.Label(panel, style="Caption.TLabel")
        self.keyword_hint.pack(anchor="w", padx=16, pady=(5, 13))

        dates = Group(panel)
        dates.pack(fill="x")
        self.date_fields = []
        for label, value in ((self.ui("开始日期", "Start date"), self.start_date),
                             (self.ui("结束日期", "End date"), self.end_date)):
            row = self._row(dates, label, height=43, separator=bool(self.date_fields))
            icon = self._icon("calendar")
            self._button(row, "▦" if icon is None else "", lambda variable=value: self._calendar(variable),
                         icon="calendar", kind="GroupLink.TButton").pack(side="right", padx=(4, 0))
            field = ttk.Entry(row, textvariable=value, width=13, style="Date.TEntry", justify="right")
            field.pack(side="right")
            self.date_fields.append(field)
            value.trace_add("write", self._update_validation)
        self.date_hint = ttk.Label(panel, style="Caption.TLabel")
        self.date_hint.pack(anchor="w", padx=16, pady=(6, 14))
        settings = Group(panel)
        settings.pack(fill="x")
        row = self._row(settings, height=42)
        self.advanced_button = self._button(row, self.ui("更多设置", "More settings"), self.toggle_options, kind="GroupLink.TButton")
        self.advanced_button.pack(side="left")
        self.settings_summary = self._button(row, "", self.toggle_options, kind="GroupLink.TButton", icon="chevron")
        self.settings_summary.configure(compound="right")
        self.settings_summary.pack(side="right")
        self.setup_feedback = ttk.Label(panel, textvariable=self.status, style="Muted.TLabel", wraplength=580)
        self.status.trace_add("write", self._update_setup_feedback)

    def _build_settings(self, panel):
        self.settings_back = self._button(panel, self.ui("返回任务设置", "Back to task setup"),
                                          lambda: self.show_page("setup"), kind="Link.TButton", icon="back")
        self.settings_back.pack(anchor="w", pady=(7, 1))
        ttk.Label(panel, text=self.ui("更多设置", "More settings"), style="SubTitle.TLabel").pack(anchor="w")
        collection = self._section(panel, self.ui("采集", "Collection"), margin=5)
        row = self._row(collection, self.ui("网页排序", "Sort order"), height=36)
        self.sort_buttons = {}
        for value in reversed(tuple(self.sort_options)):
            button = self._button(row, value, lambda option=value: self.sort.set(option), kind="Sort.TButton")
            button.pack(side="right")
            self.sort_buttons[value] = button
        row = self._row(collection, self.ui("划屏数量", "Screen count"), height=36, separator=True)
        self.screen_picker = ttk.Combobox(row, textvariable=self.screens, width=18, values=(self.bottom, "1", "2", "3", "4"))
        self.screen_picker.pack(side="right")
        ttk.Label(row, text=self.ui("1–4 屏，或输入正整数", "1–4 screens or type a positive integer"),
                  style="GroupMuted.TLabel").pack(side="right", padx=(0, 8))

        report = self._section(panel, self.ui("报告", "Report"), margin=5)
        row = self._row(report, self.ui("报告生成模板", "Report template"), height=36)
        self.template_picker = ttk.Combobox(row, textvariable=self.template, state="readonly", width=24)
        self.template_picker.pack(side="right")
        self.refresh_templates()
        row = self._row(report, height=36, separator=True)
        self._button(row, self.ui("导入 Markdown…", "Import Markdown…"), self.import_template,
                     kind="GroupLink.TButton", icon="doc").pack(side="left")
        ttk.Label(row, text=self.ui(".md · 须含「总结」「总表」「日期」", ".md · requires Summary, Overview, and Date headings"),
                  style="GroupMuted.TLabel").pack(side="right")

        ai = self._section(panel, self.ui("AI 分析（可选）", "AI analysis (optional)"), margin=5)
        row = self._row(ai, self.ui("AI 服务商", "AI provider"), height=36)
        provider = ttk.Combobox(row, textvariable=self.provider, state="readonly", values=self.providers, width=18)
        provider.pack(side="right")
        provider.bind("<<ComboboxSelected>>", self.provider_changed)
        row = self._row(ai, self.ui("模型（可选）", "Model (optional)"), height=36, separator=True)
        ttk.Entry(row, textvariable=self.model, width=26).pack(side="right")
        row = self._row(ai, self.ui("API 密钥（仅本次使用）", "API key (this run only)"), height=36, separator=True)
        ttk.Entry(row, textvariable=self.key, width=26, show="•").pack(side="right")
        row = self._row(ai, self.ui("Qwen 接口地址", "Qwen endpoint"), height=36, separator=True)
        self.endpoint_entry = ttk.Entry(row, textvariable=self.endpoint, width=26, state="disabled")
        self.endpoint_entry.pack(side="right")
        self.screen_error = ttk.Label(panel, style="Error.TLabel", wraplength=580)
        self.ai_hint = ttk.Label(
            panel, text=self.ui("留空密钥则仅导出笔记明细", "Leave the key blank to export notes without AI analysis."),
            style="Caption.TLabel")
        self.ai_hint.pack(anchor="w", padx=16, pady=(6, 0))
        self.sort.trace_add("write", self.update_options_label)
        self.screens.trace_add("write", self.update_options_label)
        self.template.trace_add("write", self.update_options_label)
        self.screens.trace_add("write", self._update_validation)
        self.update_options_label()

    def _build_running(self, panel):
        self.live_title = ttk.Label(panel, style="Title.TLabel")
        self.live_title.pack(anchor="w", pady=(30, 8))
        live = ttk.Frame(panel)
        live.pack(fill="x")
        tk.Label(live, text="●", background=WHITE, foreground=BRAND, font=(self._family, -11)).pack(
            side="left", anchor="n", pady=(4, 0))
        ttk.Label(live, textvariable=self.status, style="Medium.TLabel", wraplength=572).pack(
            side="left", fill="x", expand=True, padx=(6, 0))
        ttk.Label(panel, textvariable=self.run_counts, style="Caption.TLabel").pack(anchor="w", pady=(6, 12))
        self.progress = ProgressTrack(panel)
        self.progress.pack(fill="x")
        self.details = ttk.Frame(self.body)
        ttk.Label(self.details, text=self.ui("执行日志", "Activity log"), style="Caption.TLabel").pack(
            anchor="w", padx=16, pady=(0, 6))
        background = Group(self.details, padding=9)
        background.pack(fill="x")
        area = ttk.Scrollbar(background.inner, orient="vertical")
        area.pack(side="right", fill="y")
        self.log = tk.Text(background.inner, height=5, width=1, wrap="word", background=GROUP, foreground=INK,
                           borderwidth=0, highlightthickness=0, state="disabled", padx=2,
                           yscrollcommand=self._log_scroll_state)
        self.log_scrollbar = area
        area.configure(command=self.log.yview)
        self.log.pack(fill="both", expand=True)
        self.latest_log = self._button(self.details, self.ui("回到最新", "Jump to latest"),
                                       lambda: self.log.see("end"), kind="Link.TButton")

    def _build_result(self, panel):
        header = ttk.Frame(panel)
        header.pack(fill="x", pady=(30, 15))
        self.result_icon = tk.Label(header, background=WHITE, text="", font=(self._family, -26, "bold"))
        self.result_icon.pack(side="left", padx=(0, 14))
        main = ttk.Frame(header)
        main.pack(side="left", fill="x", expand=True)
        self.result_title = ttk.Label(main, style="Title.TLabel", wraplength=538)
        self.result_title.pack(anchor="w")
        ttk.Label(main, textvariable=self.run_counts, style="Caption.TLabel").pack(anchor="w", pady=(3, 0))
        self.result_group = Group(panel, padding=8)
        report_row = self._row(self.result_group, height=53)
        icon = self._icon("doc")
        if icon:
            ttk.Label(report_row, image=icon, style="Group.TLabel").pack(side="left", padx=(0, 12))
        labels = ttk.Frame(report_row, style="Group.TFrame")
        labels.pack(side="left", fill="x", expand=True)
        self.result_file = ttk.Label(labels, style="Group.TLabel")
        self.result_file.pack(anchor="w", pady=(5, 3))
        ttk.Label(labels, text=self.ui("Excel 工作簿 · 报告目录", "Excel workbook · Reports folder"),
                  style="GroupMuted.TLabel").pack(anchor="w")
        self.warning_group = Group(panel)
        row = self._row(self.warning_group, height=42)
        self.result_warning = ttk.Label(row, style="Group.TLabel", wraplength=550)
        self.result_warning.pack(side="left", fill="x")

    def _build_compact(self):
        self.compact = ttk.Frame(self.window, padding=(18, 13, 18, 16))
        header = ttk.Frame(self.compact)
        header.pack(fill="x")
        logo = self._logo(16)
        if logo:
            ttk.Label(header, image=logo).pack(side="left", padx=(0, 7))
        ttk.Label(header, text=self.ui("监控进度", "Monitoring progress"), font=(self._family, -13, "bold")).pack(
            side="left")
        self.compact_status = ttk.Label(header, style="Caption.TLabel", text=self.ui("● 运行中", "● Running"))
        self.compact_status.pack(side="right")
        self.compact_headline = ttk.Label(self.compact, textvariable=self.status, style="Medium.TLabel", wraplength=402)
        self.compact_headline.pack(anchor="w", pady=(17, 6))
        ttk.Label(self.compact, textvariable=self.run_counts, style="Caption.TLabel").pack(anchor="w", pady=(0, 7))
        self.compact_progress = ProgressTrack(self.compact)
        self.compact_progress.pack(fill="x")
        buttons = ttk.Frame(self.compact)
        buttons.pack(side="bottom", fill="x")
        buttons.columnconfigure((0, 1), weight=1, uniform="action")
        self.compact_background = self._button(buttons, self.ui("后台执行", "Background"), self.background,
                                               kind="Compact.TButton", icon="tray")
        self.compact_background.grid(row=0, column=0, sticky="ew", padx=(0, 4))
        self.compact_stop = self._button(buttons, self.ui("停止任务", "Stop task"), self.confirm_stop,
                                        kind="Compact.TButton", icon="stop")
        self.compact_stop.grid(row=0, column=1, sticky="ew", padx=(4, 0))

    def _resize_body(self, _=None):
        width = self.viewport.winfo_width()
        self.viewport.coords(self.body_id, width // 2, 0)
        desired_width = min(CONTENT_WIDTH, max(1, width - 38))
        if self.viewport.itemcget(self.body_id, "width") != f"{desired_width}.0":
            self.viewport.itemconfigure(self.body_id, width=desired_width)
        self.viewport.configure(scrollregion=self.viewport.bbox("all"))

    def _scroll_page(self, event, units):
        if event.widget == self.log or isinstance(event.widget, (tk.Text, ttk.Combobox)):
            return
        if self.body.winfo_height() > self.viewport.winfo_height():
            self.viewport.yview_scroll(units, "units")

    def _scroll_to_focus(self, event):
        widget = event.widget
        if widget is self.settings_back:
            self.viewport.yview_moveto(0)
            return
        total = self.body.winfo_height()
        visible_height = self.viewport.winfo_height()
        if total <= visible_height or not str(widget).startswith(f"{self.body}."):
            return
        offset = self.viewport.canvasy(0)
        top = widget.winfo_rooty() - self.viewport.winfo_rooty()
        bottom = top + widget.winfo_height()
        if top < 0:
            self.viewport.yview_moveto(max(0, offset + top - 5) / total)
        elif bottom > visible_height:
            self.viewport.yview_moveto((offset + bottom - visible_height + 5) / total)

    def _window_resized(self, event):
        if event.widget is not self.window:
            return
        compact = self.page == "running" and event.width < COMPACT_BREAKPOINT
        self.notice.configure(wraplength=max(250, event.width - 44))
        self.compact_headline.configure(wraplength=max(220, event.width - 36))
        if compact != self._is_compact:
            self._layout_running_window(compact)

    def _layout_running_window(self, compact):
        self._is_compact = compact
        if compact:
            self.full.grid_remove()
            self.compact.grid(row=0, column=0, sticky="nsew")
        else:
            self.compact.grid_remove()
            self.full.grid()

    def show_page(self, page):
        self.page = page
        for name, frame in self.pages.items():
            frame.grid(row=0, column=0, sticky="ew") if name == page else frame.grid_remove()
        for name, actions in self.actions.items():
            actions.pack(fill="x") if name == page else actions.pack_forget()
        step_number = {"setup": 0, "settings": 0, "running": 1, "result": 2}[page]
        for index, (step, marker, label) in enumerate(self.steps):
            background = WHITE if index == step_number else FILL
            step.configure(background=background)
            marker.configure(text="✓" if index < step_number else str(index + 1), background=background,
                             foreground=BRAND if index == step_number else MUTED)
            label.configure(background=background, foreground=INK if index == step_number else MUTED,
                            font=(self._family, -13, "bold" if index == step_number else "normal"))
        self.details.pack_forget()
        if page == "running":
            self.details.pack(in_=self.pages["running"], fill="x", pady=(17, 8))
        self.details_button.configure(text=self.ui("执行日志", "Activity log"))
        if page == "setup":
            self._update_setup_feedback()
        self.viewport.yview_moveto(0)
        self._resize_body()
        if page == "settings":
            self.window.after_idle(self._focus_settings)

    def _focus_settings(self):
        if self.page == "settings":
            self.viewport.yview_moveto(0)
            self.settings_back.focus_set()

    def open_running_view(self, *, compact=True):
        self._progress_counts = (0, 0, 0)
        self._log_pinned = True
        self.update_progress_view()
        self.stop_button.state(["!disabled"])
        self.compact_stop.state(["!disabled"])
        self.show_page("running")
        if not compact:
            return
        self._full_geometry = self.window.geometry()
        screen_w, screen_h = self.window.winfo_screenwidth(), self.window.winfo_screenheight()
        width, height = min(440, max(320, screen_w // 3)), min(285, screen_h)
        self.window.minsize(*COMPACT_MINIMUM)
        self.window.geometry(f"{width}x{height}+{max(0, screen_w - width - 12)}+{min(48, max(0, screen_h - height))}")
        self._layout_running_window(True)

    def close_running_view(self):
        if self._full_geometry:
            self.window.minsize(*FULL_MINIMUM)
            self.window.geometry(self._full_geometry)
            self._full_geometry = None
        self._layout_running_window(False)

    def update_progress_view(self, line=""):
        done, total, failed = self._progress_counts
        match = DONE_LINE.fullmatch(line)
        start = START_LINE.match(line)
        if match:
            index, expected = int(match[1]), int(match[2])
            if 0 < index <= expected and index == done + 1 and (total == 0 or total == expected):
                done, total = index, expected
                failed += match[3] == "失败" or match[4] == "failed"
        elif start and done == 0:
            total = int(start[2])
        self._progress_counts = (done, total, failed)
        self.run_counts.set(self.ui(f"已处理 {done} / {total} 个关键词", f"{done} of {total} keywords processed")
                            if total else "")
        for bar in (self.progress, self.compact_progress):
            bar.update_progress(done, total)
        waiting = self.dialog is not None and self.page == "running"
        title = self.ui("等待网页操作", "Waiting for browser interaction") if waiting else self.ui("正在采集笔记", "Collecting notes")
        self.live_title.configure(text=title)
        state = self.ui("⊗ 等待操作", "⊗ Action required") if waiting else self.ui("● 运行中", "● Running")
        self.compact_status.configure(text=state)

    def show_results(self, message):
        self.close_running_view()
        self.show_page("result")
        has_file = self.report is not None and self.report.is_file()
        completed = has_file and not self.cancelled and self.result == 0
        self.result_icon.configure(text="✓" if completed else "⊗", foreground=SUCCESS if completed else ACCENT)
        self.result_title.configure(text=message)
        done, _, failed = self._progress_counts
        if done:
            self.run_counts.set(self.ui(f"{done - failed} 个完成 · {failed} 个失败",
                                        f"{done - failed} completed · {failed} failed"))
        self.result_group.pack_forget()
        self.warning_group.pack_forget()
        if has_file:
            self.result_file.configure(text=self._shorten(self.report.name, 525))
            self.result_group.pack(fill="x")
        self.open_report_button.state(["!disabled"] if has_file else ["disabled"])
        if self.warning:
            self.result_warning.configure(text=f"⊗  {self.warning}")
            self.warning_group.pack(fill="x", pady=(10, 0))
        if not has_file and not self.cancelled:
            self.toggle_details()

    def toggle_details(self):
        if self.page != "result":
            return
        if self.details.winfo_manager():
            self.details.pack_forget()
            self.details_button.configure(text=self.ui("执行日志", "Activity log"))
        else:
            self.details.pack(in_=self.pages["result"], fill="x", pady=(17, 8))
            self.details_button.configure(text=self.ui("收起日志", "Hide log"))

    def _log_scroll_state(self, first, last):
        self.log_scrollbar.set(first, last)
        self._log_pinned = float(last) >= 0.999
        if self._log_pinned:
            self.latest_log.pack_forget()
        elif not self.latest_log.winfo_manager():
            self.latest_log.pack(anchor="e")

    def update_options_label(self, *_):
        for value, button in self.sort_buttons.items():
            button.configure(style="SortCurrent.TButton" if value == self.sort.get() else "Sort.TButton")
        summary = " · ".join((self.sort.get(), self.screens.get(), self.template.get()))
        self.settings_summary.configure(text=self._shorten(summary, 390))

    def toggle_options(self):
        if self.page in ("setup", "settings"):
            self.show_page("setup" if self.page == "settings" else "settings")

    def _shorten(self, value, limit):
        font = tkfont.nametofont("TkDefaultFont")
        if font.measure(value) <= limit:
            return value
        end = len(value)
        while end and font.measure(value[:end] + "…") > limit:
            end -= 1
        return value[:end] + "…"

    def _update_setup_feedback(self, *_):
        if self.status.get() == self.ui("准备就绪", "Ready"):
            self.setup_feedback.pack_forget()
        elif not self.setup_feedback.winfo_manager():
            self.setup_feedback.pack(anchor="w", pady=(10, 0))

    def _keyword_modified(self, _=None):
        if self.keyword.edit_modified():
            self.keyword.edit_modified(False)
            self._layout_keyword()
            self._update_validation()

    def _layout_keyword(self, _=None):
        raw = self.keyword.get("1.0", "end-1c")
        if raw:
            self.keyword_placeholder.place_forget()
        else:
            self.keyword_placeholder.configure(text=self.ui("多个关键词用空格分隔，例如 宝山 硚口",
                                                            "Separate keywords with spaces, e.g. 宝山 硚口"))
            self.keyword_placeholder.place(x=0, y=3)
        self.keyword.tag_remove("keyword", "1.0", "end")
        for match in re.finditer(r"\S+(?=\s)", raw):
            start, end = match.span()
            self.keyword.tag_add("keyword", f"1.0 + {start} chars", f"1.0 + {end} chars")
        line_count = self.keyword.count("1.0", "end", "displaylines", "update")
        lines = min(6, max(1, int(line_count[0]) if isinstance(line_count, tuple) else int(line_count or 1)))
        if int(self.keyword.cget("height")) != lines:
            self.keyword.configure(height=lines)

    def _paint_keyword(self):
        invalid = self._read_errors and not self.keyword.get("1.0", "end-1c").strip()
        focused = self.window.focus_get() == self.keyword
        color = WHITE if invalid or focused else GROUP
        self.keyword_group.color = color
        self.keyword_group.inner.configure(background=color)
        self.keyword.configure(background=color)
        self.keyword_caption.configure(background=color)
        self.keyword_placeholder.configure(background=color)
        self.keyword_group.border = ACCENT if invalid else BRAND if focused else ""
        self.keyword_group.paint()

    def validate_form(self):
        keyword = self.keyword.get("1.0", "end-1c").strip()
        date_error = ""
        bad_date = -1
        dates = [None, None]
        for index, variable in enumerate((self.start_date, self.end_date)):
            try:
                dates[index] = self.parse_date(variable.get())
            except ValueError:
                date_error = self.ui("请输入有效日期，格式为 YYYY-MM-DD。", "Enter valid dates in YYYY-MM-DD format.")
                bad_date = index
        if not date_error and dates[0] > dates[1]:
            date_error = self.ui("结束日期不能早于开始日期。", "The end date cannot be earlier than the start date.")
            bad_date = 0
        keyword_error = "" if keyword else self.ui("请输入至少一个关键词。", "Enter at least one keyword.")
        screens = self.screens.get().strip()
        count = "bottom" if screens == self.bottom else None
        if re.fullmatch(r"[0-9]{1,5}", screens) and 1 <= int(screens) <= 10000:
            count = int(screens)
        screen_error = "" if count is not None else self.ui(
            "划屏请输入 1 至 10000 的整数，或选择「下拉到底」。",
            "Enter a screen count from 1 to 10,000 or select Scroll to bottom.")
        return (keyword, *dates, count), (keyword_error, date_error, screen_error, bad_date)

    def _update_validation(self, *_):
        _, (keyword_error, date_error, screen_error, bad_date) = self.validate_form()
        keyword_notice = self.ui("报告已导入，可增删关键词。", "Report imported. Add or remove keywords.") if self.previous_report else self.ui(
            "多个关键词用空格分隔，每个关键词依次检索。", "Separate keywords with spaces. Each keyword runs in order.")
        show_error = self._read_errors
        self.keyword_hint.configure(text=f"⊗  {keyword_error}" if show_error and keyword_error else keyword_notice,
                                    style="Error.TLabel" if show_error and keyword_error else "Caption.TLabel")
        self.date_hint.configure(text=f"⊗  {date_error}" if date_error else self.ui(
            "北京时间，包含开始与结束当天", "Beijing time, including both dates."),
            style="Error.TLabel" if date_error else "Caption.TLabel")
        for index, field in enumerate(self.date_fields):
            field.state(["invalid"] if index == bad_date else ["!invalid"])
        self.screen_picker.state(["invalid"] if screen_error else ["!invalid"])
        self.screen_error.configure(text=f"⊗  {screen_error}" if screen_error else "")
        if screen_error and not self.screen_error.winfo_manager():
            self.screen_error.pack(anchor="w", before=self.ai_hint, padx=16, pady=(4, 0))
        elif not screen_error:
            self.screen_error.pack_forget()
        disabled = self.worker or self.importing_report or keyword_error or date_error or screen_error
        self.run.state(["disabled"] if disabled else ["!disabled"])
        self._paint_keyword()

    def _calendar(self, variable):
        if self.dialog is not None or self.worker:
            return
        try:
            chosen = self.parse_date(variable.get())
        except ValueError:
            chosen = self.today()
        dialog = tk.Toplevel(self.window)
        dialog.title(self.ui("选择日期", "Choose date"))
        dialog.transient(self.window)
        dialog.resizable(False, False)
        panel = ttk.Frame(dialog, padding=12)
        panel.pack()
        month = ttk.Label(panel, style="Medium.TLabel")
        month.grid(row=0, column=1, columnspan=5, pady=(0, 5))
        year_month = [chosen.year, chosen.month]

        def fill():
            for widget in panel.grid_slaves():
                if widget.grid_info()["row"] >= 2:
                    widget.destroy()
            year, number = year_month
            month.configure(text=self.ui(f"{year} 年 {number} 月", f"{calendar.month_name[number]} {year}"))
            for row, week in enumerate(calendar.Calendar().monthdayscalendar(year, number), 2):
                for col, day in enumerate(week):
                    if day:
                        self._button(panel, str(day),
                                     lambda value=date(year, number, day): select(value), kind="Link.TButton", width=2
                                     ).grid(row=row, column=col, padx=1, pady=1)

        def select(value):
            variable.set(value.isoformat())
            dialog.destroy()

        def move(delta):
            year, number = year_month
            months = min(9999 * 12 - 1, max(0, (year - 1) * 12 + number - 1 + delta))
            year_month[:] = (months // 12 + 1, months % 12 + 1)
            fill()

        for column, sign, direction in ((0, "‹", -1), (6, "›", 1)):
            self._button(panel, sign, lambda value=direction: move(value), kind="Link.TButton").grid(row=0, column=column)
        names = self.ui(("一", "二", "三", "四", "五", "六", "日"), ("Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"))
        for column, name in enumerate(names):
            ttk.Label(panel, text=name, style="Caption.TLabel").grid(row=1, column=column)
        fill()
        self.center_dialog(dialog)
        dialog.bind("<Escape>", lambda _: dialog.destroy())
        dialog.grab_set()

    def center_dialog(self, dialog):
        dialog.update_idletasks()
        minimum_width, minimum_height = dialog.minsize()
        dialog_width = max(dialog.winfo_reqwidth(), minimum_width)
        dialog_height = max(dialog.winfo_reqheight(), minimum_height)
        x = self.window.winfo_rootx() + (self.window.winfo_width() - dialog_width) // 2
        y = self.window.winfo_rooty() + (self.window.winfo_height() - dialog_height) // 2
        dialog.geometry(f"+{max(0, x)}+{max(0, y)}")

    def _keyboard_start(self, event):
        if self.page == "setup" and self.run.instate(["!disabled"]) and not self.dialog and event.widget != self.keyword:
            if not isinstance(event.widget, ttk.Button) or event.widget is self.run:
                self.start()
                return "break"

    def _keyboard_background(self, _):
        if self.page == "running" and not self.dialog and not self.cancelled:
            self.background()
            return "break"

    def _keyboard_stop(self, _):
        if self.page == "running":
            self.confirm_stop()
            return "break"

    def _keyboard_back(self, _):
        if self.page == "settings":
            self.show_page("setup")
            return "break"
