import fs from "fs";
import path from "path";
import admin from "firebase-admin";

const CONFIRM_FLAG = "--confirm";
const CONFIRM_TOKEN = "COPY_IREPS_SELECT_LOOKUPS_RECURSIVE_TO_TEST";

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
const writeMode =
  args.includes(CONFIRM_FLAG) && args.includes(CONFIRM_TOKEN);

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

class SafeBatchWriter {
  constructor(db, dryRun) {
    this.db = db;
    this.dryRun = dryRun;
    this.batch = null;
    this.pending = 0;
    this.commits = 0;
    this.writeCount = 0;
  }

  set(ref, data) {
    if (this.dryRun) {
      this.writeCount += 1;
      return;
    }

    if (!this.batch) {
      this.batch = this.db.batch();
      this.pending = 0;
    }

    this.batch.set(ref, data);
    this.pending += 1;
    this.writeCount += 1;
  }

  async flushIfNeeded() {
    if (this.dryRun) return;
    if (this.pending < 450) return;
    await this.flush();
  }

  async flush() {
    if (this.dryRun) return;
    if (!this.batch || this.pending === 0) return;

    await this.batch.commit();
    this.commits += 1;
    this.batch = null;
    this.pending = 0;
  }
}

function normalizePathForLog(docRef) {
  return docRef.path.replace(/\\/g, "/");
}

async function copyDocumentTree({
  sourceDocRef,
  targetDocRef,
  writer,
  stats,
  depth = 0,
}) {
  const sourceSnap = await sourceDocRef.get();

  if (!sourceSnap.exists) {
    stats.missingSourceDocs += 1;
    stats.missingPaths.push(normalizePathForLog(sourceDocRef));
    return;
  }

  const data = sourceSnap.data();

  writer.set(targetDocRef, data);
  await writer.flushIfNeeded();

  stats.docsQueued += 1;
  stats.maxDepth = Math.max(stats.maxDepth, depth);

  const pathForLog = normalizePathForLog(sourceDocRef);
  if (depth === 0) {
    stats.parentDocs += 1;
    stats.parentDocIds.push(sourceDocRef.id);
  } else {
    stats.subcollectionDocs += 1;
  }

  stats.paths.push(pathForLog);

  const subcollections = await sourceDocRef.listCollections();
  if (subcollections.length > 0) {
    stats.docsWithSubcollections += 1;
  }

  for (const subcollection of subcollections) {
    stats.subcollectionNames.add(subcollection.id);

    const childSnap = await subcollection.get();
    stats.subcollectionDocGroups.push({
      parentPath: pathForLog,
      subcollection: subcollection.id,
      docs: childSnap.size,
    });

    for (const childDoc of childSnap.docs) {
      const targetChildRef = targetDocRef
        .collection(subcollection.id)
        .doc(childDoc.id);

      await copyDocumentTree({
        sourceDocRef: childDoc.ref,
        targetDocRef: targetChildRef,
        writer,
        stats,
        depth: depth + 1,
      });
    }
  }
}

async function main() {
  printLine();
  console.log("Copy irepsSelectLookups from DEV to TEST, including subcollections");
  printLine();
  console.log(`Mode: ${writeMode ? "WRITE" : "DRY RUN"}`);
  console.log(`Source project: ${SOURCE_PROJECT_ID}`);
  console.log(`Target project: ${TARGET_PROJECT_ID}`);
  console.log(`Collection: ${COLLECTION_NAME}`);
  console.log(`Source service account path: ${sourceServiceAccountPath}`);
  console.log(`Target service account path: ${targetServiceAccountPath}`);
  printLine();

  const sourceServiceAccount = readJson(
    sourceServiceAccountPath,
    "Source",
  );
  const targetServiceAccount = readJson(
    targetServiceAccountPath,
    "Target",
  );

  assertServiceAccountProject(
    sourceServiceAccount,
    SOURCE_PROJECT_ID,
    "Source",
  );
  assertServiceAccountProject(
    targetServiceAccount,
    TARGET_PROJECT_ID,
    "Target",
  );

  const sourceDb = initFirestore("ireps2-source", sourceServiceAccount);
  const targetDb = initFirestore("ireps-test-target", targetServiceAccount);

  const sourceCollectionRef = sourceDb.collection(COLLECTION_NAME);
  const sourceSnap = await sourceCollectionRef.get();

  const stats = {
    parentDocs: 0,
    subcollectionDocs: 0,
    docsQueued: 0,
    docsWithSubcollections: 0,
    missingSourceDocs: 0,
    missingPaths: [],
    parentDocIds: [],
    paths: [],
    subcollectionNames: new Set(),
    subcollectionDocGroups: [],
    maxDepth: 0,
  };

  const writer = new SafeBatchWriter(targetDb, !writeMode);

  for (const docSnap of sourceSnap.docs) {
    const targetDocRef = targetDb.collection(COLLECTION_NAME).doc(docSnap.id);

    await copyDocumentTree({
      sourceDocRef: docSnap.ref,
      targetDocRef,
      writer,
      stats,
      depth: 0,
    });
  }

  await writer.flush();

  printLine();
  console.log("Copy plan summary:");
  console.log(
    JSON.stringify(
      {
        mode: writeMode ? "WRITE" : "DRY_RUN",
        sourceParentDocsFound: sourceSnap.size,
        parentDocsQueued: stats.parentDocs,
        subcollectionDocsQueued: stats.subcollectionDocs,
        totalDocsQueued: stats.docsQueued,
        docsWithSubcollections: stats.docsWithSubcollections,
        subcollectionNames: Array.from(stats.subcollectionNames).sort(),
        subcollectionGroups: stats.subcollectionDocGroups,
        maxDepth: stats.maxDepth,
        missingSourceDocs: stats.missingSourceDocs,
        batchWritesQueued: writer.writeCount,
        batchCommits: writer.commits,
      },
      null,
      2,
    ),
  );

  printLine();
  console.log("Parent lookup IDs:");
  console.log(stats.parentDocIds.sort().join("\n"));

  printLine();

  if (!writeMode) {
    console.log("DRY RUN PASSED — no Firestore write performed.");
    console.log(
      `To write, run: node .\\scripts\\copy_ireps_select_lookups_recursive_to_test.js --confirm ${CONFIRM_TOKEN}`,
    );
    return;
  }

  console.log("WRITE PASSED — Firestore documents copied to ireps-test.");
  console.log(
    "Note: this script creates/overwrites matching docs and subcollection docs; it does not delete extra target docs.",
  );
}

main().catch((error) => {
  printLine();
  console.error("FAILED:", error);
  process.exitCode = 1;
});
