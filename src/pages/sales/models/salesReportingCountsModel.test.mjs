// Targeted Batch rules TB-R054 (1.3.45): Sales Reporting cards and count columns.
import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_PROGRESS,
  getReportingCountsState as stateOf,
  hasCountFilter,
  summarizeReportingCards,
  withRowCounts,
} from "./salesReportingCountsModel.js";

const ready = { rows: "ready", sales: "ready" };

test("counts are ready only when the batch list, the rows and every Sales meter are read", () => {
  assert.equal(stateOf({ batchesStatus: "ready", rowCountSources: ready }), "ready");
  assert.equal(stateOf({ batchesStatus: "ready", rowCountSources: { rows: "ready", sales: "error" } }), "ready");
  assert.equal(stateOf({ batchesStatus: "syncing", rowCountSources: ready }), "counting");
  assert.equal(stateOf({ batchesStatus: "ready", rowCountSources: { rows: "syncing", sales: "idle" } }), "counting");
  assert.equal(stateOf({ batchesStatus: "ready", rowCountSources: { rows: "ready", sales: "syncing" } }), "counting");
  assert.equal(stateOf({ batchesStatus: "ready" }), "counting");
  assert.equal(stateOf({ batchesStatus: "ready", rowCountSources: { rows: "error", sales: "error" } }), "error");
  assert.equal(stateOf({ batchesStatus: "error", batchesFailed: true, rowCountSources: ready }), "error");
  assert.equal(stateOf({ batchesStatus: "ready", rowCountSources: ready, rowCountsFailed: true }), "error");
  assert.equal(stateOf({ hasWorkbase: false }), "ready");
});

test("each batch takes its counts from the rows, or none while counting", () => {
  const counts = { A: { total: 3, notStarted: 1, inProgress: 1, completed: 1 } };
  assert.deepEqual(withRowCounts({ id: "A" }, counts, "ready").progress, counts.A);
  assert.deepEqual(withRowCounts({ id: "EMPTY" }, counts, "ready").progress, EMPTY_PROGRESS);
  assert.equal(withRowCounts({ id: "A" }, counts, "counting").progress, null);
  assert.equal(withRowCounts({ id: "A" }, counts, "error").progress, null);
});

test("the cards add up the batches shown, and Sales Rows = Not Started + In Progress + Completed", () => {
  const shown = [
    { progress: { total: 5, notStarted: 2, inProgress: 1, completed: 2 } },
    { progress: { total: 3, notStarted: 0, inProgress: 0, completed: 3 } },
    { progress: EMPTY_PROGRESS },
  ];
  const cards = summarizeReportingCards(shown, { countsState: "ready" });
  assert.deepEqual(cards, { batches: 3, rows: 8, notStarted: 2, inProgress: 1, completed: 5 });
  assert.equal(cards.notStarted + cards.inProgress + cards.completed, cards.rows);
  assert.deepEqual(summarizeReportingCards([], { countsState: "ready" }), { batches: 0, rows: 0, notStarted: 0, inProgress: 0, completed: 0 });
});

test("no number while counting; no batch count while the list or a count filter is waiting", () => {
  const shown = [{ progress: null }, { progress: null }];
  assert.deepEqual(summarizeReportingCards(shown, { countsState: "counting" }), { batches: 2, rows: null, notStarted: null, inProgress: null, completed: null });
  assert.deepEqual(summarizeReportingCards(shown, { countsState: "error", listPending: true }), { batches: null, rows: null, notStarted: null, inProgress: null, completed: null });
  assert.equal(summarizeReportingCards([], { countsState: "counting", batchesReady: false }).batches, null, "no batch count before the batch list is read");
});

test("a count filter is any of the four count columns", () => {
  assert.equal(hasCountFilter({ ward: "006", batchId: "TGB" }), false);
  assert.equal(hasCountFilter({ notStarted: " " }), false);
  for (const key of ["totalRows", "notStarted", "inProgress", "completed"]) {
    assert.equal(hasCountFilter({ [key]: "0" }), true);
  }
});
