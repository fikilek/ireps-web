import crypto from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";

export const TARGETED_BATCH_COLLECTIONS = Object.freeze({
  uploads: "tb_uploads",
  rows: "tb_rows",
  sales: "demo_sales_meters",
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
const LM_PCODE_PATTERN = /^ZA[0-9]+$/;
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

export function buildCreationFingerprint({ tbId, lmPcode, salesAllMeterIds }) {
  const payload = JSON.stringify({
    tbId,
    lmPcode,
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

export function validateCreateTargetedBatchPayload(data = {}) {
  const draft = getDraftInput(data);
  const tbId = normalizeUpper(draft?.id || draft?.tbId || data?.tbId);
  const sourceType = normalizeUpper(
    draft?.source?.type || draft?.sourceType || data?.sourceType,
  );
  const sourceLabel = readFirstText(
    draft?.source?.label,
    draft?.sourceLabel,
    "Prepaid Sales",
  );
  const sourceId = readFirstText(draft?.source?.sourceId, draft?.sourceId) || null;
  const fileName = readFirstText(draft?.source?.fileName, draft?.fileName) || null;
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
  const rows = getDisplayRows(draft);
  const salesAllMeterIds = getSalesIds(draft);
  const errors = [];

  if (!TB_ID_PATTERN.test(tbId)) {
    errors.push("tbId must follow TGB_YYYYMMDD_HHMMSS_XXXX.");
  }

  if (sourceType !== TARGETED_BATCH_SOURCE_TYPES.prepaidSales) {
    errors.push("Only PREPAID_SALES Targeted Batch creation is currently supported.");
  }

  if (!LM_PCODE_PATTERN.test(lmPcode)) {
    errors.push("A valid LM pcode is required.");
  }

  if (!selectionReason || selectionReason === "NAv") {
    errors.push("The Targeted Batch selection reason is required.");
  }

  if (validation?.passed !== true && normalizeUpper(validation?.status) !== "PASSED") {
    errors.push("The confirmed TB Draft validation status must be PASSED.");
  }

  if (rows.length < 1) {
    errors.push("The confirmed TB Draft must contain at least one row.");
  }

  if (rows.length > TARGETED_BATCH_MAX_ROWS) {
    errors.push(`A Targeted Batch may contain at most ${TARGETED_BATCH_MAX_ROWS} rows.`);
  }

  if (salesAllMeterIds.length !== rows.length) {
    errors.push("The Sales source ID count must match the confirmed TB Draft row count.");
  }

  const blankSalesIds = salesAllMeterIds.filter((id) => !id).length;
  if (blankSalesIds > 0) {
    errors.push(`${blankSalesIds} Sales source ID value(s) are blank or invalid.`);
  }

  const uniqueSalesIds = uniqueValues(salesAllMeterIds.filter(Boolean));
  if (uniqueSalesIds.length !== salesAllMeterIds.filter(Boolean).length) {
    errors.push("Duplicate Sales source IDs are not allowed in one Targeted Batch.");
  }

  const normalizedRows = rows.map((row, index) => {
    const expectedSalesId = salesAllMeterIds[index] || "";
    const rowSalesId = normalizeSalesId(
      row?.salesAllMeterId ||
        row?.sourceSalesAllMeterId ||
        row?.master?.id ||
        row?.meterNoNormalized ||
        row?.meterNo ||
        row?.id,
    );

    if (rowSalesId !== expectedSalesId) {
      errors.push(
        `TB Draft row ${index + 1} does not match its ordered Sales source ID.`,
      );
    }

    return {
      ...row,
      rowNo: index + 1,
      salesAllMeterId: expectedSalesId,
    };
  });

  if (errors.length > 0) {
    return {
      ok: false,
      code: "INVALID_TARGETED_BATCH_REQUEST",
      message: errors.join(" "),
      errors,
    };
  }

  return {
    ok: true,
    tbId,
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
      warnings: safeArray(validation?.warnings).map(normalizeText).filter(Boolean),
    },
    salesAllMeterIds,
    rows: normalizedRows,
    expectedRows: normalizedRows.length,
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

  // demo_sales_meters is the temporary Prepaid Sales source. Conventional
  // demo records must carry an explicit meter type when they are introduced.
  return explicitType || "PREPAID";
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

  // TEMPORARY DEMO SOURCE RULE:
  // demo_sales_meters does not currently carry lmPcode on every document.
  // Do not require the field for Targeted Batch creation. When a demo Sales
  // document does contain lmPcode, still reject a real conflict with the
  // confirmed TB Draft scope.
  if (sourceLmPcode && sourceLmPcode !== expectedLmPcode) {
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

  return {
    ok: true,
    source,
    sourceLmPcode,
    sourceMeterNo,
    meterType,
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
    normalizeSalesId(existing?.source?.recordId) === expectedSalesId
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
