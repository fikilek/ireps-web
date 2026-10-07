import test from "node:test";
import assert from "node:assert/strict";
import { planDiscoveryCleanupDependencies, recordedTimeToIso } from "../noAccess/discoveryCleanupDependencies.js";

const visit = (extra = {}) => ({ accessData: { trnType: "METER_DISCOVERY", access: { hasAccess: "no" } }, metadata: { createdOnDevice: "2026-10-05T07:54:00Z", createdByUser: "Peter Peter" }, ...extra });
const summary = { date: "2026-10-05", time: "07:54:00", user: "Peter Peter" };
const context = { tbId: "TGB_20260915_093300_I5Z6", rowId: "R1", salesDocId: "S1" };
const sales = (visits = [summary]) => ({ tbRefs: [{ id: context.tbId, rowId: "R1", fieldWork: { status: "IN_PROGRESS", premiseId: "P1", noAccess: visits } }, { id: "TGB_20260915_093300_I5Z7", rowId: "R2", fieldWork: { noAccess: [summary] } }] });

test("deleting a visit removes only its premise links and derived records", () => {
  const records = new Map([["trns/D1", visit()], ["premises/P1", { noAccessTrnIds: ["D1", "KEEP"], astIds: ["A1"] }], ["report_trn_no_access/D1", { id: "D1" }], ["noAccessReconciliationFailures/D1", { trnId: "D1" }]]);
  assert.deepEqual(planDiscoveryCleanupDependencies(records, ["D1"]), { changes: [{ path: "premises/P1", patch: { noAccessTrnIds: ["KEEP"] } }], deletes: ["noAccessReconciliationFailures/D1", "report_trn_no_access/D1"] });
  assert.equal(records.get("premises/P1").noAccessTrnIds.length, 2);
});
test("unknown references stop cleanup", () => {
  assert.throws(() => planDiscoveryCleanupDependencies(new Map([["trns/D1", visit()], ["asts/A1", { trnId: "D1" }]]), ["D1"]), /Unreviewed reference/);
});
test("batch cleanup preserves other visits, batches, physical links and execution state", () => {
  const keep = { ...summary, time: "08:00:00" };
  const original = sales([summary, keep]);
  const records = new Map([["trns/D1", visit({ origin: { targetedBatch: context } })], ["sales-all-meters/S1", original]]);
  const result = planDiscoveryCleanupDependencies(records, ["D1"]).changes[0].patch.tbRefs;
  assert.deepEqual(result[0].fieldWork, { status: "IN_PROGRESS", premiseId: "P1", noAccess: [keep] });
  assert.deepEqual(result[1], original.tbRefs[1]);
  assert.equal(original.tbRefs[0].fieldWork.noAccess.length, 2);
});
test("ambiguous or absent batch summaries refuse deletion", () => {
  for (const list of [[], [summary, summary]]) {
    assert.throws(() => planDiscoveryCleanupDependencies(new Map([["trns/D1", visit({ targetedBatchContext: context })], ["sales-all-meters/S1", sales(list)]]), ["D1"]), /Ambiguous batch history/);
  }
});
test("a surviving visit with the same summary prevents removal", () => {
  assert.throws(() => planDiscoveryCleanupDependencies(new Map([["trns/D1", visit({ targetedBatchContext: context })], ["trns/KEEP", visit({ targetedBatchContext: context })], ["sales-all-meters/S1", sales()]]), ["D1"]), /Batch summary shared/);
});
test("cleanup cannot delete a different transaction type", () => {
  assert.throws(() => planDiscoveryCleanupDependencies(new Map([["trns/D1", { accessData: { trnType: "METER_INSPECTION", access: { hasAccess: "no" } } }]]), ["D1"]));
});
test("recorded timestamp objects are facts, while missing times stay null", () => {
  assert.equal(recordedTimeToIso({ _seconds: 1791186840, _nanoseconds: 355000000 }), "2026-10-05T07:54:00.355Z");
  assert.equal(recordedTimeToIso(null), null);
  assert.throws(() => recordedTimeToIso("NAv"), /Unreadable/);
});
