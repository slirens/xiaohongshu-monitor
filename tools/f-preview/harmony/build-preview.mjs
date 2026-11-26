import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const kit = fileURLToPath(new URL('.', import.meta.url));
const workspace = resolve(kit, '../../..');
const require = createRequire(resolve(process.env.XHS_RUNTIME || workspace, 'package.json'));
const JSZip = require('jszip');
const frontend = resolve(kit, '../frontend');
const originalLicense = join(workspace, 'LICENSE');
const manifest = {
  manifest_version: 3,
  name: '小红书舆情监控 · F 界面预览',
  version: '1.0.9',
  version_name: '1.0.9-preview.1',
  description: '使用样例数据体验 F 方案的监控工作台、续查和任务进度。',
  action: {
    default_title: 'F 界面预览 · 样例数据',
    default_popup: 'launcher.html',
  },
  content_security_policy: {
    extension_pages: "default-src 'self'; script-src 'self'; object-src 'none'; connect-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'",
  },
};
const version = new Date('2026-11-26T00:00:00Z');
const zip = new JSZip();
const write = (name, data) => zip.file(name, data, { date: version });
const main = await readFile(join(frontend, 'index.html'));
assert.match(main.toString('utf8'), /F 界面预览 · 样例数据/u, 'Shared frontend carries the preview disclosure');
write('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
write('index.html', main);
for (const name of ['app.css', 'app.mjs']) write(name, await readFile(join(frontend, name)));
for (const name of ['launcher.html', 'launcher.css', 'README.md']) write(name, await readFile(join(kit, name)));
write('LICENSE', await readFile(originalLicense));

const filename = `xiaohongshu-monitor-v${manifest.version_name}-harmonyos-browser.zip`;
const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
const sha256 = createHash('sha256').update(buffer).digest('hex');
await writeFile(join(kit, filename), buffer);
await writeFile(join(kit, 'archive-sha256.txt'), `${sha256}  ${filename}\n`);
console.log(`${filename} (${buffer.length} bytes) · SHA-256 ${sha256}`);
