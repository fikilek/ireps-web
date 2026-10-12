// The office can bin a waiting job and bring it back. `DR-R001` 5.5, 9.2.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildDeletedRows,
  buildWaitingRows,
  selectItoWork,
  waitingSinceMs,
} from "../src/pages/operations/ito-dashboard/itoMonitoring.js";
import {
  ITO_MANAGE_ACTIONS,
  buildManageRequest,
  canManageItoWork,
  manageProblem,
  saidReason,
} from "../src/components/ito/manageItoRequest.js";
import {
  ITO_TRANSACTIONS,
  describeOpenJob,
  openJobForWork,
  openJobMark,
} from "../src/components/ito/itoTransactions.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const dcn = ITO_TRANSACTIONS.find((item) => item.work === "disconnect");

const job = (state, extra = {}) => ({
  trnId: `T_${state}`,
  originChannel: "OFFICE",
  trnType: "METER_DISCONNECTION",
  workflowState: state,
  astNo: "042042",
  erfNo: "5213",
  address: "26 Oldacre Street",
  ...extra,
});

// ===========================================================================
// Who sees the bin
// ===========================================================================

test("every view excludes the bin, and one view asks for it by name", () => {
  const all = [job("CREATED"), job("ISSUED"), job("DELETED"), job("COMPLETED")];

  assert.deepEqual(
    selectItoWork(all).map((trn) => trn.workflowState),
    ["CREATED", "ISSUED", "COMPLETED"],
    "the default excludes it",
  );

  assert.deepEqual(
    selectItoWork(all, { deleted: "only" }).map((trn) => trn.workflowState),
    ["DELETED"],
    "and the Deleted view sees only it",
  );
});

test("the bin's view keeps the narrowing every other view has", () => {
  // The alternative - a caller re-filtering the raw transactions - would lose
  // the office-channel narrowing and the ITO-type narrowing, and the two
  // copies would drift.
  const mixed = [
    job("DELETED"),
    job("DELETED", { trnId: "FIELD", originChannel: "FIELD" }),
    job("DELETED", { trnId: "NOT_ITO", trnType: "METER_DISCOVERY" }),
  ];

  assert.deepEqual(
    selectItoWork(mixed, { deleted: "only" }).map((trn) => trn.trnId),
    ["T_DELETED"],
  );
});

test("a tick still narrows the bin to one kind of work", () => {
  const mixed = [
    job("DELETED"),
    job("DELETED", { trnId: "RCN", trnType: "METER_RECONNECTION" }),
  ];

  assert.deepEqual(
    selectItoWork(mixed, { deleted: "only", trnTypes: ["METER_RECONNECTION"] }).map(
      (trn) => trn.trnId,
    ),
    ["RCN"],
  );
});

// ===========================================================================
// How long it has been waiting
// ===========================================================================

test("waiting is measured from when it came BACK, not from when it was issued", () => {
  // DR-R001 9.2. A job cancelled after three days came back a minute ago; it
  // has not been waiting three days, and saying so would be a plausible
  // number covering a fact nobody held (UI-R008).
  const came_back = "2026-10-12T11:59:00.000Z";

  assert.equal(
    waitingSinceMs({
      issuedAt: "2026-10-09T12:00:00.000Z",
      returnedToCreatedAt: came_back,
    }),
    Date.parse(came_back),
  );
});

test("a job never allocated has waited since it was made", () => {
  // Its birth is not a substitute for anything - it IS when the waiting
  // began, because nobody has ever been asked.
  const made = "2026-10-12T08:00:00.000Z";

  assert.equal(waitingSinceMs({ createdAt: made }), Date.parse(made));
  assert.equal(waitingSinceMs({ metadata: { createdAt: made } }), Date.parse(made));
});

test("the issue time is never borrowed as the waiting time", () => {
  assert.equal(waitingSinceMs({ issuedAt: "2026-10-09T12:00:00.000Z" }), null);
  assert.equal(waitingSinceMs({}), null);
  assert.equal(waitingSinceMs(null), null);
});

test("a waiting row says why it is waiting, or NAv", () => {
  const rows = buildWaitingRows(
    [
      job("CREATED"),
      job("CREATED", {
        trnId: "REFUSED",
        astNo: "999",
        rejectReason: "Dog on the property",
        acceptedRejectedUser: "Kaiser",
      }),
    ],
    Date.parse("2026-10-12T12:00:00.000Z"),
  );

  const made = rows.find((row) => row.id === "T_CREATED");
  const refused = rows.find((row) => row.id === "REFUSED");

  assert.equal(made.why, "NAv", "a job nobody has refused invents no reason");
  assert.match(refused.why, /Refused by Kaiser: Dog on the property/);
});

test("a binned row says why, by whom, and for how long", () => {
  const rows = buildDeletedRows(
    [
      job("DELETED", {
        deleteReason: "Wrong meter",
        deletedByUser: "Thandi",
        deletedAt: "2026-10-11T12:00:00.000Z",
      }),
    ],
    Date.parse("2026-10-12T12:00:00.000Z"),
  );

  assert.equal(rows[0].why, "Wrong meter");
  assert.equal(rows[0].by, "Thandi");
  assert.match(rows[0].binnedFor, /1 d|24 h/);
});

test("a binned row with nothing recorded says NAv, never a blank", () => {
  const rows = buildDeletedRows([job("DELETED")], Date.parse("2026-10-12T12:00:00.000Z"));

  assert.equal(rows[0].why, "NAv");
  assert.equal(rows[0].by, "NAv");
});

// ===========================================================================
// Asking the server
// ===========================================================================

test("a delete must say why; a restore may", () => {
  // DR-R001 5.1 names a rejection, a cancellation and a deletion. A restore
  // is not on that list, so it is not demanded - and is recorded when given.
  assert.equal(ITO_MANAGE_ACTIONS.DELETE.needsReason, true);
  assert.equal(ITO_MANAGE_ACTIONS.CANCEL.needsReason, true);
  assert.equal(ITO_MANAGE_ACTIONS.RESTORE.needsReason, false);

  assert.match(manageProblem({ action: "DELETE", reason: "" }), /Why is this being deleted/);
  assert.equal(manageProblem({ action: "DELETE", reason: "Wrong meter" }), null);
  assert.equal(manageProblem({ action: "RESTORE", reason: "" }), null);
});

test("NAv IS NOT A REASON", () => {
  // DR-R001 1.12.9: a gap must never satisfy the thing it is a gap in. The
  // form refuses exactly what the server refuses.
  for (const nothing of ["NAv", "nav", "  NAV  ", "", "   "]) {
    assert.equal(saidReason(nothing), "", nothing);
    assert.ok(manageProblem({ action: "DELETE", reason: nothing }), nothing);
  }

  assert.equal(saidReason(" Wrong meter "), "Wrong meter");
});

test("the request carries the action, the transaction and its own reason key", () => {
  const built = buildManageRequest({
    action: "DELETE",
    trnId: "TRN_MDCN_1_ELC_W_5213",
    reason: "Wrong meter",
  });

  assert.equal(built.ok, true);
  assert.deepEqual(built.request, {
    action: "DELETE",
    trnId: "TRN_MDCN_1_ELC_W_5213",
    deleteReason: "Wrong meter",
  });

  assert.equal(
    buildManageRequest({ action: "RESTORE", trnId: "T" }).request.restoreReason,
    "NAv",
    "nothing given is NAv, not an empty string",
  );
});

test("nothing is sent without a transaction behind it", () => {
  for (const trnId of ["", "   ", null, undefined]) {
    const built = buildManageRequest({ action: "DELETE", trnId, reason: "x" });

    assert.equal(built.ok, false, String(trnId));
    assert.match(built.message, /No transaction was named/);
  }
});

test("only a supervisor or a manager gets the buttons at all", () => {
  // DR-R001 5.5. The route admits SPU and ADM as readers, so the screen is
  // not the gate: they see it with no action column rather than buttons that
  // refuse.
  for (const may of ["SPV", "MNG", "spv", " mng "]) {
    assert.equal(canManageItoWork(may), true, may);
  }

  for (const may_not of ["FWR", "SPU", "ADM", "", null, undefined]) {
    assert.equal(canManageItoWork(may_not), false, String(may_not));
  }
});

test("the office's own callable does it, and the web had never called it", async () => {
  const sender = await read("../src/components/ito/manageItoWork.js");
  const source = await read("../src/components/ito/manageItoRequest.js");

  assert.match(sender, /"onManageLifecycleInstructionCallable"/);
  // The three moves this screen offers. An allocate goes through the ITO
  // page, which has a whole screen of context behind it.
  assert.match(source, /DELETE: \{/);
  assert.match(source, /RESTORE: \{/);
  assert.match(source, /CANCEL: \{/);
});

test("a call that does not come back says it does not know", async () => {
  const source = await read("../src/components/ito/manageItoWork.js");

  assert.match(source, /wrote: null/);
  assert.match(source, /may or may not have gone through/);
});

// ===========================================================================
// The marker readers - `DR-R001` 5.2 forbids a presence-only read by name
// ===========================================================================

test("the launch button's mark reads the state, not merely an id", () => {
  const row = (workflowState) => ({
    openJob: { trnId: "T", trnType: "METER_DISCONNECTION", workflowState, assignedToName: "Kaiser" },
  });

  assert.ok(openJobForWork(row("ISSUED"), dcn), "issued holds the meter");
  assert.ok(openJobForWork(row("CREATED"), dcn), "so does a job waiting in the pool");
  assert.ok(openJobForWork(row("ACCEPTED"), dcn));

  assert.equal(openJobForWork(row("DELETED"), dcn), null, "the bin does not");
  assert.equal(openJobForWork(row("COMPLETED"), dcn), null, "nor does finished work");
});

test("an old word is placed, and an unplaceable one keeps its mark", () => {
  const row = (workflowState) => ({
    openJob: { trnId: "T", trnType: "METER_DISCONNECTION", workflowState },
  });

  assert.ok(openJobForWork(row("REASSIGNED"), dcn), "lands in ISSUED");
  assert.ok(openJobForWork(row("IN_PROGRESS"), dcn), "lands in ACCEPTED");
  // A handed-back job lands in CREATED, which HOLDS the meter - it is waiting
  // to be given to somebody else - so it keeps its mark. My own first
  // assertion here said null, which would have been the wrong rule.
  assert.ok(openJobForWork(row("REJECTED"), dcn), "lands in CREATED, which holds it");

  // The bulk lane really writes this, and the machine refuses to place it. An
  // unplaceable state is a fault to show, not a job to hide.
  assert.ok(
    openJobForWork(row("WAITING_BATCH_ACCEPTANCE"), dcn),
    "a state iREPS cannot place keeps its mark",
  );
});

test("the mark says what it means, in words", () => {
  const open = (workflowState, assignedToName = "Kaiser") => ({
    trnId: "T",
    trnType: "METER_DISCONNECTION",
    workflowState,
    assignedToName,
  });

  assert.match(describeOpenJob(open("CREATED", "NAv"), dcn), /waiting on this meter, with nobody/);
  assert.match(describeOpenJob(open("ISSUED"), dcn), /waiting for Kaiser to accept/);
  assert.match(describeOpenJob(open("ACCEPTED"), dcn), /Kaiser has taken it/);
  assert.match(describeOpenJob(open("SOMETHING_NEW"), dcn), /state iREPS does not know/);

  // It used to lower-case the raw state, which gave the office
  // "created, with NAv" the day the button started creating jobs nobody holds.
  assert.doesNotMatch(describeOpenJob(open("CREATED", "NAv"), dcn), /NAv/);
});

test("only work waiting for an answer wears the exclamation", () => {
  assert.equal(openJobMark({ workflowState: "ISSUED" }), "!");
  assert.equal(openJobMark({ workflowState: "REASSIGNED" }), "!", "placed first");
  assert.equal(openJobMark({ workflowState: "CREATED" }), "•");
  assert.equal(openJobMark({ workflowState: "ACCEPTED" }), "•");
});

// ===========================================================================
// The register, which six screens read
// ===========================================================================

test("the register excludes the bin once, for all six of its readers", async () => {
  // The TRN Registry, the TRN Registry dashboard, the Anomalies dashboard,
  // the Customer Category dashboard, the Operational Teams page and the
  // Activity Analytics model all read one query. Filtering in each would be
  // six chances to forget one.
  const source = await read("../src/redux/trnsApi.js");

  assert.match(source, /export function isDeletedTrnRow/);
  assert.match(source, /\.filter\(\(row\) => !isDeletedTrnRow\(row\)\)/);
});

test("the issue time is no longer borrowed from the record's birth", async () => {
  // DR-R001 9.1 named this reader. The same stamp drives the three-day
  // expiry, so a borrowed date would make a job look old enough to be sent
  // back (UI-R008).
  const source = await read("../src/redux/trnsApi.js");
  const reader = source.slice(source.indexOf("function getIssuedAt"));

  assert.match(reader.slice(0, 200), /normalizeDateValue\(data\.workflow\?\.issuedAt\)/);
  assert.doesNotMatch(reader.slice(0, 200), /metadata\?\.createdAt/);
});

test("both normalisers carry what the bin and the pool need", async () => {
  // A field the server writes and a mapper forgets is written correctly and
  // drawn nowhere - which cost three Credit control numbers on 7 October.
  const source = await read("../src/redux/trnsApi.js");

  for (const field of [
    "deletedAt",
    "deletedByUser",
    "deleteReason",
    "returnedToCreatedAt",
  ]) {
    assert.equal(
      source.split(`${field}:`).length - 1 >= 2,
      true,
      `${field} is in both the document and the registry shape`,
    );
  }
});

// ===========================================================================
// The screen
// ===========================================================================

test("the bin has a view, so a restore is reachable by a human", async () => {
  const source = await read("../src/pages/operations/ItoDashboardPage.jsx");

  assert.match(source, /\{ key: "deleted", label: "Deleted", ready: true \}/);
  assert.match(source, /deleted: "only"/);
  assert.match(source, /actions=\{\["RESTORE"\]\}/);
  assert.match(source, /actions=\{\["DELETE"\]\}/);
});

test("it asks before it writes, and says what happened after", async () => {
  // The owner's submit standard: a confirmation window before, visible
  // progress during, a result window after.
  const source = await read("../src/pages/operations/ItoDashboardPage.jsx");

  assert.match(source, /\{asking \? \(/);
  assert.match(source, /\{outcome && !asking \? \(/);
  assert.match(source, /setBusyId\(row\.id\)/, "the row shows its own wait");
  assert.match(source, /ito-manage-reason/, "and the reason is asked for");
});

test("the action column cannot go stale", async () => {
  // It closes over the role and the busy row. Memoised on an empty list it
  // would never show its spinner.
  const source = await read("../src/pages/operations/ItoDashboardPage.jsx");
  const after = source.slice(source.indexOf("const waitingColumns"));

  assert.match(after.slice(0, 3000), /\[role, busyId\]/);
});

test("the result is reported from the transaction, never from the meter", async () => {
  // A delete can leave the Meter Registry looking unchanged: the marker is a
  // single field, so it may be naming a different kind of job and the delete
  // correctly leaves it alone.
  const source = await read("../src/pages/operations/ItoDashboardPage.jsx");

  assert.match(source, /Its number: /);
  assert.match(source, /never from the\s*\n?\s*\/\/ meter/);
});
