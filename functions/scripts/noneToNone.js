// MN-R001 1.9.0 — convert the stored "nothing to do" value from the old lower-case
// code to the word None.
//
//   node functions/scripts/noneToNone.js <DEV|TEST|LIVE>            dry run, writes nothing
//   node functions/scripts/noneToNone.js <DEV|TEST|LIVE> --apply    archives, writes, verifies
//
// The service-account key is taken from IREPS_SA_KEY, or from the documented location
// under C:\dev\secrets. Keys are never printed.
//
// This belongs in the SAME window as the deploy of the affected functions. The validator
// also runs when an existing transaction is derived, so a strict server over unconverted
// data refuses that derivation, and converted data under the old server does the same.
// Neither half stands alone.
import fs from "node:fs";
import path from "node:path";
import { cert, initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECTS = {
  DEV: ["ireps2", "C:/dev/secrets/ireps2-e72fd9dc94de.json"],
  TEST: ["ireps-test", "C:/dev/secrets/ireps-test-firebase-adminsdk-fbsvc-d02929e1e3.json"],
  LIVE: ["ireps-5c3e9", "C:/dev/secrets/ireps-5c3e9-firebase-adminsdk.json"],
};

const env = (process.argv[2] || "").toUpperCase();
const APPLY = process.argv.includes("--apply");
if (!PROJECTS[env]) {
  console.error("Say which database: DEV, TEST or LIVE.");
  process.exit(1);
}
const [projectId, defaultKeyPath] = PROJECTS[env];
const keyPath = process.env.IREPS_SA_KEY || defaultKeyPath;

// Every place the value sits, found by walking real documents rather than read off a
// schema. The meter record carries it as well as the transaction, and an inspection
// carries two more copies inside its payload.
const PATHS = [
  "ast.normalisation.actionTaken",
  "inspection.captured.ast.normalisation.actionTaken",
  "inspection.lastKnown.ast.normalisation.actionTaken",
];
const COLLECTIONS = ["trns", "asts"];
const WORD = "None";

const isOld = (v) =>
  typeof v === "string" && v.trim().toLowerCase() === "none" && v !== WORD;
const getIn = (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o);

if (!fs.existsSync(keyPath)) {
  console.error(`No service-account key found for ${env}.`);
  process.exit(1);
}
const key = JSON.parse(fs.readFileSync(keyPath, "utf8"));
if (key.project_id !== projectId) {
  console.error(`That key is for ${key.project_id}, not ${projectId}. Refusing.`);
  process.exit(1);
}

const app = initializeApp({ credential: cert(key), projectId }, `noneToNone-${env}`);
const db = getFirestore(app);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const archiveDir = `C:/dev/backups/none-to-None-${env}-${stamp}`;

try {
  const plan = [];
  for (const coll of COLLECTIONS) {
    const snap = await db.collection(coll).get();
    for (const doc of snap.docs) {
      const before = doc.data() || {};
      const update = {};
      for (const p of PATHS) {
        const v = getIn(before, p);
        if (v === undefined) continue;
        if (Array.isArray(v)) {
          if (v.some(isOld)) update[p] = v.map((x) => (isOld(x) ? WORD : x));
        } else if (isOld(v)) {
          update[p] = WORD;
        }
      }
      if (Object.keys(update).length) plan.push({ coll, id: doc.id, update, before });
    }
  }

  const perColl = {};
  const perField = {};
  for (const row of plan) {
    perColl[row.coll] = (perColl[row.coll] || 0) + 1;
    for (const p of Object.keys(row.update)) perField[p] = (perField[p] || 0) + 1;
  }

  console.log(`\n=== ${env} (${projectId}) — ${APPLY ? "APPLY" : "DRY RUN"} ===`);
  console.log(`documents to change: ${plan.length}`);
  for (const [c, n] of Object.entries(perColl)) console.log(`  ${c}: ${n}`);
  for (const [p, n] of Object.entries(perField)) {
    console.log(`  ${String(n).padStart(5)}  ${p}`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply after the owner's go.");
  } else if (!plan.length) {
    console.log("\nNothing to do.");
  } else {
    fs.mkdirSync(archiveDir, { recursive: true });
    for (const row of plan) {
      fs.writeFileSync(
        path.join(archiveDir, `${row.coll}__${row.id}.json`),
        JSON.stringify(row.before, null, 1),
      );
    }
    console.log(`\narchived ${plan.length} documents to ${archiveDir}`);

    let written = 0;
    for (let i = 0; i < plan.length; i += 400) {
      const slice = plan.slice(i, i + 400);
      const batch = db.batch();
      for (const row of slice) {
        batch.update(db.collection(row.coll).doc(row.id), row.update);
      }
      await batch.commit();
      written += slice.length;
      console.log(`  written ${written}/${plan.length}`);
    }

    // Verify by reading everything back, not by trusting the writes.
    let left = 0;
    for (const coll of COLLECTIONS) {
      const snap = await db.collection(coll).get();
      for (const doc of snap.docs) {
        const d = doc.data() || {};
        for (const p of PATHS) {
          const v = getIn(d, p);
          if (Array.isArray(v) ? v.some(isOld) : isOld(v)) left += 1;
        }
      }
    }
    console.log(`\nVERIFY: ${left} old values left in ${env} — ${left === 0 ? "PASS" : "FAIL"}`);
    if (left) process.exitCode = 1;
  }
} finally {
  await deleteApp(app);
}
