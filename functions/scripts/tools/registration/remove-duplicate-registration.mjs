// RG-R001 section 8: remove a duplicate attempt at one visit — a transaction with no meter whose meter
// number, ERF and premise already belong to a transaction that HAS the meter.
//
// DRY RUN BY DEFAULT. Nothing is deleted without --apply, and --apply needs --reason. Before it will delete
// anything it archives the whole document to C:\dev\backups and checks that nothing else points at it.
//
//   node scripts/tools/registration/remove-duplicate-registration.mjs --project ireps-5c3e9 --all
//   node scripts/tools/registration/remove-duplicate-registration.mjs --project ireps-5c3e9 --all --apply --reason "..."
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
const many = (name) =>
  args.reduce((found, arg, at) => (arg === `--${name}` ? [...found, args[at + 1]] : found), []);

const project = one("project", "ireps2");
const apply = args.includes("--apply");
const reason = one("reason", "");
const everyOrphan = args.includes("--all");
const archiveRoot = one("archive", "C:/dev/backups");

if (!KEYS[project]) {
  console.error(`Unknown project "${project}".`);
  process.exit(1);
}
if (apply && !reason.trim()) {
  console.error("--apply needs --reason: a removal is recorded in the words of the person who ran it.");
  process.exit(1);
}

process.env.GOOGLE_APPLICATION_CREDENTIALS = KEYS[project];
process.env.GCLOUD_PROJECT = project;
process.env.GOOGLE_CLOUD_PROJECT = project;

const { initializeApp } = await import("firebase-admin/app");
const { getFirestore, FieldPath } = await import("firebase-admin/firestore");
const { normalizeMeterNo } = await import("../../../meterMaster/helpers.js");
initializeApp();
const db = getFirestore();

const meterNoOf = (d) => d?.ast?.astData?.astNo || d?.assetData?.meterNo || "";
const erfOf = (d) => d?.accessData?.erfNo || d?.erfNo || "";
const premiseOf = (d) => d?.accessData?.premise?.id || d?.premiseId || "";
const workerOf = (d) => d?.metadata?.createdByUser || d?.trnMetadata?.createdBy?.name || "";
const iso = (v) => (v?.toDate ? v.toDate().toISOString() : String(v ?? ""));

async function orphanTrnIds() {
  const named = many("trn").filter(Boolean);
  if (named.length) return named;
  if (!everyOrphan) throw new Error("Give me --trn <TRN_MDIS_...> or --all");

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

// The survivor is found through the meter master, which is the one place a meter number is unique.
async function survivorOf(orphanId, orphan) {
  const meterNo = meterNoOf(orphan);
  if (!meterNo) return { why: "the transaction holds no meter number" };

  const master = await db.collection("meter_master").doc(normalizeMeterNo(meterNo)).get();
  if (!master.exists) {
    return { why: `meter ${meterNo} does not exist, so this is not a duplicate — repair it instead` };
  }

  // The field link is the only place a meter number points back at its meter (registerMeter.js step 2).
  const survivorId = master.data()?.refs?.asts?.id || "";
  if (!survivorId) return { why: `meter_master/${meterNo} names no transaction` };
  if (survivorId === orphanId) return { why: "the meter master already points at this transaction" };

  const survivor = await db.collection("trns").doc(survivorId).get();
  if (!survivor.exists) return { why: `the meter names transaction ${survivorId}, which does not exist` };

  const s = survivor.data();
  const ast = await db.collection("asts").doc(survivorId).get();
  if (!ast.exists) return { why: `${survivorId} has no meter either — neither of the two can be removed` };

  const differences = [];
  if (erfOf(s) !== erfOf(orphan)) differences.push(`ERF ${erfOf(orphan)} against ${erfOf(s)}`);
  if (premiseOf(s) !== premiseOf(orphan)) {
    differences.push(`premise ${premiseOf(orphan)} against ${premiseOf(s)}`);
  }
  if (differences.length) {
    return { why: `not the same visit: ${differences.join(", ")} — this needs a person` };
  }

  return { id: survivorId, data: s };
}

// Nothing may be deleted while something still points at it.
async function referencesTo(trnId) {
  const found = [];
  const rows = await db.collection("tb_rows").where("trnId", "==", trnId).get();
  for (const row of rows.docs) found.push(`tb_rows/${row.id}`);
  const refused = await db.collection("refused_submissions").doc(trnId).get();
  if (refused.exists) found.push(`refused_submissions/${trnId}`);
  const ast = await db.collection("asts").doc(trnId).get();
  if (ast.exists) found.push(`asts/${trnId} — it HAS a meter, so this is not an orphan`);
  return found;
}

async function main() {
  const ids = await orphanTrnIds();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const folder = join(archiveRoot, `registration-duplicates-${NAMES[project] || project}-${stamp}`);

  console.log(
    `\nRG-R001 section 8 · duplicate removal on ${NAMES[project] || project} · ${ids.length} transaction(s) · ${
      apply ? `APPLYING — reason: "${reason}"` : "DRY RUN — nothing will be deleted"
    }\n`,
  );

  const removable = [];
  const held = [];

  for (const trnId of ids) {
    const snap = await db.collection("trns").doc(trnId).get();
    if (!snap.exists) {
      held.push({ trnId, why: "the transaction no longer exists" });
      continue;
    }
    const orphan = snap.data();
    const survivor = await survivorOf(trnId, orphan);

    console.log(`${trnId}`);
    console.log(
      `  meter ${meterNoOf(orphan)} · ERF ${erfOf(orphan)} · ${workerOf(orphan)} · ${iso(
        orphan?.metadata?.createdAt,
      )}`,
    );

    if (survivor.why) {
      console.log(`  HELD — ${survivor.why}\n`);
      held.push({ trnId, why: survivor.why });
      continue;
    }

    const refs = await referencesTo(trnId);
    if (refs.length) {
      console.log(`  HELD — something still points at it: ${refs.join(", ")}\n`);
      held.push({ trnId, why: `still referenced: ${refs.join(", ")}` });
      continue;
    }

    console.log(`  the meter belongs to ${survivor.id} (same ERF, same premise, ${workerOf(survivor.data)})`);
    console.log(`  ${apply ? "REMOVING" : "would remove"} this duplicate; the one with the meter stands\n`);
    removable.push({ trnId, orphan, survivorId: survivor.id, media: orphan?.media || [] });
  }

  if (!apply) {
    console.log(`Nothing deleted. ${removable.length} of ${ids.length} would be removed.`);
    if (held.length) {
      console.log(`\n${held.length} held back:`);
      for (const { trnId, why } of held) console.log(`  ${trnId}\n    ${why}`);
    }
    console.log(`\nOn --apply the archive is written to:\n  ${folder}\n`);
    return;
  }

  // Archive BEFORE anything is deleted (the LIVE data rule).
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "removal.json"),
    JSON.stringify(
      {
        rule: "RG-R001 1.2.0 section 8 — a duplicate attempt is removed, not repaired",
        project,
        environment: NAMES[project] || project,
        reason,
        by: one("by", "the office"),
        at: new Date().toISOString(),
        removed: removable.map(({ trnId, orphan, survivorId, media }) => ({
          trnId,
          survivorId,
          meterNo: meterNoOf(orphan),
          erfNo: erfOf(orphan),
          premiseId: premiseOf(orphan),
          worker: workerOf(orphan),
          mediaLeftInStorage: media,
          document: JSON.parse(
            JSON.stringify(orphan, (key, value) => (value?._seconds ? iso(value) : value)),
          ),
        })),
        heldBack: held,
      },
      null,
      2,
    ),
    "utf-8",
  );
  console.log(`archived ${removable.length} document(s) to ${join(folder, "removal.json")}`);

  let deleted = 0;
  for (const { trnId } of removable) {
    try {
      await db.collection("trns").doc(trnId).delete();
      deleted += 1;
      console.log(`  deleted trns/${trnId}`);
    } catch (error) {
      console.log(`  NOT deleted trns/${trnId} — ${error?.message || error}`);
    }
  }

  console.log(`\n${deleted} of ${removable.length} removed.`);
  if (held.length) {
    console.log(`\n${held.length} held back, and nothing was written for them:`);
    for (const { trnId, why } of held) console.log(`  ${trnId}\n    ${why}`);
  }
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("could not finish:", error?.message || error);
    process.exit(1);
  });
