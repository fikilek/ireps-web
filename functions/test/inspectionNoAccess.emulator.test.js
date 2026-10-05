import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onMeterLifecycleTrnCallable } from "../meterLifecycle/callables.js";
import { deriveNoAccessGroups } from "../noAccess/groups.js";
import { reconcilePremiseNoAccess } from "../noAccess/reconcile.js";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
test("shared phone payload through the real lifecycle callable and Firestore transaction", { skip: !enabled }, async (t) => {
  const mobile = process.env.IREPS_MOBILE_ROOT || path.resolve("../ireps-mobile");
  const { buildNoAccessPayload } = await import(pathToFileURL(path.join(mobile, "src/features/meters/noAccessCapture.js")));
  const projectId = process.env.GCLOUD_PROJECT;
  assert.match(projectId || "", /^demo-/, "This test must never connect to a real Firebase project.");
  assert.match(process.env.FIRESTORE_EMULATOR_HOST, /^(127\.0\.0\.1|localhost):\d+$/);
  const app = initializeApp({ projectId });
  const db = getFirestore(app);
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  const asset = { meterType: "electricity", status: { state: "DISCONNECTED" },
    accessData: { premise: { id: "P1" }, erfId: "E1" },
    ast: { astData: { astId: "A1", astNo: "12345", meter: { type: "prepaid" } }, location: { gps: { lat: -28, lng: 30 } } } };
  await Promise.all([
    db.doc("asts/A1").set(asset),
    db.doc("premises/P1").set({ erfId: "E1", address: { strNo: "1", strName: "Main", strType: "Street" }, propertyType: { type: "House" }, geometry: { centroid: { lat: -28.1, lng: 30.1 } }, services: { electricity: { astId: "A1", status: "DISCONNECTED" } } }),
    db.doc("ireps_erfs/E1").set({ admin: { localMunicipality: { pcode: "ZA5241" }, ward: { pcode: "ZA5241001" } } }),
    db.doc("users/U1").set({ employment: { role: "FWR", serviceProvider: { id: "SP1" } } }),
    db.doc("serviceProviders/SP1").set({ profile: { registeredName: "Provider One" } }),
  ]);
  const capturedAt = "2026-09-30T20:00:00.000Z";
  const appointment = { at: "2026-10-01T08:00:00.000Z", madeAt: capturedAt };
  const make = (id, context = {}) => buildNoAccessPayload({ trnId: id, capturedAt,
    actor: { uid: "U1", name: "Worker" },
    context: { trnType: "METER_INSPECTION", astId: "A1", premiseId: "P1", erfId: "E1", erfNo: "1", ...context },
    value: { reasonCode: "Return visit requested", appointment: { ...appointment } },
    media: [{ tag: "noAccessPhoto", url: "https://example.test/photo.jpg", uri: "file:///phone/private/photo.jpg" }],
  });
  const send = (data, uid = "U1", role = "FWR") => onMeterLifecycleTrnCallable.run({ data, auth: { uid, token: { role, name: "Worker" } } });
  await t.test("field inspection keeps canonical shape, delayed appointment and physical state; repeated ID is harmless", async () => {
    const payload = make("T1");
    const result = await send(payload);
    assert.equal(result.success, true, JSON.stringify(result));
    const trn = (await db.doc("trns/T1").get()).data();
    assert.equal(trn.accessData.access.appointment.at, appointment.at);
    assert.equal(trn.accessData.access.appointmentRuleVersion, 2);
    assert.equal(trn.accessData.access.reasonOther, "NAv");
    assert.equal(trn.ast.astData.astId, "A1");
    assert.equal(trn.ast.location.source, "ASSET");
    assert.equal(trn.serviceProvider.name, "Provider One");
    assert.equal(trn.metadata.createdOnDevice, capturedAt);
    assert.equal(Object.keys(trn.metadata).length, 12);
    assert.equal(trn.metadata.createdOnDeviceByUid, "U1");
    assert.equal(trn.meterType, "NA");
    assert.deepEqual(trn.status, {});
    assert.deepEqual(trn.assignment, {});
    for (const key of ["inspection", "executionOutcome", "astId", "trnType", "capturedAt"]) assert.equal(key in trn, false, key);
    assert.equal("uri" in trn.media[0], false);
    assert.deepEqual((await db.doc("asts/A1").get()).data(), asset);
    assert.deepEqual((await db.doc("premises/P1").get()).data().noAccessTrnIds, ["T1"]);
    assert.equal((await db.doc("premises/P1").get()).data().metadata.updatedAt, trn.metadata.updatedAt);
    const again = await send(payload);
    assert.equal(again.idempotent, true);
    assert.deepEqual((await db.doc("trns/T1").get()).data(), trn);
    assert.equal((await send(make("T2"))).success, true);
    assert.equal((await db.doc("premises/P1").get()).data().noAccessTrnIds.length, 2);
    const concurrent = await Promise.all([send(make("CONCURRENT")), send(make("CONCURRENT"))]);
    assert.ok(concurrent.every((result) => result.success));
    assert.equal((await db.doc("premises/P1").get()).data().noAccessTrnIds.filter((id) => id === "CONCURRENT").length, 1);
  });
  await t.test("office instruction keeps ID, assignment and original creation; IN_PROGRESS and team member execution work", async () => {
    await db.doc("teams/TEAM1").set({ memberUids: ["U1"] });
    const instruction = { id: "OFFICE1", accessData: { trnType: "METER_INSPECTION", premise: { id: "P1" } },
      ast: { astData: { astId: "A1" } }, origin: { channel: "OFFICE", source: "WMS" },
      workflow: { state: "IN_PROGRESS" }, assignment: { targets: [{ type: "TEAM", id: "TEAM1", name: "Team One" }], instruction: { text: "Inspect" } },
      metadata: { createdAt: "2026-09-01T00:00:00.000Z", createdByUid: "M1", createdByUser: "Manager" }, inspection: { stale: true }, executionOutcome: { outcome: "SUCCESS" } };
    await db.doc("trns/OFFICE1").set(instruction);
    await db.doc("asts/A1").update({ trnActiveLifecycle: { trnId: "OFFICE1" } });
    const payload = make("ignored", { instructionTrnId: "OFFICE1" });
    const result = await send(payload);
    assert.equal(result.success, true, JSON.stringify(result));
    const trn = (await db.doc("trns/OFFICE1").get()).data();
    assert.equal(trn.id, "OFFICE1");
    assert.deepEqual(trn.assignment, instruction.assignment);
    assert.equal(trn.origin.channel, "OFFICE");
    assert.equal(trn.metadata.createdAt, instruction.metadata.createdAt);
    assert.equal(trn.metadata.createdByUid, "M1");
    assert.equal(trn.metadata.createdOnDeviceByUid, "U1");
    assert.equal(trn.workflow.state, "COMPLETED");
    assert.equal(trn.inspection, undefined);
    assert.equal(trn.executionOutcome, undefined);
    assert.deepEqual((await db.doc("asts/A1").get()).data(), asset);
    assert.equal((await send(payload)).idempotent, true);
    assert.equal((await db.collection("trns/OFFICE1/history").get()).size, 1);
  });
  await t.test("all five lifecycle no-access types use the same writer and premise fallback", async () => {
    await db.doc("asts/A1").update({ "ast.location": {} });
    for (const type of ["METER_INSPECTION", "METER_READING", "METER_DISCONNECTION", "METER_RECONNECTION", "METER_REMOVAL"]) {
      const result = await send(make(type, { trnType: type }));
      assert.equal(result.success, true, JSON.stringify(result));
      const trn = (await db.doc(`trns/${type}`).get()).data();
      assert.equal(trn.ast.location.source, "PREMISE");
      assert.equal(trn.accessData.trnType, type);
      const withoutPhoto = make(`${type}_RETURN_NO_PHOTO`, { trnType: type });
      withoutPhoto.media = [];
      const recorded = await send(withoutPhoto);
      assert.equal(recorded.success, true, JSON.stringify(recorded));
      assert.deepEqual((await db.doc(`trns/${withoutPhoto.id}`).get()).data().media, []);
    }
  });
  await t.test("invalid evidence, reason, geography, authority and instruction create no record", async () => {
    for (const [code, alter] of [
      ["NO_ACCESS_REASON_INVALID", (p) => { p.accessData.access.reasonCode = "invented"; }],
      ["NO_ACCESS_PHOTO_REQUIRED", (p) => { delete p.media[0].url; }],
      ["NO_ACCESS_GEOGRAPHY_MISMATCH", (p) => { p.accessData.erfId = "E2"; }],
      ["NO_ACCESS_ERF_REQUIRED", (p) => { p.accessData.erfId = "NAv"; }],
      ["NO_ACCESS_APPOINTMENT_REQUIRED", (p) => { p.accessData.access.appointment = null; }],
      ["NO_ACCESS_APPOINTMENT_NOT_ALLOWED", (p) => { p.accessData.access.reasonCode = "Property Locked"; }],
      ["NO_ACCESS_APPOINTMENT_NOT_FUTURE_AT_CAPTURE", (p) => { p.accessData.access.appointment.at = capturedAt; }],
    ]) {
      await db.doc("ireps_erfs/E2").set({});
      const payload = make(code); alter(payload);
      const result = await send(payload);
      assert.equal(result.code, code, JSON.stringify(result));
      assert.equal((await db.doc(`trns/${code}`).get()).exists, false);
    }
    assert.equal((await send(make("NO_ROLE"), "U2", "MNG")).code, "UNAUTHORIZED_FIELD_ORIGIN");
    assert.equal((await send(make("X", { instructionTrnId: "MISSING" }))).code, "INSTRUCTION_TRN_NOT_FOUND");
    await db.doc("trns/NOT_YOURS").set({ accessData: { trnType: "METER_INSPECTION", premise: { id: "P1" } }, ast: { astData: { astId: "A1" } }, workflow: { state: "ACCEPTED" }, assignment: { targets: [{ type: "USER", id: "U2", name: "Other" }] } });
    assert.equal((await send(make("X", { instructionTrnId: "NOT_YOURS" }))).code, "INSTRUCTION_NOT_ASSIGNED");
  });
  await t.test("an actual successful inspection retains device time and closes the premise group", async () => {
    const at = "2026-10-01T10:00:00.000Z";
    const payload = {
      id: "ACCESS_PROOF", origin: { channel: "FIELD" }, status: { state: "DISCONNECTED" },
      accessData: { trnType: "METER_INSPECTION", access: { hasAccess: "yes" }, premise: { id: "P1" }, erfId: "E1" },
      ast: { astData: { astId: "A1" } }, metadata: { createdOnDevice: at, updatedOnDevice: at },
      media: ["astNoPhoto", "astCbPhoto", "keypadPhoto"].map((tag) => ({ tag, url: `https://example.test/${tag}.jpg` })),
      inspection: { comparison: { hasDifferences: false }, captured: { ast: {
        astData: { astNo: "12345", astManufacturer: "Conlog", astName: "Model X", meter: { type: "prepaid", category: "Normal", phase: "single", cb: { size: "60", comment: "" }, seal: { sealNo: "", comment: "Seal Missing" }, keypad: { serialNo: "K-1", comment: "" } } },
        anomalies: { anomaly: "Meter Ok", anomalyDetail: "Operationally Ok", otherAnomalies: [] }, normalisation: { actionTaken: ["None"] }, location: { placement: "Pole Top", gps: { lat: -28, lng: 30 } }, ogs: { hasOffGridSupply: "no" },
      } } },
    };
    const result = await send(payload);
    assert.equal(result.success, true, JSON.stringify(result));
    const proof = (await db.doc("trns/ACCESS_PROOF").get()).data();
    assert.equal(proof.metadata.createdOnDevice, at);
    const visits = await db.collection("trns").where("accessData.premise.id", "==", "P1").get();
    const { groups } = deriveNoAccessGroups(visits.docs.map((doc) => ({ ...doc.data(), id: doc.id })));
    assert.equal(groups[0].status, "CLOSED");
    assert.equal(groups[0].closingProof.trnId, "ACCESS_PROOF");
  });
  await t.test("reconciliation restores missing links, removes stale/deleted links and supports read-only assessment", async () => {
    await db.doc("premises/P1").update({ noAccessTrnIds: ["MISSING_TRN"] });
    const assessment = await reconcilePremiseNoAccess(db, "P1", { dryRun: true });
    assert.equal(assessment.changed, true);
    assert.deepEqual((await db.doc("premises/P1").get()).data().noAccessTrnIds, ["MISSING_TRN"]);
    await reconcilePremiseNoAccess(db, "P1");
    await db.doc("trns/T1").delete();
    await reconcilePremiseNoAccess(db, "P1");
    const links = (await db.doc("premises/P1").get()).data().noAccessTrnIds;
    assert.ok(links.includes("T2"));
    assert.ok(!links.includes("T1") && !links.includes("MISSING_TRN"));
    assert.equal((await db.doc("premises/P1").get()).data().services.electricity.status, "DISCONNECTED");
  });
  await deleteApp(app);
});
