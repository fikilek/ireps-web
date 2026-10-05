import test from "node:test";
import assert from "node:assert/strict";

test("accessible Discovery commits the full registration with canonical metadata", { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async (t) => {
  assert.match(process.env.GCLOUD_PROJECT || "", /^demo-/);
  assert.match(process.env.FIRESTORE_EMULATOR_HOST, /^(127\.0\.0\.1|localhost):\d+$/);
  const { onMeterDiscoveryCallable } = await import("../index.js");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getApps, deleteApp } = await import("firebase-admin/app");
  t.after(async () => { await Promise.all(getApps().map(deleteApp)); });
  const db = getFirestore();
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await Promise.all([
    db.doc("users/U1").set({ employment: { role: "FWR", serviceProvider: { id: "SP1" } } }),
    db.doc("serviceProviders/SP1").set({ profile: { registeredName: "Provider" } }),
    db.doc("ireps_erfs/E1").set({ admin: { localMunicipality: { pcode: "ZA5241" }, ward: { pcode: "ZA5241006" } } }),
    db.doc("premises/P1").set({ erfId: "E1", address: { strNo: "4311", strName: "Jacaranda", strType: "Avenue" }, propertyType: { type: "House" }, services: {}, geometry: { centroid: { lat: -28.1, lng: 30.1 } } }),
  ]);
  const capturedAt = "2026-10-01T06:00:00.000Z";
  const variants = [["electricity", "conventional"], ["electricity", "prepaid"], ["water", "conventional"], ["water", "prepaid"]];
  for (const [index, [meterType, kind]] of variants.entries()) {
    await t.test(`${meterType} ${kind}: meter, master, premise and ERF save once with original capture time`, async () => {
      const meterNo = `65386${index}`;
      const id = `TRN_MDIS_REG_${index}_${meterType === "water" ? "WTR" : "ELC"}_ZA5241006_4311`;
      const media = ["astNoPhoto", ...(meterType === "electricity" ? ["sealPhoto", "astCbPhoto", ...(kind === "prepaid" ? ["keypadPhoto"] : [])] : [kind === "conventional" ? "meterReadingPhoto" : "tokenReadingPhoto"])].map(tag => ({ tag, url: `https://example.test/${tag}.jpg` }));
      const data = {
        id, meterType,
        accessData: { trnType: "METER_DISCOVERY", erfId: "E1", erfNo: "4311", parents: { countryPcode: "ZA", provincePcode: "ZA5", dmPcode: "ZA524", lmPcode: "ZA5241", wardPcode: "ZA5241006" }, premise: { id: "P1", address: "4311 Jacaranda Avenue", propertyType: "House" }, access: { hasAccess: "yes", reason: "NAv" } },
        ast: {
          astData: { astNo: meterNo, astManufacturer: "Itron", astName: "Test model", meter: { type: kind, category: "Normal", ...(meterType === "electricity" ? { phase: "three", seal: { sealNo: "S1", comment: "" }, cb: { size: "60A", comment: "" }, ...(kind === "prepaid" ? { keypad: { serialNo: "K1", comment: "" } } : {}) } : {}) } },
          anomalies: { anomaly: "Meter Ok", anomalyDetail: "Operationally Ok", otherAnomalies: [] }, normalisation: { actionTaken: ["None"] },
          ogs: { hasOffGridSupply: "no" }, location: { placement: "Boundary Wall", gps: { lat: -28.16, lng: 30.23 } },
        },
        status: { state: "CONNECTED", id: "ZA5241", detail: "Endumeni" }, serviceProvider: { id: "SP1", name: "Provider" }, media,
        metadata: { createdOnDevice: capturedAt, updatedOnDevice: capturedAt },
        ...(kind === "conventional" ? { mreadings: [{ reading: "1234" }] } : meterType === "water" ? { treadings: [{ tokenReading: "4567" }] } : {}),
      };
      const send = () => onMeterDiscoveryCallable.run({ data, auth: { uid: "U1", token: { role: "FWR", name: "Worker" } } });
      const reply = await send();
      assert.equal(reply.success, true, JSON.stringify(reply));
      const [trnSnap, astSnap, masterSnap, premiseSnap, erfSnap] = await Promise.all([
        db.doc(`trns/${id}`).get(), db.doc(`asts/${id}`).get(), db.doc(`meter_master/${meterNo}`).get(), db.doc("premises/P1").get(), db.doc("ireps_erfs/E1").get(),
      ]);
      assert.ok(trnSnap.exists && astSnap.exists && masterSnap.exists);
      const trn = trnSnap.data(), asset = astSnap.data();
      assert.equal(Object.keys(trn.metadata).length, 12);
      assert.equal(trn.metadata.createdOnDevice, capturedAt);
      assert.equal(trn.metadata.updatedOnDevice, capturedAt);
      assert.notEqual(trn.metadata.updatedAt, capturedAt);
      assert.equal(trn.derived.processedAt, trn.metadata.updatedAt);
      assert.equal(erfSnap.data().metadata.updatedAt, trn.metadata.updatedAt);
      assert.equal(asset.metadata.createdOnDevice, capturedAt);
      assert.equal(asset.ast.astData.meter.type, kind);
      assert.equal(asset.ast.astData.astId, id);
      assert.equal(masterSnap.data().refs.asts.id, id);
      const bucket = meterType === "water" ? "waterMeters" : "electricityMeters";
      assert.equal(premiseSnap.data().services[bucket].filter(m => m.trnId === id).length, 1);
      const counts = await Promise.all([db.collection("asts").count().get(), db.collection("trns").count().get()]);
      assert.equal((await send()).success, true);
      assert.deepEqual((await db.doc(`trns/${id}`).get()).data(), trn);
      assert.deepEqual((await db.doc(`asts/${id}`).get()).data(), asset);
      const afterCounts = await Promise.all([db.collection("asts").count().get(), db.collection("trns").count().get()]);
      assert.deepEqual(afterCounts.map(s => s.data().count), counts.map(s => s.data().count));
    });
  }
});
