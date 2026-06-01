import { initializeApp, cert, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { existsSync, readFileSync } from "node:fs";

const DEFAULT_SERVICE_ACCOUNT_PATH =
  "C:\\dev\\secrets\\ireps2-e72fd9dc94de.json";

function getCliArg(name) {
  const direct = process.argv.find((item) => item.startsWith(`${name}=`));
  if (direct) return direct.split("=").slice(1).join("=").trim();

  const index = process.argv.indexOf(name);
  if (index >= 0) return String(process.argv[index + 1] || "").trim();

  return "";
}

function getCredential() {
  const serviceAccountPath =
    getCliArg("--key") ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    DEFAULT_SERVICE_ACCOUNT_PATH;

  if (serviceAccountPath && existsSync(serviceAccountPath)) {
    console.log(`Using service account file: ${serviceAccountPath}`);

    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf8"));

    return cert(serviceAccount);
  }

  console.log(
    "Service account file not found. Falling back to applicationDefault().",
  );
  return applicationDefault();
}

initializeApp({
  credential: getCredential(),
});

const db = getFirestore();

const TRNS_COLLECTION = "trns";
const ASTS_COLLECTION = "asts";

const SYSTEM_USER = "DEV_RESET_PENDING_WORK";
const COMPLETED = "COMPLETED";

function getArg(name) {
  const direct = process.argv.find((item) => item.startsWith(`${name}=`));
  if (direct) return direct.split("=").slice(1).join("=").trim();

  const index = process.argv.indexOf(name);
  if (index >= 0) return String(process.argv[index + 1] || "").trim();

  return "";
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase();
}

function hasMeaningfulValue(value) {
  const text = normalizeUpper(value);
  return Boolean(
    text && !["NAV", "N/AV", "N/A", "NA", "NULL", "UNDEFINED"].includes(text),
  );
}

function pickFirst(...values) {
  for (const value of values) {
    if (hasMeaningfulValue(value)) return normalizeText(value);
  }

  return "";
}

function getLmPcode(data = {}) {
  return pickFirst(
    data?.accessData?.parents?.lmPcode,
    data?.parents?.lmPcode,
    data?.refs?.lmPcode,
    data?.origin?.lmPcode,
    data?.bgo?.lmPcode,
    data?.bucket?.lmPcode,
    data?.lmPcode,
  );
}

function getWardPcode(data = {}) {
  return pickFirst(
    data?.accessData?.parents?.wardPcode,
    data?.parents?.wardPcode,
    data?.refs?.wardPcode,
    data?.origin?.wardPcode,
    data?.bgo?.wardPcode,
    data?.bucket?.wardPcode,
    data?.wardPcode,
  );
}

function getTrnType(data = {}) {
  return pickFirst(
    data?.trnType,
    data?.origin?.trnType,
    data?.assignment?.instruction?.code,
    data?.bgo?.trnType,
    data?.bucket?.trnType,
    data?.accessData?.trnType,
  );
}

function getAstNo(data = {}) {
  return pickFirst(
    data?.ast?.astData?.astNo,
    data?.astData?.astNo,
    data?.master?.id,
    data?.ast?.astNo,
  );
}

function matchesScope(data = {}, { all, lmPcode, wardPcode, trnType }) {
  if (!all) {
    const docLmPcode = normalizeUpper(getLmPcode(data));
    if (normalizeUpper(lmPcode) && docLmPcode !== normalizeUpper(lmPcode)) {
      return false;
    }
  }

  if (hasMeaningfulValue(wardPcode)) {
    const docWardPcode = normalizeUpper(getWardPcode(data));
    if (docWardPcode !== normalizeUpper(wardPcode)) {
      return false;
    }
  }

  if (hasMeaningfulValue(trnType)) {
    const docTrnType = normalizeUpper(getTrnType(data));
    if (docTrnType !== normalizeUpper(trnType)) {
      return false;
    }
  }

  return true;
}

function groupBy(items = [], keyGetter) {
  const result = {};

  items.forEach((item) => {
    const key = keyGetter(item) || "NAv";
    result[key] = (result[key] || 0) + 1;
  });

  return result;
}

async function findPendingTrns(scope) {
  const snapshot = await db
    .collection(TRNS_COLLECTION)
    .where("workflow.state", "!=", COMPLETED)
    .get();

  return snapshot.docs
    .map((doc) => ({
      id: doc.id,
      ref: doc.ref,
      data: doc.data() || {},
    }))
    .filter((item) => {
      const state = normalizeUpper(item?.data?.workflow?.state);

      // Important rule:
      // Do NOT delete TRNs where workflow.state is missing.
      if (!state) return false;
      if (state === COMPLETED) return false;

      return matchesScope(item.data, scope);
    });
}

async function findAstsWithPendingLifecycle(scope) {
  const snapshot = await db
    .collection(ASTS_COLLECTION)
    .where("trnActiveLifecycle.workflowState", "!=", COMPLETED)
    .get();

  return snapshot.docs
    .map((doc) => ({
      id: doc.id,
      ref: doc.ref,
      data: doc.data() || {},
    }))
    .filter((item) => {
      const state = normalizeUpper(
        item?.data?.trnActiveLifecycle?.workflowState,
      );

      // Important rule:
      // Do NOT clear lifecycle where workflowState is missing.
      if (!state) return false;
      if (state === COMPLETED) return false;

      return matchesScope(item.data, scope);
    });
}

async function commitOpsInBatches(ops = [], chunkSize = 400) {
  let committed = 0;

  for (let index = 0; index < ops.length; index += chunkSize) {
    const chunk = ops.slice(index, index + chunkSize);
    const batch = db.batch();

    chunk.forEach((op) => {
      if (op.type === "delete") {
        batch.delete(op.ref);
      }

      if (op.type === "update") {
        batch.update(op.ref, op.data);
      }
    });

    await batch.commit();
    committed += chunk.length;

    console.log(`Committed ${committed}/${ops.length} write operations...`);
  }

  return committed;
}

async function buildTrnDeleteOps(pendingTrns = []) {
  const ops = [];

  for (const item of pendingTrns) {
    const historySnapshot = await item.ref.collection("history").get();

    historySnapshot.docs.forEach((historyDoc) => {
      ops.push({
        type: "delete",
        ref: historyDoc.ref,
      });
    });

    ops.push({
      type: "delete",
      ref: item.ref,
    });
  }

  return ops;
}

function buildAstClearOps(asts = []) {
  const now = new Date().toISOString();

  return asts.map((item) => ({
    type: "update",
    ref: item.ref,
    data: {
      trnActiveLifecycle: FieldValue.delete(),
      "metadata.updatedAt": now,
      "metadata.updatedByUid": SYSTEM_USER,
      "metadata.updatedByUser": SYSTEM_USER,
    },
  }));
}

function printSamples({ pendingTrns, pendingAsts }) {
  console.log("\nPending TRNs by workflow.state:");
  console.table(groupBy(pendingTrns, (item) => item?.data?.workflow?.state));

  console.log("\nPending TRNs by trnType:");
  console.table(groupBy(pendingTrns, (item) => getTrnType(item.data)));

  console.log("\nSample pending TRNs:");
  console.table(
    pendingTrns.slice(0, 25).map((item) => ({
      id: item.id,
      state: item?.data?.workflow?.state || "NAv",
      trnType: getTrnType(item.data) || "NAv",
      lmPcode: getLmPcode(item.data) || "NAv",
      wardPcode: getWardPcode(item.data) || "NAv",
    })),
  );

  console.log("\nAST pending lifecycle by workflowState:");
  console.table(
    groupBy(
      pendingAsts,
      (item) => item?.data?.trnActiveLifecycle?.workflowState,
    ),
  );

  console.log("\nAST pending lifecycle by trnType:");
  console.table(
    groupBy(pendingAsts, (item) => item?.data?.trnActiveLifecycle?.trnType),
  );

  console.log("\nSample ASTs to clear:");
  console.table(
    pendingAsts.slice(0, 25).map((item) => ({
      astId: item.id,
      astNo: getAstNo(item.data) || "NAv",
      lifecycleTrnId: item?.data?.trnActiveLifecycle?.trnId || "NAv",
      lifecycleTrnType: item?.data?.trnActiveLifecycle?.trnType || "NAv",
      workflowState: item?.data?.trnActiveLifecycle?.workflowState || "NAv",
      lmPcode: getLmPcode(item.data) || "NAv",
      wardPcode: getWardPcode(item.data) || "NAv",
    })),
  );
}

async function main() {
  const apply = hasFlag("--apply");
  const all = hasFlag("--all");
  const lmPcode = getArg("--lm");
  const wardPcode = getArg("--ward");
  const trnType = getArg("--trnType");

  if (!all && !hasMeaningfulValue(lmPcode)) {
    console.error(
      "\nFor safety, provide either --lm=ZA7423 or --all.\n\nExample dry run:\nnode scripts/devResetPendingWork.js --lm=ZA7423\n\nExample apply:\nnode scripts/devResetPendingWork.js --lm=ZA7423 --apply\n",
    );
    process.exit(1);
  }

  const scope = {
    all,
    lmPcode,
    wardPcode,
    trnType,
  };

  console.log("\nDEV RESET PENDING WORK");
  console.log("----------------------");
  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Scope: ${all ? "ALL" : `LM ${lmPcode}`}`);
  console.log(`Ward filter: ${wardPcode || "none"}`);
  console.log(`TRN type filter: ${trnType || "none"}`);

  const pendingTrns = await findPendingTrns(scope);
  const pendingAsts = await findAstsWithPendingLifecycle(scope);

  console.log("\nCounts:");
  console.table({
    pendingTrnsToDelete: pendingTrns.length,
    astLifecycleSummariesToClear: pendingAsts.length,
  });

  printSamples({ pendingTrns, pendingAsts });

  if (!apply) {
    console.log("\nDRY RUN ONLY. No data was changed.");
    console.log("\nTo apply:");
    console.log(
      all
        ? "node scripts/devResetPendingWork.js --all --apply"
        : `node scripts/devResetPendingWork.js --lm=${lmPcode}${wardPcode ? ` --ward=${wardPcode}` : ""}${trnType ? ` --trnType=${trnType}` : ""} --apply`,
    );
    return;
  }

  console.log("\nApplying DEV reset...");

  const trnDeleteOps = await buildTrnDeleteOps(pendingTrns);
  const astClearOps = buildAstClearOps(pendingAsts);

  const deletedTrnWriteOps = await commitOpsInBatches(trnDeleteOps);
  const clearedAstWriteOps = await commitOpsInBatches(astClearOps);

  console.log("\nDEV reset complete.");
  console.table({
    trnDocsMatched: pendingTrns.length,
    trnAndHistoryDeleteWrites: deletedTrnWriteOps,
    astLifecycleSummariesCleared: pendingAsts.length,
    astClearWrites: clearedAstWriteOps,
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nDEV reset failed:");
    console.error(error);
    process.exit(1);
  });
