import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, or, onSnapshot } from "firebase/firestore";
import { ref, uploadBytes, deleteObject, getBytes } from "firebase/storage";
import { getQaReview, saveQaReview, sourceVersion, QA_FAILURE_REASONS } from "../functions/qa/review.js";
import { qaState, fieldSubmitter, fieldCapturedAt } from "../functions/qa/model.js";
import { getActivityDate, getUserActivityContribution } from "../functions/reports/reportHelpers.js";
import { assertQaUnlocked } from "../functions/qa/lock.js";
import { serviceProviderPatch, assertManagedUser, stampFieldSubmission } from "../functions/auth/authority.js";
import { stripToDeclaredRoot } from "../functions/transactions/trnShape.js";
import { linkFollowUp, linkReplacementInstallation } from "../functions/meterLifecycle/helpers.js";
import { recordCaptureFailure } from "../functions/meterDiscovery/captureOutcome.js";
import { discoveryFixture } from "../functions/test/qa.amendmentFixture.js";
import { getQaAmendment, saveQaAmendment, listQaAmendments } from "../functions/qa/amendments.js";
import { deliverQaEmail } from "../functions/qa/email.js";
import { recordLifecycleNoAccess } from "../functions/noAccess/recordLifecycleNoAccess.js";
import { acceptedSubmission } from "../functions/qa/submissionReceipt.js";
import { markQaNoticeRead } from "../functions/qa/notifications.js";

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

async function seedAmendment() {
  const record = discoveryFixture(bucketName);
  record.workflow = { state: "COMPLETED", completedAt: record.metadata.createdAt, completedByUid: "worker", completedByUser: "Original Worker" };
  for (const item of record.media) {
    const path = decodeURIComponent(new URL(item.url).pathname.split("/o/")[1]);
    await bucket.file(path).save(Buffer.from("Original evidence"));
  }
  await db.doc(`trns/${record.id}`).set(record);
  await db.doc(`asts/${record.id}`).set({ ast: record.ast, media: record.media, status: record.status, meterType: record.meterType,
    metadata: record.metadata, counts: { trns: 1 } });
  return record;
}
const amendContext = (id, uid = "worker") => getQaAmendment(db, uid, { trnId: id }, { bucket });
test("amendment uploads belong to the active author and become immutable evidence", async () => {
  const record = await seedAmendment();
  const path = "qa-amendments/worker/amendment-1/new-photo.jpg";
  const own = env.authenticatedContext("worker").storage(bucketName);
  const other = env.authenticatedContext("reviewer").storage(bucketName);
  await assertSucceeds(uploadBytes(ref(own, path), new Uint8Array([1, 2, 3])));
  await assertFails(uploadBytes(ref(other, path), new Uint8Array([9])));
  const context = await amendContext(record.id);
  await amend(context, { fields: { media: [...record.media, { tag: "anomalyPhoto", url: `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media` }] } });
  await assertFails(uploadBytes(ref(own, path), new Uint8Array([9])));
  await assertFails(deleteObject(ref(own, path)));
  await db.doc("users/worker").update({ accountStatus: "DISABLED" });
  await assertFails(uploadBytes(ref(own, "qa-amendments/worker/amendment-2/another.jpg"), new Uint8Array([1])));
});

test("reading correction preserves the visit's capture identity, baseline and other cache entries", async () => {
  const record = await seedAmendment();
  record.accessData.trnType = "METER_READING";
  record.ast.astData.meter.type = "conventional";
  record.meterReading = { reading: "120", readingAt: record.metadata.createdOnDevice, readingGps: record.ast.location.gps };
  record.media = [{ ...record.media[0], tag: "meterReadingEvidence" }];
  record.executionOutcome = { outcome: "SUCCESSFUL_READING", success: true, currentReading: 120, previousReading: 100,
    previousReadingAt: "2026-08-01T07:00:00Z", previousReadingTrnId: "earlier-reading", consumption: 20 };
  await db.doc(`trns/${record.id}`).set(record);
  const entry = { reading: "120", readingAt: record.metadata.createdOnDevice, trnId: record.id, source: "METER_READING",
    capturedByUid: "worker", capturedByName: "Original Worker", previousReading: 100, previousReadingAt: "2026-08-01T07:00:00Z", previousReadingTrnId: "earlier-reading", consumption: 20 };
  const earlier = { reading: "100", readingAt: "2026-08-01T07:00:00Z", trnId: "earlier-reading", source: "METER_READING" };
  await db.doc(`asts/${record.id}`).update({ ast: record.ast, mreadings: [entry, earlier] });
  const context = await amendContext(record.id);
  const result = await amend(context, { fields: { meterReading: { ...record.meterReading, reading: "125" } } });
  assert.deepEqual(result.amendment.meterProjection.appliedPaths, ["mreadings"]);
  const saved = (await db.doc(`asts/${record.id}`).get()).data();
  assert.deepEqual(saved.mreadings, [{ ...entry, reading: "125", consumption: 25 }, earlier]);
  const corrected = (await db.doc(`trns/${record.id}`).get()).data();
  assert.equal(corrected.executionOutcome.previousReading, 100); assert.equal(corrected.executionOutcome.consumption, 25);
  assert.equal(corrected.metadata.createdByUid, "worker"); assert.equal(saved.counts.trns, 1);
});
function amend(context, extras = {}, uid = "worker") {
  return saveQaAmendment(db, uid, { trnId: context.trnId, sourceVersion: context.sourceVersion,
    previousReviewId: context.previousReviewId, meterVersion: context.meterVersion, requestId: "amendment-1",
    fields: { fieldComment: { text: "Corrected field comment" } }, explanation: "Corrected the recorded detail", ...extras }, { bucket });
}
test("Draft amendment preserves one TRN, original credit and every earlier version", async () => {
  const original = await seedAmendment(), context = await amendContext(original.id);
  const result = await amend(context);
  const after = (await db.doc(`trns/${original.id}`).get()).data();
  assert.equal(result.amendment.state, "DRAFT"); assert.equal(after.id, original.id);
  assert.equal(result.amendment.lmPcode, original.accessData.parents.lmPcode);
  assert.equal(result.amendment.wardPcode, original.accessData.parents.wardPcode);
  assert.equal(after.metadata.createdAt, original.metadata.createdAt);
  assert.equal(after.metadata.createdByUid, "worker"); assert.equal(after.metadata.updatedByUid, "worker");
  assert.equal(fieldCapturedAt(after), fieldCapturedAt(original));
  assert.equal((await db.collection(`trns/${original.id}/qaAmendments`).get()).size, 1);
  assert.equal((await db.collection(`trns/${original.id}/qaVersions`).get()).size, 2);
  assert.deepEqual((await db.doc(`trns/${original.id}/qaVersions/${context.sourceVersion}`).get()).data().snapshot, original);
  assert.equal((await amend(context)).idempotent, true);
  await assert.rejects(amend(context, { explanation: "Different retry" }), code("already-exists"));
});
test("Fail to Updated sends one return notice and one review notice, with no self-review", async () => {
  const original = await seedAmendment(), review = await prepare("reviewer", original.id);
  await save(review, { trnId: original.id, state: "FAIL", reasonCode: "OTHER", comment: "Correct the comment" });
  assert.equal((await db.collection("qaNotifications").where("recipientUid", "==", "worker").get()).size, 1);
  const context = await amendContext(original.id);
  assert.equal((await amend(context)).amendment.state, "UPDATED");
  await amend(context);
  assert.equal((await db.collection("qaNotifications").get()).size, 2);
  assert.equal((await db.collection("qaEmailOutbox").get()).size, 2);
  for (const collection of ["qaNotifications", "qaEmailOutbox"]) {
    for (const doc of (await db.collection(collection).get()).docs) {
      assert.equal(doc.data().lmPcode, original.accessData.parents.lmPcode);
      assert.equal(doc.data().wardPcode, original.accessData.parents.wardPcode);
    }
  }
  await assert.rejects(amendContext(original.id), code("permission-denied"));
  await db.doc("users/worker").set(user("MNG"));
  assert.equal((await prepare("worker", original.id)).mayReview, false);
  const nextReview = await prepare("manager", original.id);
  assert.equal(nextReview.snapshot.fieldComment.text, "Corrected field comment");
  assert.equal(nextReview.amendments.length, 1);
  await save(nextReview, { trnId: original.id, requestId: "final-review" }, "manager");
  await assert.rejects(amendContext(original.id), code("permission-denied"));
});
test("MNC supervisor takeover requires evidence the submitter left and a recorded reason", async () => {
  const original = await seedAmendment();
  await save(await prepare("manager", original.id), { trnId: original.id, state: "FAIL", reasonCode: "OTHER", comment: "Correct it" }, "manager");
  await assert.rejects(amendContext(original.id, "reviewer"), code("permission-denied"));
  await db.doc("users/worker").update({ accountStatus: "DISABLED" });
  for (const uid of ["manager", "subSupervisor", "stranger"]) await assert.rejects(amendContext(original.id, uid), code("permission-denied"));
  const context = await amendContext(original.id, "reviewer"); assert.equal(context.takeover, true);
  await assert.rejects(amend(context, {}, "reviewer"), code("invalid-argument"));
  await amend(context, { takeoverReason: "Submitter left the company; account disabled" }, "reviewer");
  assert.equal((await prepare("reviewer", original.id)).mayReview, false);
});
test("Old amendments retain newer meter findings and require explicit acknowledgement", async () => {
  const original = await seedAmendment();
  await db.doc("trns/later-inspection").set({ ...trn(), ast: original.ast, metadata: { ...original.metadata, createdOnDevice: "2026-09-02T07:00:00Z" } });
  await db.doc(`asts/${original.id}`).update({ "ast.astData.astManufacturer": "Newer field finding" });
  const context = await amendContext(original.id), ast = structuredClone(original.ast);
  ast.astData.astManufacturer = "Corrected original finding";
  await assert.rejects(amend(context, { fields: { ast } }), error => { assert.equal(error.details.kind, "RETAIN_METER_FACTS"); return true; });
  await amend(context, { fields: { ast }, retainNewerMeterFacts: true });
  assert.equal((await db.doc(`asts/${original.id}`).get()).data().ast.astData.astManufacturer, "Newer field finding");
  assert.equal((await db.doc(`trns/${original.id}`).get()).data().ast.astData.astManufacturer, "Corrected original finding");
});
test("Current amendment changes only matching meter fields and never the visit count", async () => {
  const original = await seedAmendment(), context = await amendContext(original.id), ast = structuredClone(original.ast);
  ast.astData.astManufacturer = "Corrected manufacturer";
  await amend(context, { fields: { ast } });
  const meter = (await db.doc(`asts/${original.id}`).get()).data();
  assert.equal(meter.ast.astData.astManufacturer, "Corrected manufacturer"); assert.equal(meter.counts.trns, 1);
  assert.equal(meter.metadata.updatedByUid, "worker");
});
test("A concurrent review or amendment prevents a stale save", async () => {
  const original = await seedAmendment(), context = await amendContext(original.id);
  const results = await Promise.allSettled([amend(context), amend(context, { requestId: "amendment-2", fields: { fieldComment: { text: "Competing correction" } } })]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const next = await amendContext(original.id);
  await save(await prepare("reviewer", original.id), { trnId: original.id });
  await assert.rejects(amend(next, { requestId: "stale" }), code("permission-denied"));
});
test("Returned work is scoped; notices are recipient-only and cannot be forged", async () => {
  const original = await seedAmendment();
  assert.ok((await listQaAmendments(db, "worker")).items.some(item => item.trnId === original.id));
  assert.equal((await listQaAmendments(db, "stranger")).items.length, 0);
  await save(await prepare("reviewer", original.id), { trnId: original.id, state: "FAIL", reasonCode: "OTHER", comment: "Correction" });
  const failed = (await listQaAmendments(db, "worker")).items.find(item => item.trnId === original.id);
  assert.equal(failed.reviewedByUid, "reviewer");
  assert.equal(failed.reviewedByUser, "Test SPV");
  assert.equal(failed.reviewedAt, (await db.doc(`trns/${original.id}`).get()).data().qa.reviewedAt);
  const notice = (await db.collection("qaNotifications").get()).docs[0];
  await assertSucceeds(getDoc(doc(client("worker"), "qaNotifications", notice.id)));
  await assertFails(getDoc(doc(client("reviewer"), "qaNotifications", notice.id)));
  await assertFails(updateDoc(doc(client("worker"), "qaNotifications", notice.id), { readAt: "forged" }));
  await assertFails(getDoc(doc(client("worker"), "qaEmailOutbox", notice.id)));
  await markQaNoticeRead(db, "worker", { id: notice.id });
  assert.equal((await notice.ref.get()).data().metadata.updatedByUid, "worker");
});

test("Returned-work TRN listener sees reviews without notices; server excludes other owners and non-editable states", async t => {
  const batch = db.batch();
  for (const state of ["DRAFT", "FAIL", "PASS", "UPDATED"]) batch.set(db.doc(`trns/${state}`), trn({ id: state, workflow: { ...trn().workflow, state: state === "DRAFT" ? "COMPLETED" : `QA ${state}` } }));
  const other = trn({ id: "other" }); other.workflow.completedByUid = "reviewer";
  // A historical creator/device match cannot make this somebody else's submission.
  other.metadata.createdByUid = "worker";
  batch.set(db.doc("trns/other"), other);
  const outside = trn({ id: "outside", serviceProvider: { id: "other" } });
  batch.set(db.doc("trns/outside"), outside);
  await batch.commit();
  const rows = (await listQaAmendments(db, "worker")).items;
  assert.deepEqual(rows.map(item => item.trnId).sort(), ["DRAFT", "FAIL", "work"]);
  const source = query(collection(client("worker"), "trns"), or(
    where("workflow.completedByUid", "==", "worker"), where("metadata.createdOnDeviceByUid", "==", "worker"), where("metadata.createdByUid", "==", "worker")));
  let initial, changed;
  const ready = new Promise((resolve, reject) => { initial = { resolve, reject }; });
  const update = new Promise((resolve, reject) => { changed = { resolve, reject }; });
  const stop = onSnapshot(source, { includeMetadataChanges: true }, snap => {
    if (snap.metadata.fromCache) return;
    initial.resolve();
    if (snap.docs.some(item => item.id === "FAIL" && item.data().workflow?.state === "QA UPDATED")) changed.resolve();
  }, error => { initial.reject(error); changed.reject(error); });
  t.after(stop);
  await ready;
  await db.doc("trns/FAIL").update({ "workflow.state": "QA UPDATED" });
  await update;
  assert.ok(!(await listQaAmendments(db, "worker")).items.some(item => item.trnId === "FAIL"));
  assert.equal((await db.collection("qaNotifications").get()).size, 0);
  await db.doc("users/worker").update({ accountStatus: "DISABLED" });
  await assert.rejects(listQaAmendments(db, "worker"), code("permission-denied"));
});
test("Concurrent email delivery and retry send once; ambiguous SMTP never resends", async () => {
  const original = await seedAmendment();
  await save(await prepare("reviewer", original.id), { trnId: original.id, state: "FAIL", reasonCode: "OTHER", comment: "Correction" });
  const job = (await db.collection("qaEmailOutbox").get()).docs[0];
  const auth = { getUser: async () => ({ email: "fixture@example.test", emailVerified: true, disabled: false }) };
  let calls = 0;
  const sendMail = async mail => { calls++; assert.match(mail.messageId, /^<qa-/); return { accepted: [mail.to], rejected: [] }; };
  await Promise.all([deliverQaEmail(db, job.id, { auth, sendMail }), deliverQaEmail(db, job.id, { auth, sendMail })]);
  assert.equal(calls, 1); assert.equal((await job.ref.get()).data().status, "SENT");
  await job.ref.update({ status: "PENDING", nextAttemptAt: "2026-01-01" });
  const ambiguous = async () => { calls++; const error = new Error("Timeout after DATA"); error.command = "DATA"; error.code = "ETIMEDOUT"; throw error; };
  await deliverQaEmail(db, job.id, { auth, sendMail: ambiguous });
  await deliverQaEmail(db, job.id, { auth, sendMail: ambiguous });
  assert.equal(calls, 2); assert.equal((await job.ref.get()).data().status, "UNCERTAIN");
});

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
  assert.equal(after.workflow.state, "QA PASS"); assert.equal(after.qa.state, undefined); assert.equal(after.metadata.updatedByUid, "reviewer");
  assert.equal(after.qa.reviewedByUid, "reviewer"); assert.notEqual(after.qa.reviewedAt, "1900-01-01");
  assert.deepEqual(after.workflow, { ...before.workflow, state: "QA PASS" }); assert.notEqual(sourceVersion(after), sourceVersion(before));
  assert.deepEqual((await db.doc(`trns/work/qaVersions/${context.sourceVersion}`).get()).data().snapshot, before);
  const history = await db.collection("trns/work/qaHistory").get(); assert.equal(history.size, 1); assert.equal(history.docs[0].data().action, "QA_PASS");
  assert.throws(() => assertQaUnlocked(after), code("failed-precondition"));
  assert.equal(result.qa.reviewedAt, after.metadata.updatedAt);
  await assert.rejects(save(context, { requestId: "second", previousReviewId: "request1" }), code("failed-precondition"));
});
test("Fail requires a governed reason but permits an optional explanation in Draft and Updated", async () => {
  const context = await prepare();
  for (const extra of [{ state: "FAIL" }, { state: "FAIL", comment: "An explanation alone is insufficient" }, { state: "FAIL", reasonCode: "forged", comment: "A reason" }, { state: "FAIL", reasonCode: "OTHER", comment: "x".repeat(4001) }]) await assert.rejects(save(context, extra), code("invalid-argument"));
  assert.ok(QA_FAILURE_REASONS.some(r => r.code === "ILLEGAL_CONNECTION_EVIDENCE"));
  for (const state of ["DRAFT", "UPDATED"]) {
    for (const [index, comment] of [undefined, "", "   ", " Cable connection not visible "].entries()) {
      await db.doc("trns/work").set(trn({ workflow: { ...trn().workflow, state: state === "DRAFT" ? "COMPLETED" : `QA ${state}` } }));
      const current = await prepare(), requestId = `optional-${state}-${index}`;
      const reasonCode = index === 0 ? "OTHER" : "ILLEGAL_CONNECTION_EVIDENCE";
      const result = await save(current, { requestId, state: "FAIL", reasonCode, comment });
      assert.equal(result.qa.comment, (comment || "").trim());
      assert.equal(result.qa.ruleVersion, 2);
      assert.equal(result.qa.reasonCode, reasonCode);
      if (index !== 0) assert.equal(result.qa.reasonLabel, "Illegal connection evidence not clearly showing on photo(s)");
      const saved = (await db.doc("trns/work").get()).data();
      assert.equal(saved.workflow.state, "QA FAIL"); assert.equal(saved.qa.state, undefined);
      assert.equal(saved.metadata.updatedByUid, "reviewer");
      assert.equal(saved.metadata.updatedAt, result.qa.reviewedAt);
      assert.equal((await db.doc(`trns/work/qaHistory/${requestId}`).get()).data().comment, result.qa.comment);
    }
  }
});
test("Only Draft and Updated may pass or fail; all other state changes are refused", async () => {
  for (const current of ["DRAFT", "UPDATED", "FAIL", "PASS", "BROKEN"]) {
    await db.doc("trns/work").set(trn({ workflow: { ...trn().workflow, state: current === "DRAFT" ? "COMPLETED" : current === "BROKEN" ? "BROKEN" : `QA ${current}` }, qa: { reviewId: `old-${current}` } }));
    const context = await prepare();
    if (["DRAFT", "UPDATED"].includes(current)) { const result = await save(context, { requestId: current }); assert.equal(result.qa.state, "PASS"); }
    else await assert.rejects(save(context, { requestId: current }), code(current === "BROKEN" ? "permission-denied" : "failed-precondition"));
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
  const forged = stampFieldSubmission({ ...trn(), qa: { state: "PASS" }, workflow: { state: "COMPLETED", completedByUid: "somebodyElse" } }, user("FWR", "sub"), { uid: "worker", name: "Original Worker", at: "2026-10-15T12:00:00.000Z" });
  assert.deepEqual(forged.workflow, { state: "COMPLETED", completedByUid: "worker", completedByUser: "Original Worker", completedAt: "2026-10-15T12:00:00.000Z" }); assert.equal(forged.serviceProvider.id, "sub"); assert.equal(forged.qa, undefined); assert.equal(forged.origin.channel, "FIELD");
  assert.throws(() => serviceProviderPatch(user("FWR"), "mnc", { clients: [] }), code("permission-denied"));
  assert.throws(() => serviceProviderPatch(user("MNG"), "mnc", { clients: [] }), code("permission-denied"));
  assert.throws(() => serviceProviderPatch(user("MNG"), "mnc", { "clients.0.id": "other" }), code("permission-denied"));
  assert.throws(() => assertManagedUser(user("MNG"), user("FWR", "other"), []), code("permission-denied"));
});

test("v3 correction stamps and immutable after-version survive final review and delayed retries", async () => {
  const original = await seedAmendment();
  const first = await prepare("reviewer", original.id);
  const failInput = { trnId: original.id, requestId: "fail-v3", sourceVersion: first.sourceVersion,
    previousReviewId: first.previousReviewId, state: "FAIL", reasonCode: "OTHER" };
  await saveQaReview(db, "reviewer", failInput);
  const context = await amendContext(original.id);
  const result = await amend(context);
  assert.equal(result.workflowState, "QA UPDATED");
  const updated = (await db.doc(`trns/${original.id}`).get()).data();
  assert.equal(updated.qa.state, undefined);
  assert.equal(updated.workflow.completedByUid, "worker");
  assert.equal(updated.workflow.completedAt, result.amendment.at);
  assert.equal(sourceVersion(updated), result.amendment.afterVersion);
  const version = (await db.doc(`trns/${original.id}/qaVersions/${result.amendment.afterVersion}`).get()).data();
  assert.equal(version.snapshot.workflow.state, "QA UPDATED");
  assert.equal(sourceVersion(version.snapshot), version.sourceVersion);
  const beforePassStamp = updated.workflow;
  const last = await prepare("manager", original.id);
  await save(last, { trnId: original.id, requestId: "pass-v3" }, "manager");
  const passed = (await db.doc(`trns/${original.id}`).get()).data();
  assert.deepEqual(passed.workflow, { ...beforePassStamp, state: "QA PASS" });
  const retried = await amend(context);
  assert.equal(retried.idempotent, true);
  assert.equal(retried.workflowState, "QA PASS");
  assert.equal(retried.amendment.state, "UPDATED");
  assert.equal((await saveQaReview(db, "reviewer", failInput)).workflowState, "QA PASS");
  assert.equal(await acceptedSubmission({ get: ref => ref.get() }, db, original.id, passed, original, "worker"), true);
  assert.equal(await acceptedSubmission({ get: ref => ref.get() }, db, original.id, passed, { ...original, fieldComment: { text: "Fresh write" } }, "worker"), false);
  assert.deepEqual((await db.doc(`trns/${original.id}`).get()).data(), passed);
});

test("No Access completes original instruction once, preserves PASS and refuses a fresh capture", async () => {
  const id = "TRN_MDCN_1_ELC_ZA5241001_1";
  await db.doc("ireps_erfs/erf").set({ admin: { localMunicipality: { pcode: "ZA5241" }, ward: { pcode: "ZA5241001" } } });
  await db.doc("premises/premise").set({ erfId: "erf", address: { strNo: "1", strName: "Test", strType: "Street" }, propertyType: { type: "House" } });
  await db.doc("asts/meter").set({ accessData: { erfId: "erf", premise: { id: "premise" } },
    ast: { astData: { astId: "meter", astNo: "123" }, location: { gps: { lat: -28, lng: 30 } } }, status: { state: "CONNECTED" } });
  const instruction = { ...trn(), id, ast: { astData: { astId: "meter" } },
    accessData: { ...trn().accessData, trnType: "METER_DISCONNECTION" },
    assignment: { targets: [{ type: "USER", id: "worker" }] }, workflow: { state: "ACCEPTED" } };
  await db.doc(`trns/${id}`).set(instruction);
  const payload = { id, astId: "meter", accessData: { trnType: "METER_DISCONNECTION", erfId: "erf",
    premise: { id: "premise" }, access: { hasAccess: "no", reasonCode: "Property Locked" } },
    metadata: { createdOnDevice: "2026-10-15T10:00:00.000Z", createdOnDeviceByUid: "worker" },
    media: [{ tag: "noAccessPhoto", url: `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/meters%2Fqa-fixture%2Fnoaccess.jpg?alt=media` }] };
  await bucket.file("meters/qa-fixture/noaccess.jpg").save(Buffer.from("No Access evidence"));
  const submit = data => recordLifecycleNoAccess({ db, data, actor: { uid: "worker", name: "Original Worker" }, now: "2026-10-15T11:00:00.000Z", isOffice: true });
  assert.equal((await submit(payload)).workflowState, "COMPLETED");
  const completed = (await db.doc(`trns/${id}`).get()).data();
  assert.equal(completed.metadata.createdAt, instruction.metadata.createdAt);
  await save(await prepare("manager", id), { trnId: id, requestId: "no-access-pass" }, "manager");
  const passed = (await db.doc(`trns/${id}`).get()).data();
  assert.equal((await submit(payload)).workflowState, "QA PASS");
  assert.equal((await submit(payload)).idempotent, true);
  await assert.rejects(submit({ ...payload, accessData: { ...payload.accessData, access: { hasAccess: "no", reasonCode: "Other", reasonOther: "Different capture" } } }));
  assert.deepEqual((await db.doc(`trns/${id}`).get()).data(), passed);
  assert.equal((await db.doc("asts/meter").get()).data().counts.noAccess, 1);
  await db.doc("users/worker").update({ accountStatus: "DISABLED" });
  await assert.rejects(submit(payload));
});

test("Original submitter keeps history visibility after takeover without regaining correction authority", async () => {
  await db.doc("trns/work").update({ "workflow.completedByUid": "reviewer", "workflow.completedByUser": "Takeover supervisor", "workflow.state": "QA FAIL" });
  const context = await prepare("worker");
  assert.equal(context.workflowState, "QA FAIL");
  assert.equal(context.mayReview, false);
  await assert.rejects(amendContext("work", "worker"), code("permission-denied"));
});
