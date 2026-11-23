import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  parseReportTemplate, analysisInstructions, analysisSchema, summaryInstructions,
  summarySchema, validateAnalysis, validateSummary, makeReportSheets,
} from '../report-template.mjs';

const id = 'a'.repeat(24);
const url = 'https://www.xiaohongshu.com/explore/' + id + '?source=pc_search';
const sample = () => ({
  version: 1,
  analysisFields: [
    { key: 'risk', title: '风险等级', type: 'enum', values: ['高', '低'], instruction: '按样本证据判断风险。' },
    { key: 'flag', title: '需复核', type: 'boolean', instruction: '是否需要人工复核。' },
  ],
  summarySections: [
    { key: 'evidence', title: '主要证据', instruction: '列出本次观察。' },
    { key: 'scope', title: '样本范围', instruction: '写出样本限制。' },
  ],
  sheets: [
    { kind: 'overview', name: '风险总览', columns: ['risk', 'url', 'keyword', 'title', 'analysis_status'] },
    { kind: 'summary', name: '分析结果' },
    { kind: 'date', columns: ['date', 'flag'] },
    { kind: 'keyword', columns: ['title', 'risk'] },
  ],
});
const markdown = config => [
  '# 测试模板', '## 分析规则', '区分观察与未核实消息。', '## 总结', '按证据优先排序。',
  '```report-schema', JSON.stringify(config), '```',
].join('\n');

test('sample rules and existing heading-only files are accepted', async () => {
  const bundled = await readFile(new URL('../报告生成模板.md', import.meta.url), 'utf8');
  const parsed = parseReportTemplate(bundled, '报告生成模板.md');
  assert.deepEqual(parsed.sheets.map(sheet => sheet.kind), ['summary', 'overview', 'date', 'keyword']);
  assert.equal(parsed.legacy, false);
  const legacy = parseReportTemplate('\uFEFF# 原模板\r\n## 总结\r\n突出投诉\r\n## 总表\r\n## 日期', '旧模板.md');
  assert.equal(legacy.legacy, true);
  assert.equal(legacy.summaryRules, '突出投诉');
  assert.throws(() => parseReportTemplate('   ', '空文件.md'), /文件为空/);
});

test('template controls prompt and typed AI response validation', () => {
  const template = parseReportTemplate(markdown(sample()), '风险.md');
  assert.match(analysisInstructions(template), /区分观察与未核实消息/);
  assert.match(analysisInstructions(template), /风险等级/);
  assert.match(summaryInstructions(template), /按证据优先排序/);
  assert.deepEqual(analysisSchema(template).properties.risk.enum, ['高', '低']);
  assert.deepEqual(summarySchema(template).required, ['evidence', 'scope']);
  assert.equal(analysisSchema(template).additionalProperties, false);
  assert.deepEqual(validateAnalysis('```json\n{"risk":"高","flag":false}\n```', template), { risk: '高', flag: false });
  assert.throws(() => validateAnalysis('{"risk":"中","flag":false}', template), /风险等级/);
  assert.throws(() => validateAnalysis('{"risk":"高","flag":"false"}', template), /需复核/);
  assert.throws(() => validateAnalysis('{"risk":"高","flag":false,"sheet":"其他"}', template), /字段与模板不符/);
  assert.throws(() => validateSummary('{"scope":"一天"}', template), /字段与模板不符/);
});

test('invalid, duplicate, or ambiguous schema settings are rejected', () => {
  const withUnknownColumn = sample();
  withUnknownColumn.sheets[0].columns = ['unknown'];
  assert.throws(() => parseReportTemplate(markdown(withUnknownColumn)), /未定义的列/);
  const withDuplicateColumn = sample();
  withDuplicateColumn.sheets[0].columns = ['title', 'title'];
  assert.throws(() => parseReportTemplate(markdown(withDuplicateColumn)), /重复列/);
  const withDuplicateSheet = sample();
  withDuplicateSheet.sheets[1].name = '风险总览';
  assert.throws(() => parseReportTemplate(markdown(withDuplicateSheet)), /重复/);
  const withBadName = sample();
  withBadName.sheets[1].name = '分析/统计';
  assert.throws(() => parseReportTemplate(markdown(withBadName)), /Excel 命名/);
  assert.throws(() => parseReportTemplate(markdown(sample()).slice(0, -3)), /完整/);
  assert.throws(() => parseReportTemplate(markdown(sample()).replace('## 分析规则', '## 其他')), /分析规则/);
  assert.throws(() => parseReportTemplate('# 不合格的旧模板'), /旧版模板/);
});

test('workbook layout holds with or without AI and validates original links', () => {
  const template = parseReportTemplate(markdown(sample()), '风险.md');
  const note = { title: '示例', body: '反馈', date: '2026-11-23', url };
  const reports = [
    { keyword: '保山', notes: [{ ...note, analysis: { risk: '高', flag: false } }] },
    { keyword: '2026-11-23', notes: [{ ...note, url: 'https://example.com', error: '未配置 API' }] },
  ];
  const sheets = makeReportSheets(template, reports, { summary: { scope: '一天', evidence: '两项反馈' } });
  assert.deepEqual(sheets.map(sheet => sheet.name), ['风险总览', '分析结果', '2026-11-23', '保山', '2026-11-23 (2)']);
  assert.deepEqual(sheets[0].headings, ['风险等级', '原文地址', '关键词', '标题', '分析状态']);
  assert.equal(sheets[0].linkColumn, 1);
  assert.deepEqual(sheets[0].rows[0], ['高', url, '保山', '示例', '完成']);
  assert.deepEqual(sheets[0].rows[1], ['', '', '2026-11-23', '示例', '未配置 API']);
  assert.deepEqual(sheets[1].rows.slice(1, 3), [['主要证据', '两项反馈'], ['样本范围', '一天']]);
  assert.deepEqual(sheets[2].rows[0], ['2026-11-23', '否']);
  const noAi = makeReportSheets(template, [{ keyword: '保山', notes: [note] }], { summaryStatus: '未启用 AI' });
  assert.deepEqual(noAi[0].headings, sheets[0].headings);
  assert.equal(noAi[0].rows[0][0], '');
  assert.equal(noAi[0].rows[0][1], url);
});
