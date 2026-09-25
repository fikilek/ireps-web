// MN-R001 1.2.0: the instruction a finding locks onto its follow-on work must
// pass the server's assignment check (its code is the work's own type; the
// words are in the text). Mirrors ireps-mobile findingInstructions.js.
import test from "node:test";
import assert from "node:assert/strict";

import { validateAssignment } from "../meterLifecycle/helpers.js";

const targets = [{ type: "USER", id: "FWR_1", name: "Peter" }];

for (const [trnType, text] of [
  ["METER_DISCONNECTION", "Illegal Connection"],
  ["METER_REMOVAL", "Replace meter – step 1: remove"],
]) {
  test(`a ${trnType} locked after a finding passes the assignment check`, () => {
    const result = validateAssignment(
      { instruction: { code: trnType, text, notes: "", mediaRequired: false }, targets },
      trnType,
      { originChannel: "FIELD" },
    );
    assert.equal(result.ok, true, result.message);
  });
}

test("an instruction coded as the reason instead of the work is refused", () => {
  const result = validateAssignment(
    { instruction: { code: "ILLEGAL_CONNECTION", text: "Illegal Connection" }, targets },
    "METER_DISCONNECTION",
    { originChannel: "FIELD" },
  );
  assert.equal(result.code, "ASSIGNMENT_INSTRUCTION_MISMATCH");
});
