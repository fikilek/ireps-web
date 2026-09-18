// Targeted Batch rules TB-R054 (1.3.45): Sales Reporting counts one status per batch row,
// so Not Started + In Progress + Completed always equals the rows.
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTargetedBatchReport,
  countTargetedBatchRowsByBatch,
  getTargetedBatchRowWorkStatus as statusOf,
} from "./salesTargetedBatchReadModel.js";

const VISIBLE = { master: { visibility: "VISIBLE" } };
const INVISIBLE = { master: { visibility: "INVISIBLE" } };
const modernRow = (id, tbId, status, salesAllMeterId = `S_${id}`) => ({
  id, tbId, salesAllMeterId, schemaVersion: "0.3.0", execution: { status },
});

test("a VISIBLE Sales meter is Completed whatever the row says", () => {
  for (const status of ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "BOGUS"]) {
    assert.equal(statusOf({ row: modernRow("R", "TB", status), sales: VISIBLE }), "COMPLETED");
  }
});

test("otherwise the row's own status counts, and an unreadable status is Not Started", () => {
  assert.equal(statusOf({ row: modernRow("R", "TB", "COMPLETED"), sales: INVISIBLE }), "COMPLETED");
  assert.equal(statusOf({ row: modernRow("R", "TB", "IN_PROGRESS"), sales: INVISIBLE }), "IN_PROGRESS");
  assert.equal(statusOf({ row: modernRow("R", "TB", "NOT_STARTED"), sales: INVISIBLE }), "NOT_STARTED");
  assert.equal(statusOf({ row: modernRow("R", "TB", "BOGUS"), sales: INVISIBLE }), "NOT_STARTED");
  assert.equal(statusOf({ row: modernRow("R", "TB", undefined) }), "NOT_STARTED");
  assert.equal(statusOf({ row: { id: "R", tbId: "TB", execution: { status: "ALLOCATED" } } }), "NOT_STARTED");
});

test("an older row uses its own status, the same as the phone, not the Sales reference", () => {
  const at = { seconds: 1_700_000_000, nanoseconds: 0 };
  const tbId = "TGB_20260913_120000_0000";
  const sales = { master: { visibility: "INVISIBLE" }, tbRefs: [{ id: tbId, date: at, rowId: "R1", fieldWork: { status: "IN_PROGRESS", updatedAt: at } }] };
  const row = { id: "R1", tbId, schemaVersion: "0.2.0", execution: { status: "NOT_STARTED" } };
  assert.equal(statusOf({ row, sales }), "NOT_STARTED");
  assert.equal(statusOf({ row: { ...row, execution: { status: "in_progress" } }, sales }), "IN_PROGRESS");
});

test("every batch balances: each row is counted once, in one status", () => {
  const rows = [
    modernRow("A1", "A", "NOT_STARTED"),
    modernRow("A2", "A", "NOT_STARTED"),
    modernRow("A3", "A", "IN_PROGRESS"),
    modernRow("A4", "A", "COMPLETED"),
    modernRow("B1", "B", "NOT_STARTED", "S_VISIBLE"),
    modernRow("B2", "B", "IN_PROGRESS", "S_VISIBLE_2"),
    modernRow("B3", "B", "BOGUS"),
    { id: "NO_BATCH", salesAllMeterId: "S_X", execution: { status: "COMPLETED" } },
  ];
  const counts = countTargetedBatchRowsByBatch({
    rows,
    salesById: { S_VISIBLE: VISIBLE, S_VISIBLE_2: VISIBLE, S_A1: INVISIBLE },
  });

  assert.deepEqual(counts, {
    A: { total: 4, notStarted: 2, inProgress: 1, completed: 1 },
    B: { total: 3, notStarted: 1, inProgress: 0, completed: 2 },
  });
  for (const batch of Object.values(counts)) {
    assert.equal(batch.notStarted + batch.inProgress + batch.completed, batch.total);
  }
});

test("Open Report shows and counts the same status per row", () => {
  const report = buildTargetedBatchReport({
    tbId: "TB",
    batch: { id: "TB" },
    rows: [
      modernRow("R1", "TB", "NOT_STARTED", "S1"),
      modernRow("R2", "TB", "IN_PROGRESS", "S2"),
      modernRow("R3", "TB", "NOT_STARTED", "S3"),
    ],
    salesById: { S1: { id: "S1", ...VISIBLE }, S2: { id: "S2", ...INVISIBLE } },
  });
  const byId = Object.fromEntries(report.rows.map((row) => [row.id, row]));

  assert.equal(byId.R1.workStatus, "COMPLETED");
  assert.equal(byId.R1.execution.status, "NOT_STARTED");
  assert.equal(byId.R2.workStatus, "IN_PROGRESS");
  assert.equal(byId.R3.workStatus, "NOT_STARTED");
  assert.equal(report.summary.total, 3);
  assert.deepEqual(
    [report.summary.notStarted, report.summary.inProgress, report.summary.completed],
    [1, 1, 1],
  );
});
