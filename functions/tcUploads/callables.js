import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";

import {
  TC_ALLOWED_ROLES,
  buildFlatMetadata,
  buildTcRowId,
  buildTcUploadFingerprint,
  buildTcUploadId,
  buildUpdateMetadata,
  chunkArray,
  getActiveSameOperationLifecycle,
  getActorName,
  getAstSummary,
  getEligibilityResult,
  getTrnCodeForType,
  getUserRole,
  normalizeGeoFenceRefs,
  normalizeMeterNo,
  normalizeOptionalWardPcode,
  normalizeText,
  normalizeTrnType,
  normalizeUpper,
  validateAndNormalizeTcRows,
} from "./helpers.js";

import {
  applyTcRowBgoReadiness,
  buildTcUploadSummaryFromRows,
} from "./readiness.js";

const REGION = "us-central1";
const TC_UPLOADS_COLLECTION = "tc_uploads";
const TC_ROWS_COLLECTION = "tc_rows";
const TC_UPLOAD_DEDUPE_COLLECTION = "tc_upload_dedupe";
const ASTS_COLLECTION = "asts";
const PREMISES_COLLECTION = "premises";
const METER_MASTER_COLLECTION = "meter_master";
const USERS_COLLECTION = "users";
const TC_UPLOAD_EVALUATOR_USER = "TC Upload BGO Readiness Evaluator";

function requireAuth(request) {
  if (!request.auth?.uid) {
    throw new HttpsError(
      "unauthenticated",
      "You must be signed in to upload and validate TC files.",
    );
  }
}

async function getCallerData({ db, uid }) {
  const userSnapshot = await db.collection(USERS_COLLECTION).doc(uid).get();

  if (!userSnapshot.exists) {
    return {};
  }

  return userSnapshot.data() || {};
}

function assertCanUploadTc({ callerData }) {
  const role = getUserRole(callerData);

  if (!TC_ALLOWED_ROLES.includes(role)) {
    throw new HttpsError(
      "permission-denied",
      "Only SPU, ADM, MNG, or SPV users may upload TC files.",
    );
  }

  return role;
}

function validateRequestData(data = {}) {
  const trnType = normalizeTrnType(data?.trnType);
  const trnCode = getTrnCodeForType(trnType);
  const lmPcode = normalizeUpper(data?.lmPcode);
  const wardPcode = normalizeOptionalWardPcode(data?.wardPcode);

  if (!trnCode) {
    throw new HttpsError(
      "invalid-argument",
      `${trnType || "TRN type"} is not supported by TC Uploads v1.`,
    );
  }

  if (!lmPcode || lmPcode === "NAV") {
    throw new HttpsError(
      "invalid-argument",
      "lmPcode is required for TC Uploads.",
    );
  }

  const normalizedRowsResult = validateAndNormalizeTcRows(data?.rows || []);

  if (!normalizedRowsResult.ok) {
    throw new HttpsError(
      "invalid-argument",
      normalizedRowsResult.errors.join(" "),
      { errors: normalizedRowsResult.errors },
    );
  }

  return {
    trnType,
    trnCode,
    lmPcode,
    wardPcode,
    rows: normalizedRowsResult.rows,
    duplicateMeterNoSet: normalizedRowsResult.duplicateMeterNoSet,
  };
}

function getMeterMasterAstId(masterData = {}) {
  return (
    masterData?.refs?.asts?.id ||
    masterData?.refs?.ast?.id ||
    masterData?.refs?.astId ||
    masterData?.astId ||
    masterData?.ast?.id ||
    null
  );
}

async function getAstMatchesFromMeterMaster({ db, meterNos }) {
  const matchMap = new Map();
  const uniqueMeterNos = Array.from(new Set(meterNos.filter(Boolean)));

  for (const meterNoChunk of chunkArray(uniqueMeterNos, 300)) {
    const masterRefs = meterNoChunk.map((meterNo) =>
      db.collection(METER_MASTER_COLLECTION).doc(meterNo),
    );

    const masterSnapshots = await db.getAll(...masterRefs);
    const astRefsToLoad = [];
    const astIdToMeterNoMap = new Map();

    masterSnapshots.forEach((masterSnapshot, index) => {
      if (!masterSnapshot.exists) return;

      const meterNo = meterNoChunk[index];
      const masterData = masterSnapshot.data() || {};
      const astId = getMeterMasterAstId(masterData);

      if (!astId) return;

      astRefsToLoad.push(db.collection(ASTS_COLLECTION).doc(astId));
      astIdToMeterNoMap.set(astId, meterNo);
    });

    if (astRefsToLoad.length === 0) continue;

    const astSnapshots = await db.getAll(...astRefsToLoad);

    astSnapshots.forEach((astSnapshot) => {
      if (!astSnapshot.exists) return;

      const astId = astSnapshot.id;
      const meterNo = astIdToMeterNoMap.get(astId);

      if (!meterNo || matchMap.has(meterNo)) return;

      matchMap.set(meterNo, {
        astId,
        astData: astSnapshot.data() || {},
        source: "METER_MASTER",
      });
    });
  }

  return matchMap;
}

async function addFallbackAstMatches({ db, meterNos, matchMap }) {
  const unmatchedMeterNos = Array.from(
    new Set(meterNos.filter((meterNo) => meterNo && !matchMap.has(meterNo))),
  );

  for (const meterNoChunk of chunkArray(unmatchedMeterNos, 30)) {
    const astSnapshot = await db
      .collection(ASTS_COLLECTION)
      .where("master.id", "in", meterNoChunk)
      .get();

    astSnapshot.docs.forEach((documentSnapshot) => {
      const astData = documentSnapshot.data() || {};
      const matchedMeterNo = normalizeMeterNo(
        astData?.master?.id || astData?.astData?.astNo,
      );

      if (!matchedMeterNo || matchMap.has(matchedMeterNo)) return;

      matchMap.set(matchedMeterNo, {
        astId: documentSnapshot.id,
        astData,
        source: "AST_MASTER_ID",
      });
    });
  }

  return matchMap;
}

async function getAstMatches({ db, rows }) {
  const meterNos = rows.map((row) => row.meterNoNormalized).filter(Boolean);
  const matchMap = await getAstMatchesFromMeterMaster({ db, meterNos });

  await addFallbackAstMatches({ db, meterNos, matchMap });

  return matchMap;
}

function normalizeTcGps(value) {
  const latitude = Number(value?.latitude ?? value?.lat);
  const longitude = Number(value?.longitude ?? value?.lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    latitude,
    longitude,
  };
}

function getAstGpsSnapshot(astData = {}) {
  return (
    normalizeTcGps(astData?.ast?.location?.gps) ||
    normalizeTcGps(astData?.location?.gps) ||
    normalizeTcGps(astData?.gps) ||
    normalizeTcGps(astData?.astData?.location?.gps) ||
    normalizeTcGps(astData?.astData?.gps) ||
    normalizeTcGps(astData?.accessData?.gps) ||
    null
  );
}

function buildTcAstSummaryWithGps({ astId, astData = {}, meterNo }) {
  return {
    ...getAstSummary({ astId, astData, meterNo }),
    gps: getAstGpsSnapshot(astData),
  };
}

function valueOrNav(value) {
  if (value === null || value === undefined || value === "") return "NAv";
  return value;
}

function cleanPremiseText(value) {
  return String(value || "").trim();
}

function buildPremiseAddress(address = {}) {
  if (typeof address === "string") {
    const cleanAddress = cleanPremiseText(address);
    return cleanAddress || "NAv";
  }

  const parts = [
    address?.strNo,
    address?.strName,
    address?.strType,
    address?.suburbName,
  ]
    .map(cleanPremiseText)
    .filter((part) => part && part !== "NAv" && part !== "-");

  return parts.length ? parts.join(" ") : "NAv";
}

function getWardNoFromPcodeForTc(value) {
  const text = String(valueOrNav(value));

  if (text === "NAv") return "NAv";

  const digits = text.replace(/\D/g, "");
  if (!digits) return text;

  const lastThree = digits.slice(-3);
  const wardNo = Number(lastThree);

  return Number.isFinite(wardNo) ? String(wardNo) : text;
}

function getAstPremiseIdForTc(astData = {}) {
  return (
    astData?.accessData?.premise?.id ||
    astData?.accessData?.premiseId ||
    astData?.ast?.accessData?.premise?.id ||
    astData?.ast?.accessData?.premiseId ||
    astData?.premise?.id ||
    astData?.premiseId ||
    ""
  );
}

function getPremiseGpsSnapshot(premiseData = {}) {
  return (
    normalizeTcGps(premiseData?.gps) ||
    normalizeTcGps(premiseData?.location?.gps) ||
    normalizeTcGps(premiseData?.geometry?.centroid) ||
    null
  );
}

function buildTcPremiseSnapshot({
  premiseId,
  premiseData = {},
  astData = {},
  input = {},
}) {
  const propertyType = premiseData?.propertyType || {};
  const astPremise = astData?.accessData?.premise || astData?.premise || {};
  const astParents = astData?.accessData?.parents || astData?.parents || {};
  const premiseParents = premiseData?.parents || {};

  const inputPropertyType = input?.premisePropertyType || input?.propertyType;
  const premiseAddress =
    premiseData?.addressText ||
    premiseData?.addressLine ||
    premiseData?.addressString ||
    astPremise?.addressText ||
    astPremise?.address ||
    buildPremiseAddress(premiseData?.address);

  const address =
    premiseAddress && premiseAddress !== "NAv"
      ? premiseAddress
      : input?.premiseAddress || "NAv";

  const wardPcode =
    premiseData?.wardPcode ||
    premiseParents?.wardPcode ||
    astData?.wardPcode ||
    astParents?.wardPcode ||
    "NAv";

  return {
    id: valueOrNav(premiseData?.id || premiseId),
    premiseId: valueOrNav(premiseData?.premiseId || premiseId),
    address: valueOrNav(address),
    propertyType: {
      type: valueOrNav(propertyType?.type || astPremise?.propertyType?.type || inputPropertyType),
      name: valueOrNav(propertyType?.name || astPremise?.propertyType?.name || inputPropertyType),
      unitNo: valueOrNav(propertyType?.unitNo || astPremise?.propertyType?.unitNo),
    },
    gps: getPremiseGpsSnapshot(premiseData),
    erfNo: valueOrNav(premiseData?.erfNo || astData?.accessData?.erfNo || astData?.erfNo),
    wardPcode: valueOrNav(wardPcode),
    wardNo: valueOrNav(premiseData?.wardNo || getWardNoFromPcodeForTc(wardPcode)),
  };
}

function buildInputPremiseSnapshot(row = {}) {
  return buildTcPremiseSnapshot({
    premiseId: null,
    premiseData: {},
    astData: {},
    input: row?.input || {},
  });
}

async function getPremiseSnapshotsForMatches({ db, matchMap }) {
  const premiseIds = Array.from(
    new Set(
      Array.from(matchMap.values())
        .map((match) => getAstPremiseIdForTc(match?.astData || {}))
        .filter((premiseId) => premiseId && premiseId !== "NAv"),
    ),
  );

  const premiseMap = new Map();

  for (const premiseIdChunk of chunkArray(premiseIds, 300)) {
    const premiseRefs = premiseIdChunk.map((premiseId) =>
      db.collection(PREMISES_COLLECTION).doc(premiseId),
    );

    const premiseSnapshots = await db.getAll(...premiseRefs);

    premiseSnapshots.forEach((premiseSnapshot, index) => {
      const premiseId = premiseIdChunk[index];

      if (!premiseSnapshot.exists) {
        premiseMap.set(premiseId, null);
        return;
      }

      premiseMap.set(premiseId, {
        id: premiseSnapshot.id,
        ...(premiseSnapshot.data() || {}),
      });
    });
  }

  return premiseMap;
}

function createNotFoundRow({ row, tcId, requestContext, metadata }) {
  const baseRow = {
    id: buildTcRowId({ tcId, rowNo: row.rowNo }),
    tcId,
    rowNo: row.rowNo,
    csvLineNumber: row.csvLineNumber,
    input: row.input,
    upload: requestContext,
    frontend: {
      valid: true,
      duplicateRowNo: false,
      duplicateMeterNo: false,
      errors: [],
      warnings: [],
    },
    backend: {
      state: "VALIDATED",
      matched: false,
      notFound: true,
      eligible: false,
      notEligible: false,
      duplicateMeterNo: false,
      alreadyHasActiveSameOperationTrn: false,
      activeLifecycle: null,
      errors: ["Meter number was not found in iREPS."],
      warnings: [],
      reasonCodes: ["METER_NOT_FOUND"],
      message: "Meter number was not found in iREPS.",
    },
    ast: buildTcAstSummaryWithGps({
      astId: null,
      astData: {},
      meterNo: row.meterNoNormalized,
    }),
    premise: buildInputPremiseSnapshot(row),
    geofenceRefs: [],
    bgo: {
      ready: false,
      readinessState: "NOT_FOUND",
      readinessReason: "Meter was not found in iREPS.",
      used: false,
      batchId: null,
      usedAt: null,
    },
    metadata,
  };

  return applyTcRowBgoReadiness({
    row: baseRow,
    geofenceRefs: [],
    now: metadata?.createdAt || new Date().toISOString(),
    updatedByUid: metadata?.createdByUid || "SYSTEM",
    updatedByUser: TC_UPLOAD_EVALUATOR_USER,
  });
}

function createMatchedRow({
  row,
  match,
  tcId,
  trnType,
  duplicateMeterNoSet,
  requestContext,
  metadata,
  premiseData,
}) {
  const eligibility = getEligibilityResult({ trnType, astData: match.astData });
  const activeLifecycle = getActiveSameOperationLifecycle({
    trnType,
    astData: match.astData,
  });
  const duplicateMeterNo = duplicateMeterNoSet.has(row.meterNoNormalized);
  const geofenceRefs = normalizeGeoFenceRefs(match.astData?.geofenceRefs);
  const errors = [];

  if (!eligibility.eligible) {
    errors.push(eligibility.message);
  }

  if (duplicateMeterNo) {
    errors.push("Meter number appears more than once in this TC upload.");
  }

  if (activeLifecycle) {
    errors.push(
      `Meter already has active ${trnType} work in ` +
        `${activeLifecycle.workflowState} state.`,
    );
  }

  const baseRow = {
    id: buildTcRowId({ tcId, rowNo: row.rowNo }),
    tcId,
    rowNo: row.rowNo,
    csvLineNumber: row.csvLineNumber,
    input: row.input,
    upload: requestContext,
    frontend: {
      valid: true,
      duplicateRowNo: false,
      duplicateMeterNo,
      errors: [],
      warnings: [],
    },
    backend: {
      state: "VALIDATED",
      matched: true,
      notFound: false,
      eligible: eligibility.eligible,
      notEligible: !eligibility.eligible,
      eligibilityCode: eligibility.code || null,
      eligibilityMessage: eligibility.message || null,
      duplicateMeterNo,
      alreadyHasActiveSameOperationTrn: Boolean(activeLifecycle),
      activeLifecycle,
      astMatchSource: match.source,
      errors,
      warnings: [],
      reasonCodes: [],
      message: "NAv",
      trnType,
    },
    ast: buildTcAstSummaryWithGps({
      astId: match.astId,
      astData: match.astData,
    }),
    premise: buildTcPremiseSnapshot({
      premiseId: getAstPremiseIdForTc(match.astData),
      premiseData: premiseData || {},
      astData: match.astData,
      input: row.input,
    }),
    geofenceRefs,
    bgo: {
      ready: false,
      readinessState: "NOT_READY_FOR_BGO",
      readinessReason: "Row has not yet been evaluated for BGO.",
      used: false,
      batchId: null,
      usedAt: null,
    },
    metadata,
  };

  return applyTcRowBgoReadiness({
    row: baseRow,
    geofenceRefs,
    now: metadata?.createdAt || new Date().toISOString(),
    updatedByUid: metadata?.createdByUid || "SYSTEM",
    updatedByUser: TC_UPLOAD_EVALUATOR_USER,
  });
}

function summarizeRows(rowDocs) {
  return buildTcUploadSummaryFromRows(rowDocs);
}

function buildGeofenceBreakdown(rowDocs) {
  return buildTcUploadSummaryFromRows(rowDocs).summary.geofenceBreakdown;
}

async function writeRowDocs({ db, rowDocs }) {
  for (const rowDocChunk of chunkArray(rowDocs, 450)) {
    const batch = db.batch();

    rowDocChunk.forEach((rowDoc) => {
      const rowRef = db.collection(TC_ROWS_COLLECTION).doc(rowDoc.id);
      batch.set(rowRef, rowDoc);
    });

    await batch.commit();
  }
}

async function getExistingDuplicateUpload({ db, existingTcId }) {
  const uploadSnapshot = await db
    .collection(TC_UPLOADS_COLLECTION)
    .doc(existingTcId)
    .get();

  if (!uploadSnapshot.exists) {
    throw new HttpsError(
      "failed-precondition",
      "Duplicate upload lock exists, but the original TC upload is missing.",
    );
  }

  return {
    id: uploadSnapshot.id,
    ...(uploadSnapshot.data() || {}),
  };
}

async function reserveTcUploadOrReturnDuplicate({
  db,
  tcId,
  uploadFingerprint,
  initialUploadDoc,
  dedupeDoc,
}) {
  const uploadRef = db.collection(TC_UPLOADS_COLLECTION).doc(tcId);
  const dedupeRef = db
    .collection(TC_UPLOAD_DEDUPE_COLLECTION)
    .doc(uploadFingerprint);

  return db.runTransaction(async (transaction) => {
    const dedupeSnapshot = await transaction.get(dedupeRef);

    if (dedupeSnapshot.exists) {
      const duplicateData = dedupeSnapshot.data() || {};

      return {
        duplicate: true,
        existingTcId: duplicateData.tcId,
        duplicateData,
      };
    }

    const uploadSnapshot = await transaction.get(uploadRef);

    if (uploadSnapshot.exists) {
      throw new HttpsError(
        "already-exists",
        "A TC upload with the generated id already exists. Please retry.",
      );
    }

    transaction.set(uploadRef, initialUploadDoc);
    transaction.set(dedupeRef, dedupeDoc);

    return {
      duplicate: false,
      existingTcId: null,
      duplicateData: null,
    };
  });
}

export const onUploadAndValidateTcCallable = onCall(
  { region: REGION, timeoutSeconds: 540, memory: "1GiB" },
  async (request) => {
    requireAuth(request);

    const db = getFirestore();
    const caller = request.auth;
    const callerData = await getCallerData({ db, uid: caller.uid });
    const actorName = getActorName(caller, callerData);
    const role = assertCanUploadTc({ callerData });
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const requestData = request.data || {};

    const { trnType, trnCode, lmPcode, wardPcode, rows, duplicateMeterNoSet } =
      validateRequestData(requestData);

    const fileName = normalizeText(requestData?.fileName || "TC_UPLOAD.csv");
    const notes = normalizeText(requestData?.notes || "");
    const tcId = buildTcUploadId({ date: nowDate, lmPcode, trnCode });
    const metadata = buildFlatMetadata({ caller, actorName, now });
    const fingerprintResult = buildTcUploadFingerprint({
      trnType,
      lmPcode,
      rows,
    });
    const dedupePolicy = "RETURN_EXISTING_TC_UPLOAD";

    const requestContext = {
      fileName,
      trnType,
      trnCode,
      lmPcode,
      wardPcode,
    };

    const initialUploadDoc = {
      id: tcId,
      fileName,
      trnType,
      trnCode,
      lmPcode,
      wardPcode,
      notes,
      totalRows: rows.length,
      validRows: 0,
      invalidRows: 0,
      foundRows: 0,
      notFoundRows: 0,
      withGeofenceRows: 0,
      withoutGeofenceRows: 0,
      readyRows: 0,
      usedRows: 0,
      remainingRows: 0,
      needsGeofenceRows: 0,
      notEligibleRows: 0,
      blockedActiveSameOperationRows: 0,
      duplicateMeterRows: 0,
      validationState: "VALIDATING",
      bgoStatus: "NOT_READY_FOR_BGO",
      writeState: "WRITING",
      source: {
        channel: "WEB",
        module: "TC_UPLOADS",
        uploadedFrom: "iREPS_WEB",
      },
      dedupe: {
        fingerprint: fingerprintResult.fingerprint,
        fingerprintVersion: fingerprintResult.version,
        policy: dedupePolicy,
        duplicateOfTcId: null,
      },
      summary: {
        totalMeters: rows.length,
        validatedMeters: 0,
        invalidatedMeters: 0,
        foundMeters: 0,
        notFoundMeters: 0,
        withGeofenceMeters: 0,
        withoutGeofenceMeters: 0,
        readyForBgo: 0,
        needsGeofence: 0,
        notEligibleRows: 0,
        blockedActiveSameOperationRows: 0,
        duplicateMeterRows: 0,
        geofenceBreakdown: [],
      },
      metadata,
    };

    const dedupeDoc = {
      id: fingerprintResult.fingerprint,
      fingerprint: fingerprintResult.fingerprint,
      fingerprintVersion: fingerprintResult.version,
      tcId,
      fileName,
      trnType,
      trnCode,
      lmPcode,
      rowCount: rows.length,
      policy: dedupePolicy,
      createdAt: now,
      createdByUid: caller.uid,
      createdByUser: actorName,
      source: {
        channel: "WEB",
        module: "TC_UPLOADS",
        uploadedFrom: "iREPS_WEB",
      },
    };

    const reservation = await reserveTcUploadOrReturnDuplicate({
      db,
      tcId,
      uploadFingerprint: fingerprintResult.fingerprint,
      initialUploadDoc,
      dedupeDoc,
    });

    if (reservation.duplicate) {
      const existingUpload = await getExistingDuplicateUpload({
        db,
        existingTcId: reservation.existingTcId,
      });

      return {
        success: true,
        duplicate: true,
        code: "TC_UPLOAD_DUPLICATE",
        tcId: existingUpload.id,
        existingTcId: existingUpload.id,
        upload: existingUpload,
        message: "This file was already uploaded. Opening existing TC upload.",
      };
    }

    try {
      const matchMap = await getAstMatches({ db, rows });
      const premiseMap = await getPremiseSnapshotsForMatches({ db, matchMap });

      console.log("onUploadAndValidateTcCallable ---- premise snapshots loaded", {
        tcId,
        matchedMeters: matchMap.size,
        premiseSnapshots: premiseMap.size,
      });

      const rowDocs = rows.map((row) => {
        const match = matchMap.get(row.meterNoNormalized);

        if (!match) {
          return createNotFoundRow({
            row,
            tcId,
            requestContext,
            metadata,
          });
        }

        return createMatchedRow({
          row,
          match,
          tcId,
          trnType,
          duplicateMeterNoSet,
          requestContext,
          metadata,
          premiseData:
            premiseMap.get(getAstPremiseIdForTc(match.astData)) || {},
        });
      });

      const summary = summarizeRows(rowDocs);
      const geofenceBreakdown = buildGeofenceBreakdown(rowDocs);

      await writeRowDocs({ db, rowDocs });

      const uploadUpdate = {
        ...summary,
        writeState: "READY",
        summary: {
          ...summary.summary,
          totalMeters: summary.totalRows,
          validatedMeters: summary.validRows,
          invalidatedMeters: summary.invalidRows,
          foundMeters: summary.foundRows,
          notFoundMeters: summary.notFoundRows,
          withGeofenceMeters: summary.withGeofenceRows,
          withoutGeofenceMeters: summary.withoutGeofenceRows,
          readyForBgo: summary.readyRows,
          needsGeofence: summary.needsGeofenceRows,
          geofenceBreakdown,
        },
        dedupe: {
          fingerprint: fingerprintResult.fingerprint,
          fingerprintVersion: fingerprintResult.version,
          policy: dedupePolicy,
          duplicateOfTcId: null,
        },
        metadata: {
          ...metadata,
          ...buildUpdateMetadata({
            caller,
            actorName,
            now: new Date().toISOString(),
          }),
        },
      };

      await db.collection(TC_UPLOADS_COLLECTION).doc(tcId).update(uploadUpdate);

      const uploadSnapshot = await db
        .collection(TC_UPLOADS_COLLECTION)
        .doc(tcId)
        .get();
      const upload = {
        id: uploadSnapshot.id,
        ...(uploadSnapshot.data() || {}),
      };

      return {
        success: true,
        duplicate: false,
        code: "TC_UPLOAD_VALIDATED",
        tcId,
        upload,
        role,
        message: "TC upload validated successfully.",
      };
    } catch (error) {
      await db
        .collection(TC_UPLOADS_COLLECTION)
        .doc(tcId)
        .update({
          validationState: "FAILED",
          writeState: "FAILED",
          failure: {
            message: error?.message || "TC validation failed.",
            code: error?.code || "UNKNOWN_ERROR",
            failedAt: new Date().toISOString(),
          },
          metadata: {
            ...metadata,
            ...buildUpdateMetadata({
              caller,
              actorName,
              now: new Date().toISOString(),
            }),
          },
        });

      throw error;
    }
  },
);
