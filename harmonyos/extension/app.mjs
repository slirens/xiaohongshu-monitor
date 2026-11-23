import { AI_PROVIDERS, summarizeKeyword } from './ai.mjs';
import { openBrowser } from './browser.mjs';
import { checkAbort } from './cancel.mjs';
import { collectKeyword } from './collect.mjs';
import { chinaDate, validDate } from './dates.mjs';
import { buildWorkbook } from './workbook.mjs';

const $ = id => document.getElementById(id);
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
  $('model').placeholder = config?.model || '使用服务商默认模型';
  for (const name of ['key', 'model', 'template']) $(name).disabled = !config;
  $('ai-hint').hidden = !config;
});

let controller;
let browser;
let pending;
let saved;
let reportName;

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
      reject(new Error('当前浏览器无法授予 AI 接口访问权限。可以选择跳过 AI 分析。'));
      return;
    }
    api.request({ origins: [origin] }, granted => {
      const error = globalThis.chrome.runtime.lastError;
      if (error || !granted) reject(new Error('AI 接口访问权限未开启。'));
      else resolve();
    });
  });
}

async function ask(text, choices = []) {
  $('prompt-text').textContent = text;
  $('prompt-choice').replaceChildren(...choices.map(value => new Option(value, value)));
  $('prompt-choice-label').hidden = !choices.length;
  $('prompt').hidden = false;
  message('等待完成网页操作');
  await browser.mode('foreground');
  checkAbort(controller.signal);
  const answer = await new Promise(resolve => { pending = resolve; });
  $('prompt').hidden = true;
  checkAbort(controller.signal);
  await browser.mode('background');
  return answer;
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
  resolve?.($('prompt-choice').value);
});
$('show-browser').addEventListener('click', () => {
  browser?.mode('foreground').catch(error => message(error.message));
});
$('stop').addEventListener('click', () => {
  controller?.abort(new Error('任务已停止'));
  const resolve = pending;
  pending = undefined;
  resolve?.('');
});
$('download').addEventListener('click', download);

$('job').addEventListener('submit', async event => {
  event.preventDefault();
  if (controller) return;
  const terms = [...new Set($('terms').value.trim().split(/\s+/u).filter(Boolean))];
  const range = { start: $('start').value, end: $('end').value, sort: $('sort').value, screens: Number($('screens').value) };
  if (!terms.length || !validDate(range.start) || !validDate(range.end) || range.start > range.end || range.end > chinaDate.format()) {
    message('请输入关键词及有效的起止日期。');
    return;
  }
  const config = AI_PROVIDERS.find(item => item.name === $('provider').value);
  const key = $('key').value.trim();
  const model = $('model').value.trim();
  const file = $('template').files[0];
  if (config && !key) { message('请输入所选服务商的 API 密钥。'); return; }
  if (config && file && (!/\.md$/i.test(file.name) || file.size > 48000)) {
    message('请选择不超过 48 KB 的 Markdown 模板。');
    return;
  }
  controller = new AbortController();
  const { signal } = controller;
  let template = '';
  const reports = [];
  let failures = 0;
  try {
    $('start-job').disabled = true;
    $('stop').hidden = false;
    $('history').replaceChildren();
    $('progress').max = terms.length;
    $('progress').value = 0;
    $('download').hidden = true;
    saved = null;
    if (config) {
      await permissionFor(config.origin);
      template = file ? await file.text() : '';
      if (template.length > 12000) throw new Error('Markdown 模板不能超过 12,000 个字符。');
    }
    checkAbort(signal);
    message('正在打开采集标签页…');
    browser = await openBrowser('https://www.xiaohongshu.com/explore');
    await browser.mode('background');
    $('show-browser').hidden = false;
    for (const [index, keyword] of terms.entries()) {
      checkAbort(signal);
      try {
        const report = await collectKeyword(browser, keyword, range, ask, message, signal);
        if (config && report.notes.length) {
          message(`正在分析「${keyword}」…`);
          try {
            report.summary = await summarizeKeyword({ provider: config.name, key, model, keyword, notes: report.notes, template, signal });
          } catch (error) {
            checkAbort(signal);
            record(`「${keyword}」AI 分析失败 · ${error.message}`);
          }
        }
        reports.push(report);
        record(`${index + 1}/${terms.length} · 「${keyword}」完成 · ${report.notes.length} 条`);
      } catch (error) {
        checkAbort(signal);
        failures++;
        record(`${index + 1}/${terms.length} · 「${keyword}」失败 · ${error.message}`);
      }
      $('progress').value = index + 1;
    }
    if (!reports.length) throw new Error('本次没有完成的关键词，请查看下方进度。');
    saved = buildWorkbook(reports);
    reportName = `舆情_${range.start}_${range.end}.xlsx`;
    $('download').hidden = false;
    message(failures ? '已生成 Excel · 部分关键词未完成' : '已生成 Excel');
    download();
  } catch (error) {
    message(signal.aborted ? '任务已停止' : error.message);
  } finally {
    await browser?.close().catch(() => {});
    browser = undefined;
    pending = undefined;
    controller = undefined;
    $('key').value = '';
    $('prompt').hidden = true;
    $('show-browser').hidden = true;
    $('stop').hidden = true;
    $('start-job').disabled = false;
  }
});
