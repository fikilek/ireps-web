import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_FILE);

const EXPECTED_PROJECT_ID = "ireps-test";
const CONFIRM_TEXT = "BOOTSTRAP_TEST_SPU_ONLY";
const SPU_UID = "fXBACUfMzybcqC0AbeNeyYyTeRu1";
const SPU_DOC_PATH = `users/${SPU_UID}`;

const DEFAULT_USERS_EXPORT_PATH = path.join(
  SCRIPT_DIR,
  "ireps2-users-20260621-2233.json",
);
const DEFAULT_AUTH_EXPORT_PATH = path.join(
  SCRIPT_DIR,
  "ireps2-auth-users-export.json",
);

function parseArgs(argv) {
  const args = {
    dryRun: true,
    write: false,
    projectId: "",
    confirm: "",
    usersExport: DEFAULT_USERS_EXPORT_PATH,
    authExport: DEFAULT_AUTH_EXPORT_PATH,
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

    if (arg === "--authExport") {
      args.authExport = path.resolve(argv[i + 1] || "");
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

  const text = fs.readFileSync(filePath, "utf8");
  return JSON.parse(text);
}

function getAuthUsers(authExport) {
  if (Array.isArray(authExport)) {
    return authExport;
  }

  if (Array.isArray(authExport.users)) {
    return authExport.users;
  }

  fail("Auth export format not recognised. Expected an array or an object with users[].");
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

function getExactSpuAuthRecord(authExport) {
  const users = getAuthUsers(authExport);
  const authRecord = users.find((user) => user?.localId === SPU_UID);

  if (!authRecord) {
    fail(`SPU Auth export record not found for UID ${SPU_UID}.`);
  }

  return authRecord;
}

function parseClaims(authRecord) {
  const rawClaims = authRecord.customAttributes || "{}";
  const claims = JSON.parse(rawClaims);
  const keys = Object.keys(claims).sort();

  if (keys.length !== 1 || keys[0] !== "role" || claims.role !== "SPU") {
    fail(
      `Unexpected SPU custom claims. Expected exactly { role: "SPU" }, got ${JSON.stringify(
        claims,
      )}`,
    );
  }

  return claims;
}

function validateSpuData({ firestoreDoc, authRecord, claims }) {
  if (firestoreDoc.uid !== SPU_UID) {
    fail(`Firestore SPU uid mismatch. Expected ${SPU_UID}, got ${firestoreDoc.uid}`);
  }

  if (authRecord.localId !== SPU_UID) {
    fail(`Auth SPU uid mismatch. Expected ${SPU_UID}, got ${authRecord.localId}`);
  }

  if (firestoreDoc?.profile?.email !== "spu@smars.co.za") {
    fail(
      `Firestore SPU email mismatch. Expected spu@smars.co.za, got ${firestoreDoc?.profile?.email}`,
    );
  }

  if (authRecord.email !== "spu@smars.co.za") {
    fail(`Auth SPU email mismatch. Expected spu@smars.co.za, got ${authRecord.email}`);
  }

  if (firestoreDoc?.employment?.role !== "SPU") {
    fail(`Firestore SPU role mismatch. Expected SPU, got ${firestoreDoc?.employment?.role}`);
  }

  if (claims.role !== "SPU") {
    fail(`Auth claim role mismatch. Expected SPU, got ${claims.role}`);
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

async function createOrUpdateAuthUser({ auth, authRecord, password }) {
  const updatePayload = {
    email: authRecord.email,
    emailVerified: authRecord.emailVerified === true,
    disabled: authRecord.disabled === true,
  };

  if (typeof authRecord.displayName === "string" && authRecord.displayName.trim()) {
    updatePayload.displayName = authRecord.displayName.trim();
  }

  if (password) {
    updatePayload.password = password;
  }

  try {
    const existing = await auth.getUser(SPU_UID);
    await auth.updateUser(SPU_UID, updatePayload);

    return {
      action: "UPDATED",
      previousEmail: existing.email || "NAv",
    };
  } catch (error) {
    if (error?.code !== "auth/user-not-found") {
      throw error;
    }

    if (!password) {
      fail("IREPS_BOOTSTRAP_PASSWORD is required because the TEST SPU Auth user does not exist yet.");
    }

    await auth.createUser({
      uid: SPU_UID,
      ...updatePayload,
    });

    return {
      action: "CREATED",
      previousEmail: "NAv",
    };
  }
}

async function writeFirestoreUser({ db, firestoreDoc }) {
  await db.doc(SPU_DOC_PATH).set(firestoreDoc, { merge: false });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log("============================================================");
  console.log("iREPS TEST SPU Bootstrap From Export");
  console.log("============================================================");

  if (args.projectId !== EXPECTED_PROJECT_ID) {
    fail(`Refusing to run. --projectId must be ${EXPECTED_PROJECT_ID}.`);
  }

  if (args.write && args.confirm !== CONFIRM_TEXT) {
    fail(`Write mode requires --confirm ${CONFIRM_TEXT}`);
  }

  const usersExport = readJsonFile(args.usersExport, "Firestore users export");
  const authExport = readJsonFile(args.authExport, "Auth users export");

  const firestoreDoc = getExactSpuFirestoreDoc(usersExport);
  const authRecord = getExactSpuAuthRecord(authExport);
  const claims = parseClaims(authRecord);

  validateSpuData({ firestoreDoc, authRecord, claims });

  console.log(`Mode: ${args.dryRun ? "DRY RUN" : "WRITE"}`);
  console.log(`Project: ${args.projectId}`);
  console.log(`Firestore users export: ${args.usersExport}`);
  console.log(`Auth users export: ${args.authExport}`);
  console.log("");
  console.log("SPU checks passed:");
  console.log(`- UID: ${SPU_UID}`);
  console.log(`- Email: ${authRecord.email}`);
  console.log(`- Firestore path: ${SPU_DOC_PATH}`);
  console.log(`- Role: ${firestoreDoc.employment.role}`);
  console.log(`- Service Provider: ${firestoreDoc.employment.serviceProvider.name}`);
  console.log(`- Account Status: ${firestoreDoc.accountStatus}`);
  console.log(`- Onboarding: ${firestoreDoc.onboarding.status}`);
  console.log(`- Custom Claims: ${JSON.stringify(claims)}`);
  console.log(`- App field count: ${Object.keys(firestoreDoc).length}`);

  if (args.dryRun) {
    console.log("");
    console.log("DRY RUN ONLY — no Auth or Firestore writes performed.");
    console.log("Next command: run again with --write --confirm BOOTSTRAP_TEST_SPU_ONLY");
    return;
  }

  const password = process.env.IREPS_BOOTSTRAP_PASSWORD || "";
  const { auth, db } = initialiseFirebase(args.projectId);

  const authResult = await createOrUpdateAuthUser({
    auth,
    authRecord,
    password,
  });

  await auth.setCustomUserClaims(SPU_UID, claims);
  await writeFirestoreUser({ db, firestoreDoc });

  const writtenUser = await auth.getUser(SPU_UID);
  const writtenDoc = await db.doc(SPU_DOC_PATH).get();

  if (!writtenDoc.exists) {
    fail(`Verification failed. Firestore document not found at ${SPU_DOC_PATH}.`);
  }

  console.log("");
  console.log("Result: PASS");
  console.log(`Auth user: ${authResult.action}`);
  console.log(`Auth UID: ${writtenUser.uid}`);
  console.log(`Auth email: ${writtenUser.email}`);
  console.log(`Custom claims: ${JSON.stringify(writtenUser.customClaims || {})}`);
  console.log(`Firestore document: WRITTEN ${SPU_DOC_PATH}`);
  console.log("Only SPU was bootstrapped. No other users were created.");
}

main().catch((error) => {
  console.error("");
  console.error("Result: FAIL");
  console.error(error?.message || error);
  process.exit(1);
});
