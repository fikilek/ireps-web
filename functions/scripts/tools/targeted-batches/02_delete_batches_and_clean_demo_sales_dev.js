import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";

const EXPECTED_PROJECT_ID = "ireps2";
const DEFAULT_SERVICE_ACCOUNT =
  "C:\\dev\\secrets\\ireps2-e72fd9dc94de.json";

const DELETE_COLLECTIONS_IN_ORDER = [
  "tb_rows",
  "tb_uploads",
];

const DEMO_SALES_COLLECTION = "demo_sales_meters";
const DEMO_SALES_FIELD_TO_CLEAN = "tbRefs";
const BATCH_SIZE = 400;
const PAGE_SIZE = 500;
const CONFIRM_TOKEN = "RESET_TARGETED_BATCH_SCOPE_DEV";

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
    `targeted-batch-reset-apply-${Date.now()}`,
  );

  return admin.firestore(app);
}

async function countCollectionByPaging(db, collectionName) {
  const collectionRef = db.collection(collectionName);
  let lastDoc = null;
  let count = 0;

  while (true) {
    let query = collectionRef
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(1000);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    count += snapshot.size;
    lastDoc = snapshot.docs[snapshot.docs.length - 1];
  }

  return count;
}

async function countCollection(db, collectionName) {
  try {
    const snapshot = await db.collection(collectionName).count().get();
    return snapshot.data().count;
  } catch (error) {
    console.warn(
      `[COUNT] Aggregation unavailable for ${collectionName}; ` +
        "falling back to paged read.",
    );

    return countCollectionByPaging(db, collectionName);
  }
}

function inventoryCountMap(inventory) {
  return Object.fromEntries(
    inventory.collections.map((item) => [
      item.collection,
      item.documents,
    ]),
  );
}

function validateInventory(latestPointer, inventory) {
  if (latestPointer.projectId !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `Latest inventory pointer belongs to "${latestPointer.projectId}", ` +
        `not "${EXPECTED_PROJECT_ID}".`,
    );
  }

  if (inventory.projectId !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `Inventory belongs to "${inventory.projectId}", ` +
        `not "${EXPECTED_PROJECT_ID}".`,
    );
  }

  if (inventory.status !== "PASSED") {
    throw new Error(
      `Inventory status must be PASSED. Found "${inventory.status}".`,
    );
  }

  if (inventory.mode !== "READ_ONLY_EXPORT") {
    throw new Error(
      `Unexpected inventory mode "${inventory.mode}".`,
    );
  }

  const expectedCollections = new Set([
    ...DELETE_COLLECTIONS_IN_ORDER,
    DEMO_SALES_COLLECTION,
  ]);

  const inventoryCollections = new Set(
    inventory.collections.map((item) => item.collection),
  );

  for (const collectionName of expectedCollections) {
    if (!inventoryCollections.has(collectionName)) {
      throw new Error(
        `Inventory is missing required collection "${collectionName}".`,
      );
    }
  }

  for (const item of inventory.collections) {
    if (!fs.existsSync(item.exportFile)) {
      throw new Error(
        `Inventory export is missing for ${item.collection}: ` +
          `${item.exportFile}`,
      );
    }
  }

  if (
    inventory.resetPolicy?.demoSalesCleanOperation !==
    "DELETE_FIELD_tbRefs_ONLY"
  ) {
    throw new Error(
      "Inventory reset policy does not authorize the expected " +
        "demo_sales_meters cleanup.",
    );
  }
}

async function preflightCounts(db, expectedCounts) {
  const currentCounts = {};

  for (const collectionName of [
    ...DELETE_COLLECTIONS_IN_ORDER,
    DEMO_SALES_COLLECTION,
  ]) {
    const currentCount = await countCollection(db, collectionName);
    const expectedCount = expectedCounts[collectionName];

    currentCounts[collectionName] = currentCount;

    console.log(
      `[PREFLIGHT] ${collectionName}: ` +
        `inventory=${expectedCount}, current=${currentCount}`,
    );

    if (currentCount !== expectedCount) {
      throw new Error(
        `Collection changed after inventory: ${collectionName}. ` +
          `Inventory=${expectedCount}, current=${currentCount}. ` +
          "Run Step 1 again before applying the reset.",
      );
    }
  }

  return currentCounts;
}

async function deleteCollection(db, collectionName, expectedCount) {
  const collectionRef = db.collection(collectionName);
  let deleted = 0;
  let commits = 0;

  while (true) {
    const snapshot = await collectionRef
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(BATCH_SIZE)
      .get();

    if (snapshot.empty) break;

    const batch = db.batch();

    for (const docSnap of snapshot.docs) {
      batch.delete(docSnap.ref);
    }

    await batch.commit();

    deleted += snapshot.size;
    commits += 1;

    console.log(
      `[DELETE] ${collectionName}: commit ${commits}, ` +
        `${snapshot.size} deleted, total ${deleted}/${expectedCount}`,
    );
  }

  const remaining = await countCollection(db, collectionName);

  if (remaining !== 0) {
    throw new Error(
      `Verification failed for ${collectionName}: ` +
        `${remaining} documents remain.`,
    );
  }

  return {
    collection: collectionName,
    expectedFromInventory: expectedCount,
    deleted,
    commits,
    remaining,
    status:
      deleted === expectedCount
        ? "PASSED"
        : "COUNT_CHANGED_DURING_DELETE",
  };
}

async function listDemoSalesDocsWithTbRefs(db) {
  const collectionRef = db.collection(DEMO_SALES_COLLECTION);

  let lastDoc = null;
  let pages = 0;
  let scanned = 0;
  const matches = [];

  while (true) {
    let query = collectionRef
      .select(DEMO_SALES_FIELD_TO_CLEAN)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(PAGE_SIZE);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    pages += 1;
    scanned += snapshot.size;

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();

      if (
        Object.prototype.hasOwnProperty.call(
          data,
          DEMO_SALES_FIELD_TO_CLEAN,
        )
      ) {
        matches.push({
          id: docSnap.id,
          ref: docSnap.ref,
          tbRefsBefore: data[DEMO_SALES_FIELD_TO_CLEAN],
        });
      }
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];

    console.log(
      `[SCAN] ${DEMO_SALES_COLLECTION}: page ${pages}, ` +
        `${snapshot.size} docs, total ${scanned}, ` +
        `tbRefs matches ${matches.length}`,
    );
  }

  return {
    pages,
    scanned,
    matches,
  };
}

async function cleanDemoSalesTbRefs(db, expectedDocumentCount) {
  const beforeCount = await countCollection(
    db,
    DEMO_SALES_COLLECTION,
  );

  if (beforeCount !== expectedDocumentCount) {
    throw new Error(
      `${DEMO_SALES_COLLECTION} count changed before cleanup. ` +
        `Expected ${expectedDocumentCount}, found ${beforeCount}.`,
    );
  }

  const scanBefore = await listDemoSalesDocsWithTbRefs(db);

  let cleaned = 0;
  let commits = 0;

  for (
    let offset = 0;
    offset < scanBefore.matches.length;
    offset += BATCH_SIZE
  ) {
    const chunk = scanBefore.matches.slice(
      offset,
      offset + BATCH_SIZE,
    );
    const batch = db.batch();

    for (const item of chunk) {
      batch.update(item.ref, {
        [DEMO_SALES_FIELD_TO_CLEAN]:
          admin.firestore.FieldValue.delete(),
      });
    }

    await batch.commit();

    cleaned += chunk.length;
    commits += 1;

    console.log(
      `[CLEAN] ${DEMO_SALES_COLLECTION}.${DEMO_SALES_FIELD_TO_CLEAN}: ` +
        `commit ${commits}, ${chunk.length} updated, ` +
        `total ${cleaned}/${scanBefore.matches.length}`,
    );
  }

  const afterCount = await countCollection(
    db,
    DEMO_SALES_COLLECTION,
  );

  if (afterCount !== beforeCount) {
    throw new Error(
      `${DEMO_SALES_COLLECTION} document-count guard failed. ` +
        `Before=${beforeCount}, after=${afterCount}.`,
    );
  }

  const scanAfter = await listDemoSalesDocsWithTbRefs(db);

  if (scanAfter.matches.length !== 0) {
    throw new Error(
      `Verification failed: ${scanAfter.matches.length} ` +
        `${DEMO_SALES_COLLECTION} documents still contain ` +
        `${DEMO_SALES_FIELD_TO_CLEAN}.`,
    );
  }

  return {
    collection: DEMO_SALES_COLLECTION,
    operation: `DELETE_FIELD_${DEMO_SALES_FIELD_TO_CLEAN}_ONLY`,
    documentsBefore: beforeCount,
    documentsAfter: afterCount,
    documentsDeleted: 0,
    documentsCleaned: cleaned,
    commits,
    matchedDocumentIds: scanBefore.matches.map((item) => item.id),
    fieldsPreserved: "ALL_EXCEPT_tbRefs",
    remainingDocsWithTbRefs: scanAfter.matches.length,
    status: "PASSED",
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
    process.env.IREPS_DEV_SERVICE_ACCOUNT ||
      DEFAULT_SERVICE_ACCOUNT,
  );

  const confirmValue = getArgValue(args, "--confirm", "");

  if (confirmValue !== CONFIRM_TOKEN) {
    throw new Error(
      `Reset blocked. Run with --confirm ${CONFIRM_TOKEN}`,
    );
  }

  const latestPointerPath = path.join(
    REPORTS_ROOT,
    "LATEST_INVENTORY.json",
  );

  const latestPointer = readJson(
    latestPointerPath,
    "Latest inventory pointer",
  );

  const inventory = readJson(
    latestPointer.inventoryPath,
    "Inventory report",
  );

  validateInventory(latestPointer, inventory);

  const serviceAccount = readJson(
    serviceAccountPath,
    "Service-account file",
  );

  assertDevProject(projectId, serviceAccount);

  const runId = utcRunId("TARGETED_BATCH_RESET_APPLY");
  const runDir = path.join(REPORTS_ROOT, runId);

  fs.mkdirSync(runDir, { recursive: true });

  printDivider();
  console.log("TARGETED BATCH RESET — STEP 2 APPLY");
  printDivider();
  console.log(`Run ID: ${runId}`);
  console.log(`Project: ${projectId}`);
  console.log(`Service account: ${serviceAccountPath}`);
  console.log(`Inventory run: ${inventory.runId}`);
  console.log(
    `Delete collections: ${DELETE_COLLECTIONS_IN_ORDER.join(" -> ")}`,
  );
  console.log(
    `Clean only: ${DEMO_SALES_COLLECTION}.${DEMO_SALES_FIELD_TO_CLEAN}`,
  );
  console.log(
    `${DEMO_SALES_COLLECTION} document deletion: FORBIDDEN`,
  );
  console.log(`Report directory: ${runDir}`);
  printDivider();

  const db = initFirestore(serviceAccount);
  const expectedCounts = inventoryCountMap(inventory);
  const startedAt = new Date().toISOString();

  console.log("Running count preflight...");
  const countsBefore = await preflightCounts(
    db,
    expectedCounts,
  );

  printDivider();
  console.log("Preflight passed. Starting controlled reset...");
  printDivider();

  const deletionReports = [];

  for (const collectionName of DELETE_COLLECTIONS_IN_ORDER) {
    const report = await deleteCollection(
      db,
      collectionName,
      expectedCounts[collectionName],
    );

    deletionReports.push(report);

    console.log(
      `[VERIFIED] ${collectionName}: ` +
        `${report.remaining} remaining`,
    );
  }

  const demoSalesReport = await cleanDemoSalesTbRefs(
    db,
    expectedCounts[DEMO_SALES_COLLECTION],
  );

  console.log(
    `[VERIFIED] ${DEMO_SALES_COLLECTION}: ` +
      `${demoSalesReport.documentsAfter} documents preserved, ` +
      `${demoSalesReport.remainingDocsWithTbRefs} tbRefs fields remain`,
  );

  const finishedAt = new Date().toISOString();

  const totalDeleted = deletionReports.reduce(
    (sum, item) => sum + item.deleted,
    0,
  );

  const status =
    deletionReports.every((item) => item.remaining === 0) &&
    demoSalesReport.documentsBefore ===
      demoSalesReport.documentsAfter &&
    demoSalesReport.documentsDeleted === 0 &&
    demoSalesReport.remainingDocsWithTbRefs === 0
      ? "PASSED"
      : "FAILED";

  const report = {
    schemaVersion: "1.1.0",
    status,
    runId,
    mode: "APPLY_RESET",
    projectId,
    inventoryRunId: inventory.runId,
    inventoryPath: latestPointer.inventoryPath,
    countsBefore,
    deletedCollections: deletionReports,
    cleanedCollection: demoSalesReport,
    totalDocumentsDeleted: totalDeleted,
    demoSalesDocumentsDeleted: 0,
    startedAt,
    finishedAt,
    reportDirectory: runDir,
  };

  const reportPath = path.join(runDir, "reset-report.json");

  fs.writeFileSync(
    reportPath,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  printDivider();
  console.log(`STEP 2 ${status}`);
  console.log(`Total documents deleted: ${totalDeleted}`);
  console.log("demo_sales_meters documents deleted: 0");
  console.log(
    `demo_sales_meters documents preserved: ` +
      `${demoSalesReport.documentsAfter}`,
  );
  console.log(
    `demo_sales_meters tbRefs fields removed: ` +
      `${demoSalesReport.documentsCleaned}`,
  );
  console.log(`Report: ${reportPath}`);
  printDivider();

  if (status !== "PASSED") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("");
  console.error("STEP 2 FAILED");
  console.error(error?.stack || error);
  process.exitCode = 1;
});
