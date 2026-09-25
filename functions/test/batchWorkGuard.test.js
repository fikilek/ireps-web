// Targeted Batch rules TB-R059 (1.3.62): work on a meter in an allocated batch belongs to that batch's team.
// Every branch of the pure decision, the exact sentence the worker is told, and the reader's wiring against a
// stand-in Firestore (no emulator here; batch-work-guard-emulator-test.js proves the six callables).
import test from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED, BATCH_CHECK_UNAVAILABLE, METER_IN_ANOTHER_TEAMS_BATCH, UNREADABLE, UNREADABLE_MESSAGE,
  allocationDateWords, anomalyReport, assertBatchWorkAllowed, checkBatchWork, decideBatchWork,
  decideErfBatchWork, explicitlyUnallocated, illegalConnectionWords, isIllegallyConnected, readAstMeterNo,
  readBatchWorkFacts, readWorkErfId, recordErfOverride, refusalMessage, teamMemberIds,
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

// ================================================================ TB-R062 (1.3.65): the ERF's own team
// The owner proved TB-R059 could be walked past with a typo: a meter ending 4817 captured at ERF 3490 while
// the batch's own 4816 stayed Not Started. The lock is on the ERF, with one gate for an illegally connected
// meter, whose every use is recorded for the office.
const ERF = "ERF3490";
const OTHER_METER = "07034605317";
const erfRow = (extra = {}) => ({
  row: { id: `${TB}__R001`, tbId: TB, salesAllMeterId: METER, refs: { erfId: ERF }, execution: { status: "NOT_STARTED" } },
  parent: parent(), geofenceName: "Gf W6 Acacia", allocatedTeam: { memberUids: ["FWR1"] }, visibility: "",
  ...extra,
});
// The hole: a different meter number, at the batch's own ERF, by a worker of another team.
const atErf = (extra = {}) => facts({
  meterNo: OTHER_METER, sales: null, parent: null, row: null, tbId: "",
  erfId: ERF, erfRows: [erfRow()], ...extra,
});

test("a DIFFERENT meter number at a batched ERF is refused, and the sentence names the ERF", () => {
  const decision = decideBatchWork(atErf());
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, METER_IN_ANOTHER_TEAMS_BATCH);
  assert.equal(decision.message, "This ERF is in batch TGB_20260914_012600_YHXQ, geofence Gf W6 Acacia, allocated to Lefu Metering on 14 September 2026. Only that team can work on it.");
  assert.deepEqual(
    { rule: decision.details.rule, matchedOn: decision.details.matchedOn, erfId: decision.details.erfId, tbId: decision.details.tbId, rowMeterNo: decision.details.rowMeterNo, meterNo: decision.details.meterNo },
    { rule: "TB-R062", matchedOn: "ERF", erfId: ERF, tbId: TB, rowMeterNo: METER, meterNo: OTHER_METER },
  );
  // A No Access or an installation with no meter number at all is meter work on that ERF just the same.
  assert.equal(decideBatchWork(atErf({ meterNo: "" })).code, METER_IN_ANOTHER_TEAMS_BATCH);
});

test("the batch's own team may work anywhere on their ERF, by the team or by the service provider", () => {
  assert.equal(decideBatchWork(atErf({ finderTeamId: "TEAM1" })).allowed, true);
  assert.equal(decideBatchWork(atErf({ finderTeamId: "", finderUid: "FWR1" })).allowed, true, "the team's own member list");
  const underSp = atErf({ erfRows: [erfRow({ parent: parent({ targetType: "SP", targetId: "SP2", targetName: "Lefu Metering" }) })] });
  assert.equal(decideBatchWork(underSp).allowed, true, "the worker is under the batch's service provider");
});

test("the ERF is free when the batch's rows on it are done, or nobody has been given the work", () => {
  const completed = erfRow({ row: { ...erfRow().row, execution: { status: "COMPLETED" } } });
  assert.equal(decideBatchWork(atErf({ erfRows: [completed] })).allowed, true, "a Completed row frees the ERF");
  // A VISIBLE Sales meter IS completed (the owner's settled definition), so its batch holds no work on it.
  assert.equal(decideBatchWork(atErf({ erfRows: [erfRow({ visibility: "VISIBLE" })] })).allowed, true);
  const free = erfRow({ parent: parent({ status: "NOT_STARTED", targetId: "", targetType: "", targetName: "" }) });
  assert.equal(decideBatchWork(atErf({ erfRows: [free] })).allowed, true, "an unallocated batch never held the ERF");
  // Rules TB-R060 deletes the row, so a meter taken out of a batch stops matching by itself.
  assert.equal(decideBatchWork(atErf({ erfRows: [] })).allowed, true);
  assert.equal(decideBatchWork(atErf({ erfRows: null, erfId: "" })).allowed, true, "no ERF was worked out");
});

test("the batch's own meter is left to TB-R059, never decided twice by the ERF", () => {
  // The same meter, at the same ERF: the ERF test passes its row over, and TB-R059's answer stands.
  const own = facts({ erfId: ERF, erfRows: [erfRow()] });
  assert.equal(decideBatchWork(own).details.rule, "TB-R059", "TB-R059 refuses it, naming the meter");
  assert.equal(decideBatchWork({ ...own, finderTeamId: "TEAM1" }).code, ALLOWED.OWN_TEAM);
  // A row for a meter with a different spelling is still the same meter.
  const spelled = erfRow({ row: { ...erfRow().row, salesAllMeterId: ` ${METER.toLowerCase()} ` } });
  assert.equal(decideBatchWork(facts({ erfId: ERF, erfRows: [spelled], finderTeamId: "TEAM1" })).allowed, true);
});

test("a batch on the ERF that cannot be read refuses the work, and is never gated", () => {
  const unreadable = atErf({ erfRows: [erfRow({ parent: null })] });
  assert.equal(decideBatchWork(unreadable).code, BATCH_CHECK_UNAVAILABLE);
  assert.equal(decideBatchWork(unreadable).message, UNREADABLE_MESSAGE);
  assert.equal(decideBatchWork(unreadable).details.reason, UNREADABLE.ERF_BATCH);
  assert.equal(decideBatchWork({ ...unreadable, anomaly: { ast: { anomalies: { anomaly: "Illegally Connected" } } } }).code, BATCH_CHECK_UNAVAILABLE, "the gate never opens on a read that failed");
  // More rows on one ERF than iREPS read: it has not seen the whole ERF, so it refuses.
  const truncated = atErf({ erfUnreadable: UNREADABLE.ERF_ROWS });
  assert.equal(decideBatchWork(truncated).code, BATCH_CHECK_UNAVAILABLE);
  assert.equal(decideBatchWork(truncated).details.reason, UNREADABLE.ERF_ROWS);
});

// ---------------------------------------------------------------- the one gate: illegally connected
test("the phone's own words for an illegal connection are matched, and nothing else is", () => {
  for (const report of [
    { ast: { anomalies: { anomaly: "Illegally Connected", anomalyDetail: "Bridge Wire On The Meter" } } },
    { ast: { anomalies: { anomaly: "illegally connected" } } },
    { ast: { anomalies: { anomaly: " ILLEGALLY-CONNECTED " } } },
    { ast: { normalisation: { actionTaken: ["none", "Illegal connection - meter disconnected"] } } },
    { ast: { normalisation: { actionTaken: ["Illegal Connection - Meter Reconnected"] } } },
    { inspection: { captured: { ast: { anomalies: { anomaly: "Illegally Connected" } } } } },
    [{ ast: { anomalies: { anomaly: "Meter Ok" } } }, { anomalies: { anomaly: "Illegally Connected" } }],
  ]) assert.equal(isIllegallyConnected(report), true, JSON.stringify(report));

  for (const report of [
    {}, null, { ast: { anomalies: { anomaly: "Meter Ok", anomalyDetail: "Bypass Suspicion" } } },
    { ast: { anomalies: { anomaly: "Meter Damaged" }, normalisation: { actionTaken: ["Tamper Removed", "none"] } } },
    { ast: { anomalies: { anomaly: "Illegal" } } },
    { ast: { anomalies: { anomaly: "Meter Ok", otherAnomalies: ["Meter Bridged (By Munic)"] } } },
  ]) assert.equal(isIllegallyConnected(report), false, JSON.stringify(report));

  assert.equal(illegalConnectionWords({ ast: { anomalies: { anomaly: "Illegally Connected" }, normalisation: { actionTaken: ["Illegal connection - meter disconnected", "none"] } } }),
    "Illegally Connected; Illegal connection - meter disconnected");
  assert.deepEqual(anomalyReport({ ast: { anomalies: { anomaly: "Meter Ok", anomalyDetail: "Operationally Ok", otherAnomalies: ["Keypad Faulty"] }, normalisation: { actionTaken: ["none"] } } }),
    { anomalies: ["Meter Ok", "Operationally Ok", "Keypad Faulty"], actions: ["none"] });
});

test("an illegally connected meter goes through on another team's ERF, and the use is recorded", () => {
  const anomaly = { ast: { anomalies: { anomaly: "Illegally Connected", anomalyDetail: "Bridge Wire On The Meter" }, normalisation: { actionTaken: ["Illegal connection - meter disconnected"] } } };
  const decision = decideBatchWork(atErf({ anomaly, finderName: "Mfundo Masondo", finderTeamName: "Kaiser Team" }));
  assert.equal(decision.allowed, true);
  assert.equal(decision.code, ALLOWED.ILLEGAL_CONNECTION);
  assert.equal(decision.details.anomalyText, "Illegally Connected; Illegal connection - meter disconnected");
  // The refusal it walked past travels with it, so the office sees what the ERF belonged to.
  assert.equal(decision.details.refusedBy.tbId, TB);

  // Counting per worker AND per team must be possible from the record alone (the owner, 2026-09-20).
  assert.deepEqual(decision.override.worker, { uid: "FWR2", name: "Mfundo Masondo", teamId: "TEAM2", teamName: "Kaiser Team", serviceProviderId: "SP2" });
  assert.deepEqual(
    { erfId: decision.override.erfId, meterNo: decision.override.meterNo, rule: decision.override.rule },
    { erfId: ERF, meterNo: OTHER_METER, rule: "TB-R062" },
  );
  assert.deepEqual(
    { tbId: decision.override.batch.tbId, geofenceId: decision.override.batch.geofenceId, geofenceName: decision.override.batch.geofenceName, targetId: decision.override.batch.targetId, targetName: decision.override.batch.targetName, allocatedOn: decision.override.batch.allocatedOn },
    { tbId: TB, geofenceId: "FENCE1", geofenceName: "Gf W6 Acacia", targetId: "TEAM1", targetName: "Lefu Metering", allocatedOn: "14 September 2026" },
  );
  assert.equal(decision.override.anomaly.text, "Illegally Connected; Illegal connection - meter disconnected");
});

test("the gate never applies to the batch's own meter number: that stays TB-R059's test", () => {
  const anomaly = { ast: { anomalies: { anomaly: "Illegally Connected" } } };
  const own = decideBatchWork(facts({ anomaly, erfId: ERF, erfRows: [erfRow()] }));
  assert.equal(own.allowed, false, "the batch's own meter is still the batch's team's work");
  assert.equal(own.code, METER_IN_ANOTHER_TEAMS_BATCH);
  assert.equal(own.details.rule, "TB-R059");
  // And an ERF nobody else holds is an ordinary find: the answer stays the meter's own, and there is
  // nothing to record, because the gate was never needed.
  const ordinary = decideBatchWork(atErf({ anomaly, erfRows: [] }));
  assert.equal(ordinary.allowed, true);
  assert.equal(ordinary.code, ALLOWED.NO_SALES);
  assert.equal(ordinary.override, undefined, "nothing to record when the gate was not needed");
  // The ERF test on its own says why it let the work past.
  assert.equal(decideErfBatchWork(atErf({ erfRows: [] })).code, ALLOWED.ERF_FREE);
});

// ---------------------------------------------------------------- the reader and the record
test("the ERF is taken from the form, and from the premise when the form carries none", async () => {
  const db = fakeDb({ "premises/PREM_1": { id: "PREM_1", erfId: ERF }, "premises/PREM_NONE": { id: "PREM_NONE", erfId: "NAv" } });
  assert.equal(await readWorkErfId({ db, erfId: ERF }), ERF);
  assert.equal(await readWorkErfId({ db, erfId: "NAv", premiseId: "PREM_1" }), ERF);
  assert.equal(await readWorkErfId({ db, premiseId: "PREM_1" }), ERF);
  assert.equal(await readWorkErfId({ db, premiseId: "PREM_NONE" }), "");
  assert.equal(await readWorkErfId({ db, premiseId: "PREM_MISSING" }), "");
  assert.equal(await readWorkErfId({ db }), "");
});

test("the reader gathers every batch row on the ERF, each with its batch, and refuses a different meter", async () => {
  const db = fakeDb({
    [`sales-all-meters/${METER}`]: sales(), [`tb_uploads/${TB}`]: parent(), "geo_fences/FENCE1": { name: "Gf W6 Acacia" },
    "users/FWR2": { profile: { displayName: "Mfundo Masondo" }, employment: { role: "FWR", serviceProvider: { id: "SP2" } } },
    "teams/TEAM1": { memberUids: ["FWR1"] }, "premises/PREM_1": { id: "PREM_1", erfId: ERF },
  }, {
    [`tb_rows|refs.erfId=${ERF}`]: [{ id: `${TB}__R001`, tbId: TB, salesAllMeterId: METER, refs: { erfId: ERF }, execution: { status: "NOT_STARTED" } }],
    "team_member_history|userUid=FWR2": [{ id: "TEAM2__FWR2__1", teamId: "TEAM2", teamName: "Kaiser Team", userUid: "FWR2", joinedAt: "2026-01-01T00:00:00.000Z", leftAt: null }],
  });
  const read = await readBatchWorkFacts({ db, meterNo: OTHER_METER, uid: "FWR2", premiseId: "PREM_1" });
  assert.equal(read.erfId, ERF);
  assert.equal(read.erfRows.length, 1);
  assert.equal(read.erfRows[0].parent.id, TB);
  assert.equal(read.erfRows[0].geofenceName, "Gf W6 Acacia");
  assert.equal(read.erfRows[0].visibility, "INVISIBLE", "the row's own Sales meter is read only when its row would stand in the way");
  assert.deepEqual([read.finderName, read.finderTeamId, read.finderTeamName, read.finderSpId], ["Mfundo Masondo", "TEAM2", "Kaiser Team", "SP2"]);
  assert.equal(decideBatchWork(read).code, METER_IN_ANOTHER_TEAMS_BATCH);
  assert.equal(decideBatchWork(read).details.rule, "TB-R062");

  // The same submission, reported as illegally connected, goes through and carries the record.
  const gated = await readBatchWorkFacts({ db, meterNo: OTHER_METER, uid: "FWR2", premiseId: "PREM_1", anomaly: { ast: { anomalies: { anomaly: "Illegally Connected" } } } });
  const decision = decideBatchWork(gated);
  assert.equal(decision.code, ALLOWED.ILLEGAL_CONNECTION);
  assert.equal(decision.override.worker.teamId, "TEAM2");
});

test("one document per use is written to batch_erf_overrides, under the TRN id", async () => {
  const written = [];
  const db = { collection: name => ({ doc: id => ({ path: `${name}/${id}` }) }) };
  const write = (ref, value) => { written.push({ path: ref.path, value }); };
  const decision = decideBatchWork(atErf({ anomaly: { ast: { anomalies: { anomaly: "Illegally Connected" } } }, finderName: "Mfundo Masondo", finderTeamName: "Kaiser Team" }));
  const logs = [];
  const record = await recordErfOverride({ db, write, decision, trnId: "TRN_MDIS_1", trnType: "METER_DISCOVERY", now: "2026-09-20T10:00:00.000Z", log: { warn: (message, data) => logs.push({ message, data }) } });
  assert.equal(written.length, 1);
  assert.equal(written[0].path, "batch_erf_overrides/TRN_MDIS_1");
  assert.equal(record.id, "TRN_MDIS_1");
  assert.equal(record.trnType, "METER_DISCOVERY");
  assert.equal(record.recordedAt, "2026-09-20T10:00:00.000Z");
  assert.equal(record.worker.uid, "FWR2");
  assert.equal(record.worker.teamId, "TEAM2");
  assert.equal(logs.length, 1);
  assert.match(logs[0].message, /TB-R062/);

  // Work the gate did not let through is never recorded.
  assert.equal(await recordErfOverride({ db, write, decision: decideBatchWork(atErf()), trnId: "TRN_MDIS_2" }), null);
  assert.equal(await recordErfOverride({ db, write, decision, trnId: "" }), null);
  assert.equal(written.length, 1);
});

test("the gate is logged at warning level, and the ERF refusal says which rule refused it", async () => {
  const rows = { [`tb_rows|refs.erfId=${ERF}`]: [{ id: `${TB}__R001`, tbId: TB, salesAllMeterId: METER, refs: { erfId: ERF }, execution: { status: "NOT_STARTED" } }],
    "team_member_history|userUid=FWR2": [{ id: "TEAM2__FWR2__1", teamId: "TEAM2", teamName: "Kaiser Team", userUid: "FWR2", joinedAt: "2026-01-01T00:00:00.000Z", leftAt: null }] };
  const documents = { [`sales-all-meters/${METER}`]: sales(), [`tb_uploads/${TB}`]: parent(), "geo_fences/FENCE1": { name: "Gf W6 Acacia" },
    "users/FWR2": { employment: { role: "FWR", serviceProvider: { id: "SP2" } } }, "teams/TEAM1": { memberUids: ["FWR1"] } };
  const logs = [];
  const log = { warn: (message, data) => logs.push({ message, data }) };
  const refused = await checkBatchWork({ db: fakeDb(documents, rows), meterNo: OTHER_METER, uid: "FWR2", erfId: ERF, log });
  assert.equal(refused.code, METER_IN_ANOTHER_TEAMS_BATCH);
  assert.match(logs[0].message, /TB-R062: work refused, the ERF belongs to another team's batch/);

  const gated = await checkBatchWork({ db: fakeDb(documents, rows), meterNo: OTHER_METER, uid: "FWR2", erfId: ERF, anomaly: { ast: { anomalies: { anomaly: "Illegally Connected" } } }, log });
  assert.equal(gated.code, ALLOWED.ILLEGAL_CONNECTION);
  assert.match(logs[1].message, /TB-R062: an illegally connected meter was allowed on another team's ERF/);
});
