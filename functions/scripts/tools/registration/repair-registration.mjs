// RG-R001 section 8: repair a registration whose meter was never made, under its own TRN ID.
//
// DRY RUN BY DEFAULT. Nothing is written without --apply, and --apply needs --reason, because a repair is
// recorded in the person's own words. It uses the same one creator as a fresh registration, so a repaired
// meter is identical to one registered today, and it keeps the original worker and the day they worked.
//
//   node scripts/tools/registration/repair-registration.mjs --project ireps2 --all
//   node scripts/tools/registration/repair-registration.mjs --project ireps2 --all --apply --reason "..."
//   node scripts/tools/registration/repair-registration.mjs --project ireps-test --trn TRN_MDIS_...
//   node scripts/tools/registration/repair-registration.mjs --project ireps2 --unlinked
import { readFileSync } from "node:fs";

const KEYS = {
  ireps2: "C:/dev/secrets/ireps2-e72fd9dc94de.json",
  "ireps-test": "C:/dev/secrets/ireps-test-firebase-adminsdk-fbsvc-d02929e1e3.json",
  "ireps-5c3e9": "C:/dev/secrets/ireps-5c3e9-firebase-adminsdk.json",
};

const args = process.argv.slice(2);
const one = (name, fallback = "") => {
  const at = args.indexOf(`--${name}`);
  return at > -1 ? args[at + 1] : fallback;
};
const many = (name) =>
  args.reduce((found, arg, at) => (arg === `--${name}` ? [...found, args[at + 1]] : found), []);

const project = one("project", "ireps2");
const apply = args.includes("--apply");
const reason = one("reason", "");
const everyOrphan = args.includes("--all");
// RG-R001 section 2: a meter that exists but is not linked everywhere is not a finished registration.
// --unlinked walks the meters instead of the transactions and picks the ones whose links are missing.
const everyUnlinked = args.includes("--unlinked");

if (!KEYS[project]) {
  console.error(`Unknown project "${project}".`);
  process.exit(1);
}
if (apply && !reason.trim()) {
  console.error("--apply needs --reason: a repair is recorded in the person's own words.");
  process.exit(1);
}

// index.js calls initializeApp() with no arguments, so the key is handed to it the way Google's own
// libraries expect. Set before the module graph loads, which is why the imports below are dynamic.
process.env.GOOGLE_APPLICATION_CREDENTIALS = KEYS[project];
process.env.GCLOUD_PROJECT = project;
process.env.GOOGLE_CLOUD_PROJECT = project;

const { getFirestore, Timestamp, FieldPath } = await import("firebase-admin/firestore");
const { REGISTRATION_DEPS } = await import("../../../index.js");
const { registerMeterInTransaction } = await import("../../../registration/registerMeter.js");
const { repairRegistration } = await import("../../../registration/repairRegistration.js");
const { normalizeMeterNo } = await import("../../../meterMaster/helpers.js");
const { validateMeterDiscoveryPayload } = await import("../../../meterDiscovery/validation.js");
const { rebuildErfMeterCounts } = await import("../../../registry/erfMeterCountsRebuild.js");
const { rebuildPremiseRegistryRow } = await import("../../../registry/premiseRegistryRowRebuild.js");

const db = getFirestore();
const deps = {
  ...REGISTRATION_DEPS,
  registerMeterInTransaction,
  normalizeMeterNo,
  validateMeterDiscoveryPayload,
};

async function orphanTrnIds() {
  const named = many("trn").filter(Boolean);
  if (named.length) return named;
  if (everyUnlinked) {
    const asts = await db.collection("asts").get();
    return asts.docs.map((doc) => doc.id);
  }

  if (!everyOrphan) throw new Error("Give me --trn <TRN_MDIS_...>, --all or --unlinked");

  const trns = await db
    .collection("trns")
    .where(FieldPath.documentId(), ">=", "TRN_MDIS_")
    .where(FieldPath.documentId(), "<", "TRN_MDIS_\uf8ff")
    .get();

  const orphans = [];
  for (const doc of trns.docs) {
    if (doc.data()?.accessData?.access?.hasAccess !== "yes") continue;
    const ast = await db.collection("asts").doc(doc.id).get();
    if (!ast.exists) orphans.push(doc.id);
  }

  return orphans;
}

async function main() {
  const ids = await orphanTrnIds();
  console.log(
    `\nRG-R001 repair on ${project} · ${ids.length} transaction(s) · ${
      apply ? `APPLYING — reason: "${reason}"` : "DRY RUN — nothing will be written"
    }\n`,
  );

  const done = [];
  const stopped = [];
  let alreadyWhole = 0;

  for (const trnId of ids) {
    // One transaction that cannot be repaired must not stop the others. A repair is all-or-nothing for
    // its own records (RG-R001 section 1), never for the run.
    let outcome;
    try {
      outcome = await repairRegistration({
        db,
        Timestamp,
        trnId,
        actorUid: "TOOL",
        actorName: `${one("by", "the office")} (repair tool)`,
        reason,
        dryRun: !apply,
        deps,
      });
    } catch (error) {
      stopped.push({ trnId, message: error?.message || String(error) });
      console.log(`${trnId}\n  NOT REPAIRED — ${error?.message || error}\n`);
      continue;
    }

    // In --unlinked mode most meters are whole, and saying so 1,800 times helps nobody.
    if (everyUnlinked && outcome.code === "ALREADY_HAS_ITS_METER") {
      alreadyWhole += 1;
      continue;
    }

    console.log(`${trnId}\n  ${outcome.code} — ${outcome.message}`);
    if (outcome.willWrite) {
      console.log(
        `  meter ${outcome.willWrite.meterNo} · worked on ${outcome.willWrite.workedOn} by ${outcome.willWrite.worker}`,
      );
    }
    if (outcome.detail) console.log(`  ${outcome.detail}`);

    if (outcome.repaired) {
      done.push(outcome);
      // The counts and the flat rows are rebuilt from the meter, exactly as a fresh registration does.
      try {
        if (outcome.erfId && outcome.erfId !== "NAv") await rebuildErfMeterCounts(outcome.erfId);
        if (outcome.premiseId && outcome.premiseId !== "NAv") {
          await rebuildPremiseRegistryRow(outcome.premiseId);
        }
      } catch (error) {
        console.log(`  counts not rebuilt: ${error?.message || error}`);
      }
    }
    console.log("");
  }

  console.log(
    apply
      ? `${done.length} of ${ids.length} repaired.`
      : `Nothing written. ${ids.length} inspected.`,
  );
  if (alreadyWhole) console.log(`${alreadyWhole} were already linked everywhere.`);

  if (stopped.length) {
    console.log(`\n${stopped.length} could not be repaired, and nothing was written for them:`);
    for (const { trnId, message } of stopped) console.log(`  ${trnId}\n    ${message}`);
  }

  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("could not finish:", error?.message || error);
    process.exit(1);
  });
