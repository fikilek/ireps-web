import { onCall } from "firebase-functions/v2/https";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { SALES_BATCH_ID, exactSalesTbRef, nonblank, validDocumentId } from "../salesAllMeters/sales-batch-policy.js";
import { batchError, callableFailure, readBatchActor, snapshotReader } from "./sales-batch-resolution.js";
import { assertNoLinkedExecution, assertUnexecuted } from "./execution-evidence.js";

// Targeted Batch rules TB-R048 (1.3.33): Unallocate. An allocated batch on which no field work has
// started goes back exactly to how it stood before allocation, so it can be allocated again, to anyone.
// Only the parent, its rows and one history entry are written; Sales, the geofence, teams and service
// providers are never touched (TB-R037).
// Who: the user who allocated the batch unallocates their own work; any MNG may override when that
// person is unavailable, and the history entry records the override.

export const UNALLOCATE_ACCEPTANCE_STATES = Object.freeze(["NOT_READY", "WAITING", "ACCEPTED", "REJECTED"]);
const TARGET_TYPES = ["TEAM", "SP"];
const text = value => String(value ?? "").trim();
const upper = value => text(value).toUpperCase();

function readIntent(data = {}) {
  const tbId = text(data.tbId), expectedTargetType = upper(data.expectedTargetType), expectedTargetId = text(data.expectedTargetId);
  const reason = text(data.reason);
  if (!SALES_BATCH_ID.test(tbId)) throw batchError("INVALID_UNALLOCATE_INTENT", "A valid Targeted Batch ID is required");
  if (!TARGET_TYPES.includes(expectedTargetType) || !validDocumentId(expectedTargetId)) throw batchError("INVALID_UNALLOCATE_INTENT", "The TEAM or SP shown in TB Register is required");
  if (!nonblank(reason) || reason.length > 1000) throw batchError("UNALLOCATE_REASON_REQUIRED", "A reason of up to 1000 characters is required");
  return { tbId, expectedTargetType, expectedTargetId, reason };
}

// The same main service provider test allocation uses: the actor may take a batch back only from a
// TEAM or SP they could have allocated it to.
function actorMncId(profile = {}) {
  return text(profile.profile?.employment?.serviceProvider?.id || profile.employment?.serviceProvider?.id || profile.serviceProvider?.id);
}
async function assertTargetWithinMnc({ db, read, targetType, targetId, mncId }) {
  if (!mncId) throw batchError("ACTOR_MNC_SERVICE_PROVIDER_MISSING", "The signed-in user is not linked to a main service provider");
  if (targetType === "TEAM") {
    const team = await read(db.doc(`teams/${targetId}`));
    if (!team.exists) throw batchError("UNALLOCATE_TARGET_NOT_FOUND", `TEAM ${targetId} was not found`);
    if (text(team.data().ownership?.mncServiceProviderId) !== mncId) throw batchError("UNALLOCATE_TARGET_OUTSIDE_MNC", "This TEAM does not belong to your main service provider");
    return;
  }
  const sp = await read(db.doc(`serviceProviders/${targetId}`));
  if (!sp.exists) throw batchError("UNALLOCATE_TARGET_NOT_FOUND", `Service provider ${targetId} was not found`);
  const clients = Array.isArray(sp.data().clients) ? sp.data().clients : [];
  if (!clients.some(client => upper(client?.clientType) === "SP" && upper(client?.relationshipType) === "SUBC" && text(client?.id) === mncId)) throw batchError("UNALLOCATE_TARGET_OUTSIDE_MNC", "This service provider is not a subcontractor of your main service provider");
}

// Returns "ALLOCATOR" for one's own allocation, "MANAGER_OVERRIDE" for an MNG taking back someone
// else's, and refuses anyone else.
export function unallocationAuthority({ actor, parent }) {
  const allocatedByUid = text(parent.allocation?.allocatedByUid);
  if (allocatedByUid && allocatedByUid === actor.uid) return "ALLOCATOR";
  if (actor.role === "MNG") return "MANAGER_OVERRIDE";
  const allocator = text(parent.allocation?.allocatedByUser) || "the user who allocated it";
  throw batchError("UNALLOCATE_NOT_ALLOCATOR", `Only ${allocator} or a manager may unallocate this batch`);
}

function isAlreadyUnallocated(parent, rows) {
  return parent.status === "READY_FOR_ALLOCATION" && parent.allocation?.status === "NOT_STARTED" && !parent.allocation?.targetId && rows.every(row => row.allocation?.status === "UNALLOCATED" && !row.allocation?.targetId);
}

function assertRowsAllocatedToParentTarget({ tbId, parent, snapshots }) {
  const expected = parent.counts?.totalRows;
  if (snapshots.length < 1 || snapshots.length > 30 || snapshots.length !== expected || snapshots.length !== parent.creation?.createdRows || expected !== parent.creation?.expectedRows) throw batchError("BATCH_COUNT_MISMATCH", "Permanent row and parent counts do not reconcile");
  const slots = new Set(), meters = new Set();
  for (const snapshot of snapshots) {
    const row = snapshot.data();
    if (row.schemaVersion !== "0.3.0" || row.id !== snapshot.id || row.tbId !== tbId || !Number.isInteger(row.rowNo) || row.rowNo < 1 || slots.has(row.rowNo) || !nonblank(row.salesAllMeterId) || meters.has(row.salesAllMeterId) || row.decision?.status !== "ACCEPT" || row.allocation?.allocatable !== true) throw batchError("ROW_IDENTITY_INVALID", "Permanent row identity or decision is incomplete");
    if (row.allocation?.status !== "ALLOCATED" || row.allocation?.targetType !== parent.allocation.targetType || row.allocation?.targetId !== parent.allocation.targetId) throw batchError("UNALLOCATE_ROWS_INCONSISTENT", `Row ${row.id} is not allocated to the batch's TEAM or SP`);
    slots.add(row.rowNo); meters.add(row.salesAllMeterId);
  }
}

// This batch's own Sales reference is execution evidence once field work touches it. A meter made
// visible through another route does not block (TB-R048).
async function assertSalesReferencesUntouched({ db, read, tbId, rows }) {
  for (const row of rows) {
    const sales = await read(db.doc(`sales-all-meters/${row.salesAllMeterId}`));
    if (!sales.exists) throw batchError("SALES_MISSING", `Sales ${row.salesAllMeterId} is unavailable`);
    const exact = exactSalesTbRef(sales.data(), tbId);
    if (!exact.ok) throw batchError("SALES_REFERENCE_INVALID", `Sales ${row.salesAllMeterId} has no single valid reference to this batch; field work cannot be proven absent`);
    if (exact.reference.fieldWork || exact.reference.rowId) throw batchError("EXECUTION_STARTED", `Field work on ${row.id} permanently blocks unallocation`);
  }
}

export function buildUnallocationParentPatch({ rowCount, actor, at }) {
  const gone = FieldValue.delete();
  return {
    status: "READY_FOR_ALLOCATION",
    "allocation.status": "NOT_STARTED",
    "allocation.completedAt": null,
    "allocation.targetType": gone, "allocation.targetId": gone, "allocation.targetName": gone, "allocation.memberCount": gone,
    "allocation.startedAt": gone, "allocation.failureCode": gone, "allocation.failureMessage": gone, "allocation.failedAt": gone,
    "allocation.allocatedByUid": gone, "allocation.allocatedByUser": gone,
    "acceptance.status": "NOT_READY",
    "acceptance.acceptedAt": null, "acceptance.acceptedByUid": null, "acceptance.acceptedByUser": null,
    "acceptance.rejectedAt": null, "acceptance.rejectedByUid": null, "acceptance.rejectedByUser": null,
    "acceptance.rejectReason": "",
    "counts.allocatedRows": 0,
    "counts.unallocatedRows": rowCount,
    "metadata.updatedAt": at, "metadata.updatedByUid": actor.uid, "metadata.updatedByUser": actor.user,
  };
}

export function buildUnallocationRowPatch({ actor, at }) {
  return {
    "allocation.status": "UNALLOCATED",
    "allocation.targetType": null, "allocation.targetId": null, "allocation.targetName": null,
    "allocation.allocatedAt": null, "allocation.allocatedByUid": null, "allocation.allocatedByUser": null,
    "metadata.updatedAt": at, "metadata.updatedByUid": actor.uid, "metadata.updatedByUser": actor.user,
  };
}

export async function unallocateSalesBatch({ db, request, now = () => Timestamp.now() }) {
  const intent = readIntent(request?.data);
  if (!validDocumentId(request?.auth?.uid)) throw batchError("UNAUTHENTICATED", "Sign in to unallocate a Targeted Batch");
  const parentRef = db.doc(`tb_uploads/${intent.tbId}`);

  return db.runTransaction(async tx => {
    const read = snapshotReader(tx);
    const snapshot = await read(parentRef);
    if (!snapshot.exists) throw batchError("TARGETED_BATCH_NOT_FOUND", `Targeted Batch ${intent.tbId} was not found`);
    const parent = snapshot.data();
    if (parent.id !== intent.tbId) throw batchError("PARENT_IDENTITY_CONFLICT", "Batch identity does not match");
    const actor = await readBatchActor({ db, request, lmPcode: parent.scope?.lmPcode, read });
    const rowsSnapshot = await read(db.collection("tb_rows").where("tbId", "==", intent.tbId).limit(31));
    const rows = rowsSnapshot.docs.map(row => row.data());

    // A repeat after a lost response: nothing to do, nothing written.
    if (isAlreadyUnallocated(parent, rows)) return { success: true, code: "TARGETED_BATCH_ALREADY_UNALLOCATED", tbId: intent.tbId, rows: rows.length };

    if (parent.schemaVersion !== "0.3.0") throw batchError("UNALLOCATE_LEGACY_BATCH", "Only batches of the current format can be unallocated; this older batch cannot");
    if (parent.creation?.state !== "READY") throw batchError("TARGETED_BATCH_NOT_READY", "The batch was never completely created");
    assertUnexecuted(parent, rows, "unallocation");
    if (parent.status !== "ALLOCATED" || parent.allocation?.status !== "ALLOCATED" || !TARGET_TYPES.includes(parent.allocation?.targetType) || !validDocumentId(parent.allocation?.targetId)) throw batchError("UNALLOCATE_STATE_INVALID", "The batch is not in a settled allocated state");
    if (parent.allocation.targetType !== intent.expectedTargetType || parent.allocation.targetId !== intent.expectedTargetId) throw batchError("UNALLOCATE_TARGET_CHANGED", "The batch is now allocated to a different TEAM or SP; refresh TB Register");
    if (!UNALLOCATE_ACCEPTANCE_STATES.includes(parent.acceptance?.status)) throw batchError("UNALLOCATE_ACCEPTANCE_INVALID", "The batch acceptance state is not recognised");
    const authority = unallocationAuthority({ actor, parent });
    await assertTargetWithinMnc({ db, read, targetType: parent.allocation.targetType, targetId: parent.allocation.targetId, mncId: actorMncId(actor.profile) });
    assertRowsAllocatedToParentTarget({ tbId: intent.tbId, parent, snapshots: rowsSnapshot.docs });
    for (const row of rows) await assertNoLinkedExecution({ db, read, parent, row, action: "unallocation" });
    await assertSalesReferencesUntouched({ db, read, tbId: intent.tbId, rows });

    const at = now();
    for (const row of rowsSnapshot.docs) tx.update(row.ref, buildUnallocationRowPatch({ actor, at }));
    tx.update(parentRef, buildUnallocationParentPatch({ rowCount: rows.length, actor, at }));
    tx.create(parentRef.collection("history").doc(), {
      event: "TARGETED_BATCH_UNALLOCATED",
      tbId: intent.tbId,
      reason: intent.reason,
      previousAllocation: parent.allocation,
      previousAcceptance: parent.acceptance ?? null,
      rowCount: rows.length,
      authority,
      override: authority === "MANAGER_OVERRIDE",
      note: `Targeted Batch unallocated from ${parent.allocation.targetType} ${parent.allocation.targetName || parent.allocation.targetId} before field work started${authority === "MANAGER_OVERRIDE" ? ` (manager override of ${parent.allocation.allocatedByUser || "the allocator"})` : ""}: ${intent.reason}`,
      actor: { uid: actor.uid, name: actor.user, role: actor.role },
      metadata: { createdAt: at, createdByUid: actor.uid, createdByUser: actor.user, updatedAt: at, updatedByUid: actor.uid, updatedByUser: actor.user },
    });
    return {
      success: true,
      code: "TARGETED_BATCH_UNALLOCATED",
      tbId: intent.tbId,
      rows: rows.length,
      previousTarget: { type: parent.allocation.targetType, id: parent.allocation.targetId, name: parent.allocation.targetName || null },
      previousAcceptance: parent.acceptance?.status || null,
      authority,
    };
  });
}

export const onUnallocateTargetedBatchCallable = onCall(async request => {
  try { return await unallocateSalesBatch({ db: getFirestore(), request }); } catch (error) { return callableFailure(error); }
});
