import { AI_PROVIDERS, analyzeNote, summarizeKeyword } from './ai.mjs';
import { openBrowser } from './browser.mjs';
import { checkAbort } from './cancel.mjs';
import { collectKeyword } from './collect.mjs';
import { chinaDate, validDate } from './dates.mjs';
import { localizePage, t, visibleError } from './i18n.mjs';
import { makeReportSheets, parseReportTemplate } from './report-template.mjs';
import { buildWorkbook } from './workbook.mjs';

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
  if (controller) return;
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
  let failures = 0;
  let analysisIncomplete = false;
  let apiBlocked = '';
  try {
    $('start-job').disabled = true;
    $('template').disabled = true;
    $('reset-template').disabled = true;
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
      try {
        const report = await collectKeyword(browser, keyword, range, ask, message, signal);
        report.info = { 开始日期: range.start, 结束日期: range.end };
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
        if (summarize) {
          if (!config) report.summaryStatus = '未配置 API，已导出样本与统计。';
          else if (!report.notes.length) report.summaryStatus = '没有可用于总结的样本。';
          else if (apiBlocked) report.summaryStatus = apiBlocked;
          else {
            message(t(`正在总结「${keyword}」…`, `Summarizing “${keyword}”…`));
            try {
              report.summary = await summarizeKeyword({ ...ai, keyword, notes: report.notes, range });
            } catch (error) {
              checkAbort(signal);
              analysisIncomplete = true;
              report.summaryStatus = error.message;
              record(t(`「${keyword}」AI 总结未完成 · ${error.message}`, `“${keyword}” · AI summary incomplete · ${visibleError(error)}`));
            }
          }
        }
        reports.push(report);
        const count = report.notes.length;
        record(t(`${index + 1}/${terms.length} · 「${keyword}」完成 · ${count} 条`, `${index + 1}/${terms.length} · “${keyword}” complete · ${count} ${count === 1 ? 'note' : 'notes'}`));
      } catch (error) {
        checkAbort(signal);
        failures++;
        reports.push({ keyword, failed: true, notes: [] });
        record(t(`${index + 1}/${terms.length} · 「${keyword}」失败 · ${error.message}`, `${index + 1}/${terms.length} · “${keyword}” failed · ${visibleError(error)}`));
      }
      $('progress').value = index + 1;
    }
    if (failures === terms.length) throw new Error(t('本次没有完成的关键词，请查看下方进度。', 'No keywords completed. See the progress log below.'));
    // Legacy browser reports always include a keyword sheet, including for one keyword.
    const layout = makeReportSheets(template, reports, { includeSingleKeyword: true });
    saved = buildWorkbook(reports, layout);
    reportName = `${t('舆情', 'Xiaohongshu')}_${range.start}_${range.end}.xlsx`;
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
    $('prompt').hidden = true;
    $('show-browser').hidden = true;
    $('stop').hidden = true;
    $('start-job').disabled = false;
  }
});
