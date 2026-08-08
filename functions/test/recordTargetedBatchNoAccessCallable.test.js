import assert from "node:assert/strict";
import test from "node:test";
import {Timestamp} from "firebase-admin/firestore";

import {recordTargetedBatchNoAccess} from
  "../targetedBatches/recordTargetedBatchNoAccessCallable.js";

const TB = "TB_1";
const ROW = "ROW_1";
const SALES = "SALE_1";
const ERF = "ERF_1";
const TRN = "TRN_MDIS_20260804_001";
const NOW = Timestamp.fromDate(new Date("2026-08-04T12:30:00.000Z"));
const LATER = Timestamp.fromDate(new Date("2026-08-04T12:45:00.000Z"));

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function assertTimestampEqual(actual, expected) {
  assert.equal(actual?._seconds, expected.seconds);
  assert.equal(actual?._nanoseconds, expected.nanoseconds);
}

function setPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  parts.slice(0, -1).forEach((part) => {
    cursor[part] ||= {};
    cursor = cursor[part];
  });
  cursor[parts.at(-1)] = value;
}

class FakeRef {
  constructor(path) {
    this.path = path;
    this.id = path.split("/").at(-1);
  }
}

class FakeDb {
  constructor(documents) {
    this.documents = new Map(Object.entries(documents).map(([k, v]) => [k, clone(v)]));
    this.writes = [];
  }
  collection(name) {
    return {doc: (id) => new FakeRef(`${name}/${id}`)};
  }
  doc(path) {
    const ref = new FakeRef(path);
    return {get: async () => this.snapshot(ref)};
  }
  snapshot(ref) {
    const value = clone(this.documents.get(ref.path));
    return {exists: value !== undefined, id: ref.id, data: () => value};
  }
  read(path) {
    return clone(this.documents.get(path));
  }
  async runTransaction(callback) {
    const pending = [];
    const tx = {
      get: async (ref) => this.snapshot(ref),
      create: (ref, value) => pending.push({type: "create", ref, value: clone(value)}),
      update: (ref, value) => pending.push({type: "update", ref, value: clone(value)}),
    };
    const result = await callback(tx);
    pending.forEach((write) => {
      if (write.type === "create") this.documents.set(write.ref.path, write.value);
      else {
        const value = this.read(write.ref.path);
        Object.entries(write.value).forEach(([path, item]) => setPath(value, path, item));
        this.documents.set(write.ref.path, value);
      }
    });
    this.writes.push(...pending);
    return result;
  }
}

function fixture({targetType = "TEAM", premiseId = null, rowStatus = "NOT_STARTED"} = {}) {
  return {
    [`users/U1`]: {profile: {displayName: "Field Worker", employment: {
      role: "FWR", serviceProvider: {id: "SP_1"}}}},
    [`teams/TEAM_1`]: {memberUids: ["U1"]},
    [`tb_uploads/${TB}`]: {
      id: TB, creation: {state: "READY"}, acceptance: {status: "ACCEPTED"},
      allocation: {status: "ALLOCATED", targetType,
        targetId: targetType === "TEAM" ? "TEAM_1" : "SP_1"},
      execution: {status: "NOT_STARTED", startedAt: null, completedAt: null},
      counts: {executionStartedRows: 0, completedRows: 0}, metadata: {},
    },
    [`tb_rows/${ROW}`]: {
      id: ROW, tbId: TB, salesAllMeterId: SALES, decision: {status: "ACCEPT"},
      allocation: {allocatable: true, status: "ALLOCATED"},
      execution: {status: rowStatus, startedAt: null, completedAt: null},
      refs: {erfId: ERF, premiseId, meterId: null, trnId: null},
      scope: {lmPcode: "ZA1", wardPcode: "ZA1001"}, metadata: {},
    },
    [`sales-all-meters/${SALES}`]: {
      untouched: {yes: true}, geofenceRefs: [{id: "GF1"}],
      tbRefs: [{id: "OTHER", rowId: "OTHER_ROW", fieldWork: {status: "NOT_STARTED"}}, {
        id: TB, rowId: ROW, date: "LOCKED", fieldWork: {status: "NOT_STARTED",
          noAccess: [{date: "2026-08-01", time: "01:02:03", user: "Earlier"}],
          discoveredMeterNo: "KEEP", meterId: null, trnId: null,
          meterMatch: null, outcomeCode: null, outcomeLabel: null, submittedAt: null},
      }],
    },
  };
}

function request(overrides = {}, auth = {uid: "U1", token: {role: "FWR"}}) {
  return {auth, data: {trnId: TRN, sourceModule: "SALES_TARGETED_BATCH",
    tbId: TB, rowId: ROW, salesDocId: SALES, erfId: ERF, premiseId: null,
    capturedAt: "2026-08-04T10:11:12.000Z", reason: "Gate locked",
    media: [{tag: "noAccessPhoto", url: "gs://bucket/photo.jpg"}],
    location: {gps: {lat: -28.7, lng: 30.1}}, ...overrides}};
}

async function record(db, req = request(), now = NOW) {
  return recordTargetedBatchNoAccess({db, request: req, now});
}

test("requires authentication and supported role with zero writes", async () => {
  const db = new FakeDb(fixture());
  await assert.rejects(record(db, request({}, null)), {code: "UNAUTHENTICATED"});
  await assert.rejects(record(db, request({}, {uid: "U1", token: {role: "MNG"}})),
    {code: "TARGETED_BATCH_ACCESS_DENIED"});
  assert.equal(db.writes.length, 0);
});

test("TEAM and SP authority succeed; unrelated actors and direct allocation fail", async () => {
  await record(new FakeDb(fixture()));
  await record(new FakeDb(fixture({targetType: "SP"})));
  for (const [targetType, mutate, code] of [
    ["TEAM", (docs) => { docs[`teams/TEAM_1`].memberUids = ["OTHER"]; }, "TARGETED_BATCH_NOT_ASSIGNED_TO_ACTOR"],
    ["SP", (docs) => { docs[`tb_uploads/${TB}`].allocation.targetId = "SP_2"; }, "TARGETED_BATCH_NOT_ASSIGNED_TO_ACTOR"],
    ["TEAM", (docs) => { docs[`tb_uploads/${TB}`].allocation.targetType = "USER"; }, "TARGETED_BATCH_ALLOCATION_TARGET_INVALID"],
  ]) {
    const docs = fixture({targetType});
    mutate(docs);
    const db = new FakeDb(docs);
    await assert.rejects(record(db), {code});
    assert.equal(db.writes.length, 0);
  }
});

test("no-premise attempt creates canonical TRN and atomically starts row and parent", async () => {
  const db = new FakeDb(fixture());
  const result = await record(db);
  assert.deepEqual(result, {success: true, alreadyRecorded: false, trnId: TRN,
    tbId: TB, rowId: ROW, salesDocId: SALES, erfId: ERF, premiseId: null,
    rowStatus: "IN_PROGRESS", noAccessCount: 2});
  const trn = db.read(`trns/${TRN}`);
  assert.equal(trn.accessData.access.hasAccess, "no");
  assert.equal(trn.accessData.premise, null);
  assert.equal(trn.targetedBatchContext.salesDocId, SALES);
  assert.equal(trn.metadata.createdByUid, "U1");
  assert.equal(db.read(`tb_rows/${ROW}`).execution.status, "IN_PROGRESS");
  const row = db.read(`tb_rows/${ROW}`);
  const parent = db.read(`tb_uploads/${TB}`);
  assertTimestampEqual(row.execution.startedAt, NOW);
  assertTimestampEqual(row.metadata.updatedAt, NOW);
  assert.equal(row.metadata.updatedByUid, "U1");
  assert.equal(row.metadata.updatedByUser, "Field Worker");
  assert.equal(parent.counts.executionStartedRows, 1);
  assert.equal(parent.counts.completedRows, 0);
  assertTimestampEqual(parent.execution.startedAt, NOW);
  assertTimestampEqual(parent.metadata.updatedAt, NOW);
  assert.equal(parent.metadata.updatedByUid, "U1");
  assert.equal(parent.metadata.updatedByUser, "Field Worker");
  assert.equal(db.writes.some((write) => write.ref.path.startsWith("asts/")), false);
  assert.equal(db.writes.some((write) => write.ref.path.startsWith("premises/")), false);
});

test("premise is derived from row, preserved in TRN, and client mismatch fails", async () => {
  const okDb = new FakeDb(fixture({premiseId: "PREM_1"}));
  await record(okDb, request({premiseId: "PREM_1"}));
  assert.equal(okDb.read(`trns/${TRN}`).accessData.premise.id, "PREM_1");
  assert.equal(okDb.read(`sales-all-meters/${SALES}`).tbRefs[1].fieldWork.premiseId, "PREM_1");
  const derivedDb = new FakeDb(fixture({premiseId: "PREM_1"}));
  await record(derivedDb, request({premiseId: undefined}));
  assert.equal(derivedDb.read(`trns/${TRN}`).accessData.premise.id, "PREM_1");
  const badDb = new FakeDb(fixture({premiseId: "PREM_1"}));
  await assert.rejects(record(badDb, request({premiseId: "PREM_2"})),
    {code: "TARGETED_BATCH_PREMISE_LINK_MISMATCH"});
  assert.equal(badDb.writes.length, 0);
});

test("exact correlation and Sales shape failures produce zero writes", async () => {
  const cases = [
    [{tbId: "TB_BAD"}, "TARGETED_BATCH_NOT_FOUND"],
    [{rowId: "ROW_BAD"}, "TARGETED_BATCH_ROW_NOT_FOUND"],
    [{salesDocId: "SALE_BAD"}, "SALES_DOCUMENT_NOT_FOUND"],
    [{erfId: "ERF_BAD"}, "TARGETED_BATCH_ERF_LINK_MISMATCH"],
  ];
  for (const [change, code] of cases) {
    const db = new FakeDb(fixture());
    await assert.rejects(record(db, request(change)), {code});
    assert.equal(db.writes.length, 0);
  }
  const wrongRow = fixture();
  wrongRow[`sales-all-meters/${SALES}`].tbRefs[1].rowId = "OTHER_ROW";
  const wrongRowDb = new FakeDb(wrongRow);
  await assert.rejects(record(wrongRowDb), {code: "SALES_TB_REF_NOT_FOUND"});
  assert.equal(wrongRowDb.writes.length, 0);
  for (const value of ["bad", {noAccess: "bad"}]) {
    const docs = fixture();
    docs[`sales-all-meters/${SALES}`].tbRefs[1].fieldWork = value;
    const db = new FakeDb(docs);
    await assert.rejects(record(db), {code: "FIELDWORK_INVALID"});
    assert.equal(db.writes.length, 0);
  }
});

test("Sales append preserves all existing fields, references, date, and entry order", async () => {
  const db = new FakeDb(fixture());
  const before = db.read(`sales-all-meters/${SALES}`);
  await record(db);
  const after = db.read(`sales-all-meters/${SALES}`);
  assert.deepEqual(after.geofenceRefs, before.geofenceRefs);
  assert.deepEqual(after.untouched, before.untouched);
  assert.deepEqual(after.tbRefs[0], before.tbRefs[0]);
  assert.equal(after.tbRefs[1].date, "LOCKED");
  assert.deepEqual(after.tbRefs[1].fieldWork.noAccess[0], before.tbRefs[1].fieldWork.noAccess[0]);
  assert.deepEqual(after.tbRefs[1].fieldWork.noAccess[1],
    {date: "2026-08-04", time: "10:11:12", user: "Field Worker"});
  assert.equal(after.tbRefs[1].fieldWork.discoveredMeterNo, "KEEP");
  assert.equal(after.tbRefs[1].fieldWork.status, "IN_PROGRESS");
});

test("multiple attempts append in order and increment first-activity counter once", async () => {
  const db = new FakeDb(fixture());
  await record(db);
  const firstRowStartedAt = db.read(`tb_rows/${ROW}`).execution.startedAt;
  const firstParentStartedAt = db.read(`tb_uploads/${TB}`).execution.startedAt;
  await record(db, request({trnId: "TRN_MDIS_20260804_002",
    capturedAt: "2026-08-04T10:12:13.000Z"}), LATER);
  const sales = db.read(`sales-all-meters/${SALES}`);
  const row = db.read(`tb_rows/${ROW}`);
  const parent = db.read(`tb_uploads/${TB}`);
  assert.equal(sales.tbRefs[1].fieldWork.noAccess.length, 3);
  assert.deepEqual(sales.tbRefs[1].fieldWork.noAccess.slice(0, 2), [
    {date: "2026-08-01", time: "01:02:03", user: "Earlier"},
    {date: "2026-08-04", time: "10:11:12", user: "Field Worker"},
  ]);
  assert.equal(parent.counts.executionStartedRows, 1);
  assert.equal(parent.counts.completedRows, 0);
  assert.equal(row.execution.status, "IN_PROGRESS");
  assert.deepEqual(row.execution.startedAt, firstRowStartedAt);
  assert.deepEqual(parent.execution.startedAt, firstParentStartedAt);
  assertTimestampEqual(row.metadata.updatedAt, LATER);
  assertTimestampEqual(parent.metadata.updatedAt, LATER);
  assert.equal(row.metadata.updatedByUid, "U1");
  assert.equal(parent.metadata.updatedByUser, "Field Worker");
});

test("same trnId is idempotent; conflicting identity fails closed", async () => {
  const db = new FakeDb(fixture());
  await record(db);
  const writes = db.writes.length;
  const rowUpdatedAt = db.read(`tb_rows/${ROW}`).metadata.updatedAt;
  const parentUpdatedAt = db.read(`tb_uploads/${TB}`).metadata.updatedAt;
  const retry = await record(db, request(), LATER);
  assert.equal(retry.alreadyRecorded, true);
  assert.equal(db.writes.length, writes);
  assert.deepEqual(db.read(`tb_rows/${ROW}`).metadata.updatedAt, rowUpdatedAt);
  assert.deepEqual(db.read(`tb_uploads/${TB}`).metadata.updatedAt, parentUpdatedAt);
  const trn = db.read(`trns/${TRN}`);
  trn.targetedBatchContext.erfId = "OTHER";
  db.documents.set(`trns/${TRN}`, trn);
  await assert.rejects(record(db), {code: "IDEMPOTENCY_CONFLICT"});
  assert.equal(db.writes.length, writes);
});

test("meter-linked and terminal rows reject with zero writes", async () => {
  const meterDocs = fixture();
  meterDocs[`tb_rows/${ROW}`].refs.meterId = "METER_1";
  const meterDb = new FakeDb(meterDocs);
  await assert.rejects(record(meterDb), {code: "TARGETED_BATCH_METER_ALREADY_LINKED"});
  assert.equal(meterDb.writes.length, 0);
  for (const status of ["COMPLETED", "CANCELLED", "REJECTED"]) {
    const docs = fixture();
    docs[`tb_rows/${ROW}`].execution.status = status;
    const db = new FakeDb(docs);
    await assert.rejects(record(db), {code: "TARGETED_BATCH_ROW_EXECUTION_STATE_INVALID"});
    assert.equal(db.writes.length, 0);
  }
});

test("reason, photo, timestamp, location, and source validation reject early", async () => {
  const cases = [
    [{reason: " "}, "INVALID_ARGUMENT"],
    [{media: []}, "NO_ACCESS_PHOTO_REQUIRED"],
    [{capturedAt: "bad"}, "CAPTURED_AT_INVALID"],
    [{location: {gps: {lat: 100, lng: 1}}}, "LOCATION_INVALID"],
    [{sourceModule: "OTHER"}, "SOURCE_MODULE_INVALID"],
  ];
  for (const [change, code] of cases) {
    const db = new FakeDb(fixture());
    await assert.rejects(record(db, request(change)), {code});
    assert.equal(db.writes.length, 0);
  }
});
