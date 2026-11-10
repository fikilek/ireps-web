import assert from "node:assert/strict";
import test from "node:test";

import { buildMdBgoRegisterRow, getMdBgoBatchStatus, getMdBgoRowStatusCounts, mdBgoRegisterSearchValue } from "./mdBgoRegisterModel.js";

test("MD BGO batch status reads the parent lifecycle without inventing states", () => {
  assert.equal(getMdBgoBatchStatus({ raw: { workflow: { state: "READY_FOR_ALLOCATION" } } }), "READY FOR ALLOCATION");
  assert.equal(getMdBgoBatchStatus({ workflowState: "ACCEPTED" }), "ACCEPTED");
  assert.equal(getMdBgoBatchStatus({ raw: { workflow: { state: "IN_PROGRESS" } } }), "IN PROGRESS");
  assert.equal(getMdBgoBatchStatus({ workflowState: "UNKNOWN" }), "NAv");
});

test("MD BGO row counts count only distinct source documents with explicit requested states", () => {
  const counts = getMdBgoRowStatusCounts([
    { id: "R1", bgoBatchId: "B1", workflow: { state: "IN_PROGRESS" } },
    { id: "R2", batchId: "B1", workflow: { state: "COMPLETED" } },
    { id: "R3", batchId: "B1", workflow: { state: "READY_FOR_ALLOCATION" } },
    { id: "R4", batchId: "B1", workflow: {} },
    { id: "R5", batchId: "B2", workflow: { state: "COMPLETED" } },
    { id: "R6", workflow: { state: "COMPLETED" } },
  ]);

  assert.deepEqual(counts.get("B1"), { inProgress: 1, completed: 1 });
  assert.deepEqual(counts.get("B2"), { inProgress: 0, completed: 1 });
  assert.equal(counts.has(""), false);
});

const batch = (state) => ({
  id: "MD_BGO_TEST", batchMode: "BMD", operationType: "METER_DISCOVERY", workflowState: state,
  scope: { lmPcode: "ZA5241", wardPcode: "ZA5241006" }, summary: { erfCount: 23 },
  geofenceRef: { id: "GF1", name: "Nightingale" }, metadata: { createdByUser: "Creator" },
  raw: { workflow: { state, issuedAt: "2026-11-10T12:00:00Z" } },
});
const ready = { ready: true, error: "" };

test("standard table rows preserve IDs, parent data, counts and searchable batch values", () => {
  const original = batch("READY_FOR_ALLOCATION");
  const row = buildMdBgoRegisterRow(original, new Map([[original.id, { inProgress: 2, completed: 3 }]]), ready);
  assert.equal(row.id, original.id);
  assert.equal(row.raw, original.raw);
  assert.equal(original.allocation, undefined, "projection must not mutate streamed source");
  assert.deepEqual([row.total, row.inProgress, row.completed, row.ward, row.wardNo], [23, 2, 3, "Ward 6", "006"]);
  assert.match(mdBgoRegisterSearchValue(row), /Nightingale/);
  assert.match(mdBgoRegisterSearchValue(row), /ZA5241006/);
  assert.equal(row.isAllocated, false);
});

test("count loading and failure stay unavailable instead of fabricating zeros", () => {
  const original = batch("READY_FOR_ALLOCATION");
  for (const stream of [{ ready: false }, { ready: true, error: "permission-denied" }]) {
    const row = buildMdBgoRegisterRow(original, new Map(), stream);
    assert.equal(row.inProgress, null);
    assert.equal(row.completed, null);
  }
  const row = buildMdBgoRegisterRow(original, new Map(), ready);
  assert.equal(row.inProgress, 0);
  assert.equal(row.completed, 0);
});

test("table migration preserves allocation, started-work and delete action guards", () => {
  for (const state of ["ISSUED", "ACCEPTED", "REJECTED", "IN_PROGRESS", "COMPLETED"]) {
    const original = { ...batch(state), targetType: "TEAM", targetId: "T1", targetName: "Simo Team" };
    const row = buildMdBgoRegisterRow(original, new Map(), ready);
    assert.equal(row.isAllocated, true);
    assert.equal(row.allocation, "ALLOCATED");
    assert.equal(row.unallocationIntentUnavailable, false);
    assert.equal(row.fieldworkStarted, ["IN_PROGRESS", "COMPLETED"].includes(state));
    assert.equal(row.canDelete, !row.fieldworkStarted);
    assert.equal(row.intentTargetId, "T1");
  }
  const malformed = { ...batch("ISSUED"), targetType: "TEAM", targetId: "NAv", raw: {} };
  assert.equal(buildMdBgoRegisterRow(malformed, new Map(), ready).unallocationIntentUnavailable, true);
  assert.equal(buildMdBgoRegisterRow({ ...batch("READY_FOR_ALLOCATION"), targetId: "NAv" }, new Map(), ready).isAllocated, false);
});
