// Targeted Batch rules TB-R059 (1.3.62): work on a meter in an allocated batch belongs to that batch's team.
// Every branch of the pure decision, the exact sentence the worker is told, and the reader's wiring against a
// stand-in Firestore (no emulator here; batch-work-guard-emulator-test.js proves the six callables).
import test from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED, BATCH_CHECK_UNAVAILABLE, METER_IN_ANOTHER_TEAMS_BATCH, UNREADABLE, UNREADABLE_MESSAGE,
  allocationDateWords, assertBatchWorkAllowed, checkBatchWork, decideBatchWork, explicitlyUnallocated,
  readAstMeterNo, readBatchWorkFacts, refusalMessage, teamMemberIds,
} from "../targetedBatches/batch-work-guard.js";

const TB = "TGB_20260914_012600_YHXQ";
const METER = "07034605308";
const ALLOCATED_AT = { seconds: Math.trunc(Date.parse("2026-09-14T10:00:00.000Z") / 1000), nanoseconds: 0 };

const sales = (extra = {}) => ({ master: { id: METER, visibility: "INVISIBLE" }, meterNo: METER, meterNoNormalized: METER, targetedBatchId: TB, tbRefs: [{ id: TB, date: ALLOCATED_AT }], ...extra });
const parent = (allocation = {}) => ({ id: TB, geofenceId: "FENCE1", allocation: { status: "ALLOCATED", targetType: "TEAM", targetId: "TEAM1", targetName: "Lefu Metering", completedAt: ALLOCATED_AT, ...allocation } });
const facts = (extra = {}) => ({ meterNo: METER, sales: sales(), parent: parent(), row: { id: `${TB}__R001`, execution: { status: "NOT_STARTED" } }, geofenceName: "Gf W6 Acacia", finderUid: "FWR2", finderTeamId: "TEAM2", finderSpId: "SP2", ...extra });

test("a meter in no batch is free", () => {
  const decision = decideBatchWork(facts({ sales: sales({ targetedBatchId: null, tbRefs: [] }) }));
  assert.equal(decision.allowed, true);
  assert.equal(decision.code, ALLOWED.NO_BATCH);
});

test("a batch nobody has been given the work of is free", () => {
  // Plainly unallocated: no status, an empty one or NOT_STARTED, and no TEAM or SP named.
  for (const status of ["", "NOT_STARTED", "not_started"]) {
    const free = { status, targetId: "", targetName: "", targetType: "" };
    const decision = decideBatchWork(facts({ parent: parent(free) }));
    assert.equal(decision.allowed, true, JSON.stringify(free));
    assert.equal(decision.code, ALLOWED.NOT_ALLOCATED);
  }
  assert.equal(decideBatchWork(facts({ parent: { id: TB, geofenceId: "FENCE1" } })).code, ALLOWED.NOT_ALLOCATED, "a batch with no allocation at all");
});

// Rules 1.3.62: a batch being allocated, or whose allocation failed, already names a team, so it is not free.
test("a batch that already names a team is not free, whatever its allocation status says", () => {
  for (const status of ["ALLOCATING", "ALLOCATION_FAILED", "PARTIAL", "NOT_STARTED", ""]) {
    const decision = decideBatchWork(facts({ parent: parent({ status }) }));
    assert.equal(decision.allowed, false, `status ${status || "(none)"} still names TEAM1`);
    assert.equal(decision.code, METER_IN_ANOTHER_TEAMS_BATCH);
  }
  // The batch's own team is still let through on every one of them.
  for (const status of ["ALLOCATING", "ALLOCATION_FAILED", "ALLOCATED"]) {
    assert.equal(decideBatchWork(facts({ parent: parent({ status }), finderTeamId: "TEAM1" })).code, ALLOWED.OWN_TEAM);
  }
  // A named target nobody can be inside is refused, not waved through.
  assert.equal(decideBatchWork(facts({ parent: parent({ status: "ALLOCATING", targetType: "WARD" }) })).allowed, false);
  assert.deepEqual(
    [explicitlyUnallocated({ status: "NOT_STARTED", id: "" }), explicitlyUnallocated({ status: "", id: "" }), explicitlyUnallocated({ status: "ALLOCATING", id: "" }), explicitlyUnallocated({ status: "NOT_STARTED", id: "TEAM1" })],
    [true, true, false, false],
  );
});

test("a worker of the batch's own team may work, by the open membership period", () => {
  const decision = decideBatchWork(facts({ finderTeamId: "TEAM1" }));
  assert.equal(decision.allowed, true);
  assert.equal(decision.code, ALLOWED.OWN_TEAM);
  assert.equal(decision.details.matchedBy, "TEAM_HISTORY");
});

test("a worker the allocated team still lists may work, even with no membership period", () => {
  const decision = decideBatchWork(facts({ finderTeamId: "", allocatedTeam: { memberUids: ["FWR2"] } }));
  assert.equal(decision.allowed, true);
  assert.equal(decision.code, ALLOWED.OWN_TEAM);
  assert.equal(decision.details.matchedBy, "TEAM_MEMBER_LIST");
});

test("a worker under the batch's service provider may work", () => {
  const decision = decideBatchWork(facts({ parent: parent({ targetType: "SP", targetId: "SP2", targetName: "Lefu Metering" }) }));
  assert.equal(decision.allowed, true);
  assert.equal(decision.code, ALLOWED.OWN_SP);
});

test("another team is refused, in one plain sentence naming batch, geofence, team and date", () => {
  const decision = decideBatchWork(facts());
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, METER_IN_ANOTHER_TEAMS_BATCH);
  assert.equal(decision.message, "This meter is in batch TGB_20260914_012600_YHXQ, geofence Gf W6 Acacia, allocated to Lefu Metering on 14 September 2026. Only that team can work on it.");
  assert.deepEqual(
    { tbId: decision.details.tbId, targetId: decision.details.targetId, geofenceName: decision.details.geofenceName, workerTeamId: decision.details.workerTeamId, rule: decision.details.rule },
    { tbId: TB, targetId: "TEAM1", geofenceName: "Gf W6 Acacia", workerTeamId: "TEAM2", rule: "TB-R059" },
  );
});

test("another service provider is refused, and the sentence says service provider", () => {
  const decision = decideBatchWork(facts({ parent: parent({ targetType: "SP", targetId: "SP1", targetName: "Lefu Metering" }) }));
  assert.equal(decision.allowed, false);
  assert.equal(decision.message, "This meter is in batch TGB_20260914_012600_YHXQ, geofence Gf W6 Acacia, allocated to Lefu Metering on 14 September 2026. Only that service provider can work on it.");
});

test("a worker in no team and under no service provider is refused", () => {
  for (const extra of [{ finderTeamId: "", finderSpId: "" }, { finderTeamId: "", finderSpId: "", parent: parent({ targetType: "SP", targetId: "SP1" }) }]) {
    const decision = decideBatchWork(facts(extra));
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, METER_IN_ANOTHER_TEAMS_BATCH);
  }
});

test("a batch with no geofence says so", () => {
  const withoutFence = facts({ parent: { ...parent(), geofenceId: null }, geofenceName: "" });
  assert.equal(decideBatchWork(withoutFence).message, "This meter is in batch TGB_20260914_012600_YHXQ, no geofence, allocated to Lefu Metering on 14 September 2026. Only that team can work on it.");
});

test("a batch with no allocation date leaves the date out of the sentence", () => {
  const undated = facts({ parent: parent({ completedAt: null }) });
  assert.equal(decideBatchWork(undated).message, "This meter is in batch TGB_20260914_012600_YHXQ, geofence Gf W6 Acacia, allocated to Lefu Metering. Only that team can work on it.");
});

test("a Completed row releases the meter: the batch's work on it is done", () => {
  const decision = decideBatchWork(facts({ row: { id: `${TB}__R001`, execution: { status: "COMPLETED" } } }));
  assert.equal(decision.allowed, true);
  assert.equal(decision.code, ALLOWED.ROW_COMPLETED);
});

test("a VISIBLE Sales meter releases the meter", () => {
  const decision = decideBatchWork(facts({ sales: sales({ master: { id: METER, visibility: "VISIBLE" } }) }));
  assert.equal(decision.allowed, true);
  assert.equal(decision.code, ALLOWED.VISIBLE);
});

// Rules 1.3.62: iREPS never lets work through because a read failed.
test("a membership or a batch that cannot be read refuses the work, in the rule's own sentence", () => {
  const unresolved = decideBatchWork(facts({ sales: sales({ targetedBatchId: "NOT-A-BATCH" }) }));
  assert.equal(unresolved.allowed, false);
  assert.equal(unresolved.code, BATCH_CHECK_UNAVAILABLE);
  assert.equal(unresolved.message, "iREPS could not check which batch this meter is in. Nothing was saved. Please try again.");
  assert.equal(unresolved.details.reason, UNREADABLE.MEMBERSHIP);
  assert.equal(unresolved.details.rule, "TB-R059");

  const noParent = decideBatchWork(facts({ parent: null }));
  assert.equal(noParent.allowed, false);
  assert.equal(noParent.code, BATCH_CHECK_UNAVAILABLE);
  assert.equal(noParent.message, UNREADABLE_MESSAGE);
  assert.equal(noParent.details.reason, UNREADABLE.BATCH);
  assert.equal(noParent.details.tbId, TB);
  // The two refusals never share a code, so the phone can tell them apart.
  assert.notEqual(BATCH_CHECK_UNAVAILABLE, METER_IN_ANOTHER_TEAMS_BATCH);
});

test("nothing to check: no meter number, and no Sales record", () => {
  assert.equal(decideBatchWork(facts({ meterNo: "" })).code, ALLOWED.NO_METER);
  assert.equal(decideBatchWork(facts({ sales: null })).code, ALLOWED.NO_SALES);
  assert.equal(decideBatchWork().code, ALLOWED.NO_METER);
});

test("assertBatchWorkAllowed throws the refusal the phone can read", () => {
  assert.throws(() => assertBatchWorkAllowed(facts()), error => {
    assert.equal(error.irepsCode, METER_IN_ANOTHER_TEAMS_BATCH);
    assert.match(error.message, /^This meter is in batch TGB_20260914_012600_YHXQ, geofence Gf W6 Acacia/);
    assert.equal(error.details.tbId, TB);
    return true;
  });
  assert.equal(assertBatchWorkAllowed(facts({ finderTeamId: "TEAM1" })).allowed, true);
});

test("the allocation date is read from a Timestamp, an ISO string or millis, in the field's own day", () => {
  assert.equal(allocationDateWords(ALLOCATED_AT), "14 September 2026");
  assert.equal(allocationDateWords("2026-09-14T10:00:00.000Z"), "14 September 2026");
  assert.equal(allocationDateWords(Date.parse("2026-01-02T22:30:00.000Z")), "3 January 2026");
  assert.equal(allocationDateWords(null), "");
  assert.equal(allocationDateWords("not a date"), "");
});

test("a team's members are read from every list a team document uses", () => {
  assert.deepEqual([...teamMemberIds({ memberUids: ["A"], scope: { memberUserIds: ["B"] }, members: ["C", { uid: "D" }], users: [{ userId: "E" }] })], ["A", "B", "C", "D", "E"]);
  assert.equal(teamMemberIds(null).size, 0);
});

test("the refusal sentence is built from the facts it is given", () => {
  assert.equal(refusalMessage({ tbId: TB, geofenceName: "", targetType: "TEAM", targetName: "", allocatedAt: null }), `This meter is in batch ${TB}, no geofence, allocated to another team. Only that team can work on it.`);
});

// ---------------------------------------------------------------- the reader, against a stand-in Firestore
function fakeDb(documents, queries = {}) {
  const snapshot = (path) => ({ exists: Object.hasOwn(documents, path), data: () => documents[path] });
  const querySnapshot = (key) => ({ docs: (queries[key] || []).map(entry => ({ id: entry.id, data: () => entry })) });
  const query = (key) => ({ where: (field, _op, value) => query(`${key}|${field}=${value}`), limit: () => query(key), get: async () => querySnapshot(key) });
  return { collection: name => ({ doc: id => ({ get: async () => snapshot(`${name}/${id}`) }), where: (field, _op, value) => query(`${name}|${field}=${value}`) }) };
}

test("the reader gathers the Sales record, the batch, the row, the geofence name, the profile and the current team", async () => {
  const db = fakeDb({
    [`sales-all-meters/${METER}`]: sales(),
    [`tb_uploads/${TB}`]: parent(),
    "geo_fences/FENCE1": { name: "Gf W6 Acacia" },
    "users/FWR2": { employment: { role: "FWR", serviceProvider: { id: "SP2" } } },
    "teams/TEAM1": { memberUids: ["FWR1"] },
  }, {
    [`tb_rows|tbId=${TB}|salesAllMeterId=${METER}`]: [{ id: `${TB}__R001`, tbId: TB, salesAllMeterId: METER, execution: { status: "NOT_STARTED" } }],
    "team_member_history|userUid=FWR2": [{ id: "TEAM2__FWR2__1", teamId: "TEAM2", userUid: "FWR2", joinedAt: "2026-01-01T00:00:00.000Z", leftAt: null },
      { id: "TEAM3__FWR2__0", teamId: "TEAM3", userUid: "FWR2", joinedAt: "2025-01-01T00:00:00.000Z", leftAt: "2026-01-01T00:00:00.000Z" }],
  });
  const read = await readBatchWorkFacts({ db, meterNo: ` ${METER} `, uid: "FWR2" });
  assert.equal(read.tbId, TB);
  assert.equal(read.geofenceName, "Gf W6 Acacia");
  assert.equal(read.finderTeamId, "TEAM2");
  assert.equal(read.finderSpId, "SP2");
  assert.equal(read.row.id, `${TB}__R001`);
  assert.deepEqual([...teamMemberIds(read.allocatedTeam)], ["FWR1"]);
  const decision = decideBatchWork(read);
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, METER_IN_ANOTHER_TEAMS_BATCH);
});

test("the reader stops early when the meter is in no batch, and reads the AST's meter number", async () => {
  const db = fakeDb({ [`sales-all-meters/${METER}`]: sales({ targetedBatchId: null, tbRefs: [] }), "asts/TRN_MD_1": { master: { id: METER } } });
  const read = await readBatchWorkFacts({ db, meterNo: METER, uid: "FWR2" });
  assert.equal(read.tbId, "");
  assert.equal(read.parent, null);
  assert.equal(decideBatchWork(read).code, ALLOWED.NO_BATCH);
  assert.equal(await readAstMeterNo({ db, astId: "TRN_MD_1" }), METER);
  assert.equal(await readAstMeterNo({ db, astId: "" }), "");
});

test("a read that fails refuses the work and is logged as an error", async () => {
  const logs = [];
  const log = { warn: (message, data) => logs.push({ level: "warn", message, data }), error: (message, data) => logs.push({ level: "error", message, data }) };
  const db = { collection: () => ({ doc: () => ({ get: async () => { throw new Error("Firestore unavailable"); } }) }) };
  const decision = await checkBatchWork({ db, meterNo: METER, uid: "FWR2", log });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, BATCH_CHECK_UNAVAILABLE);
  assert.equal(decision.message, UNREADABLE_MESSAGE);
  assert.equal(decision.details.reason, UNREADABLE.FACTS);
  assert.equal(decision.details.detail, "Firestore unavailable");
  assert.deepEqual(logs.map(entry => entry.level), ["error"]);
  assert.match(logs[0].message, /TB-R059/);
});

// A read that fails inside a transaction is a mistake worth seeing (a read after a write), so it is thrown
// on: the transaction is abandoned, nothing is written, and the cause travels with the refusal.
test("inside a transaction a failed read is thrown on, never swallowed", async () => {
  const logs = [];
  const boom = new Error("Firestore transactions require all reads to be executed before all writes");
  const db = { collection: () => ({ doc: () => ({}) }) };
  await assert.rejects(
    () => checkBatchWork({ db, read: async () => { throw boom; }, meterNo: METER, uid: "FWR2", log: { error: (message, data) => logs.push({ message, data }) } }),
    error => {
      assert.equal(error.irepsCode, BATCH_CHECK_UNAVAILABLE);
      assert.equal(error.message, UNREADABLE_MESSAGE);
      assert.equal(error.cause, boom);
      assert.equal(error.details.detail, boom.message);
      return true;
    },
  );
  assert.equal(logs.length, 1);
});

test("a refusal read end to end is logged once", async () => {
  const logs = [];
  const db = fakeDb({
    [`sales-all-meters/${METER}`]: sales(), [`tb_uploads/${TB}`]: parent(), "geo_fences/FENCE1": { name: "Gf W6 Acacia" },
    "users/FWR2": { employment: { role: "FWR", serviceProvider: { id: "SP2" } } }, "teams/TEAM1": { memberUids: ["FWR1"] },
  }, { "team_member_history|userUid=FWR2": [{ id: "TEAM2__FWR2__1", teamId: "TEAM2", userUid: "FWR2", joinedAt: "2026-01-01T00:00:00.000Z", leftAt: null }] });
  const decision = await checkBatchWork({ db, meterNo: METER, uid: "FWR2", log: { warn: (message, data) => logs.push({ message, data }) } });
  assert.equal(decision.allowed, false);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].data.tbId, TB);
});
