// RG-R001 section 11: the balance, read from the meter. A meter exists everywhere or it does not exist.
//
// READ ONLY. It never writes. For every registration asset it checks the three records that must stand
// beside it, because a registration is finished only when all four are there:
//
//   1. the meter master document for its number exists;
//   2. that master's field link names THIS asset;
//   3. the premise carries the transaction on its own meter list.
//
// The orphan reading (a transaction with no meter) is inspect-orphan-registrations.mjs. This is the other
// direction, one layer deeper: a meter that exists but is not linked, which every count reads as finished.
//
//   node scripts/tools/registration/check-registration-links.mjs --project ireps2
import { writeFileSync } from "node:fs";

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
const out = one("out", "");

if (!KEYS[project]) {
  console.error(`Unknown project "${project}".`);
  process.exit(1);
}

process.env.GOOGLE_APPLICATION_CREDENTIALS = KEYS[project];
process.env.GCLOUD_PROJECT = project;
process.env.GOOGLE_CLOUD_PROJECT = project;

const { initializeApp } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
const { normalizeMeterNo } = await import("../../../meterMaster/helpers.js");
const { getServiceBucketFromMeterType } = await import("../../../meterLifecycle/helpers.js");
initializeApp();
const db = getFirestore();

const meterNoOf = (ast) => ast?.ast?.astData?.astNo || ast?.astData?.astNo || "";
const whenOf = (ast) => {
  const at = ast?.metadata?.createdOnServer || ast?.metadata?.createdAt;
  return at?.toDate ? at.toDate().toISOString().slice(0, 10) : "unknown";
};
const premiseOf = (ast) => ast?.accessData?.premise?.id || ast?.premiseId || "";

async function main() {
  const asts = await db.collection("asts").get();
  console.log(
    `\nRG-R001 section 11 — the reading from the meter, on ${NAMES[project] || project}. READ ONLY.\n`,
  );
  console.log(`${asts.size} meters.\n`);

  const faults = { noMaster: [], masterPointsElsewhere: [], notOnPremiseList: [], noPremise: [] };
  const premiseCache = new Map();
  let checked = 0;

  for (const doc of asts.docs) {
    const ast = doc.data() || {};
    const rawMeterNo = meterNoOf(ast);
    if (!rawMeterNo) continue;

    let normalized = "";
    try {
      normalized = normalizeMeterNo(rawMeterNo);
    } catch {
      continue;
    }
    checked += 1;

    const master = await db.collection("meter_master").doc(normalized).get();
    if (!master.exists) {
      faults.noMaster.push({ astId: doc.id, meterNo: rawMeterNo });
      continue;
    }
    const linkedAstId = master.data()?.refs?.asts?.id || "";
    if (linkedAstId !== doc.id) {
      faults.masterPointsElsewhere.push({
        astId: doc.id,
        meterNo: rawMeterNo,
        pointsAt: linkedAstId || "nothing",
        registeredAt: whenOf(ast),
      });
    }

    const premiseId = premiseOf(ast);
    if (!premiseId || premiseId === "NAv") {
      faults.noPremise.push({ astId: doc.id, meterNo: rawMeterNo });
      continue;
    }

    if (!premiseCache.has(premiseId)) {
      const snap = await db.collection("premises").doc(premiseId).get();
      premiseCache.set(premiseId, snap.exists ? snap.data() : null);
    }
    const premise = premiseCache.get(premiseId);
    if (!premise) {
      faults.noPremise.push({ astId: doc.id, meterNo: rawMeterNo, premiseId });
      continue;
    }

    const bucket = getServiceBucketFromMeterType({ meterType: ast?.meterType, trnId: doc.id }) || "";
    const list = Array.isArray(premise?.services?.[bucket]) ? premise.services[bucket] : [];
    const trnId = ast?.trnId || doc.id;
    if (!list.some((item) => item?.trnId === trnId)) {
      faults.notOnPremiseList.push({ astId: doc.id, meterNo: rawMeterNo, premiseId, bucket: bucket || "none" });
    }
  }

  const say = (label, rows, line) => {
    console.log(`${label}: ${rows.length}`);
    for (const row of rows.slice(0, 25)) console.log(`  ${line(row)}`);
    if (rows.length > 25) console.log(`  ... and ${rows.length - 25} more`);
    console.log("");
  };

  console.log(`${checked} of ${asts.size} carry a meter number and were checked.\n`);
  say("no meter master document", faults.noMaster, (r) => `${r.astId} · meter ${r.meterNo}`);
  say(
    "the master names another meter",
    faults.masterPointsElsewhere,
    (r) => `${r.registeredAt} · ${r.astId} · meter ${r.meterNo} · master points at ${r.pointsAt}`,
  );
  say(
    "not on its premise meter list",
    faults.notOnPremiseList,
    (r) => `${r.astId} · meter ${r.meterNo} · premise ${r.premiseId} · list ${r.bucket}`,
  );
  say("no premise to be listed on", faults.noPremise, (r) => `${r.astId} · meter ${r.meterNo}`);

  const total =
    faults.noMaster.length +
    faults.masterPointsElsewhere.length +
    faults.notOnPremiseList.length +
    faults.noPremise.length;
  console.log(total ? `${total} meter(s) are not linked everywhere.\n` : "Every meter is linked everywhere.\n");

  if (out) {
    writeFileSync(out, JSON.stringify({ project, meters: asts.size, checked, faults }, null, 2), "utf-8");
    console.log(`written to ${out}\n`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("could not finish:", error?.message || error);
    process.exit(1);
  });
