import { onCall } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { SALES_BATCH_ID, SALES_ID, timestampMillis, validDocumentId } from "../salesAllMeters/sales-batch-policy.js";
import { batchError, readBatchActor, snapshotReader, salesMetadataUpdate, callableFailure } from "./sales-batch-resolution.js";
import { buildSalesBatchHistory, inspectSalesRemoval } from "./sales-batch-history.js";
import { assertMutationSizes } from "./sales-batch-creation.js";
import { assertNoLinkedExecution, assertUnexecuted } from "./execution-evidence.js";
import { readRowsTakenOut } from "./rowFollowsSales.js";

async function prepareUnlinks({ db, read, parent, snapshots, actor, at, reason }) {
  const plans = [], ids = new Set();
  for (const snapshot of snapshots) {
    const row = snapshot.data(), salesId = row.salesAllMeterId || row.source?.recordId || row.meter?.salesAllMeterId;
    if (!SALES_ID.test(salesId || "") || ids.has(salesId) || row.tbId !== parent.id || row.id !== snapshot.id) throw batchError("ROW_IDENTITY_INVALID", "Permanent row and Sales identities must be unique and consistent");
    ids.add(salesId);
    const salesRef = db.doc(`sales-all-meters/${salesId}`), salesSnapshot = await read(salesRef);
    if (!salesSnapshot.exists) throw batchError("SALES_MISSING", `Sales ${salesId} is unavailable`);
    const sales = salesSnapshot.data(), removal = inspectSalesRemoval(sales, parent.id);
    if (timestampMillis(removal.exact.reference.date) !== timestampMillis(parent.metadata?.createdAt)) throw batchError("REFERENCE_DATE_CONFLICT", "The exact batch creation reference must match the parent timestamp");
    // Fresh rows have no execution refs. Legacy links must be inspected, never cleared blindly.
    await assertNoLinkedExecution({ db, read, parent, row });
    const historyRef = db.doc(`sales-all-meters/${salesId}/batchHistory/${parent.id}__REMOVED_FROM_BATCH`);
    if ((await read(historyRef)).exists) throw batchError("REMOVAL_HISTORY_CONFLICT", "Immutable removal history already exists for a retained row");
    const history = buildSalesBatchHistory({ type: "REMOVED_FROM_BATCH", tbId: parent.id, rowId: row.id, salesId, geofenceId: parent.geofenceId ?? null, erfId: row.refs?.erfId ?? null, membershipSource: removal.membership.source, actor, at, revision: sales.erfResolution?.revision ?? null, reason, removalAudit: { parentStatus: parent.status, rowExecutionStatus: row.execution?.status || "NOT_STARTED", salesMeterStatus: "NOT_STARTED", parentAllocation: parent.allocation, parentAcceptance: parent.acceptance ?? null, rowAllocation: row.allocation, removedTbRef: { id: parent.id, date: removal.exact.reference.date } } });
    const patch = { targetedBatchId: null, tbRefs: removal.remainingRefs, ...salesMetadataUpdate(sales, actor, at) };
    plans.push({ rowRef: snapshot.ref, historyRef, history, salesRef, patch });
  }
  assertMutationSizes(plans.flatMap(plan => [plan.history, plan.patch]));
  return plans;
}
function applyUnlinks(tx, plans) {
  for (const plan of plans) { tx.update(plan.salesRef, plan.patch); tx.create(plan.historyRef, plan.history); tx.delete(plan.rowRef); }
}
export async function deleteSalesBatch({ db, request, now = () => Timestamp.now() }) {
  const tbId = request.data?.tbId, reason = String(request.data?.reason || "Approved pre-execution batch removal").trim();
  if (!SALES_BATCH_ID.test(tbId || "") || !reason || reason.length > 1000) throw batchError("INVALID_DELETE_INTENT", "A valid batch identity and removal reason are required");
  if (!validDocumentId(request.auth?.uid)) throw batchError("UNAUTHENTICATED", "Sign in to remove a Targeted Batch");
  const parentRef = db.doc(`tb_uploads/${tbId}`);
  const initial = await parentRef.get();
  if (!initial.exists) return { success: true, code: "TARGETED_BATCH_ALREADY_REMOVED", tbId, deletedRows: 0 };
  const initialParent = initial.data(), modern = initialParent.schemaVersion === "0.3.0";
  let deletedRows = 0;
  // New bounded batches use exactly one transaction. Historical larger batches keep
  // bounded guarded chunks; an execution race stops the remaining historical cleanup.
  for (;;) {
    const result = await db.runTransaction(async tx => {
      const read = snapshotReader(tx), snapshot = await read(parentRef);
      if (!snapshot.exists) return { finished: true, count: 0 };
      const parent = snapshot.data();
      if (parent.id !== tbId || parent.schemaVersion !== initialParent.schemaVersion) throw batchError("PARENT_IDENTITY_CONFLICT", "Batch identity changed during removal");
      const actor = await readBatchActor({ db, request, lmPcode: parent.scope?.lmPcode, read });
      const rows = await read(db.collection("tb_rows").where("tbId", "==", tbId).limit(modern ? 31 : 1001));
      if (rows.docs.length > (modern ? 30 : 1000)) throw batchError("DELETE_SCOPE_TOO_LARGE", "The batch exceeds the governed deletion bounds");
      // Rules TB-R056 option A (1.3.52): a batch with a geofence counts its rows as created minus the rows TB-R053 or TB-R056
      // took out, read live from its own history.
      const rowsTakenOut = modern ? await readRowsTakenOut({ db, read, tbId }) : 0;
      if (modern && (rows.docs.length !== parent.counts?.totalRows || rows.docs.length !== parent.creation?.createdRows - rowsTakenOut)) throw batchError("BATCH_COUNT_MISMATCH", "Permanent row and parent counts do not reconcile");
      assertUnexecuted(parent, rows.docs.map(row => row.data()));
      if (modern) {
        if (!validDocumentId(parent.geofenceId)) throw batchError("FENCE_LINKAGE_INVALID", "The canonical geofence identity is missing");
        const fenceSnapshot = await read(db.doc(`geo_fences/${parent.geofenceId}`)), fence = fenceSnapshot.exists ? fenceSnapshot.data() : null;
        if (!fence || fence.targetedBatch?.tbId !== tbId || fence.targetedBatch?.linkState !== "LINKED" || fence.status !== "ACTIVE") throw batchError("FENCE_LINKAGE_INVALID", "The batch geofence is missing or inconsistent");
      }
      const chunk = modern ? rows.docs : rows.docs.slice(0, 30), at = now();
      const plans = await prepareUnlinks({ db, read, parent, snapshots: chunk, actor, at, reason });
      const finished = chunk.length === rows.docs.length;
      if (finished) {
        // Orphans are evidence for review, never an invitation to erase linkage.
        const scalarMembers = await read(db.collection("sales-all-meters").where("targetedBatchId", "==", tbId).limit(1001));
        const exactRefs = await read(db.collection("sales-all-meters").where("tbRefs", "array-contains", { id: tbId, date: parent.metadata.createdAt }).limit(1001));
        const legacyRefs = await read(db.collection("sales-all-meters").where("tbRefs", "array-contains", { tbId, date: parent.metadata.createdAt }).limit(1001));
        const planned = new Set(plans.map(plan => plan.salesRef.path));
        if ([...scalarMembers.docs, ...exactRefs.docs, ...legacyRefs.docs].some(doc => !planned.has(doc.ref.path))) throw batchError("ORPHAN_LINKAGE_REQUIRES_REVIEW", "Sales linkage exists without a matching removable row; no blind cleanup is allowed");
      }
      applyUnlinks(tx, plans);
      if (finished) tx.delete(parentRef);
      else tx.update(parentRef, { "metadata.updatedAt": at, "metadata.updatedByUid": actor.uid, "metadata.updatedByUser": actor.user });
      return { finished, count: plans.length };
    });
    deletedRows += result.count;
    if (result.finished) return { success: true, code: "TARGETED_BATCH_DELETED", tbId, deletedRows, retainedHistory: true, retainedFence: Boolean(initialParent.geofenceId) };
  }
}
export const onDeleteTargetedBatchCallable = onCall({ timeoutSeconds: 540, memory: "1GiB" }, async request => {
  try { return await deleteSalesBatch({ db: getFirestore(), request }); } catch (error) { return callableFailure(error); }
});
