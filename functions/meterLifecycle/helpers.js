const NOW_FALLBACK_USER = "SYSTEM";

// All meter lifecycle-family TRN types known to the platform.
// Note: METER_COMMISSIONING is valid, but it is handled by
// functions/commissioning/, not by the generic meterLifecycle callable.
export const LIFECYCLE_TRN_TYPES = [
  "METER_COMMISSIONING",
  "METER_INSPECTION",
  "METER_DISCONNECTION",
  "METER_RECONNECTION",
  "METER_REMOVAL",
  "METER_READING",
  "METER_VENDING",
];

export const IMPLEMENTED_LIFECYCLE_TRN_TYPES = [
  "METER_INSPECTION",
  "METER_REMOVAL",
  "METER_DISCONNECTION",
  "METER_RECONNECTION",
  "METER_READING",
];
export const OFFICE_LCT_INSTRUCTION_TRN_TYPES = [
  "METER_INSPECTION",
  "METER_DISCONNECTION",
  "METER_RECONNECTION",
  "METER_REMOVAL",
  "METER_READING",
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
  removalEvidence: "removalEvidence",
  meterReadingEvidence: "removalMeterReadingEvidence",
  tokenReadingPhoto: "tokenReadingPhoto",
  safetyEvidence: "safetyEvidence",
  noAccessPhoto: "noAccessPhoto",
};

export const METER_READING_MEDIA_TAGS = {
  meterReadingEvidence: "meterReadingEvidence",
  tokenReadingPhoto: "tokenReadingPhoto",
  noAccessPhoto: "noAccessPhoto",
  noReadingEvidence: "noReadingEvidence",
};

export const INSPECTION_MEDIA_TAGS = {
  astNoPhoto: "astNoPhoto",
  anomalyPhoto: "anomalyPhoto",
  normalisationPhoto: "normalisationPhoto",
  meterReadingPhoto: "meterReadingPhoto",
  noAccessPhoto: "noAccessPhoto",
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
  levelEvidence: "disconnectionLevelEvidence",
  previousDraftLevelEvidence: "levelEvidence",
  meterReadingEvidence: "disconnectionMeterReadingEvidence",
  tokenReadingPhoto: "tokenReadingPhoto",
  safetyEvidence: "safetyEvidence",
  noAccessPhoto: "noAccessPhoto",
};

export const RECONNECTION_MEDIA_TAGS = {
  reconnectionEvidence: "reconnectionEvidence",
  meterReadingEvidence: "reconnectionMeterReadingEvidence",
  tokenReadingPhoto: "tokenReadingPhoto",
  safetyEvidence: "safetyEvidence",
  noAccessPhoto: "noAccessPhoto",
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

export function buildFlatUpdateMetadata({ now, actorUid, actorName }) {
  return {
    updatedAt: now,
    updatedByUid: actorUid || NOW_FALLBACK_USER,
    updatedByUser: actorName || NOW_FALLBACK_USER,
  };
}

function normalizeTrnActiveLifecycleAssignedTo(assignedTo = {}) {
  return {
    type: normalizeUpper(assignedTo?.type || "NAv"),
    id: String(assignedTo?.id || "NAv").trim() || "NAv",
    name:
      String(
        assignedTo?.name || assignedTo?.title || assignedTo?.id || "NAv",
      ).trim() || "NAv",
  };
}

export function buildTrnActiveLifecycle({
  trnId,
  trnType,
  workflowState,
  outcome = "NAv",
  assignedTo = {},
  updatedAt,
  updatedByUser,
}) {
  return {
    trnId: trnId || "NAv",
    trnType: normalizeUpper(trnType || "NAv"),
    workflowState: normalizeUpper(workflowState || "NAv"),
    outcome: normalizeUpper(outcome || "NAv"),
    assignedTo: normalizeTrnActiveLifecycleAssignedTo(assignedTo),
    updatedAt: updatedAt || null,
    updatedByUser: updatedByUser || NOW_FALLBACK_USER,
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

function normalizeAssignmentTarget(target = {}) {
  return {
    type: normalizeUpper(target?.type || ""),
    id: String(target?.id || "").trim(),
    name: String(target?.name || target?.title || target?.id || "").trim(),
  };
}

export function normalizeAssignmentTargets(assignment = {}) {
  const targets = Array.isArray(assignment?.targets) ? assignment.targets : [];

  return targets
    .map(normalizeAssignmentTarget)
    .filter(
      (target) =>
        ["USER", "TEAM", "SP"].includes(target.type) &&
        Boolean(target.id) &&
        Boolean(target.name),
    );
}

export function validateAssignment(assignment = {}, trnType = "NAv") {
  const instruction = assignment?.instruction || {};
  const targets = normalizeAssignmentTargets(assignment);

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

  if (
    !String(instruction?.text || "").trim() &&
    normalizeUpper(trnType) !== "METER_READING"
  ) {
    return {
      ok: false,
      code: "INVALID_ASSIGNMENT_INSTRUCTION_TEXT",
      message: "assignment.instruction.text is required",
    };
  }

  if (targets.length === 0) {
    return {
      ok: false,
      code: "INVALID_ASSIGNMENT_TARGETS",
      message:
        "assignment.targets must contain at least one USER, TEAM, or SP target",
    };
  }

  return { ok: true };
}

export function sanitizeAssignment(assignment = {}) {
  return {
    targets: normalizeAssignmentTargets(assignment),

    instruction: {
      code: normalizeUpper(assignment?.instruction?.code || "NAv"),
      text: String(assignment?.instruction?.text || ""),
      notes: String(assignment?.instruction?.notes || ""),
      mediaRequired: assignment?.instruction?.mediaRequired === true,
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
  const inputMeter =
    input?.ast?.astData?.meter ||
    input?.inspection?.captured?.ast?.astData?.meter ||
    {};

  return normalizeMeterKind(astMeter?.type || inputMeter?.type || "");
}

export function isPrepaidAstMeter(astDoc = {}, input = {}) {
  return getAstPrepaidType(astDoc, input) === "prepaid";
}

export function isConventionalAstMeter(astDoc = {}, input = {}) {
  return ["conventional", "postpaid", "credit"].includes(
    getAstPrepaidType(astDoc, input),
  );
}

export function isKnownAstMeterKind(astDoc = {}, input = {}) {
  const meterKind = getAstPrepaidType(astDoc, input);

  return ["prepaid", "conventional", "postpaid", "credit"].includes(meterKind);
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

export function sanitizeRemoval(
  removal = {},
  { isPrepaidMeter = false, noAccess = false } = {},
) {
  if (noAccess) {
    return {
      meterRemoved: {
        answer: null,
        notes: "",
      },

      meterReading: "",
      tokenReading: "",
      noReadingReason: "",

      safetyConfirmed: {
        answer: null,
        notes: "",
      },
    };
  }

  return {
    meterRemoved: {
      answer: normalizeYesNo(removal?.meterRemoved?.answer),
      notes: String(removal?.meterRemoved?.notes || ""),
    },

    meterReading: isPrepaidMeter
      ? ""
      : getFlatOrNestedReading(removal, "meterReading"),

    tokenReading: isPrepaidMeter ? String(removal?.tokenReading || "") : "",

    noReadingReason: selectValueToText(removal?.noReadingReason),

    safetyConfirmed: {
      answer: normalizeYesNo(removal?.safetyConfirmed?.answer),
      notes: String(removal?.safetyConfirmed?.notes || ""),
    },
  };
}

export function sanitizeMeterReading(
  meterReading = {},
  { isPrepaidMeter = false, noAccess = false } = {},
) {
  if (noAccess) {
    return {
      reading: "",
      tokenReading: "",
      readingAt: "",
      noReadingReason: "",
      readingGps: null,
      executorNotes: "",
    };
  }

  return {
    reading: isPrepaidMeter ? "" : String(meterReading?.reading || "").trim(),
    tokenReading: isPrepaidMeter
      ? String(meterReading?.tokenReading || "").trim()
      : "",
    readingAt: String(meterReading?.readingAt || "").trim(),
    noReadingReason: selectValueToText(meterReading?.noReadingReason),
    readingGps: sanitizeGps(meterReading?.readingGps || {}),
    executorNotes: String(meterReading?.executorNotes || "").trim(),
  };
}

function getMeterReadingPayload(data = {}) {
  return data?.meterReading || {};
}

function getMeterReadingValue(data = {}) {
  return String(getMeterReadingPayload(data)?.reading || "").trim();
}

function getMeterReadingTokenValue(data = {}) {
  return String(getMeterReadingPayload(data)?.tokenReading || "").trim();
}

function getMeterReadingNoReadingReason(data = {}) {
  return selectValueToText(getMeterReadingPayload(data)?.noReadingReason);
}

function getMeterReadingAt(data = {}) {
  return String(getMeterReadingPayload(data)?.readingAt || "").trim();
}

function getMeterReadingGps(data = {}) {
  return sanitizeGps(getMeterReadingPayload(data)?.readingGps || {});
}

function hasValidGps(gps = {}) {
  return Number.isFinite(Number(gps?.lat)) && Number.isFinite(Number(gps?.lng));
}

function getKnownMeterGps(astDoc = {}, data = {}) {
  return sanitizeGps(
    astDoc?.ast?.location?.gps ||
      astDoc?.location?.gps ||
      data?.ast?.location?.gps ||
      {},
  );
}

function degreesToRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

function calculateDistanceMeters(pointA = {}, pointB = {}) {
  if (!hasValidGps(pointA) || !hasValidGps(pointB)) return null;

  const earthRadiusMeters = 6371000;
  const lat1 = degreesToRadians(pointA.lat);
  const lat2 = degreesToRadians(pointB.lat);
  const deltaLat = degreesToRadians(pointB.lat - pointA.lat);
  const deltaLng = degreesToRadians(pointB.lng - pointA.lng);

  const haversine =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);

  const centralAngle =
    2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));

  return earthRadiusMeters * centralAngle;
}

function buildLatestMreadingsCache({ astDoc = {}, reading, readingAt, trnId }) {
  const currentReadings = Array.isArray(astDoc?.mreadings)
    ? astDoc.mreadings
    : [];

  const nextReading = {
    reading: String(reading || "").trim(),
    readingAt: String(readingAt || "").trim(),
    trnId: String(trnId || "NAv").trim(),
  };

  const merged = [
    nextReading,
    ...currentReadings.filter(
      (item) => String(item?.trnId || "") !== nextReading.trnId,
    ),
  ]
    .filter((item) => item?.reading && item?.readingAt && item?.trnId)
    .sort((a, b) => String(b.readingAt).localeCompare(String(a.readingAt)));

  return merged.slice(0, 100);
}

export function validateMeterReading({ data, astDoc }) {
  const currentState = getAstCurrentState(astDoc);
  const meterType = getAstMeterType(astDoc, data);
  const isPrepaidMeter = isPrepaidAstMeter(astDoc, data);

  const noAccess = isNoAccessExecution(data);
  const noAccessReason = getNoAccessReason(data);

  const instructionText = String(
    data?.assignment?.instruction?.text || "",
  ).trim();

  const reading = getMeterReadingValue(data);
  const tokenReading = getMeterReadingTokenValue(data);
  const noReadingReason = getMeterReadingNoReadingReason(data);
  const readingAt = getMeterReadingAt(data);
  const readingGps = getMeterReadingGps(data);
  const knownMeterGps = getKnownMeterGps(astDoc, data);

  const distanceMeters = 4; // TEMP REMOTE TEST CHEAT
  // const distanceMeters = calculateDistanceMeters(knownMeterGps, readingGps);

  if (currentState === "DECOMMISSIONED") {
    return {
      ok: false,
      code: "INVALID_AST_STATE",
      message: "DECOMMISSIONED meters cannot be read",
    };
  }

  if (!["electricity", "water"].includes(meterType)) {
    return {
      ok: false,
      code: "INVALID_METER_TYPE",
      message: "Only electricity or water meters can be read",
    };
  }

  if (isPrepaidMeter) {
    return {
      ok: false,
      code: "PREPAID_MREAD_NOT_SUPPORTED",
      message: "MREAD Sprint 1 supports conventional meters only",
    };
  }

  if (!instructionText && normalizeUpper(data?.origin?.channel) === "OFFICE") {
    return {
      ok: false,
      code: "METER_READING_INSTRUCTION_REQUIRED",
      message: "Meter reading instruction is required",
    };
  }

  if (noAccess) {
    if (!noAccessReason || noAccessReason === "NAv") {
      return {
        ok: false,
        code: "NO_ACCESS_REASON_REQUIRED",
        message: "No-access reason is required",
      };
    }

    if (
      !hasMediaTag(data?.media, METER_READING_MEDIA_TAGS.noAccessPhoto, {
        requireUrl: true,
      })
    ) {
      return {
        ok: false,
        code: "MISSING_NO_ACCESS_PHOTO",
        message: "No access photo is required",
      };
    }

    return {
      ok: true,
      currentState,
      meterType,
      isPrepaidMeter,
      readingPassed: false,
      executionOutcome: {
        outcome: "NO_ACCESS",
        success: false,
      },
      nextAstState: currentState,
      astPatch: {},
      astStatusChanged: false,
      astDataChanged: false,
      distanceMeters,
    };
  }

  if (tokenReading) {
    return {
      ok: false,
      code: "TOKEN_READING_NOT_SUPPORTED",
      message: "Token readings are not supported in MREAD Sprint 1",
    };
  }

  if (!reading && !noReadingReason) {
    return {
      ok: false,
      code: "METER_READING_OR_REASON_REQUIRED",
      message: "Meter reading or no-reading reason is required",
    };
  }

  if (reading && !isNumericReading(reading)) {
    return {
      ok: false,
      code: "INVALID_METER_READING",
      message: "Meter reading must be numeric",
    };
  }

  if (!readingAt) {
    return {
      ok: false,
      code: "METER_READING_AT_REQUIRED",
      message: "Reading date/time is required",
    };
  }

  if (!hasValidGps(knownMeterGps)) {
    return {
      ok: false,
      code: "KNOWN_METER_GPS_REQUIRED",
      message: "Known meter GPS is required for MREAD",
    };
  }

  if (!hasValidGps(readingGps)) {
    return {
      ok: false,
      code: "READING_GPS_REQUIRED",
      message: "Reading GPS is required",
    };
  }

  if (distanceMeters === null || distanceMeters > 5) {
    return {
      ok: false,
      code: "READING_GPS_TOO_FAR",
      message: "You must be next to the meter to capture this reading",
      distanceMeters,
      maxDistanceMeters: 5,
    };
  }

  if (
    reading &&
    !hasMediaTag(data?.media, METER_READING_MEDIA_TAGS.meterReadingEvidence, {
      requireUrl: true,
    })
  ) {
    return {
      ok: false,
      code: "MISSING_METER_READING_EVIDENCE",
      message: "Meter reading evidence is required",
    };
  }

  if (noReadingReason) {
    return {
      ok: true,
      currentState,
      meterType,
      isPrepaidMeter,
      readingPassed: false,
      executionOutcome: {
        outcome: "NO_READING",
        success: false,
      },
      nextAstState: currentState,
      astPatch: {},
      astStatusChanged: false,
      astDataChanged: false,
      distanceMeters,
    };
  }

  const astPatch = {
    mreadings: buildLatestMreadingsCache({
      astDoc,
      reading,
      readingAt,
      trnId: data?.id,
    }),
  };

  return {
    ok: true,
    currentState,
    meterType,
    isPrepaidMeter,
    readingPassed: true,
    executionOutcome: {
      outcome: "SUCCESS",
      success: true,
    },
    nextAstState: currentState,
    astPatch,
    astStatusChanged: false,
    astDataChanged: true,
    distanceMeters,
  };
}

function getInspectionPayload(data = {}) {
  return data?.inspection || {};
}

function getInspectionCapturedAst(data = {}) {
  return getInspectionPayload(data)?.captured?.ast || {};
}

function getInspectionCapturedMreading(data = {}) {
  return getInspectionPayload(data)?.captured?.mreading || {};
}

function getInspectionNormalisationAction(data = {}) {
  const normalisation = getInspectionCapturedAst(data)?.normalisation || {};
  const selectCode = normalizeUpper(normalisation?.actionSelect?.code || "");
  const actionTaken = normalizeUpper(normalisation?.actionTaken || "");

  return selectCode || actionTaken || "NONE";
}

function getInspectionAnomalyCode(data = {}) {
  const anomalies = getInspectionCapturedAst(data)?.anomalies || {};
  const selectCode = normalizeUpper(anomalies?.anomalySelect?.code || "");
  const anomaly = normalizeUpper(anomalies?.anomaly || "");

  return selectCode || anomaly || "";
}

function normalizeInspectionOptionalText(value) {
  const clean = String(value || "").trim();
  const cleanUpper = normalizeUpper(clean);

  if (!clean || cleanUpper === "NAV" || cleanUpper === "N/AV") {
    return "";
  }

  return clean;
}

function normalizeInspectionOptionalSelectText(value) {
  return normalizeInspectionOptionalText(selectValueToText(value));
}

function getInspectionReadingValue(data = {}) {
  return normalizeInspectionOptionalText(
    getInspectionCapturedMreading(data)?.reading,
  );
}

function getInspectionReadingAt(data = {}) {
  return normalizeInspectionOptionalText(
    getInspectionCapturedMreading(data)?.readingAt,
  );
}

function getInspectionNoReadingReason(data = {}) {
  return normalizeInspectionOptionalSelectText(
    getInspectionCapturedMreading(data)?.noReadingReason,
  );
}

function isElectricityMeterType(value) {
  const clean = normalizeLower(value).replace(/[\s_-]/g, "");
  return ["electricity", "elec", "elc"].includes(clean);
}

function isWaterMeterType(value) {
  const clean = normalizeLower(value).replace(/[\s_-]/g, "");
  return ["water", "wtr"].includes(clean);
}

function sanitizeInspectionCapturedAst(
  capturedAst = {},
  { meterType = "NAv" } = {},
) {
  const astData = capturedAst?.astData || {};
  const meter = astData?.meter || {};
  const isElectricityMeter = isElectricityMeterType(meterType);

  const sanitizedMeter = {
    type: String(meter?.type || "").trim(),
    category: String(meter?.category || "").trim(),
  };

  if (isElectricityMeter) {
    sanitizedMeter.phase = String(meter?.phase || "").trim();

    sanitizedMeter.cb = {
      size: String(meter?.cb?.size || "").trim(),
      comment: String(meter?.cb?.comment || "").trim(),
    };

    sanitizedMeter.seal = {
      sealNo: String(meter?.seal?.sealNo || "").trim(),
      comment: String(meter?.seal?.comment || "").trim(),
    };

    sanitizedMeter.keypad = {
      serialNo: String(meter?.keypad?.serialNo || "").trim(),
      comment: String(meter?.keypad?.comment || "").trim(),
    };
  }

  const sanitizedAst = {
    astData: {
      astId: String(astData?.astId || "").trim(),
      astNo: String(astData?.astNo || "").trim(),
      astManufacturer: String(astData?.astManufacturer || "").trim(),
      astName: String(astData?.astName || "").trim(),
      meter: sanitizedMeter,
    },

    anomalies: {
      anomaly: String(capturedAst?.anomalies?.anomaly || "").trim(),
      anomalyDetail: String(capturedAst?.anomalies?.anomalyDetail || "").trim(),
    },

    location: {
      gps: sanitizeGps(capturedAst?.location?.gps || {}),
    },

    meterReading: String(capturedAst?.meterReading || "").trim(),

    normalisation: {
      actionTaken: normalizeUpper(
        capturedAst?.normalisation?.actionTaken ||
          capturedAst?.normalisation?.actionSelect?.code ||
          "NONE",
      ),
      actionText:
        selectValueToText(capturedAst?.normalisation?.actionSelect) ||
        String(capturedAst?.normalisation?.actionText || "None").trim(),
      childTrnId: String(
        capturedAst?.normalisation?.childTrnId || "NAv",
      ).trim(),
      childTrnType: normalizeUpper(
        capturedAst?.normalisation?.childTrnType || "NAv",
      ),
      childTrnStatus: normalizeUpper(
        capturedAst?.normalisation?.childTrnStatus || "NOT_REQUIRED",
      ),
    },
  };

  if (isElectricityMeter) {
    sanitizedAst.location.placement = String(
      capturedAst?.location?.placement || "",
    ).trim();

    sanitizedAst.ogs = {
      hasOffGridSupply: String(capturedAst?.ogs?.hasOffGridSupply || "").trim(),
    };
  }

  return sanitizedAst;
}

function sanitizeInspectionComparison(comparison = {}) {
  const differences = Array.isArray(comparison?.differences)
    ? comparison.differences
    : [];

  return {
    checkedAt: String(comparison?.checkedAt || "").trim(),
    gpsToleranceMeters: Number(comparison?.gpsToleranceMeters || 5),
    hasDifferences: comparison?.hasDifferences === true,
    differenceCount: Number(comparison?.differenceCount || differences.length),
    differences: differences.map((item) => ({
      fieldPath: String(item?.fieldPath || "").trim(),
      label: String(item?.label || "").trim(),
      lastKnownValue:
        typeof item?.lastKnownValue === "object"
          ? item.lastKnownValue
          : String(item?.lastKnownValue || "NAv").trim(),
      capturedValue:
        typeof item?.capturedValue === "object"
          ? item.capturedValue
          : String(item?.capturedValue || "NAv").trim(),
      distanceMeters:
        item?.distanceMeters === null || item?.distanceMeters === undefined
          ? null
          : Number(item.distanceMeters),
      toleranceMeters:
        item?.toleranceMeters === null || item?.toleranceMeters === undefined
          ? null
          : Number(item.toleranceMeters),
      result: normalizeUpper(item?.result || "MISMATCH"),
    })),
    excludedFields: Array.isArray(comparison?.excludedFields)
      ? comparison.excludedFields.map((item) => String(item || "").trim())
      : [],
    confirmation: {
      required: comparison?.confirmation?.required === true,
      confirmed: comparison?.confirmation?.confirmed === true,
      confirmedAt: comparison?.confirmation?.confirmedAt || "NAv",
      confirmedByUid: comparison?.confirmation?.confirmedByUid || "NAv",
      confirmedByUser: comparison?.confirmation?.confirmedByUser || "NAv",
    },
  };
}

export function sanitizeInspection(
  inspection = {},
  { noAccess = false, isPrepaidMeter = false, meterType = "NAv" } = {},
) {
  if (noAccess) {
    return {
      inspectedAt: inspection?.inspectedAt || "",
      lastKnown: inspection?.lastKnown || {},
      captured: {
        ast: {},
        mreading: {
          reading: "",
          readingAt: "",
          noReadingReason: "",
        },
      },
      comparison: sanitizeInspectionComparison({}),
    };
  }

  const capturedAst = sanitizeInspectionCapturedAst(
    inspection?.captured?.ast || {},
    { meterType },
  );

  const mreading = inspection?.captured?.mreading || {};
  const cleanInspectionReading = normalizeInspectionOptionalText(
    mreading?.reading,
  );
  const cleanInspectionReadingAt = cleanInspectionReading
    ? normalizeInspectionOptionalText(mreading?.readingAt)
    : "";
  const cleanInspectionNoReadingReason = normalizeInspectionOptionalSelectText(
    mreading?.noReadingReason,
  );

  return {
    inspectedAt: inspection?.inspectedAt || "",
    lastKnown: inspection?.lastKnown || {},
    captured: {
      ast: capturedAst,
      mreading: isPrepaidMeter
        ? {
            reading: "",
            readingAt: "",
            noReadingReason: "",
          }
        : {
            reading: cleanInspectionReading,
            readingAt: cleanInspectionReadingAt,
            noReadingReason: cleanInspectionNoReadingReason,
          },
    },
    comparison: sanitizeInspectionComparison(inspection?.comparison || {}),
  };
}

export function validateMeterInspection({ data, astDoc }) {
  const currentState = getAstCurrentState(astDoc);
  const meterType = getAstMeterType(astDoc, data);
  const meterKind = getAstPrepaidType(astDoc, data);
  const isPrepaidMeter = isPrepaidAstMeter(astDoc, data);
  const isConventionalMeter = isConventionalAstMeter(astDoc, data);
  const isElectricityMeter = isElectricityMeterType(meterType);
  const isWaterMeter = isWaterMeterType(meterType);

  const noAccess = isNoAccessExecution(data);
  const noAccessReason = getNoAccessReason(data);

  const instructionText = String(
    data?.assignment?.instruction?.text || "",
  ).trim();

  const inspection = getInspectionPayload(data);
  const capturedAst = getInspectionCapturedAst(data);
  const capturedAstData = capturedAst?.astData || {};
  const capturedMeter = capturedAstData?.meter || {};
  const capturedAnomalies = capturedAst?.anomalies || {};
  const capturedLocation = capturedAst?.location || {};
  const capturedOgs = capturedAst?.ogs || {};
  const capturedComparison = inspection?.comparison || {};

  const reading = getInspectionReadingValue(data);
  const readingAt = getInspectionReadingAt(data);
  const noReadingReason = getInspectionNoReadingReason(data);

  if (currentState === "DECOMMISSIONED") {
    return {
      ok: false,
      code: "INVALID_AST_STATE",
      message: "DECOMMISSIONED meters cannot be inspected",
    };
  }

  if (
    !["FIELD", "CONNECTED", "DISCONNECTED", "REMOVED"].includes(currentState)
  ) {
    return {
      ok: false,
      code: "INVALID_AST_STATE",
      message:
        "Only FIELD, CONNECTED, DISCONNECTED, or REMOVED meters can be inspected",
    };
  }

  if (!["electricity", "water"].includes(meterType)) {
    return {
      ok: false,
      code: "INVALID_METER_TYPE",
      message: "Only electricity or water meters can be inspected",
    };
  }

  if (!isPrepaidMeter && !isConventionalMeter) {
    return {
      ok: false,
      code: "INSPECTION_UNKNOWN_METER_KIND",
      message:
        "Meter inspection requires a known meter kind: prepaid or conventional",
      meterKind: meterKind || "UNKNOWN",
    };
  }

  if (!instructionText) {
    return {
      ok: false,
      code: "INSPECTION_INSTRUCTION_REQUIRED",
      message: "Inspection instruction is required",
    };
  }

  if (noAccess) {
    if (!noAccessReason || noAccessReason === "NAv") {
      return {
        ok: false,
        code: "NO_ACCESS_REASON_REQUIRED",
        message: "No-access reason is required",
      };
    }

    if (
      !hasMediaTag(data?.media, INSPECTION_MEDIA_TAGS.noAccessPhoto, {
        requireUrl: true,
      })
    ) {
      return {
        ok: false,
        code: "MISSING_NO_ACCESS_PHOTO",
        message: "No access photo is required",
      };
    }

    return {
      ok: true,
      currentState,
      meterType,
      isPrepaidMeter,
      inspectionPassed: false,
      executionOutcome: {
        outcome: "NO_ACCESS",
        success: false,
      },
      nextAstState: currentState,
      astPatch: {},
      astStatusChanged: false,
      astDataChanged: false,
    };
  }

  if (!inspection || Object.keys(inspection).length === 0) {
    return {
      ok: false,
      code: "INSPECTION_PAYLOAD_REQUIRED",
      message: "inspection payload is required",
    };
  }

  if (!String(capturedAstData?.astNo || "").trim()) {
    return {
      ok: false,
      code: "INSPECTION_METER_NUMBER_REQUIRED",
      message: "Meter number is required",
    };
  }

  if (!String(capturedAstData?.astManufacturer || "").trim()) {
    return {
      ok: false,
      code: "INSPECTION_MANUFACTURER_REQUIRED",
      message: "Manufacturer is required",
    };
  }

  if (!String(capturedAstData?.astName || "").trim()) {
    return {
      ok: false,
      code: "INSPECTION_MODEL_REQUIRED",
      message: "Meter model/name is required",
    };
  }

  if (!String(capturedMeter?.type || "").trim()) {
    return {
      ok: false,
      code: "INSPECTION_METER_KIND_REQUIRED",
      message: "Meter kind is required",
    };
  }

  if (!String(capturedMeter?.category || "").trim()) {
    return {
      ok: false,
      code: "INSPECTION_METER_CATEGORY_REQUIRED",
      message: "Meter category is required",
    };
  }

  if (isElectricityMeter) {
    if (!String(capturedMeter?.phase || "").trim()) {
      return {
        ok: false,
        code: "INSPECTION_PHASE_REQUIRED",
        message: "Phase is required",
      };
    }

    if (!String(capturedMeter?.cb?.size || "").trim()) {
      return {
        ok: false,
        code: "INSPECTION_CB_SIZE_REQUIRED",
        message: "CB size is required",
      };
    }

    if (!String(capturedMeter?.keypad?.serialNo || "").trim()) {
      return {
        ok: false,
        code: "INSPECTION_SERIAL_NUMBER_REQUIRED",
        message: "Serial number is required",
      };
    }

    if (!String(capturedLocation?.placement || "").trim()) {
      return {
        ok: false,
        code: "INSPECTION_PLACEMENT_REQUIRED",
        message: "Placement is required",
      };
    }

    if (!String(capturedOgs?.hasOffGridSupply || "").trim()) {
      return {
        ok: false,
        code: "INSPECTION_OFF_GRID_SUPPLY_REQUIRED",
        message: "Off-grid supply is required",
      };
    }
  }

  if (!isElectricityMeter && !isWaterMeter) {
    return {
      ok: false,
      code: "INVALID_METER_TYPE",
      message: "Only electricity or water meters can be inspected",
    };
  }

  if (!String(data?.status?.state || "").trim()) {
    return {
      ok: false,
      code: "INSPECTION_STATUS_REQUIRED",
      message: "Meter status is required",
    };
  }

  if (!String(capturedAnomalies?.anomaly || "").trim()) {
    return {
      ok: false,
      code: "INSPECTION_ANOMALY_REQUIRED",
      message: "Anomaly is required",
    };
  }

  if (!String(capturedAnomalies?.anomalyDetail || "").trim()) {
    return {
      ok: false,
      code: "INSPECTION_ANOMALY_DETAIL_REQUIRED",
      message: "Anomaly detail is required",
    };
  }

  if (!getInspectionNormalisationAction(data)) {
    return {
      ok: false,
      code: "INSPECTION_NORMALISATION_REQUIRED",
      message: "Normalisation action is required",
    };
  }

  if (
    !hasMediaTag(data?.media, INSPECTION_MEDIA_TAGS.astNoPhoto, {
      requireUrl: true,
    })
  ) {
    return {
      ok: false,
      code: "MISSING_INSPECTION_METER_NUMBER_PHOTO",
      message: "Meter number photo is required",
    };
  }

  const anomalyCode = getInspectionAnomalyCode(data);

  if (
    !["METER_OK", "METER OK", "OK"].includes(anomalyCode) &&
    !hasMediaTag(data?.media, INSPECTION_MEDIA_TAGS.anomalyPhoto, {
      requireUrl: true,
    })
  ) {
    return {
      ok: false,
      code: "MISSING_INSPECTION_ANOMALY_PHOTO",
      message: "Anomaly photo is required when anomaly is not Meter Ok",
    };
  }

  const normalisationAction = getInspectionNormalisationAction(data);

  if (
    normalisationAction !== "NONE" &&
    !hasMediaTag(data?.media, INSPECTION_MEDIA_TAGS.normalisationPhoto, {
      requireUrl: true,
    })
  ) {
    return {
      ok: false,
      code: "MISSING_INSPECTION_NORMALISATION_PHOTO",
      message: "Normalisation photo is required when normalisation is not None",
    };
  }

  if (isConventionalMeter && !reading && !noReadingReason) {
    return {
      ok: false,
      code: "INSPECTION_READING_OR_REASON_REQUIRED",
      message:
        "Inspection reading or no-reading reason is required for conventional meters",
    };
  }

  if (isConventionalMeter && reading) {
    if (!isNumericReading(reading)) {
      return {
        ok: false,
        code: "INVALID_INSPECTION_METER_READING",
        message: "Inspection meter reading must be numeric",
      };
    }

    if (!readingAt) {
      return {
        ok: false,
        code: "INSPECTION_READING_AT_REQUIRED",
        message: "Inspection reading date/time is required",
      };
    }

    if (
      !hasMediaTag(data?.media, INSPECTION_MEDIA_TAGS.meterReadingPhoto, {
        requireUrl: true,
      })
    ) {
      return {
        ok: false,
        code: "MISSING_INSPECTION_READING_PHOTO",
        message:
          "Meter reading photo is required when inspection reading is captured",
      };
    }
  }

  if (
    capturedComparison?.hasDifferences === true &&
    capturedComparison?.confirmation?.confirmed !== true
  ) {
    return {
      ok: false,
      code: "INSPECTION_DIFFERENCES_NOT_CONFIRMED",
      message:
        "Inspection comparison differences must be confirmed before submit",
    };
  }

  const astPatch = {};

  if (isConventionalMeter && reading) {
    astPatch.mreadings = buildLatestMreadingsCache({
      astDoc,
      reading,
      readingAt,
      trnId: data?.id,
    });
  }

  return {
    ok: true,
    currentState,
    meterType,
    isPrepaidMeter,
    inspectionPassed: true,
    executionOutcome: {
      outcome: "SUCCESS",
      success: true,
    },
    nextAstState: currentState,
    astPatch,
    astStatusChanged: false,
    astDataChanged: Object.keys(astPatch).length > 0,
  };
}

export function validateMeterRemoval({ data, astDoc }) {
  const currentState = getAstCurrentState(astDoc);
  const meterType = getAstMeterType(astDoc, data);
  const isPrepaidMeter = isPrepaidAstMeter(astDoc, data);

  const noAccess = isNoAccessExecution(data);
  const noAccessReason = getNoAccessReason(data);

  const removal = data?.removal || {};

  const instructionText = String(
    data?.assignment?.instruction?.text || "",
  ).trim();

  const meterRemoved = normalizeYesNo(removal?.meterRemoved?.answer);
  const meterRemovedNotes = String(removal?.meterRemoved?.notes || "").trim();

  const safetyConfirmed = normalizeYesNo(removal?.safetyConfirmed?.answer);
  const safetyConfirmedNotes = String(
    removal?.safetyConfirmed?.notes || "",
  ).trim();

  const meterReading = getRemovalMeterReading(data);
  const tokenReading = getRemovalTokenReading(data);
  const noReadingReason = getRemovalNoReadingReason(data);

  if (!["FIELD", "CONNECTED", "DISCONNECTED"].includes(currentState)) {
    return {
      ok: false,
      code: "INVALID_AST_STATE",
      message: "Only FIELD, CONNECTED, or DISCONNECTED meters can be removed",
    };
  }

  if (!["electricity", "water"].includes(meterType)) {
    return {
      ok: false,
      code: "INVALID_METER_TYPE",
      message: "Only electricity or water meters can be removed",
    };
  }

  if (!instructionText) {
    return {
      ok: false,
      code: "REMOVAL_INSTRUCTION_REQUIRED",
      message: "Removal instruction is required",
    };
  }

  if (noAccess) {
    if (!noAccessReason || noAccessReason === "NAv") {
      return {
        ok: false,
        code: "NO_ACCESS_REASON_REQUIRED",
        message: "No-access reason is required",
      };
    }

    if (
      !hasMediaTag(data?.media, REMOVAL_MEDIA_TAGS.noAccessPhoto, {
        requireUrl: true,
      })
    ) {
      return {
        ok: false,
        code: "MISSING_NO_ACCESS_PHOTO",
        message: "No access photo is required",
      };
    }

    return {
      ok: true,
      currentState,
      meterType,
      isPrepaidMeter,
      removalPassed: false,
      executionOutcome: {
        outcome: "NO_ACCESS",
        success: false,
      },
      nextAstState: currentState,
      astPatch: {},
      astStatusChanged: false,
      astDataChanged: false,
    };
  }

  if (!meterRemoved) {
    return {
      ok: false,
      code: "INVALID_REMOVAL_ANSWER",
      message: "Meter removed answer must be yes or no",
    };
  }

  if (meterRemoved !== "yes") {
    return {
      ok: false,
      code: "METER_REMOVAL_NOT_CONFIRMED",
      message: "Meter must be confirmed as removed before submit",
    };
  }

  if (!safetyConfirmed) {
    return {
      ok: false,
      code: "INVALID_REMOVAL_SAFETY_ANSWER",
      message: "Safety confirmed answer must be yes or no",
    };
  }

  if (safetyConfirmed !== "yes") {
    return {
      ok: false,
      code: "REMOVAL_SAFETY_NOT_CONFIRMED",
      message: "Safety must be confirmed before submit",
    };
  }

  if (meterRemoved === "no" && !meterRemovedNotes) {
    return {
      ok: false,
      code: "REMOVAL_NOTES_REQUIRED",
      message: "Notes are required when meter removed is no",
    };
  }

  if (safetyConfirmed === "no" && !safetyConfirmedNotes) {
    return {
      ok: false,
      code: "REMOVAL_SAFETY_NOTES_REQUIRED",
      message: "Notes are required when safety confirmed is no",
    };
  }

  if (isPrepaidMeter && meterReading) {
    return {
      ok: false,
      code: "INVALID_PREPAID_METER_READING",
      message: "Prepaid meters must use token reading, not meter reading",
    };
  }

  if (!isPrepaidMeter && tokenReading) {
    return {
      ok: false,
      code: "INVALID_CONVENTIONAL_TOKEN_READING",
      message: "Conventional meters must use meter reading, not token reading",
    };
  }

  if (isPrepaidMeter && !tokenReading && !noReadingReason) {
    return {
      ok: false,
      code: "TOKEN_READING_OR_REASON_REQUIRED",
      message: "Token reading or no-reading reason is required",
    };
  }

  if (!isPrepaidMeter && !meterReading && !noReadingReason) {
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

  if (tokenReading && !isNumericReading(tokenReading)) {
    return {
      ok: false,
      code: "INVALID_TOKEN_READING",
      message: "Token reading must be numeric",
    };
  }

  if (
    meterReading &&
    !hasMediaTag(data?.media, REMOVAL_MEDIA_TAGS.meterReadingEvidence, {
      requireUrl: true,
    })
  ) {
    return {
      ok: false,
      code: "MISSING_REMOVAL_METER_READING_EVIDENCE",
      message: "Removal meter reading evidence is required",
    };
  }

  if (
    tokenReading &&
    !hasMediaTag(data?.media, REMOVAL_MEDIA_TAGS.tokenReadingPhoto, {
      requireUrl: true,
    })
  ) {
    return {
      ok: false,
      code: "MISSING_TOKEN_READING_EVIDENCE",
      message: "Token reading photo is required",
    };
  }

  if (
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
    !hasMediaTag(data?.media, REMOVAL_MEDIA_TAGS.safetyEvidence, {
      requireUrl: true,
    })
  ) {
    return {
      ok: false,
      code: "MISSING_REMOVAL_SAFETY_EVIDENCE",
      message: "Safety evidence media is required",
    };
  }

  const astPatch = {};

  if (!isPrepaidMeter && meterReading) {
    astPatch["ast.meterReading"] = meterReading;
  }

  if (isPrepaidMeter && tokenReading) {
    astPatch["ast.tokenReading"] = tokenReading;
  }

  return {
    ok: true,
    currentState,
    meterType,
    isPrepaidMeter,
    removalPassed: true,
    executionOutcome: {
      outcome: "SUCCESS",
      success: true,
    },
    nextAstState: "REMOVED",
    astPatch,
    astStatusChanged: currentState !== "REMOVED",
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

  const isPrepaidMeter = isPrepaidAstMeter(astDoc, data);
  const meterType = getAstMeterType(astDoc, data);

  const noAccess = isNoAccessExecution(data);

  const sanitizedOrigin = sanitizeOrigin(data?.origin || {}, {
    channel: data?.instructionTrnId ? "OFFICE" : "FIELD",
    source: data?.instructionTrnId ? "WMS" : "FIELD_EXECUTION",
    parentInspectionTrnId: null,
  });

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

    origin: sanitizedOrigin,

    workflow: {
      state: "COMPLETED",
      createdMode: sanitizedOrigin.channel,
      reassignmentCount: 0,
      executionStartedAt: null,
      completedAt: now,
      completedByUid: actorUid || null,
      completedByUser: actorName || null,
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

      location:
        astDoc?.ast?.location ||
        astDoc?.location ||
        data?.ast?.location ||
        null,
      ogs: astDoc?.ast?.ogs || astDoc?.ogs || data?.ast?.ogs || null,
    },

    commissioning:
      trnType === "METER_COMMISSIONING"
        ? sanitizeCommissioning(data?.commissioning || {})
        : undefined,

    removal:
      trnType === "METER_REMOVAL"
        ? sanitizeRemoval(data?.removal || {}, { isPrepaidMeter, noAccess })
        : undefined,

    meterReading:
      trnType === "METER_READING"
        ? sanitizeMeterReading(data?.meterReading || {}, {
            isPrepaidMeter,
            noAccess,
          })
        : undefined,

    inspection:
      trnType === "METER_INSPECTION"
        ? sanitizeInspection(data?.inspection || {}, {
            noAccess,
            isPrepaidMeter,
            meterType,
          })
        : undefined,

    disconnection:
      trnType === "METER_DISCONNECTION"
        ? sanitizeMeterDisconnection(data?.disconnection || {}, {
            isPrepaidMeter,
            noAccess,
          })
        : undefined,

    executionOutcome: [
      "METER_INSPECTION",
      "METER_DISCONNECTION",
      "METER_RECONNECTION",
      "METER_REMOVAL",
      "METER_READING",
    ].includes(trnType)
      ? sanitizeLifecycleExecutionOutcome(data?.executionOutcome || {})
      : undefined,

    reconnection:
      trnType === "METER_RECONNECTION"
        ? sanitizeMeterReconnection(data?.reconnection || {}, {
            isPrepaidMeter,
            noAccess,
          })
        : undefined,

    assignment: sanitizeAssignment(data?.assignment || {}),

    meterType: astDoc?.meterType || data?.meterType || "NAv",

    media: sanitizeMedia(data?.media || []),

    status: {
      state:
        trnType === "METER_INSPECTION"
          ? data?.status?.state || astDoc?.status?.state || null
          : statusState || astDoc?.status?.state || null,
      id:
        trnType === "METER_INSPECTION"
          ? data?.status?.id || astDoc?.status?.id || "NAv"
          : astDoc?.status?.id || data?.status?.id || "NAv",
      detail:
        trnType === "METER_INSPECTION"
          ? data?.status?.detail || astDoc?.status?.detail || "NAv"
          : astDoc?.status?.detail || data?.status?.detail || "NAv",
    },

    metadata: buildFlatMetadata({
      now,
      actorUid,
      actorName,
    }),

    serviceProvider: sanitizeServiceProvider(
      data?.serviceProvider || astDoc?.serviceProvider || {},
    ),
  });
}

// DCN , RCN helpers

function normalizeCodeLabel(value = {}) {
  return {
    code: String(value?.code || "").trim(),
    label: String(value?.label || "").trim(),
    otherText: String(value?.otherText || "").trim(),
  };
}

function selectValueToText(value) {
  if (!value) return "";

  if (typeof value === "string") {
    return value.trim();
  }

  const code = String(value?.code || "").trim();
  const label = String(value?.label || "").trim();
  const otherText = String(value?.otherText || "").trim();

  if (normalizeUpper(code) === "OTHER") {
    return otherText || label || code;
  }

  return label || code || otherText;
}

function getFlatOrNestedReading(bucket = {}, key = "meterReading") {
  const value = bucket?.[key];

  if (typeof value === "object" && value !== null) {
    return String(value?.reading || "").trim();
  }

  return String(value || "").trim();
}

function getFlatOrNestedNoReadingReason(
  bucket = {},
  readingKey = "meterReading",
) {
  const directReason = bucket?.noReadingReason;

  if (directReason) {
    return selectValueToText(directReason);
  }

  const nestedReason = bucket?.[readingKey]?.noReadingReason;

  return selectValueToText(nestedReason);
}

function getLifecycleReading(data = {}, key) {
  return getFlatOrNestedReading(data?.[key] || {}, "meterReading");
}

function getLifecycleNoReadingReason(data = {}, key) {
  return getFlatOrNestedNoReadingReason(data?.[key] || {}, "meterReading");
}

function getLifecycleTokenReading(data = {}, key) {
  return String(data?.[key]?.tokenReading || "").trim();
}

function getRemovalMeterReading(data = {}) {
  return getLifecycleReading(data, "removal");
}

function getRemovalTokenReading(data = {}) {
  return getLifecycleTokenReading(data, "removal");
}

function getRemovalNoReadingReason(data = {}) {
  return getLifecycleNoReadingReason(data, "removal");
}

function isNumericReading(value) {
  return /^\d+(\.\d+)?$/.test(String(value || "").trim());
}

function hasAnyMediaTag(media = [], tags = [], options = {}) {
  return tags.some((tag) => hasMediaTag(media, tag, options));
}

function getAccessOutcome(data = {}) {
  const hasAccess = normalizeLower(
    data?.accessData?.access?.hasAccess || "yes",
  );

  return hasAccess === "no" ? "no" : "yes";
}

function isNoAccessExecution(data = {}) {
  return getAccessOutcome(data) === "no";
}

function getNoAccessReason(data = {}) {
  const reasonText = String(data?.accessData?.access?.reason || "").trim();

  if (reasonText && reasonText !== "NAv") {
    return reasonText;
  }

  return selectValueToText(data?.accessData?.access?.reasonSelect);
}

export function sanitizeLifecycleExecutionOutcome(outcome = {}) {
  const cleanOutcome = normalizeUpper(outcome?.outcome || "");
  const allowedOutcomes = ["SUCCESS", "NO_ACCESS", "NO_READING"];
  const finalOutcome = allowedOutcomes.includes(cleanOutcome)
    ? cleanOutcome
    : "SUCCESS";

  return {
    outcome: finalOutcome,
    success: finalOutcome === "SUCCESS",
  };
}

// SANITIZE FUNCTIONS

export function sanitizeMeterDisconnection(
  disconnection = {},
  { isPrepaidMeter = false, noAccess = false } = {},
) {
  if (noAccess) {
    return {
      level: {
        code: "",
        label: "",
        otherText: "",
      },

      supplyDisconnected: {
        answer: null,
        notes: "",
      },

      meterReading: "",
      tokenReading: "",
      noReadingReason: "",

      safetyConfirmed: {
        answer: null,
        notes: "",
      },
    };
  }

  return {
    level: normalizeCodeLabel(disconnection?.level || {}),

    supplyDisconnected: {
      answer: normalizeYesNo(disconnection?.supplyDisconnected?.answer),
      notes: String(disconnection?.supplyDisconnected?.notes || ""),
    },

    meterReading: isPrepaidMeter
      ? ""
      : getFlatOrNestedReading(disconnection, "meterReading"),

    tokenReading: isPrepaidMeter
      ? String(disconnection?.tokenReading || "")
      : "",

    noReadingReason: selectValueToText(disconnection?.noReadingReason),

    safetyConfirmed: {
      answer: normalizeYesNo(disconnection?.safetyConfirmed?.answer),
      notes: String(disconnection?.safetyConfirmed?.notes || ""),
    },
  };
}

export function sanitizeMeterReconnection(
  reconnection = {},
  { isPrepaidMeter = false, noAccess = false } = {},
) {
  if (noAccess) {
    return {
      supplyReconnected: {
        answer: "",
        notes: "",
      },

      meterReading: "",
      tokenReading: "",
      noReadingReason: "",

      safetyConfirmed: {
        answer: "",
        notes: "",
      },
    };
  }

  return {
    supplyReconnected: {
      answer: normalizeYesNo(reconnection?.supplyReconnected?.answer),
      notes: String(reconnection?.supplyReconnected?.notes || ""),
    },

    meterReading: isPrepaidMeter
      ? ""
      : getFlatOrNestedReading(reconnection, "meterReading"),

    tokenReading: isPrepaidMeter
      ? String(reconnection?.tokenReading || "")
      : "",

    noReadingReason: selectValueToText(reconnection?.noReadingReason),

    safetyConfirmed: {
      answer: normalizeYesNo(reconnection?.safetyConfirmed?.answer),
      notes: String(reconnection?.safetyConfirmed?.notes || ""),
    },
  };
}

export function validateMeterDisconnection({ data, astDoc }) {
  const currentState = getAstCurrentState(astDoc);
  const meterType = getAstMeterType(astDoc, data);
  const isPrepaidMeter = isPrepaidAstMeter(astDoc, data);

  const noAccess = isNoAccessExecution(data);
  const noAccessReason = getNoAccessReason(data);

  const disconnection = data?.disconnection || {};

  const instructionText = String(
    data?.assignment?.instruction?.text || "",
  ).trim();

  const level = normalizeCodeLabel(disconnection?.level || {});
  const levelConfig = DISCONNECTION_LEVELS[level.code];

  const supplyDisconnected = normalizeYesNo(
    disconnection?.supplyDisconnected?.answer,
  );

  const safetyConfirmed = normalizeYesNo(
    disconnection?.safetyConfirmed?.answer,
  );

  const meterReading = getLifecycleReading(data, "disconnection");
  const tokenReading = getLifecycleTokenReading(data, "disconnection");
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

  if (noAccess) {
    if (!noAccessReason || noAccessReason === "NAv") {
      return {
        ok: false,
        code: "NO_ACCESS_REASON_REQUIRED",
        message: "No-access reason is required",
      };
    }

    if (
      !hasMediaTag(data?.media, DISCONNECTION_MEDIA_TAGS.noAccessPhoto, {
        requireUrl: true,
      })
    ) {
      return {
        ok: false,
        code: "MISSING_NO_ACCESS_PHOTO",
        message: "No access photo is required",
      };
    }

    return {
      ok: true,
      currentState,
      meterType,
      isPrepaidMeter,
      disconnectionPassed: false,
      executionOutcome: {
        outcome: "NO_ACCESS",
        success: false,
      },
      noAccessReason,
      nextAstState: currentState,
      astPatch: {},
      astStatusChanged: false,
      astDataChanged: false,
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

  if (supplyDisconnected !== "yes") {
    return {
      ok: false,
      code: "SUPPLY_DISCONNECTION_NOT_CONFIRMED",
      message: "Supply must be confirmed as disconnected before submit",
    };
  }

  if (!safetyConfirmed) {
    return {
      ok: false,
      code: "INVALID_DISCONNECTION_SAFETY_ANSWER",
      message: "Safety confirmed answer must be yes or no",
    };
  }

  if (safetyConfirmed !== "yes") {
    return {
      ok: false,
      code: "DISCONNECTION_SAFETY_NOT_CONFIRMED",
      message: "Safety must be confirmed before submit",
    };
  }

  if (isPrepaidMeter && meterReading) {
    return {
      ok: false,
      code: "INVALID_PREPAID_METER_READING",
      message: "Prepaid meters must use token reading, not meter reading",
    };
  }

  if (!isPrepaidMeter && tokenReading) {
    return {
      ok: false,
      code: "INVALID_CONVENTIONAL_TOKEN_READING",
      message: "Conventional meters must use meter reading, not token reading",
    };
  }

  if (isPrepaidMeter && !tokenReading && !noReadingReason) {
    return {
      ok: false,
      code: "TOKEN_READING_OR_REASON_REQUIRED",
      message: "Token reading or no-reading reason is required",
    };
  }

  if (!isPrepaidMeter && !meterReading && !noReadingReason) {
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

  if (tokenReading && !isNumericReading(tokenReading)) {
    return {
      ok: false,
      code: "INVALID_TOKEN_READING",
      message: "Token reading must be numeric",
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
    tokenReading &&
    !hasMediaTag(data?.media, DISCONNECTION_MEDIA_TAGS.tokenReadingPhoto, {
      requireUrl: true,
    })
  ) {
    return {
      ok: false,
      code: "MISSING_TOKEN_READING_EVIDENCE",
      message: "Token reading photo is required",
    };
  }

  if (
    !hasAnyMediaTag(
      data?.media,
      [
        DISCONNECTION_MEDIA_TAGS.levelEvidence,
        DISCONNECTION_MEDIA_TAGS.previousDraftLevelEvidence,
      ],
      { requireUrl: true },
    )
  ) {
    return {
      ok: false,
      code: "MISSING_DISCONNECTION_LEVEL_EVIDENCE",
      message: "Disconnection level evidence media is required",
    };
  }

  if (
    !hasMediaTag(data?.media, DISCONNECTION_MEDIA_TAGS.safetyEvidence, {
      requireUrl: true,
    })
  ) {
    return {
      ok: false,
      code: "MISSING_DISCONNECTION_SAFETY_EVIDENCE",
      message: "Safety evidence media is required",
    };
  }

  const astPatch = {};

  if (!isPrepaidMeter && meterReading) {
    astPatch["ast.meterReading"] = meterReading;
  }

  if (isPrepaidMeter && tokenReading) {
    astPatch["ast.tokenReading"] = tokenReading;
  }

  return {
    ok: true,
    currentState,
    meterType,
    isPrepaidMeter,
    disconnectionPassed: true,
    executionOutcome: {
      outcome: "SUCCESS",
      success: true,
    },
    disconnectionLevel: {
      code: levelConfig.code,
      label: levelConfig.label,
    },
    nextAstState: "DISCONNECTED",
    astPatch,
    astStatusChanged: currentState !== "DISCONNECTED",
    astDataChanged: Object.keys(astPatch).length > 0,
  };
}

export function validateMeterReconnection({ data, astDoc }) {
  const currentState = getAstCurrentState(astDoc);
  const meterType = getAstMeterType(astDoc, data);
  const isPrepaidMeter = isPrepaidAstMeter(astDoc, data);

  const noAccess = isNoAccessExecution(data);
  const noAccessReason = getNoAccessReason(data);

  const reconnection = data?.reconnection || {};

  const instructionText = String(
    data?.assignment?.instruction?.text || "",
  ).trim();

  const supplyReconnected = normalizeYesNo(
    reconnection?.supplyReconnected?.answer,
  );

  const supplyReconnectedNotes = String(
    reconnection?.supplyReconnected?.notes || "",
  ).trim();

  const safetyConfirmed = normalizeYesNo(reconnection?.safetyConfirmed?.answer);

  const safetyConfirmedNotes = String(
    reconnection?.safetyConfirmed?.notes || "",
  ).trim();

  const meterReading = getLifecycleReading(data, "reconnection");
  const tokenReading = getLifecycleTokenReading(data, "reconnection");
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

  if (noAccess) {
    if (!noAccessReason || noAccessReason === "NAv") {
      return {
        ok: false,
        code: "NO_ACCESS_REASON_REQUIRED",
        message: "No-access reason is required",
      };
    }

    if (
      !hasMediaTag(data?.media, RECONNECTION_MEDIA_TAGS.noAccessPhoto, {
        requireUrl: true,
      })
    ) {
      return {
        ok: false,
        code: "MISSING_NO_ACCESS_PHOTO",
        message: "No access photo is required",
      };
    }

    return {
      ok: true,
      currentState,
      meterType,
      isPrepaidMeter,
      reconnectionPassed: false,
      executionOutcome: {
        outcome: "NO_ACCESS",
        success: false,
      },
      nextAstState: currentState,
      astPatch: {},
      astStatusChanged: false,
      astDataChanged: false,
    };
  }

  if (!supplyReconnected) {
    return {
      ok: false,
      code: "INVALID_RECONNECTION_ANSWER",
      message: "Supply reconnected answer must be yes or no",
    };
  }

  if (supplyReconnected !== "yes") {
    return {
      ok: false,
      code: "SUPPLY_RECONNECTION_NOT_CONFIRMED",
      message: "Supply must be confirmed as reconnected before submit",
    };
  }

  if (!safetyConfirmed) {
    return {
      ok: false,
      code: "INVALID_RECONNECTION_SAFETY_ANSWER",
      message: "Safety confirmed answer must be yes or no",
    };
  }

  if (safetyConfirmed !== "yes") {
    return {
      ok: false,
      code: "RECONNECTION_SAFETY_NOT_CONFIRMED",
      message: "Safety must be confirmed before submit",
    };
  }

  if (supplyReconnected === "no" && !supplyReconnectedNotes) {
    return {
      ok: false,
      code: "NOTES_REQUIRED_FOR_FAILED_RECONNECTION",
      message: "Notes are required when supply reconnected is no",
    };
  }

  if (safetyConfirmed === "no" && !safetyConfirmedNotes) {
    return {
      ok: false,
      code: "NOTES_REQUIRED_FOR_FAILED_RECONNECTION_SAFETY",
      message: "Notes are required when safety confirmed is no",
    };
  }

  if (isPrepaidMeter && meterReading) {
    return {
      ok: false,
      code: "INVALID_PREPAID_METER_READING",
      message: "Prepaid meters must use token reading, not meter reading",
    };
  }

  if (!isPrepaidMeter && tokenReading) {
    return {
      ok: false,
      code: "INVALID_CONVENTIONAL_TOKEN_READING",
      message: "Conventional meters must use meter reading, not token reading",
    };
  }

  if (isPrepaidMeter && !tokenReading && !noReadingReason) {
    return {
      ok: false,
      code: "TOKEN_READING_OR_REASON_REQUIRED",
      message: "Token reading or no-reading reason is required",
    };
  }

  if (!isPrepaidMeter && !meterReading && !noReadingReason) {
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

  if (tokenReading && !isNumericReading(tokenReading)) {
    return {
      ok: false,
      code: "INVALID_TOKEN_READING",
      message: "Token reading must be numeric",
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
    tokenReading &&
    !hasMediaTag(data?.media, RECONNECTION_MEDIA_TAGS.tokenReadingPhoto, {
      requireUrl: true,
    })
  ) {
    return {
      ok: false,
      code: "MISSING_TOKEN_READING_EVIDENCE",
      message: "Token reading photo is required",
    };
  }

  if (
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

  if (
    !hasMediaTag(data?.media, RECONNECTION_MEDIA_TAGS.safetyEvidence, {
      requireUrl: true,
    })
  ) {
    return {
      ok: false,
      code: "MISSING_RECONNECTION_SAFETY_EVIDENCE",
      message: "Safety evidence media is required",
    };
  }

  const astPatch = {};

  if (!isPrepaidMeter && meterReading) {
    astPatch["ast.meterReading"] = meterReading;
  }

  if (isPrepaidMeter && tokenReading) {
    astPatch["ast.tokenReading"] = tokenReading;
  }

  return {
    ok: true,
    currentState,
    meterType,
    isPrepaidMeter,
    reconnectionPassed: true,
    executionOutcome: {
      outcome: "SUCCESS",
      success: true,
    },
    nextAstState: "CONNECTED",
    astPatch,
    astStatusChanged: currentState !== "CONNECTED",
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
        "Only INSPECTION, DISCONNECTION, RECONNECTION, REMOVAL and METER READING instructions can be created from Operations.",
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
  return validateAssignment(assignment, trnType);
}

export function validateLifecycleInstructionEligibility({ trnType, astDoc }) {
  const currentState = getAstCurrentState(astDoc);

  if (trnType === "METER_INSPECTION") {
    if (currentState === "DECOMMISSIONED") {
      return {
        ok: false,
        code: "INVALID_AST_STATE",
        message: "DECOMMISSIONED meters cannot be issued for inspection",
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

  if (trnType === "METER_READING") {
    if (currentState === "DECOMMISSIONED") {
      return {
        ok: false,
        code: "INVALID_AST_STATE",
        message: "DECOMMISSIONED meters cannot be issued for meter reading",
      };
    }

    if (isPrepaidAstMeter(astDoc, {})) {
      return {
        ok: false,
        code: "PREPAID_MREAD_NOT_SUPPORTED",
        message: "MREAD Sprint 1 supports conventional meters only",
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

export function sanitizeServiceProvider(serviceProvider = {}) {
  const id = String(serviceProvider?.id || "").trim();
  const name = String(
    serviceProvider?.name ||
      serviceProvider?.profile?.tradingName ||
      serviceProvider?.profile?.registeredName ||
      serviceProvider?.profile?.name ||
      id ||
      "NAv",
  ).trim();

  return {
    id: id || "NAv",
    name: name || "NAv",
  };
}

export function sanitizeOrigin(origin = {}, fallback = {}) {
  const channel = normalizeUpper(
    origin?.channel || fallback?.channel || "OFFICE",
  );

  const source = normalizeUpper(
    origin?.source || fallback?.source || "TRN_ORIGIN",
  );

  const allowedChannels = ["OFFICE", "FIELD", "API", "AMI", "INTEGRATION"];

  return {
    channel: allowedChannels.includes(channel) ? channel : "OFFICE",
    source: source || "TRN_ORIGIN",
    parentInspectionTrnId:
      origin?.parentInspectionTrnId || fallback?.parentInspectionTrnId || null,
  };
}

export function sanitizeBucketRef(bucket = {}) {
  const id = String(bucket?.id || "").trim();
  const type = normalizeUpper(bucket?.type || (id ? "CAMPAIGN" : "GENERAL"));
  const createdMode = normalizeUpper(
    bucket?.createdMode || (id ? "MASS" : "INDIVIDUAL"),
  );

  return {
    id: id || null,
    name: String(bucket?.name || (id ? id : "General")).trim(),
    type: ["GENERAL", "CAMPAIGN", "BULK", "GEOFENCE"].includes(type)
      ? type
      : "GENERAL",
    createdMode: ["INDIVIDUAL", "MASS"].includes(createdMode)
      ? createdMode
      : "INDIVIDUAL",
  };
}

// Temporary compatibility helper. New iREPS vocabulary is "bucket", not
// "workorder", because Workorder is only a synonym for TRN.
export function sanitizeWorkorderRef(workorder = {}) {
  return sanitizeBucketRef(workorder);
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

    origin: sanitizeOrigin(data?.origin || {}, {
      channel: "OFFICE",
      source: "TRN_ORIGIN",
      parentInspectionTrnId: null,
    }),

    assignment: sanitizeAssignment(data?.assignment || {}),

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

      location:
        astDoc?.ast?.location ||
        astDoc?.location ||
        data?.ast?.location ||
        null,
      ogs: astDoc?.ast?.ogs || astDoc?.ogs || data?.ast?.ogs || null,
    },

    meterType: astDoc?.meterType || data?.meterType || "NAv",

    commissioning: null,
    removal: null,
    meterReading: null,
    disconnection: null,
    reconnection: null,
    inspection: null,

    media: sanitizeMedia(data?.media || []),

    status: {
      state: astDoc?.status?.state || null,
      id: astDoc?.status?.id || data?.status?.id || "NAv",
      detail: astDoc?.status?.detail || data?.status?.detail || "NAv",
    },

    serviceProvider: sanitizeServiceProvider(
      data?.serviceProvider || astDoc?.serviceProvider || {},
    ),

    bucket: sanitizeBucketRef(data?.bucket || data?.workorder || {}),

    metadata: buildFlatMetadata({
      now,
      actorUid,
      actorName,
    }),
  });
}
