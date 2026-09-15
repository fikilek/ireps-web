// Shared pure business policy. UI projections are never backend authority.
import { correctedStreetName } from "./sales-street-corrections.js";
export { correctedStreetName };
export const SALES_BATCH_MIN = 1;
export const SALES_BATCH_MAX = 30;
export const SALES_BATCH_ID = /^TGB_[0-9]{8}_[0-9]{6}_[A-Z0-9]{4}$/;
export const SALES_ID = /^[A-Z0-9]+$/;
export const SALES_WORK_STATUSES = Object.freeze({ NOT_STARTED: "NOT_STARTED", IN_PROGRESS: "IN_PROGRESS", COMPLETED: "COMPLETED" });
export const LOOKUP_OUTCOMES = Object.freeze(["NO_EXACT_POSITION", "NO_ERF", "MULTIPLE_ERFS"]);
export const GEOCODING_PROVIDER = "Google Geocoding API";
export const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
export const nonblank = value => typeof value === "string" && value.trim().length > 0;
export const validDocumentId = value => nonblank(value) && value === value.trim() && !value.includes("/") && [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127) && ![".", ".."].includes(value);
export const exactKeys = (value, keys) => isRecord(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export function timestampMillis(value) {
  if (!isRecord(value)) return null;
  if (typeof value.toMillis === "function") {
    try { const n = value.toMillis(); return Number.isFinite(n) ? n : null; } catch { return null; }
  }
  const seconds = value.seconds ?? value._seconds;
  const nanos = value.nanoseconds ?? value._nanoseconds;
  return Number.isInteger(seconds) && Number.isInteger(nanos) && nanos >= 0 && nanos <= 999999999 ? seconds * 1000 + nanos / 1e6 : null;
}
export const isTimestamp = value => timestampMillis(value) !== null;
export function readTbRefBatchId(ref) {
  if (!isRecord(ref)) return null;
  const id = Object.hasOwn(ref, "id") ? ref.id : ref.tbId;
  if (Object.hasOwn(ref, "id") && Object.hasOwn(ref, "tbId") && ref.id !== ref.tbId) return null;
  return typeof id === "string" && SALES_BATCH_ID.test(id) ? id : null;
}
export function buildSalesTbRefCorrelationKey(ref) {
  const id = readTbRefBatchId(ref);
  return id ? `${id}::${typeof ref.rowId === "string" ? ref.rowId : ""}` : "";
}
const FIELD_WORK_KEYS = ["status", "outcomeCode", "outcomeLabel", "targetedMeterNo", "discoveredMeterNo", "meterMatch", "premiseId", "meterId", "trnId", "submittedAt", "updatedAt", "noAccess"];
function inspectReference(ref, index) {
  const path = `tbRefs.${index}`;
  const issues = [];
  const issue = key => issues.push(key ? `${path}.${key}` : path);
  if (!isRecord(ref)) issue("");
  else {
    if (!readTbRefBatchId(ref)) issue("id");
    if (!isTimestamp(ref.date)) issue("date");
    Object.keys(ref).filter(key => !["id", "tbId", "date", "rowId", "fieldWork"].includes(key)).forEach(issue);
    if (Object.hasOwn(ref, "rowId") && (!validDocumentId(ref.rowId) || !Object.hasOwn(ref, "fieldWork"))) issue("rowId");
    if (Object.hasOwn(ref, "fieldWork")) {
      const fw = ref.fieldWork;
      if (!isRecord(fw)) issue("fieldWork");
      else {
        Object.keys(fw).filter(key => !FIELD_WORK_KEYS.includes(key)).forEach(key => issue(`fieldWork.${key}`));
        if (!["IN_PROGRESS", "COMPLETED"].includes(fw.status)) issue("fieldWork.status");
        if (!validDocumentId(ref.rowId)) issue("rowId");
        if (!isTimestamp(fw.updatedAt)) issue("fieldWork.updatedAt");
        for (const key of ["outcomeCode", "outcomeLabel", "targetedMeterNo", "discoveredMeterNo", "premiseId", "meterId", "trnId"]) {
          if (Object.hasOwn(fw, key) && fw[key] !== null && !nonblank(fw[key])) issue(`fieldWork.${key}`);
        }
        if (Object.hasOwn(fw, "meterMatch") && fw.meterMatch !== null && typeof fw.meterMatch !== "boolean") issue("fieldWork.meterMatch");
        if (Object.hasOwn(fw, "submittedAt") && fw.submittedAt !== null && !isTimestamp(fw.submittedAt)) issue("fieldWork.submittedAt");
        if (Object.hasOwn(fw, "noAccess")) {
          if (!Array.isArray(fw.noAccess)) issue("fieldWork.noAccess");
          else fw.noAccess.forEach((visit, n) => {
            if (!exactKeys(visit, ["date", "time", "user"]) || !/^\d{4}-\d{2}-\d{2}$/.test(visit.date) || !/^\d{2}:\d{2}:\d{2}$/.test(visit.time) || !nonblank(visit.user)) issue(`fieldWork.noAccess.${n}`);
          });
        }
        if (fw.status === "COMPLETED") {
          for (const key of ["outcomeCode", "outcomeLabel", "premiseId", "meterId", "trnId"]) if (!nonblank(fw[key])) issue(`fieldWork.${key}`);
          if (fw.outcomeCode !== "METER_DISCOVERED") issue("fieldWork.outcomeCode");
          if (typeof fw.meterMatch !== "boolean") issue("fieldWork.meterMatch");
          if (!isTimestamp(fw.submittedAt)) issue("fieldWork.submittedAt");
        } else if (fw.outcomeCode === "METER_DISCOVERED") issue("fieldWork.status");
      }
    }
  }
  return { index, correlationKey: buildSalesTbRefCorrelationKey(ref), duplicateKey: readTbRefBatchId(ref) || "", valid: issues.length === 0, issues };
}
export function inspectSalesTbRefsIntegrity(value) {
  if (value === undefined) value = [];
  if (!Array.isArray(value)) return { valid: false, issues: ["tbRefs"], entries: [], entriesByKey: {} };
  const entries = value.map(inspectReference);
  const issues = entries.flatMap(entry => entry.issues);
  const entriesByKey = {};
  for (const entry of entries) {
    entry.duplicateGroupSize = entries.filter(other => entry.duplicateKey && entry.duplicateKey === other.duplicateKey).length;
    entry.correlationGroupSize = entries.filter(other => entry.correlationKey && entry.correlationKey === other.correlationKey).length;
    entry.duplicateLogicalIdentity = entry.duplicateGroupSize > 1;
    entry.correlationAmbiguous = entry.correlationGroupSize > 1;
    entry.classifiable = entry.valid && entry.duplicateGroupSize === 1 && entry.correlationGroupSize === 1;
    if (entry.duplicateLogicalIdentity) issues.push(`tbRefs.${entry.index}.id`);
    if (entry.correlationKey) {
      const members = entries.filter(other => other.correlationKey === entry.correlationKey);
      entriesByKey[entry.correlationKey] = { correlationKey: entry.correlationKey, indexes: members.map(other => other.index), issues: members.flatMap(other => other.issues), valid: members.length === 1 && entry.valid, classifiable: entry.classifiable, correlationAmbiguous: entry.correlationAmbiguous };
    }
  }
  return { valid: issues.length === 0, issues: [...new Set(issues)], entries, entriesByKey };
}
export function classifySalesWorkStatus(row = {}) {
  const visibility = Object.hasOwn(row, "master") ? row.master?.visibility : row.masterVisibility;
  if (visibility === "VISIBLE") return "COMPLETED";
  const integrity = inspectSalesTbRefsIntegrity(row.tbRefs);
  return integrity.entries.some(entry => entry.classifiable && row.tbRefs[entry.index].fieldWork?.status === "IN_PROGRESS") ? "IN_PROGRESS" : "NOT_STARTED";
}
export const classifySalesTableWorkStatus = classifySalesWorkStatus;
export function buildSalesTableWorkStatusRows({ salesRows = [] } = {}) {
  return (Array.isArray(salesRows) ? salesRows : []).map(row => ({ ...row, salesWorkStatus: classifySalesWorkStatus(row) }));
}
export function resolveSalesTargetedBatchMembership(row = {}) {
  const unresolved = (reason, source = null) => ({ state: "UNRESOLVED", tbId: null, source, reason });
  if (row.targetedBatchIdInvalid === true) return unresolved("Current Targeted Batch ID is malformed", "SCALAR");
  if (Object.hasOwn(row, "targetedBatchId")) {
    if (row.targetedBatchId === null) return { state: "NONE", tbId: null, source: "SCALAR", reason: null };
    if (typeof row.targetedBatchId !== "string" || !SALES_BATCH_ID.test(row.targetedBatchId)) return unresolved("Current Targeted Batch ID is malformed", "SCALAR");
    return { state: "MEMBER", tbId: row.targetedBatchId, source: "SCALAR", reason: `Already belongs to ${row.targetedBatchId}` };
  }
  const integrity = inspectSalesTbRefsIntegrity(row.tbRefs);
  if (!integrity.valid || row.tbRefsIntegrity?.valid === false) return unresolved("Targeted Batch reference integrity is unresolved", "LEGACY_TBREFS");
  const refs = row.tbRefs || [];
  if (!refs.length) return { state: "NONE", tbId: null, source: "LEGACY_TBREFS", reason: null };
  if (refs.length !== 1) return unresolved("Multiple Targeted Batch references cannot establish one current batch", "LEGACY_TBREFS");
  const tbId = readTbRefBatchId(refs[0]);
  return { state: "MEMBER", tbId, source: "LEGACY_TBREFS", reason: `Already belongs to ${tbId}` };
}
export function exactSalesTbRef(row, tbId) {
  const integrity = inspectSalesTbRefsIntegrity(row?.tbRefs);
  const entries = integrity.entries.filter(entry => readTbRefBatchId(row.tbRefs[entry.index]) === tbId);
  if (entries.length !== 1 || !entries[0].classifiable || !integrity.valid) return { ok: false, code: entries.length > 1 ? "TB_REFERENCE_AMBIGUOUS" : "TB_REFERENCE_INVALID", reference: null };
  return { ok: true, index: entries[0].index, reference: row.tbRefs[entries[0].index] };
}
export function assertSalesBatchExecutionMembership(row, tbId) {
  const membership = resolveSalesTargetedBatchMembership(row);
  const exact = exactSalesTbRef(row, tbId);
  if (membership.state !== "MEMBER" || membership.tbId !== tbId || !exact.ok) {
    const error = new Error("Sales membership or execution linkage does not match this batch");
    error.code = "TARGETED_BATCH_MEMBERSHIP_CONFLICT";
    error.irepsCode = error.code;
    throw error;
  }
  return exact;
}
export function coordinateNumber(value, limit) {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}
export function pipelineCandidates(row = {}) {
  const arrays = [row.erfCandidates, row.ErfCandidates].filter(value => value !== undefined);
  if (arrays.some(value => !Array.isArray(value))) return null;
  return arrays.flat();
}
export function hasUsableSalesGps(row = {}) {
  return row.hasUsableGps === true || row.HasUsableGps === true || (pipelineCandidates(row) || []).some(candidate => coordinateNumber(candidate?.Latitude ?? candidate?.latitude, 90) !== null && coordinateNumber(candidate?.Longitude ?? candidate?.longitude, 180) !== null);
}
export function singlePipelineErf(row = {}) {
  const candidates = pipelineCandidates(row);
  if (candidates?.length !== 1) return { ok: false, code: "PIPELINE_ERF_NOT_SINGLE" };
  const candidate = candidates[0];
  const erfId = candidate?.ErfId ?? candidate?.erfId;
  const latitude = coordinateNumber(candidate?.Latitude ?? candidate?.latitude, 90);
  const longitude = coordinateNumber(candidate?.Longitude ?? candidate?.longitude, 180);
  return validDocumentId(erfId) && latitude !== null && longitude !== null ? { ok: true, erfId, point: { latitude, longitude }, candidate } : { ok: false, code: "PIPELINE_ERF_INVALID" };
}
const meaningless = new Set(["", "-", "NAV", "N/A", "NA", "NULL", "UNDEFINED"]);
const meaningful = value => nonblank(value) && !meaningless.has(value.trim().toUpperCase());
export function salesStreetAddress(row = {}) {
  return [row.adr?.strNo, row.adr?.strName, row.adr?.strType].filter(meaningful).map(value => value.trim()).join(" ");
}
export function salesStreetType(row = {}) {
  return meaningful(row.adr?.strType) ? row.adr.strType.trim() : "";
}
// TB-R041 (1.3.12): the street part sent for geocoding uses the owner-approved spelling.
export function salesGeocodingStreetAddress(row = {}) {
  return [row.adr?.strNo, correctedStreetName(row), row.adr?.strType].filter(meaningful).map(value => value.trim()).join(" ");
}
// South African province pcodes are the ZA prefix and first numeric digit.
// Keep this pure: the same address is used by Web, Google and the TB9 predicate.
const provinceNames = Object.freeze({
  ZA1: "Western Cape", ZA2: "Eastern Cape", ZA3: "Northern Cape",
  ZA4: "Free State", ZA5: "KwaZulu-Natal", ZA6: "North West",
  ZA7: "Gauteng", ZA8: "Mpumalanga", ZA9: "Limpopo",
});
export function composeSalesGeocodingAddress(row = {}) {
  const code = typeof row.lmPcode === "string" ? row.lmPcode.trim() : "";
  const province = /^ZA[1-9][0-9]+$/.test(code) ? provinceNames[code.slice(0, 3)] : null;
  // An unknown province cannot form a provider/flag address. Callers report a
  // configuration error; returning an empty string also keeps UI reads safe.
  if (!province) return "";
  return [salesGeocodingStreetAddress(row), typeof row.town === "string" ? row.town.trim() : "", province, "South Africa"].filter(Boolean).join(", ");
}
export function inspectErfLookup(row = {}) {
  if (!Object.hasOwn(row, "erfLookup")) return { valid: true, flagged: false, outcome: null };
  const flag = row.erfLookup;
  const valid = exactKeys(flag, ["version", "outcome", "address", "provider", "attemptedAt", "attemptedByUid", "attemptedByUser"]) && flag.version === 1 && LOOKUP_OUTCOMES.includes(flag.outcome) && [flag.address, flag.provider, flag.attemptedByUid, flag.attemptedByUser].every(nonblank) && isTimestamp(flag.attemptedAt);
  return { valid, flagged: valid && flag.address === composeSalesGeocodingAddress(row), outcome: valid ? flag.outcome : null };
}
// Roots TB Draft evidence does not bind (schema TB10): recording a lookup is not a Sales change.
export const NON_MATERIAL_SALES_ROOTS = Object.freeze(["erfLocated", "erfLookup", "metadata"]);
export function salesMaterial(row) {
  if (!row || typeof row !== "object") return row;
  const material = { ...row };
  for (const key of NON_MATERIAL_SALES_ROOTS) delete material[key];
  return material;
}
// Schema TB10: a successful TB Draft location. A record of the lookup, not the ERF decision;
// it applies only while its address is the meter's current composed address.
export const ERF_LOCATED_KEYS = Object.freeze(["version", "erfId", "wardPcode", "address", "provider", "locatedAt", "locatedByUid", "locatedByUser"]);
export function inspectErfLocated(row = {}) {
  if (!Object.hasOwn(row, "erfLocated")) return { valid: true, located: false, erfId: null, wardPcode: null };
  const record = row.erfLocated;
  const valid = exactKeys(record, ERF_LOCATED_KEYS) && record.version === 1 && validDocumentId(record.erfId) && /^ZA[0-9]+$/.test(record.wardPcode || "") && [record.address, record.provider, record.locatedByUid, record.locatedByUser].every(nonblank) && isTimestamp(record.locatedAt);
  const located = Boolean(valid) && record.address === composeSalesGeocodingAddress(row);
  return { valid: Boolean(valid), located, erfId: located ? record.erfId : null, wardPcode: located ? record.wardPcode : null };
}
export function inspectSavedErfDecision(row = {}) {
  const hasErf = row.erfId !== undefined && row.erfId !== null;
  const hasResolution = Object.hasOwn(row, "erfResolution");
  if (!hasErf && !hasResolution) return { valid: true, established: false };
  const r = row.erfResolution;
  const g = r?.geocode;
  const valid = validDocumentId(row.erfId) && exactKeys(r, ["version", "revision", "method", "evidenceRefs", "geocode", "confirmedByUid", "confirmedByUser", "confirmedAt", "tbId"]) && r.version === 1 && Number.isInteger(r.revision) && r.revision > 0 && r.method === "GEOCODED" && Array.isArray(r.evidenceRefs) && r.evidenceRefs.length === 1 && r.evidenceRefs[0] === `ireps_erfs/${row.erfId}` && nonblank(r.confirmedByUid) && nonblank(r.confirmedByUser) && isTimestamp(r.confirmedAt) && SALES_BATCH_ID.test(r.tbId) && exactKeys(g, ["latitude", "longitude", "matchLevel", "geocodedAddress", "provider", "geocodedAt"]) && typeof g.latitude === "number" && coordinateNumber(g.latitude, 90) !== null && typeof g.longitude === "number" && coordinateNumber(g.longitude, 180) !== null && g.matchLevel === "EXACT_STREET_NUMBER" && nonblank(g.geocodedAddress) && nonblank(g.provider) && isTimestamp(g.geocodedAt);
  return { valid: Boolean(valid), established: Boolean(valid), ...(valid ? { erfId: row.erfId, point: { latitude: g.latitude, longitude: g.longitude }, resolution: r } : {}) };
}
// Targeted Batch rules TB-R046 (1.3.28): only CAT meters are batched. The category is the one Mpilo
// supplies for a month (monthlyCategories.<YYYY-MM>.leakageCategory); iREPS never calculates it.
const CATEGORY_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const SALES_CATEGORY_LABELS = Object.freeze(["CAT1 - Zero Purchaser", "CAT2 - Ghost Purchaser (1-3 mo)", "CAT3 - Micro Purchaser (<R400)", "CAT4 - Long Gap (4+ months)",
  "CAT5 - Stopped Purchasing", "CAT6 - Low kWh per Rand", "CAT8 - Energy Without Purchase", "Normal - No Leakage Flag"]);
export const SALES_CATEGORY_CODES = Object.freeze(["SALES_CATEGORY_NORMAL", "SALES_CATEGORY_NONE"]);
const categoryMonthsOf = row => (isRecord(row?.monthlyCategories) ? Object.keys(row.monthlyCategories).filter(month => CATEGORY_MONTH.test(month) && nonblank(row.monthlyCategories[month]?.leakageCategory)) : []);
// The newest month in which any of these meters has a category; for all of an LM's meters, the LM's category month.
export function newestSalesCategoryMonth(rows = []) {
  return (Array.isArray(rows) ? rows : [rows]).flatMap(categoryMonthsOf).sort().at(-1) || null;
}
export function salesCategoryKind(row = {}, month = null) {
  const label = CATEGORY_MONTH.test(month || "") ? String(row?.monthlyCategories?.[month]?.leakageCategory ?? "").trim() : "";
  return { kind: /^CAT[1-8]\b/i.test(label) ? "CAT" : /^normal\b/i.test(label) ? "NORMAL" : "NONE", label: label || null, month: month || null };
}
export function evaluateSalesBatchability(row = {}, { salesId = row.id, lmPcode = row.lmPcode, source, categoryMonth } = {}) {
  const fail = (code, reason) => ({ batchable: false, code, reason });
  if (!row || !SALES_ID.test(salesId || "") || row.master?.id !== salesId || row.meterNoNormalized !== salesId || !nonblank(row.meterNo) || row.meterNo.replace(/\s/g, "").toUpperCase() !== salesId) return fail("SALES_IDENTITY_INVALID", "Sales meter identity is missing or conflicting");
  if (!/^ZA[0-9]+$/.test(row.lmPcode || "") || row.lmPcode !== lmPcode) return fail("SALES_LM_INVALID", "Sales municipality authority is missing or conflicting");
  if (!["VISIBLE", "INVISIBLE"].includes(row.master?.visibility)) return fail("SALES_VISIBILITY_INVALID", "Sales master visibility is invalid");
  const type = String(row.meterType || row.MeterType || row.meterMode || row.MeterMode || row.tariffType || "PREPAID").trim().toUpperCase();
  if (!["PREPAID", "CONVENTIONAL"].includes(type)) return fail("SALES_METER_TYPE_UNSUPPORTED", "Sales meter type is unsupported");
  const status = classifySalesWorkStatus(row);
  if (status !== "NOT_STARTED") return fail(`SALES_STATUS_${status}`, `${status} — not batchable`);
  const membership = resolveSalesTargetedBatchMembership(row);
  if (membership.state !== "NONE") return fail(membership.state === "MEMBER" ? "CURRENT_TARGETED_BATCH" : "TARGETED_BATCH_MEMBERSHIP_UNRESOLVED", membership.reason);
  if (!inspectSalesTbRefsIntegrity(row.tbRefs).valid || row.tbRefsIntegrity?.valid === false) return fail("TB_REFERENCE_INTEGRITY_INVALID", "Targeted Batch reference data is invalid");
  const saved = inspectSavedErfDecision(row);
  if (!saved.valid) return fail("ERF_RESOLUTION_INVALID", "Saved ERF and coordinates are incomplete or malformed");
  const lookup = inspectErfLookup(row);
  if (!lookup.valid) return fail("ERF_LOOKUP_INVALID", "Failed ERF lookup data is malformed");
  const gps = hasUsableSalesGps(row);
  if (source && gps !== (source === "PREPAID_SALES")) return fail("SALES_ORIGIN_CHANGED", gps ? "Use GPS Sales" : "Use Non-GPS Sales");
  if (!gps) {
    if (lookup.flagged) return fail("NEEDS_MANUAL_ERFING", `Needs manual ERFing — ${lookup.outcome}`);
    if (![row.town, row.adr?.strNo, row.adr?.strName].every(meaningful)) return fail("PLANNING_ADDRESS_INVALID", "Town, street number or street name is missing");
  } else if (!saved.established && !singlePipelineErf(row).ok) return fail("PIPELINE_ERF_INVALID", "GPS Sales needs exactly one valid pipeline ERF and coordinate pair");
  // Rules TB-R046: after every data check, only a CAT meter can be batched. The server always passes
  // the LM's category month; a screen holding only a few meters uses each meter's newest month.
  const category = salesCategoryKind(row, categoryMonth === undefined ? newestSalesCategoryMonth(row) : categoryMonth);
  if (category.kind === "NORMAL") return fail("SALES_CATEGORY_NORMAL", "Normal — only CAT meters are batched");
  if (category.kind !== "CAT") return fail("SALES_CATEGORY_NONE", `No category${category.month ? ` for ${category.month}` : ""} — only CAT meters are batched`);
  return { batchable: true, code: "BATCHABLE", reason: "Batchable Sales meter" };
}
export function addSalesSelection(selectedIds, additions) {
  const next = [...new Set([...selectedIds, ...additions])];
  if (next.length > SALES_BATCH_MAX) return { selectedIds, changed: false, message: `Cannot add ${next.length - selectedIds.length} meters: ${SALES_BATCH_MAX - selectedIds.length} slots remain (maximum ${SALES_BATCH_MAX}).` };
  return { selectedIds: next, changed: next.length !== selectedIds.length, message: "" };
}
