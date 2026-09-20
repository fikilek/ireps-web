// Targeted Batch rules TB-R064 (1.3.67): TB Rows on TB Register tells the truth about the work.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { normalizePermanentSalesBatchRow } from "../../../sales/models/salesTargetedBatchReadModel.js";
import { buildTargetedBatchRowsSummary, normalizeTargetedBatchRow, rowOutcomeText } from "./targetedBatchRowsModel.js";

const BATCH = { id: "TGB_20260920_043338_X70E", acceptance: { status: "ACCEPTED" }, source: { type: "PREPAID_SALES" } };
const row = (id, execution, refs) => ({
  schemaVersion: "0.3.0", id, rowNo: Number(id.slice(-1)), tbId: BATCH.id, salesAllMeterId: "04298085574",
  decision: { status: "ACCEPT" }, allocation: { status: "ALLOCATED" },
  meter: { numberRaw: "04298085574", numberNormalized: "04298085574", masterVisibility: "INVISIBLE" },
  execution, refs: { erfId: "ERF1", premiseId: null, meterId: null, trnId: null, ...refs },
});
const NOT_STARTED = { status: "NOT_STARTED", startedAt: null, completedAt: null, outcome: null, foundMeterNo: null };
const DONE = { status: "COMPLETED", startedAt: 1, completedAt: 1, outcome: "METER_DISCOVERED", foundMeterNo: null };
const DIFFERENT = { status: "COMPLETED", startedAt: 1, completedAt: 1, outcome: "DIFFERENT_METER_FOUND_AT_ERF", foundMeterNo: "04298085599" };
const FOUND_REFS = { premiseId: "PRM1", meterId: "TRN1", trnId: "TRN1" };

test("the row's own meter was found: matched, and an inspection is proposed", () => {
  const normalized = normalizePermanentSalesBatchRow(row("R1", DONE, FOUND_REFS), "R1", BATCH);
  assert.equal(normalized.astMatchStatus, "MATCHED");
  assert.equal(normalized.proposedTrnType, "METER_INSPECTION");
  assert.equal(normalized.foundMeterNo, null);
});

test("a different meter was found there: not matched, and no inspection of a meter nobody found", () => {
  const normalized = normalizePermanentSalesBatchRow(row("R2", DIFFERENT, FOUND_REFS), "R2", BATCH);
  assert.equal(normalized.astMatchStatus, "NOT_MATCHED");
  assert.equal(normalized.proposedTrnType, "METER_DISCOVERY");
  assert.equal(normalized.foundMeterNo, "04298085599");
  assert.equal(normalized.executionOutcome, "DIFFERENT_METER_FOUND_AT_ERF");
});

test("a row written before 1.3.67 is read by its outcome alone", () => {
  const old = row("R3", { ...DIFFERENT, foundMeterNo: undefined }, FOUND_REFS);
  delete old.execution.foundMeterNo;
  const normalized = normalizePermanentSalesBatchRow(old, "R3", BATCH);
  assert.equal(normalized.astMatchStatus, "NOT_MATCHED");
  assert.equal(normalized.foundMeterNo, null);
});

test("nothing found yet stays not matched and proposes a discovery", () => {
  const normalized = normalizePermanentSalesBatchRow(row("R4", NOT_STARTED, {}), "R4", BATCH);
  assert.equal(normalized.astMatchStatus, "NOT_MATCHED");
  assert.equal(normalized.proposedTrnType, "METER_DISCOVERY");
});

test("MD Completed counts a finished discovery, whichever meter was found", () => {
  const rows = [row("R1", DONE, FOUND_REFS), row("R2", DIFFERENT, FOUND_REFS), row("R3", NOT_STARTED, {})]
    .map((entry, index) => normalizeTargetedBatchRow({ row: entry, index, batch: BATCH }));
  assert.deepEqual(rows.map(entry => entry.meterDiscoveryStatus), ["COMPLETED", "COMPLETED", "NOT_STARTED"]);
  const summary = buildTargetedBatchRowsSummary(rows);
  assert.equal(summary.meterDiscoveryCompleted, 2);
  assert.equal(summary.completed, 2);
  assert.equal(rows[1].foundMeterNo, "04298085599");
});

test("a started row that is not finished keeps its discovery open", () => {
  const started = normalizeTargetedBatchRow({ row: row("R5", { status: "IN_PROGRESS", startedAt: 1, completedAt: null, outcome: null, foundMeterNo: null }, FOUND_REFS), index: 0, batch: BATCH });
  assert.equal(started.meterDiscoveryStatus, "CREATED");
});

test("the outcome is said in plain words, and an unknown code says nothing", () => {
  assert.equal(rowOutcomeText({ executionOutcome: "DIFFERENT_METER_FOUND_AT_ERF" }), "A different meter was found here");
  assert.equal(rowOutcomeText({ executionOutcome: "METER_DISCOVERED_OUTSIDE_BATCH" }), "Found outside the batch");
  assert.equal(rowOutcomeText({ executionOutcome: "METER_INSTALLED_OUTSIDE_BATCH" }), "Installed outside the batch");
  assert.equal(rowOutcomeText({ executionOutcome: "METER_DISCOVERED" }), "Meter found");
  assert.equal(rowOutcomeText({ executionOutcome: "SOMETHING_NEW" }), "");
  assert.equal(rowOutcomeText({}), "");
});

test("the table shows the number found and the outcome, and the CSV carries both", async () => {
  const table = await readFile(new URL("./TargetedBatchRowsTable.jsx", import.meta.url), "utf8");
  assert.ok(table.includes("Found {row.foundMeterNo}"), "the row must show the number found");
  assert.ok(table.includes("rowOutcomeText(row)"), "the row must say the outcome in plain words");
  const csv = await readFile(new URL("../targetedBatchUtils.js", import.meta.url), "utf8");
  for (const column of ['"foundMeterNo"', '"executionOutcome"', "row?.foundMeterNo", "row?.executionOutcome"]) {
    assert.ok(csv.includes(column), `the CSV is missing ${column}`);
  }
});
