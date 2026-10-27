import test from "node:test";
import assert from "node:assert/strict";
import {
  projectMeterQaToTbRows,
  readMeterQaTbRowPlan,
  applyMeterQaTbRowWrites,
} from "../functions/qa/meterQaProjection.js";

test("readMeterQaTbRowPlan and applyMeterQaTbRowWrites separate reads from writes", async () => {
  let readCount = 0;
  const updates = [];
  const fakeTx = {
    get: async (target) => {
      readCount++;
      if (target.path === "tb_rows/ROW_1") {
        return {
          id: "ROW_1",
          exists: true,
          data: () => ({
            id: "ROW_1",
            execution: { status: "COMPLETED" },
            qa: { premiseStatus: "QA_PASS" },
          }),
          ref: { path: "tb_rows/ROW_1" },
        };
      }
      return { docs: [] };
    },
    update: (ref, data) => {
      updates.push({ path: ref.path, data });
    },
  };

  const fakeDb = {
    doc: (path) => ({ path }),
    collection: (name) => ({
      where: (queryField, op, value) => ({ queryField, op, value }),
    }),
  };

  // Phase 1: Pure reads
  const plan = await readMeterQaTbRowPlan(
    fakeTx,
    fakeDb,
    "TRN_MDIS_123",
    { targetedBatchContext: { rowId: "ROW_1" } }
  );

  assert.equal(plan.rows.length, 1);
  assert.equal(updates.length, 0, "No writes during read phase");
  assert.ok(readCount > 0, "Reads performed during read phase");

  // Phase 2: Pure writes
  const writeResult = applyMeterQaTbRowWrites(fakeTx, plan, "QA_PASS", {
    reviewedByUser: "Zamo Ngubs",
    reviewedByUid: "UID_1",
  });

  assert.equal(writeResult.projectedCount, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].path, "tb_rows/ROW_1");
  assert.equal(updates[0].data["qa.meterStatus"], "QA_PASS");
  assert.equal(updates[0].data["qa.tbStatus"], "QA_PASS");
});

test("projectMeterQaToTbRows updates linked tb_rows with QA status and recalculates tbStatus", async () => {
  const updates = [];
  const fakeTx = {
    get: async (target) => {
      if (target.path === "tb_rows/ROW_1") {
        return {
          id: "ROW_1",
          exists: true,
          data: () => ({
            id: "ROW_1",
            execution: { status: "COMPLETED" },
            qa: { premiseStatus: "QA_PENDING" },
          }),
          ref: { path: "tb_rows/ROW_1" },
        };
      }
      if (target.queryField === "refs.meterId") {
        return {
          docs: [
            {
              id: "ROW_2",
              exists: true,
              data: () => ({
                id: "ROW_2",
                execution: { status: "COMPLETED" },
                qa: { premiseStatus: "QA_PASS" },
              }),
              ref: { path: "tb_rows/ROW_2" },
            },
          ],
        };
      }
      return { docs: [] };
    },
    update: (ref, data) => {
      updates.push({ path: ref.path, data });
    },
  };

  const fakeDb = {
    doc: (path) => ({ path }),
    collection: (name) => ({
      where: (queryField, op, value) => ({ queryField, op, value }),
    }),
  };

  const result = await projectMeterQaToTbRows(
    fakeTx,
    fakeDb,
    "TRN_MDIS_123",
    { targetedBatchContext: { rowId: "ROW_1" } },
    "QA_PASS",
    { reviewedByUser: "Zamo Ngubs", reviewedByUid: "UID_1" }
  );

  assert.equal(result.projectedCount, 2);
  assert.equal(updates.length, 2);

  // ROW_1 had premiseStatus: QA_PENDING and now meterStatus: QA_PASS -> tbStatus: QA_PENDING
  const row1Update = updates.find((u) => u.path === "tb_rows/ROW_1");
  assert.equal(row1Update.data["qa.meterStatus"], "QA_PASS");
  assert.equal(row1Update.data["qa.tbStatus"], "QA_PENDING");
  assert.equal(row1Update.data["qa.meterReviewedByUser"], "Zamo Ngubs");

  // ROW_2 had premiseStatus: QA_PASS and now meterStatus: QA_PASS -> tbStatus: QA_PASS
  const row2Update = updates.find((u) => u.path === "tb_rows/ROW_2");
  assert.equal(row2Update.data["qa.meterStatus"], "QA_PASS");
  assert.equal(row2Update.data["qa.tbStatus"], "QA_PASS");
});

