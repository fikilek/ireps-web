import fs from "fs";
import admin from "firebase-admin";

const CONFIRM_FLAG = "--confirm";
const CONFIRM_TOKEN = "COPY_MREAD_STAGING_CYCLES_TO_TEST";

const SOURCE_PROJECT_ID = "ireps2";
const TARGET_PROJECT_ID = "ireps-test";
const COLLECTION_NAME = "mread_staging_cycles";

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

function normalizePathForLog(ref) {
  return ref.path.replace(/\\/g, "/");
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
    this.writeCount += 1;

    if (this.dryRun) return;

    if (!this.batch) {
      this.batch = this.db.batch();
      this.pending = 0;
    }

    // Full controlled config copy: target document becomes the source shape.
    this.batch.set(ref, data);
    this.pending += 1;
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

  writer.set(targetDocRef, sourceSnap.data());
  await writer.flushIfNeeded();

  stats.docsQueued += 1;
  stats.maxDepth = Math.max(stats.maxDepth, depth);
  stats.pathsQueued.push(normalizePathForLog(sourceDocRef));

  if (depth === 0) {
    stats.parentDocsQueued += 1;
    stats.parentDocIds.push(sourceDocRef.id);
  } else {
    stats.subcollectionDocsQueued += 1;
  }

  const subcollections = await sourceDocRef.listCollections();

  if (subcollections.length > 0) {
    stats.docsWithSubcollections += 1;
  }

  for (const subcollection of subcollections) {
    stats.subcollectionNames.add(subcollection.id);

    const childSnap = await subcollection.get();
    stats.subcollectionGroups.push({
      parentPath: normalizePathForLog(sourceDocRef),
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

function sortedIds(snapshot) {
  return snapshot.docs.map((docSnap) => docSnap.id).sort();
}

function difference(leftIds, rightIds) {
  const right = new Set(rightIds);
  return leftIds.filter((id) => !right.has(id));
}

async function main() {
  printLine();
  console.log("Copy MREAD staging cycle controller config from DEV to TEST");
  printLine();
  console.log(`Mode: ${writeMode ? "WRITE" : "DRY RUN"}`);
  console.log(`Source project: ${SOURCE_PROJECT_ID}`);
  console.log(`Target project: ${TARGET_PROJECT_ID}`);
  console.log(`Collection: ${COLLECTION_NAME}`);
  console.log(`Source service account path: ${sourceServiceAccountPath}`);
  console.log(`Target service account path: ${targetServiceAccountPath}`);
  printLine();

  const sourceServiceAccount = readJson(sourceServiceAccountPath, "Source");
  const targetServiceAccount = readJson(targetServiceAccountPath, "Target");

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
  const targetCollectionRef = targetDb.collection(COLLECTION_NAME);

  const sourceSnap = await sourceCollectionRef.get();
  const targetBeforeSnap = await targetCollectionRef.get();

  const sourceIds = sortedIds(sourceSnap);
  const targetBeforeIds = sortedIds(targetBeforeSnap);

  const stats = {
    parentDocsQueued: 0,
    subcollectionDocsQueued: 0,
    docsQueued: 0,
    docsWithSubcollections: 0,
    missingSourceDocs: 0,
    missingPaths: [],
    parentDocIds: [],
    pathsQueued: [],
    subcollectionNames: new Set(),
    subcollectionGroups: [],
    maxDepth: 0,
  };

  const writer = new SafeBatchWriter(targetDb, !writeMode);

  for (const sourceDoc of sourceSnap.docs) {
    const targetDocRef = targetCollectionRef.doc(sourceDoc.id);

    await copyDocumentTree({
      sourceDocRef: sourceDoc.ref,
      targetDocRef,
      writer,
      stats,
      depth: 0,
    });
  }

  await writer.flush();

  const targetAfterSnap = await targetCollectionRef.get();
  const targetAfterIds = sortedIds(targetAfterSnap);

  const missingInTargetBefore = difference(sourceIds, targetBeforeIds);
  const extraInTargetBefore = difference(targetBeforeIds, sourceIds);
  const missingInTargetAfter = difference(sourceIds, targetAfterIds);
  const extraInTargetAfter = difference(targetAfterIds, sourceIds);

  printLine();
  console.log("Copy summary:");
  console.log(
    JSON.stringify(
      {
        mode: writeMode ? "WRITE" : "DRY_RUN",
        collection: COLLECTION_NAME,
        sourceProject: SOURCE_PROJECT_ID,
        targetProject: TARGET_PROJECT_ID,
        sourceParentDocsFound: sourceSnap.size,
        targetParentDocsBefore: targetBeforeSnap.size,
        targetParentDocsAfter: targetAfterSnap.size,
        parentDocsQueued: stats.parentDocsQueued,
        subcollectionDocsQueued: stats.subcollectionDocsQueued,
        totalDocsQueued: stats.docsQueued,
        docsWithSubcollections: stats.docsWithSubcollections,
        subcollectionNames: Array.from(stats.subcollectionNames).sort(),
        subcollectionGroups: stats.subcollectionGroups,
        maxDepth: stats.maxDepth,
        missingSourceDocs: stats.missingSourceDocs,
        missingTargetBeforeIds: missingInTargetBefore,
        extraTargetBeforeIds: extraInTargetBefore,
        missingTargetAfterIds: missingInTargetAfter,
        extraTargetAfterIds: extraInTargetAfter,
        batchWritesQueued: writer.writeCount,
        batchCommits: writer.commits,
      },
      null,
      2,
    ),
  );

  printLine();
  console.log("Source mread_staging_cycles document IDs:");
  console.log(sourceIds.join("\n") || "NAv");
  printLine();

  if (!writeMode) {
    console.log("DRY RUN PASSED — no Firestore write performed.");
    console.log("This script copies ONLY mread_staging_cycles.");
    console.log("It does NOT copy generated mread_staging sessions.");
    console.log("It does NOT delete extra TEST docs.");
    console.log(
      `To write, run: node .\\scripts\\28_copy_mread_staging_cycles_to_test.js --confirm ${CONFIRM_TOKEN}`,
    );
    return;
  }

  if (missingInTargetAfter.length > 0) {
    throw new Error(
      `WRITE completed but target is still missing source docs: ${missingInTargetAfter.join(", ")}`,
    );
  }

  console.log("WRITE PASSED — mread_staging_cycles copied to ireps-test.");
  console.log("Note: matching TEST docs were overwritten from DEV.");
  console.log("Note: extra TEST docs, if any, were not deleted.");
}

main().catch((error) => {
  printLine();
  console.error("FAILED:", error);
  process.exitCode = 1;
});
