import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTargetedBatchHeader } from "./salesTargetedBatchReadModel.js";

// Targeted Batch rules TB-R069 (1.3.87).
test("a batch's last activity is its own lastActivity: time and event", () => {
  const header = normalizeTargetedBatchHeader("TB", { lastActivity: { at: 1789000000000, kind: "NO_ACCESS", byUid: "U1", byUser: "W" },
    metadata: { createdAt: 1, updatedAt: 1799000000000 } });
  assert.equal(header.lastActivityAtMs, 1789000000000, "not the later updatedAt");
  assert.equal(header.lastActivityLabel, "No Access");
});

test("a batch without lastActivity has none: no guess from other dates", () => {
  const header = normalizeTargetedBatchHeader("TB", { allocation: { completedAt: 1789000000000 }, metadata: { createdAt: 1, updatedAt: 1799000000000 } });
  assert.equal(header.lastActivityAtMs, null);
  assert.equal(header.lastActivityLabel, null);
});
