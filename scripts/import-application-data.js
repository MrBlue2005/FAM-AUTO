'use strict';
const fs = require('fs'); const path = require('path'); const DataManager = require('../app/core/DataManager');
const { planLocalApplicationImport, publicImportReport } = require('../app/cloud/LocalApplicationImportPlanner');
const args = process.argv.slice(2), apply = args.includes('--apply'), reportIndex = args.indexOf('--report'), reportPath = reportIndex >= 0 ? args[reportIndex + 1] : null;
if (apply) {
  if (process.env.RX_APP_IMPORT_CONFIRM !== 'IMPORT_APPLICATION_DATA') throw new Error('Real import requires RX_APP_IMPORT_CONFIRM=IMPORT_APPLICATION_DATA and --apply.');
  throw new Error('No hosted writer is configured in Phase 4B-A; no data was changed. Run without --apply for the safe report.');
}
const report = publicImportReport(planLocalApplicationImport({ dataManager: DataManager }));
if (reportPath) { const target = path.resolve(reportPath); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); }
console.log(JSON.stringify(report, null, 2));
