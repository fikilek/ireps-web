import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, doc, documentId, getDoc, getDocs, limit, onSnapshot, orderBy, query, setDoc, updateDoc, where } from "firebase/firestore";
import { buildMdBgoMeterRows, enrichMdBgoRows } from "../src/pages/operations/md-bgo/mdBgoRowsModel.js";
import { buildMdBgoRegisterRow, getMdBgoRowStatusCounts } from "../src/pages/operations/md-bgo/mdBgoRegisterModel.js";

const projectId = "demo-ireps-qa";
const batchId = "MD_BGO_TEST_BATCH";
let env;

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "This test must never use a real database");
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: "127.0.0.1",
      port: 8087,
      rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
    },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    await Promise.all([
      setDoc(doc(context.firestore(), "users/active-field-worker"), {
        accountStatus: "ACTIVE",
        employment: { role: "FWR" },
      }),
      setDoc(doc(context.firestore(), "users/inactive-field-worker"), {
        accountStatus: "DISABLED",
        employment: { role: "FWR" },
      }),
      setDoc(doc(context.firestore(), "bgo_rows/row-1"), {
        id: "row-1",
        bgoBatchId: batchId,
        scope: { lmPcode: "ZA5241" },
        workflow: { state: "READY_FOR_ALLOCATION" },
      }),
    ]);
  });
});

after(async () => env?.cleanup());

test("active MD BGO client receives the initial batch row and a live update", async () => {
  const db = env.authenticatedContext("active-field-worker").firestore();
  const rowsQuery = query(collection(db, "bgo_rows"), where("bgoBatchId", "==", batchId));
  const initial = await assertSucceeds(getDocs(rowsQuery));
  assert.equal(initial.size, 1);

  let unsubscribe;
  let eventCount = 0;
  let initialReceived;
  const initialSnapshot = new Promise((resolve) => { initialReceived = resolve; });
  const updatedState = new Promise((resolve, reject) => {
    unsubscribe = onSnapshot(
      rowsQuery,
      (snapshot) => {
        eventCount += 1;
        const row = snapshot.docs[0]?.data();
        if (eventCount === 1) initialReceived();
        if (row?.workflow?.state === "IN_PROGRESS") resolve({ eventCount, row });
      },
      reject,
    );
  });

  try {
    await initialSnapshot;
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), "bgo_rows/row-1"), {
        "workflow.state": "IN_PROGRESS",
      });
    });
    const received = await updatedState;
    assert.ok(received.eventCount >= 2, "listener should receive its initial snapshot and a later update");
    assert.equal(received.row.workflow.state, "IN_PROGRESS");
  } finally {
    unsubscribe?.();
  }
});

test("unauthenticated and inactive clients cannot read MD BGO rows", async () => {
  const rowsQuery = (db) => query(collection(db, "bgo_rows"), where("bgoBatchId", "==", batchId));
  await assertFails(getDocs(rowsQuery(env.unauthenticatedContext().firestore())));
  await assertFails(getDocs(rowsQuery(env.authenticatedContext("inactive-field-worker").firestore())));
});

test("active clients cannot write MD BGO rows directly", async () => {
  const db = env.authenticatedContext("active-field-worker").firestore();
  await assertFails(setDoc(doc(db, "bgo_rows/forged-row"), {
    id: "forged-row",
    bgoBatchId: batchId,
    scope: { lmPcode: "ZA5241" },
  }));
});

test("BGO exact linked premise, meter and ERF queries allow active FWR and stream later changes", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await Promise.all([setDoc(doc(ctx.firestore(), "premises/linked-premise"), { id: "linked-premise", erfId: "linked-erf", address: { strName: "Before" } }),
      setDoc(doc(ctx.firestore(), "asts/linked-meter"), { id: "linked-meter" }),
      setDoc(doc(ctx.firestore(), "ireps_erfs/linked-erf"), { id: "linked-erf" })]);
  });
  const db = env.authenticatedContext("active-field-worker").firestore();
  for (const [name, id] of [["premises", "linked-premise"], ["asts", "linked-meter"], ["ireps_erfs", "linked-erf"]]) {
    const q = (client) => query(collection(client, name), where(documentId(), "in", [id]));
    assert.equal((await assertSucceeds(getDocs(q(db)))).size, 1);
    await assertFails(getDocs(q(env.unauthenticatedContext().firestore())));
    await assertFails(getDocs(q(env.authenticatedContext("inactive-field-worker").firestore())));
  }
  const snapshots = [];
  let stop, ready, changed;
  const first = new Promise((resolve) => { ready = resolve; });
  const later = new Promise((resolve, reject) => {
    stop = onSnapshot(query(collection(db, "premises"), where(documentId(), "in", ["linked-premise"])), (snap) => {
      snapshots.push(snap); ready(); if (snap.docs[0]?.data()?.address?.strName === "After") resolve();
    }, reject);
    setTimeout(() => reject(new Error("Linked premise update timed out")), 10000).unref();
    changed = () => {};
  });
  try { await first; await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), "premises/linked-premise"), { "address.strName": "After" })); await later; assert.ok(snapshots.length >= 2); }
  finally { stop(); changed(); }
});

test("permanent meter rows on one premise display only their own linked meter", () => {
  const rows = [1, 2].map((i) => ({ id: `row-${i}`, refs: { premiseId: "p", meterId: `m${i}` }, meter: { id: `m${i}`, meterNo: `100${i}` } }));
  const enriched = enrichMdBgoRows({ rows, premises: [{ id: "p" }], meters: [1, 2].map((i) => ({ id: `m${i}`, premiseId: "p", meterNo: `100${i}` })) });
  const display = buildMdBgoMeterRows(enriched);
  assert.equal(display.length, 2); assert.deepEqual(display.map((r) => r.meterId), ["m1", "m2"]);
});

test("Register parent and LM row-count queries are authorized and counts stream subsequent work", async () => {
  const db = env.authenticatedContext("active-field-worker").firestore();
  await env.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), "bgo_batches", batchId), {
    scope: { lmPcode: "ZA5241" }, batchMode: "BMD", workflow: { state: "READY_FOR_ALLOCATION" },
  }));
  for (const field of ["scope.lmPcode", "sourceUpload.lmPcode", "origin.lmPcode", "lmPcode"]) {
    const result = await assertSucceeds(getDocs(query(collection(db, "bgo_batches"), where(field, "==", "ZA5241"), limit(1000))));
    assert.equal(result.size, field === "scope.lmPcode" ? 1 : 0);
  }
  const rowsQuery = query(collection(db, "bgo_rows"), where("scope.lmPcode", "==", "ZA5241"), limit(10000));
  let off;
  let initial;
  const receivedInitial = new Promise((resolve) => { initial = resolve; });
  const updated = new Promise((resolve, reject) => {
    off = onSnapshot(rowsQuery, (snapshot) => {
      initial();
      if (snapshot.docs.some((row) => row.data().workflow?.state === "IN_PROGRESS")) resolve();
    }, reject);
  });
  try {
    await receivedInitial;
    await env.withSecurityRulesDisabled((context) => updateDoc(doc(context.firestore(), "bgo_rows/row-1"), { "workflow.state": "IN_PROGRESS" }));
    await updated;
  } finally { off?.(); }
});

test("Register Total streams an additional premise row instead of retaining its original ERF count", async () => {
  const db = env.authenticatedContext("active-field-worker").firestore();
  const rowsQuery = query(collection(db, "bgo_rows"), where("scope.lmPcode", "==", "ZA5241"), limit(10000));
  const batch = { id: batchId, workflowState: "IN_PROGRESS", summary: { erfCount: 1 } };
  let initial, off, timer;
  const receivedInitial = new Promise(resolve => { initial = resolve; });
  const changed = new Promise((resolve, reject) => {
    off = onSnapshot(rowsQuery, snap => {
      const rows = snap.docs.map(item => ({ id: item.id, ...item.data() }));
      const display = buildMdBgoRegisterRow(batch, getMdBgoRowStatusCounts(rows), { ready: true, error: "" });
      if (snap.size === 1) { assert.equal(display.total, 1); initial(); }
      if (snap.size === 2) resolve(display);
    }, reject);
  });
  try {
    await receivedInitial;
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), "bgo_rows/new-flat-premise"), {
      bgoBatchId: batchId, scope: { lmPcode: "ZA5241" }, refs: { premiseId: "UNIT_B" }, workflow: { state: "IN_PROGRESS" },
    }));
    const display = await Promise.race([changed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Register total stream timed out")), 10000); })]);
    assert.deepEqual([display.total, display.inProgress, display.completed], [2, 1, 0]);
    assert.equal(batch.summary.erfCount, 1);
  } finally { clearTimeout(timer); off?.(); }
});

test("BGO Rows receives live meter discovery and can read the Registry ERF boundary", async () => {
  const db = env.authenticatedContext("active-field-worker").firestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const admin = context.firestore();
    await Promise.all([
      updateDoc(doc(admin, "bgo_rows/row-1"), { erf: { id: "E1", erfNo: "25" }, refs: { premiseId: "P1" } }),
      setDoc(doc(admin, "premises/P1"), { parents: { wardPcode: "ZA5241006" }, address: { strName: "Main" } }),
      setDoc(doc(admin, "ireps_erfs/E1"), { geometry: JSON.stringify({ type: "Polygon", coordinates: [[[30,-28],[30.01,-28],[30,-28.01],[30,-28]]] }) }),
    ]);
  });
  const boundary = await assertSucceeds(getDoc(doc(db, "ireps_erfs/E1")));
  assert.equal(boundary.exists(), true);
  const rows = (await getDocs(query(collection(db, "bgo_rows"), where("bgoBatchId", "==", batchId)))).docs.map((item) => ({ ...item.data(), id: item.id }));
  const premises = (await assertSucceeds(getDocs(query(collection(db, "premises"), where("parents.wardPcode", "==", "ZA5241006"))))).docs.map((item) => ({ ...item.data(), id: item.id }));
  const metersQuery = query(collection(db, "asts"), where("accessData.parents.lmPcode", "==", "ZA5241"), where("accessData.parents.wardPcode", "==", "ZA5241006"), orderBy("metadata.updatedAt", "desc"));
  let initial;
  let off;
  const receivedInitial = new Promise((resolve) => { initial = resolve; });
  const receivedMeters = new Promise((resolve, reject) => {
    off = onSnapshot(metersQuery, (snapshot) => {
      const meters = snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));
      const display = buildMdBgoMeterRows(enrichMdBgoRows({ rows, premises, meters }));
      if (!meters.length) { assert.equal(display[0].meterNo, "NAv"); initial(); }
      if (display.length === 2) resolve(display);
    }, reject);
  });
  let timer;
  try {
    await receivedInitial;
    await env.withSecurityRulesDisabled(async (context) => {
      for (const n of [1, 2]) await setDoc(doc(context.firestore(), `asts/M${n}`), {
        accessData: { parents: { lmPcode: "ZA5241", wardPcode: "ZA5241006" }, premise: { id: "P1" } },
        ast: { astData: { astNo: `100${n}` } }, metadata: { updatedAt: "2026-11-10T12:00:00Z" },
      });
    });
    const display = await Promise.race([receivedMeters, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Meter discovery stream timed out")), 10000); })]);
    assert.deepEqual(display.map((row) => row.meterNo).sort(), ["1001", "1002"]);
    assert.ok(display.every((row) => row.sourceRowId === "row-1"));
  } finally { clearTimeout(timer); off?.(); }
});
