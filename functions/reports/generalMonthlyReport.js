// General Monthly Report (GMR 1.2.0, schema 1.1.0).
//
// The report is the month's field transactions: one Field Data row per
// submitted transaction, read from `trns` (GMR-R005). Premises, Sales, assets
// and team history only describe a row that a transaction already made
// (GMR-R006). The Meter Registry is never read (GMR-R007).
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

export const GMR_LM_PCODE = "ZA5241";
export const GMR_LM_NAME = "Endumeni";
export const GMR_GENERATION_MODE = "MONTHLY_GMR";
export const GMR_REPORT_TYPE = "GENERAL_MONTHLY_REPORT";
export const GMR_SCHEMA_VERSION = 2;
export const GMR_RULES_VERSION = "1.2.0";
export const GMR_REPORT_SCHEMA_VERSION = "1.1.0";

const ALLOWED_GMR_ROLES = new Set(["SPU", "ADM", "MNG", "SPV"]);
const JOHANNESBURG_OFFSET_MS = 2 * 60 * 60 * 1000;
const NO_DISCONNECTION_RECORD = "No disconnection record";
const DISCONNECT_METER = "Disconnect meter";

export const GMR_TRN_TYPE_LABELS = Object.freeze({
  METER_DISCOVERY: "Meter Discovery",
  METER_INSPECTION: "Meter Inspection",
  METER_DISCONNECTION: "Meter Disconnection",
  METER_RECONNECTION: "Meter Reconnection",
  METER_READING: "Meter Reading",
  METER_REMOVAL: "Meter Removal",
  METER_INSTALLATION: "Meter Installation",
  METER_COMMISSIONING: "Meter Commissioning",
});

const FINDING_TRN_TYPES = new Set(["METER_DISCOVERY", "METER_INSPECTION"]);

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function nullableText(value) {
  const text = cleanText(value);
  if (!text || ["NAV", "N/A", "NULL", "UNDEFINED"].includes(text.toUpperCase())) {
    return null;
  }
  return text;
}

function normalizeUpper(value) {
  return cleanText(value).toUpperCase();
}

function normalizeMeterNo(value) {
  const text = nullableText(value);
  return text ? text.replace(/\s+/g, "").toUpperCase() : null;
}

// Only a real meter number is looked up on Sales (the meter master rule);
// anything else, such as "N/AV", is shown as recorded and never looked up.
export function isGmrLookupMeterNo(value) {
  return /^[A-Z0-9]+$/.test(cleanText(value));
}

// A Firestore document id cannot contain "/" or be "." or "..".
function isDocumentId(value) {
  const id = cleanText(value);
  return Boolean(id) && !id.includes("/") && id !== "." && id !== "..";
}

function titleCaseAddressPart(value) {
  const text = nullableText(value);
  if (!text) return null;
  return text
    .toLowerCase()
    .replace(/(^|[\s\-'])\p{L}/gu, (match) => match.toUpperCase());
}

function titleCaseWords(value) {
  const text = nullableText(value);
  if (!text) return null;
  return text
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

export function timestampToIso(value) {
  if (!value) return null;

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (Number.isFinite(Number(value?.seconds)) && typeof value !== "string") {
    const milliseconds =
      Number(value.seconds) * 1000 + Number(value?.nanoseconds || 0) / 1_000_000;
    return new Date(milliseconds).toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isValidMonthKey(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

function johannesburgMonthKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const shifted = new Date(date.getTime() + JOHANNESBURG_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

function reportMonthLabel(reportMonth) {
  const [year, month] = reportMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-ZA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function getGmrReportMonthWindow(reportMonth) {
  if (!isValidMonthKey(reportMonth)) {
    throw new RangeError("GMR reporting month must use YYYY-MM format.");
  }

  const [year, month] = reportMonth.split("-").map(Number);
  const startMs = Date.UTC(year, month - 1, 1) - JOHANNESBURG_OFFSET_MS;
  const endMs = Date.UTC(year, month, 1) - JOHANNESBURG_OFFSET_MS;

  return {
    reportMonth,
    reportingPeriodLabel: reportMonthLabel(reportMonth),
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
    startMs,
    endMs,
  };
}

// GMR-R011: no future month; the current month may be generated and is
// labelled incomplete.
export function validateGmrReportMonth(reportMonth, now = new Date()) {
  const window = getGmrReportMonthWindow(reportMonth);
  const currentMonth = johannesburgMonthKey(now);
  if (!currentMonth || reportMonth > currentMonth) {
    throw new RangeError("GMR reporting month cannot be in the future.");
  }
  return { ...window, isIncompleteMonth: reportMonth === currentMonth };
}

function isInWindow(iso, window) {
  if (!iso) return false;
  const milliseconds = new Date(iso).getTime();
  return (
    Number.isFinite(milliseconds) &&
    milliseconds >= window.startMs &&
    milliseconds < window.endMs
  );
}

export function getGmrTrnType(trn = {}) {
  return normalizeUpper(trn?.accessData?.trnType || trn?.trnType);
}

// Schema 2: a transaction with a workflow counts once the field completed it;
// one with no workflow was written on submission.
export function hasWorkflow(trn = {}) {
  return Boolean(cleanText(trn?.workflow?.state));
}

export function getGmrSubmissionTime(trn = {}) {
  if (hasWorkflow(trn)) {
    return normalizeUpper(trn.workflow.state) === "COMPLETED"
      ? timestampToIso(trn.workflow.completedAt)
      : null;
  }
  return timestampToIso(trn?.metadata?.createdAt);
}

export function isGmrTransactionInMonth(trn = {}, window) {
  return isInWindow(getGmrSubmissionTime(trn), window);
}

function getFieldWorker(trn = {}) {
  if (hasWorkflow(trn)) {
    return {
      uid: nullableText(trn?.workflow?.completedByUid) || nullableText(trn?.metadata?.createdByUid),
      name: nullableText(trn?.workflow?.completedByUser) || nullableText(trn?.metadata?.createdByUser),
    };
  }
  return {
    uid: nullableText(trn?.metadata?.createdByUid),
    name: nullableText(trn?.metadata?.createdByUser),
  };
}

// GMR-R034: an inspection records its finding under inspection.captured.ast.
function getCapturedAst(trn = {}) {
  const trnType = getGmrTrnType(trn);
  if (trnType === "METER_INSPECTION") return trn?.inspection?.captured?.ast || {};
  if (trnType === "METER_DISCOVERY") return trn?.ast || {};
  return null;
}

function getAstData(trn = {}) {
  const captured = getCapturedAst(trn);
  return captured?.astData || trn?.ast?.astData || {};
}

function getLocation(trn = {}) {
  const captured = getCapturedAst(trn);
  return captured?.location || trn?.ast?.location || {};
}

export function getGmrAstId(trnId, trn = {}) {
  const astId = nullableText(trn?.ast?.astData?.astId || getAstData(trn)?.astId);
  if (astId) return astId;
  // A discovery creates the meter under its own transaction number.
  return getGmrTrnType(trn) === "METER_DISCOVERY" ? cleanText(trnId) || null : null;
}

function hasAccess(trn = {}) {
  return normalizeUpper(trn?.accessData?.access?.hasAccess) !== "NO";
}

function getNoAccessReason(trn = {}) {
  const access = trn?.accessData?.access || {};
  return (
    nullableText(access.reason) ||
    nullableText(access.noAccessReason) ||
    nullableText(access.reasonText) ||
    nullableText(trn?.executionOutcome?.reason) ||
    null
  );
}

function getNormalisation(trn = {}) {
  const captured = getCapturedAst(trn);
  return captured?.normalisation || null;
}

export function getGmrNormalisationActions(trn = {}) {
  const raw = getNormalisation(trn)?.actionTaken;
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return values.map((value) => cleanText(value)).filter(Boolean);
}

function getGpsCoordinates(trn = {}) {
  const lat = Number(getLocation(trn)?.gps?.lat);
  const lng = Number(getLocation(trn)?.gps?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return `${lat}, ${lng}`;
}

function getPhotoUrls(trn = {}) {
  const media = Array.isArray(trn?.media) ? trn.media : [];
  return media
    .map((item) => nullableText(item?.url || item?.uri))
    .filter(Boolean);
}

function displayMeterMode(value) {
  const text = nullableText(value);
  if (!text) return null;
  const token = normalizeUpper(text).replace(/[^A-Z0-9]/g, "");
  if (token === "PREPAID") return "Prepaid";
  if (["CONVENTIONAL", "POSTPAID", "CREDIT"].includes(token)) return "Conventional";
  return text;
}

function displayMeterPhase(value) {
  const text = nullableText(value);
  if (!text) return null;
  const token = normalizeUpper(text).replace(/[^A-Z0-9]/g, "");
  if (["SINGLE", "SINGLEPHASE", "1", "1PH", "1PHASE"].includes(token)) return "Single Phase";
  if (["THREE", "THREEPHASE", "3", "3PH", "3PHASE"].includes(token)) return "Three Phase";
  return text;
}

function displayVisibility(value) {
  const normalized = normalizeUpper(value);
  if (normalized === "VISIBLE") return "Visible";
  if (normalized === "INVISIBLE") return "Invisible";
  return nullableText(value);
}

function displayChannel(trn = {}) {
  const channel = normalizeUpper(trn?.origin?.channel);
  if (channel === "FIELD") return "Field";
  if (channel === "OFFICE") return "Office";
  if (channel) return titleCaseWords(channel);
  // Schema 1.0.1: a transaction with no workflow was submitted in the field.
  return hasWorkflow(trn) ? null : "Field";
}

function wardLabel(wardPcode) {
  const text = nullableText(wardPcode);
  if (!text) return null;
  const match = text.match(/(\d{1,3})$/);
  return match ? `Ward ${Number(match[1])}` : text;
}

// GMR-R022: the reporting month's authoritative category only.
export function getGmrSalesCategory(sales = {}, reportMonth) {
  const entry = sales?.monthlyCategories?.[reportMonth];
  if (
    !entry ||
    typeof entry !== "object" ||
    Array.isArray(entry) ||
    Object.keys(entry).sort().join(",") !== "leakageCategory,riskScore,riskTier" ||
    typeof entry.leakageCategory !== "string" ||
    !entry.leakageCategory.trim() ||
    typeof entry.riskTier !== "string" ||
    !entry.riskTier.trim() ||
    !Number.isInteger(entry.riskScore) ||
    entry.riskScore < 0
  ) {
    return null;
  }
  return entry.leakageCategory.trim();
}

// GMR-R033: a suspicion is not a healthy meter.
export function getGmrFindingGroup({ trnType, hasAccess: accessible, anomaly, anomalyDetail }) {
  if (!FINDING_TRN_TYPES.has(trnType)) return null;
  if (!accessible) return "No Access";
  const finding = cleanText(anomaly);
  if (!finding) return null;
  if (normalizeUpper(finding) === "METER OK") {
    return /SUSPICION/i.test(cleanText(anomalyDetail))
      ? "Meter Ok · Suspicion"
      : "Meter Ok · Operationally Ok";
  }
  return finding;
}

// GMR-R032: what the finding called for. A Disconnect meter recorded before
// the follow-up existed has no disconnection behind it.
export function getGmrFollowUp(normalisation = null, actions = []) {
  const followUp = normalisation?.followUp;
  if (followUp && typeof followUp === "object") {
    return {
      required: titleCaseWords(followUp.required),
      status: nullableText(followUp.status),
      trnId: nullableText(followUp.trnId),
    };
  }
  if (actions.includes(DISCONNECT_METER)) {
    return { required: "Meter Disconnection", status: NO_DISCONNECTION_RECORD, trnId: null };
  }
  return { required: null, status: null, trnId: null };
}

export function resolveGmrTeamAt(periods = [], userUid, submittedAtIso) {
  const uid = cleanText(userUid);
  const at = new Date(submittedAtIso || "").getTime();
  if (!uid || !Number.isFinite(at)) return "Unassigned";

  const covering = new Map();
  periods.forEach((period) => {
    if (cleanText(period?.userUid) !== uid) return;
    const joined = new Date(timestampToIso(period?.joinedAt) || "").getTime();
    const leftIso = timestampToIso(period?.leftAt);
    const left = leftIso ? new Date(leftIso).getTime() : Infinity;
    if (!Number.isFinite(joined) || at < joined || at >= left) return;
    const teamId = cleanText(period?.teamId) || cleanText(period?.teamName);
    covering.set(teamId, nullableText(period?.teamName) || teamId);
  });

  if (covering.size === 1) return [...covering.values()][0];
  if (covering.size > 1) return "Multiple";
  return "Unassigned";
}

export function buildGmrFieldRow({
  trnId,
  trn = {},
  reportMonth,
  premise = null,
  sales = null,
  fieldSalesExists = false,
  ast = null,
  team = "Unassigned",
}) {
  const trnType = getGmrTrnType(trn);
  const submittedAt = getGmrSubmissionTime(trn);
  if (!submittedAt) throw new Error("The submission time cannot be read.");

  const accessible = hasAccess(trn);
  const captured = getCapturedAst(trn);
  const astData = getAstData(trn);
  const location = getLocation(trn);
  const targeted = trn?.targetedBatchContext || {};
  const worker = getFieldWorker(trn);
  const premiseAddress = premise?.address || {};
  const normalisation = getNormalisation(trn);
  const actions = getGmrNormalisationActions(trn);
  const followUp = getGmrFollowUp(normalisation, actions);
  const anomaly = accessible ? nullableText(captured?.anomalies?.anomaly) : "No Access";
  const anomalyDetail = accessible
    ? nullableText(captured?.anomalies?.anomalyDetail)
    : getNoAccessReason(trn);
  const originalProjectMeterNo = normalizeMeterNo(targeted?.meterNo);
  const fieldFoundMeterNo = normalizeMeterNo(astData?.astNo);
  const meterType = normalizeUpper(trn?.meterType);
  const isElectricity = meterType === "ELECTRICITY";

  return {
    captureDate: submittedAt,
    trnId: cleanText(trnId),
    trnType,
    trnTypeLabel: GMR_TRN_TYPE_LABELS[trnType] || titleCaseWords(trnType) || null,
    channel: displayChannel(trn),
    fieldWorkerUid: worker.uid,
    fieldWorkerName: worker.name,
    team: nullableText(team) || "Unassigned",
    batchId: nullableText(targeted?.tbId) || "AD HOC",
    streetNo: nullableText(premiseAddress?.strNo),
    streetName: titleCaseAddressPart(premiseAddress?.strName),
    streetType: titleCaseAddressPart(premiseAddress?.strType),
    suburbName: nullableText(premiseAddress?.suburbName),
    gpsCoordinates: getGpsCoordinates(trn),
    ward: wardLabel(trn?.accessData?.parents?.wardPcode),
    propertyType: nullableText(premise?.propertyType?.type),
    propertyName: nullableText(premise?.propertyType?.name),
    propertyUnitNo: nullableText(premise?.propertyType?.unitNo),
    meterMode: displayMeterMode(astData?.meter?.type),
    meterPhase: displayMeterPhase(astData?.meter?.phase),
    meterPlacement: nullableText(location?.placement),
    originalProjectMeterNo,
    fieldFoundMeterNo,
    sameDifferent:
      originalProjectMeterNo && fieldFoundMeterNo
        ? originalProjectMeterNo === fieldFoundMeterNo ? "Same" : "Different"
        : null,
    remainingCredit: nullableText(astData?.meter?.remainingCredit),
    salesCategory: sales ? getGmrSalesCategory(sales, reportMonth) : null,
    primaryFinding: anomaly,
    findingDetail: anomalyDetail,
    normalisation: actions.length ? actions.join(" • ") : null,
    noActionReason: nullableText(normalisation?.noActionReason),
    sealNo: nullableText(astData?.meter?.seal?.sealNo),
    fieldComment: nullableText(trn?.fieldComment?.text),
    visibility: displayVisibility(ast?.master?.visibility),
    onVendingList:
      isGmrLookupMeterNo(fieldFoundMeterNo) && isElectricity
        ? (fieldSalesExists ? "Yes" : "No")
        : null,
    startedFrom:
      nullableText(trn?.origin?.parentTrnId) ||
      nullableText(trn?.origin?.parentInspectionTrnId),
    followUpRequired: followUp.required,
    followUpStatus: followUp.status,
    followUpTrnId: followUp.trnId,
    photoUrls: getPhotoUrls(trn),

    // For Field Stats.
    hasAccess: accessible,
    meterType: meterType || null,
    findingGroup: getGmrFindingGroup({
      trnType,
      hasAccess: accessible,
      anomaly: captured?.anomalies?.anomaly,
      anomalyDetail: captured?.anomalies?.anomalyDetail,
    }),
    normalisationActions: actions,
  };
}

function readRole(request, userData = {}) {
  return normalizeUpper(
    userData?.employment?.role || userData?.role || request?.auth?.token?.role,
  );
}

function getWorkbaseIds(userData = {}) {
  const workbases = Array.isArray(userData?.access?.workbases)
    ? userData.access.workbases
    : [];
  const ids = workbases
    .map((item) => cleanText(typeof item === "string" ? item : item?.id || item?.lmPcode))
    .filter(Boolean);

  const active = cleanText(
    userData?.access?.activeWorkbase?.id || userData?.access?.activeWorkbase?.lmPcode,
  );
  if (active) ids.push(active);

  return new Set(ids);
}

async function assertGmrAccess({ db, request, lmPcode }) {
  const uid = request?.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const userSnap = await db.collection("users").doc(uid).get();
  const userData = userSnap.exists ? userSnap.data() || {} : {};
  const role = readRole(request, userData);

  if (!ALLOWED_GMR_ROLES.has(role)) {
    throw new HttpsError(
      "permission-denied",
      "Only managers may generate the General Monthly Report.",
    );
  }

  if (role === "SPU" || role === "ADM") {
    return { uid, role };
  }

  if (!getWorkbaseIds(userData).has(lmPcode)) {
    throw new HttpsError(
      "permission-denied",
      "Endumeni is not one of your workbases, so you cannot generate its report.",
    );
  }

  return { uid, role };
}

async function getDocsByIds(db, collectionName, ids = []) {
  const uniqueIds = Array.from(new Set(ids.map((id) => cleanText(id)).filter(isDocumentId)));
  const results = new Map();

  for (let index = 0; index < uniqueIds.length; index += 100) {
    const refs = uniqueIds
      .slice(index, index + 100)
      .map((id) => db.collection(collectionName).doc(id));
    const snapshots = refs.length ? await db.getAll(...refs) : [];
    snapshots.forEach((snapshot) => {
      if (snapshot.exists) results.set(snapshot.id, snapshot.data() || {});
    });
  }

  return results;
}

async function getTeamHistory(db, userUids = []) {
  const uids = Array.from(new Set(userUids.map((uid) => cleanText(uid)).filter(Boolean)));
  const periods = [];

  for (let index = 0; index < uids.length; index += 30) {
    const snapshot = await db
      .collection("team_member_history")
      .where("userUid", "in", uids.slice(index, index + 30))
      .get();
    snapshot.docs.forEach((doc) => periods.push(doc.data() || {}));
  }

  return periods;
}

// GMR-R027: read only the month. Dates are ISO text (schema 1.0.1); the same
// window is also asked for as Firestore timestamps so a record stored the
// other way is never missed.
async function selectMonthTransactions(db, lmPcode, window) {
  const byLm = db.collection("trns").where("accessData.parents.lmPcode", "==", lmPcode);
  const startDate = new Date(window.startMs);
  const endDate = new Date(window.endMs);

  const [createdText, createdStamp, completedText, completedStamp] = await Promise.all([
    byLm.where("metadata.createdAt", ">=", window.startIso).where("metadata.createdAt", "<", window.endIso).get(),
    byLm.where("metadata.createdAt", ">=", startDate).where("metadata.createdAt", "<", endDate).get(),
    byLm.where("workflow.state", "==", "COMPLETED").where("workflow.completedAt", ">=", window.startIso).where("workflow.completedAt", "<", window.endIso).get(),
    byLm.where("workflow.state", "==", "COMPLETED").where("workflow.completedAt", ">=", startDate).where("workflow.completedAt", "<", endDate).get(),
  ]);

  // Workflow work created this month is kept too: if it was completed but its
  // completion time cannot be read, it is listed instead of vanishing.
  const selected = new Map();
  [createdText, createdStamp].forEach((snapshot) => {
    snapshot.docs.forEach((doc) => selected.set(doc.id, doc.data() || {}));
  });
  [completedText, completedStamp].forEach((snapshot) => {
    snapshot.docs.forEach((doc) => selected.set(doc.id, doc.data() || {}));
  });

  return selected;
}

export async function buildGeneralMonthlyReportDataset({
  db,
  lmPcode = GMR_LM_PCODE,
  reportMonth,
  generatedAt = new Date(),
  loadTransactions = selectMonthTransactions,
}) {
  if (!db) throw new TypeError("Firestore db is required.");
  if (lmPcode !== GMR_LM_PCODE) {
    throw new RangeError(`The General Monthly Report is available for ${GMR_LM_NAME} only.`);
  }
  const window = validateGmrReportMonth(reportMonth, generatedAt);
  const selected = await loadTransactions(db, lmPcode, window);

  const entries = [];
  const unplaced = [];
  selected.forEach((trn, trnId) => {
    if (isGmrTransactionInMonth(trn, window)) {
      entries.push([trnId, trn]);
      return;
    }
    if (
      hasWorkflow(trn) &&
      normalizeUpper(trn.workflow.state) === "COMPLETED" &&
      !timestampToIso(trn.workflow.completedAt)
    ) {
      unplaced.push({
        trnId,
        trnType: getGmrTrnType(trn) || null,
        reason: "Completed, but the completion time cannot be read, so its month is unknown.",
      });
    }
  });

  const premiseIds = [];
  const salesIds = [];
  const astIds = [];
  const workerUids = [];
  entries.forEach(([trnId, trn]) => {
    premiseIds.push(trn?.accessData?.premise?.id);
    const fieldFoundMeterNo = normalizeMeterNo(getAstData(trn)?.astNo);
    salesIds.push(
      trn?.targetedBatchContext?.salesDocId,
      isGmrLookupMeterNo(fieldFoundMeterNo) ? fieldFoundMeterNo : null,
    );
    astIds.push(getGmrAstId(trnId, trn));
    workerUids.push(getFieldWorker(trn).uid);
  });

  const [premisesById, salesById, astsById, teamPeriods] = await Promise.all([
    getDocsByIds(db, "premises", premiseIds),
    getDocsByIds(db, "sales-all-meters", salesIds),
    getDocsByIds(db, "asts", astIds),
    getTeamHistory(db, workerUids),
  ]);

  const fieldRows = [];

  entries.forEach(([trnId, trn]) => {
    try {
      const fieldFoundMeterNo = normalizeMeterNo(getAstData(trn)?.astNo);
      const lookupMeterNo = isGmrLookupMeterNo(fieldFoundMeterNo) ? fieldFoundMeterNo : null;
      const salesId = cleanText(trn?.targetedBatchContext?.salesDocId) || lookupMeterNo;
      const worker = getFieldWorker(trn);
      fieldRows.push(
        buildGmrFieldRow({
          trnId,
          trn,
          reportMonth: window.reportMonth,
          premise: premisesById.get(cleanText(trn?.accessData?.premise?.id)) || null,
          sales: salesId ? salesById.get(salesId) || null : null,
          fieldSalesExists: lookupMeterNo ? salesById.has(lookupMeterNo) : false,
          ast: astsById.get(getGmrAstId(trnId, trn)) || null,
          team: resolveGmrTeamAt(teamPeriods, worker.uid, getGmrSubmissionTime(trn)),
        }),
      );
    } catch (error) {
      unplaced.push({
        trnId,
        trnType: getGmrTrnType(trn) || null,
        reason: error?.message || String(error),
      });
    }
  });

  fieldRows.sort(
    (left, right) =>
      left.captureDate.localeCompare(right.captureDate) ||
      left.trnId.localeCompare(right.trnId),
  );

  const photoColumnCount = fieldRows.reduce(
    (max, row) => Math.max(max, row.photoUrls.length),
    0,
  );

  return {
    schemaVersion: GMR_SCHEMA_VERSION,
    rulesVersion: GMR_RULES_VERSION,
    reportSchemaVersion: GMR_REPORT_SCHEMA_VERSION,
    reportType: GMR_REPORT_TYPE,
    generationMode: GMR_GENERATION_MODE,
    generatedAt: generatedAt.toISOString(),
    reportMonth: window.reportMonth,
    reportingPeriodLabel: window.reportingPeriodLabel,
    isIncompleteMonth: window.isIncompleteMonth,
    municipality: { lmPcode: GMR_LM_PCODE, lmName: GMR_LM_NAME },
    photoColumnCount,
    fieldRows,
    unplaced,
    summary: {
      payableTotal: fieldRows.length,
      unplacedCount: unplaced.length,
    },
  };
}

export const generateGeneralMonthlyReportCallable = onCall(
  {
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (request) => {
    const lmPcode = cleanText(request?.data?.lmPcode || GMR_LM_PCODE);
    const mode = normalizeUpper(request?.data?.mode);
    const reportMonth = cleanText(request?.data?.reportMonth);

    if (lmPcode !== GMR_LM_PCODE) {
      throw new HttpsError(
        "invalid-argument",
        `The General Monthly Report is available for ${GMR_LM_NAME} only.`,
      );
    }
    if (mode !== GMR_GENERATION_MODE) {
      throw new HttpsError(
        "invalid-argument",
        "This page is out of date. Reload it and try again.",
      );
    }

    const generatedAt = new Date();
    let window;
    try {
      window = validateGmrReportMonth(reportMonth, generatedAt);
    } catch (error) {
      throw new HttpsError("invalid-argument", error.message);
    }

    const db = getFirestore();
    const actor = await assertGmrAccess({ db, request, lmPcode });

    logger.info("generateGeneralMonthlyReportCallable -- START", {
      actorUid: actor.uid,
      actorRole: actor.role,
      lmPcode,
      reportMonth: window.reportMonth,
    });

    try {
      const dataset = await buildGeneralMonthlyReportDataset({
        db,
        lmPcode,
        reportMonth: window.reportMonth,
        generatedAt,
      });

      logger.info("generateGeneralMonthlyReportCallable -- SUCCESS", {
        actorUid: actor.uid,
        lmPcode,
        reportMonth: dataset.reportMonth,
        payableTotal: dataset.summary.payableTotal,
        unplacedCount: dataset.summary.unplacedCount,
        photoColumnCount: dataset.photoColumnCount,
      });

      return dataset;
    } catch (error) {
      logger.error("generateGeneralMonthlyReportCallable -- ERROR", {
        actorUid: actor.uid,
        lmPcode,
        reportMonth: window.reportMonth,
        message: error?.message || String(error),
        code: error?.code || null,
        stack: error?.stack || "",
      });

      if (error instanceof HttpsError) throw error;
      if (error?.code === 9 || /index/i.test(String(error?.message || ""))) {
        throw new HttpsError(
          "failed-precondition",
          "The database is still preparing this report's search. Try again in a few minutes.",
        );
      }
      if (error instanceof RangeError || error instanceof TypeError) {
        throw new HttpsError("failed-precondition", error.message);
      }
      throw new HttpsError(
        "internal",
        "The month's transactions could not be read. Try again; if it fails again, report it.",
      );
    }
  },
);
