import fs from "node:fs";
import admin from "firebase-admin";

const DEFAULT_SERVICE_ACCOUNT_PATH =
  "C:\\dev\\secrets\\ireps-test-firebase-adminsdk-fbsvc-d02929e1e3.json";

const EXPECTED_PROJECT_ID = "ireps-test";
const DEFAULT_SPU_UID = "fXBACUfMzybcqC0AbeNeyYyTeRu1";
const CONFIRM_TOKEN = "UPDATE_SPU_TEST_WORKBASES";

const DEMO_WORKBASES = [
  { id: "ZA2157", name: "King Sabata Dalindyebo" },
  { id: "ZA7423", name: "Lesedi" },
];

const DEMO_ACTIVE_WORKBASE = { id: "ZA7423", name: "Lesedi" };

function getArgValue(name) {
  const prefix = `${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function hasConfirmToken() {
  return process.argv.includes("--confirm") && process.argv.includes(CONFIRM_TOKEN);
}

function loadServiceAccount(serviceAccountPath) {
  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(
      `Service account file not found: ${serviceAccountPath}\n` +
        "Confirm the path exists on this machine before running the script.",
    );
  }

  const raw = fs.readFileSync(serviceAccountPath, "utf8");
  const serviceAccount = JSON.parse(raw);

  if (serviceAccount.project_id !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `Refusing to run: service account project_id is "${serviceAccount.project_id}" but expected "${EXPECTED_PROJECT_ID}".`,
    );
  }

  return serviceAccount;
}

function normalizeRole(value) {
  return String(value || "").trim().toUpperCase();
}

async function main() {
  const serviceAccountPath =
    getArgValue("--service-account") ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    DEFAULT_SERVICE_ACCOUNT_PATH;

  const targetUid = getArgValue("--uid") || DEFAULT_SPU_UID;
  const writeMode = hasConfirmToken();

  console.log("============================================================");
  console.log("Patch SPU User Workbases for TEST Demo");
  console.log("============================================================");
  console.log(`Mode: ${writeMode ? "WRITE" : "DRY RUN"}`);
  console.log(`Expected Firebase project: ${EXPECTED_PROJECT_ID}`);
  console.log(`Service account path: ${serviceAccountPath}`);
  console.log(`Target user UID: ${targetUid}`);
  console.log("============================================================");

  const serviceAccount = loadServiceAccount(serviceAccountPath);

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: EXPECTED_PROJECT_ID,
    });
  }

  const db = admin.firestore();

  const lmsChecks = await Promise.all(
    DEMO_WORKBASES.map(async (wb) => {
      const snap = await db.collection("lms").doc(wb.id).get();
      return { ...wb, existsInLms: snap.exists };
    }),
  );

  const missingLms = lmsChecks.filter((wb) => !wb.existsInLms);
  if (missingLms.length > 0) {
    throw new Error(
      `Refusing to run: these LM docs were not found in lms: ${missingLms
        .map((wb) => `${wb.id} (${wb.name})`)
        .join(", ")}`,
    );
  }

  const userRef = db.collection("users").doc(targetUid);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    throw new Error(`Target user document not found: users/${targetUid}`);
  }

  const userData = userSnap.data();
  const role = normalizeRole(userData?.employment?.role);
  const email = userData?.identity?.email || userData?.email || "UNKNOWN_EMAIL";

  if (role !== "SPU") {
    throw new Error(
      `Refusing to run: target user role is "${role}" but this demo patch only updates SPU users.`,
    );
  }

  const before = {
    role,
    email,
    activeWorkbase: userData?.access?.activeWorkbase || null,
    workbases: userData?.access?.workbases || [],
  };

  const updates = {
    "access.workbases": DEMO_WORKBASES,
    "access.activeWorkbase": DEMO_ACTIVE_WORKBASE,
    "metadata.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
    "metadata.updatedBy": "patch_spu_user_workbases_for_test_demo",
    "metadata.updatedByUid": targetUid,
  };

  console.log("Current user access:");
  console.log(JSON.stringify(before, null, 2));
  console.log("============================================================");
  console.log("Planned update:");
  console.log(JSON.stringify(updates, null, 2));
  console.log("============================================================");

  if (!writeMode) {
    console.log("DRY RUN PASSED — no Firestore write performed.");
    console.log(
      `To write, run: node .\\scripts\\admin\\patch_spu_user_workbases_for_test_demo.js --confirm ${CONFIRM_TOKEN}`,
    );
    return;
  }

  await userRef.update(updates);

  const afterSnap = await userRef.get();
  const afterData = afterSnap.data();

  console.log("WRITE PASSED — Firestore user was updated.");
  console.log("Updated user access:");
  console.log(
    JSON.stringify(
      {
        activeWorkbase: afterData?.access?.activeWorkbase || null,
        workbases: afterData?.access?.workbases || [],
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("============================================================");
  console.error("PATCH FAILED");
  console.error("============================================================");
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
