import test from "node:test";
import assert from "node:assert/strict";
import { deriveNoAccessGroups } from "../noAccess/groups.js";
import { getGmrSubmissionTime, isGmrTransactionInMonth, getGmrReportMonthWindow } from "../reports/generalMonthlyReport.js";
const visit = (id, hasAccess, at, premiseId = "P1") => ({ id, accessData: { premise: { id: premiseId }, trnType: "METER_INSPECTION", access: { hasAccess } }, metadata: { createdOnDevice: at, createdAt: "2026-10-05T00:00:00.000Z" } });
test("groups are premise-wide, close only on later access, then reopen", () => {
  const rows = [visit("n1", "no", "2026-09-01"), visit("n2", "no", "2026-09-02"), visit("yes", "yes", "2026-09-03"), visit("n3", "no", "2026-09-04"), visit("other", "no", "2026-09-01", "P2")];
  const { groups } = deriveNoAccessGroups(rows);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0].visitIds, ["n1", "n2"]);
  assert.equal(groups[0].status, "CLOSED");
  assert.equal(groups[0].closingProof.trnId, "yes");
  assert.equal(groups[1].status, "OPEN");
  assert.equal(deriveNoAccessGroups(rows, { cutoff: "2026-09-02T23:59:59.000Z" }).groups[0].status, "OPEN");
});
test("unknown times never use arrival time; unfinished work and equal-time access cannot close a group", () => {
  const rows = [visit("n", "no", "2026-09-01"), visit("a-first-lexically", "yes", "2026-09-01"), visit("unknown", "no", null), { ...visit("pending", "yes", "2026-09-02"), workflow: { state: "ACCEPTED" } }];
  const result = deriveNoAccessGroups(rows);
  assert.equal(result.groups[0].status, "OPEN");
  assert.equal(result.undated[0].trnId, "unknown");
  assert.equal(getGmrSubmissionTime(rows[2]), null);
});
test("a September visit arriving in October remains in September, including an office instruction", () => {
  const row = { ...visit("n", "no", "2026-09-30T20:00:00.000Z"), workflow: { state: "COMPLETED", completedAt: "2026-10-05T00:00:00.000Z" } };
  assert.equal(isGmrTransactionInMonth(row, getGmrReportMonthWindow("2026-09")), true);
  assert.equal(isGmrTransactionInMonth(row, getGmrReportMonthWindow("2026-10")), false);
});
