import test from "node:test";
import assert from "node:assert/strict";
import { matchesSubmission, acceptedSubmission } from "../qa/submissionReceipt.js";
import { discoveryFixture } from "./qa.amendmentFixture.js";
import { workflowState } from "../qa/model.js";
const record = () => ({ ...discoveryFixture(), workflow: { state: "COMPLETED", completedByUid: "worker" } });

test("Unresolved legacy and contradictory lifecycle fields cannot authorize fresh transitions", () => {
  for (const state of ["COMPLETED", "QA FAIL", "QA PASS"]) {
    assert.equal(workflowState({ workflow: { state } }), state);
  }
  assert.equal(workflowState({ workflow: { state: "COMPLETED" }, qa: { state: "FAIL" } }), "");
  assert.equal(workflowState({ qa: { state: "DRAFT" } }), "");
});

test("receipt requires exact capture identity, author, evidence and submitted values", () => {
  const original = record();
  assert.equal(matchesSubmission(original, original, "worker"), true);
  for (const changed of [
    { id: "another" }, { metadata: { ...original.metadata, createdOnDevice: "2026-10-15T00:00:00Z" } },
    { fieldComment: { text: "different" } }, { media: [] },
    { ast: { ...original.ast, astData: { ...original.ast.astData, astNo: "wrong" } } },
  ]) assert.equal(matchesSubmission(original, { ...original, ...changed }, "worker"), false);
  assert.equal(matchesSubmission(original, original, "stranger"), false);
  assert.equal(matchesSubmission({ ...original, workflow: { state: "ACCEPTED" } }, original, "worker"), false);
  assert.equal(matchesSubmission(original, { ...original, metadata: {} }, "worker"), false);
});

test("original accepted submission can be recognized after correction and QA PASS", async () => {
  const original = record();
  const current = { ...original, workflow: { state: "QA PASS", completedByUid: "takeover" }, fieldComment: { text: "Corrected" } };
  const db = { doc: path => path, collection: path => ({ limit: count => ({ path, count }) }) };
  const reader = { get: async ref => typeof ref === "string"
    ? { exists: true, data: () => ({ accountStatus: "ACTIVE" }) }
    : { docs: [{ data: () => ({ snapshot: original }) }] } };
  assert.equal(await acceptedSubmission(reader, db, original.id, current, original, "worker"), true);
  assert.equal(await acceptedSubmission(reader, db, original.id, current, { ...original, fieldComment: { text: "Fresh submission" } }, "worker"), false);
  const disabled = { get: async () => ({ exists: true, data: () => ({ accountStatus: "DISABLED" }) }) };
  assert.equal(await acceptedSubmission(disabled, db, original.id, current, original, "worker"), false);
});
