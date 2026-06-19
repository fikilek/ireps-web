#!/usr/bin/env node

/**
 * iREPS — Tag one AST meter onto a geofence
 *
 * Purpose:
 * - Controlled DEV/test utility for correcting one AST's geofenceRefs.
 * - Dry-run by default.
 * - Writes only with --confirm.
 * - Can also write a patched copy of the AST export JSON so follow-up seed scripts
 *   can use the corrected geofence context without waiting for a fresh export.
 *
 * Default target:
 * - Meter No: W12964
 * - AST ID: TRN_MINST_1781744653513_WTR_ZA2157008_7335
 * - Geofence: Gf Maninjwa / Mvtjb8Jlgd02CmfnGjTQ
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const DEFAULTS = Object.freeze({
  astCollection: "asts",
  astId: "TRN_MINST_1781744653513_WTR_ZA2157008_7335",
  meterNo: "W12964",
  geofenceId: "Mvtjb8Jlgd02CmfnGjTQ",
  geofenceName: "Gf Maninjwa",
  updatedByUid: "SYSTEM_SCRIPT",
  updatedByUser: "tag_ast_meter_to_geofence.js",
});

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) continue;

    const key = token.slice(2);
    const next = argv[index + 1];

    if (["confirm", "help", "allowMeterMismatch"].includes(key)) {
      args[key] = true;
      continue;
    }

    if (!next || next.startsWith("--")) {
      args[key] = "";
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  node ./scripts/tag_ast_meter_to_geofence.js --input <ast-export.json>

Dry-run example:
  node ./scripts/tag_ast_meter_to_geofence.js \\
    --input "C:\\Users\\User\\OneDrive\\Desktop\\ireps2-asts-20260619-0505.json"

Confirmed Firestore write:
  $env:GOOGLE_APPLICATION_CREDENTIALS="C:\\dev\\secrets\\ireps2-e72fd9dc94de.json"
  $env:GOOGLE_CLOUD_PROJECT="ireps2"
  $env:GCLOUD_PROJECT="ireps2"

  node ./scripts/tag_ast_meter_to_geofence.js \\
    --input "C:\\Users\\User\\OneDrive\\Desktop\\ireps2-asts-20260619-0505.json" \\
    --outputPatchedExport "C:\\Users\\User\\OneDrive\\Desktop\\ireps2-asts-20260619-0505.manjinjwa-tagged.json" \\
    --confirm

Options:
  --input                 Optional AST export JSON path used for validation and patched output.
  --astId                 AST document ID. Default: ${DEFAULTS.astId}
  --meterNo               Meter number. Default: ${DEFAULTS.meterNo}
  --geofenceId            Geofence ID. Default: ${DEFAULTS.geofenceId}
  --geofenceName          Geofence name. Default: ${DEFAULTS.geofenceName}
  --projectId             Firebase project ID. If omitted, env/service account/default ireps2 is used.
  --outputPatchedExport   Optional output JSON path for a patched AST export copy.
  --allowMeterMismatch    Allow Firestore doc meterNo to differ from --meterNo.
  --confirm               Write to Firestore. Without this, dry-run only.
`);
}

function readJsonFile(filePath) {
  const resolved = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function getAstMeterNo(ast = {}) {
  return normalizeText(
    ast?.ast?.astData?.astNo ||
      ast?.astData?.astNo ||
      ast?.master?.id ||
      ast?.meterNo ||
      "",
  );
}

function getAstMeterKind(ast = {}) {
  return normalizeText(ast?.meterType || ast?.ast?.astData?.meter?.kind || "NAv");
}

function getAstMeterType(ast = {}) {
  return normalizeText(ast?.ast?.astData?.meter?.type || ast?.meter?.type || "NAv");
}

function getAstStatus(ast = {}) {
  return normalizeText(ast?.status?.state || ast?.status || "NAv");
}

function getDocIdFromExportKey(key = "") {
  const clean = String(key || "").trim();
  return clean.includes("/") ? clean.split("/").pop() : clean;
}

function findAstInExport(exportData = {}, { astId, meterNo }) {
  const wantedAstId = normalizeUpper(astId);
  const wantedMeterNo = normalizeUpper(meterNo);

  for (const [key, value] of Object.entries(exportData || {})) {
    const docId = getDocIdFromExportKey(key);
    const rowMeterNo = normalizeUpper(getAstMeterNo(value));

    if (normalizeUpper(docId) === wantedAstId || rowMeterNo === wantedMeterNo) {
      return {
        exportKey: key,
        docId,
        data: value,
      };
    }
  }

  return null;
}

function mergeGeofenceRefs(existingRefs = [], targetRef) {
  const cleanTarget = {
    id: normalizeText(targetRef.id),
    name: normalizeText(targetRef.name),
  };

  const byId = new Map();

  for (const item of safeArray(existingRefs)) {
    const id = normalizeText(item?.id);
    if (!id) continue;
    byId.set(id, {
      id,
      name: normalizeText(item?.name) || "NAv",
    });
  }

  byId.set(cleanTarget.id, cleanTarget);

  return Array.from(byId.values()).sort((a, b) =>
    String(a.name || a.id).localeCompare(String(b.name || b.id)),
  );
}

function hasGeofence(existingRefs = [], geofenceId) {
  const wanted = normalizeText(geofenceId);
  return safeArray(existingRefs).some((item) => normalizeText(item?.id) === wanted);
}

function readProjectIdFromServiceAccount() {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentialsPath) return "";

  try {
    const data = readJsonFile(credentialsPath);
    return normalizeText(data?.project_id);
  } catch {
    return "";
  }
}

function resolveProjectId(args = {}) {
  return (
    normalizeText(args.projectId) ||
    normalizeText(process.env.GOOGLE_CLOUD_PROJECT) ||
    normalizeText(process.env.GCLOUD_PROJECT) ||
    readProjectIdFromServiceAccount() ||
    "ireps2"
  );
}

function initFirestore(projectId) {
  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      projectId,
    });
  }

  return getFirestore();
}

function buildPreview({ source, existingRefs, mergedRefs, target }) {
  return {
    astId: target.astId,
    meterNo: getAstMeterNo(source || {}),
    premiseId: source?.accessData?.premise?.id || "NAv",
    premiseAddress: source?.accessData?.premise?.address || "NAv",
    lmPcode: source?.accessData?.parents?.lmPcode || "NAv",
    wardPcode: source?.accessData?.parents?.wardPcode || "NAv",
    meterKind: getAstMeterKind(source || {}),
    meterType: getAstMeterType(source || {}),
    status: getAstStatus(source || {}),
    existingGeofenceRefs: safeArray(existingRefs),
    mergedGeofenceRefs: mergedRefs,
    alreadyTagged: hasGeofence(existingRefs, target.geofenceId),
  };
}

function writePatchedExport({ inputPath, outputPath, exportData, exportMatch, mergedRefs }) {
  if (!inputPath || !outputPath || !exportMatch) return null;

  const patched = JSON.parse(JSON.stringify(exportData));
  const targetRow = patched[exportMatch.exportKey] || {};

  targetRow.geofenceRefs = mergedRefs;
  targetRow.metadata = {
    ...(targetRow.metadata || {}),
    updatedAt: new Date().toISOString(),
    updatedByUid: DEFAULTS.updatedByUid,
    updatedByUser: DEFAULTS.updatedByUser,
  };

  patched[exportMatch.exportKey] = targetRow;

  fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(patched, null, 2)}\n`, "utf8");

  return path.resolve(outputPath);
}

async function updateFirestoreAst({ args, target, exportMatch }) {
  const projectId = resolveProjectId(args);
  const db = initFirestore(projectId);
  const ref = db.collection(DEFAULTS.astCollection).doc(target.astId);
  const now = new Date().toISOString();

  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);

    if (!snap.exists) {
      throw new Error(`AST document not found: ${DEFAULTS.astCollection}/${target.astId}`);
    }

    const liveData = snap.data() || {};
    const liveMeterNo = getAstMeterNo(liveData);

    if (
      normalizeUpper(liveMeterNo) !== normalizeUpper(target.meterNo) &&
      !args.allowMeterMismatch
    ) {
      throw new Error(
        `Meter mismatch: Firestore doc ${target.astId} has meterNo ${liveMeterNo}, expected ${target.meterNo}. ` +
          "Use --allowMeterMismatch only if this is intentional.",
      );
    }

    const existingRefs = safeArray(liveData.geofenceRefs);
    const mergedRefs = mergeGeofenceRefs(existingRefs, {
      id: target.geofenceId,
      name: target.geofenceName,
    });

    const alreadyTagged = hasGeofence(existingRefs, target.geofenceId);

    transaction.update(ref, {
      geofenceRefs: mergedRefs,
      "metadata.updatedAt": now,
      "metadata.updatedByUid": DEFAULTS.updatedByUid,
      "metadata.updatedByUser": DEFAULTS.updatedByUser,
    });

    return {
      projectId,
      astPath: `${DEFAULTS.astCollection}/${target.astId}`,
      alreadyTagged,
      before: existingRefs,
      after: mergedRefs,
      liveData,
      exportMatchFound: Boolean(exportMatch),
      updatedAt: now,
    };
  });
}

async function main() {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    return;
  }

  const target = {
    astId: normalizeText(args.astId) || DEFAULTS.astId,
    meterNo: normalizeText(args.meterNo) || DEFAULTS.meterNo,
    geofenceId: normalizeText(args.geofenceId) || DEFAULTS.geofenceId,
    geofenceName: normalizeText(args.geofenceName) || DEFAULTS.geofenceName,
  };

  if (!target.astId && !target.meterNo) {
    throw new Error("Provide --astId or --meterNo.");
  }

  if (!target.geofenceId || !target.geofenceName) {
    throw new Error("Provide --geofenceId and --geofenceName.");
  }

  let exportData = null;
  let exportMatch = null;

  if (args.input) {
    exportData = readJsonFile(args.input);
    exportMatch = findAstInExport(exportData, target);
  }

  if (exportData && !exportMatch) {
    throw new Error(
      `Could not find target AST in export by astId=${target.astId} or meterNo=${target.meterNo}`,
    );
  }

  const sourceForPreview = exportMatch?.data || null;
  const existingRefsForPreview = safeArray(sourceForPreview?.geofenceRefs);
  const mergedRefsForPreview = mergeGeofenceRefs(existingRefsForPreview, {
    id: target.geofenceId,
    name: target.geofenceName,
  });

  console.log("============================================================");
  console.log("iREPS — Tag AST Meter to Geofence");
  console.log("============================================================");
  console.log(`Mode: ${args.confirm ? "CONFIRMED FIRESTORE UPDATE" : "DRY RUN ONLY"}`);
  console.log(`Target AST: ${target.astId}`);
  console.log(`Target meterNo: ${target.meterNo}`);
  console.log(`Target geofence: ${target.geofenceName} (${target.geofenceId})`);
  console.log(`Input AST export: ${args.input ? path.resolve(args.input) : "NAv"}`);
  console.log(`Output patched export: ${args.outputPatchedExport ? path.resolve(args.outputPatchedExport) : "NAv"}`);
  console.log("------------------------------------------------------------");

  if (sourceForPreview) {
    console.table([
      buildPreview({
        source: sourceForPreview,
        existingRefs: existingRefsForPreview,
        mergedRefs: mergedRefsForPreview,
        target,
      }),
    ]);
  } else {
    console.log("No local export row supplied/found. Firestore will be used only when --confirm is passed.");
  }

  let patchedExportPath = null;

  if (args.outputPatchedExport && exportData && exportMatch) {
    patchedExportPath = writePatchedExport({
      inputPath: args.input,
      outputPath: args.outputPatchedExport,
      exportData,
      exportMatch,
      mergedRefs: mergedRefsForPreview,
    });

    console.log("------------------------------------------------------------");
    console.log(`Patched export copy written: ${patchedExportPath}`);
  }

  if (!args.confirm) {
    console.log("------------------------------------------------------------");
    console.log("DRY RUN COMPLETE — no Firestore writes performed.");
    console.log("Add --confirm to update Firestore.");
    return;
  }

  const result = await updateFirestoreAst({ args, target, exportMatch });

  console.log("------------------------------------------------------------");
  console.log("FIRESTORE UPDATE COMPLETE");
  console.log(JSON.stringify(result, null, 2));

  if (patchedExportPath) {
    console.log("------------------------------------------------------------");
    console.log("Use this patched export for the fake Cycle 9 seed script:");
    console.log(patchedExportPath);
  } else {
    console.log("------------------------------------------------------------");
    console.log("Reminder: your old local AST export is unchanged unless you used --outputPatchedExport.");
    console.log("Re-export ASTs or run again with --outputPatchedExport before seeding from local JSON.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
