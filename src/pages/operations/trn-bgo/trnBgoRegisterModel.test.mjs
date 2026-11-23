import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  buildTrnBgoRegisterRow,
  buildTrnBgoRegisterSummary,
  getTrnBatchAllocationStatus,
  getTrnBgoBatchStatus,
  trnBgoRegisterSearchValue,
} from "./trnBgoRegisterModel.js";

test("TRN BGO batch status reads parent lifecycle state cleanly", () => {
  assert.equal(getTrnBgoBatchStatus({ workflowState: "READY_FOR_ALLOCATION" }), "READY FOR ALLOCATION");
  assert.equal(getTrnBgoBatchStatus({ raw: { workflow: { state: "ISSUED" } } }), "ISSUED");
  assert.equal(getTrnBgoBatchStatus({ workflowState: "ACCEPTED" }), "ACCEPTED");
  assert.equal(getTrnBgoBatchStatus({ workflowState: "IN_PROGRESS" }), "IN PROGRESS");
  assert.equal(getTrnBgoBatchStatus({ workflowState: "COMPLETED" }), "COMPLETED");
  assert.equal(getTrnBgoBatchStatus({ workflowState: "ACCEPTED", totalRows: 2, inProgressRows: 2, completedRows: 0 }), "IN PROGRESS");
  assert.equal(getTrnBgoBatchStatus({ workflowState: "ACCEPTED", totalRows: 2, inProgressRows: 0, completedRows: 2 }), "COMPLETED");
  assert.equal(getTrnBgoBatchStatus({ workflowState: "UNKNOWN" }), "NAv");
});

test("buildTrnBgoRegisterRow projects MD-aligned fields, allocation, and unallocate guards", () => {
  const unallocated = buildTrnBgoRegisterRow({
    id: "TRN_BGO_1",
    contractVersion: "1.0.0",
    trnType: "MDCN",
    fileName: "meters.csv",
    workflowState: "READY_FOR_ALLOCATION",
    wardPcode: "ZA5241006",
    totalRows: 10,
    notStartedRows: 10,
    inProgressRows: 0,
    completedRows: 0,
  });
  assert.equal(unallocated.isAllocated, false);
  assert.equal(unallocated.allocation, "NOT ALLOCATED");
  assert.equal(unallocated.allocatedTo, "NAv");
  assert.equal(unallocated.batchStatus, "READY FOR ALLOCATION");
  assert.equal(unallocated.ward, "Ward 6");
  assert.equal(unallocated.wardNo, "006");
  assert.equal(unallocated.canDelete, true);

  const allocated = buildTrnBgoRegisterRow({
    id: "TRN_BGO_2",
    contractVersion: "1.0.0",
    trnType: "MRCN",
    fileName: "recon.csv",
    workflowState: "ISSUED",
    allocatedTo: "Alpha Team",
    wardPcode: "ZA5241012",
    totalRows: 5,
    notStartedRows: 5,
    inProgressRows: 0,
    completedRows: 0,
    raw: { workflow: { state: "ISSUED", issuedAt: "2026-11-15T10:00:00Z" } },
  });
  assert.equal(allocated.isAllocated, true);
  assert.equal(allocated.allocation, "ALLOCATED");
  assert.equal(allocated.allocatedTo, "Alpha Team");
  assert.equal(allocated.batchStatus, "ISSUED");
  assert.equal(allocated.fieldworkStarted, false);
  assert.equal(allocated.unallocationIntentUnavailable, false);
  assert.equal(allocated.canDelete, true);
  assert.match(trnBgoRegisterSearchValue(allocated), /Alpha Team/);
  assert.match(trnBgoRegisterSearchValue(allocated), /ZA5241012/);

  const inProgress = buildTrnBgoRegisterRow({
    id: "TRN_BGO_3",
    contractVersion: "1.0.0",
    workflowState: "IN_PROGRESS",
    allocatedTo: "Beta SP",
    totalRows: 5,
    notStartedRows: 3,
    inProgressRows: 2,
    completedRows: 0,
    raw: { workflow: { state: "IN_PROGRESS", issuedAt: "2026-11-15T10:00:00Z" } },
  });
  assert.equal(inProgress.fieldworkStarted, true);
  assert.equal(inProgress.canDelete, false);
});

test("getTrnBatchAllocationStatus strictly returns Allocated or Unallocated", () => {
  assert.equal(getTrnBatchAllocationStatus({ workflowState: "READY_FOR_ALLOCATION" }).label, "Unallocated");
  assert.equal(getTrnBatchAllocationStatus({ workflowState: "ISSUED" }).label, "Allocated");
  assert.equal(getTrnBatchAllocationStatus({ allocatedTo: "Team A" }).label, "Allocated");
});

test("TrnBgoRegisterPage aligns columns, sticky pins, and unallocate controls with MdBgoRegisterPage", async () => {
  const screen = await readFile(new URL("../TrnBgoRegisterPage.jsx", import.meta.url), "utf8");
  const expectedOrder = [
    'key: "select"',
    'key: "map"',
    'key: "batchId"',
    'key: "trnType"',
    'key: "fileName"',
    'key: "bgoRows"',
    'key: "allocation"',
    'key: "allocatedTo"',
    'key: "batchStatus"',
    'key: "totalRows"',
    'key: "notStartedRows"',
    'key: "inProgressRows"',
    'key: "completedRows"',
    'key: "ward"',
    'key: "geofence"',
    'key: "createdBy"',
    'key: "delete"',
  ];
  let lastIdx = -1;
  for (const token of expectedOrder) {
    const idx = screen.indexOf(token);
    assert.ok(idx > lastIdx, `Expected ${token} to appear in order`);
    lastIdx = idx;
  }
  assert.match(screen, /stickyColumnKeys=\{\["select", "map", "batchId"\]\}/);
  assert.match(screen, /useAllocateTrnBgoWardBatchesMutation/);
  assert.match(screen, /targetType:\s*"UNALLOCATE"/);
});

test("buildTrnBgoRegisterSummary consolidates batch states and meter columns cleanly", () => {
  const sampleBatches = [
    { id: "B1", workflowState: "READY_FOR_ALLOCATION", totalRows: 4, notStartedRows: 4, inProgressRows: 0, completedRows: 0 },
    { id: "B2", workflowState: "READY_FOR_ALLOCATION", totalRows: 6, notStartedRows: 6, inProgressRows: 0, completedRows: 0 },
    { id: "B3", workflowState: "READY_FOR_ALLOCATION", totalRows: 5, notStartedRows: 5, inProgressRows: 0, completedRows: 0 },
    { id: "B4", workflowState: "IN_PROGRESS", totalRows: 7, notStartedRows: 5, inProgressRows: 1, completedRows: 1 },
    { id: "B5", workflowState: "COMPLETED", totalRows: 1, notStartedRows: 0, inProgressRows: 0, completedRows: 1 },
    { id: "B6", workflowState: "IN_PROGRESS", totalRows: 2, notStartedRows: 0, inProgressRows: 2, completedRows: 0 },
    { id: "B7", workflowState: "IN_PROGRESS", totalRows: 3, notStartedRows: 1, inProgressRows: 0, completedRows: 2 },
    { id: "B8", workflowState: "COMPLETED", totalRows: 2, notStartedRows: 0, inProgressRows: 0, completedRows: 2 },
    { id: "B9", workflowState: "IN_PROGRESS", totalRows: 2, notStartedRows: 1, inProgressRows: 1, completedRows: 0 },
  ];

  assert.deepEqual(buildTrnBgoRegisterSummary(sampleBatches), {
    totalBatches: 9,
    totalMeters: 32,
    notStartedBatches: 3,
    notStartedMeters: 22,
    inProgressBatches: 4,
    inProgressMeters: 4,
    completedBatches: 2,
    completedMeters: 6,
  });

  assert.deepEqual(buildTrnBgoRegisterSummary(sampleBatches, { pendingOrError: true }), {
    totalBatches: 9,
    totalMeters: 32,
    notStartedBatches: null,
    notStartedMeters: null,
    inProgressBatches: null,
    inProgressMeters: null,
    completedBatches: null,
    completedMeters: null,
  });
});

test("trnBgoProgress aligns QA PASS and QA FAIL rows with completedRows", async () => {
  const { trnBgoProgress } = await import("../../../redux/trnBgoProgress.js");
  const counts = trnBgoProgress([
    { id: "T1", origin: { trnBgo: { batchId: "B1" } }, workflow: { state: "ISSUED" } },
    { id: "T2", origin: { trnBgo: { batchId: "B1" } }, workflow: { state: "IN_PROGRESS" } },
    { id: "T3", origin: { trnBgo: { batchId: "B1" } }, workflow: { state: "COMPLETED" } },
    { id: "T4", origin: { trnBgo: { batchId: "B1" } }, workflow: { state: "QA PASS" } },
    { id: "T5", origin: { trnBgo: { batchId: "B1" } }, workflow: { state: "QA FAIL" } },
  ]);
  assert.deepEqual(counts.B1, {
    notStartedRows: 1,
    inProgressRows: 1,
    completedRows: 3,
    total: 5,
  });
});
