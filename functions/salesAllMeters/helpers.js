export const SALES_ALL_METERS_OUTCOMES = Object.freeze({
  TARGET_MISSING: "TARGET_MISSING", UNCHANGED: "UNCHANGED",
  UPDATED: "UPDATED", CONFLICT: "CONFLICT",
});

export const SALES_ALL_METERS_CONFLICT_CODES = Object.freeze({
  DOCUMENT_ID_NONCANONICAL: "SAM_DOCUMENT_ID_NONCANONICAL",
  IDENTITY_MISMATCH: "SAM_IDENTITY_MISMATCH",
  CANONICAL_FIELD_MISSING: "SAM_CANONICAL_FIELD_MISSING",
  PROHIBITED_FIELD_PRESENT: "SAM_PROHIBITED_FIELD_PRESENT",
  DOCUMENT_SHAPE_UNSAFE: "SAM_DOCUMENT_SHAPE_UNSAFE",
  DESIRED_VISIBILITY_INVALID: "SAM_DESIRED_VISIBILITY_INVALID",
  VISIBILITY_MISSING: "SAM_VISIBILITY_MISSING",
  VISIBILITY_TYPE_INVALID: "SAM_VISIBILITY_TYPE_INVALID",
  VISIBILITY_VALUE_INVALID: "SAM_VISIBILITY_VALUE_INVALID",
  GOVERNED_FIELD_TYPE_INVALID: "SAM_GOVERNED_FIELD_TYPE_INVALID",
  TRANSACTION_PRECONDITION_CHANGED: "SAM_TRANSACTION_PRECONDITION_CHANGED",
  RECORD_WRITE_FAILED: "SAM_RECORD_WRITE_FAILED",
});

const REQUIRED_CORE_FIELDS = [
  "master", "meterNo", "meterNoNormalized", "provider", "lmPcode", "customerNo",
  "accountNo", "totalAmountC", "monthlyTotalsC", "lastPurchaseAtISO",
  "daysSinceLastPurchase",
];

const MONTHLY_SOURCE_FIELDS = [
  "lmPcode", "accountNumber", "customerName", "sourceFileName", "sourceRow",
  "totalSalesC", "monthlySalesC", "monthlyUnits", "totalUnits",
  "sourceDocumentId", "sourceDocumentPath", "sourceEndRow",
  "accountNumberNormalized", "customerSurname", "addressLine1", "addressLine2",
  "town", "postalAddress1", "postalAddress2", "postalAddressTown", "standNumber",
  "tariffInstance", "installationDate", "previousMeterNumber",
  "previousInstallationDate", "leakageCategory", "riskTier", "riskScore",
  "salesPeriodFrom", "salesPeriodTo", "erfCandidateCount", "gpsMatchStatus",
  "hasUsableGps", "elmAccountMatched", "elmSourceRows", "erfCandidates",
  "erfNumbers", "missingErfNumbers",
];

const CONTOUR_REQUIRED_FIELDS = [...REQUIRED_CORE_FIELDS, ...MONTHLY_SOURCE_FIELDS];
const GOVERNED_PROVIDERS = new Set(["conlog", "contour"]);
const CANONICAL_ID = /^[A-Z0-9]+$/;
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
const TIMEZONE_ISO = /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/;

const isObject = (value) => Boolean(value) && typeof value === "object" &&
  !Array.isArray(value);
const isFiniteNumber = (value) => typeof value === "number" &&
  Number.isFinite(value) && !Number.isNaN(value);
const isNonNegativeNumber = (value) => isFiniteNumber(value) && value >= 0;
const isStrictIntegerOrNull = (value) => value === null ||
  (Number.isInteger(value) && !Number.isNaN(value) && value >= 0);

function evidenceFor(existing, paths) {
  const evidence = {};
  for (const path of paths) {
    let value = existing;
    for (const part of path.split(".")) value = value?.[part];
    evidence[path] = value;
  }
  return evidence;
}

function conflict({ code, meterId, paths, existing, sourceWriter, message }) {
  return {
    valid: false, outcome: SALES_ALL_METERS_OUTCOMES.CONFLICT, code, meterId,
    documentPath: `sales-all-meters/${meterId}`, conflictingPaths: paths,
    evidence: evidenceFor(existing, paths), sourceWriter, message,
  };
}

export class SalesAllMetersConflictError extends Error {
  constructor(result) {
    super(result?.message || "Sales All Meters conflict");
    this.name = "SalesAllMetersConflictError";
    this.conflict = result;
  }
}

export function deriveSalesAllMetersVisibilityFromMaster(masterData) {
  const astId = String(masterData?.refs?.asts?.id || "").trim();
  const salesId = String(masterData?.refs?.sales?.id || "").trim();
  return astId && salesId ? "VISIBLE" : "INVISIBLE";
}

function validateMonthlyIntegerMap(value, path, unsafe) {
  if (!isObject(value)) {
    unsafe.push(path);
    return [];
  }
  const months = Object.keys(value).sort();
  if (!months.length) unsafe.push(path);
  for (const [month, amount] of Object.entries(value)) {
    if (!MONTH_KEY.test(month) || !Number.isInteger(amount) || amount < 0) {
      unsafe.push(`${path}.${month}`);
    }
  }
  if (months.every((month) => MONTH_KEY.test(month))) {
    for (let index = 1; index < months.length; index += 1) {
      const previous = new Date(`${months[index - 1]}-01T00:00:00Z`);
      previous.setUTCMonth(previous.getUTCMonth() + 1);
      if (previous.toISOString().slice(0, 7) !== months[index]) {
        unsafe.push(path);
        break;
      }
    }
  }
  return months;
}

function mapsStrictEqual(left, right) {
  if (!isObject(left) || !isObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}


function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonblankString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableNonblankString(value) {
  return value === null || isNonblankString(value);
}

function isFirestoreTimestampLike(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  if (typeof value.toMillis === "function") {
    try {
      return Number.isFinite(value.toMillis());
    } catch {
      return false;
    }
  }

  const seconds = value.seconds ?? value._seconds;
  const nanoseconds = value.nanoseconds ?? value._nanoseconds;
  return Number.isInteger(seconds) &&
    Number.isInteger(nanoseconds) &&
    nanoseconds >= 0 && nanoseconds <= 999999999;
}

function validateNoAccessEntries(value, path, unsafe) {
  if (!Array.isArray(value)) {
    unsafe.push(path);
    return;
  }

  value.forEach((entry, index) => {
    const entryPath = `${path}.${index}`;
    if (!isPlainObject(entry)) {
      unsafe.push(entryPath);
      return;
    }

    if (typeof entry.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
      unsafe.push(`${entryPath}.date`);
    }
    if (typeof entry.time !== "string" || !/^\d{2}:\d{2}:\d{2}$/.test(entry.time)) {
      unsafe.push(`${entryPath}.time`);
    }
    if (!isNonblankString(entry.user)) unsafe.push(`${entryPath}.user`);
  });
}

function validateTbRefs(value, unsafe) {
  if (!Array.isArray(value)) {
    unsafe.push("tbRefs");
    return;
  }

  const seenIds = new Set();
  const validStatuses = new Set(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]);

  value.forEach((reference, index) => {
    const path = `tbRefs.${index}`;
    if (!isPlainObject(reference)) {
      unsafe.push(path);
      return;
    }

    if (!isNonblankString(reference.id)) {
      unsafe.push(`${path}.id`);
    } else {
      const logicalId = reference.id.trim().toUpperCase();
      if (seenIds.has(logicalId)) unsafe.push(`${path}.id`);
      seenIds.add(logicalId);
    }

    if (!isFirestoreTimestampLike(reference.date)) unsafe.push(`${path}.date`);

    if (Object.hasOwn(reference, "rowId") && !isNonblankString(reference.rowId)) {
      unsafe.push(`${path}.rowId`);
    }

    if (!Object.hasOwn(reference, "fieldWork")) return;
    if (!isPlainObject(reference.fieldWork)) {
      unsafe.push(`${path}.fieldWork`);
      return;
    }

    const fieldWork = reference.fieldWork;
    const fieldWorkPath = `${path}.fieldWork`;
    const status = Object.hasOwn(fieldWork, "status")
      ? String(fieldWork.status || "").trim().toUpperCase()
      : "";

    if (Object.hasOwn(fieldWork, "status") &&
        (typeof fieldWork.status !== "string" ||
         fieldWork.status !== status ||
         !validStatuses.has(status))) {
      unsafe.push(`${fieldWorkPath}.status`);
    }

    for (const field of [
      "outcomeCode", "outcomeLabel", "targetedMeterNo", "discoveredMeterNo",
      "premiseId", "meterId", "trnId",
    ]) {
      if (Object.hasOwn(fieldWork, field) && !isNullableNonblankString(fieldWork[field])) {
        unsafe.push(`${fieldWorkPath}.${field}`);
      }
    }

    if (Object.hasOwn(fieldWork, "meterMatch") &&
        fieldWork.meterMatch !== null && typeof fieldWork.meterMatch !== "boolean") {
      unsafe.push(`${fieldWorkPath}.meterMatch`);
    }

    for (const field of ["submittedAt", "updatedAt"]) {
      if (Object.hasOwn(fieldWork, field) && fieldWork[field] !== null &&
          !isFirestoreTimestampLike(fieldWork[field])) {
        unsafe.push(`${fieldWorkPath}.${field}`);
      }
    }

    if (Object.hasOwn(fieldWork, "noAccess")) {
      validateNoAccessEntries(fieldWork.noAccess, `${fieldWorkPath}.noAccess`, unsafe);
    }

    if (status === "IN_PROGRESS") {
      if (!isNonblankString(reference.rowId)) unsafe.push(`${path}.rowId`);
      if (!isFirestoreTimestampLike(fieldWork.updatedAt)) {
        unsafe.push(`${fieldWorkPath}.updatedAt`);
      }
    }

    if (status === "COMPLETED") {
      if (!isNonblankString(reference.rowId)) unsafe.push(`${path}.rowId`);
      for (const field of ["outcomeCode", "outcomeLabel", "premiseId", "meterId", "trnId"]) {
        if (!isNonblankString(fieldWork[field])) unsafe.push(`${fieldWorkPath}.${field}`);
      }
      if (typeof fieldWork.meterMatch !== "boolean") unsafe.push(`${fieldWorkPath}.meterMatch`);
      if (!isFirestoreTimestampLike(fieldWork.submittedAt)) {
        unsafe.push(`${fieldWorkPath}.submittedAt`);
      }
      if (!isFirestoreTimestampLike(fieldWork.updatedAt)) {
        unsafe.push(`${fieldWorkPath}.updatedAt`);
      }
    }
  });
}

function validateGeofenceRefs(value, unsafe) {
  if (!Array.isArray(value)) {
    unsafe.push("geofenceRefs");
    return;
  }

  const seenIds = new Set();

  value.forEach((reference, index) => {
    const path = `geofenceRefs.${index}`;
    if (!isPlainObject(reference)) {
      unsafe.push(path);
      return;
    }

    if (!isNonblankString(reference.id)) {
      unsafe.push(`${path}.id`);
    } else {
      const logicalId = reference.id.trim().toUpperCase();
      if (seenIds.has(logicalId)) unsafe.push(`${path}.id`);
      seenIds.add(logicalId);
    }

    if (Object.hasOwn(reference, "name") && typeof reference.name !== "string") {
      unsafe.push(`${path}.name`);
    }
  });
}

export function validateExistingSalesAllMetersTarget({
  meterId, existing, sourceWriter,
}) {
  if (typeof meterId !== "string" || !CANONICAL_ID.test(meterId)) {
    return conflict({ code: SALES_ALL_METERS_CONFLICT_CODES.DOCUMENT_ID_NONCANONICAL,
      meterId: String(meterId ?? ""), paths: ["documentId"], existing,
      sourceWriter, message: "Sales All Meters document ID is not canonical" });
  }
  if (!isObject(existing)) {
    return conflict({ code: SALES_ALL_METERS_CONFLICT_CODES.DOCUMENT_SHAPE_UNSAFE,
      meterId, paths: ["document"], existing: { document: existing }, sourceWriter,
      message: "Sales All Meters target is not an object" });
  }

  const missingCore = REQUIRED_CORE_FIELDS.filter((field) => !Object.hasOwn(existing, field));
  if (missingCore.length) {
    return conflict({ code: SALES_ALL_METERS_CONFLICT_CODES.CANONICAL_FIELD_MISSING,
      meterId, paths: missingCore, existing, sourceWriter,
      message: "Sales All Meters target is missing required fields" });
  }
  if (!isObject(existing.master)) {
    return conflict({ code: SALES_ALL_METERS_CONFLICT_CODES.DOCUMENT_SHAPE_UNSAFE,
      meterId, paths: ["master"], existing, sourceWriter,
      message: "Sales All Meters master field is not a map" });
  }
  if (!Object.hasOwn(existing.master, "id")) {
    return conflict({ code: SALES_ALL_METERS_CONFLICT_CODES.CANONICAL_FIELD_MISSING,
      meterId, paths: ["master.id"], existing, sourceWriter,
      message: "Sales All Meters target is missing master.id" });
  }
  if (!Object.hasOwn(existing.master, "visibility")) {
    return conflict({ code: SALES_ALL_METERS_CONFLICT_CODES.VISIBILITY_MISSING,
      meterId, paths: ["master.visibility"], existing, sourceWriter,
      message: "Sales All Meters target is missing master.visibility" });
  }
  if (Object.keys(existing.master).sort().join() !== "id,visibility") {
    return conflict({ code: SALES_ALL_METERS_CONFLICT_CODES.DOCUMENT_SHAPE_UNSAFE,
      meterId, paths: ["master"], existing, sourceWriter,
      message: "Sales All Meters master shape is unsafe" });
  }
  if (typeof existing.master.visibility !== "string") {
    return conflict({ code: SALES_ALL_METERS_CONFLICT_CODES.VISIBILITY_TYPE_INVALID,
      meterId, paths: ["master.visibility"], existing, sourceWriter,
      message: "Sales All Meters master.visibility must be a string" });
  }
  if (!["VISIBLE", "INVISIBLE"].includes(existing.master.visibility)) {
    return conflict({ code: SALES_ALL_METERS_CONFLICT_CODES.VISIBILITY_VALUE_INVALID,
      meterId, paths: ["master.visibility"], existing, sourceWriter,
      message: "Sales All Meters master.visibility is unsupported" });
  }

  const coreStrings = [
    ["master.id", existing.master.id], ["meterNo", existing.meterNo],
    ["meterNoNormalized", existing.meterNoNormalized], ["provider", existing.provider],
    ["customerNo", existing.customerNo], ["accountNo", existing.accountNo],
  ];
  const invalidCoreStrings = coreStrings
    .filter(([, value]) => typeof value !== "string")
    .map(([path]) => path);
  if (invalidCoreStrings.length) {
    return conflict({ code: SALES_ALL_METERS_CONFLICT_CODES.GOVERNED_FIELD_TYPE_INVALID,
      meterId, paths: invalidCoreStrings, existing, sourceWriter,
      message: "Sales All Meters target contains invalid string field types" });
  }

  const identities = [];
  if (existing.master.id !== meterId || !CANONICAL_ID.test(existing.master.id))
    identities.push("master.id");
  if (existing.meterNoNormalized !== meterId ||
      !CANONICAL_ID.test(existing.meterNoNormalized)) identities.push("meterNoNormalized");
  if (identities.length) {
    return conflict({ code: SALES_ALL_METERS_CONFLICT_CODES.IDENTITY_MISMATCH,
      meterId, paths: identities, existing, sourceWriter,
      message: "Sales All Meters canonical identities conflict" });
  }

  const unsafe = [];
  if (!existing.meterNo) unsafe.push("meterNo");
  if (!GOVERNED_PROVIDERS.has(existing.provider)) unsafe.push("provider");
  if (typeof existing.lmPcode !== "string" || !existing.lmPcode.trim()) {
    unsafe.push("lmPcode");
  }

  if (existing.provider === "contour") {
    const missingContour = CONTOUR_REQUIRED_FIELDS
      .filter((field) => !Object.hasOwn(existing, field));
    unsafe.push(...missingContour);
  }

  const optionalStringFields = [
    "lmPcode", "accountNumber", "customerName", "sourceFileName",
    "sourceDocumentId", "sourceDocumentPath", "accountNumberNormalized",
    "customerSurname", "addressLine1", "addressLine2", "town", "postalAddress1",
    "postalAddress2", "postalAddressTown", "standNumber", "tariffInstance",
    "installationDate", "previousMeterNumber", "previousInstallationDate",
    "leakageCategory", "riskTier", "salesPeriodFrom", "salesPeriodTo",
    "gpsMatchStatus",
  ];
  for (const field of optionalStringFields) {
    if (Object.hasOwn(existing, field) && typeof existing[field] !== "string") unsafe.push(field);
  }

  if (!Number.isInteger(existing.totalAmountC) || existing.totalAmountC < 0)
    unsafe.push("totalAmountC");
  const months = validateMonthlyIntegerMap(existing.monthlyTotalsC, "monthlyTotalsC", unsafe);
  if (isObject(existing.monthlyTotalsC)) {
    const sum = Object.values(existing.monthlyTotalsC)
      .reduce((total, amount) => total + (Number.isInteger(amount) ? amount : 0), 0);
    if (sum !== existing.totalAmountC) unsafe.push("totalAmountC");
  }

  if (Object.hasOwn(existing, "totalSalesC")) {
    if (!Number.isInteger(existing.totalSalesC) || existing.totalSalesC < 0 ||
        existing.totalSalesC !== existing.totalAmountC) unsafe.push("totalSalesC");
  }
  if (Object.hasOwn(existing, "monthlySalesC")) {
    validateMonthlyIntegerMap(existing.monthlySalesC, "monthlySalesC", unsafe);
    if (!mapsStrictEqual(existing.monthlySalesC, existing.monthlyTotalsC)) {
      unsafe.push("monthlySalesC");
    }
  }

  if (Object.hasOwn(existing, "monthlyUnits")) {
    if (!isObject(existing.monthlyUnits)) {
      unsafe.push("monthlyUnits");
    } else {
      const unitMonths = Object.keys(existing.monthlyUnits).sort();
      if (months.length && (unitMonths.length !== months.length ||
          unitMonths.some((month, index) => month !== months[index]))) unsafe.push("monthlyUnits");
      let unitsSum = 0;
      for (const [month, units] of Object.entries(existing.monthlyUnits)) {
        if (!MONTH_KEY.test(month) || !isNonNegativeNumber(units)) {
          unsafe.push(`monthlyUnits.${month}`);
        } else {
          unitsSum += units;
        }
      }
      if (Object.hasOwn(existing, "totalUnits")) {
        if (!isNonNegativeNumber(existing.totalUnits) ||
            Math.abs(unitsSum - existing.totalUnits) > 1e-6) unsafe.push("totalUnits");
      }
    }
  } else if (Object.hasOwn(existing, "totalUnits") && !isNonNegativeNumber(existing.totalUnits)) {
    unsafe.push("totalUnits");
  }

  for (const field of ["sourceRow", "sourceEndRow", "erfCandidateCount"]) {
    if (Object.hasOwn(existing, field) && !isStrictIntegerOrNull(existing[field])) unsafe.push(field);
  }
  if (Object.hasOwn(existing, "riskScore") &&
      !(typeof existing.riskScore === "string" || isFiniteNumber(existing.riskScore))) {
    unsafe.push("riskScore");
  }
  for (const field of ["hasUsableGps", "elmAccountMatched"]) {
    if (Object.hasOwn(existing, field) && typeof existing[field] !== "boolean") unsafe.push(field);
  }
  for (const field of ["erfCandidates", "erfNumbers", "missingErfNumbers", "elmSourceRows"]) {
    if (Object.hasOwn(existing, field) && !Array.isArray(existing[field])) unsafe.push(field);
  }
  if (Object.hasOwn(existing, "tbRefs")) validateTbRefs(existing.tbRefs, unsafe);
  if (Object.hasOwn(existing, "geofenceRefs")) {
    validateGeofenceRefs(existing.geofenceRefs, unsafe);
  }

  if (Object.hasOwn(existing, "accountNumber") && existing.accountNumber !== existing.accountNo) {
    unsafe.push("accountNumber");
  }

  if (existing.provider === "contour") {
    if (existing.lastPurchaseAtISO !== null) unsafe.push("lastPurchaseAtISO");
    if (existing.daysSinceLastPurchase !== null) unsafe.push("daysSinceLastPurchase");
  } else if (existing.totalAmountC > 0) {
    if (typeof existing.lastPurchaseAtISO !== "string" ||
        !TIMEZONE_ISO.test(existing.lastPurchaseAtISO) ||
        Number.isNaN(Date.parse(existing.lastPurchaseAtISO))) unsafe.push("lastPurchaseAtISO");
    else if (isObject(existing.monthlyTotalsC)) {
      const purchaseMonth = new Date(existing.lastPurchaseAtISO)
        .toISOString().slice(0, 7);
      const latestPositiveMonth = Object.entries(existing.monthlyTotalsC)
        .filter(([, amount]) => amount > 0).map(([month]) => month).sort().at(-1);
      if (purchaseMonth !== latestPositiveMonth) unsafe.push("lastPurchaseAtISO");
    }
    if (!Number.isInteger(existing.daysSinceLastPurchase) ||
        existing.daysSinceLastPurchase < 0) unsafe.push("daysSinceLastPurchase");
  } else {
    if (existing.lastPurchaseAtISO !== null) unsafe.push("lastPurchaseAtISO");
    if (existing.daysSinceLastPurchase !== null) unsafe.push("daysSinceLastPurchase");
  }

  if (unsafe.length) {
    return conflict({ code: SALES_ALL_METERS_CONFLICT_CODES.GOVERNED_FIELD_TYPE_INVALID,
      meterId, paths: [...new Set(unsafe)], existing, sourceWriter,
      message: "Sales All Meters target contains unsafe governed values" });
  }
  return { valid: true, outcome: null, code: null, conflictingPaths: [], evidence: {} };
}

export function classifySalesAllMetersSync({
  meterId, existing, targetExists, desiredVisibility, sourceWriter,
}) {
  if (typeof desiredVisibility !== "string" ||
      !["VISIBLE", "INVISIBLE"].includes(desiredVisibility)) {
    const result = conflict({
      code: SALES_ALL_METERS_CONFLICT_CODES.DESIRED_VISIBILITY_INVALID,
      meterId, paths: ["master.visibility"], existing, sourceWriter,
      message: "Sales All Meters desired visibility is invalid",
    });
    result.evidence.desiredVisibility = desiredVisibility;
    return { ...result, patch: null };
  }
  if (!targetExists) return { valid: true,
    outcome: SALES_ALL_METERS_OUTCOMES.TARGET_MISSING, code: "TARGET_MISSING",
    meterId, patch: null };
  const validation = validateExistingSalesAllMetersTarget({ meterId, existing, sourceWriter });
  if (!validation.valid) return { ...validation, patch: null };
  const patch = {};
  if (existing.master.id !== meterId) patch["master.id"] = meterId;
  if (existing.master.visibility !== desiredVisibility)
    patch["master.visibility"] = desiredVisibility;
  if (!Object.keys(patch).length) return { valid: true,
    outcome: SALES_ALL_METERS_OUTCOMES.UNCHANGED, code: "UNCHANGED",
    meterId, patch: null };
  return { valid: true, outcome: SALES_ALL_METERS_OUTCOMES.UPDATED,
    code: "UPDATED", meterId, patch };
}
