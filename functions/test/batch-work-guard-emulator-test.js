// Targeted Batch rules 1.3.62, TB-R059 and TB-R060. Emulator only. The batch is made by the real pipeline
// (resolve, geofence, assess, create, allocate, accept) and then four real field-work callables are
// submitted twice: once by a worker of another team, who must be refused with nothing written, and once by
// a worker of the batch's own team, who is not stopped by this rule.
//
// 1.3.62 adds three proofs: a batch iREPS cannot check refuses the work instead of letting it through, a
// batch that already names a team is not free whatever its allocation status says, and taking a meter out
// of a batch (TB-R060) needs Unallocate's authority — a supervisor of another service provider cannot free
// this batch's work, while the batch's own manager still can.
//
// 1.3.65 (TB-R062) adds the ERF: a DIFFERENT meter number discovered on the batch's ERF by another team is
// refused and writes nothing, the same discovery reported as illegally connected goes through and writes
// its override record, and the batch's own row never moves either way.
//
// index.js is imported first because it calls initializeApp(); the callables read that default app.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  onMeterDiscoveryCallable, onMeterInstallationCallable, onMeterLifecycleTrnCallable,
  onCreateMeterCommissioningCallable, onTakeMeterOutOfBatchCallable,
} from "../index.js";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { createProofCodec, resolveSalesBatch } from "../targetedBatches/sales-batch-resolution.js";
import { assessSalesBatch } from "../targetedBatches/sales-batch-geofence.js";
import { createGeoFenceRequest } from "../geofences/callables.js";
import { createSalesBatch } from "../targetedBatches/sales-batch-creation.js";
import { allocateNonGpsBatchAtomically } from "../targetedBatches/allocationCallable.js";
import { onAcceptRejectTargetedBatchCallable } from "../targetedBatches/acceptanceCallable.js";
import { forgetSalesCategoryMonths } from "../salesAllMeters/sales-category-month.js";
import { BATCH_CHECK_UNAVAILABLE, METER_IN_ANOTHER_TEAMS_BATCH, UNREADABLE_MESSAGE, allocationDateWords } from "../targetedBatches/batch-work-guard.js";

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^(127\.0\.0\.1|localhost):[0-9]+$/.test(host || "")) throw new Error("Firestore emulator unavailable: explicitly set a localhost FIRESTORE_EMULATOR_HOST; real projects are prohibited");
const projectId = process.env.GCLOUD_PROJECT || "demo-ireps-guard";
if (!/^demo-/.test(projectId)) throw new Error("Only a demo project may be used: real projects are prohibited");
const db = getFirestore();
const f = JSON.parse(fs.readFileSync(new URL("./fixtures/sales-batch-fixtures.json", import.meta.url), "utf8"));
f.erf.geometry = JSON.stringify(f.erf.geometry);
f.ward.geometry = JSON.stringify(f.ward.geometry);
// Rules TB-R046: only CAT meters are batched, by the LM's newest category month (last month, as the other tests).
const CATEGORY_MONTH = (() => { const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit" }).format(new Date()).split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; })();
f.sales.monthlyCategories = { [CATEGORY_MONTH]: { leakageCategory: "CAT4 - Long Gap (4+ months)", riskTier: "High", riskScore: 9 } };
const codec = createProofCodec("test-only-proof-key-not-a-real-secret");
const request = data => ({ auth: { uid: f.actor.uid, token: {} }, data });
const TB = f.tbId;

beforeEach(async () => {
  forgetSalesCategoryMonths();
  const response = await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" }); assert.equal(response.ok, true);
  await Promise.all([
    db.doc(`users/${f.actor.uid}`).set({ ...f.profile, employment: { role: "MNG", serviceProvider: { id: "MNC1" } } }),
    db.doc("ireps_erfs/ERF1").set(f.erf), db.doc("wards/ZA5241001").set(f.ward),
    db.doc("serviceProviders/MNC1").set({ status: "ACTIVE", name: "Main SP", clients: [] }),
    db.doc("serviceProviders/SP1").set({ status: "ACTIVE", name: "Test SP", clients: [{ id: "MNC1", clientType: "SP", relationshipType: "SUBC" }] }),
    db.doc("teams/TEAM1").set({ team: { status: "ACTIVE", name: "Team One" }, ownership: { mncServiceProviderId: "MNC1" }, scope: { memberUserIds: ["FWR1"] }, memberUids: ["FWR1"] }),
    db.doc("teams/TEAM2").set({ team: { status: "ACTIVE", name: "Team Two" }, ownership: { mncServiceProviderId: "MNC1" }, scope: { memberUserIds: ["FWR2"] }, memberUids: ["FWR2"] }),
    db.doc("users/FWR1").set({ profile: { displayName: "Worker One", employment: { role: "FWR", serviceProvider: { id: "SP1" } } }, employment: { role: "FWR", serviceProvider: { id: "SP1" } } }),
    db.doc("users/FWR2").set({ profile: { displayName: "Worker Two", employment: { role: "FWR", serviceProvider: { id: "SP1" } } }, employment: { role: "FWR", serviceProvider: { id: "SP1" } } }),
    // A supervisor of another service provider: SP1 is a subcontractor of MNC1, and this LM is among their
    // workbases but is not the active one. Rules TB-R060 (1.3.62) refuses them; before it, they could free
    // this batch's allocated work and hand it to their own team.
    db.doc("users/SPV9").set({ profile: { displayName: "Other Supervisor", employment: { role: "SPV", serviceProvider: { id: "SP1" } } },
      employment: { role: "SPV", serviceProvider: { id: "SP1" } }, access: { activeWorkbase: { id: "ZA9999" }, workbases: [{ id: "ZA9999" }, { id: "ZA5241" }] } }),
    db.doc("team_member_history/TEAM1__FWR1__1").set({ id: "TEAM1__FWR1__1", teamId: "TEAM1", teamName: "Team One", userUid: "FWR1", joinedAt: "2026-01-01T00:00:00.000Z", leftAt: null }),
    db.doc("team_member_history/TEAM2__FWR2__1").set({ id: "TEAM2__FWR2__1", teamId: "TEAM2", teamName: "Team Two", userUid: "FWR2", joinedAt: "2026-01-01T00:00:00.000Z", leftAt: null }),
  ]);
});
after(async () => { await db.terminate(); });

// ---------------------------------------------------------------- a batch made by the real pipeline
async function seedSales(n) {
  const ids = Array.from({ length: n }, (_, i) => `00${123 + i}`), batch = db.batch();
  for (const id of ids) {
    const row = structuredClone(f.sales); row.master.id = id; row.meterNo = id; row.meterNoNormalized = id;
    row.metadata = { createdAt: Timestamp.fromMillis(1000000), createdByUid: "ORIGINAL", createdByUser: "Original", updatedAt: Timestamp.fromMillis(1000000), updatedByUid: "ORIGINAL", updatedByUser: "Original" };
    batch.set(db.doc(`sales-all-meters/${id}`), row);
  }
  await batch.commit();
  return ids;
}
async function createBatch(n) {
  const ids = await seedSales(n);
  const intent = { tbId: TB, lmPcode: "ZA5241", source: "PREPAID_SALES_NON_GPS", salesIds: ids, reason: "Fixture selection", salesPeriodFrom: "2026-07", salesPeriodTo: "2026-08" };
  const resolved = await resolveSalesBatch({ db, request: request(intent), codec, geocode: async () => ({ ok: true, point: { latitude: -28.5, longitude: 30.5 }, provider: "Google Geocoding API" }) });
  assert.equal(resolved.rows.every(row => row.ready), true, JSON.stringify(resolved));
  intent.resolutionProofs = Object.fromEntries(resolved.rows.map(row => [row.salesId, row.proof]));
  const fence = await createGeoFenceRequest({ db, codec, request: request({ name: `Gf W1 Acacia ${TB}`, description: "Owner description", parents: { countryPcode: "ZA", provincePcode: "ZA5", dmPcode: "ZA524", lmPcode: "ZA5241", wardPcode: "ZA5241001" },
    points: f.fencePoints.map(p => ({ latitude: p[1], longitude: p[0] })), targetedBatch: intent }) });
  intent.geofenceId = fence.geofenceId;
  const assessment = await assessSalesBatch({ db, request: request(intent), codec });
  await createSalesBatch({ db, request: request({ ...intent, confirmationProof: assessment.confirmationProof, fingerprint: assessment.fingerprint, includedIds: assessment.includedIds }), codec });
  return ids;
}
const allocate = () => allocateNonGpsBatchAtomically({ db, request: request({}), parentRef: db.doc(`tb_uploads/${TB}`), tbId: TB, targetType: "TEAM", targetId: "TEAM1", actorMncId: "MNC1", actorUid: f.actor.uid, actorName: f.actor.user, startedAtMs: Date.now() });
const accept = async () => { const r = await onAcceptRejectTargetedBatchCallable.run({ auth: { uid: "FWR1", token: {} }, data: { tbId: TB, action: "ACCEPT" } }); assert.equal(r.success, true, JSON.stringify(r)); };
const data = async path => (await db.doc(path).get()).data();

// The batch's own work orders, as an allocated and accepted batch gives them to Team One.
async function allocatedBatch(n = 2) {
  const ids = await createBatch(n);
  await allocate(); await accept();
  await Promise.all(ids.map(id => db.doc(`premises/PREM_${id}`).set({ id: `PREM_${id}`, erfId: "ERF1", parents: { countryPcode: "ZA", provincePcode: "ZA5", dmPcode: "ZA524", lmPcode: "ZA5241", wardPcode: "ZA5241001" }, address: "1 TEST STREET", propertyType: "ERF RESIDENTIAL", services: {} })));
  return ids;
}

// Every document of the emulator, to prove that a refused submission wrote nothing.
async function dump() {
  const out = {};
  const walk = async collections => { for (const c of collections) for (const d of (await c.get()).docs) { out[d.ref.path] = JSON.stringify(d.data()); await walk(await d.ref.listCollections()); } };
  await walk(await db.listCollections());
  for (const d of (await db.collectionGroup("history").get()).docs) out[d.ref.path] = JSON.stringify(d.data());
  return out;
}

// ---------------------------------------------------------------- the four field-work submissions
const media = (...tags) => tags.map(tag => ({ tag, url: `https://example.test/${tag}.jpg` }));
const PARENTS = { countryPcode: "ZA", provincePcode: "ZA5", dmPcode: "ZA524", lmPcode: "ZA5241", wardPcode: "ZA5241001" };
// Rules TB-R062 (1.3.65): the ERF the form declares, because the lock is on the ERF. ERF1 is the fixture's
// own, the one the batch's rows sit on; a test that wants a place the batch does not hold names another.
const accessData = (trnType, meterNo, erfId = "ERF1") => ({ trnType, erfId, erfNo: f.erf.erfNo || "100", parents: PARENTS,
  premise: { id: `PREM_${meterNo}`, address: "1 TEST STREET", propertyType: "ERF RESIDENTIAL" }, access: { hasAccess: "yes", reason: "NAv" } });
const meterWork = (meterNo, trnType, id, erfId = "ERF1") => ({
  id, accessData: accessData(trnType, meterNo, erfId),
  ast: { astData: { astNo: meterNo, astManufacturer: "Conlog", astName: "Model X", meter: { phase: "single", type: "prepaid", category: "Normal", seal: { sealNo: "S-1", comment: "" }, keypad: { serialNo: "K-1", comment: "" }, cb: { size: "60A", comment: "" } } },
    anomalies: { anomaly: "Meter Ok", anomalyDetail: "Operationally Ok", otherAnomalies: [] }, ogs: { hasOffGridSupply: "no" }, normalisation: { actionTaken: ["none"] },
    location: { placement: "Boundary Wall", gps: { lat: -28.16, lng: 30.23 } } },
  meterType: "electricity", media: media("astNoPhoto", "sealPhoto", "keypadPhoto", "astCbPhoto"),
  status: { state: "CONNECTED" }, serviceProvider: { id: "SP1", name: "Test SP" },
});
const discovery = (meterNo, uid, erfId = "ERF1") => ({ auth: { uid, token: {} }, data: meterWork(meterNo, "METER_DISCOVERY", `TRN_MDIS_${meterNo}_${uid}`, erfId) });
const installation = (meterNo, uid) => ({ auth: { uid, token: {} }, data: meterWork(meterNo, "METER_INSTALLATION", `TRN_MINST_${meterNo}_${uid}`) });
const disconnection = (meterNo, uid) => ({ auth: { uid, token: {} }, data: {
  id: `TRN_MDCN_${meterNo}_${uid}`, accessData: { trnType: "METER_DISCONNECTION", premise: { id: `PREM_${meterNo}` }, parents: PARENTS, access: { hasAccess: "yes", reason: "NAv" } },
  ast: { astData: { astId: `AST_${meterNo}` } }, origin: { channel: "FIELD" },
  assignment: { instruction: { code: "METER_DISCONNECTION", text: "Disconnect: non-payment" }, targets: [{ type: "USER", id: uid, name: uid }] },
  media: media("astNoPhoto"), status: { state: "DISCONNECTED" }, serviceProvider: { id: "SP1", name: "Test SP" } } });
const commissioning = (meterNo, uid) => ({ auth: { uid, token: {} }, data: {
  id: `TRN_MCOM_${meterNo}_${uid}`, accessData: { trnType: "METER_COMMISSIONING", premise: { id: `PREM_${meterNo}` }, parents: PARENTS, access: { hasAccess: "yes", reason: "NAv" } },
  ast: { astData: { astId: `AST_${meterNo}` } }, commissioning: { meterWorks: "yes", tokenAccepted: "yes" },
  media: media("astNoPhoto"), serviceProvider: { id: "SP1", name: "Test SP" } } });

// A meter already discovered, so a DCN or a commissioning has an AST to work on. Only this rule is under
// test here: the later checks of each form (evidence, readings, meter state) are their own tests' business.
const seedAst = (meterNo) => db.doc(`asts/AST_${meterNo}`).set({ trnId: `AST_${meterNo}`, master: { id: meterNo, visibility: "VISIBLE" }, meterType: "electricity",
  ast: { astData: { astNo: meterNo, astId: `AST_${meterNo}`, meter: { type: "prepaid", category: "Normal", phase: "single" } } },
  accessData: { premise: { id: `PREM_${meterNo}` }, parents: PARENTS }, status: { state: "FIELD" },
  metadata: { createdAt: "2026-09-18T09:30:00.000Z", createdByUid: "FWR1", createdByUser: "Worker One", updatedAt: "2026-09-18T09:30:00.000Z", updatedByUid: "FWR1", updatedByUser: "Worker One" } });

// TB-R062: at an ERF the worker may have typed another number, so that sentence names the ERF.
async function expectedSentence(about = "meter") {
  const parent = await data(`tb_uploads/${TB}`);
  const fence = await data(`geo_fences/${parent.geofenceId}`);
  const what = about === "erf" ? "This ERF is in batch" : "This meter is in batch";
  return `${what} ${TB}, geofence ${fence.name}, allocated to Team One on ${allocationDateWords(parent.allocation.completedAt)}. Only that team can work on it.`;
}

test("a Meter Discovery on another team's batched meter is refused and writes nothing", async () => {
  const [a] = await allocatedBatch();
  const before = await dump();
  const result = await onMeterDiscoveryCallable.run(discovery(a, "FWR2"));
  assert.deepEqual([result.success, result.code], [false, METER_IN_ANOTHER_TEAMS_BATCH], JSON.stringify(result));
  assert.equal(result.message, await expectedSentence());
  assert.equal((await db.doc(`trns/TRN_MDIS_${a}_FWR2`).get()).exists, false);
  assert.deepEqual(await dump(), before, "a refused discovery writes nothing");
});

test("the batch's own team may do the same Meter Discovery", async () => {
  const [a] = await allocatedBatch();
  const result = await onMeterDiscoveryCallable.run(discovery(a, "FWR1"));
  assert.deepEqual([result.success, result.code], [true, "SUCCESS"], JSON.stringify(result));
  assert.equal((await db.doc(`trns/TRN_MDIS_${a}_FWR1`).get()).exists, true);
});

test("a Meter Installation on another team's batched meter is refused and writes nothing", async () => {
  const [a] = await allocatedBatch();
  const before = await dump();
  const result = await onMeterInstallationCallable.run(installation(a, "FWR2"));
  assert.deepEqual([result.success, result.code], [false, METER_IN_ANOTHER_TEAMS_BATCH], JSON.stringify(result));
  assert.equal(result.message, await expectedSentence());
  assert.equal((await db.doc(`trns/TRN_MINST_${a}_FWR2`).get()).exists, false);
  assert.deepEqual(await dump(), before, "a refused installation writes nothing");
});

test("the batch's own team is not stopped by this rule on a Meter Installation", async () => {
  const [a] = await allocatedBatch();
  const result = await onMeterInstallationCallable.run(installation(a, "FWR1"));
  assert.notEqual(result.code, METER_IN_ANOTHER_TEAMS_BATCH, JSON.stringify(result));
});

test("a Disconnection on another team's batched meter is refused and writes nothing", async () => {
  const [a] = await allocatedBatch();
  await seedAst(a);
  // The meter is not VISIBLE in Sales: the batch still holds the work, so the rule still bites.
  await db.doc(`sales-all-meters/${a}`).update({ "master.visibility": "INVISIBLE" });
  const before = await dump();
  const result = await onMeterLifecycleTrnCallable.run(disconnection(a, "FWR2"));
  assert.deepEqual([result.success, result.code], [false, METER_IN_ANOTHER_TEAMS_BATCH], JSON.stringify(result));
  assert.equal(result.message, await expectedSentence());
  assert.equal((await db.doc(`trns/TRN_MDCN_${a}_FWR2`).get()).exists, false);
  assert.deepEqual(await dump(), before, "a refused disconnection writes nothing");
});

test("the batch's own team is not stopped by this rule on a Disconnection", async () => {
  const [a] = await allocatedBatch();
  await seedAst(a);
  const result = await onMeterLifecycleTrnCallable.run(disconnection(a, "FWR1"));
  assert.notEqual(result.code, METER_IN_ANOTHER_TEAMS_BATCH, JSON.stringify(result));
});

test("a Commissioning on another team's batched meter is refused and writes nothing", async () => {
  const [a] = await allocatedBatch();
  await seedAst(a);
  await db.doc(`sales-all-meters/${a}`).update({ "master.visibility": "INVISIBLE" });
  const before = await dump();
  const result = await onCreateMeterCommissioningCallable.run(commissioning(a, "FWR2"));
  assert.deepEqual([result.success, result.code], [false, METER_IN_ANOTHER_TEAMS_BATCH], JSON.stringify(result));
  assert.equal(result.message, await expectedSentence());
  assert.equal((await db.doc(`trns/TRN_MCOM_${a}_FWR2`).get()).exists, false);
  assert.deepEqual(await dump(), before, "a refused commissioning writes nothing");
});

test("the batch's own team is not stopped by this rule on a Commissioning", async () => {
  const [a] = await allocatedBatch();
  await seedAst(a);
  const result = await onCreateMeterCommissioningCallable.run(commissioning(a, "FWR1"));
  assert.notEqual(result.code, METER_IN_ANOTHER_TEAMS_BATCH, JSON.stringify(result));
});

test("a meter in no batch is free for any team, and a VISIBLE batched meter is free again", async () => {
  // One meter, so the batch holds one ERF; rules TB-R062 (1.3.65) locks the ERF, so a second row of the
  // same batch on the same ERF would hold it whatever this meter's own state is.
  const [a] = await allocatedBatch(1);
  // A meter in no batch, at a place this batch does not hold: free for anybody.
  await db.doc("premises/PREM_99999").set({ id: "PREM_99999", erfId: "ERF2", parents: PARENTS, address: "2 TEST STREET", propertyType: "ERF RESIDENTIAL", services: {} });
  const free = await onMeterDiscoveryCallable.run(discovery("99999", "FWR2", "ERF2"));
  assert.deepEqual([free.success, free.code], [true, "SUCCESS"], JSON.stringify(free));

  await seedAst(a);
  // TB-R056 closes the batch row of a found meter; a VISIBLE Sales meter is completed, so later work is ordinary work.
  await db.doc(`sales-all-meters/${a}`).update({ "master.visibility": "VISIBLE" });
  const visible = await onCreateMeterCommissioningCallable.run(commissioning(a, "FWR2"));
  assert.notEqual(visible.code, METER_IN_ANOTHER_TEAMS_BATCH, JSON.stringify(visible));
});

test("a Completed batch row releases the meter, and an unallocated batch never held it", async () => {
  const [a] = await allocatedBatch(1);
  await seedAst(a);
  await db.doc(`sales-all-meters/${a}`).update({ "master.visibility": "INVISIBLE" });
  const rowId = (await db.collection("tb_rows").where("salesAllMeterId", "==", a).get()).docs[0].id;
  await db.doc(`tb_rows/${rowId}`).update({ "execution.status": "COMPLETED", "execution.completedAt": Timestamp.now() });
  const completed = await onCreateMeterCommissioningCallable.run(commissioning(a, "FWR2"));
  assert.notEqual(completed.code, METER_IN_ANOTHER_TEAMS_BATCH, JSON.stringify(completed));

  await db.doc(`tb_rows/${rowId}`).update({ "execution.status": "NOT_STARTED", "execution.completedAt": null });
  assert.equal((await onCreateMeterCommissioningCallable.run(commissioning(a, "FWR2"))).code, METER_IN_ANOTHER_TEAMS_BATCH, "the row is open again, so the batch holds the meter");

  // Rules 1.3.62: a batch being allocated, or whose allocation failed, already names a team, so it is not
  // free. Only a batch that names nobody at all is.
  for (const status of ["ALLOCATING", "ALLOCATION_FAILED", "NOT_STARTED"]) {
    await db.doc(`tb_uploads/${TB}`).update({ "allocation.status": status });
    assert.equal((await onCreateMeterCommissioningCallable.run(commissioning(a, "FWR2"))).code, METER_IN_ANOTHER_TEAMS_BATCH, `allocation ${status} still names Team One`);
  }
  await db.doc(`tb_uploads/${TB}`).update({ "allocation.status": "NOT_STARTED", "allocation.targetId": FieldValue.delete(), "allocation.targetType": FieldValue.delete(), "allocation.targetName": FieldValue.delete() });
  assert.notEqual((await onCreateMeterCommissioningCallable.run(commissioning(a, "FWR2"))).code, METER_IN_ANOTHER_TEAMS_BATCH, "nobody has been given this work");
});

// Rules 1.3.62: iREPS never lets work through because a read failed. Even the batch's own team is stopped,
// and the phone is told to try again.
test("work is refused, and nothing is written, when iREPS cannot check which batch the meter is in", async () => {
  const [a] = await allocatedBatch();
  await seedAst(a);
  await db.doc(`sales-all-meters/${a}`).update({ "master.visibility": "INVISIBLE" });
  const parent = await data(`tb_uploads/${TB}`);

  // The batch the meter names cannot be read.
  await db.doc(`tb_uploads/${TB}`).delete();
  const before = await dump();
  const gone = await onCreateMeterCommissioningCallable.run(commissioning(a, "FWR1"));
  assert.deepEqual([gone.success, gone.code], [false, BATCH_CHECK_UNAVAILABLE], JSON.stringify(gone));
  assert.equal(gone.message, "iREPS could not check which batch this meter is in. Nothing was saved. Please try again.");
  assert.equal(gone.message, UNREADABLE_MESSAGE);
  assert.deepEqual(await dump(), before, "nothing is written when iREPS cannot check");

  // Which batch the meter is in cannot be read.
  await db.doc(`tb_uploads/${TB}`).set(parent);
  await db.doc(`sales-all-meters/${a}`).update({ targetedBatchId: "not a batch id" });
  const unreadable = await onCreateMeterCommissioningCallable.run(commissioning(a, "FWR1"));
  assert.deepEqual([unreadable.success, unreadable.code], [false, BATCH_CHECK_UNAVAILABLE], JSON.stringify(unreadable));
  assert.equal(unreadable.message, UNREADABLE_MESSAGE);
  assert.equal((await db.doc(`trns/TRN_MCOM_${a}_FWR1`).get()).exists, false);

  // A Meter Discovery, which checks before it opens its transaction, is refused in the same words.
  const discovered = await onMeterDiscoveryCallable.run(discovery(a, "FWR1"));
  assert.deepEqual([discovered.success, discovered.code], [false, BATCH_CHECK_UNAVAILABLE], JSON.stringify(discovered));
});

// ---------------------------------------------------------------- TB-R060: taking a meter out of a batch
const takeOut = (uid, meterNos, reasonText = "Batched by mistake.") =>
  onTakeMeterOutOfBatchCallable.run({ auth: { uid, token: {} }, data: { tbId: TB, meterNos, reasonText } });

// Nothing of the batch, its rows, its Sales records or their history may move when a take-out is refused.
async function refusedTakeOut(expected, run) {
  const before = await dump();
  assert.deepEqual(await run(), expected);
  assert.deepEqual(await dump(), before, "a refused take-out writes nothing");
}

test("a supervisor of another service provider cannot take a meter out, and learns nothing about the batch", async () => {
  const [a] = await allocatedBatch();
  const hidden = { success: false, code: "PARENT_MISSING", message: `Batch ${TB} could not be read, so nothing was changed.` };

  // The LM is among their workbases but is not their active one.
  await refusedTakeOut(hidden, () => takeOut("SPV9", [a], "I want this meter for my own team."));

  // Even with the batch's LM as their active workbase: they are a subcontractor, not the main provider.
  await db.doc("users/SPV9").update({ "access.activeWorkbase": { id: "ZA5241" }, "access.workbases": [{ id: "ZA5241" }] });
  await refusedTakeOut(hidden, () => takeOut("SPV9", [a]));

  // A batch that is not there is answered in exactly the same words, so nobody learns which batches exist.
  await refusedTakeOut(
    { success: false, code: "PARENT_MISSING", message: "Batch TGB_20260914_012600_ZZZZ could not be read, so nothing was changed." },
    () => onTakeMeterOutOfBatchCallable.run({ auth: { uid: "SPV9", token: {} }, data: { tbId: "TGB_20260914_012600_ZZZZ", meterNos: [a], reasonText: "Anything." } }),
  );

  // A field worker of the batch's own team may not do it either, and is told plainly why.
  await refusedTakeOut(
    { success: false, code: "ACTOR_ROLE", message: "Only a supervisor or a manager may take a meter out of a batch." },
    () => takeOut("FWR1", [a]),
  );
});

test("the batch's own manager takes the meter out, and the meter is free again", async () => {
  const [a] = await allocatedBatch();
  const result = await takeOut(f.actor.uid, [a], "Batched by mistake: this meter belongs to next month's work.");
  assert.equal(result.success, true, JSON.stringify(result));
  assert.deepEqual(result.refused, []);
  assert.deepEqual(result.takenOut.map(item => item.meterNo), [a]);
  const sales = await data(`sales-all-meters/${a}`);
  assert.equal(sales.targetedBatchId, null);
  assert.deepEqual(sales.tbRefs, []);
  assert.equal((await db.collection("tb_rows").where("salesAllMeterId", "==", a).get()).empty, true, "the row left the batch");
  assert.equal((await data(`sales-all-meters/${a}/batchHistory/${TB}__REMOVED_FROM_BATCH`)).reason, "TAKEN_OUT_OF_BATCH");

  // TB-R059 and TB-R060 together: the meter is free. Rules TB-R062 (1.3.65): the batch's other row still
  // sits on the same ERF, and while it is open that ERF is still Team One's, so the place is not free yet.
  const held = await onMeterDiscoveryCallable.run(discovery(a, "FWR2"));
  assert.deepEqual([held.success, held.code], [false, METER_IN_ANOTHER_TEAMS_BATCH], JSON.stringify(held));

  // With the batch's last row on that ERF Completed, the ERF is free too, and anybody may work there.
  const otherRow = (await db.collection("tb_rows").where("tbId", "==", TB).get()).docs[0];
  await otherRow.ref.update({ "execution.status": "COMPLETED", "execution.completedAt": Timestamp.now() });
  const free = await onMeterDiscoveryCallable.run(discovery(a, "FWR2"));
  assert.deepEqual([free.success, free.code], [true, "SUCCESS"], JSON.stringify(free));
});

// ---------------------------------------------------------------- TB-R062 (1.3.65): the ERF's own team
// The hole the owner proved on DEV: a meter ending 4817 captured at ERF 3490 while the batch's own 4816
// stayed Not Started. TB-R059 looked at the meter number, so a different number at the same place walked
// past it. Here the batch's own meter stays Not Started and another team's worker discovers a DIFFERENT
// meter number on the batch's ERF. It must be refused — and let through, and recorded, when that meter is
// reported as illegally connected.
const OTHER_METER = "04817";

// The batch's own ERF, taken from the row the real pipeline created, and a premise on it for a meter the
// batch does not hold. The forms declare that same ERF, exactly as the phone does.
async function erfOfBatchedMeter(meterNo) {
  const rows = await db.collection("tb_rows").where("salesAllMeterId", "==", meterNo).get();
  const erfId = rows.docs[0].data()?.refs?.erfId;
  assert.equal(erfId, "ERF1", "the batch's row must sit on the fixture ERF");
  await db.doc(`premises/PREM_${OTHER_METER}`).set({ id: `PREM_${OTHER_METER}`, erfId, parents: PARENTS, address: "1 TEST STREET", propertyType: "ERF RESIDENTIAL", services: {} });
  return erfId;
}

// The same Meter Discovery, with the meter reported as illegally connected: the anomaly the phone offers,
// and the normalisation action that goes with it, each with the photo the form demands.
function illegallyConnected(request) {
  const next = structuredClone(request);
  next.data.ast.anomalies = { anomaly: "Illegally Connected", anomalyDetail: "Bridge Wire On The Meter", otherAnomalies: [] };
  next.data.ast.normalisation = { actionTaken: ["Illegal connection - meter disconnected"] };
  next.data.media = media("astNoPhoto", "sealPhoto", "keypadPhoto", "astCbPhoto", "anomalyPhoto", "normalisationPhoto");
  return next;
}

test("a DIFFERENT meter number at another team's batched ERF is refused, and writes nothing", async () => {
  const [a] = await allocatedBatch();
  await erfOfBatchedMeter(a);
  const before = await dump();
  const result = await onMeterDiscoveryCallable.run(discovery(OTHER_METER, "FWR2"));
  assert.deepEqual([result.success, result.code], [false, METER_IN_ANOTHER_TEAMS_BATCH], JSON.stringify(result));
  assert.equal(result.message, await expectedSentence("erf"));
  assert.equal((await db.doc(`trns/TRN_MDIS_${OTHER_METER}_FWR2`).get()).exists, false);
  assert.equal((await db.collection("batch_erf_overrides").get()).empty, true, "a refusal is never an override");
  assert.deepEqual(await dump(), before, "a refused discovery on another team's ERF writes nothing");
});

test("the batch's own team may discover a different meter on their own ERF, with nothing recorded", async () => {
  const [a] = await allocatedBatch();
  await erfOfBatchedMeter(a);
  const result = await onMeterDiscoveryCallable.run(discovery(OTHER_METER, "FWR1"));
  assert.deepEqual([result.success, result.code], [true, "SUCCESS"], JSON.stringify(result));
  assert.equal((await db.collection("batch_erf_overrides").get()).empty, true, "the ERF is their own, so no gate was used");
});

test("an illegally connected meter goes through on another team's ERF, and the use is recorded", async () => {
  const [a] = await allocatedBatch();
  const erfId = await erfOfBatchedMeter(a);
  const parent = await data(`tb_uploads/${TB}`);
  const rowBefore = (await db.collection("tb_rows").where("salesAllMeterId", "==", a).get()).docs[0];

  const result = await onMeterDiscoveryCallable.run(illegallyConnected(discovery(OTHER_METER, "FWR2")));
  assert.deepEqual([result.success, result.code], [true, "SUCCESS"], JSON.stringify(result));
  assert.equal((await db.doc(`trns/TRN_MDIS_${OTHER_METER}_FWR2`).get()).exists, true);

  // Rules TB-R062: one document per use, under the TRN id, holding the worker, their team, the ERF, the
  // batch and the team it is allocated to — so the office can count them per worker AND per team.
  const override = await data(`batch_erf_overrides/TRN_MDIS_${OTHER_METER}_FWR2`);
  assert.equal(override.rule, "TB-R062");
  assert.deepEqual(
    { uid: override.worker.uid, name: override.worker.name, teamId: override.worker.teamId, teamName: override.worker.teamName, serviceProviderId: override.worker.serviceProviderId },
    { uid: "FWR2", name: "Worker Two", teamId: "TEAM2", teamName: "Team Two", serviceProviderId: "SP1" },
  );
  assert.deepEqual([override.erfId, override.meterNo, override.trnId, override.trnType], [erfId, OTHER_METER, `TRN_MDIS_${OTHER_METER}_FWR2`, "METER_DISCOVERY"]);
  assert.deepEqual(
    { tbId: override.batch.tbId, geofenceId: override.batch.geofenceId, targetType: override.batch.targetType, targetId: override.batch.targetId, targetName: override.batch.targetName },
    { tbId: TB, geofenceId: parent.geofenceId, targetType: "TEAM", targetId: "TEAM1", targetName: "Team One" },
  );
  assert.equal(override.batch.rowMeterNo, a, "the batch row that holds the ERF is named");
  assert.equal(override.anomaly.text, "Illegally Connected; Illegal connection - meter disconnected");
  assert.equal(typeof override.recordedAt, "string");
  // Counted per worker and per team, both plain equality reads that need no new index.
  assert.equal((await db.collection("batch_erf_overrides").where("worker.uid", "==", "FWR2").get()).size, 1);
  assert.equal((await db.collection("batch_erf_overrides").where("worker.teamId", "==", "TEAM2").get()).size, 1);

  // It stays an ordinary normal-path find: the batch's row is untouched, so the allocated team keeps their
  // work and their count, and the batch's own meter is still theirs alone.
  const rowAfter = (await db.collection("tb_rows").where("salesAllMeterId", "==", a).get()).docs[0];
  assert.deepEqual(rowAfter.data(), rowBefore.data(), "the allocated team's row never moves");
  assert.deepEqual(await data(`tb_uploads/${TB}`), parent, "the batch itself never moves");
  const own = await onMeterDiscoveryCallable.run(illegallyConnected(discovery(a, "FWR2")));
  assert.deepEqual([own.success, own.code], [false, METER_IN_ANOTHER_TEAMS_BATCH], "the gate never applies to the batch's own meter number");
});

test("the ERF is free again once the batch's row on it is Completed, or the batch names nobody", async () => {
  const [a] = await allocatedBatch(1);
  await erfOfBatchedMeter(a);
  const rowId = (await db.collection("tb_rows").where("salesAllMeterId", "==", a).get()).docs[0].id;

  await db.doc(`tb_rows/${rowId}`).update({ "execution.status": "COMPLETED", "execution.completedAt": Timestamp.now() });
  const completed = await onMeterDiscoveryCallable.run(discovery(OTHER_METER, "FWR2"));
  assert.deepEqual([completed.success, completed.code], [true, "SUCCESS"], JSON.stringify(completed));
  assert.equal((await db.collection("batch_erf_overrides").get()).empty, true, "a free ERF needs no gate");

  await db.doc(`trns/TRN_MDIS_${OTHER_METER}_FWR2`).delete();
  await db.doc(`tb_rows/${rowId}`).update({ "execution.status": "NOT_STARTED", "execution.completedAt": null });
  assert.equal((await onMeterDiscoveryCallable.run(discovery(OTHER_METER, "FWR2"))).code, METER_IN_ANOTHER_TEAMS_BATCH, "the row is open again, so the ERF is the team's again");

  await db.doc(`tb_uploads/${TB}`).update({ "allocation.status": "NOT_STARTED", "allocation.targetId": FieldValue.delete(), "allocation.targetType": FieldValue.delete(), "allocation.targetName": FieldValue.delete() });
  const unallocated = await onMeterDiscoveryCallable.run(discovery(OTHER_METER, "FWR2"));
  assert.deepEqual([unallocated.success, unallocated.code], [true, "SUCCESS"], "nobody has been given this work, so the ERF holds nobody");
});

test("a row taken out of the batch stops holding its ERF (TB-R060), row by row", async () => {
  const [a] = await allocatedBatch();
  await erfOfBatchedMeter(a);
  assert.equal((await onMeterDiscoveryCallable.run(discovery(OTHER_METER, "FWR2"))).code, METER_IN_ANOTHER_TEAMS_BATCH);

  // TB-R060 deletes the row, so it stops matching the ERF by itself — but the batch's other row is on the
  // same ERF, and every row of an allocated batch holds the ERF it sits on.
  const takenOut = await takeOut(f.actor.uid, [a], "Batched by mistake: this meter belongs to next month's work.");
  assert.equal(takenOut.success, true, JSON.stringify(takenOut));
  const rows = await db.collection("tb_rows").where("tbId", "==", TB).get();
  assert.equal(rows.size, 1, "the row left the batch");
  const still = await onMeterDiscoveryCallable.run(discovery(OTHER_METER, "FWR2"));
  assert.deepEqual([still.success, still.code], [false, METER_IN_ANOTHER_TEAMS_BATCH], JSON.stringify(still));
  assert.equal(still.message.includes(TB), true, "the sentence still names the batch that holds the ERF");

  // Once the batch has no open row left on that ERF, the place is free for anybody.
  await rows.docs[0].ref.update({ "execution.status": "COMPLETED", "execution.completedAt": Timestamp.now() });
  const free = await onMeterDiscoveryCallable.run(discovery(OTHER_METER, "FWR2"));
  assert.deepEqual([free.success, free.code], [true, "SUCCESS"], JSON.stringify(free));
});
