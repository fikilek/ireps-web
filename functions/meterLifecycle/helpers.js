const NOW_FALLBACK_USER = "SYSTEM";

export const LIFECYCLE_TRN_TYPES = [
  "METER_COMMISSIONING",
  "METER_INSPECTION",
  "METER_DISCONNECTION",
  "METER_RECONNECTION",
  "METER_REMOVAL",
  "METER_VENDING",
];

export const IMPLEMENTED_LIFECYCLE_TRN_TYPES = [
  "METER_REMOVAL",
  "METER_DISCONNECTION",
  "METER_RECONNECTION",
];
export const OFFICE_LCT_INSTRUCTION_TRN_TYPES = [
  "METER_INSPECTION",
  "METER_DISCONNECTION",
  "METER_RECONNECTION",
  "METER_REMOVAL",
];

export const ACTIVE_LCT_WORKFLOW_STATES = [
  "ISSUED",
  "REASSIGNED",
  "ACCEPTED",
  "IN_PROGRESS",
];

export const LCT_WORKFLOW_STATES = [
  "ISSUED",
  "REASSIGNED",
  "ACCEPTED",
  "REJECTED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
];

export const COMMISSIONING_MEDIA_TAGS = {
  vendingEvidence: "vendingEvidence",
  finalSwitchOnEvidence: "finalSwitchOnEvidence",
  keypadIssuedEvidence: "keypadIssuedEvidence",
};

export const REMOVAL_MEDIA_TAGS = {
  removalInstructionEvidence: "removalInstructionEvidence",
  removalEvidence: "removalEvidence",
  finalReadingEvidence: "finalReadingEvidence",
  supplySafeEvidence: "supplySafeEvidence",
};

export const DISCONNECTION_LEVELS = {
  LEVEL_1_CB_ONLY: {
    code: "LEVEL_1_CB_ONLY",
    label: "Level 1 - Flip circuit breaker only",
  },
  LEVEL_2_CB_WIRE_REMOVED: {
    code: "LEVEL_2_CB_WIRE_REMOVED",
    label: "Level 2 - Remove wire on circuit breaker",
  },
  LEVEL_3_SUPPLY_CABLE_REMOVED: {
    code: "LEVEL_3_SUPPLY_CABLE_REMOVED",
    label: "Level 3 - Remove whole supply cable",
  },
};

export const DISCONNECTION_MEDIA_TAGS = {
  instructionEvidence: "disconnectionInstructionEvidence",
  levelEvidence: "disconnectionLevelEvidence",
  meterReadingEvidence: "disconnectionMeterReadingEvidence",
};

export const RECONNECTION_MEDIA_TAGS = {
  instructionEvidence: "reconnectionInstructionEvidence",
  reconnectionEvidence: "reconnectionEvidence",
  meterReadingEvidence: "reconnectionMeterReadingEvidence",
};

export function buildFailureResult(code, message, extra = {}) {
  return {
    success: false,
    code: code || "UNKNOWN_ERROR",
    message: message || "Unknown error",
    trnId: "NAv",
    ...extra,
  };
}

export function buildSuccessResult(
  trnId,
  message = "Lifecycle TRN created successfully",
  extra = {},
) {
  return {
    success: true,
    code: "SUCCESS",
    message,
    trnId: trnId || "NAv",
    ...extra,
  };
}

export function removeUndefinedDeep(value) {
  if (value === undefined) return null;

  return JSON.parse(
    JSON.stringify(value, (_key, item) => (item === undefined ? null : item)),
  );
}

export function getActorNameFromRequest(request) {
  return (
    request?.auth?.token?.name ||
    request?.auth?.token?.email ||
    request?.auth?.token?.displayName ||
    request?.auth?.uid ||
    NOW_FALLBACK_USER
  );
}

export function buildFlatMetadata({ now, actorUid, actorName }) {
  return {
    createdAt: now,
    createdByUid: actorUid || NOW_FALLBACK_USER,
    createdByUser: actorName || NOW_FALLBACK_USER,
    updatedAt: now,
    updatedByUid: actorUid || NOW_FALLBACK_USER,
    updatedByUser: actorName || NOW_FALLBACK_USER,
  };
}

export function normalizeUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export function normalizeLower(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function normalizeYesNo(value) {
  const clean = normalizeLower(value);
  return clean === "yes" || clean === "no" ? clean : null;
}

export function normalizeMeterKind(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, "");
}

export function getServiceBucketFromMeterType({ meterType, trnId }) {
  const rawMeterType = normalizeLower(meterType);
  const rawTrnId = normalizeUpper(trnId);

  if (
    rawMeterType === "water" ||
    rawMeterType === "wtr" ||
    rawTrnId.includes("_WTR_")
  ) {
    return "waterMeters";
  }

  if (
    rawMeterType === "electricity" ||
    rawMeterType === "elec" ||
    rawMeterType === "elc" ||
    rawTrnId.includes("_ELC_") ||
    rawTrnId.includes("_ELEC_")
  ) {
    return "electricityMeters";
  }

  return null;
}

export function normalizePremiseServiceSnapshotItem(item) {
  if (!item) return null;

  if (typeof item === "string") {
    return {
      trnId: item,
      status: "RECORDED",
      updatedAt: null,
    };
  }

  return {
    trnId: item?.trnId || item?.id || "NAv",
    status: normalizeUpper(item?.status || "RECORDED"),
    updatedAt: item?.updatedAt || null,
  };
}

export function buildPremiseServiceSnapshotPatch({
  premiseData,
  astId,
  meterType,
  status,
  updatedAt,
}) {
  const serviceBucket = getServiceBucketFromMeterType({
    meterType,
    trnId: astId,
  });

  if (!serviceBucket) {
    return {
      ok: false,
      code: "UNKNOWN_SERVICE_BUCKET",
      message: "Could not resolve premise service bucket for meter type",
    };
  }

  const services = premiseData?.services || {};

  const currentBucket = Array.isArray(services?.[serviceBucket])
    ? services[serviceBucket]
    : [];

  const normalizedBucket = currentBucket
    .map(normalizePremiseServiceSnapshotItem)
    .filter((item) => item?.trnId && item.trnId !== "NAv");

  const nextServiceItem = {
    trnId: astId,
    status: normalizeUpper(status),
    updatedAt,
  };

  const existingIndex = normalizedBucket.findIndex(
    (item) => item.trnId === astId,
  );

  if (existingIndex >= 0) {
    normalizedBucket[existingIndex] = {
      ...normalizedBucket[existingIndex],
      ...nextServiceItem,
    };
  } else {
    normalizedBucket.push(nextServiceItem);
  }

  return {
    ok: true,
    serviceBucket,
    patch: {
      [`services.${serviceBucket}`]: normalizedBucket,
    },
  };
}

export function sanitizeGps(gps) {
  const lat =
    gps?.lat !== undefined && gps?.lat !== null ? Number(gps.lat) : null;

  const lng =
    gps?.lng !== undefined && gps?.lng !== null ? Number(gps.lng) : null;

  return {
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}

export function sanitizeMedia(media = []) {
  if (!Array.isArray(media)) return [];

  return media.map((item) => ({
    tag: item?.tag || "unlabeled",
    url: item?.url || null,
    type: item?.type || "image",
    gps: sanitizeGps(item?.gps),
    created: {
      at: item?.created?.at || new Date().toISOString(),
      byUser: item?.created?.byUser || "NAv",
      byUid: item?.created?.byUid || "NAv",
    },
    updated: {
      at: item?.updated?.at || item?.created?.at || new Date().toISOString(),
      byUser: item?.updated?.byUser || item?.created?.byUser || "NAv",
      byUid: item?.updated?.byUid || item?.created?.byUid || "NAv",
    },
  }));
}

export function hasMediaTag(media = [], tag, { requireUrl = true } = {}) {
  if (!Array.isArray(media)) return false;

  return media.some((item) => {
    if (item?.tag !== tag) return false;
    if (!requireUrl) return true;
    return Boolean(item?.url);
  });
}

export function validateAssignment(assignment = {}, trnType = "NAv") {
  const instruction = assignment?.instruction || {};
  const createdFor = assignment?.createdFor || {};
  const createdForType = normalizeUpper(createdFor?.type);

  if (!instruction?.code) {
    return {
      ok: false,
      code: "INVALID_ASSIGNMENT_INSTRUCTION_CODE",
      message: "assignment.instruction.code is required",
    };
  }

  if (normalizeUpper(instruction.code) !== normalizeUpper(trnType)) {
    return {
      ok: false,
      code: "ASSIGNMENT_INSTRUCTION_MISMATCH",
      message: "assignment.instruction.code must match accessData.trnType",
    };
  }

  if (!instruction?.text) {
    return {
      ok: false,
      code: "INVALID_ASSIGNMENT_INSTRUCTION_TEXT",
      message: "assignment.instruction.text is required",
    };
  }

  if (!["USER", "TEAM"].includes(createdForType)) {
    return {
      ok: false,
      code: "INVALID_ASSIGNMENT_CREATED_FOR_TYPE",
      message: "assignment.createdFor.type must be USER or TEAM",
    };
  }

  if (!createdFor?.id) {
    return {
      ok: false,
      code: "INVALID_ASSIGNMENT_CREATED_FOR_ID",
      message: "assignment.createdFor.id is required",
    };
  }

  return { ok: true };
}

export function sanitizeAssignment(assignment = {}) {
  return {
    instruction: {
      code: normalizeUpper(assignment?.instruction?.code || "NAv"),
      text: String(assignment?.instruction?.text || ""),
      notes: String(assignment?.instruction?.notes || ""),
      mediaRequired: assignment?.instruction?.mediaRequired === true,
    },

    createdFor: {
      type: normalizeUpper(assignment?.createdFor?.type || "USER"),
      id: String(assignment?.createdFor?.id || "NAv"),
      name: String(assignment?.createdFor?.name || "NAv"),
    },

    acceptedRejectedAt: assignment?.acceptedRejectedAt || null,
    acceptedRejectedUid: assignment?.acceptedRejectedUid || null,
    acceptedRejectedUser: assignment?.acceptedRejectedUser || null,
    rejectReason: String(assignment?.rejectReason || ""),

    cancelledAt: assignment?.cancelledAt || null,
    cancelledByUid: assignment?.cancelledByUid || null,
    cancelledByUser: assignment?.cancelledByUser || null,
    cancelReason: String(assignment?.cancelReason || ""),
  };
}

export function getAstCurrentState(astDoc = {}) {
  return normalizeUpper(astDoc?.status?.state || astDoc?.status || "FIELD");
}

export function getAstMeterType(astDoc = {}, input = {}) {
  return normalizeLower(astDoc?.meterType || input?.meterType || "NAv");
}

export function getAstData(astDoc = {}) {
  return astDoc?.ast?.astData || astDoc?.astData || {};
}

export function getAstMeter(astDoc = {}) {
  return getAstData(astDoc)?.meter || {};
}

export function getAstPrepaidType(astDoc = {}, input = {}) {
  const astMeter = getAstMeter(astDoc);
  const inputMeter = input?.ast?.astData?.meter || {};

  return normalizeMeterKind(astMeter?.type || inputMeter?.type || "");
}

export function validateCommonLifecycleInput(data = {}) {
  const trnId = data?.id || "NAv";
  const trnType = data?.accessData?.trnType || "NAv";
  const astId = data?.ast?.astData?.astId || "NAv";
  const premiseId = data?.accessData?.premise?.id || "NAv";

  if (!data?.id || trnId === "NAv") {
    return {
      ok: false,
      code: "INVALID_TRN_ID",
      message: "TRN id is required",
    };
  }

  if (!data?.accessData) {
    return {
      ok: false,
      code: "INVALID_ACCESS_DATA",
      message: "accessData is required",
    };
  }

  if (!LIFECYCLE_TRN_TYPES.includes(trnType)) {
    return {
      ok: false,
      code: "INVALID_LIFECYCLE_TRN_TYPE",
      message: "Unsupported lifecycle TRN type",
    };
  }

  if (!astId || astId === "NAv") {
    return {
      ok: false,
      code: "INVALID_AST_ID",
      message: "ast.astData.astId is required",
    };
  }

  if (!premiseId || premiseId === "NAv") {
    return {
      ok: false,
      code: "INVALID_PREMISE_ID",
      message: "A valid premise id is required",
    };
  }

  return {
    ok: true,
    trnId,
    trnType,
    astId,
    premiseId,
  };
}

export function getCommissioningAnswer(data = {}, key) {
  return normalizeYesNo(data?.commissioning?.[key]?.answer);
}

export function getCommissioningNotes(data = {}, key) {
  return String(data?.commissioning?.[key]?.notes || "").trim();
}

export function sanitizeCommissioning(commissioning = {}) {
  return {
    vendingConfirmed: {
      answer: normalizeYesNo(commissioning?.vendingConfirmed?.answer),
      notes: String(commissioning?.vendingConfirmed?.notes || ""),
    },

    finalSwitchOnTested: {
      answer: normalizeYesNo(commissioning?.finalSwitchOnTested?.answer),
      notes: String(commissioning?.finalSwitchOnTested?.notes || ""),
    },

    keypadIssued: {
      answer: normalizeYesNo(commissioning?.keypadIssued?.answer),
      notes: String(commissioning?.keypadIssued?.notes || ""),
    },
  };
}

export function validateMeterCommissioning({ data, astDoc }) {
  const currentState = getAstCurrentState(astDoc);
  const meterType = getAstMeterType(astDoc, data);
  const prepaidType = getAstPrepaidType(astDoc, data);
  const isPrepaidMeter = prepaidType === "prepaid";

  const vendingConfirmed = getCommissioningAnswer(data, "vendingConfirmed");
  const finalSwitchOnTested = getCommissioningAnswer(
    data,
    "finalSwitchOnTested",
  );
  const keypadIssued = getCommissioningAnswer(data, "keypadIssued");

  if (currentState !== "FIELD") {
    return {
      ok: false,
      code: "INVALID_AST_STATE",
      message: "Only FIELD meters can be commissioned",
    };
  }

  if (meterType !== "electricity") {
    return {
      ok: false,
      code: "INVALID_METER_TYPE",
      message: "Only electricity meters can be commissioned",
    };
  }

  // All electricity meters must answer final switch-on.
  if (!finalSwitchOnTested) {
    return {
      ok: false,
      code: "INVALID_COMMISSIONING_ANSWERS",
      message: "Final switch-on answer must be yes or no",
    };
  }

  // Prepaid meters must also answer vending and keypad questions.
  if (isPrepaidMeter && (!vendingConfirmed || !keypadIssued)) {
    return {
      ok: false,
      code: "INVALID_COMMISSIONING_ANSWERS",
      message: "Prepaid commissioning requires vending and keypad answers",
    };
  }

  // Prepaid only: vending evidence is required when vending is confirmed.
  if (
    isPrepaidMeter &&
    vendingConfirmed === "yes" &&
    !hasMediaTag(data?.media, COMMISSIONING_MEDIA_TAGS.vendingEvidence, {
      requireUrl: true,
    })
  ) {
    return {
      ok: false,
      code: "MISSING_VENDING_EVIDENCE",
      message: "Vending evidence media is required",
    };
  }

  // All electricity meters: final switch-on evidence is required when tested.
  if (
    finalSwitchOnTested === "yes" &&
    !hasMediaTag(data?.media, COMMISSIONING_MEDIA_TAGS.finalSwitchOnEvidence, {
      requireUrl: true,
    })
  ) {
    return {
      ok: false,
      code: "MISSING_FINAL_SWITCH_ON_EVIDENCE",
      message: "Final switch-on evidence media is required",
    };
  }

  // Prepaid only: keypad evidence is required when keypad was issued.
  if (
    isPrepaidMeter &&
    keypadIssued === "yes" &&
    !hasMediaTag(data?.media, COMMISSIONING_MEDIA_TAGS.keypadIssuedEvidence, {
      requireUrl: true,
    })
  ) {
    return {
      ok: false,
      code: "MISSING_KEYPAD_ISSUED_EVIDENCE",
      message: "Keypad issued evidence media is required",
    };
  }

  const failedAnswers = [["finalSwitchOnTested", finalSwitchOnTested]];

  if (isPrepaidMeter) {
    failedAnswers.push(["vendingConfirmed", vendingConfirmed]);
    failedAnswers.push(["keypadIssued", keypadIssued]);
  }

  const failedAnswerRows = failedAnswers.filter(
    ([, answer]) => answer === "no",
  );

  for (const [key] of failedAnswerRows) {
    if (!getCommissioningNotes(data, key)) {
      return {
        ok: false,
        code: "NOTES_REQUIRED_FOR_FAILED_COMMISSIONING",
        message: `Notes are required when ${key} is no`,
      };
    }
  }

  const commissioningPassed =
    finalSwitchOnTested === "yes" &&
    (!isPrepaidMeter || (vendingConfirmed === "yes" && keypadIssued === "yes"));

  const nextAstState = commissioningPassed ? "CONNECTED" : "FIELD";

  return {
    ok: true,
    currentState,
    meterType,
    prepaidType,
    isPrepaidMeter,
    commissioningPassed,
    nextAstState,
    astStatusChanged: currentState !== nextAstState,
  };
}

export function getRemovalAnswer(data = {}, key) {
  return normalizeYesNo(data?.removal?.[key]?.answer);
}

export function getRemovalNotes(data = {}, key) {
  return String(data?.removal?.[key]?.notes || "").trim();
}

export function sanitizeRemoval(removal = {}) {
  return {
    removalInstruction: {
      text: String(removal?.removalInstruction?.text || ""),
    },

    meterRemoved: {
      answer: normalizeYesNo(removal?.meterRemoved?.answer),
      notes: String(removal?.meterRemoved?.notes || ""),
    },

    finalReading: {
      reading: String(removal?.finalReading?.reading || ""),
      noReadingReason: String(removal?.finalReading?.noReadingReason || ""),
    },

    supplyMadeSafe: {
      answer: normalizeYesNo(removal?.supplyMadeSafe?.answer),
      notes: String(removal?.supplyMadeSafe?.notes || ""),
    },
  };
}

export function validateMeterRemoval({ data, astDoc }) {
  const currentState = getAstCurrentState(astDoc);
  const meterType = getAstMeterType(astDoc, data);

  const meterRemoved = getRemovalAnswer(data, "meterRemoved");
  const supplyMadeSafe = getRemovalAnswer(data, "supplyMadeSafe");

  const finalReading = String(
    data?.removal?.finalReading?.reading || "",
  ).trim();

  const noReadingReason = String(
    data?.removal?.finalReading?.noReadingReason || "",
  ).trim();

  if (currentState === "REMOVED") {
    return {
      ok: false,
      code: "INVALID_AST_STATE",
      message: "This meter has already been removed",
    };
  }

  if (!["electricity", "water"].includes(meterType)) {
    return {
      ok: false,
      code: "INVALID_METER_TYPE",
      message: "Only electricity or water meters can be removed",
    };
  }

  if (!meterRemoved || !supplyMadeSafe) {
    return {
      ok: false,
      code: "INVALID_REMOVAL_ANSWERS",
      message: "Removal requires meterRemoved and supplyMadeSafe answers",
    };
  }

  if (!finalReading && !noReadingReason) {
    return {
      ok: false,
      code: "FINAL_READING_OR_REASON_REQUIRED",
      message: "Final reading or no-reading reason is required",
    };
  }

  if (finalReading && !/^\d+(\.\d+)?$/.test(finalReading)) {
    return {
      ok: false,
      code: "INVALID_FINAL_READING",
      message: "Final reading must be numeric",
    };
  }

  if (
    finalReading &&
    !hasMediaTag(data?.media, REMOVAL_MEDIA_TAGS.finalReadingEvidence, {
      requireUrl: true,
    })
  ) {
    return {
      ok: false,
      code: "MISSING_FINAL_READING_EVIDENCE",
      message: "Final reading evidence media is required",
    };
  }

  if (
    meterRemoved === "yes" &&
    !hasMediaTag(data?.media, REMOVAL_MEDIA_TAGS.removalEvidence, {
      requireUrl: true,
    })
  ) {
    return {
      ok: false,
      code: "MISSING_REMOVAL_EVIDENCE",
      message: "Removal evidence media is required",
    };
  }

  if (
    supplyMadeSafe === "yes" &&
    !hasMediaTag(data?.media, REMOVAL_MEDIA_TAGS.supplySafeEvidence, {
      requireUrl: true,
    })
  ) {
    return {
      ok: false,
      code: "MISSING_SUPPLY_SAFE_EVIDENCE",
      message: "Supply safe evidence media is required",
    };
  }

  const failedAnswers = [
    ["meterRemoved", meterRemoved],
    ["supplyMadeSafe", supplyMadeSafe],
  ].filter(([, answer]) => answer === "no");

  for (const [key] of failedAnswers) {
    if (!getRemovalNotes(data, key)) {
      return {
        ok: false,
        code: "NOTES_REQUIRED_FOR_FAILED_REMOVAL",
        message: `Notes are required when ${key} is no`,
      };
    }
  }

  const removalPassed = meterRemoved === "yes" && supplyMadeSafe === "yes";

  const nextAstState = removalPassed ? "REMOVED" : currentState;

  const astPatch = {};

  if (finalReading) {
    astPatch["ast.meterReading"] = finalReading;
  }

  return {
    ok: true,
    currentState,
    meterType,
    removalPassed,
    nextAstState,
    astPatch,
    astStatusChanged: currentState !== nextAstState,
    astDataChanged: Object.keys(astPatch).length > 0,
  };
}

export function buildLifecycleTrnPayload({
  data,
  astDoc,
  now,
  actorUid,
  actorName,
  statusState,
}) {
  const trnType = data?.accessData?.trnType;
  const astId = data?.ast?.astData?.astId;
  const serverAstData = getAstData(astDoc);
  const inputAstData = data?.ast?.astData || {};

  return removeUndefinedDeep({
    id: data.id,

    accessData: {
      access: {
        hasAccess: data?.accessData?.access?.hasAccess || "yes",
        reason: data?.accessData?.access?.reason || "NAv",
      },

      erfId: astDoc?.accessData?.erfId || data?.accessData?.erfId || "NAv",
      erfNo: astDoc?.accessData?.erfNo || data?.accessData?.erfNo || "NAv",

      parents: astDoc?.accessData?.parents || data?.accessData?.parents || {},

      premise: {
        id:
          astDoc?.accessData?.premise?.id ||
          data?.accessData?.premise?.id ||
          "NAv",
        address:
          astDoc?.accessData?.premise?.address ||
          data?.accessData?.premise?.address ||
          "NAv",
        propertyType:
          astDoc?.accessData?.premise?.propertyType ||
          data?.accessData?.premise?.propertyType ||
          "NAv",
      },

      trnType,
    },

    ast: {
      astData: {
        astId,

        astNo: serverAstData?.astNo || inputAstData?.astNo || "NAv",

        astManufacturer:
          serverAstData?.astManufacturer ||
          inputAstData?.astManufacturer ||
          "NAv",

        astName: serverAstData?.astName || inputAstData?.astName || "NAv",

        meter: serverAstData?.meter || inputAstData?.meter || {},
      },
    },

    commissioning:
      trnType === "METER_COMMISSIONING"
        ? sanitizeCommissioning(data?.commissioning || {})
        : undefined,

    removal:
      trnType === "METER_REMOVAL"
        ? sanitizeRemoval(data?.removal || {})
        : undefined,

    disconnection:
      trnType === "METER_DISCONNECTION"
        ? sanitizeMeterDisconnection(data?.disconnection || {})
        : undefined,

    reconnection:
      trnType === "METER_RECONNECTION"
        ? sanitizeMeterReconnection(data?.reconnection || {})
        : undefined,

    assignment: sanitizeAssignment(data?.assignment || {}),

    meterType: astDoc?.meterType || data?.meterType || "NAv",

    media: sanitizeMedia(data?.media || []),

    status: {
      state: statusState || astDoc?.status?.state || null,
      id: astDoc?.status?.id || data?.status?.id || "NAv",
      detail: astDoc?.status?.detail || data?.status?.detail || "NAv",
    },

    metadata: buildFlatMetadata({
      now,
      actorUid,
      actorName,
    }),

    serviceProvider: astDoc?.serviceProvider ||
      data?.serviceProvider || {
        id: "NAv",
        name: "NAv",
      },
  });
}

// DCN , RCN helpers

function normalizeCodeLabel(value = {}) {
  return {
    code: String(value?.code || "").trim(),
    label: String(value?.label || "").trim(),
  };
}

function getLifecycleReading(data = {}, key) {
  return String(data?.[key]?.meterReading?.reading || "").trim();
}

function getLifecycleNoReadingReason(data = {}, key) {
  return String(data?.[key]?.meterReading?.noReadingReason || "").trim();
}

function isNumericReading(value) {
  return /^\d+(\.\d+)?$/.test(String(value || "").trim());
}

// SANITIZE FUNCTIONS

export function sanitizeMeterDisconnection(disconnection = {}) {
  return {
    instruction: {
      text: String(disconnection?.instruction?.text || ""),
    },

    level: normalizeCodeLabel(disconnection?.level || {}),

    supplyDisconnected: {
      answer: normalizeYesNo(disconnection?.supplyDisconnected?.answer),
      notes: String(disconnection?.supplyDisconnected?.notes || ""),
    },

    meterReading: {
      reading: String(disconnection?.meterReading?.reading || ""),
      noReadingReason: String(
        disconnection?.meterReading?.noReadingReason || "",
      ),
    },
  };
}

export function sanitizeMeterReconnection(reconnection = {}) {
  return {
    instruction: {
      text: String(reconnection?.instruction?.text || ""),
    },

    supplyReconnected: {
      answer: normalizeYesNo(reconnection?.supplyReconnected?.answer),
      notes: String(reconnection?.supplyReconnected?.notes || ""),
    },

    meterReading: {
      reading: String(reconnection?.meterReading?.reading || ""),
      noReadingReason: String(
        reconnection?.meterReading?.noReadingReason || "",
      ),
    },
  };
}

// validation functions

export function validateMeterDisconnection({ data, astDoc }) {
  const currentState = getAstCurrentState(astDoc);
  const meterType = getAstMeterType(astDoc, data);

  const disconnection = data?.disconnection || {};

  const instructionText = String(disconnection?.instruction?.text || "").trim();

  const level = normalizeCodeLabel(disconnection?.level || {});
  const levelConfig = DISCONNECTION_LEVELS[level.code];

  const supplyDisconnected = normalizeYesNo(
    disconnection?.supplyDisconnected?.answer,
  );

  const supplyDisconnectedNotes = String(
    disconnection?.supplyDisconnected?.notes || "",
  ).trim();

  const meterReading = getLifecycleReading(data, "disconnection");
  const noReadingReason = getLifecycleNoReadingReason(data, "disconnection");

  if (currentState !== "CONNECTED") {
    return {
      ok: false,
      code: "INVALID_AST_STATE",
      message: "Only CONNECTED meters can be disconnected",
    };
  }

  if (!["electricity", "water"].includes(meterType)) {
    return {
      ok: false,
      code: "INVALID_METER_TYPE",
      message: "Only electricity or water meters can be disconnected",
    };
  }

  if (!instructionText) {
    return {
      ok: false,
      code: "DISCONNECTION_INSTRUCTION_REQUIRED",
      message: "Disconnection instruction is required",
    };
  }

  if (
    !hasMediaTag(data?.media, DISCONNECTION_MEDIA_TAGS.instructionEvidence, {
      requireUrl: true,
    })
  ) {
    return {
      ok: false,
      code: "MISSING_DISCONNECTION_INSTRUCTION_EVIDENCE",
      message: "Disconnection instruction evidence media is required",
    };
  }

  if (!level.code || !levelConfig) {
    return {
      ok: false,
      code: "INVALID_DISCONNECTION_LEVEL",
      message: "Valid disconnection level is required",
    };
  }

  if (!supplyDisconnected) {
    return {
      ok: false,
      code: "INVALID_DISCONNECTION_ANSWER",
      message: "Supply disconnected answer must be yes or no",
    };
  }

  if (!meterReading && !noReadingReason) {
    return {
      ok: false,
      code: "METER_READING_OR_REASON_REQUIRED",
      message: "Meter reading or no-reading reason is required",
    };
  }

  if (meterReading && !isNumericReading(meterReading)) {
    return {
      ok: false,
      code: "INVALID_METER_READING",
      message: "Meter reading must be numeric",
    };
  }

  if (
    meterReading &&
    !hasMediaTag(data?.media, DISCONNECTION_MEDIA_TAGS.meterReadingEvidence, {
      requireUrl: true,
    })
  ) {
    return {
      ok: false,
      code: "MISSING_DISCONNECTION_READING_EVIDENCE",
      message: "Disconnection meter reading evidence media is required",
    };
  }

  if (
    supplyDisconnected === "yes" &&
    !hasMediaTag(data?.media, DISCONNECTION_MEDIA_TAGS.levelEvidence, {
      requireUrl: true,
    })
  ) {
    return {
      ok: false,
      code: "MISSING_DISCONNECTION_LEVEL_EVIDENCE",
      message: "Disconnection level evidence media is required",
    };
  }

  if (supplyDisconnected === "no" && !supplyDisconnectedNotes) {
    return {
      ok: false,
      code: "NOTES_REQUIRED_FOR_FAILED_DISCONNECTION",
      message: "Notes are required when supplyDisconnected is no",
    };
  }

  const disconnectionPassed = supplyDisconnected === "yes";
  const nextAstState = disconnectionPassed ? "DISCONNECTED" : currentState;

  const astPatch = {};

  if (meterReading) {
    astPatch["ast.meterReading"] = meterReading;
  }

  return {
    ok: true,
    currentState,
    meterType,
    disconnectionPassed,
    disconnectionLevel: {
      code: levelConfig.code,
      label: levelConfig.label,
    },
    nextAstState,
    astPatch,
    astStatusChanged: currentState !== nextAstState,
    astDataChanged: Object.keys(astPatch).length > 0,
  };
}

export function validateMeterReconnection({ data, astDoc }) {
  const currentState = getAstCurrentState(astDoc);
  const meterType = getAstMeterType(astDoc, data);

  const reconnection = data?.reconnection || {};

  const instructionText = String(reconnection?.instruction?.text || "").trim();

  const supplyReconnected = normalizeYesNo(
    reconnection?.supplyReconnected?.answer,
  );

  const supplyReconnectedNotes = String(
    reconnection?.supplyReconnected?.notes || "",
  ).trim();

  const meterReading = getLifecycleReading(data, "reconnection");
  const noReadingReason = getLifecycleNoReadingReason(data, "reconnection");

  if (currentState !== "DISCONNECTED") {
    return {
      ok: false,
      code: "INVALID_AST_STATE",
      message: "Only DISCONNECTED meters can be reconnected",
    };
  }

  if (!["electricity", "water"].includes(meterType)) {
    return {
      ok: false,
      code: "INVALID_METER_TYPE",
      message: "Only electricity or water meters can be reconnected",
    };
  }

  if (!instructionText) {
    return {
      ok: false,
      code: "RECONNECTION_INSTRUCTION_REQUIRED",
      message: "Reconnection instruction is required",
    };
  }

  if (
    !hasMediaTag(data?.media, RECONNECTION_MEDIA_TAGS.instructionEvidence, {
      requireUrl: true,
    })
  ) {
    return {
      ok: false,
      code: "MISSING_RECONNECTION_INSTRUCTION_EVIDENCE",
      message: "Reconnection instruction evidence media is required",
    };
  }

  if (!supplyReconnected) {
    return {
      ok: false,
      code: "INVALID_RECONNECTION_ANSWER",
      message: "Supply reconnected answer must be yes or no",
    };
  }

  if (!meterReading && !noReadingReason) {
    return {
      ok: false,
      code: "METER_READING_OR_REASON_REQUIRED",
      message: "Meter reading or no-reading reason is required",
    };
  }

  if (meterReading && !isNumericReading(meterReading)) {
    return {
      ok: false,
      code: "INVALID_METER_READING",
      message: "Meter reading must be numeric",
    };
  }

  if (
    meterReading &&
    !hasMediaTag(data?.media, RECONNECTION_MEDIA_TAGS.meterReadingEvidence, {
      requireUrl: true,
    })
  ) {
    return {
      ok: false,
      code: "MISSING_RECONNECTION_READING_EVIDENCE",
      message: "Reconnection meter reading evidence media is required",
    };
  }

  if (
    supplyReconnected === "yes" &&
    !hasMediaTag(data?.media, RECONNECTION_MEDIA_TAGS.reconnectionEvidence, {
      requireUrl: true,
    })
  ) {
    return {
      ok: false,
      code: "MISSING_RECONNECTION_EVIDENCE",
      message: "Reconnection evidence media is required",
    };
  }

  if (supplyReconnected === "no" && !supplyReconnectedNotes) {
    return {
      ok: false,
      code: "NOTES_REQUIRED_FOR_FAILED_RECONNECTION",
      message: "Notes are required when supplyReconnected is no",
    };
  }

  const reconnectionPassed = supplyReconnected === "yes";
  const nextAstState = reconnectionPassed ? "CONNECTED" : currentState;

  const astPatch = {};

  if (meterReading) {
    astPatch["ast.meterReading"] = meterReading;
  }

  return {
    ok: true,
    currentState,
    meterType,
    reconnectionPassed,
    nextAstState,
    astPatch,
    astStatusChanged: currentState !== nextAstState,
    astDataChanged: Object.keys(astPatch).length > 0,
  };
}

// new LCT helpers

export function sanitizeGeofenceRefs(geofenceRefs = []) {
  if (!Array.isArray(geofenceRefs)) return [];

  return geofenceRefs
    .map((item) => ({
      id: String(item?.id || "").trim(),
      name: String(item?.name || "").trim(),
    }))
    .filter((item) => item.id && item.name);
}

export function validateCreateLifecycleInstructionInput(data = {}) {
  const trnId = String(data?.id || "").trim();
  const trnType = normalizeUpper(
    data?.trnType || data?.accessData?.trnType || "",
  );
  const astId = String(data?.astId || data?.ast?.astData?.astId || "").trim();
  const premiseId = String(
    data?.premiseId || data?.accessData?.premise?.id || "",
  ).trim();

  if (!trnId) {
    return {
      ok: false,
      code: "INVALID_TRN_ID",
      message: "TRN id is required",
    };
  }

  if (!OFFICE_LCT_INSTRUCTION_TRN_TYPES.includes(trnType)) {
    return {
      ok: false,
      code: "INVALID_OFFICE_LCT_TYPE",
      message:
        "Only INSPECTION, DISCONNECTION, RECONNECTION and REMOVAL instructions can be created from Operations.",
    };
  }

  if (!astId) {
    return {
      ok: false,
      code: "INVALID_AST_ID",
      message: "astId is required",
    };
  }

  if (!premiseId) {
    return {
      ok: false,
      code: "INVALID_PREMISE_ID",
      message: "premiseId is required",
    };
  }

  return {
    ok: true,
    trnId,
    trnType,
    astId,
    premiseId,
  };
}

export function validateLifecycleInstructionAssignment(
  assignment = {},
  trnType = "NAv",
) {
  const instruction = assignment?.instruction || {};
  const createdFor = assignment?.createdFor || {};
  const createdForType = normalizeUpper(createdFor?.type);

  if (!instruction?.code) {
    return {
      ok: false,
      code: "INVALID_ASSIGNMENT_INSTRUCTION_CODE",
      message: "assignment.instruction.code is required",
    };
  }

  if (normalizeUpper(instruction.code) !== normalizeUpper(trnType)) {
    return {
      ok: false,
      code: "ASSIGNMENT_INSTRUCTION_MISMATCH",
      message: "assignment.instruction.code must match trnType",
    };
  }

  if (!String(instruction?.text || "").trim()) {
    return {
      ok: false,
      code: "INVALID_ASSIGNMENT_INSTRUCTION_TEXT",
      message: "assignment.instruction.text is required",
    };
  }

  if (!["USER", "TEAM"].includes(createdForType)) {
    return {
      ok: false,
      code: "INVALID_ASSIGNMENT_CREATED_FOR_TYPE",
      message: "assignment.createdFor.type must be USER or TEAM",
    };
  }

  if (!String(createdFor?.id || "").trim()) {
    return {
      ok: false,
      code: "INVALID_ASSIGNMENT_CREATED_FOR_ID",
      message: "assignment.createdFor.id is required",
    };
  }

  if (!String(createdFor?.name || "").trim()) {
    return {
      ok: false,
      code: "INVALID_ASSIGNMENT_CREATED_FOR_NAME",
      message: "assignment.createdFor.name is required",
    };
  }

  return { ok: true };
}

export function validateLifecycleInstructionEligibility({ trnType, astDoc }) {
  const currentState = getAstCurrentState(astDoc);

  if (trnType === "METER_INSPECTION") {
    if (currentState === "REMOVED") {
      return {
        ok: false,
        code: "INVALID_AST_STATE",
        message: "REMOVED meters cannot be issued for inspection",
      };
    }

    return { ok: true };
  }

  if (trnType === "METER_DISCONNECTION") {
    if (currentState !== "CONNECTED") {
      return {
        ok: false,
        code: "INVALID_AST_STATE",
        message: "Only CONNECTED meters can be issued for disconnection",
      };
    }

    return { ok: true };
  }

  if (trnType === "METER_RECONNECTION") {
    if (currentState !== "DISCONNECTED") {
      return {
        ok: false,
        code: "INVALID_AST_STATE",
        message: "Only DISCONNECTED meters can be issued for reconnection",
      };
    }

    return { ok: true };
  }

  if (trnType === "METER_REMOVAL") {
    if (currentState === "REMOVED") {
      return {
        ok: false,
        code: "INVALID_AST_STATE",
        message: "This meter has already been removed",
      };
    }

    return { ok: true };
  }

  return {
    ok: false,
    code: "INVALID_OFFICE_LCT_TYPE",
    message: "Unsupported lifecycle instruction type",
  };
}

export function sanitizeWorkorderRef(workorder = {}) {
  const id = String(workorder?.id || "").trim();
  const type = normalizeUpper(
    workorder?.type || (id ? "WORKORDER" : "GENERAL"),
  );
  const createdMode = normalizeUpper(
    workorder?.createdMode || (id ? "MASS" : "INDIVIDUAL"),
  );

  return {
    id: id || null,
    name: String(workorder?.name || (id ? id : "General")).trim(),
    type: ["GENERAL", "WORKORDER"].includes(type) ? type : "GENERAL",
    createdMode: ["INDIVIDUAL", "MASS"].includes(createdMode)
      ? createdMode
      : "INDIVIDUAL",
  };
}

export function buildLifecycleInstructionTrnPayload({
  data,
  astDoc,
  premiseData,
  now,
  actorUid,
  actorName,
}) {
  const trnType = normalizeUpper(
    data?.trnType || data?.accessData?.trnType || "",
  );

  const astId = String(data?.astId || data?.ast?.astData?.astId || "").trim();
  const serverAstData = getAstData(astDoc);
  const geofenceRefs = sanitizeGeofenceRefs(data?.geofenceRefs || []);

  const assignment = data?.assignment || {};

  return removeUndefinedDeep({
    id: data.id,

    accessData: {
      access: {
        hasAccess: data?.accessData?.access?.hasAccess || "yes",
        reason: data?.accessData?.access?.reason || "NAv",
      },

      erfId: astDoc?.accessData?.erfId || premiseData?.erfId || "NAv",
      erfNo: astDoc?.accessData?.erfNo || premiseData?.erfNo || "NAv",

      parents: astDoc?.accessData?.parents || premiseData?.parents || {},

      premise: {
        id:
          astDoc?.accessData?.premise?.id ||
          data?.premiseId ||
          premiseData?.id ||
          "NAv",

        address:
          astDoc?.accessData?.premise?.address ||
          data?.accessData?.premise?.address ||
          "NAv",

        propertyType:
          astDoc?.accessData?.premise?.propertyType ||
          data?.accessData?.premise?.propertyType ||
          "NAv",
      },

      trnType,
    },

    assignment: {
      instruction: {
        code: normalizeUpper(assignment?.instruction?.code || trnType),
        text: String(assignment?.instruction?.text || ""),
        notes: String(assignment?.instruction?.notes || ""),
        mediaRequired: assignment?.instruction?.mediaRequired === true,
      },

      createdFor: {
        type: normalizeUpper(assignment?.createdFor?.type || "USER"),
        id: String(assignment?.createdFor?.id || "NAv"),
        name: String(assignment?.createdFor?.name || "NAv"),
      },

      acceptedRejectedAt: null,
      acceptedRejectedUid: null,
      acceptedRejectedUser: null,
      rejectReason: "",

      cancelledAt: null,
      cancelledByUid: null,
      cancelledByUser: null,
      cancelReason: "",
    },

    workflow: {
      state: "ISSUED",
      createdMode: "OFFICE",
      reassignmentCount: 0,
      executionStartedAt: null,
      completedAt: null,
      completedByUid: null,
      completedByUser: null,
    },

    assignmentHistory: [],

    geofenceRefs,

    ast: {
      astData: {
        astId,
        astNo: serverAstData?.astNo || "NAv",
        astManufacturer: serverAstData?.astManufacturer || "NAv",
        astName: serverAstData?.astName || "NAv",
        meter: serverAstData?.meter || {},
      },
    },

    meterType: astDoc?.meterType || data?.meterType || "NAv",

    commissioning: null,
    removal: null,
    disconnection: null,
    reconnection: null,
    inspection: null,

    media: [],

    status: {
      state: astDoc?.status?.state || null,
      id: astDoc?.status?.id || data?.status?.id || "NAv",
      detail: astDoc?.status?.detail || data?.status?.detail || "NAv",
    },

    serviceProvider: astDoc?.serviceProvider ||
      data?.serviceProvider || {
        id: "NAv",
        name: "NAv",
      },

    workorder: sanitizeWorkorderRef(data?.workorder || {}),

    metadata: buildFlatMetadata({
      now,
      actorUid,
      actorName,
    }),
  });
}
