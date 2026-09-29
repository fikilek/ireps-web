// A Sales All Meters row written before `lmPcode` was required is refused by the registration sync
// ("Sales All Meters target is missing required fields"), and that stops the meter being linked at all.
//
// The value is not invented: it is the lmPcode of the transaction that found the meter, which is the same
// municipality the Sales row belongs to. A row that names no such transaction is left alone.
//
// DRY RUN BY DEFAULT. --apply needs --reason and archives every row first.
//
//   node scripts/tools/registration/fill-sales-lmpcode.mjs --project ireps-test
//   node scripts/tools/registration/fill-sales-lmpcode.mjs --project ireps-test --apply --reason "..."
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const KEYS = {
  ireps2: "C:/dev/secrets/ireps2-e72fd9dc94de.json",
  "ireps-test": "C:/dev/secrets/ireps-test-firebase-adminsdk-fbsvc-d02929e1e3.json",
  "ireps-5c3e9": "C:/dev/secrets/ireps-5c3e9-firebase-adminsdk.json",
};
const NAMES = { ireps2: "DEV", "ireps-test": "TEST", "ireps-5c3e9": "LIVE" };

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

// Only the meters this environment actually has a registration for: the transaction is where the
// municipality comes from, so a Sales row with no meter behind it is not this tool's business.
async function rowsMissingLmPcode() {
  const asts = await db.collection("asts").get();
  const rows = [];

  for (const ast of asts.docs) {
    const data = ast.data() || {};
    const meterNo = data?.master?.id || "";
    const lmPcode = data?.accessData?.parents?.lmPcode || "";
    if (!meterNo || !lmPcode) continue;

    const sales = await db.collection("sales-all-meters").doc(meterNo).get();
    if (!sales.exists) continue;
    const before = sales.data() || {};
    if (Object.hasOwn(before, "lmPcode") && String(before.lmPcode || "").trim()) continue;

    rows.push({ meterNo, lmPcode, trnId: ast.id, before });
  }

  return rows;
}

async function main() {
  const rows = await rowsMissingLmPcode();

  console.log(
    `\nSales rows with no lmPcode on ${NAMES[project] || project} · ${rows.length} · ${
      apply ? `APPLYING — reason: "${reason}"` : "DRY RUN — nothing will be written"
    }\n`,
  );

  for (const row of rows) {
    console.log(`sales-all-meters/${row.meterNo}  lmPcode = ${row.lmPcode}  (from ${row.trnId})`);
  }

  if (!rows.length) {
    console.log("Every Sales row behind a meter carries its lmPcode.\n");
    return;
  }

  if (!apply) {
    console.log(`\nNothing written. ${rows.length} would be filled.\n`);
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const folder = join(archiveRoot, `sales-lmpcode-${NAMES[project] || project}-${stamp}`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "before.json"),
    JSON.stringify({ project, reason, at: new Date().toISOString(), rows }, null, 2),
    "utf-8",
  );
  console.log(`\narchived to ${join(folder, "before.json")}`);

  let done = 0;
  for (const row of rows) {
    try {
      await db
        .collection("sales-all-meters")
        .doc(row.meterNo)
        .set({ lmPcode: row.lmPcode }, { merge: true });
      done += 1;
    } catch (error) {
      console.log(`  NOT filled ${row.meterNo} — ${error?.message || error}`);
    }
  }

  console.log(`\n${done} of ${rows.length} filled.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("could not finish:", error?.message || error);
    process.exit(1);
  });
