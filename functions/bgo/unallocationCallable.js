import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { buildFailureResult, buildSuccessResult } from "./helpers.js";
import { getActorNameFromRequest, resolveTargetedBatchCreateAuthority } from "../targetedBatches/helpers.js";

const text = value => String(value ?? "").trim();
const upper = value => text(value).toUpperCase();
const fail = (code, message) => Object.assign(new Error(message), { code });
const LINK_FIELDS = ["bgo.batchId", "bgo.bgoBatchId", "refs.bgoBatchId", "refs.batchId", "origin.bgoBatchId", "origin.targetedBatch.batchId", "bucket.batchId", "bmd.batchId", "bmd.bgoBatchId"];

function millis(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mncIdFor(request, authority) {
  const token = request?.auth?.token || {};
  const profile = authority?.profile || {};
  return text(token.serviceProviderId || token.employmentServiceProviderId || token.mncServiceProviderId || profile.profile?.employment?.serviceProvider?.id || profile.employment?.serviceProvider?.id || profile.serviceProvider?.id || authority?.serviceProviderId);
}

function targetWithinMnc(data, type, mncId) {
  if (type === "TEAM") return text(data?.ownership?.mncServiceProviderId) === mncId;
  return Array.isArray(data?.clients) && data.clients.some(client => upper(client?.clientType) === "SP" && upper(client?.relationshipType) === "SUBC" && text(client?.id) === mncId);
}

async function linkedDocs(tx, db, collectionName, batchId) {
  const snapshots = await Promise.all(LINK_FIELDS.map(field => tx.get(db.collection(collectionName).where(field, "==", batchId).limit(1000))));
  const docs = new Map();
  snapshots.forEach(snapshot => snapshot.docs.forEach(doc => docs.set(doc.ref.path, doc)));
  return [...docs.values()];
}

function rowHasExecution(row = {}) {
  const state = upper(row.workflow?.state || row.workflowState);
  return Boolean(row.refs?.premiseId || row.premise?.id || row.refs?.trnId || row.refs?.astId || row.refs?.meterId || row.trnId || row.ast?.id || row.meter?.id || ["IN_PROGRESS", "COMPLETED"].includes(state) || upper(row.bgo?.releaseState || row.releaseState) === "RELEASED_TO_EXECUTION");
}

export async function unallocateMdBgoBatch({ db, request, now = () => Timestamp.now() }) {
  const input = request?.data || {};
  const batchId = text(input.bgoBatchId);
  const expectedTargetType = upper(input.expectedTargetType);
  const expectedTargetId = text(input.expectedTargetId);
  const expectedIssuedAtMillis = input.expectedIssuedAtMillis;
  const requestId = text(input.requestId);
  const reason = text(input.reason);
  const actorUid = text(request?.auth?.uid);
  if (!actorUid) throw fail("UNAUTHENTICATED", "Sign in to unallocate an MD BGO batch.");
  if (!batchId || !["TEAM", "SP"].includes(expectedTargetType) || !expectedTargetId || !Number.isFinite(expectedIssuedAtMillis) || !requestId) throw fail("INVALID_MD_BGO_UNALLOCATION", "Refresh the MD BGO Register and open Unallocate again.");
  if (!reason || reason.length > 1000) throw fail("MD_BGO_UNALLOCATION_REASON_REQUIRED", "Enter a reason of up to 1000 characters.");
  const authority = await resolveTargetedBatchCreateAuthority({ db, request });
  if (!authority.ok) throw fail("UNAUTHORIZED_MD_BGO_UNALLOCATION", "Only the allocator or an authorized MNG may unallocate this batch.");
  const actorMncId = mncIdFor(request, authority);
  if (!actorMncId || actorMncId === "UNKNOWN") throw fail("ACTOR_MNC_SERVICE_PROVIDER_MISSING", "The signed-in user is not linked to an MNC Service Provider ID.");
  const actorName = getActorNameFromRequest(request, authority.profile);
  const parentRef = db.collection("bgo_batches").doc(batchId);

  return db.runTransaction(async tx => {
    const parentSnap = await tx.get(parentRef);
    if (!parentSnap.exists) throw fail("MD_BGO_BATCH_NOT_FOUND", "The selected MD BGO batch was not found.");
    const parent = parentSnap.data() || {};
    if (parent.bgo?.lastUnallocationRequestId === requestId && upper(parent.workflow?.state) === "READY_FOR_ALLOCATION" && !parent.bgo?.targetId) return { idempotent: true, rowCount: Number(parent.summary?.erfCount || 0) };
    if (upper(parent.batchMode || parent.bgo?.batchMode) !== "BMD" || upper(parent.operationType || parent.trnType) !== "METER_DISCOVERY") throw fail("NOT_MD_BGO_BATCH", "The selected record is not an MD BGO batch.");
    const state = upper(parent.workflow?.state);
    if (!["ISSUED", "ACCEPTED", "REJECTED"].includes(state)) throw fail("MD_BGO_UNALLOCATION_STATE_INVALID", "This MD BGO batch is not in an unallocatable state.");
    const target = parent.assignment?.targets?.[0] || {};
    const targetType = upper(parent.bgo?.targetType || target.type);
    const targetId = text(parent.bgo?.targetId || target.id);
    const issuedAtMillis = millis(parent.workflow?.issuedAt);
    if (targetType !== expectedTargetType || targetId !== expectedTargetId || issuedAtMillis !== expectedIssuedAtMillis) throw fail("MD_BGO_ALLOCATION_CHANGED", "The allocation changed after you opened this confirmation. Refresh the register and try again.");
    const targetRef = db.collection(targetType === "TEAM" ? "teams" : "serviceProviders").doc(targetId);
    const rowsQueryA = db.collection("bgo_rows").where("bgoBatchId", "==", batchId).limit(1000);
    const rowsQueryB = db.collection("bgo_rows").where("batchId", "==", batchId).limit(1000);
    const notificationsQuery = db.collection("notifications").where("bgo.batchId", "==", batchId).limit(1000);
    const historyQuery = parentRef.collection("history").where("event", "==", "ISSUED").limit(1000);
    const [targetSnap, rowsA, rowsB, trns, premises, asts, notifications, issuedHistory] = await Promise.all([
      tx.get(targetRef), tx.get(rowsQueryA), tx.get(rowsQueryB), linkedDocs(tx, db, "trns", batchId), linkedDocs(tx, db, "premises", batchId), linkedDocs(tx, db, "asts", batchId), tx.get(notificationsQuery), tx.get(historyQuery),
    ]);
    if (!targetSnap.exists || !targetWithinMnc(targetSnap.data() || {}, targetType, actorMncId)) throw fail("UNALLOCATE_TARGET_OUTSIDE_MNC", "The allocation target is missing or outside your MNC scope.");
    const rowMap = new Map();
    [...rowsA.docs, ...rowsB.docs].forEach(doc => rowMap.set(doc.ref.path, doc));
    const rows = [...rowMap.values()];
    const expectedRows = Number(parent.summary?.erfCount || parent.summary?.totalRows || 0);
    if (!rows.length || rows.length > 450 || rows.length !== expectedRows) throw fail("MD_BGO_ROWS_UNAVAILABLE", "The batch ERF rows cannot be reconciled safely; no changes were made.");
    const evidence = rows.some(doc => rowHasExecution(doc.data() || {})) || trns.length > 0 || premises.length > 0 || asts.length > 0;
    if (evidence) throw fail("MD_BGO_FIELD_WORK_STARTED", "This batch cannot be unallocated because premise, meter, No Access, or other field work has started.");
    const issuer = parent.bgo?.issuedByUid || issuedHistory.docs
      .map(doc => doc.data())
      .filter(event => text(event.actor?.uid) && text(event.target?.id) === targetId && upper(event.target?.type) === targetType)
      .sort((left, right) => (millis(right.metadata?.createdAt) || 0) - (millis(left.metadata?.createdAt) || 0))[0]?.actor?.uid || parent.workflow?.issuedByUid;
    if (authority.role !== "MNG" && issuer !== actorUid) throw fail("MD_BGO_UNALLOCATION_NOT_ALLOCATOR", "Only the user who allocated this batch or an authorized MNG may unallocate it.");

    const at = now();
    const override = authority.role === "MNG" && issuer !== actorUid;
    tx.update(parentRef, {
      "assignment.targets": [],
      "assignment.acceptedRejectedAt": null, "assignment.acceptedRejectedUid": null, "assignment.acceptedRejectedUser": null, "assignment.rejectReason": "",
      "workflow.state": "READY_FOR_ALLOCATION", "workflow.issuedAt": null, "workflow.issuedByUid": null, "workflow.issuedByUser": null,
      "workflow.acceptedAt": null, "workflow.acceptedByUid": null, "workflow.acceptedByUser": null,
      "workflow.rejectedAt": null, "workflow.rejectedByUid": null, "workflow.rejectedByUser": null, "workflow.rejectReason": "",
      "bgo.targetType": FieldValue.delete(), "bgo.targetId": FieldValue.delete(), "bgo.targetName": FieldValue.delete(), "bgo.releaseState": "WAITING_BATCH_ACCEPTANCE",
      "bgo.acceptanceMode": FieldValue.delete(), "bgo.acceptedAt": null, "bgo.acceptedByUid": null, "bgo.acceptedByUser": null,
      "bgo.rejectedAt": null, "bgo.rejectedByUid": null, "bgo.rejectedByUser": null, "bgo.rejectReason": "",
      "bgo.issuedByUid": FieldValue.delete(), "bgo.issuedByUser": FieldValue.delete(), "bgo.lastUnallocationRequestId": requestId,
      "batchReleaseSummary.totalWaitingBatchAcceptance": Number(parent.summary?.erfCount || 0),
      "batchReleaseSummary.totalReleased": 0, "batchReleaseSummary.totalAcceptedForExecution": 0, "batchReleaseSummary.totalRejectedAtBatch": 0,
      "metadata.updatedAt": at, "metadata.updatedByUid": actorUid, "metadata.updatedByUser": actorName,
    });
    const rowsCount = rows.length;
    tx.create(parentRef.collection("history").doc(), {
      event: "MD_BGO_BATCH_UNALLOCATED", workflowState: "READY_FOR_ALLOCATION", bgoBatchId: batchId,
      reason, previousTarget: { type: targetType, id: targetId, name: text(target.name || parent.bgo?.targetName) || targetId },
      previousWorkflowState: state, allocatorUid: issuer || null, rowCount: rowsCount, authority: override ? "MANAGER_OVERRIDE" : "ALLOCATOR", override,
      actor: { uid: actorUid, name: actorName, role: authority.role },
      metadata: { createdAt: at, createdByUid: actorUid, createdByUser: actorName, updatedAt: at, updatedByUid: actorUid, updatedByUser: actorName },
    });
    notifications.docs.forEach(doc => {
      const data = doc.data() || {};
      if (data.type === "BMD_BGO_BATCH_ISSUED" && upper(data.delivery?.status) !== "DELIVERED" && !data.delivery?.deliveredAt) tx.update(doc.ref, { "delivery.status": "CANCELLED", "delivery.cancelledAt": at, "delivery.cancelledByUid": actorUid, "delivery.cancelReason": "MD BGO batch unallocated" });
    });
    return { rowCount: rowsCount, previousState: state, previousTarget: { type: targetType, id: targetId, name: target.name || parent.bgo?.targetName || targetId }, override };
  });
}

export const onUnallocateMdBgoBatchCallable = onCall({ memory: "512MiB", timeoutSeconds: 120 }, async request => {
  try {
    const result = await unallocateMdBgoBatch({ db: getFirestore(), request });
    return buildSuccessResult(result.idempotent ? "MD BGO batch is already unallocated." : "MD BGO batch unallocated and ready for allocation.", { code: result.idempotent ? "MD_BGO_BATCH_ALREADY_UNALLOCATED" : "MD_BGO_BATCH_UNALLOCATED", ...result });
  } catch (error) {
    const code = text(error?.code) || "MD_BGO_UNALLOCATION_FAILED";
    const message = text(error?.message) || "Could not unallocate this MD BGO batch.";
    logger.error("onUnallocateMdBgoBatchCallable -- FAILED", { batchId: text(request?.data?.bgoBatchId), code, message });
    return buildFailureResult(code, message);
  }
});
