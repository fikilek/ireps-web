import fs from "fs";
import admin from "firebase-admin";
import {PROJECT_ID, LM_PCODE, CONFIRM_TOKEN, classifyScope, collectStrings, parseStorageReference, removeExactReferences} from "./endumeniReset.helpers.js";

const arg = (name) => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const serviceAccount = arg("--service-account") || process.env.IREPS_DEV_SERVICE_ACCOUNT || "C:\\dev\\secrets\\ireps2-e72fd9dc94de.json";
if (arg("--project-id") !== PROJECT_ID) throw new Error("--project-id ireps2 is required");
if (arg("--confirm") !== CONFIRM_TOKEN) throw new Error(`--confirm ${CONFIRM_TOKEN} is required`);
const credential = JSON.parse(fs.readFileSync(serviceAccount, "utf8"));
if (credential.project_id !== PROJECT_ID) throw new Error("WRONG_SERVICE_ACCOUNT_PROJECT");

const app = admin.initializeApp({credential: admin.credential.cert(credential), projectId: PROJECT_ID, storageBucket: `${PROJECT_ID}.appspot.com`}, `endumeni-fast-reset-${Date.now()}`);
const db = admin.firestore(app); const bucket = admin.storage(app).bucket();
async function all(name) { const snap = await db.collection(name).get(); console.log(`[READ] ${name}: ${snap.size}`); return snap.docs; }
async function deleteDocs(docs, label) { const writer = db.bulkWriter(); let count = 0; writer.onWriteError((error) => error.failedAttempts < 3); for (const doc of docs) { writer.delete(doc.ref); count += 1; } await writer.close(); console.log(`[DELETE] ${label}: ${count}`); }
async function updateDocs(items, label) { const writer = db.bulkWriter(); let count = 0; writer.onWriteError((error) => error.failedAttempts < 3); for (const {ref, data} of items) { writer.set(ref, data); count += 1; } await writer.close(); console.log(`[UPDATE] ${label}: ${count}`); }

async function main() {
  console.log(`FAST DEV RESET START project=${PROJECT_ID} lmPcode=${LM_PCODE}`);
  const names = ["tb_rows", "tb_uploads", "trns", "asts", "premises", "registry_meters", "registry_premises", "registry_accounts", "report_trn_no_access", "report_trn_access", "meter_master", "sales-all-meters", "ireps_erfs"];
  const scans = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await all(name)])));
  const scoped = (name) => scans[name].filter((doc) => classifyScope(doc.data()).scope === "TARGET");
  const core = [...scoped("trns"), ...scoped("asts"), ...scoped("premises")];
  const removed = new Set(core.flatMap((doc) => [doc.id, ...collectStrings(doc.data()).filter(({path}) => /(^|\.)(id|.*Id|.*Ids)(\[\d+\])?$/.test(path)).map(({value}) => value)]));
  const related = (name) => scans[name].filter((doc) => scoped(name).includes(doc) || collectStrings(doc.data()).some(({value}) => removed.has(value)));
  const media = new Map(); for (const doc of [...scans.tb_rows, ...scans.tb_uploads, ...core]) for (const {value} of collectStrings(doc.data())) { const parsed = parseStorageReference(value); if (parsed?.eligible) media.set(`${parsed.bucket}/${parsed.objectPath}`, parsed); }
  const history = []; for (const upload of scans.tb_uploads) for (const collection of await upload.ref.listCollections()) { const snap = await collection.get(); history.push(...snap.docs); }
  await deleteDocs(history, "tb_uploads/* subcollections");
  await deleteDocs(related("report_trn_no_access"), "report_trn_no_access");
  await deleteDocs(related("report_trn_access"), "report_trn_access");
  await deleteDocs(related("registry_meters"), "registry_meters");
  await deleteDocs(related("registry_accounts"), "registry_accounts");
  await deleteDocs(related("registry_premises"), "registry_premises");
  await deleteDocs(scoped("trns"), "Endumeni trns");
  await deleteDocs(scoped("asts"), "Endumeni asts");
  await deleteDocs(scoped("premises"), "Endumeni premises");
  await updateDocs(scans.meter_master.map((doc) => { const data = removeExactReferences(doc.data(), removed); if (data.refs?.asts) delete data.refs.asts.id; data.visibility = "INVISIBLE"; return {ref: doc.ref, data}; }), "meter_master");
  await updateDocs(scans["sales-all-meters"].map((doc) => { const data = removeExactReferences(doc.data(), removed); delete data.tbRefs; if (data.master) data.master.visibility = "INVISIBLE"; return {ref: doc.ref, data}; }), "sales-all-meters");
  await updateDocs(scans.ireps_erfs.map((doc) => ({ref: doc.ref, data: removeExactReferences(doc.data(), removed)})), "ireps_erfs meter/premise links");
  await Promise.all([...media.values()].map(async (item) => { try { await bucket.file(item.objectPath).delete({ignoreNotFound: true}); } catch (error) { console.error(`[STORAGE FAILED] ${item.objectPath}: ${error.message}`); } }));
  console.log(`[STORAGE] attempted exact deletion: ${media.size}`);
  await deleteDocs(scans.tb_rows, "ALL tb_rows");
  await deleteDocs(scans.tb_uploads, "ALL tb_uploads");
  const checks = await Promise.all(["tb_rows", "tb_uploads", "trns", "asts", "premises"].map(all));
  const failures = checks.slice(0, 2).some((docs) => docs.length) || checks.slice(2).some((docs) => docs.some((doc) => classifyScope(doc.data()).scope === "TARGET"));
  console.log(failures ? "FAST DEV RESET FAILED VERIFICATION" : "FAST DEV RESET PASSED");
  if (failures) process.exitCode = 1;
}
main().catch((error) => { console.error("FAST DEV RESET FAILED", error); process.exitCode = 1; }).finally(() => app.delete());
