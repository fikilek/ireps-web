const SALES_SOURCE_TYPES = new Set([
  "PREPAID_SALES",
  "PREPAID_SALES_NON_GPS",
]);

export const CANONICAL_TARGETED_BATCH_STATES = Object.freeze({
  draft: "DRAFT",
  created: "CREATED",
  allocated: "ALLOCATED",
  accepted: "ACCEPTED",
  rejected: "REJECTED",
  completed: "COMPLETED",
});

function cleanText(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return cleanText(value).toUpperCase();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function nonNegativeInteger(value, fallback = 0) {
  return Math.max(0, Math.floor(finiteNumber(value, fallback)));
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((finiteNumber(value) + Number.EPSILON) * factor) / factor;
}

function percentage(numerator, denominator) {
  if (denominator <= 0) return 0;
  return round((numerator / denominator) * 100, 1);
}

function normalizeTargetType(value) {
  const normalized = upper(value);
  if (normalized === "SERVICE_PROVIDER") return "SP";
  return normalized === "TEAM" || normalized === "SP" ? normalized : "";
}

function getTargetFromAllocation(allocation = {}) {
  const target = allocation?.target || {};
  const type = normalizeTargetType(allocation?.targetType || target?.type);
  const id = cleanText(allocation?.targetId || target?.id);
  const name = cleanText(
    allocation?.targetName || target?.name || target?.label || id,
  );

  if (!type || !id) return null;
  return { type, id, name: name || id };
}

function targetKey(type, id) {
  const normalizedType = normalizeTargetType(type);
  const normalizedId = cleanText(id);
  return normalizedType && normalizedId
    ? `${normalizedType}:${normalizedId}`
    : "";
}

function timestampToMillis(value) {
  if (!value) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (typeof value?.seconds === "number") {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  }
  return 0;
}

export function isSupportedSalesTargetedBatch(batch = {}) {
  return SALES_SOURCE_TYPES.has(upper(batch?.source?.type || batch?.sourceType));
}

export function getCanonicalBatchState(batch = {}) {
  const parentStatus = upper(batch?.status);
  const creationStatus = upper(batch?.creation?.state);
  const allocationStatus = upper(batch?.allocation?.status);
  const acceptanceStatus = upper(batch?.acceptance?.status);
  const executionStatus = upper(batch?.execution?.status);

  if (executionStatus === "COMPLETED" || parentStatus === "COMPLETED") {
    return CANONICAL_TARGETED_BATCH_STATES.completed;
  }

  if (acceptanceStatus === "REJECTED" || parentStatus === "REJECTED") {
    return CANONICAL_TARGETED_BATCH_STATES.rejected;
  }

  if (acceptanceStatus === "ACCEPTED" || parentStatus === "ACCEPTED") {
    return CANONICAL_TARGETED_BATCH_STATES.accepted;
  }

  if (allocationStatus === "ALLOCATED" || parentStatus === "ALLOCATED") {
    return CANONICAL_TARGETED_BATCH_STATES.allocated;
  }

  if (
    creationStatus === "READY" ||
    parentStatus === "CREATED" ||
    parentStatus === "READY_FOR_ALLOCATION" ||
    allocationStatus === "ALLOCATING" ||
    allocationStatus === "ALLOCATION_FAILED"
  ) {
    return CANONICAL_TARGETED_BATCH_STATES.created;
  }

  return CANONICAL_TARGETED_BATCH_STATES.draft;
}

function getBatchId(batch = {}) {
  return cleanText(batch?.id || batch?.tbId);
}

function getRowBatchId(row = {}) {
  return cleanText(row?.tbId || row?.targetedBatchId || row?.refs?.tbId);
}

function rowExecutionStatus(row = {}) {
  return upper(row?.execution?.status || "NOT_STARTED");
}

function getBatchTotalRows(batch = {}) {
  return nonNegativeInteger(
    batch?.counts?.totalRows,
    nonNegativeInteger(batch?.creation?.expectedRows, 0),
  );
}

function getBatchCompletedRows(batch = {}) {
  return nonNegativeInteger(batch?.counts?.completedRows, 0);
}

function getBatchStartedRows(batch = {}) {
  return nonNegativeInteger(
    batch?.counts?.executionStartedRows,
    nonNegativeInteger(batch?.counts?.inProgressRows, 0) +
      getBatchCompletedRows(batch),
  );
}

function getBatchAllocatedRows(batch = {}) {
  return nonNegativeInteger(batch?.counts?.allocatedRows, 0);
}

function getBatchUnallocatedRows(batch = {}) {
  const total = getBatchTotalRows(batch);
  const allocated = getBatchAllocatedRows(batch);
  const rawValue = batch?.counts?.unallocatedRows;
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return Math.max(total - allocated, 0);
  }
  return nonNegativeInteger(rawValue, Math.max(total - allocated, 0));
}

export function getBatchAllocationIntegrity(batch = {}) {
  const state = getCanonicalBatchState(batch);
  const target = getTargetFromAllocation(batch?.allocation);
  const totalRows = getBatchTotalRows(batch);
  const allocatedRows = getBatchAllocatedRows(batch);
  const unallocatedRows = getBatchUnallocatedRows(batch);
  const completedRows = getBatchCompletedRows(batch);
  const startedRows = getBatchStartedRows(batch);
  const issues = [];
  const creationStatus = upper(batch?.creation?.state);
  const allocationStatus = upper(batch?.allocation?.status);
  const acceptanceStatus = upper(batch?.acceptance?.status);
  const executionStatus = upper(batch?.execution?.status);

  const successfulAllocationStates = new Set([
    CANONICAL_TARGETED_BATCH_STATES.allocated,
    CANONICAL_TARGETED_BATCH_STATES.accepted,
    CANONICAL_TARGETED_BATCH_STATES.rejected,
    CANONICAL_TARGETED_BATCH_STATES.completed,
  ]);

  if (!successfulAllocationStates.has(state)) {
    return {
      ok: true,
      countsTowardAllocation: false,
      issues,
      state,
      target,
      totalRows,
      allocatedRows,
      unallocatedRows,
      completedRows,
      startedRows,
    };
  }

  if (creationStatus && creationStatus !== "READY") {
    issues.push("SUCCESSFUL_STATE_WITHOUT_READY_CREATION");
  }
  if (allocationStatus !== "ALLOCATED") {
    issues.push("SUCCESSFUL_STATE_WITHOUT_ALLOCATED_STATUS");
  }
  if (
    ["ACCEPTED", "REJECTED"].includes(acceptanceStatus) &&
    allocationStatus !== "ALLOCATED"
  ) {
    issues.push("ACCEPTANCE_WITHOUT_ALLOCATION");
  }
  if (
    ["IN_PROGRESS", "COMPLETED"].includes(executionStatus) &&
    acceptanceStatus !== "ACCEPTED"
  ) {
    issues.push("EXECUTION_WITHOUT_ACCEPTANCE");
  }
  if (!target) issues.push("ALLOCATION_TARGET_MISSING");
  if (totalRows < 1) issues.push("TOTAL_ROWS_MISSING");
  if (allocatedRows !== totalRows) issues.push("ALLOCATED_ROW_COUNT_MISMATCH");
  if (unallocatedRows !== 0) issues.push("UNALLOCATED_ROWS_REMAIN");
  if (completedRows > totalRows) issues.push("COMPLETED_ROW_COUNT_INVALID");
  if (startedRows > totalRows) issues.push("STARTED_ROW_COUNT_INVALID");
  if (
    state === CANONICAL_TARGETED_BATCH_STATES.completed &&
    completedRows !== totalRows
  ) {
    issues.push("COMPLETED_PARENT_ROW_COUNT_MISMATCH");
  }

  return {
    ok: issues.length === 0,
    countsTowardAllocation: issues.length === 0,
    issues,
    state,
    target,
    totalRows,
    allocatedRows,
    unallocatedRows,
    completedRows,
    startedRows,
  };
}

export function getPendingAllocationProjectionMeters({
  batch,
  rows = [],
  rowsReady = true,
} = {}) {
  if (!batch || !rowsReady) return 0;
  if (!isSupportedSalesTargetedBatch(batch)) return 0;
  if (upper(batch?.creation?.state) !== "READY") return 0;
  if (getCanonicalBatchState(batch) !== CANONICAL_TARGETED_BATCH_STATES.created) {
    return 0;
  }

  const allocationStatus = upper(batch?.allocation?.status);
  if (allocationStatus === "ALLOCATED") return 0;

  const expectedRows = getBatchTotalRows(batch);
  if (!Array.isArray(rows)) return 0;
  const physicalRows = rows;
  const actualRows = physicalRows.length;
  if (expectedRows < 1 || actualRows !== expectedRows) return 0;

  const batchId = getBatchId(batch);
  const hasStaleAllocatedOrExecutingRow = physicalRows.some((row) => {
    if (batchId && getRowBatchId(row) !== batchId) return true;

    const rowAllocationStatus = upper(row?.allocation?.status);
    const rowTarget = getTargetFromAllocation(row?.allocation);
    const executionStatus = rowExecutionStatus(row);
    const executionStarted =
      !["", "NOT_STARTED", "PENDING"].includes(executionStatus) ||
      Boolean(row?.execution?.startedAt || row?.execution?.completedAt);

    return (
      rowAllocationStatus === "ALLOCATED" ||
      Boolean(rowTarget) ||
      executionStarted
    );
  });

  if (hasStaleAllocatedOrExecutingRow) return 0;

  return expectedRows;
}

function makeOrganisationSeed(target = {}, fallbackType = "") {
  const type = normalizeTargetType(target?.type || fallbackType);
  const id = cleanText(target?.id || target?.targetId);
  if (!type || !id) return null;

  return {
    key: targetKey(type, id),
    type,
    id,
    name: cleanText(target?.name || target?.label || id) || id,
    memberCount: finiteNumber(
      target?.memberCount,
      safeArray(target?.members).length,
    ),
    eligible: target?.eligible !== false,
  };
}

function getActiveAllocationRowIntegrity({ batch, rows = [], target } = {}) {
  const state = getCanonicalBatchState(batch);
  if (state === CANONICAL_TARGETED_BATCH_STATES.completed) {
    return { ok: true, issues: [] };
  }

  const expectedRows = getBatchTotalRows(batch);
  const batchId = getBatchId(batch);
  const issues = [];

  if (rows.length !== expectedRows) {
    issues.push("PHYSICAL_ROW_COUNT_MISMATCH");
  }

  for (const row of rows) {
    if (getRowBatchId(row) !== batchId) {
      issues.push("PHYSICAL_ROW_BATCH_MISMATCH");
      continue;
    }

    if (upper(row?.allocation?.status) !== "ALLOCATED") {
      issues.push("PHYSICAL_ROW_NOT_ALLOCATED");
      continue;
    }

    const rowTarget = getTargetFromAllocation(row?.allocation);
    if (
      !rowTarget ||
      rowTarget.type !== target?.type ||
      rowTarget.id !== target?.id
    ) {
      issues.push("PHYSICAL_ROW_TARGET_MISMATCH");
    }
  }

  return {
    ok: issues.length === 0,
    issues: Array.from(new Set(issues)),
  };
}

function emptyOrganisationMetrics(seed) {
  return {
    ...seed,
    batches: 0,
    assignedMeters: 0,
    completedMeters: 0,
    inProgressMeters: 0,
    remainingMeters: 0,
    rejectedUnresolvedMeters: 0,
    awaitingAcceptanceBatches: 0,
    acceptedBatches: 0,
    rejectedBatches: 0,
    completedBatches: 0,
    integrityIssueBatches: 0,
    progressPct: 0,
    projectSharePct: 0,
    typeSharePct: 0,
    typeAverageAssigned: 0,
    varianceFromTypeAverage: null,
    lastActivityAtMs: 0,
  };
}

export function buildOrganisationAllocationMatrixResult({
  batches = [],
  rows = [],
  teams = [],
  serviceProviders = [],
} = {}) {
  const organisations = new Map();
  const rowsByBatch = new Map();
  const integrityIssues = [];

  for (const row of safeArray(rows)) {
    const batchId = getRowBatchId(row);
    if (!batchId) continue;
    if (!rowsByBatch.has(batchId)) rowsByBatch.set(batchId, []);
    rowsByBatch.get(batchId).push(row);
  }

  for (const target of safeArray(teams)) {
    const seed = makeOrganisationSeed({ ...target, eligible: true }, "TEAM");
    if (seed) organisations.set(seed.key, emptyOrganisationMetrics(seed));
  }

  for (const target of safeArray(serviceProviders)) {
    const seed = makeOrganisationSeed({ ...target, eligible: true }, "SP");
    if (seed) organisations.set(seed.key, emptyOrganisationMetrics(seed));
  }

  const supportedBatches = safeArray(batches).filter(isSupportedSalesTargetedBatch);

  for (const batch of supportedBatches) {
    const integrity = getBatchAllocationIntegrity(batch);
    const target = integrity.target;
    const batchId = getBatchId(batch) || "UNKNOWN_BATCH";

    if (!target) {
      if (integrity.issues.length > 0) {
        integrityIssues.push({
          batchId,
          issues: [...integrity.issues],
          target: null,
        });
      }
      continue;
    }

    const key = targetKey(target.type, target.id);
    if (!organisations.has(key)) {
      organisations.set(
        key,
        emptyOrganisationMetrics({
          key,
          type: target.type,
          id: target.id,
          name: target.name || target.id,
          memberCount: finiteNumber(batch?.allocation?.memberCount, 0),
          eligible: false,
        }),
      );
    }

    const metric = organisations.get(key);
    metric.lastActivityAtMs = Math.max(
      metric.lastActivityAtMs,
      timestampToMillis(
        batch?.metadata?.updatedAt ||
          batch?.execution?.completedAt ||
          batch?.acceptance?.acceptedAt ||
          batch?.acceptance?.rejectedAt ||
          batch?.allocation?.completedAt,
      ),
    );

    if (!integrity.countsTowardAllocation) {
      if (integrity.issues.length > 0) {
        metric.integrityIssueBatches += 1;
        integrityIssues.push({
          batchId,
          issues: [...integrity.issues],
          target: { type: target.type, id: target.id, name: target.name },
        });
      }
      continue;
    }

    const physicalIntegrity = getActiveAllocationRowIntegrity({
      batch,
      rows: rowsByBatch.get(getBatchId(batch)) || [],
      target,
    });
    if (!physicalIntegrity.ok) {
      metric.integrityIssueBatches += 1;
      integrityIssues.push({
        batchId,
        issues: [...physicalIntegrity.issues],
        target: { type: target.type, id: target.id, name: target.name },
      });
      continue;
    }

    const state = integrity.state;
    const totalRows = integrity.totalRows;
    const completedRows = Math.min(integrity.completedRows, totalRows);
    const startedRows = Math.min(integrity.startedRows, totalRows);
    const unfinishedRows = Math.max(totalRows - completedRows, 0);

    metric.batches += 1;
    metric.assignedMeters += totalRows;
    metric.completedMeters += completedRows;
    metric.inProgressMeters += Math.max(startedRows - completedRows, 0);

    if (state === CANONICAL_TARGETED_BATCH_STATES.allocated) {
      metric.awaitingAcceptanceBatches += 1;
      metric.remainingMeters += unfinishedRows;
    }
    if (state === CANONICAL_TARGETED_BATCH_STATES.accepted) {
      metric.acceptedBatches += 1;
      metric.remainingMeters += unfinishedRows;
    }
    if (state === CANONICAL_TARGETED_BATCH_STATES.rejected) {
      metric.rejectedBatches += 1;
      metric.rejectedUnresolvedMeters += unfinishedRows;
    }
    if (state === CANONICAL_TARGETED_BATCH_STATES.completed) {
      metric.completedBatches += 1;
    }
  }

  const result = Array.from(organisations.values());
  const projectAssigned = result.reduce(
    (sum, metric) => sum + metric.assignedMeters,
    0,
  );

  const typeStats = new Map();
  for (const type of ["TEAM", "SP"]) {
    const eligibleSameType = result.filter(
      (metric) => metric.type === type && metric.eligible,
    );
    const assigned = eligibleSameType.reduce(
      (sum, metric) => sum + metric.assignedMeters,
      0,
    );
    typeStats.set(type, {
      count: eligibleSameType.length,
      assigned,
      average:
        eligibleSameType.length > 0 ? assigned / eligibleSameType.length : 0,
    });
  }

  for (const metric of result) {
    metric.progressPct = percentage(
      metric.completedMeters,
      metric.assignedMeters,
    );
    metric.projectSharePct = percentage(metric.assignedMeters, projectAssigned);

    const sameType = typeStats.get(metric.type) || {
      assigned: 0,
      average: 0,
    };
    metric.typeSharePct = metric.eligible
      ? percentage(metric.assignedMeters, sameType.assigned)
      : 0;
    metric.typeAverageAssigned = round(sameType.average, 1);
    metric.varianceFromTypeAverage = metric.eligible
      ? round(metric.assignedMeters - sameType.average, 1)
      : null;
  }

  const sortedOrganisations = result.sort((left, right) => {
    if (left.type !== right.type) return left.type.localeCompare(right.type);
    if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
    return left.name.localeCompare(right.name);
  });

  return {
    organisations: sortedOrganisations,
    integrityIssues,
  };
}

export function buildOrganisationAllocationMatrix(options = {}) {
  return buildOrganisationAllocationMatrixResult(options).organisations;
}

export function projectOrganisationAllocation({
  organisation,
  allOrganisations = [],
  incomingMeters = 0,
} = {}) {
  if (!organisation || organisation?.eligible === false) return null;

  const incoming = Math.max(0, Math.floor(finiteNumber(incomingMeters, 0)));
  if (incoming <= 0) return null;

  const sameType = safeArray(allOrganisations).filter(
    (candidate) =>
      candidate?.type === organisation.type && candidate?.eligible !== false,
  );
  if (sameType.length < 1) return null;

  const currentTypeAssigned = sameType.reduce(
    (sum, candidate) => sum + finiteNumber(candidate?.assignedMeters, 0),
    0,
  );
  const currentProjectAssigned = safeArray(allOrganisations).reduce(
    (sum, candidate) => sum + finiteNumber(candidate?.assignedMeters, 0),
    0,
  );
  const projectedTypeAssigned = currentTypeAssigned + incoming;
  const projectedProjectAssigned = currentProjectAssigned + incoming;
  const projectedAverage = projectedTypeAssigned / sameType.length;
  const projectedAssigned = finiteNumber(organisation.assignedMeters, 0) + incoming;
  const projectedRemaining =
    finiteNumber(organisation.remainingMeters, 0) + incoming;

  return {
    incomingMeters: incoming,
    projectedAssigned,
    projectedRemaining,
    projectedTypeAverageAssigned: round(projectedAverage, 1),
    projectedVarianceFromTypeAverage: round(
      projectedAssigned - projectedAverage,
      1,
    ),
    projectedProjectSharePct: percentage(
      projectedAssigned,
      projectedProjectAssigned,
    ),
    projectedTypeSharePct: percentage(projectedAssigned, projectedTypeAssigned),
  };
}

function userDisplayName(user = {}, fallback = "NAv") {
  const profile = user?.profile || {};
  const joined = [profile?.name, profile?.surname]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");

  return (
    cleanText(user?.displayName) ||
    cleanText(profile?.displayName) ||
    joined ||
    cleanText(user?.name) ||
    cleanText(user?.email) ||
    cleanText(profile?.email) ||
    fallback
  );
}

function userRole(user = {}) {
  return upper(
    user?.employment?.role ||
      user?.profile?.employment?.role ||
      user?.role ||
      "NAv",
  );
}

function serviceProviderNameForUser(user = {}) {
  return cleanText(
    user?.serviceProviderName ||
      user?.employment?.serviceProviderName ||
      user?.employment?.serviceProvider?.name ||
      user?.profile?.serviceProviderName ||
      user?.profile?.employment?.serviceProviderName ||
      user?.profile?.employment?.serviceProvider?.name,
  );
}

function buildUserSeed(user = {}) {
  const id = cleanText(user?.id || user?.uid);
  if (!id) return null;
  return {
    id,
    name: userDisplayName(user, id),
    role: userRole(user),
    serviceProvider: serviceProviderNameForUser(user) || "NAv",
    teams: [],
    acceptedBatches: 0,
    inProgressRows: 0,
    completedRows: 0,
    attributedRows: 0,
    progressPct: 0,
    lastActivityAtMs: 0,
  };
}

function getExecutionActor(row = {}) {
  const status = rowExecutionStatus(row);
  if (status !== "IN_PROGRESS" && status !== "COMPLETED") return null;

  const uid = cleanText(
    row?.execution?.updatedByUid ||
      row?.execution?.actorUid ||
      row?.execution?.completedByUid ||
      row?.metadata?.updatedByUid,
  );
  const name = cleanText(
    row?.execution?.updatedByUser ||
      row?.execution?.actorName ||
      row?.execution?.completedByUser ||
      row?.metadata?.updatedByUser,
  );

  if (!uid) return null;
  return { uid, name, status };
}

export function buildUserExecutionMatrix({
  users = [],
  teams = [],
  batches = [],
  rows = [],
} = {}) {
  const metrics = new Map();

  for (const user of safeArray(users)) {
    const seed = buildUserSeed(user);
    if (seed) metrics.set(seed.id, seed);
  }

  for (const team of safeArray(teams)) {
    const teamName = cleanText(team?.name || team?.label || team?.id) || "NAv";
    for (const member of safeArray(team?.members)) {
      const uid = cleanText(member?.id || member?.uid);
      if (!uid) continue;
      if (!metrics.has(uid)) {
        const seed = buildUserSeed(member);
        if (seed) metrics.set(uid, seed);
      }
      const metric = metrics.get(uid);
      if (metric && !metric.teams.includes(teamName)) metric.teams.push(teamName);
    }
  }

  const supportedBatches = safeArray(batches).filter(
    isSupportedSalesTargetedBatch,
  );
  const supportedBatchIds = new Set(
    supportedBatches.map(getBatchId).filter(Boolean),
  );

  for (const batch of supportedBatches) {
    const uid = cleanText(batch?.acceptance?.acceptedByUid);
    if (!uid) continue;
    if (!metrics.has(uid)) {
      metrics.set(uid, {
        id: uid,
        name: cleanText(batch?.acceptance?.acceptedByUser) || uid,
        role: "NAv",
        serviceProvider: "NAv",
        teams: [],
        acceptedBatches: 0,
        inProgressRows: 0,
        completedRows: 0,
        attributedRows: 0,
        progressPct: 0,
        lastActivityAtMs: 0,
      });
    }
    const metric = metrics.get(uid);
    metric.acceptedBatches += 1;
    metric.lastActivityAtMs = Math.max(
      metric.lastActivityAtMs,
      timestampToMillis(batch?.acceptance?.acceptedAt),
    );
  }

  for (const row of safeArray(rows)) {
    if (!supportedBatchIds.has(getRowBatchId(row))) continue;
    const actor = getExecutionActor(row);
    if (!actor) continue;

    if (!metrics.has(actor.uid)) {
      metrics.set(actor.uid, {
        id: actor.uid,
        name: actor.name || actor.uid,
        role: "NAv",
        serviceProvider: "NAv",
        teams: [],
        acceptedBatches: 0,
        inProgressRows: 0,
        completedRows: 0,
        attributedRows: 0,
        progressPct: 0,
        lastActivityAtMs: 0,
      });
    }

    const metric = metrics.get(actor.uid);
    metric.attributedRows += 1;
    if (actor.status === "IN_PROGRESS") metric.inProgressRows += 1;
    if (actor.status === "COMPLETED") metric.completedRows += 1;
    metric.lastActivityAtMs = Math.max(
      metric.lastActivityAtMs,
      timestampToMillis(row?.metadata?.updatedAt || row?.execution?.completedAt),
    );
  }

  return Array.from(metrics.values())
    .map((metric) => ({
      ...metric,
      teams: [...metric.teams].sort((a, b) => a.localeCompare(b)),
      progressPct: percentage(metric.completedRows, metric.attributedRows),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}
