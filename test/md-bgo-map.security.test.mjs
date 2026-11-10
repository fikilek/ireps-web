import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";
import { subscribeMdBgoMap } from "../src/pages/operations/md-bgo/mdBgoMapStream.js";

let env;
const batchId = "MD_BGO_MAP_TEST";
const lmPcode = "ZA5241";
before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Never run this suite against a real database");
  env = await initializeTestEnvironment({ projectId: "demo-ireps-qa", firestore: { host: "127.0.0.1", port: 8087, rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") } });
});
after(async () => { await env?.cleanup(); });
const admin = (fn) => env.withSecurityRulesDisabled((context) => fn(context.firestore()));
beforeEach(async () => {
  await env.clearFirestore();
  await admin(async (db) => {
    await Promise.all([
      setDoc(doc(db, "users/manager"), { accountStatus: "ACTIVE", employment: { role: "MNG" } }),
      setDoc(doc(db, "users/disabled"), { accountStatus: "DISABLED", employment: { role: "MNG" } }),
      setDoc(doc(db, "bgo_batches", batchId), { id: batchId, batchMode: "BMD", operationType: "METER_DISCOVERY", scope: { lmPcode }, geofenceRef: { id: "g1", name: "Geofence 1" } }),
      setDoc(doc(db, "bgo_rows/r1"), { id: "r1", rowNo: 1, bgoBatchId: batchId, erf: { id: "e1" } }),
      setDoc(doc(db, "ireps_erfs/e1"), { sg: { parcelNo: "25" }, geometry: JSON.stringify({ type: "Polygon", coordinates: [[[30,-28],[30.01,-28],[30.01,-28.01],[30,-28]]] }) }),
      setDoc(doc(db, "geo_fences/g1"), { name: "Geofence 1", geometry: { points: [{ lat: -28, lng: 30 }, { lat: -28.01, lng: 30 }, { lat: -28, lng: 30.01 }] } }),
      setDoc(doc(db, "premises/unrelated"), { erfId: "e1" }),
      setDoc(doc(db, "asts/unrelated"), { accessData: { premise: { id: "unrelated" } } }),
    ]);
  });
});

function openMap(db, municipality = lmPcode) {
  let latest;
  const waits = new Set();
  const stop = subscribeMdBgoMap(db, { batchId, lmPcode: municipality }, (value) => {
    latest = value;
    for (const waiter of waits) if (waiter.predicate(value)) waiter.resolve(value);
  });
  return { stop, wait(predicate) {
    if (latest && predicate(latest)) return Promise.resolve(latest);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waits.delete(waiter); reject(new Error(`Map stream timed out: ${JSON.stringify(latest)}`)); }, 15000);
      const waiter = { predicate, resolve: (value) => { clearTimeout(timer); waits.delete(waiter); resolve(value); } };
      waits.add(waiter);
    });
  } };
}

test("seed ERF becomes distinct premise/meter rows, stays live, and drops removed membership", async () => {
  const stream = openMap(env.authenticatedContext("manager").firestore());
  try {
    const initial = await stream.wait((value) => value.ready && value.erfs.length === 1);
    assert.equal(initial.error, "");
    assert.equal(initial.membership.rowCount, 1);
    assert.equal(initial.premises.length, 0);
    assert.equal(initial.meters.length, 0);
    assert.equal(initial.geofence.name, "Geofence 1");
    await admin(async (db) => {
      for (const n of [1, 2]) {
        await setDoc(doc(db, `premises/p${n}`), { erfId: "e1", address: { strName: `Unit ${n}` }, geometry: { centroid: { lat: -28, lng: 30 } } });
        await setDoc(doc(db, `asts/m${n}`), { accessData: { premise: { id: `p${n}` } }, ast: { astData: { astNo: `M${n}` }, location: { gps: { lat: -28, lng: 30 } } } });
        await setDoc(doc(db, `bgo_rows/r${n}`), { id: `r${n}`, rowNo: n, bgoBatchId: batchId, erf: { id: "e1" }, refs: { premiseId: `p${n}` } });
      }
    });
    const flats = await stream.wait((value) => value.ready && value.premises.length === 2 && value.meters.length === 2);
    assert.equal(flats.membership.rowCount, 2);
    assert.equal(flats.erfs.length, 1, "one polygon for a shared ERF");
    assert.deepEqual(flats.meters.map((meter) => meter.linkedPremiseId).sort(), ["p1", "p2"]);
    await admin(async (db) => {
      await updateDoc(doc(db, "asts/m2"), { "ast.astData.astNo": "UPDATED" });
      await updateDoc(doc(db, "geo_fences/g1"), { name: "Updated Geofence" });
    });
    await stream.wait((value) => value.ready && value.meters.some((meter) => meter.number === "UPDATED") && value.geofence?.name === "Updated Geofence");
    await admin((db) => deleteDoc(doc(db, "bgo_rows/r2")));
    const removed = await stream.wait((value) => value.ready && value.membership.rowCount === 1 && value.premises.length === 1 && value.meters.length === 1);
    assert.equal(removed.premises[0].id, "p1");
    assert.equal(removed.meters[0].id, "m1");
    await admin((db) => updateDoc(doc(db, "bgo_rows/r1"), { "refs.meterId": "missing-meter" }));
    const missing = await stream.wait((value) => value.ready && value.diagnostics.missingMeterCount === 1);
    assert.deepEqual(missing.diagnostics.missingMeterIds, ["missing-meter"]);
    await admin((db) => deleteDoc(doc(db, "bgo_batches", batchId)));
    const deleted = await stream.wait((value) => value.ready && !value.batch);
    assert.equal(deleted.erfs.length, 0);
  } finally { stream.stop(); }
});

test("more than 30 referenced ERFs are streamed in bounded chunks", async () => {
  await admin(async (db) => {
    for (let n = 2; n <= 32; n++) {
      await setDoc(doc(db, `ireps_erfs/e${n}`), { erfNo: String(n) });
      await setDoc(doc(db, `bgo_rows/r${n}`), { rowNo: n, bgoBatchId: batchId, erf: { id: `e${n}` } });
    }
  });
  const stream = openMap(env.authenticatedContext("manager").firestore());
  try { await stream.wait((value) => value.ready && value.erfs.length === 32); }
  finally { stream.stop(); }
});

test("actual map subscriptions report denied clients and wrong workbase", async () => {
  for (const db of [env.unauthenticatedContext().firestore(), env.authenticatedContext("disabled").firestore()]) {
    const stream = openMap(db);
    try { const result = await stream.wait((value) => value.ready && value.error); assert.match(result.error, /permission/i); }
    finally { stream.stop(); }
  }
  const stream = openMap(env.authenticatedContext("manager").firestore(), "OTHER_LM");
  try {
    const result = await stream.wait((value) => value.ready && value.error);
    assert.match(result.error, /workbase/);
    assert.equal(result.erfs.length, 0);
  } finally { stream.stop(); }
});
