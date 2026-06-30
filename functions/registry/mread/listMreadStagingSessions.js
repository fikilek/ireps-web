import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";
import {
  loadCallerContext,
  assertCanReadMreadStagingCycles,
} from "./listMreadStagingCycles.js";

const MREAD_STAGING_COLLECTION = "mread_staging";
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

function sortSessions(left, right) {
  const leftDate = readTimestampIso(left.generatedAt) || "";
  const rightDate = readTimestampIso(right.generatedAt) || "";

  if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
  return left.tableId.localeCompare(right.tableId);
}

function serializeSession(docSnap) {
  const data = docSnap.data() || {};
  const generation = data?.generation || {};
  const summary = data?.summary || {};
  const window = data?.window || {};

  return {
    id: docSnap.id,
    stagingId: normalizeText(data?.stagingId, docSnap.id),
    tableId: normalizeText(data?.tableId, SYSTEM_NA),
    tableStatus: normalizeUpper(data?.tableStatus, SYSTEM_NA),
    cycleId: normalizeText(data?.cycleId, SYSTEM_NA),
    lmPcode: normalizeText(data?.lmPcode, SYSTEM_NA),
    windowDisplay: normalizeText(window?.display, SYSTEM_NA),
    windowStart: readTimestampIso(window?.start),
    windowEnd: readTimestampIso(window?.end),
    generatedAt: readTimestampIso(generation?.generatedAt),
    generatedByUser: normalizeText(
      generation?.generatedBy || data?.generatedByUser,
      SYSTEM_NA,
    ),
    generationIteration: readNumber(generation?.iteration, 0),
    rowCount: readNumber(summary?.totalRows, 0),
    successfulReads: readNumber(summary?.successfulReads, 0),
    noAccess: readNumber(summary?.noAccess, 0),
    unsuccessful: readNumber(summary?.unsuccessful, 0),
    mediaEvidence: readNumber(summary?.mediaEvidence, 0),
    metadata: {
      createdAt: readTimestampIso(
        data?.metadata?.created?.at || data?.metadata?.createdAt,
      ),
      createdByUser: normalizeText(
        data?.metadata?.created?.byUser || data?.metadata?.createdByUser,
        SYSTEM_NA,
      ),
      updatedAt: readTimestampIso(
        data?.metadata?.updated?.at || data?.metadata?.updatedAt,
      ),
      updatedByUser: normalizeText(
        data?.metadata?.updated?.byUser || data?.metadata?.updatedByUser,
        SYSTEM_NA,
      ),
    },
  };
}

export const listMreadStagingSessions = onCall(async (request) => {
  try {
    const db = getFirestore();
    const data = request?.data || {};

    const lmPcode = normalizeText(data?.lmPcode, "");
    const rawLimit = Number(data?.limit || 200);
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 200;

    const caller = await loadCallerContext({ db, request });
    await assertCanReadMreadStagingCycles({ db, caller, lmPcode });

    let query = db.collection(MREAD_STAGING_COLLECTION);
    if (isMeaningful(lmPcode)) {
      query = query.where("lmPcode", "==", lmPcode);
    } else if (caller.role !== "SPU") {
      throw new HttpsError(
        "invalid-argument",
        "lmPcode is required for non-SPU users",
      );
    }

    if (limit > 0) {
      query = query.limit(limit);
    }

    const snap = await query.get();
    const sessions = snap.docs.map(serializeSession).sort(sortSessions);

    logger.info("listMreadStagingSessions -- SUCCESS", {
      requestedByUid: caller.uid,
      requestedByUser: caller.actorName,
      role: caller.role,
      auLmPcode: lmPcode || "ALL",
      sessionCount: sessions.length,
    });

    return {
      ok: true,
      collection: MREAD_STAGING_COLLECTION,
      filters: {
        lmPcode: lmPcode || null,
      },
      access: {
        role: caller.role,
      },
      rows: sessions,
      summary: {
        totalSessions: sessions.length,
      },
    };
  } catch (error) {
    logger.error("listMreadStagingSessions -- FAILED", {
      code: error?.code || "LIST_MREAD_STAGING_SESSIONS_FAILED",
      message: error?.message || String(error),
    });

    if (error instanceof HttpsError) {
      throw error;
    }

    return {
      ok: false,
      code: "LIST_MREAD_STAGING_SESSIONS_FAILED",
      message: error?.message || "Could not load MREAD staging sessions",
      rows: [],
      summary: {
        totalSessions: 0,
      },
    };
  }
});
