import test from "node:test";
import assert from "node:assert/strict";

import { createOrLinkMdBgoPremise } from "./mdBgoPremiseLink.js";

function makeDb({ batch, row, erf, premises = [] }) {
  const docs = new Map([
    [`bgo_batches/${batch.id}`, structuredClone(batch)],
    [`bgo_rows/${row.id}`, structuredClone(row)],
    [`ireps_erfs/${erf.id}`, structuredClone(erf)],
    ...premises.map((premise) => [`premises/${premise.id}`, structuredClone(premise)]),
  ]);
  const ref = (collectionName, id) => ({
    id,
    path: `${collectionName}/${id}`,
    collectionName,
    collection: (child) => ({ doc: (childId) => ref(`${collectionName}/${id}/${child}`, childId) }),
  });
  const collection = (name) => ({
    doc: (id) => ref(name, id),
    where: (field, operator, value) => ({
      queryCollection: name,
      field,
      operator,
      value,
    }),
  });
  return {
    collection,
    docs,
    async runTransaction(callback) {
      const writes = [];
      const tx = {
        async get(target) {
          if (target.queryCollection) {
            const results = [...docs.entries()]
              .filter(([path, data]) => path.startsWith(`${target.queryCollection}/`) && path.split("/").length === 2 && data?.[target.field] === target.value)
              .map(([path, data]) => ({ id: path.split("/").at(-1), exists: true, data: () => structuredClone(data) }));
            return { docs: results, size: results.length };
          }
          const data = docs.get(target.path);
          return { id: target.id, exists: Boolean(data), data: () => structuredClone(data || {}) };
        },
        create(target, data) { writes.push(["create", target, structuredClone(data)]); },
        set(target, data) { writes.push(["set", target, structuredClone(data)]); },
        update(target, patch) { writes.push(["update", target, structuredClone(patch)]); },
      };
      const result = await callback(tx);
      for (const [mode, target, data] of writes) {
        if (mode === "create" && docs.has(target.path)) throw new Error(`already exists ${target.path}`);
        const current = docs.get(target.path) || {};
        const next = { ...current };
        for (const [key, value] of Object.entries(data)) {
          const parts = key.split(".");
          let cursor = next;
          for (const part of parts.slice(0, -1)) cursor = cursor[part] ||= {};
          cursor[parts.at(-1)] = value;
        }
        docs.set(target.path, mode === "set" ? data : next);
      }
      return result;
    },
  };
}

const fixture = () => {
  const batch = {
    id: "MD_BGO_1", batchMode: "BMD", operationType: "METER_DISCOVERY",
    workflow: { state: "ACCEPTED" }, bgo: { releaseState: "RELEASED_TO_EXECUTION" },
    target: { type: "USER", id: "worker-1" }, scope: { lmPcode: "LM1", wardPcode: "W1" },
    summary: { totalRows: 1, premiseCount: 0 },
  };
  const row = {
    id: "MD_BGO_1_ROW_1", batchId: batch.id, bgoBatchId: batch.id, rowNo: 1,
    batchMode: "BMD", operationType: "METER_DISCOVERY", erf: { id: "ERF1", erfNo: "25" },
    workflow: { state: "ISSUED" }, metadata: { createdAt: "now" },
  };
  const erf = { id: "ERF1", admin: { ward: { pcode: "W1" } } };
  const db = makeDb({ batch, row, erf });
  const payload = (id) => ({ id, erfId: "ERF1", parents: { lmPcode: "LM1", wardPcode: "W1" }, metadata: { createdAt: "now", updatedAt: "now" }, qa: { sourceVersion: "v1" } });
  const context = { batchId: batch.id, rowId: row.id, erfId: "ERF1", batchMode: "BMD" };
  return { db, batch, row, payload, context };
};

test("first MD BGO premise converts the ERF seed row in place", async () => {
  const { db, row, payload, context } = fixture();
  const result = await createOrLinkMdBgoPremise({ db, premiseRef: db.collection("premises").doc("P1"), premisePayload: payload("P1"), mdBgoContext: context, actorUid: "worker-1", actorName: "Worker" });
  assert.equal(result.rowId, row.id);
  assert.equal(db.docs.get(`bgo_rows/${row.id}`).refs.premiseId, "P1");
  assert.equal(db.docs.get("bgo_batches/MD_BGO_1").workflow.state, "IN_PROGRESS");
});

test("each additional premise on an ERF receives the next canonical MD BGO row", async () => {
  const { db, row, payload, context } = fixture();
  await createOrLinkMdBgoPremise({ db, premiseRef: db.collection("premises").doc("P1"), premisePayload: payload("P1"), mdBgoContext: context, actorUid: "worker-1", actorName: "Worker" });
  const result = await createOrLinkMdBgoPremise({ db, premiseRef: db.collection("premises").doc("P2"), premisePayload: payload("P2"), mdBgoContext: context, actorUid: "worker-1", actorName: "Worker" });
  assert.equal(result.rowId, "MD_BGO_1_ROW_2");
  assert.equal(db.docs.get(`bgo_rows/${row.id}`).refs.premiseId, "P1");
  assert.equal(db.docs.get("bgo_rows/MD_BGO_1_ROW_2").refs.premiseId, "P2");
  assert.equal(db.docs.get("bgo_batches/MD_BGO_1").summary.totalRows, 2);
});

test("retrying a premise submission does not create another MD BGO row", async () => {
  const { db, payload, context } = fixture();
  const args = { db, premiseRef: db.collection("premises").doc("P1"), premisePayload: payload("P1"), mdBgoContext: context, actorUid: "worker-1", actorName: "Worker" };
  const first = await createOrLinkMdBgoPremise(args);
  const retry = await createOrLinkMdBgoPremise(args);
  assert.equal(first.rowId, retry.rowId);
  assert.equal(retry.alreadyLinked, true);
  assert.equal([...db.docs.keys()].filter((key) => key.startsWith("bgo_rows/")).length, 1);
});
