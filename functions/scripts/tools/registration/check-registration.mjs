// RG-R001: what does iREPS hold for one meter, right now?
//
// READ ONLY. Written for TP-004: run it before a test and again after, and the difference is the test
// result. It looks at every record the rule names, and at the ones that must NOT exist.
//
//   node scripts/tools/registration/check-registration.mjs --meter 04297758791 --row TBR_...
import { readFileSync } from "node:fs";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const KEYS = {
  ireps2: "C:/dev/secrets/ireps2-e72fd9dc94de.json",
  "ireps-test": "C:/dev/secrets/ireps-test-firebase-adminsdk-fbsvc-d02929e1e3.json",
  "ireps-5c3e9": "C:/dev/secrets/ireps-5c3e9-firebase-adminsdk.json",
};

const args = process.argv.slice(2);
const arg = (name, fallback = "") => {
  const at = args.indexOf(`--${name}`);
  return at > -1 ? args[at + 1] : fallback;
};

const project = arg("project", "ireps2");
initializeApp({
  credential: cert(JSON.parse(readFileSync(KEYS[project], "utf8"))),
  projectId: project,
});

const db = getFirestore();
const meterNo = arg("meter");
const rowId = arg("row");
const premiseId = arg("premise");
const say = (label, value) => console.log(`  ${String(label).padEnd(22)} ${value}`);

async function main() {
  console.log(`\n=== ${project} · ${new Date().toISOString()} ===`);

  if (meterNo) {
    console.log(`\nMETER ${meterNo}`);

    const master = await db.collection("meter_master").doc(meterNo).get();
    if (!master.exists) {
      say("meter master", "none");
    } else {
      const m = master.data();
      say("meter master", "exists");
      say("  field link", m?.refs?.asts?.id || "none");
      say("  sales link", m?.refs?.sales?.id || "none");
      say("  visibility", m?.visibility || m?.state || "—");
    }

    const sales = await db.collection("sales-all-meters").doc(meterNo).get();
    if (sales.exists) {
      const s = sales.data();
      say("sales record", "exists");
      say("  visibility", s?.master?.visibility || s?.visibility || "—");
      say("  batch", s?.targetedBatchId || "none");
      say("  work status", s?.work?.status || s?.status || "—");
    } else {
      say("sales record", "none");
    }

    // The meter itself is keyed by its transaction, so find it by its number.
    const asts = await db
      .collection("asts")
      .where("master.id", "==", meterNo)
      .limit(5)
      .get();
    say("meters (asts)", asts.size);
    for (const doc of asts.docs) {
      const a = doc.data();
      say("  " + doc.id, `visibility=${a?.master?.visibility} premise=${a?.accessData?.premise?.id}`);
      const trn = await db.collection("trns").doc(doc.id).get();
      say("    its transaction", trn.exists ? "exists" : "MISSING — orphan meter");
      if (trn.exists) {
        const t = trn.data();
        say("    worked on", t?.metadata?.createdOnDevice || t?.metadata?.createdAt || "—");
        say("    arrived", t?.metadata?.createdOnServer || "—");
        say("    by", t?.metadata?.createdByUser || "—");
        say("    derived.astId", t?.derived?.astId || "MISSING");
        say("    batch closed", t?.derived?.targetedBatch?.rowId || "—");
      }
      const registry = await db.collection("registry_meters").doc(doc.id).get();
      say("    registry row", registry.exists ? "exists" : "none");
      const refused = await db.collection("refused_submissions").doc(doc.id).get();
      say("    refusal record", refused.exists ? `PRESENT: ${refused.data()?.refusal?.code}` : "none");
    }
  }

  if (rowId) {
    console.log(`\nBATCH ROW ${rowId}`);
    const row = await db.collection("tb_rows").doc(rowId).get();
    if (!row.exists) {
      say("row", "not found");
    } else {
      const r = row.data();
      say("batch", r?.tbId);
      say("execution", `${r?.execution?.status}${r?.execution?.outcome ? ` / ${r.execution.outcome}` : ""}`);
      say("allocated to", `${r?.allocation?.targetType}:${r?.allocation?.targetName}`);
      say("meter", r?.meter?.numberNormalized);
      say("meter visibility", r?.meter?.masterVisibility);
      say("erf", `${r?.property?.erfNo || r?.location?.erfNo} (${r?.refs?.erfId || "not resolved"})`);
      say("premise", r?.refs?.premiseId || "none");
      say("transaction", r?.refs?.trnId || "none");
      say("meter id", r?.refs?.meterId || "none");

      const batch = await db.collection("tb_uploads").doc(r?.tbId).get();
      if (batch.exists) {
        const b = batch.data();
        say("batch execution", b?.execution?.status);
        say("batch counts", JSON.stringify(b?.counts || {}));
      }
    }
  }

  if (premiseId) {
    console.log(`\nPREMISE ${premiseId}`);
    const premise = await db.collection("premises").doc(premiseId).get();
    if (!premise.exists) {
      say("premise", "not found");
    } else {
      const p = premise.data();
      say("occupancy", p?.occupancy?.status || "—");
      say("electricity meters", JSON.stringify(p?.services?.electricityMeters || []));
      say("water meters", JSON.stringify(p?.services?.waterMeters || []));
      say("no access visits", (p?.noAccessTrnIds || []).length);
      say("erf", p?.refs?.erfId || p?.erfId || "—");
    }
  }

  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("could not read:", error?.message || error);
    process.exit(1);
  });
