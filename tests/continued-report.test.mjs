import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { normalizeEngagement, readEngagementLabels } from '../engagement.mjs';

const require = createRequire(import.meta.url);
const installedRequire = createRequire(join(dirname(process.execPath), '_resolve.cjs'));
const { Workbook } = (() => {
  try { return require('exceljs'); }
  catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    return installedRequire('exceljs');
  }
})();

const id = digit => digit.repeat(24);
const link = digit => 'https://www.xiaohongshu.com/explore/' + id(digit);
const day1 = '2026-11-10';
const day2 = '2026-11-11';
const note = (digit, title, date, counts) => ({ id: id(digit), title, date, url: link(digit),
  body: title + ' 这是一条测试笔记', engagement: counts });
const counts = (likes, saves, comments) => ({ likes, saves, comments });

test('engagement extraction uses the note bar, preserves zero, and skips abbreviated counts', () => {
  const control = count => ({
    getClientRects: () => [{}],
    getAttribute: () => null,
    querySelector: () => ({ textContent: count, getAttribute: () => null }),
  });
  const [like, save, comment] = ['1,012', '0', '1.2万'].map(control);
  const bar = { querySelector: selector => selector.startsWith('.like') ? like : selector.startsWith('.collect') ? save : comment };
  assert.deepEqual(normalizeEngagement(readEngagementLabels({ querySelectorAll: () => [bar] })), counts(1012, 0, null));
});

test('two rounds restore editable keywords, refresh older notes, and export verified percentages and AI data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xhs-continue-test-'));
  const originalHome = process.env.XHS_MONITOR_HOME;
  const originalFetch = globalThis.fetch;
  process.env.XHS_MONITOR_HOME = root;
  try {
    const { runBatch, inspectReport } = await import('../monitor.mjs');
    const sample = join(root, 'notes.json');
    const reports = join(root, 'reports');
    const ask = async () => { throw new Error('The JSON fixture must not request browser interaction.'); };
    await writeFile(sample, JSON.stringify([
      note('1', 'alpha', day1, counts(1, 1, 1)),
      note('2', 'beta', day1, counts(4, 4, 4)),
      note('3', 'alpha 缺失值', day1, counts(0, null, 3)),
    ]));
    await runBatch({ keyword: 'alpha beta empty', start: day1, end: day1, source: sample }, ask);
    const [original] = await readdir(reports);
    assert.match(original, /^舆情_\d{6}_[a-f0-9]{6}\.xlsx$/);
    const prior = join(reports, original);
    const imported = await inspectReport(prior);
    assert.deepEqual(imported.keywords, ['alpha', 'beta', 'empty']);
    assert.equal(imported.start, day1);

    const calls = [];
    globalThis.fetch = async (url, request) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const payload = JSON.parse(request.body);
      const format = payload.text.format;
      calls.push({ name: format.name, data: JSON.parse(payload.input) });
      const fields = format.name === 'note_analysis'
        ? { relevant: true, sentiment: '负面', topic: '产品', summary: '样本反馈。' }
        : Object.fromEntries(format.schema.required.map(key => [key, '基于样本。']));
      return { ok: true, json: async () => ({ status: 'completed', output: [{ content: [
        { type: 'output_text', text: JSON.stringify(fields) },
      ] }] }) };
    };
    await writeFile(sample, JSON.stringify([
      note('1', 'alpha', day1, counts(2, 2, 2)),
      note('2', 'beta', day1, counts(9, 9, 9)),
      note('3', 'alpha 缺失值', day1, counts(1, 3, null)),
      note('4', 'alpha gamma', day2, counts(7, 8, 9)),
    ]));
    await runBatch({ keyword: 'alpha gamma', start: day2, end: day2, source: sample,
      continueReport: prior, apiKey: 'synthetic-key', provider: 'OpenAI' }, ask);
    const [updated] = (await readdir(reports)).filter(name => name !== original);
    const updatedPath = join(reports, updated);
    assert.deepEqual((await inspectReport(updatedPath)).keywords, ['alpha', 'gamma']);
    const book = new Workbook();
    await book.xlsx.readFile(updatedPath);
    const getValues = (sheet, title) => {
      const headers = sheet.getRow(1).values;
      const row = sheet.getRows(2, sheet.rowCount - 1).find(row => row.getCell(headers.indexOf('标题')).value === title);
      assert.ok(row, title);
      return Object.fromEntries(headers.slice(1).map((heading, index) => [heading, row.getCell(index + 1)]));
    };
    for (const sheet of [book.getWorksheet('总表'), book.getWorksheet(day1)]) {
      const row = getValues(sheet, 'alpha');
      for (const metric of ['点赞', '收藏', '评论']) {
        assert.equal(row[metric + '上次'].value, 1);
        assert.equal(row[metric + '本次'].value, 2);
        assert.equal(row[metric + '增减'].value, 1);
        assert.equal(row[metric + '涨幅'].value, 1);
        assert.match(row[metric + '涨幅'].numFmt, /%/);
      }
      const sparse = getValues(sheet, 'alpha 缺失值');
      assert.equal(sparse.点赞增减.value, 1);
      assert.ok([null, ''].includes(sparse.点赞涨幅.value));
      assert.ok([null, ''].includes(sparse.收藏增减.value));
      assert.ok([null, ''].includes(sparse.评论本次.value));
      assert.equal(getValues(sheet, 'beta').本轮数据状态.value, '本轮未取得数据');
    }
    const current = book.getWorksheet(day2);
    assert.equal(current.rowCount, 2);
    assert.equal(getValues(current, 'alpha gamma').关键词.value, 'alpha、gamma');
    const summary = book.getWorksheet('总结').getSheetValues().flat();
    assert.ok(summary.some(value => typeof value === 'string' && value.endsWith('舆情更新')));
    assert.ok(summary.some(value => typeof value === 'string' && value.includes('涨幅 +100.0%')));
    assert.ok(summary.some(value => typeof value === 'string' && value.endsWith('首次基线')));
    assert.ok(calls.filter(call => call.name === 'note_analysis').every(call => call.data.engagement.likes === 7));
    const aiSummary = calls.find(call => call.name === 'report_summary')?.data;
    assert.equal(aiSummary.update.engagement.comments.delta, 1);
    assert.equal(aiSummary.changedNotes.find(row => row.title === 'alpha').comparison.likes.rate, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalHome === undefined) delete process.env.XHS_MONITOR_HOME;
    else process.env.XHS_MONITOR_HOME = originalHome;
    await rm(root, { recursive: true, force: true });
  }
});
