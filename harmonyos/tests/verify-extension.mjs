import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const worktree = resolve(root, '..');
const scratch = process.env.XHS_TEST_DIRECTORY || (dirname(worktree).endsWith('.portable-build') ? dirname(worktree) : worktree);
const require = createRequire(resolve(process.env.XHS_RUNTIME || join(worktree, 'runtime'), 'package.json'));
const { chromium } = require('playwright');
const { Workbook } = require('exceljs');
const windowsBrowsers = join(scratch, 'win-x86-browser');
const browserFiles = process.platform === 'win32' && existsSync(windowsBrowsers)
  ? await readdir(windowsBrowsers) : [];
const executablePath = process.env.XHS_CHROMIUM || browserFiles
  .map(version => join(windowsBrowsers, version, 'chrome-win32', 'chrome.exe'))
  .find(path => existsSync(path));
const temporary = await mkdtemp(join(scratch, 'verify-harmony-extension-'));
const extension = process.env.XHS_TEST_EXTENSION
  ? resolve(process.env.XHS_TEST_EXTENSION) : join(temporary, 'extension');
if (!process.env.XHS_TEST_EXTENSION) {
  execFileSync(process.execPath, [join(root, 'build.mjs'), extension], { stdio: 'inherit' });
}

const origin = 'https://www.xiaohongshu.com';
const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' });
const now = Date.now();
const today = dateFormat.format(now);
const yesterday = dateFormat.format(now - 86400000);
const cases = new Map([
  ['宝山', '0123456789abcdef01234567'],
  ['硚口', '123456789abcdef012345678'],
]);
const old = 'aaaaaaaaaaaaaaaaaaaaaaaa';

function notesPage(keyword, id) {
  return `<!doctype html><meta charset="utf-8">
    <button onclick="document.getElementById('filters').hidden = false">筛选</button>
    <section id="filters" hidden>
      <h3>排序依据</h3><button onclick="this.parentNode.dataset.sort = 'latest'">最新</button>
      <h3>发布时间</h3>
      <button onclick="if (this.parentNode.dataset.sort === 'latest') document.getElementById('notes').hidden = false">一天内</button>
    </section>
    <div id="notes" hidden>
      <section class="note-item"><a href="/search_result/${id}?fixture=card">${keyword}新笔记</a><time>${today}</time></section>
      <section class="note-item"><a href="/explore/${old}">${keyword}旧笔记</a><time>${yesterday}</time></section>
    </div>`;
}

async function verify(locale) {
  const english = locale === 'en-US';
  const searched = [];
  const opened = [];
  let signedIn = false;
  let searchHomeVisits = 0;
  const context = await chromium.launchPersistentContext(join(temporary, `profile-${locale}`), {
    ...(executablePath ? { executablePath } : { channel: 'chromium' }),
    headless: process.env.XHS_HEADED !== '1',
    acceptDownloads: true,
    locale,
    args: [
      `--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      `--lang=${locale}`,
      '--window-position=-20000,-20000',
      '--host-resolver-rules=MAP www.xiaohongshu.com 127.0.0.1, MAP xiaohongshu.com 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE localhost',
    ],
  });
  try {
    await context.route(`${origin}/**`, async route => {
      const url = new URL(route.request().url());
      const html = body => route.fulfill({ contentType: 'text/html; charset=utf-8', body });
      if (url.pathname === '/explore') {
        searchHomeVisits++;
        return html('<meta charset="utf-8"><p>小红书测试首页</p>');
      }
      if (url.pathname === '/fixture-confirm-login') {
        signedIn = true;
        return html('<meta charset="utf-8"><p>测试登录成功</p>');
      }
      if (url.pathname === '/search_result') {
        const keyword = url.searchParams.get('keyword');
        const id = cases.get(keyword);
        if (!id) return route.fulfill({ status: 404 });
        searched.push(keyword);
        if (!signedIn) return html('<meta charset="utf-8"><h1>扫码登录</h1><a href="/fixture-confirm-login">模拟完成登录</a>');
        return html(notesPage(keyword, id));
      }
      for (const [keyword, id] of cases) {
        if (url.pathname === `/search_result/${id}`) {
          return html(`<script>location.href = "/explore/${id}?fixture=final&xsec_source=pc_search";</script>`);
        }
        if (url.pathname === `/explore/${id}`) {
          opened.push(id);
          return html(`<meta charset="utf-8"><div class="note-content">
            <h1 id="detail-title">${keyword}新笔记</h1><p id="detail-desc">示例正文</p><span class="date">${today}</span>
            </div>`);
        }
      }
      if (url.pathname === `/explore/${old}`) opened.push(old);
      return route.fulfill({ status: 404 });
    });
    await context.route('https://xiaohongshu.com/**', route => route.abort());

    const launcher = context.pages()[0] || await context.newPage();
    await launcher.goto('chrome://extensions-internals/');
    const internals = await launcher.locator('pre').innerText();
    // Older Chromium builds may emit an invalid diagnostic path. The test only needs names and IDs.
    const listing = JSON.parse(internals.replace(/^(\s*"path"\s*:\s*)"[^\r\n]*"(?=,?\s*$)/gm, '$1""'));
    const installed = listing.find(item => ['小红书舆情监控', 'Xiaohongshu Monitor'].includes(item.name));
    assert.match(installed?.id || '', /^[a-p]{32}$/, 'built unpacked extension loaded');
    await launcher.goto(`chrome-extension://${installed.id}/launcher.html`);
    const dashboardOpened = context.waitForEvent('page');
    await launcher.getByRole('button', { name: english ? 'Open dashboard' : '打开监控工作台' }).click();
    const dashboard = await dashboardOpened;
    const errors = [];
    dashboard.on('pageerror', error => errors.push(error.message));
    await dashboard.waitForURL(`chrome-extension://${installed.id}/index.html`);
    await dashboard.getByRole('heading', { name: english ? 'New monitoring task' : '新建监控任务' }).waitFor();
    assert.equal(await dashboard.locator('html').getAttribute('lang'), english ? 'en' : 'zh-CN');
    assert.equal(await dashboard.locator('#status').innerText(), english ? 'Ready' : '准备就绪');
    await dashboard.locator('.sidebar img').evaluate(image => image.decode());
    const terms = dashboard.locator('#terms');
    const collapsedHeight = await terms.evaluate(field => field.offsetHeight);
    await terms.hover();
    await dashboard.waitForFunction(() => getComputedStyle(document.querySelector('#terms')).borderColor === 'rgb(147, 173, 208)');
    assert.equal(await terms.evaluate(field => getComputedStyle(field).cursor), 'text');
    assert.equal(await terms.evaluate(field => field.offsetHeight), collapsedHeight, 'hover keeps the field in place');
    await terms.focus();
    await dashboard.waitForFunction(() => getComputedStyle(document.querySelector('#terms')).borderColor === 'rgb(68, 116, 203)');
    await terms.fill('first\nsecond\nthird');
    assert.ok(await terms.evaluate(field => field.offsetHeight) > collapsedHeight + 35, 'keyword input grows for multiple lines');
    await terms.fill([...cases.keys()].join(' '));
    assert.equal(await terms.evaluate(field => field.offsetHeight), collapsedHeight);
    await dashboard.locator('summary').click();
    await dashboard.locator('#screens').fill('1');
    assert.equal(await dashboard.locator('#settings-summary').innerText(), english ? 'Latest · 1 screen' : '最新 · 1 屏');
    const templateInput = dashboard.locator('#template');
    await templateInput.setInputFiles({ name: '无效模板.md', mimeType: 'text/markdown', buffer: Buffer.from('# 无效的模板') });
    const invalidTemplate = english ? /Invalid report template/ : /报告模板无效/;
    await dashboard.locator('#template-status').filter({ hasText: invalidTemplate }).waitFor();
    await dashboard.locator('#start-job').click();
    assert.match(await dashboard.locator('#status').innerText(), invalidTemplate);
    assert.equal(searchHomeVisits, 0, 'invalid template did not open a collection tab');
    await dashboard.locator('#reset-template').click();

    await dashboard.locator('#start-job').click();

    await dashboard.locator('#prompt').waitFor({ state: 'visible', timeout: 20000 });
    assert.match(await dashboard.locator('#prompt-text').innerText(), english ? /Sign in to Xiaohongshu/ : /完成小红书登录/);
    const monitored = context.pages().find(page => page.url().startsWith(origin));
    assert(monitored, 'normal browser tab opened');
    await monitored.getByRole('link', { name: '模拟完成登录' }).click();
    await monitored.waitForURL(`${origin}/fixture-confirm-login`);
    const download = dashboard.waitForEvent('download', { timeout: 25000 });
    await dashboard.locator('#proceed').click();
    const result = await download;
    assert.equal(result.suggestedFilename(), `${english ? 'Xiaohongshu' : '舆情'}_${today}_${today}.xlsx`);
    await dashboard.locator('#stop').waitFor({ state: 'hidden' });
    assert(monitored.isClosed(), 'owned browser tab closed after collection');
    assert.equal(await dashboard.locator('#status').innerText(), english ? 'Excel ready' : '已生成 Excel');
    assert.match(await dashboard.locator('#history').innerText(), english
      ? /1\/2 · “宝山” complete · 1 note[\s\S]*2\/2 · “硚口” complete · 1 note/
      : /1\/2 · 「宝山」完成 · 1 条[\s\S]*2\/2 · 「硚口」完成 · 1 条/);
    assert.equal(await dashboard.locator('#progress').getAttribute('value'), '2');
    assert.deepEqual(searched, ['宝山', '宝山', '硚口']);
    assert.deepEqual(opened, [...cases.values()], 'old note was excluded before opening');
    assert.deepEqual(errors, []);

    const workbook = new Workbook();
    await workbook.xlsx.readFile(await result.path());
    assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['总结', '总表', today, ...cases.keys()]);
    for (const [keyword, id] of cases) {
      const sheet = workbook.getWorksheet(keyword);
      assert.equal(sheet.actualRowCount, 2);
      assert.equal(sheet.getCell('B2').value, `${keyword}新笔记`);
      assert.equal(sheet.getCell('D2').hyperlink, `${origin}/explore/${id}?fixture=final&xsec_source=pc_search`);
    }
    assert.equal(workbook.getWorksheet('总表').actualRowCount, 3);
    if (english) {
      console.log('Verified English dashboard, template validation, collection prompts and Excel download.');
      return;
    }

    const schema = {
      version: 1,
      analysisFields: [{ key: 'issue', title: '风险要点', type: 'text', instruction: '根据证据归纳问题。' }],
      summarySections: [{ key: 'risk', title: '主要风险', instruction: '汇总有样本依据的风险。' }],
      sheets: [
        { kind: 'overview', name: '核对明细', columns: ['url', 'title', 'issue', 'analysis_status'] },
        { kind: 'summary', name: '风险总结' },
        { kind: 'keyword', columns: ['title', 'date', 'url'] },
      ],
    };
    const markdown = ['# 验证模板', '## 分析规则', '根据证据分析样本。', '```report-schema', JSON.stringify(schema), '```'].join('\n');
    await templateInput.setInputFiles({ name: '风险规则.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown) });
    await dashboard.locator('#template-status').filter({ hasText: '已校验 · 风险规则.md' }).waitFor();
    const customDownload = dashboard.waitForEvent('download', { timeout: 25000 });
    await dashboard.locator('#start-job').click();
    const customResult = await customDownload;
    await dashboard.locator('#stop').waitFor({ state: 'hidden' });
    const customWorkbook = new Workbook();
    await customWorkbook.xlsx.readFile(await customResult.path());
    assert.deepEqual(customWorkbook.worksheets.map(sheet => sheet.name), ['核对明细', '风险总结', ...cases.keys()]);
    const customDetail = customWorkbook.getWorksheet('核对明细');
    assert.deepEqual(customDetail.getRow(1).values.slice(1), ['原文地址', '标题', '风险要点', '分析状态']);
    assert.equal(customDetail.getCell('A2').hyperlink, `${origin}/explore/${cases.get('宝山')}?fixture=final&xsec_source=pc_search`);
    assert.equal(customDetail.getCell('B2').value, '宝山新笔记');
    assert.ok(['', null].includes(customDetail.getCell('C2').value));
    assert.equal(customDetail.getCell('D2').value, '未配置 API');
    assert.equal(customWorkbook.getWorksheet('宝山').getCell('A2').value, '宝山新笔记');
    assert.equal(customWorkbook.getWorksheet('风险总结').getCell('B2').value, '风险规则.md');
    assert.deepEqual(errors, []);
    console.log('Verified extension collection, invalid template preflight, and custom-sheet Excel export without an API key.');
  } finally {
    await context.close();
    console.log(`Disposable test directory: ${temporary}`);
  }
}

for (const locale of ['zh-CN', 'en-US']) await verify(locale);
