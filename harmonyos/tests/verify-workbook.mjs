import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildWorkbook, KeywordReport, ReportNote } from '../src/Workbook.ts';

const require = createRequire(new URL('../../runtime/package.json', import.meta.url));
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const url = 'https://www.xiaohongshu.com/explore/0123456789abcdef01234567?xsec_source=pc_search&fixture=1';
const title = '标题 <试验> & 后续 🌟';
const overlong = '甲'.repeat(32766) + '🌟结束';
const bytes = buildWorkbook([
  new KeywordReport('宝山', [
    new ReportNote(title, '首行\n\t尾行\u0001', url, '2026-11-23'),
    new ReportNote('第二条', overlong, 'javascript:alert(1)', '2026-11-22'),
  ], '两条样本 <摘要> & 底稿'),
  new KeywordReport('宝山', []),
  new KeywordReport('2026-11-23', []),
  new KeywordReport('硚口/下', [new ReportNote('第三条', '中文正文', url, '2026-11-23')]),
  new KeywordReport(" ' '历史' ' ", []),
]);
const archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
assert(archive.file('[Content_Types].xml'));

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(Buffer.from(bytes));
assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), [
  '总结', '总表', '2026-11-22', '2026-11-23', '宝山', '宝山 (2)', '2026-11-23 (2)', '硚口 下', '历史',
]);

const summary = workbook.getWorksheet('总结');
assert.equal(summary.getCell('B2').value, 3);
assert.equal(summary.getCell('C3').value, '两条样本 <摘要> & 底稿');
assert.equal(workbook.getWorksheet('总表').getCell('E2').hyperlink, url);
assert.equal(workbook.getWorksheet('2026-11-23').actualRowCount, 3);

const keyword = workbook.getWorksheet('宝山');
assert.equal(keyword.getCell('B2').value, title);
assert.equal(keyword.getCell('C2').value, '首行\n\t尾行');
assert.equal(keyword.getCell('D2').hyperlink, url);
assert.equal(keyword.getCell('C3').value, '甲'.repeat(32766));
assert.equal(keyword.getCell('D3').hyperlink, undefined);

const empty = new ExcelJS.Workbook();
await empty.xlsx.load(Buffer.from(buildWorkbook([])));
assert.deepEqual(empty.worksheets.map(sheet => sheet.name), ['总结', '总表']);
assert.equal(empty.getWorksheet('总结').getCell('B2').value, 0);
console.log('Verified XLSX CRC-32, workbook sheets, counts, Chinese text, and note hyperlinks.');
