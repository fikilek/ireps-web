import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInAnonymously } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc } from "firebase/firestore";
import { OFFICIAL_HEADERS } from "../functions/tcUploads/stage1Validation.js";
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp: initializeAdmin, deleteApp: deleteAdmin } = require("firebase-admin/app");
const { getFirestore: adminFirestore } = require("firebase-admin/firestore");
const projectId = "demo-ireps-qa";
let adminApp, db, app, clientDb, uid, call;
const row = (number, meter) => ({ ...Object.fromEntries(OFFICIAL_HEADERS.map((key) => [key, ""])), rowNo: String(number), meterNo: meter, sourcePosition: number + 1 });
const context = { fileName: "Original Name.csv", lmPcode: "ZA5241", lmName: "Endumeni", trnType: "METER_DISCONNECTION" };
before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, "Emulators required; never use hosted data");
  adminApp = initializeAdmin({ projectId }, "trn-stage1-test"); db = adminFirestore(adminApp);
  app = initializeApp({ projectId, apiKey: "demo-key", authDomain: `${projectId}.firebaseapp.com` }, "trn-stage1-client");
  const auth = getAuth(app); connectAuthEmulator(auth, "http://127.0.0.1:9098", { disableWarnings: true });
  uid = (await signInAnonymously(auth)).user.uid;
  const functions = getFunctions(app, "us-central1"); connectFunctionsEmulator(functions, "127.0.0.1", 5003);
  clientDb = getFirestore(app); connectFirestoreEmulator(clientDb, "127.0.0.1", 8087);
  call = httpsCallable(functions, "onValidateTrnBgoStage1Callable");
  await db.doc(`users/${uid}`).set({ accountStatus: "ACTIVE", employment: { role: "MNG" }, access: { workbases: [{ id: "ZA5241", name: "Endumeni" }] } });
  await db.doc("asts/stage1-meter").set({ master: { id: "000123" }, accessData: { parents: { lmPcode: "ZA5241" }, premise: { id: "stage1-premise" } } });
  await db.doc("asts/stage1-wrong-lm").set({ master: { id: "000456" }, accessData: { parents: { lmPcode: "ZA9999" } } });
  await db.doc("premises/stage1-premise").set({ address: { strName: "Test Road" } });
});
after(async () => { await deleteApp(app); await deleteAdmin(adminApp); });

test("real authenticated callable matches resolved source, returns LM feedback, and writes no upload/archive", async () => {
  const collections = ["tc_uploads", "tc_rows", "bgo_batches", "bgo_rows", "trns"];
  const beforeCounts = await Promise.all(collections.map(async (name) => (await db.collection(name).get()).size));
  const rows = [row(1, "000123"), row(2, "000123"), row(3, "000456"), row(4, "009999")];
  const { data } = await call({ ...context, rows, keep: { "000123": "2" } });
  assert.equal(data.context.fileName, context.fileName);
  assert.equal(new Map(data.meterAstEntries).get("000123").id, "stage1-meter");
  assert.equal(new Map(data.premiseEntries).get("stage1-premise").address.strName, "Test Road");
  assert.equal(new Map(data.meterAstEntries).has("009999"), false);
  assert.equal(data.mismatches[0].meterNo, "000456");
  assert.equal(data.mismatches[0].actualLmPcode, "ZA9999");
  for (const header of OFFICIAL_HEADERS) assert.ok(Object.hasOwn(data.mismatches[0], header));
  const afterCounts = await Promise.all(collections.map(async (name) => (await db.collection(name).get()).size));
  assert.deepEqual(afterCounts, beforeCounts);
});

test("all NOT FOUND rows and installation/commissioning context remain valid Stage 1 results", async () => {
  for (const trnType of ["METER_INSTALLATION", "METER_COMMISSIONING"]) {
    const { data } = await call({ ...context, trnType, rows: [row(1, "000-NOT-FOUND")] });
    assert.equal(data.context.trnType, trnType); assert.equal(data.meterAstEntries.length, 0);
  }
});

test("server rejects altered sequence, oversized source and incomplete duplicate choices", async () => {
  for (const payload of [
    { rows: [row(2, "000123")] },
    { rows: Array.from({ length: 201 }, (_, index) => row(index + 1, `M${index}`)) },
    { rows: [row(1, "000123"), row(2, "000123")] },
  ]) await assert.rejects(call({ ...context, ...payload }), (error) => error.code === "functions/invalid-argument");
});

test("callable and exact client rules deny unauthorized roles, inactive accounts, foreign workbases and client writes", async () => {
  for (const patch of [
    { accountStatus: "DISABLED", employment: { role: "MNG" } },
    { accountStatus: "ACTIVE", employment: { role: "FWR" } },
    { accountStatus: "ACTIVE", employment: { role: "MNG" }, access: { workbases: ["ZA9999"] } },
  ]) {
    await db.doc(`users/${uid}`).set({ access: { workbases: ["ZA5241"] }, ...patch });
    await assert.rejects(call({ ...context, rows: [row(1, "000123")] }), (error) => error.code === "functions/permission-denied");
  }
  await db.doc(`users/${uid}`).set({ accountStatus: "ACTIVE", employment: { role: "MNG" }, access: { workbases: ["ZA5241"] } });
  assert.equal((await getDoc(doc(clientDb, "asts/stage1-meter"))).exists(), true);
  await assert.rejects(setDoc(doc(clientDb, "tc_uploads/forged"), { lmPcode: "ZA5241" }), (error) => error.code === "permission-denied");
  const anonymous = initializeApp({ projectId, apiKey: "demo-key" }, "trn-stage1-unsigned");
  try {
    const functions = getFunctions(anonymous); connectFunctionsEmulator(functions, "127.0.0.1", 5003);
    await assert.rejects(httpsCallable(functions, "onValidateTrnBgoStage1Callable")({ ...context, rows: [row(1, "000123")] }), (error) => error.code === "functions/unauthenticated");
  } finally { await deleteApp(anonymous); }
});
