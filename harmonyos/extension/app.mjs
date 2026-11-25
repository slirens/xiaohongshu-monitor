import { AI_PROVIDERS, analyzeNote, summarizeRun } from './ai.mjs';
import { openBrowser } from './browser.mjs';
import { checkAbort } from './cancel.mjs';
import { collectKeyword } from './collect.mjs';
import { compareEngagement, continuationMetadata, continuationNoteKey, continuationReports, keywordStart, mergeContinuation } from './continuation.mjs';
import { chinaDate, validDate } from './dates.mjs';
import { localizePage, t, visibleError } from './i18n.mjs';
import { makeReportSheets, parseReportTemplate } from './report-template.mjs';
import { latestReport, loadReport, saveReport } from './report.mjs';

const $ = id => document.getElementById(id);
localizePage();
const termsInput = $('terms');
function resizeTerms() {
  termsInput.style.height = '51px';
  termsInput.style.height = Math.min(190, Math.max(51, termsInput.scrollHeight + 2)) + 'px';
}
termsInput.addEventListener('input', resizeTerms);
window.addEventListener('resize', resizeTerms);
void document.fonts.ready.then(resizeTerms);

function updateSettingsSummary() {
  const sort = $('sort').selectedOptions[0]?.textContent || t('最新', 'Latest');
  const screens = Number($('screens').value);
  const scope = screens ? t(`${screens} 屏`, `${screens} ${screens === 1 ? 'screen' : 'screens'}`) : t('下拉到底', 'Scroll to end');
  $('settings-summary').textContent = `${sort} · ${scope}`;
}
$('sort').addEventListener('change', updateSettingsSummary);
$('screens').addEventListener('input', updateSettingsSummary);
updateSettingsSummary();

const today = chinaDate.format();
for (const input of [$('start'), $('end')]) {
  input.value = today;
  input.max = today;
}
for (const config of AI_PROVIDERS) $('provider').append(new Option(config.name, config.name));
$('provider').addEventListener('change', () => {
  const config = AI_PROVIDERS.find(item => item.name === $('provider').value);
  $('key').value = '';
  $('model').value = '';
  $('model').placeholder = config?.model || t('使用服务商默认模型', 'Use the provider’s default model');
  for (const name of ['key', 'model']) $(name).disabled = !config;
  $('ai-hint').hidden = !config;
});

let controller;
let browser;
let pending;
let saved;
let reportName;
let latest;
let previous;
let suggestedStart;
let selectingReport = false;
const builtInTemplate = parseReportTemplate();
let selectedTemplate = { value: builtInTemplate };

async function readTemplate() {
  const file = $('template').files[0];
  $('reset-template').hidden = !file;
  if (!file) {
    selectedTemplate = { value: builtInTemplate };
    $('template-status').textContent = t('当前使用内置模板', 'Using the built-in template');
    $('start-job').disabled = Boolean(controller);
    return;
  }
  const selection = {};
  selectedTemplate = selection;
  $('start-job').disabled = true;
  $('template-status').textContent = t('正在校验模板…', 'Checking the template…');
  try {
    if (!/\.md$/i.test(file.name) || file.size > 48000) {
      throw new Error(t('请选择不超过 48 KB 的 Markdown 模板。', 'Select a Markdown template of 48 KB or less.'));
    }
    selection.value = parseReportTemplate(await file.text(), file.name);
  } catch (error) {
    selection.error = visibleError(error);
  }
  if (selectedTemplate !== selection) return;
  $('template-status').textContent = selection.error || t(`已校验 · ${selection.value.name}`, `Validated · ${selection.value.name}`);
  $('start-job').disabled = Boolean(controller);
}

$('template').addEventListener('change', readTemplate);
$('reset-template').addEventListener('click', () => {
  $('template').value = '';
  void readTemplate();
});

function message(text) {
  $('status').textContent = text;
}

function record(text) {
  const entry = document.createElement('li');
  entry.textContent = text;
  $('history').append(entry);
}

function selectReport(state, name) {
  const meta = continuationMetadata(state);
  if (!meta.keywords.length) throw new Error(t('此报告中未找到可恢复的关键词。', 'No recoverable keywords were found in this report.'));
  previous = state;
  suggestedStart = meta.end && meta.end <= chinaDate.format() ? meta.end : chinaDate.format();
  termsInput.value = meta.keywords.join(' ');
  resizeTerms();
  $('start').value = suggestedStart;
  $('end').value = chinaDate.format();
  $('import-report-button').hidden = false;
  $('clear-report').hidden = false;
  $('report-source').hidden = false;
  $('report-source').textContent = t(`继续自 ${name}`, `Continuing from ${name}`);
  message(t('关键词已恢复，可增补后继续搜索。', 'Keywords restored. You can add more before searching.'));
}

$('continue-job').addEventListener('click', async () => {
  if (controller || selectingReport) return;
  try {
    selectingReport = true;
    latest ??= await latestReport().catch(() => undefined);
    if (latest) selectReport(latest.state, latest.name);
    else $('import-report').click();
  } catch (error) {
    message(visibleError(error));
  } finally {
    selectingReport = false;
  }
});
$('import-report-button').addEventListener('click', () => $('import-report').click());
$('clear-report').addEventListener('click', () => {
  if (controller || selectingReport) return;
  previous = undefined;
  $('import-report-button').hidden = true;
  $('clear-report').hidden = true;
  $('report-source').hidden = true;
  message(t('准备就绪', 'Ready'));
});
$('import-report').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file || selectingReport || controller) return;
  try {
    selectingReport = true;
    message(t('正在打开报告…', 'Opening the report…'));
    if (!/\.xlsx$/i.test(file.name) || file.size > 25 * 1024 * 1024) {
      throw new Error(t('请选择不超过 25 MB 的 Excel 报告。', 'Select an Excel report of 25 MB or less.'));
    }
    selectReport(await loadReport(file), file.name);
  } catch (error) {
    message(t(`打开报告失败 · ${visibleError(error)}`, `Could not open the report · ${visibleError(error)}`));
  } finally {
    selectingReport = false;
  }
});

function permissionFor(origin) {
  return new Promise((resolve, reject) => {
    const api = globalThis.chrome?.permissions;
    if (typeof api?.request !== 'function') {
      reject(new Error(t('当前浏览器无法授予 AI 接口访问权限。可以选择跳过 AI 分析。', 'This browser cannot grant access to the AI provider. You can skip AI analysis.')));
      return;
    }
    api.request({ origins: [origin] }, granted => {
      const error = globalThis.chrome.runtime.lastError;
      if (error || !granted) reject(new Error(t('AI 接口访问权限未开启。', 'Access to the AI provider was not granted.')));
      else resolve();
    });
  });
}

async function ask(text) {
  $('prompt-text').textContent = text;
  $('prompt').hidden = false;
  message(t('等待完成网页操作', 'Waiting for you to finish in the browser tab'));
  await browser.mode('foreground');
  checkAbort(controller.signal);
  await new Promise(resolve => { pending = resolve; });
  $('prompt').hidden = true;
  checkAbort(controller.signal);
  await browser.mode('background');
}

function download() {
  if (!saved) return;
  const url = URL.createObjectURL(new Blob([saved], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = reportName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

$('proceed').addEventListener('click', () => {
  const resolve = pending;
  pending = undefined;
  resolve?.();
});
$('show-browser').addEventListener('click', () => {
  browser?.mode('foreground').catch(error => message(visibleError(error)));
});
$('stop').addEventListener('click', () => {
  controller?.abort(new Error(t('任务已停止', 'Task stopped')));
  const resolve = pending;
  pending = undefined;
  resolve?.();
});
$('download').addEventListener('click', download);

$('job').addEventListener('submit', async event => {
  event.preventDefault();
  if (controller || selectingReport) return;
  const terms = [...new Set($('terms').value.trim().split(/\s+/u).filter(Boolean))];
  const range = { start: $('start').value, end: $('end').value, sort: $('sort').value, screens: Number($('screens').value) };
  if (!terms.length || !validDate(range.start) || !validDate(range.end) || range.start > range.end || range.end > chinaDate.format()) {
    message(t('请输入关键词及有效的起止日期。', 'Enter keywords and a valid date range.'));
    return;
  }
  const template = selectedTemplate.value;
  if (!template) {
    message(selectedTemplate.error || t('正在校验报告模板。', 'Checking the report template.'));
    return;
  }
  const summarize = template.sheets.some(sheet => sheet.kind === 'summary');
  const config = template.fields.length || summarize ? AI_PROVIDERS.find(item => item.name === $('provider').value) : undefined;
  const key = $('key').value.trim();
  const model = $('model').value.trim();
  if (config && !key) { message(t('请输入所选服务商的 API 密钥。', 'Enter the API key for the selected provider.')); return; }
  controller = new AbortController();
  const { signal } = controller;
  const ai = { provider: config?.name, key, model, template, signal };
  const reports = [];
  const history = new Map((previous?.notes ?? []).map(note => [continuationNoteKey(note), note]));
  const refreshedIds = new Set();
  let failures = 0;
  let analysisIncomplete = false;
  let apiBlocked = '';
  try {
    $('start-job').disabled = true;
    $('template').disabled = true;
    $('reset-template').disabled = true;
    for (const id of ['continue-job', 'clear-report', 'import-report-button']) $(id).disabled = true;
    $('stop').hidden = false;
    $('progress-panel').hidden = false;
    $('history').replaceChildren();
    $('progress').max = terms.length;
    $('progress').value = 0;
    $('download').hidden = true;
    saved = null;
    if (config) await permissionFor(config.origin);
    checkAbort(signal);
    message(t('正在打开采集标签页…', 'Opening the collection tab…'));
    browser = await openBrowser('https://www.xiaohongshu.com/explore');
    await browser.mode('background');
    $('show-browser').hidden = false;
    for (const [index, keyword] of terms.entries()) {
      checkAbort(signal);
      const start = previous ? keywordStart(previous, keyword, range.start, range.end, { useCoverage: range.start === suggestedStart }) : range.start;
      const keywordRange = { ...range, start };
      const info = { 关键词: keyword, 开始日期: start, 结束日期: range.end };
      try {
        const tracked = (previous?.notes ?? []).filter(note => !refreshedIds.has(note.id) && note.keywords.includes(keyword));
        const report = await collectKeyword(browser, keyword, keywordRange, ask, message, signal, tracked);
        report.info = info;
        for (const note of [...report.notes, ...report.refreshed]) {
          const prior = history.get(continuationNoteKey(note));
          if (prior) note.comparison = compareEngagement(prior.engagement, note.engagement);
          if (Object.values(note.engagement).some(value => value !== null)) refreshedIds.add(note.id);
        }
        let incomplete = 0;
        if (template.fields.length) for (const [index, note] of report.notes.entries()) {
          checkAbort(signal);
          if (!config) { note.error = '未配置 API'; continue; }
          if (apiBlocked) { note.error = apiBlocked; incomplete++; continue; }
          message(t(`正在分析「${keyword}」${index + 1}/${report.notes.length}…`, `Analyzing “${keyword}” · ${index + 1}/${report.notes.length}…`));
          try {
            note.analysis = await analyzeNote({ ...ai, keyword, note });
          } catch (error) {
            checkAbort(signal);
            note.error = error.message;
            if (/HTTP (401|403|404|429)\b/.test(error.message)) apiBlocked = error.message;
            incomplete++;
          }
        }
        if (incomplete) {
          analysisIncomplete = true;
          record(t(`「${keyword}」${incomplete} 条笔记的 AI 分析未完成。`, `“${keyword}” · AI analysis incomplete for ${incomplete} ${incomplete === 1 ? 'note' : 'notes'}.`));
        }
        reports.push(report);
        const count = report.notes.length;
        record(t(`${index + 1}/${terms.length} · 「${keyword}」完成 · ${count} 条`, `${index + 1}/${terms.length} · “${keyword}” complete · ${count} ${count === 1 ? 'note' : 'notes'}`));
      } catch (error) {
        checkAbort(signal);
        failures++;
        reports.push({ keyword, failed: true, notes: [], info: { ...info, 处理状态: '失败' } });
        record(t(`${index + 1}/${terms.length} · 「${keyword}」失败 · ${error.message}`, `${index + 1}/${terms.length} · “${keyword}” failed · ${visibleError(error)}`));
      }
      $('progress').value = index + 1;
    }
    if (failures === terms.length) throw new Error(t('本次没有完成的关键词，请查看下方进度。', 'No keywords completed. See the progress log below.'));
    const state = mergeContinuation(previous, reports, range);
    let summary;
    let summaryStatus;
    if (summarize) {
      if (!config) summaryStatus = '未配置 API，已导出样本与统计。';
      else if (apiBlocked) summaryStatus = apiBlocked;
      else if (!state.notes.some(note => note.changeType !== 'not_seen')) summaryStatus = '没有可用于总结的样本。';
      else {
        try {
          message(t('正在分析本轮舆情变化…', 'Analyzing this run’s findings…'));
          summary = await summarizeRun({ ...ai, state, reports });
          state.runs.at(-1).summaries = summary;
        } catch (error) {
          checkAbort(signal);
          analysisIncomplete = true;
          summaryStatus = visibleError(error);
        }
      }
    }
    const reportDetails = continuationReports(state, reports).map((report, index) => ({
      keyword: state.keywords[index], failed: report.info?.处理状态 === '失败', ...report,
    }));
    const layout = makeReportSheets(template, reportDetails, {
      includeSingleKeyword: true, continuationState: state, summary, summaryStatus,
    });
    saved = await saveReport(layout, state);
    const suffix = crypto.randomUUID().slice(0, 6);
    const day = state.runs.at(-1).day.slice(2).replaceAll('-', '');
    reportName = `${t('舆情', 'Xiaohongshu')}_${day}_${suffix}.xlsx`;
    latest = { state, name: reportName };
    await latestReport(latest).catch(() => {});
    if (previous) {
      previous = state;
      $('report-source').textContent = t(`继续自 ${reportName}`, `Continuing from ${reportName}`);
    }
    $('download').hidden = false;
    message(failures ? t('已生成 Excel · 部分关键词未完成', 'Excel ready · Some keywords did not complete') :
      analysisIncomplete ? t('已生成 Excel · 部分 AI 分析未完成', 'Excel ready · Some AI analysis did not complete') : t('已生成 Excel', 'Excel ready'));
    download();
  } catch (error) {
    message(signal.aborted ? t('任务已停止', 'Task stopped') : visibleError(error));
  } finally {
    await browser?.close().catch(() => {});
    browser = undefined;
    pending = undefined;
    controller = undefined;
    $('key').value = '';
    $('template').disabled = false;
    $('reset-template').disabled = false;
    for (const id of ['continue-job', 'clear-report', 'import-report-button']) $(id).disabled = false;
    $('prompt').hidden = true;
    $('show-browser').hidden = true;
    $('stop').hidden = true;
    $('start-job').disabled = false;
  }
});
