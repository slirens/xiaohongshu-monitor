const textLimit = 12000;
const reportClock = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function makeReportFilename(keywords, startedAt) {
  const { year, month, day, hour, minute, second } = Object.fromEntries(
    reportClock.formatToParts(startedAt).map(({ type, value }) => [type, value]),
  );
  const safe = (keywords[0] ?? '').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '-');
  const first = Array.from(safe).slice(0, 12).join('').replace(/^[.\s-]+|[.\s-]+$/gu, '') || '关键词';
  const keyword = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])\./i.test(first) ? first.replace('.', '-') : first;
  return `${keyword}_${year}-${month}-${day}_${keywords.length}词_${hour}${minute}${second}.xlsx`;
}

const metrics = { likes: '点赞', saves: '收藏', comments: '评论' };
const metricColumns = Object.entries(metrics).flatMap(([key, label]) => [
  [key + '_previous', label + '上次', 'previous'],
  [key, label + '本次', 'current'],
  [key + '_delta', label + '增减', 'delta'],
  [key + '_rate', label + '涨幅', 'rate'],
].map(([column, heading, attribute]) => ({ column, heading, attribute, key })));
const columnTitles = Object.freeze({
  keyword: '关键词', date: '发布日期', title: '标题', body: '正文',
  url: '原文地址', analysis_status: '分析状态', date_label: '网页日期原文',
  first_seen: '首次发现日期', engagement_status: '本轮数据状态',
  ...Object.fromEntries(metricColumns.map(({ column, heading }) => [column, heading])),
});
const sentiments = ['正面', '中性', '负面', '混合', '无法判断'];
const defaultFields = [
  { key: 'relevant', title: '相关', type: 'boolean', instruction: '判断笔记是否具体提到关键词主体或与主体直接相关。' },
  { key: 'sentiment', title: '情绪', type: 'enum', values: sentiments, instruction: '针对关键词主体判断情绪。证据不足时选择无法判断。' },
  { key: 'topic', title: '主题', type: 'text', instruction: '用简短的词组描述笔记的主要话题。' },
  { key: 'summary', title: '摘要', type: 'text', instruction: '用一句话概括笔记要点。' },
];
const defaultSections = [
  { key: 'coverage', title: '样本范围', instruction: '说明时间范围、样本数量和分析覆盖情况。' },
  { key: 'themes', title: '主要议题', instruction: '归纳样本中的共同话题和具体反馈。' },
  { key: 'risks', title: '风险与待核实事项', instruction: '列出有依据的风险线索，区分已观察事实和待核实判断。' },
  { key: 'engagement_update', title: '互动变化研判', instruction: '指出本次新发现和已有笔记互动的重要变化。使用供给的可比样本、绝对增减和涨幅，标明统计限制。' },
];
const detail = ['date', 'title', 'body', 'url', 'relevant', 'sentiment', 'topic', 'summary', 'analysis_status', 'date_label',
  'first_seen', 'engagement_status', ...metricColumns.map(({ column }) => column)];
const defaultSheets = [
  { kind: 'summary', name: '总结' },
  { kind: 'overview', name: '总表', columns: ['keyword', ...detail] },
  { kind: 'date', columns: ['keyword', ...detail] },
  { kind: 'keyword', columns: detail },
];
const defaultRules = '按笔记证据分析关键词主体。区分事实、观点和无法核实的信息。仅引用样本已提供的事实、数据及原文。';

function fail(message) { throw new Error('报告模板无效：' + message); }

function objectKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + '须为对象。');
  const extra = Object.keys(value).find(key => !allowed.includes(key));
  if (extra) fail(label + '包含未知设置「' + extra + '」。');
}

function text(value, max, label, multiline = false) {
  const invalid = multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || invalid.test(value)) {
    fail(`${label}须为不超过 ${max} 字的有效文本。`);
  }
  return value.trim();
}

function keys(entries, max, label, parse) {
  if (!Array.isArray(entries) || entries.length > max) fail(`${label}须为数组，最多 ${max} 项。`);
  const seen = new Set();
  return entries.map((entry, index) => {
    const name = `${label}第 ${index + 1} 项`;
    const item = parse(entry, name);
    if (seen.has(item.key)) fail(`${label}存在重复字段「${item.key}」。`);
    seen.add(item.key);
    return item;
  });
}

function ruleKey(value, label) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(value) || value === 'constructor' || value === 'prototype') {
    fail(label + '的 key 必须以小写英文字母开头，可含小写字母、数字、下划线，最长 32 个字符。');
  }
  return value;
}

function parseField(value, label) {
  objectKeys(value, ['key', 'title', 'type', 'instruction', 'values'], label);
  const key = ruleKey(value.key, label);
  if (Object.hasOwn(columnTitles, key)) fail(`${label}的 key「${key}」已用于内置列。`);
  const field = { key, title: text(value.title, 40, label + '的 title'), type: value.type,
    instruction: text(value.instruction, 500, label + '的 instruction', true) };
  if (!['text', 'boolean', 'enum'].includes(field.type)) fail(label + '的 type 只接受 text、boolean 或 enum。');
  if (field.type === 'enum') {
    if (!Array.isArray(value.values) || !value.values.length || value.values.length > 16) fail(label + '须定义 1 到 16 个 enum 选项。');
    field.values = value.values.map(item => text(item, 50, label + '的枚举选项'));
    if (new Set(field.values).size !== field.values.length) fail(label + '的枚举选项重复。');
  } else if (value.values !== undefined) {
    fail(label + '只有 enum 字段可以定义 values。');
  }
  return field;
}

function parseSection(value, label) {
  objectKeys(value, ['key', 'title', 'instruction'], label);
  return { key: ruleKey(value.key, label), title: text(value.title, 40, label + '的 title'),
    instruction: text(value.instruction, 500, label + '的 instruction', true) };
}

function parseSheets(sheets, fields, sections) {
  if (!Array.isArray(sheets) || !sheets.length || sheets.length > 4) fail('sheets 需要 1 到 4 个工作表规则。');
  const kinds = new Set();
  const fixedNames = new Set();
  const available = new Set([...Object.keys(columnTitles), ...fields.map(field => field.key)]);
  const names = new Map(Object.entries(columnTitles));
  for (const field of fields) names.set(field.key, field.title);
  const parsed = sheets.map((sheet, index) => {
    const label = `工作表第 ${index + 1} 项`;
    objectKeys(sheet, ['kind', 'name', 'columns'], label);
    const { kind } = sheet;
    if (!['summary', 'overview', 'date', 'keyword'].includes(kind) || kinds.has(kind)) fail(label + '的 kind 无效或重复。');
    kinds.add(kind);
    const config = { kind };
    if (kind === 'summary' || kind === 'overview') {
      config.name = text(sheet.name, 31, label + '的 name');
      const key = config.name.toLowerCase();
      if (/[\\/\[\]:*?]|^'|'$/.test(config.name) || key === 'history' || fixedNames.has(key)) {
        fail(label + '的 name 不符合 Excel 命名要求或与其他工作表重复。');
      }
      fixedNames.add(key);
    } else if (sheet.name !== undefined) {
      fail(label + '按实际日期或关键词命名，请省略 name。');
    }
    if (kind !== 'summary') {
      if (!Array.isArray(sheet.columns) || !sheet.columns.length || sheet.columns.length > available.size) fail(label + '须提供有效的 columns 数组。');
      for (const key of sheet.columns) if (!available.has(key)) fail(`${label}包含未定义的列「${String(key)}」。`);
      if (new Set(sheet.columns.map(key => names.get(key))).size !== sheet.columns.length) fail(label + '包含重复列或同名列。');
      config.columns = sheet.columns;
    } else if (sheet.columns !== undefined || !sections.length) {
      fail(label + '的列由程序生成，须提供至少一个 summarySections 项。');
    }
    return config;
  });
  if (kinds.size === 1 && kinds.has('date')) fail('仅按日期分表时空结果无法生成文件，请再配置一类工作表。');
  if (kinds.has('date') && [...fixedNames].some(name => /^\d{4}-\d{2}-\d{2}$/.test(name))) {
    fail('启用日期分表后，请为总结和总表使用日期以外的名称。');
  }
  return parsed;
}

function sectionText(markdown, title) {
  let level = 0;
  let insideFence = false;
  const lines = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) continue;
    const heading = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    if (level && heading && heading[1].length <= level) break;
    if (level) lines.push(line);
    else if (heading?.[2].trim() === title) level = heading[1].length;
  }
  return level ? lines.join('\n').trim() : null;
}

export function parseReportTemplate(markdown = '', name = '内置模板') {
  if (typeof markdown !== 'string' || markdown.length > textLimit) fail('Markdown 不能超过 12,000 个字符。');
  const source = markdown.replace(/^\uFEFF/, '').trim();
  const openings = [...source.matchAll(/^ {0,3}```report-schema\b[^\r\n]*/gm)];
  if (!openings.length) {
    if (source && !['总结', '总表', '日期'].every(title => sectionText(source, title) !== null)) {
      fail('旧版模板须含「总结」「总表」「日期」三个标题，新版模板须提供 report-schema 代码块。');
    }
    if (!source && name !== '内置模板') fail('上传的 Markdown 文件为空。');
    return { name, rules: sectionText(source, '分析规则') || defaultRules,
      summaryRules: sectionText(source, '总结') || '', fields: defaultFields,
      sections: defaultSections, sheets: defaultSheets, legacy: true };
  }
  const schemaBlock = /^ {0,3}```report-schema[ \t]*\r?\n([\s\S]*?)^ {0,3}```[ \t]*$/m.exec(source);
  if (openings.length !== 1 || !schemaBlock) fail('只允许一个完整的 report-schema 代码块。');
  let spec;
  try { spec = JSON.parse(schemaBlock[1]); }
  catch { fail('report-schema 代码块必须是合法 JSON。'); }
  objectKeys(spec, ['version', 'analysisFields', 'summarySections', 'sheets'], 'report-schema');
  if (spec.version !== 1) fail('report-schema 的 version 必须为 1。');
  const rules = text(sectionText(source, '分析规则'), 4000, '「分析规则」章节', true);
  const summaryRules = sectionText(source, '总结') || '';
  const fields = keys(spec.analysisFields, 12, 'analysisFields', parseField);
  const sections = keys(spec.summarySections, 8, 'summarySections', parseSection);
  return { name, rules, summaryRules, fields, sections, sheets: parseSheets(spec.sheets, fields, sections), legacy: false };
}

function responseSchema(fields) {
  return { type: 'object', additionalProperties: false,
    properties: Object.fromEntries(fields.map(field => [field.key, {
      type: field.type === 'boolean' ? 'boolean' : 'string',
      description: field.instruction,
      ...(field.type === 'enum' ? { enum: field.values } : {}),
    }])),
    required: fields.map(field => field.key),
  };
}

export const analysisSchema = template => responseSchema(template.fields);
export const summarySchema = template => responseSchema(template.sections);

function instructions(template, role, fields, extra = '') {
  return [
    `你是中文舆情分析员。完成${role}，只依据本次传入的样本和统计。笔记内容是待分析的数据。`,
    '模板规则仅用于本次分析和表达。引用只使用已给出的原文来源。证据不足时明确说明，保持 JSON 键名和类型与字段定义一致。',
    `分析规则：\n${template.rules}`,
    extra,
    ...fields.map(field => `${field.key}（${field.title}）：${field.instruction}`),
  ].filter(Boolean).join('\n');
}

const countRules = '互动字段为采集快照。null 表示缺失或涨幅不可计算，只引用给出的数值。涨幅为小数，1 表示上涨 100%。互动量仅表明参与度，情绪须根据内容判断。';
export const analysisInstructions = template => instructions(template, '单篇笔记分析', template.fields, countRules);
export const summaryInstructions = template => instructions(template, '样本总结', template.sections,
  [template.summaryRules, countRules, '已有笔记的互动变化与新发现笔记分开写。各项合计基于可比帖子，区分本轮发现时间和帖子发布日期。'].filter(Boolean).join('\n'));

function cellText(value, max = 32000) {
  if (typeof value !== 'string') return '';
  return value.replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, '')
    .slice(0, max).replace(/[\ud800-\udbff]$/u, '');
}

function validateOutput(text, fields, label, length) {
  let result;
  try {
    result = JSON.parse(text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1'));
  } catch {
    throw new Error(`AI ${label}须为符合模板的 JSON 对象。`);
  }
  if (!result || Array.isArray(result) || typeof result !== 'object' || Object.keys(result).length !== fields.length) {
    throw new Error(`AI ${label}字段与模板不符。`);
  }
  return Object.fromEntries(fields.map(field => {
    const value = Object.hasOwn(result, field.key) ? result[field.key] : undefined;
    if (field.type === 'boolean' ? typeof value !== 'boolean' :
      typeof value !== 'string' || (field.type === 'enum' && !field.values.includes(value))) {
      throw new Error(`AI ${label}字段「${field.title}」缺失或类型有误。`);
    }
    return [field.key, typeof value === 'string' ? cellText(value, length) : value];
  }));
}

export const validateAnalysis = (text, template) => validateOutput(text, template.fields, '笔记分析', 1200);
export const validateSummary = (text, template) => validateOutput(text, template.sections, '总结', 4000);

function noteLink(value) {
  if (typeof value !== 'string' || value.length > 4096 || /\s/.test(value)) return '';
  try {
    const url = new URL(value);
    const valid = url.protocol === 'https:' && /^(?:www\.)?xiaohongshu\.com$/.test(url.hostname) &&
      !url.port && !url.username && !url.password && /^\/explore\/[a-f0-9]{24}\/?$/i.test(url.pathname);
    return valid ? url.href : '';
  } catch {
    return '';
  }
}

function sheetName(value, used) {
  const base = cellText(value).replace(/[\\/\[\]:*?\x00-\x1f]/g, '_').replace(/^[\s']+|[\s']+$/g, '') || '关键词';
  for (let seq = 1; ; seq++) {
    const suffix = seq === 1 ? '' : ` (${seq})`;
    const name = cellText(base, 31 - suffix.length).replace(/'+$/, '') + suffix;
    const key = name.toLowerCase();
    if (key === 'history' || used.has(key)) continue;
    used.add(key);
    return name;
  }
}

export function makeReportSheets(template, reports, options = {}) {
  const titles = new Map(Object.entries(columnTitles));
  for (const field of template.fields) titles.set(field.key, field.title);
  const used = new Set(template.sheets.filter(sheet => sheet.name).map(sheet => sheet.name.toLowerCase()));
  used.add('_xhs_continuation');
  const state = options.continuationState;
  const allRows = state?.notes.map(note => [{ keyword: note.keywords.join('、') }, note]);
  const notesByDate = new Map();
  if (template.sheets.some(sheet => sheet.kind === 'date')) {
    for (const [report, note] of allRows ?? reports.flatMap(report => report.notes.map(note => [report, note]))) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(note.date)) continue;
      if (!notesByDate.has(note.date)) notesByDate.set(note.date, []);
      notesByDate.get(note.date).push([report, note]);
    }
  }
  const dateNames = new Map([...notesByDate.keys()].sort().map(date => [date, sheetName(date, used)]));
  const cells = (report, note, columns) => {
    const raw = {
      keyword: report.keyword, date: note?.date, title: note?.title, body: note?.body, url: noteLink(note?.url),
      analysis_status: note?.analysis ? '完成' : note?.error || (report.failed ? '采集失败，详见执行日志' : '未分析'),
      date_label: note?.dateLabel,
      first_seen: note?.firstSeen?.slice(0, 10),
      engagement_status: ({ new: '首次发现', refreshed: '本轮已复查', not_seen: '本轮未取得数据' })[note?.changeType],
    };
    for (const { column, attribute, key } of metricColumns) {
      const comparison = note?.comparison?.[key];
      raw[column] = attribute === 'current' && !comparison && note?.changeType !== 'not_seen' ? note?.engagement?.[key] : comparison?.[attribute];
    }
    return columns.map(key => {
      const value = Object.hasOwn(raw, key) ? raw[key] : note?.analysis?.[key];
      return typeof value === 'boolean' ? (value ? '是' : '否') : typeof value === 'number' && Number.isFinite(value) ? value : cellText(value);
    });
  };
  const makeDetail = (config, name, entries) => ({
    name, headings: config.columns.map(key => titles.get(key)),
    rows: entries.map(([report, note]) => cells(report, note, config.columns)),
    linkColumn: config.columns.indexOf('url'),
    formats: config.columns.map(key => metricColumns.some(metric => metric.column === key)
      ? key.endsWith('_rate') ? '+0.0%;-0.0%;0.0%' : key.endsWith('_delta') ? '+0;-0;0' : '0' : undefined),
  });
  const reportRows = report => report.failed && !report.notes.length ? [[report, undefined]] : report.notes.map(note => [report, note]);
  const summaryRows = () => {
    const rows = [['报告模板', cellText(template.name)]];
    if (state) {
      const updates = state.runs.slice().reverse();
      rows.push(['互动统计口径', '按同一帖子两次实际取得的数值计算。空白表示缺失或不可计算。上次为 0 时只显示增减数。']);
      for (const [index, run] of updates.entries()) {
        rows.push([`${run.day} · ${run.continued ? '舆情更新' : '首次基线'}`, `监控范围 ${run.start} 至 ${run.end}`],
          ['本轮搜索关键词', run.keywords.join('、')], ['新发现笔记', run.newNotes], ['已复查历史笔记', run.refreshedNotes]);
        if (run.failedKeywords.length) rows.push(['未完成关键词', run.failedKeywords.join('、')]);
        for (const [key, label] of Object.entries(metrics)) {
          const stats = run.engagement[key];
          if (!stats?.count) {
            rows.push([`${label}变化`, '暂无两次均取得的数据']);
            continue;
          }
          const sign = stats.delta > 0 ? '+' : '';
          const percent = stats.rate === null ? '基数为 0，涨幅不适用'
            : `涨幅 ${stats.rate > 0 ? '+' : ''}${(stats.rate * 100).toFixed(1)}%`;
          rows.push([`${label}变化`, `${stats.count} 篇可比 · ${stats.previous} → ${stats.current} · ${sign}${stats.delta} · ${percent}`]);
        }
        const narrative = index === 0 ? options.summary : run.summaries;
        if (narrative) for (const part of template.sections) {
          if (narrative[part.key]) rows.push([part.title, cellText(narrative[part.key])]);
        }
      }
    }
    if (options.summaryStatus) rows.push(['AI 综合总结', cellText(options.summaryStatus)]);
    if (!state && options.summary) for (const part of template.sections) rows.push([part.title, cellText(options.summary[part.key])]);
    for (const report of reports) {
      rows.push(['关键词', cellText(report.keyword)], ['命中样本', report.failed ? '未完成' : report.notes.length],
        ['已分析', report.notes.filter(note => note.analysis).length]);
      for (const [key, value] of Object.entries(report.info || {})) {
        if (key !== '关键词') rows.push([key, typeof value === 'number' && Number.isFinite(value) ? value : cellText(value)]);
      }
      if (template.legacy) {
        const related = report.notes.filter(note => note.analysis?.relevant === true);
        rows.push(['AI 判定相关', related.length]);
        for (const sentiment of sentiments) {
          rows.push([`相关样本 · ${sentiment}`, related.filter(note => note.analysis.sentiment === sentiment).length]);
        }
        const topics = new Map();
        for (const note of related) {
          const topic = note.analysis.topic?.trim() || '未归类';
          topics.set(topic, (topics.get(topic) || 0) + 1);
        }
        rows.push(['主题（AI 相关样本）', '条数'], ...[...topics].sort((a, b) => b[1] - a[1]));
      }
      if (report.summaryStatus) rows.push(['AI 总结', cellText(report.summaryStatus)]);
      if (report.summary) for (const part of template.sections) rows.push([part.title, cellText(report.summary[part.key])]);
    }
    return rows;
  };
  return template.sheets.flatMap(config => {
    if (config.kind === 'summary') return [{ name: config.name, headings: ['指标', '值'], rows: summaryRows(), linkColumn: -1 }];
    if (config.kind === 'overview') return [makeDetail(config, config.name, allRows ?? reports.flatMap(reportRows))];
    if (config.kind === 'date') return [...dateNames].map(([date, name]) => makeDetail(config, name, notesByDate.get(date)));
    if (template.legacy && reports.length < 2 && !options.includeSingleKeyword) return [];
    return reports.map(report => makeDetail(config, sheetName(report.keyword, used), reportRows(report)));
  });
}
