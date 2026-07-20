export const METER_MASTER_CLASSIFICATIONS = Object.freeze({
  CREATE_FIELD_ONLY: "CREATE_FIELD_ONLY",
  UPDATE_AST_LINK: "UPDATE_AST_LINK",
  UNCHANGED: "UNCHANGED",
  CONFLICT: "CONFLICT",
});

export const METER_MASTER_CONFLICT_CODES = Object.freeze({
  DOCUMENT_ID_NONCANONICAL: "MM_DOCUMENT_ID_NONCANONICAL",
  NORMALIZED_IDENTITY_CONFLICT: "MM_NORMALIZED_IDENTITY_CONFLICT",
  LM_CONFLICT: "MM_LM_CONFLICT",
  METER_TYPE_CONFLICT: "MM_METER_TYPE_CONFLICT",
  AST_REFERENCE_CONFLICT: "MM_AST_REFERENCE_CONFLICT",
  SALES_REFERENCE_CONFLICT: "MM_SALES_REFERENCE_CONFLICT",
  SALES_PROVIDER_CONFLICT: "MM_SALES_PROVIDER_CONFLICT",
  CREATED_METADATA_INVALID: "MM_CREATED_METADATA_INVALID",
  GOVERNED_FIELD_TYPE_INVALID: "MM_GOVERNED_FIELD_TYPE_INVALID",
  DOCUMENT_SHAPE_UNSAFE: "MM_DOCUMENT_SHAPE_UNSAFE",
  CANONICAL_FIELD_MISSING: "MM_CANONICAL_FIELD_MISSING",
  BLANK_WOULD_ERASE_VALID_VALUE: "MM_BLANK_WOULD_ERASE_VALID_VALUE",
  TRANSACTION_PRECONDITION_CHANGED: "MM_TRANSACTION_PRECONDITION_CHANGED",
  RECORD_WRITE_FAILED: "MM_RECORD_WRITE_FAILED",
});

const ROOT_FIELDS = [
  "lmPcode", "meterNo", "meterType", "customerNo", "accountNo", "refs", "metadata",
];
const METADATA_FIELDS = [
  "createdAt", "createdByUid", "createdByUser", "updatedAt", "updatedByUid", "updatedByUser",
];

export class MeterMasterConflictError extends Error {
  constructor(conflict) {
    super(conflict?.message || "Meter Master conflict");
    this.name = "MeterMasterConflictError";
    this.conflict = conflict;
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
}

export function isFirestoreTimestamp(value) {
  return isObject(value) && typeof value.toDate === "function" &&
    Number.isInteger(value.seconds) && Number.isInteger(value.nanoseconds);
}

export function normalizeMeterNo(value) {
  const normalized = String(value ?? "").replace(/\s+/g, "").toUpperCase();
  if (!normalized) throw new TypeError("Meter number normalizes to an empty value");
  if (!/^[A-Z0-9]+$/.test(normalized)) {
    throw new TypeError("Meter number must contain only letters and digits");
  }
  return normalized;
}

const text = (value) => String(value ?? "").trim();

function conflict({
  conflictCode, masterId, existingValues = {}, incomingValues = {},
  conflictingPaths = [], sourceWriter, message,
}) {
  return {
    classification: METER_MASTER_CLASSIFICATIONS.CONFLICT,
    patch: null,
    conflict: {
      conflictCode,
      masterId,
      documentPath: `meter_master/${masterId}`,
      existingValues,
      incomingValues,
      conflictingPaths,
      sourceWriter,
      message,
    },
  };
}

export function buildMeterMasterCreateMetadata({ actorUid, actorUser, operationTimestamp }) {
  if (!isFirestoreTimestamp(operationTimestamp)) {
    throw new TypeError("Meter Master metadata requires a Firestore Timestamp");
  }
  return {
    createdAt: operationTimestamp,
    createdByUid: text(actorUid),
    createdByUser: text(actorUser),
    updatedAt: operationTimestamp,
    updatedByUid: text(actorUid),
    updatedByUser: text(actorUser),
  };
}

export function buildMeterMasterUpdateMetadata({ actorUid, actorUser, operationTimestamp }) {
  if (!isFirestoreTimestamp(operationTimestamp)) {
    throw new TypeError("Meter Master metadata requires a Firestore Timestamp");
  }
  return {
    "metadata.updatedAt": operationTimestamp,
    "metadata.updatedByUid": text(actorUid),
    "metadata.updatedByUser": text(actorUser),
  };
}

export function buildCanonicalFieldOnlyMeterMaster({
  lmPcode, meterNoRaw, meterType, astId, actorUid, actorUser, operationTimestamp,
}) {
  const canonicalLmPcode = text(lmPcode).toUpperCase();
  const canonicalMeterType = text(meterType).toLowerCase();
  const canonicalAstId = text(astId);
  if (!canonicalLmPcode || !canonicalMeterType || !canonicalAstId) {
    throw new TypeError("lmPcode, meterType and astId are required for Meter Master creation");
  }
  return {
    lmPcode: canonicalLmPcode,
    meterNo: { raw: String(meterNoRaw ?? ""), normalized: normalizeMeterNo(meterNoRaw) },
    meterType: canonicalMeterType,
    customerNo: "",
    accountNo: "",
    refs: { asts: { id: canonicalAstId }, sales: { id: "", provider: "" } },
    metadata: buildMeterMasterCreateMetadata({ actorUid, actorUser, operationTimestamp }),
  };
}

export function validateExistingMeterMaster({
  masterId, existing, incomingLmPcode, incomingMeterType, sourceWriter,
}) {
  const incomingValues = {
    lmPcode: text(incomingLmPcode).toUpperCase(),
    meterType: text(incomingMeterType).toLowerCase(),
  };
  let canonicalMasterId;
  try { canonicalMasterId = normalizeMeterNo(masterId); } catch {
    return conflict({
      conflictCode: METER_MASTER_CONFLICT_CODES.DOCUMENT_ID_NONCANONICAL,
      masterId: String(masterId ?? ""), incomingValues, conflictingPaths: ["documentId"],
      sourceWriter, message: "Meter Master document ID is empty or noncanonical",
    });
  }
  if (canonicalMasterId !== masterId) {
    return conflict({
      conflictCode: METER_MASTER_CONFLICT_CODES.DOCUMENT_ID_NONCANONICAL,
      masterId, existingValues: { documentId: masterId },
      incomingValues: { documentId: canonicalMasterId, ...incomingValues },
      conflictingPaths: ["documentId"], sourceWriter,
      message: "Meter Master document ID is not canonical",
    });
  }
  if (!isObject(existing)) {
    return conflict({
      conflictCode: METER_MASTER_CONFLICT_CODES.DOCUMENT_SHAPE_UNSAFE,
      masterId, existingValues: { document: existing }, incomingValues,
      conflictingPaths: ["document"], sourceWriter,
      message: "Meter Master document is not an object",
    });
  }
  const missing = ROOT_FIELDS.filter((key) => !Object.hasOwn(existing, key));
  if (missing.length) {
    return conflict({
      conflictCode: METER_MASTER_CONFLICT_CODES.CANONICAL_FIELD_MISSING,
      masterId, existingValues: existing, incomingValues, conflictingPaths: missing,
      sourceWriter, message: "Meter Master is missing required canonical fields",
    });
  }
  if (!hasExactKeys(existing, ROOT_FIELDS) ||
      !hasExactKeys(existing.meterNo, ["raw", "normalized"]) ||
      !hasExactKeys(existing.refs, ["asts", "sales"]) ||
      !hasExactKeys(existing.refs?.asts, ["id"]) ||
      !hasExactKeys(existing.refs?.sales, ["id", "provider"]) ||
      !hasExactKeys(existing.metadata, METADATA_FIELDS)) {
    return conflict({
      conflictCode: METER_MASTER_CONFLICT_CODES.DOCUMENT_SHAPE_UNSAFE,
      masterId, existingValues: existing, incomingValues,
      conflictingPaths: ["documentShape"], sourceWriter,
      message: "Meter Master canonical shape is unsafe",
    });
  }
  const strings = [
    ["lmPcode", existing.lmPcode], ["meterNo.raw", existing.meterNo.raw],
    ["meterNo.normalized", existing.meterNo.normalized], ["meterType", existing.meterType],
    ["customerNo", existing.customerNo], ["accountNo", existing.accountNo],
    ["refs.asts.id", existing.refs.asts.id], ["refs.sales.id", existing.refs.sales.id],
    ["refs.sales.provider", existing.refs.sales.provider],
    ["metadata.createdByUid", existing.metadata.createdByUid],
    ["metadata.createdByUser", existing.metadata.createdByUser],
    ["metadata.updatedByUid", existing.metadata.updatedByUid],
    ["metadata.updatedByUser", existing.metadata.updatedByUser],
  ];
  const invalidStrings = strings.filter(([, value]) => typeof value !== "string").map(([path]) => path);
  if (invalidStrings.length) {
    return conflict({
      conflictCode: METER_MASTER_CONFLICT_CODES.GOVERNED_FIELD_TYPE_INVALID,
      masterId, existingValues: existing, incomingValues, conflictingPaths: invalidStrings,
      sourceWriter, message: "Meter Master contains invalid governed field types",
    });
  }
  if (!isFirestoreTimestamp(existing.metadata.createdAt)) {
    return conflict({
      conflictCode: METER_MASTER_CONFLICT_CODES.CREATED_METADATA_INVALID,
      masterId, existingValues: { createdAt: existing.metadata.createdAt }, incomingValues,
      conflictingPaths: ["metadata.createdAt"], sourceWriter,
      message: "Meter Master creation metadata is invalid",
    });
  }
  if (!isFirestoreTimestamp(existing.metadata.updatedAt)) {
    return conflict({
      conflictCode: METER_MASTER_CONFLICT_CODES.GOVERNED_FIELD_TYPE_INVALID,
      masterId, existingValues: { updatedAt: existing.metadata.updatedAt }, incomingValues,
      conflictingPaths: ["metadata.updatedAt"], sourceWriter,
      message: "Meter Master update metadata is invalid",
    });
  }
  if (existing.meterNo.normalized !== masterId) {
    return conflict({
      conflictCode: METER_MASTER_CONFLICT_CODES.NORMALIZED_IDENTITY_CONFLICT,
      masterId, existingValues: { normalized: existing.meterNo.normalized },
      incomingValues: { normalized: masterId, ...incomingValues },
      conflictingPaths: ["meterNo.normalized"], sourceWriter,
      message: "Meter Master normalized identity conflicts with its document ID",
    });
  }
  let normalizedRaw;
  try { normalizedRaw = normalizeMeterNo(existing.meterNo.raw); } catch {
    normalizedRaw = "";
  }
  if (normalizedRaw !== masterId) {
    return conflict({
      conflictCode: METER_MASTER_CONFLICT_CODES.NORMALIZED_IDENTITY_CONFLICT,
      masterId, existingValues: { raw: existing.meterNo.raw },
      incomingValues: { normalized: masterId, ...incomingValues },
      conflictingPaths: ["meterNo.raw", "meterNo.normalized"], sourceWriter,
      message: "Meter Master raw meter number does not resolve to its canonical identity",
    });
  }
  if (existing.lmPcode !== incomingValues.lmPcode) {
    return conflict({
      conflictCode: METER_MASTER_CONFLICT_CODES.LM_CONFLICT,
      masterId, existingValues: { lmPcode: existing.lmPcode }, incomingValues,
      conflictingPaths: ["lmPcode"], sourceWriter,
      message: "Meter Master LM conflicts with the operational workflow",
    });
  }
  if (existing.meterType !== incomingValues.meterType) {
    return conflict({
      conflictCode: METER_MASTER_CONFLICT_CODES.METER_TYPE_CONFLICT,
      masterId, existingValues: { meterType: existing.meterType }, incomingValues,
      conflictingPaths: ["meterType"], sourceWriter,
      message: "Meter Master meter type conflicts with the operational workflow",
    });
  }
  return { classification: "COMPATIBLE", patch: null, conflict: null };
}

export function classifyOperationalAstChange({
  masterId, existing, incomingAstId, incomingLmPcode, incomingMeterType, sourceWriter,
}) {
  const astId = text(incomingAstId);
  if (!astId) throw new TypeError("An AST ID is required for Meter Master reconciliation");
  if (existing == null) {
    return { classification: METER_MASTER_CLASSIFICATIONS.CREATE_FIELD_ONLY, patch: null, conflict: null };
  }
  const validation = validateExistingMeterMaster({
    masterId, existing, incomingLmPcode, incomingMeterType, sourceWriter,
  });
  if (validation.classification === METER_MASTER_CLASSIFICATIONS.CONFLICT) return validation;
  const existingAstId = existing.refs.asts.id;
  if (!existingAstId) {
    return { classification: METER_MASTER_CLASSIFICATIONS.UPDATE_AST_LINK, patch: null, conflict: null };
  }
  if (existingAstId === astId) {
    return { classification: METER_MASTER_CLASSIFICATIONS.UNCHANGED, patch: null, conflict: null };
  }
  return conflict({
    conflictCode: METER_MASTER_CONFLICT_CODES.AST_REFERENCE_CONFLICT,
    masterId, existingValues: { "refs.asts.id": existingAstId },
    incomingValues: { "refs.asts.id": astId }, conflictingPaths: ["refs.asts.id"],
    sourceWriter, message: "Meter Master is already linked to a different AST",
  });
}

export function buildOperationalAstUpdate({ astId, actorUid, actorUser, operationTimestamp }) {
  const canonicalAstId = text(astId);
  if (!canonicalAstId) throw new TypeError("An AST ID is required for Meter Master update");
  return {
    "refs.asts.id": canonicalAstId,
    ...buildMeterMasterUpdateMetadata({ actorUid, actorUser, operationTimestamp }),
  };
}
