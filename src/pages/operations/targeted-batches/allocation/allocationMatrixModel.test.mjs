import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOrganisationAllocationMatrix,
  buildOrganisationAllocationMatrixResult,
  buildUserExecutionMatrix,
  getBatchAllocationIntegrity,
  getCanonicalBatchState,
  getPendingAllocationProjectionMeters,
  projectOrganisationAllocation,
} from "./allocationMatrixModel.js";

function allocatedBatch({
  id,
  targetId = "TEAM_A",
  targetName = "Team A",
  targetType = "TEAM",
  totalRows = 2,
  completedRows = 0,
  startedRows = completedRows,
  acceptanceStatus = "WAITING",
  executionStatus = "NOT_STARTED",
  sourceType = "PREPAID_SALES",
} = {}) {
  return {
    id,
    source: { type: sourceType },
    creation: { state: "READY", expectedRows: totalRows },
    status: "ALLOCATED",
    allocation: {
      status: "ALLOCATED",
      targetType,
      targetId,
      targetName,
    },
    acceptance: { status: acceptanceStatus },
    execution: { status: executionStatus },
    counts: {
      totalRows,
      allocatedRows: totalRows,
      unallocatedRows: 0,
      completedRows,
      executionStartedRows: startedRows,
    },
  };
}

function allocationRowsFor(batch, { count, targetId, targetType } = {}) {
  const totalRows = count ?? Number(batch?.counts?.totalRows || 0);
  const resolvedTargetId = targetId ?? batch?.allocation?.targetId;
  const resolvedTargetType = targetType ?? batch?.allocation?.targetType;

  return Array.from({ length: totalRows }, (_, index) => ({
    id: `${batch.id}_ROW_${index + 1}`,
    tbId: batch.id,
    allocation: {
      status: "ALLOCATED",
      targetType: resolvedTargetType,
      targetId: resolvedTargetId,
      targetName: batch?.allocation?.targetName,
    },
    execution: { status: "NOT_STARTED" },
  }));
}


test("canonical state derives the common lifecycle from current persisted fields", () => {
  assert.equal(getCanonicalBatchState({ creation: { state: "READY" } }), "CREATED");
  assert.equal(
    getCanonicalBatchState({
      creation: { state: "READY" },
      allocation: { status: "ALLOCATING" },
    }),
    "CREATED",
  );
  assert.equal(
    getCanonicalBatchState({ allocation: { status: "ALLOCATED" } }),
    "ALLOCATED",
  );
  assert.equal(
    getCanonicalBatchState({ acceptance: { status: "ACCEPTED" } }),
    "ACCEPTED",
  );
  assert.equal(
    getCanonicalBatchState({ acceptance: { status: "REJECTED" } }),
    "REJECTED",
  );
  assert.equal(
    getCanonicalBatchState({ execution: { status: "COMPLETED" } }),
    "COMPLETED",
  );
});

test("completed historical work remains assigned while active remaining falls", () => {
  const batch = allocatedBatch({
    id: "TGB_1",
    totalRows: 8,
    completedRows: 2,
    startedRows: 3,
    acceptanceStatus: "ACCEPTED",
    executionStatus: "IN_PROGRESS",
  });
  const [team] = buildOrganisationAllocationMatrix({
    batches: [batch],
    rows: allocationRowsFor(batch),
    teams: [{ id: "TEAM_A", name: "Team A", eligible: true }],
  });

  assert.equal(team.assignedMeters, 8);
  assert.equal(team.completedMeters, 2);
  assert.equal(team.remainingMeters, 6);
  assert.equal(team.inProgressMeters, 1);
  assert.equal(team.progressPct, 25);
});

test("rejected work remains historical and is reported as unresolved, not released", () => {
  const batch = allocatedBatch({
    id: "REJECTED",
    totalRows: 5,
    completedRows: 1,
    acceptanceStatus: "REJECTED",
  });
  const [team] = buildOrganisationAllocationMatrix({
    batches: [batch],
    rows: allocationRowsFor(batch),
    teams: [{ id: "TEAM_A", name: "Team A", eligible: true }],
  });

  assert.equal(team.assignedMeters, 5);
  assert.equal(team.completedMeters, 1);
  assert.equal(team.rejectedBatches, 1);
  assert.equal(team.remainingMeters, 0);
  assert.equal(team.rejectedUnresolvedMeters, 4);
});

test("completed batch remains in historical allocation with zero active remaining", () => {
  const [team] = buildOrganisationAllocationMatrix({
    batches: [
      allocatedBatch({
        id: "DONE",
        totalRows: 4,
        completedRows: 4,
        startedRows: 4,
        acceptanceStatus: "ACCEPTED",
        executionStatus: "COMPLETED",
      }),
    ],
    teams: [{ id: "TEAM_A", name: "Team A", eligible: true }],
  });

  assert.equal(team.assignedMeters, 4);
  assert.equal(team.completedMeters, 4);
  assert.equal(team.remainingMeters, 0);
  assert.equal(team.completedBatches, 1);
  assert.equal(team.progressPct, 100);
});

test("partial or inconsistent parent allocation is quarantined from matrix totals", () => {
  const badBatch = allocatedBatch({ id: "BAD", totalRows: 5 });
  badBatch.counts.allocatedRows = 4;
  badBatch.counts.unallocatedRows = 1;

  const integrity = getBatchAllocationIntegrity(badBatch);
  assert.equal(integrity.ok, false);
  assert.ok(integrity.issues.includes("ALLOCATED_ROW_COUNT_MISMATCH"));
  assert.ok(integrity.issues.includes("UNALLOCATED_ROWS_REMAIN"));

  const [team] = buildOrganisationAllocationMatrix({
    batches: [badBatch],
    teams: [{ id: "TEAM_A", name: "Team A", eligible: true }],
  });

  assert.equal(team.batches, 0);
  assert.equal(team.assignedMeters, 0);
  assert.equal(team.integrityIssueBatches, 1);
});

test("mixed active row targets are quarantined from matrix totals", () => {
  const batch = allocatedBatch({ id: "MIXED", totalRows: 2 });
  const rows = allocationRowsFor(batch);
  rows[1] = {
    ...rows[1],
    allocation: {
      ...rows[1].allocation,
      targetId: "TEAM_B",
      targetName: "Team B",
    },
  };

  const [team] = buildOrganisationAllocationMatrix({
    batches: [batch],
    rows,
    teams: [{ id: "TEAM_A", name: "Team A", eligible: true }],
  });

  assert.equal(team.batches, 0);
  assert.equal(team.assignedMeters, 0);
  assert.equal(team.integrityIssueBatches, 1);
});

test("missing active rows are quarantined from matrix totals", () => {
  const batch = allocatedBatch({ id: "MISSING", totalRows: 2 });
  const [team] = buildOrganisationAllocationMatrix({
    batches: [batch],
    rows: allocationRowsFor(batch, { count: 1 }),
    teams: [{ id: "TEAM_A", name: "Team A", eligible: true }],
  });

  assert.equal(team.batches, 0);
  assert.equal(team.assignedMeters, 0);
  assert.equal(team.integrityIssueBatches, 1);
});

test("GPS and Non-GPS Sales Targeted Batches share the same matrix", () => {
  const batches = [
    allocatedBatch({ id: "GPS", totalRows: 2, sourceType: "PREPAID_SALES" }),
    allocatedBatch({
      id: "NGP",
      totalRows: 3,
      sourceType: "PREPAID_SALES_NON_GPS",
    }),
  ];

  const [team] = buildOrganisationAllocationMatrix({
    batches,
    rows: batches.flatMap((batch) => allocationRowsFor(batch)),
    teams: [{ id: "TEAM_A", name: "Team A", eligible: true }],
  });
  assert.equal(team.batches, 2);
  assert.equal(team.assignedMeters, 5);
});

test("eligible TEAM average excludes inactive historical organisations", () => {
  const batches = [
    allocatedBatch({ id: "A", targetId: "A", targetName: "A", totalRows: 60 }),
    allocatedBatch({ id: "B", targetId: "B", targetName: "B", totalRows: 40 }),
    allocatedBatch({ id: "OLD", targetId: "OLD", targetName: "Old", totalRows: 100 }),
  ];
  const organisations = buildOrganisationAllocationMatrix({
    batches,
    rows: batches.flatMap((batch) => allocationRowsFor(batch)),
    teams: [
      { id: "A", name: "A", eligible: true },
      { id: "B", name: "B", eligible: true },
    ],
  });

  const a = organisations.find((item) => item.id === "A");
  const b = organisations.find((item) => item.id === "B");
  const old = organisations.find((item) => item.id === "OLD");

  assert.equal(a.typeAverageAssigned, 50);
  assert.equal(a.varianceFromTypeAverage, 10);
  assert.equal(b.varianceFromTypeAverage, -10);
  assert.equal(old.eligible, false);
  assert.equal(old.varianceFromTypeAverage, null);
  assert.equal(old.assignedMeters, 100);
});

test("projection shows after-this-allocation position against eligible same-type average", () => {
  const organisations = [
    { type: "TEAM", id: "A", eligible: true, assignedMeters: 60, remainingMeters: 5 },
    { type: "TEAM", id: "B", eligible: true, assignedMeters: 40, remainingMeters: 30 },
    { type: "TEAM", id: "C", eligible: true, assignedMeters: 20, remainingMeters: 20 },
    { type: "TEAM", id: "OLD", eligible: false, assignedMeters: 100, remainingMeters: 0 },
    { type: "SP", id: "SP1", eligible: true, assignedMeters: 300, remainingMeters: 10 },
  ];

  const projected = projectOrganisationAllocation({
    organisation: organisations[2],
    allOrganisations: organisations,
    incomingMeters: 20,
  });

  assert.equal(projected.projectedAssigned, 40);
  assert.equal(projected.projectedRemaining, 40);
  assert.equal(projected.projectedTypeAverageAssigned, 46.7);
  assert.equal(projected.projectedVarianceFromTypeAverage, -6.7);
});

test("projection is suppressed for inactive organisations or zero incoming work", () => {
  assert.equal(
    projectOrganisationAllocation({
      organisation: { type: "TEAM", id: "OLD", eligible: false },
      allOrganisations: [],
      incomingMeters: 10,
    }),
    null,
  );
  assert.equal(
    projectOrganisationAllocation({
      organisation: { type: "TEAM", id: "A", eligible: true },
      allOrganisations: [{ type: "TEAM", id: "A", eligible: true }],
      incomingMeters: 0,
    }),
    null,
  );
});

test("pending projection meters require a complete CREATED batch row set", () => {
  const batch = {
    id: "PENDING",
    source: { type: "PREPAID_SALES_NON_GPS" },
    creation: { state: "READY", expectedRows: 2 },
    allocation: { status: "UNALLOCATED" },
    execution: { status: "NOT_STARTED" },
    counts: { totalRows: 2, allocatedRows: 0, unallocatedRows: 2 },
  };
  const rows = [
    { id: "R1", tbId: batch.id, allocation: { status: "UNALLOCATED" }, execution: { status: "NOT_STARTED" } },
    { id: "R2", tbId: batch.id, allocation: { status: "UNALLOCATED" }, execution: { status: "NOT_STARTED" } },
  ];

  assert.equal(
    getPendingAllocationProjectionMeters({ batch, rows, rowsReady: true }),
    2,
  );
  assert.equal(
    getPendingAllocationProjectionMeters({ batch, rows: rows.slice(0, 1), rowsReady: true }),
    0,
  );
  assert.equal(
    getPendingAllocationProjectionMeters({ batch, rows: null, rowsReady: true }),
    0,
  );

  const allocated = {
    ...batch,
    status: "ALLOCATED",
    allocation: { status: "ALLOCATED", targetType: "TEAM", targetId: "A" },
    counts: { ...batch.counts, allocatedRows: 2, unallocatedRows: 0 },
  };
  assert.equal(
    getPendingAllocationProjectionMeters({
      batch: allocated,
      rows,
      rowsReady: true,
    }),
    0,
  );
});

test("user matrix reports execution attribution and never creates user allocation", () => {
  const result = buildUserExecutionMatrix({
    users: [{ id: "U1", profile: { displayName: "Field User" } }],
    batches: [
      {
        id: "TGB",
        source: { type: "PREPAID_SALES" },
        acceptance: { status: "ACCEPTED", acceptedByUid: "U1" },
      },
    ],
    rows: [
      {
        id: "ROW",
        tbId: "TGB",
        execution: { status: "COMPLETED" },
        metadata: { updatedByUid: "U1", updatedByUser: "Field User" },
      },
    ],
  });

  assert.equal(result[0].acceptedBatches, 1);
  assert.equal(result[0].completedRows, 1);
  assert.equal(result[0].attributedRows, 1);
  assert.equal(result[0].progressPct, 100);
  assert.equal("allocatedMeters" in result[0], false);
});

test("targetless successful allocation is quarantined and surfaced globally", () => {
  const batch = allocatedBatch({ id: "TARGETLESS", totalRows: 2 });
  batch.allocation = { status: "ALLOCATED" };

  const result = buildOrganisationAllocationMatrixResult({
    batches: [batch],
    rows: allocationRowsFor(batch),
    teams: [{ id: "TEAM_A", name: "Team A", eligible: true }],
  });

  assert.equal(result.organisations[0].assignedMeters, 0);
  assert.equal(result.integrityIssues.length, 1);
  assert.equal(result.integrityIssues[0].batchId, "TARGETLESS");
  assert.ok(
    result.integrityIssues[0].issues.includes("ALLOCATION_TARGET_MISSING"),
  );
});

test("projected Project Share uses the complete project denominator", () => {
  const organisations = [
    { type: "TEAM", id: "A", eligible: true, assignedMeters: 20, remainingMeters: 5 },
    { type: "TEAM", id: "B", eligible: true, assignedMeters: 100, remainingMeters: 20 },
    { type: "SP", id: "SP1", eligible: true, assignedMeters: 300, remainingMeters: 10 },
  ];

  const projected = projectOrganisationAllocation({
    organisation: organisations[0],
    allOrganisations: organisations,
    incomingMeters: 20,
  });

  assert.equal(projected.projectedAssigned, 40);
  assert.equal(projected.projectedProjectSharePct, 9.1);
  assert.equal(projected.projectedTypeSharePct, 28.6);
});

test("pending projection is suppressed when CREATED parent rows already show allocation", () => {
  const batch = {
    id: "STALE_CREATED_ALLOCATED_ROW",
    source: { type: "PREPAID_SALES_NON_GPS" },
    creation: { state: "READY", expectedRows: 2 },
    allocation: { status: "UNALLOCATED" },
    execution: { status: "NOT_STARTED" },
    counts: { totalRows: 2, allocatedRows: 0, unallocatedRows: 2 },
  };
  const rows = [
    {
      id: "R1",
      tbId: batch.id,
      allocation: { status: "ALLOCATED", targetType: "TEAM", targetId: "A" },
      execution: { status: "NOT_STARTED" },
    },
    {
      id: "R2",
      tbId: batch.id,
      allocation: { status: "UNALLOCATED" },
      execution: { status: "NOT_STARTED" },
    },
  ];

  assert.equal(
    getPendingAllocationProjectionMeters({ batch, rows, rowsReady: true }),
    0,
  );
});

test("pending projection is suppressed when CREATED parent rows already show execution", () => {
  const batch = {
    id: "STALE_CREATED_EXECUTING_ROW",
    source: { type: "PREPAID_SALES_NON_GPS" },
    creation: { state: "READY", expectedRows: 2 },
    allocation: { status: "UNALLOCATED" },
    execution: { status: "NOT_STARTED" },
    counts: { totalRows: 2, allocatedRows: 0, unallocatedRows: 2 },
  };
  const rows = [
    {
      id: "R1",
      tbId: batch.id,
      allocation: { status: "UNALLOCATED" },
      execution: { status: "IN_PROGRESS" },
    },
    {
      id: "R2",
      tbId: batch.id,
      allocation: { status: "UNALLOCATED" },
      execution: { status: "NOT_STARTED" },
    },
  ];

  assert.equal(
    getPendingAllocationProjectionMeters({ batch, rows, rowsReady: true }),
    0,
  );
});

test("pending projection is suppressed for all post-CREATED lifecycle states", () => {
  const base = {
    id: "STATE_TEST",
    source: { type: "PREPAID_SALES_NON_GPS" },
    creation: { state: "READY", expectedRows: 2 },
    allocation: { status: "UNALLOCATED" },
    acceptance: { status: "WAITING" },
    execution: { status: "NOT_STARTED" },
    counts: { totalRows: 2, allocatedRows: 0, unallocatedRows: 2 },
  };
  const rows = [
    { id: "R1", tbId: base.id, allocation: { status: "UNALLOCATED" }, execution: { status: "NOT_STARTED" } },
    { id: "R2", tbId: base.id, allocation: { status: "UNALLOCATED" }, execution: { status: "NOT_STARTED" } },
  ];

  const states = [
    {
      allocation: { status: "ALLOCATED", targetType: "TEAM", targetId: "A" },
      counts: { totalRows: 2, allocatedRows: 2, unallocatedRows: 0 },
    },
    {
      allocation: { status: "ALLOCATED", targetType: "TEAM", targetId: "A" },
      acceptance: { status: "ACCEPTED" },
      counts: { totalRows: 2, allocatedRows: 2, unallocatedRows: 0 },
    },
    {
      allocation: { status: "ALLOCATED", targetType: "TEAM", targetId: "A" },
      acceptance: { status: "REJECTED" },
      counts: { totalRows: 2, allocatedRows: 2, unallocatedRows: 0 },
    },
    {
      allocation: { status: "ALLOCATED", targetType: "TEAM", targetId: "A" },
      acceptance: { status: "ACCEPTED" },
      execution: { status: "COMPLETED" },
      counts: { totalRows: 2, allocatedRows: 2, unallocatedRows: 0, completedRows: 2 },
    },
  ];

  for (const overrides of states) {
    const batch = { ...base, ...overrides };
    assert.equal(
      getPendingAllocationProjectionMeters({ batch, rows, rowsReady: true }),
      0,
    );
  }
});

test("pending projection accepts a complete clean physical row set", () => {
  const batch = {
    id: "CLEAN_CREATED",
    source: { type: "PREPAID_SALES_NON_GPS" },
    creation: { state: "READY", expectedRows: 2 },
    allocation: { status: "UNALLOCATED" },
    execution: { status: "NOT_STARTED" },
    counts: { totalRows: 2, allocatedRows: 0, unallocatedRows: 2 },
  };
  const rows = [
    { id: "R1", tbId: batch.id, allocation: { status: "UNALLOCATED" }, execution: { status: "NOT_STARTED" } },
    { id: "R2", tbId: batch.id, allocation: { status: "UNALLOCATED" }, execution: { status: "NOT_STARTED" } },
  ];

  assert.equal(
    getPendingAllocationProjectionMeters({ batch, rows, rowsReady: true }),
    2,
  );
});

test("user matrix uses normalized serviceProviderName when available", () => {
  const [user] = buildUserExecutionMatrix({
    users: [
      {
        id: "SP_USER",
        displayName: "SP User",
        serviceProviderName: "Field Services Pty",
      },
    ],
  });

  assert.equal(user.serviceProvider, "Field Services Pty");
});
