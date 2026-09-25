// Targeted Batch rules TB-R060 (1.3.62): the callable that takes meters out of a batch.
// Who may do it — Unallocate's own authority (TB-R048): SPV or MNG, the batch's LM their active workbase,
// the main service provider and not a subcontractor, and the batch's own TEAM or SP inside that main
// service provider. And that each meter is settled in its own transaction, with the batch read again inside
// it: one refused meter never stops the rest.
import test from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import { takeOutOfBatch } from "../targetedBatches/takeOutOfBatchCallable.js";

const TB = "TGB_20260913_120000_AB12";
const LM = "ZA5241";
const CREATED = Timestamp.fromMillis(Date.parse("2026-09-13T12:00:00Z"));
const STARTED = Timestamp.fromMillis(Date.parse("2026-09-15T07:00:00Z"));
const DONE = Timestamp.fromMillis(Date.parse("2026-09-16T11:00:00Z"));
const WORDS = "Batched by mistake.";
const quiet = { info() {}, warn() {}, error() {} };
const meterNo = n => `0700000000${n}`;
const rowId = n => `TBR_20260913_120000_AB12_00000${n}`;

const valueAt = (data, path) => path.split(".").reduce((cursor, key) => (cursor === undefined || cursor === null ? undefined : cursor[key]), data);
function applyPatch(existing, patch) {
  const next = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (!key.includes(".")) { next[key] = value; continue; }
    const parts = key.split(".");
    let cursor = next;
    for (const part of parts.slice(0, -1)) { cursor[part] = { ...(cursor[part] || {}) }; cursor = cursor[part]; }
    cursor[parts.at(-1)] = value;
  }
  return next;
}

// A fake Firestore: enough for one document read, one collection query and the five writes a removal makes.
class FakeDb {
  constructor(documents) { this.documents = new Map(Object.entries(documents)); this.applied = []; this.transactions = 0; }
  doc(path) { return { path, id: path.split("/").at(-1), get: async () => this.snap(path) }; }
  collection(name) { return { doc: id => this.doc(`${name}/${id}`), where: (field, op, value) => ({ __query: true, name, field, op, value }) }; }
  snap(path) { const data = this.documents.get(path); return { exists: data !== undefined, id: path.split("/").at(-1), data: () => data }; }
  runQuery(query) {
    const docs = [...this.documents.entries()]
      .filter(([path]) => path.startsWith(`${query.name}/`) && path.split("/").length === 2 && valueAt(this.documents.get(path), query.field) === query.value)
      .map(([path]) => ({ id: path.split("/").at(-1), ref: this.doc(path), data: () => this.documents.get(path) }));
    return { docs };
  }
  async runTransaction(run) {
    this.transactions += 1;
    const pending = [];
    const tx = {
      get: async target => (target.__query ? this.runQuery(target) : this.snap(target.path)),
      create: (ref, value) => pending.push(["create", ref.path, value]),
      update: (ref, value) => pending.push(["update", ref.path, value]),
      delete: ref => pending.push(["delete", ref.path]),
    };
    const result = await run(tx);
    for (const [op, path, value] of pending) {
      if (op === "delete") this.documents.delete(path);
      else if (op === "create") {
        if (this.documents.has(path)) throw Object.assign(new Error(`${path} already exists`), { code: 6 });
        this.documents.set(path, value);
      } else this.documents.set(path, applyPatch(this.documents.get(path) ?? {}, value));
      this.applied.push(`${op} ${path}`);
    }
    return result;
  }
}

const rowDoc = (n, over = {}) => ({ id: rowId(n), tbId: TB, rowNo: n, schemaVersion: "0.3.0", salesAllMeterId: meterNo(n),
  meter: { numberNormalized: meterNo(n), numberRaw: meterNo(n) }, decision: { status: "ACCEPT" },
  allocation: { allocatable: true, status: "ALLOCATED", targetType: "TEAM", targetId: "TEAM1" },
  execution: { status: "NOT_STARTED", startedAt: null, completedAt: null, outcome: null }, refs: { erfId: "ERF1", premiseId: null, meterId: null, trnId: null }, ...over });
const salesDoc = (n, over = {}) => ({ master: { id: meterNo(n), visibility: "NOT_VISIBLE" }, lmPcode: LM, targetedBatchId: TB, tbRefs: [{ id: TB, date: CREATED }], erfId: "ERF1",
  metadata: { createdAt: CREATED, createdByUid: "ORIGINAL", createdByUser: "Original", updatedAt: CREATED, updatedByUid: "ORIGINAL", updatedByUser: "Original" }, ...over });

function world({ rows = [1, 2, 3], users = {}, overrides = {} } = {}) {
  const documents = {
    [`tb_uploads/${TB}`]: { id: TB, schemaVersion: "0.3.0", status: "ALLOCATED", geofenceId: "GF1", scope: { lmPcode: LM }, creation: { state: "READY", createdRows: 3 },
      allocation: { status: "ALLOCATED", targetType: "TEAM", targetId: "TEAM1", targetName: "Team One" }, acceptance: { status: "ACCEPTED" },
      execution: { status: "NOT_STARTED", startedAt: null, completedAt: null },
      counts: { totalRows: 3, acceptedRows: 3, rejectedRows: 0, allocatableRows: 3, allocatedRows: 3, unallocatedRows: 0, executionStartedRows: 0, completedRows: 0 },
      metadata: { createdAt: CREATED } },
    "users/SPV1": { employment: { role: "SPV", serviceProvider: { id: "MNC1" } }, profile: { displayName: "Thandi Supervisor" }, access: { activeWorkbase: LM, workbases: [LM] } },
    "users/FWR1": { employment: { role: "FWR", serviceProvider: { id: "MNC1" } }, profile: { displayName: "Field Worker" }, access: { activeWorkbase: LM, workbases: [LM] } },
    "users/MNG9": { employment: { role: "MNG", serviceProvider: { id: "MNC1" } }, profile: { displayName: "Other Manager" }, access: { activeWorkbase: "ZA9999", workbases: ["ZA9999"] } },
    // A supervisor of another service provider: a subcontractor of MNC1, with this LM among their
    // workbases but not the active one. Before 1.3.62 this was enough to free another provider's work.
    "users/SPV9": { employment: { role: "SPV", serviceProvider: { id: "SUBC1" } }, profile: { displayName: "Other Supervisor" }, access: { activeWorkbase: "ZA9999", workbases: ["ZA9999", LM] } },
    "serviceProviders/MNC1": { status: "ACTIVE", name: "Main SP", clients: [] },
    "serviceProviders/SUBC1": { status: "ACTIVE", name: "Subcontractor", clients: [{ id: "MNC1", clientType: "SP", relationshipType: "SUBC" }] },
    "teams/TEAM1": { team: { status: "ACTIVE", name: "Team One" }, ownership: { mncServiceProviderId: "MNC1" } },
    "teams/TEAM9": { team: { status: "ACTIVE", name: "Team Nine" }, ownership: { mncServiceProviderId: "OTHER_MNC" } },
    ...users,
  };
  for (const n of rows) { documents[`tb_rows/${rowId(n)}`] = rowDoc(n); documents[`sales-all-meters/${meterNo(n)}`] = salesDoc(n); }
  return new FakeDb({ ...documents, ...overrides });
}
const request = (data, uid = "SPV1") => ({ auth: uid ? { uid, token: { name: "Token Name" } } : null, data });
const run = (db, data, uid) => takeOutOfBatch({ db, request: request(data, uid), log: quiet });
const good = { tbId: TB, meterNos: [meterNo(1)], reasonText: WORDS };
async function failure(db, data, uid) {
  try { await run(db, data, uid); } catch (error) { return error.code; }
  return "NO ERROR";
}

test("the request itself must be sound before anything is read", async () => {
  const db = world();
  assert.equal(await failure(db, { ...good, tbId: "nonsense" }), "INVALID_BATCH_INTENT");
  assert.equal(await failure(db, { ...good, meterNos: [] }), "INVALID_METERS");
  assert.equal(await failure(db, { ...good, meterNos: ["07 000"] }), "INVALID_METERS");
  assert.equal(await failure(db, { ...good, meterNos: Array.from({ length: 31 }, (_, n) => `0700000${1000 + n}`) }), "INVALID_METERS");
  assert.equal(await failure(db, { ...good, reasonText: "  " }), "REASON_REQUIRED");
  assert.equal(await failure(db, { ...good, reasonText: "x".repeat(501) }), "REASON_TOO_LONG");
  assert.equal(await failure(db, { ...good, tbId: "TGB_20260913_120000_ZZZZ" }), "PARENT_MISSING");
  assert.equal(db.transactions, 0, "nothing is opened until the request is sound");
});

async function refusal(db, data, uid) {
  try { await run(db, data, uid); } catch (error) { return { code: error.code, message: error.message }; }
  return { code: "NO ERROR", message: "" };
}

test("only a signed-in supervisor or manager, and only in their own municipality", async () => {
  const db = world();
  assert.equal(await failure(db, good, null), "UNAUTHENTICATED");
  assert.equal(await failure(db, good, "NOBODY"), "PERMISSION_DENIED");
  assert.deepEqual(await refusal(db, good, "FWR1"), { code: "ACTOR_ROLE", message: "Only a supervisor or a manager may take a meter out of a batch." });
  assert.equal(db.transactions, 0, "nothing is opened for someone who may not do it");
});

// Rules TB-R060 (1.3.62): the same authority as Unallocate. Before it, a supervisor of another service
// provider whose active workbase was another LM could free this batch's allocated work.
test("a supervisor of another service provider is refused, and learns nothing about the batch", async () => {
  const db = world();
  // What a batch that is not there says, in this batch's own words.
  const missing = { code: "PARENT_MISSING", message: `Batch ${TB} could not be read, so nothing was changed.` };
  const absent = await refusal(db, { ...good, tbId: "TGB_20260913_120000_ZZZZ" }, "SPV1");
  assert.equal(absent.code, missing.code);
  assert.equal(absent.message, "Batch TGB_20260913_120000_ZZZZ could not be read, so nothing was changed.");

  // The LM is in their workbases but is not their active one, and they are a subcontractor.
  const other = await refusal(db, good, "SPV9");
  assert.deepEqual(other, missing, "a batch outside the person's authority is answered like one that is not there");

  // Even with the LM as their active workbase, a subcontractor's supervisor may not do it.
  db.documents.set("users/SPV9", { ...db.documents.get("users/SPV9"), access: { activeWorkbase: LM, workbases: [LM] } });
  assert.deepEqual(await refusal(db, good, "SPV9"), missing);

  // A manager of another municipality is answered the same way.
  assert.deepEqual(await refusal(db, good, "MNG9"), missing);
  assert.equal(db.transactions, 0, "nothing is opened for someone who may not do it");
  assert.deepEqual(db.applied, [], "nothing was written");
});

test("the batch's own TEAM must sit inside the actor's main service provider", async () => {
  const db = world();
  db.documents.set(`tb_uploads/${TB}`, applyPatch(db.documents.get(`tb_uploads/${TB}`), { "allocation.targetId": "TEAM9", "allocation.targetName": "Team Nine" }));
  const outside = await refusal(db, good, "SPV1");
  assert.equal(outside.code, "TARGET_OUTSIDE_MNC");
  assert.match(outside.message, /is allocated outside your service provider, so nothing was changed\./);
  assert.equal(db.transactions, 0);

  // A TEAM the batch names but that is not there stops the action too, in plain words.
  db.documents.delete("teams/TEAM9");
  const unreadable = await refusal(db, good, "SPV1");
  assert.equal(unreadable.code, "TARGET_UNREADABLE");
  assert.match(unreadable.message, /Who batch .* is allocated to cannot be read\./);
  assert.deepEqual(db.applied, [], "nothing was written");
});

test("a batch nobody has been given the work of has no TEAM to test, and may still be corrected", async () => {
  const db = world();
  db.documents.set(`tb_uploads/${TB}`, applyPatch(db.documents.get(`tb_uploads/${TB}`), {
    status: "READY_FOR_ALLOCATION", "allocation.status": "NOT_STARTED", "allocation.targetId": "", "allocation.targetType": "", "allocation.targetName": "",
  }));
  const result = await run(db, good);
  assert.deepEqual(result.refused, []);
  assert.equal(result.takenOut.length, 1);
});

// The authority is taken from the batch as it stands inside the transaction, not as it stood before it.
test("a batch that moves out of the actor's reach mid-run stops everything, and writes nothing more", async () => {
  const db = world();
  const parentPath = `tb_uploads/${TB}`;
  let opened = 0;
  const runTransaction = db.runTransaction.bind(db);
  db.runTransaction = work => {
    opened += 1;
    if (opened === 2) db.documents.set(parentPath, applyPatch(db.documents.get(parentPath), { "allocation.targetId": "TEAM9" }));
    return runTransaction(work);
  };
  await assert.rejects(
    () => run(db, { tbId: TB, meterNos: [meterNo(1), meterNo(2)], reasonText: WORDS }),
    error => { assert.equal(error.code, "TARGET_OUTSIDE_MNC"); return true; },
  );
  assert.equal(opened, 2, "the second meter is the one that is stopped");
  assert.deepEqual(db.applied.filter(write => write.startsWith("delete")), [`delete tb_rows/${rowId(1)}`], "only the first meter went");
});

test("a meter is taken out: the row goes, the meter is free and the batch is recounted", async () => {
  const db = world();
  const result = await run(db, good);
  assert.equal(result.success, true);
  assert.deepEqual(result.refused, []);
  assert.equal(result.requested, 1);
  assert.deepEqual(result.takenOut, [{ meterNo: meterNo(1), rowId: rowId(1), rowNo: 1, batchStatusAfter: null }]);
  assert.deepEqual(db.applied, [
    `create sales-all-meters/${meterNo(1)}/batchHistory/${TB}__REMOVED_FROM_BATCH`,
    `update sales-all-meters/${meterNo(1)}`,
    `delete tb_rows/${rowId(1)}`,
    `update tb_uploads/${TB}`,
    `create tb_uploads/${TB}/history/ROW_REMOVED__${rowId(1)}`,
  ]);
  const sales = db.documents.get(`sales-all-meters/${meterNo(1)}`);
  assert.equal(sales.targetedBatchId, null);
  assert.deepEqual(sales.tbRefs, []);
  assert.equal(sales.metadata.updatedByUser, "Thandi Supervisor");
  assert.equal(db.documents.has(`tb_rows/${rowId(1)}`), false);
  const parent = db.documents.get(`tb_uploads/${TB}`);
  assert.equal(parent.counts.totalRows, 2);
  assert.equal(parent.status, "ALLOCATED", "the status does not move while nothing has started");
  assert.equal(parent.allocation.targetId, "TEAM1", "allocation is never touched");
  const event = db.documents.get(`sales-all-meters/${meterNo(1)}/batchHistory/${TB}__REMOVED_FROM_BATCH`);
  assert.equal(event.reason, "TAKEN_OUT_OF_BATCH");
  assert.equal(event.reasonText, WORDS);
  assert.deepEqual(event.actor, { uid: "SPV1", user: "Thandi Supervisor", role: "SPV" });
  assert.match(db.documents.get(`tb_uploads/${TB}/history/ROW_REMOVED__${rowId(1)}`).note, /took meter 07000000001 out of batch/);
  assert.equal(db.transactions, 1);
});

test("each meter is settled on its own: one refused never stops the rest", async () => {
  const db = world();
  db.documents.set(`tb_rows/${rowId(2)}`, rowDoc(2, { execution: { status: "COMPLETED", startedAt: STARTED, completedAt: DONE, outcome: "METER_DISCOVERED" } }));
  const result = await run(db, { tbId: TB, meterNos: [meterNo(1), meterNo(2), meterNo(3)], reasonText: WORDS });
  assert.equal(result.success, true);
  assert.deepEqual(result.takenOut.map(item => item.meterNo), [meterNo(1), meterNo(3)]);
  assert.equal(result.refused.length, 1);
  assert.equal(result.refused[0].meterNo, meterNo(2));
  assert.equal(result.refused[0].code, "ROW_COMPLETED");
  assert.match(result.refused[0].message, /Completed work is never released\./);
  assert.equal(db.transactions, 3, "one transaction per meter");
  // The completed row and its meter are untouched.
  assert.ok(db.documents.has(`tb_rows/${rowId(2)}`));
  assert.equal(db.documents.get(`sales-all-meters/${meterNo(2)}`).targetedBatchId, TB);
  // The batch was recounted down to its one remaining row.
  assert.equal(db.documents.get(`tb_uploads/${TB}`).counts.totalRows, 1);
});

test("the batch's last meter is refused, so a batch is emptied only through Delete Batch", async () => {
  const db = world({ rows: [1] });
  const result = await run(db, good);
  assert.deepEqual(result.takenOut, []);
  assert.equal(result.refused[0].code, "LAST_ROW");
  assert.match(result.refused[0].message, /Use Delete Batch to empty a batch\./);
  assert.ok(db.documents.has(`tb_rows/${rowId(1)}`));
  assert.deepEqual(db.applied, [], "nothing was written");
});

test("pressing it again is safe: the meter is no longer in the batch", async () => {
  const db = world();
  await run(db, good);
  const again = await run(db, good);
  assert.equal(again.success, true);
  assert.deepEqual(again.takenOut, []);
  assert.equal(again.refused[0].code, "NOT_IN_BATCH");
  assert.match(again.refused[0].message, /is not in batch TGB_20260913_120000_AB12\./);
});

test("a meter the batch never had, and a meter already found on site, are refused", async () => {
  const db = world();
  const strange = await run(db, { tbId: TB, meterNos: ["07000009999"], reasonText: WORDS });
  assert.equal(strange.refused[0].code, "SALES_MISSING");
  db.documents.set(`sales-all-meters/${meterNo(3)}`, salesDoc(3, { master: { id: meterNo(3), visibility: "VISIBLE" } }));
  const found = await run(db, { tbId: TB, meterNos: [meterNo(3)], reasonText: WORDS });
  assert.equal(found.refused[0].code, "METER_VISIBLE");
  assert.deepEqual(db.applied, [], "a refusal writes nothing");
});

test("records that point at the removed row are listed in the history, never changed", async () => {
  const db = world();
  db.documents.set("trns/TRN_A", { targetedBatchContext: { tbId: TB, rowId: rowId(1) } });
  db.documents.set("premises/PRM_A", { targetedBatchContext: { tbId: TB, rowId: rowId(1) } });
  await run(db, good);
  const entry = db.documents.get(`tb_uploads/${TB}/history/ROW_REMOVED__${rowId(1)}`);
  assert.deepEqual(entry.pointingAtRow, { trnIds: ["TRN_A"], premiseIds: ["PRM_A"] });
  assert.ok(db.documents.has("trns/TRN_A") && db.documents.has("premises/PRM_A"));
  assert.equal(db.applied.filter(write => /trns\/|premises\//.test(write)).length, 0);
});
