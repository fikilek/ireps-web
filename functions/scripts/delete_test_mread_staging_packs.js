import fs from "fs";
import path from "path";
import admin from "firebase-admin";

const DEFAULT_STAGING_COLLECTION = "mread_staging";
const DEFAULT_CYCLES_COLLECTION = "mread_staging_cycles";
const DEFAULT_LM_PCODE = "ZA2157";
const DEFAULT_BATCH_LIMIT = 450;
const CONFIRM_TEXT = "DELETE_TEST_MREAD_STAGING_PACKS";

const ZERO_SUMMARY = {
  mediaEvidence: 0,
  noAccess: 0,
  rowsWithConsumption: 0,
  rowsWithCurrentReading: 0,
  successfulReads: 0,
  totalRows: 0,
  unsuccessful: 0,
};

function parseArgs(argv) {
  const args = {
    stagingCollection: DEFAULT_STAGING_COLLECTION,
    cyclesCollection: DEFAULT_CYCLES_COLLECTION,
    lmPcode: DEFAULT_LM_PCODE,
    stagingIds: [],
    execute: false,
    confirm: "",
    resetCycles: true,
    batchLimit: DEFAULT_BATCH_LIMIT,
    reportDir: path.join(process.cwd(), "scripts", "reports"),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--execute") {
      args.execute = true;
    } else if (arg === "--no-reset-cycles") {
      args.resetCycles = false;
    } else if (arg === "--staging-collection") {
      args.stagingCollection = argv[++i] || args.stagingCollection;
    } else if (arg === "--cycles-collection") {
      args.cyclesCollection = argv[++i] || args.cyclesCollection;
    } else if (arg === "--lm") {
      args.lmPcode = argv[++i] || args.lmPcode;
    } else if (arg === "--staging-id") {
      const id = argv[++i];
      if (id) args.stagingIds.push(id);
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
Delete generated MREAD staging packs safely.

Default mode is DRY RUN. No Firestore deletes or cycle resets are performed unless --execute and --confirm ${CONFIRM_TEXT} are both supplied.

Usage from functions folder:
  node ./scripts/delete_test_mread_staging_packs.js --lm ZA2157
  node ./scripts/delete_test_mread_staging_packs.js --lm ZA2157 --execute --confirm ${CONFIRM_TEXT}

Default target:
  ${DEFAULT_STAGING_COLLECTION} documents whose ID starts with <lm>_MREAD_STAGING_

Optional targeted mode:
  node ./scripts/delete_test_mread_staging_packs.js --staging-id ZA2157_MREAD_STAGING_20260619_084229

What it does in EXECUTE mode:
  1. Deletes rows under mread_staging/{stagingId}/rows first, if present.
  2. Deletes the mread_staging/{stagingId} parent document.
  3. Resets mread_staging_cycles documents that point to deleted staging IDs.

What it never does:
  - It never deletes mread_staging_cycles documents.
  - It never deletes registry_mread rows.
  - It never deletes trns, asts, or billing records.

Options:
  --lm <lmPcode>                   LM guard. Defaults to ${DEFAULT_LM_PCODE}.
  --staging-id <id>                Delete one explicit staging ID. Can be repeated.
  --staging-collection <name>      Defaults to ${DEFAULT_STAGING_COLLECTION}.
  --cycles-collection <name>       Defaults to ${DEFAULT_CYCLES_COLLECTION}.
  --no-reset-cycles                Delete staging packs only; do not reset cycle pointers.
  --batch-limit <number>           Defaults to ${DEFAULT_BATCH_LIMIT}.
  --report-dir <path>              Defaults to ./scripts/reports.
  --execute                        Actually delete/reset.
  --confirm <text>                 Must equal ${CONFIRM_TEXT} when --execute is used.
  --help                           Show this help.
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

function getTimestampText(value) {
  if (!value) return "NAv";
  if (typeof value === "string") return value;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (typeof value?._seconds === "number") return new Date(value._seconds * 1000).toISOString();
  return "NAv";
}

function stagingIdPrefix(lmPcode) {
  return `${lmPcode}_MREAD_STAGING_`;
}

function isLmStagingPackId(id, lmPcode) {
  return getString(id, "").startsWith(stagingIdPrefix(lmPcode));
}

function summarizeStagingDoc(doc, childRowCount = 0) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    stagingId: getString(data.stagingId),
    tableId: getString(data.tableId),
    lmPcode: getString(data.lmPcode),
    cycleId: getString(data.cycleId),
    tableStatus: getString(data.tableStatus),
    generationStatus: getString(data.generation?.status),
    generatedAt: getTimestampText(data.generation?.generatedAt),
    failedAt: getTimestampText(data.generation?.failedAt),
    sourceRowsRead: data.generation?.sourceRowsRead ?? null,
    totalRows: data.summary?.totalRows ?? null,
    childRows: childRowCount,
  };
}

async function getCandidateStagingDocs(db, args) {
  const collectionRef = db.collection(args.stagingCollection);

  if (args.stagingIds.length > 0) {
    const explicit = [];

    for (const stagingId of args.stagingIds) {
      const snap = await collectionRef.doc(stagingId).get();
      if (snap.exists) {
        explicit.push(snap);
      } else {
        explicit.push({
          id: stagingId,
          exists: false,
          ref: collectionRef.doc(stagingId),
          data: () => ({}),
        });
      }
    }

    return explicit.filter((doc) => doc.exists !== false);
  }

  // Firestore does not support startsWith directly. For small admin cleanup runs,
  // scan the staging collection and apply the destructive LM prefix guard in code.
  const snap = await collectionRef.get();
  return snap.docs.filter((doc) => isLmStagingPackId(doc.id, args.lmPcode));
}

async function countRowsSubcollection(stagingDoc) {
  const rowsSnap = await stagingDoc.ref.collection("rows").get();
  return rowsSnap.size;
}

async function getRowsSubcollectionRefs(stagingDoc) {
  const rowsSnap = await stagingDoc.ref.collection("rows").get();
  return rowsSnap.docs.map((rowDoc) => rowDoc.ref);
}

async function commitDeletes(db, refs, batchLimit, label) {
  let deletedCount = 0;

  for (let start = 0; start < refs.length; start += batchLimit) {
    const chunk = refs.slice(start, start + batchLimit);
    const batch = db.batch();

    for (const ref of chunk) {
      batch.delete(ref);
    }

    await batch.commit();
    deletedCount += chunk.length;
    console.log(`Deleted ${deletedCount}/${refs.length} ${label}...`);
  }

  return deletedCount;
}

async function findCyclesToReset(db, args, deletedStagingIds) {
  const cyclesSnap = await db
    .collection(args.cyclesCollection)
    .where("lmPcode", "==", args.lmPcode)
    .get();

  const deletedIdSet = new Set(deletedStagingIds);
  const affected = [];

  cyclesSnap.forEach((doc) => {
    const data = doc.data() || {};
    const activeStagingId = getString(data.activeStagingId, "");
    const lastGeneratedStagingId = getString(data.lastGenerated?.stagingId, "");

    if (deletedIdSet.has(activeStagingId) || deletedIdSet.has(lastGeneratedStagingId)) {
      affected.push({
        ref: doc.ref,
        summary: {
          id: doc.id,
          cycleId: getString(data.cycleId),
          cycleLabel: getString(data.cycleLabel),
          status: getString(data.status),
          activeStagingId,
          currentIteration: data.currentIteration ?? null,
          lastGeneratedStagingId,
          summaryTotalRows: data.summary?.totalRows ?? null,
        },
      });
    }
  });

  return affected;
}

async function commitCycleResets(db, affectedCycles, batchLimit) {
  let resetCount = 0;
  const now = admin.firestore.FieldValue.serverTimestamp();

  for (let start = 0; start < affectedCycles.length; start += batchLimit) {
    const chunk = affectedCycles.slice(start, start + batchLimit);
    const batch = db.batch();

    for (const item of chunk) {
      batch.update(item.ref, {
        activeStagingId: null,
        currentIteration: 0,
        lastGenerated: null,
        summary: ZERO_SUMMARY,
        "metadata.updatedAt": now,
        "metadata.updatedBy": "delete_test_mread_staging_packs.js",
      });
    }

    await batch.commit();
    resetCount += chunk.length;
    console.log(`Reset ${resetCount}/${affectedCycles.length} cycle pointer documents...`);
  }

  return resetCount;
}

function writeReport(reportDir, report) {
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "").replace("T", "_").replace("Z", "Z");
  const filename = `delete_test_mread_staging_packs_report_${stamp}.json`;
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
      `Execution blocked. To delete staging packs, pass: --execute --confirm ${CONFIRM_TEXT}`,
    );
  }

  if (!args.lmPcode) {
    throw new Error("Execution blocked. Supply --lm <lmPcode>.");
  }

  const db = initAdmin();
  const startedAt = new Date().toISOString();

  console.log("============================================================");
  console.log("Delete Test MREAD Staging Packs");
  console.log("============================================================");
  console.log(`Mode: ${args.execute ? "EXECUTE" : "DRY RUN"}`);
  console.log(`Staging collection: ${args.stagingCollection}`);
  console.log(`Cycles collection: ${args.cyclesCollection}`);
  console.log(`LM guard: ${args.lmPcode}`);
  console.log(`Default staging ID prefix: ${stagingIdPrefix(args.lmPcode)}`);
  console.log(`Reset cycle pointers: ${args.resetCycles ? "YES" : "NO"}`);
  console.log("Important: mread_staging_cycles documents are never deleted.");
  console.log("============================================================");

  const candidateDocs = await getCandidateStagingDocs(db, args);
  const candidates = [];

  for (const doc of candidateDocs) {
    const childRowCount = await countRowsSubcollection(doc);
    candidates.push({
      doc,
      summary: summarizeStagingDoc(doc, childRowCount),
    });
  }

  const candidateIds = candidates.map((item) => item.doc.id);
  const childRowRefsByStagingId = {};
  let totalChildRowRefs = 0;

  for (const item of candidates) {
    const rowRefs = await getRowsSubcollectionRefs(item.doc);
    childRowRefsByStagingId[item.doc.id] = rowRefs;
    totalChildRowRefs += rowRefs.length;
  }

  const affectedCycles = args.resetCycles
    ? await findCyclesToReset(db, args, candidateIds)
    : [];

  console.log(`Matched staging packs: ${candidates.length}`);
  console.log(`Matched child rows under staging packs: ${totalChildRowRefs}`);
  console.log(`Cycle pointer docs to reset: ${affectedCycles.length}`);
  console.log("Matched staging packs:");
  console.log(JSON.stringify(candidates.map((item) => item.summary), null, 2));
  console.log("Affected cycles:");
  console.log(JSON.stringify(affectedCycles.map((item) => item.summary), null, 2));

  let deletedChildRows = 0;
  let deletedParents = 0;
  let resetCycles = 0;

  if (args.execute) {
    const allRowRefs = Object.values(childRowRefsByStagingId).flat();
    if (allRowRefs.length > 0) {
      deletedChildRows = await commitDeletes(db, allRowRefs, args.batchLimit, "staging child rows");
    }

    if (candidates.length > 0) {
      deletedParents = await commitDeletes(
        db,
        candidates.map((item) => item.doc.ref),
        args.batchLimit,
        "staging parent docs",
      );
    }

    if (args.resetCycles && affectedCycles.length > 0) {
      resetCycles = await commitCycleResets(db, affectedCycles, args.batchLimit);
    }
  }

  const completedAt = new Date().toISOString();
  const report = {
    scriptName: "delete_test_mread_staging_packs.js",
    scriptVersion: "1.0.0",
    startedAt,
    completedAt,
    mode: args.execute ? "EXECUTE" : "DRY_RUN",
    stagingCollection: args.stagingCollection,
    cyclesCollection: args.cyclesCollection,
    lmPcode: args.lmPcode,
    target: args.stagingIds.length > 0
      ? { explicitStagingIds: args.stagingIds }
      : { idPrefix: stagingIdPrefix(args.lmPcode) },
    resetCyclePointers: args.resetCycles,
    safety: {
      mreadStagingCyclesDocumentsDeleted: 0,
      registryMreadRowsDeleted: 0,
      trnsDeleted: 0,
      astsDeleted: 0,
      billingRecordsDeleted: 0,
    },
    counts: {
      matchedStagingPacks: candidates.length,
      matchedChildRows: totalChildRowRefs,
      matchedCyclePointerDocsToReset: affectedCycles.length,
      deletedChildRows,
      deletedStagingParentDocs: deletedParents,
      resetCyclePointerDocs: resetCycles,
    },
    matchedStagingPacks: candidates.map((item) => item.summary),
    affectedCycles: affectedCycles.map((item) => item.summary),
  };

  const reportPath = writeReport(args.reportDir, report);
  console.log("============================================================");
  console.log(`Report written: ${reportPath}`);
  console.log(`Result: ${args.execute ? "EXECUTE COMPLETE" : "DRY RUN ONLY"}`);
  console.log("============================================================");
}

main().catch((error) => {
  console.error("ERROR:", error);
  process.exitCode = 1;
});
