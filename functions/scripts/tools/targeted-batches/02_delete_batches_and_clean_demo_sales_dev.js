import fs from "fs";
import path from "path";
import crypto from "crypto";
import {fileURLToPath} from "url";
import admin from "firebase-admin";
import {
  RESET_SCHEMA_VERSION, RESET_POLICY, EXPECTED_PROJECT_ID, validatePreflight,
  cleanPremiseIds, classifySalesTbTrn, inventoryPathWithinRoot,
  assertExpectedUpdateTime, exactUpdateTime, makeLastUpdateTime,
  assessStorageLiveState, assessSalesCollection, RESET_MANIFEST_VERSION,
} from "./targetedBatchReset.helpers.js";

const DEFAULT_SERVICE_ACCOUNT = "C:\\dev\\secrets\\ireps2-e72fd9dc94de.json";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
const REPORTS_ROOT = path.join(ROOT, "docs", "reports", "targeted-batch-reset", "generated");
const arg = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const readJsonl = (file) => fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
const hashFile = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const snapshotUpdateTime = (snapshot) => snapshot?.updateTime ? exactUpdateTime(snapshot.updateTime) : null;
const precondition = (value) => makeLastUpdateTime(value, admin.firestore.Timestamp);
async function count(db, name) { return (await db.collection(name).count().get()).data().count; }
async function exactDocs(db, rows, collection, idKey) { return Promise.all(rows.map(async (row) => ({row, snap: await db.collection(collection).doc(row[idKey]).get()}))); }
async function allSales(db) { const snapshot = await db.collection("demo_sales_meters").orderBy(admin.firestore.FieldPath.documentId()).get(); return snapshot.docs.map((snap) => ({documentId: snap.id, documentPath: snap.ref.path, updateTime: exactUpdateTime(snap.updateTime), data: snap.data()})); }
async function liveObject(bucket, object) { try { const [metadata] = await bucket.file(object.objectPath).getMetadata(); return {metadata, error: null}; } catch (error) { return {metadata: null, error}; } }
function assertExactPath(pathValue, collection, id) { if (pathValue !== `${collection}/${id}` || !id || id.includes("/")) throw new Error(`Unsafe exact path: ${pathValue}`); }
function realPath(file) { return fs.realpathSync.native ? fs.realpathSync.native(file) : fs.realpathSync(file); }
function validateInventoryFile(file) { const result = inventoryPathWithinRoot(file, REPORTS_ROOT, {root: realPath(REPORTS_ROOT), candidate: realPath(file)}); if (!result.valid) throw new Error(result.reason); return result.inventoryPath; }
function validateArtifactPath(file, inventoryPath) { validateInventoryFile(path.join(path.dirname(inventoryPath), "inventory.json")); const relative = path.relative(path.dirname(inventoryPath), path.resolve(file)); if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`INVENTORY_ARTIFACT_PATH_ESCAPE ${file}`); }
async function guardedWrite({ref, collection, id, expectedUpdateTime, operation}) {
  try { return await operation(precondition(expectedUpdateTime)); } catch (error) {
    if (![5, 9, "not-found", "failed-precondition"].includes(error?.code)) throw error;
    const actual = await ref.get();
    throw new Error(`STALE_WRITE_REJECTED ${collection}/${id} expected=${JSON.stringify(expectedUpdateTime)} actual=${actual.exists ? JSON.stringify(snapshotUpdateTime(actual)) : "<missing>"}`);
  }
}

async function main() {
  const projectId = arg("--project-id", EXPECTED_PROJECT_ID); const confirmToken = arg("--confirm", "");
  const serviceAccountPath = arg("--service-account", process.env.IREPS_DEV_SERVICE_ACCOUNT || DEFAULT_SERVICE_ACCOUNT);
  const pointerPath = path.join(REPORTS_ROOT, "LATEST_INVENTORY.json"); const pointer = readJson(pointerPath);
  const inventoryPath = validateInventoryFile(pointer.inventoryPath); const inventory = readJson(inventoryPath); const credential = readJson(serviceAccountPath);
  const artifacts = [...Object.values(inventory.exports || {}), ...Object.values(inventory.manifests || {})]; let hashesMatch = true;
  for (const item of artifacts) { if (!item?.path) { hashesMatch = false; continue; } validateArtifactPath(item.path, inventoryPath); if (!fs.existsSync(item.path) || hashFile(item.path) !== item.sha256) hashesMatch = false; }
  const trns = readJsonl(inventory.manifests.salesTbNaTrns.path); const premises = readJsonl(inventory.manifests.salesTbNaPremises.path); const erfs = readJsonl(inventory.manifests.salesTbNaErfs.path); const objects = readJsonl(inventory.manifests.salesTbNaStorageObjects.path); const ambiguous = readJsonl(inventory.manifests.ambiguousSalesTbTrns.path);
  const rowTargets = readJsonl(inventory.exports.tb_rows.path); const uploadTargets = readJsonl(inventory.exports.tb_uploads.path); const salesExport = readJsonl(inventory.exports.demo_sales_meters.path); const salesTargets = salesExport.filter((row) => Object.hasOwn(row.data, "tbRefs"));
  let guard = validatePreflight({projectId, serviceAccountProject: credential.project_id, confirmToken, inventory, hashesMatch, ambiguousTrns: ambiguous.length, ambiguousStorage: objects.some((item) => !item.deletionEligible)});
  if (pointer.projectId !== EXPECTED_PROJECT_ID || pointer.runId !== inventory.runId || inventoryPath !== path.resolve(pointer.inventoryPath) || inventory.manifestVersion !== RESET_MANIFEST_VERSION || trns.some((row) => row.manifestVersion !== RESET_MANIFEST_VERSION)) guard.errors.push("LATEST_POINTER_OR_MANIFEST_INVALID");
  if (guard.errors.length) throw new Error(`Preflight blocked: ${guard.errors.join(", ")}`);
  trns.forEach((row) => assertExactPath(row.trnPath, "trns", row.trnId)); premises.forEach((row) => assertExactPath(row.premisePath, "premises", row.premiseId)); erfs.forEach((row) => assertExactPath(`registry_erfs/${row.erfId}`, "registry_erfs", row.erfId)); rowTargets.forEach((row) => assertExactPath(row.documentPath, "tb_rows", row.documentId)); uploadTargets.forEach((row) => assertExactPath(row.documentPath, "tb_uploads", row.documentId)); salesTargets.forEach((row) => assertExactPath(row.documentPath, "demo_sales_meters", row.documentId));

  const app = admin.initializeApp({credential: admin.credential.cert(credential), projectId, storageBucket: `${projectId}.appspot.com`}, `tb-reset-apply-${Date.now()}`); const db = admin.firestore(app); const bucket = admin.storage(app).bucket();
  const currentCounts = {}; for (const name of Object.keys(inventory.preservationCounts)) currentCounts[name] = await count(db, name);
  const countsMatch = Object.entries(inventory.preservationCounts).every(([name, value]) => currentCounts[name] === value);
  const [trnSnaps, premiseSnaps, rowSnaps, uploadSnaps, salesSnaps, registrySnaps] = await Promise.all([
    exactDocs(db, trns, "trns", "trnId"), exactDocs(db, premises, "premises", "premiseId"), exactDocs(db, rowTargets, "tb_rows", "documentId"), exactDocs(db, uploadTargets, "tb_uploads", "documentId"), exactDocs(db, salesTargets, "demo_sales_meters", "documentId"), exactDocs(db, erfs, "registry_erfs", "erfId"),
  ]);
  const liveSalesBefore = await allSales(db); const salesPreflight = assessSalesCollection(salesExport, liveSalesBefore);
  let updateTimesMatch = true;
  for (const {row, snap} of trnSnaps) { try { assertExpectedUpdateTime({collection: "trns", id: row.trnId, expected: row.trnUpdateTime, actual: snapshotUpdateTime(snap), exists: snap.exists}); } catch { updateTimesMatch = false; } }
  for (const {row, snap} of premiseSnaps) { try { assertExpectedUpdateTime({collection: "premises", id: row.premiseId, expected: row.updateTime, actual: snapshotUpdateTime(snap), exists: snap.exists}); if (JSON.stringify(snap.data()?.noAccessTrnIds) !== JSON.stringify(row.noAccessTrnIds)) updateTimesMatch = false; } catch { updateTimesMatch = false; } }
  for (const [{row, snap}, collection, idKey, timeKey] of [...rowSnaps.map((item) => [item, "tb_rows", "documentId", "updateTime"]), ...uploadSnaps.map((item) => [item, "tb_uploads", "documentId", "updateTime"]), ...registrySnaps.map((item) => [item, "registry_erfs", "erfId", "registryErfUpdateTime"])]) { try { assertExpectedUpdateTime({collection, id: row[idKey], expected: row[timeKey], actual: snapshotUpdateTime(snap), exists: snap.exists}); } catch { updateTimesMatch = false; } }
  for (const object of objects) { const live = await liveObject(bucket, object); const assessment = assessStorageLiveState(object, live.metadata, live.error); if (!assessment.valid) { console.error(assessment.blocker, object.objectPath); updateTimesMatch = false; } }
  if (!salesPreflight.valid) { console.error("SALES_GLOBAL_PREFLIGHT", salesPreflight.blockers); updateTimesMatch = false; }
  guard = validatePreflight({projectId, serviceAccountProject: credential.project_id, confirmToken, inventory, hashesMatch, countsMatch, updateTimesMatch, ambiguousTrns: ambiguous.length, ambiguousStorage: objects.some((item) => !item.deletionEligible)});
  if (!guard.passed) throw new Error(`Preflight blocked: ${guard.errors.join(", ")}`);
  console.log("PREFLIGHT PASSED - 0 WRITES PERFORMED SO FAR");

  const startedAt = new Date().toISOString(); const phases = []; let firestoreWrites = 0; let storageDeletions = 0; let finalStatus = "PARTIAL_FAILURE";
  try {
    console.log("[PREMISES] START");
    for (const {row, snap} of premiseSnaps) { const current = snap.data()?.noAccessTrnIds; if (JSON.stringify(current) !== JSON.stringify(row.noAccessTrnIds)) throw new Error(`PREMISE_ARRAY_STALE premises/${row.premiseId}`); const cleaned = cleanPremiseIds(current, row.targetedRemovalIds); if (!cleaned.safe || JSON.stringify(cleaned.remaining) !== JSON.stringify(row.remainingIds)) throw new Error(`Premise guard failed: ${row.premiseId}`); await guardedWrite({ref: snap.ref, collection: "premises", id: row.premiseId, expectedUpdateTime: row.updateTime, operation: (condition) => snap.ref.update({noAccessTrnIds: cleaned.remaining, "metadata.updatedAt": new Date().toISOString(), "metadata.updatedByUid": "SYSTEM", "metadata.updatedByUser": "Targeted Batch Nuclear Reset"}, condition)}); firestoreWrites += 1; }
    phases.push({phase: "PREMISES", status: "DONE", writes: premises.length}); console.log("[PREMISES] DONE");
    console.log("[TRNS] START");
    for (const {row, snap} of trnSnaps) { await guardedWrite({ref: snap.ref, collection: "trns", id: row.trnId, expectedUpdateTime: row.trnUpdateTime, operation: (condition) => snap.ref.delete(condition)}); firestoreWrites += 1; }
    phases.push({phase: "TRNS", status: "DONE", deleted: trns.length}); console.log("[TRNS] DONE");
    console.log("[REGISTRY_ERFS] START");
    for (const {row, snap} of registrySnaps) { const [na, yes] = await Promise.all([db.collection("trns").where("accessData.erfId", "==", row.erfId).where("accessData.access.hasAccess", "==", "no").count().get(), db.collection("trns").where("accessData.erfId", "==", row.erfId).where("accessData.access.hasAccess", "==", "yes").count().get()]); const counts = {trnsNa: na.data().count || 0, trnsAccess: yes.data().count || 0}; counts.trnsTotal = counts.trnsNa + counts.trnsAccess; if (JSON.stringify(counts) !== JSON.stringify(row.expectedCounts)) throw new Error(`REGISTRY_ERF_COUNT_MISMATCH registry_erfs/${row.erfId}`); await guardedWrite({ref: snap.ref, collection: "registry_erfs", id: row.erfId, expectedUpdateTime: row.registryErfUpdateTime, operation: (condition) => snap.ref.update({"counts.trnsNa": counts.trnsNa, "counts.trnsAccess": counts.trnsAccess, "counts.trnsTotal": counts.trnsTotal, "metadata.updatedAt": new Date().toISOString(), "metadata.updatedByUid": "SYSTEM", "metadata.updatedByUser": "Targeted Batch Nuclear Reset Rebuild"}, condition)}); firestoreWrites += 1; }
    phases.push({phase: "REGISTRY_ERFS", status: "DONE", rebuilt: erfs.length}); console.log("[REGISTRY_ERFS] DONE");
    console.log("[STORAGE] START");
    for (const object of objects) { if (object.state === "ALREADY_MISSING") continue; try { await bucket.file(object.objectPath, {generation: object.generation}).delete({ifGenerationMatch: Number(object.generation), ifMetagenerationMatch: Number(object.metageneration)}); storageDeletions += 1; } catch (error) { const current = await liveObject(bucket, object); if (error?.code === 404 && !current.error) throw new Error(`STORAGE_REPLACEMENT_PRESENT_AFTER_DELETE_404 ${object.objectPath}`); throw error; } }
    phases.push({phase: "STORAGE", status: "DONE", deleted: storageDeletions}); console.log("[STORAGE] DONE");
    for (const [phase, collection, snapshots, idKey] of [["TB_ROWS", "tb_rows", rowSnaps, "documentId"], ["TB_UPLOADS", "tb_uploads", uploadSnaps, "documentId"]]) { console.log(`[${phase}] START`); for (const {row, snap} of snapshots) { await guardedWrite({ref: snap.ref, collection, id: row[idKey], expectedUpdateTime: row.updateTime, operation: (condition) => snap.ref.delete(condition)}); firestoreWrites += 1; } phases.push({phase, status: "DONE", deleted: snapshots.length}); console.log(`[${phase}] DONE`); }
    console.log("[DEMO_SALES] START");
    for (const {snap} of salesSnaps) { await snap.ref.update({tbRefs: admin.firestore.FieldValue.delete()}); firestoreWrites += 1; }
    phases.push({phase: "DEMO_SALES", status: "DONE", cleaned: salesSnaps.length}); console.log("[DEMO_SALES] DONE");
    const [rowsAfter, uploadsAfter, salesAfter, trnsAfter, premisesAfter, registryErfsAfter, astsAfter] = await Promise.all([count(db, "tb_rows"), count(db, "tb_uploads"), count(db, "demo_sales_meters"), count(db, "trns"), count(db, "premises"), count(db, "registry_erfs"), count(db, "asts")]);
    const targetAbsent = (await exactDocs(db, trns, "trns", "trnId")).every(({snap}) => !snap.exists); const verifiedPremises = await exactDocs(db, premises, "premises", "premiseId"); const premisesCorrect = verifiedPremises.every(({row, snap}) => snap.exists && JSON.stringify(snap.data()?.noAccessTrnIds) === JSON.stringify(row.remainingIds)); const verifiedSales = await exactDocs(db, salesTargets, "demo_sales_meters", "documentId"); const salesCorrect = verifiedSales.every(({snap}) => snap.exists && !Object.hasOwn(snap.data(), "tbRefs")); const erfsCorrect = (await Promise.all(erfs.map(async (row) => { const snap = await db.collection("registry_erfs").doc(row.erfId).get(); const counts = snap.data()?.counts || {}; return snap.exists && ["trnsNa", "trnsAccess", "trnsTotal"].every((key) => counts[key] === row.expectedCounts[key]); }))).every(Boolean); const storageAbsent = (await Promise.all(objects.map(async (object) => { const current = await liveObject(bucket, object); return current.error?.code === 404 || current.error?.statusCode === 404; }))).every(Boolean); const canonicalRemaining = (await db.collection("trns").where("sourceModule", "==", "SALES_TARGETED_BATCH").get()).docs.filter((doc) => classifySalesTbTrn({id: doc.id, data: doc.data()}).classification === "CANONICAL_SALES_TB_NA").length; const finalSales = assessSalesCollection(salesExport, await allSales(db), {final: true});
    const passed = rowsAfter === 0 && uploadsAfter === 0 && salesAfter === inventory.preservationCounts.demo_sales_meters && premisesAfter === inventory.preservationCounts.premises && registryErfsAfter === inventory.preservationCounts.registry_erfs && astsAfter === inventory.preservationCounts.asts && trnsAfter === inventory.preservationCounts.trns - trns.length && targetAbsent && canonicalRemaining === 0 && premisesCorrect && salesCorrect && erfsCorrect && storageAbsent && finalSales.valid;
    finalStatus = passed ? "PASSED" : "FAILED";
  } catch (error) { phases.push({phase: "FAILED", status: "PARTIAL_FAILURE", error: error.message}); throw error; }
  finally { const runId = `TARGETED_BATCH_RESET_APPLY_${new Date().toISOString().replace(/[-:.]/g, "")}`; const runDir = path.join(REPORTS_ROOT, runId); fs.mkdirSync(runDir, {recursive: true}); fs.writeFileSync(path.join(runDir, "reset-report.json"), `${JSON.stringify({schemaVersion: RESET_SCHEMA_VERSION, runId, projectId, mode: "APPLY_RESET", resetPolicy: RESET_POLICY, inventoryRunId: inventory.runId, startedAt, finishedAt: new Date().toISOString(), status: finalStatus, phases, exactDeletedTrnIds: trns.map((row) => row.trnId), exactAffectedPremiseIds: premises.map((row) => row.premiseId), exactAffectedErfIds: erfs.map((row) => row.erfId), exactStorageObjects: objects.map((item) => ({bucket: item.bucket, objectPath: item.objectPath, generation: item.generation, state: item.state})), irepsErfsScope: {reads: 0, writes: 0, status: "OUTSIDE_RESET_SCOPE"}, firestoreWrites, storageDeletions}, null, 2)}\n`); await app.delete(); }
  if (finalStatus !== "PASSED") process.exitCode = 1;
}
main().catch((error) => { console.error("STEP 2 FAILED OR PARTIAL_FAILURE", error); process.exitCode = 1; });
