import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

import {
  resolveAuthoritativeSalesErfReference,
} from "../../targetedBatches/helpers.js";

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;

    const key = token.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeUpper(value) {
  return cleanText(value).toUpperCase();
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getRowNo(row = {}) {
  const number = Number(row?.rowNo || 0);
  return Number.isFinite(number) ? number : 0;
}

function hasExecutionStarted(parent = {}, rows = []) {
  const parentStatus = normalizeUpper(parent?.execution?.status);
  const startedRows = Number(parent?.counts?.executionStartedRows || 0);
  const childStarted = rows.some(
    (row) => normalizeUpper(row?.execution?.status) !== "NOT_STARTED",
  );

  return (
    parentStatus !== "NOT_STARTED" ||
    Boolean(parent?.execution?.startedAt) ||
    startedRows > 0 ||
    childStarted
  );
}

function buildAssessment({ row, sourceSnapshot }) {
  const sourceExists = sourceSnapshot?.exists === true;
  const source = sourceExists ? sourceSnapshot.data() || {} : {};
  const sourceId = cleanText(row?.salesAllMeterId || row?.source?.recordId);
  const currentErfId = cleanText(row?.refs?.erfId);
  const currentErfNo = cleanText(row?.property?.erfNo);

  if (!sourceExists) {
    return {
      ok: false,
      classification: "SOURCE_NOT_FOUND",
      message: `Sales source ${sourceId} was not found.`,
      sourceId,
      currentErfId: currentErfId || null,
      currentErfNo: currentErfNo || null,
      resolvedErfId: null,
      resolvedErfNo: null,
      requiresWrite: false,
    };
  }

  const resolution = resolveAuthoritativeSalesErfReference({ source });

  if (!resolution.ok) {
    return {
      ok: false,
      classification: resolution.code,
      message: resolution.message,
      sourceId,
      currentErfId: currentErfId || null,
      currentErfNo: currentErfNo || null,
      resolvedErfId: null,
      resolvedErfNo: null,
      candidateErfIds: resolution.candidateErfIds || [],
      requiresWrite: false,
    };
  }

  if (currentErfId && currentErfId !== resolution.erfId) {
    return {
      ok: false,
      classification: "CURRENT_ERF_ID_CONFLICT",
      message: `Current refs.erfId ${currentErfId} conflicts with authoritative ERF ${resolution.erfId}.`,
      sourceId,
      currentErfId,
      currentErfNo: currentErfNo || null,
      resolvedErfId: resolution.erfId,
      resolvedErfNo: resolution.erfNo,
      requiresWrite: false,
    };
  }

  if (currentErfNo && currentErfNo !== resolution.erfNo) {
    return {
      ok: false,
      classification: "CURRENT_ERF_NUMBER_CONFLICT",
      message: `Current property.erfNo ${currentErfNo} conflicts with authoritative ERF number ${resolution.erfNo}.`,
      sourceId,
      currentErfId: currentErfId || null,
      currentErfNo,
      resolvedErfId: resolution.erfId,
      resolvedErfNo: resolution.erfNo,
      requiresWrite: false,
    };
  }

  const requiresWrite =
    currentErfId !== resolution.erfId ||
    currentErfNo !== resolution.erfNo;

  return {
    ok: true,
    classification: requiresWrite
      ? "READY_FOR_ERF_REFERENCE_REPAIR"
      : "ERF_REFERENCE_ALREADY_CORRECT",
    message: requiresWrite
      ? "ERF reference can be repaired from the authoritative Sales source."
      : "ERF reference is already correct.",
    sourceId,
    currentErfId: currentErfId || null,
    currentErfNo: currentErfNo || null,
    resolvedErfId: resolution.erfId,
    resolvedErfNo: resolution.erfNo,
    resolutionSource: resolution.resolutionSource,
    requiresWrite,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = cleanText(args["project-id"] || "ireps2");
  const tbId = normalizeUpper(args["tb-id"]);
  const apply = args.apply === true;
  const serviceAccountPath = path.resolve(cleanText(args["service-account"]));
  const outputPath = path.resolve(
    cleanText(args.output) ||
      path.join(
        process.cwd(),
        `TB_ERF_REFERENCE_REPAIR_${tbId}_${apply ? "APPLY" : "DRY_RUN"}.json`,
      ),
  );

  if (!tbId) throw new Error("--tb-id is required.");
  if (!args["service-account"]) {
    throw new Error("--service-account is required.");
  }
  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(`Service account file not found: ${serviceAccountPath}`);
  }

  console.log("");
  console.log("==============================================");
  console.log("TARGETED BATCH ERF REFERENCE REPAIR");
  console.log("==============================================");
  console.log(`[PROJECT] ${projectId}`);
  console.log(`[TB ID]   ${tbId}`);
  console.log(`[MODE]    ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`[OUTPUT]  ${outputPath}`);

  if (!getApps().length) {
    initializeApp({
      credential: cert(readJsonFile(serviceAccountPath)),
      projectId,
    });
  }

  const db = getFirestore();

  console.log("");
  console.log("[1/5] Reading Targeted Batch parent...");
  const parentSnapshot = await db.collection("tb_uploads").doc(tbId).get();

  if (!parentSnapshot.exists) {
    throw new Error(`Targeted Batch ${tbId} was not found.`);
  }

  const parent = parentSnapshot.data() || {};
  console.log(
    `[PASS] status=${parent?.status || "NAv"}, acceptance=${parent?.acceptance?.status || "NAv"}`,
  );

  console.log("");
  console.log("[2/5] Reading permanent TB rows...");
  const rowsSnapshot = await db
    .collection("tb_rows")
    .where("tbId", "==", tbId)
    .get();
  const rows = rowsSnapshot.docs
    .map((snapshot) => ({
      id: snapshot.id,
      ref: snapshot.ref,
      ...snapshot.data(),
    }))
    .sort((left, right) => getRowNo(left) - getRowNo(right));

  console.log(`[PASS] Read ${rows.length} row(s).`);

  if (rows.length === 0) {
    throw new Error(`Targeted Batch ${tbId} has no permanent rows.`);
  }

  if (hasExecutionStarted(parent, rows)) {
    throw new Error(
      "Repair blocked because Targeted Batch execution has already started.",
    );
  }

  console.log("");
  console.log("[3/5] Reading authoritative Sales records...");
  const sourceRefs = rows.map((row) => {
    const sourceId = cleanText(row?.salesAllMeterId || row?.source?.recordId);
    return db.collection("demo_sales_meters").doc(sourceId);
  });
  const sourceSnapshots = await db.getAll(...sourceRefs);
  console.log(`[PASS] Read ${sourceSnapshots.length} source record(s).`);

  console.log("");
  console.log("[4/5] Resolving ERF references...");
  const assessments = rows.map((row, index) => {
    const assessment = buildAssessment({
      row,
      sourceSnapshot: sourceSnapshots[index],
    });

    console.log(
      `[ROW ${String(getRowNo(row)).padStart(3, "0")}] ${assessment.sourceId} -> ${assessment.classification}`,
    );

    return {
      rowNo: getRowNo(row),
      tbRowId: row.id,
      meterNo: cleanText(
        row?.meter?.numberRaw || row?.meter?.numberNormalized,
      ),
      ...assessment,
    };
  });

  const blockedRows = assessments.filter((assessment) => !assessment.ok);
  const repairableRows = assessments.filter(
    (assessment) => assessment.ok && assessment.requiresWrite,
  );
  const unchangedRows = assessments.filter(
    (assessment) => assessment.ok && !assessment.requiresWrite,
  );
  let writesPerformed = 0;

  console.log("");
  console.log("[5/5] Finalizing...");

  if (blockedRows.length > 0) {
    console.log(
      `[BLOCKED] ${blockedRows.length} row(s) could not be resolved safely. No writes performed.`,
    );
  } else if (!apply) {
    console.log(
      `[DRY RUN] ${repairableRows.length} row(s) are ready for repair. No writes performed.`,
    );
  } else if (repairableRows.length === 0) {
    console.log("[PASS] All ERF references are already correct.");
  } else {
    const now = Timestamp.now();
    const batch = db.batch();

    repairableRows.forEach((assessment) => {
      const row = rows.find((item) => item.id === assessment.tbRowId);

      batch.update(row.ref, {
        "refs.erfId": assessment.resolvedErfId,
        "property.erfNo": assessment.resolvedErfNo,
        "metadata.updatedAt": now,
        "metadata.updatedByUid": "SYSTEM_TARGETED_BATCH_ERF_REPAIR",
        "metadata.updatedByUser": "SYSTEM_TARGETED_BATCH_ERF_REPAIR",
      });
    });

    await batch.commit();
    writesPerformed = repairableRows.length;
    console.log(`[PASS] Updated ${writesPerformed} TB row(s).`);
  }

  const report = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    projectId,
    tbId,
    mode: apply ? "APPLY" : "DRY_RUN",
    parent: {
      status: parent?.status || null,
      allocationStatus: parent?.allocation?.status || null,
      acceptanceStatus: parent?.acceptance?.status || null,
      executionStatus: parent?.execution?.status || null,
    },
    summary: {
      rowsRead: rows.length,
      repairableRows: repairableRows.length,
      unchangedRows: unchangedRows.length,
      blockedRows: blockedRows.length,
      readyToApply: blockedRows.length === 0,
      firestoreWritesPerformed: writesPerformed,
    },
    rows: assessments,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log("");
  console.log("==============================================");
  console.log("REPAIR ASSESSMENT COMPLETE");
  console.log("==============================================");
  console.log(`[ROWS]       ${rows.length}`);
  console.log(`[REPAIRABLE] ${repairableRows.length}`);
  console.log(`[BLOCKED]    ${blockedRows.length}`);
  console.log(`[WRITES]     ${writesPerformed}`);
  console.log(`[OUTPUT]     ${outputPath}`);

  if (blockedRows.length > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error("");
  console.error("==============================================");
  console.error("REPAIR FAILED");
  console.error("==============================================");
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
