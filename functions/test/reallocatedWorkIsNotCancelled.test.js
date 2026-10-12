// A job taken back off a worker and given out again is NOT a cancelled job.
//
// Owner, 12 October 2026, testing on TEST: a disconnection he had unallocated
// and then allocated again could be neither accepted nor rejected. Both
// buttons returned "Cancelled TRNs cannot be accepted or rejected" while the
// record plainly read ISSUED and the worker plainly held it on his phone.
//
// Two faults, one on each side of the same fact, and the pair is why it was
// permanent:
//
//   the WRITER left a lie - allocating reset the accept/reject stamps and not
//   the cancel stamps, so `assignment.cancelledAt` survived for ever;
//
//   the READER believed it - the accept/reject callable refused on that stamp
//   instead of on `workflow.state`, which `DR-R001` 5.2 says is the truth.
//
// These tests read the source, because both faults are about WHICH FIELD the
// code names - something a behavioural test with a hand-made fixture would
// miss by supplying a tidy record that never had a cancel in its past.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, "..", p), "utf8");

test("allocating clears the cancel stamps, not only the accept/reject ones", () => {
  const src = read("meterLifecycle/manageInstructionCallable.js");

  // To the closing brace at column 0, not the first inner one.
  const patch = src.match(/function buildAllocatePatch\([\s\S]*?\n\}\n/);
  assert.ok(patch, "buildAllocatePatch exists");

  // The four that were already cleared.
  for (const field of [
    '"assignment.acceptedRejectedAt": null',
    '"assignment.acceptedRejectedUid": null',
    '"assignment.acceptedRejectedUser": null',
    '"assignment.rejectReason": ""',
  ]) {
    assert.ok(patch[0].includes(field), `still clears ${field}`);
  }

  // The five it forgot, which is the whole bug.
  for (const field of [
    '"assignment.cancelledAt": null',
    '"assignment.cancelledByUid": null',
    '"assignment.cancelledByUser": null',
    '"assignment.cancelReason": ""',
    '"workflow.returnedToCreatedAt": null',
  ]) {
    assert.ok(patch[0].includes(field), `now clears ${field}`);
  }
});

test("accept and reject are refused by the STATE, never by a leftover stamp", () => {
  const src = read("meterLifecycle/acceptRejectCallable.js");

  // The exact reads that caused it.
  assert.doesNotMatch(
    src,
    /row\.data\?\.assignment\?\.cancelledAt/,
    "must not refuse on a cancel stamp",
  );
  assert.doesNotMatch(
    src,
    /row\.data\?\.workflow\?\.completedAt\s*\|\|/,
    "must not refuse on a completed stamp either - same anti-pattern",
  );

  // And the message naming a state iREPS does not have is gone.
  assert.doesNotMatch(src, /Cancelled TRNs cannot be accepted or rejected/);
  assert.doesNotMatch(src, /workflowState === "CANCELLED"/);

  // The state check that does the work is still there.
  assert.match(src, /getAllowedWorkflowStatesForAction\(action\)/);
  assert.match(src, /allowedWorkflowStates\.includes\(workflowState\)/);
});

test("a cancelled job lands in Created, which the state check already refuses", () => {
  // Nothing writes CANCELLED any more - a cancel returns the job to Created
  // (`DR-R001` 5). So the removed check could only ever have fired on the
  // stamp, never on the state. This pins the reason it was safe to remove.
  const machine = read("meterLifecycle/trnStateMachine.js");

  assert.doesNotMatch(
    machine,
    /CANCELLED:\s*"CANCELLED"/,
    "CANCELLED is not one of the five states",
  );
  assert.match(machine, /OLD_STATE_LANDS_IN/, "old words are placed, not kept");
});
