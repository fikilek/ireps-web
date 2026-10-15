// The transaction state machine. `DR-R001` 5, owner 11 October 2026.
//
// These pin the owner's own list, written as he gave it:
//   CREATED can only take 'delete' and 'allocate'
//   DELETED can only 'create' and 'final delete'
//   ISSUED can only take 'reject', 'cancel', 'accept'
//   ACCEPTED can only take 'cancel', 'execute'
//   COMPLETED takes nothing
import test from "node:test";
import assert from "node:assert/strict";

import {
  EXPIRES_AFTER_MS,
  OLD_STATE_LANDS_IN,
  TRN_STATES,
  TRN_STATE_LIST,
  canMove,
  canMoveAs,
  hasExpired,
  holdsTheMeter,
  isTrnState,
  theWorkerSees,
} from "../meterLifecycle/trnStateMachine.js";

test("v3 contains eight persisted states; REMOVED remains deferred", () => {
  assert.deepEqual(TRN_STATE_LIST, ["CREATED", "DELETED", "ISSUED", "ACCEPTED", "COMPLETED", "QA FAIL", "QA UPDATED", "QA PASS"]);

  for (const gone of ["REJECTED", "CANCELLED", "REASSIGNED", "IN_PROGRESS"]) {
    assert.equal(isTrnState(gone), false, `${gone} is an event, not a state`);
  }
});

test("each state takes exactly the moves the owner listed", () => {
  const allowed = (state) =>
    ["allocate", "delete", "create", "finalDelete", "accept", "reject", "cancel", "execute", "expire", "amend", "qaFail", "qaPass"]
      .filter((action) => canMove(state, action).ok || canMove(state, action).code === "MOVE_NOT_BUILT");

  assert.deepEqual(allowed("CREATED"), ["allocate", "delete"]);
  assert.deepEqual(allowed("DELETED"), ["create", "finalDelete"]);
  assert.deepEqual(allowed("ISSUED"), ["accept", "reject", "cancel", "expire"]);
  assert.deepEqual(allowed("ACCEPTED"), ["cancel", "execute"]);
  assert.deepEqual(allowed("COMPLETED"), ["amend", "qaFail", "qaPass"]);
  assert.deepEqual(allowed("QA FAIL"), ["amend"]);
  assert.deepEqual(allowed("QA UPDATED"), ["qaFail", "qaPass"]);
  assert.deepEqual(allowed("QA PASS"), []);
});

test("every move lands where the rule says", () => {
  assert.equal(canMove("CREATED", "allocate").to, "ISSUED");
  assert.equal(canMove("CREATED", "delete").to, "DELETED");
  assert.equal(canMove("DELETED", "create").to, "CREATED");
  assert.equal(canMove("ISSUED", "accept").to, "ACCEPTED");
  assert.equal(canMove("ISSUED", "reject").to, "CREATED");
  assert.equal(canMove("ISSUED", "cancel").to, "CREATED");
  assert.equal(canMove("ACCEPTED", "cancel").to, "CREATED");
  assert.equal(canMove("ACCEPTED", "execute").to, "COMPLETED");
});

test("everything that comes back comes back to one place", () => {
  // DR-R001 5: there is exactly one place a job waits to be given out,
  // whether it has never been sent or has been handed back twice.
  for (const [from, action] of [["ISSUED", "reject"], ["ISSUED", "cancel"], ["ISSUED", "expire"], ["ACCEPTED", "cancel"]]) {
    assert.equal(canMove(from, action).to, TRN_STATES.CREATED, `${from} ${action}`);
  }
});

test("a QA PASS transaction is finished, and says so", () => {
  const refused = canMove("QA PASS", "cancel");

  assert.equal(refused.ok, false);
  assert.match(refused.message, /is finished\. Nothing moves it/);
});

test("a refusal says what the state CAN take, not merely no", () => {
  const refused = canMove("ACCEPTED", "reject");

  assert.equal(refused.ok, false);
  assert.equal(refused.code, "MOVE_NOT_ALLOWED");
  assert.match(refused.message, /can only take: cancel, execute/);
});

test("a worker cannot hand back what he has accepted", () => {
  // DR-R001 5.5. Deliberate: his only other move would be a false No
  // Access. The office override is what covers him.
  assert.equal(canMove("ACCEPTED", "reject").ok, false);
  assert.equal(canMove("ACCEPTED", "cancel").ok, true);
});

test("final delete is declared but not built, and says which", () => {
  const refused = canMove("DELETED", "finalDelete");

  assert.equal(refused.ok, false);
  assert.equal(refused.code, "MOVE_NOT_BUILT");
  assert.match(refused.message, /not built yet/);
});

test("a state nobody knows is refused by name", () => {
  for (const state of ["REJECTED", "", null, "SOMETHING_NEW"]) {
    const refused = canMove(state, "accept");

    assert.equal(refused.ok, false);
    assert.equal(refused.code, "UNKNOWN_STATE");
  }
});

test("only a supervisor or a manager makes an office move", () => {
  assert.equal(canMoveAs("ACCEPTED", "cancel", "SPV").ok, true);
  assert.equal(canMoveAs("ACCEPTED", "cancel", "MNG").ok, true);

  const refused = canMoveAs("ACCEPTED", "cancel", "FWR");

  assert.equal(refused.ok, false);
  assert.equal(refused.code, "NOT_YOURS_TO_DO");
  assert.match(refused.message, /supervisor or a manager/);

  // The worker's own moves are his.
  assert.equal(canMoveAs("ISSUED", "accept", "FWR").ok, true);
  assert.equal(canMoveAs("ISSUED", "reject", "FWR").ok, true);
});

test("a created job holds its meter, a deleted one lets it go", () => {
  // DR-R001 5.2. Created has nobody on it but it exists and will be
  // allocated; a second would leave two to allocate on one meter.
  assert.equal(holdsTheMeter("CREATED"), true);
  assert.equal(holdsTheMeter("ISSUED"), true);
  assert.equal(holdsTheMeter("ACCEPTED"), true);
  assert.equal(holdsTheMeter("DELETED"), false);
  assert.equal(holdsTheMeter("COMPLETED"), false);
});

test("the worker sees his issued work, his accepted work, and what he finished", () => {
  // DR-R001 5.5, owner: "DELETED must not show in FWRs devices." His own
  // card has a working Completed box, so Completed is his too - the
  // correction of 1.12.8, which this test had been pinning the wrong way
  // round since the rule was amended.
  for (const his of ["ISSUED", "ACCEPTED", "COMPLETED"]) {
    assert.equal(theWorkerSees(his), true, his);
  }

  // Nobody holds a created job and a deleted one is in the bin.
  for (const hidden of ["CREATED", "DELETED"]) {
    assert.equal(theWorkerSees(hidden), false, hidden);
  }

  // An old word is placed before it is tested, so a record written before
  // the machine still draws on his phone.
  assert.equal(theWorkerSees("REASSIGNED"), true, "lands in ISSUED");
  assert.equal(theWorkerSees("IN_PROGRESS"), true, "lands in ACCEPTED");
  assert.equal(theWorkerSees("REJECTED"), false, "lands in CREATED - not his any more");
});

test("every old state has somewhere to land", () => {
  // The census of 11 October found no record anywhere that could not be
  // placed. This pins the mapping it was measured against.
  assert.deepEqual(OLD_STATE_LANDS_IN, {
    ISSUED: "ISSUED",
    REASSIGNED: "ISSUED",
    ACCEPTED: "ACCEPTED",
    IN_PROGRESS: "ACCEPTED",
    REJECTED: "CREATED",
    CANCELLED: "CREATED",
    COMPLETED: "COMPLETED",
  });

  for (const landing of Object.values(OLD_STATE_LANDS_IN)) {
    assert.equal(isTrnState(landing), true, `${landing} must be one of the five`);
  }
});

test("three days of silence expires an issued job", () => {
  const now = Date.parse("2026-10-11T12:00:00.000Z");
  const ago = (ms) => new Date(now - ms).toISOString();

  assert.equal(EXPIRES_AFTER_MS, 3 * 24 * 60 * 60 * 1000);

  const issued = (issuedAt, state = "ISSUED") => ({ workflow: { state, issuedAt } });

  assert.equal(hasExpired(issued(ago(EXPIRES_AFTER_MS + 1000)), now), true);
  assert.equal(hasExpired(issued(ago(EXPIRES_AFTER_MS - 1000)), now), false);
});

test("expiry is for silence only, never for work a man has taken", () => {
  // DR-R001 5.6, owner agreed: the clock cannot see that he is standing at
  // the meter. The override covers the man who accepted and cannot go.
  const now = Date.parse("2026-10-11T12:00:00.000Z");
  const longAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  assert.equal(hasExpired({ workflow: { state: "ACCEPTED", issuedAt: longAgo } }, now), false);
  assert.equal(hasExpired({ workflow: { state: "CREATED", issuedAt: longAgo } }, now), false);
});

test("a job with no issue time is never expired", () => {
  // The census: 58 of DEV's 94, all of TEST's and LIVE's one have no
  // issuedAt - they predate the stamp. An unknown age is not a long one,
  // and the record's creation time is not a substitute for it (UI-R008).
  const now = Date.parse("2026-10-11T12:00:00.000Z");

  for (const issuedAt of [null, undefined, "", "not a date"]) {
    assert.equal(hasExpired({ workflow: { state: "ISSUED", issuedAt } }, now), false);
  }
});

test("the meter guard reads the machine's list, not its own", async () => {
  // One well. A second copy of which states hold a meter is how the guard
  // and the machine come to disagree about whether a meter is busy.
  const { ACTIVE_LCT_WORKFLOW_STATES } = await import("../meterLifecycle/helpers.js");

  assert.deepEqual(ACTIVE_LCT_WORKFLOW_STATES, ["CREATED", "ISSUED", "ACCEPTED"]);
  assert.equal(ACTIVE_LCT_WORKFLOW_STATES.includes("REASSIGNED"), false);
  assert.equal(ACTIVE_LCT_WORKFLOW_STATES.includes("IN_PROGRESS"), false);
});

test("QA lifecycle preserves corrections and terminal PASS without operational re-entry", () => {
  assert.equal(canMove("COMPLETED", "amend").to, "COMPLETED");
  assert.equal(canMove("COMPLETED", "qaFail").to, "QA FAIL");
  assert.equal(canMove("QA FAIL", "amend").to, "QA UPDATED");
  assert.equal(canMove("QA UPDATED", "qaPass").to, "QA PASS");
  assert.equal(canMove("QA FAIL", "qaPass").ok, false);
  assert.equal(canMove("QA UPDATED", "amend").ok, false);
  for (const state of ["QA FAIL", "QA UPDATED", "QA PASS"]) {
    assert.equal(theWorkerSees(state), true);
    assert.equal(holdsTheMeter(state), false);
    for (const action of ["execute", "allocate", "delete", "cancel"]) assert.equal(canMove(state, action).ok, false);
  }
});
