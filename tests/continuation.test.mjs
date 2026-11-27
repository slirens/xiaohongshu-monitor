import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareEngagement, continuationMetadata, continuationReports, continuationStateChunks,
  continuationStateSignature, keywordStart, mergeContinuation,
  readContinuationBytes, readContinuationWorkbook, writeContinuation,
} from '../continuation.mjs';

const require = createRequire(import.meta.url);
const { Workbook } = require('exceljs');
const Zip = require('jszip');
const { SaxesParser } = require('saxes');
const id = 'a'.repeat(24);
const url = `https://www.xiaohongshu.com/explore/${id}`;
const note = (engagement, extra) => ({ id, url, date: '2026-11-10', title: 'A B 客户体验', body: '附详细反馈',
  engagement, ...extra });
const report = (keyword, notes = [], refreshed = [], failed = false) => ({
  info: { 关键词: keyword, ...(failed ? { 处理状态: '失败' } : {}) }, notes, refreshed,
});
const run = (day, start = day) => ({ start, end: day, at: `${day}T15:30:00.000Z` });

test('continuation deduplicates notes and compares a single snapshot per run', () => {
  const first = mergeContinuation(null, [report('A', [note({ likes: 1, saves: 1, comments: 1 })]),
    report('B', [note({ likes: 1, saves: 1, comments: 1 }, { url: `${url}?source=pc_search` })]),
    report('零结果')], run('2026-11-10'));
  assert.deepEqual(continuationMetadata(first).keywords, ['A', 'B', '零结果']);
  assert.equal(first.notes.length, 1);
  assert.equal(first.notes[0].history.length, 1);
  assert.deepEqual(first.notes[0].keywords, ['A', 'B']);
  const second = mergeContinuation(first, [report('a', [note({ likes: 2 })]),
    report('新词', [note({ saves: 2 }, { url: `${url}?source=web` })], [note({ comments: 2 })])], run('2026-11-11', '2026-11-10'));
  assert.equal(second.notes.length, 1);
  assert.deepEqual(second.notes[0].keywords, ['a', 'B', '新词']);
  assert.equal(second.notes[0].history.length, 2);
  assert.equal(second.runs.length, 2);
  assert.deepEqual(second.keywords, ['a', '新词']);
  assert.ok(second.coverage.B);
  assert.deepEqual(continuationReports(second, []).map(entry => entry.notes.length), [1, 1]);
  assert.equal(second.runs[1].refreshedNotes, 1);
  assert.equal(second.runs[1].newNotes, 0);
  const expected = { previous: 1, current: 2, delta: 1, rate: 1 };
  for (const field of ['likes', 'saves', 'comments']) {
    assert.deepEqual(second.notes[0].comparison[field], expected);
    assert.deepEqual(second.runs[1].engagement[field], { ...expected, count: 1 });
  }
  assert.equal(first.runs.length, 1);
  assert.deepEqual(first.notes[0].engagement, { likes: 1, saves: 1, comments: 1 });
});

test('keeps previous coverage for failed words and accepts explicit date overrides', () => {
  const first = mergeContinuation(null, [report('keyword'), report('First attempt', [], [], true)], run('2026-11-10', '2026-11-08'));
  assert.equal(continuationMetadata(first).start, '2026-11-08');
  assert.equal(keywordStart(first, 'Keyword', '2026-11-08', '2026-11-11'), '2026-11-10');
  assert.equal(keywordStart(first, 'First attempt', '2026-11-10', '2026-11-11'), '2026-11-08');
  assert.equal(keywordStart(first, 'Keyword', '2026-11-03', '2026-11-11', { useCoverage: false }), '2026-11-03');
});

test('zero, missing counts, and missing intervening snapshots remain distinct', () => {
  assert.deepEqual(compareEngagement({ likes: 0 }, { likes: 2 }).likes, { previous: 0, current: 2, delta: 2, rate: null });
  assert.deepEqual(compareEngagement({ likes: 2 }, {}).likes, { previous: 2, current: null, delta: null, rate: null });
  const first = mergeContinuation(null, [report('A', [note({ likes: 1, comments: 0 })])], run('2026-11-10'));
  const second = mergeContinuation(first, [report('A', [], [note({ comments: 2 })])], run('2026-11-11'));
  const third = mergeContinuation(second, [report('A', [], [note({ likes: 3, comments: 1 })])], run('2026-11-12'));
  assert.equal(second.notes[0].engagement.likes, null);
  assert.equal(second.runs.at(-1).engagement.likes.count, 0);
  assert.equal(third.notes[0].comparison.likes.rate, 2);
  assert.equal(third.notes[0].comparison.comments.delta, -1);
  assert.equal(third.notes[0].comparison.comments.rate, -0.5);
});

test('imports legacy workbooks and writes recoverable report state across Excel serialization', async () => {
  const legacy = new Workbook();
  legacy.addWorksheet('总结').addRows([
    ['指标', '值'], ['关键词', 'A'], ['开始日期', '2026-11-09'], ['结束日期', '2026-11-10'],
    ['关键词', 'B'], ['开始日期', '2026-11-09'], ['结束日期', '2026-11-10'], ['命中样本', 0],
  ]);
  legacy.addWorksheet('总表').addRows([
    ['关键词', '发布日期', '标题', '正文', '原文地址'], ['A', '2026-11-10', '标题', '正文', { text: '帖子', hyperlink: url }],
  ]);
  const prior = readContinuationWorkbook(legacy);
  assert.deepEqual(prior.keywords, ['A', 'B']);
  assert.equal(prior.notes[0].url, url);
  assert.equal(prior.notes[0].engagement.likes, null);
  assert.equal(keywordStart(prior, 'B', '2026-11-04', '2026-11-11'), '2026-11-10');

  const state = mergeContinuation(prior, [report('A', [note({ likes: 2 }, { body: '🔎'.repeat(15900) })])], run('2026-11-11'));
  const book = new Workbook();
  book.addWorksheet('总结');
  book.addWorksheet('_xhs_continuation');
  writeContinuation(book, state);
  const reopened = new Workbook();
  await reopened.xlsx.load(await book.xlsx.writeBuffer());
  assert.equal(reopened.getWorksheet('_xhs_continuation_2').state, 'veryHidden');
  assert.ok(JSON.stringify(readContinuationWorkbook(reopened)) === JSON.stringify(state), 'serialized workbook preserves state');
  assert.equal(state.notes[0].comparison.likes.delta, null);
});

test('reads pre-ExcelJS reports with a qualified worksheet namespace', async () => {
  const workbook = new Workbook();
  workbook.addWorksheet('总结').addRows([['指标', '值'], ['关键词', 'A'], ['开始日期', '2026-11-10'], ['结束日期', '2026-11-11']]);
  workbook.addWorksheet('总表').addRows([['关键词', '发布日期', '标题', '原文地址'], ['A', '2026-11-10', '标题', url]]);
  const zip = await Zip.loadAsync(await workbook.xlsx.writeBuffer());
  for (const file of zip.file(/^xl\/(?:workbook|sharedStrings|styles|worksheets\/sheet\d+)\.xml$/)) {
    const xml = await file.async('string');
    zip.file(file.name, xml.replace(/<(\/?)((?:[A-Za-z][\w.-]*))(?=[\s/>])/g, '<$1x:$2')
      .replace('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
        'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'));
  }
  const state = await readContinuationBytes(await zip.generateAsync({ type: 'uint8array' }), {
    Workbook, Zip, SaxesParser, legacyZip: async () => Zip,
  });
  assert.deepEqual(state.keywords, ['A']);
  assert.equal(state.notes[0].url, url);
  assert.equal(continuationMetadata(state).start, '2026-11-11');
});

test('reads suffixed embedded state without opening the visible worksheets', async () => {
  const book = new Workbook();
  book.addWorksheet('总结').addRows([['指标', '值'], ['关键词', 'Visible sheet']]);
  book.addWorksheet('_xhs_continuation').addRow([continuationStateSignature]);
  const state = mergeContinuation(null, [report('宝山', [note({ likes: 4 }, { body: '🔎'.repeat(3000) })]), report('硚口')],
    run('2026-11-10'));
  writeContinuation(book, state);
  const zip = await Zip.loadAsync(await book.xlsx.writeBuffer());
  // A visible sheet with the reserved name is ignored, and the legacy loader would fail on this XML.
  zip.file('xl/worksheets/sheet1.xml', '<broken>');
  const loaded = await readContinuationBytes(await zip.generateAsync({ type: 'uint8array' }), {
    Zip, SaxesParser, loadWorkbook: () => assert.fail('Do not load ExcelJS for an embedded state'),
  });
  assert.deepEqual(loaded, state);
  assert.deepEqual(continuationMetadata(loaded), continuationMetadata(state));
});

test('reads inline state strings and does not require a shared string table', async () => {
  const state = mergeContinuation(null, [report('A < B & C', [note({ likes: 12 })])], run('2026-11-11'));
  const book = new Workbook();
  book.addWorksheet('总表').addRow(['title']);
  writeContinuation(book, state);
  const zip = await Zip.loadAsync(await book.xlsx.writeBuffer());
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const rows = [continuationStateSignature, ...continuationStateChunks(state)].map((value, index) => {
    const row = index + 1;
    return `<row r="${row}"><c r="A${row}" t="inlineStr"><is><r><t>${escape(value.slice(0, 4))}</t></r><r><t>${escape(value.slice(4))}</t></r></is></c></row>`;
  }).join('');
  zip.file('xl/worksheets/sheet2.xml',
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`);
  zip.remove('xl/sharedStrings.xml');
  assert.deepEqual(await readContinuationBytes(await zip.generateAsync({ type: 'uint8array' }), {
    Zip, SaxesParser, loadWorkbook: () => assert.fail('Inline state does not require ExcelJS'),
  }), state);
});

test('falls back to the first signed hidden state when its sheet name was changed', async () => {
  const prior = mergeContinuation(null, [report('older')], run('2026-11-10'));
  const next = mergeContinuation(null, [report('newer')], run('2026-11-11'));
  const book = new Workbook();
  writeContinuation(book, prior);
  book.worksheets[0].name = 'Renamed history';
  writeContinuation(book, next);
  let workbookLoads = 0;
  const loaded = await readContinuationBytes(await book.xlsx.writeBuffer(), {
    Zip, SaxesParser, loadWorkbook: async () => {
      workbookLoads++;
      return { Workbook };
    },
  });
  assert.equal(workbookLoads, 1);
  assert.deepEqual(loaded, prior);
});

test('falls back to legacy visible reports when no signed hidden state exists', async () => {
  const book = new Workbook();
  book.addWorksheet('总结').addRows([['指标', '值'], ['关键词', 'Legacy report']]);
  book.addWorksheet('_xhs_continuation', { state: 'veryHidden' }).addRows([['Not the state signature'], ['{}']]);
  let workbookLoads = 0;
  const loaded = await readContinuationBytes(await book.xlsx.writeBuffer(), {
    Zip, SaxesParser, loadWorkbook: async () => {
      workbookLoads++;
      return Workbook;
    },
  });
  assert.equal(workbookLoads, 1);
  assert.deepEqual(loaded.keywords, ['Legacy', 'report']);
});

test('a signed but malformed hidden state preserves the corruption error', async () => {
  const book = new Workbook();
  book.addWorksheet('总结').addRows([['指标', '值'], ['关键词', 'Legacy fallback']]);
  book.addWorksheet('_xhs_continuation', { state: 'veryHidden' }).addRows([[
    continuationStateSignature,
  ], ['{"version":2}']]);
  await assert.rejects(readContinuationBytes(await book.xlsx.writeBuffer(), {
    Zip, SaxesParser, loadWorkbook: () => assert.fail('Corrupt embedded state must be reported'),
  }), /Monitoring history is damaged or uses an unsupported format/);
});
