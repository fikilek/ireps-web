import test from "node:test";
import assert from "node:assert/strict";

test("MD BGO callable registration closes work atomically and survives retries and additional meters", { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async (t) => {
  assert.match(process.env.GCLOUD_PROJECT || "", /^demo-/);
  const { onMeterDiscoveryCallable } = await import("../index.js");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getApps, deleteApp } = await import("firebase-admin/app");
  const { createOrLinkMdBgoPremise } = await import("../bgo/mdBgoPremiseLink.js");
  t.after(async () => Promise.all(getApps().map(deleteApp)));
  const db = getFirestore();
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  const batchId = "MD_BGO_20261111_010000_ZA5241006_MDIS", rowId = `${batchId}_ROW_1`;
  const scope = { lmPcode: "ZA5241", wardPcode: "ZA5241006" };
  const context = { batchId, rowId, erfId: "E1", premiseId: "P1", batchMode: "BMD" };
  await Promise.all([
    db.doc("users/U1").set({ accountStatus: "ACTIVE", employment: { role: "FWR", serviceProvider: { id: "SP1" } } }),
    db.doc("users/U2").set({ accountStatus: "ACTIVE", employment: { role: "FWR", serviceProvider: { id: "SP2" } } }),
    db.doc("serviceProviders/SP1").set({ profile: { registeredName: "Provider" } }),
    db.doc("ireps_erfs/E1").set({ admin: { localMunicipality: { pcode: scope.lmPcode }, ward: { pcode: scope.wardPcode } } }),
    db.doc("premises/P1").set({ id: "P1", erfId: "E1", parents: scope, address: { strNo: "4311", strName: "Jacaranda", strType: "Avenue" }, propertyType: { type: "Residential" }, services: {}, geometry: { centroid: { lat: -28.1, lng: 30.1 } } }),
    db.doc(`bgo_batches/${batchId}`).set({ id: batchId, operationType: "METER_DISCOVERY", bgo: { batchMode: "BMD", releaseState: "RELEASED_TO_EXECUTION", targetType: "USER", targetId: "U1" }, scope, workflow: { state: "ACCEPTED" }, summary: { erfCount: 1, totalRows: 1 } }),
    db.doc(`bgo_rows/${rowId}`).set({ id: rowId, rowNo: 1, bgoBatchId: batchId, batchId, batchMode: "BMD", operationType: "METER_DISCOVERY", scope, erf: { id: "E1", erfNo: "4311" }, refs: { premiseId: "P1" }, workflow: { state: "IN_PROGRESS" }, metadata: { createdAt: "2026-11-10T20:00:00.000Z" } }),
  ]);
  const payload = (suffix, meterNo) => ({
    id: `TRN_MDIS_BGO_${suffix}_ELC_ZA5241006_4311`, meterType: "electricity", mdBgoContext: { ...context },
    accessData: { trnType: "METER_DISCOVERY", erfId: "E1", erfNo: "4311", parents: { countryPcode: "ZA", provincePcode: "ZA5", dmPcode: "ZA524", ...scope }, premise: { id: "P1", address: "4311 Jacaranda Avenue", propertyType: "Residential" }, access: { hasAccess: "yes", reason: "NAv" } },
    ast: { astData: { astNo: meterNo, astManufacturer: "Itron", astName: "Test", meter: { type: "conventional", category: "Normal", phase: "three", seal: { sealNo: "S1", comment: "" }, cb: { size: "60A", comment: "" } } },
      anomalies: { anomaly: "Meter Ok", anomalyDetail: "Operationally Ok", otherAnomalies: [] }, normalisation: { actionTaken: ["None"] }, ogs: { hasOffGridSupply: "no" }, location: { placement: "Boundary Wall", gps: { lat: -28.16, lng: 30.23 } } },
    status: { state: "CONNECTED", id: "ZA5241", detail: "Endumeni" }, serviceProvider: { id: "SP1", name: "Provider" },
    media: ["astNoPhoto", "sealPhoto", "astCbPhoto"].map((tag) => ({ tag, url: `https://example.test/${tag}.jpg` })),
    metadata: { createdOnDevice: "2026-11-10T20:00:00.000Z", updatedOnDevice: "2026-11-10T20:00:00.000Z" }, mreadings: [{ reading: "1234" }],
  });
  const send = (data, uid = "U1") => onMeterDiscoveryCallable.run({ data, auth: { uid, token: { role: "FWR", name: "Worker" } } });
  await t.test("first meter, master, TRN and completed BGO row commit together; retry is unchanged", async () => {
    const data = payload("FIRST", "654321001");
    const reply = await send(data); assert.equal(reply.success, true, JSON.stringify(reply));
    const row = (await db.doc(`bgo_rows/${rowId}`).get()).data();
    assert.equal(row.workflow.state, "COMPLETED"); assert.equal(row.refs.meterId, data.id); assert.equal(row.meter.meterNo, "654321001");
    const parent = (await db.doc(`bgo_batches/${batchId}`).get()).data();
    assert.equal(parent.workflow.state, "COMPLETED"); assert.equal(parent.summary.completedRows, 1); assert.equal(parent.summary.meterCount, 1);
    const trn = (await db.doc(`trns/${data.id}`).get()).data(); assert.equal(trn.origin.mdBgo.rowId, rowId); assert.equal(trn.mdBgoContext, undefined);
    assert.ok((await db.doc(`asts/${data.id}`).get()).exists); assert.equal((await db.doc("meter_master/654321001").get()).data().refs.asts.id, data.id);
    assert.equal((await send(data)).success, true);
    assert.deepEqual((await db.doc(`bgo_batches/${batchId}`).get()).data(), parent);
  });
  await t.test("additional and concurrent meters receive separate canonical rows without duplicate counts", async () => {
    const replies = await Promise.all([send(payload("SECOND", "654321002")), send(payload("THIRD", "654321003"))]);
    replies.forEach((r) => assert.equal(r.success, true, JSON.stringify(r)));
    const rows = await db.collection("bgo_rows").where("bgoBatchId", "==", batchId).get(); assert.equal(rows.size, 3);
    assert.deepEqual(rows.docs.map((d) => d.data().rowNo).sort(), [1, 2, 3]);
    for (const d of rows.docs) {
      assert.equal(d.data().refs.premiseId, "P1"); assert.equal(d.data().workflow.state, "COMPLETED");
      const trn = (await db.doc(`trns/${d.data().refs.trnId}`).get()).data();
      assert.equal(trn.origin.mdBgo.rowId, d.id);
      assert.equal(trn.mdBgoContext, undefined);
    }
    assert.equal((await db.doc(`bgo_batches/${batchId}`).get()).data().summary.meterCount, 3);
  });
  await t.test("premise duplication never copies existing meter or completion links", async () => {
    await createOrLinkMdBgoPremise({ db, premiseRef: db.doc("premises/P2"), premisePayload: { id: "P2", erfId: "E1", parents: scope, geometry: { centroid: { lat: -28.1, lng: 30.1 } }, metadata: { createdAt: "2026-11-10T21:00:00.000Z", updatedAt: "2026-11-10T21:00:00.000Z" } }, mdBgoContext: context, actorUid: "U1", actorName: "Worker" });
    const rows = await db.collection("bgo_rows").where("refs.premiseId", "==", "P2").get(); assert.equal(rows.size, 1);
    const row = rows.docs[0].data(); assert.equal(row.refs.meterId, undefined); assert.equal(row.meter, null); assert.equal(row.workflow.completedAt, undefined);
    assert.equal((await db.doc(`bgo_batches/${batchId}`).get()).data().workflow.state, "IN_PROGRESS");
  });
  await t.test("No Access attaches once to its premise row and leaves it in progress", async () => {
    const data = payload("NA", "");
    data.mdBgoContext = { ...context, premiseId: "P2", rowId: `${batchId}_ROW_4` };
    data.meterType = "NA"; data.accessData.premise.id = "P2";
    data.accessData.access = { hasAccess: "no", reasonCode: "Property Locked", reason: "Property Locked" };
    data.media = [{ tag: "noAccessPhoto", url: "https://example.test/gate.jpg" }];
    delete data.mreadings;
    delete data.ast;
    const reply = await send(data); assert.equal(reply.success, true, JSON.stringify(reply));
    const row = (await db.doc(`bgo_rows/${batchId}_ROW_4`).get()).data();
    assert.equal(row.workflow.state, "IN_PROGRESS"); assert.equal(row.noAccessCount, 1); assert.deepEqual(row.refs.noAccessTrnIds, [data.id]);
    assert.equal((await send(data)).success, true);
    assert.equal((await db.doc(`bgo_rows/${batchId}_ROW_4`).get()).data().noAccessCount, 1);
  });
  await t.test("wrong worker or forged ERF causes no registration writes", async () => {
    const data = payload("DENIED", "654321009");
    const denied = await send(data, "U2"); assert.equal(denied.success, false);
    const forged = payload("FORGED", "654321010"); forged.mdBgoContext.erfId = "OTHER";
    assert.equal((await send(forged)).success, false);
    for (const capture of [data, forged]) { assert.equal((await db.doc(`trns/${capture.id}`).get()).exists, false); assert.equal((await db.doc(`asts/${capture.id}`).get()).exists, false); }
  });
});
