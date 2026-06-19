// functions/src/mread/generateMreadStaging.js
// iREPS MREAD Staging v2 — Phase 1 backend generator
// ES module version for functions/package.json "type": "module".

import admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const COLLECTIONS = {
  registryMread: "registry_mread",
  stagingCycles: "mread_staging_cycles",
  staging: "mread_staging",
  users: "users",
};

const NAv = "NAv";
const BATCH_LIMIT = 450;
const GENERATION_LOCK_MINUTES = 15;
const ALLOWED_GENERATION_STATUSES = new Set(["DRAFT"]);
const BLOCKED_GENERATION_STATUSES = new Set(["CLOSED", "FUTURE"]);
const SUCCESSFUL_OUTCOME = "SUCCESSFUL_READING";
const NO_ACCESS_OUTCOME = "NO_ACCESS";
const UNSUCCESSFUL_OUTCOME = "UNSUCCESSFUL_READING";

function normalizeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function normalizeUpper(value, fallback = "") {
  return normalizeText(value, fallback).toUpperCase();
}

function isMeaningfulText(value) {
  const text = normalizeText(value, "");
  if (!text) return false;
  return !["nav", "n/av", "n/a", "na", "null", "undefined"].includes(
    text.toLowerCase(),
  );
}

function firstValue(...values) {
  for (const value of values) {
    if (value === 0) return value;
    if (value === false) return value;
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
}

function firstText(...values) {
  const value = firstValue(...values);
  return isMeaningfulText(value) ? String(value).trim() : NAv;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(numberValue) ? numberValue : null;
}

function toDateOrNull(value) {
  if (!value || value === NAv) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value?.toMillis === "function") {
    const date = new Date(value.toMillis());
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value?.seconds === "number") {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toTimestampOrNull(value) {
  const date = toDateOrNull(value);
  return date ? Timestamp.fromDate(date) : null;
}

function dateMs(value) {
  const date = toDateOrNull(value);
  return date ? date.getTime() : 0;
}

function buildUtcStamp(date = new Date()) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function buildStagingId(lmPcode, generatedAt = new Date()) {
  return `${lmPcode}_MREAD_STAGING_${buildUtcStamp(generatedAt)}`;
}

function buildIterationId(iteration) {
  return String(iteration).padStart(3, "0");
}

function safeDocId(value) {
  return normalizeText(value, "UNKNOWN")
    .replace(/[\\/]/g, "_")
    .replace(/[^a-zA-Z0-9_.:-]/g, "_")
    .slice(0, 900);
}

function getCycleWindow(cycle = {}) {
  const start = firstValue(
    cycle?.window?.start,
    cycle?.window?.startDate,
    cycle?.startDate,
    cycle?.windowStart,
  );
  const end = firstValue(
    cycle?.window?.end,
    cycle?.window?.endDate,
    cycle?.endDate,
    cycle?.windowEnd,
  );

  const startDate = toDateOrNull(start);
  const endDate = toDateOrNull(end);

  if (!startDate || !endDate) {
    throw new HttpsError(
      "failed-precondition",
      "Cycle window is missing or invalid. Cannot generate MREAD staging.",
      { code: "INVALID_CYCLE_WINDOW" },
    );
  }

  return {
    startDate,
    endDate,
    startTimestamp: Timestamp.fromDate(startDate),
    endTimestamp: Timestamp.fromDate(endDate),
    display: firstText(cycle?.window?.display),
  };
}

function getRegistryRowDate(row = {}) {
  return firstValue(
    row?.reading?.readingAt,
    row?.readingAt,
    row?.source?.completedAt,
    row?.completedAt,
    row?.metadata?.updatedAt,
    row?.metadata?.createdAt,
  );
}

function getRegistryRowDateMs(row = {}) {
  return dateMs(getRegistryRowDate(row));
}

function isRowInsideWindow(row, startDate, endDate) {
  const ms = getRegistryRowDateMs(row);
  return ms >= startDate.getTime() && ms <= endDate.getTime();
}

function getOutcome(row = {}) {
  return normalizeUpper(firstValue(row?.outcome?.outcome, row?.outcome), NAv);
}

function isSuccessfulReading(row = {}) {
  return getOutcome(row) === SUCCESSFUL_OUTCOME;
}

function isNoAccess(row = {}) {
  return getOutcome(row) === NO_ACCESS_OUTCOME;
}

function isUnsuccessfulReading(row = {}) {
  const outcome = getOutcome(row);
  return outcome === UNSUCCESSFUL_OUTCOME || outcome === "NO_READING";
}

function isFakeSeed(row = {}) {
  return row?.fake === true || row?.fakeSeed?.safeToDelete === true;
}

function getMeterKey(row = {}) {
  return firstText(
    row?.meter?.astId,
    row?.astId,
    row?.sourceAstId,
    row?.meter?.meterId,
    row?.meterId,
    row?.meter?.astNo,
    row?.meter?.meterNo,
    row?.meterNo,
    row?.astNo,
  );
}

function getMeterNo(row = {}) {
  return firstText(row?.meter?.astNo, row?.meter?.meterNo, row?.meterNo, row?.astNo);
}

function getCurrentReadingValue(row = {}) {
  return toNumberOrNull(
    firstValue(row?.reading?.currentReading, row?.currentReading, row?.reading),
  );
}

function getPreviousReadingValue(row = {}) {
  return toNumberOrNull(
    firstValue(
      row?.reading?.previousReading,
      row?.reading?.prevReading,
      row?.previousReading,
      row?.prevReading,
    ),
  );
}

function getPreviousReadingDate(row = {}) {
  return firstValue(
    row?.reading?.previousReadingDate,
    row?.reading?.prevReadingDate,
    row?.previousReadingDate,
    row?.prevReadingDate,
    row?.reading?.previousReadingAt,
    row?.previousReadingAt,
  );
}

function normalizeMediaRefs(value) {
  const refs = [];

  const add = (item) => {
    if (!item) return;
    if (typeof item === "string") {
      const url = normalizeText(item, "");
      if (url) refs.push({ url, tag: "meterReadingEvidence" });
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(add);
      return;
    }
    if (typeof item !== "object") return;

    const url = normalizeText(
      item.url ||
        item.uri ||
        item.href ||
        item.link ||
        item.mediaUrl ||
        item.imageUrl ||
        item.downloadUrl ||
        item.storageUrl,
      "",
    );

    refs.push({
      ...item,
      ...(url ? { url } : {}),
      tag: item.tag || item.type || "meterReadingEvidence",
    });
  };

  add(value);

  const seen = new Set();
  return refs.filter((item) => {
    const key = item.url || item.id || JSON.stringify(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getMediaRefs(row = {}) {
  return normalizeMediaRefs(
    firstValue(
      row?.evidence?.mediaRefs,
      row?.evidence?.photoRefs,
      row?.evidence?.photos,
      row?.mediaRefs,
      row?.raw?.evidence?.mediaRefs,
      [],
    ),
  );
}

function getMediaCount(row = {}) {
  const mediaRefs = getMediaRefs(row);
  const photoCount = Number(firstValue(row?.evidence?.photoCount, row?.photoCount, 0));
  if (Number.isFinite(photoCount) && photoCount > 0) return photoCount;
  return mediaRefs.length;
}

function countMedia(rows = []) {
  return rows.reduce((total, row) => total + getMediaCount(row), 0);
}

function getPremiseAddress(row = {}) {
  const existing = firstValue(row?.premise?.address, row?.premiseAddress);
  if (isMeaningfulText(existing)) return normalizeText(existing);

  const address = row?.premise?.addressParts || row?.premise || {};
  const parts = [
    address?.strNo,
    address?.streetNo,
    address?.strName,
    address?.streetName,
    address?.strType,
    address?.streetType,
    address?.name,
    address?.buildingName,
    address?.unitNo,
  ]
    .map((part) => normalizeText(part, ""))
    .filter(Boolean);

  return parts.join(" ") || NAv;
}

function readContext(row = {}) {
  return {
    meterNo: getMeterNo(row),
    meterKind: firstText(row?.meter?.meterKind, row?.meterKind),
    meterType: firstText(row?.meter?.meterType, row?.meterType),
    phase: firstText(row?.meter?.phase, row?.meter?.meterPhase, row?.phase),
    category: firstText(row?.meter?.category, row?.meter?.meterCategory, row?.category),
    premiseAddress: getPremiseAddress(row),
    premiseType: firstText(
      row?.premise?.premiseType,
      row?.premise?.propertyType,
      row?.premiseType,
      row?.propertyType,
    ),
    lmPcode: firstText(row?.geography?.lmPcode, row?.lmPcode),
    wardPcode: firstText(row?.geography?.wardPcode, row?.wardPcode),
    geofence: firstText(
      row?.geography?.geofenceName,
      row?.geography?.geofenceId,
      row?.geofenceName,
      row?.geofenceId,
    ),
    refs: {
      astId: firstText(row?.meter?.astId, row?.astId, row?.sourceAstId),
      meterId: firstText(row?.meter?.meterId, row?.meterId),
      premiseId: firstText(row?.premise?.premiseId, row?.premiseId),
      erfId: firstText(row?.premise?.erfId, row?.erfId),
    },
  };
}

function pickLatest(rows = []) {
  return [...rows].sort((a, b) => getRegistryRowDateMs(b) - getRegistryRowDateMs(a))[0] || null;
}

function selectCurrentReading(rowsInWindow = []) {
  return pickLatest(
    rowsInWindow.filter(
      (row) => isSuccessfulReading(row) && !isFakeSeed(row) && getCurrentReadingValue(row) !== null,
    ),
  );
}

function selectPreviousReading({ allRowsForMeter = [], currentRow = null }) {
  if (!currentRow) return { value: null, date: null, sourceId: NAv, sourceType: "NONE" };

  const directPrevious = getPreviousReadingValue(currentRow);
  if (directPrevious !== null) {
    return {
      value: directPrevious,
      date: toTimestampOrNull(getPreviousReadingDate(currentRow)),
      sourceId: firstText(
        currentRow?.reading?.previousReadingSourceId,
        currentRow?.refs?.previousReadingSourceId,
        currentRow?.previousReadingSourceId,
      ),
      sourceType: "CURRENT_ROW_PREVIOUS_READING",
    };
  }

  const currentMs = getRegistryRowDateMs(currentRow);
  const previousRow = pickLatest(
    allRowsForMeter.filter((row) => {
      if (row === currentRow) return false;
      if (!isSuccessfulReading(row)) return false;
      if (getCurrentReadingValue(row) === null) return false;
      const rowMs = getRegistryRowDateMs(row);
      return rowMs > 0 && rowMs < currentMs;
    }),
  );

  if (!previousRow) return { value: null, date: null, sourceId: NAv, sourceType: "NONE" };

  return {
    value: getCurrentReadingValue(previousRow),
    date: toTimestampOrNull(getRegistryRowDate(previousRow)),
    sourceId: previousRow.__id || previousRow.id || NAv,
    sourceType: isFakeSeed(previousRow) ? "FAKE_SEED_BASELINE" : "REGISTRY_MREAD",
  };
}

function buildStagingRow({ meterKey, rowsInWindow, allRowsForMeter, window }) {
  const currentRow = selectCurrentReading(rowsInWindow);
  const contextRow = currentRow || pickLatest(rowsInWindow) || pickLatest(allRowsForMeter) || {};
  const context = readContext(contextRow);
  const previous = selectPreviousReading({ allRowsForMeter, currentRow });

  const currentReading = currentRow ? getCurrentReadingValue(currentRow) : null;
  const currentReadingDate = currentRow ? toTimestampOrNull(getRegistryRowDate(currentRow)) : null;
  const prevReading = previous.value;
  const consumption =
    currentReading !== null && prevReading !== null ? currentReading - prevReading : null;

  const successfulReads = rowsInWindow.filter(isSuccessfulReading).length;
  const noAccess = rowsInWindow.filter(isNoAccess).length;
  const unsuccessful = rowsInWindow.filter(isUnsuccessfulReading).length;
  const mediaEvidence = countMedia(rowsInWindow);
  const registryMreadIdsInCycle = rowsInWindow.map((row) => row.__id || row.id).filter(Boolean);

  const currentRegistryMreadId = currentRow?.__id || currentRow?.id || NAv;
  const rowId = safeDocId(context.refs.astId !== NAv ? context.refs.astId : meterKey);

  const warnings = [];
  if (consumption !== null && consumption < 0) warnings.push("NEGATIVE_CONSUMPTION_READING_WENT_BACKWARDS");
  if (!currentRow && rowsInWindow.length > 0) warnings.push("NO_SUCCESSFUL_READING_IN_WINDOW");
  if (currentRow && prevReading === null) warnings.push("NO_PREVIOUS_READING_AVAILABLE");

  return {
    rowId,
    meterNo: context.meterNo,

    currentReading,
    currentReadingDate,
    prevReading,
    prevReadingDate: previous.date,
    consumption,

    meterKind: context.meterKind,
    meterType: context.meterType,
    phase: context.phase,
    category: context.category,

    premiseAddress: context.premiseAddress,
    premiseType: context.premiseType,

    successfulReads,
    noAccess,
    unsuccessful,
    mediaEvidence,

    lmPcode: context.lmPcode,
    wardPcode: context.wardPcode,
    geofence: context.geofence,

    refs: {
      astId: context.refs.astId,
      meterId: context.refs.meterId,
      premiseId: context.refs.premiseId,
      erfId: context.refs.erfId,
      currentRegistryMreadId,
      previousReadingSourceId: previous.sourceId,
      registryMreadIdsInCycle,
    },

    sourceCounts: {
      successfulReads,
      noAccess,
      unsuccessful,
      totalAttempts: rowsInWindow.length,
    },

    evidence: {
      mediaEvidenceIds: rowsInWindow.flatMap((row) =>
        getMediaRefs(row).map((item) => item.id || item.url).filter(Boolean),
      ),
      hasMedia: mediaEvidence > 0,
    },

    sourceWindow: {
      start: window.startTimestamp,
      end: window.endTimestamp,
    },

    dataQuality: {
      warnings,
      previousReadingSourceType: previous.sourceType,
      hasCurrentReading: currentReading !== null,
      hasPreviousReading: prevReading !== null,
      hasConsumption: consumption !== null,
    },

    metadata: {
      generatedBy: "generateMreadStaging",
      updatedAt: FieldValue.serverTimestamp(),
    },
  };
}

function buildSummary(rows = []) {
  return rows.reduce(
    (summary, row) => ({
      totalRows: summary.totalRows + 1,
      rowsWithCurrentReading:
        summary.rowsWithCurrentReading + (row.currentReading !== null ? 1 : 0),
      rowsWithConsumption: summary.rowsWithConsumption + (row.consumption !== null ? 1 : 0),
      successfulReads: summary.successfulReads + Number(row.successfulReads || 0),
      noAccess: summary.noAccess + Number(row.noAccess || 0),
      unsuccessful: summary.unsuccessful + Number(row.unsuccessful || 0),
      mediaEvidence: summary.mediaEvidence + Number(row.mediaEvidence || 0),
    }),
    {
      totalRows: 0,
      rowsWithCurrentReading: 0,
      rowsWithConsumption: 0,
      successfulReads: 0,
      noAccess: 0,
      unsuccessful: 0,
      mediaEvidence: 0,
    },
  );
}

async function getUserDoc(uid) {
  if (!uid) return null;
  const snap = await db.collection(COLLECTIONS.users).doc(uid).get();
  return snap.exists ? snap.data() : null;
}

function readRole(auth, userDoc) {
  return firstText(
    auth?.token?.role,
    auth?.token?.userRole,
    userDoc?.role,
    userDoc?.userRole,
    userDoc?.profile?.role,
  );
}

function roleCanGenerate(role) {
  const cleanRole = normalizeUpper(role, "").replace(/\s+/g, "");
  return new Set([
    "ADMIN",
    "SUPER_ADMIN",
    "SUPERADMIN",
    "MNG",
    "SPU",
    "SPV(MNC)",
    "SPV_MNC",
    "MNC",
  ]).has(cleanRole);
}

function userHasLmScope(auth, userDoc, lmPcode) {
  const values = [
    auth?.token?.lmPcode,
    auth?.token?.pcode,
    auth?.token?.activeWorkbase,
    userDoc?.lmPcode,
    userDoc?.pcode,
    userDoc?.activeWorkbase?.lmPcode,
    userDoc?.activeWorkbase?.pcode,
    userDoc?.activeWorkbase?.id,
  ];

  const workbases = Array.isArray(userDoc?.workbases) ? userDoc.workbases : [];
  for (const workbase of workbases) {
    values.push(workbase?.lmPcode, workbase?.pcode, workbase?.id, workbase?.localMunicipalityId);
  }

  const meaningfulValues = values.map((value) => normalizeText(value, "")).filter(Boolean);

  // If the user document does not expose workbase fields yet, do not hard-fail here.
  // Firestore/Callable security can be tightened later once the canonical user claims are locked.
  if (!meaningfulValues.length) return true;

  return meaningfulValues.includes(lmPcode);
}

async function assertCanGenerate({ auth, lmPcode }) {
  if (!auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to generate MREAD staging.");
  }

  const userDoc = await getUserDoc(auth.uid);
  const role = readRole(auth, userDoc);

  if (!roleCanGenerate(role)) {
    throw new HttpsError(
      "permission-denied",
      "Your role is not allowed to generate MREAD staging.",
      { code: "ROLE_NOT_ALLOWED", role },
    );
  }

  if (!userHasLmScope(auth, userDoc, lmPcode)) {
    throw new HttpsError(
      "permission-denied",
      "You are not authorised for this LM staging cycle.",
      { code: "LM_SCOPE_NOT_ALLOWED", lmPcode },
    );
  }

  return { userDoc, role };
}

async function fetchRegistryRowsForLm(lmPcode) {
  const snapshot = await db
    .collection(COLLECTIONS.registryMread)
    .where("geography.lmPcode", "==", lmPcode)
    .get();

  return snapshot.docs.map((doc) => ({ __id: doc.id, ...doc.data() }));
}

function groupRowsByMeter(rows = []) {
  const groups = new Map();

  for (const row of rows) {
    const meterKey = getMeterKey(row);
    if (!isMeaningfulText(meterKey)) continue;
    if (!groups.has(meterKey)) groups.set(meterKey, []);
    groups.get(meterKey).push(row);
  }

  return groups;
}

function buildRowsForCycle({ registryRows, window }) {
  const groups = groupRowsByMeter(registryRows);
  const stagingRows = [];

  for (const [meterKey, allRowsForMeter] of groups.entries()) {
    const rowsInWindow = allRowsForMeter.filter((row) =>
      isRowInsideWindow(row, window.startDate, window.endDate),
    );

    if (!rowsInWindow.length) continue;

    stagingRows.push(
      buildStagingRow({ meterKey, rowsInWindow, allRowsForMeter, window }),
    );
  }

  return stagingRows.sort((a, b) => String(a.meterNo).localeCompare(String(b.meterNo), undefined, { numeric: true }));
}

async function commitOpsInBatches(ops = []) {
  for (let index = 0; index < ops.length; index += BATCH_LIMIT) {
    const batch = db.batch();
    const chunk = ops.slice(index, index + BATCH_LIMIT);

    for (const op of chunk) {
      if (op.type === "set") batch.set(op.ref, op.data, op.options || {});
      if (op.type === "update") batch.update(op.ref, op.data);
    }

    await batch.commit();
  }
}

async function lockCycleForGeneration(cycleRef, uid) {
  return db.runTransaction(async (transaction) => {
    const cycleSnap = await transaction.get(cycleRef);

    if (!cycleSnap.exists) {
      throw new HttpsError("not-found", "MREAD staging cycle not found.", {
        code: "CYCLE_NOT_FOUND",
      });
    }

    const cycle = cycleSnap.data() || {};
    const status = normalizeUpper(cycle.status, "");

    if (BLOCKED_GENERATION_STATUSES.has(status) || !ALLOWED_GENERATION_STATUSES.has(status)) {
      throw new HttpsError(
        "failed-precondition",
        `MREAD staging generation is blocked for ${status || "UNKNOWN"} cycles.`,
        { code: "CYCLE_NOT_GENERATABLE", status },
      );
    }

    const lockUntil = toDateOrNull(cycle?.generationLock?.expiresAt);
    if (cycle?.generationLock?.locked === true && lockUntil && lockUntil > new Date()) {
      throw new HttpsError(
        "aborted",
        "MREAD staging generation is already running for this cycle.",
        { code: "GENERATION_ALREADY_RUNNING" },
      );
    }

    const lmPcode = firstText(cycle.lmPcode);
    if (!isMeaningfulText(lmPcode)) {
      throw new HttpsError("failed-precondition", "Cycle LM is missing.", {
        code: "CYCLE_LM_MISSING",
      });
    }

    const currentIteration = Number(cycle.currentIteration || 0);
    const nextIteration = Number.isFinite(currentIteration) ? currentIteration + 1 : 1;
    const generatedAt = new Date();
    const stagingId = buildStagingId(lmPcode, generatedAt);
    const iterationId = buildIterationId(nextIteration);
    const iterationRef = cycleRef.collection("iterations").doc(iterationId);

    transaction.set(iterationRef, {
      iteration: nextIteration,
      stagingId,
      status: "STARTED",
      generatedAt: Timestamp.fromDate(generatedAt),
      generatedByUser: {
        uid,
        displayName: NAv,
      },
      summary: null,
      metadata: {
        createdAt: FieldValue.serverTimestamp(),
        createdBy: uid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: uid,
      },
    });

    transaction.update(cycleRef, {
      generationLock: {
        locked: true,
        lockedAt: FieldValue.serverTimestamp(),
        lockedBy: uid,
        expiresAt: Timestamp.fromDate(
          new Date(generatedAt.getTime() + GENERATION_LOCK_MINUTES * 60 * 1000),
        ),
        stagingId,
        iteration: nextIteration,
      },
      "metadata.updatedAt": FieldValue.serverTimestamp(),
      "metadata.updatedBy": uid,
    });

    return { cycle, lmPcode, nextIteration, stagingId, generatedAt, iterationRef };
  });
}


async function previewDryRun({ cycleRef, cycleId, auth }) {
  const cycleSnap = await cycleRef.get();
  if (!cycleSnap.exists) {
    throw new HttpsError("not-found", "MREAD staging cycle not found.", {
      code: "CYCLE_NOT_FOUND",
    });
  }

  const cycle = cycleSnap.data() || {};
  const status = normalizeUpper(cycle.status, "");
  if (BLOCKED_GENERATION_STATUSES.has(status) || !ALLOWED_GENERATION_STATUSES.has(status)) {
    throw new HttpsError(
      "failed-precondition",
      `MREAD staging generation is blocked for ${status || "UNKNOWN"} cycles.`,
      { code: "CYCLE_NOT_GENERATABLE", status },
    );
  }

  const lmPcode = firstText(cycle.lmPcode);
  if (!isMeaningfulText(lmPcode)) {
    throw new HttpsError("failed-precondition", "Cycle LM is missing.", {
      code: "CYCLE_LM_MISSING",
    });
  }

  await assertCanGenerate({ auth, lmPcode });
  const window = getCycleWindow(cycle);
  const registryRows = await fetchRegistryRowsForLm(lmPcode);
  const stagingRows = buildRowsForCycle({ registryRows, window });
  const summary = buildSummary(stagingRows);

  return {
    ok: true,
    dryRun: true,
    cycleId,
    lmPcode,
    sourceRowsRead: registryRows.length,
    summary,
  };
}

async function markGenerationFailed({ cycleRef, iterationRef, stagingId, uid, error }) {
  const failure = {
    status: "FAILED",
    failedAt: FieldValue.serverTimestamp(),
    error: {
      code: error?.code || error?.details?.code || "GENERATE_MREAD_STAGING_FAILED",
      message: error?.message || "Failed to generate MREAD staging.",
    },
    metadata: {
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: uid || "SYSTEM",
    },
  };

  const ops = [];
  if (iterationRef) ops.push({ type: "set", ref: iterationRef, data: failure, options: { merge: true } });
  if (stagingId) {
    ops.push({
      type: "set",
      ref: db.collection(COLLECTIONS.staging).doc(stagingId),
      data: {
        stagingId,
        tableId: stagingId,
        tableStatus: "FAILED",
        generation: failure,
        metadata: {
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: uid || "SYSTEM",
        },
      },
      options: { merge: true },
    });
  }
  ops.push({
    type: "update",
    ref: cycleRef,
    data: {
      generationLock: FieldValue.delete(),
      "lastGenerated.status": "FAILED",
      "lastGenerated.errorMessage": failure.error.message,
      "lastGenerated.failedAt": FieldValue.serverTimestamp(),
      "metadata.updatedAt": FieldValue.serverTimestamp(),
      "metadata.updatedBy": uid || "SYSTEM",
    },
  });

  await commitOpsInBatches(ops);
}

export const generateMreadStaging = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 540,
    memory: "1GiB",
  },
  async (request) => {
    const uid = request.auth?.uid || null;
    const cycleId = normalizeText(request.data?.cycleId, "");
    const dryRun = request.data?.dryRun === true;

    if (!cycleId) {
      throw new HttpsError("invalid-argument", "cycleId is required.", {
        code: "CYCLE_ID_REQUIRED",
      });
    }

    const cycleRef = db.collection(COLLECTIONS.stagingCycles).doc(cycleId);

    if (dryRun) {
      return previewDryRun({ cycleRef, cycleId, auth: request.auth });
    }

    let lock = null;

    try {
      lock = await lockCycleForGeneration(cycleRef, uid);
      const { cycle, lmPcode, nextIteration, stagingId, generatedAt, iterationRef } = lock;

      const actor = await assertCanGenerate({ auth: request.auth, lmPcode });
      const window = getCycleWindow(cycle);

      logger.info("generateMreadStaging started", {
        cycleId,
        lmPcode,
        stagingId,
        iteration: nextIteration,
        uid,
        dryRun,
      });

      const registryRows = await fetchRegistryRowsForLm(lmPcode);
      const stagingRows = buildRowsForCycle({ registryRows, window });
      const summary = buildSummary(stagingRows);

      const stagingRef = db.collection(COLLECTIONS.staging).doc(stagingId);
      const generatedByUser = {
        uid,
        displayName: firstText(
          actor.userDoc?.displayName,
          actor.userDoc?.name,
          request.auth?.token?.name,
          request.auth?.token?.email,
        ),
        role: actor.role,
      };

      const parentDoc = {
        stagingId,
        tableId: stagingId,
        cycleId,
        lmPcode,
        tableStatus: "DRAFT",
        window: {
          start: window.startTimestamp,
          end: window.endTimestamp,
          display: window.display,
        },
        generation: {
          status: "COMPLETED",
          iteration: nextIteration,
          generatedByUser,
          generatedAt: Timestamp.fromDate(generatedAt),
          sourceCollection: COLLECTIONS.registryMread,
          sourceRowsRead: registryRows.length,
        },
        summary: {
          totalRows: summary.totalRows,
          rowsWithCurrentReading: summary.rowsWithCurrentReading,
          rowsWithConsumption: summary.rowsWithConsumption,
          totalSuccessfulReads: summary.successfulReads,
          totalNoAccess: summary.noAccess,
          totalUnsuccessful: summary.unsuccessful,
          totalMediaEvidence: summary.mediaEvidence,
          successfulReads: summary.successfulReads,
          noAccess: summary.noAccess,
          unsuccessful: summary.unsuccessful,
          mediaEvidence: summary.mediaEvidence,
        },
        metadata: {
          createdAt: FieldValue.serverTimestamp(),
          createdBy: uid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: uid,
        },
      };

      const rowOps = stagingRows.map((row) => ({
        type: "set",
        ref: stagingRef.collection("rows").doc(row.rowId),
        data: {
          ...row,
          stagingId,
          cycleId,
          generation: {
            iteration: nextIteration,
            generatedAt: Timestamp.fromDate(generatedAt),
          },
        },
      }));

      const completionOps = [
        { type: "set", ref: stagingRef, data: parentDoc },
        ...rowOps,
        {
          type: "set",
          ref: iterationRef,
          data: {
            status: "COMPLETED",
            completedAt: FieldValue.serverTimestamp(),
            generatedByUser,
            summary,
            metadata: {
              updatedAt: FieldValue.serverTimestamp(),
              updatedBy: uid,
            },
          },
          options: { merge: true },
        },
        {
          type: "update",
          ref: cycleRef,
          data: {
            currentIteration: nextIteration,
            activeStagingId: stagingId,
            lastGenerated: {
              status: "COMPLETED",
              stagingId,
              iteration: nextIteration,
              generatedAt: Timestamp.fromDate(generatedAt),
              generatedByUser,
            },
            summary,
            generationLock: FieldValue.delete(),
            "metadata.updatedAt": FieldValue.serverTimestamp(),
            "metadata.updatedBy": uid,
          },
        },
      ];

      await commitOpsInBatches(completionOps);

      logger.info("generateMreadStaging completed", {
        cycleId,
        lmPcode,
        stagingId,
        iteration: nextIteration,
        summary,
      });

      return {
        ok: true,
        cycleId,
        lmPcode,
        stagingId,
        activeStagingId: stagingId,
        iteration: nextIteration,
        sourceRowsRead: registryRows.length,
        summary,
      };
    } catch (error) {
      logger.error("generateMreadStaging failed", {
        cycleId,
        uid,
        code: error?.code,
        message: error?.message,
      });

      if (lock?.iterationRef) {
        try {
          await markGenerationFailed({
            cycleRef,
            iterationRef: lock.iterationRef,
            stagingId: lock.stagingId,
            uid,
            error,
          });
        } catch (markFailedError) {
          logger.error("generateMreadStaging failed to clear lock", {
            cycleId,
            message: markFailedError?.message,
          });
        }
      }

      if (error instanceof HttpsError) throw error;

      throw new HttpsError(
        "internal",
        error?.message || "Failed to generate MREAD staging.",
        { code: "GENERATE_MREAD_STAGING_FAILED" },
      );
    }
  },
);
