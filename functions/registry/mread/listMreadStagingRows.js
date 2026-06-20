import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";
import {
  loadCallerContext,
  assertCanReadMreadStagingCycles,
} from "./listMreadStagingCycles.js";

const MREAD_STAGING_COLLECTION = "mread_staging";
const SYSTEM_NA = "NAv";
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 200;

function normalizeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function normalizeOptionalFilter(value) {
  const text = normalizeText(value, "");
  if (!text || text.toUpperCase() === "ALL") return null;
  return text;
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

function readNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function compareText(left, right) {
  return String(left || "").localeCompare(String(right || ""));
}

function sortRows(left, right) {
  return (
    compareText(left.wardPcode, right.wardPcode) ||
    compareText(left.geofence, right.geofence) ||
    compareText(left.meterNo, right.meterNo) ||
    compareText(left.rowId, right.rowId)
  );
}

function serializeRow(docSnap) {
  const data = docSnap.data() || {};
  return {
    rowId: normalizeText(docSnap.id),
    stagingId: normalizeText(data?.stagingId, SYSTEM_NA),
    meterNo: normalizeText(data?.meterNo, SYSTEM_NA),
    currentReading: readNumber(data?.currentReading, null),
    prevReading: readNumber(data?.prevReading, null),
    consumption: readNumber(data?.consumption, null),
    currentReadingDate: readTimestampIso(data?.currentReadingDate),
    prevReadingDate: readTimestampIso(data?.prevReadingDate),
    wardPcode: normalizeText(data?.wardPcode, SYSTEM_NA),
    geofence: normalizeText(data?.geofence, SYSTEM_NA),
    meterKind: normalizeText(data?.meterKind, SYSTEM_NA),
    meterType: normalizeText(data?.meterType, SYSTEM_NA),
    phase: normalizeText(data?.phase, SYSTEM_NA),
    premiseType: normalizeText(data?.premiseType, SYSTEM_NA),
    premiseAddress: normalizeText(data?.premiseAddress, SYSTEM_NA),
    successfulReads: readNumber(data?.successfulReads, 0),
    unsuccessful: readNumber(data?.unsuccessful, 0),
    noAccess: readNumber(data?.noAccess, 0),
    mediaEvidence: readNumber(data?.mediaEvidence, 0),
    sourceCounts: {
      successfulReads: readNumber(data?.sourceCounts?.successfulReads, 0),
      unsuccessful: readNumber(data?.sourceCounts?.unsuccessful, 0),
      noAccess: readNumber(data?.sourceCounts?.noAccess, 0),
      totalAttempts: readNumber(data?.sourceCounts?.totalAttempts, 0),
    },
    evidence: {
      hasMedia: data?.evidence?.hasMedia === true,
      mediaEvidenceIds: Array.isArray(data?.evidence?.mediaEvidenceIds)
        ? data.evidence.mediaEvidenceIds
        : [],
    },
  };
}

export const listMreadStagingRows = onCall(async (request) => {
  const db = getFirestore();
  const data = request?.data || {};

  const requestedLmPcode = normalizeText(data?.lmPcode, "");
  const stagingId = normalizeText(data?.stagingId, "");
  const wardPcode = normalizeOptionalFilter(data?.wardPcode);
  const geofence = normalizeOptionalFilter(data?.geofence);
  const meterKind = normalizeOptionalFilter(data?.meterKind);
  const meterType = normalizeOptionalFilter(data?.meterType);
  const phase = normalizeOptionalFilter(data?.phase);
  const premiseType = normalizeOptionalFilter(data?.premiseType);
  const search = normalizeOptionalFilter(data?.search);
  const pageSize = Number.isFinite(Number(data?.pageSize))
    ? Math.min(Math.max(Number(data?.pageSize), 1), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  const cursor = normalizeText(data?.cursor, "");

  if (!stagingId) {
    throw new HttpsError("invalid-argument", "stagingId is required");
  }

  if (!wardPcode) {
    throw new HttpsError(
      "invalid-argument",
      "wardPcode is required for MREAD staging row reads",
    );
  }

  const stagingSnap = await db
    .collection(MREAD_STAGING_COLLECTION)
    .doc(stagingId)
    .get();

  if (!stagingSnap.exists) {
    throw new HttpsError("not-found", "Staging session not found");
  }

  const stagingDoc = stagingSnap.data() || {};
  const lmPcode = normalizeText(stagingDoc?.lmPcode, "");

  if (
    requestedLmPcode &&
    requestedLmPcode !== SYSTEM_NA &&
    lmPcode &&
    requestedLmPcode !== lmPcode
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Staging session does not match requested LM scope",
    );
  }

  const caller = await loadCallerContext({ db, request });
  await assertCanReadMreadStagingCycles({ db, caller, lmPcode });

  let query = db.collection(`${MREAD_STAGING_COLLECTION}/${stagingId}/rows`);

  if (wardPcode) query = query.where("wardPcode", "==", wardPcode);
  if (geofence) query = query.where("geofence", "==", geofence);
  if (meterKind) query = query.where("meterKind", "==", meterKind);
  if (meterType) query = query.where("meterType", "==", meterType);
  if (phase) query = query.where("phase", "==", phase);
  if (premiseType) query = query.where("premiseType", "==", premiseType);

  const snap = await query.get();
  let rows = snap.docs.map(serializeRow).sort(sortRows);

  if (search) {
    const normalizedSearch = normalizeText(search);
    rows = rows.filter((row) =>
      [row.meterNo, row.premiseAddress, row.geofence, row.phase]
        .map(normalizeText)
        .some((value) =>
          value.toLowerCase().includes(normalizedSearch.toLowerCase()),
        ),
    );
  }

  const startIndex = cursor
    ? Math.max(rows.findIndex((row) => row.rowId === cursor) + 1, 0)
    : 0;
  const pageRows = rows.slice(startIndex, startIndex + pageSize);
  const nextCursor =
    startIndex + pageRows.length < rows.length
      ? rows[startIndex + pageRows.length]?.rowId || null
      : null;

  logger.info("listMreadStagingRows -- SUCCESS", {
    requestedByUid: caller.uid,
    requestedByUser: caller.actorName,
    role: caller.role,
    stagingId,
    lmPcode,
    rowCount: pageRows.length,
    totalRows: rows.length,
  });

  return {
    ok: true,
    stagingId,
    access: {
      role: caller.role,
    },
    filters: {
      lmPcode: requestedLmPcode || null,
      wardPcode: wardPcode || null,
      geofence: geofence || null,
      meterKind: meterKind || null,
      meterType: meterType || null,
      phase: phase || null,
      premiseType: premiseType || null,
      search: search || null,
      pageSize,
      cursor: cursor || null,
    },
    totalRows: rows.length,
    nextCursor,
    rows: pageRows,
  };
});
