import { readContinuationBytes, writeContinuation } from './continuation.mjs';

function openReports() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('xiaohongshu-monitor-reports', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('reports');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function latestReport(current) {
  const database = await openReports();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('reports', current ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('reports');
      const request = current ? store.put(current, 'latest') : store.get('latest');
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function loadReport(file) {
  return readContinuationBytes(await file.arrayBuffer(), {
    Workbook: globalThis.ExcelJS.Workbook,
    legacyZip: async () => globalThis.JSZip,
  });
}

export async function saveReport(layout, state) {
  const book = new globalThis.ExcelJS.Workbook();
  for (const layoutSheet of layout) {
    const { name, headings, rows, linkColumn, formats = [] } = layoutSheet;
    const sheet = book.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.addRow(headings).font = { bold: true };
    for (let column = 0; column < headings.length; column++) {
      const field = sheet.getColumn(column + 1);
      field.width = ({ 正文: 60, 原文地址: 44, 值: 52 })[headings[column]] ?? 19;
      if (formats[column]) field.numFmt = formats[column];
    }
    for (const row of rows) {
      const address = row[linkColumn];
      sheet.addRow(row.map((value, index) => index === linkColumn && address
        ? { text: address, hyperlink: address } : value));
    }
  }
  writeContinuation(book, state);
  return book.xlsx.writeBuffer();
}
