// MN-R001 1.9.0 — convert the stored "nothing to do" value to the word None.
//
//   node functions/scripts/noneToNone.js <DEV|TEST|LIVE>            dry run, writes nothing
//   node functions/scripts/noneToNone.js <DEV|TEST|LIVE> --apply    archives, writes, verifies
//
//   --batch=<n>    documents per commit (default 100)
//   --pause=<ms>   wait between commits (default 500)
//   --settle=<s>   wait before the report buckets (default 30)
//
// The service-account key comes from IREPS_SA_KEY or the documented location under
// C:\dev\secrets. Keys are never printed.
//
// RUN IT TWICE. It is idempotent, and the second run catches anything a late trigger
// re-stamped. It is finished when a run reports nothing to change and VERIFY PASS.
//
// WHY THE BATCHES ARE SMALL AND SLOW. Every write to `trns` fires onTrnWritten
// (functions/reports/trnReports.js), which is not change-gated: it rebuilds the
// normalisation, anomaly and user-activity buckets and the ward registry row, and several
// of those read every `trns` document for the whole municipality. Converting 1,585 LIVE
// transactions therefore sets off thousands of full collection scans. Large concurrent
// batches turn that into a long invisible backlog - trigger failures are swallowed and
// only logged. Small batches with a pause keep it walkable. Expect the reads to cost real
// money on LIVE and check the transaction count for that municipality before starting.
import fs from "node:fs";
import path from "node:path";
import { cert, initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECTS = {
  DEV: ["ireps2", "C:/dev/secrets/ireps2-e72fd9dc94de.json"],
  TEST: ["ireps-test", "C:/dev/secrets/ireps-test-firebase-adminsdk-fbsvc-d02929e1e3.json"],
  LIVE: ["ireps-5c3e9", "C:/dev/secrets/ireps-5c3e9-firebase-adminsdk.json"],
};

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : fallback;
};

const env = (process.argv[2] || "").toUpperCase();
const APPLY = process.argv.includes("--apply");
const BATCH = arg("batch", 100);
const PAUSE = arg("pause", 500);
const SETTLE = arg("settle", 30);

if (!PROJECTS[env]) {
  console.error("Say which database: DEV, TEST or LIVE.");
  process.exit(1);
}
const [projectId, defaultKeyPath] = PROJECTS[env];
const keyPath = process.env.IREPS_SA_KEY || defaultKeyPath;

// Where the value sits, per collection. Found by walking real documents; the verify below
// re-walks them, so this list is checked rather than trusted.
//
// The transaction and the meter record each carry it, and an inspection carries two more
// copies inside its payload. The report buckets carry their own copy, which is what the
// web and phone Normalisation Reports actually read - a conversion that skips them leaves
// every report showing the old word after the records themselves are clean.
const PLAN = {
  trns: [
    "ast.normalisation.actionTaken",
    "inspection.captured.ast.normalisation.actionTaken",
    "inspection.lastKnown.ast.normalisation.actionTaken",
  ],
  asts: ["ast.normalisation.actionTaken"],
  report_trn_normalisation: ["normalisation.actions"],
};

// The report buckets go last: a write to `trns` makes onTrnWritten rebuild the bucket from
// the PREVIOUS version of the document, which re-stamps the old word. Converting them
// before the transactions have settled would simply be undone.
const ORDER = ["trns", "asts", "report_trn_normalisation"];

const WORD = "None";
const isOld = (v) =>
  typeof v === "string" && v.trim().toLowerCase() === "none" && v !== WORD;
const getIn = (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// KEYS ARE NOT WORDS, and these ones stay lower case on purpose. A slug is built by
// lower-casing and joining, so "none" is its correct form, and code matches on it:
// src/pages/reports/NormalisationReportPage.jsx:140 tests `combinationKey === "none"`.
// Converting these would break the report rather than clean it. The completeness walk below
// finds them - it cannot tell a key from a word - so they are excluded here, by name, with
// the reason attached. An unexplained exclusion in a data conversion is how a real residual
// value gets waved through as "expected".
const KEY_PATHS_LEFT_ALONE = Object.freeze([
  "report_trn_normalisation.normalisation.combinationKey",
]);

// A document id like ZA5241__2026-08-09__none carries the same slug, and is likewise left.
function planFor(data, paths) {
  const update = {};
  for (const p of paths) {
    const v = getIn(data, p);
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.some(isOld)) update[p] = v.map((x) => (isOld(x) ? WORD : x));
    } else if (isOld(v)) {
      update[p] = WORD;
    }
  }
  return update;
}

// The real completeness check: walk the whole document for ANY string that reads as the
// old word, wherever it sits, and say where it was. The previous version of this script
// verified using the same path list that built its plan, so it could only ever prove that
// its own writes had landed - never that nothing else stored the value. That is how the
// report buckets were missed.
function walkOld(node, at, out, depth = 0) {
  if (depth > 10 || node == null) return;
  if (typeof node === "string") {
    if (isOld(node)) out.set(at, (out.get(at) || 0) + 1);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v) => walkOld(v, `${at}[]`, out, depth + 1));
    return;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      walkOld(v, at ? `${at}.${k}` : k, out, depth + 1);
    }
  }
}

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
  console.log(`\n=== ${env} (${projectId}) — ${APPLY ? "APPLY" : "DRY RUN"} ===`);
  if (APPLY) console.log(`batch ${BATCH}, pause ${PAUSE}ms, settle ${SETTLE}s\n`);

  let totalChanged = 0;

  for (const coll of ORDER) {
    const paths = PLAN[coll];
    const snap = await db.collection(coll).get();
    const rows = [];
    for (const doc of snap.docs) {
      const before = doc.data() || {};
      const update = planFor(before, paths);
      if (Object.keys(update).length) rows.push({ id: doc.id, update, before });
    }

    const perField = {};
    for (const r of rows) {
      for (const p of Object.keys(r.update)) perField[p] = (perField[p] || 0) + 1;
    }
    console.log(`${coll}: ${rows.length} of ${snap.size} documents to change`);
    for (const [p, n] of Object.entries(perField)) {
      console.log(`  ${String(n).padStart(5)}  ${p}`);
    }
    totalChanged += rows.length;

    if (!APPLY || !rows.length) continue;

    if (coll === "report_trn_normalisation" && SETTLE > 0) {
      console.log(`  waiting ${SETTLE}s for the transaction triggers to settle first...`);
      await sleep(SETTLE * 1000);
      // Re-plan: a trigger may have rewritten a bucket while we waited.
      const again = await db.collection(coll).get();
      rows.length = 0;
      for (const doc of again.docs) {
        const before = doc.data() || {};
        const update = planFor(before, paths);
        if (Object.keys(update).length) rows.push({ id: doc.id, update, before });
      }
      console.log(`  after settling: ${rows.length} to change`);
    }

    fs.mkdirSync(path.join(archiveDir, coll), { recursive: true });
    for (const r of rows) {
      fs.writeFileSync(
        path.join(archiveDir, coll, `${r.id.replace(/[\\/:*?"<>|]/g, "_")}.json`),
        JSON.stringify(r.before, null, 1),
      );
    }
    console.log(`  archived ${rows.length} documents to ${archiveDir}/${coll}`);

    let written = 0;
    let skipped = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const batch = db.batch();
      for (const r of slice) {
        batch.update(db.collection(coll).doc(r.id), r.update);
      }
      try {
        await batch.commit();
        written += slice.length;
      } catch (error) {
        // One document deleted since the read rejects the whole commit, so fall back to
        // one at a time and name what could not be written rather than abandoning the run.
        console.log(`  batch at ${i} failed (${error.message}); writing it one by one`);
        for (const r of slice) {
          try {
            await db.collection(coll).doc(r.id).update(r.update);
            written += 1;
          } catch (inner) {
            skipped += 1;
            console.log(`    SKIPPED ${coll}/${r.id}: ${inner.message}`);
          }
        }
      }
      console.log(`  written ${written}/${rows.length}${skipped ? ` (${skipped} skipped)` : ""}`);
      if (PAUSE) await sleep(PAUSE);
    }
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. ${totalChanged} documents would change.`);
    console.log("Re-run with --apply after the owner's go.");
  } else {
    // Verify by walking every document, not by re-checking the paths we planned from.
    console.log("\nVERIFY — walking every document for any remaining old value:");
    const residual = new Map();
    let scanned = 0;
    for (const coll of ORDER) {
      const snap = await db.collection(coll).get();
      scanned += snap.size;
      for (const doc of snap.docs) {
        const found = new Map();
        walkOld(doc.data() || {}, "", found);
        for (const [p, n] of found) {
          const at = `${coll}.${p}`;
          residual.set(at, (residual.get(at) || 0) + n);
        }
      }
    }
    console.log(`  ${scanned} documents scanned across ${ORDER.join(", ")}`);

    const excluded = [...residual].filter(([p]) => KEY_PATHS_LEFT_ALONE.includes(p));
    const real = [...residual].filter(([p]) => !KEY_PATHS_LEFT_ALONE.includes(p));

    if (excluded.length) {
      console.log(`\n  keys left lower case on purpose (see KEY_PATHS_LEFT_ALONE):`);
      for (const [p, n] of excluded) console.log(`  ${String(n).padStart(5)}  ${p}`);
    }

    if (!real.length) {
      console.log(`\nVERIFY PASS — no stored WORD left holding the old spelling.`);
    } else {
      console.log(`\nVERIFY FAIL — still holding the old word:`);
      for (const [p, n] of real.sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(n).padStart(5)}  ${p}`);
      }
      console.log("\nRe-run the script: a trigger may have re-stamped a bucket.");
      process.exitCode = 1;
    }
  }
} finally {
  await deleteApp(app);
}
