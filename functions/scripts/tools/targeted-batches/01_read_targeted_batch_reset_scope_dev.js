import fs from "fs";
import path from "path";
import crypto from "crypto";
import {fileURLToPath} from "url";
import admin from "firebase-admin";
import {
  RESET_SCHEMA_VERSION, RESET_POLICY, EXPECTED_PROJECT_ID, classifySalesTbTrn,
  correlationState, premiseCorrelation, cleanPremiseIds, parseStorageObject,
  validateEvidenceReferences, evidenceObjectState, detectDuplicates,
  markSharedStorage, sortByKeys, expectedErfCounts, uniqueSorted,
  stableStringify, exactUpdateTime, writeImmutableJson, replaceLatestPointer,
  proveCanonicalCorrelation, RESET_MANIFEST_VERSION,
} from "./targetedBatchReset.helpers.js";

const DEFAULT_SERVICE_ACCOUNT = "C:\\dev\\secrets\\ireps2-e72fd9dc94de.json";
const PAGE_SIZE = 500;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
const REPORTS_ROOT = path.join(ROOT, "docs", "reports", "targeted-batch-reset", "generated");
const EXPORT_COLLECTIONS = ["tb_rows", "tb_uploads", "demo_sales_meters"];
const COUNT_COLLECTIONS = ["tb_rows", "tb_uploads", "demo_sales_meters", "trns", "premises", "registry_erfs", "asts"];

const arg = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const iso = (value) => value?.toDate?.().toISOString?.() || value || null;
const hashFile = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function writeJsonl(file, rows) { const content = rows.map((row) => stableStringify(row)).join("\n") + (rows.length ? "\n" : ""); fs.writeFileSync(file, content, {encoding: "utf8", flag: "wx"}); return {path: file, sha256: hashFile(file), rows: rows.length}; }
async function pages(query, label) { let cursor; const docs = []; let page = 0; while (true) { let current = query.orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE_SIZE); if (cursor) current = current.startAfter(cursor); const snapshot = await current.get(); if (snapshot.empty) break; docs.push(...snapshot.docs); cursor = snapshot.docs.at(-1); page += 1; console.log(`[READ] ${label}: page ${page}, ${snapshot.size} docs, total ${docs.length}`); } return docs; }
async function count(db, name) { try { return (await db.collection(name).count().get()).data().count; } catch { return (await pages(db.collection(name), `${name} count fallback`)).length; } }

async function main() {
  const projectId = arg("--project-id", EXPECTED_PROJECT_ID);
  const serviceAccountPath = arg("--service-account", process.env.IREPS_DEV_SERVICE_ACCOUNT || DEFAULT_SERVICE_ACCOUNT);
  const credential = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
  if (projectId !== EXPECTED_PROJECT_ID || credential.project_id !== EXPECTED_PROJECT_ID) throw new Error("DEV project/service-account guard failed.");
  const runId = `TARGETED_BATCH_RESET_INVENTORY_${new Date().toISOString().replace(/[-:.]/g, "")}`;
  const runDir = path.join(REPORTS_ROOT, runId); const before = path.join(runDir, "before"); fs.mkdirSync(before, {recursive: true});
  console.log(`STEP 1 READ ONLY START ${runId}; Firestore writes: 0; Storage writes: 0`);
  const app = admin.initializeApp({credential: admin.credential.cert(credential), projectId, storageBucket: `${projectId}.appspot.com`}, `tb-reset-read-${Date.now()}`);
  const db = admin.firestore(app); const bucket = admin.storage(app).bucket(); const startedAt = new Date().toISOString();
  const exports = {}; const sourceMaps = {};
  for (const name of EXPORT_COLLECTIONS) {
    const docs = await pages(db.collection(name), name); sourceMaps[name] = new Map(docs.map((doc) => [doc.id, doc]));
    exports[name] = writeJsonl(path.join(before, `${name}.jsonl`), docs.map((doc) => ({documentId: doc.id, documentPath: doc.ref.path, createTime: iso(doc.createTime), updateTime: exactUpdateTime(doc.updateTime), data: doc.data()})));
  }
  const trnDocs = await pages(db.collection("trns"), "trns classification");
  const canonical = []; const ambiguous = []; const nonTargetStorage = new Set();
  for (const doc of trnDocs) {
    const data = doc.data(); const result = classifySalesTbTrn({id: doc.id, data});
    if (result.classification === "NON_TARGET") {
      for (const media of Array.isArray(data.media) ? data.media : []) { const parsed = parseStorageObject(media); if (parsed.bucket && parsed.objectPath) nonTargetStorage.add(`${parsed.bucket}/${parsed.objectPath}`); }
      continue;
    }
    const context = data.targetedBatchContext || {}; const premiseId = data.accessData?.premise?.id || null;
    const base = {manifestVersion: RESET_MANIFEST_VERSION, trnId: doc.id, trnPath: doc.ref.path, trnCreateTime: iso(doc.createTime), trnUpdateTime: exactUpdateTime(doc.updateTime), sourceModule: data.sourceModule || null, outcome: data.accessData?.access?.hasAccess || null, tbId: context.tbId || null, rowId: context.rowId || null, salesDocId: context.salesDocId || null, erfId: context.erfId || null, premiseId, storageObjects: []};
    if (result.classification === "AMBIGUOUS_SALES_TB_RECORD") { ambiguous.push({...base, reasons: result.reasons}); continue; }

    const evidence = validateEvidenceReferences(data.media, doc.id);
    if (!evidence.valid) base.evidenceBlocker = evidence.reason;
    const [premise, registryErf] = await Promise.all([premiseId ? db.collection("premises").doc(premiseId).get() : null, db.collection("registry_erfs").doc(context.erfId).get()]);
    const premiseState = premiseCorrelation({premiseId, premiseExists: premise?.exists});
    base.premiseClassification = premiseState.classification;
    base.correlationStates = correlationState({tb: sourceMaps.tb_uploads.has(context.tbId), row: sourceMaps.tb_rows.has(context.rowId), sales: sourceMaps.demo_sales_meters.has(context.salesDocId), premiseRequired: Boolean(premiseId), premise: premise?.exists, registryErf: registryErf.exists});
    const proof = proveCanonicalCorrelation({trnId: doc.id, trn: data, rowId: context.rowId,
      row: sourceMaps.tb_rows.get(context.rowId)?.data() || {}, tbId: context.tbId,
      parent: sourceMaps.tb_uploads.get(context.tbId)?.data() || {}, salesDocId: context.salesDocId,
      sales: sourceMaps.demo_sales_meters.get(context.salesDocId)?.data() || {}, erfId: context.erfId,
      premiseId, premise: premise?.exists ? {id: premise.id, ...premise.data()} : null,
      registryErf: registryErf.exists ? {id: registryErf.id, ...registryErf.data()} : {}});
    base.correlationEvidence = {valid: proof.valid, blockers: proof.blockers,
      establishedFields: ["trns.id", "targetedBatchContext.tbId", "targetedBatchContext.rowId",
        "targetedBatchContext.salesDocId", "targetedBatchContext.erfId", "accessData.premise.id",
        "accessData.erfId", "tb_rows.id", "tb_rows.tbId", "tb_rows.salesAllMeterId",
        "tb_rows.refs.erfId", "tb_rows.refs.premiseId", "tb_uploads.id",
        "demo_sales_meters.tbRefs[].id", "demo_sales_meters.tbRefs[].rowId",
        "demo_sales_meters.tbRefs[].fieldWork.premiseId", "premises.erfId",
        "premises.noAccessTrnIds", "registry_erfs.erfId"], matchingSalesTbRef: proof.matchingSalesTbRef};
    base._snapshots = {premise, registryErf};
    if (evidence.valid) {
      const reference = evidence.references[0]; let metadata = null; let storageError = null;
      try { [metadata] = await bucket.file(reference.objectPath).getMetadata(); } catch (error) { storageError = error; }
      base.storageObjects.push({...evidenceObjectState(reference, metadata, storageError), sourceTrnId: doc.id});
    }
    canonical.push(base);
  }

  const storage = markSharedStorage(canonical.flatMap((row) => row.storageObjects), nonTargetStorage);
  const targetsByPremise = new Map(); canonical.forEach((row) => { if (row.premiseId) targetsByPremise.set(row.premiseId, [...(targetsByPremise.get(row.premiseId) || []), row.trnId]); });
  const premises = [];
  for (const [premiseId, ids] of targetsByPremise) {
    const snapshot = canonical.find((row) => row.premiseId === premiseId)._snapshots.premise;
    if (!snapshot?.exists) continue;
    const current = snapshot.data()?.noAccessTrnIds; const simulated = cleanPremiseIds(current, ids);
    premises.push({manifestVersion: RESET_MANIFEST_VERSION, premiseId, premisePath: `premises/${premiseId}`, createTime: iso(snapshot.createTime), updateTime: exactUpdateTime(snapshot.updateTime), noAccessTrnIds: current ?? null, targetedRemovalIds: uniqueSorted(ids), remainingIds: simulated.remaining ?? null, countBefore: Array.isArray(current) ? current.length : null, targetedRemovalCount: simulated.removed?.length ?? 0, countAfter: simulated.remaining?.length ?? null, duplicateTargetedIds: simulated.duplicateTargetIds || [], missingExpectedTargetedIds: simulated.missing || [], safe: simulated.safe});
  }
  const erfIds = uniqueSorted(canonical.map((row) => row.erfId)); const erfs = [];
  for (const erfId of erfIds) {
    const rows = trnDocs.filter((doc) => doc.data()?.accessData?.erfId === erfId || doc.data()?.targetedBatchContext?.erfId === erfId).map((doc) => ({id: doc.id, ...doc.data()}));
    const targetIds = uniqueSorted(canonical.filter((row) => row.erfId === erfId).map((row) => row.trnId)); const registry = canonical.find((row) => row.erfId === erfId)._snapshots.registryErf;
    erfs.push({manifestVersion: RESET_MANIFEST_VERSION, erfId, registryErfExists: registry.exists, registryErfUpdateTime: registry.exists ? exactUpdateTime(registry.updateTime) : null, currentCounts: registry.data()?.counts || null, targetTrnIds: targetIds, remainingTrnIds: rows.filter((row) => !targetIds.includes(row.id)).map((row) => row.id).sort(), expectedCounts: expectedErfCounts(rows, targetIds)});
  }
  canonical.forEach((row) => delete row._snapshots);
  const manifests = {
    salesTbNaTrns: writeJsonl(path.join(before, "sales_tb_na_trns.jsonl"), sortByKeys(canonical, ["trnId"])),
    salesTbNaPremises: writeJsonl(path.join(before, "sales_tb_na_premises.jsonl"), sortByKeys(premises, ["premiseId"])),
    salesTbNaErfs: writeJsonl(path.join(before, "sales_tb_na_erfs.jsonl"), sortByKeys(erfs, ["erfId"])),
    salesTbNaStorageObjects: writeJsonl(path.join(before, "sales_tb_na_storage_objects.jsonl"), sortByKeys(storage, ["bucket", "objectPath", "sourceTrnId"])),
    ambiguousSalesTbTrns: writeJsonl(path.join(before, "ambiguous_sales_tb_trns.jsonl"), sortByKeys(ambiguous, ["trnId"])),
  };
  const counts = {}; for (const name of COUNT_COLLECTIONS) counts[name] = await count(db, name);
  const blockers = [];
  if (ambiguous.length) blockers.push("AMBIGUOUS_SALES_TB_RECORDS");
  if (detectDuplicates(canonical, (row) => row.trnId).length) blockers.push("DUPLICATE_TRN_IDS");
  if (canonical.some((row) => row.evidenceBlocker || row.storageObjects.length !== 1)) blockers.push("INVALID_NO_ACCESS_EVIDENCE");
  if (storage.some((item) => !item.deletionEligible)) blockers.push("AMBIGUOUS_STORAGE_TARGETS");
  if (premises.some((item) => !item.safe || item.missingExpectedTargetedIds.length)) blockers.push("UNSAFE_PREMISE_CORRELATION");
  if (canonical.some((row) => row.correlationStates.some((state) => state !== "FULLY_CORRELATED"))) blockers.push("UNSAFE_DOCUMENT_CORRELATION");
  for (const row of canonical) blockers.push(...(row.correlationEvidence?.blockers || []));
  if (erfs.some((row) => !row.registryErfExists)) blockers.push("UNSAFE_REGISTRY_ERF_CORRELATION");
  const demoDocs = [...sourceMaps.demo_sales_meters.values()]; const finishedAt = new Date().toISOString();
  const salesWithTbRefs = demoDocs.filter((doc) => Object.hasOwn(doc.data(), "tbRefs"));
  const inventory = {schemaVersion: RESET_SCHEMA_VERSION, manifestVersion: RESET_MANIFEST_VERSION, status: blockers.length ? "BLOCKED_AMBIGUOUS_SCOPE" : "PASSED", blockers: uniqueSorted(blockers), runId, projectId, mode: "READ_ONLY_EXPORT", resetPolicy: RESET_POLICY, startedAt, finishedAt, exports, manifests, preservationCounts: counts, salesConcurrencySnapshot: {totalDocumentCount: demoDocs.length, documentIds: demoDocs.map((doc) => doc.id).sort(), documentsWithRootTbRefs: salesWithTbRefs.map((doc) => doc.id).sort(), rootTbRefsCount: salesWithTbRefs.length}, irepsErfsScope: {reads: 0, writes: 0, status: "OUTSIDE_RESET_SCOPE"}, summary: {canonicalSalesTbNaTrns: canonical.length, ambiguousSalesTbRecords: ambiguous.length, affectedPremises: premises.length, prePremiseNoAccessTrns: canonical.filter((row) => !row.premiseId).length, affectedErfs: erfs.length, existingStorageObjects: storage.filter((item) => item.state === "EXISTS").length, alreadyMissingStorageObjects: storage.filter((item) => item.state === "ALREADY_MISSING").length, demoSalesWithTbRefs: salesWithTbRefs.length, demoSalesPreserved: demoDocs.length}, firestoreWrites: 0, storageWrites: 0};
  const inventoryPath = path.join(runDir, "inventory.json"); writeImmutableJson(inventoryPath, inventory); replaceLatestPointer(path.join(REPORTS_ROOT, "LATEST_INVENTORY.json"), {runId, projectId, inventoryPath, createdAt: finishedAt});
  console.log(`STEP 1 ${inventory.status}; Inventory: ${inventoryPath}; Firestore writes: 0; Storage writes: 0`); await app.delete(); if (inventory.status !== "PASSED") process.exitCode = 2;
}
main().catch((error) => { console.error("STEP 1 FAILED", error); process.exitCode = 1; });
