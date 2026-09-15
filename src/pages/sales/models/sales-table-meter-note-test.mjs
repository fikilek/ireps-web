import test from "node:test";
import assert from "node:assert/strict";
import { NON_GPS_SALES_NOTE, REASONS_SHOWN_IN_COLUMNS, salesTableMeterNote } from "./sales-table-meter-note.js";

test("Non-GPS meters always read Non-GPS Sales, even when already batched", () => {
  assert.equal(salesTableMeterNote({ isNonGpsSales: true, batchability: { batchable: false, code: "SALES_ORIGIN_CHANGED", reason: "Use Non-GPS Sales" } }), NON_GPS_SALES_NOTE);
  assert.equal(salesTableMeterNote({ isNonGpsSales: true, batchability: { batchable: false, code: "CURRENT_TARGETED_BATCH", reason: "Already belongs to TGB_20260816_095858_I3PJ" } }), NON_GPS_SALES_NOTE);
});

test("current batch membership gets no note; the TB IDs column shows it", () => {
  assert.equal(salesTableMeterNote({ isNonGpsSales: false, batchability: { batchable: false, code: "CURRENT_TARGETED_BATCH", reason: "Already belongs to TGB_20260911_042607_5ED6" } }), null);
});

test("In Progress and Completed get no note; the Work Status column shows them", () => {
  assert.equal(salesTableMeterNote({ isNonGpsSales: false, batchability: { batchable: false, code: "SALES_STATUS_COMPLETED", reason: "COMPLETED — not batchable" } }), null);
  assert.equal(salesTableMeterNote({ isNonGpsSales: false, batchability: { batchable: false, code: "SALES_STATUS_IN_PROGRESS", reason: "IN_PROGRESS — not batchable" } }), null);
});

test("batchable meters get no note; other blocking reasons stay visible", () => {
  assert.equal(salesTableMeterNote({ isNonGpsSales: false, batchability: { batchable: true, code: "BATCHABLE", reason: "Batchable Sales meter" } }), null);
  assert.equal(salesTableMeterNote({ isNonGpsSales: false, batchability: { batchable: false, code: "PIPELINE_ERF_INVALID", reason: "GPS Sales needs exactly one valid pipeline ERF and coordinate pair" } }), "GPS Sales needs exactly one valid pipeline ERF and coordinate pair");
  assert.equal(salesTableMeterNote({ isNonGpsSales: false, batchability: { batchable: false, code: "SALES_IDENTITY_INVALID", reason: "Sales meter identity is missing or conflicting" } }), "Sales meter identity is missing or conflicting");
});

test("only the batch, work-status and category reasons are left out", () => {
  assert.deepEqual([...REASONS_SHOWN_IN_COLUMNS].sort(), ["CURRENT_TARGETED_BATCH", "SALES_CATEGORY_NONE", "SALES_CATEGORY_NORMAL", "SALES_STATUS_COMPLETED", "SALES_STATUS_IN_PROGRESS"]);
});
