import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

import {
  TARGETED_BATCH_COLLECTIONS,
  findActorProfile,
  getActorNameFromRequest,
  normalizeText,
  normalizeUpper,
} from "./helpers.js";

export const SALES_TARGETED_BATCH_SOURCE_MODULE = "SALES_TARGETED_BATCH";

function controlledError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.irepsCode = code;
  error.details = details;
  return error;
}

function firstText(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return "";
}

function requireId(value, field) {
  const id = normalizeText(value);
  if (!id || id === "NAv") {
    throw controlledError("INVALID_ARGUMENT", `${field} is required.`, {field});
  }
  return id;
}

function sameId(left, right) {
  return normalizeText(left) === normalizeText(right) && Boolean(normalizeText(left));
}

function requireDocument(snapshot, code, message) {
  if (!snapshot?.exists) throw controlledError(code, message);
  return snapshot.data() || {};
}

function actorRole(profile, token) {
  return normalizeUpper(firstText(
    token?.role, token?.userRole, token?.employmentRole,
    token?.employment_role, token?.irepsRole, profile?.role,
    profile?.userRole, profile?.profile?.employment?.role,
    profile?.employment?.role, profile?.employment?.position,
  ));
}

function actorSpId(profile, token) {
  return firstText(
    token?.spId, token?.serviceProviderId,
    token?.employmentServiceProviderId,
    profile?.profile?.employment?.serviceProvider?.id,
    profile?.employment?.serviceProvider?.id,
    profile?.serviceProvider?.id,
  );
}

function teamMemberIds(team = {}) {
  const ids = new Set();
  const add = (value) => {
    const id = normalizeText(value);
    if (id) ids.add(id);
  };
  (Array.isArray(team.memberUids) ? team.memberUids : []).forEach(add);
  (Array.isArray(team?.scope?.memberUserIds) ? team.scope.memberUserIds : []).forEach(add);
  [...(Array.isArray(team.members) ? team.members : []),
    ...(Array.isArray(team.users) ? team.users : [])].forEach((member) => {
    if (typeof member === "string") add(member);
    else {
      add(member?.uid);
      add(member?.id);
      add(member?.userId);
    }
  });
  return ids;
}

function parseCapturedAt(value) {
  const date = value?.toDate instanceof Function ? value.toDate() : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw controlledError("CAPTURED_AT_INVALID", "capturedAt must be a valid timestamp.");
  }
  return {date, timestamp: Timestamp.fromDate(date), iso: date.toISOString()};
}

function validateMedia(media) {
  if (!Array.isArray(media)) {
    throw controlledError("MEDIA_INVALID", "media must be an array.");
  }
  const valid = media.some((item) =>
    item?.tag === "noAccessPhoto" && firstText(item?.url, item?.uri));
  if (!valid) {
    throw controlledError("NO_ACCESS_PHOTO_REQUIRED", "A noAccessPhoto upload reference is required.");
  }
  return media;
}

function validateLocation(location) {
  const gps = location?.gps || location;
  const lat = Number(gps?.lat);
  const lng = Number(gps?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw controlledError("LOCATION_INVALID", "location.gps must contain valid lat and lng values.");
  }
  return {...location, gps: {lat, lng}};
}

export function normalizeNoAccessInput(data = {}) {
  const trnId = requireId(data.trnId || data.id, "trnId");
  if (!trnId.startsWith("TRN_MDIS_")) {
    throw controlledError("INVALID_TRN_ID", "trnId must start with TRN_MDIS_.");
  }
  if (normalizeUpper(data.sourceModule) !== SALES_TARGETED_BATCH_SOURCE_MODULE) {
    throw controlledError("SOURCE_MODULE_INVALID", "sourceModule must be SALES_TARGETED_BATCH.");
  }
  const reason = requireId(data.reason, "reason");
  return {
    trnId,
    sourceModule: SALES_TARGETED_BATCH_SOURCE_MODULE,
    tbId: requireId(data.tbId, "tbId"),
    rowId: requireId(data.rowId, "rowId"),
    salesDocId: requireId(data.salesDocId, "salesDocId"),
    erfId: requireId(data.erfId, "erfId"),
    premiseId: normalizeText(data.premiseId) || null,
    capturedAt: parseCapturedAt(data.capturedAt),
    reason,
    media: validateMedia(data.media),
    location: validateLocation(data.location),
  };
}

function assertParentExecutable(parent, tbId) {
  if (normalizeUpper(parent?.creation?.state) !== "READY") {
    throw controlledError("TARGETED_BATCH_NOT_READY", `${tbId} is not ready.`);
  }
  if (normalizeUpper(parent?.allocation?.status) !== "ALLOCATED") {
    throw controlledError("TARGETED_BATCH_NOT_ALLOCATED", `${tbId} is not allocated.`);
  }
  if (normalizeUpper(parent?.acceptance?.status) !== "ACCEPTED") {
    throw controlledError("TARGETED_BATCH_NOT_ACCEPTED", `${tbId} is not accepted.`);
  }
  const status = normalizeUpper(parent?.execution?.status || "NOT_STARTED");
  if (!["NOT_STARTED", "IN_PROGRESS"].includes(status)) {
    throw controlledError("TARGETED_BATCH_EXECUTION_STATE_INVALID", `${tbId} is not executable.`);
  }
}

function assertRowExecutable(row, rowId) {
  if (normalizeUpper(row?.decision?.status || "ACCEPT") !== "ACCEPT" ||
      row?.allocation?.allocatable === false ||
      normalizeUpper(row?.allocation?.status) !== "ALLOCATED") {
    throw controlledError("TARGETED_BATCH_ROW_NOT_EXECUTABLE", `${rowId} is not executable.`);
  }
  const status = normalizeUpper(row?.execution?.status || "NOT_STARTED");
  if (!["NOT_STARTED", "IN_PROGRESS"].includes(status)) {
    throw controlledError("TARGETED_BATCH_ROW_EXECUTION_STATE_INVALID", `${rowId} is not executable.`);
  }
  if (normalizeText(row?.refs?.meterId)) {
    throw controlledError("TARGETED_BATCH_METER_ALREADY_LINKED", `${rowId} already has a linked meter.`);
  }
  return status;
}

function assertAuthority({parent, actor, team}) {
  if (!["FWR", "SPV"].includes(actor.role)) {
    throw controlledError("TARGETED_BATCH_ACCESS_DENIED", "Targeted Batch access denied.");
  }
  const allocation = parent?.allocation || {};
  const target = allocation?.target || {};
  const type = normalizeUpper(allocation?.targetType || target?.type);
  const id = firstText(allocation?.targetId, target?.id);
  if (!id || !["TEAM", "SP"].includes(type)) {
    throw controlledError("TARGETED_BATCH_ALLOCATION_TARGET_INVALID", "A TEAM or SP allocation is required.");
  }
  if (type === "SP" && actor.spId === id) return;
  if (type === "TEAM" && teamMemberIds(team).has(actor.uid)) return;
  throw controlledError("TARGETED_BATCH_NOT_ASSIGNED_TO_ACTOR", "Targeted Batch access denied.");
}

function assertIdentity(existing, input) {
  const context = existing?.targetedBatchContext || {};
  if (normalizeUpper(existing?.sourceModule) !== SALES_TARGETED_BATCH_SOURCE_MODULE ||
      !sameId(existing?.id, input.trnId) || !sameId(context?.tbId, input.tbId) ||
      !sameId(context?.rowId, input.rowId) ||
      !sameId(context?.salesDocId, input.salesDocId) ||
      !sameId(context?.erfId, input.erfId)) {
    throw controlledError("IDEMPOTENCY_CONFLICT", "trnId belongs to a different canonical request.");
  }
}

function buildSalesAppend({tbRefs, input, premiseId, actorName, now}) {
  if (!Array.isArray(tbRefs)) {
    throw controlledError("SALES_TB_REFS_INVALID", "The Sales tbRefs field is invalid.");
  }
  const matches = [];
  tbRefs.forEach((ref, index) => {
    if (sameId(ref?.id, input.tbId) && sameId(ref?.rowId, input.rowId)) matches.push(index);
  });
  if (matches.length !== 1) {
    throw controlledError(matches.length ? "SALES_TB_REF_DUPLICATE" : "SALES_TB_REF_NOT_FOUND",
      "The exact Sales Targeted Batch reference was not found uniquely.");
  }
  const index = matches[0];
  const ref = tbRefs[index];
  if (ref.fieldWork !== undefined &&
      (!ref.fieldWork || typeof ref.fieldWork !== "object" || Array.isArray(ref.fieldWork))) {
    throw controlledError("FIELDWORK_INVALID", "Sales fieldWork is invalid.");
  }
  const fieldWork = ref.fieldWork || {};
  if (fieldWork.noAccess !== undefined && !Array.isArray(fieldWork.noAccess)) {
    throw controlledError("FIELDWORK_INVALID", "Sales fieldWork.noAccess is invalid.");
  }
  if (normalizeUpper(fieldWork.status) === "COMPLETED") {
    throw controlledError("TARGETED_BATCH_EXECUTION_COMPLETED", "Sales field work is completed.");
  }
  const summary = {
    date: input.capturedAt.iso.slice(0, 10),
    time: input.capturedAt.iso.slice(11, 19),
    user: actorName,
  };
  const updated = [...tbRefs];
  updated[index] = {
    ...ref,
    fieldWork: {
      ...fieldWork,
      status: "IN_PROGRESS",
      noAccess: [...(fieldWork.noAccess || []), summary],
      premiseId,
      updatedAt: now,
    },
  };
  return {tbRefs: updated, count: updated[index].fieldWork.noAccess.length};
}

function buildTrn({input, row, actor, premiseId, now}) {
  const accessData = {
    trnType: "METER_DISCOVERY",
    erfId: input.erfId,
    parents: {
      lmPcode: row?.scope?.lmPcode || null,
      wardPcode: row?.scope?.wardPcode || null,
    },
    premise: premiseId ? {id: premiseId} : null,
    access: {hasAccess: "no", reason: input.reason},
  };
  return {
    id: input.trnId,
    sourceModule: input.sourceModule,
    targetedBatchContext: {
      tbId: input.tbId,
      rowId: input.rowId,
      salesDocId: input.salesDocId,
      erfId: input.erfId,
    },
    accessData,
    ast: null,
    meterType: "NA",
    media: input.media,
    location: input.location,
    capturedAt: input.capturedAt.timestamp,
    metadata: {
      createdAt: now.toDate().toISOString(),
      createdByUid: actor.uid,
      createdByUser: actor.name,
      updatedAt: now.toDate().toISOString(),
      updatedByUid: actor.uid,
      updatedByUser: actor.name,
    },
  };
}

export async function recordTargetedBatchNoAccess({db, request, now = Timestamp.now()}) {
  const uid = request?.auth?.uid;
  if (!uid) throw controlledError("UNAUTHENTICATED", "Authentication is required.");
  const input = normalizeNoAccessInput(request?.data || {});
  const profile = await findActorProfile(db, uid);
  const token = request?.auth?.token || {};
  const actor = {
    uid,
    name: getActorNameFromRequest(request, profile),
    role: actorRole(profile, token),
    spId: actorSpId(profile, token),
  };
  if (!["FWR", "SPV"].includes(actor.role)) {
    throw controlledError("TARGETED_BATCH_ACCESS_DENIED", "Targeted Batch access denied.");
  }

  const parentRef = db.collection(TARGETED_BATCH_COLLECTIONS.uploads).doc(input.tbId);
  const rowRef = db.collection(TARGETED_BATCH_COLLECTIONS.rows).doc(input.rowId);
  const salesRef = db.collection(TARGETED_BATCH_COLLECTIONS.sales).doc(input.salesDocId);
  const trnRef = db.collection("trns").doc(input.trnId);

  return db.runTransaction(async (transaction) => {
    const [parentSnap, rowSnap, salesSnap, trnSnap] = await Promise.all([
      transaction.get(parentRef), transaction.get(rowRef),
      transaction.get(salesRef), transaction.get(trnRef),
    ]);
    const parent = requireDocument(parentSnap, "TARGETED_BATCH_NOT_FOUND", "Targeted Batch not found.");
    const row = requireDocument(rowSnap, "TARGETED_BATCH_ROW_NOT_FOUND", "Targeted Batch row not found.");
    const sales = requireDocument(salesSnap, "SALES_DOCUMENT_NOT_FOUND", "Sales document not found.");
    const allocation = parent?.allocation || {};
    const target = allocation?.target || {};
    const targetType = normalizeUpper(allocation?.targetType || target?.type);
    const targetId = firstText(allocation?.targetId, target?.id);
    let team = {};
    if (targetType === "TEAM" && targetId) {
      const teamSnap = await transaction.get(db.collection("teams").doc(targetId));
      team = requireDocument(teamSnap, "TARGETED_BATCH_TEAM_NOT_FOUND", "Allocated TEAM not found.");
    }
    assertAuthority({parent, actor, team});

    if (trnSnap.exists) {
      assertIdentity(trnSnap.data() || {}, input);
      const premiseId = normalizeText(row?.refs?.premiseId) || null;
      const exact = Array.isArray(sales.tbRefs) ? sales.tbRefs.find((ref) =>
        sameId(ref?.id, input.tbId) && sameId(ref?.rowId, input.rowId)) : null;
      return {success: true, alreadyRecorded: true, trnId: input.trnId,
        tbId: input.tbId, rowId: input.rowId, salesDocId: input.salesDocId,
        erfId: input.erfId, premiseId, rowStatus: "IN_PROGRESS",
        noAccessCount: Array.isArray(exact?.fieldWork?.noAccess) ? exact.fieldWork.noAccess.length : 0};
    }

    assertParentExecutable(parent, input.tbId);
    const rowStatus = assertRowExecutable(row, input.rowId);
    if (!sameId(row?.id || rowRef.id, input.rowId) || !sameId(row?.tbId, input.tbId)) {
      throw controlledError("TARGETED_BATCH_ROW_CORRELATION_MISMATCH", "Row correlation failed.");
    }
    const authoritativeSalesId = firstText(row?.salesAllMeterId, row?.source?.recordId);
    if (!sameId(authoritativeSalesId, input.salesDocId)) {
      throw controlledError("TARGETED_BATCH_SALES_LINK_MISMATCH", "Sales correlation failed.");
    }
    if (!sameId(row?.refs?.erfId, input.erfId)) {
      throw controlledError("TARGETED_BATCH_ERF_LINK_MISMATCH", "ERF correlation failed.");
    }
    const premiseId = normalizeText(row?.refs?.premiseId) || null;
    if (input.premiseId && input.premiseId !== premiseId) {
      throw controlledError("TARGETED_BATCH_PREMISE_LINK_MISMATCH", "Premise correlation failed.");
    }
    const salesAppend = buildSalesAppend({tbRefs: sales.tbRefs, input,
      premiseId, actorName: actor.name, now});
    transaction.create(trnRef, buildTrn({input, row, actor, premiseId, now}));
    transaction.update(salesRef, {tbRefs: salesAppend.tbRefs});
    const rowPatch = {
      "metadata.updatedAt": now,
      "metadata.updatedByUid": actor.uid,
      "metadata.updatedByUser": actor.name,
    };
    if (rowStatus === "NOT_STARTED") {
      Object.assign(rowPatch, {
        "execution.status": "IN_PROGRESS", "execution.startedAt": row?.execution?.startedAt || now,
        "execution.completedAt": null,
      });
    }
    transaction.update(rowRef, rowPatch);
    const parentStatus = normalizeUpper(parent?.execution?.status || "NOT_STARTED");
    const parentPatch = {
      "metadata.updatedAt": now,
      "metadata.updatedByUid": actor.uid,
      "metadata.updatedByUser": actor.name,
    };
    if (parentStatus === "NOT_STARTED" || rowStatus === "NOT_STARTED") {
      Object.assign(parentPatch, {
        "execution.status": "IN_PROGRESS", "execution.startedAt": parent?.execution?.startedAt || now,
        "execution.completedAt": null,
      });
      if (rowStatus === "NOT_STARTED") {
        const count = Number(parent?.counts?.executionStartedRows || 0);
        parentPatch["counts.executionStartedRows"] =
          Math.max(0, Number.isFinite(count) ? Math.trunc(count) : 0) + 1;
      }
    }
    transaction.update(parentRef, parentPatch);
    return {success: true, alreadyRecorded: false, trnId: input.trnId,
      tbId: input.tbId, rowId: input.rowId, salesDocId: input.salesDocId,
      erfId: input.erfId, premiseId, rowStatus: "IN_PROGRESS",
      noAccessCount: salesAppend.count};
  });
}

export const recordTargetedBatchNoAccessCallable = onCall(async (request) => {
  try {
    return await recordTargetedBatchNoAccess({db: getFirestore(), request});
  } catch (error) {
    logger.warn("recordTargetedBatchNoAccessCallable rejected", {
      code: error?.irepsCode || error?.code || "TARGETED_BATCH_NO_ACCESS_FAILED",
      message: error?.message,
      uid: request?.auth?.uid || null,
    });
    return {success: false,
      code: error?.irepsCode || error?.code || "TARGETED_BATCH_NO_ACCESS_FAILED",
      message: error?.message || "Targeted Batch No Access could not be recorded."};
  }
});
