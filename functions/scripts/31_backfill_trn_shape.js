// Stage H — the backfill: bring every transaction to the agreed shape.
//
// Rules: TR-R001 0.6.0 (transactions/transaction-shape-rules.md), NA-R035…NA-R039, NA-R080…NA-R086.
// Schema: ireps-schemas/transactions/trn.schema.md 0.6.0.
//
// NA-R080 — WRITERS FIRST, THEN DATA. The writers changed on 3 October (K.4, web b57b8f9 and
// mobile 6ab683d), so nothing new arrives in the old shape while this runs.
//
// DRY RUN IS THE DEFAULT. Nothing is written without --apply AND the confirm token, and an
// archive of every document about to change is written first. NA-R082: on LIVE this is
// measure, dry run, archive, apply, verify — on the owner's own go, never anything else.
//
// WHAT IT WILL NOT DO. It never invents. A device time nobody captured stays empty (TR-R002:
// "leave them empty for the true reflection of what they truly are"), and a record whose
// premise cannot be resolved is reported — not guessed at, and not quietly deleted.

import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatPropertyType, formatStreetAddress } from "../premises/streetAddress.js";

const SCRIPT_NAME = "31_backfill_trn_shape.js";
const CONFIRM_TOKEN = "BACKFILL_TRN_SHAPE";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// TR-R001 section 2: the root, present and empty rather than absent.
const ROOT_OBJECT_KEYS = ["status", "assignment", "origin", "workflow", "serviceProvider"];

// TR-R001: one work property, named for the work — never the other five empty beside it.
const WORK_PROPERTY_BY_TYPE = {
  METER_COMMISSIONING: "commissioning",
  METER_DISCONNECTION: "disconnection",
  METER_RECONNECTION: "reconnection",
  METER_REMOVAL: "removal",
  METER_INSPECTION: "inspection",
  METER_READING: "meterReading",
  METER_DISCOVERY: "discovery",
  METER_INSTALLATION: "installation",
};
const ALL_WORK_PROPERTIES = Object.values(WORK_PROPERTY_BY_TYPE);

// TR-R002: twelve keys. The server six are already on all 493; these six are the device set,
// which has never been written on any record, and they are created EMPTY — not filled.
const DEVICE_METADATA_KEYS = [
  "createdOnDevice",
  "createdOnDeviceByUid",
  "createdOnDeviceByUser",
  "updatedOnDevice",
  "updatedOnDeviceByUid",
  "updatedOnDeviceByUser",
];

// TR-R002: retired. Measured 13 of 13 identical to createdAt / updatedAt.
const RETIRED_METADATA_KEYS = ["createdOnServer", "updatedOnServer"];

function parseArgs(argv) {
  const args = { projectId: "ireps2", apply: false, confirm: null, help: false };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--project") {
      args.projectId = argv[i + 1];
      i += 1;
    } else if (arg === "--confirm") {
      args.confirm = argv[i + 1];
      i += 1;
    } else if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }

  return args;
}

const get = (obj, ...keys) => {
  let cur = obj;
  for (const key of keys) {
    if (!cur || typeof cur !== "object" || !(key in cur)) return undefined;
    cur = cur[key];
  }
  return cur;
};

const isFilled = (value) =>
  value !== undefined &&
  value !== null &&
  value !== "" &&
  !(typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);

// The same reader the server uses (readGpsPoint in noAccess/recordNoAccess.js), deliberately
// kept in step with it: a backfill that accepted a position the server would reject would
// write records the live code could never produce.
function readGpsPoint(value) {
  const gps = value?.gps || value;
  const lat = Number(gps?.lat ?? gps?.latitude);
  const lng = Number(gps?.lng ?? gps?.longitude);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }

  return { lat, lng };
}

/**
 * Where a transaction names its meter.
 *
 * It is `ast.astData.astId`. NOT `ast.astData.id`, which does not exist — and asking for it
 * returns undefined on every record, so no asset is ever found and EVERY repaired position
 * falls back to the premise.
 *
 * That is not a harmless miss. Under TR-R003 a PREMISE label on work where the meter is known
 * means "this meter has no position of its own, go and look at it". The first run of this
 * script would have written that onto 81 records whose meter's exact position was sitting in
 * `asts` all along — 81 manufactured defect signals, each one looking exactly like a finding.
 *
 * The same shape of mistake as asking premises for `accessData.erfId`. Both times the wrong
 * field answered quietly instead of failing.
 */
function assetIdOf(data) {
  return get(data, "ast", "astData", "astId") || get(data, "astId") || "";
}

async function readMany(db, collection, ids) {
  const out = new Map();
  const list = [...ids];

  for (let i = 0; i < list.length; i += 200) {
    const refs = list.slice(i, i + 200).map((id) => db.collection(collection).doc(id));
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap) => {
      if (snap.exists) out.set(snap.id, snap.data());
    });
  }

  return out;
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    console.log(SCRIPT_NAME);
    console.log("");
    console.log("  Dry run (the default — writes nothing):");
    console.log(`    node functions/scripts/${SCRIPT_NAME} --project ireps2`);
    console.log("");
    console.log("  Apply:");
    console.log(
      `    node functions/scripts/${SCRIPT_NAME} --project ireps2 --apply --confirm ${CONFIRM_TOKEN}`,
    );
    return;
  }

  const willWrite = args.apply === true;

  if (willWrite && args.confirm !== CONFIRM_TOKEN) {
    console.error(`REFUSED: --apply needs --confirm ${CONFIRM_TOKEN}`);
    process.exitCode = 1;
    return;
  }

  // DEV only. TEST and LIVE are the release chat's, and LIVE needs the owner's own go
  // (NA-R082) — so there is no key here to run it with by accident.
  const keyByProject = { ireps2: "C:/dev/secrets/ireps2-e72fd9dc94de.json" };
  const keyPath = keyByProject[args.projectId];

  if (!keyPath) {
    console.error(`REFUSED: no key is configured for project "${args.projectId}".`);
    console.error("TEST and LIVE are not run from here (NA-R082).");
    process.exitCode = 1;
    return;
  }

  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, "utf8"))),
  });
  const db = admin.firestore();

  console.log(`${SCRIPT_NAME} — project ${args.projectId} — ${willWrite ? "APPLY" : "DRY RUN"}`);
  console.log("");

  const snap = await db.collection("trns").get();
  const rows = [];
  snap.forEach((doc) => rows.push({ id: doc.id, data: doc.data() }));
  console.log(`transactions read: ${rows.length}`);

  const premiseIds = new Set();
  const astIds = new Set();
  const erfIds = new Set();

  for (const { data } of rows) {
    const premiseId = get(data, "accessData", "premise", "id");
    if (isFilled(premiseId)) premiseIds.add(premiseId);

    const erfId = get(data, "accessData", "erfId");
    if (isFilled(erfId)) erfIds.add(erfId);

    const astId = assetIdOf(data);
    if (isFilled(astId)) astIds.add(astId);
  }

  const premiseById = await readMany(db, "premises", premiseIds);
  const erfById = await readMany(db, "ireps_erfs", erfIds);
  const astById = await readMany(db, "asts", astIds);

  // Premises BY ERF, so a transaction with no premise can be resolved where its ERF holds
  // exactly one.
  //
  // NOTE THE FIELD NAME. Premises keep the ERF at `erfId`, NOT at `accessData.erfId`. Asking
  // for the wrong one returns zero premises for every ERF, which reads exactly like "there is
  // nothing to repair from" — and on 3 October that would have condemned 5 repairable records
  // as unrepairable. A silent empty query is the most dangerous answer a backfill can get,
  // because it looks like a finding.
  const premisesByErf = new Map();
  const allPremises = await db.collection("premises").get();

  allPremises.forEach((doc) => {
    const erfId = doc.data()?.erfId;
    if (!isFilled(erfId)) return;
    if (!premisesByErf.has(erfId)) premisesByErf.set(erfId, []);
    premisesByErf.get(erfId).push({ id: doc.id, ...doc.data() });
  });

  console.log(
    `premises: ${allPremises.size} · ERFs: ${erfById.size} · assets: ${astById.size}`,
  );
  console.log("");

  const tally = {};
  const count = (key) => {
    tally[key] = (tally[key] || 0) + 1;
  };

  const plans = [];
  const unresolved = [];

  for (const { id, data } of rows) {
    const update = {};
    const trnType = get(data, "accessData", "trnType");

    // 1. trnType at the root, taken from accessData, which carries it on every record.
    if (!isFilled(data.trnType) && isFilled(trnType)) {
      update.trnType = trnType;
      count("trnType at the root");
    }

    // 2. the root keys: present and empty rather than absent.
    for (const key of ROOT_OBJECT_KEYS) {
      if (!(key in data)) {
        update[key] = {};
        count("root key present and empty");
      }
    }

    // 3. one work property. The others go only where they hold NOTHING — an empty block says
    //    nothing and sends a reader to the wrong place, but a filled one is data, and a shape
    //    repair never deletes data. A filled block on the wrong type is reported instead.
    const ownProperty = WORK_PROPERTY_BY_TYPE[trnType];

    for (const property of ALL_WORK_PROPERTIES) {
      if (property === ownProperty) continue;
      if (!(property in data)) continue;

      if (isFilled(data[property])) {
        unresolved.push({ id, why: `carries a FILLED ${property} but is a ${trnType}` });
        continue;
      }

      update[property] = admin.firestore.FieldValue.delete();
      count("empty work property dropped");
    }

    // 4. metadata: the device set created empty, the duplicates removed.
    for (const key of DEVICE_METADATA_KEYS) {
      if (!(key in (data.metadata || {}))) {
        update[`metadata.${key}`] = null;
        count("device metadata key created empty");
      }
    }

    for (const key of RETIRED_METADATA_KEYS) {
      if (key in (data.metadata || {})) {
        update[`metadata.${key}`] = admin.firestore.FieldValue.delete();
        count("retired metadata key removed");
      }
    }

    // 5. the municipality and the ward, from the ERF, which is the authority for where a
    //    property is. Without them a record exists and cannot be found (GMR-R027).
    const erf = erfById.get(get(data, "accessData", "erfId"));

    if (erf) {
      if (!isFilled(get(data, "accessData", "parents", "lmPcode"))) {
        const lm = get(erf, "admin", "localMunicipality", "pcode");
        if (isFilled(lm)) {
          update["accessData.parents.lmPcode"] = String(lm).toUpperCase();
          count("lmPcode from the ERF");
        }
      }

      if (!isFilled(get(data, "accessData", "parents", "wardPcode"))) {
        const ward = get(erf, "admin", "ward", "pcode");
        if (isFilled(ward)) {
          update["accessData.parents.wardPcode"] = String(ward).toUpperCase();
          count("wardPcode from the ERF");
        }
      }
    }

    // 6. the premise, where its ERF holds exactly one and there is no doubt which.
    let premiseId = get(data, "accessData", "premise", "id");

    if (!isFilled(premiseId)) {
      const candidates = premisesByErf.get(get(data, "accessData", "erfId")) || [];
      const named = candidates.filter((p) => (p.noAccessTrnIds || []).includes(id));

      if (named.length === 1) premiseId = named[0].id;
      else if (candidates.length === 1) premiseId = candidates[0].id;

      if (isFilled(premiseId)) {
        const premise = candidates.find((p) => p.id === premiseId);
        update["accessData.premise.id"] = premiseId;
        // Stamped, so no reader mistakes a premise attached months later for the one the
        // worker stood at (plan H.2).
        update["accessData.premise.attachedByBackfill"] = true;
        count("premise resolved from its ERF");
        premiseById.set(premiseId, premise);
      } else {
        unresolved.push({
          id,
          why:
            candidates.length === 0
              ? "no premise exists on its ERF"
              : `${candidates.length} premises on its ERF and none names it`,
        });
      }
    }

    // 6a. the premise written the way every other transaction writes it (NA-R030): the address
    //     and the property type as WORDS, from the premise document, which is the authority
    //     for its own address.
    //
    //     The owner, 3 October, on the TRN Registry: "there is no access without an address."
    //     normalizeNoAccessPremise used to return the id alone, so these showed NAv while 478
    //     of the other 493 showed their street.
    const premiseDoc = premiseById.get(premiseId);

    if (premiseDoc) {
      const address = formatStreetAddress(premiseDoc.address);
      const propertyType = formatPropertyType(premiseDoc.propertyType);
      const currentAddress = get(data, "accessData", "premise", "address");
      const currentType = get(data, "accessData", "premise", "propertyType");

      if (address && (!isFilled(currentAddress) || currentAddress === "NAv")) {
        update["accessData.premise.address"] = address;
        count("premise address from the premise");
      }

      if (propertyType && (!isFilled(currentType) || currentType === "NAv")) {
        update["accessData.premise.propertyType"] = propertyType;
        count("premise property type from the premise");
      }
    }

    // 7. the position: the asset's own, else the premise's — and it always says which
    //    (TR-R003). A PREMISE label on work where the meter is known is a defect to look at,
    //    not a tidy result.
    if (!readGpsPoint(get(data, "ast", "location"))) {
      const assetPoint = readGpsPoint(get(astById.get(assetIdOf(data)), "ast", "location"));

      if (assetPoint) {
        update["ast.location.gps"] = assetPoint;
        update["ast.location.source"] = "ASSET";
        count("position from the asset");
      } else {
        const premisePoint = readGpsPoint(
          get(premiseById.get(premiseId), "geometry", "centroid"),
        );

        if (premisePoint) {
          update["ast.location.gps"] = premisePoint;
          update["ast.location.source"] = "PREMISE";
          count("position from the premise");
        } else if (!unresolved.some((item) => item.id === id)) {
          unresolved.push({ id, why: "neither the asset nor the premise has a position" });
        }
      }
    }

    // 7a. a position that is already there but says nothing about itself.
    //
    // TR-R003 requires the label on every position, not only on the ones this script fills.
    // 388 records had a position and no source.
    //
    // Where the worker HAD access the position was captured standing at the meter - that is
    // where `asts` got its own position from in the first place - so it is the asset's and is
    // labelled ASSET.
    //
    // Where the worker had NO access it was captured at a gate by the old No Access screen, so
    // it is neither the asset's nor the premise's: it is the worker's own fix, which TR-R003
    // says is not what this field holds. Replacing it is a real change to a recorded field
    // observation, so this script REPORTS those and does not touch them. The owner decides.
    const existingPoint = readGpsPoint(get(data, "ast", "location"));

    if (existingPoint && !isFilled(get(data, "ast", "location", "source"))) {
      const hadAccess = String(get(data, "accessData", "access", "hasAccess") || "").toLowerCase();

      if (hadAccess === "yes") {
        update["ast.location.source"] = "ASSET";
        count("existing position labelled ASSET");
      } else {
        unresolved.push({
          id,
          why: "no access with a position captured at the gate by the old screen - owner's call",
        });
      }
    }

    // 8. the retired home for the position.
    if ("location" in data) {
      update.location = admin.firestore.FieldValue.delete();
      count("root location removed");
    }

    if (Object.keys(update).length) plans.push({ id, update, before: data });
  }

  console.log("WHAT WOULD CHANGE");
  for (const [key, value] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key.padEnd(38)} ${String(value).padStart(5)}`);
  }

  console.log("");
  console.log(`documents to update : ${plans.length}`);
  console.log(`documents untouched : ${rows.length - plans.length}`);
  console.log("");

  if (unresolved.length) {
    console.log(`CANNOT BE REPAIRED — ${unresolved.length}.`);
    console.log("Reported, never guessed at, and NEVER deleted by this script:");
    console.log("NA-R086 is the owner's call, not a default.");
    for (const item of unresolved) console.log(`  ${item.id}  —  ${item.why}`);
    console.log("");
  }

  if (!willWrite) {
    console.log("DRY RUN — nothing was written.");
    console.log(`To apply: --apply --confirm ${CONFIRM_TOKEN}`);
    return;
  }

  // Archive first, always (NA-R082). Every document exactly as it is now, before anything
  // touches it.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveDir = path.join(__dirname, "archive");
  fs.mkdirSync(archiveDir, { recursive: true });

  const archivePath = path.join(archiveDir, `trn-shape-${args.projectId}-${stamp}.json`);
  fs.writeFileSync(
    archivePath,
    JSON.stringify(
      {
        script: SCRIPT_NAME,
        project: args.projectId,
        at: stamp,
        documents: plans.map((plan) => ({ id: plan.id, before: plan.before })),
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`archived ${plans.length} documents as they are now → ${archivePath}`);

  let written = 0;
  for (let i = 0; i < plans.length; i += 400) {
    const slice = plans.slice(i, i + 400);
    const batch = db.batch();
    for (const plan of slice) batch.update(db.collection("trns").doc(plan.id), plan.update);
    await batch.commit();
    written += slice.length;
    console.log(`  written ${written}/${plans.length}`);
  }

  console.log("");
  console.log("VERIFY — reading every transaction back");

  const after = await db.collection("trns").get();
  const failures = [];

  after.forEach((doc) => {
    const d = doc.data();
    const faults = [];

    if (ROOT_OBJECT_KEYS.some((key) => !(key in d))) faults.push("a root key is absent");
    if (!isFilled(d.trnType)) faults.push("no trnType at the root");
    if (!readGpsPoint(get(d, "ast", "location"))) faults.push("no position");
    if (!isFilled(get(d, "ast", "location", "source"))) faults.push("position with no source");
    if (RETIRED_METADATA_KEYS.some((key) => key in (d.metadata || {}))) faults.push("a retired metadata key");
    if ("location" in d) faults.push("root location");
    if (DEVICE_METADATA_KEYS.some((key) => !(key in (d.metadata || {})))) faults.push("a device metadata key is absent");
    if (isFilled(get(d, "accessData", "premise", "id")) && !isFilled(get(d, "accessData", "premise", "address"))) faults.push("a premise with no address");

    if (faults.length) failures.push({ id: doc.id, faults });
  });

  // Every check above, so the count and the list are the same set. A verify that counts one
  // thing and explains another is how a number nobody can reconcile gets believed.
  console.log(`  transactions not yet in the agreed shape: ${failures.length}`);
  for (const failure of failures) {
    console.log(`    ${failure.id}  —  ${failure.faults.join("; ")}`);
  }
}

main().catch((error) => {
  console.error("FAILED:", error?.message || error);
  process.exitCode = 1;
});
