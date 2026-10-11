// Allocate on the ITO page. `DR-R001` 3.4, 5, 11 October 2026.
//
// The button makes the work; the page says why, in what words, to whom, and
// with what attached. So the instruction arrives with the allocate, and this
// pins what that writes - and, as much, what it must not wipe.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  checkAllocationInstruction,
  mergeInstruction,
} from "../meterLifecycle/manageInstructionCallable.js";

const created = {
  accessData: { trnType: "METER_DISCONNECTION" },
  workflow: { state: "CREATED", issuedAt: null },
  assignment: {
    targets: [],
    instruction: {
      code: "METER_DISCONNECTION",
      text: "NAv",
      reason: { code: "NAv", words: "NAv", explanation: "NAv" },
    },
  },
};

const kaiser = [{ type: "USER", id: "fwr-1", name: "Kaiser" }];

const client = {
  reason: { code: "CLIENT_INSTRUCTION", words: "Client instruction" },
  text: "Disconnect at the pole, the box is locked",
};

test("the allocate's instruction is merged onto the one the create wrote", () => {
  // The create wrote the code. An allocate carrying only a reason that
  // replaced the instruction wholesale would wipe it, and the server would
  // then refuse its own job for having no code.
  const merged = mergeInstruction({ trnData: created, instruction: client });

  assert.equal(merged.code, "METER_DISCONNECTION");
  assert.equal(merged.text, "Disconnect at the pole, the box is locked");
  assert.equal(merged.reason.code, "CLIENT_INSTRUCTION");
});

test("a reason is merged as a whole, never half of an old one", () => {
  // `DR-R001` 3.4: the reason is a code AND its words. Keeping the old words
  // beside a new code is how a record comes to say two things at once.
  const merged = mergeInstruction({
    trnData: {
      assignment: {
        instruction: { reason: { code: "CUSTOMER_INSTRUCTION", words: "Customer instruction" } },
      },
    },
    instruction: { reason: { code: "OTHER", explanation: "Court order" } },
  });

  assert.equal(merged.reason.code, "OTHER");
  assert.equal(merged.reason.explanation, "Court order");
});

test("nothing sent leaves the instruction exactly as it was", () => {
  // A reassign sends no instruction. The worker before him was given words,
  // and the next man must read the same ones.
  const merged = mergeInstruction({ trnData: created, instruction: null });

  assert.deepEqual(merged, created.assignment.instruction);
});

test("an allocate with no reason behind it is refused", () => {
  const refused = checkAllocationInstruction({
    trnData: created,
    trnType: "METER_DISCONNECTION",
    instruction: { text: "Just go and do it" },
    targets: kaiser,
    media: [],
  });

  assert.equal(refused.ok, false);
  assert.equal(refused.code, "INVALID_ASSIGNMENT_INSTRUCTION_REASON");
  assert.match(refused.message, /why this work is being sent/);
});

test("Other without its explanation is refused by name", () => {
  // UI-R006 1.2.0: no iREPS form is ever submitted with an empty Other.
  for (const explanation of [undefined, "", "   ", "NAv"]) {
    const refused = checkAllocationInstruction({
      trnData: created,
      trnType: "METER_DISCONNECTION",
      instruction: { reason: { code: "OTHER", explanation } },
      targets: kaiser,
      media: [],
    });

    assert.equal(refused.ok, false, String(explanation));
    assert.equal(refused.code, "INVALID_ASSIGNMENT_INSTRUCTION_REASON_EXPLANATION");
  }
});

test("an allocate with nobody on it is refused", () => {
  const refused = checkAllocationInstruction({
    trnData: created,
    trnType: "METER_DISCONNECTION",
    instruction: client,
    targets: [],
    media: [],
  });

  assert.equal(refused.ok, false);
  assert.equal(refused.code, "INVALID_ASSIGNMENT_TARGETS");
});

test("a reason and a worker is all it takes - the words stay optional", () => {
  // Owner, 10 October 2026, having asked twice: the instruction is optional.
  // The reason says why; words and an image elaborate it.
  const allowed = checkAllocationInstruction({
    trnData: created,
    trnType: "METER_DISCONNECTION",
    instruction: { reason: { code: "CLIENT_INSTRUCTION", words: "Client instruction" } },
    targets: kaiser,
    media: [],
  });

  assert.equal(allowed.ok, true);
});

test("an instruction for the wrong kind of work is refused", () => {
  const refused = checkAllocationInstruction({
    trnData: created,
    trnType: "METER_DISCONNECTION",
    instruction: { ...client, code: "METER_RECONNECTION" },
    targets: kaiser,
    media: [],
  });

  assert.equal(refused.ok, false);
  assert.equal(refused.code, "ASSIGNMENT_INSTRUCTION_MISMATCH");
});

test("the instruction is written only where one was sent", async () => {
  const source = await readFile(
    new URL("../meterLifecycle/manageInstructionCallable.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /if \(instruction\) \{/);
  assert.match(source, /instruction: action === "ALLOCATE" \? instruction : null/);
  assert.match(source, /media: action === "ALLOCATE" \? media : null/);
  assert.doesNotMatch(
    source,
    /export function buildAllocatePatch/,
    "the writer stays internal; only the two pure checks are exported",
  );
});

test("an attached image is added to the media, never put in place of it", async () => {
  // A job can already carry media when it is allocated, and `arrayUnion`
  // keeps both. An assignment would drop whatever was there.
  const source = await readFile(
    new URL("../meterLifecycle/manageInstructionCallable.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /patch\.media = FieldValue\.arrayUnion\(\.\.\.media\);/);
});

test("the allocate validates through the create's own validator", async () => {
  // The one well. A copy of the rules here is how the two lanes come to
  // accept different work from the same office.
  const source = await readFile(
    new URL("../meterLifecycle/manageInstructionCallable.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /validateLifecycleInstructionAssignment\(/);
  assert.match(source, /allocating: true/);
});

test("NAv is not a reason, so it cannot satisfy the one required", () => {
  // Owner, 30 September 2026: NAv is a flag, not a tidy placeholder. A
  // created job carries `reason.code: "NAv"` correctly, because nothing has
  // been chosen - and an allocate that sent none used to pass on it, putting
  // a job in a worker's hands with NAv where its reason belongs.
  for (const code of ["NAv", "nav", " NAV ", "", undefined]) {
    const refused = checkAllocationInstruction({
      trnData: created,
      trnType: "METER_DISCONNECTION",
      instruction: { reason: { code } },
      targets: kaiser,
      media: [],
    });

    assert.equal(refused.ok, false, String(code));
    assert.equal(refused.code, "INVALID_ASSIGNMENT_INSTRUCTION_REASON");
  }
});
