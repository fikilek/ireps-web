import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

const PROJECT_ID = "ireps2";
const SECRETS_FOLDER = "C:/dev/secrets";

const SYSTEM_UID = "SYSTEM";
const SYSTEM_USER = "MREAD Lookup Seed Script";

function findServiceAccountKeyPath() {
  if (!existsSync(SECRETS_FOLDER)) {
    throw new Error(`Secrets folder not found: ${SECRETS_FOLDER}`);
  }

  const jsonFiles = readdirSync(SECRETS_FOLDER).filter((fileName) =>
    fileName.toLowerCase().endsWith(".json"),
  );

  if (!jsonFiles.length) {
    throw new Error(`No JSON key file found in ${SECRETS_FOLDER}`);
  }

  const preferredFile =
    jsonFiles.find((fileName) => fileName.toLowerCase().includes("ireps2")) ||
    jsonFiles[0];

  return join(SECRETS_FOLDER, preferredFile);
}

const serviceAccountKeyPath = findServiceAccountKeyPath();
const serviceAccount = JSON.parse(readFileSync(serviceAccountKeyPath, "utf8"));

initializeApp({
  credential: cert(serviceAccount),
  projectId: PROJECT_ID,
});

const db = getFirestore();

function optionDoc({
  code,
  label,
  description = "",
  sortOrder = 9999,
  enabled = true,
}) {
  return {
    code,
    label,
    description,
    sortOrder,
    enabled,
    metadata: {
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: SYSTEM_UID,
      updatedByUser: SYSTEM_USER,
    },
  };
}

const lookupSeeds = [
  {
    lookupKey: "METER_READING_INSTRUCTION",
    title: "Meter Reading Instruction",
    description:
      "Standard instructions used when issuing individual meter reading workorders.",
    domain: "METER_READING",
    fieldKey: "assignment.instruction.text",
    allowOther: true,
    otherCode: "OTHER",
    otherLabel: "Other",
    status: "PUBLISHED",
    system: false,
    options: [
      optionDoc({
        code: "MONTHLY_METER_READING",
        label: "Monthly Meter Reading",
        description: "Capture a scheduled monthly meter reading.",
        sortOrder: 10,
      }),
      optionDoc({
        code: "ROUTINE_METER_READING",
        label: "Routine Meter Reading",
        description: "Capture a normal routine meter reading.",
        sortOrder: 20,
      }),
      optionDoc({
        code: "VERIFY_METER_READING",
        label: "Verify Meter Reading",
        description: "Verify or confirm a previous meter reading.",
        sortOrder: 30,
      }),
      optionDoc({
        code: "FINAL_METER_READING",
        label: "Final Meter Reading",
        description:
          "Capture a final reading before account, service, or asset action.",
        sortOrder: 40,
      }),
      optionDoc({
        code: "INVESTIGATION_METER_READING",
        label: "Investigation Meter Reading",
        description:
          "Capture a reading for investigation, audit, anomaly, or complaint handling.",
        sortOrder: 50,
      }),
      optionDoc({
        code: "BULK_METER_READING",
        label: "Bulk Meter Reading",
        description:
          "Capture a reading as part of a bulk/geofence meter reading campaign.",
        sortOrder: 60,
      }),
    ],
  },
];

async function upsertLookup(seed) {
  const lookupRef = db.collection("irepsSelectLookups").doc(seed.lookupKey);
  const lookupSnap = await lookupRef.get();

  const nowPatch = lookupSnap.exists
    ? {
        "metadata.updatedAt": FieldValue.serverTimestamp(),
        "metadata.updatedByUid": SYSTEM_UID,
        "metadata.updatedByUser": SYSTEM_USER,
      }
    : {
        metadata: {
          createdAt: FieldValue.serverTimestamp(),
          createdByUid: SYSTEM_UID,
          createdByUser: SYSTEM_USER,
          updatedAt: FieldValue.serverTimestamp(),
          updatedByUid: SYSTEM_UID,
          updatedByUser: SYSTEM_USER,
        },
      };

  await lookupRef.set(
    {
      lookupKey: seed.lookupKey,
      title: seed.title,
      description: seed.description,
      domain: seed.domain,
      fieldKey: seed.fieldKey,
      allowOther: seed.allowOther,
      otherCode: seed.otherCode,
      otherLabel: seed.otherLabel,
      status: seed.status,
      system: seed.system,
      optionCount: seed.options.length,
      version: FieldValue.increment(1),
      ...nowPatch,
    },
    { merge: true },
  );

  for (const option of seed.options) {
    const optionRef = lookupRef.collection("options").doc(option.code);

    await optionRef.set(
      {
        ...option,
        metadata: {
          createdAt: FieldValue.serverTimestamp(),
          createdByUid: SYSTEM_UID,
          createdByUser: SYSTEM_USER,
          updatedAt: FieldValue.serverTimestamp(),
          updatedByUid: SYSTEM_UID,
          updatedByUser: SYSTEM_USER,
        },
      },
      { merge: true },
    );
  }

  console.log(
    `✅ ${seed.lookupKey} upserted with ${seed.options.length} options`,
  );
}

async function main() {
  console.log("Starting MREAD instruction lookup seed...");
  console.log(`Using service account key from: ${serviceAccountKeyPath}`);

  for (const seed of lookupSeeds) {
    await upsertLookup(seed);
  }

  console.log("MREAD instruction lookup seed complete.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("MREAD instruction lookup seed failed:", error);
    process.exit(1);
  });
