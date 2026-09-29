// TB-R056 (rules 1.3.52, 1.3.56, 1.3.88): run "a batch row follows its Sales meter" again, by hand.
//
// The trigger fires when a Sales meter turns VISIBLE. A meter that was already VISIBLE while the rule was
// standing down wrongly (1.3.88) never gets a second event, so its row stays open until the rule is asked
// again. This asks it.
//
// DRY RUN BY DEFAULT: it reads, decides, and prints what it would write. Nothing is written without
// --apply. On LIVE it is archive first, dry run the owner reads, apply, then verify.
//
//   node scripts/tools/registration/rerun-row-follows-sales.mjs --project ireps2 --meter 04299590580
//   node scripts/tools/registration/rerun-row-follows-sales.mjs --project ireps2 --batch TGB_... --apply
import { readFileSync } from "node:fs";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  applyRowFollowsSales,
  gatherRowFollowsSalesFacts,
} from "../../../targetedBatches/rowFollowsSalesTrigger.js";
import { decideRowFollowsSales } from "../../../targetedBatches/rowFollowsSales.js";

const KEYS = {
  ireps2: "C:/dev/secrets/ireps2-e72fd9dc94de.json",
  "ireps-test": "C:/dev/secrets/ireps-test-firebase-adminsdk-fbsvc-d02929e1e3.json",
  "ireps-5c3e9": "C:/dev/secrets/ireps-5c3e9-firebase-adminsdk.json",
};

const args = process.argv.slice(2);
const values = (name) =>
  args.reduce(
    (found, arg, at) => (arg === `--${name}` ? [...found, args[at + 1]] : found),
    [],
  );
const project = values("project")[0] || "ireps2";
const apply = args.includes("--apply");

initializeApp({
  credential: cert(JSON.parse(readFileSync(KEYS[project], "utf8"))),
  projectId: project,
});

const db = getFirestore();

async function salesIdsToRun() {
  const meters = values("meter").filter(Boolean);
  if (meters.length) return meters;

  const tbId = values("batch")[0];
  if (!tbId) throw new Error("Give me --meter <number> or --batch <TGB_...>");

  const rows = await db.collection("tb_rows").where("tbId", "==", tbId).get();
  return rows.docs
    .filter(
      (row) =>
        String(row.data()?.execution?.status || "NOT_STARTED").toUpperCase() !==
        "COMPLETED",
    )
    .map((row) => row.data()?.salesAllMeterId)
    .filter(Boolean);
}

async function main() {
  const salesIds = await salesIdsToRun();
  console.log(
    `\nTB-R056 on ${project} · ${salesIds.length} meter(s) · ${
      apply ? "APPLYING" : "DRY RUN — nothing will be written"
    }\n`,
  );

  for (const salesId of salesIds) {
    if (!apply) {
      const facts = await gatherRowFollowsSalesFacts({
        db,
        get: (ref) => ref.get(),
        salesId,
      });
      const plan = decideRowFollowsSales(facts);

      console.log(
        `${salesId}  ${plan.decision}  ${plan.code}` +
          `${plan.rowId ? `  row ${plan.rowId}` : ""}` +
          `${plan.finder ? `  finder ${plan.finder.user}` : ""}` +
          `${plan.detail ? `  (${plan.detail})` : ""}`,
      );
      continue;
    }

    const result = await applyRowFollowsSales({ db, salesId });
    console.log(
      `${salesId}  ${result.decision}  ${result.code}` +
        `${result.rowId ? `  row ${result.rowId}` : ""}` +
        `${result.writes ? `\n   wrote: ${result.writes.join("; ")}` : ""}`,
    );
  }

  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("could not finish:", error?.message || error);
    process.exit(1);
  });
