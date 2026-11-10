import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onAllocateMdBgoBatchesTogetherCallable } from "../bgo/allocationCallable.js";
import { onUnallocateMdBgoBatchCallable } from "../bgo/unallocationCallable.js";

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^(127\.0\.0\.1|localhost):[0-9]+$/.test(host || "")) throw new Error("Firestore emulator unavailable: explicitly set a localhost FIRESTORE_EMULATOR_HOST; real projects are prohibited");
const projectId = "demo-md-bgo-allocation";
const app = initializeApp({ projectId });
const db = getFirestore(app);
const uid = "md-bgo-allocator";
const ids = ["MD_BGO_20261109_100001_ZA5241006_MDIS", "MD_BGO_20261109_100002_ZA5241006_MDIS"];
const target = { type: "TEAM", id: "TEAM_MNC1", name: "MNC One Team" };
const request = bgoBatchIds => ({ auth: { uid, token: { role: "MNG", serviceProviderId: "MNC1", name: "MNG Test" } }, data: { bgoBatchIds, targetType: target.type, targetId: target.id } });

before(async () => {
  await db.doc(`users/${uid}`).set({ id: uid, role: "MNG", employment: { serviceProvider: { id: "MNC1", relationshipType: "MNC" } } });
});
beforeEach(async () => {
  await Promise.all(ids.map(async id => {
    await db.doc(`bgo_batches/${id}`).delete();
    const history = await db.collection(`bgo_batches/${id}/history`).get();
    await Promise.all(history.docs.map(doc => doc.ref.delete()));
  }));
  const notifications = await db.collection("notifications").where("type", "==", "BMD_BGO_BATCH_ISSUED").get();
  await Promise.all(notifications.docs.map(doc => doc.ref.delete()));
  await db.doc(`teams/${target.id}`).set({ status: "ACTIVE", name: target.name, ownership: { mncServiceProviderId: "MNC1" } });
  await Promise.all(ids.map(async (id, index) => {
    await db.doc(`bgo_batches/${id}`).set({
    id, batchMode: "BMD", operationType: "METER_DISCOVERY", trnType: "BULK_GEOFENCE_ORIGIN",
    scope: { lmPcode: "ZA524", wardPcode: "ZA5241006" }, geofenceRef: { id: `GF${index}`, name: `Gf W6 ${index}` },
    worklist: { type: "ERF_LIST", erfRefs: [{ id: `ERF${index}`, erfNo: String(index) }] }, summary: { erfCount: 1, premiseCount: 0, meterCount: 0 },
    workflow: { state: "READY_FOR_ALLOCATION" }, assignment: { targets: [] }, bgo: { batchMode: "BMD", releaseState: "WAITING_BATCH_ACCEPTANCE" },
    metadata: { createdAt: new Date(), createdByUid: "seed" },
    });
    await db.doc(`bgo_rows/${id}_ROW_1`).set({ id: `${id}_ROW_1`, bgoBatchId: id, batchMode: "BMD", operationType: "METER_DISCOVERY", workflow: { state: "READY_FOR_ALLOCATION" } });
  }));
});
after(async () => { await db.terminate(); await deleteApp(app); });

test("issues all selected MD BGO batches atomically and writes parent history and notifications", async () => {
  const result = await onAllocateMdBgoBatchesTogetherCallable.run(request(ids));
  assert.equal(result.success, true, result.message);
  assert.deepEqual(result.issuedBgoBatchIds, ids);
  for (const id of ids) {
    const batch = (await db.doc(`bgo_batches/${id}`).get()).data();
    assert.equal(batch.workflow.state, "ISSUED");
    assert.deepEqual(batch.assignment.targets, [result.target]);
    assert.equal(batch.bgo.targetId, target.id);
    assert.equal(batch.bgo.issuedByUid, uid);
    assert.equal((await db.doc(`bgo_rows/${id}_ROW_1`).get()).data().workflow.state, "READY_FOR_ALLOCATION", "allocation keeps the existing ERF row lifecycle intact");
    const history = await db.collection(`bgo_batches/${id}/history`).get();
    assert.equal(history.size, 1);
    assert.equal(history.docs[0].data().event, "ISSUED");
  }
  assert.equal((await db.collection("notifications").where("type", "==", "BMD_BGO_BATCH_ISSUED").get()).size, 2);
});

test("unallocates an accepted batch without field work, preserves ERF rows, and cancels pending issue notification", async () => {
  const issued = await onAllocateMdBgoBatchesTogetherCallable.run(request([ids[0]]));
  assert.equal(issued.success, true, issued.message);
  const before = (await db.doc(`bgo_batches/${ids[0]}`).get()).data();
  await db.doc(`bgo_batches/${ids[0]}`).update({ "workflow.state": "ACCEPTED", "bgo.releaseState": "RELEASED_TO_EXECUTION" });
  const unallocateRequest = {
    auth: request([]).auth,
    data: {
      bgoBatchId: ids[0], expectedTargetType: target.type, expectedTargetId: target.id,
      expectedIssuedAtMillis: before.workflow.issuedAt.toMillis(), requestId: "unalloc-request-1", reason: "Reassigning workload",
    },
  };
  const result = await onUnallocateMdBgoBatchCallable.run(unallocateRequest);
  assert.equal(result.success, true, result.message);
  const batch = (await db.doc(`bgo_batches/${ids[0]}`).get()).data();
  assert.equal(batch.workflow.state, "READY_FOR_ALLOCATION");
  assert.deepEqual(batch.assignment.targets, []);
  assert.equal(batch.bgo.targetId, undefined);
  assert.equal(batch.bgo.releaseState, "WAITING_BATCH_ACCEPTANCE");
  assert.equal((await db.doc(`bgo_rows/${ids[0]}_ROW_1`).get()).exists, true);
  assert.equal((await db.doc(`bgo_rows/${ids[0]}_ROW_1`).get()).data().workflow.state, "READY_FOR_ALLOCATION");
  const history = await db.collection(`bgo_batches/${ids[0]}/history`).get();
  assert.ok(history.docs.some(doc => doc.data().event === "MD_BGO_BATCH_UNALLOCATED"));
  const notification = await db.collection("notifications").where("bgo.batchId", "==", ids[0]).get();
  assert.equal(notification.docs[0].data().delivery.status, "CANCELLED");
  const retry = await onUnallocateMdBgoBatchCallable.run(unallocateRequest);
  assert.equal(retry.success, true);
  assert.equal((await db.collection(`bgo_batches/${ids[0]}/history`).get()).size, history.size);
});

test("refuses MD BGO unallocation when a premise is linked to an ERF row", async () => {
  const issued = await onAllocateMdBgoBatchesTogetherCallable.run(request([ids[0]]));
  assert.equal(issued.success, true, issued.message);
  const batch = (await db.doc(`bgo_batches/${ids[0]}`).get()).data();
  await db.doc(`bgo_rows/${ids[0]}_ROW_1`).update({ "refs.premiseId": "PREMISE_1" });
  const result = await onUnallocateMdBgoBatchCallable.run({
    auth: request([]).auth,
    data: { bgoBatchId: ids[0], expectedTargetType: target.type, expectedTargetId: target.id, expectedIssuedAtMillis: batch.workflow.issuedAt.toMillis(), requestId: "unalloc-request-2", reason: "Test blocked field work" },
  });
  assert.equal(result.success, false);
  assert.equal(result.code, "MD_BGO_FIELD_WORK_STARTED");
  assert.equal((await db.doc(`bgo_batches/${ids[0]}`).get()).data().workflow.state, "ISSUED");
});

test("one batch failing validation leaves every selected batch unchanged", async () => {
  await db.doc(`bgo_batches/${ids[1]}`).update({ "workflow.state": "ISSUED", "bgo.targetId": "OTHER_TEAM" });
  const result = await onAllocateMdBgoBatchesTogetherCallable.run(request(ids));
  assert.equal(result.success, false);
  assert.equal(result.code, "MD_BGO_BATCH_NOT_READY");
  const first = (await db.doc(`bgo_batches/${ids[0]}`).get()).data();
  assert.equal(first.workflow.state, "READY_FOR_ALLOCATION");
  assert.deepEqual(first.assignment.targets, []);
  assert.equal((await db.collection(`bgo_batches/${ids[0]}/history`).get()).size, 0);
  assert.equal((await db.collection("notifications").where("type", "==", "BMD_BGO_BATCH_ISSUED").get()).size, 0);
});
