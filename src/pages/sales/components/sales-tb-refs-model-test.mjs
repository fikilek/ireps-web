// Targeted Batch rules TB-R058 (1.3.58): the Sales tables' Targeted Batch window names the batch.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ACCEPTANCE_TEXT, acceptanceText, allocationText, batchTypeText, rowProgress, workStatusText } from "./sales-tb-refs-model.js";

test("the batch type is named as TB Register names it", () => {
  assert.equal(batchTypeText({ source: { type: "PREPAID_SALES" } }), "GPS");
  assert.equal(batchTypeText({ source: { type: "PREPAID_SALES_NON_GPS" } }), "Non-GPS");
  assert.equal(batchTypeText({ selection: { planningMode: "NON_GPS_STREET" }, source: { type: "PREPAID_SALES" } }), "Non-GPS");
  assert.equal(batchTypeText({}), "NAv");
});

test("who the batch is allocated to, in plain words", () => {
  assert.equal(allocationText({ status: "ALLOCATED", allocation: { targetType: "TEAM", targetId: "T1", targetName: "Kaiser Team" } }), "Kaiser Team (Team)");
  assert.equal(allocationText({ allocation: { status: "ALLOCATED", target: { type: "SP", id: "SP1", name: "Lefu Metering" } } }), "Lefu Metering (Service provider)");
  assert.equal(allocationText({ allocation: { targetId: "T1" } }), "Name missing");
  assert.equal(allocationText({}), "Not allocated");
  assert.equal(allocationText({ status: "READY" }), "Not allocated");
});

test("only the three statuses are used", () => {
  assert.equal(workStatusText("NOT_STARTED"), "Not Started");
  assert.equal(workStatusText("in_progress"), "In Progress");
  assert.equal(workStatusText("COMPLETED"), "Completed");
  assert.equal(workStatusText(""), "NAv");
  assert.deepEqual(Object.values(ACCEPTANCE_TEXT), ["Not sent out yet", "Waiting to be accepted", "Accepted", "Rejected"]);
  assert.equal(acceptanceText("waiting"), "Waiting to be accepted");
  assert.equal(acceptanceText(null), "NAv");
});

test("the whole batch's word comes from its rows", () => {
  const rows = [{ execution: { status: "COMPLETED" } }, { execution: { status: "NOT_STARTED" } }, { execution: {} }];
  assert.deepEqual(rowProgress(rows), { total: 3, completed: 1, inProgress: 0, notStarted: 2 });
  assert.deepEqual(rowProgress([]), { total: 0, completed: 0, inProgress: 0, notStarted: 0 });
});

test("the window asks for the batch, its geofence and this meter's row, and says so in plain words", () => {
  const modal = fs.readFileSync(new URL("./SalesTbRefsModal.jsx", import.meta.url), "utf8");
  for (const needle of [
    "useGetPermanentSalesBatchesQuery",
    "useBatchGeofence",
    '["Created",',
    '["Geofence",',
    '["Batch type",',
    '["Ward",',
    '["Allocated to",',
    '["Acceptance",',
    '["Status of the whole batch",',
    'batchWorkStatus(rowProgress(rows))',
    "This meter in the batch",
    "Open the batch's rows",
    "The batch this meter is in now",
    "This batch cannot be read",
  ]) assert.ok(modal.includes(needle), `the window is missing ${needle}`);
  // Never a coined status word, and no internal status codes on screen.
  for (const banned of ["Untouched", "Pending", "Outstanding", '>NOT_STARTED<', '>IN_PROGRESS<', '>COMPLETED<']) {
    assert.ok(!modal.includes(banned), `the window must not show ${banned}`);
  }
});
