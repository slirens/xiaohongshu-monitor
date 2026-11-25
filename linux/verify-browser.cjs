const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { existsSync } = require('node:fs');
const { mkdtemp, readdir, realpath, rm, writeFile } = require('node:fs/promises');
const { createRequire } = require('node:module');
const { tmpdir } = require('node:os');
const { dirname, join, resolve } = require('node:path');
const { createInterface } = require('node:readline');

const origin = 'https://www.xiaohongshu.com';
const id = '0123456789abcdef01234567';
const olderId = '1123456789abcdef01234567';
const newerId = '2123456789abcdef01234567';
const hashtags = ['宝山', '硚口'];
const failedKeyword = '筛选失败样本';
const keywords = [hashtags[0], failedKeyword, hashtags[1]];
const title = '宝山 硚口 边界当天';
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format();
const daysAgo = days => new Date(Date.parse(today) - days * 86400000).toISOString().slice(0, 10);
const start = daysAgo(195);
const end = daysAgo(1);
const loginMarker = '.fixture-signed-in';

function resultPage(login, missingSort) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
    <style>
      header { display: flex; justify-content: end; }
      #filters { position: fixed; top: 64px; right: 12px; padding: 12px; width: 460px; background: white; }
      #filters h3 { margin: 10px 0 4px; }
      button { padding: 5px 12px; }
      #login { position: fixed; inset: 0; padding: 32px; background: #eee; }
    </style>
    <header><button id="trigger">筛选</button></header>
    <div id="filters" hidden>
      <section><h3>排序依据</h3><div><button>综合</button>${missingSort ? '' : '<button id="latest">最新</button>'}</div></section>
      <section><h3>笔记类型</h3><div><button onclick="fetch('/wrong-filter')">不限</button></div></section>
      <section><h3>发布时间</h3><div>
        <button id="any-time">不限</button>
        <button>一天内</button><button>一周内</button><button>半年内</button>
      </div></section>
      <section><h3>搜索范围</h3><div><button onclick="fetch('/wrong-filter')">不限</button></div></section>
    </div>
    <main id="hits" hidden>
      <section class="note-item"><a href="/explore/${olderId}">下限之前</a><time>${daysAgo(196)}</time></section>
      <section class="note-item"><a href="/search_result/${id}?fixture=card">${title}</a><time>${start}</time></section>
      <section class="note-item"><a href="/explore/${newerId}">超过上限</a><time>${today}</time></section>
    </main>
    <section id="login" role="dialog" ${login ? '' : 'hidden'}>
      <h2>登录后查看搜索结果</h2><p>扫码</p><input type="tel" placeholder="输入手机号">
    </section>
    <div style="height: 250vh"></div>
    <script>
      const gate = document.getElementById('login');
      const filters = document.getElementById('filters');
      const trigger = document.getElementById('trigger');
      const show = () => { if (gate.hidden) filters.hidden = false; };
      trigger.addEventListener('mouseenter', show);
      trigger.addEventListener('click', show);
      trigger.addEventListener('mouseleave', () => { filters.hidden = true; });
      document.getElementById('latest')?.addEventListener('click', event => {
        window.latest = true;
        console.log('TEST_LINUX_FILTER sort ' + event.isTrusted);
      });
      document.getElementById('any-time').addEventListener('click', event => {
        if (!window.latest) throw new Error('Date selected before sorting');
        document.getElementById('hits').hidden = false;
        console.log('TEST_LINUX_FILTER time ' + event.isTrusted);
      });
      if (!gate.hidden) {
        const timer = setInterval(async () => {
          const state = await (await fetch('/fixture-login-state', { cache: 'no-store' })).text();
          if (state !== 'ok' || gate.hidden) return;
          clearInterval(timer);
          gate.hidden = true;
          console.log('TEST_LINUX_LOGIN_READY');
        }, 100);
      }
      window.addEventListener('wheel', () => fetch('/unexpected-scroll'));
    </script>
  </html>`;
}

function installFixture() {
  const runtimeRequire = createRequire(join(dirname(process.execPath), '_resolve.cjs'));
  const { chromium } = runtimeRequire('playwright');
  const launch = chromium.launchPersistentContext.bind(chromium);
  let launches = 0;
  let searches = 0;
  chromium.launchPersistentContext = async (profile, options) => {
    assert.equal(++launches, 1, 'A multi-keyword run must reuse its browser');
    assert.equal(options.channel, 'chrome');
    assert.equal(options.headless, false);
    assert.equal(options.chromiumSandbox, true);
    const context = await launch(profile, options);
    const signedIn = () => existsSync(join(process.env.XHS_MONITOR_HOME, loginMarker));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      const html = body => route.fulfill({ contentType: 'text/html; charset=utf-8', body });
      if (url.pathname === '/search_result') {
        const keyword = url.searchParams.get('keyword');
        assert.equal(keyword, keywords[searches++]);
        return html(resultPage(!signedIn(), keyword === failedKeyword));
      }
      if (url.pathname === '/fixture-login-state') {
        return route.fulfill({ contentType: 'text/plain', body: signedIn() ? 'ok' : 'pending' });
      }
      if (url.pathname === '/search_result/' + id) {
        return html(`<script>location.href="/explore/${id}?fixture=redirect"</script>`);
      }
      if (url.pathname === '/explore/' + id) {
        return html(`<h1 id="detail-title">${title}</h1><div class="note-content">
          <p id="detail-desc">采集测试正文</p><time class="date">${start}</time></div>`);
      }
      if (['/wrong-filter', '/unexpected-scroll', '/explore/' + olderId, '/explore/' + newerId].includes(url.pathname)) {
        console.log(`TEST_LINUX_ERROR unexpected request: ${url.pathname}`);
        process.exitCode = 1;
      }
      return route.abort();
    });
    const page = context.pages()[0];
    page.on('console', message => {
      if (message.text().startsWith('TEST_LINUX_')) console.log(message.text());
    });
    page.on('pageerror', error => console.log(`TEST_LINUX_ERROR ${error.message}`));
    return context;
  };
}

async function verify(installation) {
  assert.equal(process.platform, 'linux');
  const app = resolve(installation);
  const state = await mkdtemp(join(tmpdir(), 'xhs-linux-browser-'));
  try {
    const node = join(app, 'runtime', 'node');
    const child = spawn(node, ['--require', __filename, join(app, 'monitor.mjs'), '--desktop'], {
      env: { ...process.env, XHS_MONITOR_HOME: state, XHS_LINUX_BROWSER_FIXTURE: '1', XHS_AI_KEY: '',
        OPENAI_API_KEY: '', XHS_UI_LANG: 'zh-CN', XHS_TASK_DIAGNOSTICS: '1' },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const result = once(child, 'close');
    const timer = setTimeout(() => child.kill(), 60000);
    let loginPrompts = 0;
    const log = [];
    child.stdin.on('error', error => {
      if (error.code !== 'EPIPE') throw error;
    });
    try {
      const respond = value => child.stdin.write(JSON.stringify(value) + '\n');
      respond({ keyword: keywords.join(' '), start, end, sort: '最新', screens: 'bottom' });
      for await (const line of createInterface({ input: child.stdout })) {
        console.log(line);
        log.push(line);
        if (line.startsWith('UI_ASK ')) {
          const signIn = JSON.parse(line.slice('UI_ASK '.length)).startsWith('小红书需要登录或完成网页验证');
          assert.ok(signIn, `Unexpected interactive prompt: ${line}`);
          assert.equal(++loginPrompts, 1);
          await writeFile(join(state, loginMarker), '');
        }
        if (line === 'TEST_LINUX_LOGIN_READY') respond('继续');
      }
      const [code] = await result;
      assert.equal(code, 1, 'One keyword should fail while the other two export');
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await result;
      }
    }
    assert.equal(loginPrompts, 1);
    assert.ok(log.every(line => !line.startsWith('TEST_LINUX_ERROR ')));
    assert.deepEqual(log.filter(line => line.startsWith('TEST_LINUX_FILTER ')), [
      'TEST_LINUX_FILTER sort false', 'TEST_LINUX_FILTER time false',
      'TEST_LINUX_FILTER sort false', 'TEST_LINUX_FILTER time false',
    ]);
    assert.equal(log.filter(line => /网页发布时间筛选：不限/.test(line)).length, 2);
    assert.equal(log.filter(line => /早于/.test(line)).length, 2);
    assert.equal(log.filter(line => /第 1 屏/.test(line)).length, 2);
    assert.equal(log.filter(line => /第 [2-9][0-9]* 屏/.test(line)).length, 0);
    assert.equal(log.filter(line => /日期命中 1 条，范围外跳过 2 条/.test(line)).length, 2);
    assert.ok(log.some(line => line.startsWith('UI_PROGRESS 2/3') && line.endsWith('失败')));
    assert.ok(log.some(line => line.startsWith('UI_PROGRESS 3/3') && line.endsWith('完成')));
    const diagnostics = log.filter(line => line.startsWith('UI_DIAG ')).map(line => JSON.parse(line.slice(8)));
    const events = (name, keywordIndex) => diagnostics.filter(row => row.event === name &&
      (keywordIndex === undefined || row.keywordIndex === keywordIndex));
    assert.equal(events('browser_launch_succeeded').length, 1);
    assert.equal(events('browser_reused').length, 2);
    assert.equal(events('search_access_restored', 1).length, 1);
    assert.deepEqual(events('filter_applied').map(row => [row.keywordIndex, row.requestedTime]), [[1, 'any_time'], [3, 'any_time']]);
    assert.equal(events('filter_failed', 2)[0]?.stage, 'select_sort');
    assert.equal(events('scan_started', 2).length, 0);

    const reportDirectory = join(state, 'reports');
    const [file, ...others] = (await readdir(reportDirectory)).filter(name => name.endsWith('.xlsx'));
    assert.ok(file);
    assert.equal(others.length, 0);
    const { Workbook } = createRequire(join(app, 'monitor.mjs'))('exceljs');
    const workbook = new Workbook();
    await workbook.xlsx.readFile(join(reportDirectory, file));
    assert.deepEqual(workbook.worksheets.filter(sheet => sheet.state === 'visible').map(sheet => sheet.name), ['总结', '总表', start, ...keywords]);
    assert.equal(workbook.getWorksheet('_xhs_continuation').state, 'veryHidden');
    for (const keyword of hashtags) {
      const sheet = workbook.getWorksheet(keyword);
      assert.equal(sheet.actualRowCount, 2);
      assert.equal(sheet.getCell('B2').value, title);
      assert.equal(sheet.getCell('D2').hyperlink, `${origin}/explore/${id}?fixture=redirect`);
    }
    const failedRows = workbook.getWorksheet(failedKeyword).getSheetValues().filter(Boolean);
    assert.ok(failedRows.some(row => row.includes('采集失败，详见执行日志')));
    console.log('Linux Chrome sandbox, same-page login, auto-only filter fallback, date cutoff and partial workbook passed.');
  } finally {
    const actualState = await realpath(state);
    assert.equal(dirname(actualState), await realpath(tmpdir()));
    await rm(actualState, { recursive: true, force: true });
  }
}

if (process.env.XHS_LINUX_BROWSER_FIXTURE === '1') {
  installFixture();
} else {
  verify(process.argv[2] || '/opt/xiaohongshu-monitor').catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
