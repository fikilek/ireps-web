import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { mdBgoDashboardQueries, subscribeMdBgoDashboard } from "../src/redux/mdBgoDashboardStream.js";
import { buildMdBgoDashboard } from "../src/pages/operations/md-bgo/mdBgoDashboardModel.js";
let env;
before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Emulator required; never use live database");
  env = await initializeTestEnvironment({ projectId: "demo-ireps-qa", firestore: { host: "127.0.0.1", port: 8087, rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") } });
});
after(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "users/manager"), { accountStatus: "ACTIVE", employment: { role: "MNG" } }),
      setDoc(doc(db, "users/inactive"), { accountStatus: "DISABLED", employment: { role: "MNG" } }),
      setDoc(doc(db, "bgo_batches/batch"), { operationType: "METER_DISCOVERY", workflow: { state: "IN_PROGRESS" }, scope: { lmPcode: "ZA5241" }, worklist: { erfRefs: ["ERF-A"] } }),
      setDoc(doc(db, "bgo_rows/row"), { bgoBatchId: "batch", scope: { lmPcode: "ZA5241" }, erf: { id: "ERF-A" }, workflow: { state: "READY_FOR_ALLOCATION" } }),
      setDoc(doc(db, "wards/ward"), { pcode: "ward", parents: { localMunicipalityId: "ZA5241" } }),
      setDoc(doc(db, "registry_wards/summary"), { localMunicipality: { pcode: "ZA5241" }, ward: { pcode: "ward" }, calculation: { state: "READY" }, counts: { totalErfs: 10 } }),
    ]);
  });
});

function watch(uid = "manager", lm = "ZA5241") {
  const snapshots = [], waiters = [];
  const stop = subscribeMdBgoDashboard(env.authenticatedContext(uid).firestore(), lm, source => {
    snapshots.push(source);
    waiters.forEach(waiter => { if (waiter.matches(source)) waiter.resolve(source); });
  });
  const until = matches => {
    const existing = snapshots.find(matches); if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Dashboard stream timed out")), 12000);
      waiters.push({ matches, resolve: value => { clearTimeout(timer); resolve(value); } });
    });
  };
  return { stop, until, snapshots };
}

test("actual dashboard subscriber waits for all four authorized initial server sources", async () => {
  const stream = watch();
  try {
    const ready = await stream.until(source => source.ready);
    assert.equal(ready.error, "");
    for (const key of ["batches", "rows", "wards", "summaries"]) assert.equal(ready[key].length, 1);
    const model = buildMdBgoDashboard(ready); assert.equal(model.total, 1); assert.equal(model.coverage.total, 10); assert.equal(model.coverage.percent, 10);
    assert.ok(stream.snapshots.slice(0, -1).every(source => !source.ready));
  } finally { stream.stop(); }
});

test("new premise and meter writes stream to open workload and discovery charts without changing ERF coverage", async () => {
  const stream = watch();
  try {
    await stream.until(source => source.ready);
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), "bgo_rows/unit-b"), { bgoBatchId: "batch", scope: { lmPcode: "ZA5241" }, erf: { id: "ERF-A" }, refs: { premiseId: "UNIT-B" }, workflow: { state: "IN_PROGRESS" } }));
    const added = buildMdBgoDashboard(await stream.until(source => source.ready && source.rows.length === 2));
    assert.equal(added.total, 2); assert.equal(added.inProgress, 1); assert.equal(added.premises, 1); assert.equal(added.erfs, 1);
    await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), "bgo_rows/unit-b"), { "refs.meterId": "METER-B", "workflow.state": "COMPLETED" }));
    const completed = buildMdBgoDashboard(await stream.until(source => source.ready && source.rows.some(row => row.refs?.meterId === "METER-B")));
    assert.equal(completed.meters, 1); assert.equal(completed.completed, 1); assert.equal(completed.inProgress, 0); assert.equal(completed.coverage.percent, 10);
  } finally { stream.stop(); }
});

test("parent allocation and membership changes plus deletion reach the open dashboard", async () => {
  const stream = watch();
  try {
    await stream.until(source => source.ready);
    await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), "bgo_batches/batch"), { "bgo.targetId": "TEAM", "bgo.targetName": "Peter Team", "workflow.state": "ACCEPTED", "worklist.erfRefs": ["ERF-A", "ERF-B"] }));
    const updated = buildMdBgoDashboard(await stream.until(source => source.ready && source.batches[0]?.workflow?.state === "ACCEPTED"));
    assert.equal(updated.batches[0].team, "Peter Team"); assert.equal(updated.erfs, 2); assert.equal(updated.batches[0].status, "ACCEPTED");
    await env.withSecurityRulesDisabled(context => deleteDoc(doc(context.firestore(), "bgo_batches/batch")));
    const removed = buildMdBgoDashboard(await stream.until(source => source.ready && !source.batches.length)); assert.equal(removed.total, 0); assert.equal(removed.erfs, 0);
  } finally { stream.stop(); }
});

test("ward source and authoritative summary updates stream; missing or pending summaries suppress coverage", async () => {
  const stream = watch();
  try {
    await stream.until(source => source.ready);
    await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), "registry_wards/summary"), { "counts.totalErfs": 20 }));
    assert.equal(buildMdBgoDashboard(await stream.until(source => source.ready && source.summaries[0]?.counts?.totalErfs === 20)).coverage.percent, 5);
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), "wards/new-ward"), { pcode: "new-ward", parents: { localMunicipalityId: "ZA5241" } }));
    assert.equal(buildMdBgoDashboard(await stream.until(source => source.ready && source.wards.length === 2)).coverage.total, null);
  } finally { stream.stop(); }
});

test("all exact dashboard queries deny anonymous and inactive clients; listener errors are surfaced", async () => {
  for (const db of [env.unauthenticatedContext().firestore(), env.authenticatedContext("inactive").firestore()]) {
    for (const source of Object.values(mdBgoDashboardQueries(db, "ZA5241"))) await assertFails(getDocs(source));
  }
  const stream = watch("inactive");
  try { const failure = await stream.until(source => Boolean(source.error)); assert.equal(failure.ready, false); assert.match(failure.error, /permissions|denied/i); }
  finally { stream.stop(); }
});

test("other-LM sources remain isolated and stop detaches all four listeners", async () => {
  const stream = watch("manager", "OTHER-LM");
  const ready = await stream.until(source => source.ready); assert.equal(buildMdBgoDashboard(ready).total, 0); assert.equal(ready.wards.length, 0);
  stream.stop(); const calls = stream.snapshots.length;
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), "wards/other"), { parents: { localMunicipalityId: "OTHER-LM" } }));
  await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(stream.snapshots.length, calls);
  const allowed = await assertSucceeds(getDocs(mdBgoDashboardQueries(env.authenticatedContext("manager").firestore(), "ZA5241").rows)); assert.equal(allowed.size, 1);
});
