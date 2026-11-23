import test from "node:test";
import assert from "node:assert/strict";
import { explainChildDecisionBlocker } from "../tcUploads/allocation.js";
import { expireOne } from "../meterLifecycle/expireSilentWork.js";

test("explainChildDecisionBlocker explains 72-hour expiry clearly", () => {
  const snap = {
    id: "TRN_MINSP_1794862228069_ELC_ZA5241006_4230",
    data: () => ({
      origin: { trnBgo: { batchId: "TRN_BGO_20261116_225028_ZA5241006_MINSP" } },
      workflow: { state: "CREATED", expiredAt: "2026-11-20T14:45:09.782Z" },
    }),
  };
  const msg = explainChildDecisionBlocker(
    snap,
    "TRN_BGO_20261116_225028_ZA5241006_MINSP",
    "ACCEPT",
    "SPV",
  );
  assert.match(msg, /expired.*72 hours/i);
});

test("explainChildDecisionBlocker returns null when ISSUED child can be accepted", () => {
  const snap = {
    id: "TRN_1",
    data: () => ({
      origin: { trnBgo: { batchId: "BATCH_1" } },
      workflow: { state: "ISSUED" },
    }),
  };
  assert.equal(explainChildDecisionBlocker(snap, "BATCH_1", "ACCEPT", "SPV"), null);
});

test("expireOne resets ISSUED parent tc_uploads batch to READY_FOR_ALLOCATION", async () => {
  const updates = [];
  const sets = [];
  const docs = {
    "trns/TRN_1": {
      exists: true,
      data: () => ({
        ast: { astData: { astId: "AST_1" } },
        accessData: { trnType: "METER_INSPECTION" },
        origin: { trnBgo: { batchId: "BATCH_1" } },
        workflow: { state: "ISSUED", issuedAt: "2026-11-17T14:06:59.988Z" },
      }),
    },
    "asts/AST_1": {
      exists: true,
      data: () => ({ trnActiveLifecycle: { trnId: "TRN_1" } }),
    },
    "tc_uploads/BATCH_1": {
      exists: true,
      data: () => ({ workflow: { state: "ISSUED" } }),
    },
  };
  const makeRef = (path) => ({
    path,
    collection: (sub) => ({ doc: () => ({ path: `${path}/${sub}/auto` }) }),
  });
  const db = {
    collection: (name) => ({ doc: (id) => makeRef(`${name}/${id}`) }),
    runTransaction: async (fn) => {
      const tx = {
        get: async (ref) => docs[ref.path] || { exists: false, data: () => ({}) },
        update: (ref, patch) => updates.push({ path: ref.path, patch }),
        set: (ref, payload) => sets.push({ path: ref.path, payload }),
      };
      return fn(tx);
    },
  };

  const res = await expireOne({
    db,
    job: { trnId: "TRN_1", ref: makeRef("trns/TRN_1"), astId: "AST_1", trnType: "METER_INSPECTION" },
    nowMs: Date.parse("2026-11-20T14:45:09.782Z"),
    now: "2026-11-20T14:45:09.782Z",
  });

  assert.equal(res.done, true);
  const parentUpdate = updates.find((u) => u.path === "tc_uploads/BATCH_1");
  assert.ok(parentUpdate);
  assert.equal(parentUpdate.patch["workflow.state"], "READY_FOR_ALLOCATION");
  assert.equal(parentUpdate.patch.bgoStatus, "READY_FOR_ALLOCATION");
  assert.deepEqual(parentUpdate.patch["assignment.targets"], []);
  assert.ok(sets.some((s) => s.path.startsWith("tc_uploads/BATCH_1/history/")));
});

test("expireOne resets all sibling ISSUED TRNs and matching AST markers in the same batch", async () => {
  const updates = [];
  const sets = [];
  const docs = {
    "trns/TRN_1": {
      exists: true,
      data: () => ({
        ast: { astData: { astId: "AST_1" } },
        accessData: { trnType: "METER_DISCONNECTION" },
        origin: { trnBgo: { batchId: "BATCH_1" } },
        workflow: { state: "ISSUED", issuedAt: "2026-11-17T14:06:59.988Z" },
      }),
    },
    "trns/TRN_2": {
      id: "TRN_2",
      exists: true,
      data: () => ({
        ast: { astData: { astId: "AST_2" } },
        accessData: { trnType: "METER_DISCONNECTION" },
        origin: { trnBgo: { batchId: "BATCH_1" } },
        workflow: { state: "ISSUED", issuedAt: "2026-11-17T14:06:59.988Z" },
      }),
    },
    "asts/AST_1": { exists: true, data: () => ({ trnActiveLifecycle: { trnId: "TRN_1", workflowState: "ISSUED" } }) },
    "asts/AST_2": { exists: true, data: () => ({ trnActiveLifecycle: { trnId: "TRN_2", workflowState: "ISSUED" } }) },
    "tc_uploads/BATCH_1": { exists: true, data: () => ({ workflow: { state: "ISSUED" }, trnIds: ["TRN_1", "TRN_2"] }) },
  };
  const makeRef = (path) => ({ path, collection: (sub) => ({ doc: () => ({ path: `${path}/${sub}/auto` }) }) });
  const db = {
    collection: (name) => ({ doc: (id) => makeRef(`${name}/${id}`) }),
    runTransaction: async (fn) => fn({
      get: async (ref) => docs[ref.path] || { exists: false, data: () => ({}) },
      update: (ref, patch) => updates.push({ path: ref.path, patch }),
      set: (ref, payload) => sets.push({ path: ref.path, payload }),
    }),
  };

  const res = await expireOne({
    db,
    job: { trnId: "TRN_1", ref: makeRef("trns/TRN_1"), astId: "AST_1", trnType: "METER_DISCONNECTION" },
    nowMs: Date.parse("2026-11-20T14:45:09.782Z"),
    now: "2026-11-20T14:45:09.782Z",
  });

  assert.equal(res.done, true);
  assert.equal(updates.find((u) => u.path === "trns/TRN_1")?.patch["workflow.state"], "CREATED");
  assert.equal(updates.find((u) => u.path === "trns/TRN_2")?.patch["workflow.state"], "CREATED");
  assert.equal(updates.find((u) => u.path === "asts/AST_1")?.patch.trnActiveLifecycle.workflowState, "CREATED");
  assert.equal(updates.find((u) => u.path === "asts/AST_2")?.patch.trnActiveLifecycle.workflowState, "CREATED");
  assert.ok(sets.some((s) => s.path.startsWith("trns/TRN_2/history/")));
});
