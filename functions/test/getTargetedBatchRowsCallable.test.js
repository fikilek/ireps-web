import test from "node:test";
import assert from "node:assert/strict";

import {
  SALES_DOCUMENT_ID_MISSING,
  enrichTargetedBatchRow,
  getTargetedBatchRows,
} from "../targetedBatches/getTargetedBatchRowsCallable.js";

const TB = "TGB_TEST";
const snap = (id, value) => ({ id, exists: value !== undefined,
  data: () => value });

class FakeDb {
  constructor(documents) {
    this.documents = structuredClone(documents);
    this.getAllCalls = [];
    this.writes = 0;
  }
  doc(path) { return this.collection(path.split("/")[0]).doc(path.split("/")[1]); }
  collection(name) {
    const db = this;
    return {
      doc(id) { return { id, path: `${name}/${id}`, get: async () => snap(id, db.documents[`${name}/${id}`]) }; },
      where(field, op, value) {
        const state = { field, value, cursor: null, limit: Infinity };
        const query = {
          orderBy() { return query; },
          startAfter(rowNo, id) { state.cursor = { rowNo, id }; return query; },
          limit(valueLimit) { state.limit = valueLimit; return query; },
          async get() {
            let docs = Object.entries(db.documents).filter(([path, value]) =>
              path.startsWith(`${name}/`) && value[state.field] === state.value)
              .map(([path, value]) => snap(path.slice(name.length + 1), value))
              .sort((a, b) => a.data().rowNo - b.data().rowNo || a.id.localeCompare(b.id));
            if (state.cursor) docs = docs.filter((item) =>
              item.data().rowNo > state.cursor.rowNo ||
              (item.data().rowNo === state.cursor.rowNo && item.id > state.cursor.id));
            return { docs: docs.slice(0, state.limit) };
          },
        };
        return query;
      },
    };
  }
  async getAll(...refs) {
    this.getAllCalls.push(refs.map((ref) => ref.id));
    return refs.map((ref) => snap(ref.id, this.documents[ref.path]));
  }
}

function docs(targetType = "TEAM", targetId = "TEAM_1") {
  const result = {
    [`tb_uploads/${TB}`]: { allocation: { status: "ALLOCATED", targetType, targetId } },
    "teams/TEAM_1": { memberUids: ["worker"] },
    "users/worker": { employment: { role: "FWR", serviceProvider: { id: "SP_1" } } },
  };
  for (let rowNo = 1; rowNo <= 3; rowNo += 1) {
    const id = `ROW_${rowNo}`;
    result[`tb_rows/${id}`] = { id, tbId: TB, rowNo, salesAllMeterId: rowNo < 3 ? "SALE_1" : "SALE_2", refs: { erfId: `ERF_${rowNo}` } };
  }
  result["tb_rows/OTHER"] = { tbId: "OTHER", rowNo: 1, salesAllMeterId: "SALE_1" };
  result["sales-all-meters/SALE_1"] = { secret: "never returned", tbRefs: [
    { id: TB, rowId: "ROW_1", fieldWork: {} },
    { id: TB, rowId: "ROW_2", fieldWork: { noAccess: [{}, {}] } },
  ] };
  result["sales-all-meters/SALE_2"] = { tbRefs: [{ id: TB, rowId: "ROW_3", fieldWork: { noAccess: [] } }] };
  return result;
}

const request = (data, uid = "worker") => ({ data, auth: uid ? { uid, token: {} } : null });

test("requires authentication, valid input, and allocation authority", async () => {
  await assert.rejects(getTargetedBatchRows({ db: new FakeDb(docs()), request: request({ tbId: TB }, null) }), { code: "unauthenticated" });
  await assert.rejects(getTargetedBatchRows({ db: new FakeDb(docs()), request: request({ tbId: " " }) }), { code: "invalid-argument" });
  await assert.rejects(getTargetedBatchRows({ db: new FakeDb(docs()), request: request({ tbId: TB }, "stranger") }), { code: "permission-denied" });
  const teamResult = await getTargetedBatchRows({ db: new FakeDb(docs()), request: request({ tbId: TB, limit: 1 }) });
  assert.equal(teamResult.rows.length, 1);
  const spResult = await getTargetedBatchRows({ db: new FakeDb(docs("SP", "SP_1")), request: request({ tbId: TB, limit: 1 }) });
  assert.equal(spResult.rows.length, 1);
});

test("orders, filters, limits and paginates without duplicates or omissions", async () => {
  const db = new FakeDb(docs());
  const first = await getTargetedBatchRows({ db, request: request({ tbId: TB, limit: 2 }) });
  const second = await getTargetedBatchRows({ db, request: request({ tbId: TB, limit: 2, cursor: first.pagination.nextCursor }) });
  assert.deepEqual([...first.rows, ...second.rows].map((row) => row.id), ["ROW_1", "ROW_2", "ROW_3"]);
  assert.equal(first.pagination.hasMore, true);
  assert.equal(second.pagination.hasMore, false);
  await assert.rejects(getTargetedBatchRows({ db, request: request({ tbId: TB, cursor: { rowNo: 0, id: "" } }) }), { code: "invalid-argument" });
});

test("enriches from exact Sales tbRef and deduplicates reads without writes", async () => {
  const db = new FakeDb(docs());
  const before = structuredClone(db.documents);
  const result = await getTargetedBatchRows({ db, request: request({ tbId: TB }) });
  assert.deepEqual(result.rows.map((row) => row.noAccessCount), [0, 2, 0]);
  assert.ok(result.rows.every((row) => row.noAccessSourceStatus === "OK"));
  assert.deepEqual(db.getAllCalls, [["SALE_1", "SALE_2"]]);
  assert.equal(result.diagnostics.firestoreWrites, 0);
  assert.equal(db.writes, 0);
  assert.deepEqual(db.documents, before);
  assert.ok(result.rows.every((row) => row.secret === undefined && row.tbRefs === undefined));
});

test("reports all integrity states and never maps them to zero", () => {
  const row = { id: "ROW", tbId: TB, salesAllMeterId: "SALE" };
  const cases = [
    [enrichTargetedBatchRow({ ...row, salesAllMeterId: "" }), SALES_DOCUMENT_ID_MISSING],
    [enrichTargetedBatchRow(row), "SALES_DOCUMENT_MISSING"],
    [enrichTargetedBatchRow(row, snap("SALE", { tbRefs: [{ id: TB, rowId: "WRONG" }] })), "TB_REFERENCE_MISSING"],
    [enrichTargetedBatchRow(row, snap("SALE", { tbRefs: [{ id: TB, rowId: "ROW", fieldWork: "bad" }] })), "FIELDWORK_INVALID"],
    [enrichTargetedBatchRow(row, snap("SALE", { tbRefs: [{ id: TB, rowId: "ROW", fieldWork: { noAccess: "bad" } }] })), "FIELDWORK_INVALID"],
  ];
  cases.forEach(([result, status]) => {
    assert.equal(result.noAccessSourceStatus, status);
    assert.equal(result.noAccessCount, null);
  });
});
