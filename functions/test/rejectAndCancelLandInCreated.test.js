// A rejection and a cancellation land in CREATED. `DR-R001` 5, 11 October 2026.
//
// There was no test anywhere asserting what state a rejection produced —
// which is why changing it broke nothing. That is a gap, not luck, and
// these close it: the two writers are read at their source, because a
// callable's transaction body cannot be exercised without an emulator and
// the thing worth pinning is the decision, not the plumbing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { TRN_STATES, canMove } from "../meterLifecycle/trnStateMachine.js";

const read = (name) =>
  readFile(new URL(`../meterLifecycle/${name}`, import.meta.url), "utf8");

test("a rejection lands in CREATED and takes his name off it", async () => {
  // DR-R001 5.1: leaving the targets on it would make the job his and
  // nobody's at once, which is the fault the five states remove.
  const source = await read("acceptRejectCallable.js");
  const patch = source.slice(source.indexOf("function buildWorkflowPatch"));

  assert.match(patch, /"workflow\.state": TRN_STATES\.CREATED/);
  assert.match(patch, /"assignment\.targets": \[\]/);
  assert.match(patch, /"assignment\.rejectReason": rejectReason/, "the reason is kept");
});

test("the refusal is still recorded as an event called REJECTED", async () => {
  // The event is what happened; the state is where it landed. After this
  // change the history is the ONLY place the refusal exists (DR-R001 5.7).
  const source = await read("acceptRejectCallable.js");

  assert.match(source, /event: action === "ACCEPT" \? "ACCEPTED" : "REJECTED"/);
});

test("only an issued job can be accepted or rejected", async () => {
  // DR-R001 5.5: a worker cannot hand back what he has accepted. His only
  // other move would be a false No Access; the office override covers him.
  const source = await read("acceptRejectCallable.js");

  assert.match(source, /ACCEPT_ALLOWED_WORKFLOW_STATES = \[TRN_STATES\.ISSUED\]/);
  assert.match(source, /REJECT_ALLOWED_WORKFLOW_STATES = \[TRN_STATES\.ISSUED\]/);
  assert.doesNotMatch(source, /"REASSIGNED"/, "REASSIGNED is not a state");

  assert.equal(canMove(TRN_STATES.ACCEPTED, "reject").ok, false);
  assert.equal(canMove(TRN_STATES.ISSUED, "reject").to, TRN_STATES.CREATED);
});

test("the refusal tells the worker what to do instead", async () => {
  // A rule that cannot say why it refused is a rule nobody can act on.
  const source = await read("acceptRejectCallable.js");

  assert.match(source, /ask the office to take it back/);
});

test("a cancel lands in CREATED and takes his name off it too", async () => {
  const source = await read("manageInstructionCallable.js");
  const patch = source.slice(source.indexOf("function buildCancelPatch"));

  assert.match(patch, /"workflow\.state": TRN_STATES\.CREATED/);
  assert.match(patch, /"assignment\.targets": \[\]/);
  assert.match(patch, /"assignment\.cancelReason": cancelReason/, "the reason is kept");
});

test("a reassign is still an allocate to somebody else", async () => {
  // Since the ALLOCATE action landed, a reassign is checked as the two moves
  // it actually is - cancel, then allocate - and written by the same writer
  // as a first allocate. The one thing only the history can say is which of
  // the two it was.
  const source = await read("manageInstructionCallable.js");

  assert.match(source, /REASSIGN: \["cancel", "allocate"\]/);
  assert.match(source, /reassigning: action === "REASSIGN"/);

  // The event ladder became one well on 12 October, when DELETE and RESTORE
  // joined it - five actions in an if-chain is how two of them come to write
  // the same word.
  assert.match(source, /ALLOCATE: "ALLOCATED"/);
  assert.match(source, /REASSIGN: "REASSIGNED"/);
  assert.match(source, /event: HISTORY_EVENT\[action\]/);
});

test("the meter's marker names nobody once nobody holds it", async () => {
  // The meter is still held - CREATED holds it (5.2) - but by a job waiting
  // to be given out, not by a worker who has walked away from it.
  const accept = await read("acceptRejectCallable.js");
  const manage = await read("manageInstructionCallable.js");

  assert.match(accept, /action === "ACCEPT"\s*\n\s*\? targets\[0\]/);
  assert.match(manage, /const assignedTo = allocating \? newTargets\?\.\[0\] \|\| \{\} : \{\}/);
});

test("CREATED still holds the meter, so no second of its kind can be made", async () => {
  const { ACTIVE_LCT_WORKFLOW_STATES } = await import("../meterLifecycle/helpers.js");

  assert.equal(ACTIVE_LCT_WORKFLOW_STATES.includes(TRN_STATES.CREATED), true);
});

test("each refusal is also written where a ward-scoped screen can read it", async () => {
  // DR-R001 5.7: the history is authoritative and this is the fast read.
  // The monitoring screen reads hundreds of transactions for a ward -
  // opening a subcollection on each to count refusals would make a screen
  // that gets slower every month. Written in the same transaction, so the
  // two cannot disagree.
  const source = await read("acceptRejectCallable.js");
  const patch = source.slice(source.indexOf("function buildWorkflowPatch"));

  assert.match(patch, /"workflow\.rejections": FieldValue\.arrayUnion\(/);
  assert.match(patch, /uid: actorUid \|\| "NAv"/);
  assert.match(patch, /reason: rejectReason \|\| "NAv"/);
});
