import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("canonical MNC supervisor originates MD BGO; scope and denied clients remain protected", async t => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(localhost|127\.0\.0\.1):\d+$/);
  assert.match(process.env.GCLOUD_PROJECT || "", /^demo-/);
  const { onCreateBgoCallable } = await import("../index.js");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getApps, deleteApp } = await import("firebase-admin/app");
  const { initializeTestEnvironment, assertFails } = await import("@firebase/rules-unit-testing");
  const { collection, query, where, getDocs, setDoc, doc } = await import("firebase/firestore");
  const db = getFirestore();
  const env = await initializeTestEnvironment({ projectId: process.env.GCLOUD_PROJECT,
    firestore: { host: "127.0.0.1", port: 8087, rules: await readFile(new URL("../../firestore.rules", import.meta.url), "utf8") } });
  t.after(async () => { await env.cleanup(); await Promise.all(getApps().map(deleteApp)); });
  const scope = { lmPcode: "ZA5241", wardPcode: "ZA5241006" };
  const data = { batchMode: "BMD", operationType: "METER_DISCOVERY", scope,
    geofenceRef: { id: "AUTHORITY_GF", name: "MNC fixture" }, worklist: { erfRefs: [{ id: "AUTHORITY_ERF", erfNo: "35" }] } };
  await db.doc("users/mandy-authority").set({ accountStatus: "ACTIVE", employment: { role: "SPV", serviceProvider: { id: "AUTHORITY_RSTE" } } });
  await db.doc("serviceProviders/AUTHORITY_RSTE").set({ status: "ACTIVE", clients: [{ id: scope.lmPcode, name: "Endumeni", clientType: "LM", relationshipType: "MNC" }] });
  await db.doc("geo_fences/AUTHORITY_GF").set({ parents: scope });
  const auth = { uid: "mandy-authority", token: { role: "SPV" } };
  await t.test("foreign LM and misleading MNC claim denied without writes", async () => {
    const result = await onCreateBgoCallable.run({ auth: { ...auth, token: { role: "SPV", relationshipType: "MNC" } }, data: { ...data, scope: { ...scope, lmPcode: "FOREIGN" } } });
    assert.equal(result.code, "UNAUTHORIZED_BGO_ORIGINATOR");
    assert.equal((await db.doc("geo_fences/AUTHORITY_GF").get()).data().bgo, undefined);
  });
  await t.test("FWR and unsigned request denied", async () => {
    assert.equal((await onCreateBgoCallable.run({ auth: { ...auth, token: { role: "FWR" } }, data })).code, "UNAUTHORIZED_BGO_ORIGINATOR");
    assert.equal((await onCreateBgoCallable.run({ data })).code, "UNAUTHENTICATED");
  });
  await t.test("geofence municipality cannot bypass MNC scope", async () => {
    await db.doc("geo_fences/AUTHORITY_GF").update({ "parents.lmPcode": "FOREIGN" });
    await assert.rejects(onCreateBgoCallable.run({ auth, data }), /municipality does not match/);
    await db.doc("geo_fences/AUTHORITY_GF").update({ "parents.lmPcode": scope.lmPcode });
  });
  let created;
  await t.test("actual callable atomically creates batch, ERF row and geofence link", async () => {
    created = await onCreateBgoCallable.run({ auth, data });
    assert.equal(created.success, true, created.message);
    assert.equal(created.createdBgoRowCount, 1);
    assert.equal((await db.doc(`bgo_batches/${created.bgoBatchId}`).get()).data().scope.lmPcode, scope.lmPcode);
    assert.equal((await db.doc("geo_fences/AUTHORITY_GF").get()).data().bgo.batchId, created.bgoBatchId);
    const client = env.authenticatedContext(auth.uid, auth.token).firestore();
    const rows = await getDocs(query(collection(client, "bgo_rows"), where("bgoBatchId", "==", created.bgoBatchId)));
    assert.equal(rows.size, 1, "intended authenticated supervisor can read the created work row");
    await assertFails(setDoc(doc(client, "bgo_rows/authority-forged"), { bgoBatchId: created.bgoBatchId }));
    await assertFails(getDocs(query(collection(env.unauthenticatedContext().firestore(), "bgo_rows"), where("bgoBatchId", "==", created.bgoBatchId))));
  });
  await t.test("repeat origination preserves exclusivity", async () => {
    assert.equal((await onCreateBgoCallable.run({ auth, data })).code, "GEOFENCE_ALREADY_BATCHED");
  });
});
