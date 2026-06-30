import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";
import { annotateMreadStagingCycles } from "./mreadStagingCycleController.v2.js";

const MREAD_STAGING_CYCLES_COLLECTION = "mread_staging_cycles";
const SYSTEM_NA = "NAv";

function normalizeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function normalizeUpper(value, fallback = "") {
  const text = normalizeText(value, fallback);
  return text ? text.toUpperCase() : fallback;
}

function isMeaningful(value) {
  const text = normalizeText(value, "");
  if (!text) return false;

  return !["nav", "n/av", "n/a", "na", "null", "undefined", "all"].includes(
    text.toLowerCase(),
  );
}

function readTimestampIso(value) {
  if (!value) return null;

  if (typeof value === "string") return value;

  if (value instanceof Date) return value.toISOString();

  if (typeof value?.toDate === "function") {
    try {
      return value.toDate().toISOString();
    } catch (_error) {
      return null;
    }
  }

  if (typeof value?.seconds === "number") {
    try {
      return new Date(value.seconds * 1000).toISOString();
    } catch (_error) {
      return null;
    }
  }

  return null;
}

function readNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readRoleFromRequest(request) {
  const token = request?.auth?.token || {};

  return normalizeUpper(
    token.role ||
      token.userRole ||
      token.employment?.role ||
      token.claims?.role ||
      "",
  );
}

function getActorName(request, userDoc = {}) {
  return (
    request?.auth?.token?.name ||
    request?.auth?.token?.email ||
    request?.auth?.token?.displayName ||
    userDoc?.profile?.displayName ||
    userDoc?.profile?.email ||
    request?.auth?.uid ||
    "SYSTEM"
  );
}

function readServiceProviderId(request, userDoc = {}) {
  const token = request?.auth?.token || {};

  return normalizeText(
    token.spId ||
      token.serviceProviderId ||
      token.serviceProvider?.id ||
      userDoc?.employment?.serviceProvider?.id ||
      userDoc?.serviceProvider?.id ||
      "",
  );
}

function collectWorkbaseIds(userDoc = {}) {
  const workbases = Array.isArray(userDoc?.access?.workbases)
    ? userDoc.access.workbases
    : [];

  const activeWorkbase = userDoc?.access?.activeWorkbase || null;
  const ids = new Set();

  [...workbases, activeWorkbase].filter(Boolean).forEach((workbase) => {
    [workbase?.id, workbase?.pcode, workbase?.lmPcode, workbase?.code].forEach(
      (candidate) => {
        const text = normalizeText(candidate, "");
        if (text) ids.add(text);
      },
    );
  });

  return ids;
}

function serviceProviderLooksLikeMnc(serviceProvider = {}) {
  const values = [
    serviceProvider?.classification,
    serviceProvider?.profile?.classification,
    serviceProvider?.profile?.serviceProviderType,
    serviceProvider?.serviceProviderType,
    serviceProvider?.relationshipType,
    serviceProvider?.contract?.classification,
    serviceProvider?.type,
  ]
    .map((value) => normalizeUpper(value, ""))
    .filter(Boolean);

  return values.some((value) =>
    ["MNC", "MAIN_CONTRACTOR", "MAIN CONTRACTOR"].includes(value),
  );
}

async function loadCallerContext({ db, request }) {
  if (!request?.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const uid = request.auth.uid;
  const role = readRoleFromRequest(request);
  const userSnap = await db.collection("users").doc(uid).get();
  const userDoc = userSnap.exists ? userSnap.data() || {} : {};
  const fallbackRole = normalizeUpper(
    userDoc?.employment?.role || userDoc?.role || "",
  );
  const resolvedRole = role || fallbackRole;
  const actorName = getActorName(request, userDoc);
  const serviceProviderId = readServiceProviderId(request, userDoc);
  const workbaseIds = collectWorkbaseIds(userDoc);

  return {
    uid,
    role: resolvedRole,
    actorName,
    userDoc,
    serviceProviderId,
    workbaseIds,
  };
}

async function assertCanReadMreadStagingCycles({ db, caller, lmPcode }) {
  if (caller.role === "SPU") {
    return {
      ok: true,
      accessLevel: "SPU",
    };
  }

  if (caller.role === "MNG") {
    if (isMeaningful(lmPcode) && !caller.workbaseIds.has(lmPcode)) {
      throw new HttpsError(
        "permission-denied",
        "Manager is not assigned to the requested LM workbase",
      );
    }

    return {
      ok: true,
      accessLevel: "MNG",
    };
  }

  if (caller.role === "SPV") {
    if (!caller.serviceProviderId) {
      throw new HttpsError(
        "permission-denied",
        "Supervisor is not linked to a service provider",
      );
    }

    const serviceProviderSnap = await db
      .collection("serviceProviders")
      .doc(caller.serviceProviderId)
      .get();

    if (!serviceProviderSnap.exists) {
      throw new HttpsError(
        "permission-denied",
        "Supervisor service provider was not found",
      );
    }

    const serviceProvider = serviceProviderSnap.data() || {};

    if (!serviceProviderLooksLikeMnc(serviceProvider)) {
      throw new HttpsError(
        "permission-denied",
        "Only main-contractor supervisors may view MREAD staging cycles",
      );
    }

    if (isMeaningful(lmPcode) && !caller.workbaseIds.has(lmPcode)) {
      throw new HttpsError(
        "permission-denied",
        "Supervisor is not assigned to the requested LM workbase",
      );
    }

    return {
      ok: true,
      accessLevel: "SPV_MNC",
    };
  }

  throw new HttpsError(
    "permission-denied",
    "Only SPU, MNG, or SPV(MNC) may view MREAD staging cycles",
  );
}

function serializeCycle(docSnap) {
  const data = docSnap.data() || {};
  const metadata = data?.metadata || {};
  const summary = data?.summary || {};
  const window = data?.window || {};

  return {
    id: docSnap.id,
    cycleId: normalizeText(data?.cycleId, docSnap.id),
    lmPcode: normalizeText(data?.lmPcode, SYSTEM_NA),

    billingPeriod: normalizeText(data?.billingPeriod, SYSTEM_NA),
    billingPeriodFull: normalizeText(data?.billingPeriodFull, SYSTEM_NA),
    billingPeriodStartYear: readNumber(data?.billingPeriodStartYear, null),
    billingPeriodEndYear: readNumber(data?.billingPeriodEndYear, null),

    cycleCode: normalizeText(data?.cycleCode, SYSTEM_NA),
    cycleLabel: normalizeText(data?.cycleLabel, SYSTEM_NA),
    cycleNo: readNumber(data?.cycleNo, 0),
    cycleNoText: normalizeText(data?.cycleNoText, SYSTEM_NA),

    currentIteration: readNumber(data?.currentIteration, 0),
    activeStagingId: normalizeText(data?.activeStagingId, SYSTEM_NA),
    lastGenerated: data?.lastGenerated || null,

    window: {
      pattern: normalizeText(window?.pattern, SYSTEM_NA),
      display: normalizeText(window?.display, SYSTEM_NA),
      startDate: normalizeText(window?.startDate, SYSTEM_NA),
      endDate: normalizeText(window?.endDate, SYSTEM_NA),
      start: readTimestampIso(window?.start),
      end: readTimestampIso(window?.end),
    },

    summary: {
      totalRows: readNumber(summary?.totalRows, 0),
      rowsWithCurrentReading: readNumber(summary?.rowsWithCurrentReading, 0),
      rowsWithConsumption: readNumber(summary?.rowsWithConsumption, 0),
      successfulReads: readNumber(summary?.successfulReads, 0),
      noAccess: readNumber(summary?.noAccess, 0),
      unsuccessful: readNumber(summary?.unsuccessful, 0),
      mediaEvidence: readNumber(summary?.mediaEvidence, 0),
    },

    metadata: {
      createdAt: readTimestampIso(metadata?.created?.at || metadata?.createdAt),
      createdByUid: normalizeText(
        metadata?.created?.byUid || metadata?.createdByUid,
        SYSTEM_NA,
      ),
      createdByUser: normalizeText(
        metadata?.created?.byUser || metadata?.createdByUser,
        SYSTEM_NA,
      ),
      updatedAt: readTimestampIso(metadata?.updated?.at || metadata?.updatedAt),
      updatedByUid: normalizeText(
        metadata?.updated?.byUid || metadata?.updatedByUid,
        SYSTEM_NA,
      ),
      updatedByUser: normalizeText(
        metadata?.updated?.byUser || metadata?.updatedByUser,
        SYSTEM_NA,
      ),
      source: {
        setupType: normalizeText(metadata?.source?.setupType, SYSTEM_NA),
        scriptName: normalizeText(metadata?.source?.scriptName, SYSTEM_NA),
        scriptVersion: normalizeText(
          metadata?.source?.scriptVersion,
          SYSTEM_NA,
        ),
        asOfDate: normalizeText(metadata?.source?.asOfDate, SYSTEM_NA),
        collection: normalizeText(metadata?.source?.collection, SYSTEM_NA),
      },
    },
  };
}

function buildSummary(rows = []) {
  return rows.reduce(
    (acc, row) => {
      acc.total += 1;
      if (row.isFuture) acc.future += 1;
      else acc.available += 1;
      if (row.isCurrentCycle) {
        acc.currentCycle = {
          cycleId: row.cycleId,
          cycleLabel: row.cycleLabel,
          billingPeriod: row.billingPeriod,
          window: row.window?.display || SYSTEM_NA,
        };
      }
      return acc;
    },
    {
      total: 0,
      available: 0,
      future: 0,
      currentCycle: null,
    },
  );
}

function sortCyclesDesc(left, right) {
  const leftStart = normalizeText(left?.window?.startDate, "");
  const rightStart = normalizeText(right?.window?.startDate, "");

  if (leftStart !== rightStart) return rightStart.localeCompare(leftStart);

  const leftCycleNo = readNumber(left.cycleNo, 0);
  const rightCycleNo = readNumber(right.cycleNo, 0);

  return rightCycleNo - leftCycleNo;
}

export const listMreadStagingCycles = onCall(async (request) => {
  const db = getFirestore();
  const data = request?.data || {};

  const lmPcode = normalizeText(data?.lmPcode, "");
  const billingPeriod = normalizeText(data?.billingPeriod, "");
  const includeFuture = data?.includeFuture === true;
  const rawLimit = Number(data?.limit || 100);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 100;

  const caller = await loadCallerContext({ db, request });
  const access = await assertCanReadMreadStagingCycles({
    db,
    caller,
    lmPcode,
  });

  let query = db.collection(MREAD_STAGING_CYCLES_COLLECTION);

  if (isMeaningful(lmPcode)) {
    query = query.where("lmPcode", "==", lmPcode);
  } else if (caller.role !== "SPU") {
    throw new HttpsError(
      "invalid-argument",
      "lmPcode is required for non-SPU users",
    );
  }

  const snap = await query.get();
  const sourceRows = snap.docs.map(serializeCycle);
  const cycleState = annotateMreadStagingCycles(sourceRows);
  const filteredRows = cycleState.rows
    .filter((row) => includeFuture || !row.isFuture)
    .filter(
      (row) =>
        !isMeaningful(billingPeriod) || row.billingPeriod === billingPeriod,
    )
    .sort(sortCyclesDesc);
  const rows = filteredRows.slice(0, limit);
  const visibleSummary = buildSummary(rows);

  logger.info("listMreadStagingCycles -- SUCCESS", {
    requestedByUid: caller.uid,
    requestedByUser: caller.actorName,
    role: caller.role,
    accessLevel: access.accessLevel,
    lmPcode: lmPcode || "ALL",
    billingPeriod: billingPeriod || "ALL",
    includeFuture,
    rowCount: rows.length,
    sourceRowCount: sourceRows.length,
  });

  return {
    ok: true,
    collection: MREAD_STAGING_CYCLES_COLLECTION,
    filters: {
      lmPcode: lmPcode || null,
      billingPeriod: billingPeriod || null,
      includeFuture,
      limit,
    },
    access: {
      role: caller.role,
      level: access.accessLevel,
    },
    rows,
    summary: {
      ...cycleState.summary,
      visibleAvailable: visibleSummary.available,
      visibleRows: rows.length,
      currentCycle:
        visibleSummary.currentCycle || cycleState.summary.currentCycle,
    },
  };
});
export { loadCallerContext, assertCanReadMreadStagingCycles };
