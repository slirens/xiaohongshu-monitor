import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const kit = dirname(fileURLToPath(import.meta.url));
const source = join(kit, 'frontend');
const stage = await mkdtemp(join(kit, 'prepare-test-'));
const prepared = spawnSync(process.execPath, [join(kit, 'prepare.mjs'), source, stage], { encoding: 'utf8' });
assert.equal(prepared.status, 0, prepared.stderr);
const assets = JSON.parse(await readFile(join(stage, 'shared-assets.json'), 'utf8'));
const types = new Map([['/index.html', 'text/html'], ['/app.css', 'text/css'], ['/app.mjs', 'text/javascript'], ['/probe.mjs', 'text/javascript']]);
for (const [name, sha] of Object.entries(assets)) {
  const original = await readFile(join(source, name));
  assert.equal(createHash('sha256').update(original).digest('hex'), sha);
  const copied = await readFile(join(stage, 'dist', name));
  assert.equal(name === 'index.html' ? copied.toString('utf8').replace('./probe.mjs', './app.mjs') : copied.toString('utf8'), original.toString('utf8'));
}
const png = await readFile(join(stage, 'src-tauri', 'icons', 'icon.png'));
const ico = await readFile(join(stage, 'src-tauri', 'icons', 'icon.ico'));
assert.deepEqual(ico.subarray(ico.readUInt32LE(18)), png);

const server = createServer(async (request, response) => {
  const type = types.get(request.url);
  if (!type) return response.writeHead(404).end();
  const body = await readFile(join(stage, 'dist', request.url.slice(1)));
  response.writeHead(200, { 'Content-Type': type + '; charset=utf-8' }).end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const runtime = resolve(process.env.XHS_RUNTIME || join(kit, '../../../runtime'));
const require = createRequire(join(runtime, 'package.json'));
const { chromium } = require('playwright');
const executablePath = process.env.XHS_CHROMIUM || join(kit, '../../win-x86-browser/158.0.8127.36/chrome-win32/chrome.exe');
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-background-networking'] });
  const page = await browser.newPage({ viewport: { width: 1180, height: 800 } });
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.addInitScript(() => {
    globalThis.probeEvents = [];
    globalThis.__TAURI__ = { core: { invoke: async (command, args) => globalThis.probeEvents.push({ command, args }) } };
  });
  await page.goto(`${origin}/index.html`);
  await page.waitForFunction(() => globalThis.probeEvents.length > 0, { timeout: 12000 });
  const [ipc] = await page.evaluate(() => globalThis.probeEvents);
  assert.equal(ipc.command, 'webview_ready', JSON.stringify(ipc));
  const proof = { browser: browser.version(), fixture: JSON.parse(ipc.args.proof), frontend: assets, nativeMacOS: false };
  await writeFile(join(stage, 'browser-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
