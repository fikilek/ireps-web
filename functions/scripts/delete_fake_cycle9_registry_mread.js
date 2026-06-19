#!/usr/bin/env node
/*
 * iREPS MREAD Staging Test Data Cleanup
 * Delete fake Cycle 9 registry_mread rows created for Cycle 10 staging tests.
 *
 * Safety:
 * - Dry-run by default.
 * - Firestore delete only when --confirm is supplied.
 * - Deletes only rows with fake: true, matching cycleId, safeToDelete: true,
 *   and seedType: FAKE_MREAD_CYCLE_9_TEST_DATA.
 */

import process from "node:process";
import admin from "firebase-admin";

const SCRIPT_NAME = "delete_fake_cycle9_registry_mread.js";
const REGISTRY_MREAD_COLLECTION = "registry_mread";
const DEFAULTS = Object.freeze({
  cycleId: "ZA2157_2025_2026_CYCLE_09",
  geofenceId: "Mvtjb8Jlgd02CmfnGjTQ",
  geofenceName: "Gf Maninjwa",
});

function parseArgs(argv) {
  const args = { ...DEFAULTS };

  for (let i = 2; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;

    const key = item.slice(2);
    const next = argv[i + 1];

    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }

  return args;
}

function readString(value, fallback = "NAv") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function isTargetFakeSeed(row = {}, args = {}) {
  return (
    row.fake === true &&
    row.fakeSeed?.safeToDelete === true &&
    row.fakeSeed?.seedType === "FAKE_MREAD_CYCLE_9_TEST_DATA" &&
    row.fakeSeed?.cycleId === args.cycleId &&
    row.cycle?.cycleId === args.cycleId &&
    row.fakeSeed?.targetGeofenceId === args.geofenceId &&
    row.geography?.geofenceId === args.geofenceId
  );
}

async function initDb() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  return admin.firestore();
}

async function findTargetRows({ db, args }) {
  const snap = await db
    .collection(REGISTRY_MREAD_COLLECTION)
    .where("fake", "==", true)
    .get();

  return snap.docs
    .map((doc) => ({ docId: doc.id, ref: doc.ref, row: doc.data() }))
    .filter((item) => isTargetFakeSeed(item.row, args))
    .sort((a, b) =>
      readString(a.row?.premise?.address).localeCompare(readString(b.row?.premise?.address)),
    );
}

async function deleteRows({ rows, confirm }) {
  if (!confirm) return { deleted: 0 };

  let deleted = 0;
  for (const item of rows) {
    await item.ref.delete();
    deleted += 1;
  }

  return { deleted };
}

async function main() {
  const args = parseArgs(process.argv);
  const confirm = Boolean(args.confirm);
  const mode = confirm ? "CONFIRMED DELETE" : "DRY RUN ONLY";
  const db = await initDb();
  const rows = await findTargetRows({ db, args });

  console.log("============================================================");
  console.log("iREPS — Delete Fake Cycle 9 registry_mread Rows");
  console.log("============================================================");
  console.log(`Script: ${SCRIPT_NAME}`);
  console.log(`Mode: ${mode}`);
  console.log(`Collection: ${REGISTRY_MREAD_COLLECTION}`);
  console.log(`Cycle: ${args.cycleId}`);
  console.log(`Geofence: ${args.geofenceName} (${args.geofenceId})`);
  console.log(`Matched safe fake rows: ${rows.length}`);
  console.log("------------------------------------------------------------");
  console.table(
    rows.map((item) => ({
      docId: item.docId,
      meterNo: item.row?.meter?.astNo,
      premiseAddress: item.row?.premise?.address,
      reading: item.row?.reading?.currentReading,
      readingAt: item.row?.reading?.readingAt,
      fake: item.row?.fake,
      safeToDelete: item.row?.fakeSeed?.safeToDelete,
    })),
  );

  if (!confirm) {
    console.log("------------------------------------------------------------");
    console.log("DRY RUN COMPLETE — no Firestore deletes performed.");
    console.log("Add --confirm to delete only the matched safe fake rows.");
    return;
  }

  const result = await deleteRows({ rows, confirm });
  console.log("------------------------------------------------------------");
  console.log("DELETE COMPLETE");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
