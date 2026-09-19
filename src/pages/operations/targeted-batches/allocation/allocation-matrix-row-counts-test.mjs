import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildOrganisationAllocationMatrixResult } from "./allocationMatrixModel.js";
import { countTargetedBatchRowsByBatch } from "../../../sales/models/salesTargetedBatchReadModel.js";
import { summarizeReportingCards, withRowCounts } from "../../../sales/models/salesReportingCountsModel.js";

// Targeted Batch rules TB-R045 (1.3.57, Task Register w13): the Allocation Matrix counts the batch rows,
// one status per row, exactly as Sales Reporting (TB-R054); the running totals on a batch are not used.
const teams = [{ id: "KAISER", name: "Kaiser Team", memberCount: 2, status: "ACTIVE" }, { id: "SIMO", name: "Simo Team", memberCount: 1, status: "ACTIVE" }];
function batch({ id, targetId = "KAISER", counts, acceptance = "ACCEPTED", execution = "IN_PROGRESS" }) {
  return { id, source: { type: "PREPAID_SALES_NON_GPS" }, creation: { state: "READY", expectedRows: counts.totalRows }, status: "ALLOCATED",
    allocation: { status: "ALLOCATED", targetType: "TEAM", targetId }, acceptance: { status: acceptance }, execution: { status: execution },
    counts: { allocatedRows: counts.totalRows, unallocatedRows: 0, completedRows: 0, executionStartedRows: 0, ...counts } };
}
function row(tbId, index, status, targetId = "KAISER") {
  return { id: `${tbId}_${index}`, tbId, salesAllMeterId: `S${tbId}${index}`, allocation: { status: "ALLOCATED", targetType: "TEAM", targetId }, execution: { status } };
}
const statuses = (tbId, list, targetId) => list.map((status, index) => row(tbId, index, status, targetId));
const numbers = (result, id) => {
  const m = result.organisations.find(item => item.id === id).matrix;
  return [m.batches, m.assigned, m.notStarted, m.inProgress, m.completed];
};

test("the TEAM numbers come from the rows, and the batch's running totals are ignored", () => {
  // The stored totals say 9 meters, 5 done; the rows say 4 meters: 1 Not Started, 1 In Progress, 2 Completed.
  const b1 = batch({ id: "B1", counts: { totalRows: 9, completedRows: 5, executionStartedRows: 7 } });
  const rows = statuses("B1", ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "COMPLETED"]);
  const counted = buildOrganisationAllocationMatrixResult({ batches: [b1], rows, teams, rowCountsByBatch: countTargetedBatchRowsByBatch({ rows }) });
  assert.deepEqual(numbers(counted, "KAISER"), [1, 4, 1, 1, 2]);
  assert.equal(counted.integrityIssues.length, 0, "totals that disagree with the rows no longer leave the batch out");
  // Without row counts (the Allocate page) the old behaviour stays: the mismatch leaves the batch out.
  const old = buildOrganisationAllocationMatrixResult({ batches: [b1], rows, teams });
  assert.deepEqual(numbers(old, "KAISER"), [0, 0, 0, 0, 0]);
  assert.deepEqual(old.integrityIssues[0].issues, ["PHYSICAL_ROW_COUNT_MISMATCH"]);
});

test("a VISIBLE Sales meter is Completed even while its row is open, as on Sales Reporting", () => {
  const b1 = batch({ id: "B1", counts: { totalRows: 2 } });
  const rows = statuses("B1", ["NOT_STARTED", "NOT_STARTED"]);
  const salesById = { [rows[0].salesAllMeterId]: { id: rows[0].salesAllMeterId, master: { visibility: "VISIBLE" } } };
  const counts = countTargetedBatchRowsByBatch({ rows, salesById });
  assert.deepEqual(counts.B1, { total: 2, notStarted: 1, inProgress: 0, completed: 1 }, "Sales Reporting's count of the batch");
  const result = buildOrganisationAllocationMatrixResult({ batches: [b1], rows, teams, rowCountsByBatch: counts });
  assert.deepEqual(numbers(result, "KAISER"), [1, 2, 1, 0, 1], "the matrix shows the same: the VISIBLE meter is Completed");
});

test("the matrix and Sales Reporting give the same numbers for the same batches", () => {
  const batches = [
    batch({ id: "B1", counts: { totalRows: 30, completedRows: 30 } }),
    batch({ id: "B2", targetId: "SIMO", counts: { totalRows: 3 } }),
    batch({ id: "B3", counts: { totalRows: 12 }, execution: "NOT_STARTED" }),
  ];
  const rows = [...statuses("B1", ["COMPLETED", "IN_PROGRESS", "NOT_STARTED"]), ...statuses("B2", ["COMPLETED", "COMPLETED"], "SIMO"), ...statuses("B3", ["NOT_STARTED"])];
  const countsByBatch = countTargetedBatchRowsByBatch({ rows });
  const matrix = buildOrganisationAllocationMatrixResult({ batches, rows, teams, rowCountsByBatch: countsByBatch });
  const cards = summarizeReportingCards(batches.map(item => withRowCounts(item, countsByBatch, "ready")), { countsState: "ready" });
  const sum = key => matrix.organisations.reduce((total, item) => total + item.matrix[key], 0);
  assert.deepEqual([sum("assigned"), sum("notStarted"), sum("inProgress"), sum("completed")], [cards.rows, cards.notStarted, cards.inProgress, cards.completed]);
  assert.deepEqual(numbers(matrix, "KAISER"), [2, 4, 2, 1, 1]);
  assert.deepEqual(numbers(matrix, "SIMO"), [1, 2, 0, 0, 2]);
});

test("rejected batches stay out, and a row allocated to another TEAM still leaves its batch out", () => {
  const rejected = batch({ id: "B1", counts: { totalRows: 2 }, acceptance: "REJECTED", execution: "NOT_STARTED" });
  const conflict = batch({ id: "B2", counts: { totalRows: 2 } });
  const rows = [...statuses("B1", ["NOT_STARTED", "NOT_STARTED"]), row("B2", 0, "NOT_STARTED"), row("B2", 1, "NOT_STARTED", "SIMO")];
  const result = buildOrganisationAllocationMatrixResult({ batches: [rejected, conflict], rows, teams, rowCountsByBatch: countTargetedBatchRowsByBatch({ rows }) });
  const kaiser = result.organisations.find(item => item.id === "KAISER").matrix;
  assert.deepEqual([kaiser.batches, kaiser.rejectedBatches, kaiser.assigned], [0, 1, 0]);
  assert.deepEqual(result.integrityIssues.map(issue => [issue.batchId, issue.issues]), [["B2", ["PHYSICAL_ROW_TARGET_MISMATCH"]]]);
});

test("the Matrix, TB Register and the Allocation Map read the row counts; the Allocate page does not", async () => {
  const read = path => readFile(new URL(path, import.meta.url), "utf8");
  const hook = await read("./use-allocation-matrix.js");
  assert.match(hook, /useGetTargetedBatchRowCountsByLmQuery\(lmPcode \|\| skipToken\)/);
  assert.match(hook, /const rowCountsByBatch = countsState === "ready" \? rowCountsStream\?\.countsByBatch \|\| NO_ROW_COUNTS : NO_ROW_COUNTS;/, "never the running totals, even while counting");
  assert.match(hook, /rowCountsByBatch,\s*\}\),/);
  assert.match(hook, /countsState === "counting" \|\|/, "the table waits for the counts");
  const map = await read("../../TargetedBatchAllocationMapPage.jsx");
  assert.match(map, /useGetTargetedBatchRowCountsByLmQuery\(lmPcode \|\| skipToken\)/);
  assert.match(map, /buildOrganisationAllocationMatrixResult\(\{ batches, rows: matrixStream\?\.rows \|\| EMPTY, teams, serviceProviders, rowCountsByBatch \}\)/);
  assert.match(map, /: new Map\(\)\),/, "until counted, the chips show member counts");
  const allocate = await read("../../TargetedBatchAllocationPage.jsx");
  assert.doesNotMatch(allocate, /rowCountsByBatch/, "the Allocate page's own workload box is a separate change");
});
