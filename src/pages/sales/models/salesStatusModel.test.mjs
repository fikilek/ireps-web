import assert from "node:assert/strict";
import test from "node:test";
import { SALES_OPERATIONAL_STATUSES, SALES_STATUSES, SALES_STATUS_FILTER_OPTIONS, SALES_STATUS_LABELS, classifySalesStatus, getSalesStatusLabel, getSalesStatusSortRank } from "./salesStatusModel.js";
const timestamp = { seconds: 1789200000, nanoseconds: 0 };
const ref = (status, id = "TGB_20260913_120000_AAAA") => ({ id, date: timestamp, rowId: "ROW1", fieldWork: {
  status, updatedAt: timestamp,
  ...(status === "COMPLETED" ? { outcomeCode: "METER_DISCOVERED", outcomeLabel: "Meter discovered", premiseId: "P1", meterId: "M1", trnId: "T1", meterMatch: false, submittedAt: timestamp } : {}),
} });
test("canonical status vocabulary is three states; integrity is an independent display filter", () => {
  assert.deepEqual(SALES_OPERATIONAL_STATUSES, ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]);
  assert.deepEqual(SALES_STATUS_FILTER_OPTIONS.map(option => option.value), [...SALES_OPERATIONAL_STATUSES, "INTEGRITY_EXCEPTION"]);
});
for (const [name, row, status] of [
  ["empty", {}, "NOT_STARTED"],
  ["allocation reference", { tbRefs: [{ id: "TGB_20260913_120000_AAAA", date: timestamp }] }, "NOT_STARTED"],
  ["current membership alone", { targetedBatchId: "TGB_20260913_120000_AAAA" }, "NOT_STARTED"],
  ["canonical start", { tbRefs: [ref("IN_PROGRESS")] }, "IN_PROGRESS"],
  ["fieldwork completion without visible master", { tbRefs: [ref("COMPLETED")] }, "NOT_STARTED"],
  ["visible master without fieldwork", { master: { visibility: "VISIBLE" } }, "COMPLETED"],
  ["visible outranks start", { master: { visibility: "VISIBLE" }, tbRefs: [ref("IN_PROGRESS")] }, "COMPLETED"],
  ["completed history and active fieldwork", { tbRefs: [ref("COMPLETED"), ref("IN_PROGRESS", "TGB_20260913_120000_BBBB")] }, "IN_PROGRESS"],
  ["invalid sibling cannot hide valid start", { tbRefs: [{ id: "BAD" }, ref("IN_PROGRESS")] }, "IN_PROGRESS"],
  ["duplicate suppresses both starts", { tbRefs: [ref("IN_PROGRESS"), ref("IN_PROGRESS")] }, "NOT_STARTED"],
  ["persisted status is ignored", { salesStatus: "COMPLETED" }, "NOT_STARTED"],
  ["raw null visibility outranks a flat cached claim", { master: { visibility: null }, masterVisibility: "VISIBLE" }, "NOT_STARTED"],
]) test(name, () => {
  const before = structuredClone(row);
  assert.equal(classifySalesStatus(row).status, status);
  assert.deepEqual(row, before);
});
for (const value of [null, {}, [ref("NOT_STARTED")], [ref("in_progress")], [ref("UNKNOWN")], [{ ...ref("IN_PROGRESS"), fieldWork: {} }]]) {
  test("malformed raw linkage carries diagnostics without inventing a fourth status: " + JSON.stringify(value), () => {
    const result = classifySalesStatus({ tbRefs: value, tbRefsIntegrity: { valid: true } });
    assert.equal(result.status, "NOT_STARTED"); assert.ok(result.issues.length > 0);
  });
}
test("cached integrity does not override raw status or invent raw issues", () => {
  assert.deepEqual(classifySalesStatus({ tbRefs: [], tbRefsIntegrity: { valid: false, issues: ["cached"] } }), { status: "NOT_STARTED", issues: [] });
});
test("labels use canonical wording", () => {
  assert.equal(SALES_STATUS_LABELS[SALES_STATUSES.NOT_STARTED], "Not Started");
  assert.equal(getSalesStatusLabel(SALES_STATUSES.IN_PROGRESS), "In Progress");
  assert.equal(getSalesStatusLabel(SALES_STATUSES.COMPLETED), "Completed");
  assert.equal(
    getSalesStatusLabel(SALES_STATUSES.INTEGRITY_EXCEPTION),
    "Integrity Exception",
  );
});

test("sort rank follows lifecycle order", () => {
  assert.ok(
    getSalesStatusSortRank(SALES_STATUSES.NOT_STARTED) <
      getSalesStatusSortRank(SALES_STATUSES.IN_PROGRESS),
  );
  assert.ok(
    getSalesStatusSortRank(SALES_STATUSES.IN_PROGRESS) <
      getSalesStatusSortRank(SALES_STATUSES.COMPLETED),
  );
  assert.ok(
    getSalesStatusSortRank(SALES_STATUSES.COMPLETED) <
      getSalesStatusSortRank(SALES_STATUSES.INTEGRITY_EXCEPTION),
  );
});
