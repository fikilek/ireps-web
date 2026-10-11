// The ITO monitoring screen, per worker. `DR-R001` 9.1.
//
// Reshaped on 11 October 2026 when the state machine landed: a refusal
// stopped being a state, so a refused job is back in `Created` with nobody
// on it. The table is about workers, so a job nobody holds is on nobody's
// row — and a refusal is counted as something a worker DID, outside the
// total of what he holds.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ITO_STATES,
  buildWorkerRows,
  columnFor,
  describeAge,
  describeTicks,
  holderOf,
  isWaitingToBeGivenOut,
  lettersFor,
  monitoringAside,
  refusalsOn,
  selectItoWork,
  summariseWorkers,
} from "../src/pages/operations/ito-dashboard/itoMonitoring.js";

const NOW = Date.parse("2026-10-11T06:00:00.000Z");
const ago = (minutes) => new Date(NOW - minutes * 60000).toISOString();

const job = (over = {}) => ({
  trnType: "METER_DISCONNECTION",
  originChannel: "OFFICE",
  workflowState: "ISSUED",
  assignment: { targets: [{ type: "USER", id: "u1", name: "Peter M." }] },
  issuedAt: ago(30),
  ...over,
});

/** A job Kaiser refused: back in Created, with his refusal on the record. */
const refused = (over = {}) =>
  job({
    workflowState: "CREATED",
    assignment: { targets: [] },
    workflow: {
      rejections: [{ uid: "kaiser", name: "Kaiser Kaiser", reason: "Dog on the property" }],
    },
    ...over,
  });

test("the four states a job can be in, and Progress is not among them", () => {
  assert.deepEqual(ITO_STATES.map((s) => s.key), ["CREATED", "ISSUED", "ACCEPTED", "COMPLETED"]);
});

test("a worker's columns are what he holds or held, and a refusal is not one", () => {
  assert.equal(columnFor("ISSUED"), "issued");
  assert.equal(columnFor("REASSIGNED"), "issued", "a reassign is waiting to be accepted");
  assert.equal(columnFor("ACCEPTED"), "accepted");
  assert.equal(columnFor("COMPLETED"), "completed");

  // A job nobody holds is nobody's, so it has no column on a table about
  // workers. It is read in the Created view instead (DR-R001 9.2).
  assert.equal(columnFor("CREATED"), null);
  assert.equal(isWaitingToBeGivenOut({ workflowState: "CREATED" }), true);

  assert.equal(columnFor("IN_PROGRESS"), null, "nothing exists between accepted and done");
  assert.equal(columnFor("REJECTED"), null, "a refusal is not a state");
});

test("a refused job is on nobody's row, and his refusal still counts", () => {
  // The heart of the change. Kaiser refused two; they went back to the pool
  // with nobody on them. He holds one. The office still sees he refused two.
  const rows = buildWorkerRows({
    trns: [
      job({ assignment: { targets: [{ type: "USER", id: "kaiser", name: "Kaiser Kaiser" }] } }),
      refused(),
      refused(),
    ],
    nowMs: NOW,
  });

  assert.equal(rows.length, 1, "the two in the pool are on nobody's row");

  const kaiser = rows[0];

  assert.equal(kaiser.total, 1, "he holds one");
  assert.equal(kaiser.issued, 1);
  assert.equal(kaiser.refused, 2, "and he refused two");
  assert.equal(kaiser.refusedJobs.length, 2);
  assert.equal(kaiser.refusedJobs[0].reason, "Dog on the property");
});

test("a worker who holds nothing but refused something still gets a row", () => {
  // Dropping him would hide the refusal with him.
  const rows = buildWorkerRows({ trns: [refused()], nowMs: NOW });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Kaiser Kaiser");
  assert.equal(rows[0].total, 0);
  assert.equal(rows[0].refused, 1);
});

test("the Total is the sum of the columns beside it", () => {
  const rows = buildWorkerRows({
    trns: [job(), job({ workflowState: "ACCEPTED" }), job({ workflowState: "COMPLETED" }), refused()],
    nowMs: NOW,
  });

  const peter = rows.find((r) => r.uid === "u1");

  assert.equal(peter.issued + peter.accepted + peter.completed, peter.total);
  assert.equal(peter.total, 3);
  assert.equal(peter.refused, 0, "the refusal was Kaiser's, not his");
});

test("a row per worker, with the directory name winning", () => {
  const rows = buildWorkerRows({
    trns: [job(), job({ workflowState: "ACCEPTED" })],
    usersById: { u1: { name: "Peter Mokoena", role: "FWR", serviceProviderName: "RSTE" } },
    nowMs: NOW,
  });

  assert.equal(rows[0].name, "Peter Mokoena");
  assert.equal(rows[0].provider, "RSTE");
  assert.equal(rows[0].transactions, "DCN 2");
});

test("work with no holder gets its own row, never dropped", () => {
  // Not the same as a job in Created: this one is Issued and nobody has it,
  // which is a fault the office has to be able to see.
  const rows = buildWorkerRows({
    trns: [job(), job({ assignment: { targets: [] } })],
    nowMs: NOW,
  });

  const orphan = rows.find((r) => r.unheld);

  assert.ok(orphan, "an issued job with nobody on it must still be visible");
  assert.equal(orphan.issued, 1);
  assert.equal(summariseWorkers(rows).issued, 2, "and it counts in the figures above");
});

test("the figures above the table are the sum of the rows beneath it", () => {
  const rows = buildWorkerRows({
    trns: [
      job(),
      job({ workflowState: "ACCEPTED" }),
      job({
        workflowState: "COMPLETED",
        assignment: { targets: [{ type: "USER", id: "u2", name: "B" }] },
      }),
      refused(),
    ],
    nowMs: NOW,
  });

  const totals = summariseWorkers(rows);
  const summed = rows.reduce(
    (acc, r) => ({
      issued: acc.issued + r.issued,
      accepted: acc.accepted + r.accepted,
      completed: acc.completed + r.completed,
      refused: acc.refused + r.refused,
    }),
    { issued: 0, accepted: 0, completed: 0, refused: 0 },
  );

  assert.deepEqual(
    {
      issued: totals.issued,
      accepted: totals.accepted,
      completed: totals.completed,
      refused: totals.refused,
    },
    summed,
  );
  assert.equal(totals.total, totals.issued + totals.accepted + totals.completed);
});

test("refusals are said in words beneath the table, never dropped", () => {
  const rows = buildWorkerRows({ trns: [job(), refused(), refused()], nowMs: NOW });

  assert.deepEqual(monitoringAside(rows), ["2 refusals in this ward"]);
  assert.deepEqual(monitoringAside(buildWorkerRows({ trns: [refused()], nowMs: NOW })), [
    "1 refusal in this ward",
  ]);
  assert.deepEqual(monitoringAside(buildWorkerRows({ trns: [job()], nowMs: NOW })), []);
});

test("a state with no column is named beneath the table", () => {
  const rows = buildWorkerRows({ trns: [job({ workflowState: "SOMETHING_NEW" })], nowMs: NOW });

  assert.equal(rows[0].total, 0);
  assert.deepEqual(monitoringAside(rows), ["not in any column: SOMETHING_NEW"]);
});

test("a record refused before the list existed is still counted", () => {
  // Records rejected before 11 October 2026 carry one reason and no list.
  const legacy = job({
    workflowState: "REJECTED",
    assignment: {
      targets: [],
      acceptedRejectedUid: "kaiser",
      acceptedRejectedUser: "Kaiser Kaiser",
      rejectReason: "Gate locked",
    },
  });

  assert.deepEqual(refusalsOn(legacy), [
    { uid: "kaiser", name: "Kaiser Kaiser", reason: "Gate locked" },
  ]);

  assert.equal(buildWorkerRows({ trns: [legacy], nowMs: NOW })[0].refused, 1);
});

test("a deleted job is in nothing at all", () => {
  // DR-R001 5.5: every reader excludes DELETED.
  assert.equal(selectItoWork([job({ workflowState: "DELETED" }), job()]).length, 1);
});

test("only office-issued individual work is watched", () => {
  const picked = selectItoWork([
    job(),
    job({ originChannel: "FIELD" }),
    job({ trnType: "METER_DISCOVERY" }),
  ]);

  assert.equal(picked.length, 1);
});

test("nothing ticked means everything, not nothing", () => {
  const work = [job(), job({ trnType: "METER_READING", workflowState: "COMPLETED" }), refused()];

  assert.equal(selectItoWork(work, { trnTypes: [], states: [] }).length, 3);
  assert.equal(selectItoWork(work, { trnTypes: ["METER_READING"] }).length, 1);
  assert.equal(selectItoWork(work, { states: ["COMPLETED"] }).length, 1);
  assert.equal(selectItoWork(work, { states: ["CREATED"] }).length, 1, "created can be asked for");
});

test("the oldest waiting job is the oldest still waiting", () => {
  const rows = buildWorkerRows({
    trns: [
      job({ issuedAt: ago(30) }),
      job({ issuedAt: ago(600), workflowState: "COMPLETED" }),
      job({ issuedAt: ago(90), workflowState: "ACCEPTED" }),
    ],
    nowMs: NOW,
  });

  assert.equal(rows[0].oldestWaiting, "1 h", "the completed one has stopped waiting");
});

test("a job issued before the stamp was written has no age, and says so", () => {
  const rows = buildWorkerRows({ trns: [job({ issuedAt: null })], nowMs: NOW });

  assert.equal(rows[0].oldestWaiting, "NAv");
  assert.equal(rows[0].oldestWaitingMs, null);
});

test("ages are said in plain words, and an unknown stays NAv", () => {
  assert.equal(describeAge(NOW - 30000, NOW), "just now");
  assert.equal(describeAge(NOW - 25 * 60000, NOW), "25 min");
  assert.equal(describeAge(NOW - 3 * 3600000, NOW), "3 h");
  assert.equal(describeAge(NOW - 50 * 3600000, NOW), "2 d");
  assert.equal(describeAge(null, NOW), "NAv");
  assert.equal(describeAge(NOW, null), "NAv");
});

test("when a worker was last heard from comes from the live feed, or never", () => {
  const rows = buildWorkerRows({
    trns: [job(), job({ assignment: { targets: [{ type: "USER", id: "u9", name: "Thandi K." }] } })],
    liveByUid: { u1: { capturedAtMs: NOW - 4 * 60000 } },
    nowMs: NOW,
  });

  assert.match(rows.find((r) => r.uid === "u1").lastHeard, /4/);
  assert.equal(rows.find((r) => r.uid === "u9").lastHeard, "never heard from");
});

test("the holder is found in all three shapes this screen is fed", () => {
  assert.deepEqual(holderOf(job()), { id: "u1", name: "Peter M." });
  assert.deepEqual(holderOf({ targetType: "USER", targetId: "u7", targetName: "Kaiser" }), {
    id: "u7",
    name: "Kaiser",
  });
  assert.equal(holderOf({ targetType: "USER", targetId: "NAv" }), null, "NAv is an absence");
  assert.equal(holderOf({ targetType: "TEAM", targetId: "t1" }), null);
});

test("the letters carry their counts, as the board draws them", () => {
  assert.equal(
    lettersFor(new Map([["METER_DISCONNECTION", 6], ["METER_RECONNECTION", 2]])),
    "DCN 6 · RCN 2",
  );
  assert.equal(lettersFor(new Map()), "NAv");
});

test("the ticks are said the way the office would say them", () => {
  assert.equal(describeTicks([]).showing, "Nothing ticked shows every transaction.");
  assert.equal(describeTicks(["METER_DISCONNECTION"]).showing, "Showing DCN.");
  assert.equal(
    describeTicks(["METER_DISCONNECTION", "METER_RECONNECTION"]).showing,
    "Showing DCN and RCN.",
  );
  assert.equal(describeTicks(["METER_RECONNECTION", "METER_REMOVAL"]).count, 2);
});

test("the Clear button is drawn only when there is something to clear", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(
    new URL("../src/pages/operations/ItoDashboardPage.jsx", import.meta.url),
    "utf8",
  );

  assert.match(page, /ticks\.count > 0 \? \(/);
  assert.match(page, /onClick=\{\(\) => setTrnTypes\(\[\]\)\}/);
  assert.doesNotMatch(page, /disabled=\{!ticks\.count\}/, "never a dead control");
});
