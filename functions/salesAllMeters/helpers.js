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

const ROOT_FIELDS = [
  "master", "meterNo", "meterNoNormalized", "provider", "customerNo",
  "accountNo", "totalAmountC", "monthlyTotalsC", "lastPurchaseAtISO",
  "daysSinceLastPurchase",
];
const CANONICAL_ID = /^[A-Z0-9]+$/;
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
const TIMEZONE_ISO = /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/;

const isObject = (value) => Boolean(value) && typeof value === "object" &&
  !Array.isArray(value);

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
  const missing = ROOT_FIELDS.filter((field) => !Object.hasOwn(existing, field));
  if (missing.length) {
    return conflict({ code: SALES_ALL_METERS_CONFLICT_CODES.CANONICAL_FIELD_MISSING,
      meterId, paths: missing, existing, sourceWriter,
      message: "Sales All Meters target is missing required fields" });
  }
  const extras = Object.keys(existing).filter((field) => !ROOT_FIELDS.includes(field));
  if (extras.length) {
    return conflict({ code: SALES_ALL_METERS_CONFLICT_CODES.PROHIBITED_FIELD_PRESENT,
      meterId, paths: extras, existing, sourceWriter,
      message: "Sales All Meters target contains prohibited root fields" });
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
  const strings = [["master.id", existing.master.id], ["meterNo", existing.meterNo],
    ["meterNoNormalized", existing.meterNoNormalized], ["provider", existing.provider],
    ["customerNo", existing.customerNo], ["accountNo", existing.accountNo]];
  const invalidStrings = strings.filter(([, value]) => typeof value !== "string")
    .map(([path]) => path);
  if (invalidStrings.length) {
    return conflict({ code: SALES_ALL_METERS_CONFLICT_CODES.GOVERNED_FIELD_TYPE_INVALID,
      meterId, paths: invalidStrings, existing, sourceWriter,
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
  if (existing.provider !== "conlog") unsafe.push("provider");
  if (!Number.isInteger(existing.totalAmountC) || existing.totalAmountC < 0)
    unsafe.push("totalAmountC");
  const monthlyTotalsIsMap = isObject(existing.monthlyTotalsC) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(existing.monthlyTotalsC));
  if (!monthlyTotalsIsMap) unsafe.push("monthlyTotalsC");
  else {
    const months = Object.keys(existing.monthlyTotalsC).sort();
    if (!months.length) unsafe.push("monthlyTotalsC");
    for (const [month, amount] of Object.entries(existing.monthlyTotalsC)) {
      if (!MONTH_KEY.test(month) || !Number.isInteger(amount) || amount < 0)
        unsafe.push(`monthlyTotalsC.${month}`);
    }
    if (months.every((month) => MONTH_KEY.test(month))) {
      for (let index = 1; index < months.length; index += 1) {
        const previous = new Date(`${months[index - 1]}-01T00:00:00Z`);
        previous.setUTCMonth(previous.getUTCMonth() + 1);
        if (previous.toISOString().slice(0, 7) !== months[index]) {
          unsafe.push("monthlyTotalsC");
          break;
        }
      }
    }
    const sum = Object.values(existing.monthlyTotalsC)
      .reduce((total, amount) => total + (Number.isInteger(amount) ? amount : 0), 0);
    if (sum !== existing.totalAmountC) unsafe.push("totalAmountC");
  }
  if (existing.totalAmountC > 0) {
    if (typeof existing.lastPurchaseAtISO !== "string" ||
        !TIMEZONE_ISO.test(existing.lastPurchaseAtISO) ||
        Number.isNaN(Date.parse(existing.lastPurchaseAtISO))) unsafe.push("lastPurchaseAtISO");
    else if (monthlyTotalsIsMap) {
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
