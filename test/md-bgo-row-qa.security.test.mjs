import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";
import { mdBgoRowQaSources, subscribeMdBgoRowQa } from "../src/redux/mdBgoRowQaStream.js";
import { enrichMdBgoRowQa } from "../src/pages/operations/md-bgo/mdBgoRowQaModel.js";
let env;
const links = { premiseIds: ["UNIT-A", "UNIT-B", "UNIT-A"], trnIds: ["TRN-A"] };
const rows = [{ premiseId: "UNIT-A", meterId: "TRN-A", progress: "COMPLETED" }, { premiseId: "UNIT-B", progress: "IN_PROGRESS" }];
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
      setDoc(doc(db, "users/worker"), { accountStatus: "ACTIVE", employment: { role: "FWR" } }),
      setDoc(doc(db, "users/inactive"), { accountStatus: "DISABLED", employment: { role: "MNG" } }),
      setDoc(doc(db, "premises/UNIT-A"), { parents: { wardPcode: "WARD-6" }, qa: { status: "QA_PENDING" } }),
      setDoc(doc(db, "premises/UNIT-B"), { qa: { status: "QA_FAIL" } }),
      setDoc(doc(db, "trns/TRN-A"), { workflow: { state: "QA FAIL" } }),
    ]);
  });
});
function watch(uid = "manager", requested = links) {
  const snapshots = [], waiters = [];
  const stop = subscribeMdBgoRowQa(env.authenticatedContext(uid).firestore(), requested, source => {
    snapshots.push(source);
    waiters.forEach(waiter => { if (waiter.matches(source)) waiter.resolve(source); });
  });
  const until = matches => {
    const existing = snapshots.find(matches); if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("QA stream timeout")), 7000);
      waiters.push({ matches, resolve(value) { clearTimeout(timer); resolve(value); } });
    });
  };
  return { stop, until, snapshots };
}
test("exact linked-document stream waits for all server sources and isolates flats", async () => {
  const stream = watch();
  try {
    const source = await stream.until(s => s.ready);
    assert.ok(stream.snapshots.slice(0, -1).every(s => !s.ready));
    assert.equal(Object.keys(source.premises).length, 2);
    const [a, b] = enrichMdBgoRowQa(rows, source);
    assert.equal(a.premiseQa, "QA PENDING"); assert.equal(b.premiseQa, "QA FAIL");
    assert.equal(a.qaFinal, "QA FAIL"); assert.equal(b.qaFinal, "QA NAv");
    assert.match(a.premiseQaHref, /wardPcode=WARD-6/);
  } finally { stream.stop(); }
});
test("later premise/TRN QA changes and deletion reach the open listener without row writes", async () => {
  const stream = watch();
  try {
    await stream.until(s => s.ready);
    await env.withSecurityRulesDisabled(async context => {
      await updateDoc(doc(context.firestore(), "premises/UNIT-A"), { "qa.status": "QA_PASS" });
      await updateDoc(doc(context.firestore(), "trns/TRN-A"), { "workflow.state": "QA PASS" });
    });
    const source = await stream.until(s => s.ready && s.premises["UNIT-A"]?.qa.status === "QA_PASS" && s.trns["TRN-A"]?.workflow.state === "QA PASS");
    assert.equal(enrichMdBgoRowQa(rows, source)[0].qaFinal, "QA PASS");
    await env.withSecurityRulesDisabled(context => deleteDoc(doc(context.firestore(), "trns/TRN-A")));
    const removed = await stream.until(s => s.ready && s.trns["TRN-A"] === null);
    assert.equal(enrichMdBgoRowQa(rows, removed)[0].meterQaHref, "");
    assert.equal(enrichMdBgoRowQa(rows, removed)[0].qaFinal, "QA NAv");
  } finally { stream.stop(); }
});
test("active manager/worker reads succeed; anonymous/inactive reads and direct QA writes fail", async () => {
  for (const uid of ["manager", "worker"]) {
    const db = env.authenticatedContext(uid).firestore();
    for (const { ref } of mdBgoRowQaSources(db, links)) await assertSucceeds(getDoc(ref));
    await assertFails(updateDoc(doc(db, "trns/TRN-A"), { "workflow.state": "QA PASS" }));
    await assertFails(updateDoc(doc(db, "premises/UNIT-A"), { "qa.status": "QA_PASS" }));
  }
  for (const db of [env.unauthenticatedContext().firestore(), env.authenticatedContext("inactive").firestore()]) {
    for (const { ref } of mdBgoRowQaSources(db, links)) await assertFails(getDoc(ref));
  }
  const stream = watch("inactive");
  try { const source = await stream.until(s => !!s.error); assert.equal(source.ready, false); assert.match(source.error, /permission|denied/i); }
  finally { stream.stop(); }
});
test("missing records and empty links are ready/unavailable; unsubscribe stops later publications", async () => {
  const stream = watch("manager", { premiseIds: ["MISSING"], trnIds: [] });
  const source = await stream.until(s => s.ready); assert.equal(source.premises.MISSING, null);
  stream.stop(); const count = stream.snapshots.length;
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), "premises/MISSING"), { qa: { status: "QA_PASS" } }));
  await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(stream.snapshots.length, count);
  const empty = watch("manager", {});
  try { assert.equal((await empty.until(s => s.ready)).error, ""); } finally { empty.stop(); }
});
