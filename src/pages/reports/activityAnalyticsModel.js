export const ACTIVITY_KEYS = [
  "meterDiscoveryTrns",
  "noAccessTrns",
  "meterInspectionTrns",
  "meterInstallationTrns",
  "meterRemovalTrns",
  "meterDisconnectionTrns",
  "meterReconnectionTrns",
];

export const TEAM_SYNTHETIC_IDS = {
  UNASSIGNED: "__UNASSIGNED__",
  MULTIPLE: "__MULTIPLE__",
};

const TRN_BUCKETS = {
  METER_DISCOVERY: "meterDiscoveryTrns",
  METER_INSTALLATION: "meterInstallationTrns",
  METER_INSPECTION: "meterInspectionTrns",
  METER_REMOVAL: "meterRemovalTrns",
  METER_DISCONNECTION: "meterDisconnectionTrns",
  METER_RECONNECTION: "meterReconnectionTrns",
};

export function normalizeCode(value) {
  if (value === null || value === undefined || value === "") return "NAV";
  return String(value).trim().toUpperCase();
}

export function hasMeaningfulValue(value) {
  const text = String(value || "").trim();
  return Boolean(text && !["NAV", "-"].includes(text.toUpperCase()));
}

export function classifyTrn(trn) {
  const hasAccess = normalizeCode(trn?.hasAccess);
  const trnType = normalizeCode(trn?.trnType);

  if (hasAccess === "NO" || trnType === "NO_ACCESS" || trnType === "NA") {
    return "noAccessTrns";
  }

  return TRN_BUCKETS[trnType] || null;
}

export function calculateTotalTrns(row) {
  return ACTIVITY_KEYS.reduce((sum, key) => sum + Number(row?.[key] || 0), 0);
}

function createEmptyActivityCounts() {
  return ACTIVITY_KEYS.reduce((counts, key) => {
    counts[key] = 0;
    return counts;
  }, {});
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export function resolveDateRange(filter, now = new Date()) {
  const preset = filter?.preset || "ALL_TIME";

  if (preset === "ALL_TIME") {
    return { start: null, end: null, label: "All Time" };
  }

  if (preset === "TODAY") {
    return { start: startOfDay(now), end: now, label: "Today" };
  }

  if (preset === "YESTERDAY") {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return {
      start: startOfDay(yesterday),
      end: endOfDay(yesterday),
      label: "Yesterday",
    };
  }

  if (preset === "THIS_WEEK") {
    const monday = startOfDay(now);
    const day = monday.getDay();
    const daysFromMonday = day === 0 ? 6 : day - 1;
    monday.setDate(monday.getDate() - daysFromMonday);
    return { start: monday, end: now, label: "This Week" };
  }

  if (preset === "LAST_7_DAYS") {
    const start = startOfDay(now);
    start.setDate(start.getDate() - 6);
    return { start, end: now, label: "Last 7 Days" };
  }

  if (preset === "THIS_MONTH") {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
      end: now,
      label: "This Month",
    };
  }

  if (preset === "LAST_MONTH") {
    return {
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0),
      end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999),
      label: "Last Month",
    };
  }

  const start = filter?.customStart ? new Date(filter.customStart) : null;
  const end = filter?.customEnd ? new Date(filter.customEnd) : null;

  return {
    start,
    end,
    label:
      start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())
        ? `${start.toLocaleString()} → ${end.toLocaleString()}`
        : "Custom Range",
  };
}

export function filterTrnsByDate(registryTrns = [], dateFilter = { preset: "ALL_TIME" }, now) {
  const preset = dateFilter?.preset || "ALL_TIME";
  const dateRange = resolveDateRange({ ...dateFilter, preset }, now);
  let missingCreatedAt = 0;

  const rows = registryTrns.filter((trn) => {
    const createdAt = trn?.createdAt ? new Date(trn.createdAt) : null;
    const hasValidCreatedAt = createdAt && !Number.isNaN(createdAt.getTime());

    if (!hasValidCreatedAt) {
      missingCreatedAt += 1;
      return preset === "ALL_TIME";
    }

    if (dateRange.start && createdAt < dateRange.start) return false;
    if (dateRange.end && createdAt > dateRange.end) return false;
    return true;
  });

  return { rows, missingCreatedAt, dateRange };
}

function createUserActivityRow(userUid, userName) {
  return {
    id: userUid,
    userUid,
    userName: hasMeaningfulValue(userName) ? String(userName).trim() : userUid,
    serviceProviderName: "NAv",
    serviceProviderNames: [],
    teamName: "NAv",
    teamNames: [],
    activityTeamId: TEAM_SYNTHETIC_IDS.UNASSIGNED,
    activityTeamName: "Unassigned",
    teamAttributionStatus: "UNASSIGNED",
    ...createEmptyActivityCounts(),
    totalTrns: 0,
    lastUpdatedAt: null,
  };
}

function buildTeamsByUserUid(teams = []) {
  const teamsByUserUid = new Map();

  teams.forEach((team) => {
    const teamId = String(team?.id || "").trim();
    const teamName = String(team?.name || "").trim();
    if (!teamId || !hasMeaningfulValue(teamName)) return;

    const memberUserIds = Array.from(
      new Set((team?.memberUserIds || []).map((value) => String(value || "").trim()).filter(Boolean)),
    );

    memberUserIds.forEach((userUid) => {
      const memberships = teamsByUserUid.get(userUid) || [];
      memberships.push({ id: teamId, name: teamName });
      teamsByUserUid.set(userUid, memberships);
    });
  });

  return teamsByUserUid;
}

function getUniqueMemberships(userUid, teamsByUserUid) {
  const memberships = userUid ? teamsByUserUid.get(userUid) || [] : [];

  return Array.from(
    new Map(
      memberships.map((team) => [
        team.id,
        {
          id: team.id,
          name: team.name,
        },
      ]),
    ).values(),
  ).sort((left, right) => left.name.localeCompare(right.name));
}

function resolveActivityTeam(uniqueMemberships) {
  if (uniqueMemberships.length === 1) {
    return {
      activityTeamId: uniqueMemberships[0].id,
      activityTeamName: uniqueMemberships[0].name,
      teamAttributionStatus: "RESOLVED",
    };
  }

  if (uniqueMemberships.length > 1) {
    return {
      activityTeamId: TEAM_SYNTHETIC_IDS.MULTIPLE,
      activityTeamName: "Multiple",
      teamAttributionStatus: "MULTIPLE",
    };
  }

  return {
    activityTeamId: TEAM_SYNTHETIC_IDS.UNASSIGNED,
    activityTeamName: "Unassigned",
    teamAttributionStatus: "UNASSIGNED",
  };
}

function resolveServiceProvider(user, serviceProviderById) {
  const serviceProviderId = hasMeaningfulValue(user?.serviceProviderId)
    ? String(user.serviceProviderId).trim()
    : "";
  const canonical = serviceProviderId ? serviceProviderById.get(serviceProviderId) : null;
  const name = hasMeaningfulValue(canonical?.name)
    ? String(canonical.name).trim()
    : hasMeaningfulValue(user?.serviceProviderName)
      ? String(user.serviceProviderName).trim()
      : "NAv";

  return {
    id: serviceProviderId,
    name,
  };
}

function addActivity(target, source) {
  ACTIVITY_KEYS.forEach((key) => {
    target[key] += Number(source?.[key] || 0);
  });
  target.totalTrns = calculateTotalTrns(target);
}

function latestTimestamp(currentValue, candidateValue) {
  if (!candidateValue) return currentValue || null;
  const candidate = new Date(candidateValue);
  if (Number.isNaN(candidate.getTime())) return currentValue || null;

  if (!currentValue) return candidateValue;
  const current = new Date(currentValue);
  if (Number.isNaN(current.getTime()) || candidate > current) return candidateValue;
  return currentValue;
}

function createConfiguredTeamRow(team, userByUid, serviceProviderById, missingTeamMemberIds) {
  const memberUserIds = Array.from(
    new Set((team?.memberUserIds || []).map((value) => String(value || "").trim()).filter(Boolean)),
  );
  const serviceProviderNames = new Set();

  memberUserIds.forEach((userUid) => {
    const user = userByUid.get(userUid);
    if (!user) {
      missingTeamMemberIds.add(userUid);
      return;
    }

    const serviceProvider = resolveServiceProvider(user, serviceProviderById);
    if (hasMeaningfulValue(serviceProvider.name)) serviceProviderNames.add(serviceProvider.name);
  });

  const names = Array.from(serviceProviderNames).sort((left, right) => left.localeCompare(right));

  return {
    id: String(team?.id || "").trim(),
    teamId: String(team?.id || "").trim(),
    teamName: hasMeaningfulValue(team?.name) ? String(team.name).trim() : String(team?.id || "NAv"),
    isSynthetic: false,
    teamAttributionStatus: "RESOLVED",
    memberCount: memberUserIds.length,
    memberUserIds,
    serviceProviderNames: names,
    serviceProviderName: names.length ? names.join(", ") : "NAv",
    ...createEmptyActivityCounts(),
    totalTrns: 0,
    lastUpdatedAt: null,
  };
}

function createSyntheticTeamRow(id, name, status) {
  return {
    id,
    teamId: id,
    teamName: name,
    isSynthetic: true,
    teamAttributionStatus: status,
    memberCount: 0,
    memberUserIds: [],
    serviceProviderNames: [],
    serviceProviderName: "NAv",
    ...createEmptyActivityCounts(),
    totalTrns: 0,
    lastUpdatedAt: null,
    _memberUserIds: new Set(),
    _serviceProviderNames: new Set(),
  };
}

function buildReconciliation(userRows, teamRows) {
  const userTotals = buildActivitySummary(userRows);
  const teamTotals = buildActivitySummary(teamRows);
  const byKey = {};

  ACTIVITY_KEYS.forEach((key) => {
    byKey[key] = {
      userTotal: userTotals[key],
      teamTotal: teamTotals[key],
      matches: userTotals[key] === teamTotals[key],
    };
  });

  return {
    userTotalTrns: userTotals.totalTrns,
    teamTotalTrns: teamTotals.totalTrns,
    matches: userTotals.totalTrns === teamTotals.totalTrns &&
      Object.values(byKey).every((entry) => entry.matches),
    byKey,
  };
}

export function buildActivityAnalytics({
  registryTrns = [],
  users = [],
  teams = [],
  serviceProviders = [],
  dateFilter = { preset: "ALL_TIME" },
  now,
} = {}) {
  const dateFilteredResult = filterTrnsByDate(registryTrns, dateFilter, now);
  const serviceProviderById = new Map(
    serviceProviders.map((serviceProvider) => [String(serviceProvider?.id || "").trim(), serviceProvider]),
  );
  const userByUid = new Map();
  users.forEach((user) => {
    const userUid = String(user?.uid || user?.id || "").trim();
    if (userUid) userByUid.set(userUid, user);
  });
  const teamsByUserUid = buildTeamsByUserUid(teams);

  const rowsByUserUid = new Map();
  const unclassifiedTypes = new Map();
  let unclassifiedTrns = 0;
  let missingCreatedByUid = 0;

  dateFilteredResult.rows.forEach((trn) => {
    const bucket = classifyTrn(trn);
    if (!bucket) {
      unclassifiedTrns += 1;
      const type = normalizeCode(trn?.trnType);
      unclassifiedTypes.set(type, (unclassifiedTypes.get(type) || 0) + 1);
      return;
    }

    const userUid = hasMeaningfulValue(trn?.createdByUid)
      ? String(trn.createdByUid).trim()
      : "";

    if (!userUid) {
      missingCreatedByUid += 1;
      return;
    }

    let row = rowsByUserUid.get(userUid);
    if (!row) {
      row = createUserActivityRow(userUid, trn?.createdByUser);
      rowsByUserUid.set(userUid, row);
    } else if (!hasMeaningfulValue(row.userName) && hasMeaningfulValue(trn?.createdByUser)) {
      row.userName = String(trn.createdByUser).trim();
    }

    row[bucket] += 1;
    row.lastUpdatedAt = latestTimestamp(row.lastUpdatedAt, trn?.lastUpdatedAt);
  });

  const userRows = Array.from(rowsByUserUid.values()).map((row) => {
    const uniqueMemberships = getUniqueMemberships(row.userUid, teamsByUserUid);
    const teamNames = uniqueMemberships.map((team) => team.name);
    const user = userByUid.get(row.userUid);
    const serviceProvider = resolveServiceProvider(user, serviceProviderById);
    const serviceProviderNames = hasMeaningfulValue(serviceProvider.name)
      ? [serviceProvider.name]
      : [];

    return {
      ...row,
      teamNames,
      teamName: teamNames.length ? teamNames.join(", ") : "NAv",
      serviceProviderNames,
      serviceProviderName: serviceProvider.name,
      ...resolveActivityTeam(uniqueMemberships),
      totalTrns: calculateTotalTrns(row),
    };
  });

  const missingTeamMemberIds = new Set();
  const teamRowsById = new Map();
  teams.forEach((team) => {
    const teamId = String(team?.id || "").trim();
    if (!teamId || teamRowsById.has(teamId)) return;
    teamRowsById.set(
      teamId,
      createConfiguredTeamRow(team, userByUid, serviceProviderById, missingTeamMemberIds),
    );
  });

  userRows.forEach((userRow) => {
    let teamRow = teamRowsById.get(userRow.activityTeamId);

    if (!teamRow && userRow.teamAttributionStatus === "UNASSIGNED") {
      teamRow = createSyntheticTeamRow(
        TEAM_SYNTHETIC_IDS.UNASSIGNED,
        "Unassigned",
        "UNASSIGNED",
      );
      teamRowsById.set(teamRow.id, teamRow);
    } else if (!teamRow && userRow.teamAttributionStatus === "MULTIPLE") {
      teamRow = createSyntheticTeamRow(
        TEAM_SYNTHETIC_IDS.MULTIPLE,
        "Multiple",
        "MULTIPLE",
      );
      teamRowsById.set(teamRow.id, teamRow);
    }

    if (!teamRow) return;

    addActivity(teamRow, userRow);
    teamRow.lastUpdatedAt = latestTimestamp(teamRow.lastUpdatedAt, userRow.lastUpdatedAt);

    if (teamRow.isSynthetic) {
      teamRow._memberUserIds.add(userRow.userUid);
      (userRow.serviceProviderNames || []).forEach((name) => {
        if (hasMeaningfulValue(name)) teamRow._serviceProviderNames.add(name);
      });
    }
  });

  const teamRows = Array.from(teamRowsById.values())
    .map((row) => {
      if (!row.isSynthetic) return row;

      const serviceProviderNames = Array.from(row._serviceProviderNames).sort((left, right) =>
        left.localeCompare(right),
      );
      const memberUserIds = Array.from(row._memberUserIds).sort((left, right) =>
        left.localeCompare(right),
      );
      const { _memberUserIds, _serviceProviderNames, ...cleanRow } = row;

      return {
        ...cleanRow,
        memberCount: memberUserIds.length,
        memberUserIds,
        serviceProviderNames,
        serviceProviderName: serviceProviderNames.length
          ? serviceProviderNames.join(", ")
          : "NAv",
      };
    })
    .filter((row) => !row.isSynthetic || row.totalTrns > 0)
    .sort((left, right) => {
      if (left.isSynthetic !== right.isSynthetic) return left.isSynthetic ? 1 : -1;
      return left.teamName.localeCompare(right.teamName);
    });

  const reconciliation = buildReconciliation(userRows, teamRows);
  const attributableTotalTrns = reconciliation.userTotalTrns;

  return {
    userRows,
    teamRows,
    dateRange: dateFilteredResult.dateRange,
    summary: buildActivitySummary(userRows),
    integrity: {
      unclassifiedTrns,
      missingCreatedByUid,
      missingCreatedAt: dateFilteredResult.missingCreatedAt,
      unclassifiedTypes: Array.from(unclassifiedTypes.entries()).sort((left, right) =>
        left[0].localeCompare(right[0]),
      ),
      attributableTotalTrns,
      classifiedTotalTrns: attributableTotalTrns + missingCreatedByUid,
      missingTeamMemberIds: Array.from(missingTeamMemberIds).sort(),
      directoryLimitReached: {
        teams: teams.length >= 500,
        users: users.length >= 1000,
        serviceProviders: serviceProviders.length >= 500,
      },
      reconciliation,
    },
  };
}

export function buildActivitySummary(rows = []) {
  const totals = {
    totalTrns: 0,
    ...createEmptyActivityCounts(),
  };

  rows.forEach((row) => {
    ACTIVITY_KEYS.forEach((key) => {
      totals[key] += Number(row?.[key] || 0);
    });
  });

  totals.totalTrns = ACTIVITY_KEYS.reduce((sum, key) => sum + totals[key], 0);
  return totals;
}

export function filterDashboardUserRows(rows = [], filters = {}) {
  return rows.filter((row) => {
    if (Number(row?.totalTrns || 0) <= 0) return false;

    if (
      filters.serviceProvider &&
      String(row?.serviceProviderName || "") !== filters.serviceProvider
    ) {
      return false;
    }

    if (filters.team && String(row?.activityTeamName || "") !== filters.team) {
      return false;
    }

    return true;
  });
}

export function buildDashboardActivityModel(rows = [], trnTypes = []) {
  const filteredRows = rows
    .map((row) => ({ ...row, activityTotal: calculateTotalTrns(row) }))
    .filter((row) => row.activityTotal > 0);
  const totalActivity = filteredRows.reduce((sum, row) => sum + row.activityTotal, 0);
  const serviceProviders = new Set();
  const representedTeams = new Set();

  filteredRows.forEach((row) => {
    if (hasMeaningfulValue(row?.serviceProviderName)) {
      serviceProviders.add(row.serviceProviderName);
    }
    if (row?.teamAttributionStatus === "RESOLVED" && row?.activityTeamId) {
      representedTeams.add(row.activityTeamId);
    }
  });

  const users = [...filteredRows].sort(
    (left, right) =>
      right.activityTotal - left.activityTotal ||
      String(left?.userName || "").localeCompare(String(right?.userName || "")),
  );

  const teamMap = new Map();
  filteredRows.forEach((row) => {
    const teamId = row?.activityTeamId || TEAM_SYNTHETIC_IDS.UNASSIGNED;
    const teamName = row?.activityTeamName || "Unassigned";
    const current = teamMap.get(teamId) || {
      id: teamId,
      name: teamName,
      teamAttributionStatus: row?.teamAttributionStatus || "UNASSIGNED",
      discovery: 0,
      inspection: 0,
      other: 0,
      total: 0,
    };

    current.discovery += Number(row?.meterDiscoveryTrns || 0);
    current.inspection += Number(row?.meterInspectionTrns || 0);
    current.other +=
      Number(row?.noAccessTrns || 0) +
      Number(row?.meterInstallationTrns || 0) +
      Number(row?.meterRemovalTrns || 0) +
      Number(row?.meterDisconnectionTrns || 0) +
      Number(row?.meterReconnectionTrns || 0);
    current.total += row.activityTotal;
    teamMap.set(teamId, current);
  });

  const teamActivity = Array.from(teamMap.values()).sort(
    (left, right) => right.total - left.total || left.name.localeCompare(right.name),
  );

  const typeTotals = trnTypes.map((type) => ({
    ...type,
    count: filteredRows.reduce((sum, row) => sum + Number(row?.[type.key] || 0), 0),
  }));

  const latestRow = [...filteredRows]
    .filter((row) => row?.lastUpdatedAt && String(row.lastUpdatedAt).toUpperCase() !== "NAV")
    .sort((left, right) => {
      const leftTime = new Date(left.lastUpdatedAt).getTime() || 0;
      const rightTime = new Date(right.lastUpdatedAt).getTime() || 0;
      return rightTime - leftTime;
    })[0];

  const topUser = users[0] || null;
  const topTeam = teamActivity.find((team) => team.teamAttributionStatus === "RESOLVED") || null;
  const topType = [...typeTotals].sort((left, right) => right.count - left.count)[0] || null;

  return {
    rows: filteredRows,
    totalActivity,
    activeUsers: filteredRows.length,
    serviceProviderCount: serviceProviders.size,
    teamCount: representedTeams.size,
    users,
    teamActivity,
    typeTotals,
    latestRow,
    topUser,
    topTeam,
    topType,
  };
}
