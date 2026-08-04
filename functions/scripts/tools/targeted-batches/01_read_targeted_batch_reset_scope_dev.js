import fs from "fs";
import path from "path";
import crypto from "crypto";
import { once } from "events";
import { fileURLToPath } from "url";
import admin from "firebase-admin";

const EXPECTED_PROJECT_ID = "ireps2";
const DEFAULT_SERVICE_ACCOUNT =
  "C:\\dev\\secrets\\ireps2-e72fd9dc94de.json";

const COLLECTIONS = [
  "tb_rows",
  "tb_uploads",
  "demo_sales_meters",
];

const PAGE_SIZE = 500;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../../");
const REPORTS_ROOT = path.join(
  REPO_ROOT,
  "reports",
  "targeted-batch-reset",
);

function getArgValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;

  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}.`);
  }

  return value;
}

function utcRunId(prefix) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

  return `${prefix}_${stamp}`;
}

function printDivider() {
  console.log("============================================================");
}

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertDevProject(projectId, serviceAccount) {
  if (projectId !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `DEV guard failed. Expected project "${EXPECTED_PROJECT_ID}", received "${projectId}".`,
    );
  }

  if (serviceAccount.project_id !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `Service-account guard failed. Expected "${EXPECTED_PROJECT_ID}", received "${serviceAccount.project_id}".`,
    );
  }
}

function initFirestore(serviceAccount) {
  const app = admin.initializeApp(
    {
      credential: admin.credential.cert(serviceAccount),
      projectId: EXPECTED_PROJECT_ID,
    },
    `targeted-batch-reset-read-${Date.now()}`,
  );

  return admin.firestore(app);
}

function isTimestamp(value) {
  return value?.constructor?.name === "Timestamp";
}

function isGeoPoint(value) {
  return value?.constructor?.name === "GeoPoint";
}

function isDocumentReference(value) {
  return value?.constructor?.name === "DocumentReference";
}

function toJsonSafe(value) {
  if (value === null || value === undefined) return value ?? null;

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value instanceof Date) {
    return {
      __type__: "Date",
      iso: value.toISOString(),
    };
  }

  if (isTimestamp(value)) {
    return {
      __type__: "Timestamp",
      iso: value.toDate().toISOString(),
      seconds: value.seconds,
      nanoseconds: value.nanoseconds,
    };
  }

  if (isGeoPoint(value)) {
    return {
      __type__: "GeoPoint",
      latitude: value.latitude,
      longitude: value.longitude,
    };
  }

  if (isDocumentReference(value)) {
    return {
      __type__: "DocumentReference",
      path: value.path,
    };
  }

  if (Buffer.isBuffer(value)) {
    return {
      __type__: "Bytes",
      base64: value.toString("base64"),
    };
  }

  if (ArrayBuffer.isView(value)) {
    return {
      __type__: "Bytes",
      base64: Buffer.from(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      ).toString("base64"),
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonSafe(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, childValue]) => [
        key,
        toJsonSafe(childValue),
      ]),
    );
  }

  return String(value);
}

async function writeLine(stream, hash, object) {
  const line = `${JSON.stringify(object)}\n`;
  hash.update(line);

  if (!stream.write(line, "utf8")) {
    await once(stream, "drain");
  }
}

async function exportCollection(db, collectionName, outputFile) {
  const collectionRef = db.collection(collectionName);
  const stream = fs.createWriteStream(outputFile, {
    encoding: "utf8",
    flags: "wx",
  });
  const hash = crypto.createHash("sha256");

  let lastDoc = null;
  let totalDocs = 0;
  let pages = 0;
  let docsWithTbRefsField = 0;
  let docsWithNonEmptyTbRefs = 0;

  try {
    while (true) {
      let query = collectionRef
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(PAGE_SIZE);

      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snapshot = await query.get();
      if (snapshot.empty) break;

      pages += 1;

      for (const docSnap of snapshot.docs) {
        const data = docSnap.data();

        if (
          collectionName === "demo_sales_meters" &&
          Object.prototype.hasOwnProperty.call(data, "tbRefs")
        ) {
          docsWithTbRefsField += 1;

          if (Array.isArray(data.tbRefs) && data.tbRefs.length > 0) {
            docsWithNonEmptyTbRefs += 1;
          }
        }

        await writeLine(stream, hash, {
          documentPath: docSnap.ref.path,
          documentId: docSnap.id,
          createTime: docSnap.createTime?.toDate?.().toISOString() ?? null,
          updateTime: docSnap.updateTime?.toDate?.().toISOString() ?? null,
          readTime: docSnap.readTime?.toDate?.().toISOString() ?? null,
          data: toJsonSafe(data),
        });
      }

      totalDocs += snapshot.size;
      lastDoc = snapshot.docs[snapshot.docs.length - 1];

      console.log(
        `[READ] ${collectionName}: page ${pages}, ` +
          `${snapshot.size} docs, total ${totalDocs}`,
      );
    }

    stream.end();
    await once(stream, "finish");
  } catch (error) {
    stream.destroy();
    throw error;
  }

  return {
    collection: collectionName,
    documents: totalDocs,
    pages,
    pageSize: PAGE_SIZE,
    exportFile: outputFile,
    sha256: hash.digest("hex"),
    docsWithTbRefsField:
      collectionName === "demo_sales_meters"
        ? docsWithTbRefsField
        : null,
    docsWithNonEmptyTbRefs:
      collectionName === "demo_sales_meters"
        ? docsWithNonEmptyTbRefs
        : null,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const projectId = getArgValue(
    args,
    "--project-id",
    EXPECTED_PROJECT_ID,
  );
  const serviceAccountPath = getArgValue(
    args,
    "--service-account",
    process.env.IREPS_DEV_SERVICE_ACCOUNT || DEFAULT_SERVICE_ACCOUNT,
  );

  const runId = utcRunId("TARGETED_BATCH_RESET_INVENTORY");
  const runDir = path.join(REPORTS_ROOT, runId);
  const exportDir = path.join(runDir, "before");

  fs.mkdirSync(exportDir, { recursive: true });

  printDivider();
  console.log("TARGETED BATCH RESET — STEP 1 READ AND EXPORT");
  printDivider();
  console.log(`Run ID: ${runId}`);
  console.log(`Project: ${projectId}`);
  console.log(`Service account: ${serviceAccountPath}`);
  console.log(`Collections: ${COLLECTIONS.join(", ")}`);
  console.log(`Report directory: ${runDir}`);
  console.log("Mode: READ ONLY");
  console.log("Firestore writes: 0");
  printDivider();

  const serviceAccount = readJson(
    serviceAccountPath,
    "Service-account file",
  );
  assertDevProject(projectId, serviceAccount);

  const db = initFirestore(serviceAccount);
  const startedAt = new Date().toISOString();
  const collectionReports = [];

  for (const collectionName of COLLECTIONS) {
    const outputFile = path.join(
      exportDir,
      `${collectionName}.jsonl`,
    );

    console.log(`[START] Reading ${collectionName}...`);

    const report = await exportCollection(
      db,
      collectionName,
      outputFile,
    );

    collectionReports.push(report);

    console.log(
      `[DONE] ${collectionName}: ${report.documents} docs, ` +
        `SHA-256 ${report.sha256}`,
    );

    if (collectionName === "demo_sales_meters") {
      console.log(
        `[DEMO SALES] docs with tbRefs field: ` +
          `${report.docsWithTbRefsField}`,
      );
      console.log(
        `[DEMO SALES] docs with non-empty tbRefs: ` +
          `${report.docsWithNonEmptyTbRefs}`,
      );
    }
  }

  const finishedAt = new Date().toISOString();
  const totalDocuments = collectionReports.reduce(
    (sum, item) => sum + item.documents,
    0,
  );

  const inventory = {
    schemaVersion: "1.1.0",
    status: "PASSED",
    runId,
    mode: "READ_ONLY_EXPORT",
    projectId,
    resetPolicy: {
      deleteCollections: ["tb_rows", "tb_uploads"],
      preserveCollectionDocuments: ["demo_sales_meters"],
      demoSalesCleanOperation: "DELETE_FIELD_tbRefs_ONLY",
    },
    collections: collectionReports,
    totalDocuments,
    firestoreWrites: 0,
    startedAt,
    finishedAt,
    reportDirectory: runDir,
  };

  const inventoryPath = path.join(runDir, "inventory.json");

  fs.writeFileSync(
    inventoryPath,
    `${JSON.stringify(inventory, null, 2)}\n`,
    "utf8",
  );

  fs.mkdirSync(REPORTS_ROOT, { recursive: true });

  fs.writeFileSync(
    path.join(REPORTS_ROOT, "LATEST_INVENTORY.json"),
    `${JSON.stringify(
      {
        runId,
        projectId,
        inventoryPath,
        createdAt: finishedAt,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  printDivider();
  console.log("STEP 1 PASSED");
  console.log(`Documents exported: ${totalDocuments}`);
  console.log(`Inventory: ${inventoryPath}`);
  console.log("Firestore writes performed: 0");
  printDivider();
}

main().catch((error) => {
  console.error("");
  console.error("STEP 1 FAILED");
  console.error(error?.stack || error);
  process.exitCode = 1;
});
