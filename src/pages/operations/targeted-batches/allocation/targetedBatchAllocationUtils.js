export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function valueOrNav(value) {
  if (value === null || value === undefined || value === "") return "NAv";
  return value;
}

export function normalizeValue(value) {
  return String(value || "").trim().toUpperCase();
}

export function safeNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

export function getActorMncServiceProviderId(authContext = {}) {
  return firstText(
    authContext?.serviceProvider?.id,
    authContext?.profile?.employment?.serviceProvider?.id,
    authContext?.profile?.profile?.employment?.serviceProvider?.id,
    authContext?.profile?.serviceProvider?.id,
  );
}

export function getRowKey(row = {}, index = 0, batchId = "TB") {
  return firstText(
    row.tbRowId,
    row.uploadRowId,
    row.salesAllMeterId,
    row.sourceSalesAllMeterId,
    row.id,
    row.rowId,
    `${batchId}::ROW::${row.rowNo || index + 1}::${
      row.meterNo || row.meterNoNormalized || "METER"
    }`,
  );
}

export function getTbRowId(row = {}) {
  return firstText(row.tbRowId, row.uploadRowId) || null;
}

export function getRowOutcome(row = {}, sourceType = "") {
  const outcome = normalizeValue(
    row.rowDecision ||
      row.assessmentDecision ||
      row.decision ||
      row.rowOutcome ||
      row.outcome ||
      row.backend?.outcome ||
      row.assessment?.outcome ||
      row.validation?.outcome,
  );

  if (outcome === "ACCEPT" || outcome === "ACCEPTED") return "ACCEPT";
  if (outcome === "REJECT" || outcome === "REJECTED") return "REJECT";
  if (
    ["PREPAID_SALES", "PREPAID_SALES_NON_GPS"].includes(
      normalizeValue(sourceType),
    )
  ) {
    return "ACCEPT";
  }
  return "PENDING";
}

export function getAstMatchStatus(row = {}) {
  return normalizeValue(
    row.astMatchStatus ||
      row.backend?.astMatchStatus ||
      row.backend?.matchedStatus ||
      "NOT_CHECKED",
  );
}

export function getProposedTrnType(row = {}) {
  const explicit = normalizeValue(
    row.proposedTrnType ||
      row.backend?.proposedTrnType ||
      row.assessment?.proposedTrnType,
  );

  if (explicit) return explicit;

  const astMatchStatus = getAstMatchStatus(row);

  if (astMatchStatus === "MATCHED") return "METER_INSPECTION";
  if (astMatchStatus === "NOT_MATCHED") return "METER_DISCOVERY";
  return "PENDING_ASSESSMENT";
}

export function getTrnId(row = {}) {
  return firstText(
    row.trnId,
    row.trn?.id,
    row.createdTrnId,
    row.backend?.trnId,
    row.meterDiscoveryTrnId,
  );
}

export function hasCreatedTrn(row = {}) {
  return Boolean(getTrnId(row));
}

function normalizeTargetType(value) {
  const normalized = normalizeValue(value);
  if (normalized === "SERVICE_PROVIDER") return "SP";
  return normalized;
}

export function getBackendAllocation(row = {}) {
  const allocation =
    row.allocation || row.backend?.allocation || row.assessment?.allocation || {};
  const targetType = normalizeTargetType(
    allocation.targetType ||
      allocation.type ||
      row.allocationTargetType ||
      row.targetType,
  );
  const targetId = firstText(
    allocation.targetId,
    allocation.id,
    row.allocationTargetId,
    row.targetId,
  );
  const targetName = firstText(
    allocation.targetName,
    allocation.name,
    row.allocationTargetName,
    row.targetName,
    targetId,
  );

  if (!["TEAM", "SP"].includes(targetType) || !targetId) return null;

  return {
    type: targetType,
    id: targetId,
    name: targetName || targetId,
    memberCount: safeNumber(allocation.memberCount),
    source: allocation.source || "BACKEND",
    plannedAt: allocation.plannedAt || row.allocationUpdatedAt || null,
  };
}

export function isBackendAllocation(row = {}) {
  const allocation = getBackendAllocation(row);
  return allocation?.source === "BACKEND";
}

export function canAllocateRow(row = {}, sourceType = "") {
  return (
    getRowOutcome(row, sourceType) === "ACCEPT" &&
    !hasCreatedTrn(row) &&
    !isBackendAllocation(row)
  );
}

export function getUserDisplayName(user = {}) {
  return (
    user.displayName ||
    [user.name, user.surname].filter(Boolean).join(" ") ||
    user.email ||
    user.id ||
    "Unknown user"
  );
}

export function getUserRoleLabel(user = {}) {
  const role = valueOrNav(user.role);
  const accountStatus = valueOrNav(user.accountStatus);
  const onboardingStatus = valueOrNav(user.onboardingStatus);
  return `${role} • ${accountStatus} • ${onboardingStatus}`;
}

export function buildUsersById(users = []) {
  const map = new Map();

  asArray(users).forEach((user) => {
    if (!user?.id) return;
    map.set(user.id, user);
    if (user.uid) map.set(user.uid, user);
  });

  return map;
}

function buildUnknownMember(userId) {
  return {
    id: userId,
    uid: userId,
    displayName: `Unknown user ${userId}`,
    role: "NAv",
    accountStatus: "NAv",
    onboardingStatus: "NAv",
    missing: true,
  };
}

export function enrichTeamsWithMembers(teams = [], usersById = new Map()) {
  return asArray(teams).map((team) => {
    const memberUserIds = asArray(team.memberUserIds)
      .map((id) => String(id || "").trim())
      .filter(Boolean);

    const members = memberUserIds.map((userId) => {
      const user = usersById.get(userId) || buildUnknownMember(userId);
      return {
        ...user,
        id: user.id || userId,
        uid: user.uid || userId,
        displayName: getUserDisplayName(user),
      };
    });

    return {
      ...team,
      type: "TEAM",
      members,
      memberCount: members.length,
    };
  });
}

export function enrichServiceProvidersWithMembers(
  serviceProviders = [],
  users = [],
) {
  return asArray(serviceProviders).map((serviceProvider) => {
    const members = asArray(users)
      .filter((user) => user.serviceProviderId === serviceProvider.id)
      .sort((left, right) =>
        getUserDisplayName(left).localeCompare(getUserDisplayName(right)),
      );

    return {
      ...serviceProvider,
      type: "SP",
      members,
      memberCount: members.length,
    };
  });
}

export function getTargetOptionSubtitle(target = {}) {
  if (target.type === "TEAM") {
    return `${target.memberCount || 0} member(s) • ${
      target.serviceProviderCount || 0
    } SP link(s)`;
  }

  const parentText =
    target.parentServiceProviderName &&
    target.parentServiceProviderName !== "NAv"
      ? `SUBC under ${target.parentServiceProviderName}`
      : "SUBC service provider";

  return `${target.memberCount || 0} member(s) • ${parentText}`;
}

export function getTargetOptionMicroText(target = {}) {
  if (target.type === "TEAM") {
    return `Owner: ${target.mncServiceProviderName || "NAv"}`;
  }
  return `SP ID: ${target.id || "NAv"}`;
}

export function buildTargetPayload(target = null) {
  if (!target || typeof target !== "object") return null;

  const type = normalizeTargetType(target.type);
  const id = firstText(target.id);
  const name = firstText(target.name, target.displayName, id);

  if (!["TEAM", "SP"].includes(type) || !id) return null;

  return {
    type,
    id,
    name: name || id,
    memberCount: safeNumber(target.memberCount),
    source: target.source || "FRONTEND_PENDING_BACKEND",
  };
}

export function getTargetLabel(target = {}) {
  if (!target?.type || !target?.id) return "NAv";
  return `${target.type} • ${target.name || target.id}`;
}

export function getExactRowReference(row = {}) {
  const tbRowId = getTbRowId(row);
  return {
    rowKey: row._rowKey || getRowKey(row),
    tbRowId,
    label: tbRowId || "PENDING_BACKEND",
    meterNo: firstText(row.meterNo, row.meterNoNormalized) || "NAv",
    rowNo: firstText(row.rowNo) || "NAv",
    sourceId: firstText(
      row.salesAllMeterId,
      row.sourceSalesAllMeterId,
      row.id,
    ),
  };
}

export function applyQuickFilter(rows, activeFilter, allocationsByRowId) {
  if (activeFilter === "ALL") return rows;

  return rows.filter((row) => {
    const allocation = allocationsByRowId[row._rowKey] || row._backendAllocation;
    const trnType = getProposedTrnType(row);

    if (activeFilter === "UNALLOCATED") return !allocation;
    if (activeFilter === "ALLOCATED") return Boolean(allocation);
    if (activeFilter === "METER_DISCOVERY") {
      return trnType === "METER_DISCOVERY";
    }
    if (activeFilter === "METER_INSPECTION") {
      return trnType === "METER_INSPECTION";
    }
    if (activeFilter === "PENDING_ASSESSMENT") {
      return trnType === "PENDING_ASSESSMENT";
    }
    return true;
  });
}

export function applyAllocationSearch(rows, query) {
  const normalizedQuery = normalizeValue(query);
  if (!normalizedQuery) return rows;

  return rows.filter((row) =>
    [
      row._rowKey,
      getTbRowId(row),
      row.rowNo,
      row.meterNo,
      row.meterNoNormalized,
      row.accountNumber,
      row.accountNo,
      row.customerName,
      row.addressLine1,
      row.premiseAddress,
      row.town,
      row.salesAllMeterId,
      row.sourceSalesAllMeterId,
    ].some((value) => normalizeValue(value).includes(normalizedQuery)),
  );
}

export function getPageBounds({ pageIndex, pageSize, totalRows }) {
  if (totalRows === 0) {
    return {
      pageCount: 1,
      safePageIndex: 0,
      startIndex: 0,
      endIndex: 0,
      displayStart: 0,
      displayEnd: 0,
    };
  }

  const pageCount = Math.max(Math.ceil(totalRows / pageSize), 1);
  const safePageIndex = Math.min(Math.max(pageIndex, 0), pageCount - 1);
  const startIndex = safePageIndex * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalRows);

  return {
    pageCount,
    safePageIndex,
    startIndex,
    endIndex,
    displayStart: startIndex + 1,
    displayEnd: endIndex,
  };
}

export function buildAllocationReviewRows({ rows, allocationsByRowId }) {
  const grouped = new Map();

  asArray(rows).forEach((row) => {
    const target = allocationsByRowId[row._rowKey] || row._backendAllocation;
    if (!target?.id) return;

    const key = `${target.type}_${target.id}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        id: key,
        target,
        discoveryRows: 0,
        inspectionRows: 0,
        pendingAssessmentRows: 0,
        totalRows: 0,
        exactTbRowLinks: 0,
        pendingBackendRowLinks: 0,
        rowReferences: [],
      });
    }

    const item = grouped.get(key);
    const trnType = getProposedTrnType(row);
    const reference = getExactRowReference(row);

    item.totalRows += 1;
    item.rowReferences.push(reference);

    if (reference.tbRowId) item.exactTbRowLinks += 1;
    else item.pendingBackendRowLinks += 1;

    if (trnType === "METER_DISCOVERY") item.discoveryRows += 1;
    else if (trnType === "METER_INSPECTION") item.inspectionRows += 1;
    else item.pendingAssessmentRows += 1;
  });

  return Array.from(grouped.values())
    .map((item) => ({
      ...item,
      status:
        item.pendingBackendRowLinks > 0
          ? "FRONTEND_PLAN"
          : "READY_FOR_BACKEND",
    }))
    .sort((left, right) =>
      getTargetLabel(left.target).localeCompare(getTargetLabel(right.target)),
    );
}
