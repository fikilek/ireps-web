// Targeted Batch rules 1.3.52, TB-R056: a batch row follows its Sales meter. Emulator only.
// Batches are made by the real pipeline (resolve, geofence, assess, create, allocate, accept); a find is seeded as
// onMeterDiscoveryCreated leaves it (AST, TRN, meter_master link) and the Sales record then turns VISIBLE.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { createProofCodec, resolveSalesBatch } from "../targetedBatches/sales-batch-resolution.js";
import { assessSalesBatch } from "../targetedBatches/sales-batch-geofence.js";
import { createGeoFenceRequest } from "../geofences/callables.js";
import { createSalesBatch } from "../targetedBatches/sales-batch-creation.js";
import { allocateNonGpsBatchAtomically } from "../targetedBatches/allocationCallable.js";
import { onAcceptRejectTargetedBatchCallable } from "../targetedBatches/acceptanceCallable.js";
import { deleteSalesBatch } from "../targetedBatches/deleteCallable.js";
import { unallocateSalesBatch } from "../targetedBatches/unallocateCallable.js";
import { forgetSalesCategoryMonths } from "../salesAllMeters/sales-category-month.js";
import { applyRowFollowsSales, onSalesMeterVisibleBatchRow, onTargetedBatchStateRowFollowsSales } from "../targetedBatches/rowFollowsSalesTrigger.js";
import { inspectSalesTbRefsIntegrity } from "../salesAllMeters/sales-batch-policy.js";

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^(127\.0\.0\.1|localhost):[0-9]+$/.test(host || "")) throw new Error("Firestore emulator unavailable: explicitly set a localhost FIRESTORE_EMULATOR_HOST; real projects are prohibited");
const projectId = "demo-ireps-tbr056";
const app = initializeApp({ projectId });
const db = getFirestore(app);
const f = JSON.parse(fs.readFileSync(new URL("./fixtures/sales-batch-fixtures.json", import.meta.url), "utf8"));
f.erf.geometry = JSON.stringify(f.erf.geometry);
f.ward.geometry = JSON.stringify(f.ward.geometry);
// Rules TB-R046: only CAT meters are batched, by the LM's newest category month (last month, as the creation tests).
const CATEGORY_MONTH = (() => { const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit" }).format(new Date()).split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; })();
f.sales.monthlyCategories = { [CATEGORY_MONTH]: { leakageCategory: "CAT4 - Long Gap (4+ months)", riskTier: "High", riskScore: 9 } };
const codec = createProofCodec("test-only-proof-key-not-a-real-secret");
const request = data => ({ auth: { uid: f.actor.uid, token: {} }, data });
const geocode = async () => ({ ok: true, point: { latitude: -28.5, longitude: 30.5 }, provider: "Google Geocoding API" });
const TB = f.tbId;
const logs = [];
const log = { info: (message, data) => logs.push({ level: "info", message, data }), warn: (message, data) => logs.push({ level: "warn", message, data }) };
const run = salesId => applyRowFollowsSales({ db, salesId, log });

beforeEach(async () => {
  forgetSalesCategoryMonths();
  logs.length = 0;
  const response = await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" }); assert.equal(response.ok, true);
  await Promise.all([
    db.doc(`users/${f.actor.uid}`).set({ ...f.profile, employment: { role: "MNG", serviceProvider: { id: "MNC1" } } }),
    db.doc("ireps_erfs/ERF1").set(f.erf), db.doc("wards/ZA5241001").set(f.ward),
    db.doc("serviceProviders/MNC1").set({ status: "ACTIVE", name: "Main SP", clients: [] }),
    db.doc("serviceProviders/SP1").set({ status: "ACTIVE", name: "Test SP", clients: [{ id: "MNC1", clientType: "SP", relationshipType: "SUBC" }] }),
    db.doc("teams/TEAM1").set({ team: { status: "ACTIVE", name: "Team One" }, ownership: { mncServiceProviderId: "MNC1" }, scope: { memberUserIds: ["FWR1"] }, memberUids: ["FWR1"] }),
    db.doc("teams/TEAM2").set({ team: { status: "ACTIVE", name: "Team Two" }, ownership: { mncServiceProviderId: "MNC1" }, scope: { memberUserIds: ["FWR2"] }, memberUids: ["FWR2"] }),
    db.doc("users/FWR1").set({ profile: { displayName: "Worker One", employment: { role: "FWR", serviceProvider: { id: "SP1" } } } }),
    db.doc("users/FWR2").set({ profile: { displayName: "Worker Two", employment: { role: "FWR", serviceProvider: { id: "SP1" } } } }),
    db.doc("team_member_history/TEAM1__FWR1__1").set({ id: "TEAM1__FWR1__1", teamId: "TEAM1", teamName: "Team One", userUid: "FWR1", joinedAt: "2026-01-01T00:00:00.000Z", leftAt: null }),
    db.doc("team_member_history/TEAM2__FWR2__1").set({ id: "TEAM2__FWR2__1", teamId: "TEAM2", teamName: "Team Two", userUid: "FWR2", joinedAt: "2026-01-01T00:00:00.000Z", leftAt: null }),
  ]);
});
after(async () => { await db.terminate(); await deleteApp(app); });

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
  const resolved = await resolveSalesBatch({ db, request: request(intent), codec, geocode });
  assert.equal(resolved.rows.every(row => row.ready), true, JSON.stringify(resolved));
  intent.resolutionProofs = Object.fromEntries(resolved.rows.map(row => [row.salesId, row.proof]));
  const fence = await createGeoFenceRequest({ db, codec, request: request({ name: `Gf W1 Test ${TB}`, description: "Owner description", parents: { countryPcode: "ZA", provincePcode: "ZA5", dmPcode: "ZA524", lmPcode: "ZA5241", wardPcode: "ZA5241001" },
    points: f.fencePoints.map(p => ({ latitude: p[1], longitude: p[0] })), targetedBatch: intent }) });
  intent.geofenceId = fence.geofenceId;
  const assessment = await assessSalesBatch({ db, request: request(intent), codec });
  await createSalesBatch({ db, request: request({ ...intent, confirmationProof: assessment.confirmationProof, fingerprint: assessment.fingerprint, includedIds: assessment.includedIds }), codec });
  return ids;
}
const allocate = () => allocateNonGpsBatchAtomically({ db, request: request({}), parentRef: db.doc(`tb_uploads/${TB}`), tbId: TB, targetType: "TEAM", targetId: "TEAM1", actorMncId: "MNC1", actorUid: f.actor.uid, actorName: f.actor.user, startedAtMs: Date.now() });
const accept = async () => { const r = await onAcceptRejectTargetedBatchCallable.run({ auth: { uid: "FWR1", token: {} }, data: { tbId: TB, action: "ACCEPT" } }); assert.equal(r.success, true, JSON.stringify(r)); };
const unallocate = async () => unallocateSalesBatch({ db, request: { auth: { uid: f.actor.uid, token: {} }, data: { tbId: TB, expectedTargetType: "TEAM", expectedTargetId: "TEAM1",
  expectedAllocatedAtMillis: (await db.doc(`tb_uploads/${TB}`).get()).data().allocation.completedAt.toMillis(), reason: "Allocated to the wrong team" } } });
const remove = () => deleteSalesBatch({ db, request: request({ tbId: TB, reason: "Owner fixture removal" }) });

// A find as onMeterDiscoveryCreated leaves it, then the Sales record turns VISIBLE (MV-R001).
async function find(salesId, uid, { at = "2026-09-18T09:30:00.000Z", visible = true } = {}) {
  const trnId = `TRN_MDIS_${salesId}_${uid}`;
  await db.doc(`asts/${trnId}`).set({ trnId, ast: { astData: { astNo: salesId, astId: trnId } }, metadata: { createdAt: at, createdByUid: uid, createdByUser: uid === "FWR1" ? "Worker One" : "Worker Two", updatedAt: at, updatedByUid: uid, updatedByUser: uid } });
  await db.doc(`trns/${trnId}`).set({ id: trnId, accessData: { trnType: "METER_DISCOVERY", access: { hasAccess: "yes" }, premise: { id: `PREM_${salesId}` }, erfId: "ERF1" }, ast: { astData: { astNo: salesId } }, metadata: { createdAt: at, createdByUid: uid } });
  await db.doc(`meter_master/${salesId}`).set({ id: salesId, refs: { asts: { id: trnId }, sales: { id: salesId } } });
  if (visible) await db.doc(`sales-all-meters/${salesId}`).update({ "master.visibility": "VISIBLE" });
  return trnId;
}
const rowOf = async salesId => (await db.collection("tb_rows").where("salesAllMeterId", "==", salesId).get()).docs.map(d => d.data())[0] ?? null;
const data = async path => (await db.doc(path).get()).data();
const history = async () => Object.fromEntries((await db.collection(`tb_uploads/${TB}/history`).get()).docs.map(d => [d.id, d.data()]));
// Every document of the emulator, to prove that a run wrote nothing.
async function dump() {
  const out = {};
  const walk = async collections => { for (const c of collections) for (const d of (await c.get()).docs) { out[d.ref.path] = JSON.stringify(d.data()); await walk(await d.ref.listCollections()); } };
  await walk(await db.listCollections());
  // Subcollections of a deleted parent (history) are not reached through the parent.
  for (const d of (await db.collectionGroup("history").get()).docs) out[d.ref.path] = JSON.stringify(d.data());
  return out;
}
const event = (salesId, before, after) => ({ params: { salesId }, data: { before: { data: () => before }, after: { data: () => after } } });

test("found by the batch's own team: the row closes as Completed, once", async () => {
  const [a, b] = await createBatch(3);
  await allocate(); await accept();
  const salesBefore = await data(`sales-all-meters/${a}`);
  const trnId = await find(a, "FWR1");
  const result = await run(a);
  assert.deepEqual([result.decision, result.code], ["CLOSE", "FOUND_BY_BATCH_TEAM"], JSON.stringify(result));
  const row = await rowOf(a);
  assert.deepEqual([row.execution.status, row.execution.outcome, row.execution.completedAt.toDate().toISOString(), row.refs.premiseId, row.refs.meterId, row.refs.trnId, row.metadata.updatedByUid],
    ["COMPLETED", "METER_DISCOVERED_OUTSIDE_BATCH", "2026-09-18T09:30:00.000Z", `PREM_${a}`, trnId, trnId, "FWR1"]);
  const sales = await data(`sales-all-meters/${a}`);
  assert.equal(sales.targetedBatchId, TB, "closing keeps the scalar");
  assert.equal(inspectSalesTbRefsIntegrity(sales.tbRefs).valid, true);
  assert.deepEqual([sales.tbRefs[0].rowId, sales.tbRefs[0].fieldWork.status, sales.tbRefs[0].fieldWork.outcomeCode, sales.tbRefs[0].fieldWork.trnId, sales.tbRefs[0].date.toMillis()],
    [row.id, "COMPLETED", "METER_DISCOVERED", trnId, salesBefore.tbRefs[0].date.toMillis()]);
  assert.deepEqual([sales.metadata.createdAt.toMillis(), sales.metadata.updatedByUid], [1000000, "FWR1"]);
  assert.equal((await db.collection(`sales-all-meters/${a}/batchHistory`).get()).size, 1, "closing writes no Sales event");
  assert.deepEqual((await data(`trns/${trnId}`)).derived.targetedBatch, { tbId: TB, rowId: row.id, salesDocId: a, premiseId: `PREM_${a}`, meterId: trnId, trnId, meterMatch: true, batchCompleted: false });
  const parent = await data(`tb_uploads/${TB}`);
  assert.deepEqual([parent.status, parent.execution.status, parent.counts.totalRows, parent.counts.executionStartedRows, parent.counts.completedRows, parent.creation.createdRows, parent.allocation.targetId, parent.acceptance.status],
    ["IN_PROGRESS", "IN_PROGRESS", 3, 1, 1, 3, "TEAM1", "ACCEPTED"]);
  const h = (await history())[`ROW_CLOSED__${row.id}`];
  assert.deepEqual([h.event, h.rule, h.runId, h.trnId, h.finder.teamId, h.statusAfter.status], ["TARGETED_BATCH_ROW_CLOSED", "TB-R056", `TB-R056:${trnId}`, trnId, "TEAM1", "IN_PROGRESS"]);

  // A retry, and the trigger's own Sales write, change nothing.
  const snapshot = await dump();
  assert.deepEqual([(await run(a)).code], ["ROW_ALREADY_COMPLETED"]);
  assert.equal(await onSalesMeterVisibleBatchRow.run(event(a, sales, sales)), null, "VISIBLE -> VISIBLE is ignored: no loop");
  const retried = await onSalesMeterVisibleBatchRow.run(event(a, salesBefore, sales));
  assert.deepEqual(retried, { decision: "NONE", code: "ROW_ALREADY_COMPLETED" });
  assert.deepEqual(await dump(), snapshot, "a second run writes nothing");
  assert.equal((await rowOf(b)).execution.status, "NOT_STARTED", "the other rows are untouched");
});

test("the trigger itself closes the row when Sales turns VISIBLE", async () => {
  const [a] = await createBatch(2);
  await allocate(); await accept();
  await find(a, "FWR1", { visible: false });
  const before = await data(`sales-all-meters/${a}`);
  await db.doc(`sales-all-meters/${a}`).update({ "master.visibility": "VISIBLE" });
  const afterDoc = await data(`sales-all-meters/${a}`);
  assert.deepEqual(await onSalesMeterVisibleBatchRow.run(event(a, before, afterDoc)), { decision: "CLOSE", code: "FOUND_BY_BATCH_TEAM" });
  assert.equal((await rowOf(a)).execution.status, "COMPLETED");
});

test("found by another team: the row goes out, and Unallocate, Allocate and Delete still accept the batch (option A)", async () => {
  const [a, b, c] = await createBatch(3);
  await allocate(); await accept();
  const rowBefore = await rowOf(a);
  const trnId = await find(a, "FWR2");
  const result = await run(a);
  assert.deepEqual([result.decision, result.code, result.finder.teamId], ["REMOVE", "FOUND_BY_ANOTHER_TEAM", "TEAM2"], JSON.stringify(result));
  assert.equal(await rowOf(a), null, "the row is deleted");
  const sales = await data(`sales-all-meters/${a}`);
  assert.deepEqual([sales.targetedBatchId, sales.tbRefs, sales.master.visibility], [null, [], "VISIBLE"]);
  const ev = await data(`sales-all-meters/${a}/batchHistory/${TB}__REMOVED_FROM_BATCH`);
  assert.deepEqual([ev.eventType, ev.reason, ev.salesMeterStatus, ev.membershipBefore, ev.membershipAfter, ev.membershipSource, ev.actor.uid, ev.removalAudit.cleanupRunId, ev.removalAudit.ownerRule, ev.occurredAt instanceof Timestamp],
    ["REMOVED_FROM_BATCH", "FOUND_BY_ANOTHER_TEAM", "COMPLETED", TB, null, "SCALAR", "FWR2", `TB-R056:${trnId}`, "FOUND_BY_ANOTHER_TEAM", true]);
  assert.equal((await data(`trns/${trnId}`)).derived, undefined, "the finder keeps the credit through its own transaction");
  const parent = await data(`tb_uploads/${TB}`);
  assert.deepEqual([parent.status, parent.counts.totalRows, parent.counts.allocatedRows, parent.creation.createdRows, parent.creation.expectedRows], ["ALLOCATED", 2, 2, 3, 3]);
  const h = (await history())[`ROW_REMOVED__${rowBefore.id}`];
  assert.deepEqual([h.event, h.rule, h.reason, h.removedRow.id], ["TARGETED_BATCH_ROW_REMOVED", "TB-R056", "FOUND_BY_ANOTHER_TEAM", rowBefore.id]);
  // Idempotent.
  const snapshot = await dump();
  assert.equal((await run(a)).code, "NO_BATCH");
  assert.deepEqual(await dump(), snapshot, "a second run writes nothing");

  // Without the history entry the batch would not reconcile: option A is what lets it through.
  await db.doc(`tb_uploads/${TB}/history/ROW_REMOVED__${rowBefore.id}`).delete();
  await assert.rejects(unallocate(), { code: "BATCH_COUNT_MISMATCH" });
  await db.doc(`tb_uploads/${TB}/history/ROW_REMOVED__${rowBefore.id}`).set(h);

  const un = await unallocate();
  assert.deepEqual([un.success, un.code, un.rows], [true, "TARGETED_BATCH_UNALLOCATED", 2]);
  const again = await allocate();
  assert.deepEqual([again.success, again.totalRows], [true, 2], JSON.stringify(again));
  const del = await remove();
  assert.deepEqual([del.success, del.code, del.deletedRows], [true, "TARGETED_BATCH_DELETED", 2]);
  for (const id of [b, c]) assert.equal((await data(`sales-all-meters/${id}`)).targetedBatchId, null);
});

test("found while the batch is not allocated: the row goes out and Allocate still accepts the batch", async () => {
  const [a] = await createBatch(3);
  await find(a, "FWR1");
  const result = await run(a);
  assert.deepEqual([result.decision, result.code], ["REMOVE", "FOUND_WHILE_UNALLOCATED"], JSON.stringify(result));
  const parent = await data(`tb_uploads/${TB}`);
  assert.deepEqual([parent.status, parent.counts.totalRows, parent.counts.unallocatedRows, parent.allocation.status], ["READY_FOR_ALLOCATION", 2, 2, "NOT_STARTED"]);
  assert.equal((await data(`sales-all-meters/${a}/batchHistory/${TB}__REMOVED_FROM_BATCH`)).reason, "FOUND_WHILE_UNALLOCATED");
  const allocated = await allocate();
  assert.deepEqual([allocated.success, allocated.totalRows], [true, 2], JSON.stringify(allocated));
  assert.equal((await data(`tb_uploads/${TB}`)).counts.allocatedRows, 2);
});

test("a batch left with no rows is deleted, its history and geofence kept", async () => {
  const [a] = await createBatch(1);
  const fenceBefore = (await db.collection("geo_fences").where("targetedBatch.tbId", "==", TB).get()).docs[0].data();
  const trnId = await find(a, "FWR1");
  const result = await run(a);
  assert.deepEqual([result.decision, result.after.action], ["REMOVE", "DELETE"], JSON.stringify(result));
  assert.equal((await db.doc(`tb_uploads/${TB}`).get()).exists, false);
  assert.equal((await db.collection("tb_rows").where("tbId", "==", TB).get()).size, 0);
  const h = await history();
  assert.deepEqual(Object.keys(h).sort(), [`BATCH_DELETED__TB-R056:${trnId}`, `ROW_REMOVED__${result.rowId}`]);
  assert.equal(h[`BATCH_DELETED__TB-R056:${trnId}`].event, "TARGETED_BATCH_DELETED");
  assert.deepEqual((await db.collection("geo_fences").where("targetedBatch.tbId", "==", TB).get()).docs[0].data(), fenceBefore, "the geofence is untouched");
  assert.equal((await data(`sales-all-meters/${a}`)).targetedBatchId, null);
  const snapshot = await dump();
  assert.equal((await run(a)).code, "NO_BATCH");
  assert.deepEqual(await dump(), snapshot);
});

test("a sales-path find that already completed the row is left alone", async () => {
  const [a] = await createBatch(2);
  await allocate(); await accept();
  const trnId = await find(a, "FWR1", { visible: false });
  // As a batch completion leaves it (premiseLink.js completeTargetedBatchMeterDiscoveryInTransaction), in the same commit as VISIBLE.
  const row = await rowOf(a);
  const sales = await data(`sales-all-meters/${a}`);
  const at = Timestamp.fromMillis(Date.parse("2026-09-18T09:30:00Z"));
  await db.doc(`tb_rows/${row.id}`).update({ "execution.status": "COMPLETED", "execution.startedAt": at, "execution.completedAt": at, "execution.outcome": "METER_DISCOVERED", "refs.premiseId": `PREM_${a}`, "refs.meterId": trnId, "refs.trnId": trnId });
  await db.doc(`sales-all-meters/${a}`).update({ "master.visibility": "VISIBLE", tbRefs: [{ ...sales.tbRefs[0], rowId: row.id, fieldWork: { status: "COMPLETED", outcomeCode: "METER_DISCOVERED", outcomeLabel: "Meter Discovered", targetedMeterNo: a, discoveredMeterNo: a, meterMatch: true, premiseId: `PREM_${a}`, meterId: trnId, trnId, submittedAt: at, updatedAt: at } }] });
  await db.doc(`tb_uploads/${TB}`).update({ status: "IN_PROGRESS", "execution.status": "IN_PROGRESS", "execution.startedAt": at, "counts.executionStartedRows": 1, "counts.completedRows": 1 });
  const snapshot = await dump();
  const result = await run(a);
  assert.deepEqual([result.decision, result.code], ["NONE", "ROW_ALREADY_COMPLETED"]);
  assert.deepEqual(await dump(), snapshot, "nothing is written");
});

test("finder unknown or membership unresolved: nothing changes, the case is logged", async () => {
  const [a, b] = await createBatch(2);
  await allocate(); await accept();
  await db.doc("users/NOTEAM").set({ profile: { displayName: "Nobody", employment: { role: "FWR" } } });
  await find(a, "NOTEAM");
  let snapshot = await dump();
  const unknown = await run(a);
  assert.deepEqual([unknown.decision, unknown.code, unknown.detail], ["LOG", "FINDER_UNKNOWN", "NO_TEAM_OR_SERVICE_PROVIDER"]);
  assert.deepEqual(await dump(), snapshot);
  assert.equal(logs.at(-1).level, "warn");
  assert.equal(logs.at(-1).data.code, "TB_R056_FINDER_UNKNOWN");

  await db.doc(`sales-all-meters/${b}`).update({ targetedBatchId: "NOT_A_BATCH", "master.visibility": "VISIBLE" });
  snapshot = await dump();
  const unresolved = await run(b);
  assert.deepEqual([unresolved.decision, unresolved.code], ["LOG", "MEMBERSHIP_UNRESOLVED"]);
  assert.equal(logs.at(-1).data.code, "TB_R056_MEMBERSHIP_UNRESOLVED");
  assert.deepEqual(await dump(), snapshot);
});

test("two meters of one batch found by its team one after the other complete the batch", async () => {
  const [a, b] = await createBatch(2);
  await allocate(); await accept();
  const trnA = await find(a, "FWR1", { at: "2026-09-18T09:00:00.000Z" });
  const trnB = await find(b, "FWR1", { at: "2026-09-18T10:00:00.000Z" });
  await Promise.all([run(a), run(b)]);
  const parent = await data(`tb_uploads/${TB}`);
  assert.deepEqual([parent.status, parent.execution.status, parent.counts.completedRows, parent.execution.completedAt.toDate().toISOString()], ["COMPLETED", "COMPLETED", 2, "2026-09-18T10:00:00.000Z"]);
  const marks = [(await data(`trns/${trnA}`)).derived.targetedBatch.batchCompleted, (await data(`trns/${trnB}`)).derived.targetedBatch.batchCompleted].sort();
  assert.deepEqual(marks, [false, true], "the find that completed the batch says so");
});

// ---------------------------------------------------------------- held cases are decided again when the batch settles
const batchEvent = (before, afterDoc) => ({ params: { tbId: TB }, data: { before: { data: () => before }, after: { data: () => afterDoc } } });

test("found by the batch's own team before it accepted: held, then closed when the team accepts", async () => {
  const [a, b] = await createBatch(2);
  await allocate();
  const trnId = await find(a, "FWR1");
  const snapshot = await dump();
  const held = await run(a);
  assert.deepEqual([held.decision, held.code], ["LOG", "PARENT_NOT_ACCEPTED"], JSON.stringify(held));
  assert.deepEqual(await dump(), snapshot, "nothing is written while the batch waits");
  const before = await data(`tb_uploads/${TB}`);
  await accept();
  const afterDoc = await data(`tb_uploads/${TB}`);
  const results = await onTargetedBatchStateRowFollowsSales.run(batchEvent(before, afterDoc));
  assert.deepEqual(results, [{ salesId: a, decision: "CLOSE", code: "FOUND_BY_BATCH_TEAM" }], "only the VISIBLE meter with an open row");
  const row = await rowOf(a);
  assert.deepEqual([row.execution.status, row.refs.trnId], ["COMPLETED", trnId]);
  assert.equal((await rowOf(b)).execution.status, "NOT_STARTED");
  // The rule's own write to the batch (counts, status) does not run it again.
  const settled = await data(`tb_uploads/${TB}`);
  assert.equal(await onTargetedBatchStateRowFollowsSales.run(batchEvent(afterDoc, settled)), null);
});

test("found by the batch's own team before it accepted, then unallocated: the row goes out when the batch is unallocated", async () => {
  const [a] = await createBatch(2);
  await allocate();
  await find(a, "FWR1");
  assert.equal((await run(a)).code, "PARENT_NOT_ACCEPTED");
  const before = await data(`tb_uploads/${TB}`);
  const un = await unallocate();
  assert.equal(un.success, true, JSON.stringify(un));
  const results = await onTargetedBatchStateRowFollowsSales.run(batchEvent(before, await data(`tb_uploads/${TB}`)));
  assert.deepEqual(results, [{ salesId: a, decision: "REMOVE", code: "FOUND_WHILE_UNALLOCATED" }]);
  assert.equal(await rowOf(a), null);
  const allocated = await allocate();
  assert.deepEqual([allocated.success, allocated.totalRows], [true, 1], JSON.stringify(allocated));
});

test("a batch is not deleted while another Sales record still names it in a tbRef with other keys", async () => {
  const [a, other] = await createBatch(2);
  // A legacy record without the scalar, whose tbRef carries rowId and fieldWork (array-contains of {id, date} misses it).
  const otherRef = { ...(await data(`sales-all-meters/${other}`)).tbRefs[0], rowId: "TBR_EARLIER", fieldWork: { status: "IN_PROGRESS", updatedAt: Timestamp.fromMillis(2000000) } };
  await db.doc(`sales-all-meters/${other}`).update({ targetedBatchId: null, tbRefs: [otherRef] });
  await db.doc(`tb_rows/${(await rowOf(other)).id}`).delete();
  await db.doc(`tb_uploads/${TB}`).update({ "counts.totalRows": 1, "counts.acceptedRows": 1, "counts.allocatableRows": 1, "counts.unallocatedRows": 1 });
  await find(a, "FWR1");
  const snapshot = await dump();
  const result = await run(a);
  assert.deepEqual([result.decision, result.code, result.namedBy], ["LOG", "NAMED_BY_OTHER_SALES", [other]], JSON.stringify(result));
  assert.deepEqual(await dump(), snapshot, "nothing is written");
});

test("an old Non-GPS batch loses a found row and can still be allocated, and allocated again (option A counts it too)", async () => {
  const [a, b] = await createBatch(3);
  // As a batch of the old format (no geofence count check; Allocate counts it against creation.expectedRows).
  await db.doc(`tb_uploads/${TB}`).update({ schemaVersion: "0.2.0" });
  await find(a, "FWR1");
  const removed = await run(a);
  assert.deepEqual([removed.decision, removed.code], ["REMOVE", "FOUND_WHILE_UNALLOCATED"], JSON.stringify(removed));
  const parent = await data(`tb_uploads/${TB}`);
  assert.deepEqual([parent.counts.totalRows, parent.creation.expectedRows], [2, 3]);
  const allocated = await allocate();
  assert.deepEqual([allocated.success, allocated.totalRows], [true, 2], JSON.stringify(allocated));
  // Allocated: another team finds a second meter; the row goes out and a repeat Allocate still says already allocated.
  await find(b, "FWR2");
  assert.equal((await run(b)).code, "FOUND_BY_ANOTHER_TEAM");
  const again = await allocate();
  assert.deepEqual([again.success, again.alreadyAllocated, again.totalRows], [true, true, 1], JSON.stringify(again));
});
