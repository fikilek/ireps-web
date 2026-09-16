import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { getUnallocateEligibility, hasFieldWorkStarted } from "./unallocateEligibility.js";

// Targeted Batch rules TB-R048 (1.3.33): Unallocate in TB Register.
const read = path => readFile(new URL(path, import.meta.url), "utf8");
const batch = (overrides = {}) => ({
  id: "TGB_20260916_001039_OU77", schemaVersion: "0.3.0", status: "ALLOCATED",
  allocation: { status: "ALLOCATED", targetType: "TEAM", targetId: "TEAM1", targetName: "Magubane Team", allocatedByUid: "ZAMO", allocatedByUser: "Zamo Ngubs" },
  acceptance: { status: "ACCEPTED" }, execution: { status: "NOT_STARTED", startedAt: null, completedAt: null },
  counts: { totalRows: 19, executionStartedRows: 0, completedRows: 0 }, ...overrides,
});

test("the allocator may unallocate their own not-started batch", () => {
  const result = getUnallocateEligibility(batch(), { uid: "ZAMO", role: "MNG" });
  assert.deepEqual([result.allowed, result.authority], [true, "ALLOCATOR"]);
});

test("another manager may override, and is told it is recorded as an override", () => {
  const result = getUnallocateEligibility(batch(), { uid: "MPILO", role: "MNG" });
  assert.deepEqual([result.allowed, result.authority], [true, "MANAGER_OVERRIDE"]);
  assert.match(result.reason, /Zamo Ngubs allocated this batch.*override/);
});

test("a supervisor who did not allocate, and any other role, may not", () => {
  for (const actor of [{ uid: "KAISER", role: "SPV" }, { uid: "FIKILE", role: "SPU" }, { uid: "ZAMO", role: "FWR" }]) {
    const result = getUnallocateEligibility(batch(), actor);
    assert.equal(result.allowed, false, JSON.stringify(actor));
    assert.match(result.reason, /Only Zamo Ngubs or a manager can unallocate this batch/);
  }
});

test("field work, an older batch or an unsettled allocation disables the button with the reason", () => {
  const actor = { uid: "ZAMO", role: "MNG" };
  for (const started of [
    batch({ counts: { totalRows: 19, executionStartedRows: 1, completedRows: 0 } }),
    batch({ execution: { status: "IN_PROGRESS" } }),
    batch({ status: "IN_PROGRESS" }),
    batch({ execution: { status: "NOT_STARTED", startedAt: "2026-09-16T08:00:00Z" } }),
  ]) {
    assert.equal(hasFieldWorkStarted(started), true);
    assert.deepEqual(getUnallocateEligibility(started, actor), { allowed: false, reason: "Field work has started on this batch, so it keeps its TEAM or SP." });
  }
  assert.equal(getUnallocateEligibility(batch({ schemaVersion: "0.2.0" }), actor).reason, "Older batches cannot be unallocated.");
  assert.equal(getUnallocateEligibility(batch({ allocation: { status: "ALLOCATION_FAILED", targetId: "TEAM1" } }), actor).reason, "The batch is not in a settled allocated state.");
});

test("TB Register sends the TEAM or SP it showed, and the confirmation requires a reason", async () => {
  const page = await read("../TargetedBatchesPage.jsx");
  assert.match(page, /unallocateCallable\(\{\s*tbId: upload\.id,\s*expectedTargetType: upload\.allocation\?\.targetType,\s*expectedTargetId: upload\.allocation\?\.targetId,\s*reason,\s*\}\)\.unwrap\(\)/);
  assert.match(page, /disabled=\{!unallocateEligibility\.allowed\}\s*title=\{unallocateEligibility\.reason\}/);
  assert.match(page, /<TargetedBatchUnallocateModal[\s\S]*authority=\{unallocateCandidate\.authority\}/);
  const modal = await read("./TargetedBatchUnallocateModal.jsx");
  assert.match(modal, /const canConfirm = Boolean\(trimmedReason\) && trimmedReason\.length <= REASON_LIMIT && !isUnallocating;/);
  assert.match(modal, /acceptance === "ACCEPTED"/, "an accepted batch warns that it is on the team's phones");
  assert.match(modal, /recorded as a\s+manager override/);
  const api = await read("../../../redux/salesTargetedBatchApi.js");
  assert.match(api, /unallocateSalesTargetedBatch: rtkBuilder\.mutation\(callSalesBatch\("onUnallocateTargetedBatchCallable"\)\)/);
  const index = await read("../../../../functions/index.js");
  assert.match(index, /onUnallocateTargetedBatchCallable,/);
});
