const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdtemp, readdir, rm } = require('node:fs/promises');
const { createRequire } = require('node:module');
const { tmpdir } = require('node:os');
const { dirname, join, resolve } = require('node:path');
const { createInterface } = require('node:readline');

const origin = 'https://www.xiaohongshu.com';
const id = '0123456789abcdef01234567';
const olderId = '1123456789abcdef01234567';
const newerId = '2123456789abcdef01234567';
const hashtags = ['宝山', '硚口'];
const title = '宝山 硚口 边界当天';
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format();
const daysAgo = days => new Date(Date.parse(today) - days * 86400000).toISOString().slice(0, 10);
const start = daysAgo(195);
const end = daysAgo(1);

function resultPage() {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
    <button>筛选</button>
    <div>
      <section><h3>排序依据</h3><div><button onclick="window.latest=true">最新</button></div></section>
      <section><h3>笔记类型</h3><div><button onclick="fetch('/wrong-filter')">不限</button></div></section>
      <section><h3>发布时间</h3><div>
        <button onclick="if (window.latest) document.querySelector('#hits').hidden=false">不限</button>
        <button>一天内</button><button>一周内</button><button>半年内</button>
      </div></section>
      <section><h3>搜索范围</h3><div><button onclick="fetch('/wrong-filter')">不限</button></div></section>
    </div>
    <main id="hits" hidden>
      <section class="note-item"><a href="/explore/${olderId}">下限之前</a><time>${daysAgo(196)}</time></section>
      <section class="note-item"><a href="/search_result/${id}?fixture=card">${title}</a><time>${start}</time></section>
      <section class="note-item"><a href="/explore/${newerId}">超过上限</a><time>${today}</time></section>
    </main>
    <div style="height: 250vh"></div>
    <script>window.addEventListener('wheel', () => fetch('/unexpected-scroll'));</script>
  </html>`;
}

function installFixture() {
  const runtimeRequire = createRequire(join(dirname(process.execPath), '_resolve.cjs'));
  const { chromium } = runtimeRequire('playwright');
  const launch = chromium.launchPersistentContext.bind(chromium);
  chromium.launchPersistentContext = async (profile, options) => {
    assert.equal(options.channel, 'chrome');
    assert.equal(options.headless, false);
    assert.equal(options.chromiumSandbox, true);
    const context = await launch(profile, options);
    let attempts = 0;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      const html = body => route.fulfill({ contentType: 'text/html; charset=utf-8', body });
      if (url.pathname === '/search_result') {
        assert.ok(hashtags.includes(url.searchParams.get('keyword')));
        return html(++attempts === 1 ? '<main>扫码登录</main>' : resultPage());
      }
      if (url.pathname === '/search_result/' + id) {
        return html(`<script>location.href="/explore/${id}?fixture=redirect"</script>`);
      }
      if (url.pathname === '/explore/' + id) {
        return html(`<h1 id="detail-title">${title}</h1><div class="note-content">
          <p id="detail-desc">采集测试正文</p><time class="date">${start}</time></div>`);
      }
      if (['/wrong-filter', '/unexpected-scroll', '/explore/' + olderId, '/explore/' + newerId].includes(url.pathname)) {
        console.error(`Unexpected fixture request: ${url.pathname}`);
        process.exitCode = 1;
      }
      return route.abort();
    });
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
      env: { ...process.env, XHS_MONITOR_HOME: state, XHS_LINUX_BROWSER_FIXTURE: '1', XHS_AI_KEY: '', OPENAI_API_KEY: '' },
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
      child.stdin.write(JSON.stringify({ keyword: hashtags.join(' '), start, end, sort: '最新', screens: 'bottom' }) + '\n');
      for await (const line of createInterface({ input: child.stdout })) {
        console.log(line);
        log.push(line);
        if (line.startsWith('UI_ASK ')) {
          if (JSON.parse(line.slice('UI_ASK '.length)).includes('完成扫码登录或网页验证')) loginPrompts++;
          child.stdin.write('""\n');
        }
      }
      const [code] = await result;
      assert.equal(code, 0);
    } finally {
      clearTimeout(timer);
    }
    assert.equal(loginPrompts, 2);
    assert.equal(log.filter(line => /网页发布时间筛选：不限/.test(line)).length, 2);
    assert.equal(log.filter(line => /早于/.test(line)).length, 2);
    assert.equal(log.filter(line => /第 1 屏/.test(line)).length, 2);
    assert.equal(log.filter(line => /第 [2-9][0-9]* 屏/.test(line)).length, 0);
    assert.equal(log.filter(line => /日期命中 1 条，范围外跳过 2 条/.test(line)).length, 2);
    assert.ok(log.some(line => line.startsWith('UI_PROGRESS 2/2') && line.endsWith('完成')));

    const reportDirectory = join(state, 'reports');
    const [file, ...others] = (await readdir(reportDirectory)).filter(name => name.endsWith('.xlsx'));
    assert.ok(file);
    assert.equal(others.length, 0);
    const { Workbook } = createRequire(join(app, 'monitor.mjs'))('exceljs');
    const workbook = new Workbook();
    await workbook.xlsx.readFile(join(reportDirectory, file));
    assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['总结', '总表', start, ...hashtags]);
    for (const keyword of hashtags) {
      const sheet = workbook.getWorksheet(keyword);
      assert.equal(sheet.actualRowCount, 2);
      assert.equal(sheet.getCell('B2').value, title);
      assert.equal(sheet.getCell('D2').hyperlink, `${origin}/explore/${id}?fixture=redirect`);
    }
    console.log('Linux Chrome sandbox, login prompt, date cutoff and multi-keyword workbook passed.');
  } finally {
    await rm(state, { recursive: true, force: true });
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
