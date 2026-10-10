// The server refuses what the ITO form refuses. `DR-R001` 3.4, and the
// owner's rule of 10 October 2026.
//
// "Validations in the form must always be the same as validations at the
// back. The back is the safeguard." A form that lets something through
// knowing the back will send it straight back wastes the user's time; a back
// that accepts what the form would have refused is not safeguarding anything.
// These pin the second half, which is the half that was missing.
import test from "node:test";
import assert from "node:assert/strict";

import { readFile } from "node:fs/promises";

import {
  sanitizeAssignment,
  validateAssignment,
  validateCreateLifecycleInstructionInput,
  validateLifecycleInstructionAssignment,
} from "../meterLifecycle/helpers.js";

const targets = [{ type: "USER", id: "FWR_1", name: "Peter M." }];

const officeInstruction = (over = {}) => ({
  instruction: {
    code: "METER_DISCONNECTION",
    text: "Disconnect at the circuit breaker",
    reason: { code: "CREDIT_CONTROL_INSTRUCTION", words: "Client instruction", explanation: "NAv" },
    mediaRequired: false,
    ...over,
  },
  targets,
});

const input = (over = {}) => ({
  id: "TRN_MDCN_1791538506000_ELC_ZA5241006_5213",
  trnType: "METER_DISCONNECTION",
  astId: "AST_1",
  premiseId: "PRM_1",
  accessData: { parents: { lmPcode: "ZA5241", wardPcode: "ZA5241006" } },
  ...over,
});

test("a complete office instruction passes", () => {
  const result = validateLifecycleInstructionAssignment(officeInstruction(), "METER_DISCONNECTION");

  assert.equal(result.ok, true, result.message);
});

test("the instruction is optional — words, an image, or neither", () => {
  // Owner, 10 October 2026: optional, not conditional. It was required, then
  // required-unless-an-image, which still stopped an office that had neither.
  // The coded reason carries WHY the work is being sent and is required; the
  // words and the image elaborate it for the worker.
  const noWords = officeInstruction({ text: "" });

  assert.equal(
    validateLifecycleInstructionAssignment(noWords, "METER_DISCONNECTION", {
      hasInstructionMedia: true,
    }).ok,
    true,
    "an image alone is an instruction",
  );

  assert.equal(
    validateLifecycleInstructionAssignment(noWords, "METER_DISCONNECTION").ok,
    true,
    "and neither is still a job, because the reason says why",
  );
});

test("the office must say why the work is being sent", () => {
  for (const reason of [undefined, {}, { code: "" }, { code: "   " }]) {
    const result = validateLifecycleInstructionAssignment(
      officeInstruction({ reason }),
      "METER_DISCONNECTION",
    );

    assert.equal(result.ok, false, `a reason of ${JSON.stringify(reason)} must be refused`);
    assert.equal(result.code, "INVALID_ASSIGNMENT_INSTRUCTION_REASON");
    assert.match(result.message, /why this work is being sent/i);
  }
});

test("Other may not be sent without its explanation", () => {
  // UI-R006 1.2.0, now on both sides. NAv is the absence, so it is not an
  // explanation either.
  for (const explanation of [undefined, "", "   ", "NAv", "nav"]) {
    const result = validateLifecycleInstructionAssignment(
      officeInstruction({ reason: { code: "OTHER", words: "Other", explanation } }),
      "METER_DISCONNECTION",
    );

    assert.equal(result.ok, false, `an explanation of ${JSON.stringify(explanation)} must be refused`);
    assert.match(result.message, /other reason/i);
  }

  assert.equal(
    validateLifecycleInstructionAssignment(
      officeInstruction({ reason: { code: "OTHER", words: "Other", explanation: "Court order" } }),
      "METER_DISCONNECTION",
    ).ok,
    true,
  );
});

test("field-originated work is not asked for an office reason", () => {
  // A disconnection locked onto a Meter Discovery finding is field work: the
  // finding IS the reason (MN-R001). Demanding an ITO reason there would
  // refuse work the rules require.
  const result = validateAssignment(
    { instruction: { code: "METER_DISCONNECTION", text: "Illegal Connection" }, targets },
    "METER_DISCONNECTION",
    { originChannel: "FIELD" },
  );

  assert.equal(result.ok, true, result.message);
});

test("no workbase or no ward is refused before anything is written", () => {
  // Owner, 3 October 2026: a record without them is worse than wrong - it
  // exists and cannot be found, and nothing says it is missing.
  for (const parents of [undefined, {}, { lmPcode: "ZA5241" }, { wardPcode: "ZA5241006" }, { lmPcode: " ", wardPcode: " " }]) {
    const result = validateCreateLifecycleInstructionInput(input({ accessData: { parents } }));

    assert.equal(result.ok, false, `parents ${JSON.stringify(parents)} must be refused`);
    assert.equal(result.code, "INVALID_WORKBASE_OR_WARD");
    assert.match(result.message, /workbase|ward/i);
  }
});

test("a complete input passes, and the earlier refusals still stand", () => {
  assert.equal(validateCreateLifecycleInstructionInput(input()).ok, true);

  assert.equal(validateCreateLifecycleInstructionInput(input({ id: "" })).code, "INVALID_TRN_ID");
  assert.equal(validateCreateLifecycleInstructionInput(input({ astId: "" })).code, "INVALID_AST_ID");
  assert.equal(
    validateCreateLifecycleInstructionInput(input({ premiseId: "", accessData: { parents: {} } })).code,
    "INVALID_PREMISE_ID",
    "the premise is still asked for before the workbase",
  );
});

test("the reason survives being written down", async () => {
  // The owner's first office job stored NAv for a reason he had chosen: the
  // stored instruction is rebuilt from a NAMED LIST, so a field added at one
  // end and validated on the way in still arrived as nothing. Name the
  // readers, not only the writers.
  const stored = sanitizeAssignment({
    targets,
    instruction: {
      code: "METER_DISCONNECTION",
      text: "Disconnect at the circuit breaker",
      reason: { code: "CREDIT_CONTROL_INSTRUCTION", words: "Client instruction", explanation: "NAv" },
    },
  });

  assert.equal(stored.instruction.reason.code, "CREDIT_CONTROL_INSTRUCTION");
  assert.equal(stored.instruction.reason.words, "Client instruction");
  assert.equal(stored.instruction.reason.explanation, "NAv");
});

test("an instruction with no reason stores NAv, never nothing", () => {
  // Field work has no office reason. NAv is the honest answer and keeps one
  // shape for every instruction, so a reader never meets a missing key.
  const stored = sanitizeAssignment({ targets, instruction: { code: "METER_DISCONNECTION" } });

  assert.deepEqual(stored.instruction.reason, { code: "NAV", words: "NAv", explanation: "NAv" });
});

test("the send stamps when the job was issued", async () => {
  // DR-R001 3.5. Nothing wrote it, so nothing could say how long a job had
  // waited - and the reminder ladder of section 8 and the monitoring screen
  // of 9.1 are both built on knowing exactly that.
  const source = await readFile(new URL("../meterLifecycle/helpers.js", import.meta.url), "utf8");
  const workflow = source.slice(source.indexOf('state: "ISSUED"'));

  assert.match(workflow.slice(0, 400), /issuedAt: now,/);
});
