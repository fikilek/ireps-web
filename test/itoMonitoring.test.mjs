// The ITO monitoring screen, per worker. `DR-R001` 9.1.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ITO_STATES,
  buildWorkerRows,
  columnFor,
  describeAge,
  describeTicks,
  holderOf,
  lettersFor,
  selectItoWork,
  monitoringAside,
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

test("the four columns are the request's own words, and Progress is not among them", () => {
  // DR-R001 5: there is nothing between accepted and done on this path.
  assert.deepEqual(ITO_STATES.map((s) => s.key), ["ISSUED", "ACCEPTED", "REJECTED", "COMPLETED"]);

  assert.equal(columnFor("ISSUED"), "issued");
  assert.equal(columnFor("REASSIGNED"), "issued", "a reassign is waiting to be accepted");
  assert.equal(columnFor("ACCEPTED"), "accepted");
  // Nothing exists between accepted and submitted here, so IN_PROGRESS has
  // no column and is not folded into one. It would be a fault, and faults
  // surface.
  assert.equal(columnFor("IN_PROGRESS"), null);
  assert.equal(columnFor("REJECTED"), "rejected");
  assert.equal(columnFor("COMPLETED"), "completed");
  assert.equal(columnFor("CANCELLED"), null);
  assert.equal(columnFor(""), null);
});

test("only office-issued individual work is watched", () => {
  // DR-R001 9: field work arrives finished, so there is nothing to watch.
  const picked = selectItoWork([
    job(),
    job({ originChannel: "FIELD" }),
    job({ trnType: "METER_DISCOVERY" }),
  ]);

  assert.equal(picked.length, 1);
});

test("nothing ticked means everything, not nothing", () => {
  const work = [job(), job({ trnType: "METER_READING", workflowState: "COMPLETED" })];

  assert.equal(selectItoWork(work, { trnTypes: [], states: [] }).length, 2);
  assert.equal(selectItoWork(work, { trnTypes: ["METER_READING"] }).length, 1);
  assert.equal(selectItoWork(work, { states: ["COMPLETED"] }).length, 1);
  assert.equal(selectItoWork(work, { states: ["ISSUED"] }).length, 1);
});

test("a row per worker, spread across the four columns", () => {
  const rows = buildWorkerRows({
    trns: [
      job(),
      job({ workflowState: "ACCEPTED" }),
      job({ workflowState: "REJECTED" }),
      job({
        workflowState: "COMPLETED",
        trnType: "METER_READING",
        assignment: { targets: [{ type: "USER", id: "u2", name: "Mpho N." }] },
      }),
    ],
    usersById: { u1: { name: "Peter Mokoena", role: "FWR" } },
    nowMs: NOW,
  });

  const peter = rows.find((r) => r.uid === "u1");

  assert.equal(peter.name, "Peter Mokoena", "the directory name wins over the stamped one");
  assert.equal(peter.role, "FWR");
  assert.equal(peter.issued, 1);
  assert.equal(peter.accepted, 1);
  assert.equal(peter.rejected, 1);
  assert.equal(peter.completed, 0);
  assert.equal(peter.total, 3);
  assert.equal(peter.transactions, "DCN 3");

  const mpho = rows.find((r) => r.uid === "u2");

  assert.equal(mpho.name, "Mpho N.", "a worker with no directory entry keeps his stamped name");
  assert.equal(mpho.completed, 1);
  assert.equal(mpho.transactions, "MREAD 1");
});

test("work with no holder gets its own row, never dropped", () => {
  // The same reason the per-area view gives "not in a geofence" a row: drop
  // it and the rows stop adding up to the total above them.
  const rows = buildWorkerRows({
    trns: [job(), job({ assignment: { targets: [] } })],
    nowMs: NOW,
  });

  const unheld = rows.find((r) => r.unheld);

  assert.ok(unheld, "a job with nobody holding it must still be visible");
  assert.equal(unheld.name, "Not with a worker");
  assert.equal(unheld.issued, 1);
  assert.equal(unheld.lastHeard, "NAv");

  assert.equal(
    summariseWorkers(rows).issued,
    2,
    "and it counts in the figures above the table",
  );
});

test("the oldest waiting job is the oldest still waiting, not the oldest job", () => {
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
  // UI-R008: an unknown is NAv. The record's creation time is not a
  // substitute, and 0 would read as "nothing is waiting".
  const rows = buildWorkerRows({ trns: [job({ issuedAt: null })], nowMs: NOW });

  assert.equal(rows[0].oldestWaiting, "NAv");
  assert.equal(rows[0].oldestWaitingMs, null);
  assert.equal(summariseWorkers(rows).oldestWaitingMs, null);
});

test("ages are said in plain words, and an unknown stays NAv", () => {
  assert.equal(describeAge(NOW - 30000, NOW), "just now");
  assert.equal(describeAge(NOW - 25 * 60000, NOW), "25 min");
  assert.equal(describeAge(NOW - 3 * 3600000, NOW), "3 h");
  assert.equal(describeAge(NOW - 50 * 3600000, NOW), "2 d");
  assert.equal(describeAge(null, NOW), "NAv");
  assert.equal(describeAge(NOW, null), "NAv");
});

test("when a worker was last heard from comes from the live feed, or NAv", () => {
  const rows = buildWorkerRows({
    trns: [job(), job({ assignment: { targets: [{ type: "USER", id: "u9", name: "Thandi K." }] } })],
    liveByUid: { u1: { capturedAtMs: NOW - 4 * 60000 } },
    nowMs: NOW,
  });

  assert.match(rows.find((r) => r.uid === "u1").lastHeard, /4/);
  // The shared helper says it in words - "never heard from" - rather than
  // NAv, and the ITO page already uses those words. One vocabulary.
  assert.equal(
    rows.find((r) => r.uid === "u9").lastHeard,
    "never heard from",
    "a worker never heard from is not 'just now'",
  );
});

test("the holder is the user the job sits with", () => {
  assert.deepEqual(holderOf(job()), { id: "u1", name: "Peter M." });
  assert.equal(holderOf({ assignment: { targets: [{ type: "TEAM", id: "t1" }] } }), null);
  assert.deepEqual(holderOf({ assignedTo: { uid: "u5", name: "Sipho" } }), { id: "u5", name: "Sipho" });
});

test("the letters carry their counts, as the board draws them", () => {
  // "DCN 6 · RCN 2" - the office reads what he is carrying, not merely which
  // kinds. Most-carried first.
  assert.equal(
    lettersFor(new Map([["METER_DISCONNECTION", 6], ["METER_RECONNECTION", 2]])),
    "DCN 6 · RCN 2",
  );
  assert.equal(lettersFor({ METER_DISCONNECTION: 7 }), "DCN 7");
  assert.equal(lettersFor(new Map()), "NAv");
  assert.equal(lettersFor(null), "NAv");
});

test("a rejected count carries its jobs, so it can be opened with the reasons", () => {
  // DR-R001 9.1: "A rejected count opens those jobs with the reason on each."
  const rows = buildWorkerRows({
    trns: [
      job({ workflowState: "REJECTED", trnId: "TRN_A", astNo: "042042", rejectReason: "Dog on the property" }),
      job({ workflowState: "REJECTED", trnId: "TRN_B", astNo: "042043" }),
      job(),
    ],
    nowMs: NOW,
  });

  const peter = rows[0];

  assert.equal(peter.rejected, 2);
  assert.equal(peter.rejectedJobs.length, 2);
  assert.deepEqual(peter.rejectedJobs[0], {
    trnId: "TRN_A",
    meterNo: "042042",
    erfNo: "NAv",
    letter: "DCN",
    reason: "Dog on the property",
  });
  assert.equal(peter.rejectedJobs[1].reason, "NAv", "a rejection with no reason recorded says NAv");
});

test("the figures above the table are the sum of the rows beneath it", () => {
  const rows = buildWorkerRows({
    trns: [
      job(),
      job({ workflowState: "ACCEPTED" }),
      job({ workflowState: "REJECTED", assignment: { targets: [{ type: "USER", id: "u2", name: "B" }] } }),
      job({ workflowState: "COMPLETED", assignment: { targets: [{ type: "USER", id: "u2", name: "B" }] } }),
    ],
    nowMs: NOW,
  });

  const totals = summariseWorkers(rows);
  const summed = rows.reduce(
    (acc, r) => ({
      issued: acc.issued + r.issued,
      accepted: acc.accepted + r.accepted,
      rejected: acc.rejected + r.rejected,
      completed: acc.completed + r.completed,
    }),
    { issued: 0, accepted: 0, rejected: 0, completed: 0 },
  );

  assert.deepEqual(
    { issued: totals.issued, accepted: totals.accepted, rejected: totals.rejected, completed: totals.completed },
    summed,
  );
  assert.equal(totals.workers, 2);
});

test("the worker with the most still waiting comes first", () => {
  const rows = buildWorkerRows({
    trns: [
      job({ assignment: { targets: [{ type: "USER", id: "quiet", name: "Quiet" }] }, workflowState: "COMPLETED" }),
      job({ assignment: { targets: [{ type: "USER", id: "busy", name: "Busy" }] } }),
      job({ assignment: { targets: [{ type: "USER", id: "busy", name: "Busy" }] }, workflowState: "ACCEPTED" }),
    ],
    nowMs: NOW,
  });

  assert.equal(rows[0].uid, "busy");
});

test("the holder is found in all three shapes this screen is fed", () => {
  // The first build read only assignment.targets, so every job in Ward 6
  // landed under "Not with a worker". normalizeTrnDoc flattens the first
  // target instead, and valueOrNav writes the literal string "NAv" where a
  // value is missing - which is an absence, not an id.
  assert.deepEqual(
    holderOf({ targetType: "USER", targetId: "u7", targetName: "Kaiser Kaiser" }),
    { id: "u7", name: "Kaiser Kaiser" },
  );

  assert.deepEqual(
    holderOf({ target: { type: "USER", id: "u8", name: "Peter M." } }),
    { id: "u8", name: "Peter M." },
  );

  assert.equal(
    holderOf({ targetType: "USER", targetId: "NAv", targetName: "NAv" }),
    null,
    "NAv is an absence, never an id",
  );

  assert.equal(holderOf({ targetType: "TEAM", targetId: "t1" }), null, "a team is not a worker");
});

test("the ward stream's normaliser carries the flattened target this reads", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/redux/trnsApi.js", import.meta.url), "utf8");
  const normaliser = source.slice(source.indexOf("function normalizeTrnDoc"));

  assert.match(normaliser.slice(0, 3000), /targetId: target\.id/);
  assert.match(normaliser.slice(0, 3000), /targetType: target\.type/);
});

test("the Total column is the sum of the four states beside it", () => {
  // Owner, 11 October 2026: the total is what the worker was allocated, and
  // the four states say how it is split. A row that does not add up is the
  // fault found on his phone this morning.
  const rows = buildWorkerRows({
    trns: [
      job(),
      job({ workflowState: "ACCEPTED" }),
      job({ workflowState: "REJECTED" }),
      job({ workflowState: "COMPLETED" }),
    ],
    nowMs: NOW,
  });

  const row = rows[0];

  assert.equal(row.total, 4);
  assert.equal(row.issued + row.accepted + row.rejected + row.completed, row.total);
});

test("a cancelled job is not in his total, and is said in words", () => {
  // The office withdrew it, so it is no longer his work - the same ruling as
  // UI-R005 7 made for his phone. Counted apart, never dropped.
  const rows = buildWorkerRows({
    trns: [job(), job({ workflowState: "CANCELLED" }), job({ workflowState: "CANCELLED" })],
    nowMs: NOW,
  });

  assert.equal(rows[0].total, 1, "the cancelled pair is not his work");
  assert.equal(rows[0].issued + rows[0].accepted + rows[0].rejected + rows[0].completed, 1);
  assert.deepEqual(monitoringAside(rows), ["2 cancelled, not counted in any total"]);
});

test("a state with no column is named beneath the table, never dropped", () => {
  const rows = buildWorkerRows({ trns: [job({ workflowState: "SOMETHING_NEW" })], nowMs: NOW });

  assert.equal(rows[0].total, 0);
  assert.deepEqual(monitoringAside(rows), ["not in any column: SOMETHING_NEW"]);
});

test("nothing to say when every job has a column", () => {
  assert.deepEqual(monitoringAside(buildWorkerRows({ trns: [job()], nowMs: NOW })), []);
});

test("the ticks are said the way the office would say them", () => {
  assert.deepEqual(describeTicks([]), {
    count: 0,
    words: "",
    showing: "Nothing ticked shows every transaction.",
  });

  assert.equal(describeTicks(["METER_DISCONNECTION"]).showing, "Showing DCN.");
  assert.equal(
    describeTicks(["METER_DISCONNECTION", "METER_RECONNECTION"]).showing,
    "Showing DCN and RCN.",
  );
  assert.equal(
    describeTicks(["METER_DISCONNECTION", "METER_RECONNECTION", "METER_INSPECTION"]).showing,
    "Showing DCN, RCN and INSP.",
  );
  assert.equal(describeTicks(["METER_RECONNECTION", "METER_REMOVAL"]).count, 2);
});

test("the Clear button is drawn only when there is something to clear", async () => {
  // Owner, 11 October 2026, choosing it over an always-present greyed one:
  // a control that does nothing most of the time is the same fault as a chip
  // that can only ever read 0.
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(
    new URL("../src/pages/operations/ItoDashboardPage.jsx", import.meta.url),
    "utf8",
  );

  assert.match(page, /ticks\.count > 0 \? \(/, "drawn only when ticks are on");
  assert.match(page, /onClick=\{\(\) => setTrnTypes\(\[\]\)\}/, "and it clears them all");
  assert.match(page, /Clear \{ticks\.count\} ×/, "saying how many");
  assert.doesNotMatch(page, /disabled=\{!ticks\.count\}/, "never a dead control");
});
