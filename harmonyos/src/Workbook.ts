const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

export class ReportNote {
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly date: string;

  constructor(title: string, body: string, url: string, date: string) {
    this.title = title;
    this.body = body;
    this.url = url;
    this.date = date;
  }
}

export class KeywordReport {
  readonly keyword: string;
  readonly notes: ReportNote[];
  readonly summary: string;

  constructor(keyword: string, notes: ReportNote[], summary: string = '') {
    this.keyword = keyword;
    this.notes = notes;
    this.summary = summary;
  }
}

class Row {
  readonly cells: (string | number)[];
  readonly link: string;

  constructor(cells: (string | number)[], link: string = '') {
    this.cells = cells;
    this.link = link;
  }
}

class Sheet {
  readonly name: string;
  readonly headings: string[];
  readonly rows: Row[];
  readonly linkColumn: number;

  constructor(name: string, headings: string[], rows: Row[], linkColumn: number = -1) {
    this.name = name;
    this.headings = headings;
    this.rows = rows;
    this.linkColumn = linkColumn;
  }
}

interface SheetLayout {
  name: string;
  headings: string[];
  rows: (string | number)[][];
  linkColumn: number;
}

function limitText(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  const last = value.charCodeAt(max - 1);
  return value.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

function cleanXml(value: string): string {
  return value.replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '');
}

function xml(value: string): string {
  return cleanXml(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/\r/g, '&#13;');
}

function uniqueSheetName(input: string, used: Set<string>): string {
  const sanitized = cleanXml(input).replace(/[\u0009\u000A\u000D\\/*?:[\]]/g, ' ')
    .replace(/^[\s']+|[\s']+$/g, '');
  const base = sanitized || '关键词';
  let name = limitText(base, 31).replace(/'+$/g, '');
  let index = 2;
  while (used.has(name.toLowerCase()) || name.toLowerCase() === 'history') {
    const suffix = ' (' + index + ')';
    name = limitText(base, 31 - suffix.length) + suffix;
    index++;
  }
  used.add(name.toLowerCase());
  return name;
}

function noteLink(address: string): string {
  if (address.length > 4096) {
    return '';
  }
  return /^https:\/\/(?:www\.)?xiaohongshu\.com\/(?:explore|discovery\/item)\/[0-9a-f]{24}\/?(?:[?#][^\s<>"']*)?$/i
    .test(address) ? address : '';
}

function noteRow(note: ReportNote, keyword: string = ''): Row {
  const address = noteLink(note.url);
  const fields = [note.date, note.title, note.body, address];
  if (keyword.length > 0) {
    fields.unshift(keyword);
  }
  return new Row(fields, address);
}

function reportSheets(reports: KeywordReport[]): Sheet[] {
  const headings = ['日期', '标题', '正文', '原文链接'];
  const combined = ['关键词', '日期', '标题', '正文', '原文链接'];
  const used = new Set<string>(['总结', '总表']);
  const summary: Row[] = [];
  const overview: Row[] = [];
  const dated = new Map<string, Row[]>();
  let count = 0;

  for (const report of reports) {
    summary.push(new Row([report.keyword, report.notes.length, report.summary]));
    count += report.notes.length;
    for (const note of report.notes) {
      const row = noteRow(note, report.keyword || '关键词');
      overview.push(row);
      if (/^\d{4}-\d{2}-\d{2}$/.test(note.date)) {
        let rows = dated.get(note.date);
        if (rows === undefined) {
          rows = [];
          dated.set(note.date, rows);
        }
        rows.push(row);
      }
    }
  }
  summary.unshift(new Row(['合计', count, '']));

  const sheets = [new Sheet('总结', ['关键词', '笔记数', '摘要'], summary), new Sheet('总表', combined, overview, 4)];
  const dates = Array.from(dated.keys()).sort();
  for (const date of dates) {
    const rows = dated.get(date);
    if (rows !== undefined) {
      used.add(date);
      sheets.push(new Sheet(date, combined, rows, 4));
    }
  }
  for (const report of reports) {
    const rows = report.notes.map((note: ReportNote): Row => noteRow(note));
    sheets.push(new Sheet(uniqueSheetName(report.keyword, used), headings, rows, 3));
  }
  return sheets;
}

function relationship(id: number, type: string, target: string, external: boolean = false): string {
  return '<Relationship Id="rId' + id + '" Type="' + OFFICE_REL + '/' + type +
    '" Target="' + xml(target) + '"' + (external ? ' TargetMode="External"' : '') + '/>';
}

function relationships(entries: string[]): string {
  return XML_HEADER + '<Relationships xmlns="' + PKG_REL + '">' + entries.join('') + '</Relationships>';
}

function rowXml(row: (string | number)[], index: number, linkColumn: number = -1): string {
  const cells: string[] = row.map((value: string | number, column: number): string => {
    const ref = String.fromCharCode(65 + column) + index;
    const style = index === 1 ? ' s="1"' : column === linkColumn ? ' s="2"' : '';
    if (typeof value === 'number') {
      return '<c r="' + ref + '"' + style + '><v>' + value + '</v></c>';
    }
    return '<c r="' + ref + '" t="inlineStr"' + style + '><is><t xml:space="preserve">' +
      xml(limitText(value, 32767)) + '</t></is></c>';
  });
  return '<row r="' + index + '">' + cells.join('') + '</row>';
}

const STYLES = XML_HEADER + '<styleSheet xmlns="' + SHEET_NS + '">' +
  '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/>' +
  '<name val="Calibri"/></font><font><u/><sz val="11"/><color rgb="FF1565C0"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

class ZipEntry {
  readonly name: Uint8Array;
  readonly data: Uint8Array;
  readonly checksum: number;

  constructor(path: string, content: string) {
    this.name = utf8(path);
    this.data = utf8(content);
    this.checksum = crc32(this.data);
  }
}

function appendSheet(entries: ZipEntry[], sheet: Sheet, number: number): void {
  const rows = [rowXml(sheet.headings, 1)];
  const references: string[] = [];
  const links: string[] = [];
  for (let index = 0; index < sheet.rows.length; index++) {
    const row = sheet.rows[index];
    const rowNumber = index + 2;
    const column = row.link ? sheet.linkColumn : -1;
    rows.push(rowXml(row.cells, rowNumber, column));
    if (column >= 0) {
      const ref = String.fromCharCode(65 + column) + rowNumber;
      const id = links.length + 1;
      references.push('<hyperlink ref="' + ref + '" r:id="rId' + id + '"/>');
      links.push(relationship(id, 'hyperlink', row.link, true));
    }
  }
  const widths = sheet.headings.map((heading: string, index: number): string => {
    const width = index === sheet.linkColumn ? 60 :
      ['正文', '摘要', '值'].includes(heading) ? 65 : heading === '标题' ? 32 : 17;
    return '<col min="' + (index + 1) + '" max="' + (index + 1) + '" width="' + width + '" customWidth="1"/>';
  });
  const hyperlinks = references.length > 0 ? '<hyperlinks>' + references.join('') + '</hyperlinks>' : '';
  const data = XML_HEADER + '<worksheet xmlns="' + SHEET_NS + '" xmlns:r="' + OFFICE_REL + '">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '</sheetView></sheetViews><cols>' + widths.join('') + '</cols><sheetData>' + rows.join('') + '</sheetData>' +
    hyperlinks + '</worksheet>';
  entries.push(new ZipEntry('xl/worksheets/sheet' + number + '.xml', data));
  if (links.length > 0) {
    entries.push(new ZipEntry('xl/worksheets/_rels/sheet' + number + '.xml.rels', relationships(links)));
  }
}

function utf8(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length * 3);
  let offset = 0;
  for (let index = 0; index < text.length; index++) {
    let point = text.codePointAt(index) ?? 0xfffd;
    if (point >= 0xd800 && point <= 0xdfff) {
      point = 0xfffd;
    }
    if (point < 0x80) {
      bytes[offset++] = point;
    } else if (point < 0x800) {
      bytes[offset++] = 0xc0 | point >> 6;
      bytes[offset++] = 0x80 | point & 0x3f;
    } else if (point < 0x10000) {
      bytes[offset++] = 0xe0 | point >> 12;
      bytes[offset++] = 0x80 | point >> 6 & 0x3f;
      bytes[offset++] = 0x80 | point & 0x3f;
    } else {
      bytes[offset++] = 0xf0 | point >> 18;
      bytes[offset++] = 0x80 | point >> 12 & 0x3f;
      bytes[offset++] = 0x80 | point >> 6 & 0x3f;
      bytes[offset++] = 0x80 | point & 0x3f;
      index++;
    }
  }
  return bytes.slice(0, offset);
}

function crcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index++) {
    let entry = index;
    for (let bit = 0; bit < 8; bit++) {
      entry = (entry >>> 1) ^ ((entry & 1) ? 0xedb88320 : 0);
    }
    table[index] = entry;
  }
  return table;
}

const CRC_TABLE = crcTable();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index++) {
    crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// OOXML is stored in a ZIP with uncompressed entries and CRC-32 integrity checks.
function zip(entries: ZipEntry[]): Uint8Array {
  let centralOffset = 0;
  let centralLength = 0;
  for (const entry of entries) {
    centralOffset += 30 + entry.name.length + entry.data.length;
    centralLength += 46 + entry.name.length;
  }
  if (entries.length > 0xffff || centralOffset + centralLength + 22 > 0x7fffffff) {
    throw new Error('工作簿过大，请缩小日期范围或减少关键词。');
  }
  const bytes = new Uint8Array(centralOffset + centralLength + 22);
  const view = new DataView(bytes.buffer);
  let local = 0;
  let central = centralOffset;
  for (const entry of entries) {
    const nameLength = entry.name.length;
    const size = entry.data.length;
    view.setUint32(local, 0x04034b50, true);
    view.setUint16(local + 4, 20, true);
    view.setUint16(local + 6, 0x0800, true);
    view.setUint16(local + 12, 33, true);
    view.setUint32(local + 14, entry.checksum, true);
    view.setUint32(local + 18, size, true);
    view.setUint32(local + 22, size, true);
    view.setUint16(local + 26, nameLength, true);
    bytes.set(entry.name, local + 30);
    bytes.set(entry.data, local + 30 + nameLength);

    view.setUint32(central, 0x02014b50, true);
    view.setUint16(central + 4, 20, true);
    view.setUint16(central + 6, 20, true);
    view.setUint16(central + 8, 0x0800, true);
    view.setUint16(central + 14, 33, true);
    view.setUint32(central + 16, entry.checksum, true);
    view.setUint32(central + 20, size, true);
    view.setUint32(central + 24, size, true);
    view.setUint16(central + 28, nameLength, true);
    view.setUint32(central + 42, local, true);
    bytes.set(entry.name, central + 46);
    central += 46 + nameLength;
    local += 30 + nameLength + size;
  }
  view.setUint32(central, 0x06054b50, true);
  view.setUint16(central + 8, entries.length, true);
  view.setUint16(central + 10, entries.length, true);
  view.setUint32(central + 12, centralLength, true);
  view.setUint32(central + 16, centralOffset, true);
  return bytes;
}

export function buildWorkbook(reports: KeywordReport[], layout?: SheetLayout[]): Uint8Array {
  const sheets = layout
    ? layout.map(sheet => new Sheet(sheet.name, sheet.headings, sheet.rows.map(cells => {
      const address = cells[sheet.linkColumn];
      return new Row(cells, typeof address === 'string' ? noteLink(address) : '');
    }), sheet.linkColumn))
    : reportSheets(reports);
  const entries: ZipEntry[] = [];
  const sheetList: string[] = [];
  const rels: string[] = [];
  const types = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
  ];
  for (let index = 0; index < sheets.length; index++) {
    const number = index + 1;
    const sheet = sheets[index];
    appendSheet(entries, sheet, number);
    sheetList.push('<sheet name="' + xml(sheet.name) + '" sheetId="' + number + '" r:id="rId' + number + '"/>');
    const path = 'worksheets/sheet' + number + '.xml';
    rels.push(relationship(number, 'worksheet', path));
    types.push('<Override PartName="/xl/' + path +
      '" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
  }
  rels.push(relationship(sheets.length + 1, 'styles', 'styles.xml'));
  entries.push(new ZipEntry('xl/workbook.xml', XML_HEADER + '<workbook xmlns="' + SHEET_NS + '" xmlns:r="' +
    OFFICE_REL + '"><bookViews><workbookView/></bookViews><sheets>' + sheetList.join('') + '</sheets></workbook>'));
  entries.push(new ZipEntry('xl/_rels/workbook.xml.rels', relationships(rels)));
  entries.push(new ZipEntry('xl/styles.xml', STYLES));
  entries.push(new ZipEntry('_rels/.rels', relationships([relationship(1, 'officeDocument', 'xl/workbook.xml')])));
  entries.push(new ZipEntry('[Content_Types].xml', XML_HEADER + '<Types xmlns="' + CONTENT_NS + '">' + types.join('') + '</Types>'));
  return zip(entries);
}
