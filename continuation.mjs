export const engagementFields = ['likes', 'saves', 'comments'];

const chinaDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' });
export const continuationSheetName = '_xhs_continuation';
export const continuationStateSignature = 'xiaohongshu-monitor-continuation-v1';
const isoDay = /^\d{4}-\d{2}-\d{2}$/;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clean = value => typeof value === 'string' ? value.trim() : '';
const unique = values => [...new Set(values.map(clean).filter(Boolean))];
const termKey = term => clean(term).toLowerCase();
const uniqueTerms = values => [...new Map(unique(values).map(value => [termKey(value), value])).values()];
const fieldObject = entry => Object.fromEntries(engagementFields.map(field => [field, entry(field)]));

function validDay(value) {
  if (typeof value !== 'string' || !isoDay.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}

function count(value) {
  if (typeof value === 'string' && /^[\d,]+$/.test(value.trim())) {
    const raw = value.trim();
    value = /^\d+$|^\d{1,3}(,\d{3})+$/.test(raw) ? Number(raw.replaceAll(',', '')) : null;
  }
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function normalizeEngagement(value) {
  return fieldObject(field => count(value?.[field]));
}

export function previousEngagement(note) {
  return fieldObject(field => {
    const latest = count(note?.engagement?.[field]);
    if (latest !== null) return latest;
    const history = note?.history ?? [];
    for (let index = history.length - 1; index >= 0; index--) {
      const value = count(history[index].engagement?.[field]);
      if (value !== null) return value;
    }
    return null;
  });
}

export function compareEngagement(previous, current) {
  return fieldObject(field => {
    const before = count(previous?.[field]);
    const after = count(current?.[field]);
    const delta = before !== null && after !== null ? after - before : null;
    return { previous: before, current: after, delta, rate: before > 0 && delta !== null ? delta / before : null };
  });
}

function noteId(note) {
  if (typeof note?.id === 'string' && note.id.trim()) return note.id.trim().toLowerCase();
  try {
    const url = new URL(note?.url);
    if (url.protocol === 'https:' && /^(?:www\.)?xiaohongshu\.com$/i.test(url.hostname)) {
      return url.pathname.match(/^\/(?:explore|search_result|discovery\/item)\/([a-f\d]{24})\/?$/i)?.[1]?.toLowerCase() ?? '';
    }
  } catch {
    return '';
  }
  return '';
}

function noteFingerprint(note) {
  const date = clean(note?.date);
  const title = clean(note?.title);
  const body = clean(note?.body);
  return validDay(date) && (title || body) ? 'content:' + JSON.stringify([date, title, body]) : '';
}

export function continuationNoteKey(note) {
  const id = noteId(note);
  return id ? `id:${id}` : noteFingerprint(note);
}

function emptyState() {
  return { version: 1, keywords: [], coverage: {}, notes: [], runs: [] };
}

function noteIndex(notes) {
  const keyed = new Map();
  const legacy = new Map();
  function add(note) {
    const key = continuationNoteKey(note);
    if (key) keyed.set(key, note);
    if (!noteId(note)) {
      const fingerprint = noteFingerprint(note);
      if (fingerprint) legacy.set(fingerprint, note);
    }
  }
  for (const note of notes) add(note);
  const get = note => keyed.get(continuationNoteKey(note)) ?? legacy.get(noteFingerprint(note));
  return { add, get };
}

function newerNote(before, note, keyword) {
  const fields = ['title', 'body', 'date', 'dateLabel', 'url'];
  const result = { ...before, id: noteId(note) || noteId(before), keywords: uniqueTerms([
    ...(before?.keywords ?? []), ...(Array.isArray(note.keywords) ? note.keywords : []), keyword,
  ]) };
  for (const field of fields) result[field] = clean(note[field]) || clean(before?.[field]);
  const study = new Map(Object.entries(before?.analysisByKeyword ?? {}));
  if (keyword && record(note.analysis)) study.set(termKey(keyword), note.analysis);
  result.analysisByKeyword = Object.fromEntries(study);
  if (keyword && record(note.analysis)) result.analysis = note.analysis;
  if (clean(note.error) && !result.analysis) result.error = note.error;
  return result;
}

export function engagementSummary(notes) {
  const engagement = fieldObject(field => {
    const compared = notes.flatMap(note => note.comparison?.[field]?.delta == null ? [] : [note.comparison[field]]);
    if (!compared.length) return { previous: null, current: null, delta: null, rate: null, count: 0 };
    const previous = compared.reduce((sum, item) => sum + item.previous, 0);
    const current = compared.reduce((sum, item) => sum + item.current, 0);
    const delta = current - previous;
    return { previous, current, delta, rate: previous > 0 ? delta / previous : null, count: compared.length };
  });
  return { newNotes: notes.filter(note => note.changeType === 'new').length,
    refreshedNotes: notes.filter(note => note.changeType === 'refreshed').length, ...engagement };
}

export function continuationMetadata(state) {
  const last = state.runs.at(-1);
  const ranges = Object.values(state.coverage);
  const activeEnds = state.keywords.map(keyword => coverageStart(state, keyword)).filter(validDay).sort();
  return { keywords: state.keywords.slice(),
    start: activeEnds[0] ?? last?.end ?? ranges.map(range => range.end).filter(validDay).sort().at(-1) ?? '',
    end: last?.end ?? ranges.map(range => range.end).filter(validDay).sort().at(-1) ?? '',
    coverage: state.coverage };
}

function coveredRange(state, keyword) {
  if (!state) return undefined;
  if (Object.hasOwn(state.coverage, keyword)) return state.coverage[keyword];
  const key = Object.keys(state.coverage).find(word => termKey(word) === termKey(keyword));
  return key ? state.coverage[key] : undefined;
}

function coverageStart(state, keyword) {
  const previousEnd = coveredRange(state, keyword)?.end;
  if (validDay(previousEnd)) return previousEnd;
  const failedStarts = (state?.runs ?? []).filter(run =>
    run.failedKeywords?.some(word => termKey(word) === termKey(keyword))).map(run => run.start);
  return failedStarts.filter(validDay).sort()[0];
}

export function keywordStart(state, keyword, fallbackStart, end, { useCoverage = true } = {}) {
  const previousEnd = coverageStart(state, keyword);
  return useCoverage && validDay(previousEnd) && previousEnd <= end ? previousEnd : fallbackStart;
}

export function mergeContinuation(previous, reports, options = {}) {
  const { start = '', end = '', at = new Date(), continued = Boolean(previous) } = options;
  const timestamp = new Date(at);
  const run = { at: timestamp.toISOString(), day: chinaDay.format(timestamp), start, end, continued,
    keywords: uniqueTerms(reports.map(report => report.info?.关键词)), failedKeywords: [] };
  const history = previous ?? emptyState();
  const coverage = new Map(Object.entries(history.coverage));
  const pastNotes = history.notes.map(note => ({ ...note }));
  const past = noteIndex(pastNotes);
  const observed = new Map();
  const newNotes = [];

  function observe(note, keyword, existingOnly = false) {
    const key = continuationNoteKey(note);
    if (!key) return;
    const match = past.get(note);
    let known = match?.original ?? match;
    if (!known && existingOnly) return;
    if (!known) {
      known = { firstSeen: run.at, history: [], engagement: normalizeEngagement() };
      newNotes.push(known);
    }
    const earlier = observed.get(known);
    const details = existingOnly ? { id: note.id, url: note.url } : note;
    const updated = newerNote(earlier ?? known, details, keyword);
    updated.engagement = fieldObject(field => count(note.engagement?.[field]) ?? earlier?.engagement[field] ?? null);
    observed.set(known, updated);
    // Index refreshed identifiers while retaining the original baseline for this run.
    past.add({ ...updated, original: known });
    const updateKey = continuationNoteKey(updated);
    if (updateKey !== key) past.add({ ...note, original: known });
  }

  for (const report of reports) {
    const info = report.info ?? {};
    const keyword = clean(info.关键词);
    if (info.处理状态 === '失败') run.failedKeywords.push(keyword);
    else if (keyword) {
      const priorKey = [...coverage.keys()].find(word => termKey(word) === termKey(keyword));
      const prior = coverage.get(priorKey);
      const first = validDay(info.开始日期) ? info.开始日期 : start;
      const last = validDay(info.结束日期) ? info.结束日期 : end;
      if (validDay(first) && validDay(last) && first <= last) {
        if (priorKey && priorKey !== keyword) coverage.delete(priorKey);
        coverage.set(keyword, { start: prior?.start && prior.start < first ? prior.start : first,
          end: prior?.end && prior.end > last ? prior.end : last });
      }
    }
    for (const note of report.notes ?? []) observe(note, keyword);
    for (const note of report.refreshed ?? []) observe(note, '', true);
  }

  const touched = new Set(newNotes);
  const notes = [...pastNotes, ...newNotes].map(note => {
    const update = observed.get(note);
    if (!update) return { ...note, comparison: compareEngagement(previousEngagement(note)), changeType: 'not_seen' };
    return { ...update, changeType: touched.has(note) ? 'new' : 'refreshed', lastSeen: run.at,
      comparison: compareEngagement(previousEngagement(note), update.engagement),
      history: [...(note.history ?? []), { at: run.at, engagement: update.engagement }] };
  });
  const { newNotes: newCount, refreshedNotes, ...engagement } = engagementSummary(notes);
  Object.assign(run, { newNotes: newCount, refreshedNotes, engagement });
  return { version: 1, keywords: run.keywords.slice(), coverage: Object.fromEntries(coverage), notes,
    runs: [...history.runs, run] };
}

export function continuationReports(state, reports) {
  const byKeyword = new Map(reports.map(report => [termKey(report.info?.关键词), report]));
  return state.keywords.map(keyword => {
    const key = termKey(keyword);
    const current = byKeyword.get(key);
    const notes = state.notes.filter(note => note.keywords.some(word => termKey(word) === key)).map(note => ({ ...note,
      analysis: Object.hasOwn(note.analysisByKeyword ?? {}, key) ? note.analysisByKeyword[key] : note.analysis }));
    return { info: current?.info ?? { 关键词: keyword }, notes };
  });
}

export function writeContinuation(book, state) {
  const occupied = new Set(book.worksheets.map(sheet => sheet.name.toLowerCase()));
  let name = continuationSheetName;
  for (let suffix = 2; occupied.has(name.toLowerCase()); suffix++) name = `${continuationSheetName}_${suffix}`;
  const sheet = book.addWorksheet(name, { state: 'veryHidden' });
  sheet.addRow([continuationStateSignature]);
  for (const chunk of continuationStateChunks(state)) sheet.addRow([chunk]);
}

export function* continuationStateChunks(state) {
  // Some XLSX readers decode XML in byte chunks. ASCII keeps Unicode safe at those boundaries.
  const json = JSON.stringify(state).replace(/[\u007f-\uffff]/g, character =>
    '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
  for (let start = 0; start < json.length; start += 28000) yield json.slice(start, start + 28000);
}

function cellValue(cell) {
  const value = cell?.value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (!record(value)) return value;
  if (typeof value.hyperlink === 'string') return value.hyperlink;
  if (Array.isArray(value.richText)) return value.richText.map(span => span.text ?? '').join('');
  return value.result ?? value.text;
}

const headers = {
  keywords: ['关键词', '搜索关键词', 'keyword', 'keywords'],
  title: ['标题', '帖子标题', '笔记标题', 'title'],
  body: ['正文', '内容', '笔记正文', 'body', 'content'],
  date: ['发布日期', '发布时间', '日期', 'date', 'publication date'],
  url: ['原文地址', '原文链接', '帖子链接', '链接', 'original link', 'url'],
  dateLabel: ['网页日期原文'], id: ['笔记 id', '帖子 id', 'note id', 'id'],
  likes: ['点赞', '点赞数', '本次点赞', 'likes'],
  saves: ['收藏', '收藏数', '本次收藏', 'saves'],
  comments: ['评论', '评论数', '本次评论', 'comments'],
  relevant: ['相关', 'relevant'], sentiment: ['情绪', 'sentiment'], topic: ['主题', 'topic'], summary: ['摘要', 'summary'],
};

function words(value) {
  return unique(clean(value).split(/[\s、，,;；]+/u));
}

export function legacyContinuation(book) {
  const state = emptyState();
  const keywordSet = new Set();
  const dates = new Map();
  const sheets = book.worksheets.filter(sheet => sheet.state === 'visible');
  for (const sheet of sheets) {
    const label = clean(cellValue(sheet.getCell('A1'))).toLowerCase();
    if (!['指标', 'metric', 'item'].includes(label)) continue;
    let active = [];
    sheet.eachRow(row => {
      const heading = clean(cellValue(row.getCell(1))).toLowerCase();
      const value = cellValue(row.getCell(2));
      if (headers.keywords.includes(heading)) {
        active = words(value);
        active.forEach(keyword => keywordSet.add(keyword));
      }
      const field = ['开始日期', 'start date'].includes(heading) ? 'start' :
        ['结束日期', 'end date'].includes(heading) ? 'end' : '';
      if (field && validDay(value)) for (const keyword of active) {
        dates.set(keyword, { ...dates.get(keyword), [field]: value });
      }
      if (['处理状态', '状态', 'status', '命中样本'].includes(heading) && /^(?:失败|未完成|failed|incomplete)$/i.test(clean(value))) {
        for (const keyword of active) dates.delete(keyword);
      }
    });
  }
  const notes = new Map();
  for (const sheet of sheets) {
    const columns = new Map();
    sheet.getRow(1).eachCell((cell, index) => columns.set(clean(cellValue(cell)).toLowerCase(), index));
    const at = field => headers[field].map(name => columns.get(name)).find(Boolean);
    const indexes = Object.fromEntries(Object.keys(headers).map(field => [field, at(field)]));
    if (!indexes.title || !indexes.date) continue;
    sheet.eachRow((row, index) => {
      if (index === 1) return;
      const get = field => indexes[field] ? cellValue(row.getCell(indexes[field])) : undefined;
      const date = get('date');
      const title = clean(get('title'));
      if (!validDay(date) || !title) return;
      let keywords = words(get('keywords'));
      if (!keywords.length && keywordSet.has(sheet.name)) keywords = [sheet.name];
      if (!keywords.length && keywordSet.size === 1) keywords = [...keywordSet];
      if (!keywords.length) return;
      keywords.forEach(keyword => keywordSet.add(keyword));
      const note = { date, title, keywords, body: clean(get('body')), url: clean(get('url')),
        dateLabel: clean(get('dateLabel')), id: clean(get('id')),
        engagement: fieldObject(field => count(get(field))) };
      const relevant = clean(get('relevant')).toLowerCase();
      const sentiment = clean(get('sentiment'));
      const topic = clean(get('topic'));
      const summary = clean(get('summary'));
      if (relevant || sentiment || topic || summary) note.analysis = {
        ...(['是', 'yes', 'true', '否', 'no', 'false'].includes(relevant) ? { relevant: ['是', 'yes', 'true'].includes(relevant) } : {}),
        sentiment, topic, summary,
      };
      const key = continuationNoteKey(note);
      const known = notes.get(key);
      const merged = newerNote(known, note, keywords[0]);
      merged.engagement = fieldObject(field => note.engagement[field] ?? known?.engagement[field] ?? null);
      const history = engagementFields.some(field => merged.engagement[field] !== null) ? [{ at: '', engagement: merged.engagement }] : [];
      notes.set(key, { ...merged, history, firstSeen: '', lastSeen: '', changeType: 'not_seen', comparison: compareEngagement() });
    });
  }
  state.keywords = [...keywordSet];
  state.coverage = Object.fromEntries([...dates].filter(([, range]) => validDay(range.start) && validDay(range.end)));
  state.notes = [...notes.values()];
  return state;
}

function validState(state) {
  return record(state) && state.version === 1 && Array.isArray(state.keywords) && state.keywords.every(item => clean(item)) &&
    record(state.coverage) && Object.values(state.coverage).every(range => record(range) && validDay(range.start) && validDay(range.end)) &&
    Array.isArray(state.notes) && state.notes.every(note => record(note) && continuationNoteKey(note) && Array.isArray(note.keywords) &&
      note.keywords.every(item => clean(item)) && Array.isArray(note.history)) && Array.isArray(state.runs) &&
    state.runs.every(run => record(run) && typeof run.at === 'string' && Array.isArray(run.keywords));
}

export function parseContinuationState(json) {
  let state;
  try { state = JSON.parse(json); } catch { state = null; }
  if (!validState(state)) throw new Error('续查数据损坏或版本不受支持。 Monitoring history is damaged or uses an unsupported format.');
  return state;
}

const sheetXml = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const packageRelations = 'http://schemas.openxmlformats.org/package/2006/relationships';
const workbookRelations = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const continuationTab = /^_xhs_continuation(?:_(?:[2-9]|[1-9]\d+))?$/;

function readXml(xml, SaxesParser, namespace, { open, close, text }) {
  const parser = new SaxesParser({ xmlns: true });
  const path = [];
  parser.on('opentag', tag => {
    path.push(tag.uri === namespace ? tag.local : '');
    open?.(path, tag.attributes);
  });
  parser.on('closetag', () => {
    close?.(path);
    path.pop();
  });
  if (text) {
    parser.on('text', value => text(path, value));
    parser.on('cdata', value => text(path, value));
  }
  parser.write(xml).close();
}

function hiddenTabs(xml, SaxesParser) {
  const tabs = [];
  readXml(xml, SaxesParser, sheetXml, { open(path, attrs) {
    if (path.length !== 3 || path[0] !== 'workbook' || path[1] !== 'sheets' || path[2] !== 'sheet') return;
    if (attrs.state?.value !== 'hidden' && attrs.state?.value !== 'veryHidden') return;
    const relation = Object.values(attrs).find(attr => attr.uri === workbookRelations && attr.local === 'id');
    tabs.push({ name: attrs.name?.value, relation: relation?.value });
  } });
  return tabs;
}

function relatedFiles(xml, SaxesParser) {
  const sheets = new Map();
  let sharedStrings;
  readXml(xml, SaxesParser, packageRelations, { open(path, attrs) {
    if (path.length !== 2 || path[0] !== 'Relationships' || path[1] !== 'Relationship') return;
    if (attrs.TargetMode?.value && attrs.TargetMode.value !== 'Internal') return;
    const target = attrs.Target?.value?.replace(/^\/xl\//, '');
    if (attrs.Type?.value === `${workbookRelations}/worksheet` && /^worksheets\/sheet\d+\.xml$/.test(target)) {
      const id = attrs.Id?.value;
      if (!id || sheets.has(id)) throw new Error('Ambiguous worksheet relationship');
      sheets.set(id, `xl/${target}`);
    } else if (attrs.Type?.value === `${workbookRelations}/sharedStrings` && target === 'sharedStrings.xml') {
      if (sharedStrings) throw new Error('Ambiguous shared-string relationship');
      sharedStrings = `xl/${target}`;
    }
  } });
  return { sheets, sharedStrings };
}

function isStringText(path, depth) {
  return path.at(-1) === 't' && (path.length === depth + 2 || (path.length === depth + 3 && path[depth + 1] === 'r'));
}

function stateCells(xml, SaxesParser) {
  const cells = new Map();
  let cell;
  let previousRow = 0;
  readXml(xml, SaxesParser, sheetXml, {
    open(path, attrs) {
      if (cell && path.length === 5 && path[4] === 'f') throw new Error('Unsupported worksheet formula');
      if (path.length !== 4 || path[0] !== 'worksheet' || path[1] !== 'sheetData' || path[2] !== 'row' || path[3] !== 'c') return;
      const address = /^A([1-9]\d*)$/.exec(attrs.r?.value);
      if (!address) return;
      const row = Number(address[1]);
      const type = attrs.t?.value;
      if (!Number.isSafeInteger(row) || row <= previousRow || !['s', 'str', 'inlineStr'].includes(type))
        throw new Error('Unsupported state cell layout');
      previousRow = row;
      cell = { row, type, value: '' };
    },
    text(path, value) {
      if (!cell) return;
      if (cell.type === 'inlineStr' ? path[4] === 'is' && isStringText(path, 4) :
        path.length === 5 && path[4] === 'v') cell.value += value;
    },
    close(path) {
      if (path.length !== 4 || path[3] !== 'c' || !cell) return;
      if (cell.type === 's') {
        if (!/^\d+$/.test(cell.value) || !Number.isSafeInteger(Number(cell.value)))
          throw new Error('Invalid shared-string index');
        cell.value = Number(cell.value);
      }
      cells.set(cell.row, cell.value);
      cell = undefined;
    },
  });
  return cells;
}

function selectedStrings(xml, SaxesParser, wanted) {
  const selected = new Map();
  let index = -1;
  let current;
  readXml(xml, SaxesParser, sheetXml, {
    open(path) {
      if (path.length === 2 && path[0] === 'sst' && path[1] === 'si') current = wanted.has(++index) ? '' : undefined;
    },
    text(path, value) {
      if (current !== undefined && isStringText(path, 1)) current += value;
    },
    close(path) {
      if (path.length === 2 && path[1] === 'si' && current !== undefined) {
        selected.set(index, current);
        current = undefined;
      }
    },
  });
  if (selected.size !== wanted.size) throw new Error('Missing shared-string index');
  return selected;
}

async function readEmbeddedState(bytes, Zip, SaxesParser) {
  const zip = await Zip.loadAsync(bytes);
  const xml = name => zip.file(name)?.async('string');
  const workbook = await xml('xl/workbook.xml');
  if (!workbook) return;
  const tabs = hiddenTabs(workbook, SaxesParser);
  if (!tabs.length) return;
  const relationships = await xml('xl/_rels/workbook.xml.rels');
  if (!relationships) return;
  const { sheets, sharedStrings } = relatedFiles(relationships, SaxesParser);
  for (const tab of tabs) {
    // Other hidden tabs can still hold legacy state, so preserve the workbook reader's selection order.
    if (!continuationTab.test(tab.name) || !sheets.has(tab.relation)) return;
    const worksheet = await xml(sheets.get(tab.relation));
    if (!worksheet) return;
    const cells = stateCells(worksheet, SaxesParser);
    const wanted = new Set([...cells.values()].filter(value => typeof value === 'number'));
    let strings = new Map();
    if (wanted.size) {
      const table = sharedStrings && await xml(sharedStrings);
      if (!table) return;
      strings = selectedStrings(table, SaxesParser, wanted);
    }
    const value = cell => typeof cell === 'number' ? strings.get(cell) : cell;
    if (value(cells.get(1)) !== continuationStateSignature) continue;
    cells.delete(1);
    return [...cells.values()].map(value).join('');
  }
}

export async function readContinuation(path, options) {
  const { readFile } = await import('node:fs/promises');
  const bytes = await readFile(path);
  return readContinuationBytes(bytes, { legacyZip: async () => {
    if (options.Zip) return options.Zip;
    const { createRequire } = await import('node:module');
    return createRequire(import.meta.url)('jszip');
  }, ...options });
}

export async function readContinuationBytes(bytes, { Workbook, Zip, SaxesParser, loadWorkbook, legacyZip }) {
  if (Zip && SaxesParser) {
    let state;
    try { state = await readEmbeddedState(bytes, Zip, SaxesParser); } catch { /* Unsupported workbook encoding. */ }
    if (state !== undefined) return parseContinuationState(state);
  }
  const loaded = Workbook ?? await loadWorkbook?.();
  const Constructor = loaded?.Workbook ?? loaded;
  let book = new Constructor();
  try {
    await book.xlsx.load(bytes);
  } catch (error) {
    const LegacyZip = legacyZip ? await legacyZip() : Zip;
    if (!LegacyZip) throw error;
    const zip = await LegacyZip.loadAsync(bytes);
    const workbook = await zip.file('xl/workbook.xml')?.async('string');
    if (!workbook?.includes('<x:workbook') || !workbook.includes('xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')) throw error;
    // Older app exports used a qualified spreadsheet namespace; ExcelJS needs unprefixed element names.
    const files = zip.file(/^xl\/(?:workbook|sharedStrings|styles|worksheets\/sheet\d+)\.xml$/);
    for (const file of files) {
      const xml = await file.async('string');
      zip.file(file.name, xml.replace(/<(\/?)x:(?=[A-Za-z])/g, '<$1').replace('xmlns:x=', 'xmlns='));
    }
    book = new Constructor();
    await book.xlsx.load(await zip.generateAsync({ type: 'uint8array' }));
  }
  return readContinuationWorkbook(book);
}

export function readContinuationWorkbook(book) {
  const sheet = book.worksheets.find(candidate => candidate.state !== 'visible' && cellValue(candidate.getCell('A1')) === continuationStateSignature);
  if (!sheet) {
    const state = legacyContinuation(book);
    if (state.keywords.length) return state;
    throw new Error('未能从 Excel 识别监控关键词。请选择舆情监控导出的报告。 Could not find monitoring keywords in this Excel report.');
  }
  const chunks = [];
  sheet.eachRow((row, index) => { if (index > 1) chunks.push(cellValue(row.getCell(1))); });
  return parseContinuationState(chunks.join(''));
}
