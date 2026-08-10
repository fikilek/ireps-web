import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";
import admin from "firebase-admin";
import {SCHEMA_VERSION, PROJECT_ID, LM_PCODE, CONFIRM_TOKEN, classifyScope, exactUpdateTime, updateTimeEqual, stable, sha256, collectStrings, parseStorageReference, removeExactReferences, cleanSales} from "./endumeniReset.helpers.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
const REPORT_ROOT = path.join(ROOT, "docs", "reports", "endumeni-nuclear-reset");
const DELETE_COLLECTIONS = ["report_trn_no_access", "report_trn_access", "registry_meters", "registry_accounts", "registry_premises", "trns", "asts", "premises", "tb_rows", "tb_uploads"];
const SCAN_COLLECTIONS = [...DELETE_COLLECTIONS, "meter_master", "sales-all-meters", "ireps_erfs", "registry_erfs", "registry_wards", "geo_fences"];
const args = Object.fromEntries(process.argv.slice(3).reduce((rows, item, index, all) => item.startsWith("--") ? [...rows, [item.slice(2), all[index + 1]?.startsWith("--") ? true : all[index + 1]]] : rows, []));
const mode = process.argv[2];
const serviceAccount = args["service-account"] || process.env.IREPS_DEV_SERVICE_ACCOUNT || "C:\\dev\\secrets\\ireps2-e72fd9dc94de.json";

function assertCli() {
  if (!['inventory', 'verify', 'apply'].includes(mode)) throw new Error("Usage: endumeni-reset.js <inventory|verify|apply> --service-account <path> [--manifest <inventory.json>] [--confirm token]");
  if ((args["project-id"] || PROJECT_ID) !== PROJECT_ID) throw new Error("WRONG_PROJECT");
  if (!fs.existsSync(serviceAccount)) throw new Error("SERVICE_ACCOUNT_NOT_FOUND");
}
function writeNew(file, value) { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, `${JSON.stringify(stable(value), null, 2)}\n`, {flag: "wx"}); }
function read(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function timestamp() { return new Date().toISOString().replace(/[-:.]/g, ""); }
function manifestPath() { const file = args.manifest; if (!file) throw new Error("--manifest is required"); const resolved = path.resolve(file); const relative = path.relative(REPORT_ROOT, resolved); if (relative.startsWith("..") || path.isAbsolute(relative) || path.basename(resolved) !== "inventory.json") throw new Error("MANIFEST_OUTSIDE_APPROVED_REPORT_ROOT"); return resolved; }
async function pageCollection(db, name) { const rows = []; let after = null; let pages = 0; console.log(`[INVENTORY] ${name}: START`); do { let query = db.collection(name).orderBy(admin.firestore.FieldPath.documentId()).limit(500); if (after) query = query.startAfter(after); const snap = await query.get(); for (const doc of snap.docs) rows.push({collection: name, id: doc.id, path: doc.ref.path, updateTime: exactUpdateTime(doc.updateTime), data: doc.data()}); after = snap.docs.at(-1) || null; pages += 1; console.log(`[INVENTORY] ${name}: ${rows.length} documents (${pages} pages)`); if (snap.size < 500) break; } while (after); console.log(`[INVENTORY] ${name}: DONE`); return rows; }
async function historyRows(db, uploadIds) { const rows = []; for (const id of uploadIds) { const parent = db.collection("tb_uploads").doc(id); const collections = await parent.listCollections(); for (const child of collections) { if (child.id !== "history") throw new Error(`UNEXPECTED_UPLOAD_SUBCOLLECTION:${parent.path}/${child.id}`); const snap = await child.get(); snap.docs.forEach((doc) => rows.push({collection: "tb_uploads_history", id: doc.id, path: doc.ref.path, updateTime: exactUpdateTime(doc.updateTime), data: doc.data()})); } } return rows; }
function targetRows(all) { return all.filter((row) => classifyScope(row.data).scope === "TARGET"); }
function ambiguousRows(all) { return all.filter((row) => classifyScope(row.data).scope === "AMBIGUOUS"); }
function relatedIds(rows) { return new Set(rows.flatMap((row) => [row.id, ...collectStrings(row.data).filter(({path}) => /(^|\.)(id|.*Id|.*Ids)(\[\d+\])?$/.test(path)).map(({value}) => value)])); }
function isRelated(row, ids) { return row.id && (ids.has(row.id) || collectStrings(row.data).some(({value}) => ids.has(value))); }
function storageRefs(rows) { const map = new Map(); for (const row of rows) for (const item of collectStrings(row.data)) { const parsed = parseStorageReference(item.value); if (!parsed) continue; const key = `${parsed.bucket}/${parsed.objectPath}`; const current = map.get(key) || {...parsed, sources: []}; current.sources.push({documentPath: row.path, fieldPath: item.path}); map.set(key, current); } return [...map.values()]; }
async function storageState(bucket, ref) { try { const [metadata] = await bucket.file(ref.objectPath).getMetadata(); return {...ref, state: "EXISTS", generation: String(metadata.generation), metageneration: String(metadata.metageneration)}; } catch (error) { if (error.code === 404 || error.statusCode === 404) return {...ref, state: "MISSING"}; return {...ref, state: "ERROR", error: String(error.message)}; } }

async function inventory(db, bucket) {
  const scans = Object.fromEntries(await Promise.all(SCAN_COLLECTIONS.map(async (name) => [name, await pageCollection(db, name)])));
  const blockers = [];
  for (const [name, rows] of Object.entries(scans)) if (ambiguousRows(rows).length) blockers.push(`AMBIGUOUS_SCOPE:${name}`);
  const core = ["tb_rows", "tb_uploads", "trns", "asts", "premises"].flatMap((name) => targetRows(scans[name]));
  const ids = relatedIds(core);
  const targets = {};
  for (const name of SCAN_COLLECTIONS) targets[name] = scans[name].filter((row) => classifyScope(row.data).scope === "TARGET" || isRelated(row, ids));
  targets.tb_uploads_history = await historyRows(db, targets.tb_uploads.map((row) => row.id));
  targets.tb_uploads_history.forEach((row) => ids.add(row.id));
  const media = storageRefs(Object.values(targets).flat());
  const allNonTargetMedia = new Set(storageRefs(Object.values(scans).flatMap((rows) => rows.filter((row) => !isRelated(row, ids) && classifyScope(row.data).scope !== "TARGET"))).map((item) => `${item.bucket}/${item.objectPath}`));
  for (const ref of media) { if (!ref.eligible) blockers.push(`UNSAFE_STORAGE_PATH:${ref.objectPath || "unknown"}`); if (allNonTargetMedia.has(`${ref.bucket}/${ref.objectPath}`)) blockers.push(`SHARED_STORAGE_OBJECT:${ref.objectPath}`); }
  console.log(`[INVENTORY] storage: checking ${media.length} exact objects`);
  const storage = await Promise.all(media.map((ref) => storageState(bucket, ref)));
  if (!targets.tb_rows.length && !targets.tb_uploads.length && !targets.trns.length && !targets.asts.length && !targets.premises.length) blockers.push("EMPTY_PRIMARY_SCOPE");
  const runDir = path.join(REPORT_ROOT, `ENDUMENI_INVENTORY_${timestamp()}`); const targetFile = path.join(runDir, "targets.json"); const storageFile = path.join(runDir, "storage.json");
  writeNew(targetFile, targets); writeNew(storageFile, storage);
  const result = {schemaVersion: SCHEMA_VERSION, projectId: PROJECT_ID, lmPcode: LM_PCODE, mode: "READ_ONLY", createdAt: new Date().toISOString(), status: blockers.length ? "BLOCKED" : "PASSED", blockers: [...new Set(blockers)].sort(), files: {targets: {path: targetFile, sha256: sha256(fs.readFileSync(targetFile))}, storage: {path: storageFile, sha256: sha256(fs.readFileSync(storageFile))}}, counts: Object.fromEntries(Object.entries(targets).map(([name, rows]) => [name, rows.length])), storageCount: storage.length};
  const file = path.join(runDir, "inventory.json"); writeNew(file, result); console.log(JSON.stringify({status: result.status, manifest: file, counts: result.counts, blockers: result.blockers}, null, 2)); if (blockers.length) process.exitCode = 2;
}

function loadManifest() { const file = manifestPath(); const manifest = read(file); if (manifest.schemaVersion !== SCHEMA_VERSION || manifest.projectId !== PROJECT_ID || manifest.lmPcode !== LM_PCODE || manifest.status !== "PASSED") throw new Error("INVALID_OR_BLOCKED_MANIFEST"); for (const entry of Object.values(manifest.files)) if (!fs.existsSync(entry.path) || sha256(fs.readFileSync(entry.path)) !== entry.sha256) throw new Error("MANIFEST_HASH_MISMATCH"); return {file, manifest, targets: read(manifest.files.targets.path), storage: read(manifest.files.storage.path)}; }
async function assertFresh(db, targets) { for (const rows of Object.values(targets)) for (const row of rows) { const snap = await db.doc(row.path).get(); if (!snap.exists) throw new Error(`STALE_MISSING:${row.path}`); if (!updateTimeEqual(row.updateTime, exactUpdateTime(snap.updateTime))) throw new Error(`STALE_CHANGED:${row.path}`); } }
async function assertStorageFresh(bucket, rows) { for (const row of rows) { const current = await storageState(bucket, row); if (row.state !== current.state || row.generation !== current.generation || row.metageneration !== current.metageneration) throw new Error(`STALE_STORAGE:${row.objectPath}`); } }
async function verify(db, bucket, loaded, final = false) { if (!final) { await assertFresh(db, loaded.targets); await assertStorageFresh(bucket, loaded.storage); return {status: "PASSED", phase: "PREFLIGHT"}; } const failures = []; for (const name of DELETE_COLLECTIONS) { const rows = await pageCollection(db, name); if (targetRows(rows).length) failures.push(`TARGETS_REMAIN:${name}`); } for (const row of loaded.storage) { const current = await storageState(bucket, row); if (current.state !== "MISSING") failures.push(`STORAGE_REMAINS:${row.objectPath}`); } return {status: failures.length ? "FAILED" : "PASSED", phase: "FINAL", failures}; }
async function guardedDelete(db, row) { const stamp = new admin.firestore.Timestamp(Number(row.updateTime.seconds), row.updateTime.nanoseconds); await db.doc(row.path).delete({lastUpdateTime: stamp}); }
async function guardedSet(db, row, data) { await db.runTransaction(async (transaction) => { const ref = db.doc(row.path); const snap = await transaction.get(ref); if (!snap.exists || !updateTimeEqual(row.updateTime, exactUpdateTime(snap.updateTime))) throw new Error(`STALE_CHANGED:${row.path}`); transaction.set(ref, data); }); }
async function apply(db, bucket, loaded) {
  if (args.confirm !== CONFIRM_TOKEN) throw new Error(`CONFIRMATION_REQUIRED:${CONFIRM_TOKEN}`);
  if (args["maintenance-freeze"] !== "ENFORCED") throw new Error("--maintenance-freeze ENFORCED is required; the flag is an operator attestation, not a lock implementation");
  console.log(JSON.stringify(await verify(db, bucket, loaded, false)));
  const removed = relatedIds([...(loaded.targets.trns || []), ...(loaded.targets.asts || []), ...(loaded.targets.premises || [])]);
  for (const name of ["report_trn_no_access", "report_trn_access", "registry_meters", "registry_accounts", "registry_premises", "trns", "asts", "premises"]) for (const row of loaded.targets[name] || []) await guardedDelete(db, row);
  for (const row of loaded.targets.meter_master || []) { const next = removeExactReferences(row.data, removed); if (next.refs?.asts && removed.has(next.refs.asts.id)) delete next.refs.asts.id; if (next.refs?.asts && !Object.keys(next.refs.asts).length) delete next.refs.asts; next.visibility = next.refs?.asts?.id && next.refs?.sales?.id ? "VISIBLE" : "INVISIBLE"; await guardedSet(db, row, next); }
  for (const row of loaded.targets["sales-all-meters"] || []) await guardedSet(db, row, cleanSales(row.data, removed));
  for (const name of ["ireps_erfs", "registry_erfs", "registry_wards", "geo_fences"]) for (const row of loaded.targets[name] || []) await guardedSet(db, row, removeExactReferences(row.data, removed));
  for (const row of loaded.storage) if (row.state === "EXISTS") await bucket.file(row.objectPath, {generation: row.generation}).delete({ifGenerationMatch: Number(row.generation), ifMetagenerationMatch: Number(row.metageneration)});
  for (const row of loaded.targets.tb_uploads_history || []) await guardedDelete(db, row);
  for (const row of loaded.targets.tb_rows || []) await guardedDelete(db, row);
  for (const row of loaded.targets.tb_uploads || []) await guardedDelete(db, row);
  const result = await verify(db, bucket, loaded, true); const report = path.join(path.dirname(loaded.file), `apply-${timestamp()}.json`); writeNew(report, {...result, completedAt: new Date().toISOString()}); console.log(JSON.stringify({...result, report}, null, 2)); if (result.status !== "PASSED") process.exitCode = 1;
}

async function main() { assertCli(); const credential = read(serviceAccount); if (credential.project_id !== PROJECT_ID) throw new Error("WRONG_SERVICE_ACCOUNT_PROJECT"); const app = admin.initializeApp({credential: admin.credential.cert(credential), projectId: PROJECT_ID, storageBucket: `${PROJECT_ID}.appspot.com`}, `endumeni-reset-${Date.now()}`); try { const db = admin.firestore(app); const bucket = admin.storage(app).bucket(); if (mode === "inventory") await inventory(db, bucket); else { const loaded = loadManifest(); if (mode === "verify") console.log(JSON.stringify(await verify(db, bucket, loaded, false), null, 2)); else await apply(db, bucket, loaded); } } finally { await app.delete(); } }
main().catch((error) => { console.error("ENDUMENI RESET FAILED", error); process.exitCode = 1; });
