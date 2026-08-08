import crypto from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";

export const TARGETED_BATCH_COLLECTIONS = Object.freeze({
  uploads: "tb_uploads",
  rows: "tb_rows",
  sales: "sales-all-meters",
  erfs: "ireps_erfs",
  users: "users",
});

export const TARGETED_BATCH_SOURCE_TYPES = Object.freeze({
  prepaidSales: "PREPAID_SALES",
});

export const TARGETED_BATCH_CREATION_STATES = Object.freeze({
  creating: "CREATING",
  ready: "READY",
  failed: "CREATION_FAILED",
});

export const TARGETED_BATCH_ALLOWED_METER_TYPES = Object.freeze([
  "PREPAID",
  "CONVENTIONAL",
]);

export const TARGETED_BATCH_MAX_ROWS = 1000;

const TB_ID_PATTERN = /^TGB_[0-9]{8}_[0-9]{6}_[A-Z0-9]{4}$/;
const CREATION_GROUP_ID_PATTERN =
  /^TBCG_[0-9]{8}_[0-9]{6}_[A-Z0-9]{4}$/;
const LM_PCODE_PATTERN = /^ZA[0-9]+$/;
const WARD_PCODE_PATTERN = /^ZA[0-9]+$/;
const MONTH_KEY_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

export function normalizeText(value) {
  return String(value ?? "").trim();
}

export function normalizeUpper(value) {
  return normalizeText(value).toUpperCase();
}

export function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeSalesId(value) {
  return normalizeUpper(value).replace(/[^A-Z0-9]/g, "");
}

export function normalizeMeterNo(value) {
  return normalizeUpper(value).replace(/\s+/g, "");
}

export function normalizeLmPcode(value) {
  return normalizeUpper(value);
}

export function normalizeWardPcode(value) {
  return normalizeUpper(value);
}

export function normalizeWardNumber(value) {
  const text = normalizeText(value).replace(/^WARD\s*/i, "");

  if (!text) return "";
  if (/^\d+$/.test(text)) return String(Number(text));
  return normalizeUpper(text);
}

export function deriveWardNumberFromPcode(wardPcode, lmPcode) {
  const normalizedWardPcode = normalizeWardPcode(wardPcode);
  const normalizedLmPcode = normalizeLmPcode(lmPcode);

  if (
    !normalizedWardPcode ||
    !normalizedLmPcode ||
    !normalizedWardPcode.startsWith(normalizedLmPcode) ||
    normalizedWardPcode === normalizedLmPcode
  ) {
    return "";
  }

  return normalizeWardNumber(
    normalizedWardPcode.slice(normalizedLmPcode.length),
  );
}

export function normalizeMonth(value) {
  const text = normalizeText(value);
  return MONTH_KEY_PATTERN.test(text) ? text : null;
}

export function buildFailureResult(code, message, extra = {}) {
  return {
    success: false,
    code: code || "TARGETED_BATCH_CREATE_FAILED",
    message: message || "Targeted Batch creation failed",
    ...extra,
  };
}

export function buildSuccessResult(message, extra = {}) {
  return {
    success: true,
    code: extra.code || "TARGETED_BATCH_CREATED",
    message: message || "Targeted Batch created successfully",
    ...extra,
  };
}

export function getActorNameFromRequest(request, profile = {}) {
  const token = request?.auth?.token || {};

  return (
    profile?.profile?.displayName ||
    profile?.displayName ||
    profile?.name ||
    token?.name ||
    token?.displayName ||
    token?.email ||
    request?.auth?.uid ||
    "SYSTEM"
  );
}

function readFirstText(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }

  return "";
}

function extractRole({ profile = {}, token = {} }) {
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

function extractRelationshipType({ profile = {}, token = {} }) {
  return normalizeUpper(
    readFirstText(
      token?.serviceProviderRelationshipType,
      token?.relationshipType,
      token?.spRelationshipType,
      token?.employmentServiceProviderRelationshipType,
      profile?.profile?.employment?.serviceProvider?.relationshipType,
      profile?.employment?.serviceProvider?.relationshipType,
      profile?.employment?.serviceProvider?.clientRelationshipType,
      profile?.serviceProvider?.relationshipType,
    ),
  );
}

function extractClientType({ profile = {}, token = {} }) {
  return normalizeUpper(
    readFirstText(
      token?.serviceProviderClientType,
      token?.clientType,
      token?.spClientType,
      profile?.profile?.employment?.serviceProvider?.clientType,
      profile?.employment?.serviceProvider?.clientType,
      profile?.serviceProvider?.clientType,
    ),
  );
}

export async function findActorProfile(db, uid) {
  if (!uid) return {};

  const candidatePaths = [
    `users/${uid}`,
    `userProfiles/${uid}`,
    `profiles/${uid}`,
  ];

  for (const path of candidatePaths) {
    const snapshot = await db.doc(path).get();

    if (snapshot.exists) {
      return snapshot.data() || {};
    }
  }

  return {};
}

export async function resolveTargetedBatchCreateAuthority({ db, request }) {
  const uid = request?.auth?.uid;
  const token = request?.auth?.token || {};
  const profile = await findActorProfile(db, uid);
  const role = extractRole({ profile, token });
  const relationshipType = extractRelationshipType({ profile, token });
  const clientType = extractClientType({ profile, token });

  const isMnc =
    relationshipType === "MNC" ||
    clientType === "MNC" ||
    profile?.profile?.employment?.serviceProvider?.isMnc === true ||
    profile?.employment?.serviceProvider?.isMnc === true ||
    profile?.serviceProvider?.isMnc === true;

  return {
    ok: role === "MNG" || (role === "SPV" && isMnc),
    role: role || "UNKNOWN",
    relationshipType: relationshipType || "UNKNOWN",
    clientType: clientType || "UNKNOWN",
    isMnc,
    profile,
  };
}

export function buildTbRowId(tbId, rowNo) {
  const suffix = normalizeUpper(tbId).replace(/^TGB_/, "");
  const sequence = String(Number(rowNo) || 0).padStart(6, "0");
  return `TBR_${suffix}_${sequence}`;
}

export function buildCreationFingerprint({
  tbId,
  lmPcode,
  wardPcode,
  creationGroupId,
  salesAllMeterIds,
}) {
  const payload = JSON.stringify({
    tbId,
    lmPcode,
    wardPcode,
    creationGroupId,
    salesAllMeterIds,
  });

  return crypto.createHash("sha256").update(payload).digest("hex").toUpperCase();
}

function uniqueValues(values = []) {
  return [...new Set(values)];
}

function getDraftInput(data = {}) {
  return data?.draft && typeof data.draft === "object" ? data.draft : data;
}

function getSalesIds(draft = {}) {
  const candidates =
    draft?.authoritativeIds?.salesAllMeterIds ||
    draft?.salesAllMeterIds ||
    draft?.selectedSalesAllMeterIds ||
    [];

  return safeArray(candidates).map(normalizeSalesId);
}

function getDisplayRows(draft = {}) {
  return safeArray(draft?.displayRows || draft?.rows);
}

function getProposedBatches(draft = {}) {
  return safeArray(draft?.proposedBatches);
}

function getRowSalesId(row = {}) {
  return normalizeSalesId(
    row?.salesAllMeterId ||
      row?.sourceSalesAllMeterId ||
      row?.master?.id ||
      row?.meterNoNormalized ||
      row?.meterNo ||
      row?.id,
  );
}

function arraysEqual(left = [], right = []) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function validateCreateTargetedBatchPayload(data = {}) {
  const draft = getDraftInput(data);
  const sourceType = normalizeUpper(
    draft?.source?.type || draft?.sourceType || data?.sourceType,
  );
  const sourceLabel = readFirstText(
    draft?.source?.label,
    draft?.sourceLabel,
    "Prepaid Sales",
  );
  const sourceId =
    readFirstText(draft?.source?.sourceId, draft?.sourceId) || null;
  const fileName =
    readFirstText(draft?.source?.fileName, draft?.fileName) || null;
  const lmPcode = normalizeLmPcode(
    draft?.scope?.lmPcode || draft?.lmPcode || data?.lmPcode,
  );
  const lmName = readFirstText(
    draft?.scope?.lmName,
    draft?.lmName,
    data?.lmName,
    "NAv",
  );
  const selectionReason = readFirstText(
    draft?.selection?.reason,
    draft?.selectionReason,
    "NAv",
  );
  const salesPeriodFrom = normalizeMonth(
    draft?.selection?.salesPeriodFrom ?? draft?.salesPeriodFrom,
  );
  const salesPeriodTo = normalizeMonth(
    draft?.selection?.salesPeriodTo ?? draft?.salesPeriodTo,
  );
  const validation = draft?.validation || {};
  const rootRows = getDisplayRows(draft);
  const rootSalesIds = getSalesIds(draft);
  const proposedBatchInputs = getProposedBatches(draft);
  const creationGroupId = normalizeUpper(
    draft?.creationGroup?.id || draft?.creationGroupId,
  );
  const errors = [];

  if (sourceType !== TARGETED_BATCH_SOURCE_TYPES.prepaidSales) {
    errors.push(
      "Only PREPAID_SALES Targeted Batch creation is currently supported.",
    );
  }

  if (!LM_PCODE_PATTERN.test(lmPcode)) {
    errors.push("A valid LM pcode is required.");
  }

  if (!CREATION_GROUP_ID_PATTERN.test(creationGroupId)) {
    errors.push("A valid Targeted Batch creation-group ID is required.");
  }

  if (!selectionReason || selectionReason === "NAv") {
    errors.push("The Targeted Batch selection reason is required.");
  }

  if (
    validation?.passed !== true &&
    normalizeUpper(validation?.status) !== "PASSED"
  ) {
    errors.push("The confirmed TB Draft validation status must be PASSED.");
  }

  if (proposedBatchInputs.length < 1) {
    errors.push("The confirmed TB Draft has no proposed ward batches.");
  }

  const seenBatchIds = new Set();
  const seenBatchKeys = new Set();
  const seenSalesIds = new Set();
  const normalizedBatches = proposedBatchInputs.map((batch, batchIndex) => {
    const batchLabel = `Proposed batch ${batchIndex + 1}`;
    const tbId = normalizeUpper(batch?.tbId || batch?.id);
    const draftBatchKey = readFirstText(batch?.draftBatchKey);
    const batchLmPcode = normalizeLmPcode(
      batch?.scope?.lmPcode || batch?.lmPcode,
    );
    const batchLmName = readFirstText(
      batch?.scope?.lmName,
      batch?.lmName,
      lmName,
      "NAv",
    );
    const wardPcode = normalizeWardPcode(
      batch?.scope?.wardPcode || batch?.wardPcode,
    );
    const proposedWardNumber = normalizeWardNumber(
      batch?.scope?.wardNumber || batch?.wardNumber,
    );
    const derivedWardNumber = deriveWardNumberFromPcode(
      wardPcode,
      batchLmPcode,
    );
    const wardNumber = proposedWardNumber || derivedWardNumber;
    const wardName = readFirstText(
      batch?.scope?.wardName,
      batch?.wardName,
      wardNumber ? `Ward ${wardNumber}` : "",
    );
    const rows = safeArray(batch?.rows);
    const salesAllMeterIds = safeArray(batch?.salesAllMeterIds).map(
      normalizeSalesId,
    );

    if (!TB_ID_PATTERN.test(tbId)) {
      errors.push(`${batchLabel} has an invalid Targeted Batch ID.`);
    }

    if (!draftBatchKey) {
      errors.push(`${batchLabel} has no draft batch key.`);
    }

    if (seenBatchIds.has(tbId)) {
      errors.push(`${batchLabel} repeats Targeted Batch ID ${tbId}.`);
    }
    seenBatchIds.add(tbId);

    if (seenBatchKeys.has(draftBatchKey)) {
      errors.push(`${batchLabel} repeats draft batch key ${draftBatchKey}.`);
    }
    seenBatchKeys.add(draftBatchKey);

    if (batchLmPcode !== lmPcode) {
      errors.push(`${batchLabel} does not match the root LM scope.`);
    }

    if (
      !WARD_PCODE_PATTERN.test(wardPcode) ||
      !wardPcode.startsWith(batchLmPcode) ||
      wardPcode === batchLmPcode
    ) {
      errors.push(`${batchLabel} has an invalid ward pcode.`);
    }

    if (!wardNumber) {
      errors.push(`${batchLabel} has no ward number.`);
    }

    if (
      proposedWardNumber &&
      derivedWardNumber &&
      proposedWardNumber !== derivedWardNumber
    ) {
      errors.push(`${batchLabel} has conflicting ward scope values.`);
    }

    if (rows.length < 1) {
      errors.push(`${batchLabel} must contain at least one row.`);
    }

    if (rows.length > TARGETED_BATCH_MAX_ROWS) {
      errors.push(
        `${batchLabel} may contain at most ${TARGETED_BATCH_MAX_ROWS} rows.`,
      );
    }

    if (salesAllMeterIds.length !== rows.length) {
      errors.push(`${batchLabel} Sales ID count does not match its row count.`);
    }

    const normalizedRows = rows.map((row, rowIndex) => {
      const expectedSalesId = salesAllMeterIds[rowIndex] || "";
      const rowSalesId = getRowSalesId(row);
      const rowWardPcode = normalizeWardPcode(row?.wardPcode);
      const rowWardNumber = normalizeWardNumber(row?.wardNumber);
      const rowProposedTbId = normalizeUpper(row?.proposedTbId);
      const rowLmPcode = normalizeLmPcode(row?.lmPcode || batchLmPcode);

      if (!expectedSalesId) {
        errors.push(`${batchLabel} row ${rowIndex + 1} has no Sales ID.`);
      }

      if (rowSalesId !== expectedSalesId) {
        errors.push(
          `${batchLabel} row ${rowIndex + 1} does not match its ordered Sales ID.`,
        );
      }

      if (seenSalesIds.has(expectedSalesId)) {
        errors.push(
          `Sales source ${expectedSalesId || "NAv"} appears in more than one proposed batch.`,
        );
      }
      if (expectedSalesId) seenSalesIds.add(expectedSalesId);

      if (rowLmPcode !== batchLmPcode) {
        errors.push(`${batchLabel} row ${rowIndex + 1} crosses the LM scope.`);
      }

      if (rowWardPcode !== wardPcode) {
        errors.push(
          `${batchLabel} row ${rowIndex + 1} crosses the proposed ward boundary.`,
        );
      }

      if (rowWardNumber !== wardNumber) {
        errors.push(
          `${batchLabel} row ${rowIndex + 1} has a conflicting ward number.`,
        );
      }

      if (rowProposedTbId !== tbId) {
        errors.push(
          `${batchLabel} row ${rowIndex + 1} has a conflicting proposed batch ID.`,
        );
      }

      return {
        ...row,
        rowNo: rowIndex + 1,
        salesAllMeterId: expectedSalesId,
        lmPcode: batchLmPcode,
        wardPcode,
        wardNumber,
        wardName,
        proposedTbId: tbId,
        draftBatchKey,
      };
    });

    return {
      tbId,
      draftBatchKey,
      sequence: Number(batch?.sequence || batchIndex + 1),
      source: {
        type: sourceType,
        label: sourceLabel,
        sourceId,
        fileName,
      },
      scope: {
        lmPcode: batchLmPcode,
        lmName: batchLmName,
        wardPcode,
        wardNumber,
        wardName,
      },
      selection: {
        reason: selectionReason,
        salesPeriodFrom,
        salesPeriodTo,
      },
      validation: {
        status: "PASSED",
        fileDecision: null,
        errors: safeArray(validation?.errors)
          .map(normalizeText)
          .filter(Boolean),
        warnings: safeArray(validation?.warnings)
          .map(normalizeText)
          .filter(Boolean),
      },
      salesAllMeterIds,
      rows: normalizedRows,
      expectedRows: normalizedRows.length,
      creationGroupId,
      creationGroupBatchCount: proposedBatchInputs.length,
    };
  });

  const flattenedRows = normalizedBatches.flatMap((batch) => batch.rows);
  const flattenedSalesIds = normalizedBatches.flatMap(
    (batch) => batch.salesAllMeterIds,
  );

  if (rootRows.length !== flattenedRows.length) {
    errors.push(
      "The root TB Draft row count does not match the proposed batch plan.",
    );
  }

  if (!arraysEqual(rootSalesIds, flattenedSalesIds)) {
    errors.push(
      "The root Sales ID order does not match the proposed batch plan.",
    );
  }

  if (errors.length > 0) {
    return {
      ok: false,
      code: "INVALID_TARGETED_BATCH_REQUEST",
      message: errors.join(" "),
      errors: uniqueValues(errors),
    };
  }

  return {
    ok: true,
    creationGroupId,
    source: {
      type: sourceType,
      label: sourceLabel,
      sourceId,
      fileName,
    },
    scope: {
      lmPcode,
      lmName,
    },
    selection: {
      reason: selectionReason,
      salesPeriodFrom,
      salesPeriodTo,
    },
    validation: {
      status: "PASSED",
      fileDecision: null,
      errors: safeArray(validation?.errors).map(normalizeText).filter(Boolean),
      warnings: safeArray(validation?.warnings)
        .map(normalizeText)
        .filter(Boolean),
    },
    proposedBatches: normalizedBatches,
    salesAllMeterIds: flattenedSalesIds,
    rows: flattenedRows,
    expectedRows: flattenedRows.length,
    expectedBatches: normalizedBatches.length,
  };
}

export function getDemoSalesLmPcode(data = {}) {
  return normalizeLmPcode(
    data?.lmPcode ||
      data?.LmPcode ||
      data?.LM_PCODE ||
      data?.municipality?.lmPcode ||
      data?.scope?.lmPcode,
  );
}

export function getDemoSalesMeterNo(data = {}, fallbackId = "") {
  return normalizeMeterNo(
    data?.meterNo ||
      data?.meterNoNormalized ||
      data?.MeterNumber ||
      data?.master?.id ||
      fallbackId,
  );
}

export function getDemoSalesMeterType(data = {}) {
  const explicitType = normalizeUpper(
    data?.meterType ||
      data?.MeterType ||
      data?.meterMode ||
      data?.MeterMode ||
      data?.tariffType,
  );

  // Prepaid Sales remains the supported Targeted Batch source type. Canonical
  // Sales All records may omit an explicit meter type, so default to PREPAID.
  return explicitType || "PREPAID";
}


function getErfCandidateEntries(source = {}) {
  const candidates = [
    ...safeArray(source?.ErfCandidates),
    ...safeArray(source?.erfCandidates),
  ];

  return candidates
    .map((candidate) => ({
      erfId: readFirstText(
        candidate?.ErfId,
        candidate?.erfId,
        candidate?.id,
      ),
      erfNo: readFirstText(
        candidate?.ErfNumber,
        candidate?.erfNumber,
        candidate?.erfNo,
        candidate?.number,
      ),
    }))
    .filter((candidate) => candidate.erfId);
}

export function resolveAuthoritativeSalesErfReference({
  source = {},
  draftRow = {},
}) {
  const directErfId = readFirstText(
    source?.erfId,
    source?.ErfId,
    source?.refs?.erfId,
  );
  const directErfNo = readFirstText(
    source?.erfNo,
    source?.ErfNo,
    source?.erfNumber,
    source?.ErfNumber,
    source?.property?.erfNo,
  );
  const draftErfId = readFirstText(
    draftRow?.erfId,
    draftRow?.refs?.erfId,
  );
  const draftErfNo = readFirstText(
    draftRow?.erfNo,
    draftRow?.erfNumber,
    draftRow?.property?.erfNo,
  );

  let erfId = directErfId;
  let erfNo = directErfNo;
  let resolutionSource = directErfId ? "DIRECT_SALES_REFERENCE" : null;

  if (!erfId) {
    const candidateEntries = getErfCandidateEntries(source);
    const uniqueCandidateIds = uniqueValues(
      candidateEntries.map((candidate) => candidate.erfId),
    );

    if (uniqueCandidateIds.length === 0) {
      return {
        ok: false,
        code: "SALES_ERF_REFERENCE_MISSING",
        message: "The authoritative Sales source has no ERF reference.",
        candidateErfIds: [],
      };
    }

    if (uniqueCandidateIds.length > 1) {
      return {
        ok: false,
        code: "SALES_ERF_REFERENCE_AMBIGUOUS",
        message: `The authoritative Sales source resolves to ${uniqueCandidateIds.length} ERFs.`,
        candidateErfIds: uniqueCandidateIds,
      };
    }

    erfId = uniqueCandidateIds[0];
    erfNo = readFirstText(
      ...candidateEntries
        .filter((candidate) => candidate.erfId === erfId)
        .map((candidate) => candidate.erfNo),
      safeArray(source?.ErfNumbers)[0],
      safeArray(source?.erfNumbers)[0],
    );
    resolutionSource = "UNIQUE_SALES_ERF_CANDIDATE";
  }

  if (!erfNo) {
    const matchingCandidate = getErfCandidateEntries(source).find(
      (candidate) => candidate.erfId === erfId && candidate.erfNo,
    );

    erfNo = readFirstText(
      matchingCandidate?.erfNo,
      safeArray(source?.ErfNumbers)[0],
      safeArray(source?.erfNumbers)[0],
      directErfNo,
    );
  }

  if (!erfNo) {
    return {
      ok: false,
      code: "SALES_ERF_NUMBER_MISSING",
      message: `The authoritative Sales source resolves to ERF ${erfId} but has no ERF number.`,
      candidateErfIds: [erfId],
    };
  }

  if (draftErfId && draftErfId !== erfId) {
    return {
      ok: false,
      code: "DRAFT_ERF_REFERENCE_MISMATCH",
      message: `The TB Draft ERF ${draftErfId} conflicts with authoritative ERF ${erfId}.`,
      candidateErfIds: [erfId],
    };
  }

  if (draftErfNo && draftErfNo !== erfNo) {
    return {
      ok: false,
      code: "DRAFT_ERF_NUMBER_MISMATCH",
      message: `The TB Draft ERF number ${draftErfNo} conflicts with authoritative ERF number ${erfNo}.`,
      candidateErfIds: [erfId],
    };
  }

  return {
    ok: true,
    erfId,
    erfNo,
    resolutionSource,
    candidateErfIds: [erfId],
  };
}

export function validateAuthoritativeSalesDocument({
  snapshot,
  expectedSalesId,
  expectedLmPcode,
  draftRow,
}) {
  if (!snapshot?.exists) {
    return {
      ok: false,
      code: "SALES_SOURCE_NOT_FOUND",
      message: `Sales source ${expectedSalesId} was not found.`,
    };
  }

  const source = snapshot.data() || {};
  const documentId = normalizeSalesId(snapshot.id);
  const sourceMeterNo = getDemoSalesMeterNo(source, snapshot.id);
  const draftMeterNo = normalizeMeterNo(
    draftRow?.meterNoNormalized || draftRow?.meterNo || expectedSalesId,
  );
  const sourceLmPcode = getDemoSalesLmPcode(source);
  const meterType = getDemoSalesMeterType(source);

  if (documentId !== expectedSalesId) {
    return {
      ok: false,
      code: "SALES_SOURCE_ID_MISMATCH",
      message: `Sales source ${snapshot.id} does not match ${expectedSalesId}.`,
    };
  }

  if (sourceMeterNo && normalizeSalesId(sourceMeterNo) !== expectedSalesId) {
    return {
      ok: false,
      code: "SALES_METER_IDENTITY_MISMATCH",
      message: `Sales source ${expectedSalesId} has a conflicting meter identity.`,
    };
  }

  if (draftMeterNo && normalizeSalesId(draftMeterNo) !== expectedSalesId) {
    return {
      ok: false,
      code: "DRAFT_METER_IDENTITY_MISMATCH",
      message: `TB Draft row for ${expectedSalesId} has a conflicting meter identity.`,
    };
  }

  if (!sourceLmPcode) {
    return {
      ok: false,
      code: "SALES_LM_SCOPE_MISSING",
      message: `Sales source ${expectedSalesId} has no canonical lmPcode.`,
    };
  }

  if (sourceLmPcode !== expectedLmPcode) {
    return {
      ok: false,
      code: "SALES_LM_SCOPE_MISMATCH",
      message: `Sales source ${expectedSalesId} belongs to ${sourceLmPcode}, not ${expectedLmPcode}.`,
    };
  }

  if (!TARGETED_BATCH_ALLOWED_METER_TYPES.includes(meterType)) {
    return {
      ok: false,
      code: "UNSUPPORTED_SALES_METER_TYPE",
      message: `Sales source ${expectedSalesId} has unsupported meter type ${meterType || "NAv"}.`,
    };
  }

  if (source?.tbRefs !== undefined && !Array.isArray(source.tbRefs)) {
    return {
      ok: false,
      code: "INVALID_SALES_TB_REFS",
      message: `Sales source ${expectedSalesId} has an invalid tbRefs field.`,
    };
  }

  const erfReference = resolveAuthoritativeSalesErfReference({
    source,
    draftRow,
  });

  if (!erfReference.ok) {
    return {
      ok: false,
      code: erfReference.code,
      message: `Sales source ${expectedSalesId}: ${erfReference.message}`,
    };
  }

  return {
    ok: true,
    source,
    sourceLmPcode,
    sourceMeterNo,
    meterType,
    erfReference,
  };
}


function buildCanonicalErfNo(sg = {}) {
  const parcelNo = normalizeText(sg?.parcelNo);
  const portion = Number(sg?.portion || 0);

  if (!parcelNo) return "";
  if (Number.isFinite(portion) && portion > 0) {
    return `${parcelNo}/${portion}`;
  }

  return parcelNo;
}

export function validateAuthoritativeErfDocument({
  snapshot,
  expectedErfId,
  expectedErfNo,
  expectedLmPcode,
  expectedWardPcode,
  expectedWardNumber,
}) {
  if (!snapshot?.exists) {
    return {
      ok: false,
      code: "AUTHORITATIVE_ERF_NOT_FOUND",
      message: `Authoritative ERF ${expectedErfId} was not found.`,
    };
  }

  const source = snapshot.data() || {};
  const documentErfId = readFirstText(source?.erfId, snapshot.id);
  const authoritativeErfNo = buildCanonicalErfNo(source?.sg);
  const proposedErfNo = normalizeText(expectedErfNo);
  const lmPcode = normalizeLmPcode(
    source?.admin?.localMunicipality?.pcode,
  );
  const lmName = readFirstText(
    source?.admin?.localMunicipality?.name,
    "NAv",
  );
  const wardPcode = normalizeWardPcode(source?.admin?.ward?.pcode);
  const wardName = readFirstText(source?.admin?.ward?.name);
  const namedWardNumber = normalizeWardNumber(wardName);
  const derivedWardNumber = deriveWardNumberFromPcode(
    wardPcode,
    lmPcode,
  );
  const wardNumber = namedWardNumber || derivedWardNumber;

  if (documentErfId !== expectedErfId || snapshot.id !== expectedErfId) {
    return {
      ok: false,
      code: "AUTHORITATIVE_ERF_ID_MISMATCH",
      message: `Authoritative ERF ${snapshot.id} conflicts with expected ERF ${expectedErfId}.`,
    };
  }


  if (!authoritativeErfNo) {
    return {
      ok: false,
      code: "AUTHORITATIVE_ERF_NUMBER_MISSING",
      message: `Authoritative ERF ${expectedErfId} has no canonical ERF number.`,
    };
  }

  if (proposedErfNo && authoritativeErfNo !== proposedErfNo) {
    return {
      ok: false,
      code: "AUTHORITATIVE_ERF_NUMBER_MISMATCH",
      message: `Authoritative ERF ${expectedErfId} has ERF number ${authoritativeErfNo}, not ${proposedErfNo}.`,
    };
  }
  if (!lmPcode || lmPcode !== expectedLmPcode) {
    return {
      ok: false,
      code: "AUTHORITATIVE_ERF_LM_SCOPE_MISMATCH",
      message: `Authoritative ERF ${expectedErfId} belongs to ${lmPcode || "NAv"}, not ${expectedLmPcode}.`,
    };
  }

  if (!wardPcode || wardPcode !== expectedWardPcode) {
    return {
      ok: false,
      code: "AUTHORITATIVE_ERF_WARD_SCOPE_MISMATCH",
      message: `Authoritative ERF ${expectedErfId} belongs to ward ${wardPcode || "NAv"}, not ${expectedWardPcode}.`,
    };
  }

  if (!wardNumber) {
    return {
      ok: false,
      code: "AUTHORITATIVE_ERF_WARD_NUMBER_MISSING",
      message: `Authoritative ERF ${expectedErfId} has no valid ward number.`,
    };
  }

  if (
    namedWardNumber &&
    derivedWardNumber &&
    namedWardNumber !== derivedWardNumber
  ) {
    return {
      ok: false,
      code: "AUTHORITATIVE_ERF_WARD_NUMBER_CONFLICT",
      message: `Authoritative ERF ${expectedErfId} has conflicting ward information.`,
    };
  }

  if (wardNumber !== normalizeWardNumber(expectedWardNumber)) {
    return {
      ok: false,
      code: "AUTHORITATIVE_ERF_WARD_NUMBER_MISMATCH",
      message: `Authoritative ERF ${expectedErfId} belongs to ward ${wardNumber}, not ${expectedWardNumber}.`,
    };
  }

  return {
    ok: true,
    source,
    erfNo: authoritativeErfNo,
    scope: {
      lmPcode,
      lmName,
      wardPcode,
      wardNumber,
      wardName: wardName || `Ward ${wardNumber}`,
    },
  };
}

export function coerceTimestamp(value) {
  if (value instanceof Timestamp) return value;

  if (
    value &&
    typeof value === "object" &&
    Number.isInteger(value.seconds) &&
    Number.isInteger(value.nanoseconds)
  ) {
    return new Timestamp(value.seconds, value.nanoseconds);
  }

  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return Timestamp.fromDate(date);
  }

  return null;
}

export function timestampsEqual(left, right) {
  const leftTimestamp = coerceTimestamp(left);
  const rightTimestamp = coerceTimestamp(right);

  if (!leftTimestamp || !rightTimestamp) return false;
  return leftTimestamp.isEqual(rightTimestamp);
}

export function hasMatchingSalesTbRef({ salesData = {}, tbId, creationDate }) {
  return safeArray(salesData?.tbRefs).some(
    (reference) =>
      normalizeUpper(reference?.id) === tbId &&
      timestampsEqual(reference?.date, creationDate),
  );
}

export function validateExistingTbRow({
  existing = {},
  expectedRow,
  expectedSalesId,
}) {
  return (
    normalizeUpper(existing?.id) === expectedRow.id &&
    normalizeUpper(existing?.tbId) === expectedRow.tbId &&
    Number(existing?.rowNo) === Number(expectedRow.rowNo) &&
    normalizeSalesId(existing?.salesAllMeterId) === expectedSalesId &&
    normalizeSalesId(existing?.source?.recordId) === expectedSalesId &&
    normalizeLmPcode(existing?.scope?.lmPcode) ===
      normalizeLmPcode(expectedRow?.scope?.lmPcode) &&
    normalizeWardPcode(existing?.scope?.wardPcode) ===
      normalizeWardPcode(expectedRow?.scope?.wardPcode) &&
    normalizeWardNumber(existing?.scope?.wardNumber) ===
      normalizeWardNumber(expectedRow?.scope?.wardNumber)
  );
}

export function chunkArray(items = [], size = 300) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

export async function getSnapshotsInChunks({ db, refs = [], chunkSize = 300 }) {
  const snapshots = [];

  for (const chunk of chunkArray(refs, chunkSize)) {
    if (chunk.length > 0) {
      snapshots.push(...(await db.getAll(...chunk)));
    }
  }

  return snapshots;
}

export function timestampToIso(value) {
  const timestamp = coerceTimestamp(value);
  return timestamp ? timestamp.toDate().toISOString() : null;
}
