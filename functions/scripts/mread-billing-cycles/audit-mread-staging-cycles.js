// functions/scripts/mread-billing-cycles/audit-mread-staging-cycles.js
//
// Read-only audit for MREAD staging cycle setup.
//
// Usage:
//   node scripts/mread-billing-cycles/audit-mread-staging-cycles.js --project ireps2
//   node scripts/mread-billing-cycles/audit-mread-staging-cycles.js --project ireps-test
//
// This script makes no writes.

import { existsSync, readFileSync } from "node:fs";
import admin from "firebase-admin";

const COLLECTION_LMS = "lms";
const COLLECTION_CYCLES = "mread_staging_cycles";
const EXPECTED_PERIODS = ["2025/26", "2026/27"];
const EXPECTED_CYCLES_PER_PERIOD = 12;
const EXPECTED_CYCLES_PER_LM = EXPECTED_PERIODS.length * EXPECTED_CYCLES_PER_PERIOD;
const EXPECTED_ID_PATTERN = /^[A-Z0-9]+_\d{4}_\d{4}_CYCLE_[0-9]{2}$/;
const PROJECT_CREDENTIAL_FILES = Object.freeze({
  ireps2: "C:\\dev\\secrets\\ireps2-e72fd9dc94de.json",
  "ireps-test": "C:\\dev\\secrets\\ireps-test-firebase-adminsdk-fbsvc-d02929e1e3.json",
});


function parseArgs(argv) {
  const args = {};

  for (let index = 2; index < argv.length; index += 1) {
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

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function resolveCredentialFile(projectId, args = {}) {
  const explicitCredentialFile = normalizeText(args.credentials || args.credentialFile || args.keyFile);
  const defaultCredentialFile = PROJECT_CREDENTIAL_FILES[projectId];
  const credentialFile = explicitCredentialFile || defaultCredentialFile;

  if (!credentialFile) {
    throw new Error(
      `No credential file is configured for project "${projectId}". `
        + "Pass --credentials C:\\dev\\secrets\\your-service-account.json",
    );
  }

  if (!existsSync(credentialFile)) {
    throw new Error(
      `Credential file was not found: ${credentialFile}. `
        + "Check C:\\dev\\secrets or pass --credentials with the correct path.",
    );
  }

  return credentialFile;
}

function loadServiceAccount(projectId, credentialFile) {
  const serviceAccount = JSON.parse(readFileSync(credentialFile, "utf8"));
  const serviceAccountProjectId = normalizeText(serviceAccount.project_id);

  if (serviceAccountProjectId && serviceAccountProjectId !== projectId) {
    throw new Error(
      `Credential project mismatch. --project is "${projectId}" but key file belongs to "${serviceAccountProjectId}".`,
    );
  }

  return serviceAccount;
}

function initializeFirebase(projectId, args = {}) {
  if (!projectId) {
    throw new Error('Missing required --project value. Example: --project ireps2');
  }

  const credentialFile = resolveCredentialFile(projectId, args);
  const serviceAccount = loadServiceAccount(projectId, credentialFile);

  if (!admin.apps.length) {
    admin.initializeApp({
      projectId,
      credential: admin.credential.cert(serviceAccount),
    });
  }

  return {
    db: admin.firestore(),
    credentialFile,
  };
}

function getLmName(doc) {
  const data = doc.data() || {};
  return normalizeText(data.name) || normalizeText(data.lmName) || doc.id;
}

function getCycleLmPcode(data, fallbackDocId = "") {
  const direct = normalizeText(data?.lmPcode);
  if (direct) return direct;

  const cycleId = normalizeText(data?.cycleId) || normalizeText(fallbackDocId);
  const [fromId] = cycleId.split("_");
  return normalizeText(fromId);
}

function getStatusForCount(count) {
  if (count >= EXPECTED_CYCLES_PER_LM) return "OK";
  if (count <= 0) return "MISSING";
  return "INCOMPLETE";
}

async function loadLms(db) {
  const snap = await db.collection(COLLECTION_LMS).get();

  return snap.docs
    .map((doc) => ({
      id: doc.id,
      name: getLmName(doc),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function loadCycleCounts(db) {
  const snap = await db.collection(COLLECTION_CYCLES).get();
  const counts = new Map();

  for (const doc of snap.docs) {
    const lmPcode = getCycleLmPcode(doc.data() || {}, doc.id);
    if (!lmPcode) continue;
    counts.set(lmPcode, (counts.get(lmPcode) || 0) + 1);
  }

  return counts;
}

async function loadCycleDocs(db) {
  const snap = await db.collection(COLLECTION_CYCLES).get();
  return snap.docs;
}

function auditCycleDoc(doc) {
  const data = doc.data() || {};
  const issues = [];

  if (Object.prototype.hasOwnProperty.call(data, "status")) issues.push("ROOT_STATUS");
  if (Object.prototype.hasOwnProperty.call(data, "closed")) issues.push("ROOT_CLOSED");
  if (Object.prototype.hasOwnProperty.call(data, "closedAt")) issues.push("ROOT_CLOSED_AT");
  if (Object.prototype.hasOwnProperty.call(data, "closedByUser")) issues.push("ROOT_CLOSED_BY_USER");

  const cycleId = normalizeText(data.cycleId || doc.id);
  if (!EXPECTED_ID_PATTERN.test(cycleId)) issues.push("INVALID_ID");

  const billingPeriod = normalizeText(data.billingPeriod);
  if (!EXPECTED_PERIODS.includes(billingPeriod)) issues.push("INVALID_BILLING_PERIOD");

  const cycleNo = Number(data.cycleNo);
  if (!Number.isInteger(cycleNo) || cycleNo < 1 || cycleNo > EXPECTED_CYCLES_PER_PERIOD) issues.push("INVALID_CYCLE_NO");

  if (!data.window || !normalizeText(data.window.startDate) || !normalizeText(data.window.endDate)) {
    issues.push("MISSING_WINDOW");
  }

  return {
    docId: doc.id,
    cycleId,
    lmPcode: getCycleLmPcode(data, doc.id),
    issues,
  };
}

function summarizeCycleIssues(cycleDocs) {
  const results = [];

  for (const doc of cycleDocs) {
    const audit = auditCycleDoc(doc);
    if (audit.issues.length) results.push(audit);
  }

  return results;
}

function printAudit({ projectId, credentialFile, lms, cycleCounts, cycleShapeIssues }) {
  let missingCount = 0;
  let incompleteCount = 0;

  console.log("");
  console.log("MREAD staging cycles audit");
  console.log("──────────────────────────");
  console.log(`Project: ${projectId}`);
  console.log(`Credential file: ${credentialFile}`);
  console.log(`Collection: ${COLLECTION_CYCLES}`);
  console.log(`Expected per LM: ${EXPECTED_CYCLES_PER_LM} docs (${EXPECTED_PERIODS.join(", ")})`);
  console.log("");

  if (!lms.length) {
    console.log("No LM documents found in lms.");
    return { status: "FAILED", missingCount: 0, incompleteCount: 0, shapeStatus: "OK" };
  }

  console.log("LMs found:");

  for (const lm of lms) {
    const count = cycleCounts.get(lm.id) || 0;
    const status = getStatusForCount(count);

    if (status === "MISSING") missingCount += 1;
    if (status === "INCOMPLETE") incompleteCount += 1;

    const lmLabel = `${lm.id} / ${lm.name}`.padEnd(34, " ");
    const countLabel = `cycles: ${String(count).padStart(2, " ")}`.padEnd(13, " ");
    console.log(`- ${lmLabel}${countLabel}${status}`);
  }

  const knownLmIds = new Set(lms.map((lm) => lm.id));
  const orphanLmIds = Array.from(cycleCounts.keys())
    .filter((lmPcode) => !knownLmIds.has(lmPcode))
    .sort();

  if (orphanLmIds.length) {
    console.log("");
    console.log("Cycle groups without matching lms document:");
    for (const lmPcode of orphanLmIds) {
      console.log(`- ${lmPcode} cycles: ${cycleCounts.get(lmPcode)}`);
    }
  }

  console.log("");

  const shapeStatus = cycleShapeIssues.length ? "LEGACY_FIELDS_FOUND" : "OK";

  if (missingCount || incompleteCount) {
    console.log("Status: FAILED");
    if (missingCount) console.log(`Missing cycle setup for ${missingCount} LM(s).`);
    if (incompleteCount) console.log(`Incomplete cycle setup for ${incompleteCount} LM(s).`);
    console.log(`Clean shape: ${shapeStatus}`);
    if (cycleShapeIssues.length) {
      console.log(`Legacy / invalid cycle shape issues found: ${cycleShapeIssues.length}`);
    }
    return { status: "FAILED", missingCount, incompleteCount, shapeStatus };
  }

  console.log("Status: PASSED");
  console.log("Every LM has the expected MREAD staging cycle setup.");
  console.log(`Clean shape: ${shapeStatus}`);
  if (cycleShapeIssues.length) {
    console.log(`Legacy / invalid cycle shape issues found: ${cycleShapeIssues.length}`);
  }
  return { status: "PASSED", missingCount, incompleteCount, shapeStatus };
}

async function main() {
  const args = parseArgs(process.argv);
  const projectId = normalizeText(args.project);
  const { db, credentialFile } = initializeFirebase(projectId, args);

  console.log(`[iREPS] Connected to Firebase project: ${projectId}`);
  console.log(`[iREPS] Credential file: ${credentialFile}`);
  console.log("[iREPS] This audit is read-only. No Firestore writes will be made.");

  const [lms, cycleCounts, cycleDocs] = await Promise.all([
    loadLms(db),
    loadCycleCounts(db),
    loadCycleDocs(db),
  ]);
  const cycleShapeIssues = summarizeCycleIssues(cycleDocs);
  const result = printAudit({ projectId, credentialFile, lms, cycleCounts, cycleShapeIssues });

  if (result.status !== "PASSED") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("");
  console.error("MREAD staging cycles audit failed:");
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
