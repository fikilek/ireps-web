import admin from "firebase-admin";
import fs from "fs";
import path from "path";

const EXPECTED_PROJECT_ID = "ireps-5c3e9";
const CONFIRM_TEXT = "BOOTSTRAP_LIVE_SPU_ONLY";
const SPU_UID = "fXBACUfMzybcqC0AbeNeyYyTeRu1";
const SPU_EMAIL = "spu@smars.co.za";
const SPU_DOC_PATH = `users/${SPU_UID}`;

function parseArgs(argv) {
  const args = {
    dryRun: true,
    write: false,
    projectId: "",
    confirm: "",
    usersExport: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--dryRun") {
      args.dryRun = true;
      args.write = false;
      continue;
    }

    if (arg === "--write") {
      args.write = true;
      args.dryRun = false;
      continue;
    }

    if (arg === "--projectId") {
      args.projectId = argv[i + 1] || "";
      i += 1;
      continue;
    }

    if (arg === "--confirm") {
      args.confirm = argv[i + 1] || "";
      i += 1;
      continue;
    }

    if (arg === "--usersExport") {
      args.usersExport = path.resolve(argv[i + 1] || "");
      i += 1;
      continue;
    }
  }

  return args;
}

function fail(message) {
  throw new Error(message);
}

function readJsonFile(filePath, label) {
  if (!filePath) {
    fail(`${label} path is required.`);
  }

  if (!fs.existsSync(filePath)) {
    fail(`${label} file not found: ${filePath}`);
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getExactSpuFirestoreDoc(usersExport) {
  const rawDoc = usersExport?.[SPU_DOC_PATH];

  if (!rawDoc || typeof rawDoc !== "object" || Array.isArray(rawDoc)) {
    fail(`SPU Firestore document not found at ${SPU_DOC_PATH}.`);
  }

  const doc = {};

  for (const [key, value] of Object.entries(rawDoc)) {
    if (key.startsWith("__")) continue;
    doc[key] = value;
  }

  return doc;
}

function validateSpuData(firestoreDoc) {
  if (firestoreDoc.uid !== SPU_UID) {
    fail(`Firestore SPU uid mismatch. Expected ${SPU_UID}, got ${firestoreDoc.uid}`);
  }

  if (firestoreDoc?.profile?.email !== SPU_EMAIL) {
    fail(
      `Firestore SPU email mismatch. Expected ${SPU_EMAIL}, got ${firestoreDoc?.profile?.email}`,
    );
  }

  if (firestoreDoc?.employment?.role !== "SPU") {
    fail(`Firestore SPU role mismatch. Expected SPU, got ${firestoreDoc?.employment?.role}`);
  }

  if (firestoreDoc?.employment?.serviceProvider?.id !== "smarsId") {
    fail(
      `SPU serviceProvider.id mismatch. Expected smarsId, got ${firestoreDoc?.employment?.serviceProvider?.id}`,
    );
  }

  if (firestoreDoc?.employment?.serviceProvider?.name !== "Smars") {
    fail(
      `SPU serviceProvider.name mismatch. Expected Smars, got ${firestoreDoc?.employment?.serviceProvider?.name}`,
    );
  }

  if (firestoreDoc?.accountStatus !== "ACTIVE") {
    fail(`SPU accountStatus mismatch. Expected ACTIVE, got ${firestoreDoc?.accountStatus}`);
  }

  if (firestoreDoc?.onboarding?.status !== "COMPLETED") {
    fail(
      `SPU onboarding.status mismatch. Expected COMPLETED, got ${firestoreDoc?.onboarding?.status}`,
    );
  }

  if (!Array.isArray(firestoreDoc?.access?.workbases) || firestoreDoc.access.workbases.length === 0) {
    fail("SPU access.workbases must be a non-empty array.");
  }

  if (
    !firestoreDoc?.access?.activeWorkbase?.id ||
    !firestoreDoc?.access?.activeWorkbase?.name
  ) {
    fail("SPU access.activeWorkbase must contain id and name.");
  }
}

function initialiseFirebase(projectId) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId,
  });

  const actualProjectId = admin.app().options.projectId;

  if (actualProjectId !== EXPECTED_PROJECT_ID) {
    fail(`Firebase Admin project mismatch. Expected ${EXPECTED_PROJECT_ID}, got ${actualProjectId}`);
  }

  return {
    auth: admin.auth(),
    db: admin.firestore(),
  };
}

async function assertLiveSpuAbsent({ auth, db }) {
  try {
    const existing = await auth.getUser(SPU_UID);
    fail(`Refusing to continue. LIVE Auth SPU already exists: ${existing.uid}`);
  } catch (error) {
    if (error?.code !== "auth/user-not-found") {
      throw error;
    }
  }

  const doc = await db.doc(SPU_DOC_PATH).get();

  if (doc.exists) {
    fail(`Refusing to continue. LIVE Firestore SPU already exists at ${SPU_DOC_PATH}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log("============================================================");
  console.log("iREPS LIVE SPU Bootstrap");
  console.log("============================================================");

  if (args.projectId !== EXPECTED_PROJECT_ID) {
    fail(`Refusing to run. --projectId must be ${EXPECTED_PROJECT_ID}.`);
  }

  if (args.write && args.confirm !== CONFIRM_TEXT) {
    fail(`Write mode requires --confirm ${CONFIRM_TEXT}`);
  }

  const usersExport = readJsonFile(args.usersExport, "Firestore users export");
  const firestoreDoc = getExactSpuFirestoreDoc(usersExport);
  validateSpuData(firestoreDoc);

  const { auth, db } = initialiseFirebase(args.projectId);
  await assertLiveSpuAbsent({ auth, db });

  console.log(`Mode: ${args.dryRun ? "DRY RUN" : "WRITE"}`);
  console.log(`Project: ${args.projectId}`);
  console.log(`Firestore users export: ${args.usersExport}`);
  console.log("");
  console.log("SPU checks passed:");
  console.log(`- UID: ${SPU_UID}`);
  console.log(`- Email: ${SPU_EMAIL}`);
  console.log(`- Firestore path: ${SPU_DOC_PATH}`);
  console.log(`- Role: ${firestoreDoc.employment.role}`);
  console.log(`- Service Provider: ${firestoreDoc.employment.serviceProvider.name}`);
  console.log(`- Account Status: ${firestoreDoc.accountStatus}`);
  console.log(`- Onboarding: ${firestoreDoc.onboarding.status}`);
  console.log(`- Active Workbase: ${firestoreDoc.access.activeWorkbase.name}`);
  console.log(`- Workbase count: ${firestoreDoc.access.workbases.length}`);
  console.log('- Custom Claims: {"role":"SPU"}');
  console.log("- LIVE Auth preflight: ABSENT");
  console.log("- LIVE Firestore preflight: ABSENT");

  if (args.dryRun) {
    console.log("");
    console.log("Result: PASS");
    console.log("DRY RUN ONLY - no Auth or Firestore writes performed.");
    return;
  }

  const password = process.env.IREPS_LIVE_SPU_PASSWORD || "";

  if (!password) {
    fail("IREPS_LIVE_SPU_PASSWORD is required in write mode.");
  }

  await auth.createUser({
    uid: SPU_UID,
    email: SPU_EMAIL,
    displayName: firestoreDoc?.profile?.displayName || "SPU",
    password,
    disabled: false,
  });

  await auth.setCustomUserClaims(SPU_UID, { role: "SPU" });
  await db.doc(SPU_DOC_PATH).set(firestoreDoc, { merge: false });

  const writtenUser = await auth.getUser(SPU_UID);
  const writtenDoc = await db.doc(SPU_DOC_PATH).get();

  if (!writtenDoc.exists) {
    fail(`Verification failed. Firestore document not found at ${SPU_DOC_PATH}.`);
  }

  const writtenData = writtenDoc.data();

  if (writtenUser.email !== SPU_EMAIL) {
    fail(`Verification failed. Auth email mismatch: ${writtenUser.email}`);
  }

  if (writtenUser.customClaims?.role !== "SPU") {
    fail(
      `Verification failed. Auth custom claim mismatch: ${JSON.stringify(
        writtenUser.customClaims || {},
      )}`,
    );
  }

  if (writtenData?.uid !== SPU_UID || writtenData?.employment?.role !== "SPU") {
    fail("Verification failed. Firestore SPU document shape is incorrect.");
  }

  console.log("");
  console.log("Result: PASS");
  console.log("Auth user: CREATED");
  console.log(`Auth UID: ${writtenUser.uid}`);
  console.log(`Auth email: ${writtenUser.email}`);
  console.log(`Custom claims: ${JSON.stringify(writtenUser.customClaims || {})}`);
  console.log(`Firestore document: WRITTEN ${SPU_DOC_PATH}`);
  console.log("Only the LIVE SPU was bootstrapped.");
}

main().catch((error) => {
  console.error("");
  console.error("Result: FAIL");
  console.error(error?.message || error);
  process.exit(1);
});
