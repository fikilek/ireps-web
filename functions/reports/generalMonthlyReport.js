import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

export const GMR_LM_PCODE = "ZA5241";
export const GMR_LM_NAME = "Endumeni";
export const GMR_GENERATION_MODE = "MONTHLY_GMR";
export const GMR_REPORT_TYPE = "GENERAL_MONTHLY_REPORT";
export const GMR_SCHEMA_VERSION = 1;
export const GMR_ZAMO_PHOTO_HARD_CEILING = 6;

const ALLOWED_GMR_ROLES = new Set(["SPU", "ADM", "MNG", "SPV"]);
const GMR_LIFECYCLE_TYPES = new Set([
  "METER_DISCONNECTION",
  "METER_RECONNECTION",
]);
const JOHANNESBURG_OFFSET_MS = 2 * 60 * 60 * 1000;
const GMR_ACTIVITY_SCOPE = "REGISTRY_LINKED_DISCOVERY_AND_COMPLETED_DCN_RCN";

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

function titleCaseAddressPart(value) {
  const text = nullableText(value);
  if (!text) return null;

  return text
    .toLowerCase()
    .replace(/(^|[\s\-'])\p{L}/gu, (match) => match.toUpperCase());
}

function normalizeUpper(value) {
  return cleanText(value).toUpperCase();
}

function normalizeMeterNo(value) {
  return cleanText(value).replace(/\s+/g, "").toUpperCase();
}

function displayVisibility(value) {
  const normalized = normalizeUpper(value);
  if (normalized === "VISIBLE") return "Visible";
  if (normalized === "INVISIBLE") return "Invisible";
  return nullableText(value);
}

function timestampToIso(value) {
  if (!value) return null;

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (typeof value?.toMillis === "function") {
    const milliseconds = Number(value.toMillis());
    return Number.isFinite(milliseconds)
      ? new Date(milliseconds).toISOString()
      : null;
  }

  if (Number.isFinite(Number(value?.seconds))) {
    const milliseconds = Number(value.seconds) * 1000 + Number(value?.nanoseconds || 0) / 1_000_000;
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

function addMonths(monthKey, delta) {
  const match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + delta, 1));
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function johannesburgMonthKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const shifted = new Date(date.getTime() + JOHANNESBURG_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

function reportMonthLabel(reportMonth) {
  if (!isValidMonthKey(reportMonth)) return null;
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

export function validateGmrReportMonth(reportMonth, now = new Date()) {
  const window = getGmrReportMonthWindow(reportMonth);
  const currentMonth = johannesburgMonthKey(now);
  if (!currentMonth || reportMonth > currentMonth) {
    throw new RangeError("GMR reporting month cannot be in the future.");
  }
  return window;
}

export function isTimestampInGmrReportMonth(value, reportMonthOrWindow) {
  const iso = timestampToIso(value);
  if (!iso) return false;
  const milliseconds = new Date(iso).getTime();
  if (!Number.isFinite(milliseconds)) return false;
  const window = typeof reportMonthOrWindow === "string"
    ? getGmrReportMonthWindow(reportMonthOrWindow)
    : reportMonthOrWindow;
  return Boolean(
    window &&
    Number.isFinite(window.startMs) &&
    Number.isFinite(window.endMs) &&
    milliseconds >= window.startMs &&
    milliseconds < window.endMs
  );
}

function monthKeyFromIso(value) {
  const iso = timestampToIso(value);
  return iso ? johannesburgMonthKey(iso) : null;
}

export function buildGmrMonthKeysFromSales(salesDocs = []) {
  const items = salesDocs instanceof Map
    ? [...salesDocs.values()]
    : Array.isArray(salesDocs)
      ? salesDocs
      : [];
  const observed = new Set();

  items.forEach((item) => {
    const sales = item?.data || item || {};
    [sales?.monthlySalesC, sales?.Sales].forEach((source) => {
      if (!source || typeof source !== "object" || Array.isArray(source)) return;
      Object.keys(source).forEach((key) => {
        if (isValidMonthKey(key)) observed.add(key);
      });
    });
  });

  const sorted = [...observed].sort();
  if (!sorted.length) return [];

  const keys = [];
  let cursor = sorted[0];
  const last = sorted.at(-1);
  while (cursor && cursor <= last) {
    keys.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return keys;
}

function compareRegistryMeters(left = {}, right = {}) {
  const leftWard = cleanText(left?.parents?.wardPcode);
  const rightWard = cleanText(right?.parents?.wardPcode);
  const wardComparison = leftWard.localeCompare(rightWard, undefined, {
    numeric: true,
    sensitivity: "base",
  });
  if (wardComparison !== 0) return wardComparison;

  const meterComparison = normalizeMeterNo(left?.meterNo).localeCompare(
    normalizeMeterNo(right?.meterNo),
    undefined,
    { numeric: true, sensitivity: "base" },
  );
  if (meterComparison !== 0) return meterComparison;

  return cleanText(left?.id || left?.meterId).localeCompare(
    cleanText(right?.id || right?.meterId),
    undefined,
    { numeric: true, sensitivity: "base" },
  );
}

export function selectGmrPopulationMeters(registryMeters = []) {
  const selected = [...registryMeters].sort(compareRegistryMeters);
  const visible = selected.filter(
    (meter) => normalizeUpper(meter?.visibility) === "VISIBLE",
  );
  const invisible = selected.filter(
    (meter) => normalizeUpper(meter?.visibility) === "INVISIBLE",
  );
  const unclassified = selected.filter((meter) => {
    const visibility = normalizeUpper(meter?.visibility);
    return visibility !== "VISIBLE" && visibility !== "INVISIBLE";
  });

  return {
    selected,
    summary: {
      populationTotal: selected.length,
      visiblePopulation: visible.length,
      invisiblePopulation: invisible.length,
      unclassifiedPopulation: unclassified.length,
      selectedTotal: selected.length,
      visibleSelected: visible.length,
      invisibleSelected: invisible.length,
      unclassifiedSelected: unclassified.length,
    },
    unclassified,
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
      "This user may not generate the General Monthly Report.",
    );
  }

  if (role === "SPU" || role === "ADM") {
    return { uid, role };
  }

  const workbaseIds = getWorkbaseIds(userData);
  if (!workbaseIds.has(lmPcode)) {
    throw new HttpsError(
      "permission-denied",
      "The General Monthly Report is outside the user's assigned workbases.",
    );
  }

  return { uid, role };
}

async function getDocsByIds(db, collectionName, ids = []) {
  const uniqueIds = Array.from(
    new Set(ids.map((id) => cleanText(id)).filter(Boolean)),
  );
  const results = new Map();

  for (let index = 0; index < uniqueIds.length; index += 100) {
    const chunk = uniqueIds.slice(index, index + 100);
    const refs = chunk.map((id) => db.collection(collectionName).doc(id));
    const snapshots = refs.length ? await db.getAll(...refs) : [];

    snapshots.forEach((snapshot) => {
      if (snapshot.exists) {
        results.set(snapshot.id, {
          id: snapshot.id,
          data: snapshot.data() || {},
        });
      }
    });
  }

  return results;
}

function getTrnType(trn = {}) {
  return normalizeUpper(trn?.accessData?.trnType || trn?.trnType);
}

function getLifecycleAstId(trn = {}) {
  return cleanText(trn?.astId || trn?.ast?.astData?.astId);
}

function getLifecycleEventDate(trn = {}) {
  return (
    timestampToIso(trn?.workflow?.completedAt) ||
    timestampToIso(trn?.workflow?.issuedAt) ||
    timestampToIso(trn?.metadata?.updatedAt) ||
    timestampToIso(trn?.metadata?.createdAt)
  );
}

function getDiscoveryDate(discovery = {}) {
  return timestampToIso(discovery?.metadata?.createdAt);
}

function getDiscoveryFieldWorker(discovery = {}) {
  return (
    nullableText(discovery?.metadata?.createdByUser) ||
    nullableText(discovery?.metadata?.updatedByUser) ||
    null
  );
}

function getDiscoveryGpsCoordinates(discovery = {}) {
  const lat = Number(discovery?.ast?.location?.gps?.lat);
  const lng = Number(discovery?.ast?.location?.gps?.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;

  return `${lat}, ${lng}`;
}

function getDiscoveryPhotoUrls(discovery = {}) {
  const media = Array.isArray(discovery?.media) ? discovery.media : [];

  return media
    .filter((item) => {
      const type = normalizeUpper(item?.type);
      return !type || type === "IMAGE";
    })
    .map((item) => nullableText(item?.url))
    .filter(Boolean);
}

function getDiscoveryNormalisation(discovery = {}) {
  const actions = Array.isArray(discovery?.ast?.normalisation?.actionTaken)
    ? discovery.ast.normalisation.actionTaken
    : [];

  const clean = actions
    .filter((action) => typeof action === "string")
    .map((action) => action.trim())
    .filter(Boolean);

  return clean.length ? clean.join(" • ") : null;
}

export function buildZamoReportPhotoConfig(rows = []) {
  const observedMaxPhotoCount = rows.reduce(
    (max, row) => Math.max(max, Array.isArray(row?.photoUrls) ? row.photoUrls.length : 0),
    0,
  );
  const photoColumnCount = Math.min(
    observedMaxPhotoCount,
    GMR_ZAMO_PHOTO_HARD_CEILING,
  );
  const truncatedPhotoCount = rows.reduce((total, row) => {
    const count = Array.isArray(row?.photoUrls) ? row.photoUrls.length : 0;
    return total + Math.max(0, count - photoColumnCount);
  }, 0);

  return {
    observedMaxPhotoCount,
    photoColumnCount,
    hardCeiling: GMR_ZAMO_PHOTO_HARD_CEILING,
    truncatedPhotoCount,
  };
}

function getPremisePropertyType(premise = {}) {
  return nullableText(premise?.propertyType?.type);
}

function getPremisePropertyName(premise = {}) {
  return nullableText(premise?.propertyType?.name);
}

function getPremisePropertyUnitNo(premise = {}) {
  return nullableText(premise?.propertyType?.unitNo);
}

export function buildGmrTeamMembershipIndex(teams = []) {
  const teamsByUserUid = new Map();

  teams.forEach((team) => {
    const data = team?.data || team || {};
    const teamId = cleanText(team?.id || data?.id);
    const teamName = nullableText(data?.team?.name || data?.name || teamId);
    const status = normalizeUpper(data?.team?.status || data?.status);
    if (!teamId || !teamName || teamName === "-" || status !== "ACTIVE") return;

    const memberUserIds = Array.isArray(data?.scope?.memberUserIds)
      ? data.scope.memberUserIds
      : Array.isArray(data?.memberUserIds)
        ? data.memberUserIds
        : [];

    Array.from(new Set(memberUserIds.map((uid) => cleanText(uid)).filter(Boolean)))
      .forEach((userUid) => {
        const memberships = teamsByUserUid.get(userUid) || [];
        memberships.push({ id: teamId, name: teamName });
        teamsByUserUid.set(userUid, memberships);
      });
  });

  return teamsByUserUid;
}

export function resolveGmrFieldStatsTeam(userUid, teamsByUserUid = new Map()) {
  const cleanUid = cleanText(userUid);
  const memberships = cleanUid ? teamsByUserUid.get(cleanUid) || [] : [];
  const uniqueMemberships = Array.from(
    new Map(memberships.map((team) => [team.id, team])).values(),
  ).sort((left, right) => left.name.localeCompare(right.name));

  if (uniqueMemberships.length === 1) return uniqueMemberships[0].name;
  if (uniqueMemberships.length > 1) return "Multiple";
  return "Unassigned";
}

function displayMeterMode(value) {
  const text = nullableText(value);
  if (!text) return null;

  const token = normalizeUpper(text).replace(/[^A-Z0-9]/g, "");
  if (token === "PREPAID") return "Prepaid";
  if (["CONVENTIONAL", "POSTPAID", "CREDIT"].includes(token)) {
    return "Conventional";
  }

  return text;
}

function displayMeterPhase(value) {
  const text = nullableText(value);
  if (!text) return null;

  const token = normalizeUpper(text).replace(/[^A-Z0-9]/g, "");
  if (["SINGLE", "SINGLEPHASE", "1", "1PH", "1PHASE"].includes(token)) {
    return "Single Phase";
  }
  if (["THREE", "THREEPHASE", "3", "3PH", "3PHASE"].includes(token)) {
    return "Three Phase";
  }

  return text;
}

function buildFullAddress(premise = {}, registry = {}, sales = {}) {
  const premiseAddress = premise?.address || {};
  const parts = [
    nullableText(premiseAddress?.strNo),
    titleCaseAddressPart(premiseAddress?.strName),
    titleCaseAddressPart(premiseAddress?.strType),
  ].filter(Boolean);

  if (parts.length) return parts.join(" ");

  return (
    nullableText(registry?.premiseAddress) ||
    nullableText(sales?.addressLine1 || sales?.AddressLine1 || sales?.PostalAddress1) ||
    null
  );
}

function wardLabel(wardPcode) {
  const text = nullableText(wardPcode);
  if (!text) return null;
  const match = text.match(/(\d{1,3})$/);
  return match ? `Ward ${Number(match[1])}` : text;
}

function resolveTeamName(discovery = {}) {
  const createdFor = nullableText(discovery?.assignment?.createdFor?.name);
  if (createdFor) return createdFor;

  const targets = Array.isArray(discovery?.assignment?.targets)
    ? discovery.assignment.targets
    : [];
  const teamTarget = targets.find(
    (target) => normalizeUpper(target?.type || target?.targetType) === "TEAM",
  );
  return nullableText(teamTarget?.name || teamTarget?.displayName);
}

function getSalesMeterNo(id, sales = {}) {
  return normalizeMeterNo(
    sales?.meterNoNormalized || sales?.meterNo || sales?.MeterNumber || id,
  ) || null;
}

function getSalesAccountNumber(sales = {}) {
  return nullableText(sales?.accountNumber || sales?.AccountNumber);
}

function getSalesCustomerName(sales = {}) {
  return nullableText(
    sales?.customerName || sales?.Customer || sales?.Surname,
  );
}

function getSalesCategory(sales = {}) {
  return nullableText(sales?.leakageCategory || sales?.Leakage_Category);
}

function isTargetSalesCategory(value) {
  return /^CAT[1-8]\b/i.test(cleanText(value));
}

function targetCategoryFlag(value) {
  const category = nullableText(value);
  if (!category) return null;
  return isTargetSalesCategory(category) ? "Yes" : "No";
}

function getMonthlyPurchaseRands(sales = {}, monthKey) {
  const monthlySalesC = sales?.monthlySalesC;
  if (
    monthlySalesC &&
    typeof monthlySalesC === "object" &&
    Object.prototype.hasOwnProperty.call(monthlySalesC, monthKey)
  ) {
    const cents = Number(monthlySalesC[monthKey]);
    return Number.isFinite(cents) ? cents / 100 : null;
  }

  const legacySales = sales?.Sales;
  if (
    legacySales &&
    typeof legacySales === "object" &&
    Object.prototype.hasOwnProperty.call(legacySales, monthKey)
  ) {
    const rands = Number(legacySales[monthKey]);
    return Number.isFinite(rands) ? rands : null;
  }

  return null;
}

function buildMonthlyPurchases(sales = {}, monthKeys = []) {
  return monthKeys.reduce((result, monthKey) => {
    result[monthKey] = getMonthlyPurchaseRands(sales, monthKey);
    return result;
  }, {});
}

function hasAnySalesHistory(monthlyPurchases = {}) {
  return Object.values(monthlyPurchases).some((value) => Number.isFinite(value));
}

function getThreeMonthAverage(monthlyPurchases, anchorMonth, offsets) {
  if (!anchorMonth) return null;
  const values = offsets.map((offset) => monthlyPurchases?.[addMonths(anchorMonth, offset)]);
  if (!values.every((value) => Number.isFinite(value))) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function buildFinancialAnalytics({
  monthlyPurchases,
  investigationDate,
  hasSalesHistory,
  monthKeys = [],
}) {
  if (!hasSalesHistory) {
    return {
      purchasesAfterInvestigation: null,
      purchasingBehaviour: null,
      purchasingMatchEnergy: null,
      preInvestigation3mAveragePurchase: null,
      investigationMonthPurchase: null,
      postInvestigation3mAveragePurchase: null,
      vendingRevenueMovementR: null,
      vendingRevenueMovementPct: null,
      financialImpactClassification: null,
      latestAvailablePurchaseValue: null,
      previousMonthPurchaseValue: null,
      latestMonthMovementR: null,
      latestMonthMovementPct: null,
      latestPurchasingStatus: null,
      lastPurchaseMonth: null,
      consecutiveZeroPurchaseMonths: null,
      revenueAssessmentStatus: null,
      financialAnalysisNotes: null,
    };
  }

  const investigationMonth = monthKeyFromIso(investigationDate);
  const preAverage = getThreeMonthAverage(monthlyPurchases, investigationMonth, [-3, -2, -1]);
  const investigationMonthPurchase = investigationMonth
    ? monthlyPurchases?.[investigationMonth]
    : null;
  const postAverage = getThreeMonthAverage(monthlyPurchases, investigationMonth, [1, 2, 3]);

  const monthsAfterInvestigation = investigationMonth
    ? monthKeys.filter((monthKey) => monthKey > investigationMonth)
    : [];
  const availablePostValues = monthsAfterInvestigation
    .map((monthKey) => monthlyPurchases?.[monthKey])
    .filter((value) => Number.isFinite(value));
  const purchasesAfterInvestigation = availablePostValues.length === 0
    ? null
    : availablePostValues.some((value) => value > 0)
      ? "Yes"
      : "No";

  const availableMonths = monthKeys.filter((monthKey) =>
    Number.isFinite(monthlyPurchases?.[monthKey]),
  );
  const latestMonth = availableMonths.at(-1) || null;
  const latestIndex = latestMonth ? monthKeys.indexOf(latestMonth) : -1;
  const previousMonth = latestIndex > 0 ? monthKeys[latestIndex - 1] : null;
  const latestValue = latestMonth ? monthlyPurchases[latestMonth] : null;
  const previousValue = previousMonth && Number.isFinite(monthlyPurchases?.[previousMonth])
    ? monthlyPurchases[previousMonth]
    : null;
  const latestMovement = Number.isFinite(latestValue) && Number.isFinite(previousValue)
    ? latestValue - previousValue
    : null;
  const latestMovementPct = Number.isFinite(latestMovement) && Number.isFinite(previousValue) && previousValue !== 0
    ? latestMovement / previousValue
    : null;

  const lastPurchaseMonth = [...availableMonths]
    .reverse()
    .find((monthKey) => monthlyPurchases[monthKey] > 0) || null;

  let consecutiveZeroPurchaseMonths = 0;
  const latestAvailableIndex = latestMonth ? monthKeys.indexOf(latestMonth) : -1;
  for (let index = latestAvailableIndex; index >= 0; index -= 1) {
    const value = monthlyPurchases[monthKeys[index]];
    if (!Number.isFinite(value)) break;
    if (value !== 0) break;
    consecutiveZeroPurchaseMonths += 1;
  }

  const vendingMovement = Number.isFinite(preAverage) && Number.isFinite(postAverage)
    ? postAverage - preAverage
    : null;
  const vendingMovementPct = Number.isFinite(vendingMovement) && Number.isFinite(preAverage) && preAverage !== 0
    ? vendingMovement / preAverage
    : null;

  let financialImpactClassification = null;
  if (Number.isFinite(vendingMovement)) {
    if (vendingMovement > 0) financialImpactClassification = "Improved";
    else if (vendingMovement < 0) financialImpactClassification = "Declined";
    else financialImpactClassification = "Unchanged";
  }

  return {
    purchasesAfterInvestigation,
    purchasingBehaviour: null,
    purchasingMatchEnergy: null,
    preInvestigation3mAveragePurchase: preAverage,
    investigationMonthPurchase: Number.isFinite(investigationMonthPurchase)
      ? investigationMonthPurchase
      : null,
    postInvestigation3mAveragePurchase: postAverage,
    vendingRevenueMovementR: vendingMovement,
    vendingRevenueMovementPct: vendingMovementPct,
    financialImpactClassification,
    latestAvailablePurchaseValue: Number.isFinite(latestValue) ? latestValue : null,
    previousMonthPurchaseValue: Number.isFinite(previousValue) ? previousValue : null,
    latestMonthMovementR: latestMovement,
    latestMonthMovementPct: latestMovementPct,
    latestPurchasingStatus: Number.isFinite(latestValue)
      ? latestValue > 0
        ? "Purchasing"
        : "Zero Purchase"
      : null,
    lastPurchaseMonth,
    consecutiveZeroPurchaseMonths,
    revenueAssessmentStatus:
      Number.isFinite(preAverage) && Number.isFinite(postAverage)
        ? "Sufficient Data"
        : "Insufficient Data",
    financialAnalysisNotes:
      Number.isFinite(preAverage) && Number.isFinite(postAverage)
        ? "Observed pre/post-investigation vending movement. This does not by itself establish causation."
        : "Insufficient complete pre/post monthly history for a three-month intervention comparison.",
  };
}

function isCompletedLifecycleEvent(event = {}) {
  return normalizeUpper(event?.workflowState) === "COMPLETED" && event?.success !== false;
}

function isMonthlyCompletedLifecycleTrn(trn = {}, reportWindow) {
  return (
    GMR_LIFECYCLE_TYPES.has(getTrnType(trn)) &&
    normalizeUpper(trn?.workflow?.state) === "COMPLETED" &&
    isTimestampInGmrReportMonth(trn?.workflow?.completedAt, reportWindow)
  );
}

function buildLifecycleEvent({ trnId, trn = {}, meterRowContext = {} }) {
  const trnType = getTrnType(trn);
  const disconnection = trn?.disconnection || {};
  const reconnection = trn?.reconnection || {};
  const workflowState = normalizeUpper(trn?.workflow?.state || trn?.state) || null;
  const eventDate = getLifecycleEventDate(trn);
  const reason = nullableText(
    disconnection?.level?.label ||
      disconnection?.level?.code ||
      trn?.assignment?.instruction?.text ||
      trn?.fieldComment?.text,
  );
  const success = trn?.executionOutcome?.success;

  return {
    gmrMeterKey: meterRowContext.iRepsMeterId || null,
    originalProjectMeterNo: meterRowContext.originalProjectMeterNo || null,
    fieldFoundMeterNo: meterRowContext.fieldFoundMeterNo || null,
    accountNumber: meterRowContext.accountNumber || null,
    customerName: meterRowContext.customerName || null,
    physicalAddress: meterRowContext.fullAddress || null,
    eventId: trnId,
    eventType: trnType || null,
    eventDate,
    performedBy: nullableText(
      trn?.workflow?.completedByUser || trn?.metadata?.updatedByUser,
    ),
    reason,
    tamperFineClassification: null,
    fineReference: null,
    fineAmountIssuedR: null,
    paymentMade: null,
    amountPaidR: null,
    amountOutstandingR: null,
    paymentDate: null,
    reconnectionDate: trnType === "METER_RECONNECTION" && isCompletedLifecycleEvent({ workflowState, success })
      ? eventDate
      : null,
    reconnectedBy: trnType === "METER_RECONNECTION"
      ? nullableText(trn?.workflow?.completedByUser || trn?.metadata?.updatedByUser)
      : null,
    eventStatus: workflowState,
    source: "IREPS_TRN",
    sourceReference: trnId,
    notes: nullableText(trn?.fieldComment?.text),
    workflowState,
    success: typeof success === "boolean" ? success : null,
    disconnectionAnswer: nullableText(disconnection?.supplyDisconnected?.answer),
    reconnectionAnswer: nullableText(reconnection?.supplyReconnected?.answer),
  };
}

function buildInterventionSummary({ lifecycleEvents = [], primaryFinding }) {
  const sorted = [...lifecycleEvents].sort((left, right) =>
    String(left?.eventDate || "").localeCompare(String(right?.eventDate || "")),
  );
  const latest = sorted.at(-1) || null;
  const completedDisconnections = sorted.filter(
    (event) => event.eventType === "METER_DISCONNECTION" && isCompletedLifecycleEvent(event),
  );
  const completedReconnections = sorted.filter(
    (event) => event.eventType === "METER_RECONNECTION" && isCompletedLifecycleEvent(event),
  );

  const finding = normalizeUpper(primaryFinding);
  let interventionRequired = null;
  let interventionStatus = null;

  if (sorted.length > 0) {
    interventionRequired = "Yes";
    interventionStatus = isCompletedLifecycleEvent(latest)
      ? "Completed"
      : "Pending";
  } else if (finding === "ILLEGALLY CONNECTED") {
    interventionRequired = "Yes";
    interventionStatus = "Required";
  } else if (finding === "METER OK") {
    interventionRequired = "No";
    interventionStatus = "Not Required";
  }

  const latestDisconnection = completedDisconnections.at(-1) || null;
  const latestReconnection = completedReconnections.at(-1) || null;

  return {
    interventionRequired,
    interventionStatus,
    interventionCount: sorted.length,
    firstInterventionDate: sorted[0]?.eventDate || null,
    latestInterventionDate: latest?.eventDate || null,
    latestInterventionType: latest?.eventType || null,
    disconnected: completedDisconnections.length > 0 ? "Yes" : "No",
    latestDisconnectionDate: latestDisconnection?.eventDate || null,
    latestDisconnectionReason: latestDisconnection?.reason || null,
    latestDisconnectedBy: latestDisconnection?.performedBy || null,
    reconnected: completedReconnections.length > 0 ? "Yes" : "No",
    latestReconnectionDate: latestReconnection?.eventDate || null,
    latestReconnectedBy: latestReconnection?.performedBy || null,
    fineIssued: null,
    latestFineReference: null,
    latestFineIssuedDate: null,
    totalFinesIssuedR: null,
    finePaid: null,
    latestFinePaymentDate: null,
    totalFinesPaidR: null,
    outstandingFineAmountR: null,
    directRecoveryAmountR: null,
    interventionSource: sorted.length > 0 ? "iREPS TRN" : null,
    interventionRecoveryNotes: null,
  };
}

function inferTamperingEvidence(anomaly, detail) {
  const text = `${normalizeUpper(anomaly)} ${normalizeUpper(detail)}`;
  if (text.includes("ILLEGALLY CONNECTED") || text.includes("BYPASS") || text.includes("BRIDGE") || text.includes("TAMPER")) {
    return "Yes";
  }
  if (normalizeUpper(anomaly) === "METER OK") return "No";
  return null;
}

function inferIllegalConnectionIndicator(anomaly, detail) {
  const text = `${normalizeUpper(anomaly)} ${normalizeUpper(detail)}`;
  if (text.includes("ILLEGALLY CONNECTED") || text.includes("BYPASS") || text.includes("BRIDGE")) {
    return "Yes";
  }
  return anomaly ? "No" : null;
}

function fieldTechnology(discovery = {}, registry = {}) {
  const utility = nullableText(discovery?.meterType || registry?.meterType);
  const kind = nullableText(
    discovery?.ast?.astData?.meter?.type || registry?.meterKind,
  );
  const phase = nullableText(
    discovery?.ast?.astData?.meter?.phase || registry?.meterPhase,
  );
  const values = [utility, kind, phase].filter(Boolean);
  return values.length ? values.join(" / ") : null;
}

function buildException({ meter, type, source, severity = "WARNING", details }) {
  return {
    meterKey: meter?.iRepsMeterId || null,
    fieldFoundMeterNo: meter?.fieldFoundMeterNo || null,
    registryVisibility: meter?.registryVisibility || null,
    exceptionType: type,
    sourceJoin: source,
    severity,
    details,
    resolutionStatus: "OPEN",
    resolutionNotes: null,
  };
}

function getFindingCounts(rows) {
  return rows.reduce((counts, row) => {
    const key = row.primaryFinding || "Not Available";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function getWardCounts(rows) {
  return rows.reduce((counts, row) => {
    const key = row.ward || "Not Available";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

export function buildCanonicalGmrMeterRow({
  registry,
  discoveryEntry,
  premiseEntry,
  fieldSalesEntry,
  sourceSalesEntry,
  lifecycleTrns = [],
  fieldStatsTeam = "Unassigned",
  monthKeys = null,
}) {
  const discovery = discoveryEntry?.data || {};
  const premise = premiseEntry?.data || {};
  const fieldSales = fieldSalesEntry?.data || {};
  const sourceSales = sourceSalesEntry?.data || {};
  const targetedContext = discovery?.targetedBatchContext || {};
  const effectiveMonthKeys = Array.isArray(monthKeys)
    ? monthKeys
    : buildGmrMonthKeysFromSales([sourceSales]);

  const fieldFoundMeterNo = normalizeMeterNo(
    registry?.meterNo || discovery?.ast?.astData?.astNo,
  ) || null;
  const targetedMeterNo = normalizeMeterNo(targetedContext?.meterNo) || null;
  const originalProjectMeterNo = targetedMeterNo ||
    (fieldSalesEntry ? getSalesMeterNo(fieldSalesEntry.id, fieldSales) : null);
  const fieldFoundSalesMeterNo = fieldSalesEntry
    ? getSalesMeterNo(fieldSalesEntry.id, fieldSales)
    : null;
  const salesHistorySourceMeterNo = sourceSalesEntry
    ? getSalesMeterNo(sourceSalesEntry.id, sourceSales)
    : null;
  const monthlyPurchases = buildMonthlyPurchases(sourceSales, effectiveMonthKeys);
  const salesHistoryAvailable = hasAnySalesHistory(monthlyPurchases);
  const salesCategory = getSalesCategory(sourceSales);
  const targetCategory = targetCategoryFlag(salesCategory);
  const investigationDate = getDiscoveryDate(discovery);
  const anomaly = nullableText(discovery?.ast?.anomalies?.anomaly);
  const anomalyDetail = nullableText(discovery?.ast?.anomalies?.anomalyDetail);
  const premiseId = nullableText(registry?.premiseId || discovery?.accessData?.premise?.id);
  const wardPcode = nullableText(
    registry?.parents?.wardPcode || discovery?.accessData?.parents?.wardPcode || premise?.parents?.wardPcode,
  );
  const accountNumber = nullableText(targetedContext?.accountNumber) || getSalesAccountNumber(sourceSales);
  const customerName = nullableText(targetedContext?.customerName) || getSalesCustomerName(sourceSales);
  const fullAddress = buildFullAddress(premise, registry, sourceSales);
  const meterNumberVerified = originalProjectMeterNo && fieldFoundMeterNo
    ? originalProjectMeterNo === fieldFoundMeterNo
      ? "Correct"
      : "Incorrect"
    : null;
  const sameDifferent = originalProjectMeterNo && fieldFoundMeterNo
    ? originalProjectMeterNo === fieldFoundMeterNo
      ? "Same"
      : "Different"
    : null;
  const rawMeterKind = nullableText(
    registry?.meterKind || discovery?.ast?.astData?.meter?.type,
  );
  const rawMeterPhase = nullableText(
    discovery?.ast?.astData?.meter?.phase || registry?.meterPhase,
  );

  const rowContext = {
    originalProjectMeterNo,
    fieldFoundMeterNo,
    iRepsMeterId: cleanText(registry?.id || registry?.meterId) || null,
    accountNumber,
    customerName,
    fullAddress,
  };

  const lifecycleEvents = lifecycleTrns.map((entry) =>
    buildLifecycleEvent({
      trnId: entry.id,
      trn: entry.data,
      meterRowContext: rowContext,
    }),
  );
  const intervention = buildInterventionSummary({
    lifecycleEvents,
    primaryFinding: anomaly,
  });
  const financial = buildFinancialAnalytics({
    monthlyPurchases,
    investigationDate,
    hasSalesHistory: salesHistoryAvailable,
    monthKeys: effectiveMonthKeys,
  });

  return {
    ...rowContext,
    registryVisibility: displayVisibility(registry?.visibility),
    fieldFoundMeterInSales: fieldSalesEntry ? "Yes" : "No",
    fieldFoundSalesMeterNo,
    salesHistorySourceMeterNo,
    salesHistoryAvailable: salesHistoryAvailable ? "Yes" : "No",
    salesCategory,
    targetCategory,
    iRepsPremiseId: premiseId,
    lm: GMR_LM_NAME,
    lmPcode: GMR_LM_PCODE,
    ward: wardLabel(wardPcode),
    wardPcode,
    areaWorkbase: GMR_LM_NAME,
    erf: nullableText(registry?.erfNo || discovery?.accessData?.erfNo || premise?.erfNo),
    streetNo: nullableText(premise?.address?.strNo),
    streetNumber: nullableText(premise?.address?.strNo),
    streetName: titleCaseAddressPart(premise?.address?.strName),
    streetType: titleCaseAddressPart(premise?.address?.strType),
    suburbName: nullableText(premise?.address?.suburbName),
    fullAddress,
    areaName: nullableText(premise?.address?.suburbName),
    batchId: nullableText(targetedContext?.tbId) || "AD HOC",
    batchAllocationReference: targetedContext?.tbId
      ? `${targetedContext.tbId}${targetedContext?.rowId ? ` / ${targetedContext.rowId}` : ""}`
      : null,
    team: resolveTeamName(discovery),
    fieldStatsTeam: nullableText(fieldStatsTeam) || "Unassigned",
    serviceProvider: nullableText(discovery?.serviceProvider?.name),
    investigationStatus: discoveryEntry ? "Completed" : null,
    investigationDate,
    fieldWorkerName: getDiscoveryFieldWorker(discovery),
    captureDate: getDiscoveryDate(discovery),
    gpsCoordinates: getDiscoveryGpsCoordinates(discovery),
    photoUrls: getDiscoveryPhotoUrls(discovery),
    normalisation: getDiscoveryNormalisation(discovery),
    sealNo: nullableText(discovery?.ast?.astData?.meter?.seal?.sealNo),
    fieldComment: nullableText(discovery?.fieldComment?.text),

    propertyExists: null,
    propertyType: getPremisePropertyType(premise),
    propertyName: getPremisePropertyName(premise),
    propertyUnitNo: getPremisePropertyUnitNo(premise),
    propertyOccupiedActive: null,
    propertyAccessible: normalizeUpper(discovery?.accessData?.access?.hasAccess) === "YES" ? "Yes" : null,
    propertyCondition: null,
    propertyStatusFindingNotes: premise?.occupancy?.status
      ? `Premises occupancy status: ${premise.occupancy.status}`
      : null,

    meterExists: fieldFoundMeterNo ? "Yes" : null,
    meterNumberVerified,
    sameDifferent,
    meterOperational: null,
    meterAccessible: normalizeUpper(discovery?.accessData?.access?.hasAccess) === "YES" ? "Yes" : null,
    meterInstallation: null,
    expectedMeterTypeTechnology: null,
    fieldMeterTypeTechnology: fieldTechnology(discovery, registry),
    meterKind: rawMeterKind,
    meterMode: displayMeterMode(rawMeterKind),
    meterPhase: displayMeterPhase(rawMeterPhase),
    meterUtilityType: nullableText(registry?.meterType || discovery?.meterType),
    meterConnectionStatus: nullableText(registry?.statusState || registry?.status?.state),
    meterVerificationNotes: null,

    tamperingBypassBridgingEvidence: inferTamperingEvidence(anomaly, anomalyDetail),
    primaryFinding: anomaly,
    findingDetail: anomalyDetail,
    illegalConnectionIndicator: inferIllegalConnectionIndicator(anomaly, anomalyDetail),
    findingDate: investigationDate,
    latestRelevantTrnType: discoveryEntry ? "METER_DISCOVERY" : null,
    latestRelevantTrnId: discoveryEntry?.id || null,
    fieldFindingEvidenceNotes: null,

    ...intervention,
    monthlyPurchases,
    ...financial,
    lifecycleEvents,
  };
}

function sourceSalesIdForMeter({ registry, discoveryEntry }) {
  const targetedContext = discoveryEntry?.data?.targetedBatchContext || {};
  const targetedSalesId = cleanText(targetedContext?.salesDocId);
  if (targetedSalesId) return targetedSalesId;

  if (normalizeUpper(registry?.visibility) === "VISIBLE") {
    return normalizeMeterNo(registry?.meterNo);
  }

  return null;
}

function fieldSalesIdForMeter(registry = {}) {
  return normalizeMeterNo(registry?.meterNo) || null;
}

export async function buildGeneralMonthlyReportDataset({
  db,
  lmPcode = GMR_LM_PCODE,
  reportMonth,
  generatedAt = new Date(),
}) {
  if (!db) throw new TypeError("Firestore db is required.");
  if (lmPcode !== GMR_LM_PCODE) {
    throw new RangeError(`GMR Builder v0.1 is locked to ${GMR_LM_PCODE}.`);
  }
  const reportWindow = validateGmrReportMonth(reportMonth, generatedAt);

  const [registrySnapshot, trnSnapshot, teamsSnapshot] = await Promise.all([
    db.collection("registry_meters")
      .where("parents.lmPcode", "==", lmPcode)
      .get(),
    db.collection("trns")
      .where("accessData.parents.lmPcode", "==", lmPcode)
      .get(),
    db.collection("teams").get(),
  ]);

  const registryMeters = registrySnapshot.docs.map((snapshot) => ({
    id: snapshot.id,
    ...(snapshot.data() || {}),
  }));
  const selection = selectGmrPopulationMeters(registryMeters);
  const teamsByUserUid = buildGmrTeamMembershipIndex(
    teamsSnapshot.docs.map((snapshot) => ({
      id: snapshot.id,
      data: snapshot.data() || {},
    })),
  );

  const trnById = new Map();
  const lifecycleByAstId = new Map();

  trnSnapshot.docs.forEach((snapshot) => {
    const entry = { id: snapshot.id, data: snapshot.data() || {} };
    trnById.set(snapshot.id, entry);

    const trnType = getTrnType(entry.data);
    if (!GMR_LIFECYCLE_TYPES.has(trnType)) return;

    const astId = getLifecycleAstId(entry.data);
    if (!astId) return;
    const items = lifecycleByAstId.get(astId) || [];
    items.push(entry);
    lifecycleByAstId.set(astId, items);
  });

  const discoveryByMeterId = new Map();
  const monthlyDiscoveryMeterIds = new Set();
  selection.selected.forEach((registry) => {
    const meterId = cleanText(registry?.id || registry?.meterId);
    const candidate = trnById.get(meterId) || null;
    const discoveryEntry = candidate && getTrnType(candidate.data) === "METER_DISCOVERY"
      ? candidate
      : null;
    discoveryByMeterId.set(meterId, discoveryEntry);

    if (
      discoveryEntry &&
      isTimestampInGmrReportMonth(discoveryEntry?.data?.metadata?.createdAt, reportWindow)
    ) {
      monthlyDiscoveryMeterIds.add(meterId);
    }
  });

  const premiseIds = selection.selected.map((registry) => registry?.premiseId);
  const premisesById = await getDocsByIds(db, "premises", premiseIds);

  const fieldSalesIds = [];
  const sourceSalesIds = [];
  selection.selected.forEach((registry) => {
    const meterId = cleanText(registry?.id || registry?.meterId);
    const discoveryEntry = discoveryByMeterId.get(meterId);
    const fieldId = fieldSalesIdForMeter(registry);
    const sourceId = sourceSalesIdForMeter({ registry, discoveryEntry });
    if (fieldId) fieldSalesIds.push(fieldId);
    if (sourceId) sourceSalesIds.push(sourceId);
  });

  const salesById = await getDocsByIds(
    db,
    "sales-all-meters",
    [...fieldSalesIds, ...sourceSalesIds],
  );
  const monthKeys = buildGmrMonthKeysFromSales(salesById);

  const rows = [];
  const fieldRows = [];
  const interventionEvents = [];
  const exceptions = [];
  const monthlyInterventionMeterIds = new Set();

  for (const registry of selection.selected) {
    const meterId = cleanText(registry?.id || registry?.meterId);
    const discoveryEntry = discoveryByMeterId.get(meterId) || null;
    const premiseId = cleanText(registry?.premiseId);
    const premiseEntry = premiseId ? premisesById.get(premiseId) || null : null;
    const fieldSalesId = fieldSalesIdForMeter(registry);
    const fieldSalesEntry = fieldSalesId ? salesById.get(fieldSalesId) || null : null;
    const sourceSalesId = sourceSalesIdForMeter({ registry, discoveryEntry });
    const configuredSourceSalesEntry = sourceSalesId
      ? salesById.get(sourceSalesId) || null
      : null;
    const sourceSalesEntry = configuredSourceSalesEntry || fieldSalesEntry || null;
    const lifecycleTrns = lifecycleByAstId.get(meterId) || [];

    const fieldStatsTeam = resolveGmrFieldStatsTeam(
      discoveryEntry?.data?.metadata?.createdByUid,
      teamsByUserUid,
    );
    const row = buildCanonicalGmrMeterRow({
      registry,
      discoveryEntry,
      premiseEntry,
      fieldSalesEntry,
      sourceSalesEntry,
      lifecycleTrns,
      fieldStatsTeam,
      monthKeys,
    });
    rows.push(row);

    if (monthlyDiscoveryMeterIds.has(meterId)) {
      fieldRows.push(row);
    }

    const monthlyLifecycleIds = new Set(
      lifecycleTrns
        .filter((entry) => isMonthlyCompletedLifecycleTrn(entry.data, reportWindow))
        .map((entry) => entry.id),
    );
    const monthlyEvents = row.lifecycleEvents.filter((event) => monthlyLifecycleIds.has(event.eventId));
    if (monthlyEvents.length) monthlyInterventionMeterIds.add(meterId);
    interventionEvents.push(...monthlyEvents);

    if (discoveryEntry && !timestampToIso(discoveryEntry?.data?.metadata?.createdAt)) {
      exceptions.push(buildException({
        meter: row,
        type: "METER_DISCOVERY_CREATED_AT_MISSING",
        source: "trns.metadata.createdAt",
        severity: "ERROR",
        details: "The Meter Discovery TRN has no valid metadata.createdAt and cannot be allocated to a reporting month.",
      }));
    }

    lifecycleTrns.forEach((entry) => {
      if (
        normalizeUpper(entry?.data?.workflow?.state) === "COMPLETED" &&
        !timestampToIso(entry?.data?.workflow?.completedAt)
      ) {
        exceptions.push(buildException({
          meter: row,
          type: "LIFECYCLE_COMPLETED_AT_MISSING",
          source: `${getTrnType(entry.data)}.workflow.completedAt`,
          severity: "ERROR",
          details: `Completed lifecycle TRN ${entry.id} has no valid workflow.completedAt and is excluded from monthly intervention activity.`,
        }));
      }
    });

    if (!discoveryEntry) {
      exceptions.push(buildException({
        meter: row,
        type: "METER_DISCOVERY_NOT_FOUND",
        source: "registry_meters -> trns",
        severity: "ERROR",
        details: "The Meter Registry row could not be resolved to its originating METER_DISCOVERY TRN.",
      }));
    }

    if (!premiseEntry) {
      exceptions.push(buildException({
        meter: row,
        type: "PREMISE_REGISTRY_NOT_FOUND",
        source: "registry_meters -> premises",
        severity: "ERROR",
        details: "The linked authoritative Premises document was not found.",
      }));
    }

    if (normalizeUpper(registry?.visibility) === "INVISIBLE") {
      exceptions.push(buildException({
        meter: row,
        type: fieldSalesEntry
          ? "INVISIBLE_METER_NOW_PRESENT_IN_SALES"
          : "FIELD_FOUND_METER_NOT_IN_SALES",
        source: "registry_meters -> sales-all-meters",
        severity: fieldSalesEntry ? "WARNING" : "INFO",
        details: fieldSalesEntry
          ? "Meter Registry still classifies the field-found meter as Invisible, but a current Sales document now exists. The GMR uses the available Sales evidence and flags the registry reconciliation state for review."
          : "Field-found meter is classified Invisible and no current Sales document was found for that field meter.",
      }));
    }

    if (normalizeUpper(registry?.visibility) === "VISIBLE" && !fieldSalesEntry) {
      exceptions.push(buildException({
        meter: row,
        type: "VISIBLE_METER_SALES_LINK_MISSING",
        source: "registry_meters -> sales-all-meters",
        severity: "ERROR",
        details: "Registry visibility is VISIBLE but the field-found Sales document was not found.",
      }));
    }

    const targetedSalesId = cleanText(discoveryEntry?.data?.targetedBatchContext?.salesDocId);
    if (targetedSalesId && !configuredSourceSalesEntry) {
      exceptions.push(buildException({
        meter: row,
        type: "PROJECT_SALES_HISTORY_SOURCE_NOT_FOUND",
        source: "METER_DISCOVERY.targetedBatchContext.salesDocId -> sales-all-meters",
        severity: "ERROR",
        details: `Targeted Batch Sales source ${targetedSalesId} was not found.`,
      }));
    }

    if (sourceSalesEntry && row.salesHistoryAvailable !== "Yes") {
      exceptions.push(buildException({
        meter: row,
        type: "SALES_HISTORY_NOT_AVAILABLE",
        source: "sales-all-meters.monthlySalesC / Sales",
        severity: "WARNING",
        details: "The Sales source exists but contains no usable monthly purchase history.",
      }));
    }
  }

  for (const unclassified of selection.unclassified) {
    exceptions.push(buildException({
      meter: {
        iRepsMeterId: cleanText(unclassified?.id || unclassified?.meterId) || null,
        fieldFoundMeterNo: normalizeMeterNo(unclassified?.meterNo) || null,
        registryVisibility: displayVisibility(unclassified?.visibility),
      },
      type: "REGISTRY_VISIBILITY_UNCLASSIFIED",
      source: "registry_meters.visibility",
      severity: "WARNING",
      details: "Meter Registry row is included in the GMR population but its visibility is neither VISIBLE nor INVISIBLE.",
    }));
  }

  const zamoReport = buildZamoReportPhotoConfig(fieldRows);

  const summary = {
    ...selection.summary,
    premiseLinkedSelected: rows.filter((row) => row.iRepsPremiseId).length,
    fieldFoundSalesMatchedSelected: rows.filter((row) => row.fieldFoundMeterInSales === "Yes").length,
    salesHistoryAvailableSelected: rows.filter((row) => row.salesHistoryAvailable === "Yes").length,
    monthlyDiscoveryCount: fieldRows.length,
    monthlyInterventionEventCount: interventionEvents.length,
    interventionEventCount: interventionEvents.length,
    metersWithInterventions: monthlyInterventionMeterIds.size,
    targetCategorySelected: rows.filter((row) => row.targetCategory === "Yes").length,
    normalCategorySelected: rows.filter(
      (row) => normalizeUpper(row.salesCategory) === "NORMAL - NO LEAKAGE FLAG",
    ).length,
    categoryNotAvailableSelected: rows.filter((row) => !row.salesCategory).length,
    exceptionCount: exceptions.length,
    wardCounts: getWardCounts(rows),
    findingCounts: getFindingCounts(fieldRows),
  };

  return {
    schemaVersion: GMR_SCHEMA_VERSION,
    reportType: GMR_REPORT_TYPE,
    generatedAt: generatedAt.toISOString(),
    reportMonth: reportWindow.reportMonth,
    reportingPeriodLabel: reportWindow.reportingPeriodLabel,
    activityScope: GMR_ACTIVITY_SCOPE,
    municipality: {
      lmPcode: GMR_LM_PCODE,
      lmName: GMR_LM_NAME,
    },
    generationMode: GMR_GENERATION_MODE,
    populationSize: rows.length,
    monthKeys,
    summary,
    zamoReport,
    rows,
    fieldRows,
    interventionEvents,
    exceptions,
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
        `GMR Builder v0.1 is locked to ${GMR_LM_NAME} (${GMR_LM_PCODE}).`,
      );
    }
    if (mode !== GMR_GENERATION_MODE) {
      throw new HttpsError(
        "invalid-argument",
        "GMR Builder v0.1 requires MONTHLY_GMR generation mode.",
      );
    }

    const generatedAt = new Date();
    let reportWindow;
    try {
      reportWindow = validateGmrReportMonth(reportMonth, generatedAt);
    } catch (error) {
      throw new HttpsError("invalid-argument", error.message);
    }

    const db = getFirestore();
    const actor = await assertGmrAccess({ db, request, lmPcode });

    logger.info("generateGeneralMonthlyReportCallable -- START", {
      actorUid: actor.uid,
      actorRole: actor.role,
      lmPcode,
      generationMode: GMR_GENERATION_MODE,
      reportMonth: reportWindow.reportMonth,
    });

    try {
      const dataset = await buildGeneralMonthlyReportDataset({
        db,
        lmPcode,
        reportMonth: reportWindow.reportMonth,
        generatedAt,
      });

      logger.info("generateGeneralMonthlyReportCallable -- SUCCESS", {
        actorUid: actor.uid,
        lmPcode,
        reportMonth: dataset.reportMonth,
        selectedTotal: dataset.summary.selectedTotal,
        visibleSelected: dataset.summary.visibleSelected,
        invisibleSelected: dataset.summary.invisibleSelected,
        monthlyDiscoveryCount: dataset.summary.monthlyDiscoveryCount,
        monthlyInterventionEventCount: dataset.summary.monthlyInterventionEventCount,
        exceptionCount: dataset.summary.exceptionCount,
        zamoPhotoObservedMax: dataset?.zamoReport?.observedMaxPhotoCount ?? 0,
        zamoPhotoColumnCount: dataset?.zamoReport?.photoColumnCount ?? 0,
        zamoPhotoTruncatedCount: dataset?.zamoReport?.truncatedPhotoCount ?? 0,
      });

      return dataset;
    } catch (error) {
      logger.error("generateGeneralMonthlyReportCallable -- ERROR", {
        actorUid: actor.uid,
        lmPcode,
        reportMonth: reportWindow.reportMonth,
        generationMode: GMR_GENERATION_MODE,
        message: error?.message || String(error),
        stack: error?.stack || "",
      });

      if (error instanceof HttpsError) throw error;
      if (error instanceof RangeError || error instanceof TypeError) {
        throw new HttpsError("failed-precondition", error.message);
      }
      throw new HttpsError(
        "internal",
        "The General Monthly Report dataset could not be generated.",
      );
    }
  },
);
