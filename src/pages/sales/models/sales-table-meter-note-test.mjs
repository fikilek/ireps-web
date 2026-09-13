import test from "node:test";
import assert from "node:assert/strict";
import { NON_GPS_SALES_NOTE, salesTableMeterNote } from "./sales-table-meter-note.js";

test("Non-GPS meters always read Non-GPS Sales, even when already batched", () => {
  assert.equal(salesTableMeterNote({ isNonGpsSales: true, batchability: { batchable: false, code: "SALES_ORIGIN_CHANGED", reason: "Use Non-GPS Sales" } }), NON_GPS_SALES_NOTE);
  assert.equal(salesTableMeterNote({ isNonGpsSales: true, batchability: { batchable: false, code: "CURRENT_TARGETED_BATCH", reason: "Already belongs to TGB_20260816_095858_I3PJ" } }), NON_GPS_SALES_NOTE);
});

test("current batch membership gets no note; the TB IDs column shows it", () => {
  assert.equal(salesTableMeterNote({ isNonGpsSales: false, batchability: { batchable: false, code: "CURRENT_TARGETED_BATCH", reason: "Already belongs to TGB_20260911_042607_5ED6" } }), null);
});

test("batchable meters get no note; other blocking reasons stay visible", () => {
  assert.equal(salesTableMeterNote({ isNonGpsSales: false, batchability: { batchable: true, code: "BATCHABLE", reason: "Batchable Sales meter" } }), null);
  assert.equal(salesTableMeterNote({ isNonGpsSales: false, batchability: { batchable: false, code: "SALES_STATUS_COMPLETED", reason: "COMPLETED — not batchable" } }), "COMPLETED — not batchable");
});
