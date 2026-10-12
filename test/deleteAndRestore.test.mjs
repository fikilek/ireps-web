// The office can bin a waiting job and bring it back. `DR-R001` 5.5, 9.2.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildDeletedRows,
  buildWaitingRows,
  isWaitingToBeGivenOut,
  selectItoWork,
  waitingSinceMs,
  workFor,
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

  // Owner, 12 October 2026: who refused it and why are two columns, not one
  // sentence - so each can be filtered and sorted on its own.
  assert.equal(made.rejectedBy, "NAv", "a job nobody has refused names nobody");
  assert.equal(made.rejectedReason, "NAv", "and invents no reason");
  assert.equal(refused.rejectedBy, "Kaiser");
  assert.equal(refused.rejectedReason, "Dog on the property");
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
    // Both: the server reads the list first, and the single id is what
    // every existing caller sends.
    trnIds: ["TRN_MDCN_1_ELC_W_5213"],
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
  assert.match(source, /ask\("RESTORE", row\)/);
  assert.match(source, /ask\("DELETE", row\)/);
});

test("it asks before it writes, and says what happened after", async () => {
  // The owner's submit standard: a confirmation window before, visible
  // progress during, a result window after.
  const source = await read("../src/pages/operations/ItoDashboardPage.jsx");

  assert.match(source, /\{asking \? \(/);
  assert.match(source, /\{outcome && !asking \? \(/);
  assert.match(source, /setBusyId\(rows\.length === 1 \? rows\[0\]\.id : "ALL"\)/, "the row shows its own wait");
  assert.match(source, /ito-manage-reason/, "and the reason is asked for");
});

test("the action column cannot go stale", async () => {
  // It closes over the role and the busy row. Memoised on an empty list it
  // would never show its spinner.
  const source = await read("../src/pages/operations/ItoDashboardPage.jsx");
  const after = source.slice(source.indexOf("const waitingColumns"));

  // It closes over the role, the busy row and now the router too.
  assert.match(after.slice(0, 6000), /\[role, busyId, navigate\]/);
});

test("the result is reported from the transaction, never from the meter", async () => {
  // A delete can leave the Meter Registry looking unchanged: the marker is a
  // single field, so it may be naming a different kind of job and the delete
  // correctly leaves it alone.
  const source = await read("../src/pages/operations/ItoDashboardPage.jsx");

  assert.match(source, /Its number: /);
  assert.match(source, /never from the\s*\n?\s*\/\/ meter/);
});

// ===========================================================================
// The Waiting view made powerful. Owner, 12 October 2026.
// ===========================================================================

test("the old words for the pool are placed, not mis-filed", async () => {
  // Owner, finding it on his own screen: "its 4 ...not 6". Two of ward 6's
  // jobs were stored as REJECTED - which `DR-R001` 5.1 says IS a Created job
  // - and a reader comparing the literal CREATED left them out of Waiting,
  // while `columnFor` could not place them either, so they landed in
  // `unaccounted` on the row of the worker who had refused them.
  const { ITO_CREATED_STATES } = await import(
    "../src/pages/operations/dashboard/operationsSummary.js"
  );

  assert.ok(ITO_CREATED_STATES.includes("CREATED"));
  assert.ok(ITO_CREATED_STATES.includes("REJECTED"), "a refusal returns it to the pool");
  assert.ok(ITO_CREATED_STATES.includes("CANCELLED"), "so does the office taking it back");

  // And the one that must NOT be folded in. The owner settled twice that it
  // has no place in this lane; it has to surface as the fault it would be.
  assert.equal(ITO_CREATED_STATES.includes("IN_PROGRESS"), false);

  const old = [job("REJECTED"), job("CANCELLED"), job("CREATED")];

  assert.equal(selectItoWork(old).filter(isWaitingToBeGivenOut).length, 3);
});

test("who refused it and why are two columns", () => {
  const rows = buildWaitingRows(
    [
      job("CREATED", {
        rejectReason: "Dog on the property",
        acceptedRejectedUser: "Kaiser",
      }),
    ],
    Date.parse("2026-10-12T12:00:00.000Z"),
  );

  assert.equal(rows[0].rejectedBy, "Kaiser");
  assert.equal(rows[0].rejectedReason, "Dog on the property");
});

test("a waiting row carries what the three windows need", () => {
  // A field the server writes and a row builder forgets is a button that
  // cannot open.
  const rows = buildWaitingRows(
    [
      job("CREATED", {
        astId: "AST_1",
        erfId: "ERF_1",
        premiseId: "PRM_1",
        wardPcode: "ZA5241006",
        wardNo: "006",
      }),
    ],
    Date.parse("2026-10-12T12:00:00.000Z"),
  );

  const row = rows[0];

  assert.equal(row.astId, "AST_1", "the meter window and the ITO page need it");
  assert.equal(row.erfId, "ERF_1", "the map draws the boundary from the id");
  assert.equal(row.premiseId, "PRM_1", "the premise pin");
  assert.equal(row.wardPcode, "ZA5241006");
  assert.equal(row.wardNo, "006");
});

test("the row knows which page allocates it", () => {
  // One well: the pairing lives in ITO_TRANSACTIONS (`DR-R001` 3.2), not in
  // a second map of five lines.
  assert.equal(workFor("METER_DISCONNECTION"), "disconnect");
  assert.equal(workFor("METER_RECONNECTION"), "reconnect");
  assert.equal(workFor("METER_INSPECTION"), "inspect");
  assert.equal(workFor("METER_REMOVAL"), "remove");
  assert.equal(workFor("METER_READING"), "read");

  // A transaction the ITO page does not send gets no button rather than a
  // button to nowhere.
  assert.equal(workFor("METER_DISCOVERY"), "");
  assert.equal(workFor(""), "");
});

test("the Allocate button opens the ITO page on THIS transaction", async () => {
  const source = await read("../src/pages/operations/ItoDashboardPage.jsx");

  assert.match(
    source,
    /\/operations\/ito\/\$\{row\.astId\}\/\$\{row\.work\}\?trn=\$\{encodeURIComponent\(row\.id\)\}/,
  );
  // No meter id or no work, no button - rather than a button that cannot open.
  assert.match(source, /row\.astId && row\.work \?/);
});

test("the meter and the maps are the windows the registries already open", async () => {
  // One window for one thing, reached from wherever the office is standing.
  const source = await read("../src/pages/operations/ItoDashboardPage.jsx");

  assert.match(source, /MeterDeepDetailsModal trnId=\{meterTrnId\}/);
  assert.match(source, /from "\.\.\/registries\/components\/BoundaryMapModal"/);
  assert.match(source, /from "\.\.\/registries\/components\/MeterDeepDetailsModal"/);

  // The address pins the premise and the meter; the ERF asks about the ERF.
  assert.match(source, /setMapView\(\{ \.\.\.row, withPins: true \}\)/);
  assert.match(source, /withPins: false/);
});

test("nothing is pinned at nowhere", async () => {
  // A premise or meter with no position gets no pin, and the map shows the
  // ERF alone - which is the honest answer and a gap worth seeing (UI-R008).
  const source = await read("../src/pages/operations/ItoDashboardPage.jsx");
  const pins = source.slice(source.indexOf("const mapPins"));

  assert.match(pins.slice(0, 2000), /Number\.isFinite\(premiseLat\) && Number\.isFinite\(premiseLng\)/);
  assert.match(pins.slice(0, 2000), /Number\.isFinite\(meterLat\) && Number\.isFinite\(meterLng\)/);
  assert.match(pins.slice(0, 2000), /NOTHING IS PINNED AT NOWHERE/);
});

test("a cell with nothing behind it is text, not a dead button", async () => {
  const source = await read("../src/pages/operations/ItoDashboardPage.jsx");

  // No ERF id, no boundary to draw - so the ERF and the address stay as text.
  assert.match(source, /row\.erfId \? \(/);
});

test("the Meter column stays put through a horizontal scroll", async () => {
  // It was already switched on; with nine columns it now has something to do.
  const source = await read("../src/pages/operations/ItoDashboardPage.jsx");
  const waiting = source.slice(source.indexOf('title="Waiting to be given out"'));

  assert.match(waiting.slice(0, 600), /stickyFirstColumn/);
});

test("ONE LOOK FOR A CELL YOU CAN PRESS", async () => {
  // Owner, 12 October 2026, holding the Meter Registry and the ITO
  // monitoring screen side by side: "can we be consistent with css".
  //
  // He was looking at the same three things - a meter, an ERF, an address -
  // drawn as blue chips with icons on one screen and bare underlined text on
  // the other. The component that makes the chip already existed; it lived
  // INSIDE the registry page, so every other screen had to invent its own.
  const registry = await read("../src/pages/registries/MetersRegistryPage.jsx");
  const ito = await read("../src/pages/operations/ItoDashboardPage.jsx");

  for (const [name, source] of [["registry", registry], ["ito", ito]]) {
    assert.match(source, /from "\.\.\/\.\.\/components\/table\/DataActionButton"/, name);

    // Neither keeps a copy of the look.
    assert.doesNotMatch(source, /function DataActionButton/, name);
    assert.doesNotMatch(source, /dataActionButton: \{/, name);
    assert.doesNotMatch(source, /actionSvgIcon: \{/, name);
  }

  // The three cells that are the same thing on both screens use the same
  // icon on both.
  for (const icon of ["MeterActionIcon", "ErfActionIcon", "PremiseActionIcon"]) {
    assert.match(registry, new RegExp(`<${icon} />`), `registry ${icon}`);
    assert.match(ito, new RegExp(`<${icon} />`), `ito ${icon}`);
  }
});

test("the red chip says what it does in its word, not only in its colour", async () => {
  const chip = await read("../src/components/table/DataActionButton.jsx");

  assert.match(chip, /tone === "remove"/);
  assert.match(chip, /never stands alone/);

  const ito = await read("../src/pages/operations/ItoDashboardPage.jsx");

  assert.match(ito, /tone="remove"/);
  assert.match(ito, />\s*Delete\s*</, "and the word is there");
});

test("a row shows its own wait, and the others do not pretend to be ready", async () => {
  const ito = await read("../src/pages/operations/ItoDashboardPage.jsx");

  assert.match(ito, /busy=\{busyId === row\.id\}/);
  assert.match(ito, /disabled=\{Boolean\(busyId\) && busyId !== row\.id\}/);
});

// ===========================================================================
// The worker's own page. `DR-R001` 9.3 and 1.15.0.
// ===========================================================================

const KAISER = "fwr-kaiser";

const his = (state, extra = {}) =>
  job(state, {
    targetType: "USER",
    targetId: KAISER,
    targetName: "Kaiser Kaiser",
    ...extra,
  });

test("his page lists what he HOLDS, and nothing else", async () => {
  // Issued and Accepted are the two states in which the job is his. His
  // completed work is his too, but it is finished and is not a load.
  const { buildWorkerJobRows, countWorkerCompleted } = await import(
    "../src/pages/operations/ito-dashboard/itoMonitoring.js"
  );

  const all = [
    his("ISSUED", { trnId: "A", issuedAt: "2026-10-10T23:45:00.000Z" }),
    his("ACCEPTED", { trnId: "B" }),
    his("COMPLETED", { trnId: "C" }),
    job("ISSUED", { trnId: "SOMEBODY_ELSE", targetType: "USER", targetId: "other", targetName: "Peter" }),
    job("CREATED", { trnId: "NOBODY" }),
  ];

  const rows = buildWorkerJobRows(all, KAISER, Date.parse("2026-10-12T12:00:00.000Z"));

  assert.deepEqual(rows.map((row) => row.id).sort(), ["A", "B"]);
  assert.equal(countWorkerCompleted(all, KAISER), 1, "counted, not listed");
});

test("the oldest is first, because that is what the office came about", async () => {
  const { buildWorkerJobRows } = await import(
    "../src/pages/operations/ito-dashboard/itoMonitoring.js"
  );

  const rows = buildWorkerJobRows(
    [
      his("ISSUED", { trnId: "NEW", issuedAt: "2026-10-12T09:00:00.000Z" }),
      his("ISSUED", { trnId: "OLD", issuedAt: "2026-10-10T23:45:00.000Z" }),
      // No issue time at all - it cannot be placed in the order, so it goes
      // last rather than being treated as the oldest thing on the page.
      his("ACCEPTED", { trnId: "NOSTAMP" }),
    ],
    KAISER,
    Date.parse("2026-10-12T12:00:00.000Z"),
  );

  assert.deepEqual(rows.map((row) => row.id), ["OLD", "NEW", "NOSTAMP"]);
});

test("the three-day clock says what it is doing, in words", async () => {
  // DR-R001 5.6. Two cases must never read as a number: work he has taken,
  // which is not on the clock at all, and work with no issue time, which the
  // clock can never reach.
  const { describeExpiry } = await import(
    "../src/pages/operations/ito-dashboard/itoMonitoring.js"
  );

  const now = Date.parse("2026-10-12T12:00:00.000Z");
  const ago = (ms) => new Date(now - ms).toISOString();
  const DAY = 24 * 60 * 60 * 1000;

  assert.equal(
    describeExpiry({ workflowState: "ACCEPTED", issuedAt: ago(10 * DAY) }, now),
    "not on the clock",
    "the clock cannot see that he is standing at the meter",
  );

  assert.equal(describeExpiry({ workflowState: "ISSUED" }, now), "never");
  assert.equal(describeExpiry({ workflowState: "ISSUED", issuedAt: null }, now), "never");

  assert.equal(describeExpiry({ workflowState: "ISSUED", issuedAt: ago(1.5 * DAY) }, now), "in 1 d");
  assert.equal(describeExpiry({ workflowState: "ISSUED", issuedAt: ago(2.9 * DAY) }, now), "in 2 h");
  assert.equal(describeExpiry({ workflowState: "ISSUED", issuedAt: ago(4 * DAY) }, now), "due now");
});

test("ONE ACTION ON HIS PAGE: unallocate", async () => {
  // Owner, 12 October 2026: "unallocate first, then delete" (DR-R001 1.15.0).
  // A job still with him cannot be deleted, and once unallocated it is in
  // Waiting - which has the Delete already. No combined act: the two have
  // different reasons and one press cannot honestly collect both.
  const source = await read("../src/pages/operations/ItoDashboardPage.jsx");
  const block = source.slice(source.indexOf("const workerJobColumns"));
  const columns = block.slice(0, block.indexOf("const deletedColumns"));

  assert.match(columns, /ask\("CANCEL", row\)/);
  assert.match(columns, />\s*Unallocate\s*</);
  assert.doesNotMatch(columns, /ask\("DELETE", row\)/, "no delete on his page");
  assert.doesNotMatch(columns, />\s*Delete\s*</);
});

test("clicking work nobody holds opens the pool, not a person", async () => {
  // The per-worker table has a row for jobs with no holder. There is no
  // person there to have a page.
  //
  // This pins the RULE, not the line. It first matched the inline
  // `row.unheld ? setView("created")` and broke the moment that moved into
  // openWorker - a test that fails on a rename teaches nothing, and gets
  // deleted by whoever is in a hurry.
  const source = await read("../src/pages/operations/ItoDashboardPage.jsx");

  const open = source.match(/function openWorker\(row\) \{[\s\S]*?\n  \}/);

  assert.ok(open, "one well for opening a worker");
  assert.match(open[0], /row\.unheld/);
  assert.match(open[0], /setView\("created"\)/);
  assert.match(open[0], /return;/, "and it stops there - no page for a non-person");
});

test("a worker's name LOOKS like something you can open", async () => {
  // Owner, 12 October 2026, shown the per-worker table: *"how will a normal
  // person realize this is a btn ?"*, then *"there is mouse over. there is
  // nothing visually that shows its a btn"*.
  //
  // A pointer cursor is NOT an affordance. It speaks only once the mouse is
  // already on the row, so it can never tell anyone the row opens anything.
  // The name itself has to carry it, standing still.
  const source = await read("../src/pages/operations/ItoDashboardPage.jsx");

  const style = source.match(/workerOpen: \{[\s\S]*?\n  \},/);

  assert.ok(style, "the name has a style of its own");
  assert.match(style[0], /textDecoration: "underline"/, "underlined");
  assert.match(style[0], /color: "#1d4ed8"/, "and blue - the colour iREPS opens things in");

  // Not colour alone - colour is never the only signal. An arrow too.
  assert.match(source, /workerOpenArrow/);

  // A real button, so the keyboard reaches it. A clickable <tr> never did.
  assert.match(source, /<button[\s\S]{0,80}style=\{styles\.workerOpen\}/);

  // And it does not fire the row underneath as well.
  assert.match(source, /event\.stopPropagation\(\);[\s\S]{0,40}openWorker\(row\);/);
});

test("the words say it too, for anyone who reads before clicking", async () => {
  const source = await read("../src/pages/operations/ItoDashboardPage.jsx");

  assert.match(source, /A worker's name opens his page/);
});

test("a clickable row carries the pointer, and nothing else", async () => {
  // The shared table is used by about forty screens. It may say "you can
  // press this" with the cursor; it must NOT paint the row on hover, because
  // it would have to put the colour back by hand afterwards and would wipe
  // whatever rowStyle had set - the MREAD registry paints its chosen cycle
  // row exactly that way.
  const source = await read("../src/components/table/IrepsTable.jsx");

  assert.match(source, /clickableRow: \{ cursor: "pointer" \}/);
  assert.doesNotMatch(source, /onMouseEnter/, "no hand-painted hover on the shared row");
  assert.doesNotMatch(source, /onMouseLeave/);
});

test("his page says what it does not know", async () => {
  const source = await read("../src/pages/operations/ItoDashboardPage.jsx");

  assert.match(source, /last heard from/);
  assert.match(source, /an unknown age is not a long one/);
  assert.match(source, /it is his, but it is not a load/);
});

test("his page keeps the ward that was chosen above it", async () => {
  // It is a view of this screen rather than a route of its own. Nothing in
  // iREPS loads before a ward (UI-R009 4).
  const source = await read("../src/pages/operations/ItoDashboardPage.jsx");

  assert.match(source, /It is a view of this screen rather than a route of its own/);
  assert.doesNotMatch(source, /navigate\(`\/operations\/ito-dashboard\/worker/);
});

test("his whole load can come off him in one act", async () => {
  // All three designs reached this independently, and the owner's own case
  // for the override is the bulk one: "someone accepts the work, and then
  // he's hit by a car, he's in hospital". That is not one job.
  const built = buildManageRequest({
    action: "CANCEL",
    trnIds: ["A", "B", "C"],
    reason: "In hospital until Monday",
  });

  assert.equal(built.ok, true);
  assert.equal(built.count, 3);
  assert.deepEqual(built.request.trnIds, ["A", "B", "C"]);
  assert.equal(built.request.cancelReason, "In hospital until Monday");
});

test("it is all of them or none of them, and the office is told which", async () => {
  // The office's callable writes every job in ONE Firestore transaction, so
  // a batch cannot half-succeed. Saying so is what stops the office guessing.
  const source = await read("../src/pages/operations/ItoDashboardPage.jsx");

  assert.match(source, /either every one of them comes off him, or none does/);
  assert.match(source, /Nothing moved — the office writes them together or not at all/);
});

test("fifty is the most that goes at once, and it says so", () => {
  const tooMany = buildManageRequest({
    action: "CANCEL",
    trnIds: Array.from({ length: 51 }, (_, index) => `T${index}`),
    reason: "x",
  });

  assert.equal(tooMany.ok, false);
  assert.match(tooMany.message, /51 jobs is more than iREPS sends at once/);
});

test("the office is warned when the job is already in his hands", async () => {
  // iREPS watches the record, not the work, so it cannot know he is at the
  // meter - and must say so rather than let the office find out from him.
  // Since 12 October his capture survives, which is the half he most needs.
  const source = await read("../src/pages/operations/ItoDashboardPage.jsx");

  assert.match(source, /work he has already taken/);
  assert.match(source, /nothing he captured is lost/);
});

test("a job iREPS cannot place still gets a row on his page", async () => {
  // Filtering it out would drop a job off his page silently - a record
  // nobody can see is a record nobody fixes.
  const { buildWorkerJobRows } = await import(
    "../src/pages/operations/ito-dashboard/itoMonitoring.js"
  );

  const rows = buildWorkerJobRows(
    [his("WAITING_BATCH_ACCEPTANCE", { trnId: "ODD" })],
    KAISER,
    Date.parse("2026-10-12T12:00:00.000Z"),
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].unplaceable, true);
  assert.equal(rows[0].state, "WAITING_BATCH_ACCEPTANCE", "it keeps its own word");

  // And it is offered no action, because the machine would refuse one.
  const source = await read("../src/pages/operations/ItoDashboardPage.jsx");

  assert.match(source, /row\.unplaceable \? \(/);
  assert.match(source, /iREPS cannot place this job's state/);
});

test("ONE AT A TIME, OR SEVERAL - both, never one instead of the other", async () => {
  // Owner, 12 October 2026, correcting me when I reported the bulk path as
  // though it replaced the single one: "the SPV should be able to take one at
  // a time if they want .. or more then one if required that way".
  //
  // So the page carries both, and neither is the exception. A row has its own
  // Unallocate; ticking several offers one act over all of them.
  const source = await read("../src/pages/operations/ItoDashboardPage.jsx");
  const block = source.slice(source.indexOf("const workerJobColumns"));
  const columns = block.slice(0, block.indexOf("const deletedColumns"));

  // One at a time: the button is on the row.
  assert.match(columns, /onClick=\{\(\) => ask\("CANCEL", row\)\}/);

  // Several: a tick on the row, and a bar that acts on what is ticked.
  assert.match(columns, /type="checkbox"/);
  assert.match(source, /askForAll\(/);
  assert.match(source, /Unallocate \{pickedHere\.length\}/);

  // And the bar only appears once something is ticked, so the single path is
  // never cluttered by the other.
  assert.match(source, /pickedHere\.length \? \(/);
});
