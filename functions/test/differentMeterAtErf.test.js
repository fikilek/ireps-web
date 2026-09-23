// Targeted Batch rules TB-R063 (1.3.66): a different meter at the ERF completes the Sales meter.
// The owner's case, on 2026-09-20: a worker captured meter 04298620077 at ERF 3496 while the Sales meter
// expected there, 04297704464, stayed Not Started for ever and would be batched again. The meter on the
// Sales list has been replaced, so it must read Completed.
//
// Every branch of the pure decision, the exact writes it produces, and the reader's wiring against a
// stand-in Firestore that also takes the writes, so a repeat is proved to write nothing.
// The six real callables are proved end to end in different-meter-at-erf-emulator-test.js.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DECISIONS, FIELD, OUTCOME_LABEL, ROW_ACTIONS, ROW_OUTCOME, RULE,
  buildDifferentMeterAtErfWrites, buildDifferentMeterFoundRecord, decideDifferentMeterAtErf,
  findSalesMetersAtErf, readFinder, recordDifferentMeterAtErf, salesErfId, settleDifferentMeterForSales,
} from "../targetedBatches/differentMeterAtErf.js";
import {
  classifySalesWorkStatus, evaluateSalesBatchability, inspectDifferentMeterFound,
} from "../salesAllMeters/sales-batch-policy.js";

const TB = "TGB_20260914_012600_YHXQ";
// The owner's own numbers.
const EXPECTED = "04297704464";
const FOUND = "04298620077";
const ERF = "ERF_3496";
const ROW_ID = `${TB}__R001`;
const CREATED_MS = Date.parse("2026-09-01T06:00:00.000Z");
const FIND_MS = Date.parse("2026-09-20T09:30:00.000Z");

const ts = ms => ({ seconds: Math.trunc(ms / 1000), nanoseconds: (ms % 1000) * 1e6, toMillis: () => ms });
const Timestamp = { fromMillis: ts, now: () => ts(FIND_MS) };
const FieldValue = { serverTimestamp: () => "SERVER_TIME" };

const metadata = () => ({ createdAt: ts(CREATED_MS), createdByUid: "LOADER", createdByUser: "Sales load", updatedAt: ts(CREATED_MS), updatedByUid: "LOADER", updatedByUser: "Sales load" });
const sales = (extra = {}) => ({
  master: { id: EXPECTED, visibility: "INVISIBLE" }, meterNo: EXPECTED, meterNoNormalized: EXPECTED,
  lmPcode: "ZA5241", erfId: ERF, targetedBatchId: TB, tbRefs: [{ id: TB, date: ts(CREATED_MS) }],
  metadata: metadata(), ...extra,
});
const parent = (extra = {}) => ({
  id: TB, geofenceId: "FENCE1", schemaVersion: "0.3.0", status: "IN_PROGRESS",
  creation: { state: "READY" }, acceptance: { status: "ACCEPTED" },
  allocation: { status: "ALLOCATED", targetType: "TEAM", targetId: "TEAM1", targetName: "Lefu Metering", completedAt: ts(CREATED_MS) },
  execution: { status: "IN_PROGRESS", startedAt: ts(CREATED_MS), completedAt: null },
  counts: { totalRows: 1, acceptedRows: 1, rejectedRows: 0, allocatableRows: 1, allocatedRows: 1, unallocatedRows: 0, executionStartedRows: 0, completedRows: 0 },
  metadata: { createdAt: ts(CREATED_MS) },
  ...extra,
});
const row = (extra = {}) => ({
  id: ROW_ID, tbId: TB, rowNo: 1, salesAllMeterId: EXPECTED, schemaVersion: "0.3.0",
  meter: { numberNormalized: EXPECTED, numberRaw: EXPECTED },
  decision: { status: "ACCEPT" }, allocation: { status: "ALLOCATED", allocatable: true },
  execution: { status: "NOT_STARTED", startedAt: null, completedAt: null, outcome: null },
  refs: { erfId: ERF, premiseId: "PREM_1", meterId: null, trnId: null }, ...extra,
});
const find = (extra = {}) => ({ meterNo: FOUND, erfId: ERF, premiseId: "PREM_1", trnId: "TRN_MDIS_1", trnType: "METER_DISCOVERY", astId: "TRN_MDIS_1", findAtMs: FIND_MS, ...extra });
// A worker of the batch's own team. TB-R062's outsider is a worker of another one.
const finder = (extra = {}) => ({ uid: "FWR1", user: "Worker One", role: "FWR", teamId: "TEAM1", teamName: "Team One", serviceProviderId: "SP1", serviceProviderName: "Test SP", ...extra });
const outsider = () => finder({ uid: "FWR2", user: "Worker Two", teamId: "TEAM2", teamName: "Team Two" });
// A GPS Sales meter: no saved ERF decision, one pipeline ERF, listed by ERF number in `erfNumbers`.
const GPS_METER = "04290000001";
const gpsSales = (extra = {}) => ({
  master: { id: GPS_METER, visibility: "INVISIBLE" }, meterNo: GPS_METER, meterNoNormalized: GPS_METER,
  lmPcode: "ZA5241", hasUsableGps: true, erfNumbers: ["3496"],
  erfCandidates: [{ ErfId: ERF, Latitude: -28.5, Longitude: 30.5 }],
  targetedBatchId: null, tbRefs: [], metadata: metadata(), ...extra,
});
const facts = (extra = {}) => ({ salesId: EXPECTED, find: find(), finder: finder(), sales: sales(), parent: parent(), rows: [row()], allocatedTeam: { memberUids: ["FWR1"] }, historyExists: false, trnAlreadyLinked: false, ...extra });

// ---------------------------------------------------------------- the decision
test("a different meter at the ERF closes the Sales meter's row as Completed", () => {
  const plan = decideDifferentMeterAtErf(facts());
  assert.equal(plan.decision, DECISIONS.RECORD);
  assert.equal(plan.code, "ROW_CLOSED");
  assert.equal(plan.rowAction, ROW_ACTIONS.CLOSE);
  assert.equal(plan.tbId, TB);
  assert.equal(plan.rowId, ROW_ID);
  // The numbers side by side, the O: / F: the Batch Report shows.
  assert.deepEqual([plan.targetedMeterNo, plan.discoveredMeterNo, plan.meterMatch], [EXPECTED, FOUND, false]);
  assert.equal(plan.creditedToBatch, true, "the batch's own team found it");
  assert.equal(plan.after.counts.completedRows, 1);
  assert.equal(plan.after.status, "COMPLETED");
});

test("the same meter number changes nothing: the meter on the Sales list is the one that was found", () => {
  const same = decideDifferentMeterAtErf(facts({ find: find({ meterNo: EXPECTED }) }));
  assert.deepEqual([same.decision, same.code], [DECISIONS.NONE, "SAME_METER"]);
  // However it is spelled on the form.
  assert.equal(decideDifferentMeterAtErf(facts({ find: find({ meterNo: ` ${EXPECTED} ` }) })).code, "SAME_METER");
  assert.equal(decideDifferentMeterAtErf(facts({ find: find({ meterNo: "" }) })).code, "NO_METER_NUMBER");
});

test("a Sales meter that is already VISIBLE, or whose row is Completed, needs no row change", () => {
  const visible = decideDifferentMeterAtErf(facts({ sales: sales({ master: { id: EXPECTED, visibility: "VISIBLE" } }) }));
  assert.deepEqual([visible.decision, visible.code], [DECISIONS.NONE, "ALREADY_VISIBLE"]);
  const done = decideDifferentMeterAtErf(facts({ rows: [row({ execution: { status: "COMPLETED", startedAt: ts(CREATED_MS), completedAt: ts(FIND_MS), outcome: "METER_DISCOVERED" } })] }));
  assert.deepEqual([done.decision, done.code, done.rowAction], [DECISIONS.RECORD, "ROW_ALREADY_COMPLETED", ROW_ACTIONS.ALREADY_COMPLETED]);
});

test("a Sales meter in no batch is treated the same way: the record alone completes it", () => {
  const plan = decideDifferentMeterAtErf(facts({ sales: sales({ targetedBatchId: null, tbRefs: [] }), parent: null, rows: [] }));
  assert.deepEqual([plan.decision, plan.code, plan.rowAction], [DECISIONS.RECORD, "NO_BATCH", ROW_ACTIONS.NO_BATCH]);
  assert.equal(plan.creditedToBatch, false);
});

test("credit follows the finder: an outsider closes the row but is not credited to the batch", () => {
  const own = decideDifferentMeterAtErf(facts());
  const other = decideDifferentMeterAtErf(facts({ finder: outsider(), allocatedTeam: { memberUids: ["FWR1"] } }));
  assert.deepEqual([own.rowAction, own.creditedToBatch], [ROW_ACTIONS.CLOSE, true]);
  assert.deepEqual([other.rowAction, other.creditedToBatch], [ROW_ACTIONS.CLOSE, false], "the row still closes, the credit does not follow");
  // The batch's own service provider counts too, and so does the team's own member list.
  const bySp = decideDifferentMeterAtErf(facts({ finder: outsider(), parent: parent({ allocation: { status: "ALLOCATED", targetType: "SP", targetId: "SP1", targetName: "Test SP", completedAt: ts(CREATED_MS) } }) }));
  assert.equal(bySp.creditedToBatch, true);
  const byList = decideDifferentMeterAtErf(facts({ finder: outsider({ teamId: null, teamName: null }), allocatedTeam: { memberUids: ["FWR2"] } }));
  assert.equal(byList.creditedToBatch, true);
});

test("a batch nobody has been given the work of, or one not yet accepted, holds the row and still records the find", () => {
  for (const [name, change, credited] of [
    ["not allocated", { allocation: { status: "NOT_STARTED" } }, false],
    ["not accepted", { acceptance: { status: "PENDING" } }, true],
    ["not ready", { creation: { state: "DRAFT" } }, true],
  ]) {
    const plan = decideDifferentMeterAtErf(facts({ parent: parent(change) }));
    assert.equal(plan.decision, DECISIONS.RECORD, name);
    assert.equal(plan.rowAction, ROW_ACTIONS.HOLD, name);
    // Nobody has been given an unallocated batch's work, so there is no team to credit.
    assert.equal(plan.creditedToBatch, credited, name);
  }
  assert.equal(decideDifferentMeterAtErf(facts({ historyExists: true })).holdReason, "HISTORY_EXISTS");
  assert.equal(decideDifferentMeterAtErf(facts({ parent: null })).holdReason, "PARENT_MISSING");
});

test("a repeat finds its own record and changes nothing", () => {
  const record = buildDifferentMeterFoundRecord({ find: find(), finder: finder(), tbId: TB, rowId: ROW_ID, creditedToBatch: true, foundAt: ts(FIND_MS) });
  const plan = decideDifferentMeterAtErf(facts({ sales: sales({ [FIELD]: record }) }));
  assert.deepEqual([plan.decision, plan.code, plan.recordedTrnId], [DECISIONS.NONE, "ALREADY_RECORDED", "TRN_MDIS_1"]);
  // A malformed record never quietly completes a meter: it is an integrity case for the office.
  const broken = decideDifferentMeterAtErf(facts({ sales: sales({ [FIELD]: { ...record, finder: { uid: "FWR1" } } }) }));
  assert.deepEqual([broken.decision, broken.code], [DECISIONS.LOG, "RECORD_INVALID"]);
});

test("the finder and the find time must be known before anything is written", () => {
  assert.equal(decideDifferentMeterAtErf(facts({ finder: null })).code, "FINDER_UNKNOWN");
  assert.equal(decideDifferentMeterAtErf(facts({ finder: finder({ role: "" }) })).code, "FINDER_UNKNOWN");
  assert.equal(decideDifferentMeterAtErf(facts({ find: find({ findAtMs: NaN }) })).code, "FIND_TIME_UNKNOWN");
  assert.equal(decideDifferentMeterAtErf(facts({ find: find({ erfId: "" }) })).code, "FIND_INCOMPLETE");
  assert.equal(decideDifferentMeterAtErf(facts({ sales: null })).code, "NO_SALES_RECORD");
});

// ---------------------------------------------------------------- the work status everywhere
test("a Sales record carrying the record reads Completed, and can never be batched again", () => {
  const record = buildDifferentMeterFoundRecord({ find: find(), finder: finder(), tbId: TB, rowId: ROW_ID, creditedToBatch: true, foundAt: ts(FIND_MS) });
  assert.equal(classifySalesWorkStatus(sales()), "NOT_STARTED");
  assert.equal(classifySalesWorkStatus(sales({ [FIELD]: record })), "COMPLETED");
  // Without becoming VISIBLE: the meter master is untouched, because that number genuinely is not there.
  assert.equal(sales({ [FIELD]: record }).master.visibility, "INVISIBLE");
  // A malformed record is an integrity defect, never a silent completion nor a silent re-batching.
  const broken = sales({ [FIELD]: { version: 1 }, targetedBatchId: null, tbRefs: [] });
  assert.equal(classifySalesWorkStatus(broken), "NOT_STARTED");
  assert.equal(inspectDifferentMeterFound(broken).valid, false);
  assert.equal(evaluateSalesBatchability(broken, { salesId: EXPECTED, lmPcode: "ZA5241" }).code, "DIFFERENT_METER_FOUND_INVALID");
  const completed = sales({ [FIELD]: record, targetedBatchId: null, tbRefs: [] });
  assert.equal(evaluateSalesBatchability(completed, { salesId: EXPECTED, lmPcode: "ZA5241" }).code, "SALES_STATUS_COMPLETED");
});

test("the record holds the meter found, the ERF, the finder, their team and service provider, and when", () => {
  const record = buildDifferentMeterFoundRecord({ find: find(), finder: finder(), tbId: TB, rowId: ROW_ID, creditedToBatch: true, foundAt: ts(FIND_MS) });
  assert.deepEqual(Object.keys(record).sort(), ["astId", "creditedToBatch", "erfId", "finder", "foundAt", "meterNo", "rowId", "rule", "rulesVersion", "tbId", "trnId", "trnType", "version"]);
  assert.deepEqual(
    [record.meterNo, record.erfId, record.trnId, record.trnType, record.astId, record.tbId, record.rowId, record.rule],
    [FOUND, ERF, "TRN_MDIS_1", "METER_DISCOVERY", "TRN_MDIS_1", TB, ROW_ID, RULE],
  );
  assert.deepEqual(record.finder, { uid: "FWR1", user: "Worker One", role: "FWR", teamId: "TEAM1", teamName: "Team One", serviceProviderId: "SP1", serviceProviderName: "Test SP" });
  assert.equal(record.foundAt.toMillis(), FIND_MS);
  assert.equal(inspectDifferentMeterFound({ differentMeterFound: record }).found, true);
});

// ---------------------------------------------------------------- the writes
const writesOf = (plan, extra = {}) => buildDifferentMeterAtErfWrites(plan, facts(extra), { ts, now: ts(FIND_MS), serverTime: "SERVER_TIME" });
const at = (writes, path) => writes.find(write => write.path === path);

test("closing the row writes the O: / F: numbers, the mark, the recount and the history", () => {
  const plan = decideDifferentMeterAtErf(facts());
  const writes = writesOf(plan);
  const rowWrite = at(writes, `tb_rows/${ROW_ID}`);
  assert.equal(rowWrite.data["execution.status"], "COMPLETED");
  assert.equal(rowWrite.data["execution.outcome"], ROW_OUTCOME, "marked: a different meter was found here");
  // TB-R064 (1.3.67): the row records the number found, so TB Register and its CSV can show it.
  assert.equal(rowWrite.data["execution.foundMeterNo"], FOUND, "the number found is on the row");
  assert.equal(rowWrite.data["execution.completedAt"].toMillis(), FIND_MS);
  assert.deepEqual([rowWrite.data["refs.meterId"], rowWrite.data["refs.trnId"]], ["TRN_MDIS_1", "TRN_MDIS_1"]);

  const salesWrite = at(writes, `sales-all-meters/${EXPECTED}`);
  const fieldWork = salesWrite.data.tbRefs[0].fieldWork;
  assert.equal(fieldWork.status, "COMPLETED");
  assert.equal(fieldWork.outcomeLabel, OUTCOME_LABEL);
  assert.deepEqual([fieldWork.targetedMeterNo, fieldWork.discoveredMeterNo, fieldWork.meterMatch], [EXPECTED, FOUND, false]);
  assert.equal(salesWrite.data[FIELD].meterNo, FOUND);
  assert.equal(salesWrite.data.master, undefined, "the Sales meter never becomes VISIBLE");

  const parentWrite = at(writes, `tb_uploads/${TB}`);
  assert.equal(parentWrite.data["counts.completedRows"], 1);
  assert.equal(parentWrite.data.status, "COMPLETED");

  const history = at(writes, `tb_uploads/${TB}/history/ROW_CLOSED__${ROW_ID}`);
  assert.equal(history.op, "create", "a deterministic id, so a repeat cannot write it twice");
  assert.equal(history.data.rule, RULE);
  assert.equal(history.data.meterMatch, false);
  assert.match(history.data.note, /A different meter \(04298620077\) was found at ERF ERF_3496/);
  assert.match(history.data.note, /Sales meter 04297704464 was expected/);
  // Nothing is written to meter_master, and no Sales batchHistory event: closing a row writes none.
  assert.deepEqual(writes.filter(write => /^meter_master|batchHistory/.test(write.path)), []);
});

test("credit is linked to the batch only when the finder is in its team", () => {
  const own = writesOf(decideDifferentMeterAtErf(facts()));
  const mark = at(own, "trns/TRN_MDIS_1");
  assert.equal(mark.data["derived.targetedBatch"].tbId, TB);
  assert.equal(mark.data["derived.targetedBatch"].meterMatch, false);
  assert.equal(mark.data["derived.targetedBatch"].salesDocId, EXPECTED);

  const other = writesOf(decideDifferentMeterAtErf(facts({ finder: outsider() })), { finder: outsider() });
  assert.equal(at(other, "trns/TRN_MDIS_1"), undefined, "the find stays the worker's own transaction");
  assert.equal(at(other, `tb_rows/${ROW_ID}`).data["execution.status"], "COMPLETED", "the row still closes");
  assert.equal(at(other, `sales-all-meters/${EXPECTED}`).data[FIELD].creditedToBatch, false);

  // One find is credited once: a TRN already linked to a batch keeps that link.
  const linked = writesOf(decideDifferentMeterAtErf(facts()), { trnAlreadyLinked: true });
  assert.equal(at(linked, "trns/TRN_MDIS_1"), undefined);
});

test("a held row, and a meter in no batch, write only the Sales record", () => {
  for (const extra of [{ parent: parent({ acceptance: { status: "PENDING" } }) }, { sales: sales({ targetedBatchId: null, tbRefs: [] }), parent: null, rows: [] }]) {
    const writes = writesOf(decideDifferentMeterAtErf(facts(extra)), extra);
    assert.deepEqual(writes.map(write => write.path), [`sales-all-meters/${EXPECTED}`]);
    assert.equal(writes[0].data[FIELD].meterNo, FOUND);
    assert.equal(writes[0].data.tbRefs, undefined, "a held row never completes its tbRef");
  }
});

// ---------------------------------------------------------------- the reader and the transaction
const setPath = (target, path, value) => {
  const parts = path.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) node = node[part] ??= {};
  node[parts.at(-1)] = value;
};

// A deep copy that leaves the stand-in Timestamps alone (structuredClone refuses their toMillis).
const copy = value => (Array.isArray(value) ? value.map(copy)
  : value && typeof value === "object" && typeof value.toMillis !== "function"
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]))
    : value);

function fakeDb({ docs = {}, queries = {} } = {}) {
  const store = new Map(Object.entries(docs).map(([path, data]) => [path, copy(data)]));
  const reads = [], writes = [];
  const rows = key => (queries[key] || []).map(item => ({ id: item.id, data: () => item }));
  const query = key => ({ where: (field, _op, value) => query(`${key}|${field}=${value}`), limit: () => query(key), get: async () => ({ size: rows(key).length, docs: rows(key) }) });
  const doc = path => ({ path, id: path.split("/").pop(), get: async () => { reads.push(path); return { exists: store.has(path), id: path.split("/").pop(), data: () => store.get(path) }; } });
  return {
    doc,
    collection: name => ({ doc: id => doc(`${name}/${id}`), where: (field, _op, value) => query(`${name}|${field}=${value}`) }),
    runTransaction: async run => run({
      get: refOrQuery => refOrQuery.get(),
      update: (ref, data) => {
        writes.push({ op: "update", path: ref.path, data });
        const next = copy(store.get(ref.path) || {});
        for (const [key, value] of Object.entries(data)) setPath(next, key, value);
        store.set(ref.path, next);
      },
      create: (ref, data) => {
        if (store.has(ref.path)) throw new Error(`already exists: ${ref.path}`);
        writes.push({ op: "create", path: ref.path, data });
        store.set(ref.path, copy(data));
      },
    }),
    store, reads, writes,
  };
}

const world = () => fakeDb({
  docs: {
    [`sales-all-meters/${EXPECTED}`]: sales(),
    [`sales-all-meters/${GPS_METER}`]: gpsSales(),
    [`tb_uploads/${TB}`]: parent(),
    "teams/TEAM1": { memberUids: ["FWR1"] },
    "trns/TRN_MDIS_1": { id: "TRN_MDIS_1" },
    [`ireps_erfs/${ERF}`]: { sg: { erfNo: "3496" }, admin: { localMunicipality: { pcode: "ZA5241" } } },
    "users/FWR1": { profile: { displayName: "Worker One", employment: { role: "FWR", serviceProvider: { id: "SP1", name: "Test SP" } } }, employment: { role: "FWR", serviceProvider: { id: "SP1", name: "Test SP" } } },
  },
  queries: {
    [`tb_rows|tbId=${TB}`]: [row()],
    [`tb_rows|refs.erfId=${ERF}`]: [row()],
    [`sales-all-meters|erfId=${ERF}`]: [{ id: EXPECTED, ...sales() }],
    // A GPS Sales meter names its ERF by number; it is matched back on the ERF ID, because ERF numbers
    // repeat across towns. The second one is at ERF 3496's number in another town and must not match.
    "sales-all-meters|lmPcode=ZA5241|erfNumbers=3496": [
      { id: GPS_METER, ...gpsSales() },
      { id: "09999999999", ...gpsSales({ erfCandidates: [{ ErfId: "ERF_OTHER_TOWN", Latitude: -28.5, Longitude: 30.5 }] }) },
    ],
    "team_member_history|userUid=FWR1": [{ id: "TEAM1__FWR1__1", teamId: "TEAM1", teamName: "Team One", userUid: "FWR1", joinedAt: "2026-01-01T00:00:00.000Z", leftAt: null }],
  },
});

test("the Sales meters expected at an ERF are found by their own ERF, by ERF number and by the batch rows", async () => {
  const db = world();
  const found = await findSalesMetersAtErf({ db, erfId: ERF });
  assert.deepEqual(found.salesIds, [GPS_METER, EXPECTED].sort());
  assert.equal(found.truncated, false);
  assert.deepEqual((await findSalesMetersAtErf({ db, erfId: "" })).salesIds, []);
  // The resolver's own choice of ERF, so an ERF number that repeats across towns never matches by accident.
  assert.equal(salesErfId(gpsSales()), ERF);
  assert.equal(salesErfId({ erfId: "OTHER" }), null, "an erfId without its provenance is not an established ERF");
});

test("the worker and the team they were in at the find time are read from their profile and history", async () => {
  const read = await readFinder({ db: world(), uid: "FWR1", atMs: FIND_MS });
  assert.deepEqual(read, { uid: "FWR1", user: "Worker One", role: "FWR", teamId: "TEAM1", teamName: "Team One", serviceProviderId: "SP1", serviceProviderName: "Test SP" });
  assert.equal(await readFinder({ db: world(), uid: "" }), null);
});

test("one transaction settles one Sales meter, and running it again writes nothing", async () => {
  const db = world();
  const first = await settleDifferentMeterForSales({ db, salesId: EXPECTED, find: find(), finder: finder(), Timestamp, FieldValue });
  assert.equal(first.decision, DECISIONS.RECORD);
  assert.equal(first.rowAction, ROW_ACTIONS.CLOSE);
  assert.equal(db.store.get(`sales-all-meters/${EXPECTED}`)[FIELD].meterNo, FOUND);
  assert.equal(classifySalesWorkStatus(db.store.get(`sales-all-meters/${EXPECTED}`)), "COMPLETED");
  assert.equal(db.store.get(`sales-all-meters/${EXPECTED}`).master.visibility, "INVISIBLE");
  assert.equal(db.store.has(`tb_uploads/${TB}/history/ROW_CLOSED__${ROW_ID}`), true);
  const wrote = db.writes.length;

  const again = await settleDifferentMeterForSales({ db, salesId: EXPECTED, find: find({ trnId: "TRN_MDIS_2" }), finder: finder(), Timestamp, FieldValue });
  assert.deepEqual([again.decision, again.code], [DECISIONS.NONE, "ALREADY_RECORDED"]);
  assert.equal(db.writes.length, wrote, "a repeat writes nothing");
});

test("the whole capture settles every expected meter at the ERF and never fails the submission", async () => {
  const db = world();
  const logs = [];
  const log = { info: (message, data) => logs.push({ message, data }), warn: (message, data) => logs.push({ message, data }), error: (message, data) => logs.push({ level: "error", message, data }) };
  const results = await recordDifferentMeterAtErf({
    db, Timestamp, FieldValue, meterNo: FOUND, erfId: ERF, premiseId: "PREM_1",
    trnId: "TRN_MDIS_1", trnType: "METER_DISCOVERY", astId: "TRN_MDIS_1", uid: "FWR1",
    foundAt: new Date(FIND_MS).toISOString(), log,
  });
  // Every Sales meter expected at that ERF is settled: the batched one closes its row, and the one in no
  // batch is completed by the record alone.
  assert.deepEqual(results.map(result => [result.salesId, result.code]), [[GPS_METER, "NO_BATCH"], [EXPECTED, "ROW_CLOSED"]]);
  assert.equal(db.store.get(`tb_rows/${ROW_ID}`).execution.outcome, ROW_OUTCOME);
  assert.equal(db.store.get(`tb_rows/${ROW_ID}`).execution.foundMeterNo, FOUND);
  assert.equal(classifySalesWorkStatus(db.store.get(`sales-all-meters/${GPS_METER}`)), "COMPLETED");

  // The meter just captured is never treated as expected at its own ERF.
  const own = await recordDifferentMeterAtErf({ db, Timestamp, FieldValue, meterNo: EXPECTED, erfId: ERF, trnId: "TRN_MDIS_3", uid: "FWR1", log });
  assert.equal(own.some(result => result.salesId === EXPECTED), false);

  // A read that fails is logged for the office, never thrown at the worker whose work is already saved.
  const broken = { doc: () => ({ get: async () => { throw new Error("Firestore unavailable"); } }), collection: () => ({ doc: () => ({ get: async () => { throw new Error("Firestore unavailable"); } }) }) };
  assert.deepEqual(await recordDifferentMeterAtErf({ db: broken, Timestamp, FieldValue, meterNo: FOUND, erfId: ERF, trnId: "TRN_MDIS_4", uid: "FWR1", log }), []);
  assert.equal(logs.at(-1).level, "error");
  assert.match(logs.at(-1).message, /TB-R063/);
});

// TB-R063 1.3.72 (owner, 23 Sep 2026): a capture made from a batch row belongs to
// that row alone. One meter captured at ERF 689 had closed all thirteen rows of
// his batch, because thirteen Sales meters share that ERF.
test("a capture from a batch row settles that row's Sales meter and no other", async () => {
  const db = world();
  const context = { tbId: TB, rowId: "TBR_1", salesDocId: EXPECTED, meterNo: EXPECTED };

  // the worker captured a different number on that row
  const results = await recordDifferentMeterAtErf({
    db, Timestamp, FieldValue, meterNo: FOUND, erfId: ERF, premiseId: "PRM_1",
    trnId: "TRN_MDIS_1", trnType: "METER_DISCOVERY", astId: "TRN_MDIS_1", uid: "FWR1",
    foundAt: new Date(FIND_MS).toISOString(), targetedBatchContext: context,
  });

  assert.deepEqual(results.map(result => result.salesId), [EXPECTED],
    "only the row's own Sales meter is settled");
  assert.equal(db.store.get(`sales-all-meters/${GPS_METER}`).differentMeterFound, undefined,
    "another Sales meter on the same ERF is untouched");
});

test("a capture from a batch row of the very number it was sent for settles nothing", async () => {
  const db = world();

  const results = await recordDifferentMeterAtErf({
    db, Timestamp, FieldValue, meterNo: EXPECTED, erfId: ERF, premiseId: "PRM_1",
    trnId: "TRN_MDIS_1", trnType: "METER_DISCOVERY", astId: "TRN_MDIS_1", uid: "FWR1",
    foundAt: new Date(FIND_MS).toISOString(),
    targetedBatchContext: { tbId: TB, rowId: "TBR_1", salesDocId: EXPECTED, meterNo: EXPECTED },
  });

  assert.deepEqual(results, [], "nothing to settle: the meter is the one expected");
  assert.equal(db.store.get(`sales-all-meters/${GPS_METER}`).differentMeterFound, undefined);
  assert.equal(db.store.get(`sales-all-meters/${EXPECTED}`).differentMeterFound, undefined);
});
