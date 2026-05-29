import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

/**
 * ============================================================
 * iREPS Lookup Migration Seed Script
 * ============================================================
 *
 * PURPOSE
 * -------
 * Migrates existing meter-related settings into
 * irepsSelectLookups WITHOUT deleting the old settings collection.
 *
 * IMPORTANT RULE
 * --------------
 * DO NOT delete existing settings documents yet.
 *
 * We will:
 * 1. Seed irepsSelectLookups
 * 2. Modify frontend/backend code gradually
 * 3. Test everything
 * 4. Only later remove old settings usage
 *
 * ============================================================
 */

const PROJECT_ID = "ireps2";
const SECRETS_FOLDER = "C:/dev/secrets";

const SYSTEM_UID = "SYSTEM";
const SYSTEM_USER = "Lookup Migration Seed Script";

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
  parentCode = null,
  appliesTo = [],
}) {
  return {
    code,
    label,
    description,
    sortOrder,
    enabled,
    parentCode,
    appliesTo,
    metadata: {
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: SYSTEM_UID,
      updatedByUser: SYSTEM_USER,
    },
  };
}

const lookupSeeds = [
  /**
   * ============================================================
   * METER NORMALISATION ACTION
   * ============================================================
   */
  {
    lookupKey: "METER_NORMALISATION_ACTION",
    title: "Meter Normalisation Action",
    description:
      "Standard meter normalisation actions used during discovery, inspection, and lifecycle execution.",
    domain: "METER",
    fieldKey: "ast.normalisation.actionTaken",
    allowOther: true,
    otherCode: "OTHER",
    otherLabel: "Other",
    status: "PUBLISHED",
    system: false,
    options: [
      optionDoc({
        code: "NONE",
        label: "None",
        description: "No normalisation action was done.",
        sortOrder: 10,
      }),
      optionDoc({
        code: "ISSUE_FINE",
        label: "Issue Fine",
        description: "Fine was issued.",
        sortOrder: 20,
      }),
      optionDoc({
        code: "NEW_INSTALLATION",
        label: "New Installation",
        description: "New installation was done.",
        sortOrder: 30,
      }),
      optionDoc({
        code: "METER_REMOVAL",
        label: "Remove Meter",
        description: "Meter was removed.",
        sortOrder: 40,
      }),
      optionDoc({
        code: "METER_RECONNECTION",
        label: "Reconnect",
        description: "Meter reconnection was done.",
        sortOrder: 50,
      }),
      optionDoc({
        code: "METER_DISCONNECTION",
        label: "Disconnect",
        description: "Meter disconnection was done.",
        sortOrder: 60,
      }),
      optionDoc({
        code: "TAMPER_REMOVAL",
        label: "Tamper Removal",
        description: "Tamper was removed or cleared.",
        sortOrder: 70,
      }),
      optionDoc({
        code: "METER_READING",
        label: "Meter Reading",
        description: "Meter reading was done.",
        sortOrder: 80,
      }),
    ],
  },

  /**
   * ============================================================
   * METER ANOMALY
   * ============================================================
   */
  {
    lookupKey: "METER_ANOMALY",
    title: "Meter Anomaly",
    description:
      "Primary anomaly categories used in meter discovery, inspection, and lifecycle operations.",
    domain: "METER",
    fieldKey: "ast.anomalies.anomaly",
    allowOther: true,
    otherCode: "OTHER",
    otherLabel: "Other",
    status: "PUBLISHED",
    system: false,
    options: [
      optionDoc({
        code: "METER_OK",
        label: "Meter Ok",
        description: "Meter is operationally normal.",
        sortOrder: 10,
      }),
      optionDoc({
        code: "METER_NOT_ON_PORTAL",
        label: "Meter Not On Portal",
        description: "Meter is not available or token-ready on the portal.",
        sortOrder: 20,
      }),
      optionDoc({
        code: "METER_FAULTY",
        label: "Meter Faulty",
        description: "Meter is faulty or malfunctioning.",
        sortOrder: 30,
      }),
      optionDoc({
        code: "METER_DAMAGED",
        label: "Meter Damaged",
        description: "Meter is physically damaged.",
        sortOrder: 40,
      }),
      optionDoc({
        code: "ILLEGALLY_CONNECTED",
        label: "Illegally Connected",
        description: "Illegal or bypass connection detected.",
        sortOrder: 50,
      }),
    ],
  },

  /**
   * ============================================================
   * ANOMALY DETAIL
   * ============================================================
   */
  {
    lookupKey: "ANOMALY_DETAIL",
    title: "Anomaly Detail",
    description:
      "Detailed anomaly options linked to parent anomaly categories.",
    domain: "METER",
    fieldKey: "ast.anomalies.anomalyDetail",
    allowOther: true,
    otherCode: "OTHER",
    otherLabel: "Other",
    status: "PUBLISHED",
    system: false,
    options: [
      optionDoc({
        parentCode: "METER_OK",
        code: "OPERATIONALLY_OK",
        label: "Operationally Ok",
        description: "Meter is operationally normal.",
        sortOrder: 10,
      }),

      optionDoc({
        parentCode: "METER_NOT_ON_PORTAL",
        code: "NO_TID_KC_TOKENS_ON_PORTAL",
        label: "No TID KC Tokens On Portal",
        description: "No TID key change tokens are available on the portal.",
        sortOrder: 20,
      }),
      optionDoc({
        parentCode: "METER_NOT_ON_PORTAL",
        code: "NO_SGC_TOKENS_AVAILABLE",
        label: "No SGC Tokens Available",
        description: "No SGC tokens are available for the meter.",
        sortOrder: 30,
      }),

      optionDoc({
        parentCode: "METER_FAULTY",
        code: "NOT_ACCEPTING_SGC_TOKENS",
        label: "Not Accepting SGC Tokens",
        description: "Meter is not accepting SGC tokens.",
        sortOrder: 40,
      }),
      optionDoc({
        parentCode: "METER_FAULTY",
        code: "METER_DISPLAY_BLANK",
        label: "Meter Display Blank",
        description: "Meter display is blank.",
        sortOrder: 50,
      }),
      optionDoc({
        parentCode: "METER_FAULTY",
        code: "NEGATIVE_CREDIT_UNITS",
        label: "Negative Credit Units",
        description: "Meter shows negative credit units.",
        sortOrder: 60,
      }),
      optionDoc({
        parentCode: "METER_FAULTY",
        code: "ZERO_READING_CONVENTIONAL_METER",
        label: "Zero Reading - Conventional Meter",
        description: "Conventional meter shows a zero reading.",
        sortOrder: 70,
      }),
      optionDoc({
        parentCode: "METER_FAULTY",
        code: "METER_WHEEL_NOT_MOVING",
        label: "Meter Wheel Not Moving",
        description: "Conventional meter wheel is not moving.",
        sortOrder: 80,
      }),
      optionDoc({
        parentCode: "METER_FAULTY",
        code: "METER_WHEEL_RUNNING_IN_REVERSE",
        label: "Meter Wheel Running In Reverse",
        description: "Conventional meter wheel is running in reverse.",
        sortOrder: 90,
      }),

      optionDoc({
        parentCode: "METER_DAMAGED",
        code: "METER_NUMBER_NOT_CLEARLY_VISIBLE",
        label: "Meter Number Not Clearly Visible",
        description: "Meter number cannot be clearly read.",
        sortOrder: 100,
      }),
      optionDoc({
        parentCode: "METER_DAMAGED",
        code: "METER_BURNT",
        label: "Meter Burnt",
        description: "Meter shows burn damage.",
        sortOrder: 110,
      }),
      optionDoc({
        parentCode: "METER_DAMAGED",
        code: "METER_BUTTONS_NOT_WORKING",
        label: "Meter Button(s) Not Working",
        description: "Meter button or buttons are not working.",
        sortOrder: 120,
      }),
      optionDoc({
        parentCode: "METER_DAMAGED",
        code: "METER_BROKEN",
        label: "Meter Broken",
        description: "Meter is broken.",
        sortOrder: 130,
      }),

      optionDoc({
        parentCode: "ILLEGALLY_CONNECTED",
        code: "STRAIGHT_CONNECTION_METER_BYPASSED",
        label: "Straight Connection (Meter Bypassed)",
        description: "Straight connection or bypass detected on the meter.",
        sortOrder: 140,
      }),
      optionDoc({
        parentCode: "ILLEGALLY_CONNECTED",
        code: "BRIDGE_WIRE_ON_METER",
        label: "Bridge Wire On the Meter",
        description: "Bridge wire found on the meter.",
        sortOrder: 150,
      }),
    ],
  },

  /**
   * ============================================================
   * METER PLACEMENT
   * ============================================================
   */
  {
    lookupKey: "METER_PLACEMENT",
    title: "Meter Placement",
    description: "Standard placement descriptions for meter location.",
    domain: "METER",
    fieldKey: "ast.location.placement",
    allowOther: true,
    otherCode: "OTHER",
    otherLabel: "Other",
    status: "PUBLISHED",
    system: false,
    options: [
      optionDoc({
        code: "KIOSK",
        label: "Kiosk",
        sortOrder: 10,
      }),
      optionDoc({
        code: "TOP_POLE",
        label: "Top Pole",
        sortOrder: 10,
      }),
      optionDoc({
        code: "BOTTOM_POLE",
        label: "Bottom Pole",
        sortOrder: 20,
      }),
      optionDoc({
        code: "BOUNDARY_WALL",
        label: "Boundary Wall",
        sortOrder: 30,
      }),
      optionDoc({
        code: "INSIDE_PREMISES",
        label: "Inside Premises",
        sortOrder: 40,
      }),
    ],
  },

  /**
   * ============================================================
   * METER CB SIZE
   * ============================================================
   */
  {
    lookupKey: "METER_CB_SIZE",
    title: "Meter CB Size",
    description: "Standard circuit breaker sizes.",
    domain: "METER",
    fieldKey: "ast.astData.meter.cb.size",
    allowOther: true,
    otherCode: "OTHER",
    otherLabel: "Other",
    status: "PUBLISHED",
    system: false,
    options: [
      optionDoc({ code: "20", label: "20", sortOrder: 10 }),
      optionDoc({ code: "40", label: "40", sortOrder: 20 }),
      optionDoc({ code: "60", label: "60", sortOrder: 30 }),
      optionDoc({ code: "80", label: "80", sortOrder: 40 }),
      optionDoc({ code: "90", label: "80", sortOrder: 50 }),
      optionDoc({ code: "100", label: "100", sortOrder: 60 }),
    ],
  },

  /**
   * ============================================================
   * METER PHASE
   * ============================================================
   */
  {
    lookupKey: "METER_PHASE",
    title: "Meter Phase",
    description: "Standard meter phase options.",
    domain: "METER",
    fieldKey: "ast.astData.meter.phase",
    allowOther: false,
    otherCode: "OTHER",
    otherLabel: "",
    status: "PUBLISHED",
    system: false,
    options: [
      optionDoc({
        code: "SINGLE_PHASE",
        label: "Single Phase",
        sortOrder: 10,
      }),
      optionDoc({
        code: "THREE_PHASE",
        label: "Three Phase",
        sortOrder: 20,
      }),
    ],
  },

  /**
   * ============================================================
   * METER MANUFACTURER
   * ============================================================
   * Generic manufacturer lookup. Options are filtered by appliesTo.
   */
  {
    lookupKey: "METER_MANUFACTURER",
    title: "Meter Manufacturer",
    description:
      "Generic meter manufacturer lookup filtered by meter service type.",
    domain: "METER",
    fieldKey: "ast.astData.astManufacturer",
    allowOther: true,
    otherCode: "OTHER",
    otherLabel: "Other",
    status: "PUBLISHED",
    system: false,
    options: [
      optionDoc({
        code: "LANDIS_GYR",
        label: "Landis+Gyr",
        appliesTo: ["electricity"],
        sortOrder: 10,
      }),
      optionDoc({
        code: "CONLOG",
        label: "Conlog",
        appliesTo: ["electricity"],
        sortOrder: 20,
      }),
      optionDoc({
        code: "HEXING",
        label: "Hexing",
        appliesTo: ["electricity"],
        sortOrder: 30,
      }),
      optionDoc({
        code: "ITRON",
        label: "Itron",
        appliesTo: ["electricity"],
        sortOrder: 40,
      }),
      optionDoc({
        code: "CASHPOWER",
        label: "Cashpower",
        appliesTo: ["electricity"],
        sortOrder: 50,
      }),
      optionDoc({
        code: "ELSTER",
        label: "Elster",
        appliesTo: ["water"],
        sortOrder: 60,
      }),
      optionDoc({
        code: "KENT",
        label: "Kent",
        appliesTo: ["water"],
        sortOrder: 70,
      }),
      optionDoc({
        code: "SENSUS",
        label: "Sensus",
        appliesTo: ["water"],
        sortOrder: 80,
      }),
      optionDoc({
        code: "PRECISION",
        label: "Precision",
        appliesTo: ["water"],
        sortOrder: 90,
      }),
      optionDoc({
        code: "ARAD",
        label: "Arad",
        appliesTo: ["water"],
        sortOrder: 100,
      }),
    ],
  },

  /**
   * NOTE:
   * METER_DISCONNECTION_LEVEL is intentionally excluded because it already
   * exists in irepsSelectLookups.
   */

  /**
   * ============================================================
   * METER CONNECTION STATUS
   * ============================================================
   */
  {
    lookupKey: "METER_CONNECTION_STATUS",
    title: "Meter Connection Status",
    description: "Standard meter connection status options.",
    domain: "METER",
    fieldKey: "status.state",
    allowOther: false,
    otherCode: "OTHER",
    otherLabel: "",
    status: "PUBLISHED",
    system: false,
    options: [
      optionDoc({ code: "FIELD", label: "Field", sortOrder: 10 }),
      optionDoc({ code: "CONNECTED", label: "Connected", sortOrder: 20 }),
      optionDoc({ code: "DISCONNECTED", label: "Disconnected", sortOrder: 30 }),
      optionDoc({ code: "REMOVED", label: "Removed", sortOrder: 40 }),
      optionDoc({
        code: "DECOMMISSIONED",
        label: "Decommissioned",
        sortOrder: 50,
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
  console.log("====================================================");
  console.log("Starting iREPS lookup migration seed...");
  console.log(`Using service account key from: ${serviceAccountKeyPath}`);
  console.log("====================================================");

  for (const seed of lookupSeeds) {
    await upsertLookup(seed);
  }

  console.log("====================================================");
  console.log("iREPS lookup migration seed complete.");
  console.log("IMPORTANT: Existing settings collection was NOT removed.");
  console.log("====================================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Lookup migration seed failed:", error);
    process.exit(1);
  });
