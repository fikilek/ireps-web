// DR-R001 3.2 and 3.3 — the one-time count, and the reconciliation that goes
// with it.
//
// Every meter carries three numbers from now on: how many times it was
// disconnected, how many times it was reconnected, and how many visits to it
// ended because nobody could reach it. The meters that already exist have to
// be counted once, from the transactions, before those columns are shown.
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

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

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

const COUNTED_WORK = {
  METER_DISCONNECTION: "disconnections",
  METER_RECONNECTION: "reconnections",
};

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
  const counts = new Map(); // astId -> {disconnections, reconnections, noAccess}
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
      const row = counts.get(meterId) || {
        disconnections: 0,
        reconnections: 0,
        noAccess: 0,
      };

      if (hasNoAccess(trn)) {
        row.noAccess += 1;
      } else if (outcome(trn) === "SUCCESS" && COUNTED_WORK[type]) {
        row[COUNTED_WORK[type]] += 1;
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

  for (const [astId, wanted] of counts) {
    const ref = db.collection("asts").doc(astId);
    const snap = await ref.get();

    if (!snap.exists) {
      // A transaction naming a meter that is not there: a finding, not a fix.
      missingMeters.push(astId);
      continue;
    }

    const held = snap.data()?.counts || {};

    const differs =
      Number(held.disconnections || 0) !== wanted.disconnections ||
      Number(held.reconnections || 0) !== wanted.reconnections ||
      Number(held.noAccess || 0) !== wanted.noAccess;

    const carriesACount =
      wanted.disconnections > 0 || wanted.reconnections > 0 || wanted.noAccess > 0;

    if (differs) changed.push({ astId, held, wanted });

    if (APPLY && differs) {
      await ref.update({
        "counts.disconnections": wanted.disconnections,
        "counts.reconnections": wanted.reconnections,
        "counts.noAccess": wanted.noAccess,
        "metadata.updatedAt": new Date().toISOString(),
        "metadata.updatedByUid": "SYSTEM",
        "metadata.updatedByUser": "Meter counts backfill",
      });
    }

    if (APPLY && (differs || (ROWS_ONLY && carriesACount))) {
      await rebuildMeterRegistryRow(astId);
      rowsRebuilt.push(astId);
    }
  }

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
      await doc.ref.update({
        "counts.disconnections": 0,
        "counts.reconnections": 0,
        "counts.noAccess": 0,
        "metadata.updatedAt": new Date().toISOString(),
        "metadata.updatedByUid": "SYSTEM",
        "metadata.updatedByUser": "Meter counts backfill",
      });

      // The register reads a copy, so the copy is brought with it. Without
      // this the row still has no counts and the page cannot tell a meter
      // nothing has happened to from a meter it was never told about.
      await rebuildMeterRegistryRow(doc.id);
    }
  }

  return { given, meters: snapshot.size };
}

async function main() {
  console.log(
    `Meter counts and No Access reconciliation — ${APPLY ? "APPLYING" : "DRY RUN"}${
      LM_PCODE ? ` — ${LM_PCODE}` : " — every municipality"
    }`,
  );

  const { given, meters } = await initialiseMissingCounts();

  console.log(`\nMeters: ${meters}`);
  console.log(
    APPLY
      ? `  carried no counts at all, now started at zero: ${given.length}`
      : `  carry no counts at all, would be started at zero: ${given.length}`,
  );

  const { counts, noAccessByPremise, noAccessWithoutPremise, read } =
    await readTransactions();

  console.log(`\nTransactions read: ${read}`);
  console.log(`Meters with work behind them: ${counts.size}`);

  const { changed, missingMeters, rowsRebuilt } = await writeMeterCounts(counts);
  const { missingFromPremise, onPremiseWithoutTrn, missingPremises } =
    await reconcilePremiseNoAccess(noAccessByPremise);

  report(
    APPLY ? "Meter counts written" : "Meter counts that would change",
    changed,
    (row) =>
      `${row.astId}  held ${row.held.disconnections || 0}/${row.held.reconnections || 0}/${row.held.noAccess || 0}` +
      `  →  ${row.wanted.disconnections}/${row.wanted.reconnections}/${row.wanted.noAccess}  (dcn/rcn/na)`,
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
