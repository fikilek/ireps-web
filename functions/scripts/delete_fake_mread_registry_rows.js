import fs from "fs";
import path from "path";
import admin from "firebase-admin";

const DEFAULT_COLLECTION = "registry_mread";
const DEFAULT_LM_PCODE = "ZA2157";
const DEFAULT_BATCH_LIMIT = 450;
const CONFIRM_TEXT = "DELETE_FAKE_MREAD_REGISTRY_ROWS";
const FAKE_SEED_PREFIX = "FAKE_MREAD";

function parseArgs(argv) {
  const args = {
    collection: DEFAULT_COLLECTION,
    lmPcode: DEFAULT_LM_PCODE,
    batchLimit: DEFAULT_BATCH_LIMIT,
    execute: false,
    confirm: "",
    allLms: false,
    reportDir: path.join(process.cwd(), "scripts", "reports"),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--execute") {
      args.execute = true;
    } else if (arg === "--all-lms") {
      args.allLms = true;
    } else if (arg === "--collection") {
      args.collection = argv[++i] || args.collection;
    } else if (arg === "--lm") {
      args.lmPcode = argv[++i] || args.lmPcode;
    } else if (arg === "--batch-limit") {
      const parsed = Number(argv[++i]);
      args.batchLimit = Number.isFinite(parsed) && parsed > 0 ? parsed : args.batchLimit;
    } else if (arg === "--confirm") {
      args.confirm = argv[++i] || "";
    } else if (arg === "--report-dir") {
      args.reportDir = argv[++i] || args.reportDir;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }

  return args;
}

function printHelp() {
  console.log(`
Delete fake MREAD registry rows safely.

Default mode is DRY RUN. No Firestore deletes are performed unless --execute and --confirm ${CONFIRM_TEXT} are both supplied.

Usage from functions folder:
  node ./scripts/delete_fake_mread_registry_rows.js --lm ZA2157
  node ./scripts/delete_fake_mread_registry_rows.js --lm ZA2157 --execute --confirm ${CONFIRM_TEXT}

Filters used before delete:
  doc.fake === true
  doc.fakeSeed.safeToDelete === true
  doc.fakeSeed.seedType starts with "${FAKE_SEED_PREFIX}"
  doc.geography.lmPcode === --lm value, unless --all-lms is supplied

Options:
  --lm <lmPcode>              LM guard. Defaults to ${DEFAULT_LM_PCODE}.
  --all-lms                   Remove the LM guard. Not recommended.
  --collection <name>         Defaults to ${DEFAULT_COLLECTION}.
  --batch-limit <number>      Defaults to ${DEFAULT_BATCH_LIMIT}.
  --report-dir <path>         Defaults to ./scripts/reports.
  --execute                   Actually delete matching rows.
  --confirm <text>            Must equal ${CONFIRM_TEXT} when --execute is used.
  --help                      Show this help.
`);
}

function initAdmin() {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  return admin.firestore();
}

function getString(value, fallback = "NAv") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function startsWithFakeMreadSeed(data) {
  const seedType = getString(data?.fakeSeed?.seedType, "");
  return seedType.startsWith(FAKE_SEED_PREFIX);
}

function isSafeFakeMreadRow(data, lmPcode, allLms) {
  const isFake = data?.fake === true;
  const safeToDelete = data?.fakeSeed?.safeToDelete === true;
  const seedTypeOk = startsWithFakeMreadSeed(data);
  const lmOk = allLms || getString(data?.geography?.lmPcode, "") === lmPcode;

  return isFake && safeToDelete && seedTypeOk && lmOk;
}

function summarizeDoc(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    lmPcode: getString(data?.geography?.lmPcode),
    cycleId: getString(data?.cycle?.cycleId),
    cycleLabel: getString(data?.cycle?.cycleLabel),
    readingAt: getString(data?.reading?.readingAt),
    meterNo: getString(data?.meter?.astNo),
    astId: getString(data?.meter?.astId),
    premiseId: getString(data?.premise?.premiseId),
    fakeSeedType: getString(data?.fakeSeed?.seedType),
    safeToDelete: data?.fakeSeed?.safeToDelete === true,
  };
}

async function commitDeletes(db, refs, batchLimit) {
  let deletedCount = 0;

  for (let start = 0; start < refs.length; start += batchLimit) {
    const chunk = refs.slice(start, start + batchLimit);
    const batch = db.batch();

    for (const ref of chunk) {
      batch.delete(ref);
    }

    await batch.commit();
    deletedCount += chunk.length;
    console.log(`Deleted ${deletedCount}/${refs.length} fake MREAD registry rows...`);
  }

  return deletedCount;
}

function writeReport(reportDir, report) {
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "").replace("T", "_").replace("Z", "Z");
  const filename = `delete_fake_mread_registry_rows_report_${stamp}.json`;
  const reportPath = path.join(reportDir, filename);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return reportPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (args.execute && args.confirm !== CONFIRM_TEXT) {
    throw new Error(
      `Execution blocked. To delete rows, pass: --execute --confirm ${CONFIRM_TEXT}`,
    );
  }

  if (!args.allLms && !args.lmPcode) {
    throw new Error("Execution blocked. Supply --lm <lmPcode> or explicitly pass --all-lms.");
  }

  const db = initAdmin();
  const startedAt = new Date().toISOString();

  console.log("============================================================");
  console.log("Delete Fake MREAD Registry Rows");
  console.log("============================================================");
  console.log(`Mode: ${args.execute ? "EXECUTE" : "DRY RUN"}`);
  console.log(`Collection: ${args.collection}`);
  console.log(`LM guard: ${args.allLms ? "ALL LMS" : args.lmPcode}`);
  console.log(`Required fakeSeed prefix: ${FAKE_SEED_PREFIX}`);
  console.log("Safety filters:");
  console.log("  - fake === true");
  console.log("  - fakeSeed.safeToDelete === true");
  console.log(`  - fakeSeed.seedType starts with ${FAKE_SEED_PREFIX}`);
  console.log("============================================================");

  // Query only on `fake` to avoid requiring composite indexes. All destructive filters
  // are applied again in code before a document reference is added to the delete list.
  const snap = await db.collection(args.collection).where("fake", "==", true).get();

  const scannedFakeRows = snap.size;
  const candidates = [];
  const skipped = [];

  snap.forEach((doc) => {
    const data = doc.data() || {};
    const summary = summarizeDoc(doc);

    if (isSafeFakeMreadRow(data, args.lmPcode, args.allLms)) {
      candidates.push({ ref: doc.ref, summary });
    } else {
      skipped.push({
        ...summary,
        reason: {
          fake: data?.fake === true,
          safeToDelete: data?.fakeSeed?.safeToDelete === true,
          seedTypeStartsWithFakeMread: startsWithFakeMreadSeed(data),
          lmMatches: args.allLms || getString(data?.geography?.lmPcode, "") === args.lmPcode,
        },
      });
    }
  });

  console.log(`Scanned fake rows: ${scannedFakeRows}`);
  console.log(`Matched safe fake MREAD rows: ${candidates.length}`);
  console.log(`Skipped fake rows: ${skipped.length}`);

  const byCycle = candidates.reduce((acc, item) => {
    const cycleId = item.summary.cycleId;
    acc[cycleId] = (acc[cycleId] || 0) + 1;
    return acc;
  }, {});

  console.log("Matched rows by cycle:");
  console.log(JSON.stringify(byCycle, null, 2));

  let deletedCount = 0;
  if (args.execute && candidates.length > 0) {
    deletedCount = await commitDeletes(
      db,
      candidates.map((item) => item.ref),
      args.batchLimit,
    );
  }

  const completedAt = new Date().toISOString();
  const report = {
    scriptName: "delete_fake_mread_registry_rows.js",
    scriptVersion: "1.0.0",
    startedAt,
    completedAt,
    mode: args.execute ? "EXECUTE" : "DRY_RUN",
    collection: args.collection,
    lmGuard: args.allLms ? "ALL_LMS" : args.lmPcode,
    filters: {
      fake: true,
      fakeSeedSafeToDelete: true,
      fakeSeedTypePrefix: FAKE_SEED_PREFIX,
    },
    counts: {
      scannedFakeRows,
      matchedSafeFakeMreadRows: candidates.length,
      skippedFakeRows: skipped.length,
      deletedRows: deletedCount,
    },
    matchedRowsByCycle: byCycle,
    matchedRows: candidates.map((item) => item.summary),
    skippedRows: skipped,
  };

  const reportPath = writeReport(args.reportDir, report);
  console.log("============================================================");
  console.log(`Report written: ${reportPath}`);
  console.log(`Result: ${args.execute ? `DELETED ${deletedCount}` : "DRY RUN ONLY"}`);
  console.log("============================================================");
}

main().catch((error) => {
  console.error("ERROR:", error);
  process.exitCode = 1;
});
