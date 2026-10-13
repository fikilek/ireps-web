import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where } from "firebase/firestore";
import { ref, uploadBytes, deleteObject, getBytes } from "firebase/storage";
import { getQaReview, saveQaReview, sourceVersion, QA_FAILURE_REASONS } from "../functions/qa/review.js";
import { qaState, fieldSubmitter, fieldCapturedAt } from "../functions/qa/model.js";
import { getActivityDate, getUserActivityContribution } from "../functions/reports/reportHelpers.js";
import { assertQaUnlocked } from "../functions/qa/lock.js";
import { serviceProviderPatch, assertManagedUser, stampFieldSubmission } from "../functions/auth/authority.js";
import { stripToDeclaredRoot } from "../functions/transactions/trnShape.js";
import { linkFollowUp, linkReplacementInstallation } from "../functions/meterLifecycle/helpers.js";
import { recordCaptureFailure } from "../functions/meterDiscovery/captureOutcome.js";

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const projectId = "demo-ireps-qa";
const bucketName = `${projectId}.appspot.com`;
let env, app, db, bucket;
const workbase = { id: "ZA5241", name: "Endumeni" };
const user = (role = "SPV", provider = "mnc") => ({ accountStatus: "ACTIVE", employment: { role, serviceProvider: { id: provider } }, access: { workbases: [workbase], activeWorkbase: workbase }, profile: { displayName: `Test ${role}` }, onboarding: { status: "COMPLETED", mustChangePassword: false }, metadata: { createdByUid: "office", updatedByUid: "office" } });
const trn = (patch = {}) => ({ id: "work", accessData: { trnType: "METER_INSPECTION", parents: { lmPcode: "ZA5241", wardPcode: "ZA5241001" }, access: { hasAccess: "yes" }, premise: { id: "premise", address: "1 Test Street" } },
  workflow: { state: "COMPLETED", completedAt: "2026-09-01T08:00:00.000Z", completedByUid: "worker", completedByUser: "Original Worker" },
  origin: { channel: "OFFICE" }, serviceProvider: { id: "sub" }, ast: { astData: { astNo: "123" } },
  metadata: { createdAt: "2026-08-01T08:00:00.000Z", createdByUid: "manager", createdByUser: "Office Creator", updatedAt: "2026-09-01T08:00:00.000Z", updatedByUid: "worker", updatedByUser: "Original Worker", createdOnDevice: "2026-09-01T07:59:00.000Z", createdOnDeviceByUid: "worker", createdOnDeviceByUser: "Original Worker" },
  media: [], ...patch });
const prepare = (uid = "reviewer", id = "work") => getQaReview(db, uid, { trnId: id }, { bucket });
const save = (context, extra = {}, uid = "reviewer") => saveQaReview(db, uid, { trnId: "work", requestId: "request1", sourceVersion: context.sourceVersion, previousReviewId: context.previousReviewId, state: "PASS", comment: "", ...extra });
const code = expected => error => { assert.equal(error.code, expected); return true; };
const client = uid => env.authenticatedContext(uid).firestore();

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "This test must never use a real database");
  assert.ok(process.env.FIREBASE_STORAGE_EMULATOR_HOST, "This test must never use real Storage");
  env = await initializeTestEnvironment({ projectId, firestore: { host: "127.0.0.1", port: 8087, rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") }, storage: { host: "127.0.0.1", port: 9197, rules: await readFile(new URL("../storage.rules", import.meta.url), "utf8") } });
  app = initializeApp({ projectId, storageBucket: bucketName }, "qa-tests"); db = getFirestore(app); bucket = getStorage(app).bucket();
});
beforeEach(async () => {
  await env.clearFirestore(); await env.clearStorage();
  const batch = db.batch();
  for (const [uid, data] of Object.entries({ reviewer: user(), manager: user("MNG"), worker: user("FWR", "sub"), subSupervisor: user("SPV", "sub"), admin: user("ADM"), owner: user("SPU"), stranger: user("MNG", "other") })) batch.set(db.doc(`users/${uid}`), data);
  for (const [id, data] of Object.entries({ mnc: { status: "ACTIVE", clients: [{ id: "ZA5241", name: "Endumeni", clientType: "LM", relationshipType: "MNC" }] }, sub: { status: "ACTIVE", clients: [{ id: "mnc", clientType: "SP", relationshipType: "SUBC" }] }, other: { status: "ACTIVE", clients: [{ id: "ZA5241", name: "Endumeni", clientType: "LM", relationshipType: "MNC" }] } })) batch.set(db.doc(`serviceProviders/${id}`), data);
  batch.set(db.doc("trns/work"), trn()); await batch.commit();
});
after(async () => { await env?.cleanup(); await db?.terminate(); if (app) await deleteApp(app); });

test("Completed hands over to Draft; every historical submitted type is eligible, unfinished ITO is not", () => {
  assert.equal(qaState(trn()), "DRAFT");
  for (const state of ["CREATED", "ISSUED", "ACCEPTED", "DELETED"]) assert.equal(qaState(trn({ workflow: { state } })), "");
  for (const kind of ["DISCOVERY", "INSTALLATION", "DISCONNECTION", "RECONNECTION", "REMOVAL", "INSPECTION", "COMMISSIONING", "READING"]) {
    const record = trn({ workflow: {}, origin: { channel: "FIELD" } }); record.accessData.trnType = `METER_${kind}`; record.accessData.access.hasAccess = "no";
    assert.equal(qaState(record), "DRAFT");
  }
});
test("Pass preserves the exact original, creates one permanent decision, stamps actual reviewer and locks", async () => {
  const before = (await db.doc("trns/work").get()).data(); const context = await prepare();
  assert.equal(context.mayReview, true); assert.equal((await db.doc("trns/work").get()).data().qa, undefined);
  const result = await save(context, { reviewedByUid: "forged", reviewedAt: "1900-01-01" });
  const after = (await db.doc("trns/work").get()).data();
  assert.equal(after.qa.state, "PASS"); assert.equal(after.metadata.updatedByUid, "reviewer");
  assert.equal(after.qa.reviewedByUid, "reviewer"); assert.notEqual(after.qa.reviewedAt, "1900-01-01");
  assert.deepEqual(after.workflow, before.workflow); assert.equal(sourceVersion(after), sourceVersion(before));
  assert.deepEqual((await db.doc(`trns/work/qaVersions/${context.sourceVersion}`).get()).data().snapshot, before);
  const history = await db.collection("trns/work/qaHistory").get(); assert.equal(history.size, 1); assert.equal(history.docs[0].data().action, "QA_PASS");
  assert.throws(() => assertQaUnlocked(after), code("failed-precondition"));
  assert.equal(result.qa.reviewedAt, after.metadata.updatedAt);
  await assert.rejects(save(context, { requestId: "second", previousReviewId: "request1" }), code("failed-precondition"));
});
test("Fail requires a governed reason and nonblank explanation; illegal-connection evidence is included", async () => {
  const context = await prepare();
  for (const extra of [{ state: "FAIL" }, { state: "FAIL", reasonCode: "OTHER", comment: "   " }, { state: "FAIL", reasonCode: "forged", comment: "A reason" }]) await assert.rejects(save(context, extra), code("invalid-argument"));
  assert.ok(QA_FAILURE_REASONS.some(r => r.code === "ILLEGAL_CONNECTION_EVIDENCE"));
  const result = await save(context, { state: "FAIL", reasonCode: "ILLEGAL_CONNECTION_EVIDENCE", comment: "Cable connection not visible" });
  assert.equal(result.qa.reasonLabel, "Illegal connection evidence not clearly showing on photo(s)");
});
test("Only Draft and Updated may pass or fail; all other state changes are refused", async () => {
  for (const current of ["DRAFT", "UPDATED", "FAIL", "PASS", "BROKEN"]) {
    await db.doc("trns/work").set(trn({ qa: { state: current, reviewId: `old-${current}` } }));
    const context = await prepare();
    if (["DRAFT", "UPDATED"].includes(current)) { const result = await save(context, { requestId: current }); assert.equal(result.qa.state, "PASS"); }
    else await assert.rejects(save(context, { requestId: current }), code("failed-precondition"));
  }
  for (const requested of ["DRAFT", "UPDATED", "CREATED", "DELETE", "REOPEN"]) await assert.rejects(save({}, { state: requested }), code("invalid-argument"));
});
test("No role bypass: worker, SUB supervisor, ADM, SPU and another contractor cannot QA", async () => {
  const context = await prepare();
  for (const uid of ["worker", "subSupervisor", "admin", "owner", "stranger"]) await assert.rejects(save(context, { requestId: uid }, uid), code("permission-denied"));
});
test("QA history reads respect provider/workbase boundaries while own submissions remain readable", async () => {
  await assert.rejects(prepare("stranger"), code("permission-denied"));
  await db.doc("users/outsider").set(user("FWR", "other"));
  await assert.rejects(prepare("outsider"), code("permission-denied"));
  for (const uid of ["worker", "subSupervisor", "admin", "owner"]) assert.equal((await prepare(uid)).mayReview, false);
});
test("Delayed capture failures and later follow-up links cannot mutate a passed parent", async () => {
  await save(await prepare());
  const before = (await db.doc("trns/work").get()).data();
  assert.equal((await linkFollowUp({ db, parentTrnId: "work", parentTrnType: "METER_INSPECTION", workTrnType: "METER_DISCONNECTION", trnId: "child", astId: "meter" })).reason, "QA_PASS_LOCKED");
  assert.equal((await linkReplacementInstallation({ db, removalTrnId: "work", installationTrnId: "child" })).reason, "QA_PASS_LOCKED");
  await recordCaptureFailure({ db, trnId: "work", code: "LATE_RETRY", message: "Delayed failure", stage: "CAPTURE" });
  assert.deepEqual((await db.doc("trns/work").get()).data(), before);
});
test("Office creator may review another worker; field submitter may never review their own work after promotion", async () => {
  const context = await prepare("manager"); await save(context, {}, "manager");
  await db.doc("trns/work").set(trn()); await db.doc("users/worker").set(user("MNG"));
  await assert.rejects(save(await prepare(), {}, "worker"), code("permission-denied"));
});
test("Authority changes during review are checked at save: workbase, provider, role and disabled account", async () => {
  const context = await prepare();
  for (const replacement of [user("FWR"), { ...user(), accountStatus: "DISABLED" }, { ...user(), access: { workbases: [] } }, user("SPV", "sub")]) {
    await db.doc("users/reviewer").set(replacement); await assert.rejects(save(context), code("permission-denied"));
  }
});
test("Missing ownership and NAv are gaps, never authority", async () => {
  for (const missing of [{ serviceProvider: {} }, { serviceProvider: { id: "NAv" } }, { metadata: {}, workflow: { state: "COMPLETED" } }]) {
    await db.doc("trns/work").set(trn(missing));
    await assert.rejects(save({ sourceVersion: sourceVersion(trn(missing)) }), code("permission-denied"));
  }
});
test("Stale content cannot be approved; opening without evidence preparation cannot approve", async () => {
  await assert.rejects(save({ sourceVersion: sourceVersion(trn()) }), code("failed-precondition"));
  const context = await prepare(); await db.doc("trns/work").update({ "ast.astData.astNo": "changed" });
  await assert.rejects(save(context), code("aborted")); assert.equal((await db.collection("trns/work/qaHistory").get()).size, 0);
});
test("Retry is idempotent; request IDs cannot be repurposed", async () => {
  const context = await prepare(); const first = await save(context); const second = await save(context);
  assert.equal(second.idempotent, true); assert.equal(second.qa.reviewedAt, first.qa.reviewedAt);
  await assert.rejects(save(context, { comment: "different" }), code("already-exists")); assert.equal((await db.collection("trns/work/qaHistory").get()).size, 1);
});
test("Two competing reviewers commit exactly one decision", async () => {
  const context = await prepare();
  const results = await Promise.allSettled([save(context), save(context, { requestId: "other", state: "FAIL", reasonCode: "OTHER", comment: "Competing decision" }, "manager")]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal((await db.collection("trns/work/qaHistory").get()).size, 1);
});
test("Protected evidence survives overwrite/delete, while an ordinary unreviewed upload can retry", async () => {
  const storage = env.authenticatedContext("worker").storage(`gs://${bucketName}`);
  const object = ref(storage, "meters/lifecycle/field.jpg");
  await assertSucceeds(uploadBytes(object, new Uint8Array([1, 2, 3])));
  await assertSucceeds(uploadBytes(object, new Uint8Array([4, 5, 6])));
  await db.doc("trns/work").update({ media: [{ tag: "anomalyPhoto", type: "image", url: `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/meters%2Flifecycle%2Ffield.jpg?alt=media` }] });
  const context = await prepare(); assert.equal(context.evidence[0].available, true); assert.ok(context.evidence[0].generation);
  const copy = ref(storage, context.evidence[0].preservedPath);
  assert.deepEqual(new Uint8Array(await getBytes(copy)), new Uint8Array([4, 5, 6]));
  await assertFails(uploadBytes(copy, new Uint8Array([9]))); await assertFails(deleteObject(copy));
  // Even a privileged alteration of the original cannot change reviewed history.
  await bucket.file("meters/lifecycle/field.jpg").save(Buffer.from([7]));
  assert.deepEqual(new Uint8Array(await getBytes(copy)), new Uint8Array([4, 5, 6]));
  await assertFails(uploadBytes(object, new Uint8Array([9]))); await assertFails(deleteObject(object));
  await assertSucceeds(getBytes(object));
  await save(context); await assertFails(deleteObject(object));
});
test("An absent evidence file is preserved as unavailable, with a Fail still possible", async () => {
  await db.doc("trns/work").update({ media: [{ url: `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/meters%2Flifecycle%2Fmissing.jpg?alt=media` }] });
  const context = await prepare(); assert.equal(context.evidence[0].available, false);
  await save(context, { state: "FAIL", reasonCode: "PHOTO_MISSING", comment: "File absent" });
  await assertFails(uploadBytes(ref(env.authenticatedContext("worker").storage(`gs://${bucketName}`), "meters/lifecycle/missing.jpg"), new Uint8Array([1])));
});
test("Current nested phone and office evidence paths are copied and permanently protected", async () => {
  const paths = ["meters/lifecycle/disconnection/dcn.jpg", "meters/lifecycle/inspection/ins.jpg", "trns/lifecycle_instructions/work/office.jpg", "lifecycleInstructions/work/web.jpg"];
  const storage = env.authenticatedContext("worker").storage(`gs://${bucketName}`);
  for (const path of paths) await assertSucceeds(uploadBytes(ref(storage, path), new Uint8Array([1, 2, 3])));
  await db.doc("trns/work").update({ media: paths.map(path => ({ type: "image", url: `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media` })) });
  const context = await prepare(); assert.equal(context.evidence.length, paths.length);
  for (const item of context.evidence) {
    assert.equal(item.available, true); assert.ok(item.preservedUrl);
    await assertFails(uploadBytes(ref(storage, item.path), new Uint8Array([9])));
    await assertFails(deleteObject(ref(storage, item.preservedPath)));
  }
});
test("External evidence cannot be mistaken for protected iREPS evidence", async () => {
  await db.doc("trns/work").update({ media: [{ url: "https://example.com/photo.jpg" }] });
  await assert.rejects(prepare(), code("failed-precondition"));
});
test("No client including platform roles can forge/delete QA, versions, evidence locks or TRNs", async () => {
  for (const uid of ["worker", "reviewer", "subSupervisor", "admin", "owner"]) {
    const firestore = client(uid);
    await assertFails(updateDoc(doc(firestore, "trns/work"), { qa: { state: "PASS" } }));
    await assertFails(deleteDoc(doc(firestore, "trns/work")));
    for (const path of ["trns/work/qaHistory/forged", "trns/work/qaVersions/forged", "qaEvidenceLocks/field.jpg"]) await assertFails(setDoc(doc(firestore, path), { forged: true }));
  }
});
test("Self-service cannot change authority, while assigned workbase switching still works", async () => {
  const firestore = client("reviewer"); const profile = doc(firestore, "users/reviewer");
  for (const patch of [{ "employment.role": "MNG" }, { "employment.serviceProvider.id": "other" }, { "access.workbases": [{ id: "other" }] }, { "access.activeWorkbase": { id: "other", name: "Other" } }, { accountStatus: "ACTIVE", "onboarding.mustChangePassword": true }]) await assertFails(updateDoc(profile, patch));
  await assertSucceeds(updateDoc(profile, { "profile.displayName": "Reviewer's name" }));
  await db.doc("users/reviewer").update({ "access.activeWorkbase": null });
  await assertSucceeds(updateDoc(profile, { "access.activeWorkbase": workbase }));
  await assertFails(updateDoc(doc(firestore, "serviceProviders/mnc"), { clients: [{ id: "other" }] }));
});
test("Existing authenticated registry queries work, unauthenticated and inactive access do not", async () => {
  await assertSucceeds(getDocs(query(collection(client("reviewer"), "trns"), where("accessData.parents.lmPcode", "==", "ZA5241"))));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "trns/work")));
  await db.doc("users/reviewer").update({ accountStatus: "DISABLED" }); await assertFails(getDoc(doc(client("reviewer"), "trns/work")));
});
test("Existing web ward boundaries and mobile geography remain readable without client edits", async () => {
  for (const name of ["wards", "districtMunicipalities", "towns"]) {
    await db.doc(`${name}/place`).set({ parents: { localMunicipalityId: "ZA5241" } });
    await assertSucceeds(getDocs(query(collection(client("reviewer"), name), where("parents.localMunicipalityId", "==", "ZA5241"))));
    await assertSucceeds(getDoc(doc(client("worker"), name, "place")));
    await assertFails(updateDoc(doc(client("worker"), name, "place"), { name: "forged" }));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), name, "place")));
  }
});
test("Existing own-profile onboarding and platform status changes work without allowing self-activation", async () => {
  const own = doc(client("reviewer"), "users/reviewer");
  await assertSucceeds(updateDoc(own, { "contact.cell": "0123456789", "profile.email": "contact@example.test", "onboarding.steps.profileCompleted": true }));
  await assertSucceeds(updateDoc(doc(client("owner"), "users/reviewer"), { accountStatus: "DISABLED" }));
  await assertFails(updateDoc(own, { accountStatus: "ACTIVE" }));
  await assertSucceeds(updateDoc(doc(client("owner"), "users/reviewer"), { accountStatus: "ACTIVE" }));
  await assertFails(updateDoc(doc(client("subSupervisor"), "users/reviewer"), { accountStatus: "DISABLED" }));
});
test("Field worker credit/date survive QA; unknown capture time stays unknown; unfinished work is not a visit", () => {
  const original = trn(); const reviewed = { ...original, metadata: { ...original.metadata, updatedAt: "2026-10-13T12:00:00Z", updatedByUid: "reviewer", updatedByUser: "Reviewer" }, qa: { state: "PASS" } };
  assert.deepEqual(fieldSubmitter(reviewed), { uid: "worker", name: "Original Worker" }); assert.equal(fieldCapturedAt(reviewed), original.metadata.createdOnDevice);
  assert.equal(getActivityDate(reviewed), "2026-09-01"); assert.deepEqual(getUserActivityContribution(reviewed), getUserActivityContribution(original));
  assert.equal(getActivityDate(trn({ metadata: { createdAt: "2026-08-01" } })), "NAv");
  assert.equal(getUserActivityContribution(trn({ workflow: { state: "ISSUED" } })).totalTrns, 0);
});
test("Submission shaping cannot inject QA and governance operations cannot escalate another company", () => {
  assert.equal(stripToDeclaredRoot({ ...trn(), qa: { state: "PASS" } }).qa, undefined);
  const forged = stampFieldSubmission({ ...trn(), qa: { state: "PASS" }, workflow: { state: "COMPLETED", completedByUid: "somebodyElse" } }, user("FWR", "sub"));
  assert.deepEqual(forged.workflow, {}); assert.equal(forged.serviceProvider.id, "sub"); assert.equal(forged.qa, undefined); assert.equal(forged.origin.channel, "FIELD");
  assert.throws(() => serviceProviderPatch(user("FWR"), "mnc", { clients: [] }), code("permission-denied"));
  assert.throws(() => serviceProviderPatch(user("MNG"), "mnc", { clients: [] }), code("permission-denied"));
  assert.throws(() => serviceProviderPatch(user("MNG"), "mnc", { "clients.0.id": "other" }), code("permission-denied"));
  assert.throws(() => assertManagedUser(user("MNG"), user("FWR", "other"), []), code("permission-denied"));
});
