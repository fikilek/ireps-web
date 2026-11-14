import { mncIdFor, readMdAllocationTarget } from "./mdAllocationPolicy.js";
import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { buildBmdBgoBatchHistoryDoc, buildBmdBgoNotificationRecord } from "./trnFactory.js";
import { BGO_COLLECTIONS, buildFailureResult, buildSuccessResult } from "./helpers.js";
import { getActorNameFromRequest, resolveTargetedBatchCreateAuthority } from "../targetedBatches/helpers.js";

const MAX_BATCHES = 15;
const text = value => String(value ?? "").trim();
const upper = value => text(value).toUpperCase();
const fail = (code, message, details = {}) => Object.assign(new Error(message), { code, details });

export const onAllocateMdBgoBatchesTogetherCallable = onCall({ memory: "512MiB", timeoutSeconds: 120 }, async request => {
  const db = getFirestore();
  const actorUid = request?.auth?.uid || "";
  const input = request?.data || {};
  const batchIds = Array.isArray(input.bgoBatchIds) ? input.bgoBatchIds.map(text) : [];
  try {
    if (!actorUid) return buildFailureResult("UNAUTHENTICATED", "Authentication is required to allocate MD BGO batches.");
    const authority = await resolveTargetedBatchCreateAuthority({ db, request });
    if (!authority.ok) return buildFailureResult("UNAUTHORIZED_MD_BGO_ALLOCATION", "Only MNG and SPV(MNC) users may allocate MD BGO batches.");
    const actorMncId = mncIdFor(request, authority);
    if (!actorMncId || actorMncId === "UNKNOWN") return buildFailureResult("ACTOR_MNC_SERVICE_PROVIDER_MISSING", "The signed-in user is not linked to an MNC Service Provider ID.");
    if (!batchIds.length || batchIds.length > MAX_BATCHES) return buildFailureResult("INVALID_MD_BGO_ALLOCATION_SIZE", `Select between 1 and ${MAX_BATCHES} batches.`);
    if (new Set(batchIds).size !== batchIds.length || batchIds.some(id => !id)) return buildFailureResult("INVALID_MD_BGO_BATCH_IDS", "The selection contains an empty or duplicate batch ID.");
    const targetType = upper(input.targetType), targetId = text(input.targetId);
    if (!["TEAM", "SP"].includes(targetType)) return buildFailureResult("INVALID_ALLOCATION_TARGET_TYPE", "targetType must be TEAM or SP.");
    if (!targetId) return buildFailureResult("ALLOCATION_TARGET_ID_REQUIRED", "targetId is required.");

    const batchRefs = batchIds.map(id => db.collection(BGO_COLLECTIONS.batches).doc(id));
    const historyRefs = batchRefs.map(ref => ref.collection("history").doc());
    const notificationRefs = batchIds.map(() => db.collection(BGO_COLLECTIONS.notifications).doc());
    const actorName = getActorNameFromRequest(request, authority.profile);
    const issuedAt = Timestamp.now();

    const result = await db.runTransaction(async transaction => {
      const target = await readMdAllocationTarget({ db, transaction, targetType, targetId, actorMncId });
      const snapshots = await Promise.all(batchRefs.map(ref => transaction.get(ref)));
      for (let index = 0; index < snapshots.length; index += 1) {
        const snapshot = snapshots[index];
        if (!snapshot.exists) throw fail("MD_BGO_BATCH_NOT_FOUND", `MD BGO batch ${batchIds[index]} was not found.`, { bgoBatchId: batchIds[index] });
        const data = snapshot.data() || {};
        if (upper(data.batchMode || data.bgo?.batchMode) !== "BMD" || upper(data.operationType || data.trnType) !== "METER_DISCOVERY") throw fail("NOT_MD_BGO_BATCH", `${batchIds[index]} is not an MD BGO batch.`, { bgoBatchId: batchIds[index] });
        if (upper(data.workflow?.state) !== "READY_FOR_ALLOCATION") throw fail("MD_BGO_BATCH_NOT_READY", `${batchIds[index]} is not Ready for Allocation.`, { bgoBatchId: batchIds[index] });
        if (data.bgo?.targetId || (Array.isArray(data.assignment?.targets) && data.assignment.targets.length)) throw fail("MD_BGO_BATCH_ALREADY_ISSUED", `${batchIds[index]} already has an allocation.`, { bgoBatchId: batchIds[index] });
      }
      snapshots.forEach((snapshot, index) => {
        const data = snapshot.data() || {};
        const geofenceRef = data.geofenceRef || { id: text(data.geofenceId), name: text(data.geofenceName) };
        const summary = data.summary || {};
        transaction.update(batchRefs[index], {
          "assignment.targets": [target],
          "bgo.targetType": targetType, "bgo.targetId": targetId, "bgo.targetName": target.name, "bgo.releaseState": "WAITING_BATCH_ACCEPTANCE",
          "bgo.issuedByUid": actorUid, "bgo.issuedByUser": actorName,
          "workflow.state": "ISSUED", "workflow.issuedAt": issuedAt, "workflow.issuedByUid": actorUid, "workflow.issuedByUser": actorName,
          "metadata.updatedAt": issuedAt, "metadata.updatedByUid": actorUid, "metadata.updatedByUser": actorName,
        });
        transaction.set(historyRefs[index], buildBmdBgoBatchHistoryDoc({ bgoBatchId: batchIds[index], geofenceRef, target, summary, actorUid, actorName, now: issuedAt }));
        transaction.set(notificationRefs[index], buildBmdBgoNotificationRecord({ bgoBatchId: batchIds[index], target, geofenceRef, summary, actorUid, actorName, now: issuedAt }));
      });
      return { target, batchIds };
    });
    logger.info("onAllocateMdBgoBatchesTogetherCallable -- COMPLETED", { batchIds, targetType, targetId, actorUid });
    return buildSuccessResult(`${batchIds.length} MD BGO batch(es) issued to ${result.target.name}.`, { code: "MD_BGO_BATCHES_ISSUED", bgoBatchIds: batchIds, issuedBgoBatchIds: batchIds, target: result.target, issuedAt: issuedAt.toDate().toISOString() });
  } catch (error) {
    const code = text(error?.code) || "MD_BGO_ALLOCATION_FAILED";
    const message = text(error?.message) || "MD BGO allocation failed.";
    logger.error("onAllocateMdBgoBatchesTogetherCallable -- FAILED", { batchIds, code, message, details: error?.details || null });
    return buildFailureResult(code, message, { bgoBatchId: error?.details?.bgoBatchId || null, details: error?.details || null });
  }
});
