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
const {
  classifyGroupAvailabilityText,
} = require('../app/facebook/groupAvailability');
const {
  getGroupsPostedOnDate,
  hasPostedInGroupOnDate,
} = require('../app/utils/historyManager');
const DataManager = require('../app/core/DataManager');
const ScheduleManager = require('../app/core/ScheduleManager');
const { buildDiagnostics, diagnoseEmptyQueue } = require('../app/core/Diagnostics');

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

test('queue only treats a property and group as processed on the current local day', () => {
  const now = new Date(2026, 6, 13, 15, 0, 0);
  const yesterdayHistory = [{
    propertyId: 'P1',
    groupId: 'G1',
    day: 2,
    facebookProfileId: 'another-profile',
    status: 'posted',
    date: new Date(2026, 6, 12, 15, 0, 0).toISOString(),
  }];
  const pendingPlan = buildQueuePlan({
    ...fixture({ history: yesterdayHistory }),
    now,
  });
  assert.equal(pendingPlan.tasks[0].status, 'pending');
  assert.equal(pendingPlan.activeTasks.length, 1);

  const todayHistory = [{
    ...yesterdayHistory[0],
    date: new Date(2026, 6, 13, 8, 0, 0).toISOString(),
  }];
  const donePlan = buildQueuePlan({
    ...fixture({ history: todayHistory }),
    now,
  });
  assert.equal(donePlan.tasks[0].status, 'done');
  assert.equal(donePlan.activeTasks.length, 0);

  const retryPlan = buildQueuePlan({
    ...fixture({
      history: todayHistory,
      config: { queueRetryTaskIds: [getTaskId('P1', 'G1', 'main')] },
    }),
    now,
  });
  assert.equal(retryPlan.tasks[0].status, 'retry');
  assert.equal(retryPlan.activeTasks.length, 1);
});

test('paused and unavailable Facebook groups are classified for safe skipping', () => {
  assert.deepEqual(
    classifyGroupAvailabilityText('Administratorii au pus acest grup pe pauză.'),
    { available: false, reason: 'group_paused' }
  );
  assert.deepEqual(
    classifyGroupAvailabilityText('This content isn’t available right now.'),
    { available: false, reason: 'group_unavailable' }
  );
  assert.deepEqual(
    classifyGroupAvailabilityText('Scrie ceva...'),
    { available: true, reason: null }
  );
  assert.deepEqual(
    classifyGroupAvailabilityText('Activitatea din acest grup este temporar suspendată.'),
    { available: false, reason: 'group_paused' }
  );
  assert.deepEqual(
    classifyGroupAvailabilityText('Pagina grupului este încărcată.', {
      fallbackOnMissingComposer: true,
      url: 'https://www.facebook.com/groups/123456',
    }),
    { available: false, reason: 'composer_unavailable' }
  );
  assert.deepEqual(
    classifyGroupAvailabilityText('Log into Facebook', {
      fallbackOnMissingComposer: true,
      url: 'https://www.facebook.com/groups/123456',
    }),
    { available: true, reason: null }
  );
});

test('queue keeps Romanian and international group categories separate', () => {
  const groups = [
    {
      id: 'RO',
      name: 'Chirii Bucuresti',
      url: 'https://www.facebook.com/groups/romania',
      active: true,
      category: 'real_estate',
      groupListCategory: 'Romania',
    },
    {
      id: 'INT',
      name: 'International rentals',
      url: 'https://www.facebook.com/groups/international',
      active: true,
      category: 'real_estate',
      groupListCategory: 'Internationale',
      overrideType: 'rent',
    },
  ];

  const internationalPlan = buildQueuePlan(fixture({
    groups,
    config: { selectedGroupListCategory: 'internationale' },
  }));

  assert.deepEqual(internationalPlan.tasks.map((task) => task.groupId), ['INT']);

  const legacyRomanianPlan = buildQueuePlan(fixture({
    groups: [{ ...groups[0], groupListCategory: undefined }],
    config: { selectedGroupListCategory: 'Romania' },
  }));

  assert.deepEqual(legacyRomanianPlan.tasks.map((task) => task.groupId), ['RO']);
});
test('queue never includes an inactive campaign even when it remains selected', () => {
  const inactive = fixture();
  inactive.properties[0].active = false;

  const plan = buildQueuePlan(inactive);

  assert.equal(plan.tasks.length, 0);
  assert.equal(plan.activeTasks.length, 0);
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

test('scheduled queue skips groups posted today before applying its group limit', () => {
  const now = new Date(2026, 6, 13, 15, 0, 0);
  const groups = [
    { id: 'G1', name: 'Chirie 1', url: 'https://www.facebook.com/groups/one', active: true, category: 'real_estate' },
    { id: 'G2', name: 'Chirie 2', url: 'https://www.facebook.com/groups/two', active: true, category: 'real_estate' },
  ];
  const history = [
    { propertyId: 'OTHER', groupId: 'G1', status: 'posted', date: new Date(2026, 6, 13, 9, 0, 0).toISOString() },
    { propertyId: 'OTHER', groupId: 'G2', status: 'prepared', date: new Date(2026, 6, 13, 10, 0, 0).toISOString() },
  ];

  const plan = buildQueuePlan({ ...fixture({
    groups,
    history,
    config: { groupLimit: 1, skipGroupsPostedToday: true },
  }), now });

  assert.equal(plan.summary.skippedToday, 1);
  assert.equal(plan.activeTasks.length, 1);
  assert.equal(plan.activeTasks[0].groupId, 'G2');
});

test('daily posted-group check uses the server local calendar day', () => {
  const now = new Date(2026, 6, 13, 15, 0, 0);
  const history = [
    { groupId: 'TODAY', status: 'posted', date: new Date(2026, 6, 13, 8, 0, 0).toISOString() },
    { groupId: 'YESTERDAY', status: 'posted', date: new Date(2026, 6, 12, 23, 59, 0).toISOString() },
    { groupId: 'TEST_ONLY', status: 'prepared', date: new Date(2026, 6, 13, 9, 0, 0).toISOString() },
  ];

  assert.deepEqual([...getGroupsPostedOnDate(history, now)], ['TODAY']);
  assert.equal(hasPostedInGroupOnDate(history, 'TODAY', now), true);
  assert.equal(hasPostedInGroupOnDate(history, 'YESTERDAY', now), false);
  assert.equal(hasPostedInGroupOnDate(history, 'TEST_ONLY', now), false);
});

test('preflight reports a daily no-work result when every group was already posted', () => {
  const now = new Date(2026, 6, 13, 15, 0, 0);
  const report = buildPreflightReport({ ...fixture({
    history: [{
      propertyId: 'OTHER',
      groupId: 'G1',
      status: 'posted',
      date: new Date(2026, 6, 13, 8, 0, 0).toISOString(),
    }],
    config: { skipGroupsPostedToday: true },
  }), now });

  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) => issue.code === 'NO_ELIGIBLE_GROUPS_TODAY'));
});

test('empty queue diagnostic explains a browser profile mismatch', () => {
  const data = fixture({
    config: {
      facebookProfileId: 'alternate',
      facebookProfiles: [
        { id: 'main', label: 'Main', category: 'real_estate' },
        { id: 'alternate', label: 'Alternate', category: 'real_estate' },
      ],
    },
  });

  const diagnostic = diagnoseEmptyQueue(data);

  assert.equal(diagnostic.title, 'Profilul browser activ nu corespunde campaniei selectate');
  assert.equal(diagnostic.actionPage, 'queue');
  assert.match(diagnostic.explanation, /alternate/);
});

test('diagnostics interpret preflight errors and preserve the technical message', () => {
  const data = fixture();
  const diagnostics = buildDiagnostics({
    ...data,
    preflight: {
      issues: [
        { code: 'MISSING_MEDIA', level: 'error', message: 'Media lipseste pentru task.' },
        { code: 'LIVE_MODE', level: 'warning', message: 'Mod LIVE activ.' },
      ],
    },
    validations: { globalIssues: [], campaigns: [] },
    queuePlan: { summary: { active: 0, total: 0 } },
  });

  assert.equal(diagnostics.status, 'blocked');
  assert.equal(diagnostics.summary.errors, 1);
  assert.equal(diagnostics.summary.warnings, 1);
  assert.equal(diagnostics.issues[0].title, 'Postarea nu are media');
  assert.equal(diagnostics.issues[0].originalMessage, 'Media lipseste pentru task.');
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

test('deleting a campaign reference updates mixed schedules and removes empty schedules', () => {
  const schedules = [
    { id: 'ONLY_PROPERTY', campaignCategory: 'real_estate', campaignIds: ['P1'] },
    { id: 'MIXED_PROPERTIES', campaignCategory: 'real_estate', campaignIds: ['P1', 'P2'] },
    { id: 'JOB_WITH_SAME_ID', campaignCategory: 'jobs', campaignIds: ['P1'] },
  ];

  const result = DataManager.pruneSchedulesForCampaign(schedules, 'P1', 'real_estate');

  assert.equal(result.removedCount, 1);
  assert.equal(result.updatedCount, 1);
  assert.deepEqual(result.schedules.map((schedule) => schedule.id), [
    'MIXED_PROPERTIES',
    'JOB_WITH_SAME_ID',
  ]);
  assert.deepEqual(result.schedules[0].campaignIds, ['P2']);
  assert.deepEqual(result.schedules[1].campaignIds, ['P1']);
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
