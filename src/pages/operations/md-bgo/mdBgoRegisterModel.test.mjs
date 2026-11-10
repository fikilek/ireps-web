import assert from "node:assert/strict";
import test from "node:test";

import { getMdBgoBatchStatus, getMdBgoRowStatusCounts } from "./mdBgoRegisterModel.js";

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
