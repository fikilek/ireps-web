// DR-R001 3.2 and 3.3 — the one-time count, and the reconciliation that goes
// with it.
//
// Every meter carries SIX numbers (9 October 2026): how many times each of the
// five kinds of work was actually done on it — disconnection, reconnection,
// inspection, removal, reading — and how many visits to it ended because
// nobody could reach it. The meters that already exist have to be counted
// once, from the transactions, before the ITO button shows those numbers.
//
// The owner's instruction of 9 October: the numbers are made true in DEV, TEST
// and LIVE BEFORE the button that displays them is built, because a button
// carrying wrong numbers is worse than no button — the office would be
// deciding from it.
//
// THE TRANSACTIONS ARE THE TRUTH, so this pass is authoritative in both
// directions: a meter whose transactions say three disconnections is set to
// three, and a meter with no transactions at all is set to zero rather than
// left holding whatever it holds. Skipping the second case would leave a wrong
// number standing precisely where nothing could ever correct it.
//
// The same pass reconciles the premises' No Access lists both ways, because a
// No Access on work the office issued never reached the premise's list (Task
// Register f03). Nothing is quietly corrected: what does not match is listed
// for the office.
//
// It counts what the transactions say. The transactions are the truth; these
// numbers are only a reading of them.
//
//   node functions/scripts/backfillMeterCountsAndNoAccess.js                (dry run)
//   node functions/scripts/backfillMeterCountsAndNoAccess.js --apply        (writes)
//   node functions/scripts/backfillMeterCountsAndNoAccess.js --lm ZA7423    (one municipality)
//
// Credentials come from GOOGLE_APPLICATION_CREDENTIALS, so the environment is
// whichever key is set. Run it on DEV first, read the report, then TEST, then
// LIVE with the owner's go.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

import {
  COUNT_KEY_BY_TRN_TYPE,
  METER_COUNT_KEYS,
  newMeterCounts,
  outcomeMeansWorkWasDone,
} from "../registration/meterCounts.js";

initializeApp({ credential: applicationDefault() });

const db = getFirestore();

// The register reads a copy of the meter, so the copy is rebuilt here rather
// than left to the trigger: whichever version of the trigger an environment
// happens to be running, the register shows what the meter says.
const { rebuildMeterRegistryRow } = await import(
  "../registry/meterRegistryRowRebuild.js"
);

const APPLY = process.argv.includes("--apply");
// Rebuild every register row of a meter that carries a count, even where the
// meter's own numbers were already right.
const ROWS_ONLY = process.argv.includes("--rows");
const LM_INDEX = process.argv.indexOf("--lm");
const LM_PCODE = LM_INDEX > -1 ? process.argv[LM_INDEX + 1] : "";
// Where the before-images go. Required to write anything: archive first is the
// owner's standing rule for a data change, and a script that can be run
// without one will eventually be run without one.
const OUT_INDEX = process.argv.indexOf("--out");
const OUT_DIR = OUT_INDEX > -1 ? process.argv[OUT_INDEX + 1] : "";

if (APPLY && !OUT_DIR) {
  console.error(
    "Refusing to write without --out <folder>: every meter's counts are archived before they are changed.",
  );
  process.exit(1);
}

// The one well decides which kind of work raises which count
// (registration/meterCounts.js). This script does not keep its own copy: a
// fourth place naming the counts by hand is how one of them gets forgotten.

function trnType(trn = {}) {
  return String(trn?.accessData?.trnType || trn?.trnType || "")
    .trim()
    .toUpperCase();
}

function outcome(trn = {}) {
  return String(trn?.executionOutcome?.outcome || "")
    .trim()
    .toUpperCase();
}

function hasNoAccess(trn = {}) {
  return (
    String(trn?.accessData?.access?.hasAccess || "")
      .trim()
      .toLowerCase() === "no" || outcome(trn) === "NO_ACCESS"
  );
}

function meterOf(trn = {}) {
  return String(trn?.ast?.astData?.astId || trn?.astId || "").trim();
}

function premiseOf(trn = {}) {
  return String(trn?.accessData?.premise?.id || trn?.premiseId || "").trim();
}

async function readTransactions() {
  const counts = new Map(); // astId -> every count in METER_COUNT_KEYS
  const noAccessByPremise = new Map(); // premiseId -> Set(trnId)
  const noAccessWithoutPremise = [];

  let query = db.collection("trns");

  if (LM_PCODE) {
    query = query.where("accessData.parents.lmPcode", "==", LM_PCODE);
  }

  const snapshot = await query.get();

  snapshot.forEach((doc) => {
    const trn = doc.data() || {};
    const meterId = meterOf(trn);
    const type = trnType(trn);

    if (meterId) {
      const row = counts.get(meterId) || newMeterCounts();

      if (hasNoAccess(trn)) {
        row.noAccess += 1;
      } else if (outcomeMeansWorkWasDone(outcome(trn)) && COUNT_KEY_BY_TRN_TYPE[type]) {
        row[COUNT_KEY_BY_TRN_TYPE[type]] += 1;
      }

      counts.set(meterId, row);
    }

    if (hasNoAccess(trn)) {
      const premiseId = premiseOf(trn);

      if (!premiseId) {
        // A No Access with no premise to attach it to. A finding, not a fix: the
        // Meter Discovery validator never asked for the ERF or the premise on a
        // no-access visit, so the record was written without them. NA-R001 fixes
        // the form and then backfills what evidence can name.
        noAccessWithoutPremise.push(doc.id);
        return;
      }

      const held = noAccessByPremise.get(premiseId) || new Set();
      held.add(doc.id);
      noAccessByPremise.set(premiseId, held);
    }
  });

  return { counts, noAccessByPremise, noAccessWithoutPremise, read: snapshot.size };
}

async function writeMeterCounts(counts) {
  const changed = [];
  const missingMeters = [];
  const rowsRebuilt = [];
  const rowsToRebuild = [];

  // FIRST PASS: read only. Nothing is written until every meter that will be
  // touched has been read and archived, so a run that dies halfway cannot
  // leave meters changed with no record of what they held.
  for (const [astId, wanted] of counts) {
    const ref = db.collection("asts").doc(astId);
    const snap = await ref.get();

    if (!snap.exists) {
      // A transaction naming a meter that is not there: a finding, not a fix.
      missingMeters.push(astId);
      continue;
    }

    const held = snap.data()?.counts || {};

    // A MISSING KEY COUNTS AS A DIFFERENCE, not only a different number.
    //
    // Found by the verification on 9 October 2026, after this pass reported
    // nothing left to do. 146 meters sat at all zeros, so comparing values
    // alone found no difference — and they kept a three-key counts object with
    // inspections, removals and readings simply absent, their register rows
    // with them. The shape rule says all six are always present, and this
    // file's own comment says absent and zero are different facts. The check
    // has to ask both questions or it enforces only half the rule.
    const differs = METER_COUNT_KEYS.some(
      (key) => typeof held[key] !== "number" || Number(held[key]) !== Number(wanted[key] || 0),
    );

    const carriesACount = METER_COUNT_KEYS.some((key) => Number(wanted[key] || 0) > 0);

    if (differs) {
      changed.push({
        astId,
        held,
        wanted,
        // The whole meter's prior counts object, not only the six numbers we
        // compare, so the archive can restore exactly what was there.
        before: snap.data()?.counts ?? null,
        updatedAtBefore: snap.data()?.metadata?.updatedAt ?? null,
      });
    }

    if (ROWS_ONLY && carriesACount && !differs) rowsToRebuild.push(astId);
  }

  if (!APPLY) return { changed, missingMeters, rowsRebuilt };

  // The archive, written before the first update.
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    join(OUT_DIR, "backup.json"),
    JSON.stringify(
      {
        takenAt: new Date().toISOString(),
        municipality: LM_PCODE || "every municipality",
        meters: changed.length,
        before: changed.map(({ astId, before, updatedAtBefore }) => ({
          astId,
          counts: before,
          updatedAt: updatedAtBefore,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`\nArchived ${changed.length} meters' counts to ${join(OUT_DIR, "backup.json")}`);

  // SECOND PASS: write.
  for (const row of changed) {
    const ref = db.collection("asts").doc(row.astId);
    const patch = {
      "metadata.updatedAt": new Date().toISOString(),
      "metadata.updatedByUid": "SYSTEM",
      "metadata.updatedByUser": "Meter counts backfill",
    };

    for (const key of METER_COUNT_KEYS) patch[`counts.${key}`] = Number(row.wanted[key] || 0);

    await ref.update(patch);

    // The register reads a copy, so the copy comes with it. Without this the
    // meter is right and the page still shows the old number.
    await rebuildMeterRegistryRow(row.astId);
    rowsRebuilt.push(row.astId);
  }

  for (const astId of rowsToRebuild) {
    await rebuildMeterRegistryRow(astId);
    rowsRebuilt.push(astId);
  }

  writeFileSync(
    join(OUT_DIR, "applied.json"),
    JSON.stringify(
      {
        appliedAt: new Date().toISOString(),
        metersWritten: changed.length,
        registerRowsRebuilt: rowsRebuilt.length,
        changes: changed.map(({ astId, held, wanted }) => ({ astId, held, wanted })),
      },
      null,
      2,
    ),
  );

  return { changed, missingMeters, rowsRebuilt };
}

async function reconcilePremiseNoAccess(noAccessByPremise) {
  const missingFromPremise = [];
  const onPremiseWithoutTrn = [];
  const missingPremises = [];

  for (const [premiseId, trnIds] of noAccessByPremise) {
    const ref = db.collection("premises").doc(premiseId);
    const snap = await ref.get();

    if (!snap.exists) {
      missingPremises.push(premiseId);
      continue;
    }

    const held = new Set(
      Array.isArray(snap.data()?.noAccessTrnIds)
        ? snap.data().noAccessTrnIds
        : [],
    );

    const missing = [...trnIds].filter((id) => !held.has(id));
    const extra = [...held].filter((id) => !trnIds.has(id));

    if (extra.length) onPremiseWithoutTrn.push({ premiseId, extra });

    if (!missing.length) continue;

    missingFromPremise.push({ premiseId, missing });

    if (APPLY) {
      await ref.update({
        noAccessTrnIds: FieldValue.arrayUnion(...missing),
        "metadata.updatedAt": new Date().toISOString(),
        "metadata.updatedByUid": "SYSTEM",
        "metadata.updatedByUser": "No Access reconciliation",
      });
    }
  }

  return { missingFromPremise, onPremiseWithoutTrn, missingPremises };
}

function report(title, rows, render) {
  console.log(`\n${title}: ${rows.length}`);
  rows.slice(0, 20).forEach((row) => console.log(`  ${render(row)}`));
  if (rows.length > 20) console.log(`  … and ${rows.length - 20} more`);
}

// asts.md 10.1: every meter carries its three counts, from the moment it is
// created. Meters made before that rule have no `counts` at all, and absent
// reads the same as zero to anybody looking — which is how a count that never
// reached the screen passed for a meter nothing had happened to. Writing the
// zeros makes a missing `counts` mean one thing only: something is wrong.
//
// This writes zeros. It never lowers a number: a meter that already carries
// counts is left to the pass that reconciles it against the transactions.
async function initialiseMissingCounts() {
  const given = [];

  let query = db.collection("asts");

  if (LM_PCODE) {
    query = query.where("accessData.parents.lmPcode", "==", LM_PCODE);
  }

  const snapshot = await query.get();

  for (const doc of snapshot.docs) {
    if (doc.data()?.counts) continue;

    given.push(doc.id);

    if (APPLY) {
      const zeros = newMeterCounts();
      const patch = {
        "metadata.updatedAt": new Date().toISOString(),
        "metadata.updatedByUid": "SYSTEM",
        "metadata.updatedByUser": "Meter counts backfill",
      };

      for (const key of METER_COUNT_KEYS) patch[`counts.${key}`] = zeros[key];

      await doc.ref.update(patch);

      // The register reads a copy, so the copy is brought with it. Without
      // this the row still has no counts and the page cannot tell a meter
      // nothing has happened to from a meter it was never told about.
      await rebuildMeterRegistryRow(doc.id);
    }
  }

  return { given, meters: snapshot.size, meterIds: snapshot.docs.map((doc) => doc.id) };
}

async function main() {
  console.log(
    `Meter counts and No Access reconciliation — ${APPLY ? "APPLYING" : "DRY RUN"}${
      LM_PCODE ? ` — ${LM_PCODE}` : " — every municipality"
    }`,
  );

  const { given, meters, meterIds } = await initialiseMissingCounts();

  console.log(`\nMeters: ${meters}`);
  console.log(
    APPLY
      ? `  carried no counts at all, now started at zero: ${given.length}`
      : `  carry no counts at all, would be started at zero: ${given.length}`,
  );

  const { counts, noAccessByPremise, noAccessWithoutPremise, read } =
    await readTransactions();

  // A meter no transaction mentions must read zero, not whatever it happens to
  // hold. Without this the pass only ever raises numbers and can never correct
  // one that is too high — and a meter whose transactions were removed would
  // keep its old count for ever, with nothing left that could disagree.
  let untouchedByAnyWork = 0;

  for (const meterId of meterIds) {
    if (counts.has(meterId)) continue;

    counts.set(meterId, newMeterCounts());
    untouchedByAnyWork += 1;
  }

  console.log(`  no transaction names them, so every count is zero: ${untouchedByAnyWork}`);

  console.log(`\nTransactions read: ${read}`);
  console.log(`Meters considered, every one of them: ${counts.size}`);

  const { changed, missingMeters, rowsRebuilt } = await writeMeterCounts(counts);
  const { missingFromPremise, onPremiseWithoutTrn, missingPremises } =
    await reconcilePremiseNoAccess(noAccessByPremise);

  report(
    APPLY ? "Meter counts written" : "Meter counts that would change",
    changed,
    // Every count, in the order METER_COUNT_KEYS gives them, and the ones that
    // actually moved named at the end. A report that printed three of six said
    // "50 would change" and then showed before and after as identical, which
    // is worse than no report: it reads as a bug in the counting.
    (row) => {
      const held = METER_COUNT_KEYS.map((key) => Number(row.held[key] || 0));
      const wanted = METER_COUNT_KEYS.map((key) => Number(row.wanted[key] || 0));
      const moved = METER_COUNT_KEYS.filter(
        (key, i) => held[i] !== wanted[i],
      ).join(", ");

      return (
        `${row.astId}  held ${held.join("/")}  →  ${wanted.join("/")}` +
        `  (${METER_COUNT_KEYS.join("/")})  — ${moved}`
      );
    },
  );

  console.log(
    `\nRegister rows rebuilt so the page shows the same numbers: ${rowsRebuilt.length}`,
  );

  report(
    APPLY
      ? "No Access visits added to their premise"
      : "No Access visits missing from their premise",
    missingFromPremise,
    (row) => `${row.premiseId}  ${row.missing.length} missing`,
  );

  console.log("\n— For the office, not corrected here —");

  report(
    "Transactions naming a meter that does not exist",
    missingMeters,
    (id) => id,
  );
  report("Premises named by a No Access that do not exist", missingPremises, (id) => id);
  report(
    "On a premise's No Access list with no transaction behind it",
    onPremiseWithoutTrn,
    (row) => `${row.premiseId}  ${row.extra.join(", ")}`,
  );
  console.log(
    `\nNo Access visits with no premise to attach them to (NA-R001): ${noAccessWithoutPremise.length}`,
  );

  if (!APPLY) {
    console.log("\nDry run. Nothing was written. Add --apply to write.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exit(1);
  });
