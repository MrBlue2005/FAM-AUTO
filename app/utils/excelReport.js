const ExcelJS = require('exceljs');

const COLORS = {
  navy: '172033',
  blue: '2563EB',
  cyan: '06B6D4',
  green: '16A34A',
  amber: 'D97706',
  red: 'DC2626',
  slate: '475569',
  light: 'F1F5F9',
  white: 'FFFFFF',
  border: 'CBD5E1',
};

function numberFromEntry(entry, keys) {
  for (const key of keys) {
    const value = key.split('.').reduce((current, part) => current?.[part], entry);
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function filterHistory(history, range) {
  if (!range || range === 'all') return history.slice();
  const days = Number(range);
  if (![1, 7, 30].includes(days)) return history.slice();
  const threshold = Date.now() - days * 24 * 60 * 60 * 1000;
  return history.filter((entry) => new Date(entry.date).getTime() >= threshold);
}

function groupRows(history, idKey, nameKey) {
  const groups = new Map();
  for (const entry of history) {
    const id = entry[idKey] || '-';
    const current = groups.get(id) || {
      id,
      name: entry[nameKey] || id,
      total: 0,
      posted: 0,
      prepared: 0,
      skipped: 0,
      errors: 0,
      views: 0,
      firstDate: null,
      lastDate: null,
    };
    current.total += 1;
    if (entry.status === 'posted') current.posted += 1;
    if (entry.status === 'prepared') current.prepared += 1;
    if (entry.status === 'skipped') current.skipped += 1;
    if (entry.status === 'error') current.errors += 1;
    current.views += numberFromEntry(entry, ['views', 'viewCount', 'impressions', 'reach', 'metrics.views', 'metrics.impressions']);
    const date = entry.date ? new Date(entry.date) : null;
    if (date && !Number.isNaN(date.getTime())) {
      if (!current.firstDate || date < current.firstDate) current.firstDate = date;
      if (!current.lastDate || date > current.lastDate) current.lastDate = date;
    }
    groups.set(id, current);
  }
  return Array.from(groups.values()).sort((a, b) => b.posted - a.posted || b.total - a.total);
}

function styleTitle(sheet, title, subtitle, lastColumn) {
  sheet.mergeCells(`A1:${lastColumn}1`);
  sheet.getCell('A1').value = title;
  sheet.getCell('A1').font = { name: 'Aptos Display', size: 20, bold: true, color: { argb: COLORS.white } };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } };
  sheet.getCell('A1').alignment = { vertical: 'middle' };
  sheet.getRow(1).height = 36;
  sheet.mergeCells(`A2:${lastColumn}2`);
  sheet.getCell('A2').value = subtitle;
  sheet.getCell('A2').font = { name: 'Aptos', size: 10, color: { argb: COLORS.slate } };
  sheet.getCell('A2').alignment = { vertical: 'middle' };
  sheet.getRow(2).height = 24;
  sheet.views = [{ state: 'frozen', ySplit: 4 }];
  sheet.properties.showGridLines = false;
}

function styleTableHeader(row) {
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { name: 'Aptos', bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.blue } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = { bottom: { style: 'thin', color: { argb: COLORS.border } } };
  });
}

function styleBody(sheet, firstRow, lastRow, columns) {
  if (lastRow < firstRow) return;
  for (let rowNumber = firstRow; rowNumber <= lastRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.height = 21;
    row.eachCell((cell) => {
      cell.font = { name: 'Aptos', size: 10, color: { argb: COLORS.navy } };
      cell.border = { bottom: { style: 'hair', color: { argb: COLORS.border } } };
      cell.alignment = { vertical: 'middle' };
    });
    if (rowNumber % 2 === 0) {
      row.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } }; });
    }
  }
  columns.forEach((column, index) => { sheet.getColumn(index + 1).width = column.width; });
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: columns.length } };
}

function addAggregateSheet(workbook, name, title, subtitle, rows, idLabel) {
  const sheet = workbook.addWorksheet(name);
  const columns = [
    { header: idLabel, key: 'id', width: 22 },
    { header: 'Nume', key: 'name', width: 38 },
    { header: 'Total', key: 'total', width: 11 },
    { header: 'Postate', key: 'posted', width: 11 },
    { header: 'Pregatite', key: 'prepared', width: 12 },
    { header: 'Sarite', key: 'skipped', width: 10 },
    { header: 'Erori', key: 'errors', width: 10 },
    { header: 'Rata succes', key: 'successRate', width: 14 },
    { header: 'Vizualizari', key: 'views', width: 14 },
    { header: 'Prima actiune', key: 'firstDate', width: 20 },
    { header: 'Ultima actiune', key: 'lastDate', width: 20 },
  ];
  styleTitle(sheet, title, subtitle, 'K');
  sheet.getRow(4).values = columns.map((column) => column.header);
  styleTableHeader(sheet.getRow(4));
  rows.forEach((item, index) => {
    const rowNumber = index + 5;
    sheet.getRow(rowNumber).values = [item.id, item.name, item.total, item.posted, item.prepared, item.skipped, item.errors, null, item.views, item.firstDate, item.lastDate];
    sheet.getCell(`H${rowNumber}`).value = { formula: `IF(C${rowNumber}=0,0,D${rowNumber}/C${rowNumber})` };
  });
  const lastRow = Math.max(5, rows.length + 4);
  styleBody(sheet, 5, rows.length + 4, columns);
  sheet.getColumn('H').numFmt = '0.0%';
  sheet.getColumn('I').numFmt = '#,##0';
  sheet.getColumn('J').numFmt = 'yyyy-mm-dd hh:mm';
  sheet.getColumn('K').numFmt = 'yyyy-mm-dd hh:mm';
  sheet.addConditionalFormatting({ ref: `G5:G${lastRow}`, rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: [0], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FEE2E2' } }, font: { color: { argb: COLORS.red }, bold: true } } }] });
  return sheet;
}

async function buildCampaignWorkbook({ history, range = 'all' }) {
  const filtered = filterHistory(history, range);
  const campaignRows = groupRows(filtered, 'propertyId', 'propertyName');
  const groupSummaryRows = groupRows(filtered, 'groupId', 'groupName');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'R.X. AI Studio';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const detail = workbook.addWorksheet('Detalii');
  const detailColumns = [
    { header: 'Data', key: 'date', width: 20 }, { header: 'Campanie ID', key: 'propertyId', width: 22 },
    { header: 'Campanie', key: 'propertyName', width: 34 }, { header: 'Grup ID', key: 'groupId', width: 18 },
    { header: 'Grup', key: 'groupName', width: 42 }, { header: 'Zi', key: 'day', width: 8 },
    { header: 'Status', key: 'status', width: 13 }, { header: 'Vizualizari', key: 'views', width: 14 },
    { header: 'Motiv / eroare', key: 'reason', width: 48 },
  ];
  styleTitle(detail, 'R.X. AI - Detalii rezultate', `Filtru: ${range === 'all' ? 'tot istoricul' : `ultimele ${range} zile`} | Generat: ${new Date().toLocaleString('ro-RO')}`, 'I');
  detail.getRow(4).values = detailColumns.map((column) => column.header);
  styleTableHeader(detail.getRow(4));
  filtered.forEach((entry, index) => {
    const parsedDate = entry.date ? new Date(entry.date) : null;
    detail.getRow(index + 5).values = [
      parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null,
      entry.propertyId || '', entry.propertyName || '', entry.groupId || '', entry.groupName || '',
      Number(entry.day) || 0, entry.status || '', numberFromEntry(entry, ['views', 'viewCount', 'impressions', 'reach', 'metrics.views', 'metrics.impressions']),
      entry.reason || entry.error || entry.message || '',
    ];
  });
  const detailLastRow = Math.max(5, filtered.length + 4);
  styleBody(detail, 5, filtered.length + 4, detailColumns);
  detail.getColumn('A').numFmt = 'yyyy-mm-dd hh:mm';
  detail.getColumn('H').numFmt = '#,##0';
  detail.addConditionalFormatting({ ref: `G5:G${detailLastRow}`, rules: [
    { type: 'containsText', operator: 'containsText', text: 'posted', formulae: ['NOT(ISERROR(SEARCH("posted",G5)))'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'DCFCE7' } }, font: { color: { argb: COLORS.green } } } },
    { type: 'containsText', operator: 'containsText', text: 'error', formulae: ['NOT(ISERROR(SEARCH("error",G5)))'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FEE2E2' } }, font: { color: { argb: COLORS.red }, bold: true } } },
  ] });

  addAggregateSheet(workbook, 'Campanii', 'R.X. AI - Rezultate pe campanii', 'Agregare dupa proprietate sau job', campaignRows, 'Campanie ID');
  addAggregateSheet(workbook, 'Grupuri', 'R.X. AI - Rezultate pe grupuri', 'Performanta si erori pentru fiecare grup Facebook', groupSummaryRows, 'Grup ID');

  const summary = workbook.addWorksheet('Sumar', { properties: { tabColor: { argb: COLORS.cyan } } });
  styleTitle(summary, 'R.X. AI - Raport campanii', `Filtru: ${range === 'all' ? 'tot istoricul' : `ultimele ${range} zile`} | Generat: ${new Date().toLocaleString('ro-RO')}`, 'H');
  const cards = [
    ['Total actiuni', `COUNTA('Detalii'!$G$5:$G$${detailLastRow})`, COLORS.blue],
    ['Postate', `COUNTIF('Detalii'!$G$5:$G$${detailLastRow},"posted")`, COLORS.green],
    ['Pregatite', `COUNTIF('Detalii'!$G$5:$G$${detailLastRow},"prepared")`, COLORS.cyan],
    ['Sarite', `COUNTIF('Detalii'!$G$5:$G$${detailLastRow},"skipped")`, COLORS.amber],
    ['Erori', `COUNTIF('Detalii'!$G$5:$G$${detailLastRow},"error")`, COLORS.red],
    ['Rata succes', 'IF(B5=0,0,D5/B5)', COLORS.green],
  ];
  cards.forEach(([label, formula, color], index) => {
    const startColumn = index % 3 === 0 ? 1 : index % 3 === 1 ? 4 : 7;
    const startRow = index < 3 ? 4 : 8;
    summary.mergeCells(startRow, startColumn, startRow, startColumn + 1);
    summary.mergeCells(startRow + 1, startColumn, startRow + 2, startColumn + 1);
    const labelCell = summary.getCell(startRow, startColumn);
    labelCell.value = label;
    labelCell.font = { name: 'Aptos', bold: true, color: { argb: COLORS.slate } };
    const valueCell = summary.getCell(startRow + 1, startColumn);
    valueCell.value = { formula };
    valueCell.font = { name: 'Aptos Display', size: 22, bold: true, color: { argb: color } };
    valueCell.alignment = { vertical: 'middle' };
    for (let row = startRow; row <= startRow + 2; row += 1) {
      for (let column = startColumn; column <= startColumn + 1; column += 1) {
        const cell = summary.getCell(row, column);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
        cell.border = { bottom: { style: 'thin', color: { argb: COLORS.border } } };
      }
    }
  });
  summary.getCell('G9').numFmt = '0.0%';
  summary.getColumn(1).width = 18; summary.getColumn(2).width = 10;
  summary.getColumn(3).width = 3; summary.getColumn(4).width = 18;
  summary.getColumn(5).width = 10; summary.getColumn(6).width = 3;
  summary.getColumn(7).width = 18; summary.getColumn(8).width = 10;
  summary.properties.showGridLines = false;
  summary.views = [{ state: 'frozen', ySplit: 2 }];
  workbook.views = [{ activeTab: workbook.worksheets.indexOf(summary) }];

  return workbook.xlsx.writeBuffer();
}

module.exports = { buildCampaignWorkbook, filterHistory, groupRows };
