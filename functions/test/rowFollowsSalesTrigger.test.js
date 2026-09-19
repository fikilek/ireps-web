// Targeted Batch rules 1.3.52, TB-R056: the triggers around the policy. A temporary Firestore failure is thrown so the
// trigger (retry: true) runs again, up to a day; a batch whose allocation or acceptance changes runs the rule again.
import test from "node:test";
import assert from "node:assert/strict";
import { applyRowFollowsSales, handleSalesVisibleEvent, handleBatchStateEvent, batchStateChanged, isTransientError, salesNamesBatch, reapplyRowFollowsSalesForBatch, MAX_EVENT_AGE_MS }
  from "../targetedBatches/rowFollowsSalesTrigger.js";

const TB = "TGB_20260913_120000_AB12";
const quiet = () => { const lines = []; return { lines, info: (m, d) => lines.push({ level: "info", m, d }), warn: (m, d) => lines.push({ level: "warn", m, d }), error: (m, d) => lines.push({ level: "error", m, d }) }; };
const failing = error => ({ runTransaction: async () => { throw error; } });
const grpc = (code, message = "failed") => Object.assign(new Error(message), { code });
const doc = data => ({ data: () => data });
const salesEvent = (time = new Date().toISOString()) => ({ time, params: { salesId: "07000000001" }, data: { before: doc({ master: { visibility: "INVISIBLE" } }), after: doc({ master: { visibility: "VISIBLE" } }) } });

test("temporary Firestore failures are told apart from fixed ones", () => {
  for (const code of [10, 14, 4, 8, 13, "aborted", "unavailable", "deadline-exceeded", "ABORTED"]) assert.equal(isTransientError(grpc(code)), true, String(code));
  for (const code of [3, 5, 6, 7, 9, "failed-precondition", undefined]) assert.equal(isTransientError(grpc(code)), false, String(code));
  assert.equal(isTransientError(new Error("plain")), false);
});

test("a temporary failure is thrown for the trigger to retry; a fixed one is logged", async () => {
  const log = quiet();
  await assert.rejects(applyRowFollowsSales({ db: failing(grpc(10, "too much contention")), salesId: "S1", log, rethrowTransient: true }), { code: 10 });
  assert.equal(log.lines.at(-1).d.code, "TB_R056_TEMPORARY_FAILURE");
  const kept = await applyRowFollowsSales({ db: failing(grpc(10)), salesId: "S1", log });
  assert.deepEqual([kept.decision, kept.code], ["LOG", "UNEXPECTED_ERROR"], "without rethrowTransient (a direct call) it is only logged");
  const fixed = await applyRowFollowsSales({ db: failing(grpc(9, "precondition")), salesId: "S1", log, rethrowTransient: true });
  assert.deepEqual([fixed.decision, fixed.code, log.lines.at(-1).level], ["LOG", "UNEXPECTED_ERROR", "warn"], "a fixed failure is never retried");
});

test("the Sales trigger rethrows a temporary failure, and drops an event that kept failing for a day", async () => {
  const log = quiet();
  let opened = 0;
  const db = () => { opened += 1; return failing(grpc(14, "unavailable")); };
  const now = Date.now();
  await assert.rejects(handleSalesVisibleEvent(salesEvent(new Date(now - 60000).toISOString()), { db, log, nowMs: now }), { code: 14 });
  assert.equal(opened, 1);
  assert.equal(await handleSalesVisibleEvent(salesEvent(new Date(now - MAX_EVENT_AGE_MS - 1).toISOString()), { db, log, nowMs: now }), null);
  assert.deepEqual([opened, log.lines.at(-1).level, log.lines.at(-1).d.code], [1, "error", "TB_R056_RETRY_EXPIRED"]);
  const same = { ...salesEvent(), data: { before: doc({ master: { visibility: "VISIBLE" } }), after: doc({ master: { visibility: "VISIBLE" } }) } };
  assert.equal(await handleSalesVisibleEvent(same, { db, log, nowMs: now }), null);
  assert.equal(opened, 1, "an event that does nothing never reads Firestore");
});

test("the batch trigger runs only when allocation or acceptance changes", async () => {
  const waiting = { allocation: { status: "ALLOCATED", targetType: "TEAM", targetId: "TEAM1" }, acceptance: { status: "WAITING" }, counts: { totalRows: 3 } };
  assert.equal(batchStateChanged(waiting, { ...waiting, acceptance: { status: "ACCEPTED" } }), true);
  assert.equal(batchStateChanged({ ...waiting, allocation: { status: "ALLOCATING" } }, waiting), true);
  assert.equal(batchStateChanged(waiting, { ...waiting, allocation: { status: "NOT_STARTED" } }), true);
  assert.equal(batchStateChanged(waiting, { ...waiting, allocation: { ...waiting.allocation, targetId: "TEAM2" } }), true);
  assert.equal(batchStateChanged(waiting, { ...waiting, counts: { totalRows: 2 }, status: "IN_PROGRESS" }), false, "the rule's own writes (counts, status) do not re-run it: no loop");
  assert.equal(batchStateChanged(waiting, undefined), false, "a deleted batch");
  let opened = 0;
  const event = { time: new Date().toISOString(), params: { tbId: TB }, data: { before: doc(waiting), after: doc({ ...waiting, counts: { totalRows: 2 } }) } };
  assert.equal(await handleBatchStateEvent(event, { db: () => { opened += 1; }, log: quiet() }), null);
  assert.equal(opened, 0);
});

test("the batch re-run takes only VISIBLE meters whose rows are still open, one after another", async () => {
  const rows = [{ salesAllMeterId: "S1", execution: { status: "NOT_STARTED" } }, { salesAllMeterId: "S2", execution: { status: "COMPLETED" } }, { salesAllMeterId: "S3" }, { salesAllMeterId: "S4", execution: { status: "IN_PROGRESS" } }];
  const visibility = { S1: "VISIBLE", S2: "VISIBLE", S3: "INVISIBLE", S4: "VISIBLE" };
  const ran = [];
  const db = {
    collection: () => ({ where: () => ({ get: async () => ({ docs: rows.map(doc) }) }) }),
    doc: path => ({ get: async () => doc({ master: { visibility: visibility[path.split("/")[1]] } }) }),
    // Each meter's transaction: read the Sales record, which here is missing, so the policy logs SALES_MISSING.
    runTransaction: async fn => { ran.push("tx"); return fn({ get: async () => ({ exists: false, data: () => undefined }) }); },
  };
  const results = await reapplyRowFollowsSalesForBatch({ db, tbId: TB, log: quiet() });
  assert.deepEqual(results.map(r => r.salesId), ["S1", "S4"]);
  assert.equal(ran.length, 2);
});

test("a Sales record names a batch by its scalar or by any tbRef, whatever the tbRef's other keys", () => {
  assert.equal(salesNamesBatch({ targetedBatchId: TB }, TB), true);
  assert.equal(salesNamesBatch({ tbRefs: [{ id: TB, date: "x", rowId: "R1", fieldWork: { status: "IN_PROGRESS" } }] }, TB), true);
  assert.equal(salesNamesBatch({ tbRefs: [{ tbId: TB, date: 1 }] }, TB), true);
  assert.equal(salesNamesBatch({ targetedBatchId: null, tbRefs: [{ id: "TGB_OTHER", date: 1 }, null] }, TB), false);
  assert.equal(salesNamesBatch(undefined, TB), false);
});
