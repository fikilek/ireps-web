// Fill the ERF number on transactions that have none.
//
// The owner, 4 October 2026, reading the TRN Registry: "can we do a backfill where we're
// missing the ERF number?" Thirteen rows showed NAv under ERF No.
//
// WHY IT MATTERS. It is the same fault as a record with no municipality: the record exists and
// cannot be found. The registry is filtered by ERF, the reports group by it, and a worker
// looking for what happened at a property finds nothing.
//
// THE AUTHORITY, AND WHY IT IS NOT THE ERF. Endumeni's ERFs are not in this environment's
// `erfs` collection at all - measured 4 October, 0 of 36,798 carry a K241 parcel key - so the
// ERF cannot answer. Two things can, and they were checked against each other first:
//
//   1. THE PREMISE. It carries `erfNo` directly. 11 of the 13 have a premise.
//   2. THE PARCEL KEY, which the transaction already holds as `accessData.erfId`. Digits 13-20,
//      zero-stripped, are the ERF number. Measured across every transaction that has both an
//      erfNo and an erfId: 514 agree, 0 disagree.
//
// On all 11 records that have a premise, the two answers AGREE. The premise is preferred
// because it is a record a person maintains; the parcel key is the fallback, and it is the
// only answer for the 2 records with no premise.
//
// IT NEVER INVENTS. A record neither source can answer is reported and left alone, and two
// sources that disagree are reported rather than chosen between. Nothing is deleted, and
// nothing but `accessData.erfNo` is touched.
//
// DRY RUN IS THE DEFAULT. Nothing is written without --apply AND the confirm token, and an
// archive of every document about to change is written first.

import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_NAME = "33_backfill_trn_erfno.js";
const CONFIRM_TOKEN = "BACKFILL_TRN_ERFNO";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const blank = (value) =>
  value === undefined ||
  value === null ||
  String(value).trim() === "" ||
  String(value).trim() === "NAv";

/**
 * The ERF number a parcel key carries.
 *
 * A parcel key is 26 characters - K241N0GT011800000698000000 - and digits 13 to 20 are the ERF
 * number, zero padded. This is not a guess: it was measured on all 514 DEV transactions that
 * hold both, with no disagreements. It returns "" for anything that is not that shape, so a
 * key from somewhere else cannot quietly produce a wrong number.
 */
export function erfNoFromParcelKey(parcelKey) {
  const key = String(parcelKey || "").trim();
  if (key.length !== 26) return "";

  const digits = key.slice(12, 20);
  if (!/^[0-9]{8}$/.test(digits)) return "";

  return digits.replace(/^0+/, "");
}

function parseArgs(argv) {
  const args = { projectId: "ireps2", apply: false, confirm: null };

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--project") args.projectId = argv[i + 1];
    if (argv[i] === "--apply") args.apply = true;
    if (argv[i] === "--confirm") args.confirm = argv[i + 1];
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.apply && args.confirm !== CONFIRM_TOKEN) {
    console.error(`REFUSED: --apply needs --confirm ${CONFIRM_TOKEN}`);
    process.exitCode = 1;
    return;
  }

  // DEV only. TEST and LIVE are the release chat's, and LIVE needs the owner's own go.
  const keyByProject = { ireps2: "C:/dev/secrets/ireps2-e72fd9dc94de.json" };
  const keyPath = keyByProject[args.projectId];

  if (!keyPath) {
    console.error(`REFUSED: no key is configured for project "${args.projectId}".`);
    process.exitCode = 1;
    return;
  }

  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, "utf8"))),
  });
  const db = admin.firestore();

  console.log(`${SCRIPT_NAME} - ${args.projectId} - ${args.apply ? "APPLY" : "DRY RUN"}`);

  const snap = await db.collection("trns").get();
  const missing = snap.docs
    .map((doc) => ({ id: doc.id, accessData: doc.data()?.accessData || {} }))
    .filter((row) => blank(row.accessData.erfNo));

  console.log(`transactions: ${snap.size}`);
  console.log(`erfNo missing or NAv: ${missing.length}`);

  const planned = [];
  const unresolved = [];
  const conflicts = [];

  for (const row of missing) {
    const fromKey = erfNoFromParcelKey(row.accessData.erfId);

    let fromPremise = "";
    const premiseId = row.accessData?.premise?.id;

    if (premiseId) {
      const premise = await db.collection("premises").doc(premiseId).get();
      if (premise.exists && !blank(premise.data()?.erfNo)) {
        fromPremise = String(premise.data().erfNo).trim();
      }
    }

    // Two sources that disagree is not a repair, it is a finding. Reported, never guessed at.
    if (fromPremise && fromKey && fromPremise !== fromKey) {
      conflicts.push({ id: row.id, fromPremise, fromKey });
      continue;
    }

    const erfNo = fromPremise || fromKey;

    if (!erfNo) {
      unresolved.push({
        id: row.id,
        erfId: row.accessData.erfId || "",
        premiseId: premiseId || "",
      });
      continue;
    }

    planned.push({
      id: row.id,
      erfNo,
      source: fromPremise ? "premise" : "parcelKey",
      agreed: Boolean(fromPremise && fromKey),
    });
  }

  console.log(`to fill: ${planned.length}`);
  console.log(`  both sources agree: ${planned.filter((row) => row.agreed).length}`);
  console.log(
    `  parcel key only (no premise): ${planned.filter((row) => row.source === "parcelKey").length}`,
  );
  console.log(`sources disagree (SKIPPED): ${conflicts.length}`);
  console.log(`no source can answer (SKIPPED): ${unresolved.length}`);

  planned.forEach((row) =>
    console.log(`  ${row.id} -> ${row.erfNo} (${row.source}${row.agreed ? ", agreed" : ""})`),
  );
  conflicts.forEach((row) =>
    console.log(`  CONFLICT ${row.id}: premise ${row.fromPremise} vs key ${row.fromKey}`),
  );
  unresolved.forEach((row) =>
    console.log(`  UNRESOLVED ${row.id}: erfId=${row.erfId || "none"} premise=${row.premiseId || "none"}`),
  );

  if (!args.apply) {
    console.log(`DRY RUN - nothing written. Re-run with --apply --confirm ${CONFIRM_TOKEN}`);
    return;
  }

  if (!planned.length) {
    console.log("nothing to write.");
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archivePath = path.join(__dirname, `trn-erfno-${args.projectId}-${stamp}.json`);
  fs.writeFileSync(
    archivePath,
    JSON.stringify(
      { script: SCRIPT_NAME, project: args.projectId, at: stamp, planned, conflicts, unresolved },
      null,
      2,
    ),
  );
  console.log(`archive: ${archivePath}`);

  for (let i = 0; i < planned.length; i += 400) {
    const batch = db.batch();
    planned.slice(i, i + 400).forEach((row) => {
      batch.update(db.collection("trns").doc(row.id), { "accessData.erfNo": row.erfNo });
    });
    await batch.commit();
    console.log(`  written ${Math.min(i + 400, planned.length)}/${planned.length}`);
  }

  // VERIFY - read it back, and check each one says what it was meant to say.
  let wrong = 0;

  for (const row of planned) {
    const doc = await db.collection("trns").doc(row.id).get();
    if (String(doc.data()?.accessData?.erfNo || "") !== row.erfNo) {
      wrong += 1;
      console.log(
        `  VERIFY MISMATCH ${row.id}: expected ${row.erfNo}, found ${doc.data()?.accessData?.erfNo}`,
      );
    }
  }

  const after = await db.collection("trns").get();
  const stillMissing = after.docs.filter((doc) => blank(doc.data()?.accessData?.erfNo));
  const expectedLeft = conflicts.length + unresolved.length;

  console.log(`VERIFY - written and re-read correctly: ${planned.length - wrong}/${planned.length}`);
  console.log(`VERIFY - erfNo still missing: ${stillMissing.length} (expected ${expectedLeft})`);
  console.log(wrong === 0 && stillMissing.length === expectedLeft ? "VERIFY PASS" : "VERIFY FAIL");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
