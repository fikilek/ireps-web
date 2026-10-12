// Create at the button, allocate on the ITO page. `DR-R001` 3.2, 3.4, 5.
// Owner, 11 October 2026: "the moment you click on the ITO button, you
// actually creating a transaction... let's create and then go to the ITO
// page to allocate."
//
// Two things are proved here. The payload builder is called directly,
// because it is a pure function and the decision lives in it. The callable's
// own transaction body cannot run without an emulator, so what is pinned
// there is the decision it makes, read at its source.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  ACTIVE_LCT_WORKFLOW_STATES,
  buildLifecycleInstructionTrnPayload,
  validateLifecycleInstructionAssignment,
} from "../meterLifecycle/helpers.js";
import { TRN_STATES, currentState } from "../meterLifecycle/trnStateMachine.js";

const read = (name) =>
  readFile(new URL(`../meterLifecycle/${name}`, import.meta.url), "utf8");

const astDoc = {
  exists: true,
  id: "AST_1",
  data: () => ({
    astData: {
      astId: "AST_1",
      astNo: "042042",
      utility: "ELC",
      meterType: "CONVENTIONAL",
      astState: { currentState: "CONNECTED" },
    },
    accessData: {
      parents: { lmPcode: "ZA524", wardPcode: "ZA5241006", erfId: "ERF_1" },
    },
  }),
};

const instruction = {
  code: "METER_DISCONNECTION",
  // `DR-R001` 3.4: the reason is stored as a code as well as words, so the
  // rewording now under way leaves old records countable.
  reason: { code: "CLIENT_INSTRUCTION", text: "Client instruction" },
  note: "Disconnect for non payment",
};

const makePayload = (assignment) =>
  buildLifecycleInstructionTrnPayload({
    data: {
      id: "TRN_1",
      trnType: "METER_DISCONNECTION",
      astId: "AST_1",
      assignment,
    },
    astDoc,
    premiseData: {},
    now: "2026-10-11T10:00:00.000Z",
    actorUid: "spv-1",
    actorName: "Thandi",
    allocating: Array.isArray(assignment?.targets) && assignment.targets.length > 0,
  });

test("the button makes a transaction that is CREATED, with nobody on it", () => {
  const trn = makePayload({ instruction, targets: [] });

  assert.equal(trn.workflow.state, TRN_STATES.CREATED);
  assert.deepEqual(trn.assignment.targets, []);
});

test("a created job has no issued time, and no clock running on it", () => {
  // UI-R008: a date here would be an invention, and DR-R001 5.6 would then
  // expire a job nobody had ever been given.
  const trn = makePayload({ instruction, targets: [] });

  assert.equal(trn.workflow.issuedAt, null);
});

test("the button carries two facts, and the reason is not one of them", () => {
  // The meter's row knows the meter and the kind of work. Why the work is
  // being sent, the words and the worker are all chosen on the ITO page, so
  // demanding a reason at the button would refuse the owner's own flow.
  const creating = validateLifecycleInstructionAssignment(
    { instruction: { code: "METER_DISCONNECTION" }, targets: [] },
    "METER_DISCONNECTION",
    { allocating: false },
  );

  assert.equal(creating.ok, true);
});

test("the reason IS required the moment a worker's name goes on", () => {
  // The same validator, front and back (owner, 10 October 2026). A job
  // reaching a worker with no reason behind it is a job iREPS can never
  // explain.
  const refused = validateLifecycleInstructionAssignment(
    {
      instruction: { code: "METER_DISCONNECTION" },
      targets: [{ type: "USER", id: "fwr-1", name: "Kaiser" }],
    },
    "METER_DISCONNECTION",
    { allocating: true },
  );

  assert.equal(refused.ok, false);
  assert.match(refused.code, /REASON/);
});

test("nobody on it is only allowed while it is being created", () => {
  // The ITO page allocates, and an allocate with no name on it is a fault,
  // not an empty job.
  const allocating = validateLifecycleInstructionAssignment(
    { instruction, targets: [] },
    "METER_DISCONNECTION",
    { allocating: true },
  );

  assert.equal(allocating.ok, false);
  assert.equal(allocating.code, "INVALID_ASSIGNMENT_TARGETS");
});

test("the send still writes ISSUED and stamps it, as it did before", () => {
  // Nothing about today changes what a send does. The ITO page's own send
  // may still create and allocate in one call.
  const trn = makePayload({
    instruction,
    targets: [{ type: "USER", id: "fwr-1", name: "Kaiser" }],
  });

  assert.equal(trn.workflow.state, TRN_STATES.ISSUED);
  assert.equal(trn.workflow.issuedAt, "2026-10-11T10:00:00.000Z");
});

test("a created job holds its meter, so the button cannot make a second", () => {
  // DR-R001 5.2. Without this, two clicks on DCN would leave two
  // disconnections to allocate on one meter.
  assert.equal(ACTIVE_LCT_WORKFLOW_STATES.includes(TRN_STATES.CREATED), true);
});

test("the callable creates when no name was sent, and allocates when one was", async () => {
  const source = await read("instructionCallable.js");

  assert.match(
    source,
    /const allocating =\s*\n?\s*Array\.isArray\(data\?\.assignment\?\.targets\) && data\.assignment\.targets\.length > 0;/,
  );
  assert.match(source, /allocating,\s*\n\s*\}\);/, "the flag reaches the payload builder");
});

test("ALLOCATE is an action the office can take", async () => {
  const source = await read("manageInstructionCallable.js");

  assert.match(
    source,
    /MANAGE_ACTIONS = \["ALLOCATE", "REASSIGN", "CANCEL", "DELETE", "RESTORE"\]/,
  );
  assert.match(source, /ALLOCATE: \["allocate"\]/);
  assert.match(source, /CANCEL: \["cancel"\]/);
});

test("every state gate in the manage callable is the machine's", async () => {
  // Five hand-written refusals went: TRN_ALREADY_COMPLETED,
  // TRN_ALREADY_CANCELLED, TRN_IN_PROGRESS, INVALID_REASSIGN_STATE and
  // INVALID_CANCEL_STATE, each with its own list of allowed states. One
  // more list of states is one more thing that can disagree with the rule.
  const source = await read("manageInstructionCallable.js");

  for (const gone of [
    "TRN_ALREADY_COMPLETED",
    "TRN_ALREADY_CANCELLED",
    "TRN_IN_PROGRESS",
    "INVALID_REASSIGN_STATE",
    "INVALID_CANCEL_STATE",
    "REASSIGN_ALLOWED_STATES",
    "CANCEL_ALLOWED_STATES",
  ]) {
    assert.doesNotMatch(source, new RegExp(gone), `${gone} is the machine's job now`);
  }

  assert.match(source, /canMoveAs\(from, move, role\)/);
});

test("allocating stamps the clock every time a name goes on", async () => {
  // DR-R001 5.6: a job handed to a second man has waited on him since now.
  const source = await read("manageInstructionCallable.js");
  const patch = source.slice(source.indexOf("function buildAllocatePatch"));

  assert.match(patch.slice(0, 1800), /"workflow\.state": TRN_STATES\.ISSUED/);
  assert.match(patch.slice(0, 1800), /"workflow\.issuedAt": now/);
});

test("only a reassign counts as a reassignment", async () => {
  // A first allocate that bumped the count would make every job look as
  // though it had been handed on once.
  const source = await read("manageInstructionCallable.js");
  const patch = source.slice(source.indexOf("function buildAllocatePatch"));

  assert.match(patch.slice(0, 2400), /if \(reassigning\) \{/);
  assert.match(patch.slice(0, 2400), /patch\["workflow\.reassignmentCount"\] = currentCount \+ 1;/);
});

test("the old words are understood in one place, and placed before use", () => {
  // The copies of the state on the meter and on its registry row were never
  // measured by the census, so a reader must place what it finds rather
  // than assume it is one of the five.
  assert.equal(currentState("REASSIGNED"), TRN_STATES.ISSUED);
  assert.equal(currentState("IN_PROGRESS"), TRN_STATES.ACCEPTED);
  assert.equal(currentState("REJECTED"), TRN_STATES.CREATED);
  assert.equal(currentState("ISSUED"), TRN_STATES.ISSUED);
  assert.equal(currentState("SOMETHING_NEW"), "", "a state nobody knows is shown, not filled in");
  assert.equal(currentState(null), "");
});

test("BGO reads the machine's list, so a waiting ITO job blocks a batch", async () => {
  // Found while building this slice: `tcUploads` kept TWO copies of which
  // states mean work is out on a meter, neither holding CREATED. A BGO
  // batch would have read a meter with an unallocated disconnection on it
  // as free and sent a second one.
  const { TC_ACTIVE_WORKFLOW_STATES, getActiveSameOperationLifecycle } =
    await import("../tcUploads/helpers.js");

  assert.deepEqual(TC_ACTIVE_WORKFLOW_STATES, ["CREATED", "ISSUED", "ACCEPTED"]);

  const busy = (workflowState) =>
    getActiveSameOperationLifecycle({
      trnType: "METER_DISCONNECTION",
      astData: {
        trnActiveLifecycle: {
          trnId: "TRN_1",
          trnType: "METER_DISCONNECTION",
          workflowState,
        },
      },
    });

  assert.notEqual(busy("CREATED"), null, "a job waiting to be allocated holds the meter");
  assert.notEqual(busy("ISSUED"), null);
  assert.notEqual(busy("ACCEPTED"), null);

  // The marker may still carry an old word; it is placed, not refused.
  assert.notEqual(busy("REASSIGNED"), null);
  assert.notEqual(busy("IN_PROGRESS"), null);

  assert.equal(busy("COMPLETED"), null);
  assert.equal(busy("DELETED"), null);

  // A handed-back job is NOT free. It lands in CREATED and is waiting to be
  // given to somebody else (`DR-R001` 5.1), so it still holds its meter.
  // Before today a `REJECTED` marker read as free and a BGO batch could put
  // a second disconnection on that meter - the same fault as CREATED, one
  // step further on.
  assert.notEqual(busy("REJECTED"), null);
});

test("the refresh callable no longer keeps its own copy of that list", async () => {
  const source = await readFile(
    new URL("../tcUploads/refreshCallable.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /TC_ACTIVE_WORKFLOW_STATES = STATES_HOLDING_THE_METER/);
  assert.doesNotMatch(source, /"REASSIGNED",/);
  assert.match(source, /currentState\(workflowState\)/);
});
