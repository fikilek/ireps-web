import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";

const SOURCE_PROJECT_ID = "ireps2";
const TARGET_PROJECT_ID = "ireps-test";
const COLLECTION_NAME = "irepsSelectLookups";

const DEFAULT_SOURCE_SERVICE_ACCOUNT =
  "C:\\dev\\secrets\\ireps2-e72fd9dc94de.json";
const DEFAULT_TARGET_SERVICE_ACCOUNT =
  "C:\\dev\\secrets\\ireps-test-firebase-adminsdk-fbsvc-d02929e1e3.json";

const sourceServiceAccountPath =
  process.env.IREPS_SOURCE_SERVICE_ACCOUNT || DEFAULT_SOURCE_SERVICE_ACCOUNT;
const targetServiceAccountPath =
  process.env.IREPS_TARGET_SERVICE_ACCOUNT || DEFAULT_TARGET_SERVICE_ACCOUNT;

const args = process.argv.slice(2);
const failOnDiff = args.includes("--fail-on-diff");
const showValues = args.includes("--show-values");
const maxPrintedItems = readNumberArg("--max-print", 80);
const maxPrintedFieldDiffs = readNumberArg("--max-field-diffs", 40);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const reportDir = path.join(__dirname, "reports");

function readNumberArg(flag, fallback) {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const raw = args[index + 1];
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function printLine() {
  console.log("============================================================");
}

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} service account file not found: ${filePath}`);
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertServiceAccountProject(serviceAccount, expectedProjectId, label) {
  if (serviceAccount.project_id !== expectedProjectId) {
    throw new Error(
      `${label} service account project mismatch. Expected "${expectedProjectId}", got "${serviceAccount.project_id}".`,
    );
  }
}

function initFirestore(appName, serviceAccount) {
  const app = admin.initializeApp(
    {
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    },
    appName,
  );

  return admin.firestore(app);
}

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function sortObjectKeys(obj) {
  return Object.keys(obj)
    .sort()
    .reduce((acc, key) => {
      acc[key] = obj[key];
      return acc;
    }, {});
}

function normalizeFirestoreValue(value) {
  if (value === null || value === undefined) return value;

  if (
    value instanceof admin.firestore.Timestamp ||
    (typeof value?._seconds === "number" && typeof value?._nanoseconds === "number")
  ) {
    return {
      __firestoreType: "Timestamp",
      seconds: value.seconds ?? value._seconds,
      nanoseconds: value.nanoseconds ?? value._nanoseconds,
    };
  }

  if (value instanceof admin.firestore.GeoPoint) {
    return {
      __firestoreType: "GeoPoint",
      latitude: value.latitude,
      longitude: value.longitude,
    };
  }

  if (value instanceof admin.firestore.DocumentReference) {
    return {
      __firestoreType: "DocumentReference",
      path: value.path,
    };
  }

  if (value instanceof Date) {
    return {
      __firestoreType: "Date",
      iso: value.toISOString(),
    };
  }

  if (Buffer.isBuffer(value)) {
    return {
      __firestoreType: "Buffer",
      base64: value.toString("base64"),
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeFirestoreValue(item));
  }

  if (typeof value === "object") {
    const normalized = {};
    Object.keys(value)
      .sort()
      .forEach((key) => {
        normalized[key] = normalizeFirestoreValue(value[key]);
      });
    return normalized;
  }

  return value;
}

function canonicalString(value) {
  return JSON.stringify(normalizeFirestoreValue(value));
}

function preview(value) {
  const raw = JSON.stringify(value);
  if (!raw) return String(value);
  if (raw.length <= 220) return raw;
  return `${raw.slice(0, 220)}...`;
}

function diffValues(source, target, basePath = "$", out = []) {
  const sType = valueType(source);
  const tType = valueType(target);

  if (sType !== tType) {
    out.push({
      path: basePath,
      kind: "TYPE_MISMATCH",
      sourceType: sType,
      targetType: tType,
      ...(showValues ? { sourceValue: source, targetValue: target } : {}),
    });
    return out;
  }

  if (sType === "array") {
    if (source.length !== target.length) {
      out.push({
        path: `${basePath}.length`,
        kind: "ARRAY_LENGTH_MISMATCH",
        sourceValue: source.length,
        targetValue: target.length,
      });
    }

    const maxLength = Math.max(source.length, target.length);
    for (let i = 0; i < maxLength; i += 1) {
      if (i >= source.length) {
        out.push({
          path: `${basePath}[${i}]`,
          kind: "EXTRA_ARRAY_ITEM_IN_TARGET",
          ...(showValues ? { targetValue: target[i] } : {}),
        });
      } else if (i >= target.length) {
        out.push({
          path: `${basePath}[${i}]`,
          kind: "MISSING_ARRAY_ITEM_IN_TARGET",
          ...(showValues ? { sourceValue: source[i] } : {}),
        });
      } else {
        diffValues(source[i], target[i], `${basePath}[${i}]`, out);
      }
    }

    return out;
  }

  if (sType === "object") {
    const sourceKeys = Object.keys(source).sort();
    const targetKeys = Object.keys(target).sort();
    const allKeys = Array.from(new Set([...sourceKeys, ...targetKeys])).sort();

    for (const key of allKeys) {
      const childPath = `${basePath}.${key}`;

      if (!Object.prototype.hasOwnProperty.call(source, key)) {
        out.push({
          path: childPath,
          kind: "EXTRA_FIELD_IN_TARGET",
          ...(showValues ? { targetValue: target[key] } : {}),
        });
      } else if (!Object.prototype.hasOwnProperty.call(target, key)) {
        out.push({
          path: childPath,
          kind: "MISSING_FIELD_IN_TARGET",
          ...(showValues ? { sourceValue: source[key] } : {}),
        });
      } else {
        diffValues(source[key], target[key], childPath, out);
      }
    }

    return out;
  }

  if (source !== target) {
    out.push({
      path: basePath,
      kind: "VALUE_MISMATCH",
      ...(showValues ? { sourceValue: source, targetValue: target } : {}),
    });
  }

  return out;
}

async function collectDocumentTree({ collectionRef, output }) {
  const snap = await collectionRef.get();

  for (const docSnap of snap.docs) {
    const rawData = docSnap.data();
    const normalizedData = normalizeFirestoreValue(rawData);
    const normalizedPath = docSnap.ref.path.replace(/\\/g, "/");

    output.set(normalizedPath, {
      path: normalizedPath,
      id: docSnap.id,
      data: normalizedData,
      canonical: JSON.stringify(normalizedData),
    });

    const subcollections = await docSnap.ref.listCollections();
    for (const subcollectionRef of subcollections) {
      await collectDocumentTree({
        collectionRef: subcollectionRef,
        output,
      });
    }
  }
}

function buildExceptions({ sourceMap, targetMap }) {
  const sourcePaths = Array.from(sourceMap.keys()).sort();
  const targetPaths = Array.from(targetMap.keys()).sort();
  const sourcePathSet = new Set(sourcePaths);
  const targetPathSet = new Set(targetPaths);

  const missingInTarget = sourcePaths.filter((pathValue) => !targetPathSet.has(pathValue));
  const extraInTarget = targetPaths.filter((pathValue) => !sourcePathSet.has(pathValue));
  const changedDocs = [];

  for (const pathValue of sourcePaths) {
    if (!targetPathSet.has(pathValue)) continue;

    const sourceDoc = sourceMap.get(pathValue);
    const targetDoc = targetMap.get(pathValue);

    if (sourceDoc.canonical === targetDoc.canonical) continue;

    const fieldDiffs = diffValues(sourceDoc.data, targetDoc.data);
    changedDocs.push({
      path: pathValue,
      diffCount: fieldDiffs.length,
      fieldDiffs,
    });
  }

  return {
    missingInTarget,
    extraInTarget,
    changedDocs,
  };
}

function limited(items, maxItems) {
  return items.slice(0, maxItems);
}

function writeReport(report) {
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(
    reportDir,
    `lookup_compare_exceptions_${SOURCE_PROJECT_ID}_vs_${TARGET_PROJECT_ID}_${stamp}.json`,
  );

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return reportPath;
}

function printExceptions(report, reportPath) {
  printLine();
  console.log("EXCEPTIONS FOUND");
  printLine();
  console.log(
    JSON.stringify(
      {
        sourceProject: SOURCE_PROJECT_ID,
        targetProject: TARGET_PROJECT_ID,
        collection: COLLECTION_NAME,
        sourceTotalDocsRecursive: report.summary.sourceTotalDocsRecursive,
        targetTotalDocsRecursive: report.summary.targetTotalDocsRecursive,
        missingInTargetCount: report.summary.missingInTargetCount,
        extraInTargetCount: report.summary.extraInTargetCount,
        changedDocsCount: report.summary.changedDocsCount,
        totalExceptionCount: report.summary.totalExceptionCount,
        fullReportPath: reportPath,
      },
      null,
      2,
    ),
  );

  if (report.exceptions.missingInTarget.length > 0) {
    printLine();
    console.log(`Missing in ${TARGET_PROJECT_ID}:`);
    for (const item of limited(report.exceptions.missingInTarget, maxPrintedItems)) {
      console.log(`- ${item}`);
    }
    const remaining = report.exceptions.missingInTarget.length - maxPrintedItems;
    if (remaining > 0) console.log(`... ${remaining} more in report file`);
  }

  if (report.exceptions.extraInTarget.length > 0) {
    printLine();
    console.log(`Extra in ${TARGET_PROJECT_ID}:`);
    for (const item of limited(report.exceptions.extraInTarget, maxPrintedItems)) {
      console.log(`- ${item}`);
    }
    const remaining = report.exceptions.extraInTarget.length - maxPrintedItems;
    if (remaining > 0) console.log(`... ${remaining} more in report file`);
  }

  if (report.exceptions.changedDocs.length > 0) {
    printLine();
    console.log("Changed document shapes/values:");

    for (const docDiff of limited(report.exceptions.changedDocs, maxPrintedItems)) {
      console.log(`- ${docDiff.path} (${docDiff.diffCount} field differences)`);

      for (const fieldDiff of limited(docDiff.fieldDiffs, maxPrintedFieldDiffs)) {
        const base = `    ${fieldDiff.kind}: ${fieldDiff.path}`;
        if (showValues) {
          console.log(
            `${base} | source=${preview(fieldDiff.sourceValue)} | target=${preview(fieldDiff.targetValue)}`,
          );
        } else {
          console.log(base);
        }
      }

      const remainingFieldDiffs = docDiff.fieldDiffs.length - maxPrintedFieldDiffs;
      if (remainingFieldDiffs > 0) {
        console.log(`    ... ${remainingFieldDiffs} more field differences in report file`);
      }
    }

    const remainingDocs = report.exceptions.changedDocs.length - maxPrintedItems;
    if (remainingDocs > 0) console.log(`... ${remainingDocs} more changed docs in report file`);
  }
}

async function main() {
  printLine();
  console.log("Compare irepsSelectLookups DEV vs TEST — exceptions only");
  printLine();
  console.log("Mode: READ ONLY");
  console.log(`Source project: ${SOURCE_PROJECT_ID}`);
  console.log(`Target project: ${TARGET_PROJECT_ID}`);
  console.log(`Collection: ${COLLECTION_NAME}`);
  console.log(`Source service account path: ${sourceServiceAccountPath}`);
  console.log(`Target service account path: ${targetServiceAccountPath}`);
  console.log(`Print values: ${showValues ? "YES" : "NO"}`);
  console.log(`Fail on diff: ${failOnDiff ? "YES" : "NO"}`);

  const sourceServiceAccount = readJson(sourceServiceAccountPath, "Source");
  const targetServiceAccount = readJson(targetServiceAccountPath, "Target");

  assertServiceAccountProject(sourceServiceAccount, SOURCE_PROJECT_ID, "Source");
  assertServiceAccountProject(targetServiceAccount, TARGET_PROJECT_ID, "Target");

  const sourceDb = initFirestore("ireps2-lookup-compare-source", sourceServiceAccount);
  const targetDb = initFirestore("ireps-test-lookup-compare-target", targetServiceAccount);

  const sourceMap = new Map();
  const targetMap = new Map();

  await collectDocumentTree({
    collectionRef: sourceDb.collection(COLLECTION_NAME),
    output: sourceMap,
  });

  await collectDocumentTree({
    collectionRef: targetDb.collection(COLLECTION_NAME),
    output: targetMap,
  });

  const exceptions = buildExceptions({ sourceMap, targetMap });
  const totalExceptionCount =
    exceptions.missingInTarget.length +
    exceptions.extraInTarget.length +
    exceptions.changedDocs.length;

  const report = {
    generatedAt: new Date().toISOString(),
    sourceProject: SOURCE_PROJECT_ID,
    targetProject: TARGET_PROJECT_ID,
    collection: COLLECTION_NAME,
    summary: sortObjectKeys({
      sourceTotalDocsRecursive: sourceMap.size,
      targetTotalDocsRecursive: targetMap.size,
      commonDocs: Array.from(sourceMap.keys()).filter((pathValue) => targetMap.has(pathValue)).length,
      missingInTargetCount: exceptions.missingInTarget.length,
      extraInTargetCount: exceptions.extraInTarget.length,
      changedDocsCount: exceptions.changedDocs.length,
      totalExceptionCount,
    }),
    exceptions,
  };

  if (totalExceptionCount === 0) {
    printLine();
    console.log("PASS — no lookup exceptions found.");
    console.log(
      JSON.stringify(
        {
          sourceProject: SOURCE_PROJECT_ID,
          targetProject: TARGET_PROJECT_ID,
          collection: COLLECTION_NAME,
          sourceTotalDocsRecursive: sourceMap.size,
          targetTotalDocsRecursive: targetMap.size,
          result: "ALL_PATHS_AND_DOCUMENT_SHAPES_MATCH",
        },
        null,
        2,
      ),
    );
    return;
  }

  const reportPath = writeReport(report);
  printExceptions(report, reportPath);

  if (failOnDiff) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  printLine();
  console.error("FAILED:", error);
  process.exitCode = 1;
});
