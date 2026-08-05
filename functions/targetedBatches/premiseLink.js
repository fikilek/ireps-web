import { Timestamp } from "firebase-admin/firestore";

import {
  TARGETED_BATCH_COLLECTIONS,
  findActorProfile,
  getActorNameFromRequest,
  normalizeMeterNo,
  normalizeText,
  normalizeUpper,
} from "./helpers.js";

export const TARGETED_BATCH_PREMISE_SOURCE_MODULE = "SALES_TARGETED_BATCH";
export const TARGETED_BATCH_PREMISE_OPERATION_TYPE = "METER_DISCOVERY";

function controlledError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.irepsCode = code;
  error.details = details;
  return error;
}

function readFirstText(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }

  return "";
}

function readNullableText(...values) {
  return readFirstText(...values) || null;
}

function readNonNegativeInteger(value, fallback = 0) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(0, Math.trunc(numberValue));
}

function normalizeRowNo(value) {
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue <= 0) return null;
  return numberValue;
}

function sameId(left, right) {
  return Boolean(
    normalizeText(left) &&
      normalizeText(right) &&
      normalizeText(left) === normalizeText(right),
  );
}

function assertSameId({
  left,
  right,
  code,
  message,
  details = {},
}) {
  if (!sameId(left, right)) {
    throw controlledError(code, message, {
      ...details,
      left: normalizeText(left) || null,
      right: normalizeText(right) || null,
    });
  }
}

function getScope(entity = {}, type = "PARENT") {
  if (type === "ERF") {
    return {
      lmPcode: normalizeUpper(
        entity?.admin?.localMunicipality?.pcode,
      ),
      wardPcode: normalizeUpper(entity?.admin?.ward?.pcode),
    };
  }

  if (type === "PREMISE") {
    return {
      lmPcode: normalizeUpper(entity?.parents?.lmPcode),
      wardPcode: normalizeUpper(entity?.parents?.wardPcode),
    };
  }

  return {
    lmPcode: normalizeUpper(entity?.scope?.lmPcode),
    wardPcode: normalizeUpper(entity?.scope?.wardPcode),
  };
}

function assertScopeComplete(scope = {}, label) {
  if (!scope.lmPcode || !scope.wardPcode) {
    throw controlledError(
      "TARGETED_BATCH_SCOPE_MISSING",
      `${label} does not carry the required LM and ward scope.`,
      {
        label,
        lmPcode: scope.lmPcode || null,
        wardPcode: scope.wardPcode || null,
      },
    );
  }
}

function assertSameScope({
  parentScope,
  rowScope,
  erfScope,
  premiseScope,
}) {
  [
    ["Targeted Batch", parentScope],
    ["Targeted Batch Row", rowScope],
    ["Authoritative ERF", erfScope],
    ["Premise", premiseScope],
  ].forEach(([label, scope]) => assertScopeComplete(scope, label));

  const lmValues = [
    parentScope.lmPcode,
    rowScope.lmPcode,
    erfScope.lmPcode,
    premiseScope.lmPcode,
  ];

  if (new Set(lmValues).size !== 1) {
    throw controlledError(
      "TARGETED_BATCH_LM_SCOPE_MISMATCH",
      "The Targeted Batch, TB Row, ERF and premise do not share one LM scope.",
      {
        parentLmPcode: parentScope.lmPcode,
        rowLmPcode: rowScope.lmPcode,
        erfLmPcode: erfScope.lmPcode,
        premiseLmPcode: premiseScope.lmPcode,
      },
    );
  }

  const wardValues = [
    parentScope.wardPcode,
    rowScope.wardPcode,
    erfScope.wardPcode,
    premiseScope.wardPcode,
  ];

  if (new Set(wardValues).size !== 1) {
    throw controlledError(
      "TARGETED_BATCH_WARD_SCOPE_MISMATCH",
      "The Targeted Batch, TB Row, ERF and premise do not share one ward scope.",
      {
        parentWardPcode: parentScope.wardPcode,
        rowWardPcode: rowScope.wardPcode,
        erfWardPcode: erfScope.wardPcode,
        premiseWardPcode: premiseScope.wardPcode,
      },
    );
  }
}

function requireDocument(snapshot, code, message) {
  if (!snapshot?.exists) {
    throw controlledError(code, message);
  }

  return snapshot.data() || {};
}

function getAuthoritativeSalesDocId(row = {}) {
  return readFirstText(
    row?.salesAllMeterId,
    row?.source?.recordId,
  );
}

function getAuthoritativeErfId(row = {}) {
  return readFirstText(row?.refs?.erfId);
}

function getAuthoritativeMeterNo(row = {}, context = {}) {
  return readNullableText(
    row?.meter?.numberNormalized,
    row?.meter?.numberRaw,
    context?.meterNo,
  );
}

function buildCanonicalContext({
  parentRef,
  rowRef,
  row,
  context,
  salesDocId,
  erfId,
}) {
  return {
    sourceModule: TARGETED_BATCH_PREMISE_SOURCE_MODULE,
    operationType: TARGETED_BATCH_PREMISE_OPERATION_TYPE,
    tbId: parentRef.id,
    rowId: rowRef.id,
    rowNo: normalizeRowNo(row?.rowNo) || context?.rowNo || null,
    salesDocId,
    erfId,
    meterNo: getAuthoritativeMeterNo(row, context),
    accountNumber: readNullableText(
      row?.customer?.accountNumber,
      context?.accountNumber,
    ),
    customerName: readNullableText(
      row?.customer?.customerName,
      context?.customerName,
    ),
    sourceAddress: {
      addressLine1: readNullableText(row?.location?.addressLine1),
      town: readNullableText(row?.location?.town),
    },
  };
}

function coreContextMatches(left = {}, right = {}) {
  return (
    normalizeUpper(left?.sourceModule) ===
      normalizeUpper(right?.sourceModule) &&
    sameId(left?.tbId, right?.tbId) &&
    sameId(left?.rowId, right?.rowId) &&
    sameId(left?.salesDocId, right?.salesDocId) &&
    sameId(left?.erfId, right?.erfId)
  );
}

function assertParentReady(parent = {}, tbId) {
  const creationState = normalizeUpper(parent?.creation?.state);
  const allocationStatus = normalizeUpper(parent?.allocation?.status);
  const acceptanceStatus = normalizeUpper(parent?.acceptance?.status);
  const executionStatus = normalizeUpper(
    parent?.execution?.status || "NOT_STARTED",
  );

  if (creationState !== "READY") {
    throw controlledError(
      "TARGETED_BATCH_NOT_READY",
      `${tbId} has not completed permanent Targeted Batch creation.`,
      { creationState: creationState || "UNKNOWN" },
    );
  }

  if (allocationStatus !== "ALLOCATED") {
    throw controlledError(
      "TARGETED_BATCH_NOT_ALLOCATED",
      `${tbId} has not been allocated for field execution.`,
      { allocationStatus: allocationStatus || "UNKNOWN" },
    );
  }

  if (acceptanceStatus !== "ACCEPTED") {
    throw controlledError(
      "TARGETED_BATCH_NOT_ACCEPTED",
      `${tbId} has not been accepted for field execution.`,
      { acceptanceStatus: acceptanceStatus || "UNKNOWN" },
    );
  }

  if (executionStatus === "COMPLETED") {
    throw controlledError(
      "TARGETED_BATCH_EXECUTION_COMPLETED",
      `${tbId} has already completed execution.`,
    );
  }

  if (!["NOT_STARTED", "IN_PROGRESS"].includes(executionStatus)) {
    throw controlledError(
      "TARGETED_BATCH_EXECUTION_STATE_INVALID",
      `${tbId} has unsupported execution status ${executionStatus || "UNKNOWN"}.`,
      { executionStatus: executionStatus || "UNKNOWN" },
    );
  }
}

function assertRowReady(row = {}, rowId) {
  const decisionStatus = normalizeUpper(row?.decision?.status || "ACCEPT");
  const allocationStatus = normalizeUpper(row?.allocation?.status);
  const executionStatus = normalizeUpper(
    row?.execution?.status || "NOT_STARTED",
  );

  if (decisionStatus !== "ACCEPT") {
    throw controlledError(
      "TARGETED_BATCH_ROW_NOT_ACCEPTED",
      `${rowId} is not an accepted Targeted Batch row.`,
      { decisionStatus: decisionStatus || "UNKNOWN" },
    );
  }

  if (row?.allocation?.allocatable === false) {
    throw controlledError(
      "TARGETED_BATCH_ROW_NOT_ALLOCATABLE",
      `${rowId} is not allocatable.`,
    );
  }

  if (allocationStatus !== "ALLOCATED") {
    throw controlledError(
      "TARGETED_BATCH_ROW_NOT_ALLOCATED",
      `${rowId} has not been allocated for field execution.`,
      { allocationStatus: allocationStatus || "UNKNOWN" },
    );
  }

  if (executionStatus === "COMPLETED") {
    throw controlledError(
      "TARGETED_BATCH_EXECUTION_COMPLETED",
      `${rowId} has already completed execution.`,
    );
  }

  if (!["NOT_STARTED", "IN_PROGRESS"].includes(executionStatus)) {
    throw controlledError(
      "TARGETED_BATCH_ROW_EXECUTION_STATE_INVALID",
      `${rowId} has unsupported execution status ${executionStatus || "UNKNOWN"}.`,
      { executionStatus: executionStatus || "UNKNOWN" },
    );
  }

  return executionStatus;
}

function assertExistingPremiseCompatible({
  existingPremise,
  proposedPremise,
  parent,
  row,
  erf,
  canonicalContext,
}) {
  assertSameId({
    left: existingPremise?.erfId,
    right: proposedPremise?.erfId,
    code: "TARGETED_BATCH_PREMISE_CONFLICT",
    message: "The existing premise belongs to another ERF.",
  });

  assertSameScope({
    parentScope: getScope(parent, "PARENT"),
    rowScope: getScope(row, "PARENT"),
    erfScope: getScope(erf, "ERF"),
    premiseScope: getScope(existingPremise, "PREMISE"),
  });

  const existingContext = existingPremise?.targetedBatchContext;

  if (
    existingContext &&
    !coreContextMatches(existingContext, canonicalContext)
  ) {
    throw controlledError(
      "TARGETED_BATCH_PREMISE_CONTEXT_CONFLICT",
      "The existing premise is linked to another Targeted Batch row.",
      {
        existingContext,
        expectedContext: canonicalContext,
      },
    );
  }
}

export function isSalesTargetedBatchContext(value = {}) {
  return (
    normalizeUpper(value?.sourceModule) ===
    TARGETED_BATCH_PREMISE_SOURCE_MODULE
  );
}

export function classifyTargetedBatchPremiseRoute({
  hasTargetedBatchContext = false,
  targetedBatchContext,
} = {}) {
  const context =
    targetedBatchContext && typeof targetedBatchContext === "object"
      ? targetedBatchContext
      : {};
  const sourceModule = normalizeUpper(context?.sourceModule);
  const operationType = normalizeUpper(context?.operationType);
  const safeIds = {
    tbId: normalizeText(context?.tbId) || null,
    rowId: normalizeText(context?.rowId) || null,
    salesDocId: normalizeText(context?.salesDocId) || null,
    erfId: normalizeText(context?.erfId) || null,
  };

  if (!hasTargetedBatchContext) {
    return {
      hasTargetedBatchContext: false,
      sourceModule: null,
      ...safeIds,
      selectedBranch: "NORMAL",
      code: null,
      missing: [],
    };
  }

  const missing = Object.entries(safeIds)
    .filter(([, value]) => !value)
    .map(([field]) => field);
  const validSourceModule =
    sourceModule === TARGETED_BATCH_PREMISE_SOURCE_MODULE;
  const validOperationType =
    !operationType ||
    operationType === TARGETED_BATCH_PREMISE_OPERATION_TYPE;

  if (!validSourceModule || !validOperationType || missing.length > 0) {
    return {
      hasTargetedBatchContext: true,
      sourceModule: sourceModule || null,
      ...safeIds,
      selectedBranch: "REJECTED_CONTEXT",
      code: "TARGETED_BATCH_CONTEXT_INVALID",
      missing,
    };
  }

  return {
    hasTargetedBatchContext: true,
    sourceModule,
    ...safeIds,
    selectedBranch: "TARGETED_BATCH",
    code: null,
    missing: [],
  };
}

export function normalizeTargetedBatchPremiseContext(value = {}) {
  if (!isSalesTargetedBatchContext(value)) return null;

  return {
    sourceModule: TARGETED_BATCH_PREMISE_SOURCE_MODULE,
    operationType:
      normalizeUpper(value?.operationType) ||
      TARGETED_BATCH_PREMISE_OPERATION_TYPE,
    tbId: normalizeText(value?.tbId),
    rowId: normalizeText(value?.rowId),
    rowNo: normalizeRowNo(value?.rowNo),
    salesDocId: normalizeText(value?.salesDocId),
    erfId: normalizeText(value?.erfId),
    meterNo: readNullableText(value?.meterNo),
    accountNumber: readNullableText(value?.accountNumber),
    customerName: readNullableText(value?.customerName),
  };
}

export function assertCompleteTargetedBatchPremiseContext(context = {}) {
  const missing = [
    ["tbId", context?.tbId],
    ["rowId", context?.rowId],
    ["salesDocId", context?.salesDocId],
    ["erfId", context?.erfId],
  ]
    .filter(([, value]) => !normalizeText(value))
    .map(([field]) => field);

  if (missing.length > 0) {
    throw controlledError(
      "TARGETED_BATCH_CONTEXT_INCOMPLETE",
      `Targeted Batch premise context is missing: ${missing.join(", ")}.`,
      { missing },
    );
  }

  if (
    normalizeUpper(context?.operationType) !==
    TARGETED_BATCH_PREMISE_OPERATION_TYPE
  ) {
    throw controlledError(
      "TARGETED_BATCH_OPERATION_TYPE_INVALID",
      "Premise creation is only supported for Meter Discovery Targeted Batch rows.",
      {
        operationType: normalizeUpper(context?.operationType) || null,
      },
    );
  }
}

export function buildSalesTbRefsForPremiseStart({
  tbRefs,
  tbId,
  rowId,
  premiseId,
  targetedMeterNo,
  updatedAt,
}) {
  if (!Array.isArray(tbRefs)) {
    throw controlledError(
      "SALES_TB_REFS_INVALID",
      "The Sales document has an invalid tbRefs field.",
    );
  }

  const matchingIndexes = [];

  tbRefs.forEach((reference, index) => {
    if (normalizeUpper(reference?.id) === normalizeUpper(tbId)) {
      matchingIndexes.push(index);
    }
  });

  if (matchingIndexes.length === 0) {
    throw controlledError(
      "SALES_TB_REF_NOT_FOUND",
      `The Sales document is not linked to ${tbId}.`,
    );
  }

  if (matchingIndexes.length > 1) {
    throw controlledError(
      "SALES_TB_REF_DUPLICATE",
      `The Sales document contains duplicate references to ${tbId}.`,
      { count: matchingIndexes.length },
    );
  }

  const targetIndex = matchingIndexes[0];
  const currentReference = tbRefs[targetIndex] || {};
  const currentRowId = normalizeText(currentReference?.rowId);
  const currentFieldWork = currentReference?.fieldWork || {};
  const currentStatus = normalizeUpper(
    currentFieldWork?.status || "NOT_STARTED",
  );
  const currentPremiseId = normalizeText(currentFieldWork?.premiseId);

  if (currentRowId && currentRowId !== normalizeText(rowId)) {
    throw controlledError(
      "SALES_TB_REF_ROW_CONFLICT",
      `The Sales reference for ${tbId} belongs to another TB Row.`,
      {
        existingRowId: currentRowId,
        expectedRowId: rowId,
      },
    );
  }

  if (currentStatus === "COMPLETED") {
    throw controlledError(
      "TARGETED_BATCH_EXECUTION_COMPLETED",
      `The Sales field work for ${tbId} has already completed.`,
    );
  }

  if (currentPremiseId && currentPremiseId !== normalizeText(premiseId)) {
    throw controlledError(
      "SALES_TB_REF_PREMISE_CONFLICT",
      `The Sales reference for ${tbId} is linked to another premise.`,
      {
        existingPremiseId: currentPremiseId,
        expectedPremiseId: premiseId,
      },
    );
  }

  const updatedReference = {
    ...currentReference,
    rowId,
    fieldWork: {
      ...currentFieldWork,
      status: "IN_PROGRESS",
      outcomeCode: currentFieldWork?.outcomeCode ?? null,
      outcomeLabel: currentFieldWork?.outcomeLabel ?? null,
      targetedMeterNo:
        readNullableText(
          targetedMeterNo,
          currentFieldWork?.targetedMeterNo,
        ),
      discoveredMeterNo: currentFieldWork?.discoveredMeterNo ?? null,
      meterMatch: currentFieldWork?.meterMatch ?? null,
      premiseId,
      meterId: currentFieldWork?.meterId ?? null,
      trnId: currentFieldWork?.trnId ?? null,
      submittedAt: currentFieldWork?.submittedAt ?? null,
      updatedAt,
    },
  };

  const updatedTbRefs = tbRefs.map((reference, index) =>
    index === targetIndex ? updatedReference : reference,
  );

  return {
    updatedTbRefs,
    currentReference,
    updatedReference,
    alreadyLinked:
      currentRowId === normalizeText(rowId) &&
      currentStatus === "IN_PROGRESS" &&
      currentPremiseId === normalizeText(premiseId),
  };
}

export async function createOrLinkTargetedBatchPremise({
  db,
  premiseRef,
  premisePayload,
  actorUid,
  actorName,
}) {
  const context = normalizeTargetedBatchPremiseContext(
    premisePayload?.targetedBatchContext,
  );

  assertCompleteTargetedBatchPremiseContext(context);

  const parentRef = db
    .collection(TARGETED_BATCH_COLLECTIONS.uploads)
    .doc(context.tbId);
  const rowRef = db
    .collection(TARGETED_BATCH_COLLECTIONS.rows)
    .doc(context.rowId);
  const salesRef = db
    .collection(TARGETED_BATCH_COLLECTIONS.sales)
    .doc(context.salesDocId);
  const erfRef = db
    .collection(TARGETED_BATCH_COLLECTIONS.erfs)
    .doc(context.erfId);
  const now = Timestamp.now();

  return db.runTransaction(async (transaction) => {
    const parentSnapshot = await transaction.get(parentRef);
    const rowSnapshot = await transaction.get(rowRef);
    const salesSnapshot = await transaction.get(salesRef);
    const erfSnapshot = await transaction.get(erfRef);
    const premiseSnapshot = await transaction.get(premiseRef);

    const parent = requireDocument(
      parentSnapshot,
      "TARGETED_BATCH_NOT_FOUND",
      `Targeted Batch ${context.tbId} was not found.`,
    );
    const row = requireDocument(
      rowSnapshot,
      "TARGETED_BATCH_ROW_NOT_FOUND",
      `Targeted Batch Row ${context.rowId} was not found.`,
    );
    const sales = requireDocument(
      salesSnapshot,
      "SALES_DOCUMENT_NOT_FOUND",
      `Sales document ${context.salesDocId} was not found.`,
    );
    const erf = requireDocument(
      erfSnapshot,
      "TARGETED_BATCH_ERF_NOT_FOUND",
      `Authoritative ERF ${context.erfId} was not found.`,
    );

    assertParentReady(parent, context.tbId);
    const rowExecutionStatus = assertRowReady(row, context.rowId);

    assertSameId({
      left: parent?.id || parentRef.id,
      right: context.tbId,
      code: "TARGETED_BATCH_PARENT_ID_MISMATCH",
      message: "The Targeted Batch parent ID does not match the request.",
    });

    assertSameId({
      left: row?.tbId,
      right: context.tbId,
      code: "TARGETED_BATCH_ROW_PARENT_MISMATCH",
      message: "The Targeted Batch Row belongs to another parent batch.",
    });

    assertSameId({
      left: row?.id || rowRef.id,
      right: context.rowId,
      code: "TARGETED_BATCH_ROW_ID_MISMATCH",
      message: "The Targeted Batch Row ID does not match the request.",
    });

    const salesDocId = getAuthoritativeSalesDocId(row);
    const erfId = getAuthoritativeErfId(row);

    assertSameId({
      left: salesDocId,
      right: context.salesDocId,
      code: "TARGETED_BATCH_SALES_LINK_MISMATCH",
      message: "The Targeted Batch Row points to another Sales document.",
    });

    assertSameId({
      left: erfId,
      right: context.erfId,
      code: "TARGETED_BATCH_ERF_LINK_MISMATCH",
      message: "The Targeted Batch Row points to another ERF.",
    });

    assertSameId({
      left: premisePayload?.erfId,
      right: erfId,
      code: "TARGETED_BATCH_ERF_LINK_MISMATCH",
      message: "The premise payload points to another ERF.",
    });

    const parentScope = getScope(parent, "PARENT");
    const rowScope = getScope(row, "PARENT");
    const erfScope = getScope(erf, "ERF");
    const premiseScope = getScope(premisePayload, "PREMISE");

    assertSameScope({
      parentScope,
      rowScope,
      erfScope,
      premiseScope,
    });

    const canonicalContext = buildCanonicalContext({
      parentRef,
      rowRef,
      row,
      context,
      salesDocId,
      erfId,
    });

    const existingRowPremiseId = readFirstText(row?.refs?.premiseId);

    if (
      existingRowPremiseId &&
      existingRowPremiseId !== premiseRef.id
    ) {
      throw controlledError(
        "TARGETED_BATCH_PREMISE_CONFLICT",
        `${context.rowId} is linked to another premise.`,
        {
          existingPremiseId: existingRowPremiseId,
          expectedPremiseId: premiseRef.id,
        },
      );
    }

    const salesTbRefResult = buildSalesTbRefsForPremiseStart({
      tbRefs: sales?.tbRefs,
      tbId: context.tbId,
      rowId: context.rowId,
      premiseId: premiseRef.id,
      targetedMeterNo: getAuthoritativeMeterNo(row, context),
      updatedAt: now,
    });

    let premiseNeedsWrite = !premiseSnapshot.exists;

    if (premiseSnapshot.exists) {
      const existingPremise = premiseSnapshot.data() || {};

      assertExistingPremiseCompatible({
        existingPremise,
        proposedPremise: premisePayload,
        parent,
        row,
        erf,
        canonicalContext,
      });

      premiseNeedsWrite = !coreContextMatches(
        existingPremise?.targetedBatchContext,
        canonicalContext,
      );
    }

    const rowAlreadyLinked =
      rowExecutionStatus === "IN_PROGRESS" &&
      existingRowPremiseId === premiseRef.id;
    const parentExecutionStatus = normalizeUpper(
      parent?.execution?.status || "NOT_STARTED",
    );
    const parentAlreadyStarted = parentExecutionStatus === "IN_PROGRESS";
    const fullNoOp =
      premiseSnapshot.exists &&
      !premiseNeedsWrite &&
      rowAlreadyLinked &&
      parentAlreadyStarted &&
      salesTbRefResult.alreadyLinked;

    if (fullNoOp) {
      return {
        linked: true,
        alreadyLinked: true,
        premiseCreated: false,
        tbId: context.tbId,
        rowId: context.rowId,
        salesDocId: context.salesDocId,
        erfId: context.erfId,
        executionStatus: "IN_PROGRESS",
      };
    }

    if (!premiseSnapshot.exists) {
      transaction.create(premiseRef, {
        ...premisePayload,
        targetedBatchContext: canonicalContext,
      });
    } else if (premiseNeedsWrite) {
      transaction.update(premiseRef, {
        targetedBatchContext: canonicalContext,
        "metadata.updatedAt": now.toDate().toISOString(),
        "metadata.updatedByUid": actorUid,
        "metadata.updatedByUser": actorName,
      });
    }

    if (!rowAlreadyLinked) {
      transaction.update(rowRef, {
        "execution.status": "IN_PROGRESS",
        "execution.startedAt": row?.execution?.startedAt || now,
        "execution.completedAt": null,
        "refs.premiseId": premiseRef.id,
        "metadata.updatedAt": now,
        "metadata.updatedByUid": actorUid,
        "metadata.updatedByUser": actorName,
      });
    }

    if (!parentAlreadyStarted || rowExecutionStatus === "NOT_STARTED") {
      const parentPatch = {
        "execution.status": "IN_PROGRESS",
        "execution.startedAt": parent?.execution?.startedAt || now,
        "execution.completedAt": null,
        "metadata.updatedAt": now,
        "metadata.updatedByUid": actorUid,
        "metadata.updatedByUser": actorName,
      };

      if (rowExecutionStatus === "NOT_STARTED") {
        parentPatch["counts.executionStartedRows"] =
          readNonNegativeInteger(parent?.counts?.executionStartedRows) + 1;
      }

      transaction.update(parentRef, parentPatch);
    }

    if (!salesTbRefResult.alreadyLinked) {
      transaction.update(salesRef, {
        tbRefs: salesTbRefResult.updatedTbRefs,
      });
    }

    return {
      linked: true,
      alreadyLinked: false,
      premiseCreated: !premiseSnapshot.exists,
      tbId: context.tbId,
      rowId: context.rowId,
      salesDocId: context.salesDocId,
      erfId: context.erfId,
      executionStatus: "IN_PROGRESS",
    };
  });
}

function targetedBatchActorRole(profile = {}, token = {}) {
  return normalizeUpper(
    readFirstText(
      token?.role,
      token?.userRole,
      token?.employmentRole,
      token?.employment_role,
      token?.irepsRole,
      profile?.role,
      profile?.userRole,
      profile?.profile?.employment?.role,
      profile?.employment?.role,
      profile?.employment?.position,
    ),
  );
}

function targetedBatchActorSpId(profile = {}, token = {}) {
  return readFirstText(
    token?.spId,
    token?.serviceProviderId,
    token?.employmentServiceProviderId,
    profile?.profile?.employment?.serviceProvider?.id,
    profile?.employment?.serviceProvider?.id,
    profile?.serviceProvider?.id,
  );
}

function targetedBatchTeamMemberIds(team = {}) {
  const ids = new Set();

  const add = (value) => {
    const id = normalizeText(value);
    if (id) ids.add(id);
  };

  (Array.isArray(team?.memberUids) ? team.memberUids : []).forEach(add);
  (
    Array.isArray(team?.scope?.memberUserIds)
      ? team.scope.memberUserIds
      : []
  ).forEach(add);

  [
    ...(Array.isArray(team?.members) ? team.members : []),
    ...(Array.isArray(team?.users) ? team.users : []),
  ].forEach((member) => {
    if (typeof member === "string") {
      add(member);
      return;
    }

    add(member?.uid);
    add(member?.id);
    add(member?.userId);
  });

  return ids;
}

function getTargetedBatchAllocation(parent = {}) {
  const allocation = parent?.allocation || {};
  const target = allocation?.target || {};

  return {
    type: normalizeUpper(allocation?.targetType || target?.type),
    id: readFirstText(allocation?.targetId, target?.id),
  };
}

function assertTargetedBatchExecutionAuthority({
  parent,
  actor,
  team,
}) {
  if (!["FWR", "SPV"].includes(actor?.role)) {
    throw controlledError(
      "TARGETED_BATCH_ACCESS_DENIED",
      "Targeted Batch access denied.",
      { role: actor?.role || "UNKNOWN" },
    );
  }

  const allocation = getTargetedBatchAllocation(parent);

  if (!allocation.id || !["TEAM", "SP"].includes(allocation.type)) {
    throw controlledError(
      "TARGETED_BATCH_ALLOCATION_TARGET_INVALID",
      "A TEAM or Service Provider allocation is required.",
      {
        targetType: allocation.type || null,
        targetId: allocation.id || null,
      },
    );
  }

  if (
    allocation.type === "SP" &&
    sameId(actor?.spId, allocation.id)
  ) {
    return;
  }

  if (
    allocation.type === "TEAM" &&
    targetedBatchTeamMemberIds(team).has(actor?.uid)
  ) {
    return;
  }

  throw controlledError(
    "TARGETED_BATCH_NOT_ASSIGNED_TO_ACTOR",
    "The Targeted Batch is not assigned to this field user.",
    {
      targetType: allocation.type,
      targetId: allocation.id,
      actorUid: actor?.uid || null,
      actorSpId: actor?.spId || null,
    },
  );
}

function findSalesTargetedBatchReference({
  tbRefs,
  tbId,
  rowId,
}) {
  if (!Array.isArray(tbRefs)) {
    throw controlledError(
      "SALES_TB_REFS_INVALID",
      "The Sales document has an invalid tbRefs field.",
    );
  }

  const matches = [];

  tbRefs.forEach((reference, index) => {
    if (sameId(reference?.id, tbId)) {
      matches.push({ index, reference: reference || {} });
    }
  });

  if (matches.length === 0) {
    throw controlledError(
      "SALES_TB_REF_NOT_FOUND",
      `The Sales document is not linked to ${tbId}.`,
    );
  }

  if (matches.length > 1) {
    throw controlledError(
      "SALES_TB_REF_DUPLICATE",
      `The Sales document contains duplicate references to ${tbId}.`,
      { count: matches.length },
    );
  }

  const match = matches[0];
  const existingRowId = normalizeText(match.reference?.rowId);

  if (existingRowId && !sameId(existingRowId, rowId)) {
    throw controlledError(
      "SALES_TB_REF_ROW_CONFLICT",
      `The Sales reference for ${tbId} belongs to another TB Row.`,
      {
        existingRowId,
        expectedRowId: rowId,
      },
    );
  }

  return match;
}

function assertTargetedBatchMeterDiscoveryCorrelations({
  parentRef,
  rowRef,
  salesRef,
  premiseRef,
  context,
  parent,
  row,
  sales,
  premise,
}) {
  assertSameId({
    left: parent?.id || parentRef.id,
    right: context.tbId,
    code: "TARGETED_BATCH_PARENT_ID_MISMATCH",
    message: "The Targeted Batch parent ID does not match the request.",
  });

  assertSameId({
    left: row?.tbId,
    right: context.tbId,
    code: "TARGETED_BATCH_ROW_PARENT_MISMATCH",
    message: "The Targeted Batch Row belongs to another parent batch.",
  });

  assertSameId({
    left: row?.id || rowRef.id,
    right: context.rowId,
    code: "TARGETED_BATCH_ROW_ID_MISMATCH",
    message: "The Targeted Batch Row ID does not match the request.",
  });

  assertSameId({
    left: getAuthoritativeSalesDocId(row),
    right: salesRef.id,
    code: "TARGETED_BATCH_SALES_LINK_MISMATCH",
    message: "The Targeted Batch Row points to another Sales document.",
  });

  assertSameId({
    left: context.salesDocId,
    right: salesRef.id,
    code: "TARGETED_BATCH_SALES_LINK_MISMATCH",
    message: "The Targeted Batch context points to another Sales document.",
  });

  assertSameId({
    left: getAuthoritativeErfId(row),
    right: context.erfId,
    code: "TARGETED_BATCH_ERF_LINK_MISMATCH",
    message: "The Targeted Batch Row points to another ERF.",
  });

  assertSameId({
    left: row?.refs?.premiseId,
    right: premiseRef.id,
    code: "TARGETED_BATCH_PREMISE_LINK_MISMATCH",
    message: "The Targeted Batch Row points to another premise.",
  });

  assertSameId({
    left: premise?.erfId,
    right: context.erfId,
    code: "TARGETED_BATCH_ERF_LINK_MISMATCH",
    message: "The linked premise belongs to another ERF.",
  });

  const premiseContext = premise?.targetedBatchContext;

  if (
    !premiseContext ||
    !coreContextMatches(premiseContext, context)
  ) {
    throw controlledError(
      "TARGETED_BATCH_PREMISE_CONTEXT_MISMATCH",
      "The linked premise does not carry the expected Targeted Batch context.",
      {
        premiseId: premiseRef.id,
        expectedContext: context,
        existingContext: premiseContext || null,
      },
    );
  }

  findSalesTargetedBatchReference({
    tbRefs: sales?.tbRefs,
    tbId: context.tbId,
    rowId: context.rowId,
  });
}

export async function validateTargetedBatchMeterDiscoverySubmission({
  db,
  request,
  data,
}) {
  const rawContext = data?.targetedBatchContext;

  if (!rawContext) {
    return {
      isTargetedBatch: false,
      targetedBatchContext: null,
    };
  }

  const context = normalizeTargetedBatchPremiseContext(rawContext);

  if (!context) {
    throw controlledError(
      "TARGETED_BATCH_CONTEXT_INVALID",
      "The Meter Discovery Targeted Batch context is invalid.",
    );
  }

  assertCompleteTargetedBatchPremiseContext(context);

  if (data?.accessData?.access?.hasAccess !== "yes") {
    throw controlledError(
      "TARGETED_BATCH_USE_NO_ACCESS_FLOW",
      "Use the Targeted Batch No Access action when the site cannot be accessed.",
    );
  }

  const uid = request?.auth?.uid;

  if (!uid) {
    throw controlledError(
      "UNAUTHENTICATED",
      "Authentication is required.",
    );
  }

  const premiseId = readFirstText(
    data?.accessData?.premise?.id,
    context?.premiseId,
  );

  if (!premiseId || premiseId === "NAv") {
    throw controlledError(
      "TARGETED_BATCH_PREMISE_LINK_MISSING",
      "A linked Targeted Batch premise is required.",
    );
  }

  const parentRef = db
    .collection(TARGETED_BATCH_COLLECTIONS.uploads)
    .doc(context.tbId);
  const rowRef = db
    .collection(TARGETED_BATCH_COLLECTIONS.rows)
    .doc(context.rowId);
  const salesRef = db
    .collection(TARGETED_BATCH_COLLECTIONS.sales)
    .doc(context.salesDocId);
  const erfRef = db
    .collection(TARGETED_BATCH_COLLECTIONS.erfs)
    .doc(context.erfId);
  const premiseRef = db.collection("premises").doc(premiseId);

  const [
    parentSnapshot,
    rowSnapshot,
    salesSnapshot,
    erfSnapshot,
    premiseSnapshot,
  ] = await Promise.all([
    parentRef.get(),
    rowRef.get(),
    salesRef.get(),
    erfRef.get(),
    premiseRef.get(),
  ]);

  const parent = requireDocument(
    parentSnapshot,
    "TARGETED_BATCH_NOT_FOUND",
    `Targeted Batch ${context.tbId} was not found.`,
  );
  const row = requireDocument(
    rowSnapshot,
    "TARGETED_BATCH_ROW_NOT_FOUND",
    `Targeted Batch Row ${context.rowId} was not found.`,
  );
  const sales = requireDocument(
    salesSnapshot,
    "SALES_DOCUMENT_NOT_FOUND",
    `Sales document ${context.salesDocId} was not found.`,
  );
  const erf = requireDocument(
    erfSnapshot,
    "TARGETED_BATCH_ERF_NOT_FOUND",
    `Authoritative ERF ${context.erfId} was not found.`,
  );
  const premise = requireDocument(
    premiseSnapshot,
    "TARGETED_BATCH_PREMISE_NOT_FOUND",
    `Premise ${premiseId} was not found.`,
  );

  assertParentReady(parent, context.tbId);
  assertRowReady(row, context.rowId);

  assertTargetedBatchMeterDiscoveryCorrelations({
    parentRef,
    rowRef,
    salesRef,
    premiseRef,
    context,
    parent,
    row,
    sales,
    premise,
  });

  assertSameScope({
    parentScope: getScope(parent, "PARENT"),
    rowScope: getScope(row, "PARENT"),
    erfScope: getScope(erf, "ERF"),
    premiseScope: getScope(premise, "PREMISE"),
  });

  const profile = await findActorProfile(db, uid);
  const token = request?.auth?.token || {};
  const actor = {
    uid,
    name: getActorNameFromRequest(request, profile),
    role: targetedBatchActorRole(profile, token),
    spId: targetedBatchActorSpId(profile, token),
  };
  const allocation = getTargetedBatchAllocation(parent);
  let team = {};

  if (allocation.type === "TEAM" && allocation.id) {
    const teamSnapshot = await db
      .collection("teams")
      .doc(allocation.id)
      .get();

    team = requireDocument(
      teamSnapshot,
      "TARGETED_BATCH_TEAM_NOT_FOUND",
      "The allocated TEAM was not found.",
    );
  }

  assertTargetedBatchExecutionAuthority({
    parent,
    actor,
    team,
  });

  const canonicalContext = {
    ...buildCanonicalContext({
      parentRef,
      rowRef,
      row,
      context,
      salesDocId: salesRef.id,
      erfId: context.erfId,
    }),
    premiseId,
  };

  return {
    isTargetedBatch: true,
    targetedBatchContext: canonicalContext,
    actor,
  };
}

export function buildSalesTbRefsForMeterDiscoveryCompletion({
  tbRefs,
  tbId,
  rowId,
  premiseId,
  meterId,
  trnId,
  targetedMeterNo,
  discoveredMeterNo,
  updatedAt,
}) {
  const match = findSalesTargetedBatchReference({
    tbRefs,
    tbId,
    rowId,
  });
  const currentReference = match.reference || {};
  const currentFieldWork = currentReference?.fieldWork || {};

  if (
    currentReference?.fieldWork !== undefined &&
    (
      !currentReference.fieldWork ||
      typeof currentReference.fieldWork !== "object" ||
      Array.isArray(currentReference.fieldWork)
    )
  ) {
    throw controlledError(
      "FIELDWORK_INVALID",
      "The Sales fieldWork value is invalid.",
    );
  }

  const currentStatus = normalizeUpper(
    currentFieldWork?.status || "NOT_STARTED",
  );
  const currentPremiseId = normalizeText(currentFieldWork?.premiseId);
  const currentMeterId = normalizeText(currentFieldWork?.meterId);
  const currentTrnId = normalizeText(currentFieldWork?.trnId);

  if (currentPremiseId && !sameId(currentPremiseId, premiseId)) {
    throw controlledError(
      "SALES_TB_REF_PREMISE_CONFLICT",
      "The Sales Targeted Batch reference points to another premise.",
      {
        existingPremiseId: currentPremiseId,
        expectedPremiseId: premiseId,
      },
    );
  }

  if (currentMeterId && !sameId(currentMeterId, meterId)) {
    throw controlledError(
      "SALES_TB_REF_METER_CONFLICT",
      "The Sales Targeted Batch reference points to another meter.",
      {
        existingMeterId: currentMeterId,
        expectedMeterId: meterId,
      },
    );
  }

  if (currentTrnId && !sameId(currentTrnId, trnId)) {
    throw controlledError(
      "SALES_TB_REF_TRN_CONFLICT",
      "The Sales Targeted Batch reference points to another TRN.",
      {
        existingTrnId: currentTrnId,
        expectedTrnId: trnId,
      },
    );
  }

  const targetedNormalized = normalizeMeterNo(targetedMeterNo);
  const discoveredNormalized = normalizeMeterNo(discoveredMeterNo);
  const meterMatch =
    Boolean(targetedNormalized && discoveredNormalized) &&
    targetedNormalized === discoveredNormalized;
  const alreadyCompleted =
    currentStatus === "COMPLETED" &&
    sameId(currentPremiseId, premiseId) &&
    sameId(currentMeterId, meterId) &&
    sameId(currentTrnId, trnId);

  const updatedReference = {
    ...currentReference,
    rowId,
    fieldWork: {
      ...currentFieldWork,
      status: "COMPLETED",
      outcomeCode: "METER_DISCOVERED",
      outcomeLabel: "Meter Discovered",
      targetedMeterNo:
        readNullableText(
          targetedMeterNo,
          currentFieldWork?.targetedMeterNo,
        ),
      discoveredMeterNo:
        readNullableText(
          discoveredMeterNo,
          currentFieldWork?.discoveredMeterNo,
        ),
      meterMatch,
      premiseId,
      meterId,
      trnId,
      submittedAt: currentFieldWork?.submittedAt || updatedAt,
      updatedAt,
    },
  };

  const updatedTbRefs = tbRefs.map((reference, index) =>
    index === match.index ? updatedReference : reference,
  );

  return {
    updatedTbRefs,
    currentReference,
    updatedReference,
    alreadyCompleted,
    meterMatch,
  };
}

function getTargetedBatchCompletionTarget(parent = {}) {
  const candidates = [
    parent?.counts?.allocatableRows,
    parent?.counts?.acceptedRows,
    parent?.counts?.allocatedRows,
    parent?.counts?.totalRows,
  ]
    .map((value) => readNonNegativeInteger(value))
    .filter((value) => value > 0);

  return candidates[0] || 0;
}

export async function completeTargetedBatchMeterDiscoveryInTransaction({
  transaction,
  db,
  trnData,
  astId,
  normalizedMeterNo,
  now = Timestamp.now(),
}) {
  const rawContext = trnData?.targetedBatchContext;

  if (!rawContext) {
    return {
      applied: false,
      alreadyCompleted: false,
    };
  }

  const context = normalizeTargetedBatchPremiseContext(rawContext);

  if (!context) {
    throw controlledError(
      "TARGETED_BATCH_CONTEXT_INVALID",
      "The Meter Discovery TRN carries invalid Targeted Batch context.",
    );
  }

  assertCompleteTargetedBatchPremiseContext(context);

  const premiseId = readFirstText(
    trnData?.accessData?.premise?.id,
    context?.premiseId,
  );
  const trnId = normalizeText(trnData?.id || astId);
  const discoveredMeterNo = readFirstText(
    trnData?.ast?.astData?.astNo,
    normalizedMeterNo,
  );

  if (!premiseId || !trnId || !astId || !discoveredMeterNo) {
    throw controlledError(
      "TARGETED_BATCH_METER_DISCOVERY_RESULT_INCOMPLETE",
      "The Meter Discovery result is missing its premise, meter or TRN linkage.",
      {
        premiseId: premiseId || null,
        trnId: trnId || null,
        meterId: astId || null,
        discoveredMeterNo: discoveredMeterNo || null,
      },
    );
  }

  const parentRef = db
    .collection(TARGETED_BATCH_COLLECTIONS.uploads)
    .doc(context.tbId);
  const rowRef = db
    .collection(TARGETED_BATCH_COLLECTIONS.rows)
    .doc(context.rowId);
  const salesRef = db
    .collection(TARGETED_BATCH_COLLECTIONS.sales)
    .doc(context.salesDocId);
  const premiseRef = db.collection("premises").doc(premiseId);

  const [
    parentSnapshot,
    rowSnapshot,
    salesSnapshot,
    premiseSnapshot,
  ] = await Promise.all([
    transaction.get(parentRef),
    transaction.get(rowRef),
    transaction.get(salesRef),
    transaction.get(premiseRef),
  ]);

  const parent = requireDocument(
    parentSnapshot,
    "TARGETED_BATCH_NOT_FOUND",
    `Targeted Batch ${context.tbId} was not found.`,
  );
  const row = requireDocument(
    rowSnapshot,
    "TARGETED_BATCH_ROW_NOT_FOUND",
    `Targeted Batch Row ${context.rowId} was not found.`,
  );
  const sales = requireDocument(
    salesSnapshot,
    "SALES_DOCUMENT_NOT_FOUND",
    `Sales document ${context.salesDocId} was not found.`,
  );
  const premise = requireDocument(
    premiseSnapshot,
    "TARGETED_BATCH_PREMISE_NOT_FOUND",
    `Premise ${premiseId} was not found.`,
  );

  assertTargetedBatchMeterDiscoveryCorrelations({
    parentRef,
    rowRef,
    salesRef,
    premiseRef,
    context,
    parent,
    row,
    sales,
    premise,
  });

  const rowStatus = normalizeUpper(
    row?.execution?.status || "NOT_STARTED",
  );
  const existingRowMeterId = normalizeText(row?.refs?.meterId);
  const existingRowTrnId = normalizeText(row?.refs?.trnId);
  const existingRowPremiseId = normalizeText(row?.refs?.premiseId);

  const salesCompletion = buildSalesTbRefsForMeterDiscoveryCompletion({
    tbRefs: sales?.tbRefs,
    tbId: context.tbId,
    rowId: context.rowId,
    premiseId,
    meterId: astId,
    trnId,
    targetedMeterNo: getAuthoritativeMeterNo(row, context),
    discoveredMeterNo,
    updatedAt: now,
  });

  if (rowStatus === "COMPLETED") {
    const rowMatches =
      sameId(existingRowPremiseId, premiseId) &&
      sameId(existingRowMeterId, astId) &&
      sameId(existingRowTrnId, trnId);

    if (!rowMatches || !salesCompletion.alreadyCompleted) {
      throw controlledError(
        "TARGETED_BATCH_COMPLETION_CONFLICT",
        "The Targeted Batch row is already completed with different linkage.",
        {
          rowId: context.rowId,
          existingPremiseId: existingRowPremiseId || null,
          existingMeterId: existingRowMeterId || null,
          existingTrnId: existingRowTrnId || null,
          expectedPremiseId: premiseId,
          expectedMeterId: astId,
          expectedTrnId: trnId,
        },
      );
    }

    return {
      applied: true,
      alreadyCompleted: true,
      tbId: context.tbId,
      rowId: context.rowId,
      salesDocId: context.salesDocId,
      premiseId,
      meterId: astId,
      trnId,
      meterMatch: salesCompletion.meterMatch,
      batchCompleted:
        normalizeUpper(parent?.execution?.status) === "COMPLETED",
    };
  }

  assertParentReady(parent, context.tbId);
  assertRowReady(row, context.rowId);

  const actorUid =
    trnData?.metadata?.updatedByUid ||
    trnData?.metadata?.createdByUid ||
    "SYSTEM";
  const actorName =
    trnData?.metadata?.updatedByUser ||
    trnData?.metadata?.createdByUser ||
    "SYSTEM";

  const currentCompletedRows = readNonNegativeInteger(
    parent?.counts?.completedRows,
  );
  const currentStartedRows = readNonNegativeInteger(
    parent?.counts?.executionStartedRows,
  );
  const nextCompletedRows = currentCompletedRows + 1;
  const completionTarget = getTargetedBatchCompletionTarget(parent);
  const batchCompleted =
    completionTarget > 0 &&
    nextCompletedRows >= completionTarget;

  transaction.update(rowRef, {
    "execution.status": "COMPLETED",
    "execution.startedAt": row?.execution?.startedAt || now,
    "execution.completedAt": now,
    "execution.outcome": "METER_DISCOVERED",
    "refs.premiseId": premiseId,
    "refs.meterId": astId,
    "refs.trnId": trnId,
    "metadata.updatedAt": now,
    "metadata.updatedByUid": actorUid,
    "metadata.updatedByUser": actorName,
  });

  transaction.update(salesRef, {
    tbRefs: salesCompletion.updatedTbRefs,
  });

  const parentPatch = {
    "counts.completedRows": nextCompletedRows,
    "execution.status": batchCompleted ? "COMPLETED" : "IN_PROGRESS",
    "execution.startedAt": parent?.execution?.startedAt || now,
    "execution.completedAt": batchCompleted ? now : null,
    "metadata.updatedAt": now,
    "metadata.updatedByUid": actorUid,
    "metadata.updatedByUser": actorName,
  };

  if (rowStatus === "NOT_STARTED") {
    parentPatch["counts.executionStartedRows"] =
      currentStartedRows + 1;
  }

  transaction.update(parentRef, parentPatch);

  return {
    applied: true,
    alreadyCompleted: false,
    tbId: context.tbId,
    rowId: context.rowId,
    salesDocId: context.salesDocId,
    premiseId,
    meterId: astId,
    trnId,
    meterMatch: salesCompletion.meterMatch,
    completedRows: nextCompletedRows,
    completionTarget,
    batchCompleted,
  };
}

