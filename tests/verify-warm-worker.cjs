const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { existsSync } = require('node:fs');
const { mkdir, mkdtemp, readdir, rm, writeFile } = require('node:fs/promises');
const { createRequire } = require('node:module');
const { basename, dirname, join, resolve } = require('node:path');
const { createInterface } = require('node:readline');

const taskKey = 'synthetic-request-key-only';
const inheritedKey = 'synthetic-old-environment-key';
const privateMalformed = 'synthetic-broken-request-key';
const day = '2026-11-24';
const noteLink = 'https://www.xiaohongshu.com/explore/0123456789abcdef01234567';

if (process.env.XHS_VERIFY_WARM_WORKER === 'child') {
  const Module = require('node:module');
  const load = Module._load;
  Module._load = function (name, ...args) {
    const value = load.call(this, name, ...args);
    if (name === 'playwright') {
      value.chromium.launchPersistentContext = async (_profile, options) => {
        if (process.env.XHS_WARM_FIXTURE_BROWSER !== 'chrome' || options.channel !== 'chrome') {
          console.log('UNEXPECTED_BROWSER_LAUNCH');
        } else {
          console.log('FIXTURE_BROWSER_LAUNCH');
        }
        throw new Error('Simulated test browser did not start.');
      };
    }
    return value;
  };
  globalThis.fetch = async (url, request) => {
    if (process.env.XHS_WARM_FIXTURE_AI !== 'yes' || url !== 'https://api.openai.com/v1/responses' ||
        request.headers.Authorization !== 'Bearer ' + taskKey) {
      console.log('UNEXPECTED_AI_REQUEST');
      throw new Error('Fixture intercepted an unexpected AI request.');
    }
    console.log('FIXTURE_AI_REQUEST');
    const format = JSON.parse(request.body).text.format.name;
    const response = format === 'note_analysis'
      ? { relevant: true, sentiment: '正面', topic: '预热核查主题', summary: '根据测试样本得出。' }
      : { coverage: '样本范围', themes: '主要议题', risks: '待核实事项', engagement_update: '互动变化研判' };
    return { ok: true, json: async () => ({ status: 'completed', output: [
      { content: [{ type: 'output_text', text: JSON.stringify(response) }] },
    ] }) };
  };
} else {
  void verify().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

async function verify() {
  assert.equal(process.platform, 'win32');
  const workerPath = resolve(process.argv[2] || 'monitor.mjs');
  const location = __dirname;
  const scratch = await mkdtemp(join(location, 'verify-warm-worker-'));
  const pending = new Set();
  try {
    const sample = join(scratch, 'sample.json');
    await writeFile(sample, JSON.stringify([
      { date: day, title: '暖启动测试样本', body: '暖启动测试正文', url: noteLink },
    ]));
    const request = { keyword: '暖启动', start: day, end: day, source: sample, sort: '最新', provider: 'OpenAI' };
    async function start(mode, values = {}) {
      const home = join(scratch, mode);
      await mkdir(home);
      const child = spawn(process.execPath, ['--require', __filename, workerPath, '--desktop', '--warm-browser-driver'], {
        env: { ...process.env, XHS_MONITOR_HOME: home, XHS_UI_LANG: 'zh-CN', XHS_TASK_DIAGNOSTICS: '1',
          XHS_AI_KEY: '', OPENAI_API_KEY: inheritedKey, XHS_VERIFY_WARM_WORKER: 'child', ...values },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      pending.add(child);
      const lines = [], diagnostics = [];
      let stderr = '';
      let driverReady;
      const ready = new Promise(resolve => { driverReady = resolve; });
      child.stderr.setEncoding('utf8').on('data', text => { stderr += text; });
      const timeout = setTimeout(() => child.kill(), 30000);
      const reader = createInterface({ input: child.stdout });
      reader.on('line', line => {
        lines.push(line);
        if (line.startsWith('UI_DIAG ')) {
          const event = JSON.parse(line.slice('UI_DIAG '.length));
          diagnostics.push(event);
          if (event.event === 'browser_driver_ready') driverReady(true);
        }
      });
      const closed = once(child, 'close').then(([code]) => {
        clearTimeout(timeout);
        pending.delete(child);
        driverReady(false);
        const output = [...lines, stderr].join('\n');
        assert.doesNotMatch(output, /UNEXPECTED_BROWSER_LAUNCH|UNEXPECTED_AI_REQUEST/);
        for (const secret of [taskKey, inheritedKey, privateMalformed]) {
          assert.ok(!output.includes(secret), 'A credential reached worker output.');
        }
        return { code, output, diagnostics };
      });
      return { child, home, diagnostics, lines, ready, closed };
    }

    const idle = await start('idle');
    assert.equal(await idle.ready, true);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.deepEqual(idle.diagnostics.map(event => event.event), ['worker_ready', 'browser_driver_ready']);
    assert.equal(idle.child.exitCode, null);
    idle.child.stdin.end();
    assert.equal((await idle.closed).code, 0);
    assert.equal(existsSync(join(idle.home, 'reports')), false);

    const immediate = await start('immediate', { XHS_WARM_FIXTURE_AI: 'yes' });
    immediate.child.stdin.end(JSON.stringify({ ...request, apiKey: taskKey }) + '\n');
    const completed = await immediate.closed;
    assert.equal(completed.code, 0, completed.output);
    const startup = completed.diagnostics.map(event => event.event);
    assert.deepEqual(startup.slice(0, 3), ['worker_ready', 'browser_driver_ready', 'worker_request_received']);
    assert.equal(startup.filter(event => event === 'batch_started').length, 1);
    assert.equal(startup.filter(event => event === 'browser_launch_started').length, 0);
    assert.equal(completed.output.match(/^FIXTURE_AI_REQUEST$/gm)?.length, 2);
    const { Workbook } = createRequire(join(dirname(process.execPath), 'warm-fixture.cjs'))('exceljs');
    const workbook = new Workbook();
    const reports = join(immediate.home, 'reports');
    const [filename] = await readdir(reports);
    await workbook.xlsx.readFile(join(reports, filename));
    const overview = workbook.getWorksheet('总表');
    assert.equal(overview.getCell('E2').hyperlink, noteLink);
    assert.ok(overview.getRow(2).values.includes('预热核查主题'));

    const offline = await start('offline');
    offline.child.stdin.end(JSON.stringify({ ...request, apiKey: '' }) + '\n');
    const offlineResult = await offline.closed;
    assert.equal(offlineResult.code, 0, offlineResult.output);
    assert.equal(offlineResult.diagnostics.find(event => event.event === 'batch_started')?.aiEnabled, false);

    const malformed = await start('malformed');
    malformed.child.stdin.end('{"apiKey":"' + privateMalformed + '","keyword":invalid}\n');
    const rejected = await malformed.closed;
    assert.equal(rejected.code, 1);
    assert.match(rejected.output, /无法读取任务配置/);
    assert.equal(rejected.diagnostics.some(event => event.event === 'batch_started'), false);

    const cancelled = await start('cancelled');
    cancelled.child.stdin.end(JSON.stringify({ ...request, source: '', apiKey: '' }) + '\nUI_CANCEL\n');
    const stopped = await cancelled.closed;
    assert.equal(stopped.code, 1);
    assert.equal(stopped.diagnostics.some(event => event.event === 'browser_launch_started'), false);
    assert.equal(stopped.diagnostics.find(event => event.event === 'batch_failed')?.reason, 'stopped');
    assert.equal(existsSync(join(cancelled.home, 'reports')), false);

    const browser = await start('browser', { XHS_WARM_FIXTURE_BROWSER: 'chrome', XHS_DEFAULT_BROWSER_EXE: 'msedge.exe' });
    assert.equal(await browser.ready, true);
    assert.equal(browser.lines.some(line => line === 'FIXTURE_BROWSER_LAUNCH'), false);
    browser.child.stdin.end(JSON.stringify({ ...request, source: '', apiKey: '', defaultBrowserExecutable: 'chrome.exe' }) + '\n');
    const attempted = await browser.closed;
    assert.equal(attempted.code, 1);
    assert.equal(attempted.output.match(/^FIXTURE_BROWSER_LAUNCH$/gm)?.length, 1);
    assert.equal(attempted.diagnostics.find(event => event.event === 'default_browser_detected')?.browser, 'chrome');
    console.log('Passed idle driver prewarm and EOF, immediate request and XLSX, ephemeral API key, malformed request redaction, early cancellation, and request-time browser selection.');
  } finally {
    await Promise.all([...pending].map(async child => {
      const closed = once(child, 'close');
      child.kill();
      await closed;
    }));
    if (dirname(scratch) === location && basename(scratch).startsWith('verify-warm-worker-')) {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}
