// Targeted Batch rules TB-R063 (1.3.66): a different meter at the ERF completes the Sales meter.
// Emulator only. The owner's own case, end to end, through the real Meter Discovery callable.
//
// On 2026-09-20 a worker captured meter 04298620077 at ERF 3496 while the Sales meter expected there,
// 04297704464, stayed Not Started for ever and would be batched again. The owner refused both an office
// list and manual sweeping: "there's a meter there that actually has replaced it. You need to say it's
// completed."
//
// The batch is made by the real pipeline (resolve, geofence, assess, create, allocate, accept), and then a
// DIFFERENT meter number is discovered on the batch's own ERF. This proves:
//   - the batch row closes as Completed, marked "a different meter was found here", with the number found
//     beside the number expected (the O: / F: the Batch Report shows, meterMatch false);
//   - the Sales record reads Completed but stays INVISIBLE, and meter_master is untouched;
//   - the batch is recounted from its rows and its status follows section 14;
//   - credit follows the finder: linked to the batch for its own team, NOT linked for an outsider who came
//     through the TB-R062 illegal-connection gate;
//   - the same meter number changes nothing, a Sales meter with no batch is completed the same way, and a
//     repeat writes nothing.
//
// index.js is imported first because it calls initializeApp(); the callables read that default app.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { onMeterDiscoveryCallable } from "../index.js";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { createProofCodec, resolveSalesBatch } from "../targetedBatches/sales-batch-resolution.js";
import { assessSalesBatch } from "../targetedBatches/sales-batch-geofence.js";
import { createGeoFenceRequest } from "../geofences/callables.js";
import { createSalesBatch } from "../targetedBatches/sales-batch-creation.js";
import { allocateNonGpsBatchAtomically } from "../targetedBatches/allocationCallable.js";
import { onAcceptRejectTargetedBatchCallable } from "../targetedBatches/acceptanceCallable.js";
import { forgetSalesCategoryMonths } from "../salesAllMeters/sales-category-month.js";
import { FIELD, OUTCOME_LABEL, ROW_OUTCOME, RULE, recordDifferentMeterAtErf } from "../targetedBatches/differentMeterAtErf.js";
import { classifySalesWorkStatus, evaluateSalesBatchability } from "../salesAllMeters/sales-batch-policy.js";
import { completeTargetedBatchMeterDiscoveryInTransaction } from "../targetedBatches/premiseLink.js";

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^(127\.0\.0\.1|localhost):[0-9]+$/.test(host || "")) throw new Error("Firestore emulator unavailable: explicitly set a localhost FIRESTORE_EMULATOR_HOST; real projects are prohibited");
const projectId = process.env.GCLOUD_PROJECT || "demo-ireps-diff";
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
// The owner's numbers: the Sales meter expected at the ERF, and the meter that has replaced it.
const EXPECTED = "04297704464";
const FOUND = "04298620077";

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
    db.doc("users/FWR1").set({ profile: { displayName: "Worker One", employment: { role: "FWR", serviceProvider: { id: "SP1", name: "Test SP" } } }, employment: { role: "FWR", serviceProvider: { id: "SP1", name: "Test SP" } } }),
    db.doc("users/FWR2").set({ profile: { displayName: "Worker Two", employment: { role: "FWR", serviceProvider: { id: "SP1", name: "Test SP" } } }, employment: { role: "FWR", serviceProvider: { id: "SP1", name: "Test SP" } } }),
    db.doc("team_member_history/TEAM1__FWR1__1").set({ id: "TEAM1__FWR1__1", teamId: "TEAM1", teamName: "Team One", userUid: "FWR1", joinedAt: "2026-01-01T00:00:00.000Z", leftAt: null }),
    db.doc("team_member_history/TEAM2__FWR2__1").set({ id: "TEAM2__FWR2__1", teamId: "TEAM2", teamName: "Team Two", userUid: "FWR2", joinedAt: "2026-01-01T00:00:00.000Z", leftAt: null }),
  ]);
});
after(async () => { await db.terminate(); });

// ---------------------------------------------------------------- a batch made by the real pipeline
async function seedSales(ids) {
  const batch = db.batch();
  for (const id of ids) {
    const row = structuredClone(f.sales); row.master.id = id; row.meterNo = id; row.meterNoNormalized = id;
    row.metadata = { createdAt: Timestamp.fromMillis(1000000), createdByUid: "ORIGINAL", createdByUser: "Original", updatedAt: Timestamp.fromMillis(1000000), updatedByUid: "ORIGINAL", updatedByUser: "Original" };
    batch.set(db.doc(`sales-all-meters/${id}`), row);
  }
  await batch.commit();
  return ids;
}
async function createBatch(ids) {
  await seedSales(ids);
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

// One Sales meter, one row, one ERF: the owner's case exactly. A premise on the batch's own ERF for the
// meter that has replaced it, because the phone declares the place the work is happening on.
async function allocatedBatch() {
  await createBatch([EXPECTED]);
  await allocate(); await accept();
  for (const id of [EXPECTED, FOUND]) {
    await db.doc(`premises/PREM_${id}`).set({ id: `PREM_${id}`, erfId: "ERF1", parents: PARENTS, address: "1 TEST STREET", propertyType: "ERF RESIDENTIAL", services: {} });
  }
  const rows = await db.collection("tb_rows").where("salesAllMeterId", "==", EXPECTED).get();
  const row = rows.docs[0];
  assert.equal(row.data()?.refs?.erfId, "ERF1", "the batch's row must sit on the fixture ERF");
  return row.id;
}

// Every document of the emulator, to prove that a repeat writes nothing.
async function dump() {
  const out = {};
  const walk = async collections => { for (const c of collections) for (const d of (await c.get()).docs) { out[d.ref.path] = JSON.stringify(d.data()); await walk(await d.ref.listCollections()); } };
  await walk(await db.listCollections());
  for (const d of (await db.collectionGroup("history").get()).docs) out[d.ref.path] = JSON.stringify(d.data());
  return out;
}

// ---------------------------------------------------------------- the Meter Discovery the phone sends
const media = (...tags) => tags.map(tag => ({ tag, url: `https://example.test/${tag}.jpg` }));
const PARENTS = { countryPcode: "ZA", provincePcode: "ZA5", dmPcode: "ZA524", lmPcode: "ZA5241", wardPcode: "ZA5241001" };
const meterWork = (meterNo, trnType, id, erfId = "ERF1") => ({
  id, accessData: { trnType, erfId, erfNo: "100", parents: PARENTS, premise: { id: `PREM_${meterNo}`, address: "1 TEST STREET", propertyType: "ERF RESIDENTIAL" }, access: { hasAccess: "yes", reason: "NAv" } },
  ast: { astData: { astNo: meterNo, astManufacturer: "Conlog", astName: "Model X", meter: { phase: "single", type: "prepaid", category: "Normal", seal: { sealNo: "S-1", comment: "" }, keypad: { serialNo: "K-1", comment: "" }, cb: { size: "60A", comment: "" } } },
    anomalies: { anomaly: "Meter Ok", anomalyDetail: "Operationally Ok", otherAnomalies: [] }, ogs: { hasOffGridSupply: "no" }, normalisation: { actionTaken: ["None"] },
    location: { placement: "Boundary Wall", gps: { lat: -28.16, lng: 30.23 } } },
  meterType: "electricity", media: media("astNoPhoto", "sealPhoto", "keypadPhoto", "astCbPhoto"),
  status: { state: "CONNECTED" }, serviceProvider: { id: "SP1", name: "Test SP" },
});
const discovery = (meterNo, uid, erfId = "ERF1") => ({ auth: { uid, token: {} }, data: meterWork(meterNo, "METER_DISCOVERY", `TRN_MDIS_${meterNo}_${uid}`, erfId) });

// The same Meter Discovery, reported as illegally connected: the TB-R062 gate an outsider comes through.
function illegallyConnected(payload) {
  const next = structuredClone(payload);
  next.data.ast.anomalies = { anomaly: "Illegally Connected", anomalyDetail: "Bridge Wire On The Meter", otherAnomalies: [] };
  next.data.ast.normalisation = { actionTaken: ["Illegal connection - meter disconnected"] };
  next.data.media = media("astNoPhoto", "sealPhoto", "keypadPhoto", "astCbPhoto", "anomalyPhoto", "normalisationPhoto");
  return next;
}

// ---------------------------------------------------------------- the owner's case, end to end
test("a different meter found at the batch's ERF completes the Sales meter and closes its row", async () => {
  const rowId = await allocatedBatch();
  const parentBefore = await data(`tb_uploads/${TB}`);
  assert.equal(parentBefore.counts.completedRows, 0);
  assert.equal(classifySalesWorkStatus(await data(`sales-all-meters/${EXPECTED}`)), "NOT_STARTED", "the meter waits, Not Started, for ever");

  const result = await onMeterDiscoveryCallable.run(discovery(FOUND, "FWR1"));
  assert.deepEqual([result.success, result.code], [true, "SUCCESS"], JSON.stringify(result));

  // 1. The Sales meter reads Completed, without becoming VISIBLE and without touching the meter master.
  const sales = await data(`sales-all-meters/${EXPECTED}`);
  assert.equal(classifySalesWorkStatus(sales), "COMPLETED");
  assert.equal(sales.master.visibility, "INVISIBLE", "that number genuinely is not there");
  assert.equal((await db.doc(`meter_master/${EXPECTED}`).get()).exists, false, "the meter master is untouched");

  // 2. What was found is written on the Sales meter: the meter, the ERF, the TRN, the finder and when.
  const record = sales[FIELD];
  assert.deepEqual([record.version, record.meterNo, record.erfId, record.trnId, record.trnType, record.astId],
    [1, FOUND, "ERF1", `TRN_MDIS_${FOUND}_FWR1`, "METER_DISCOVERY", `TRN_MDIS_${FOUND}_FWR1`]);
  assert.deepEqual(record.finder, { uid: "FWR1", user: "Worker One", role: "FWR", teamId: "TEAM1", teamName: "Team One", serviceProviderId: "SP1", serviceProviderName: "Test SP" });
  assert.deepEqual([record.tbId, record.rowId, record.creditedToBatch, record.rule], [TB, rowId, true, RULE]);
  assert.equal(typeof record.foundAt.toMillis(), "number");

  // 3. The batch row closes as Completed, marked, with the numbers beside each other.
  const row = await data(`tb_rows/${rowId}`);
  assert.equal(row.execution.status, "COMPLETED");
  assert.equal(row.execution.outcome, ROW_OUTCOME);
  assert.deepEqual([row.refs.meterId, row.refs.trnId], [`TRN_MDIS_${FOUND}_FWR1`, `TRN_MDIS_${FOUND}_FWR1`]);
  const fieldWork = sales.tbRefs[0].fieldWork;
  assert.equal(fieldWork.status, "COMPLETED");
  assert.equal(fieldWork.outcomeLabel, OUTCOME_LABEL);
  assert.deepEqual([fieldWork.targetedMeterNo, fieldWork.discoveredMeterNo, fieldWork.meterMatch], [EXPECTED, FOUND, false]);

  // 4. The batch is recounted from its rows and its status follows section 14.
  const parent = await data(`tb_uploads/${TB}`);
  assert.equal(parent.counts.completedRows, 1);
  assert.equal(parent.counts.totalRows, 1);
  assert.equal(parent.status, "COMPLETED");
  assert.equal(parent.execution.status, "COMPLETED");

  // 5. The history says what happened, under a deterministic id.
  const history = await data(`tb_uploads/${TB}/history/ROW_CLOSED__${rowId}`);
  assert.equal(history.rule, RULE);
  assert.equal(history.meterMatch, false);
  assert.equal(history.creditedToBatch, true);
  assert.match(history.note, new RegExp(`A different meter \\(${FOUND}\\) was found at ERF ERF1`));

  // 6. The batch's own team found it, so the find counts as the batch's completed work.
  const trn = await data(`trns/TRN_MDIS_${FOUND}_FWR1`);
  assert.equal(trn.derived.targetedBatch.tbId, TB);
  assert.equal(trn.derived.targetedBatch.rowId, rowId);
  assert.equal(trn.derived.targetedBatch.meterMatch, false);
  assert.equal(trn.derived.targetedBatch.batchCompleted, true);

  // 7. It can never be batched again.
  assert.equal(evaluateSalesBatchability({ ...sales, id: EXPECTED }, { salesId: EXPECTED, lmPcode: "ZA5241" }).code, "SALES_STATUS_COMPLETED");

  // 8. A repeat of the rule writes nothing.
  const before = await dump();
  await recordDifferentMeterAtErf({ db, Timestamp, FieldValue, meterNo: FOUND, erfId: "ERF1", premiseId: `PREM_${FOUND}`, trnId: `TRN_MDIS_${FOUND}_FWR1`, trnType: "METER_DISCOVERY", astId: `TRN_MDIS_${FOUND}_FWR1`, uid: "FWR1" });
  assert.deepEqual(await dump(), before, "a repeat of TB-R063 writes nothing");
});

test("the batch's own meter number changes nothing: that meter was not replaced", async () => {
  const rowId = await allocatedBatch();
  const result = await onMeterDiscoveryCallable.run(discovery(EXPECTED, "FWR1"));
  assert.deepEqual([result.success, result.code], [true, "SUCCESS"], JSON.stringify(result));
  const sales = await data(`sales-all-meters/${EXPECTED}`);
  assert.equal(sales[FIELD], undefined, "the meter on the Sales list is the one that was found");
  assert.equal(classifySalesWorkStatus(sales), "NOT_STARTED");
  assert.equal((await data(`tb_rows/${rowId}`)).execution.status, "NOT_STARTED");
});

// Rules TB-R062 (1.3.65) and TB-R063: an outsider comes through the illegal-connection gate. The row still
// closes, but the find is NOT linked to the batch, so the Allocation Matrix counts it as that worker's own
// transaction and the batch's team is not credited with work they did not do.
test("an outsider through the illegal-connection gate closes the row without being credited to the batch", async () => {
  const rowId = await allocatedBatch();
  const result = await onMeterDiscoveryCallable.run(illegallyConnected(discovery(FOUND, "FWR2")));
  assert.deepEqual([result.success, result.code], [true, "SUCCESS"], JSON.stringify(result));

  const sales = await data(`sales-all-meters/${EXPECTED}`);
  assert.equal(classifySalesWorkStatus(sales), "COMPLETED", "the Sales meter has still been replaced");
  assert.equal(sales.master.visibility, "INVISIBLE");
  assert.equal(sales[FIELD].creditedToBatch, false);
  assert.deepEqual([sales[FIELD].finder.uid, sales[FIELD].finder.teamId], ["FWR2", "TEAM2"]);
  assert.equal((await data(`tb_rows/${rowId}`)).execution.status, "COMPLETED", "nobody is sent back");

  const trn = await data(`trns/TRN_MDIS_${FOUND}_FWR2`);
  assert.equal(trn.derived?.targetedBatch, undefined, "the find stays the finder's own transaction");
  assert.equal((await data(`tb_uploads/${TB}/history/ROW_CLOSED__${rowId}`)).creditedToBatch, false);
  // The TB-R062 gate was still recorded for the office, per worker and per team.
  assert.equal((await data(`batch_erf_overrides/TRN_MDIS_${FOUND}_FWR2`)).worker.teamId, "TEAM2");
});

test("a Sales meter with no batch is completed the same way, because the check is on the ERF", async () => {
  await allocatedBatch();
  // A Sales meter of its own, at a place this batch does not hold, in no batch at all.
  const lonely = "04291111111";
  await seedSales([lonely]);
  await db.doc(`sales-all-meters/${lonely}`).update({ erfId: "ERF2", targetedBatchId: null });
  await db.doc("premises/PREM_04292222222").set({ id: "PREM_04292222222", erfId: "ERF2", parents: PARENTS, address: "2 TEST STREET", propertyType: "ERF RESIDENTIAL", services: {} });

  const result = await onMeterDiscoveryCallable.run(discovery("04292222222", "FWR2", "ERF2"));
  assert.deepEqual([result.success, result.code], [true, "SUCCESS"], JSON.stringify(result));
  const sales = await data(`sales-all-meters/${lonely}`);
  assert.equal(classifySalesWorkStatus(sales), "COMPLETED");
  assert.deepEqual([sales[FIELD].tbId, sales[FIELD].rowId, sales[FIELD].creditedToBatch], [null, null, false]);
  assert.equal(sales.master.visibility, "INVISIBLE");
});

// The sales path: the batch's own team opened the row on the phone (premiseLink left it In Progress on its
// premise) and then captured a DIFFERENT number there. TB-R063 runs as the discovery is saved, before the
// batch's own completion trigger. This proves the two cannot fight: the row closes once, keeping its start
// time, and the batch completion that follows sees its own linkage and writes nothing.
test("on the sales path the row closes once, and the batch completion that follows writes nothing", async () => {
  const rowId = await allocatedBatch();
  const startedAt = Timestamp.fromMillis(Date.now() - 60 * 60 * 1000);
  await db.doc(`tb_rows/${rowId}`).update({ "execution.status": "IN_PROGRESS", "execution.startedAt": startedAt, "refs.premiseId": `PREM_${EXPECTED}` });
  await db.doc(`tb_uploads/${TB}`).update({ "counts.executionStartedRows": 1 });

  // The premise and the Sales tbRef as premiseLink leaves them when the team opens the row on the phone.
  const row = await data(`tb_rows/${rowId}`);
  const context = { sourceModule: "SALES_TARGETED_BATCH", operationType: "METER_DISCOVERY", tbId: TB, rowId, rowNo: row.rowNo, salesDocId: EXPECTED, erfId: "ERF1", meterNo: EXPECTED, accountNumber: null, customerName: null };
  await db.doc(`premises/PREM_${EXPECTED}`).update({ targetedBatchContext: context });
  const tbRef = (await data(`sales-all-meters/${EXPECTED}`)).tbRefs[0];
  await db.doc(`sales-all-meters/${EXPECTED}`).update({ tbRefs: [{ ...tbRef, rowId, fieldWork: { status: "IN_PROGRESS", updatedAt: startedAt } }] });

  const payload = discovery(FOUND, "FWR1");
  payload.data.targetedBatchContext = context;
  payload.data.accessData.premise = { id: `PREM_${EXPECTED}`, address: "1 TEST STREET", propertyType: "ERF RESIDENTIAL" };
  const result = await onMeterDiscoveryCallable.run(payload);
  assert.deepEqual([result.success, result.code], [true, "SUCCESS"], JSON.stringify(result));

  const closed = await data(`tb_rows/${rowId}`);
  assert.deepEqual([closed.execution.status, closed.execution.outcome], ["COMPLETED", ROW_OUTCOME]);
  assert.equal(closed.execution.startedAt.toMillis(), startedAt.toMillis(), "the row keeps the time the team started it");
  assert.equal(closed.refs.premiseId, `PREM_${EXPECTED}`, "a premise the row already had is kept");

  // The batch's own completion (premiseLink.js), which the Meter Discovery trigger runs next, is a no-op.
  const before = await dump();
  const completion = await db.runTransaction(transaction => completeTargetedBatchMeterDiscoveryInTransaction({
    transaction, db, trnData: { ...payload.data, id: payload.data.id }, astId: payload.data.id, normalizedMeterNo: FOUND,
  }));
  assert.deepEqual([completion.applied, completion.alreadyCompleted], [true, true]);
  assert.deepEqual(await dump(), before, "the batch completion writes nothing over TB-R063's close");
});
