import crypto from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";

export const BGO_COLLECTIONS = {
  batches: "bgo_batches",
  rows: "bgo_rows",
  tcUploads: "tc_uploads",
  tcRows: "tc_rows",
  trns: "trns",
  asts: "asts",
  premises: "premises",
  users: "users",
  notifications: "notifications",
};

export const BGO_SOURCE = "BULK_GEOFENCE_ORIGIN";

export const BGO_CHILD_RELEASE_STATES = {
  waiting: "WAITING_BATCH_ACCEPTANCE",
  released: "RELEASED_TO_EXECUTION",
};

export const BGO_BATCH_WORKFLOW_STATES = {
  issued: "ISSUED",
  accepted: "ACCEPTED",
  rejected: "REJECTED",
  cancelled: "CANCELLED",
};

export function normalizeText(value) {
  return String(value || "").trim();
}

export function normalizeUpper(value) {
  return normalizeText(value).toUpperCase();
}

export function hasMeaningfulValue(value) {
  const text = normalizeUpper(value);

  return (
    text !== "" &&
    text !== "NAV" &&
    text !== "N/AV" &&
    text !== "N/A" &&
    text !== "NA" &&
    text !== "NULL" &&
    text !== "UNDEFINED"
  );
}

export function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function safeJsonClone(value) {
  return JSON.parse(
    JSON.stringify(value, (key, item) => (item === undefined ? null : item)),
  );
}

export function buildFailureResult(code, message, extra = {}) {
  return {
    success: false,
    code: code || "UNKNOWN_ERROR",
    message: message || "Unknown error",
    ...extra,
  };
}

export function buildSuccessResult(message, extra = {}) {
  return {
    success: true,
    code: "SUCCESS",
    message: message || "BGO processed successfully",
    ...extra,
  };
}

export function getActorNameFromRequest(request) {
  const token = request?.auth?.token || {};

  return (
    token?.name ||
    token?.email ||
    token?.displayName ||
    request?.auth?.uid ||
    "SYSTEM"
  );
}

function readFirstString(...values) {
  for (const value of values) {
    const clean = normalizeText(value);
    if (clean) return clean;
  }

  return "";
}

function extractRoleFromProfileOrToken({ profile = {}, token = {} }) {
  return normalizeUpper(
    readFirstString(
      token?.role,
      token?.userRole,
      token?.employmentRole,
      token?.employment_role,
      token?.irepsRole,
      profile?.role,
      profile?.userRole,
      profile?.employment?.role,
      profile?.employment?.position,
    ),
  );
}

function extractServiceProviderRelationship({ profile = {}, token = {} }) {
  return normalizeUpper(
    readFirstString(
      token?.serviceProviderRelationshipType,
      token?.relationshipType,
      token?.spRelationshipType,
      token?.employmentServiceProviderRelationshipType,
      profile?.employment?.serviceProvider?.relationshipType,
      profile?.employment?.serviceProvider?.clientRelationshipType,
      profile?.serviceProvider?.relationshipType,
    ),
  );
}

function extractServiceProviderClientType({ profile = {}, token = {} }) {
  return normalizeUpper(
    readFirstString(
      token?.serviceProviderClientType,
      token?.clientType,
      token?.spClientType,
      profile?.employment?.serviceProvider?.clientType,
      profile?.serviceProvider?.clientType,
    ),
  );
}

export async function findActorProfile(db, uid) {
  if (!uid) return {};

  const candidatePaths = [
    `users/${uid}`,
    `userProfiles/${uid}`,
    `profiles/${uid}`,
  ];

  for (const path of candidatePaths) {
    const snap = await db.doc(path).get();

    if (snap.exists) {
      return snap.data() || {};
    }
  }

  return {};
}

export async function resolveBgoCreateAuthority({ db, request }) {
  const uid = request?.auth?.uid;
  const token = request?.auth?.token || {};
  const profile = await findActorProfile(db, uid);

  const role = extractRoleFromProfileOrToken({ profile, token });

  const relationshipType = extractServiceProviderRelationship({
    profile,
    token,
  });

  const clientType = extractServiceProviderClientType({
    profile,
    token,
  });

  const isMnc =
    relationshipType === "MNC" ||
    clientType === "MNC" ||
    profile?.employment?.serviceProvider?.isMnc === true ||
    profile?.serviceProvider?.isMnc === true;

  const isMng = role === "MNG";
  const isMncSpv = role === "SPV" && isMnc;

  return {
    ok: isMng || isMncSpv,
    role: role || "UNKNOWN",
    relationshipType: relationshipType || "UNKNOWN",
    clientType: clientType || "UNKNOWN",
    isMnc,
    profile,
  };
}

export function buildRootMetadata({ now, actorUid, actorName }) {
  return {
    createdAt: now,
    createdByUid: actorUid || "NAv",
    createdByUser: actorName || "NAv",
    updatedAt: now,
    updatedByUid: actorUid || "NAv",
    updatedByUser: actorName || "NAv",
  };
}

export function buildUpdateMetadataPatch({ now, actorUid, actorName }) {
  return {
    "metadata.updatedAt": now,
    "metadata.updatedByUid": actorUid || "NAv",
    "metadata.updatedByUser": actorName || "NAv",
  };
}

export function buildHash(value, length = 16) {
  return crypto
    .createHash("sha1")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, length)
    .toUpperCase();
}

export function sanitizeIdPart(value, fallback = "NAV") {
  const clean = normalizeUpper(value)
    .replace(/[^A-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return clean || fallback;
}

export function sanitizeFirestoreIdPart(value, fallback = "NAv") {
  const clean = normalizeText(value)
    .replace(/[\\/]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return clean || fallback;
}

export function getTrnShortCode(trnType) {
  switch (normalizeUpper(trnType)) {
    case "METER_DISCONNECTION":
      return "MDCN";
    case "METER_RECONNECTION":
      return "MRCN";
    case "METER_REMOVAL":
      return "MREM";
    case "METER_READING":
      return "MREAD";
    case "METER_INSPECTION":
      return "MINSP";
    case "METER_DISCOVERY":
      return "MDIS";
    case "METER_INSTALLATION":
      return "MINST";
    default:
      return "MTRN";
  }
}

export function buildBgoBatchId({ tcId, geofenceId }) {
  return `${sanitizeFirestoreIdPart(tcId)}_BGO_${sanitizeFirestoreIdPart(
    geofenceId,
    "NO_GEOFENCE",
  )}`;
}

export function buildBgoRowId({ tcRowId }) {
  return `${sanitizeFirestoreIdPart(tcRowId)}_BGO`;
}

export function getMeterServiceCode(meterType) {
  const value = normalizeUpper(meterType);

  if (value === "ELECTRICITY" || value === "ELECTRIC" || value === "ELC") {
    return "ELC";
  }

  if (value === "WATER" || value === "WTR") {
    return "WTR";
  }

  return "MTR";
}

export function buildBgoChildTrnId({
  trnType,
  timestampMs,
  meterType,
  wardPcode,
  erfNo,
}) {
  const shortCode = getTrnShortCode(trnType);
  const cleanTimestamp = String(Number(timestampMs) || Date.now()).replace(
    /\D/g,
    "",
  );

  return [
    "TRN",
    sanitizeIdPart(shortCode),
    sanitizeIdPart(cleanTimestamp),
    getMeterServiceCode(meterType),
    sanitizeIdPart(wardPcode),
    sanitizeIdPart(erfNo),
  ].join("_");
}

export function buildHistoryEvent({
  trnId,
  trnType,
  astId,
  event,
  workflowState,
  outcome = "NAv",
  actorUid,
  actorName,
  now,
  note = "",
}) {
  return {
    event,
    workflowState,
    outcome,
    trnId,
    trnType,
    astId,
    note,
    actor: {
      uid: actorUid || "NAv",
      name: actorName || "NAv",
    },
    metadata: buildRootMetadata({ now, actorUid, actorName }),
  };
}

export function getTcRowId(rowDoc) {
  return rowDoc?.id || "NAv";
}

export function getTcIdFromUpload(upload = {}) {
  return (
    upload?.id ||
    upload?.tcId ||
    upload?.upload?.tcId ||
    upload?.upload?.id ||
    "NAv"
  );
}

export function getTcIdFromRow(row = {}) {
  return (
    row?.tcId ||
    row?.upload?.tcId ||
    row?.upload?.id ||
    row?.tcUploadId ||
    "NAv"
  );
}

export function getTcRowTrnType(row = {}, upload = {}) {
  return normalizeUpper(
    row?.backend?.trnType ||
      row?.upload?.trnType ||
      row?.trnType ||
      upload?.trnType ||
      upload?.trnCode ||
      "",
  );
}

export function getAstIdFromRow(row = {}) {
  return normalizeText(
    row?.ast?.id ||
      row?.ast?.astId ||
      row?.ast?.trnId ||
      row?.backend?.astId ||
      row?.backend?.matchedAstId ||
      row?.matchedAstId ||
      "",
  );
}

export function getPremiseIdFromRow(row = {}) {
  return normalizeText(
    row?.premise?.id ||
      row?.premise?.premiseId ||
      row?.ast?.premiseId ||
      row?.backend?.premiseId ||
      row?.backend?.matchedPremiseId ||
      "",
  );
}

export function getMeterNoFromRow(row = {}) {
  return (
    row?.frontend?.meterNo ||
    row?.input?.meterNo ||
    row?.ast?.astNo ||
    row?.ast?.meterNo ||
    row?.backend?.meterNo ||
    "NAv"
  );
}

export function getErfNoFromRow(row = {}, astDoc = {}) {
  return (
    row?.premise?.erfNo ||
    row?.ast?.erfNo ||
    astDoc?.accessData?.erfNo ||
    astDoc?.accessData?.erf?.erfNo ||
    "NAv"
  );
}

export function normalizeGeofenceRef(ref = {}) {
  const id = normalizeText(ref?.id || ref?.geofenceId || ref?.geoFenceId || "");
  const name = normalizeText(ref?.name || ref?.label || ref?.description || id);

  if (!id) return null;

  return {
    id,
    name: name || id,
  };
}

export function normalizeGeofenceRefs(refs = []) {
  const seen = new Set();

  return safeArray(refs)
    .map(normalizeGeofenceRef)
    .filter((ref) => {
      if (!ref?.id || seen.has(ref.id)) return false;
      seen.add(ref.id);
      return true;
    });
}

export function selectedGeofenceBelongsToRow({ row = {}, geofenceRef = {} }) {
  const selected = normalizeGeofenceRef(geofenceRef);

  if (!selected) return false;

  const rowRefs = normalizeGeofenceRefs(row?.geofenceRefs);

  return rowRefs.some((ref) => ref.id === selected.id);
}

export function isTcRowReadyForBgo(row = {}) {
  return (
    row?.bgo?.ready === true &&
    row?.bgo?.readinessState === "READY_FOR_BGO" &&
    row?.bgo?.used !== true &&
    !hasMeaningfulValue(row?.bgo?.batchId)
  );
}

export function validateTarget(target = {}) {
  const targetType = normalizeUpper(target?.type);
  const targetId = normalizeText(target?.id);
  const targetName = normalizeText(target?.name || targetId);

  if (!["TEAM", "SP"].includes(targetType)) {
    return {
      ok: false,
      code: "INVALID_BGO_TARGET_TYPE",
      message: "BGO target must be TEAM or SP",
    };
  }

  if (!targetId) {
    return {
      ok: false,
      code: "INVALID_BGO_TARGET_ID",
      message: "BGO target id is required",
    };
  }

  return {
    ok: true,
    target: {
      type: targetType,
      id: targetId,
      name: targetName || targetId,
    },
  };
}

export function validateCreateBgoPayload(data = {}) {
  const tcId = normalizeText(data?.tcId);
  const trnType = normalizeUpper(data?.trnType || data?.operationType);
  const allocations = safeArray(data?.allocations);

  if (!tcId) {
    return {
      ok: false,
      code: "INVALID_TC_ID",
      message: "tcId is required",
    };
  }

  if (!trnType) {
    return {
      ok: false,
      code: "INVALID_BGO_TRN_TYPE",
      message: "trnType / operationType is required",
    };
  }

  if (allocations.length === 0) {
    return {
      ok: false,
      code: "NO_BGO_ALLOCATIONS",
      message: "At least one geofence allocation is required",
    };
  }

  const normalizedAllocations = [];

  for (const allocation of allocations) {
    const geofenceRef = normalizeGeofenceRef({
      id: allocation?.geofenceId || allocation?.geofence?.id,
      name: allocation?.geofenceName || allocation?.geofence?.name,
    });

    if (!geofenceRef) {
      return {
        ok: false,
        code: "INVALID_BGO_GEOFENCE",
        message: "Every allocation must include a geofence id",
      };
    }

    const targetCheck = validateTarget({
      type: allocation?.targetType || allocation?.target?.type,
      id: allocation?.targetId || allocation?.target?.id,
      name: allocation?.targetName || allocation?.target?.name,
    });

    if (!targetCheck.ok) {
      return targetCheck;
    }

    const tcRowIds = safeArray(allocation?.tcRowIds)
      .map((id) => normalizeText(id))
      .filter(Boolean);

    if (tcRowIds.length === 0) {
      return {
        ok: false,
        code: "BGO_ALLOCATION_HAS_NO_ROWS",
        message: `Allocation ${geofenceRef.name} has no TC rows`,
      };
    }

    normalizedAllocations.push({
      geofenceRef,
      target: targetCheck.target,
      tcRowIds: [...new Set(tcRowIds)],
      instruction: allocation?.instruction || null,
    });
  }

  return {
    ok: true,
    tcId,
    trnType,
    allocations: normalizedAllocations,
  };
}

export function assertNoDuplicateRowUseAcrossAllocations(allocations = []) {
  const seen = new Map();

  for (const allocation of allocations) {
    for (const tcRowId of allocation.tcRowIds) {
      if (seen.has(tcRowId)) {
        throw new HttpsError(
          "invalid-argument",
          `TC row ${tcRowId} appears in more than one BGO allocation.`,
        );
      }

      seen.set(tcRowId, allocation.geofenceRef.id);
    }
  }

  return Array.from(seen.keys());
}

export function chunkArray(items = [], size = 400) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

export async function commitWriteJobsInChunks({
  db,
  writeJobs = [],
  chunkSize = 400,
}) {
  let committedWrites = 0;

  for (const chunk of chunkArray(writeJobs, chunkSize)) {
    const batch = db.batch();

    chunk.forEach((writeJob) => {
      writeJob(batch);
      committedWrites += 1;
    });

    await batch.commit();
  }

  return committedWrites;
}
