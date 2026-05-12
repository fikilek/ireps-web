import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

initializeApp({
  credential: applicationDefault(),
});

const db = getFirestore();

const SYSTEM_UID = "SYSTEM";
const SYSTEM_USER = "DCN Lookup Seed Script";

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
    lookupKey: "METER_DISCONNECTION_INSTRUCTION",
    title: "Meter Disconnection Instruction",
    description: "",
    domain: "METER_DISCONNECTION",
    fieldKey: "disconnection.instruction",
    allowOther: true,
    otherCode: "OTHER",
    otherLabel: "Other",
    status: "PUBLISHED",
    system: false,
    options: [
      optionDoc({
        code: "CREDIT_CONTROL_INSTRUCTION",
        label: "Credit Control Instruction",
        description: "Disconnection instructed for credit control purposes.",
        sortOrder: 10,
      }),
      optionDoc({
        code: "ILLEGAL_CONNECTION",
        label: "Illegal Connection",
        description: "Disconnection instructed due to an illegal connection.",
        sortOrder: 20,
      }),
      optionDoc({
        code: "NON_PAYMENT",
        label: "Non Payment",
        description: "Disconnection instructed due to non-payment.",
        sortOrder: 30,
      }),
    ],
  },

  {
    lookupKey: "METER_DISCONNECTION_LEVEL",
    title: "Meter Disconnection Level",
    description: "",
    domain: "METER_DISCONNECTION",
    fieldKey: "disconnection.level",
    allowOther: false,
    otherCode: "OTHER",
    otherLabel: "",
    status: "PUBLISHED",
    system: false,
    options: [
      optionDoc({
        code: "LEVEL_1_CB_ONLY",
        label: "Level 1 - Flip circuit breaker only",
        description:
          "Supply disconnected by switching off the circuit breaker only.",
        sortOrder: 10,
      }),
      optionDoc({
        code: "LEVEL_2_CB_WIRE_REMOVED",
        label: "Level 2 - Remove wire on circuit breaker",
        description:
          "Supply disconnected by removing the wire from the circuit breaker.",
        sortOrder: 20,
      }),
      optionDoc({
        code: "LEVEL_3_SUPPLY_CABLE_REMOVED",
        label: "Level 3 - Remove whole supply cable",
        description: "Supply disconnected by removing the supply cable.",
        sortOrder: 30,
      }),
    ],
  },

  {
    lookupKey: "METER_NO_ACCESS_REASON",
    title: "Meter No Access Reason",
    description:
      "Standard reasons used when a meter or supply point could not be safely accessed.",
    domain: "METER",
    fieldKey: "accessData.access.reason",
    allowOther: true,
    otherCode: "OTHER",
    otherLabel: "Other",
    status: "PUBLISHED",
    system: false,
    options: [
      optionDoc({
        code: "LOCKED_GATE_NO_KEY",
        label: "Locked Gate / No Key",
        description:
          "The property or meter area was locked and no key or access method was available.",
        sortOrder: 10,
      }),
      optionDoc({
        code: "VICIOUS_DOGS",
        label: "Vicious Dogs",
        description:
          "Dogs or animals prevented safe access to the meter or property.",
        sortOrder: 20,
      }),
      optionDoc({
        code: "CUSTOMER_REFUSED_ACCESS",
        label: "Customer Refused Access",
        description:
          "The customer or occupant refused access to the meter or property.",
        sortOrder: 30,
      }),
      optionDoc({
        code: "NO_ONE_ON_SITE",
        label: "No One On Site",
        description: "No responsible person was available to provide access.",
        sortOrder: 40,
      }),
      optionDoc({
        code: "UNSAFE_SITE_CONDITION",
        label: "Unsafe Site Condition",
        description:
          "The site condition was unsafe for the executor to proceed.",
        sortOrder: 50,
      }),
      optionDoc({
        code: "METER_INSIDE_PREMISES",
        label: "Meter Inside Premises",
        description:
          "The meter was inside the premises and could not be reached.",
        sortOrder: 60,
      }),
      optionDoc({
        code: "ACCESS_BLOCKED",
        label: "Access Blocked",
        description:
          "Physical obstruction blocked access to the meter or supply point.",
        sortOrder: 70,
      }),
      optionDoc({
        code: "WRONG_LOCATION",
        label: "Wrong Location",
        description:
          "The executor could not locate the correct meter or property.",
        sortOrder: 80,
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
  console.log("Starting DCN lookup seed...");

  for (const seed of lookupSeeds) {
    await upsertLookup(seed);
  }

  console.log("DCN lookup seed complete.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("DCN lookup seed failed:", error);
    process.exit(1);
  });
