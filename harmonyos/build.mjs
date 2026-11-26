import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { datePattern, timePresets, validDate, parseDisplayedDate, presetsCovering } from '../monitor.mjs';
import { pageRead } from '../safari.mjs';
import { readEngagementLabels } from '../engagement.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.argv[2] || join(root, 'output'));
const version = process.argv[3];
if (version !== undefined &&
    (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
     version === '0.0.0' || version.split('.').some(part => Number(part) > 65535))) {
  throw new Error('Use a valid extension version in x.y.z form.');
}
await mkdir(output);
await cp(join(root, 'extension'), output, { recursive: true });
if (version !== undefined) {
  const manifestPath = join(output, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.version = version;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}
await cp(join(root, '..', 'LICENSE'), join(output, 'LICENSE'));
const design = join(root, '..', 'design', 'v2');
const icons = join(output, 'icons');
await mkdir(icons);
for (const name of ['alert', 'back', 'check', 'chevron', 'doc', 'search', 'spinner', 'stop', 'tray', 'xmark']) {
  await cp(join(design, 'icons', name + '.svg'), join(icons, name + '.svg'));
}
const logoPath = join(design, 'logo', 'xhs-monitor-logo');
await cp(logoPath + '.svg', join(icons, 'logo.svg'));
for (const size of [16, 32, 128]) {
  await cp(`${logoPath}-${size}.png`, join(icons, `logo-${size}.png`));
}
// The final Windows ICO includes the original 48px PNG from the same logo.
const ico = await readFile(logoPath + '.ico');
const size48 = Array.from({ length: ico.readUInt16LE(4) }, (_, index) => 6 + index * 16)
  .find(offset => ico[offset] === 48 && ico[offset + 1] === 48);
if (size48 === undefined) throw new Error('The brand icon is missing its 48px rendition.');
const logo48 = ico.readUInt32LE(size48 + 12);
const logo48Bytes = ico.readUInt32LE(size48 + 8);
await writeFile(join(icons, 'logo-48.png'), ico.subarray(logo48, logo48 + logo48Bytes));
await cp(join(root, '..', '报告生成模板.md'), join(output, '报告生成模板.md'));
await cp(join(root, '..', 'report-template.mjs'), join(output, 'report-template.mjs'));
await cp(join(root, '..', 'continuation.mjs'), join(output, 'continuation.mjs'));
await cp(join(root, '..', 'engagement.mjs'), join(output, 'engagement.mjs'));
const require = createRequire(resolve(process.env.XHS_RUNTIME ?? join(root, '..'), 'package.json'));
await cp(require.resolve('exceljs/dist/exceljs.min.js'), join(output, 'exceljs.min.js'));
await cp(require.resolve('exceljs/LICENSE'), join(output, 'ExcelJS-LICENSE.txt'));
await cp(require.resolve('jszip/dist/jszip.min.js'), join(output, 'jszip.min.js'));
await cp(require.resolve('jszip/LICENSE.markdown'), join(output, 'JSZip-LICENSE.md'));
await cp(join(root, 'README.md'), join(output, 'README.md'));
await writeFile(join(output, 'page.js'), [pageRead.toString(), readEngagementLabels.toString()].join('\n') + '\n');
const presets = timePresets.map(([days, expression]) => `[${days}, ${expression}]`).join(', ');
const dates = [
  `const datePattern = ${datePattern};`,
  `const timePresets = [${presets}];`,
  'export const chinaDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" });',
  ...[validDate, parseDisplayedDate, presetsCovering].map(fn => 'export ' + fn.toString()),
].join('\n\n');
await writeFile(join(output, 'dates.mjs'), dates + '\n');
console.log(output);
