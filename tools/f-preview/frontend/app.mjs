const byId = id => document.getElementById(id);
const setup = byId('setup');
const execution = byId('execution');
const background = byId('background');
const keyword = byId('keyword');
const form = byId('task');
const start = byId('start');
const end = byId('end');
const screens = byId('screens');
const sort = byId('sort');
const taskButton = byId('start-task');
const progress = byId('read-progress');
const confirmation = byId('confirm-stop');
const states = {
  startup: ['启动中', '正在启动浏览器', '准备开始检索，完成后生成一份 Excel 报告。'],
  login: ['需要操作', '等待在浏览器登录', '在正式程序中完成浏览器登录，再返回此处继续。'],
  working: ['执行中', '正在收集笔记', '按关键词依次检索。完成后生成一份 Excel 报告。'],
  export: ['导出中', '正在生成 Excel', '本轮关键词已处理完毕。'],
};
let mode = 'new';
let stage = 'startup';
let terms = [];
let processed = 0;
let timer;
let minimized = false;
let focusBack;

function autosize() {
  keyword.style.height = 'auto';
  keyword.style.height = `${keyword.scrollHeight + 2}px`;
}

function showNotice(message) {
  byId('notice').textContent = message;
  byId('notice').hidden = !message;
}

function setStage(index) {
  [...byId('stages').children].forEach((step, position) => {
    if (position === index) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  });
}

function selectMode(next, loadSample = false) {
  if (next === mode && !loadSample) return;
  mode = next;
  const continuing = mode === 'continue';
  byId('new').setAttribute('aria-pressed', !continuing);
  byId('continue').setAttribute('aria-pressed', continuing);
  byId('previous').hidden = !continuing;
  byId('title').textContent = continuing ? '继续监控' : '新建监控';
  byId('intro').textContent = continuing
    ? '从上次报告取回关键词，可修改后继续检索。'
    : '设置关键词和日期范围，检索后导出 Excel 报告。';
  byId('keyword-help').textContent = continuing ? '已提取 2 个样例关键词，可直接编辑。' : '用空格分隔，每个关键词依次检索。';
  taskButton.textContent = continuing ? '开始续查' : '开始监控';
  keyword.value = continuing ? '宝山 硚口' : '';
  start.value = continuing ? '2026-11-24' : '2026-11-25';
  end.value = '2026-11-25';
  start.setCustomValidity('');
  end.setCustomValidity('');
  setStage(0);
  showNotice('');
  autosize();
  keyword.focus();
}

function updateSummary() {
  byId('setting-summary').textContent = `${sort.value}排序 · ${screens.value ? screens.value + ' 屏' : '下拉到底'}`;
}

function showRun(next, focus = false) {
  stage = next;
  const [label, title, detail] = states[next];
  execution.dataset.state = next;
  byId('run-state').textContent = label;
  byId('run-title').textContent = title;
  byId('run-detail').textContent = detail;
  byId('run-primary').textContent = next === 'login' ? '已登录，继续' : '后台执行';
  const text = next === 'startup' ? '正在准备任务'
    : next === 'login' ? `等待登录 · 0 / ${terms.length}`
      : `已完成 ${processed} / ${terms.length}${next === 'working' ? ' · ' + terms[processed] + '检索中' : ''}`;
  byId('run-count').textContent = text;
  byId('background-status').textContent = text;
  progress.max = terms.length;
  if (next === 'startup') progress.removeAttribute('value');
  else progress.value = processed;
  if (focus) byId('run-title').focus();
}

function closeRun(message, completed = false) {
  clearTimeout(timer);
  minimized = false;
  background.hidden = true;
  execution.hidden = true;
  setup.hidden = false;
  delete document.body.dataset.view;
  setStage(completed ? 2 : 0);
  showNotice(message);
  (focusBack ?? taskButton).focus();
}

function advance() {
  timer = setTimeout(() => {
    processed++;
    if (processed < terms.length) {
      showRun('working');
      advance();
    } else {
      showRun('export');
      timer = setTimeout(() => closeRun('样例任务完成。此预览使用样例数据。', true), 650);
    }
  }, 1300);
}

byId('new').addEventListener('click', () => selectMode('new'));
byId('continue').addEventListener('click', () => selectMode('continue'));
byId('change-report').addEventListener('click', () => selectMode('continue', true));
keyword.addEventListener('input', autosize);
new ResizeObserver(autosize).observe(form);
screens.addEventListener('input', updateSummary);
sort.addEventListener('change', updateSummary);
for (const date of [start, end]) date.addEventListener('input', () => end.setCustomValidity(''));
byId('open-reports').addEventListener('click', () => showNotice('报告目录会在正式监控版中可用。'));

form.addEventListener('submit', event => {
  event.preventDefault();
  const unique = new Set();
  terms = keyword.value.trim().split(/\s+/u).filter(term => {
    const key = term.toLowerCase();
    if (!key || unique.has(key)) return false;
    unique.add(key);
    return true;
  });
  if (!terms.length) {
    showNotice('请输入至少一个关键词。');
    keyword.focus();
    return;
  }
  if (start.value > end.value) {
    end.setCustomValidity('结束日期不能早于开始日期。');
    end.reportValidity();
    return;
  }
  focusBack = document.activeElement;
  processed = 0;
  setStage(1);
  setup.hidden = true;
  execution.hidden = false;
  document.body.dataset.view = 'execution';
  showRun('startup', true);
  timer = setTimeout(() => {
    if (minimized) byId('restore').click();
    showRun('login', true);
  }, 700);
});

byId('run-primary').addEventListener('click', () => {
  if (stage === 'login') {
    showRun('working', true);
    advance();
    return;
  }
  minimized = true;
  execution.hidden = true;
  background.hidden = false;
  byId('restore').focus();
});

byId('restore').addEventListener('click', () => {
  minimized = false;
  background.hidden = true;
  execution.hidden = false;
  byId('run-title').focus();
});

byId('stop').addEventListener('click', () => {
  confirmation.returnValue = '';
  confirmation.showModal();
});
confirmation.addEventListener('close', () => {
  if (confirmation.returnValue === 'stop') closeRun('任务已停止。保留本次关键词和日期。');
});
