import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

test("Discovery and Installation enforce the return agreement through their real callables", { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async (t) => {
  assert.match(process.env.GCLOUD_PROJECT || "", /^demo-/);
  assert.match(process.env.FIRESTORE_EMULATOR_HOST, /^(127\.0\.0\.1|localhost):\d+$/);
  const { onMeterDiscoveryCallable, onMeterInstallationCallable } = await import("../index.js");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getApps, deleteApp } = await import("firebase-admin/app");
  t.after(async () => { await Promise.all(getApps().map(deleteApp)); });
  const db = getFirestore();
  const mobile = process.env.IREPS_MOBILE_ROOT || path.resolve("../ireps-mobile");
  const { buildNoAccessPayload } = await import(pathToFileURL(path.join(mobile, "src/features/meters/noAccessCapture.js")));
  const { NO_ACCESS_REASONS } = await import(pathToFileURL(path.join(mobile, "src/features/meters/noAccessReasons.js")));
  const { NO_ACCESS_REASON_CODES } = await import("../noAccess/recordNoAccess.js");
  assert.deepEqual(NO_ACCESS_REASONS.map(s => s.toUpperCase()).sort(), NO_ACCESS_REASON_CODES.map(s => s.toUpperCase()).sort());
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await Promise.all([
    db.doc("users/U1").set({ employment: { role: "FWR", serviceProvider: { id: "SP1" } } }),
    db.doc("serviceProviders/SP1").set({ profile: { registeredName: "Provider" } }),
    db.doc("ireps_erfs/E1").set({ admin: { localMunicipality: { pcode: "ZA5241" }, ward: { pcode: "ZA5241006" } } }),
    db.doc("premises/P1").set({ erfId: "E1", address: { strNo: "1", strName: "Test", strType: "Road" }, propertyType: { type: "House" }, services: {}, geometry: { centroid: { lat: -28.1, lng: 30.1 } } }),
  ]);
  const capturedAt = "2020-01-01T06:00:00.000Z";
  const appointment = { at: "2020-01-02T08:00:00.000Z", madeAt: capturedAt };
  for (const [type, prefix, callable] of [["METER_DISCOVERY", "MDIS", onMeterDiscoveryCallable], ["METER_INSTALLATION", "MINST", onMeterInstallationCallable]]) {
    const make = (suffix) => buildNoAccessPayload({ trnId: `TRN_${prefix}_RETURN_${suffix}`, capturedAt,
      context: { trnType: type, premiseId: "P1", erfId: "E1", erfNo: "1", lmPcode: "ZA5241", wardPcode: "ZA5241006" },
      value: { reasonCode: "Occupant requested a return visit", appointment: { ...appointment } }, actor: { uid: "U1", name: "Worker" },
      media: [{ tag: "noAccessPhoto", url: "https://example.test/photo.jpg" }],
    });
    const send = (data) => callable.run({ data, auth: { uid: "U1", token: { role: "FWR", name: "Worker" } } });
    await t.test(`${type}: old appointment delivers once without creating a meter`, async () => {
      const payload = make("VALID");
      assert.equal((await send(payload)).success, true);
      const before = (await db.doc(`trns/${payload.id}`).get()).data();
      assert.equal(before.accessData.access.appointment.at, appointment.at);
      assert.equal(before.accessData.access.appointmentRuleVersion, 2);
      assert.equal((await send(payload)).success, true);
      assert.deepEqual((await db.doc(`trns/${payload.id}`).get()).data(), before);
      const premise = (await db.doc("premises/P1").get()).data();
      assert.equal(premise.noAccessTrnIds.filter(id => id === payload.id).length, 1);
      assert.deepEqual(premise.services, {});
      assert.equal((await db.collection("asts").get()).size, 0);
      assert.equal((await db.collection("meter_master").get()).size, 0);
    });
    await t.test(`${type}: each invalid agreement is refused without a transaction or count change`, async () => {
      const before = (await db.doc("premises/P1").get()).data();
      for (const [code, alter] of [
        ["NO_ACCESS_APPOINTMENT_REQUIRED", p => { p.accessData.access.appointment = null; }],
        ["NO_ACCESS_APPOINTMENT_NOT_ALLOWED", p => { p.accessData.access.reasonCode = "Property Locked"; }],
        ["NO_ACCESS_APPOINTMENT_NOT_FUTURE_AT_CAPTURE", p => { p.accessData.access.appointment.at = capturedAt; }],
        ["NO_ACCESS_APPOINTMENT_INVALID", p => { delete p.metadata.createdOnDevice; }],
      ]) {
        const payload = make(code); alter(payload);
        const result = await send(payload).catch(error => {
          assert.equal(error.code, "failed-precondition");
          return error.details;
        });
        assert.equal(result.code, code, JSON.stringify(result));
        assert.equal((await db.doc(`trns/${payload.id}`).get()).exists, false);
      }
      assert.deepEqual((await db.doc("premises/P1").get()).data(), before);
    });
    await t.test(`${type}: a legacy offline appointment still arrives unchanged`, async () => {
      const payload = make("LEGACY");
      delete payload.accessData.access.appointmentRuleVersion;
      payload.accessData.access.reasonCode = "Property Locked";
      const result = await send(payload);
      assert.equal(result.success, true, JSON.stringify(result));
      const stored = (await db.doc(`trns/${payload.id}`).get()).data().accessData.access;
      assert.equal(stored.reasonCode, "Property Locked");
      assert.equal(stored.appointment.at, appointment.at);
      assert.equal(Object.hasOwn(stored, "appointmentRuleVersion"), false);
    });
  }
});
