import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  buildTrnBgoRegisterRow,
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
