// RG-R001 section 8: find the registrations whose meter was never made, and say what a repair would do.
//
// READ ONLY. It writes nothing, anywhere, whatever it finds. It is the dry run the rule asks for, and
// the same tool for DEV, TEST and LIVE â€” the environment is chosen by the key it is given.
//
//   $env:NODE_OPTIONS = "--no-network-family-autoselection"
//   node scripts/tools/registration/inspect-orphan-registrations.mjs --project ireps2
//
// A repair itself is run by the office through repairRegistrationCallable, which asks this same
// question again before it writes anything.
import { readFileSync } from "node:fs";
import { cert, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";

import { inspectRegistration } from "../../../registration/repairRegistration.js";
import { normalizeMeterNo } from "../../../meterMaster/helpers.js";
import { validateMeterDiscoveryPayload } from "../../../meterDiscovery/validation.js";

const KEYS = {
  ireps2: "C:/dev/secrets/ireps2-e72fd9dc94de.json",
  "ireps-test": "C:/dev/secrets/ireps-test-firebase-adminsdk-fbsvc-d02929e1e3.json",
  "ireps-5c3e9": "C:/dev/secrets/ireps-5c3e9-firebase-adminsdk.json",
};

const args = process.argv.slice(2);
const project = args[args.indexOf("--project") + 1] || "ireps2";
const keyPath = KEYS[project];

if (!keyPath) {
  console.error(`Unknown project "${project}". One of: ${Object.keys(KEYS).join(", ")}`);
  process.exit(1);
}

initializeApp({
  credential: cert(JSON.parse(readFileSync(keyPath, "utf8"))),
  projectId: project,
});

const db = getFirestore();
const deps = { normalizeMeterNo, validateMeterDiscoveryPayload };

const line = (label, value) => console.log(`  ${label.padEnd(16)} ${value}`);

async function main() {
  console.log(`\nRG-R001 dry run â€” registrations with no meter, on ${project}\n`);

  // Every Meter Discovery, by its id, so no composite index is needed.
  const trnSnap = await db
    .collection("trns")
    .where(FieldPath.documentId(), ">=", "TRN_MDIS_")
    .where(FieldPath.documentId(), "<", "TRN_MDIS_\uf8ff")
    .get();

  const discoveries = trnSnap.docs;
  const accessed = discoveries.filter(
    (doc) => doc.data()?.accessData?.access?.hasAccess === "yes",
  );

  const orphans = [];

  for (const doc of accessed) {
    const astSnap = await db.collection("asts").doc(doc.id).get();
    if (!astSnap.exists) orphans.push(doc);
  }

  console.log(
    `${discoveries.length} Meter Discovery transactions, ${accessed.length} with access, ` +
      `${orphans.length} with no meter.\n`,
  );

  if (!orphans.length) {
    console.log("Nothing to repair.\n");
    return;
  }

  for (const doc of orphans) {
    const inspection = await inspectRegistration({ db, trnId: doc.id, deps });
    const data = doc.data() || {};

    console.log(doc.id);
    line("worked on", data?.metadata?.createdOnDevice || data?.metadata?.createdAt || "NAv");
    line("worker", data?.metadata?.createdByUser || "NAv");
    line("meter", data?.ast?.astData?.astNo || "NAv");
    line("premise", data?.accessData?.premise?.address || "NAv");
    line("erf", data?.accessData?.erfNo || "NAv");
    line("batch", data?.targetedBatchContext?.tbId || "none");
    line("verdict", inspection.repairable ? "CAN BE REPAIRED" : `REFUSED: ${inspection.code}`);

    if (inspection.detail) line("detail", inspection.detail);

    if (inspection.repairable) {
      line("would write", inspection.willWrite.ast);
      line("", inspection.willWrite.master);
      line("", `${inspection.willWrite.premise} (its meter list)`);
    }

    console.log("");
  }

  const repairable = [];
  for (const doc of orphans) {
    const inspection = await inspectRegistration({ db, trnId: doc.id, deps });
    if (inspection.repairable) repairable.push(doc.id);
  }

  console.log(
    `${repairable.length} of ${orphans.length} can be repaired. Nothing has been written.\n`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nThe dry run could not finish:", error?.message || error);
    process.exit(1);
  });
