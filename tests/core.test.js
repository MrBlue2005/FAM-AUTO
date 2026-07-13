const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const {
  normalizeMediaReference,
  resolveMediaReference,
} = require('../app/utils/mediaPath');
const {
  buildPreflightReport,
  buildQueuePlan,
  getTaskId,
} = require('../app/core/CampaignTools');
const { buildCampaignWorkbook } = require('../app/utils/excelReport');
const DataManager = require('../app/core/DataManager');
const ScheduleManager = require('../app/core/ScheduleManager');

function fixture(overrides = {}) {
  const config = {
    campaignDay: 1,
    groupLimit: 'all',
    startFromGroup: 1,
    publishEnabled: false,
    selectedPropertyIds: ['P1'],
    campaignCategory: 'real_estate',
    facebookProfileId: 'main',
    facebookProfiles: [{ id: 'main', label: 'Main', category: 'real_estate' }],
    facebookPostingIdentities: [{ id: 'default', label: 'Default' }],
    postingIdentityByCategory: { real_estate: 'default' },
    postingIdentityByProfile: {},
    queueExcludedTaskIds: [],
    queueRetryTaskIds: [],
    queueOrder: [],
    ...overrides.config,
  };
  const properties = overrides.properties || [{
    id: 'P1',
    name: 'Property 1',
    active: true,
    transactionType: 'rent',
    posts: [{ day: 1, text: 'Text valid', media: [__filename], imagePath: __filename }],
  }];
  const groups = overrides.groups || [{
    id: 'G1',
    name: 'Chirie Bucuresti',
    url: 'https://www.facebook.com/groups/example',
    active: true,
    category: 'real_estate',
  }];

  return {
    config,
    properties,
    jobs: overrides.jobs || [],
    groups,
    history: overrides.history || [],
  };
}

test('normalizes legacy upload paths and resolves them in the current workspace', () => {
  const legacy = 'C:\\Users\\old\\Facebook Automation\\app\\uploads\\CHERRY_PARK\\day-1\\cover.jpg';
  assert.equal(
    normalizeMediaReference(legacy),
    'app/uploads/CHERRY_PARK/day-1/cover.jpg'
  );
  assert.match(resolveMediaReference(legacy), /app[\\/]uploads[\\/]CHERRY_PARK/);
});

test('queue marks processed tasks done and activates an explicit retry', () => {
  const postedHistory = [{
    propertyId: 'P1',
    groupId: 'G1',
    day: 1,
    facebookProfileId: 'main',
    status: 'posted',
  }];
  const donePlan = buildQueuePlan(fixture({ history: postedHistory }));
  assert.equal(donePlan.tasks[0].status, 'done');
  assert.equal(donePlan.activeTasks.length, 0);

  const retryPlan = buildQueuePlan(fixture({
    history: postedHistory,
    config: { queueRetryTaskIds: [getTaskId('P1', 'G1', 'main')] },
  }));
  assert.equal(retryPlan.tasks[0].status, 'retry');
  assert.equal(retryPlan.activeTasks.length, 1);
});

test('preflight blocks missing media and accepts a valid test-mode plan', () => {
  const valid = buildPreflightReport(fixture());
  assert.equal(valid.ok, true);
  assert.equal(valid.summary.active, 1);

  const invalidData = fixture();
  invalidData.properties[0].posts[0].media = ['Z:\\missing\\media.jpg'];
  invalidData.properties[0].posts[0].imagePath = 'Z:\\missing\\media.jpg';
  const invalid = buildPreflightReport(invalidData);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.issues.some((issue) => issue.code === 'MEDIA_NOT_FOUND'));
});

test('backup export has a versioned format and rejects incompatible imports', () => {
  const backup = DataManager.createBackup();
  assert.equal(backup.format, 'rx-ai-studio-backup');
  assert.equal(backup.version, 1);
  assert.ok(Array.isArray(backup.properties));
  assert.ok(Array.isArray(backup.runs));
  assert.ok(Array.isArray(backup.schedules));
  assert.throws(() => DataManager.restoreBackup({ ...backup, version: 999 }), /invalid|incompatibil/i);
  assert.throws(() => DataManager.restoreBackup({
    ...backup,
    properties: [{ id: '../invalid' }],
  }), /caractere nepermise/i);
  assert.deepEqual(DataManager.getRuntimeConfig(), backup.runtimeConfig);
});

test('weekly schedule computes the next local weekday and skips elapsed times', () => {
  const schedule = { daysOfWeek: [1, 3], time: '09:30' };
  const mondayMorning = new Date(2026, 6, 13, 8, 0, 0);
  const sameMonday = new Date(ScheduleManager.computeNextRun(schedule, mondayMorning));
  assert.equal(sameMonday.getDay(), 1);
  assert.equal(sameMonday.getHours(), 9);
  assert.equal(sameMonday.getMinutes(), 30);

  const mondayAfternoon = new Date(2026, 6, 13, 10, 0, 0);
  const nextWednesday = new Date(ScheduleManager.computeNextRun(schedule, mondayAfternoon));
  assert.equal(nextWednesday.getDay(), 3);
  assert.equal(nextWednesday.getDate(), 15);
});

test('Excel report contains summary, aggregate, and detailed result sheets', async () => {
  const history = [
    { propertyId: 'P1', propertyName: 'Campanie test', groupId: 'G1', groupName: 'Grup test', day: 1, status: 'posted', views: 120, date: '2026-07-12T10:00:00.000Z' },
    { propertyId: 'P1', propertyName: 'Campanie test', groupId: 'G2', groupName: 'Grup cu eroare', day: 1, status: 'error', reason: 'Composer indisponibil', date: '2026-07-12T10:05:00.000Z' },
  ];
  const buffer = await buildCampaignWorkbook({ history, range: 'all' });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Detalii', 'Campanii', 'Grupuri', 'Sumar']);
  assert.equal(workbook.getWorksheet('Detalii').getCell('G5').value, 'posted');
  assert.equal(workbook.getWorksheet('Campanii').getCell('H5').value.formula, 'IF(C5=0,0,D5/C5)');
  assert.equal(workbook.getWorksheet('Sumar').getCell('G9').value.formula, 'IF(B5=0,0,D5/B5)');
  assert.ok(buffer.byteLength > 5000);
});
