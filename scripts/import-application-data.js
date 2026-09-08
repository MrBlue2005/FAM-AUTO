'use strict';
const fs = require('fs'); const path = require('path'); const DataManager = require('../app/core/DataManager');
const { planLocalApplicationImport, publicImportReport } = require('../app/cloud/LocalApplicationImportPlanner');
const { SupabaseApplicationDataStore } = require('../app/cloud/SupabaseApplicationDataStore'); const { writeApplicationImport } = require('../app/cloud/ApplicationImportWriter');
const args = process.argv.slice(2), apply = args.includes('--apply'), reportIndex = args.indexOf('--report'), reportPath = reportIndex >= 0 ? args[reportIndex + 1] : null;
if (apply) {
  if (process.env.RX_APP_IMPORT_CONFIRM !== 'IMPORT_APPLICATION_DATA') throw new Error('Real import requires RX_APP_IMPORT_CONFIRM=IMPORT_APPLICATION_DATA and --apply.');
  const result = writeApplicationImport({ dataManager: DataManager, store: new SupabaseApplicationDataStore() });
  result.then((report) => { if (reportPath) { const target = path.resolve(reportPath); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); } console.log(JSON.stringify(report, null, 2)); }).catch((error) => { console.error(JSON.stringify({ mode: 'APPLY', error: error.message })); process.exitCode = 1; });
  return;
}
const report = publicImportReport(planLocalApplicationImport({ dataManager: DataManager }));
if (reportPath) { const target = path.resolve(reportPath); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); }
console.log(JSON.stringify(report, null, 2));
