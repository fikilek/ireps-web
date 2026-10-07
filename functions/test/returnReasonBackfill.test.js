import test from "node:test";
import assert from "node:assert/strict";
import { returnReasonPatch } from "../noAccess/returnReasonBackfill.js";
test("backfill only changes canonical return words, preserving Other explanations and access", () => {
  const reason = "Occupant requested a return visit";
  const input = { hasAccess: "no", reasonCode: reason, reason, appointment: { at: "2026-10-05T13:00:00Z" } };
  assert.deepEqual(returnReasonPatch(input), { "accessData.access.reasonCode": "Return visit requested", "accessData.access.reason": "Return visit requested" });
  assert.equal(input.reason, reason);
  assert.deepEqual(returnReasonPatch({ ...input, reasonCode: "OTHER" }), {});
  assert.deepEqual(returnReasonPatch({ ...input, hasAccess: "yes" }), {});
  assert.deepEqual(returnReasonPatch({ ...input, reasonCode: "Return visit requested", reason: "Return visit requested" }), {});
  assert.deepEqual(Object.keys(returnReasonPatch(input, "access")), ["access.reason"]);
});
