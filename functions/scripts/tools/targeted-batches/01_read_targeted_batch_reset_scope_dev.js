// Historical DEV inventory only. This output is never an executable reset approval.
import fs from "node:fs";
import admin from "firebase-admin";
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
async function main() {
  if (!process.argv.includes("--historical-dev-inventory") || process.argv.some(arg => arg.includes("apply"))) throw new Error("Historical DEV inventory flag required; reset/apply is retired");
  if (option("--project-id") !== "ireps2") throw new Error("Explicit DEV project ireps2 is required");
  const serviceAccount = option("--service-account"), output = option("--output");
  if (!serviceAccount || !output) throw new Error("Explicit service account and existing output directory are required");
  const credential = JSON.parse(fs.readFileSync(serviceAccount, "utf8"));
  if (credential.project_id !== "ireps2") throw new Error("Service account scope mismatch");
  const app = admin.initializeApp({ credential: admin.credential.cert(credential), projectId: "ireps2" }, "historical-tb-inventory");
  try {
    const db = admin.firestore(app), inventory = { mode: "HISTORICAL_DEV_READ_ONLY", executableApproval: false, firestoreWrites: 0, collections: {} };
    for (const name of ["tb_uploads", "tb_rows", "demo_sales_meters", "sales-all-meters", "geo_fences"]) {
      const snapshot = await db.collection(name).get();
      inventory.collections[name] = { count: snapshot.size, documentIds: snapshot.docs.map(doc => doc.id) };
    }
    inventory.canonicalDependencies = "Sales targetedBatchId/tbRefs, saved ERF provenance, sales-all-meters/{id}/batchHistory, and dedicated geo_fences remain governed. Demo documents cannot substitute for them.";
    fs.writeFileSync(output, JSON.stringify(inventory, null, 2) + "\n", { flag: "wx" });
  } finally { await app.delete(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
