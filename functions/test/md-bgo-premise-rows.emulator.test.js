import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("premise saves immediately publish repeatable BGO rows without a meter", { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async (t) => {
  assert.match(process.env.GCLOUD_PROJECT || "", /^demo-/);
  const { onPremiseCreateCallable } = await import("../index.js");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getApps, deleteApp } = await import("firebase-admin/app");
  const { initializeTestEnvironment, assertFails } = await import("@firebase/rules-unit-testing");
  const { collection, query, where, onSnapshot, getDocs, setDoc, doc } = await import("firebase/firestore");
  const db = getFirestore();
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  const env = await initializeTestEnvironment({ projectId: process.env.GCLOUD_PROJECT,
    firestore: { host: "127.0.0.1", port: 8087, rules: await readFile(new URL("../../firestore.rules", import.meta.url), "utf8") } });
  t.after(async () => { await env.cleanup(); await Promise.all(getApps().map(deleteApp)); });
  const batchId = "MD_BGO_PREMISE_ROWS", scope = { lmPcode: "ZA5241", wardPcode: "ZA5241006" };
  const parent = { id: batchId, operationType: "METER_DISCOVERY", bgo: { batchMode: "BMD", releaseState: "RELEASED_TO_EXECUTION", targetType: "USER", targetId: "U1" }, scope,
    workflow: { state: "IN_PROGRESS" }, summary: { erfCount: 59, totalRows: 59, notStartedRows: 58, inProgressRows: 1, completedRows: 0, premiseCount: 1, meterCount: 0 } };
  await Promise.all([
    db.doc("users/U1").set({ accountStatus: "ACTIVE", employment: { role: "FWR" } }),
    db.doc("users/U2").set({ accountStatus: "ACTIVE", employment: { role: "FWR" } }),
    db.doc("users/DISABLED").set({ accountStatus: "DISABLED", employment: { role: "FWR" } }),
    db.doc("ireps_erfs/E1").set({ admin: { ward: { pcode: scope.wardPcode } } }),
    db.doc("ireps_erfs/E3").set({ admin: { ward: { pcode: scope.wardPcode } } }),
    db.doc(`bgo_batches/${batchId}`).set(parent),
    ...Array.from({ length: 59 }, (_, index) => {
      const rowNo = index + 1, id = `${batchId}_ROW_${rowNo}`;
      return db.doc(`bgo_rows/${id}`).set({ id, rowNo, bgoBatchId: batchId, batchId, batchMode: "BMD", operationType: "METER_DISCOVERY", scope,
        erf: { id: `E${rowNo}`, erfNo: rowNo === 1 ? "3485" : `${3700 + rowNo}` }, refs: rowNo === 2 ? { premiseId: "P_OTHER" } : {}, workflow: { state: rowNo === 2 ? "IN_PROGRESS" : "ISSUED" } });
    }),
  ]);
  const payload = (unit, erfId = "E1") => ({ id: `P_${unit}`, erfId, erfNo: "3485", parents: scope,
    address: { strNo: "3485", strName: "Albatross", strType: "Street" }, propertyType: { type: "Flats", name: "ZK Flats", unitNo: unit },
    geometry: { centroid: { lat: -28.1, lng: 30.1 } }, media: [] });
  const send = (data, uid = "U1") => onPremiseCreateCallable.run({ data, auth: { uid, token: { name: "Worker", role: "FWR" } } });
  const client = env.authenticatedContext("U1").firestore();
  const rowQuery = query(collection(client, "bgo_rows"), where("bgoBatchId", "==", batchId));
  let latest = [], observer = () => {}, streamError;
  const stop = onSnapshot(rowQuery, snap => { latest = snap.docs.map(d => ({ id: d.id, ...d.data() })); observer(); }, error => { streamError = error; observer(); });
  t.after(stop);
  const waitFor = (predicate) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Client row stream did not receive premise-created row")), 10000);
    observer = () => { if (streamError) { clearTimeout(timer); reject(streamError); } else if (predicate(latest)) { clearTimeout(timer); resolve(); } };
    observer();
  });
  await waitFor(rows => rows.length === 59);
  await t.test("Unit A converts its seed; Unit B immediately creates row 60 and streams before meter capture", async () => {
    assert.equal((await send(payload("A"))).success, true);
    assert.equal((await db.doc(`bgo_batches/${batchId}`).get()).data().summary.totalRows, 59);
    const reply = await send(payload("B"));
    assert.equal(reply.success, true, JSON.stringify(reply));
    await waitFor(rows => rows.length === 60 && rows.some(row => row.refs?.premiseId === "P_B"));
    const row = latest.find(row => row.refs?.premiseId === "P_B");
    assert.equal(row.id, `${batchId}_ROW_60`);
    assert.equal(row.workflow.state, "IN_PROGRESS");
    assert.equal(row.refs.meterId, undefined);
    assert.equal(row.meter, null);
    const summary = (await db.doc(`bgo_batches/${batchId}`).get()).data().summary;
    assert.deepEqual([summary.totalRows, summary.notStartedRows, summary.inProgressRows, summary.completedRows], [60, 57, 3, 0]);
    assert.equal(summary.premiseCount, 3);
    assert.equal(summary.meterCount, 0);
  });
  await t.test("retry is idempotent and concurrent Unit C/D captures each add their own row", async () => {
    const original = (await db.doc("premises/P_B").get()).data();
    assert.equal((await send(payload("B"))).success, true);
    assert.equal((await db.doc(`bgo_batches/${batchId}`).get()).data().summary.totalRows, 60);
    assert.deepEqual((await db.doc("premises/P_B").get()).data(), original);
    const replies = await Promise.all([send(payload("C")), send(payload("D"))]);
    replies.forEach(reply => assert.equal(reply.success, true, JSON.stringify(reply)));
    const rows = await db.collection("bgo_rows").where("bgoBatchId", "==", batchId).get();
    assert.equal(rows.size, 62);
    for (const unit of ["A", "B", "C", "D"]) assert.equal(rows.docs.filter(d => d.data().refs?.premiseId === `P_${unit}`).length, 1);
  });
  await t.test("an already-saved unlinked premise is repaired without changing its captured data", async () => {
    const original = { ...payload("SAVED"), metadata: { createdAt: "2026-11-11T17:59:02.519Z", updatedAt: "2026-11-11T17:59:04.577Z", createdByUid: "U1" }, qa: { status: "QA_PENDING", sourceVersion: "original" } };
    await db.doc("premises/P_SAVED").set(original);
    assert.equal((await send(payload("SAVED"))).success, true);
    assert.deepEqual((await db.doc("premises/P_SAVED").get()).data(), original);
    const linked = await db.collection("bgo_rows").where("refs.premiseId", "==", "P_SAVED").get();
    assert.equal(linked.size, 1);
  });
  await t.test("wrong actor and malformed explicit context cannot add a batch row; no-batch normal capture still works", async () => {
    const explicit = { ...payload("DENIED"), mdBgoContext: { batchId, rowId: `${batchId}_ROW_1`, erfId: "E1", batchMode: "BMD" } };
    assert.equal((await send(explicit, "U2")).success, false);
    assert.equal((await db.doc("premises/P_DENIED").get()).exists, false);
    assert.equal((await send({ ...payload("BAD"), mdBgoContext: {} })).success, false);
    assert.equal((await db.doc("premises/P_BAD").get()).exists, false);
    assert.equal((await send(payload("NORMAL", "E_OUTSIDE_BATCH"))).success, true);
    assert.equal((await db.collection("bgo_rows").where("refs.premiseId", "==", "P_NORMAL").get()).size, 0);
    await assertFails(getDocs(query(collection(env.unauthenticatedContext().firestore(), "bgo_rows"), where("bgoBatchId", "==", batchId))));
    await assertFails(getDocs(query(collection(env.authenticatedContext("DISABLED").firestore(), "bgo_rows"), where("bgoBatchId", "==", batchId))));
    await assertFails(setDoc(doc(client, "bgo_rows/FORGED"), { bgoBatchId: batchId }));
  });
  await t.test("context-free creation resolves current TEAM and SP assignment", async () => {
    await db.doc("teams/TEAM1").set({ scope: { memberUserIds: ["U1"] } });
    await db.doc(`bgo_batches/${batchId}`).update({ "bgo.targetType": "TEAM", "bgo.targetId": "TEAM1" });
    assert.equal((await send(payload("TEAM"))).success, true);
    assert.equal((await db.collection("bgo_rows").where("refs.premiseId", "==", "P_TEAM").get()).size, 1);
    await db.doc("users/U1").update({ "employment.serviceProvider": { id: "SP1" } });
    await db.doc(`bgo_batches/${batchId}`).update({ "bgo.targetType": "SP", "bgo.targetId": "SP1" });
    assert.equal((await send(payload("SP"))).success, true);
    assert.equal((await db.collection("bgo_rows").where("refs.premiseId", "==", "P_SP").get()).size, 1);
    await db.doc(`bgo_batches/${batchId}`).update({ "bgo.targetType": "USER", "bgo.targetId": "U1" });
  });
  await t.test("ambiguous assigned batches are rejected without saving the premise or guessing", async () => {
    const other = "MD_BGO_OVERLAP";
    await db.doc(`bgo_batches/${other}`).set({ ...parent, id: other });
    await db.doc(`bgo_rows/${other}_ROW_1`).set({ id: `${other}_ROW_1`, bgoBatchId: other, rowNo: 1, batchMode: "BMD", operationType: "METER_DISCOVERY", erf: { id: "E1" }, workflow: { state: "ISSUED" } });
    const reply = await send(payload("AMBIGUOUS"));
    assert.equal(reply.success, false);
    assert.equal(reply.code, "MD_BGO_BATCH_AMBIGUOUS");
    assert.equal((await db.doc("premises/P_AMBIGUOUS").get()).exists, false);
  });
});
