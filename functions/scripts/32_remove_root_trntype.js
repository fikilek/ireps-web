// TR-R001 0.8.0 — take `trnType` off the root of every transaction.
//
// The owner, 4 October 2026: "let's remove trnType at root level. We already have it under
// accessData ... so we are redundant here" and "it's redundant and space costs money."
//
// It was at the root for one day. `0.3.0` put it there on 3 October and the backfill stamped
// it onto every record; `0.8.0` withdrew it the next morning. `accessData.trnType` is the home
// every transaction already had.
//
// SAFE TO REMOVE, CHECKED BEFORE WRITING THIS. No Firestore query asks for the root key - a
// query on a deleted field returns nothing rather than failing, which is the trap that holds
// up the other 22 keys in TR-R001 section 2A. Every server reader takes `accessData.trnType`
// first, and the web screens read a row from normalizeTrnRegistryDoc, which does the same.
//
// DRY RUN IS THE DEFAULT. Nothing is written without --apply AND the confirm token, and an
// archive of every document about to change is written first. It never deletes a document and
// never touches `accessData`.

import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_NAME = "32_remove_root_trntype.js";
const CONFIRM_TOKEN = "REMOVE_ROOT_TRNTYPE";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  console.log(`${SCRIPT_NAME} — ${args.projectId} — ${args.apply ? "APPLY" : "DRY RUN"}`);

  const snap = await db.collection("trns").get();
  const carrying = [];
  const disagreeing = [];
  const noAccessDataType = [];

  snap.docs.forEach((doc) => {
    const data = doc.data() || {};
    if (!("trnType" in data)) return;

    carrying.push({ id: doc.id, root: data.trnType, inner: data?.accessData?.trnType });

    // The one thing that must be true before the root copy goes: accessData holds the same
    // answer. A record where it does not would LOSE its type, so it is reported and skipped.
    const inner = String(data?.accessData?.trnType ?? "").trim();
    const root = String(data.trnType ?? "").trim();

    if (!inner) noAccessDataType.push({ id: doc.id, root });
    else if (inner !== root) disagreeing.push({ id: doc.id, root, inner });
  });

  console.log(`transactions: ${snap.size}`);
  console.log(`carrying a root trnType: ${carrying.length}`);
  console.log(`accessData.trnType missing (SKIPPED): ${noAccessDataType.length}`);
  console.log(`accessData.trnType disagrees (SKIPPED): ${disagreeing.length}`);

  noAccessDataType.forEach((row) => console.log(`  no accessData.trnType: ${row.id} (root ${row.root})`));
  disagreeing.forEach((row) => console.log(`  disagrees: ${row.id} root=${row.root} accessData=${row.inner}`));

  const skip = new Set([...noAccessDataType, ...disagreeing].map((row) => row.id));
  const toRemove = carrying.filter((row) => !skip.has(row.id));

  console.log(`to remove: ${toRemove.length}`);

  if (!args.apply) {
    console.log("DRY RUN — nothing written. Re-run with --apply --confirm " + CONFIRM_TOKEN);
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archivePath = path.join(__dirname, `root-trntype-${args.projectId}-${stamp}.json`);
  fs.writeFileSync(
    archivePath,
    JSON.stringify({ script: SCRIPT_NAME, project: args.projectId, at: stamp, removed: toRemove }, null, 2),
  );
  console.log(`archive: ${archivePath}`);

  let written = 0;

  for (let i = 0; i < toRemove.length; i += 400) {
    const batch = db.batch();
    toRemove.slice(i, i + 400).forEach((row) => {
      batch.update(db.collection("trns").doc(row.id), {
        trnType: admin.firestore.FieldValue.delete(),
      });
    });
    await batch.commit();
    written += Math.min(400, toRemove.length - i);
    console.log(`  written ${written}/${toRemove.length}`);
  }

  // VERIFY — read it back rather than trusting the writes.
  const after = await db.collection("trns").get();
  const left = after.docs.filter((doc) => "trnType" in (doc.data() || {}));
  const lostType = after.docs.filter((doc) => !String(doc.data()?.accessData?.trnType || "").trim());

  console.log(`VERIFY — root trnType left: ${left.length} (expected ${skip.size})`);
  console.log(`VERIFY — records with no type anywhere: ${lostType.length} (expected 0)`);
  console.log(left.length === skip.size && lostType.length === 0 ? "VERIFY PASS" : "VERIFY FAIL");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
