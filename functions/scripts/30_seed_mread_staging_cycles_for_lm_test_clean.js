import fs from "fs";
import admin from "firebase-admin";

const CONFIRM_FLAG = "--confirm";
const CONFIRM_TOKEN = "SEED_CLEAN_MREAD_STAGING_CYCLES_FOR_LESEDI_TEST";

const SOURCE_PROJECT_ID = "ireps2";
const TARGET_PROJECT_ID = "ireps-test";
const COLLECTION_NAME = "mread_staging_cycles";

const DEFAULT_SOURCE_SERVICE_ACCOUNT =
  "C:\\dev\\secrets\\ireps2-e72fd9dc94de.json";
const DEFAULT_TARGET_SERVICE_ACCOUNT =
  "C:\\dev\\secrets\\ireps-test-firebase-adminsdk-fbsvc-d02929e1e3.json";

const DEFAULT_SOURCE_LM_PCODE = "ZA2157";
const DEFAULT_TARGET_LM_PCODE = "ZA7423";
const DEFAULT_TARGET_LM_NAME = "Lesedi";

const sourceServiceAccountPath =
  process.env.IREPS_SOURCE_SERVICE_ACCOUNT || DEFAULT_SOURCE_SERVICE_ACCOUNT;
const targetServiceAccountPath =
  process.env.IREPS_TARGET_SERVICE_ACCOUNT || DEFAULT_TARGET_SERVICE_ACCOUNT;

const args = process.argv.slice(2);
const writeMode =
  args.includes(CONFIRM_FLAG) && args.includes(CONFIRM_TOKEN);

function getArgValue(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] || fallback;
}

const sourceLmPcode = getArgValue("--source-lm-pcode", DEFAULT_SOURCE_LM_PCODE);
const targetLmPcode = getArgValue("--target-lm-pcode", DEFAULT_TARGET_LM_PCODE);
const targetLmName = getArgValue("--target-lm-name", DEFAULT_TARGET_LM_NAME);

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

function isFirestoreSpecialValue(value) {
  if (!value || typeof value !== "object") return false;

  const constructorName = value.constructor?.name;

  return (
    constructorName === "Timestamp" ||
    constructorName === "GeoPoint" ||
    constructorName === "DocumentReference" ||
    constructorName === "Bytes" ||
    typeof value.toMillis === "function" ||
    typeof value.isEqual === "function"
  );
}

function isPlainObject(value) {
  if (!value || typeof value !== "object") return false;
  if (isFirestoreSpecialValue(value)) return false;

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function replaceLmPcode(value) {
  if (typeof value !== "string") return value;
  return value.split(sourceLmPcode).join(targetLmPcode);
}

function isLmCodeKey(key) {
  const normalized = String(key || "").toLowerCase();

  return [
    "lmpcode",
    "lmcode",
    "localmunicipalitypcode",
    "localmunicipalitycode",
    "localmunicipalityid",
    "municipalitypcode",
    "municipalitycode",
  ].includes(normalized);
}

function isLmNameKey(key) {
  const normalized = String(key || "").toLowerCase();

  return [
    "lmname",
    "localmunicipalityname",
    "municipalityname",
  ].includes(normalized);
}

function isIterationCounterKey(key) {
  const normalized = String(key || "").toLowerCase();

  return (
    normalized === "iteration" ||
    normalized === "iterationno" ||
    normalized === "iterationnumber" ||
    normalized === "iterationcount" ||
    normalized === "currentiteration" ||
    normalized === "lastiteration" ||
    normalized === "latestiteration" ||
    normalized === "nextiteration" ||
    normalized === "generatediteration"
  );
}

function isRowCounterKey(key) {
  const normalized = String(key || "").toLowerCase();

  return (
    normalized === "rows" ||
    normalized === "rowcount" ||
    normalized === "totalrows" ||
    normalized === "stagingrows" ||
    normalized === "generatedrows" ||
    normalized === "successfulrows" ||
    normalized === "noaccessrows" ||
    normalized === "unsuccessfulrows" ||
    normalized === "failedrows" ||
    normalized === "errorrows" ||
    normalized.endsWith("rows") ||
    normalized.endsWith("rowcount")
  );
}

function isLastGeneratedKey(key) {
  const normalized = String(key || "").toLowerCase();

  return (
    normalized === "lastgenerated" ||
    normalized === "lastgeneratedat" ||
    normalized === "lastgeneratedon" ||
    normalized === "generatedat" ||
    normalized === "generatedon" ||
    normalized === "lastgeneratedby" ||
    normalized === "lastgeneratedbyuid" ||
    normalized === "lastgeneratedbyuser"
  );
}

function isStagingRunReferenceKey(key) {
  const normalized = String(key || "").toLowerCase();

  return (
    normalized === "laststagingid" ||
    normalized === "lateststagingid" ||
    normalized === "laststagingdocid" ||
    normalized === "lateststagingdocid" ||
    normalized === "lastgeneratedstagingid" ||
    normalized === "latestgeneratedstagingid" ||
    normalized === "stagingid" ||
    normalized === "stagingdocid"
  );
}

function resetValueForKey(value, key, path, report) {
  if (isIterationCounterKey(key) || isRowCounterKey(key)) {
    report.resetCounterPaths.push(path);
    return 0;
  }

  if (isLastGeneratedKey(key) || isStagingRunReferenceKey(key)) {
    report.resetGeneratedPaths.push(path);

    if (typeof value === "number") return 0;
    if (typeof value === "string") return "NAv";
    return null;
  }

  return undefined;
}

function transformAndResetValue(value, key = "", path = "", report) {
  const resetValue = resetValueForKey(value, key, path || key, report);
  if (resetValue !== undefined) return resetValue;

  if (typeof value === "string") {
    if (isLmCodeKey(key)) return targetLmPcode;
    if (isLmNameKey(key) && targetLmName) return targetLmName;
    return replaceLmPcode(value);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      transformAndResetValue(item, "", `${path}[${index}]`, report),
    );
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        transformAndResetValue(
          childValue,
          childKey,
          path ? `${path}.${childKey}` : childKey,
          report,
        ),
      ]),
    );
  }

  return value;
}

function buildTargetDocId(sourceDocId) {
  if (!sourceDocId.startsWith(`${sourceLmPcode}_`)) {
    throw new Error(
      `Source doc ID does not start with ${sourceLmPcode}_: ${sourceDocId}`,
    );
  }

  return sourceDocId.replace(`${sourceLmPcode}_`, `${targetLmPcode}_`);
}

function sortedIds(snapshot) {
  return snapshot.docs.map((docSnap) => docSnap.id).sort();
}

function difference(leftIds, rightIds) {
  const right = new Set(rightIds);
  return leftIds.filter((id) => !right.has(id));
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

    // Full overwrite is intentional for parent cycle controller docs.
    // This removes copied/generated runtime values and writes a clean LM seed.
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

async function countImmediateSubcollectionDocs(docRef) {
  const subcollections = await docRef.listCollections();
  const groups = [];
  let total = 0;

  for (const subcollection of subcollections) {
    const snap = await subcollection.get();
    total += snap.size;
    groups.push({
      parentPath: docRef.path,
      subcollection: subcollection.id,
      docs: snap.size,
    });
  }

  return { total, groups };
}

async function main() {
  printLine();
  console.log("Seed CLEAN MREAD staging cycles for target LM in TEST");
  printLine();
  console.log(`Mode: ${writeMode ? "WRITE" : "DRY RUN"}`);
  console.log(`Source project: ${SOURCE_PROJECT_ID}`);
  console.log(`Target project: ${TARGET_PROJECT_ID}`);
  console.log(`Collection: ${COLLECTION_NAME}`);
  console.log(`Template source LM: ${sourceLmPcode}`);
  console.log(`Target LM: ${targetLmPcode}`);
  console.log(`Target LM name: ${targetLmName || "NAv"}`);
  console.log(`Source service account path: ${sourceServiceAccountPath}`);
  console.log(`Target service account path: ${targetServiceAccountPath}`);
  printLine();

  if (sourceLmPcode === targetLmPcode) {
    throw new Error("Source LM pcode and target LM pcode cannot be the same.");
  }

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

  const sourceDb = initFirestore(
    "ireps2-source-lesedi-clean-cycle-seed",
    sourceServiceAccount,
  );
  const targetDb = initFirestore(
    "ireps-test-target-lesedi-clean-cycle-seed",
    targetServiceAccount,
  );

  const sourceCollectionRef = sourceDb.collection(COLLECTION_NAME);
  const targetCollectionRef = targetDb.collection(COLLECTION_NAME);

  const sourceAllSnap = await sourceCollectionRef.get();
  const sourceDocs = sourceAllSnap.docs
    .filter((docSnap) => docSnap.id.startsWith(`${sourceLmPcode}_`))
    .sort((a, b) => a.id.localeCompare(b.id));

  if (sourceDocs.length === 0) {
    throw new Error(
      `No source ${COLLECTION_NAME} docs found with prefix ${sourceLmPcode}_ in ${SOURCE_PROJECT_ID}.`,
    );
  }

  const targetBeforeSnap = await targetCollectionRef.get();
  const targetBeforeIds = sortedIds(targetBeforeSnap);

  const targetDocIds = sourceDocs.map((docSnap) => buildTargetDocId(docSnap.id));
  const existingTargetIds = targetDocIds.filter((id) =>
    targetBeforeIds.includes(id),
  );
  const missingTargetBeforeIds = difference(targetDocIds, targetBeforeIds);

  const writer = new SafeBatchWriter(targetDb, !writeMode);
  const writtenDocIds = [];
  const sourceDocIds = [];
  const skippedSubcollectionGroups = [];
  const perDocResetSummary = [];
  let skippedSubcollectionDocs = 0;
  let totalResetCounterFields = 0;
  let totalResetGeneratedFields = 0;

  for (const sourceDoc of sourceDocs) {
    const targetDocId = buildTargetDocId(sourceDoc.id);
    const targetDocRef = targetCollectionRef.doc(targetDocId);
    const sourceData = sourceDoc.data() || {};
    const resetReport = {
      resetCounterPaths: [],
      resetGeneratedPaths: [],
    };

    const targetData = transformAndResetValue(
      sourceData,
      "",
      "",
      resetReport,
    );

    writer.set(targetDocRef, targetData);
    await writer.flushIfNeeded();

    sourceDocIds.push(sourceDoc.id);
    writtenDocIds.push(targetDocId);

    totalResetCounterFields += resetReport.resetCounterPaths.length;
    totalResetGeneratedFields += resetReport.resetGeneratedPaths.length;

    perDocResetSummary.push({
      targetDocId,
      resetCounterFields: resetReport.resetCounterPaths,
      resetGeneratedFields: resetReport.resetGeneratedPaths,
    });

    const subcollectionCount = await countImmediateSubcollectionDocs(sourceDoc.ref);
    skippedSubcollectionDocs += subcollectionCount.total;
    skippedSubcollectionGroups.push(...subcollectionCount.groups);
  }

  await writer.flush();

  const targetAfterSnap = await targetCollectionRef.get();
  const targetAfterIds = sortedIds(targetAfterSnap);
  const missingTargetAfterIds = difference(targetDocIds, targetAfterIds);

  printLine();
  console.log("Clean seed summary:");
  console.log(
    JSON.stringify(
      {
        mode: writeMode ? "WRITE" : "DRY_RUN",
        collection: COLLECTION_NAME,
        sourceProject: SOURCE_PROJECT_ID,
        targetProject: TARGET_PROJECT_ID,
        sourceLmPcode,
        targetLmPcode,
        targetLmName,
        sourceTemplateDocsFound: sourceDocs.length,
        targetParentDocsBefore: targetBeforeSnap.size,
        targetParentDocsAfter: targetAfterSnap.size,
        targetDocsQueued: writtenDocIds.length,
        existingTargetDocsToOverwrite: existingTargetIds,
        missingTargetBeforeIds,
        missingTargetAfterIds,
        sourceDocIds,
        targetDocIds: writtenDocIds,
        resetPolicy: {
          iterationCounters: "0",
          rowCounters: "0",
          generatedMetadata: "NAv/null/0 depending on existing field type",
          subcollections: "skipped",
        },
        totalResetCounterFields,
        totalResetGeneratedFields,
        perDocResetSummary,
        skippedSubcollections: true,
        skippedSubcollectionDocs,
        skippedSubcollectionGroups,
        batchWritesQueued: writer.writeCount,
        batchCommits: writer.commits,
      },
      null,
      2,
    ),
  );

  printLine();
  console.log("Target cycle document IDs to exist after WRITE:");
  console.log(writtenDocIds.join("\n") || "NAv");
  printLine();

  if (!writeMode) {
    console.log("DRY RUN PASSED — no Firestore write performed.");
    console.log("This script seeds ONLY mread_staging_cycles parent docs.");
    console.log("It rewrites the LM pcode from template source to target LM.");
    console.log("It resets copied iteration counters and row counters to 0.");
    console.log("It resets copied generated/staging run metadata to empty values.");
    console.log("It does NOT copy generated mread_staging sessions.");
    console.log("It does NOT copy iterations subcollections for the new LM.");
    console.log("It does NOT delete extra TEST docs.");
    console.log(
      `To write, run: node .\\scripts\\30_seed_mread_staging_cycles_for_lm_test_clean.js --confirm ${CONFIRM_TOKEN}`,
    );
    return;
  }

  if (missingTargetAfterIds.length > 0) {
    throw new Error(
      `WRITE completed but target is still missing docs: ${missingTargetAfterIds.join(", ")}`,
    );
  }

  console.log("WRITE PASSED — clean target LM mread_staging_cycles seeded in ireps-test.");
  console.log("Note: matching TEST docs were overwritten from the transformed clean template.");
  console.log("Note: iteration/row counters were reset to 0.");
  console.log("Note: iterations subcollections were intentionally not copied.");
}

main().catch((error) => {
  printLine();
  console.error("FAILED:", error);
  process.exitCode = 1;
});
