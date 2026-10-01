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

const APPLY = process.argv.includes("--apply");
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
        // A batch No Access whose row names no premise. By design, not a gap.
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

    if (!differs) continue;

    changed.push({ astId, held, wanted });

    if (APPLY) {
      await ref.update({
        "counts.disconnections": wanted.disconnections,
        "counts.reconnections": wanted.reconnections,
        "counts.noAccess": wanted.noAccess,
        "metadata.updatedAt": new Date().toISOString(),
        "metadata.updatedByUid": "SYSTEM",
        "metadata.updatedByUser": "Meter counts backfill",
      });
    }
  }

  return { changed, missingMeters };
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

async function main() {
  console.log(
    `Meter counts and No Access reconciliation — ${APPLY ? "APPLYING" : "DRY RUN"}${
      LM_PCODE ? ` — ${LM_PCODE}` : " — every municipality"
    }`,
  );

  const { counts, noAccessByPremise, noAccessWithoutPremise, read } =
    await readTransactions();

  console.log(`\nTransactions read: ${read}`);
  console.log(`Meters with work behind them: ${counts.size}`);

  const { changed, missingMeters } = await writeMeterCounts(counts);
  const { missingFromPremise, onPremiseWithoutTrn, missingPremises } =
    await reconcilePremiseNoAccess(noAccessByPremise);

  report(
    APPLY ? "Meter counts written" : "Meter counts that would change",
    changed,
    (row) =>
      `${row.astId}  held ${row.held.disconnections || 0}/${row.held.reconnections || 0}/${row.held.noAccess || 0}` +
      `  →  ${row.wanted.disconnections}/${row.wanted.reconnections}/${row.wanted.noAccess}  (dcn/rcn/na)`,
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
    `\nNo Access visits naming no premise (by design, batch rows): ${noAccessWithoutPremise.length}`,
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
