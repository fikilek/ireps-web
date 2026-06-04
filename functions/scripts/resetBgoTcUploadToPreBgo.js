/* eslint-disable no-console */

/**
 * BGO Dev Reset v1 — Reset one TC upload/BGO family to pre-BGO state.
 *
 * DEV ONLY. Not a production callable.
 *
 * What it keeps:
 * - tc_uploads/{tcId}
 * - tc_rows linked to tcId
 *
 * What it resets/deletes:
 * - deletes bgo_batches linked to tcId
 * - deletes BGO child TRNs linked to tcId/batch ids
 * - deletes history subcollections under deleted bgo_batches/TRNs
 * - deletes BGO notifications linked to deleted batch ids
 * - deletes tc_upload_dedupe docs where tcId == selected tcId
 * - resets TC rows used by those BGO batches back to READY_FOR_BGO
 * - clears AST.trnActiveLifecycle if it points to a deleted BGO TRN
 * - restores AST.status only when a clear pre-BGO status snapshot exists in the child TRN
 *
 * Usage from C:\dev\ireps-web\functions:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\dev\secrets\ireps2-e72fd9dc94de.json"
 *   node .\scripts\resetBgoTcUploadToPreBgo.js --tcId TC_20260601_095534_ZA7423_MDCN --dryRun
 *   node .\scripts\resetBgoTcUploadToPreBgo.js --tcId TC_20260601_095534_ZA7423_MDCN --apply
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COLLECTIONS = {
  tcUploads: "tc_uploads",
  tcRows: "tc_rows",
  tcUploadDedupe: "tc_upload_dedupe",
  bgoBatches: "bgo_batches",
  bgoRows: "bgo_rows",
  trns: "trns",
  asts: "asts",
  notifications: "notifications",
};

const SYSTEM_UID = "BGO_DEV_RESET";
const SYSTEM_USER = "BGO Dev Reset Script";
const READY_STATE = "READY_FOR_BGO";
const READY_REASON = "BGO_DEV_RESET_READY_AGAIN";
const CHUNK_SIZE = 400;

function parseArgs(argv = []) {
  const args = {
    tcId: "",
    apply: false,
    dryRun: true,
    serviceAccount: "",
    backupDir: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--tcId") {
      args.tcId = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--tcId=")) {
      args.tcId = String(arg.split("=").slice(1).join("=") || "").trim();
      continue;
    }

    if (arg === "--apply") {
      args.apply = true;
      args.dryRun = false;
      continue;
    }

    if (arg === "--dryRun" || arg === "--dry-run") {
      args.apply = false;
      args.dryRun = true;
      continue;
    }

    if (arg === "--serviceAccount") {
      args.serviceAccount = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--serviceAccount=")) {
      args.serviceAccount = String(arg.split("=").slice(1).join("=") || "").trim();
      continue;
    }

    if (arg === "--backupDir") {
      args.backupDir = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--backupDir=")) {
      args.backupDir = String(arg.split("=").slice(1).join("=") || "").trim();
      continue;
    }
  }

  return args;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase();
}

function hasMeaningfulValue(value) {
  const text = normalizeUpper(value);

  return (
    text !== "" &&
    text !== "NAV" &&
    text !== "N/AV" &&
    text !== "N/A" &&
    text !== "NA" &&
    text !== "NULL" &&
    text !== "UNDEFINED"
  );
}

function serializeData(value) {
  return JSON.parse(
    JSON.stringify(value, (key, item) => {
      if (item === undefined) return null;
      if (item && typeof item.toDate === "function") return item.toDate().toISOString();
      return item;
    }),
  );
}

function docPath(refOrSnap) {
  return refOrSnap?.ref?.path || refOrSnap?.path || "";
}

function addDocSnap(map, snap) {
  if (snap?.exists) map.set(snap.ref.path, snap);
}

function addDocSnaps(map, snaps = []) {
  snaps.forEach((snap) => addDocSnap(map, snap));
}

function chunkArray(items = [], size = CHUNK_SIZE) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function initFirebase({ serviceAccount }) {
  const explicitPath = serviceAccount || process.env.GOOGLE_APPLICATION_CREDENTIALS || "";

  if (explicitPath && fs.existsSync(explicitPath)) {
    const raw = fs.readFileSync(explicitPath, "utf8");
    const json = JSON.parse(raw);
    initializeApp({ credential: cert(json) });
    console.log(`✅ Firebase initialized using service account: ${explicitPath}`);
    return;
  }

  initializeApp({ credential: applicationDefault() });
  console.log("✅ Firebase initialized using applicationDefault()");
}

async function queryEq({ db, collectionName, field, value }) {
  if (!hasMeaningfulValue(value)) return [];

  try {
    const snap = await db.collection(collectionName).where(field, "==", value).get();
    return snap.docs;
  } catch (error) {
    console.warn("⚠️ Query skipped", {
      collectionName,
      field,
      value,
      message: error?.message || String(error),
    });
    return [];
  }
}

async function queryInChunks({ db, collectionName, field, values = [] }) {
  const cleanValues = [...new Set(values.map(normalizeText).filter(Boolean))];
  const docs = [];

  for (const chunk of chunkArray(cleanValues, 30)) {
    try {
      const snap = await db.collection(collectionName).where(field, "in", chunk).get();
      docs.push(...snap.docs);
    } catch (error) {
      console.warn("⚠️ IN query skipped", {
        collectionName,
        field,
        count: chunk.length,
        message: error?.message || String(error),
      });
    }
  }

  return docs;
}

async function getAllExisting({ db, refs = [] }) {
  const cleanRefs = refs.filter(Boolean);
  const map = new Map();

  for (const chunk of chunkArray(cleanRefs, 300)) {
    const snaps = await db.getAll(...chunk);
    snaps.forEach((snap) => addDocSnap(map, snap));
  }

  return [...map.values()];
}

async function collectTcRows({ db, tcId }) {
  const rowMap = new Map();

  const queries = [
    ["tcId", tcId],
    ["upload.tcId", tcId],
    ["upload.id", tcId],
    ["tcUploadId", tcId],
  ];

  for (const [field, value] of queries) {
    addDocSnaps(
      rowMap,
      await queryEq({ db, collectionName: COLLECTIONS.tcRows, field, value }),
    );
  }

  return [...rowMap.values()];
}

async function collectBgoBatches({ db, tcId }) {
  const batchMap = new Map();

  const queries = [
    ["tcId", tcId],
    ["origin.tcId", tcId],
    ["bgo.tcId", tcId],
    ["refs.tcUploadId", tcId],
    ["sourceUpload.id", tcId],
  ];

  for (const [field, value] of queries) {
    addDocSnaps(
      batchMap,
      await queryEq({ db, collectionName: COLLECTIONS.bgoBatches, field, value }),
    );
  }

  return [...batchMap.values()];
}

function getBgoBatchTrnIds(batchData = {}) {
  return [
    ...(Array.isArray(batchData?.trnIds) ? batchData.trnIds : []),
    ...(Array.isArray(batchData?.refs?.trnIds) ? batchData.refs.trnIds : []),
    ...(Array.isArray(batchData?.bgo?.trnIds) ? batchData.bgo.trnIds : []),
    ...(Array.isArray(batchData?.childTrnIds) ? batchData.childTrnIds : []),
  ]
    .map(normalizeText)
    .filter(Boolean);
}

async function collectChildTrns({ db, tcId, batchSnaps = [] }) {
  const trnMap = new Map();
  const batchIds = batchSnaps.map((snap) => snap.id).filter(Boolean);
  const trnIdsFromBatches = [
    ...new Set(batchSnaps.flatMap((snap) => getBgoBatchTrnIds(snap.data() || {}))),
  ];

  if (trnIdsFromBatches.length > 0) {
    const refs = trnIdsFromBatches.map((trnId) => db.collection(COLLECTIONS.trns).doc(trnId));
    addDocSnaps(trnMap, await getAllExisting({ db, refs }));
  }

  const queries = [
    ["bgo.tcId", tcId],
    ["origin.tcId", tcId],
    ["refs.tcUploadId", tcId],
  ];

  for (const [field, value] of queries) {
    addDocSnaps(
      trnMap,
      await queryEq({ db, collectionName: COLLECTIONS.trns, field, value }),
    );
  }

  if (batchIds.length > 0) {
    addDocSnaps(
      trnMap,
      await queryInChunks({
        db,
        collectionName: COLLECTIONS.trns,
        field: "bgo.batchId",
        values: batchIds,
      }),
    );

    addDocSnaps(
      trnMap,
      await queryInChunks({
        db,
        collectionName: COLLECTIONS.trns,
        field: "bucket.batchId",
        values: batchIds,
      }),
    );

    addDocSnaps(
      trnMap,
      await queryInChunks({
        db,
        collectionName: COLLECTIONS.trns,
        field: "refs.bgoBatchId",
        values: batchIds,
      }),
    );
  }

  // Keep this strict: only BGO child TRNs for this TC/batch family.
  return [...trnMap.values()].filter((snap) => {
    const data = snap.data() || {};
    const isBgo =
      normalizeUpper(data?.bgo?.kind) === "BGO_TRN" ||
      normalizeUpper(data?.origin?.source) === "BGO" ||
      normalizeUpper(data?.origin?.sourceModule) === "BULK_GEOFENCE_ORIGIN" ||
      normalizeUpper(data?.bucket?.type) === "BULK_GEOFENCE";

    const linkedTcId =
      normalizeText(data?.bgo?.tcId) ||
      normalizeText(data?.bgo?.tcUploadId) ||
      normalizeText(data?.origin?.tcId) ||
      normalizeText(data?.refs?.tcUploadId);

    const linkedBatchId =
      normalizeText(data?.bgo?.batchId) ||
      normalizeText(data?.bgo?.bgoBatchId) ||
      normalizeText(data?.bucket?.batchId) ||
      normalizeText(data?.refs?.bgoBatchId);

    return isBgo && (linkedTcId === tcId || batchIds.includes(linkedBatchId));
  });
}

async function collectBgoRows({ db, tcId, batchIds = [] }) {
  const rowMap = new Map();

  const queries = [
    ["tcId", tcId],
    ["upload.tcId", tcId],
    ["bgo.tcId", tcId],
    ["refs.tcUploadId", tcId],
  ];

  for (const [field, value] of queries) {
    addDocSnaps(
      rowMap,
      await queryEq({ db, collectionName: COLLECTIONS.bgoRows, field, value }),
    );
  }

  if (batchIds.length > 0) {
    addDocSnaps(
      rowMap,
      await queryInChunks({
        db,
        collectionName: COLLECTIONS.bgoRows,
        field: "bgo.batchId",
        values: batchIds,
      }),
    );

    addDocSnaps(
      rowMap,
      await queryInChunks({
        db,
        collectionName: COLLECTIONS.bgoRows,
        field: "batchId",
        values: batchIds,
      }),
    );
  }

  return [...rowMap.values()];
}

async function collectNotifications({ db, batchIds = [] }) {
  if (batchIds.length === 0) return [];

  const notificationMap = new Map();
  addDocSnaps(
    notificationMap,
    await queryInChunks({
      db,
      collectionName: COLLECTIONS.notifications,
      field: "bgo.batchId",
      values: batchIds,
    }),
  );

  return [...notificationMap.values()];
}

async function collectTcUploadDedupe({ db, tcId }) {
  const dedupeMap = new Map();

  const queries = [
    ["tcId", tcId],
    ["upload.tcId", tcId],
    ["upload.id", tcId],
    ["refs.tcUploadId", tcId],
  ];

  for (const [field, value] of queries) {
    addDocSnaps(
      dedupeMap,
      await queryEq({ db, collectionName: COLLECTIONS.tcUploadDedupe, field, value }),
    );
  }

  return [...dedupeMap.values()];
}

async function collectHistoryDocs(snaps = []) {
  const historyMap = new Map();

  for (const snap of snaps) {
    const historySnap = await snap.ref.collection("history").get();
    historySnap.docs.forEach((historyDoc) => addDocSnap(historyMap, historyDoc));
  }

  return [...historyMap.values()];
}

function getAstIdFromTrn(trnData = {}) {
  return normalizeText(
    trnData?.refs?.astId ||
      trnData?.astId ||
      trnData?.ast?.astData?.astId ||
      trnData?.astData?.astId ||
      trnData?.ast?.id ||
      "",
  );
}

function getTcRowIdFromTrn(trnData = {}) {
  return normalizeText(
    trnData?.refs?.tcRowId ||
      trnData?.bgo?.tcRowId ||
      trnData?.origin?.tcRowId ||
      trnData?.tcRowId ||
      "",
  );
}

function getBatchIdFromTrn(trnData = {}) {
  return normalizeText(
    trnData?.bgo?.batchId ||
      trnData?.bgo?.bgoBatchId ||
      trnData?.bucket?.batchId ||
      trnData?.refs?.bgoBatchId ||
      trnData?.refs?.batchId ||
      "",
  );
}

function normalizeStatusCandidate(candidate) {
  if (!candidate) return null;

  if (typeof candidate === "string") {
    const state = normalizeUpper(candidate);
    if (!hasMeaningfulValue(state)) return null;
    return { kind: "state", state };
  }

  if (typeof candidate === "object") {
    const state = normalizeUpper(
      candidate?.state || candidate?.statusState || candidate?.id || candidate?.code || "",
    );

    if (!hasMeaningfulValue(state)) return null;

    return {
      kind: "object",
      status: serializeData({
        ...candidate,
        state: candidate?.state || state,
      }),
      state,
    };
  }

  return null;
}

function getClearPreBgoStatusFromTrn(trnData = {}) {
  const candidates = [
    trnData?.bgo?.preBgoStatus,
    trnData?.bgo?.preStatus,
    trnData?.preBgoStatus,
    trnData?.preStatus,
    trnData?.meterPreStatus,
    trnData?.ast?.status,
    trnData?.astStatus,
    trnData?.status,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeStatusCandidate(candidate);
    if (normalized) return normalized;
  }

  return null;
}

function getExecutionStateCounts(childTrnSnaps = []) {
  const counts = {
    waiting: 0,
    accepted: 0,
    inProgress: 0,
    completed: 0,
    rejected: 0,
    cancelled: 0,
    other: 0,
  };

  for (const snap of childTrnSnaps) {
    const state = normalizeUpper(snap.data()?.workflow?.state || snap.data()?.workflowState);

    if (state === "WAITING_BATCH_ACCEPTANCE") counts.waiting += 1;
    else if (state === "ACCEPTED") counts.accepted += 1;
    else if (state === "IN_PROGRESS") counts.inProgress += 1;
    else if (state === "COMPLETED") counts.completed += 1;
    else if (state === "REJECTED") counts.rejected += 1;
    else if (state === "CANCELLED") counts.cancelled += 1;
    else counts.other += 1;
  }

  return counts;
}

function isRowUsedByDeletedBgo({ rowSnap, batchIds, trnIds, tcRowIdsFromTrns }) {
  const row = rowSnap.data() || {};
  const bgo = row?.bgo || {};
  const rowBatchIds = [bgo?.batchId, bgo?.bgoBatchId].map(normalizeText).filter(Boolean);
  const rowTrnIds = [bgo?.trnId, bgo?.bgoRowId].map(normalizeText).filter(Boolean);

  if (tcRowIdsFromTrns.has(rowSnap.id)) return true;
  if (rowBatchIds.some((id) => batchIds.has(id))) return true;
  if (rowTrnIds.some((id) => trnIds.has(id))) return true;

  return false;
}

function buildTcRowResetPatch({ now, batchIds, trnIds }) {
  return {
    "bgo.ready": true,
    "bgo.readinessState": READY_STATE,
    "bgo.readinessReason": READY_REASON,
    "bgo.used": false,
    "bgo.usedAt": null,
    "bgo.usedByUid": null,
    "bgo.usedByUser": null,
    "bgo.batchId": null,
    "bgo.bgoBatchId": null,
    "bgo.bgoRowId": null,
    "bgo.trnId": null,
    "bgo.selectedGeofenceRef": null,
    "bgo.target": null,
    "bgo.devReset": {
      resetAt: now,
      resetByUid: SYSTEM_UID,
      resetByUser: SYSTEM_USER,
      deletedBatchCount: batchIds.size,
      deletedTrnCount: trnIds.size,
    },
    "metadata.updatedAt": now,
    "metadata.updatedByUid": SYSTEM_UID,
    "metadata.updatedByUser": SYSTEM_USER,
  };
}

function buildTcUploadPatch({ tcRowSnaps, rowsToReset, now }) {
  const rowDataAfterReset = tcRowSnaps.map((snap) => {
    if (!rowsToReset.has(snap.id)) return snap.data() || {};

    return {
      ...(snap.data() || {}),
      bgo: {
        ...((snap.data() || {})?.bgo || {}),
        ready: true,
        readinessState: READY_STATE,
        readinessReason: READY_REASON,
        used: false,
        batchId: null,
        bgoBatchId: null,
        bgoRowId: null,
        trnId: null,
      },
    };
  });

  const readyRows = rowDataAfterReset.filter((row) => {
    const bgo = row?.bgo || {};
    return (
      bgo.ready === true &&
      bgo.readinessState === READY_STATE &&
      bgo.used !== true &&
      !hasMeaningfulValue(bgo.batchId) &&
      !hasMeaningfulValue(bgo.bgoBatchId)
    );
  }).length;

  const usedRows = rowDataAfterReset.filter((row) => row?.bgo?.used === true).length;
  const remainingRows = readyRows;

  return {
    bgoStatus: readyRows > 0 ? READY_STATE : "NOT_READY_FOR_BGO",
    readyRows,
    remainingRows,
    usedRows,
    "summary.readyForBgo": readyRows,
    "summary.readyRows": readyRows,
    "summary.remainingRows": remainingRows,
    "summary.usedRows": usedRows,
    "bgo.lastBatchCreatedAt": FieldValue.delete(),
    "bgo.lastBatchCreatedByUid": FieldValue.delete(),
    "bgo.lastBatchCreatedByUser": FieldValue.delete(),
    "bgo.lastCreatedBatchIds": FieldValue.delete(),
    "bgo.lastCreatedTrnIds": FieldValue.delete(),
    "bgo.devReset": {
      resetAt: now,
      resetByUid: SYSTEM_UID,
      resetByUser: SYSTEM_USER,
      rowsReset: rowsToReset.size,
    },
    "metadata.updatedAt": now,
    "metadata.updatedByUid": SYSTEM_UID,
    "metadata.updatedByUser": SYSTEM_USER,
  };
}

function buildAstPatches({ astSnaps, childTrnSnaps, deletedTrnIds, now }) {
  const trnsByAstId = new Map();

  for (const trnSnap of childTrnSnaps) {
    const trnData = trnSnap.data() || {};
    const astId = getAstIdFromTrn(trnData);
    if (!astId) continue;

    const list = trnsByAstId.get(astId) || [];
    list.push(trnSnap);
    trnsByAstId.set(astId, list);
  }

  const astUpdates = [];
  const warnings = [];

  for (const astSnap of astSnaps) {
    const ast = astSnap.data() || {};
    const activeTrnId = normalizeText(ast?.trnActiveLifecycle?.trnId);
    const relatedTrns = trnsByAstId.get(astSnap.id) || [];
    const patch = {
      "metadata.updatedAt": now,
      "metadata.updatedByUid": SYSTEM_UID,
      "metadata.updatedByUser": SYSTEM_USER,
    };
    let hasChange = false;

    if (activeTrnId && deletedTrnIds.has(activeTrnId)) {
      patch.trnActiveLifecycle = FieldValue.delete();
      hasChange = true;
    }

    const completedOrStarted = relatedTrns.filter((trnSnap) => {
      const trn = trnSnap.data() || {};
      const state = normalizeUpper(trn?.workflow?.state || trn?.workflowState);
      return (
        state === "COMPLETED" ||
        state === "IN_PROGRESS" ||
        Boolean(trn?.workflow?.executionStartedAt) ||
        Boolean(trn?.executionOutcome)
      );
    });

    if (completedOrStarted.length > 0) {
      const statusSnapshot = completedOrStarted
        .map((trnSnap) => getClearPreBgoStatusFromTrn(trnSnap.data() || {}))
        .find(Boolean);

      if (statusSnapshot?.kind === "object") {
        patch.status = statusSnapshot.status;
        hasChange = true;
      } else if (statusSnapshot?.kind === "state") {
        patch["status.state"] = statusSnapshot.state;
        hasChange = true;
      } else {
        warnings.push({
          astId: astSnap.id,
          reason: "NO_CLEAR_PRE_BGO_STATUS_SNAPSHOT",
          deletedActiveLifecycleTrnId: activeTrnId || null,
          relatedTrnIds: relatedTrns.map((snap) => snap.id),
        });
      }
    }

    if (hasChange) {
      astUpdates.push({ ref: astSnap.ref, patch });
    }
  }

  return { astUpdates, warnings };
}

async function commitInChunks({ db, deletes = [], updates = [] }) {
  const operations = [
    ...updates.map((item) => ({ type: "update", ...item })),
    ...deletes.map((ref) => ({ type: "delete", ref })),
  ];

  let committed = 0;

  for (const chunk of chunkArray(operations, CHUNK_SIZE)) {
    const batch = db.batch();

    for (const op of chunk) {
      if (op.type === "update") batch.update(op.ref, op.patch);
      if (op.type === "delete") batch.delete(op.ref);
      committed += 1;
    }

    await batch.commit();
  }

  return committed;
}

function backupDocFromSnap(snap) {
  return {
    path: snap.ref.path,
    id: snap.id,
    data: serializeData(snap.data() || {}),
  };
}

function writeBackup({ backupDir, tcId, payload }) {
  const safeTcId = tcId.replace(/[^A-Za-z0-9_-]+/g, "_");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const finalBackupDir = backupDir || path.resolve(__dirname, "../_bgo_reset_backups");

  fs.mkdirSync(finalBackupDir, { recursive: true });

  const backupPath = path.join(finalBackupDir, `${safeTcId}_${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(payload, null, 2), "utf8");

  return backupPath;
}

function printPlan(plan) {
  console.log("\n================ BGO DEV RESET PLAN ================");
  console.log(`TC upload:          ${plan.tcId}`);
  console.log(`Mode:               ${plan.apply ? "APPLY" : "DRY RUN"}`);
  console.log(`BGO batches:        ${plan.batchCount}`);
  console.log(`BGO rows docs:      ${plan.bgoRowDocCount}`);
  console.log(`Child BGO TRNs:     ${plan.childTrnCount}`);
  console.log("Child TRN states:  ", plan.childTrnStateCounts);
  console.log(`TC rows total:      ${plan.tcRowCount}`);
  console.log(`TC rows to reset:   ${plan.tcRowsToReset}`);
  console.log(`Affected ASTs:      ${plan.affectedAstCount}`);
  console.log(`AST updates:        ${plan.astUpdateCount}`);
  console.log(`Notifications:      ${plan.notificationCount}`);
  console.log(`Dedupe docs:        ${plan.dedupeCount}`);
  console.log(`History docs:       ${plan.historyDocCount}`);
  console.log(`Deletes planned:    ${plan.deleteCount}`);
  console.log(`Updates planned:    ${plan.updateCount}`);
  console.log(`Warnings:           ${plan.warningCount}`);
  console.log(`Backup:             ${plan.backupPath}`);
  console.log("====================================================\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.tcId) {
    console.error("❌ Missing required --tcId");
    console.error("Example: node .\\scripts\\resetBgoTcUploadToPreBgo.js --tcId TC_20260601_095534_ZA7423_MDCN --dryRun");
    process.exit(1);
  }

  initFirebase({ serviceAccount: args.serviceAccount });
  const db = getFirestore();
  const now = new Date().toISOString();

  const tcUploadRef = db.collection(COLLECTIONS.tcUploads).doc(args.tcId);
  const tcUploadSnap = await tcUploadRef.get();

  if (!tcUploadSnap.exists) {
    console.error(`❌ TC upload not found: ${args.tcId}`);
    process.exit(1);
  }

  const tcRowSnaps = await collectTcRows({ db, tcId: args.tcId });
  const batchSnaps = await collectBgoBatches({ db, tcId: args.tcId });
  const batchIds = new Set(batchSnaps.map((snap) => snap.id));
  const childTrnSnaps = await collectChildTrns({ db, tcId: args.tcId, batchSnaps });
  const childTrnIds = new Set(childTrnSnaps.map((snap) => snap.id));
  const bgoRowSnaps = await collectBgoRows({ db, tcId: args.tcId, batchIds: [...batchIds] });
  const notificationSnaps = await collectNotifications({ db, batchIds: [...batchIds] });
  const dedupeSnaps = await collectTcUploadDedupe({ db, tcId: args.tcId });
  const batchHistorySnaps = await collectHistoryDocs(batchSnaps);
  const childTrnHistorySnaps = await collectHistoryDocs(childTrnSnaps);

  const tcRowIdsFromTrns = new Set(
    childTrnSnaps.map((snap) => getTcRowIdFromTrn(snap.data() || {})).filter(Boolean),
  );

  const rowsToReset = new Set(
    tcRowSnaps
      .filter((rowSnap) =>
        isRowUsedByDeletedBgo({
          rowSnap,
          batchIds,
          trnIds: childTrnIds,
          tcRowIdsFromTrns,
        }),
      )
      .map((snap) => snap.id),
  );

  const affectedAstIds = [
    ...new Set(childTrnSnaps.map((snap) => getAstIdFromTrn(snap.data() || {})).filter(Boolean)),
  ];

  const astRefs = affectedAstIds.map((astId) => db.collection(COLLECTIONS.asts).doc(astId));
  const astSnaps = await getAllExisting({ db, refs: astRefs });

  const { astUpdates, warnings } = buildAstPatches({
    astSnaps,
    childTrnSnaps,
    deletedTrnIds: childTrnIds,
    now,
  });

  const tcRowUpdates = tcRowSnaps
    .filter((snap) => rowsToReset.has(snap.id))
    .map((snap) => ({
      ref: snap.ref,
      patch: buildTcRowResetPatch({ now, batchIds, trnIds: childTrnIds }),
    }));

  const tcUploadPatch = buildTcUploadPatch({ tcRowSnaps, rowsToReset, now });
  const tcUploadUpdate = { ref: tcUploadRef, patch: tcUploadPatch };

  const deletes = [
    ...batchHistorySnaps.map((snap) => snap.ref),
    ...childTrnHistorySnaps.map((snap) => snap.ref),
    ...notificationSnaps.map((snap) => snap.ref),
    ...dedupeSnaps.map((snap) => snap.ref),
    ...bgoRowSnaps.map((snap) => snap.ref),
    ...childTrnSnaps.map((snap) => snap.ref),
    ...batchSnaps.map((snap) => snap.ref),
  ];

  const updates = [tcUploadUpdate, ...tcRowUpdates, ...astUpdates];

  const backupPayload = {
    script: "resetBgoTcUploadToPreBgo.js",
    version: "BGO_DEV_RESET_V1",
    mode: args.apply ? "APPLY" : "DRY_RUN",
    tcId: args.tcId,
    createdAt: now,
    collections: COLLECTIONS,
    counts: {
      tcRows: tcRowSnaps.length,
      rowsToReset: rowsToReset.size,
      bgoBatches: batchSnaps.length,
      bgoRows: bgoRowSnaps.length,
      childTrns: childTrnSnaps.length,
      batchHistory: batchHistorySnaps.length,
      childTrnHistory: childTrnHistorySnaps.length,
      asts: astSnaps.length,
      astUpdates: astUpdates.length,
      notifications: notificationSnaps.length,
      dedupeDocs: dedupeSnaps.length,
      deletes: deletes.length,
      updates: updates.length,
      warnings: warnings.length,
    },
    warnings,
    docs: {
      tcUpload: backupDocFromSnap(tcUploadSnap),
      tcRows: tcRowSnaps.map(backupDocFromSnap),
      bgoBatches: batchSnaps.map(backupDocFromSnap),
      bgoRows: bgoRowSnaps.map(backupDocFromSnap),
      childTrns: childTrnSnaps.map(backupDocFromSnap),
      batchHistory: batchHistorySnaps.map(backupDocFromSnap),
      childTrnHistory: childTrnHistorySnaps.map(backupDocFromSnap),
      asts: astSnaps.map(backupDocFromSnap),
      notifications: notificationSnaps.map(backupDocFromSnap),
      tcUploadDedupe: dedupeSnaps.map(backupDocFromSnap),
    },
    plannedUpdates: updates.map((item) => ({ path: item.ref.path, patch: serializeData(item.patch) })),
    plannedDeletes: deletes.map((ref) => ref.path),
  };

  const backupPath = writeBackup({ backupDir: args.backupDir, tcId: args.tcId, payload: backupPayload });

  const plan = {
    tcId: args.tcId,
    apply: args.apply,
    batchCount: batchSnaps.length,
    bgoRowDocCount: bgoRowSnaps.length,
    childTrnCount: childTrnSnaps.length,
    childTrnStateCounts: getExecutionStateCounts(childTrnSnaps),
    tcRowCount: tcRowSnaps.length,
    tcRowsToReset: rowsToReset.size,
    affectedAstCount: affectedAstIds.length,
    astUpdateCount: astUpdates.length,
    notificationCount: notificationSnaps.length,
    dedupeCount: dedupeSnaps.length,
    historyDocCount: batchHistorySnaps.length + childTrnHistorySnaps.length,
    deleteCount: deletes.length,
    updateCount: updates.length,
    warningCount: warnings.length,
    backupPath,
  };

  printPlan(plan);

  if (warnings.length > 0) {
    console.log("⚠️ AST status warnings:");
    warnings.forEach((warning) => console.log(JSON.stringify(warning, null, 2)));
    console.log("");
  }

  if (!args.apply) {
    console.log("✅ Dry run complete. No Firestore writes were made.");
    console.log("Run again with --apply to execute this reset.");
    return;
  }

  if (deletes.length === 0 && updates.length === 0) {
    console.log("✅ Nothing to reset.");
    return;
  }

  const committed = await commitInChunks({ db, deletes, updates });

  console.log("✅ BGO dev reset applied successfully.");
  console.log(`Committed operations: ${committed}`);
  console.log(`Backup: ${backupPath}`);
}

main().catch((error) => {
  console.error("❌ BGO dev reset failed", {
    message: error?.message || String(error),
    stack: error?.stack || "NAv",
    code: error?.code || "NAv",
  });
  process.exit(1);
});
