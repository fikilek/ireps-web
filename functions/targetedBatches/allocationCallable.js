import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

import {
  TARGETED_BATCH_COLLECTIONS,
  TARGETED_BATCH_CREATION_STATES,
  TARGETED_BATCH_PLANNING_MODES,
  buildFailureResult,
  buildSuccessResult,
  chunkArray,
  getActorNameFromRequest,
  normalizeText,
  normalizeUpper,
  resolveTargetedBatchCreateAuthority,
  safeArray,
} from "./helpers.js";

const TB_ID_PATTERN = /^TGB_[0-9]{8}_[0-9]{6}_[A-Z0-9]{4}$/;
const ALLOCATION_TARGET_TYPES = Object.freeze(["TEAM", "SP"]);
const ALLOCATION_WRITE_CHUNK = 400;

function controlledError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function getErrorCode(error) {
  return String(error?.code || "").trim() || "TARGETED_BATCH_ALLOCATION_FAILED";
}

function getErrorMessage(error) {
  return (
    String(error?.message || "").trim() ||
    "Targeted Batch allocation failed"
  );
}

function readFirstText(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }

  return "";
}

function getActorMncServiceProviderId({ request, profile = {} }) {
  const token = request?.auth?.token || {};

  return readFirstText(
    token?.serviceProviderId,
    token?.employmentServiceProviderId,
    token?.mncServiceProviderId,
    profile?.profile?.employment?.serviceProvider?.id,
    profile?.employment?.serviceProvider?.id,
    profile?.serviceProvider?.id,
  );
}

function getTargetedBatchId(data = {}) {
  return normalizeUpper(data?.tbId || data?.id || data?.targetedBatchId);
}

function getTargetType(data = {}) {
  return normalizeUpper(data?.targetType || data?.target?.type);
}

function getTargetId(data = {}) {
  return normalizeText(data?.targetId || data?.target?.id);
}

function getTeamStatus(data = {}) {
  return normalizeUpper(data?.team?.status || data?.status);
}

function getTeamName(data = {}, fallbackId = "") {
  return readFirstText(data?.team?.name, data?.name, fallbackId);
}

function getServiceProviderStatus(data = {}) {
  return normalizeUpper(data?.status || data?.lifecycleStatus);
}

function getServiceProviderName(data = {}, fallbackId = "") {
  return readFirstText(
    data?.profile?.tradingName,
    data?.profile?.registeredName,
    data?.name,
    fallbackId,
  );
}

function findSubcontractorMncClient(data = {}, actorMncId) {
  return safeArray(data?.clients).find((client) => {
    const clientType = normalizeUpper(client?.clientType);
    const relationshipType = normalizeUpper(client?.relationshipType);
    const clientId = normalizeText(client?.id);

    return (
      clientType === "SP" &&
      relationshipType === "SUBC" &&
      clientId === actorMncId
    );
  });
}

async function resolveAllocationTarget({
  db,
  targetType,
  targetId,
  actorMncId,
}) {
  if (targetType === "TEAM") {
    const snapshot = await db.collection("teams").doc(targetId).get();

    if (!snapshot.exists) {
      throw controlledError(
        "ALLOCATION_TEAM_NOT_FOUND",
        `TEAM ${targetId} was not found.`,
      );
    }

    const data = snapshot.data() || {};
    const status = getTeamStatus(data);
    const ownerMncId = normalizeText(data?.ownership?.mncServiceProviderId);

    if (status !== "ACTIVE") {
      throw controlledError(
        "ALLOCATION_TEAM_NOT_ACTIVE",
        `TEAM ${targetId} is not ACTIVE.`,
      );
    }

    if (!ownerMncId || ownerMncId !== actorMncId) {
      throw controlledError(
        "ALLOCATION_TEAM_OUTSIDE_MNC",
        "The selected TEAM does not belong to the authorised MNC.",
        { targetId, actorMncId, ownerMncId: ownerMncId || null },
      );
    }

    return {
      type: "TEAM",
      id: snapshot.id,
      name: getTeamName(data, snapshot.id),
      memberCount: safeArray(data?.scope?.memberUserIds).length,
    };
  }

  const snapshot = await db
    .collection("serviceProviders")
    .doc(targetId)
    .get();

  if (!snapshot.exists) {
    throw controlledError(
      "ALLOCATION_SERVICE_PROVIDER_NOT_FOUND",
      `Service Provider ${targetId} was not found.`,
    );
  }

  const data = snapshot.data() || {};
  const status = getServiceProviderStatus(data);
  const mncClient = findSubcontractorMncClient(data, actorMncId);

  if (status !== "ACTIVE") {
    throw controlledError(
      "ALLOCATION_SERVICE_PROVIDER_NOT_ACTIVE",
      `Service Provider ${targetId} is not ACTIVE.`,
    );
  }

  if (!mncClient) {
    throw controlledError(
      "ALLOCATION_SERVICE_PROVIDER_OUTSIDE_MNC",
      "The selected Service Provider is not a subcontractor of the authorised MNC.",
      { targetId, actorMncId },
    );
  }

  const membersSnapshot = await db
    .collection(TARGETED_BATCH_COLLECTIONS.users)
    .where("employment.serviceProvider.id", "==", snapshot.id)
    .get();

  return {
    type: "SP",
    id: snapshot.id,
    name: getServiceProviderName(data, snapshot.id),
    memberCount: membersSnapshot.size,
  };
}

async function resolveAllocationTargetInTransaction({
  db,
  transaction,
  targetType,
  targetId,
  actorMncId,
  fallbackMemberCount = 0,
}) {
  if (targetType === "TEAM") {
    const targetRef = db.collection("teams").doc(targetId);
    const snapshot = await transaction.get(targetRef);

    if (!snapshot.exists) {
      throw controlledError(
        "ALLOCATION_TEAM_NOT_FOUND",
        `TEAM ${targetId} was not found.`,
      );
    }

    const data = snapshot.data() || {};
    const status = getTeamStatus(data);
    const ownerMncId = normalizeText(data?.ownership?.mncServiceProviderId);

    if (status !== "ACTIVE") {
      throw controlledError(
        "ALLOCATION_TEAM_NOT_ACTIVE",
        `TEAM ${targetId} is not ACTIVE.`,
      );
    }

    if (!ownerMncId || ownerMncId !== actorMncId) {
      throw controlledError(
        "ALLOCATION_TEAM_OUTSIDE_MNC",
        "The selected TEAM does not belong to the authorised MNC.",
        { targetId, actorMncId, ownerMncId: ownerMncId || null },
      );
    }

    return {
      type: "TEAM",
      id: snapshot.id,
      name: getTeamName(data, snapshot.id),
      memberCount: safeArray(data?.scope?.memberUserIds).length,
    };
  }

  const targetRef = db.collection("serviceProviders").doc(targetId);
  const snapshot = await transaction.get(targetRef);

  if (!snapshot.exists) {
    throw controlledError(
      "ALLOCATION_SERVICE_PROVIDER_NOT_FOUND",
      `Service Provider ${targetId} was not found.`,
    );
  }

  const data = snapshot.data() || {};
  const status = getServiceProviderStatus(data);
  const mncClient = findSubcontractorMncClient(data, actorMncId);

  if (status !== "ACTIVE") {
    throw controlledError(
      "ALLOCATION_SERVICE_PROVIDER_NOT_ACTIVE",
      `Service Provider ${targetId} is not ACTIVE.`,
    );
  }

  if (!mncClient) {
    throw controlledError(
      "ALLOCATION_SERVICE_PROVIDER_OUTSIDE_MNC",
      "The selected Service Provider is not a subcontractor of the authorised MNC.",
      { targetId, actorMncId },
    );
  }

  return {
    type: "SP",
    id: snapshot.id,
    name: getServiceProviderName(data, snapshot.id),
    memberCount: Math.max(0, Number(fallbackMemberCount || 0)),
  };
}

function assertParentReadyForAllocation({ parent = {}, tbId }) {
  const creationState = normalizeUpper(parent?.creation?.state);
  const executionStatus = normalizeUpper(parent?.execution?.status);

  if (creationState !== TARGETED_BATCH_CREATION_STATES.ready) {
    throw controlledError(
      "TARGETED_BATCH_NOT_READY",
      `${tbId} has not completed permanent Targeted Batch creation.`,
      { creationState: creationState || "UNKNOWN" },
    );
  }

  if (executionStatus && executionStatus !== "NOT_STARTED") {
    throw controlledError(
      "TARGETED_BATCH_EXECUTION_ALREADY_STARTED",
      `${tbId} cannot be allocated because execution has already started.`,
      { executionStatus },
    );
  }
}

function getExistingParentTarget(parent = {}) {
  const allocation = parent?.allocation || {};
  const target = allocation?.target || {};
  const type = normalizeUpper(allocation?.targetType || target?.type);
  const id = normalizeText(allocation?.targetId || target?.id);

  if (!type || !id) return null;

  return { type, id };
}

function targetMatches(left, right) {
  return Boolean(
    left?.type &&
      left?.id &&
      right?.type &&
      right?.id &&
      normalizeUpper(left.type) === normalizeUpper(right.type) &&
      normalizeText(left.id) === normalizeText(right.id),
  );
}

function assertRowsSafeForAllocation({ rowSnapshots, target, tbId }) {
  const conflicts = [];
  const executionStarted = [];
  const nonAllocatable = [];

  rowSnapshots.forEach((snapshot) => {
    const row = snapshot.data() || {};
    const executionStatus = normalizeUpper(row?.execution?.status);
    const allocationStatus = normalizeUpper(row?.allocation?.status);
    const existingTarget = {
      type: normalizeUpper(row?.allocation?.targetType),
      id: normalizeText(row?.allocation?.targetId),
    };

    if (row?.allocation?.allocatable === false) {
      nonAllocatable.push(snapshot.id);
    }

    if (executionStatus && executionStatus !== "NOT_STARTED") {
      executionStarted.push(snapshot.id);
    }

    if (
      allocationStatus === "ALLOCATED" &&
      !targetMatches(existingTarget, target)
    ) {
      conflicts.push(snapshot.id);
    }
  });

  if (nonAllocatable.length > 0) {
    throw controlledError(
      "TARGETED_BATCH_ROWS_NOT_ALLOCATABLE",
      `${tbId} contains rows that are not allocatable.`,
      { rowIds: nonAllocatable.slice(0, 20), count: nonAllocatable.length },
    );
  }

  if (executionStarted.length > 0) {
    throw controlledError(
      "TARGETED_BATCH_ROWS_EXECUTION_STARTED",
      `${tbId} contains rows whose execution has already started.`,
      { rowIds: executionStarted.slice(0, 20), count: executionStarted.length },
    );
  }

  if (conflicts.length > 0) {
    throw controlledError(
      "TARGETED_BATCH_ROWS_ALREADY_ALLOCATED",
      `${tbId} contains rows allocated to another TEAM/SP.`,
      { rowIds: conflicts.slice(0, 20), count: conflicts.length },
    );
  }
}

function getRowsAlreadyAllocatedToTarget(rowSnapshots, target) {
  return rowSnapshots.filter((snapshot) => {
    const row = snapshot.data() || {};
    return (
      normalizeUpper(row?.allocation?.status) === "ALLOCATED" &&
      targetMatches(
        {
          type: row?.allocation?.targetType,
          id: row?.allocation?.targetId,
        },
        target,
      )
    );
  });
}

export function isNonGpsTargetedBatch(parent = {}) {
  const sourceType = normalizeUpper(parent?.source?.type);
  const planningMode = normalizeUpper(parent?.selection?.planningMode);

  return (
    sourceType === "PREPAID_SALES_NON_GPS" ||
    (sourceType === "PREPAID_SALES" &&
      planningMode === TARGETED_BATCH_PLANNING_MODES.nonGpsStreet)
  );
}

function getAuthoritativeNonGpsExpectedRows(parent = {}, tbId) {
  const candidates = [
    {
      field: "counts.totalRows",
      raw: parent?.counts?.totalRows,
    },
    {
      field: "creation.expectedRows",
      raw: parent?.creation?.expectedRows,
    },
  ].filter(({ raw }) => raw !== null && raw !== undefined && raw !== "");

  if (candidates.length === 0) {
    throw controlledError(
      "NGP_ALLOCATION_EXPECTED_ROW_COUNT_INVALID",
      `${tbId} does not have a positive authoritative parent row count.`,
      { reason: "MISSING" },
    );
  }

  const parsed = candidates.map(({ field, raw }) => ({
    field,
    raw,
    value: Number(raw),
  }));
  const invalid = parsed.find(
    ({ value }) => !Number.isInteger(value) || value < 1 || value > 20,
  );

  if (invalid) {
    throw controlledError(
      "NGP_ALLOCATION_EXPECTED_ROW_COUNT_INVALID",
      `${tbId} has an invalid authoritative parent row count.`,
      { field: invalid.field, value: invalid.raw ?? null },
    );
  }

  const expectedRows = parsed[0].value;
  const conflicting = parsed.find(({ value }) => value !== expectedRows);
  if (conflicting) {
    throw controlledError(
      "NGP_ALLOCATION_EXPECTED_ROW_COUNT_CONFLICT",
      `${tbId} has conflicting authoritative parent row counts.`,
      {
        countsTotalRows: parent?.counts?.totalRows ?? null,
        creationExpectedRows: parent?.creation?.expectedRows ?? null,
      },
    );
  }

  return expectedRows;
}

export async function allocateNonGpsBatchAtomically({
  db,
  parentRef,
  tbId,
  targetType,
  targetId,
  actorMncId,
  fallbackMemberCount = 0,
  actorUid,
  actorName,
  startedAtMs,
}) {
  const result = await db.runTransaction(async (transaction) => {
    const liveParentSnapshot = await transaction.get(parentRef);

    if (!liveParentSnapshot.exists) {
      throw controlledError(
        "TARGETED_BATCH_NOT_FOUND",
        `Targeted Batch ${tbId} was not found.`,
      );
    }

    const rowsQuery = db
      .collection(TARGETED_BATCH_COLLECTIONS.rows)
      .where("tbId", "==", tbId);
    const liveRowsQuerySnapshot = await transaction.get(rowsQuery);
    const liveRowSnapshots = liveRowsQuerySnapshot.docs;
    const liveTarget = await resolveAllocationTargetInTransaction({
      db,
      transaction,
      targetType,
      targetId,
      actorMncId,
      fallbackMemberCount,
    });

    const liveParent = liveParentSnapshot.data() || {};
    assertParentReadyForAllocation({ parent: liveParent, tbId });

    if (!isNonGpsTargetedBatch(liveParent)) {
      throw controlledError(
        "NGP_ALLOCATION_SOURCE_CHANGED",
        `${tbId} is no longer recognised as a Non-GPS Targeted Batch.`,
      );
    }

    if (liveRowSnapshots.length < 1 || liveRowSnapshots.length > 20) {
      throw controlledError(
        "NGP_ALLOCATION_ROW_COUNT_INVALID",
        `${tbId} must contain between 1 and 20 rows for atomic Non-GPS allocation.`,
        { rowCount: liveRowSnapshots.length },
      );
    }

    const expectedRows = getAuthoritativeNonGpsExpectedRows(
      liveParent,
      tbId,
    );

    if (liveRowSnapshots.length !== expectedRows) {
      throw controlledError(
        "TARGETED_BATCH_ROW_COUNT_MISMATCH",
        `${tbId} expected ${expectedRows} rows but ${liveRowSnapshots.length} were found.`,
        { expectedRows, actualRows: liveRowSnapshots.length },
      );
    }

    const foreignRows = liveRowSnapshots
      .filter(
        (snapshot) =>
          normalizeUpper(snapshot.data()?.tbId) !== normalizeUpper(tbId),
      )
      .map((snapshot) => snapshot.id);

    if (foreignRows.length > 0) {
      throw controlledError(
        "TARGETED_BATCH_ROW_PARENT_MISMATCH",
        `${tbId} contains TB Rows linked to another parent.`,
        { rowIds: foreignRows },
      );
    }

    assertRowsSafeForAllocation({
      rowSnapshots: liveRowSnapshots,
      target: liveTarget,
      tbId,
    });

    const liveStatus = normalizeUpper(liveParent?.allocation?.status);
    const liveParentTarget = getExistingParentTarget(liveParent);
    const alreadyAllocatedRows = getRowsAlreadyAllocatedToTarget(
      liveRowSnapshots,
      liveTarget,
    ).length;

    if (liveStatus === "ALLOCATED") {
      if (!targetMatches(liveParentTarget, liveTarget)) {
        throw controlledError(
          "TARGETED_BATCH_ALREADY_ALLOCATED",
          `${tbId} is already allocated to another TEAM/SP.`,
          { existingTarget: liveParentTarget },
        );
      }

      if (alreadyAllocatedRows !== liveRowSnapshots.length) {
        throw controlledError(
          "TARGETED_BATCH_ALLOCATION_INCOMPLETE",
          `${tbId} is marked ALLOCATED but not every TB Row has the same target.`,
          {
            expectedRows: liveRowSnapshots.length,
            allocatedRows: alreadyAllocatedRows,
          },
        );
      }

      return {
        alreadyAllocated: true,
        completedAt: liveParent?.allocation?.completedAt || Timestamp.now(),
        totalRows: liveRowSnapshots.length,
        updatedRows: 0,
        target: liveTarget,
      };
    }

    if (liveParentTarget && !targetMatches(liveParentTarget, liveTarget)) {
      throw controlledError(
        "TARGETED_BATCH_ALLOCATION_TARGET_CONFLICT",
        `${tbId} already has a different allocation target.`,
        { existingTarget: liveParentTarget },
      );
    }

    const completedAt = Timestamp.now();
    let updatedRows = 0;

    liveRowSnapshots.forEach((rowSnapshot) => {
      const row = rowSnapshot.data() || {};
      const existingTarget = {
        type: row?.allocation?.targetType,
        id: row?.allocation?.targetId,
      };
      const alreadyAllocated =
        normalizeUpper(row?.allocation?.status) === "ALLOCATED" &&
        targetMatches(existingTarget, liveTarget);

      if (alreadyAllocated) return;

      transaction.update(rowSnapshot.ref, {
        "allocation.status": "ALLOCATED",
        "allocation.targetType": liveTarget.type,
        "allocation.targetId": liveTarget.id,
        "allocation.targetName": liveTarget.name,
        "allocation.allocatedAt": completedAt,
        "allocation.allocatedByUid": actorUid,
        "allocation.allocatedByUser": actorName,
        "metadata.updatedAt": completedAt,
        "metadata.updatedByUid": actorUid,
        "metadata.updatedByUser": actorName,
      });
      updatedRows += 1;
    });

    transaction.update(parentRef, {
      status: "ALLOCATED",
      "allocation.status": "ALLOCATED",
      "allocation.targetType": liveTarget.type,
      "allocation.targetId": liveTarget.id,
      "allocation.targetName": liveTarget.name,
      "allocation.memberCount": liveTarget.memberCount,
      "allocation.startedAt": liveParent?.allocation?.startedAt || completedAt,
      "allocation.completedAt": completedAt,
      "allocation.failureCode": null,
      "allocation.failureMessage": null,
      "allocation.failedAt": null,
      "allocation.allocatedByUid": actorUid,
      "allocation.allocatedByUser": actorName,
      "acceptance.status": "WAITING",
      "acceptance.acceptedAt": null,
      "acceptance.acceptedByUid": null,
      "acceptance.acceptedByUser": null,
      "acceptance.rejectedAt": null,
      "acceptance.rejectedByUid": null,
      "acceptance.rejectedByUser": null,
      "acceptance.rejectReason": "",
      "counts.allocatedRows": liveRowSnapshots.length,
      "counts.unallocatedRows": 0,
      "metadata.updatedAt": completedAt,
      "metadata.updatedByUid": actorUid,
      "metadata.updatedByUser": actorName,
    });

    return {
      alreadyAllocated: false,
      completedAt,
      totalRows: liveRowSnapshots.length,
      updatedRows,
      target: liveTarget,
    };
  });

  const completedAtIso =
    typeof result.completedAt?.toDate === "function"
      ? result.completedAt.toDate().toISOString()
      : new Date().toISOString();

  logger.info("onAllocateTargetedBatchCallable -- NGP ATOMIC COMPLETED", {
    tbId,
    targetType: result.target.type,
    targetId: result.target.id,
    targetName: result.target.name,
    totalRows: result.totalRows,
    updatedRows: result.updatedRows,
    alreadyAllocated: result.alreadyAllocated,
    durationMs: Date.now() - startedAtMs,
  });

  return buildSuccessResult(
    result.alreadyAllocated
      ? `${tbId} is already allocated to ${result.target.name}.`
      : `${tbId} was allocated to ${result.target.name}.`,
    {
      code: result.alreadyAllocated
        ? "TARGETED_BATCH_ALREADY_ALLOCATED_TO_TARGET"
        : "TARGETED_BATCH_ALLOCATED",
      tbId,
      batchStatus: "ALLOCATED",
      allocationStatus: "ALLOCATED",
      acceptanceStatus: "WAITING",
      target: result.target,
      totalRows: result.totalRows,
      allocatedRows: result.totalRows,
      unallocatedRows: 0,
      updatedRows: result.updatedRows,
      verifiedRows: result.totalRows,
      completedAt: completedAtIso,
      alreadyAllocated: result.alreadyAllocated,
      atomic: true,
      durationMs: Date.now() - startedAtMs,
    },
  );
}

async function markAllocationFailure({
  parentRef,
  target,
  actorUid,
  actorName,
  error,
}) {
  if (!parentRef || !target?.id) return;

  const failedAt = Timestamp.now();

  try {
    await parentRef.update({
      "allocation.status": "ALLOCATION_FAILED",
      "allocation.targetType": target.type,
      "allocation.targetId": target.id,
      "allocation.targetName": target.name,
      "allocation.memberCount": target.memberCount,
      "allocation.failureCode": getErrorCode(error),
      "allocation.failureMessage": getErrorMessage(error),
      "allocation.failedAt": failedAt,
      "metadata.updatedAt": failedAt,
      "metadata.updatedByUid": actorUid,
      "metadata.updatedByUser": actorName,
    });
  } catch (patchError) {
    logger.error(
      "onAllocateTargetedBatchCallable -- FAILURE PATCH FAILED",
      {
        tbId: parentRef.id,
        errorCode: getErrorCode(patchError),
        errorMessage: getErrorMessage(patchError),
      },
    );
  }
}

export const onAllocateTargetedBatchCallable = onCall(
  {
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async (request) => {
    const startedAtMs = Date.now();
    const db = getFirestore();
    const actorUid = request?.auth?.uid || null;
    let actorName = actorUid || "SYSTEM";
    let tbId = null;
    let parentRef = null;
    let resolvedTarget = null;
    let allocationClaimed = false;

    try {
      if (!actorUid) {
        return buildFailureResult(
          "UNAUTHENTICATED",
          "Authentication is required to allocate a Targeted Batch.",
        );
      }

      const authority = await resolveTargetedBatchCreateAuthority({
        db,
        request,
      });
      actorName = getActorNameFromRequest(request, authority.profile);

      if (!authority.ok) {
        return buildFailureResult(
          "UNAUTHORIZED_TARGETED_BATCH_ALLOCATION",
          "Only MNG and SPV(MNC) users may allocate Targeted Batches.",
          {
            actorRole: authority.role,
            actorRelationshipType: authority.relationshipType,
            actorClientType: authority.clientType,
          },
        );
      }

      const actorMncId = getActorMncServiceProviderId({
        request,
        profile: authority.profile,
      });

      if (!actorMncId) {
        return buildFailureResult(
          "ACTOR_MNC_SERVICE_PROVIDER_MISSING",
          "The signed-in user is not linked to an MNC Service Provider ID.",
        );
      }

      const requestData = request?.data || {};
      tbId = getTargetedBatchId(requestData);
      const targetType = getTargetType(requestData);
      const targetId = getTargetId(requestData);

      if (!TB_ID_PATTERN.test(tbId)) {
        return buildFailureResult(
          "INVALID_TARGETED_BATCH_ID",
          "tbId must follow TGB_YYYYMMDD_HHMMSS_XXXX.",
        );
      }

      if (!ALLOCATION_TARGET_TYPES.includes(targetType)) {
        return buildFailureResult(
          "INVALID_ALLOCATION_TARGET_TYPE",
          "targetType must be TEAM or SP.",
        );
      }

      if (!targetId) {
        return buildFailureResult(
          "ALLOCATION_TARGET_ID_REQUIRED",
          "targetId is required.",
        );
      }

      resolvedTarget = await resolveAllocationTarget({
        db,
        targetType,
        targetId,
        actorMncId,
      });

      parentRef = db
        .collection(TARGETED_BATCH_COLLECTIONS.uploads)
        .doc(tbId);
      const parentSnapshot = await parentRef.get();

      if (!parentSnapshot.exists) {
        return buildFailureResult(
          "TARGETED_BATCH_NOT_FOUND",
          `Targeted Batch ${tbId} was not found.`,
        );
      }

      const parent = parentSnapshot.data() || {};
      assertParentReadyForAllocation({ parent, tbId });

      if (isNonGpsTargetedBatch(parent)) {
        return await allocateNonGpsBatchAtomically({
          db,
          parentRef,
          tbId,
          targetType,
          targetId,
          actorMncId,
          fallbackMemberCount: resolvedTarget?.memberCount || 0,
          actorUid,
          actorName,
          startedAtMs,
        });
      }

      const rowsSnapshot = await db
        .collection(TARGETED_BATCH_COLLECTIONS.rows)
        .where("tbId", "==", tbId)
        .get();
      const rowSnapshots = rowsSnapshot.docs;
      const expectedRows = Number(
        parent?.counts?.totalRows || parent?.creation?.expectedRows || 0,
      );

      if (rowSnapshots.length < 1) {
        throw controlledError(
          "TARGETED_BATCH_ROWS_NOT_FOUND",
          `No permanent TB Rows were found for ${tbId}.`,
        );
      }

      if (expectedRows > 0 && rowSnapshots.length !== expectedRows) {
        throw controlledError(
          "TARGETED_BATCH_ROW_COUNT_MISMATCH",
          `${tbId} expected ${expectedRows} rows but ${rowSnapshots.length} were found.`,
          { expectedRows, actualRows: rowSnapshots.length },
        );
      }

      assertRowsSafeForAllocation({
        rowSnapshots,
        target: resolvedTarget,
        tbId,
      });

      const existingParentTarget = getExistingParentTarget(parent);
      const existingStatus = normalizeUpper(parent?.allocation?.status);
      const alreadyAllocatedRows = getRowsAlreadyAllocatedToTarget(
        rowSnapshots,
        resolvedTarget,
      ).length;

      if (existingStatus === "ALLOCATED") {
        if (!targetMatches(existingParentTarget, resolvedTarget)) {
          throw controlledError(
            "TARGETED_BATCH_ALREADY_ALLOCATED",
            `${tbId} is already allocated to another TEAM/SP.`,
            { existingTarget: existingParentTarget },
          );
        }

        if (alreadyAllocatedRows !== rowSnapshots.length) {
          throw controlledError(
            "TARGETED_BATCH_ALLOCATION_INCOMPLETE",
            `${tbId} is marked ALLOCATED but not every TB Row has the same target.`,
            {
              expectedRows: rowSnapshots.length,
              allocatedRows: alreadyAllocatedRows,
            },
          );
        }

        return buildSuccessResult(
          `${tbId} is already allocated to ${resolvedTarget.name}.`,
          {
            code: "TARGETED_BATCH_ALREADY_ALLOCATED",
            tbId,
            batchStatus: normalizeUpper(parent?.status) || "ALLOCATED",
            allocationStatus: "ALLOCATED",
            target: resolvedTarget,
            totalRows: rowSnapshots.length,
            allocatedRows: rowSnapshots.length,
            unallocatedRows: 0,
            alreadyAllocated: true,
            durationMs: Date.now() - startedAtMs,
          },
        );
      }

      if (
        existingParentTarget &&
        !targetMatches(existingParentTarget, resolvedTarget)
      ) {
        throw controlledError(
          "TARGETED_BATCH_ALLOCATION_TARGET_CONFLICT",
          `${tbId} already has a different allocation target in progress.`,
          { existingTarget: existingParentTarget },
        );
      }

      const allocationStartedAt = Timestamp.now();

      const allocationClaim = await db.runTransaction(async (transaction) => {
        const liveSnapshot = await transaction.get(parentRef);
        const liveResolvedTarget = await resolveAllocationTargetInTransaction({
          db,
          transaction,
          targetType,
          targetId,
          actorMncId,
          fallbackMemberCount: resolvedTarget?.memberCount || 0,
        });

        if (!liveSnapshot.exists) {
          throw controlledError(
            "TARGETED_BATCH_NOT_FOUND",
            `Targeted Batch ${tbId} was not found.`,
          );
        }

        const liveParent = liveSnapshot.data() || {};
        assertParentReadyForAllocation({ parent: liveParent, tbId });

        const liveStatus = normalizeUpper(liveParent?.allocation?.status);
        const liveTarget = getExistingParentTarget(liveParent);

        if (liveStatus === "ALLOCATED") {
          if (!targetMatches(liveTarget, liveResolvedTarget)) {
            throw controlledError(
              "TARGETED_BATCH_ALREADY_ALLOCATED",
              `${tbId} is already allocated to another TEAM/SP.`,
              { existingTarget: liveTarget },
            );
          }

          return { claimed: false, target: liveResolvedTarget };
        }

        if (liveTarget && !targetMatches(liveTarget, liveResolvedTarget)) {
          throw controlledError(
            "TARGETED_BATCH_ALLOCATION_TARGET_CONFLICT",
            `${tbId} already has a different allocation target in progress.`,
            { existingTarget: liveTarget },
          );
        }

        transaction.update(parentRef, {
          "allocation.status": "ALLOCATING",
          "allocation.targetType": liveResolvedTarget.type,
          "allocation.targetId": liveResolvedTarget.id,
          "allocation.targetName": liveResolvedTarget.name,
          "allocation.memberCount": liveResolvedTarget.memberCount,
          "allocation.startedAt":
            liveParent?.allocation?.startedAt || allocationStartedAt,
          "allocation.completedAt": null,
          "allocation.failureCode": null,
          "allocation.failureMessage": null,
          "allocation.failedAt": null,
          "allocation.allocatedByUid": actorUid,
          "allocation.allocatedByUser": actorName,
          "metadata.updatedAt": allocationStartedAt,
          "metadata.updatedByUid": actorUid,
          "metadata.updatedByUser": actorName,
        });

        return { claimed: true, target: liveResolvedTarget };
      });

      allocationClaimed = allocationClaim.claimed;
      resolvedTarget = allocationClaim.target;

      let updatedRows = 0;
      let processedRows = 0;

      for (const [chunkIndex, chunk] of chunkArray(
        rowSnapshots,
        ALLOCATION_WRITE_CHUNK,
      ).entries()) {
        const writeBatch = db.batch();
        let writesInChunk = 0;
        const allocatedAt = Timestamp.now();

        chunk.forEach((rowSnapshot) => {
          const row = rowSnapshot.data() || {};
          const existingTarget = {
            type: row?.allocation?.targetType,
            id: row?.allocation?.targetId,
          };
          const isAlreadyAllocated =
            normalizeUpper(row?.allocation?.status) === "ALLOCATED" &&
            targetMatches(existingTarget, resolvedTarget);

          if (isAlreadyAllocated) return;

          writeBatch.update(rowSnapshot.ref, {
            "allocation.status": "ALLOCATED",
            "allocation.targetType": resolvedTarget.type,
            "allocation.targetId": resolvedTarget.id,
            "allocation.targetName": resolvedTarget.name,
            "allocation.allocatedAt": allocatedAt,
            "allocation.allocatedByUid": actorUid,
            "allocation.allocatedByUser": actorName,
            "metadata.updatedAt": allocatedAt,
            "metadata.updatedByUid": actorUid,
            "metadata.updatedByUser": actorName,
          });
          writesInChunk += 1;
        });

        if (writesInChunk > 0) {
          await writeBatch.commit();
          updatedRows += writesInChunk;
        }

        processedRows += chunk.length;

        logger.info("onAllocateTargetedBatchCallable -- ROW PROGRESS", {
          tbId,
          chunk: chunkIndex + 1,
          chunks: Math.ceil(rowSnapshots.length / ALLOCATION_WRITE_CHUNK),
          processedRows,
          totalRows: rowSnapshots.length,
          updatedRows,
        });
      }

      const verificationSnapshot = await db
        .collection(TARGETED_BATCH_COLLECTIONS.rows)
        .where("tbId", "==", tbId)
        .get();
      const verifiedRows = getRowsAlreadyAllocatedToTarget(
        verificationSnapshot.docs,
        resolvedTarget,
      ).length;

      if (
        verificationSnapshot.size !== rowSnapshots.length ||
        verifiedRows !== rowSnapshots.length
      ) {
        throw controlledError(
          "TARGETED_BATCH_ALLOCATION_VERIFICATION_FAILED",
          `Post-write verification failed for ${tbId}.`,
          {
            expectedRows: rowSnapshots.length,
            rowsRead: verificationSnapshot.size,
            verifiedRows,
          },
        );
      }

      const completedAt = Timestamp.now();

      await parentRef.update({
        status: "ALLOCATED",
        "allocation.status": "ALLOCATED",
        "allocation.targetType": resolvedTarget.type,
        "allocation.targetId": resolvedTarget.id,
        "allocation.targetName": resolvedTarget.name,
        "allocation.memberCount": resolvedTarget.memberCount,
        "allocation.completedAt": completedAt,
        "allocation.failureCode": null,
        "allocation.failureMessage": null,
        "allocation.failedAt": null,
        "acceptance.status": "WAITING",
        "acceptance.acceptedAt": null,
        "acceptance.acceptedByUid": null,
        "acceptance.acceptedByUser": null,
        "acceptance.rejectedAt": null,
        "acceptance.rejectedByUid": null,
        "acceptance.rejectedByUser": null,
        "acceptance.rejectReason": "",
        "counts.allocatedRows": rowSnapshots.length,
        "counts.unallocatedRows": 0,
        "metadata.updatedAt": completedAt,
        "metadata.updatedByUid": actorUid,
        "metadata.updatedByUser": actorName,
      });

      logger.info("onAllocateTargetedBatchCallable -- COMPLETED", {
        tbId,
        targetType: resolvedTarget.type,
        targetId: resolvedTarget.id,
        targetName: resolvedTarget.name,
        totalRows: rowSnapshots.length,
        updatedRows,
        verifiedRows,
        durationMs: Date.now() - startedAtMs,
      });

      return buildSuccessResult(
        `${tbId} was allocated to ${resolvedTarget.name}.`,
        {
          code: "TARGETED_BATCH_ALLOCATED",
          tbId,
          batchStatus: "ALLOCATED",
          allocationStatus: "ALLOCATED",
          acceptanceStatus: "WAITING",
          target: resolvedTarget,
          totalRows: rowSnapshots.length,
          allocatedRows: rowSnapshots.length,
          unallocatedRows: 0,
          updatedRows,
          verifiedRows,
          completedAt: completedAt.toDate().toISOString(),
          alreadyAllocated: false,
          durationMs: Date.now() - startedAtMs,
        },
      );
    } catch (error) {
      const code = getErrorCode(error);
      const message = getErrorMessage(error);

      if (allocationClaimed) {
        await markAllocationFailure({
          parentRef,
          target: resolvedTarget,
          actorUid,
          actorName,
          error,
        });
      }

      logger.error("onAllocateTargetedBatchCallable -- FAILED", {
        tbId,
        targetType: resolvedTarget?.type || null,
        targetId: resolvedTarget?.id || null,
        code,
        message,
        details: error?.details || null,
        durationMs: Date.now() - startedAtMs,
      });

      return buildFailureResult(code, message, {
        tbId,
        details: error?.details || null,
        durationMs: Date.now() - startedAtMs,
      });
    }
  },
);
