// The Meter Placement list was reworded on 17 August 2026 (commit 7952413): "Top Pole" became "Pole Top",
// and the bottom of the pole with it. Transactions captured before that day still hold the old wording, so
// today's validator refuses them - which stops their meters being linked, and stops them being repaired.
//
// This is not an accommodation for dirty data: the value means the same position, and the phone itself
// offered the old words. It is the same placement, written the way the list writes it now.
//
// DRY RUN BY DEFAULT. --apply needs --reason, archives every document first, and records the correction on
// the transaction so nobody later reads it as a worker's own words.
//
//   node scripts/tools/registration/fix-old-placement-wording.mjs --project ireps-test
//   node scripts/tools/registration/fix-old-placement-wording.mjs --project ireps-test --apply --reason "..."
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const KEYS = {
  ireps2: "C:/dev/secrets/ireps2-e72fd9dc94de.json",
  "ireps-test": "C:/dev/secrets/ireps-test-firebase-adminsdk-fbsvc-d02929e1e3.json",
  "ireps-5c3e9": "C:/dev/secrets/ireps-5c3e9-firebase-adminsdk.json",
};
const NAMES = { ireps2: "DEV", "ireps-test": "TEST", "ireps-5c3e9": "LIVE" };

// The old wording, and the approved option it means. Nothing else is touched.
const RENAMED = new Map([
  ["Top Pole", "Pole Top"],
  ["Bottom Pole", "Pole Bottom"],
]);

// The approved options, so a value that differs only in capitals is corrected to the way the list writes
// it. "kiosk" is Kiosk. This is the same option, not a different one, and nothing is guessed.
const APPROVED = [
  "Kiosk",
  "Pole Top",
  "Pole Bottom",
  "Boundary Wall",
  "Meter Room",
  "Wall Indoors",
  "Inside Property",
  "Other",
];

const args = process.argv.slice(2);
const one = (name, fallback = "") => {
  const at = args.indexOf(`--${name}`);
  return at > -1 ? args[at + 1] : fallback;
};
const project = one("project", "ireps2");
const apply = args.includes("--apply");
const reason = one("reason", "");
const archiveRoot = one("archive", "C:/dev/backups");

if (!KEYS[project]) {
  console.error(`Unknown project "${project}".`);
  process.exit(1);
}
if (apply && !reason.trim()) {
  console.error("--apply needs --reason.");
  process.exit(1);
}

process.env.GOOGLE_APPLICATION_CREDENTIALS = KEYS[project];
process.env.GCLOUD_PROJECT = project;
process.env.GOOGLE_CLOUD_PROJECT = project;

const { initializeApp } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
initializeApp();
const db = getFirestore();

const iso = (v) => (v?.toDate ? v.toDate().toISOString() : String(v ?? ""));

async function main() {
  const found = [];

  // Every value in use, so capitals and the old wording are both caught in one pass.
  const all = await db.collection("trns").get();
  const approvedByLower = new Map(APPROVED.map((word) => [word.toLowerCase(), word]));
  for (const [oldWord, approved] of RENAMED) {
    approvedByLower.set(oldWord.toLowerCase(), approved);
  }

  {
    for (const doc of all.docs) {
      const d = doc.data() || {};
      const held = String(d?.ast?.location?.placement || "").trim();
      if (!held) continue;
      const approved = approvedByLower.get(held.toLowerCase());
      if (!approved || approved === held) continue;
      const oldWord = held;
      found.push({
        trnId: doc.id,
        oldWord,
        approved,
        meterNo: d?.ast?.astData?.astNo || "NAv",
        erfNo: d?.accessData?.erfNo || "NAv",
        worker: d?.metadata?.createdByUser || "NAv",
        capturedAt: iso(d?.metadata?.createdAt),
      });
    }
  }

  console.log(
    `\nMeter Placement wording on ${NAMES[project] || project} · ${found.length} transaction(s) · ${
      apply ? `APPLYING — reason: "${reason}"` : "DRY RUN — nothing will be written"
    }\n`,
  );

  for (const row of found) {
    console.log(`${row.trnId}`);
    console.log(
      `  "${row.oldWord}" becomes "${row.approved}" · meter ${row.meterNo} · ERF ${row.erfNo} · ${row.worker} · ${row.capturedAt.slice(0, 10)}`,
    );
  }

  if (!found.length) {
    console.log("Nothing holds the old wording.\n");
    return;
  }

  if (!apply) {
    console.log(`\nNothing written. ${found.length} would be corrected.\n`);
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const folder = join(archiveRoot, `placement-wording-${NAMES[project] || project}-${stamp}`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "before.json"),
    JSON.stringify({ project, reason, at: new Date().toISOString(), rows: found }, null, 2),
    "utf-8",
  );
  console.log(`\narchived to ${join(folder, "before.json")}`);

  let done = 0;
  for (const row of found) {
    try {
      await db
        .collection("trns")
        .doc(row.trnId)
        .set(
          {
            ast: { location: { placement: row.approved } },
            // Recorded, so nobody later reads the new words as the worker's own.
            corrections: {
              placementWording: {
                from: row.oldWord,
                to: row.approved,
                at: new Date().toISOString(),
                by: one("by", "the office"),
                reason: reason.trim(),
              },
            },
          },
          { merge: true },
        );
      done += 1;
    } catch (error) {
      console.log(`  NOT corrected ${row.trnId} — ${error?.message || error}`);
    }
  }

  console.log(`\n${done} of ${found.length} corrected.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("could not finish:", error?.message || error);
    process.exit(1);
  });
