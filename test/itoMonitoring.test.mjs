// The ITO monitoring screen, per worker. `DR-R001` 9.1.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ITO_STATES,
  buildWorkerRows,
  columnFor,
  describeAge,
  holderOf,
  lettersFor,
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
  assert.equal(peter.transactions, "DCN");

  const mpho = rows.find((r) => r.uid === "u2");

  assert.equal(mpho.name, "Mpho N.", "a worker with no directory entry keeps his stamped name");
  assert.equal(mpho.completed, 1);
  assert.equal(mpho.transactions, "MREAD");
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

test("the letters say which transaction, and nothing held says NAv", () => {
  assert.equal(lettersFor(["METER_DISCONNECTION", "METER_READING"]), "DCN MREAD");
  assert.equal(lettersFor(["METER_DISCONNECTION", "METER_DISCONNECTION"]), "DCN");
  assert.equal(lettersFor([]), "NAv");
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
