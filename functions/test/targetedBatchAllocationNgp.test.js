import assert from "node:assert/strict";
import test from "node:test";

import {
  allocateNonGpsBatchAtomically,
  isNonGpsTargetedBatch,
} from "../targetedBatches/allocationCallable.js";

test("new PREPAID_SALES_NON_GPS source uses atomic NGTB allocation", () => {
  assert.equal(
    isNonGpsTargetedBatch({
      source: { type: "PREPAID_SALES_NON_GPS" },
      selection: { planningMode: "NON_GPS_STREET" },
    }),
    true,
  );
});

test("legacy Sales NGTB is recognised only as PREPAID_SALES plus NON_GPS_STREET", () => {
  assert.equal(
    isNonGpsTargetedBatch({
      source: { type: "PREPAID_SALES" },
      selection: { planningMode: "NON_GPS_STREET" },
    }),
    true,
  );
});

test("ordinary GPS Sales Targeted Batch stays on the existing allocation path", () => {
  assert.equal(
    isNonGpsTargetedBatch({
      source: { type: "PREPAID_SALES" },
      selection: { planningMode: "WARD_ERF" },
    }),
    false,
  );
});

test("NON_GPS_STREET alone cannot move CSV or unknown sources into NGTB allocation", () => {
  for (const sourceType of ["CSV", "TARGETED_BATCH_CSV", "UNKNOWN", ""]) {
    assert.equal(
      isNonGpsTargetedBatch({
        source: { type: sourceType },
        selection: { planningMode: "NON_GPS_STREET" },
      }),
      false,
      sourceType || "blank source",
    );
  }
});


function makeRowSnapshot(id, tbId, allocation = {}) {
  return {
    id,
    ref: { kind: "rowRef", id },
    data: () => ({
      tbId,
      allocation: {
        status: "UNALLOCATED",
        allocatable: true,
        ...allocation,
      },
      execution: { status: "NOT_STARTED" },
    }),
  };
}

function makeAtomicDb({
  tbId = "TGB_20260816_060948_U7E2",
  rowCount = 2,
  parentOverrides = {},
  rowSnapshots = null,
} = {}) {
  const parent = {
    id: tbId,
    source: { type: "PREPAID_SALES_NON_GPS" },
    selection: { planningMode: "NON_GPS_STREET" },
    creation: { state: "READY", expectedRows: rowCount },
    status: "CREATED",
    allocation: { status: "UNALLOCATED" },
    execution: { status: "NOT_STARTED" },
    counts: {
      totalRows: rowCount,
      allocatedRows: 0,
      unallocatedRows: rowCount,
    },
    ...parentOverrides,
  };
  const rows =
    rowSnapshots ||
    Array.from({ length: rowCount }, (_, index) =>
      makeRowSnapshot(`ROW_${index + 1}`, tbId),
    );
  const parentRef = { kind: "parentRef", id: tbId };
  const teamRef = { kind: "teamRef", id: "TEAM_A" };
  const reads = [];
  const writes = [];

  const transaction = {
    async get(refOrQuery) {
      reads.push(refOrQuery);
      if (refOrQuery === parentRef) {
        return { exists: true, data: () => parent };
      }
      if (refOrQuery?.kind === "rowsQuery") {
        return { docs: rows };
      }
      if (refOrQuery?.kind === "teamRef") {
        return {
          exists: true,
          id: refOrQuery.id,
          data: () => ({
            team: { status: "ACTIVE", name: "Team A" },
            ownership: { mncServiceProviderId: "MNC_1" },
            scope: { memberUserIds: ["U1", "U2"] },
          }),
        };
      }
      throw new Error(`Unexpected transaction read: ${JSON.stringify(refOrQuery)}`);
    },
    update(ref, data) {
      writes.push({ ref, data });
    },
  };

  const db = {
    collection(name) {
      if (name === "tb_rows") {
        return {
          where(field, operator, value) {
            assert.equal(field, "tbId");
            assert.equal(operator, "==");
            assert.equal(value, tbId);
            return { kind: "rowsQuery", tbId: value };
          },
        };
      }
      if (name === "teams") {
        return {
          doc(id) {
            return { ...teamRef, id };
          },
        };
      }
      throw new Error(`Unexpected collection: ${name}`);
    },
    async runTransaction(callback) {
      return callback(transaction);
    },
  };

  return { db, parentRef, reads, writes, rows, parent };
}

test("atomic NGTB allocation discovers rows and TEAM authority inside the transaction", async () => {
  const fixture = makeAtomicDb({ rowCount: 2 });

  const result = await allocateNonGpsBatchAtomically({
    db: fixture.db,
    parentRef: fixture.parentRef,
    tbId: fixture.parent.id,
    targetType: "TEAM",
    targetId: "TEAM_A",
    actorMncId: "MNC_1",
    actorUid: "ALLOCATOR",
    actorName: "Allocator",
    startedAtMs: Date.now(),
  });

  assert.equal(result.success, true);
  assert.equal(result.atomic, true);
  assert.equal(result.totalRows, 2);
  assert.ok(fixture.reads.some((read) => read?.kind === "rowsQuery"));
  assert.ok(fixture.reads.some((read) => read?.kind === "teamRef"));
  assert.equal(fixture.writes.length, 3);
  assert.equal(
    fixture.writes.filter((write) => write.ref?.kind === "rowRef").length,
    2,
  );
  const parentWrite = fixture.writes.find(
    (write) => write.ref === fixture.parentRef,
  );
  assert.equal(parentWrite.data.status, "ALLOCATED");
  assert.equal(parentWrite.data["counts.allocatedRows"], 2);
  assert.equal(parentWrite.data["counts.unallocatedRows"], 0);
});

test("atomic NGTB allocation fails before writes when authoritative row count changed", async () => {
  const fixture = makeAtomicDb({
    rowCount: 2,
    rowSnapshots: [makeRowSnapshot("ROW_1", "TGB_20260816_060948_U7E2")],
  });

  await assert.rejects(
    () =>
      allocateNonGpsBatchAtomically({
        db: fixture.db,
        parentRef: fixture.parentRef,
        tbId: fixture.parent.id,
        targetType: "TEAM",
        targetId: "TEAM_A",
        actorMncId: "MNC_1",
        actorUid: "ALLOCATOR",
        actorName: "Allocator",
        startedAtMs: Date.now(),
      }),
    (error) => error?.code === "TARGETED_BATCH_ROW_COUNT_MISMATCH",
  );

  assert.equal(fixture.writes.length, 0);
});

test("atomic NGTB identical retry is idempotent when parent and every row already match", async () => {
  const tbId = "TGB_20260816_060948_U7E2";
  const rows = [
    makeRowSnapshot("ROW_1", tbId, {
      status: "ALLOCATED",
      targetType: "TEAM",
      targetId: "TEAM_A",
    }),
    makeRowSnapshot("ROW_2", tbId, {
      status: "ALLOCATED",
      targetType: "TEAM",
      targetId: "TEAM_A",
    }),
  ];
  const fixture = makeAtomicDb({
    rowCount: 2,
    rowSnapshots: rows,
    parentOverrides: {
      status: "ALLOCATED",
      allocation: {
        status: "ALLOCATED",
        targetType: "TEAM",
        targetId: "TEAM_A",
        targetName: "Team A",
      },
      counts: { totalRows: 2, allocatedRows: 2, unallocatedRows: 0 },
    },
  });

  const result = await allocateNonGpsBatchAtomically({
    db: fixture.db,
    parentRef: fixture.parentRef,
    tbId,
    targetType: "TEAM",
    targetId: "TEAM_A",
    actorMncId: "MNC_1",
    actorUid: "ALLOCATOR",
    actorName: "Allocator",
    startedAtMs: Date.now(),
  });

  assert.equal(result.success, true);
  assert.equal(result.alreadyAllocated, true);
  assert.equal(fixture.writes.length, 0);
});

test("atomic NGTB conflicting target fails with zero writes", async () => {
  const fixture = makeAtomicDb({
    rowCount: 2,
    parentOverrides: {
      status: "ALLOCATED",
      allocation: {
        status: "ALLOCATED",
        targetType: "TEAM",
        targetId: "TEAM_B",
        targetName: "Team B",
      },
      counts: { totalRows: 2, allocatedRows: 2, unallocatedRows: 0 },
    },
  });

  await assert.rejects(
    () =>
      allocateNonGpsBatchAtomically({
        db: fixture.db,
        parentRef: fixture.parentRef,
        tbId: fixture.parent.id,
        targetType: "TEAM",
        targetId: "TEAM_A",
        actorMncId: "MNC_1",
        actorUid: "ALLOCATOR",
        actorName: "Allocator",
        startedAtMs: Date.now(),
      }),
    (error) => error?.code === "TARGETED_BATCH_ALREADY_ALLOCATED",
  );

  assert.equal(fixture.writes.length, 0);
});

test("atomic NGTB allocation fails closed when authoritative parent row count is missing", async () => {
  const fixture = makeAtomicDb({
    rowCount: 2,
    parentOverrides: {
      creation: { state: "READY" },
      counts: { allocatedRows: 0, unallocatedRows: 2 },
    },
  });

  await assert.rejects(
    () =>
      allocateNonGpsBatchAtomically({
        db: fixture.db,
        parentRef: fixture.parentRef,
        tbId: fixture.parent.id,
        targetType: "TEAM",
        targetId: "TEAM_A",
        actorMncId: "MNC_1",
        actorUid: "ALLOCATOR",
        actorName: "Allocator",
        startedAtMs: Date.now(),
      }),
    (error) => error?.code === "NGP_ALLOCATION_EXPECTED_ROW_COUNT_INVALID",
  );

  assert.equal(fixture.writes.length, 0);
});

test("atomic NGTB allocation fails closed when authoritative parent row count is zero", async () => {
  const fixture = makeAtomicDb({
    rowCount: 2,
    parentOverrides: {
      creation: { state: "READY", expectedRows: 0 },
      counts: { totalRows: 0, allocatedRows: 0, unallocatedRows: 2 },
    },
  });

  await assert.rejects(
    () =>
      allocateNonGpsBatchAtomically({
        db: fixture.db,
        parentRef: fixture.parentRef,
        tbId: fixture.parent.id,
        targetType: "TEAM",
        targetId: "TEAM_A",
        actorMncId: "MNC_1",
        actorUid: "ALLOCATOR",
        actorName: "Allocator",
        startedAtMs: Date.now(),
      }),
    (error) => error?.code === "NGP_ALLOCATION_EXPECTED_ROW_COUNT_INVALID",
  );

  assert.equal(fixture.writes.length, 0);
});

test("atomic NGTB allocation fails closed when authoritative parent row count is non-numeric", async () => {
  const fixture = makeAtomicDb({
    rowCount: 2,
    parentOverrides: {
      creation: { state: "READY", expectedRows: "two" },
      counts: { totalRows: "two", allocatedRows: 0, unallocatedRows: 2 },
    },
  });

  await assert.rejects(
    () =>
      allocateNonGpsBatchAtomically({
        db: fixture.db,
        parentRef: fixture.parentRef,
        tbId: fixture.parent.id,
        targetType: "TEAM",
        targetId: "TEAM_A",
        actorMncId: "MNC_1",
        actorUid: "ALLOCATOR",
        actorName: "Allocator",
        startedAtMs: Date.now(),
      }),
    (error) => error?.code === "NGP_ALLOCATION_EXPECTED_ROW_COUNT_INVALID",
  );

  assert.equal(fixture.writes.length, 0);
});

test("atomic NGTB allocation fails closed when parent row-count fields conflict", async () => {
  const fixture = makeAtomicDb({
    rowCount: 2,
    parentOverrides: {
      creation: { state: "READY", expectedRows: 2 },
      counts: { totalRows: 3, allocatedRows: 0, unallocatedRows: 2 },
    },
  });

  await assert.rejects(
    () =>
      allocateNonGpsBatchAtomically({
        db: fixture.db,
        parentRef: fixture.parentRef,
        tbId: fixture.parent.id,
        targetType: "TEAM",
        targetId: "TEAM_A",
        actorMncId: "MNC_1",
        actorUid: "ALLOCATOR",
        actorName: "Allocator",
        startedAtMs: Date.now(),
      }),
    (error) => error?.code === "NGP_ALLOCATION_EXPECTED_ROW_COUNT_CONFLICT",
  );

  assert.equal(fixture.writes.length, 0);
});
