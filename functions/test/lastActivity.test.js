import test from "node:test";
import assert from "node:assert/strict";
import { LAST_ACTIVITY_KINDS, lastActivityPatch } from "../targetedBatches/lastActivity.js";

// Targeted Batch rules TB-R069 (1.3.87).
test("the five kinds, and nothing else", () => {
  assert.deepEqual(Object.keys(LAST_ACTIVITY_KINDS), ["ALLOCATED", "ACCEPTED", "PREMISE", "NO_ACCESS", "METER"]);
  assert.throws(() => lastActivityPatch("REJECTED", 1, {}));
});

test("the patch names when, what and who", () => {
  assert.deepEqual(lastActivityPatch("PREMISE", "T", { uid: "U1", name: "Worker" }), { lastActivity: { at: "T", kind: "PREMISE", byUid: "U1", byUser: "Worker" } });
  assert.deepEqual(lastActivityPatch("METER", "T", { uid: "U1", user: "Finder" }).lastActivity.byUser, "Finder");
  assert.deepEqual(lastActivityPatch("ALLOCATED", "T").lastActivity, { at: "T", kind: "ALLOCATED", byUid: null, byUser: null });
});
