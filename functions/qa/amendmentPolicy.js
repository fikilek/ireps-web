import { HttpsError } from "firebase-functions/v2/https";
import { canonical } from "./review.js";
import { qaText, fieldSubmitter } from "./model.js";
import { validateMeterDiscoveryPayload } from "../meterDiscovery/validation.js";
import { validateMeterCreationPayload } from "../meterInstallation/creationValidation.js";
import { assertNoAccessMedia, buildNoAccessAccessBlock } from "../noAccess/recordNoAccess.js";
import { validateMeterCommissioning, validateMeterDisconnection, validateMeterReconnection,
  validateMeterInspection, validateMeterRemoval, validateMeterReading } from "../meterLifecycle/helpers.js";

export const same = (a, b) => JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null));
export const at = (value, path) => path.split(".").reduce((item, key) => item?.[key], value);
export function put(value, path, item) {
  const keys = path.split("."); let parent = value;
  for (const key of keys.slice(0, -1)) parent = parent[key] ||= {};
  parent[keys.at(-1)] = structuredClone(item);
}
const object = value => value && typeof value === "object" && !Array.isArray(value);
export function changes(before, after, prefix = "") {
  if (same(before, after)) return [];
  if ((object(before) || before == null) && (object(after) || after == null) && (object(before) || object(after))) return [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
    .flatMap(key => changes(before?.[key], after?.[key], prefix ? `${prefix}.${key}` : key));
  return [prefix];
}

export const WORK_BLOCKS = Object.freeze({ METER_DISCOVERY: "discovery", METER_INSTALLATION: "installation",
  METER_INSPECTION: "inspection", METER_DISCONNECTION: "disconnection", METER_RECONNECTION: "reconnection",
  METER_REMOVAL: "removal", METER_COMMISSIONING: "commissioning", METER_READING: "meterReading" });

// Fields that identify the visit or record physical outcomes are never ordinary edits.
const protectedPart = /(^|\.)(astId|astNo|meterNo|premiseId|erfId|trnId|sourceAstId|replacedAstId|replacementAstId|followUp|previous[^.]*|baseline|lastKnown|comparison|executionOutcome|outcome|success|passed|completedAt|readingAt|capturedAt|inspectedAt|metadata|created|updated)(\.|$)/;
const protectedAnswer = /^(commissioning|removal)\.(?:(?:answers|result|status)(?:\.|$)|[^.]+\.answer$)/;
export function editablePath(path, trn) {
  if (path === "media") return true;
  if (trn.accessData?.access?.hasAccess === "no") return /^accessData\.access\.(reason|reasonCode|reasonOther|reasonSelect|noAccessReason|otherText)(\.|$)/.test(path);
  if (path.startsWith("fieldComment.")) return true;
  if (["mreadings", "treadings"].includes(path)) return ["METER_DISCOVERY", "METER_INSTALLATION"].includes(trn.accessData?.trnType);
  if (protectedPart.test(path) || protectedAnswer.test(path)) return false;
  if (path.startsWith("ast.")) return !["METER_INSPECTION"].includes(trn.accessData?.trnType);
  const block = WORK_BLOCKS[trn.accessData?.trnType];
  return !!block && path.startsWith(`${block}.`);
}

export function buildAmendedRecord(before, fields) {
  if (!object(fields) || Object.keys(fields).some(key => !["ast", "media", "fieldComment", "accessData", "mreadings", "treadings", ...Object.values(WORK_BLOCKS)].includes(key))) {
    throw new HttpsError("invalid-argument", "Only editable form fields may be sent for amendment.");
  }
  const after = { ...before, ...structuredClone(fields) };
  const changed = changes(before, after);
  if (!changed.length) throw new HttpsError("invalid-argument", "Change the recorded form before submitting an amendment.");
  for (const path of changed) {
    if (!editablePath(path, before)) throw new HttpsError("failed-precondition", `This amendment cannot change ${path}. It requires its separate procedure or new work.`);
    if (at(after, path) === undefined) throw new HttpsError("invalid-argument", "A form field cannot be removed from the transaction.");
  }
  for (const [key, valueKey] of [["mreadings", "reading"], ["treadings", "tokenReading"]]) {
    if (!changed.includes(key)) continue;
    const originals = before[key] || [], amended = after[key];
    const validRows = rows => Array.isArray(rows) && rows.every(object);
    const withoutValue = rows => rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== valueKey)));
    if (!validRows(originals) || !validRows(amended) || !same(withoutValue(originals), withoutValue(amended))) throw new HttpsError("failed-precondition", "A reading correction must preserve its original capture time, identity and history.");
  }
  const serialized = JSON.stringify(fields);
  if (serialized.length > 350000 || /"(?:__proto__|constructor|prototype)"\s*:/.test(serialized)) throw new HttpsError("invalid-argument", "Invalid amendment fields.");
  if (!Array.isArray(after.media) || after.media.length > 100) throw new HttpsError("invalid-argument", "Invalid evidence list.");
  if (after.media.some(item => !item || !/^https:\/\//i.test(item.url || ""))) throw new HttpsError("invalid-argument", "Upload each evidence file before submitting the correction.");
  if (qaText(after.fieldComment?.text).length > 12000) throw new HttpsError("invalid-argument", "The field comment is too long.");
  return { after, changed };
}

const validators = { METER_COMMISSIONING: validateMeterCommissioning, METER_DISCONNECTION: validateMeterDisconnection,
  METER_RECONNECTION: validateMeterReconnection, METER_INSPECTION: validateMeterInspection,
  METER_REMOVAL: validateMeterRemoval, METER_READING: validateMeterReading };
// Validate the recorded form, not permission to execute another visit now. These
// reference states only select the existing form validator; no state is written.
const referenceStates = { METER_COMMISSIONING: "FIELD", METER_DISCONNECTION: "CONNECTED",
  METER_RECONNECTION: "DISCONNECTED", METER_INSPECTION: "CONNECTED", METER_REMOVAL: "DISCONNECTED", METER_READING: "CONNECTED" };
export function checkAmendedForm(trn, meter = {}) {
  const type = trn.accessData?.trnType;
  if (!WORK_BLOCKS[type]) throw new HttpsError("failed-precondition", "This form type is not supported for amendment.");
  if (trn.accessData?.access?.hasAccess === "no") {
    try {
      const normalized = buildNoAccessAccessBlock(trn.accessData.access, { metadata: trn.metadata });
      if (normalized.reason !== trn.accessData.access.reason || normalized.reasonCode !== trn.accessData.access.reasonCode) throw new Error("The No Access reason and its code must agree.");
      assertNoAccessMedia(trn.media, trn.accessData.access, { uploaded: true });
    } catch (error) { throw new HttpsError("invalid-argument", error.message); }
    return { astPatch: {} };
  }
  if (type === "METER_DISCOVERY") {
    const error = validateMeterDiscoveryPayload({ data: trn });
    if (error) throw new HttpsError("invalid-argument", error.message || "The discovery form is incomplete.");
    return { astPatch: { ast: trn.ast } };
  }
  if (type === "METER_INSTALLATION") {
    const error = validateMeterCreationPayload({ data: trn, expectedTrnType: type, expectedTrnPrefix: "TRN_MINST_", allowedStatuses: [] });
    if (error) throw new HttpsError("invalid-argument", error.message || "The installation form is incomplete.");
    if (!qaText(trn.ast?.astData?.astNo) || !trn.media.some(item => item.tag === "astNoPhoto" && qaText(item.url))) throw new HttpsError("invalid-argument", "The installed meter and its photo are required.");
    return { astPatch: { ast: trn.ast } };
  }
  const reference = { ...meter, meterType: trn.meterType || meter.meterType, ast: trn.ast, status: { state: referenceStates[type] } };
  const actor = fieldSubmitter(trn);
  const result = validators[type]({ data: trn, astDoc: reference, actorUid: actor.uid, actorName: actor.name });
  if (!result.ok) throw new HttpsError("invalid-argument", result.message || "The amended form is incomplete.");
  return result;
}
