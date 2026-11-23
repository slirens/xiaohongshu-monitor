import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { datePattern, timePresets, validDate, parseDisplayedDate, presetsCovering } from '../monitor.mjs';
import { pageRead } from '../safari.mjs';

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
await cp(join(root, '..', 'cover.png'), join(output, 'cover.png'));
await cp(join(root, '..', '报告生成模板.md'), join(output, '报告生成模板.md'));
await cp(join(root, '..', 'report-template.mjs'), join(output, 'report-template.mjs'));
await cp(join(root, 'README.md'), join(output, 'README.md'));
await writeFile(join(output, 'page.js'), pageRead.toString() + '\n');
const presets = timePresets.map(([days, expression]) => `[${days}, ${expression}]`).join(', ');
const dates = [
  `const datePattern = ${datePattern};`,
  `const timePresets = [${presets}];`,
  'export const chinaDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" });',
  ...[validDate, parseDisplayedDate, presetsCovering].map(fn => 'export ' + fn.toString()),
].join('\n\n');
await writeFile(join(output, 'dates.mjs'), dates + '\n');
const workbook = await readFile(join(root, 'src', 'Workbook.ts'), 'utf8');
await writeFile(join(output, 'workbook.mjs'), stripTypeScriptTypes(workbook, { mode: 'transform' }));
console.log(output);
