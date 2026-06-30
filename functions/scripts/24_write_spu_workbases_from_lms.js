import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_NAME = "24_write_spu_workbases_from_lms.js";
const CONFIRM_TOKEN = "WRITE_SPU_WORKBASES_IREPS2";
const DEFAULT_SPU_UID = "fXBACUfMzybcqC0AbeNeyYyTeRu1";
const ACTIVE_WORKBASE_ID = "ZA7423";
const ACTIVE_WORKBASE_NAME = "Lesedi";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_INPUT_PATH = path.join(
  __dirname,
  "input",
  "ireps2-lms-20260624-0729.json",
);

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT_PATH,
    uid: DEFAULT_SPU_UID,
    projectId: "ireps2",
    confirm: null,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--input") {
      args.input = argv[i + 1];
      i += 1;
    } else if (arg === "--uid") {
      args.uid = argv[i + 1];
      i += 1;
    } else if (arg === "--project") {
      args.projectId = argv[i + 1];
      i += 1;
    } else if (arg === "--confirm") {
      args.confirm = argv[i + 1];
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`\n${SCRIPT_NAME}\n\nPurpose:\n  Write simple LM workbases to the SPU user document in ireps2.\n\nWrites only:\n  access.activeWorkbase = { id: "ZA7423", name: "Lesedi" }\n  access.workbases = [{ id, name }, ...]\n\nDry run:\n  node ./scripts/${SCRIPT_NAME}\n\nWrite mode:\n  node ./scripts/${SCRIPT_NAME} --confirm ${CONFIRM_TOKEN}\n\nOptional:\n  --input <path-to-lms-json>\n  --uid <spu-user-uid>\n  --project ireps2\n\nRequired env:\n  GOOGLE_APPLICATION_CREDENTIALS must point to the ireps2 service account JSON.\n`);
}

function getDocIdFromPath(docPath) {
  const parts = String(docPath || "").split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}

function extractWorkbases(rawExport) {
  if (!rawExport || typeof rawExport !== "object" || Array.isArray(rawExport)) {
    throw new Error("Input JSON must be an object keyed by document path, e.g. lms/ZA7423.");
  }

  const seen = new Set();
  const workbases = [];

  for (const [docPath, doc] of Object.entries(rawExport)) {
    const id = String(doc?.id || doc?.pcode || doc?.__name__ || getDocIdFromPath(docPath)).trim();
    const name = String(doc?.name || "").trim();

    if (!id) {
      throw new Error(`LM record is missing id: ${docPath}`);
    }

    if (!name) {
      throw new Error(`LM record ${id} is missing name.`);
    }

    if (seen.has(id)) {
      throw new Error(`Duplicate LM id found in input: ${id}`);
    }

    seen.add(id);
    workbases.push({ id, name });
  }

  const active = workbases.find((item) => item.id === ACTIVE_WORKBASE_ID);

  if (!active) {
    throw new Error(`Active workbase ${ACTIVE_WORKBASE_ID} (${ACTIVE_WORKBASE_NAME}) was not found in input.`);
  }

  if (active.name !== ACTIVE_WORKBASE_NAME) {
    throw new Error(
      `Active workbase ${ACTIVE_WORKBASE_ID} name mismatch. Expected "${ACTIVE_WORKBASE_NAME}", got "${active.name}".`,
    );
  }

  return workbases;
}

function initAdmin(projectId) {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS is not set.");
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId,
    });
  }

  return admin.firestore();
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    return;
  }

  const inputPath = path.resolve(args.input);
  const isWriteMode = args.confirm === CONFIRM_TOKEN;

  console.log("============================================================");
  console.log("SPU LM Workbases Bootstrap");
  console.log("============================================================");
  console.log("Project:", args.projectId);
  console.log("SPU UID:", args.uid);
  console.log("Input:", inputPath);
  console.log("Write mode:", isWriteMode ? "YES" : "NO - DRY RUN");
  console.log("Active workbase:", `${ACTIVE_WORKBASE_ID} - ${ACTIVE_WORKBASE_NAME}`);
  console.log("============================================================");

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const rawExport = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const workbases = extractWorkbases(rawExport);
  const activeWorkbase = { id: ACTIVE_WORKBASE_ID, name: ACTIVE_WORKBASE_NAME };

  console.log("Workbases to write:", workbases.length);
  for (const item of workbases) {
    console.log(`- ${item.id} - ${item.name}`);
  }

  const db = initAdmin(args.projectId);
  const userRef = db.collection("users").doc(args.uid);
  const beforeSnap = await userRef.get();

  if (!beforeSnap.exists) {
    throw new Error(`SPU user document not found: users/${args.uid}`);
  }

  const before = beforeSnap.data() || {};
  const beforeAccess = before.access || {};

  console.log("============================================================");
  console.log("Current access summary");
  console.log("============================================================");
  console.log("Current activeWorkbase:", beforeAccess.activeWorkbase || null);
  console.log("Current workbases count:", Array.isArray(beforeAccess.workbases) ? beforeAccess.workbases.length : 0);

  const updatePayload = {
    "access.activeWorkbase": activeWorkbase,
    "access.workbases": workbases,
  };

  console.log("============================================================");
  console.log("Next access summary");
  console.log("============================================================");
  console.log("Next activeWorkbase:", activeWorkbase);
  console.log("Next workbases count:", workbases.length);

  if (!isWriteMode) {
    console.log("============================================================");
    console.log("DRY RUN COMPLETE - NO FIRESTORE WRITE PERFORMED");
    console.log("To write, rerun with:");
    console.log(`node ./scripts/${SCRIPT_NAME} --confirm ${CONFIRM_TOKEN}`);
    console.log("============================================================");
    return;
  }

  await userRef.update(updatePayload);
  const afterSnap = await userRef.get();
  const afterAccess = afterSnap.data()?.access || {};

  console.log("============================================================");
  console.log("WRITE COMPLETE");
  console.log("============================================================");
  console.log("Firestore path:", `users/${args.uid}`);
  console.log("Saved activeWorkbase:", afterAccess.activeWorkbase || null);
  console.log("Saved workbases count:", Array.isArray(afterAccess.workbases) ? afterAccess.workbases.length : 0);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("============================================================");
    console.error("SCRIPT FAILED");
    console.error("============================================================");
    console.error(error);
    process.exit(1);
  });
