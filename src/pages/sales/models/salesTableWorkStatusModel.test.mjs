import assert from "node:assert/strict";
import test from "node:test";

import { SALES_STATUSES } from "./salesStatusModel.js";
import { inspectSalesTbRefsIntegrity } from "./salesTbRefsIntegrityModel.js";
import {
  buildSalesTableWorkStatusRows,
  classifySalesTableWorkStatus,
} from "./salesTableWorkStatusModel.js";

const timestamp = (seconds) => ({ seconds, nanoseconds: 0 });

function inProgress(overrides = {}) {
  return {
    id: "TGB_1",
    rowId: "ROW_1",
    date: timestamp(1),
    fieldWork: { status: "IN_PROGRESS", updatedAt: timestamp(2) },
    ...overrides,
  };
}

function completed(overrides = {}) {
  return {
    id: "TGB_DONE",
    rowId: "ROW_DONE",
    date: timestamp(1),
    fieldWork: {
      status: "COMPLETED",
      outcomeCode: "METER_DISCOVERED",
      outcomeLabel: "Meter discovered",
      premiseId: "P1",
      meterId: "M1",
      trnId: "TRN1",
      meterMatch: false,
      submittedAt: timestamp(2),
      updatedAt: timestamp(2),
    },
    ...overrides,
  };
}

function salesRow({ masterVisibility = "INVISIBLE", tbRefs = [] } = {}) {
  return {
    id: "07142661326",
    masterVisibility,
    tbRefs,
    tbRefsIntegrity: inspectSalesTbRefsIntegrity(tbRefs),
  };
}

for (const [name, row, expected] of [
  ["VISIBLE without tbRefs", salesRow({ masterVisibility: "VISIBLE" }), SALES_STATUSES.COMPLETED],
  ["VISIBLE with IN_PROGRESS", salesRow({ masterVisibility: "VISIBLE", tbRefs: [inProgress()] }), SALES_STATUSES.COMPLETED],
  ["VISIBLE with malformed tbRefs", { masterVisibility: "VISIBLE", tbRefs: "bad", tbRefsIntegrity: inspectSalesTbRefsIntegrity("bad") }, SALES_STATUSES.COMPLETED],
  ["INVISIBLE with canonical IN_PROGRESS", salesRow({ tbRefs: [inProgress()] }), SALES_STATUSES.IN_PROGRESS],
  ["allocation only", salesRow({ tbRefs: [{ id: "TGB_1", date: timestamp(1) }] }), SALES_STATUSES.NOT_STARTED],
  ["different-meter completed", salesRow({ tbRefs: [completed()] }), SALES_STATUSES.NOT_STARTED],
  ["same-meter completed", salesRow({ tbRefs: [completed({ fieldWork: { ...completed().fieldWork, meterMatch: true } })] }), SALES_STATUSES.NOT_STARTED],
  ["completed history plus IN_PROGRESS", salesRow({ tbRefs: [completed(), inProgress()] }), SALES_STATUSES.IN_PROGRESS],
  ["lowercase status", salesRow({ tbRefs: [inProgress({ fieldWork: { status: "in_progress", updatedAt: timestamp(2) } })] }), SALES_STATUSES.NOT_STARTED],
  ["padded status", salesRow({ tbRefs: [inProgress({ fieldWork: { status: " IN_PROGRESS ", updatedAt: timestamp(2) } })] }), SALES_STATUSES.NOT_STARTED],
  ["missing rowId", salesRow({ tbRefs: [inProgress({ rowId: undefined })] }), SALES_STATUSES.NOT_STARTED],
  ["no tbRefs", { masterVisibility: "INVISIBLE" }, SALES_STATUSES.NOT_STARTED],
  ["lowercase visibility", salesRow({ masterVisibility: "visible" }), SALES_STATUSES.NOT_STARTED],
  ["padded visibility", salesRow({ masterVisibility: " VISIBLE " }), SALES_STATUSES.NOT_STARTED],
  ["null visibility", salesRow({ masterVisibility: null }), SALES_STATUSES.NOT_STARTED],
]) {
  test(name, () => {
    assert.equal(classifySalesTableWorkStatus(row), expected);
  });
}

test("malformed sibling recovery uses correlation identity rather than array index", () => {
  const row = salesRow({ tbRefs: [{ id: "BROKEN" }, inProgress()] });
  assert.equal(row.tbRefsIntegrity.valid, false);
  assert.equal(classifySalesTableWorkStatus(row), SALES_STATUSES.IN_PROGRESS);
});

test("canonical null wins over a legacy-looking normalized reference", () => {
  const row = { masterVisibility: "INVISIBLE", tbRefs: [], tbRefsIntegrity: inspectSalesTbRefsIntegrity(null) };
  assert.equal(classifySalesTableWorkStatus(row), SALES_STATUSES.NOT_STARTED);
});

test("builder adds only the public three-state work status", () => {
  const input = salesRow({ masterVisibility: "VISIBLE" });
  const [row] = buildSalesTableWorkStatusRows({ salesRows: [input] });
  assert.equal(row.salesWorkStatus, SALES_STATUSES.COMPLETED);
  assert.equal(Object.hasOwn(row, "salesWorkStatusIssues"), false);
  assert.equal(Object.hasOwn(row, "salesWorkStatusEvidence"), false);
});
