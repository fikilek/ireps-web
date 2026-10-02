// No Access rules NA-R003 / NA-R041 / NA-R084.1 — the batch half of the one no access.
//
// The twin of the Meter Discovery completion. These lock the behaviour that moved out of
// recordTargetedBatchNoAccessCallable when that screen and its callable were retired, and in
// particular the GMR-R038 trap, which is the one a fresh implementation walks straight into.

import test from "node:test";
import assert from "node:assert/strict";

import { recordTargetedBatchNoAccessInTransaction } from "../targetedBatches/premiseLink.js";

const TB_ID = "TGB_20260809_030009_WFIL";
const ROW_ID = "TBR_20260809_030009_WFIL_000001";
const SALES_ID = "07027981971";
const ERF_ID = "K241N0GT030900000654000000";
const NOW = { seconds: 1, nanoseconds: 0 };
const ACTOR = { uid: "UID_1", name: "Siya Siya" };

function salesContext(patch = {}) {
  return {
    sourceModule: "SALES_TARGETED_BATCH",
    operationType: "METER_DISCOVERY",
    tbId: TB_ID,
    rowId: ROW_ID,
    rowNo: 1,
    salesDocId: SALES_ID,
    erfId: ERF_ID,
    ...patch,
  };
}

function trn(patch = {}) {
  return {
    id: "TRN_MDIS_1786237424520_NA_9E8MU",
    targetedBatchContext: salesContext(),
    accessData: {
      trnType: "METER_DISCOVERY",
      erfId: ERF_ID,
      premise: null,
      access: { hasAccess: "no", reason: "Property Locked" },
    },
    metadata: { createdOnDevice: "2026-08-09T01:05:11.000Z" },
    ...patch,
  };
}

function snap(data) {
  return { exists: true, id: "X", data: () => data };
}

function parentDoc(patch = {}) {
  return {
    creation: { state: "READY" },
    allocation: { status: "ALLOCATED", targetType: "TEAM", targetId: "TEAM_1" },
    acceptance: { status: "ACCEPTED" },
    execution: { status: "NOT_STARTED" },
    counts: { executionStartedRows: 0, totalRows: 10 },
    ...patch,
  };
}

function rowDoc(patch = {}) {
  return {
    id: ROW_ID,
    tbId: TB_ID,
    decision: { status: "ACCEPT" },
    allocation: { status: "ALLOCATED", allocatable: true },
    execution: { status: "NOT_STARTED" },
    refs: { erfId: ERF_ID, premiseId: null },
    ...patch,
  };
}

// A reference with no field work yet omits the key entirely: an empty fieldWork object fails
// the Sales integrity check, which demands status and updatedAt once the key is present.
function salesDoc(fieldWork) {
  // An untouched reference carries neither rowId nor fieldWork: a row is linked to the Sales
  // record only once field work starts, and a rowId without fieldWork fails integrity.
  const reference = { id: TB_ID, date: NOW };
  if (fieldWork) {
    reference.rowId = ROW_ID;
    reference.fieldWork = { status: "IN_PROGRESS", updatedAt: NOW, ...fieldWork };
  }
  return { id: SALES_ID, targetedBatchId: TB_ID, tbRefs: [reference] };
}

/** A transaction that records what it was asked to write, and reads from a fixed set. */
function fakeTransaction({ parent, row, sales }) {
  const writes = [];
  return {
    writes,
    tx: {
      get: async (ref) => {
        const path = ref.__path;
        if (path === "uploads") return snap(parent);
        if (path === "rows") return snap(row);
        if (path === "sales") return snap(sales);
        throw new Error(`unexpected read: ${path}`);
      },
      update: (ref, patch) => writes.push({ path: ref.__path, patch }),
      create: (ref, data) => writes.push({ path: ref.__path, data, op: "create" }),
    },
  };
}

const db = {
  collection: (name) => ({
    doc: () => ({
      __path:
        name === "tb_uploads" ? "uploads" : name === "tb_rows" ? "rows" : "sales",
    }),
  }),
};

async function run({ parent = parentDoc(), row = rowDoc(), sales = salesDoc(), trnData = trn() } = {}) {
  const { tx, writes } = fakeTransaction({ parent, row, sales });
  const result = await recordTargetedBatchNoAccessInTransaction({
    transaction: tx, db, trnData, actor: ACTOR, now: NOW,
  });
  return { result, writes };
}

function writeFor(writes, path) {
  return writes.find((write) => write.path === path)?.patch;
}

/* ------------------------------------------------------------------ *
 * The GMR-R038 trap — the one that bites a fresh implementation
 * ------------------------------------------------------------------ */

test("GMR-R038: a context the SERVER stamped is not Sales Path work, and nothing is written", async () => {
  // The worker came in on the Normal Path on a premise that happens to belong to a batch.
  // Treating that as a hand-over is what left a row NOT_STARTED with the worker told nothing
  // (owner, on TEST, 2026-09-28). The no access still stands; no row is touched.
  const { result, writes } = await run({
    trnData: trn({
      targetedBatchContext: { recognisedBy: "IREPS", rule: "GMR-R038", tbId: TB_ID },
    }),
  });

  assert.equal(result.applied, false);
  assert.equal(result.reason, "RECOGNISED_CONTEXT_ONLY");
  assert.equal(writes.length, 0, "a recognised context must write nothing");
});

test("a no access with no batch context at all writes nothing and does not throw", async () => {
  const { result, writes } = await run({
    trnData: trn({ targetedBatchContext: null }),
  });

  assert.equal(result.applied, false);
  assert.equal(result.reason, "NO_BATCH_CONTEXT");
  assert.equal(writes.length, 0);
});

/* ------------------------------------------------------------------ *
 * The ordinary Sales Path no access
 * ------------------------------------------------------------------ */

test("a Sales Path no access moves the row, the Sales record and the batch", async () => {
  const { result, writes } = await run();

  assert.equal(result.applied, true);
  assert.equal(result.noAccessCount, 1);
  assert.equal(result.rowStatus, "IN_PROGRESS");

  const rowPatch = writeFor(writes, "rows");
  assert.equal(rowPatch["execution.status"], "IN_PROGRESS");
  assert.equal(rowPatch["execution.completedAt"], null, "a no access never completes a row");

  const salesPatch = writeFor(writes, "sales");
  const fieldWork = salesPatch.tbRefs[0].fieldWork;
  assert.equal(fieldWork.status, "IN_PROGRESS");
  assert.equal(fieldWork.noAccess.length, 1);
  assert.equal(fieldWork.noAccess[0].date, "2026-08-09");
  assert.equal(fieldWork.noAccess[0].user, "Siya Siya");

  const parentPatch = writeFor(writes, "uploads");
  assert.equal(parentPatch.status, "IN_PROGRESS");
  assert.equal(parentPatch["counts.executionStartedRows"], 1);
});

test("NA-R041: a no access never completes the row, and the batch is not completed either", async () => {
  const { writes } = await run();
  const parentPatch = writeFor(writes, "uploads");
  assert.equal(parentPatch["execution.completedAt"], null);
  assert.equal(parentPatch.status, "IN_PROGRESS");
});

test("a second visit that also fails is a second, real no access", async () => {
  // Not idempotent by row, deliberately: the worker went twice and failed twice.
  const existing = { status: "IN_PROGRESS", noAccess: [{ date: "2026-08-01", time: "09:00:00", user: "Someone" }] };
  const { result, writes } = await run({ sales: salesDoc(existing) });

  assert.equal(result.noAccessCount, 2);
  assert.equal(writeFor(writes, "sales").tbRefs[0].fieldWork.noAccess.length, 2);
});

test("the row count is not raised again once the row is already In Progress", async () => {
  const { writes } = await run({ row: rowDoc({ execution: { status: "IN_PROGRESS" } }) });
  const parentPatch = writeFor(writes, "uploads");
  assert.equal(
    Object.hasOwn(parentPatch, "counts.executionStartedRows"),
    false,
    "a row already started must not be counted as started twice",
  );
});

/* ------------------------------------------------------------------ *
 * The guards
 * ------------------------------------------------------------------ */

async function codeOf(options) {
  try {
    await run(options);
  } catch (error) {
    return error?.irepsCode || error?.code || "NO_CODE";
  }
  return "NO_ERROR_THROWN";
}

test("a row whose meter is already found refuses a no access", async () => {
  assert.equal(
    await codeOf({ sales: salesDoc({ meterId: "AST_1" }) }),
    "TARGETED_BATCH_METER_ALREADY_LINKED",
  );
});

test("completed Sales field work refuses a no access, by the meter guard that fires first", async () => {
  // Sales integrity requires a COMPLETED fieldWork to carry outcomeCode, outcomeLabel,
  // premiseId, meterId, trnId, meterMatch and submittedAt — so a genuinely completed entry
  // always has a meter, and TARGETED_BATCH_METER_ALREADY_LINKED is what a worker sees. The
  // EXECUTION_COMPLETED guard behind it is defence in depth, not the path taken.
  const completed = {
    status: "COMPLETED",
    outcomeCode: "METER_DISCOVERED",
    outcomeLabel: "Meter Discovered",
    premiseId: "PRM_1",
    meterId: "AST_1",
    trnId: "TRN_1",
    meterMatch: true,
    submittedAt: NOW,
  };
  assert.equal(await codeOf({ sales: salesDoc(completed) }), "TARGETED_BATCH_METER_ALREADY_LINKED");
});

test("a batch that is not accepted refuses a no access", async () => {
  assert.equal(
    await codeOf({ parent: parentDoc({ acceptance: { status: "PENDING" } }) }),
    "TARGETED_BATCH_NOT_ACCEPTED",
  );
});

test("a row that is not allocated refuses a no access", async () => {
  assert.equal(
    await codeOf({ row: rowDoc({ allocation: { status: "UNALLOCATED", allocatable: true } }) }),
    "TARGETED_BATCH_ROW_NOT_ALLOCATED",
  );
});

/* ------------------------------------------------------------------ *
 * NA-R084.1 — the premise is only ever what the record carries
 * ------------------------------------------------------------------ */

test("NA-R084.1: no premise on the record means no premise on the Sales entry", async () => {
  const { result, writes } = await run();
  assert.equal(result.premiseId, null);
  assert.equal(writeFor(writes, "sales").tbRefs[0].fieldWork.premiseId, null);
});

test("NA-R084.1: a premise the worker had at the visit is carried", async () => {
  const { result } = await run({
    trnData: trn({
      accessData: {
        trnType: "METER_DISCOVERY",
        erfId: ERF_ID,
        premise: { id: "PRM_1" },
        access: { hasAccess: "no", reason: "Property Locked" },
      },
    }),
  });
  assert.equal(result.premiseId, "PRM_1");
});

test("NA-R084.1: the row's own premise is never read back onto the visit", async () => {
  // The row has a premise today; the record does not. TB-R067 lets a row's premise be
  // swapped, so reading it back would let a past visit change what it says.
  const { result } = await run({ row: rowDoc({ refs: { erfId: ERF_ID, premiseId: "PRM_LATER" } }) });
  assert.equal(result.premiseId, null, "the row's premise must not leak onto the record");
});
