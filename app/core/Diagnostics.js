const { getPostForDay, getEligibleGroups } = require('../utils/campaignPlanner');
const { getActiveCampaignCategory } = require('../utils/campaignCategory');
const { matchesSelectedGroupListCategory } = require('../utils/groupListCategory');

const preflightCatalog = {
  NO_ELIGIBLE_GROUPS_TODAY: {
    title: 'Grupurile eligibile au fost deja parcurse azi',
    explanation: 'Robotul nu mai are unde sa posteze astazi deoarece istoricul curent arata ca grupurile eligibile au fost deja procesate.',
    resolution: 'Asteapta ziua urmatoare, activeaza alte grupuri sau marcheaza explicit taskurile pentru retry din Queue.',
    actionPage: 'queue',
    actionLabel: 'Deschide Queue',
  },
  MISSING_POST: {
    title: 'Lipseste postarea pentru ziua selectata',
    explanation: 'Campania nu are o postare definita pentru ziua curenta din configuratia Queue.',
    resolution: 'Adauga textul si media pentru ziua indicata sau schimba ziua campaniei din Queue.',
    actionPage: 'campaigns',
    actionLabel: 'Deschide Campanii',
  },
  MISSING_TEXT: {
    title: 'Textul postarii este gol',
    explanation: 'Robotul a gasit campania si ziua, dar descrierea care trebuie publicata nu contine text.',
    resolution: 'Completeaza textul postarii pentru ziua indicata si salveaza campania.',
    actionPage: 'campaigns',
    actionLabel: 'Editeaza campania',
  },
  MISSING_MEDIA: {
    title: 'Postarea nu are media',
    explanation: 'Pentru ziua selectata nu este atasata nicio imagine sau inregistrare video.',
    resolution: 'Adauga cel putin o imagine sau un video in postarea campaniei.',
    actionPage: 'campaigns',
    actionLabel: 'Editeaza campania',
  },
  MEDIA_NOT_FOUND: {
    title: 'Fisierul media nu mai exista pe disc',
    explanation: 'Campania contine o referinta spre media, dar fisierul a fost mutat, sters sau nu a fost transferat pe acest PC.',
    resolution: 'Reincarca media din campanie sau restaureaza fisierul lipsa din backup.',
    actionPage: 'media',
    actionLabel: 'Deschide Media',
  },
  INVALID_PROFILE: {
    title: 'Profilul Facebook configurat nu exista',
    explanation: 'Taskul indica un profil de browser care nu se mai gaseste in configuratia Studio.',
    resolution: 'Alege un profil existent din Queue sau recreeaza profilul lipsa in Settings.',
    actionPage: 'settings',
    actionLabel: 'Deschide Settings',
  },
  INVALID_IDENTITY: {
    title: 'Identitatea de postare nu exista',
    explanation: 'Pagina sau identitatea Facebook selectata pentru publicare nu mai exista in configuratie.',
    resolution: 'Alege o identitate existenta la Pagina de postare din Queue.',
    actionPage: 'queue',
    actionLabel: 'Deschide Queue',
  },
  INVALID_GROUP_URL: {
    title: 'URL-ul grupului nu este valid',
    explanation: 'Adresa grupului nu incepe cu http:// sau https:// si nu poate fi deschisa de robot.',
    resolution: 'Corecteaza URL-ul grupului si salveaza lista de grupuri.',
    actionPage: 'groups',
    actionLabel: 'Deschide Grupuri',
  },
  LIVE_MODE: {
    title: 'Publicarea LIVE este activa',
    explanation: 'Acesta este un avertisment de siguranta, nu o defectiune. Pornirea robotului poate publica efectiv pe Facebook.',
    resolution: 'Continua numai daca vrei publicare reala; altfel schimba Publicare pe OFF in Queue.',
    actionPage: 'queue',
    actionLabel: 'Verifica Queue',
  },
};

function categoryItems(category, properties, jobs) {
  return category === 'jobs' ? jobs : properties;
}

function getDefaultProfileIdForCategory(config, category) {
  const profile = (config.facebookProfiles || []).find((item) =>
    getActiveCampaignCategory({ ...config, facebookProfileId: item.id }) === category
  );
  return profile?.id || config.facebookProfileId || 'main';
}

function matchesActiveProfile(item, config, category) {
  const activeProfileId = config.facebookProfileId || 'main';
  const explicitProfileId = item.facebookProfileId || item.postingProfileId || '';
  return explicitProfileId
    ? explicitProfileId === activeProfileId
    : activeProfileId === getDefaultProfileIdForCategory(config, category);
}

function diagnoseEmptyQueue({ config, properties, jobs, groups }) {
  const category = getActiveCampaignCategory(config);
  const items = categoryItems(category, properties, jobs);
  const selectedIds = config.selectedPropertyIds || [];
  const activeItems = items.filter((item) => item.active === true);
  const selectedItems = selectedIds.length
    ? items.filter((item) => selectedIds.includes(item.id))
    : activeItems;
  const matchingProfileItems = activeItems.filter((item) => matchesActiveProfile(item, config, category));
  const selectedMatchingItems = selectedItems.filter(
    (item) => item.active === true && matchesActiveProfile(item, config, category)
  );
  const activeGroups = groups.filter(
    (group) => group.active === true &&
      matchesSelectedGroupListCategory(group, config) &&
      (group.category || 'real_estate') === category
  );
  const campaignDay = Number(config.campaignDay || 1);

  if (selectedIds.length && selectedItems.length === 0) {
    return {
      title: 'Selectia Queue contine campanii care nu mai exista',
      explanation: `Selectia salvata contine ${selectedIds.join(', ')}, dar aceste ID-uri nu mai exista in categoria activa.`,
      resolution: 'Goleste selectia din Queue si selecteaza din nou campaniile existente.',
      actionPage: 'queue',
      actionLabel: 'Corecteaza selectia',
    };
  }

  const inactiveSelected = selectedItems.filter((item) => item.active !== true);
  if (inactiveSelected.length) {
    return {
      title: 'Campania selectata este inactiva',
      explanation: `${inactiveSelected.map((item) => item.name || item.title || item.id).join(', ')} nu poate intra in Queue deoarece este marcata inactiv.`,
      resolution: 'Activeaza campania sau elimina-o din selectia Queue.',
      actionPage: 'campaigns',
      actionLabel: 'Deschide Campanii',
    };
  }

  if (activeItems.length === 0) {
    return {
      title: 'Nu exista campanii active pentru categoria curenta',
      explanation: `Categoria activa este ${category}, dar nicio campanie din aceasta categorie nu este activa.`,
      resolution: 'Activeaza cel putin o campanie sau schimba tipul campaniei din Queue.',
      actionPage: 'campaigns',
      actionLabel: 'Deschide Campanii',
    };
  }

  if (matchingProfileItems.length === 0 || selectedMatchingItems.length === 0) {
    const selectedNames = selectedItems.map((item) => item.name || item.title || item.id).join(', ');
    return {
      title: 'Profilul browser activ nu corespunde campaniei selectate',
      explanation: `Profilul activ este ${config.facebookProfileId || 'main'}, iar campania ${selectedNames || 'selectata'} este asociata altui profil sau profilului implicit al categoriei.`,
      resolution: 'Alege in Queue profilul folosit de campanie sau atribuie explicit profilul activ campaniei.',
      actionPage: 'queue',
      actionLabel: 'Schimba profilul',
    };
  }

  if (activeGroups.length === 0) {
    return {
      title: 'Nu exista grupuri active pentru categoria curenta',
      explanation: `Categoria ${category} nu are niciun grup activ disponibil pentru planificare.`,
      resolution: 'Activeaza cel putin un grup compatibil si salveaza lista.',
      actionPage: 'groups',
      actionLabel: 'Deschide Grupuri',
    };
  }

  const missingDay = selectedMatchingItems.filter((item) => !getPostForDay(item, campaignDay));
  if (missingDay.length) {
    return {
      title: 'Ziua selectata nu este configurata in campanie',
      explanation: `${missingDay.map((item) => item.name || item.title || item.id).join(', ')} nu are postare pentru ziua ${campaignDay}.`,
      resolution: 'Adauga postarea pentru aceasta zi sau schimba Ziua campaniei din Queue.',
      actionPage: 'campaigns',
      actionLabel: 'Editeaza campania',
    };
  }

  const noEligibleGroups = selectedMatchingItems.filter(
    (item) => getEligibleGroups(item, groups, config).length === 0
  );
  if (noEligibleGroups.length) {
    return {
      title: 'Campania nu are grupuri compatibile',
      explanation: 'Exista grupuri active, dar filtrele de categorie sau tip ale campaniei le elimina pe toate.',
      resolution: 'Verifica tipul campaniei si clasificarea grupurilor active.',
      actionPage: 'groups',
      actionLabel: 'Verifica Grupuri',
    };
  }

  const eligibleCount = Math.max(...selectedMatchingItems.map((item) => getEligibleGroups(item, groups, config).length), 0);
  if (Number(config.startFromGroup || 1) > eligibleCount) {
    return {
      title: 'Pozitia de start depaseste numarul de grupuri',
      explanation: `Queue incepe de la grupul ${config.startFromGroup}, dar sunt numai ${eligibleCount} grupuri eligibile.`,
      resolution: 'Seteaza Incepe de la grupul la 1 sau la o valoare care exista.',
      actionPage: 'queue',
      actionLabel: 'Corecteaza Queue',
    };
  }

  return {
    title: 'Queue este gol dupa aplicarea filtrelor',
    explanation: 'Campaniile, profilul, grupurile si optiunile Queue nu produc niciun task eligibil.',
    resolution: 'Verifica selectia de campanii, profilul activ, ziua si filtrele Queue.',
    actionPage: 'queue',
    actionLabel: 'Deschide Queue',
  };
}

function campaignIssueInterpretation(issue, campaign) {
  const context = { campaignId: campaign.id, campaignTitle: campaign.title, category: campaign.category };
  if (issue.includes('inactiva')) {
    return { ...context, code: 'INACTIVE_CAMPAIGN', title: 'Campania este inactiva', explanation: 'Campania este exclusa intentionat din Queue.', resolution: 'Activeaz-o numai daca vrei sa fie rulata.', actionPage: 'campaigns', actionLabel: 'Deschide Campanii' };
  }
  if (issue.includes('Profilul Facebook')) {
    return { ...context, ...preflightCatalog.INVALID_PROFILE, code: 'INVALID_PROFILE' };
  }
  if (issue.includes('fara text')) {
    return { ...context, ...preflightCatalog.MISSING_TEXT, code: 'MISSING_TEXT' };
  }
  if (issue.includes('fara media')) {
    return { ...context, ...preflightCatalog.MISSING_MEDIA, code: 'MISSING_MEDIA' };
  }
  if (issue.includes('Nu are postari')) {
    return { ...context, ...preflightCatalog.MISSING_POST, code: 'MISSING_POST' };
  }
  if (issue.includes('Nu exista grupuri active')) {
    return { ...context, code: 'NO_ACTIVE_GROUPS', title: 'Nu exista grupuri active', explanation: 'Categoria campaniei nu are grupuri active.', resolution: 'Activeaza grupuri compatibile.', actionPage: 'groups', actionLabel: 'Deschide Grupuri' };
  }
  return { ...context, code: 'CAMPAIGN_VALIDATION', title: 'Configuratia campaniei necesita atentie', explanation: issue, resolution: 'Verifica si salveaza din nou campania.', actionPage: 'campaigns', actionLabel: 'Deschide Campanii' };
}

function buildDiagnostics({ preflight, validations, queuePlan, config, properties, jobs, groups }) {
  const issues = [];

  for (const issue of preflight.issues || []) {
    const interpretation = issue.code === 'EMPTY_QUEUE'
      ? diagnoseEmptyQueue({ config, properties, jobs, groups })
      : preflightCatalog[issue.code] || {
          title: 'Eroare preflight necunoscuta',
          explanation: issue.message,
          resolution: 'Reincarca diagnosticul si verifica configuratia indicata in mesaj.',
          actionPage: 'queue',
          actionLabel: 'Deschide Queue',
        };
    issues.push({
      id: `preflight-${issue.code}-${issue.taskId || issue.campaignId || 'global'}`,
      source: 'preflight',
      ...issue,
      ...interpretation,
      originalMessage: issue.message,
    });
  }

  for (const message of validations.globalIssues || []) {
    const identity = message.includes('Identitatea');
    issues.push({
      id: `global-${message}`,
      source: 'validation',
      level: 'error',
      code: identity ? 'INVALID_IDENTITY' : 'INVALID_PROFILE',
      ...(identity ? preflightCatalog.INVALID_IDENTITY : preflightCatalog.INVALID_PROFILE),
      originalMessage: message,
    });
  }

  for (const campaign of validations.campaigns || []) {
    for (const message of campaign.issues || []) {
      const interpreted = campaignIssueInterpretation(message, campaign);
      issues.push({
        id: `campaign-${campaign.id}-${interpreted.code}-${message}`,
        source: 'validation',
        level: campaign.level === 'error' ? 'error' : 'warning',
        originalMessage: message,
        ...interpreted,
      });
    }
  }

  const uniqueIssues = Array.from(new Map(issues.map((issue) => [
    `${issue.code}-${issue.campaignId || ''}-${issue.originalMessage}`,
    issue,
  ])).values());
  const errors = uniqueIssues.filter((issue) => issue.level === 'error').length;
  const warnings = uniqueIssues.filter((issue) => issue.level === 'warning').length;
  const category = getActiveCampaignCategory(config);
  const profile = (config.facebookProfiles || []).find((item) => item.id === config.facebookProfileId);

  return {
    generatedAt: new Date().toISOString(),
    ok: errors === 0,
    status: errors ? 'blocked' : warnings ? 'warning' : 'ready',
    summary: {
      errors,
      warnings,
      activeTasks: queuePlan.summary?.active || 0,
      totalTasks: queuePlan.summary?.total || 0,
    },
    context: {
      mode: config.publishEnabled ? 'live' : 'test',
      campaignDay: Number(config.campaignDay || 1),
      category,
      facebookProfileId: config.facebookProfileId || 'main',
      facebookProfileLabel: profile?.label || config.facebookProfileId || 'main',
      selectedCampaignIds: config.selectedPropertyIds || [],
    },
    issues: uniqueIssues.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1)),
  };
}

module.exports = { buildDiagnostics, diagnoseEmptyQueue };
