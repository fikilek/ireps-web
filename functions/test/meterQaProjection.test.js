import test from "node:test";
import assert from "node:assert/strict";
import { readMeterQaTbRowPlan, applyMeterQaTbRowWrites } from "../qa/meterQaProjection.js";

test("meterQaProjection: reads linked rows and parent batch", async () => {
  const mockRows = [
    {
      id: "row_1",
      ref: { id: "row_1" },
      data: () => ({
        id: "row_1",
        tbId: "tb_123",
        execution: { status: "COMPLETED" },
        qa: { premiseStatus: "QA_PASS", meterStatus: "QA_PENDING", tbStatus: "QA_PENDING" },
      }),
    },
    {
      id: "row_2",
      ref: { id: "row_2" },
      data: () => ({
        id: "row_2",
        tbId: "tb_123",
        execution: { status: "COMPLETED" },
        qa: { premiseStatus: "QA_PASS", meterStatus: "QA_PASS", tbStatus: "QA_PASS" },
      }),
    },
  ];

  const tx = {
    get: async (refOrQuery) => {
      if (refOrQuery._type === "doc" && refOrQuery.path === "tb_uploads/tb_123") {
        return { exists: true, data: () => ({ counts: { totalRows: 2, completedRows: 2 } }) };
      }
      if (refOrQuery._type === "query" && refOrQuery.field === "refs.meterId") {
        return { docs: [mockRows[0]] };
      }
      if (refOrQuery._type === "query" && refOrQuery.field === "refs.trnId") {
        return { docs: [] };
      }
      if (refOrQuery._type === "query" && refOrQuery.field === "tbId") {
        return { docs: mockRows };
      }
      return { exists: false };
    },
  };

  const db = {
    doc: (path) => ({ _type: "doc", path }),
    collection: (name) => ({
      where: (field, op, val) => ({ _type: "query", name, field, op, val }),
    }),
  };

  const plan = await readMeterQaTbRowPlan(tx, db, "TRN_METER_1", {});
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.batchPlans.length, 1);
  assert.equal(plan.batchPlans[0].tbId, "tb_123");
  assert.equal(plan.batchPlans[0].tbRows.length, 2);
});

test("meterQaProjection: applies writes to row and recalculates batch qaPassRows and qaFailRows", async () => {
  const updates = [];
  const tx = {
    update: (ref, data) => {
      updates.push({ ref, data });
    },
  };

  const plan = {
    rows: [
      {
        ref: { id: "row_1" },
        data: {
          id: "row_1",
          tbId: "tb_123",
          execution: { status: "COMPLETED" },
          qa: { premiseStatus: "QA_PASS", meterStatus: "QA_PENDING", tbStatus: "QA_PENDING" },
        },
      },
    ],
    batchPlans: [
      {
        tbId: "tb_123",
        parentRef: { id: "tb_123", path: "tb_uploads/tb_123" },
        tbRows: [
          {
            id: "row_1",
            execution: { status: "COMPLETED" },
            qa: { premiseStatus: "QA_PASS", meterStatus: "QA_PENDING", tbStatus: "QA_PENDING" },
          },
          {
            id: "row_2",
            execution: { status: "COMPLETED" },
            qa: { premiseStatus: "QA_PASS", meterStatus: "QA_PASS", tbStatus: "QA_PASS" },
          },
        ],
      },
    ],
  };

  // 1. Meter QA FAIL -> row becomes QA_FAIL, batch has 1 qaPass, 1 qaFail
  applyMeterQaTbRowWrites(tx, plan, "QA_FAIL", { reviewedByUser: "Tester", reviewedByUid: "UID_1" });
  assert.equal(updates.length, 2);
  assert.equal(updates[0].data["qa.meterStatus"], "QA_FAIL");
  assert.equal(updates[0].data["qa.tbStatus"], "QA_FAIL");
  assert.equal(updates[1].data["counts.qaPassRows"], 1);
  assert.equal(updates[1].data["counts.qaFailRows"], 1);

  updates.length = 0;
  // 2. Meter QA PASS -> row becomes QA_PASS, batch has 2 qaPass, 0 qaFail
  applyMeterQaTbRowWrites(tx, plan, "QA_PASS", { reviewedByUser: "Tester", reviewedByUid: "UID_1" });
  assert.equal(updates.length, 2);
  assert.equal(updates[0].data["qa.meterStatus"], "QA_PASS");
  assert.equal(updates[0].data["qa.tbStatus"], "QA_PASS");
  assert.equal(updates[1].data["counts.qaPassRows"], 2);
  assert.equal(updates[1].data["counts.qaFailRows"], 0);
});
