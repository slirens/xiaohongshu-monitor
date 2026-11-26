import { t } from './i18n.mjs';

export const $ = id => document.getElementById(id);

const workbench = document.querySelector('.workbench');
const steps = [...document.querySelectorAll('.steps li')];
const pageScroll = document.querySelector('.page-scroll');
const terms = $('terms');
const tokens = $('keyword-tokens');
const history = $('history');
const results = $('result-list');
const progress = $('progress');
const log = $('log-section');
const logEnd = $('log-end');
const resultSearch = $('result-search');
const resultFilters = $('result-filters');
const filters = [...resultFilters.querySelectorAll('button')];
const headings = { setup: 'setup-title', settings: 'settings-title', run: 'run-title', result: 'result-title' };
const panels = { setup: 'setup', settings: 'settings', run: 'progress-panel', result: 'result' };
const clock = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', timeStyle: 'medium', hourCycle: 'h23' });
let keywordRows = [];
let current;
let running = false;
let expanded = false;
let filter = 'all';

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function glyph(name) {
  const node = element('span', 'icon ' + name);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

export function resizeTerms() {
  terms.style.height = '32px';
  terms.style.height = Math.min(142, Math.max(32, terms.scrollHeight)) + 'px';
}

function editTerms() {
  terms.hidden = false;
  tokens.hidden = true;
  resizeTerms();
  terms.focus();
}

export function refreshTokens() {
  const words = [...terms.value.matchAll(/\S+/gu)];
  terms.hidden = false;
  tokens.hidden = true;
  tokens.replaceChildren();
  if (!words.length || document.activeElement === terms || document.activeElement === $('terms-box')) {
    resizeTerms();
    return;
  }

  const edit = element('button', 'plain token-edit', t('编辑', 'Edit'));
  edit.type = 'button';
  edit.setAttribute('aria-label', t('编辑关键词', 'Edit keywords'));
  edit.addEventListener('click', editTerms);
  const chips = words.map(([word]) => element('span', 'token', word));
  // The chips are a projection of the textarea. Whitespace and order stay in the original input.
  tokens.replaceChildren(...chips, edit);
  terms.hidden = true;
  tokens.hidden = false;
}

terms.addEventListener('input', resizeTerms);
terms.addEventListener('blur', refreshTokens);
$('terms-box').addEventListener('click', event => {
  if (terms.hidden && event.target !== tokens.lastElementChild) editTerms();
});
window.addEventListener('resize', resizeTerms);
void document.fonts.ready.then(resizeTerms);

export function setStage(stage, focus = true) {
  workbench.dataset.stage = stage;
  $('job').hidden = stage === 'run' || stage === 'result';
  for (const [name, id] of Object.entries(panels)) {
    $(id).hidden = name !== stage;
    $(name + '-actions').hidden = name !== stage;
  }
  const active = stage === 'run' ? 1 : stage === 'result' ? 2 : 0;
  for (const [index, step] of steps.entries()) {
    step.toggleAttribute('data-completed', index < active);
    if (index === active) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  }
  $('open-log').disabled = (stage === 'setup' || stage === 'settings') || history.childElementCount === 0;
  pageScroll.scrollTop = 0;
  if (focus) $(headings[stage]).focus({ preventScroll: true });
}

export function message(text) {
  $('status').textContent = text;
  if (running) {
    $('run-detail').textContent = text;
    record(text);
  }
}

function followLog() {
  history.scrollTop = history.scrollHeight;
  logEnd.hidden = true;
}

export function record(text) {
  const last = history.lastElementChild;
  if (last?.lastElementChild.textContent === text) return;
  const follow = history.scrollHeight - history.clientHeight - history.scrollTop < 3;
  const entry = document.createElement('li');
  const time = document.createElement('time');
  const now = new Date();
  time.dateTime = now.toISOString();
  time.textContent = clock.format(now);
  entry.append(time, element('span', '', text));
  history.append(entry);
  // Bound this view while retaining all terminal per-keyword summaries in the results.
  if (history.childElementCount > 2000) history.firstElementChild.remove();
  if (follow) followLog();
  else logEnd.hidden = false;
  if (running || workbench.dataset.stage === 'result') $('open-log').disabled = false;
}

history.addEventListener('scroll', () => {
  logEnd.hidden = history.scrollHeight - history.clientHeight - history.scrollTop < 3;
});
logEnd.addEventListener('click', followLog);
$('open-log').addEventListener('click', () => {
  if (running) {
    $('log-title').focus({ preventScroll: true });
    log.scrollIntoView({ block: 'nearest' });
    return;
  }
  const holder = $('result-log');
  holder.hidden = !holder.hidden;
  if (!holder.hidden) {
    if (expanded) expandResults(false);
    followLog();
    $('log-title').focus({ preventScroll: true });
    log.scrollIntoView({ block: 'nearest' });
  }
});

function noteCount(count) {
  return t(`${count} 条`, `${count} ${count === 1 ? 'note' : 'notes'}`);
}

function renderRow(item, group, statusOverride) {
  const status = statusOverride || item.status;
  const row = element('li', 'row keyword-row');
  const mark = { failed: 'xmark', complete: 'check', active: 'spinner' }[status];
  if (mark) row.append(glyph(mark));
  const title = element('span', 'keyword-name', item.keyword);
  const caption = status === 'complete' ? noteCount(item.notes)
    : status === 'failed' ? t('失败 · 见执行日志', 'Failed · See activity log')
    : status === 'active' ? t('执行中', 'Running')
    : t('等待执行', 'Queued');
  row.append(title, element('span', 'muted', caption));
  group.append(row);
  return row;
}

export function openRun(terms) {
  running = true;
  current = undefined;
  keywordRows = terms.map(keyword => ({ keyword, status: 'queued', notes: 0 }));
  progress.setAttribute('max', String(terms.length));
  progress.setAttribute('value', '0');
  history.replaceChildren();
  $('run-detail').textContent = '';
  $('run-keywords').replaceChildren();
  $('run-keywords').classList.toggle('long', terms.length > 5);
  for (const item of keywordRows) item.row = renderRow(item, $('run-keywords'));
  $('running-log').append(log);
  log.hidden = false;
  $('result-log').hidden = true;
  updateRunCount();
  setStage('run');
}

function updateRunCount() {
  const done = progress.value;
  const size = keywordRows.length;
  $('run-count').textContent = current
    ? t(`正在检索「${current.keyword}」 · 已处理 ${done} / ${size}`, `Searching “${current.keyword}” · ${done} of ${size} processed`)
    : t(`已处理 ${done} / ${size} 个关键词`, `${done} of ${size} keywords processed`);
}

function updateRunRow(item) {
  const list = $('run-keywords');
  const next = renderRow(item, list);
  item.row.replaceWith(next);
  item.row = next;
}

export function beginKeyword(index) {
  current = keywordRows[index];
  current.status = 'active';
  updateRunRow(current);
  if ($('run-keywords').classList.contains('long')) {
    $('run-keywords').scrollTop = current.row.offsetTop - $('run-keywords').offsetTop;
  }
  updateRunCount();
}

export function endKeyword(index, count) {
  const item = keywordRows[index];
  item.status = count === null ? 'failed' : 'complete';
  item.notes = count ?? 0;
  updateRunRow(item);
  current = undefined;
  progress.setAttribute('value', String(index + 1));
  updateRunCount();
}

function group(items, title) {
  if (!items.length) return;
  if (title) results.append(element('h3', 'result-group-title', title));
  const list = element('ul', 'keyword-list');
  for (const item of items) renderRow(item, list);
  results.append(list);
}

function renderResults() {
  results.replaceChildren();
  const completed = keywordRows.filter(item => item.status === 'complete').sort((a, b) => b.notes - a.notes);
  const failed = keywordRows.filter(item => item.status === 'failed');
  const summary = keywordRows.length > 6;
  const showFilter = summary || expanded;
  resultFilters.hidden = !showFilter;
  $('collapse-results').hidden = !expanded;
  resultSearch.parentElement.hidden = !expanded;
  $('result-footnote').hidden = expanded || !summary || filter !== 'all';
  filters[0].textContent = expanded ? t(`全部 ${keywordRows.length}`, `All ${keywordRows.length}`) : t('全部', 'All');
  filters[1].textContent = t(`失败 ${failed.length}`, `Failed ${failed.length}`);
  filters[2].textContent = t(`完成 ${completed.length}`, `Completed ${completed.length}`);
  filters[2].hidden = !expanded;
  for (const button of filters) button.setAttribute('aria-pressed', String(filter === button.dataset.filter));

  if (expanded) {
    const query = resultSearch.value.trim().toLocaleLowerCase();
    const matches = item => item.keyword.toLocaleLowerCase().includes(query);
    const failures = filter === 'complete' ? [] : failed.filter(matches);
    const successes = filter === 'failed' ? [] : completed.filter(matches);
    group(failures, t(`失败 · ${failures.length}`, `Failed · ${failures.length}`));
    group(successes, t(`已完成 · ${successes.length}`, `Completed · ${successes.length}`));
    const pending = filter === 'all' ? keywordRows.filter(item => item.status !== 'complete' && item.status !== 'failed' && matches(item)) : [];
    group(pending, t(`未完成 · ${pending.length}`, `Not completed · ${pending.length}`));
    if (!results.children.length) results.append(element('p', 'row muted', t('没有匹配的关键词', 'No matching keywords')));
    results.scrollTop = 0;
  } else if (summary) {
    const top = filter === 'failed' ? failed.slice(0, 5) : [...failed, ...completed.slice(0, 3)].slice(0, 5);
    group(top);
    if (!top.length) results.append(element('p', 'row muted', t('没有失败的关键词', 'No failed keywords')));
    const button = element('button', 'row result-link', t(`显示全部 ${keywordRows.length} 个关键词`, `Show all ${keywordRows.length} keywords`));
    button.type = 'button';
    button.append(glyph('chevron'));
    button.addEventListener('click', () => expandResults(true));
    results.append(button);
  } else {
    const pending = keywordRows.filter(item => item.status !== 'complete' && item.status !== 'failed');
    group([...failed, ...completed, ...pending]);
  }
}

function expandResults(value, focus = false) {
  expanded = value;
  if (value) $('result-log').hidden = true;
  if (value || filter === 'complete') filter = 'all';
  resultSearch.value = '';
  $('result').dataset.expanded = String(value);
  renderResults();
  pageScroll.scrollTop = 0;
  if (focus || value) (value ? resultSearch : $('result-list').querySelector('button'))?.focus({ preventScroll: true });
}

resultSearch.addEventListener('input', renderResults);
$('collapse-results').addEventListener('click', () => expandResults(false, true));
for (const button of filters) button.addEventListener('click', () => {
  filter = button.dataset.filter;
  renderResults();
});

export function showResult({ title, filename, partial, analysisIncomplete }) {
  running = false;
  if (current) {
    current.status = 'queued';
    current = undefined;
  }
  const kind = filename && !partial && !analysisIncomplete ? 'ok' : 'warning';
  const completed = keywordRows.filter(item => item.status === 'complete').length;
  const failed = keywordRows.filter(item => item.status === 'failed').length;
  const count = keywordRows.reduce((sum, item) => sum + item.notes, 0);
  $('result').dataset.outcome = kind;
  $('result-icon').className = kind === 'ok' ? 'icon check' : 'icon alert';
  $('result-title').textContent = title;
  $('result-summary').textContent = t(
    `${keywordRows.length} 个关键词 · ${completed} 个完成 · ${failed} 个失败 · 共 ${count} 条笔记`,
    `${keywordRows.length} keywords · ${completed} completed · ${failed} failed · ${noteCount(count)}`,
  );
  $('result-file').hidden = !filename;
  $('result-filename').textContent = filename ?? '';
  $('download').hidden = !filename;
  $('result-warning').hidden = !analysisIncomplete;
  $('result-warning').textContent = analysisIncomplete ? t('部分 AI 分析未完成，已保留本次采集数据。', 'Some AI analysis did not complete. Collected data was retained.') : '';
  $('result-log').append(log);
  $('result-log').hidden = Boolean(filename);
  filter = 'all';
  expandResults(false);
  setStage('result');
}