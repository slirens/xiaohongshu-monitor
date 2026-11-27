import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
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
const screenshots = process.env.XHS_SCREENSHOT_DIRECTORY && resolve(process.env.XHS_SCREENSHOT_DIRECTORY);
if (screenshots) await mkdir(screenshots, { recursive: true });
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
const missingSort = '无可用排序';

function notesPage(keyword, id, empty = false) {
  return `<!doctype html><meta charset="utf-8">
    <button onclick="document.getElementById('filters').hidden = false">筛选</button>
    <section id="filters" hidden>
      <h3>排序依据</h3><button onclick="this.parentNode.dataset.sort = 'latest'">最新</button>
      <h3>发布时间</h3>
      <button onclick="if (this.parentNode.dataset.sort === 'latest') document.getElementById('notes').hidden = false">一天内</button>
    </section>
    <div id="notes" hidden>${empty ? '<p>暂无相关笔记</p>' : `
      <section class="note-item"><a href="/search_result/${id}?fixture=card">${keyword}新笔记</a><time>${today}</time></section>
      <section class="note-item"><a href="/explore/${old}">${keyword}旧笔记</a><time>${yesterday}</time></section>
      `}
    </div>`;
}

async function verify(locale) {
  const english = locale === 'en-US';
  const searched = [];
  const opened = [];
  let signedIn = false;
  let searchHomeVisits = 0;
  let count = 1;
  let refreshViaHistory = false;
  let searchGate;
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
        if (keyword === missingSort) return html(notesPage(keyword, old).replace('>最新</button>', '>其他排序</button>'));
        const id = cases.get(keyword);
        if (!id) return route.fulfill({ status: 404 });
        searched.push(keyword);
        if (!signedIn) return html('<meta charset="utf-8"><h1>扫码登录</h1><a href="/fixture-confirm-login">模拟完成登录</a>');
        if (searchGate?.keyword === keyword) {
          const gate = searchGate.promise;
          searchGate = undefined;
          await gate;
        }
        return html(notesPage(keyword, id, refreshViaHistory && keyword === '宝山'));
      }
      for (const [keyword, id] of cases) {
        if (url.pathname === `/search_result/${id}`) {
          return html(`<script>location.href = "/explore/${id}?fixture=final&xsec_source=pc_search";</script>`);
        }
        if (url.pathname === `/explore/${id}`) {
          opened.push(id);
          return html(`<meta charset="utf-8"><div class="note-content">
            <h1 id="detail-title">${keyword}新笔记</h1><p id="detail-desc">示例正文</p><span class="date">${today}</span>
            <div class="engage-bar">
              <button class="like-wrapper"><span class="count">${count}</span></button>
              <button class="collect-wrapper"><span class="count">${count}</span></button>
              <button class="chat-wrapper"><span class="count">${count}</span></button>
            </div>
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
    await dashboard.setViewportSize({ width: 1080, height: 660 });
    async function waitForTransitions(page) {
      await page.evaluate(async () => {
        await Promise.allSettled(document.getAnimations()
          .filter(animation => Number.isFinite(animation.effect.getComputedTiming().endTime))
          .map(animation => animation.finished));
      });
    }
    async function capture(name, sizes = [[1080, 660], [880, 590]]) {
      if (!screenshots) return;
      for (const [width, height] of sizes) {
        await dashboard.setViewportSize({ width, height });
        await waitForTransitions(dashboard);
        assert(await dashboard.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: no horizontal page overflow`);
        await dashboard.screenshot({ path: join(screenshots, `${locale}-${name}-${width}x${height}.png`), animations: 'disabled' });
      }
      await dashboard.setViewportSize({ width: 1080, height: 660 });
    }
    await dashboard.getByRole('heading', { name: english ? 'New monitoring task' : '新建监控任务' }).waitFor();
    assert.equal(await dashboard.locator('html').getAttribute('lang'), english ? 'en' : 'zh-CN');
    assert.equal(await dashboard.locator('#status').innerText(), english ? 'Ready' : '准备就绪');
    assert.match(await dashboard.locator('.notice').innerText(), english
      ? /For lawful, non-commercial use only/
      : /仅限合法、非商业使用/);
    await dashboard.locator('.toolbar .brand img').evaluate(image => image.decode());
    assert.equal(await dashboard.locator('.sidebar').count(), 0);
    assert.equal(await dashboard.locator('[aria-current="step"]').innerText(), english ? '1\nSet up' : '1\n设置任务');
    await capture('FA-01');
    const terms = dashboard.locator('#terms');
    const termsBox = dashboard.locator('#terms-box');
    const collapsedHeight = await termsBox.evaluate(field => field.offsetHeight);
    await terms.hover();
    await dashboard.waitForFunction(() => getComputedStyle(document.querySelector('#terms-box')).borderColor === 'rgb(131, 129, 130)');
    assert.equal(await terms.evaluate(field => getComputedStyle(field).cursor), 'text');
    assert.equal(await termsBox.evaluate(field => field.offsetHeight), collapsedHeight, 'hover keeps the field in place');
    await terms.focus();
    await dashboard.waitForFunction(() => getComputedStyle(document.querySelector('#terms-box')).borderColor === 'rgb(255, 36, 66)');
    await terms.fill('first\nsecond\nthird');
    assert.ok(await termsBox.evaluate(field => field.offsetHeight) > collapsedHeight + 35, 'keyword input grows for multiple lines');
    await terms.fill(' ');
    await dashboard.locator('#open-settings').focus();
    assert.equal(await terms.getAttribute('aria-invalid'), 'true');
    assert(!await dashboard.locator('#start-job').isEnabled());
    await capture('FA-04');
    await terms.fill([...cases.keys()].join(' '));
    assert.equal(await termsBox.evaluate(field => field.offsetHeight), collapsedHeight);
    await dashboard.locator('#open-settings').click();
    assert.equal(await dashboard.locator('.token').count(), 2, 'the raw text is rendered as two chips when blurred');
    await dashboard.locator('#close-settings').click();
    await capture('FA-01-keywords');
    await dashboard.locator('#open-settings').click();
    await capture('FA-03');
    await dashboard.locator('#screens').fill('1.5');
    await dashboard.locator('#done-settings').click();
    assert(!await dashboard.locator('#start-job').isEnabled(), 'noninteger screen count stays invalid');
    await dashboard.locator('#open-settings').click();
    await dashboard.locator('#screens').fill('1');
    assert.equal(await dashboard.locator('#settings-summary').textContent(), english ? 'Latest · 1 screen · Built-in template' : '最新 · 1 屏 · 内置模板');
    const templateInput = dashboard.locator('#template');
    await templateInput.setInputFiles({ name: '无效模板.md', mimeType: 'text/markdown', buffer: Buffer.from('# 无效的模板') });
    const invalidTemplate = english ? /Invalid report template/ : /报告模板无效/;
    await dashboard.locator('#template-status').filter({ hasText: invalidTemplate }).waitFor();
    await dashboard.locator('#done-settings').click();
    assert.match(await dashboard.locator('#settings-error').innerText(), invalidTemplate);
    assert(!await dashboard.locator('#start-job').isEnabled());
    assert.equal(searchHomeVisits, 0, 'invalid template did not open a collection tab');
    await dashboard.locator('#open-settings').click();
    await dashboard.locator('#reset-template').click();
    await dashboard.locator('#done-settings').click();

    await dashboard.clock.setFixedTime(new Date(`${today}T16:03:05+08:00`));
    await dashboard.locator('#start-job').focus();
    await dashboard.keyboard.press('Enter');
    await dashboard.clock.setSystemTime(new Date(`${today}T16:04:05+08:00`));

    await dashboard.locator('#prompt').waitFor({ state: 'visible', timeout: 20000 });
    assert.match(await dashboard.locator('#prompt-text').innerText(), english ? /Sign in to Xiaohongshu/ : /完成小红书登录/);
    await capture('FA-05');
    await capture('FA-11', [[440, 285]]);
    await dashboard.locator('#stop-from-prompt').click();
    assert(await dashboard.locator('#stop-confirm').isVisible(), 'stop asks for confirmation over sign-in');
    await capture('FA-12', [[440, 285]]);
    await dashboard.locator('#stop-confirm button[value=keep]').click();
    assert(await dashboard.locator('#prompt').isVisible(), 'declining stop returns to login');
    const monitored = context.pages().find(page => page.url().startsWith(origin));
    assert(monitored, 'normal browser tab opened');
    await monitored.getByRole('link', { name: '模拟完成登录' }).click();
    await monitored.waitForURL(`${origin}/fixture-confirm-login`);
    const download = dashboard.waitForEvent('download', { timeout: 25000 });
    let releaseSearch;
    searchGate = { keyword: '硚口', promise: new Promise(resolve => { releaseSearch = resolve; }) };
    await dashboard.locator('#proceed').click();
    await dashboard.locator('#prompt').waitFor({ state: 'hidden' });
    await dashboard.waitForFunction(() => document.querySelector('#progress').value === 1);
    await capture('FA-06');
    await capture('FA-09', [[880, 590]]);
    await capture('FA-10', [[440, 285]]);
    releaseSearch();
    const result = await download;
    assert.equal(result.suggestedFilename(), `宝山_${today}_2词_160305.xlsx`);
    await dashboard.locator('#stop').waitFor({ state: 'hidden' });
    assert(monitored.isClosed(), 'owned browser tab closed after collection');
    assert.equal(await dashboard.locator('#status').innerText(), english ? 'Excel ready' : '已生成 Excel');
    assert.match(await dashboard.locator('#history').textContent(), english
      ? /1\/2 · “宝山” complete · 1 note[\s\S]*2\/2 · “硚口” complete · 1 note/
      : /1\/2 · 「宝山」完成 · 1 条[\s\S]*2\/2 · 「硚口」完成 · 1 条/);
    assert.equal(await dashboard.locator('#progress').getAttribute('value'), '2');
    assert.deepEqual(searched, ['宝山', '宝山', '硚口']);
    assert.deepEqual(opened, [...cases.values()], 'old note was excluded before opening');
    assert.deepEqual(errors, []);
    assert.equal(await dashboard.locator('#result-list .keyword-row').count(), 2);
    await capture('FA-07');

    // Replay terminal outcomes directly through the rendered view. This covers hundreds of
    // keywords and AI warnings without issuing hundreds of requests or granting AI access.
    const stress = await context.newPage();
    try {
      await stress.goto(dashboard.url());
      async function replay(size, warn = false) {
        await stress.evaluate(async ({ size, warn, basename }) => {
          const view = await import('./task-view.mjs');
          const words = Array.from({ length: size }, (_, index) => 'fixture-' + String(index).padStart(3, '0'));
          view.openRun(words);
          for (let index = 0; index < words.length; index++) view.endKeyword(index, index < 2 ? null : index);
          view.showResult({
            title: warn ? 'Excel · ' + (document.documentElement.lang === 'en' ? 'AI analysis incomplete' : '部分 AI 分析未完成') : 'Excel',
            filename: basename, partial: true, analysisIncomplete: warn,
          });
        }, { size, warn, basename: result.suggestedFilename() });
      }
      async function resultSnapshot(name) {
        if (screenshots) for (const [width, height] of [[1080, 660], [880, 590]]) {
          await stress.setViewportSize({ width, height });
          await waitForTransitions(stress);
          assert(await stress.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await stress.screenshot({ path: join(screenshots, `${locale}-${name}-${width}x${height}.png`), animations: 'disabled' });
        }
      }
      await replay(6, true);
      assert.equal(await stress.locator('#result-list .keyword-row').count(), 6);
      assert(await stress.locator('#result-warning').isVisible());
      await resultSnapshot('FA-08-fixture');
      await replay(7);
      assert.equal(await stress.locator('#result-list .keyword-row').count(), 5);
      await replay(32);
      assert.equal(await stress.locator('#result-list .keyword-row').allTextContents().then(rows => rows[0].startsWith('fixture-000')), true);
      assert.equal(await stress.locator('#result-list .keyword-row').allTextContents().then(rows => rows[2].startsWith('fixture-031')), true);
      await resultSnapshot('FA-07b-fixture');
      await stress.locator('#result-list button').click();
      assert.equal(await stress.locator('#result-list .keyword-row').count(), 32);
      await resultSnapshot('FA-07c-fixture');
      await replay(200);
      await stress.locator('#result-list button').focus();
      await stress.keyboard.press('Enter');
      assert.equal(await stress.locator('#result-list .keyword-row').count(), 200);
      assert(await stress.locator('#result-search').evaluate(field => document.activeElement === field));
      await stress.locator('#result-search').fill('fixture-199');
      assert.equal(await stress.locator('#result-list .keyword-row').count(), 1);
      await stress.locator('[data-filter=failed]').click();
      assert.equal(await stress.locator('#result-list .keyword-row').count(), 0);
      await stress.locator('#result-search').fill('');
      assert.equal(await stress.locator('#result-list .keyword-row').count(), 2);
      await stress.locator('[data-filter=complete]').click();
      assert.equal(await stress.locator('#result-list .keyword-row').count(), 198);
      await stress.locator('#collapse-results').click();
      assert.equal(await stress.locator('#result-list .keyword-row').count(), 5);
      await stress.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await stress.locator('#result').evaluate(node => getComputedStyle(node).animationName), 'none');
      assert.equal(await stress.locator('.progress-track').evaluate(node => getComputedStyle(node, '::after').animationName), 'none');
      console.log(`Verified ${locale} result thresholds, 200-keyword filtering, keyboard focus, and reduced motion.`);
    } finally {
      await stress.close();
    }

    const workbook = new Workbook();
    await workbook.xlsx.readFile(await result.path());
    const visibleSheets = book => book.worksheets.filter(sheet => sheet.state === 'visible').map(sheet => sheet.name);
    assert.deepEqual(visibleSheets(workbook), ['总结', '总表', today, ...cases.keys()]);
    assert.equal(workbook.getWorksheet('_xhs_continuation').state, 'veryHidden');
    for (const [keyword, id] of cases) {
      const sheet = workbook.getWorksheet(keyword);
      assert.equal(sheet.actualRowCount, 2);
      assert.equal(sheet.getCell('B2').value, `${keyword}新笔记`);
      assert.equal(sheet.getCell('D2').hyperlink, `${origin}/explore/${id}?fixture=final&xsec_source=pc_search`);
    }
    assert.equal(workbook.getWorksheet('总表').actualRowCount, 3);
    await dashboard.locator('#continue-from-result').click();
    await dashboard.locator('#report-source').filter({ hasText: result.suggestedFilename() }).waitFor();
    assert.equal(await terms.inputValue(), [...cases.keys()].join(' '));
    await capture('FA-02');
    if (english) {
      console.log('Verified English dashboard, template validation, collection prompts and Excel download.');
      return;
    }

    await dashboard.locator('#import-report').setInputFiles({
      name: 'baseline.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: await readFile(await result.path()),
    });
    await dashboard.locator('#report-source').filter({ hasText: 'baseline.xlsx' }).waitFor();
    count = 2;
    refreshViaHistory = true;
    const updateDownload = dashboard.waitForEvent('download', { timeout: 25000 });
    await dashboard.locator('#start-job').click();
    const updateResult = await updateDownload.catch(async error => {
      throw new Error(await dashboard.locator('#status').innerText() + '\n' + await dashboard.locator('#history').innerText(), { cause: error });
    });
    await dashboard.locator('#stop').waitFor({ state: 'hidden' });
    const updateBook = new Workbook();
    await updateBook.xlsx.readFile(await updateResult.path());
    for (const name of ['总表', today]) {
      const sheet = updateBook.getWorksheet(name);
      const row = Object.fromEntries(sheet.getRow(1).values.slice(1).map((value, index) => [value, sheet.getCell(2, index + 1)]));
      for (const metric of ['点赞', '收藏', '评论']) {
        assert.equal(row[`${metric}上次`]?.value, 1);
        assert.equal(row[`${metric}本次`]?.value, 2);
        assert.equal(row[`${metric}增减`]?.value, 1);
        assert.equal(row[`${metric}涨幅`]?.value, 1);
        assert.match(row[`${metric}涨幅`]?.numFmt, /%/);
      }
    }
    const summaryRows = updateBook.getWorksheet('总结').getSheetValues().flat().join('\n');
    assert.match(summaryRows, /舆情更新/);
    assert.match(summaryRows, /首次基线/);
    assert.match(summaryRows, /2 → 4 · \+2 · 涨幅 \+100\.0%/);
    assert.equal(opened.filter(id => id === cases.get('宝山')).length, 2, 'history notes refresh even when absent in search');
    refreshViaHistory = false;
    await dashboard.locator('#new-from-result').click();
    assert(await dashboard.locator('#report-card').isHidden());
    assert.equal(await terms.inputValue(), '');
    await terms.fill([...cases.keys()].join(' '));
    await dashboard.locator('#open-settings').click();

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
    await dashboard.locator('#done-settings').click();
    await dashboard.locator('#start-job').click();
    const customResult = await customDownload;
    await dashboard.locator('#stop').waitFor({ state: 'hidden' });
    const customWorkbook = new Workbook();
    await customWorkbook.xlsx.readFile(await customResult.path());
    assert.deepEqual(visibleSheets(customWorkbook), ['核对明细', '风险总结', ...cases.keys()]);
    const customDetail = customWorkbook.getWorksheet('核对明细');
    assert.deepEqual(customDetail.getRow(1).values.slice(1), ['原文地址', '标题', '风险要点', '分析状态']);
    assert.equal(customDetail.getCell('A2').hyperlink, `${origin}/explore/${cases.get('宝山')}?fixture=final&xsec_source=pc_search`);
    assert.equal(customDetail.getCell('B2').value, '宝山新笔记');
    assert.ok(['', null].includes(customDetail.getCell('C2').value));
    assert.equal(customDetail.getCell('D2').value, '未配置 API');
    assert.equal(customWorkbook.getWorksheet('宝山').getCell('A2').value, '宝山新笔记');
    assert.equal(customWorkbook.getWorksheet('风险总结').getCell('B2').value, '风险规则.md');
    const previouslyOpened = opened.length;
    await dashboard.locator('#new-from-result').click();
    await terms.fill(missingSort);
    await dashboard.locator('#start-job').click();
    await dashboard.locator('#status').filter({ hasText: '本次没有完成的关键词' }).waitFor();
    assert.match(await dashboard.locator('#history').textContent(), /自动筛选失败（选择排序）/);
    assert.ok(!await dashboard.locator('#prompt').isVisible(), 'filter failure did not ask for a manual choice');
    assert.equal(opened.length, previouslyOpened, 'filter failure did not open a note');

    await dashboard.locator('#new-from-result').click();
    await terms.fill([` ${missingSort}`, '宝山 '].join('\t'));
    const partialDownload = dashboard.waitForEvent('download', { timeout: 25000 });
    await dashboard.locator('#start-job').click();
    const partialResult = await partialDownload;
    await dashboard.locator('#result-summary').filter({ hasText: '1 个完成 · 1 个失败' }).waitFor();
    assert.match(await dashboard.locator('#result-list').innerText(), /无可用排序[\s\S]*失败[\s\S]*宝山[\s\S]*1 条/);
    const partialBook = new Workbook();
    await partialBook.xlsx.readFile(await partialResult.path());
    assert.equal(partialBook.getWorksheet('宝山').getCell('A2').value, '宝山新笔记');
    await capture('FA-08-partial');

    await dashboard.locator('#new-from-result').click();
    await terms.fill('宝山');
    let releaseStoppedSearch;
    searchGate = { keyword: '宝山', promise: new Promise(resolve => { releaseStoppedSearch = resolve; }) };
    try {
      await dashboard.locator('#start-job').click();
      await dashboard.locator('#stop').click();
      await dashboard.locator('#stop-confirm button[value=stop]').click();
    } finally {
      releaseStoppedSearch();
    }
    await dashboard.locator('#result-title').filter({ hasText: '任务已停止' }).waitFor();
    assert(await dashboard.locator('#download').isHidden());
    assert.deepEqual(errors, []);
    console.log('Verified extension collection, a skipped filter failure, and custom-sheet Excel export without an API key.');
  } finally {
    await context.close();
    console.log(`Disposable test directory: ${temporary}`);
  }
}

for (const locale of ['zh-CN', 'en-US']) await verify(locale);
