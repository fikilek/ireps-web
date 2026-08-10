import crypto from "crypto";
import fs from "fs";
import path from "path";

export const RESET_SCHEMA_VERSION = "3.0.0";
export const RESET_MANIFEST_VERSION = "2.0.0";
export const EXPECTED_PROJECT_ID = "ireps2";
export const CONFIRM_TOKEN = "RESET_TARGETED_BATCH_AND_NA_SCOPE_DEV";
export const SOURCE_MODULE = "SALES_TARGETED_BATCH";
export const EVIDENCE_PREFIX = "meters/no_access/";
export const RESET_POLICY = Object.freeze({
  deleteCollections: ["tb_rows", "tb_uploads"],
  deleteExactDocuments: ["trns"],
  deleteExactStorageObjects: true,
  premiseOperation: "REMOVE_EXACT_MANIFEST_TRN_IDS_ONLY",
  erfOperation: "REBUILD_CANONICAL_TRN_COUNTS_FOR_MANIFEST_REGISTRY_ERFS_ONLY",
  demoSalesOperation: "DELETE_ROOT_FIELD_tbRefs_ONLY",
  forbiddenDocumentDeletes: ["premises", "ireps_erfs", "registry_erfs", "demo_sales_meters", "asts"],
  irepsErfsScope: "ZERO_READS_ZERO_WRITES_OUTSIDE_RESET_SCOPE",
});

const text = (value) => typeof value === "string" ? value.trim() : "";
const isPlainObject = (value) => value !== null && typeof value === "object" &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function contextResult(data) {
  const context = data?.targetedBatchContext;
  if (!isPlainObject(context)) return {valid: false, reason: "MALFORMED_TARGETED_BATCH_CONTEXT"};
  const ids = ["tbId", "rowId", "salesDocId", "erfId"];
  if (!ids.every((key) => text(context[key]))) return {valid: false, reason: "INCOMPLETE_TARGETED_BATCH_CONTEXT"};
  const authoritativeErfIds = [data?.accessData?.erfId, data?.accessData?.erf?.id]
    .map(text).filter(Boolean);
  if (authoritativeErfIds.some((erfId) => erfId !== context.erfId)) {
    return {valid: false, reason: "CONFLICTING_ERF_IDENTITY"};
  }
  return {valid: true};
}

export function classifySalesTbTrn({id, data = {}} = {}) {
  const context = contextResult(data);
  const sourceIsSalesTb = data.sourceModule === SOURCE_MODULE;
  const hasSalesSignal = sourceIsSalesTb || data.targetedBatchContext != null;
  const identityMatches = Boolean(text(id)) && data.id === id;
  const trnTypeMatches = data.accessData?.trnType === "METER_DISCOVERY";
  const access = data.accessData?.access?.hasAccess;
  const canonicalNa = sourceIsSalesTb && identityMatches && context.valid && trnTypeMatches &&
    access === "no" && data.meterType === "NA";
  if (canonicalNa) return {classification: "CANONICAL_SALES_TB_NA", reasons: []};

  const successful = sourceIsSalesTb && identityMatches && context.valid && trnTypeMatches &&
    access === "yes" && data.meterType !== "NA" && text(data.meterType);
  if (successful) return {classification: "NON_TARGET", preservedReason: "SUCCESSFUL_SALES_TB_METER_DISCOVERY", reasons: []};
  if (!hasSalesSignal) return {classification: "NON_TARGET", reasons: []};

  const reasons = [];
  if (!sourceIsSalesTb) reasons.push("CONTRADICTORY_SALES_TB_SOURCE");
  if (!identityMatches) reasons.push("ROOT_ID_MISMATCH");
  if (!context.valid) reasons.push(context.reason);
  if (!trnTypeMatches) reasons.push("INVALID_SALES_TB_TRN_TYPE");
  if (access === "no" && data.meterType !== "NA") reasons.push("NO_ACCESS_WITH_NON_NA_METER_TYPE");
  if (access === "yes" && data.meterType === "NA") reasons.push("SUCCESS_WITH_NA_METER_TYPE");
  if (!reasons.length) reasons.push("INCOMPLETE_OR_CONTRADICTORY_SALES_TB_SIGNALS");
  return {classification: "AMBIGUOUS_SALES_TB_RECORD", reasons};
}

export function premiseCorrelation({premiseId, premiseExists} = {}) {
  if (!text(premiseId)) return {valid: true, classification: "VALID_PRE_PREMISE_NO_ACCESS", includeManifest: false};
  if (!premiseExists) return {valid: false, classification: "MISSING_REFERENCED_PREMISE", includeManifest: false};
  return {valid: true, classification: "REFERENCED_PREMISE", includeManifest: true};
}

export function correlationState(exists = {}) {
  const states = [];
  if (!exists.tb) states.push("ORPHAN_PARENT");
  if (!exists.row) states.push("ORPHAN_ROW");
  if (!exists.sales) states.push("MISSING_SALES_DOCUMENT");
  if (exists.premiseRequired && !exists.premise) states.push("MISSING_REFERENCED_PREMISE");
  if (!exists.registryErf) states.push("MISSING_REGISTRY_ERF");
  return states.length ? states : ["FULLY_CORRELATED"];
}

const sameText = (left, right) => text(left) === text(right);
export function proveCanonicalCorrelation({trnId, trn = {}, rowId, row = {}, tbId,
  parent = {}, salesDocId, sales = {}, erfId, premiseId = null, premise = null,
  registryErf = {}} = {}) {
  const blockers = [];
  if (!sameText(trn.id, trnId)) blockers.push("TRN_ROOT_ID_MISMATCH");
  const context = trn.targetedBatchContext || {};
  for (const [key, value] of [["tbId", tbId], ["rowId", rowId],
    ["salesDocId", salesDocId], ["erfId", erfId]]) {
    if (!sameText(context[key], value)) blockers.push(`TRN_${key.replace(/([A-Z])/g, "_$1").toUpperCase()}_MISMATCH`);
  }
  if (trn.sourceModule !== SOURCE_MODULE) blockers.push("TRN_SOURCE_MODULE_MISMATCH");
  if (text(trn.accessData?.erfId) && !sameText(trn.accessData.erfId, erfId)) blockers.push("TRN_ACCESS_ERF_ID_MISMATCH");
  const authoritativePremise = text(trn.accessData?.premise?.id);
  if (authoritativePremise && !sameText(authoritativePremise, premiseId)) blockers.push("TRN_PREMISE_ID_MISMATCH");
  if (!sameText(row.id, rowId)) blockers.push("ROW_ROOT_ID_MISMATCH");
  if (!sameText(row.tbId, tbId)) blockers.push("ROW_TB_ID_MISMATCH");
  if (!sameText(row.salesAllMeterId, salesDocId)) blockers.push("ROW_SALES_DOC_ID_MISMATCH");
  if (!sameText(row.refs?.erfId, erfId)) blockers.push("ROW_ERF_ID_MISMATCH");
  if (premiseId && text(row.refs?.premiseId) && !sameText(row.refs.premiseId, premiseId)) blockers.push("ROW_PREMISE_ID_MISMATCH");
  if (row.execution?.status === "COMPLETED" || text(row.refs?.meterId) || text(row.refs?.trnId)) blockers.push("ROW_COMPLETION_STATE_CONFLICT");
  if (text(parent.id) && !sameText(parent.id, tbId)) blockers.push("PARENT_BATCH_ID_MISMATCH");
  const matches = Array.isArray(sales.tbRefs) ? sales.tbRefs.filter((ref) =>
    sameText(ref?.id, tbId) && sameText(ref?.rowId, rowId)) : [];
  if (!matches.length) blockers.push("SALES_TBREF_NOT_FOUND");
  if (matches.length > 1) blockers.push("DUPLICATE_SALES_TBREF_MATCH");
  const match = matches.length === 1 ? matches[0] : null;
  const refErfId = text(match?.erfId) || text(match?.fieldWork?.erfId);
  if (refErfId && !sameText(refErfId, erfId)) blockers.push("SALES_TBREF_ERF_ID_MISMATCH");
  const refPremiseId = text(match?.premiseId) || text(match?.fieldWork?.premiseId);
  if (premiseId && refPremiseId && !sameText(refPremiseId, premiseId)) blockers.push("SALES_TBREF_PREMISE_ID_MISMATCH");
  if (premiseId) {
    if (!premise) blockers.push("MISSING_REFERENCED_PREMISE");
    else {
      if (text(premise.id) && !sameText(premise.id, premiseId)) blockers.push("PREMISE_ROOT_ID_MISMATCH");
      if (text(premise.erfId) && !sameText(premise.erfId, erfId)) blockers.push("PREMISE_ERF_ID_MISMATCH");
      const ids = premise.noAccessTrnIds;
      if (!Array.isArray(ids) || ids.filter((id) => id === trnId).length !== 1) blockers.push("PREMISE_TRN_LINK_MISMATCH");
    }
  }
  if (text(registryErf.id) && !sameText(registryErf.id, erfId)) blockers.push("REGISTRY_ERF_ID_MISMATCH");
  if (!Object.keys(registryErf).length) blockers.push("MISSING_REGISTRY_ERF");
  return {valid: blockers.length === 0, blockers: [...new Set(blockers)], matchingSalesTbRef: match};
}

export function cleanPremiseIds(current, targets) {
  if (!Array.isArray(current) || current.some((id) => typeof id !== "string" || !id.trim())) {
    return {safe: false, reason: "MALFORMED_NO_ACCESS_TRN_IDS"};
  }
  const targetSet = new Set(targets);
  const duplicateTargetIds = [...targetSet].filter((id) => current.filter((item) => item === id).length > 1);
  if (duplicateTargetIds.length) return {safe: false, reason: "DUPLICATE_TARGET_IDS", duplicateTargetIds};
  const remaining = current.filter((id) => !targetSet.has(id));
  return {safe: true, remaining, removed: current.filter((id) => targetSet.has(id)), missing: [...targetSet].filter((id) => !current.includes(id))};
}

export function parseStorageObject(media, {expectedBucket = "ireps2.appspot.com", prefix = EVIDENCE_PREFIX} = {}) {
  const raw = text(media?.storagePath) || text(media?.url) || text(media?.uri);
  let bucket = "";
  let objectPath = "";
  try {
    if (raw.startsWith("gs://")) {
      const parsed = new URL(raw);
      bucket = parsed.hostname;
      objectPath = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    } else {
      const parsed = new URL(raw);
      const match = parsed.pathname.match(/^\/v0\/b\/([^/]+)\/o\/([^/]+)$/);
      if (parsed.protocol !== "https:" || parsed.hostname !== "firebasestorage.googleapis.com" || !match) throw new Error("unsupported URL");
      bucket = decodeURIComponent(match[1]);
      objectPath = decodeURIComponent(match[2]);
    }
  } catch {
    return {eligible: false, reason: "UNRESOLVED_STORAGE_PATH", bucket: null, objectPath: null};
  }
  if (bucket !== expectedBucket) return {eligible: false, reason: "UNEXPECTED_BUCKET", bucket, objectPath};
  if (/[*?[\]{}]/.test(objectPath)) return {eligible: false, reason: "WILDCARD_PATH", bucket, objectPath};
  if (!objectPath.startsWith(prefix)) return {eligible: false, reason: "OUTSIDE_APPROVED_PREFIX", bucket, objectPath};
  if (!objectPath.slice(prefix.length) || objectPath.endsWith("/")) return {eligible: false, reason: "FOLDER_PATH", bucket, objectPath};
  return {eligible: true, reason: null, bucket, objectPath};
}

export function validateEvidenceReferences(media, trnId, options = {}) {
  const entries = (Array.isArray(media) ? media : []).filter((item) => item?.tag === "noAccessPhoto");
  if (!entries.length) return {valid: false, reason: "MISSING_NO_ACCESS_EVIDENCE", references: []};
  if (entries.length !== 1) return {valid: false, reason: "MULTIPLE_NO_ACCESS_EVIDENCE", references: []};
  const parsed = parseStorageObject(entries[0], options);
  if (!parsed.eligible) return {valid: false, reason: parsed.reason, references: [{...parsed, mediaTag: "noAccessPhoto"}]};
  const expectedPath = `${options.prefix || EVIDENCE_PREFIX}${trnId}_noAccessPhoto.jpg`;
  if (parsed.objectPath !== expectedPath) return {valid: false, reason: "UNEXPECTED_EVIDENCE_OBJECT_PATH", references: [{...parsed, mediaTag: "noAccessPhoto"}]};
  return {valid: true, reason: null, references: [{...parsed, mediaTag: "noAccessPhoto"}]};
}

export function evidenceObjectState(reference, metadata, error) {
  if (error?.code === 404 || error?.statusCode === 404) return {...reference, state: "ALREADY_MISSING", exists: false, generation: null, metageneration: null, deletionEligible: true};
  if (error) return {...reference, state: "STORAGE_METADATA_FAILED", exists: false, reason: `STORAGE_READ_FAILED_${error.code || error.statusCode || "UNKNOWN"}`, deletionEligible: false};
  return {...reference, state: "EXISTS", exists: true, generation: String(metadata?.generation), metageneration: String(metadata?.metageneration), deletionEligible: Boolean(metadata?.generation && metadata?.metageneration)};
}

export function detectDuplicates(values, key = (value) => value) {
  const seen = new Set(); const duplicates = new Set();
  for (const value of values) { const id = key(value); if (seen.has(id)) duplicates.add(id); seen.add(id); }
  return [...duplicates].sort();
}

export function markSharedStorage(objects, nonTargetKeys = new Set()) {
  const counts = new Map();
  objects.forEach((item) => counts.set(`${item.bucket}/${item.objectPath}`, (counts.get(`${item.bucket}/${item.objectPath}`) || 0) + 1));
  return objects.map((item) => { const key = `${item.bucket}/${item.objectPath}`; const shared = counts.get(key) > 1 || nonTargetKeys.has(key); return {...item, deletionEligible: Boolean(item.deletionEligible) && !shared, shared}; });
}

export function serializeFirestoreValue(value) {
  if (value === null || ["string", "boolean", "number"].includes(typeof value)) return value;
  if (value === undefined) return {__type__: "Undefined"};
  if (value instanceof Date) return {__type__: "Date", iso: value.toISOString()};
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return {__type__: "Bytes", base64: value.toString("base64")};
  if (value instanceof Uint8Array) return {__type__: "Bytes", base64: Buffer.from(value).toString("base64")};
  if (Array.isArray(value)) return value.map(serializeFirestoreValue);
  if (value && typeof value.toDate === "function" && ("seconds" in value || "_seconds" in value)) {
    return {__type__: "Timestamp", iso: value.toDate().toISOString(), seconds: String(value.seconds ?? value._seconds), nanoseconds: value.nanoseconds ?? value._nanoseconds ?? 0};
  }
  if (value && Number.isFinite(value.latitude) && Number.isFinite(value.longitude) && value.constructor?.name === "GeoPoint") {
    return {__type__: "GeoPoint", latitude: value.latitude, longitude: value.longitude};
  }
  if (value && typeof value.path === "string" && (value.constructor?.name === "DocumentReference" || value.firestore)) {
    return {__type__: "DocumentReference", path: value.path};
  }
  if (value && typeof value.toUint8Array === "function") return serializeFirestoreValue(value.toUint8Array());
  if (isPlainObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, serializeFirestoreValue(value[key])]));
  throw new TypeError(`Unsupported Firestore value: ${value?.constructor?.name || typeof value}`);
}

export function exactUpdateTime(value) {
  const seconds = value?.seconds ?? value?._seconds;
  const nanoseconds = value?.nanoseconds ?? value?._nanoseconds;
  const secondsText = typeof seconds === "bigint" ? String(seconds) : String(seconds ?? "");
  if (!/^\d+$/.test(secondsText)) throw new TypeError("MALFORMED_UPDATE_TIME_SECONDS");
  if (!Number.isInteger(nanoseconds) || nanoseconds < 0 || nanoseconds > 999999999) throw new TypeError("MALFORMED_UPDATE_TIME_NANOSECONDS");
  return {__firestoreUpdateTime__: {seconds: secondsText, nanoseconds}};
}

export function parseExactUpdateTime(value) {
  if (!isPlainObject(value) || !isPlainObject(value.__firestoreUpdateTime__)) throw new TypeError("LEGACY_OR_MISSING_EXACT_UPDATE_TIME");
  return exactUpdateTime(value.__firestoreUpdateTime__).__firestoreUpdateTime__;
}

export function exactUpdateTimesEqual(left, right) {
  try { return stableStringify(parseExactUpdateTime(left)) === stableStringify(parseExactUpdateTime(right)); } catch { return false; }
}

export function makeLastUpdateTime(value, Timestamp) {
  const exact = parseExactUpdateTime(value);
  const seconds = Number(exact.seconds);
  if (!Number.isSafeInteger(seconds)) throw new TypeError("UPDATE_TIME_SECONDS_OUT_OF_RANGE");
  return {lastUpdateTime: new Timestamp(seconds, exact.nanoseconds)};
}

export function writeImmutableJson(file, value, fileSystem = fs) {
  fileSystem.writeFileSync(file, `${JSON.stringify(serializeFirestoreValue(value), null, 2)}\n`, {encoding: "utf8", flag: "wx"});
}

export function replaceLatestPointer(file, value, {fileSystem = fs, unique = crypto.randomUUID()} = {}) {
  const directory = path.dirname(file); const temporary = path.join(directory, `.${path.basename(file)}.${unique}.tmp`);
  const content = `${JSON.stringify(serializeFirestoreValue(value), null, 2)}\n`;
  let temporaryCreated = false;
  try {
    temporaryCreated = true; fileSystem.writeFileSync(temporary, content, {encoding: "utf8", flag: "wx"});
    try { fileSystem.renameSync(temporary, file); } catch (error) {
      if (process.platform !== "win32" || !["EEXIST", "EPERM", "EACCES"].includes(error?.code)) throw error;
      const backup = path.join(directory, `.${path.basename(file)}.${unique}.bak`);
      let backedUp = false;
      try { if (fileSystem.existsSync(file)) { fileSystem.renameSync(file, backup); backedUp = true; } fileSystem.renameSync(temporary, file); temporaryCreated = false; if (backedUp) fileSystem.unlinkSync(backup); }
      catch (replaceError) { if (backedUp && !fileSystem.existsSync(file)) fileSystem.renameSync(backup, file); throw replaceError; }
    }
    temporaryCreated = false;
  } finally { if (temporaryCreated && fileSystem.existsSync(temporary)) fileSystem.unlinkSync(temporary); }
}

export function assessStorageLiveState(inventoried, liveMetadata, error) {
  const missing = error?.code === 404 || error?.statusCode === 404;
  if (inventoried.state === "ALREADY_MISSING") return missing ? {valid: true} : {valid: false, blocker: "STORAGE_OBJECT_RECREATED_AFTER_INVENTORY"};
  if (inventoried.state !== "EXISTS") return {valid: false, blocker: "INVALID_STORAGE_INVENTORY_STATE"};
  if (missing) return {valid: false, blocker: "STORAGE_OBJECT_MISSING_AFTER_INVENTORY"};
  if (error) return {valid: false, blocker: "STORAGE_OBJECT_PREFLIGHT_FAILED"};
  if (String(liveMetadata?.generation) !== String(inventoried.generation)) return {valid: false, blocker: "STORAGE_OBJECT_REPLACED_AFTER_INVENTORY"};
  if (String(liveMetadata?.metageneration) !== String(inventoried.metageneration)) return {valid: false, blocker: "STORAGE_OBJECT_METADATA_CHANGED_AFTER_INVENTORY"};
  return {valid: true};
}

export function assessSalesCollection(inventoryRows, liveRows, {final = false} = {}) {
  const expected = new Map(inventoryRows.map((row) => [row.documentId, row]));
  const live = new Map(liveRows.map((row) => [row.documentId, row])); const blockers = [];
  if (expected.size !== live.size) blockers.push("SALES_COLLECTION_COUNT_MISMATCH");
  if ([...expected.keys()].some((id) => !live.has(id)) || [...live.keys()].some((id) => !expected.has(id))) blockers.push("SALES_COLLECTION_ID_SET_MISMATCH");
  if (!final) for (const [id, row] of expected) {
    const current = live.get(id); if (!current) continue;
    if (stableStringify(row.data?.tbRefs) !== stableStringify(current.data?.tbRefs)) blockers.push(`SALES_TBREFS_MISMATCH:${id}`);
  }
  if (final && [...live.values()].some((row) => Object.hasOwn(row.data || {}, "tbRefs"))) blockers.push("SALES_TBREFS_REMAIN");
  return {valid: blockers.length === 0, blockers, count: live.size, tbRefsRemaining: [...live.values()].filter((row) => Object.hasOwn(row.data || {}, "tbRefs")).length};
}

export const stableStringify = (value) => JSON.stringify(serializeFirestoreValue(value));
export const sha256Text = (value) => crypto.createHash("sha256").update(value).digest("hex");
export const sortByKeys = (rows, keys) => [...rows].sort((a, b) => keys.map((key) => String(a[key] ?? "").localeCompare(String(b[key] ?? ""))).find((result) => result) || 0);

export function expectedErfCounts(trns, deletedIds) {
  const removed = new Set(deletedIds);
  return trns.filter((trn) => !removed.has(trn.id)).reduce((counts, trn) => { const outcome = trn.accessData?.access?.hasAccess; if (outcome === "no") counts.trnsNa += 1; if (outcome === "yes") counts.trnsAccess += 1; counts.trnsTotal = counts.trnsNa + counts.trnsAccess; return counts; }, {trnsNa: 0, trnsAccess: 0, trnsTotal: 0});
}

export function inventoryPathWithinRoot(candidate, approvedRoot, resolved = {}) {
  if (typeof candidate !== "string" || !path.win32.isAbsolute(candidate)) return {valid: false, reason: "INVENTORY_PATH_NOT_ABSOLUTE"};
  const root = path.win32.resolve(approvedRoot); const inventory = path.win32.resolve(candidate);
  const relative = path.win32.relative(root, inventory);
  if (!relative || relative.startsWith("..") || path.win32.isAbsolute(relative)) return {valid: false, reason: "INVENTORY_PATH_OUTSIDE_APPROVED_ROOT"};
  if (path.win32.basename(inventory).toLowerCase() !== "inventory.json") return {valid: false, reason: "INVENTORY_FILENAME_INVALID"};
  if (resolved.root || resolved.candidate) {
    const realRoot = path.win32.resolve(resolved.root || root); const realCandidate = path.win32.resolve(resolved.candidate || inventory);
    const realRelative = path.win32.relative(realRoot, realCandidate);
    if (!realRelative || realRelative.startsWith("..") || path.win32.isAbsolute(realRelative)) return {valid: false, reason: "INVENTORY_REALPATH_ESCAPE"};
  }
  return {valid: true, inventoryPath: inventory};
}

export function assertExpectedUpdateTime({collection, id, expected, actual, exists = true}) {
  if (!exists) throw new Error(`MISSING_GUARDED_DOCUMENT ${collection}/${id}`);
  if (!exactUpdateTimesEqual(expected, actual)) throw new Error(`STALE_UPDATE_TIME ${collection}/${id}`);
  return true;
}

export const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort();
export function cleanDemoSales(data = {}) { const next = {...data}; delete next.tbRefs; return next; }

export function validatePreflight(input) {
  const errors = [];
  if (input.projectId !== EXPECTED_PROJECT_ID) errors.push("WRONG_PROJECT");
  if (input.serviceAccountProject !== EXPECTED_PROJECT_ID) errors.push("WRONG_SERVICE_ACCOUNT_PROJECT");
  if (input.confirmToken !== CONFIRM_TOKEN) errors.push("WRONG_CONFIRMATION_TOKEN");
  if (input.inventory?.schemaVersion !== RESET_SCHEMA_VERSION) errors.push("OLD_SCHEMA_VERSION");
  if (input.inventory?.status !== "PASSED") errors.push("INVENTORY_NOT_PASSED");
  if (stableStringify(input.inventory?.resetPolicy) !== stableStringify(RESET_POLICY)) errors.push("RESET_POLICY_MISMATCH");
  if (input.hashesMatch === false) errors.push("HASH_MISMATCH");
  if (input.updateTimesMatch === false) errors.push("UPDATE_TIME_MISMATCH");
  if (input.countsMatch === false) errors.push("COUNT_MISMATCH");
  if (input.ambiguousTrns) errors.push("AMBIGUOUS_TRN");
  if (input.ambiguousStorage) errors.push("AMBIGUOUS_STORAGE");
  return {passed: errors.length === 0, errors};
}
