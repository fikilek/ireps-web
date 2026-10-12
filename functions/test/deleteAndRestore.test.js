// A delete flags, it does not remove. `DR-R001` 5.5, owner 11 October 2026:
// "lets flag it as DELETED .. lets not delete in firestore .. lets just flag
// it". And it is reversible: `Deleted -> create` brings it back.
//
// The callable's transaction body cannot run without an emulator, so what is
// pinned here is the decision, read at its source, plus the pure machine
// behaviour the decision rests on.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  OLD_STATE_LANDS_IN,
  TRN_STATES,
  canMove,
  canMoveAs,
  holdsTheMeter,
} from "../meterLifecycle/trnStateMachine.js";

const read = (name) =>
  readFile(new URL(`../meterLifecycle/${name}`, import.meta.url), "utf8");

test("only a waiting job can be deleted", () => {
  // The machine already settles it: CREATED takes delete, nothing else does.
  // So there is no second list of which states may be deleted.
  assert.equal(canMove(TRN_STATES.CREATED, "delete").to, TRN_STATES.DELETED);

  for (const from of ["ISSUED", "ACCEPTED", "COMPLETED", "DELETED"]) {
    const refused = canMove(from, "delete");

    assert.equal(refused.ok, false, from);
    assert.match(refused.message, /cannot take 'delete'|is finished/);
  }
});

test("the office takes it back before it can delete it", () => {
  // A job with a worker on it cannot be deleted in one step, and the refusal
  // says what to do instead - unallocate, then delete.
  const refused = canMove(TRN_STATES.ISSUED, "delete");

  assert.equal(refused.ok, false);
  assert.match(refused.message, /can only take: accept, cancel, expire, reject/);
});

test("a delete and a restore are the supervisor's and the manager's", () => {
  for (const role of ["SPV", "MNG"]) {
    assert.equal(canMoveAs(TRN_STATES.CREATED, "delete", role).ok, true, role);
    assert.equal(canMoveAs(TRN_STATES.DELETED, "create", role).ok, true, role);
  }

  for (const role of ["FWR", "SPU", "ADM", "", null]) {
    const refused = canMoveAs(TRN_STATES.CREATED, "delete", role);

    assert.equal(refused.ok, false, String(role));
    assert.equal(refused.code, "NOT_YOURS_TO_DO");
    assert.match(refused.message, /supervisor or a manager/);
  }
});

test("a deleted job lets go of its meter; a restored one takes it back", () => {
  // DR-R001 5.2 and 5.5. This is the whole reason the delete writes to the
  // asset at all.
  assert.equal(holdsTheMeter(TRN_STATES.DELETED), false);
  assert.equal(holdsTheMeter(TRN_STATES.CREATED), true);
});

test("the two actions exist and are the machine's own moves", async () => {
  const source = await read("manageInstructionCallable.js");

  assert.match(
    source,
    /MANAGE_ACTIONS = \["ALLOCATE", "REASSIGN", "CANCEL", "DELETE", "RESTORE"\]/,
  );
  assert.match(source, /DELETE: \["delete"\]/);
  assert.match(source, /RESTORE: \["create"\]/);
});

test("a delete flags the record and never removes it", async () => {
  const source = await read("manageInstructionCallable.js");
  const patch = source.slice(source.indexOf("function buildDeletePatch"));

  assert.match(patch.slice(0, 1200), /"workflow\.state": TRN_STATES\.DELETED/);
  assert.match(patch.slice(0, 1200), /"workflow\.deletedAt": now/);
  assert.match(patch.slice(0, 1200), /"workflow\.deleteReason": deleteReason/);

  // Nothing in this callable deletes a transaction document. The owner was
  // explicit, and `final delete` stays unbuilt.
  assert.doesNotMatch(source, /\.delete\(row\.ref\)/);
  assert.doesNotMatch(source, /tx\.delete\(/);
});

test("a delete says why, and is refused when it does not", async () => {
  // DR-R001 5.1: "A rejection still needs a reason. So does a cancellation
  // and a deletion."
  const source = await read("manageInstructionCallable.js");

  assert.match(source, /action === "DELETE" && !deleteReason/);
  assert.match(source, /"DELETE_REASON_REQUIRED"/);
  assert.match(source, /Say why this work is being deleted\./);
});

test("the meter's marker is REMOVED on a delete, not restamped", async () => {
  // The registry row's copy is made from the marker's PRESENCE, so a marker
  // left naming a deleted job keeps the launch button showing work out on
  // that meter. `FieldValue.delete()` is what a completed job uses.
  const source = await read("manageInstructionCallable.js");
  const loop = source.slice(source.indexOf("THE METER'S MARKER"));

  assert.match(loop.slice(0, 2500), /trnActiveLifecycle: FieldValue\.delete\(\)/);
  assert.match(loop.slice(0, 2500), /"metadata\.updatedAt": now/);
});

test("the marker is cleared only when it names THIS job, matched on the id alone", async () => {
  // The marker is one field: it may be naming an inspection while a
  // disconnection is deleted. And its STATE cannot be trusted - BGO writes
  // WAITING_BATCH_ACCEPTANCE, which the five states cannot place.
  const source = await read("manageInstructionCallable.js");
  const loop = source.slice(source.indexOf("THE METER'S MARKER"));

  assert.match(loop.slice(0, 2500), /String\(marker\?\.trnId \|\| ""\)\.trim\(\) === row\.trnId/);
  assert.doesNotMatch(
    loop.slice(0, 2500),
    /holdsTheMeter\(marker/,
    "never gated on the marker's state",
  );
});

test("nothing writes the registry row directly", async () => {
  // It is derived. The only way to free it is to remove the marker and let
  // onMeterUpdated rebuild the row.
  const source = await read("manageInstructionCallable.js");

  // The comment names it; nothing opens it. A collection reference here
  // would be a second writer of a derived fact.
  assert.doesNotMatch(source, /collection\("registry_meters"\)/);
  assert.match(source, /Nothing writes `registry_meters/, "and the file says why");
});

test("a restore asks what a create asks: is one of this kind already out?", async () => {
  // DR-R001 5.2 - never two of the same kind on one meter. The office may
  // have issued a replacement while this one sat in the bin.
  const source = await read("manageInstructionCallable.js");

  assert.match(source, /if \(action === "RESTORE"\) \{/);
  assert.match(source, /ACTIVE_LCT_WORKFLOW_STATES/);
  assert.match(source, /"ACTIVE_LCT_ALREADY_EXISTS"/);
  assert.match(source, /blockingTrnId: already\.docs\[0\]\.id/);
});

test("two deleted jobs of one kind cannot both come back to one meter", async () => {
  // Both would pass the Firestore query, because neither is in an active
  // state yet. The guard has to hold within the call as well.
  const source = await read("manageInstructionCallable.js");

  assert.match(source, /restoringLanes/);
  assert.match(source, /Restore them one at a time/);
});

test("a restored job comes back with nobody on it", async () => {
  const source = await read("manageInstructionCallable.js");
  const patch = source.slice(source.indexOf("function buildRestorePatch"));

  assert.match(patch.slice(0, 1200), /"workflow\.state": TRN_STATES\.CREATED/);
  assert.match(patch.slice(0, 1200), /"workflow\.restoredAt": now/);
  assert.match(patch.slice(0, 1200), /"assignment\.targets": \[\]/);
});

test("a restore does not erase the fact that it was deleted", async () => {
  // The record should be able to say it was once in the bin, and who put it
  // there. Where the fields and the history disagree, the history wins (5.7).
  const source = await read("manageInstructionCallable.js");
  const patch = source.slice(
    source.indexOf("function buildRestorePatch"),
    source.indexOf("function buildCancelPatch"),
  );

  assert.doesNotMatch(patch, /deletedAt": FieldValue\.delete/);
  assert.doesNotMatch(patch, /"workflow\.deletedAt": null/);
  assert.doesNotMatch(patch, /deleteReason": ""/);
});

test("the history says which of the five actions it was", async () => {
  // They do not all land in distinct states - a cancel, a delete's restore
  // and an expiry all leave the record in Created - so only the history can
  // tell them apart (5.7).
  const source = await read("manageInstructionCallable.js");

  assert.match(source, /DELETE: "DELETED"/);
  assert.match(source, /RESTORE: "RESTORED"/);
  assert.match(source, /event: HISTORY_EVENT\[action\]/);
  assert.match(source, /Lifecycle instruction deleted: \$\{deleteReason\}/);
});

test("final delete is still declared and still refused, in words", () => {
  // The arrow stays in the machine because the owner means to have it. Until
  // it has a writer it says which it is.
  const refused = canMove(TRN_STATES.DELETED, "finalDelete");

  assert.equal(refused.ok, false);
  assert.equal(refused.code, "MOVE_NOT_BUILT");
  assert.match(refused.message, /not built yet/);
});

test("the launch button's own create no longer lies about the state", async () => {
  // A fault of mine from 11 October: the transaction said CREATED and this
  // file hard-coded ISSUED into the meter's marker, the history event and the
  // response. Three copies of one fact, one of them wrong - and the records
  // the delete acts on were exactly those records.
  const source = await read("instructionCallable.js");

  assert.match(source, /const workflowState = cleanInstructionTrn\?\.workflow\?\.state;/);
  assert.match(source, /event: allocating \? "ISSUED" : "CREATED"/);
  assert.doesNotMatch(source, /workflowState: "ISSUED"/, "no hard-coded state anywhere");
});

test("NOTHING WRITES A SIXTH STATE", async () => {
  // Owner, 12 October 2026: "fix the IN_PROGRESS writer".
  //
  // `startExecutionCallable` wrote `IN_PROGRESS` to the transaction and to
  // the meter's marker. `IN_PROGRESS` is not one of the five, so the
  // duplication guard - which asks `where("workflow.state","in",[CREATED,
  // ISSUED,ACCEPTED])` - did not match it: a meter whose job was in progress
  // read as FREE and would have taken a second job of the same kind.
  //
  // It was removed rather than rewritten. It was built for `DR-R001` 1.3.0,
  // whose rule 1.10.0 then reversed - "there is nothing between accepted and
  // done... Opening the form reports nothing" - and NO COMMIT IN EITHER
  // REPOSITORY ever called it. A deployed writer of a state that does not
  // exist, reachable by nobody, is not something to leave in the tree.
  const { readdir } = await import("node:fs/promises");
  const dir = new URL("../meterLifecycle/", import.meta.url);

  const files = await readdir(dir);

  assert.equal(
    files.includes("startExecutionCallable.js"),
    false,
    "the file is gone",
  );

  const index = await readFile(new URL("../index.js", import.meta.url), "utf8");

  assert.doesNotMatch(index, /onStartLifecycleInstructionCallable/);
  assert.doesNotMatch(index, /startExecutionCallable/);

  // And no other writer puts the word on a transaction or a meter.
  for (const file of files.filter((name) => name.endsWith(".js"))) {
    const source = await readFile(new URL(file, dir), "utf8");

    assert.doesNotMatch(
      source,
      /"workflow\.state":\s*"IN_PROGRESS"/,
      `${file} writes it to the transaction`,
    );
    assert.doesNotMatch(
      source,
      /workflowState:\s*"IN_PROGRESS"/,
      `${file} writes it to the marker`,
    );
  }
});

test("the machine still knows the word, because records might", () => {
  // Removing the WRITER is not the same as forgetting the word. A record
  // written before today could still carry it, and a reader that could not
  // place it would read the meter as free - the very fault being closed.
  assert.equal(OLD_STATE_LANDS_IN.IN_PROGRESS, TRN_STATES.ACCEPTED);
  assert.equal(holdsTheMeter("IN_PROGRESS"), true);
});
