const METER_DISCOVERY_TRN_TYPE = "METER_DISCOVERY";
const METER_DISCOVERY_TRN_PREFIX = "TRN_MDIS_";
const METER_DISCOVERY_STATUSES = new Set(["CONNECTED", "DISCONNECTED"]);
const METER_CATEGORIES = new Set(["Normal", "Bulk"]);
const METER_SUBTYPES = new Set(["prepaid", "conventional"]);
const ELECTRICITY_PHASES = new Set(["single", "three"]);
const METER_DISCOVERY_CONTRACT_VERSION = 2;
const REMAINING_CREDIT_PATTERN = /^[+-]?\d+(?:\.\d+)?$/;
const REMAINING_CREDIT_COMMENT_REASONS = new Set([
  "Display blank / no reading",
  "Display damaged",
  "Display unreadable",
  "Unable to obtain balance",
  "Meter not responding",
  "Other",
]);
const REMAINING_CREDIT_STANDARD_REASONS = new Set(
  [...REMAINING_CREDIT_COMMENT_REASONS].filter((reason) => reason !== "Other"),
);
const REMAINING_CREDIT_OTHER_PREFIX = "Other:";
const ELECTRICITY_PLACEMENTS = new Set([
  "Kiosk",
  "Pole Top",
  "Pole Bottom",
  "Boundary Wall",
  "Meter Room",
  "Wall Indoors",
  "Inside Property",
  "Other",
]);

const OTHER_ANOMALY_VALUES = new Set([
  "Meter Blocked (By Munic)",
  "Meter Bridged (By Munic)",
  "Incomplete Service Points",
  "Meter Not Registered",
  "Keypad Faulty",
]);

const NORMALISATION_CANONICAL_ACTION_VALUES = Object.freeze([
  "none",
  "New Meter Installed",
  "Meter Removed",
  "Illegal connection - meter disconnected",
  "Illegal connection - meter reconnected",
  "Meter faulty - meter replaced",
  "Meter damaged - meter replaced",
  "Tamper Removed",
  "Keypad Normalised",
  "Service Point Completed / Cable Installed",
  "Meter Registered",
]);

// Retained for compatibility with Mobile versions released before Normalisation v3.
const NORMALISATION_LEGACY_ACTION_VALUES = Object.freeze([
  "Meter Disconnected",
  "Meter Reconnected",
]);

const NORMALISATION_ACTION_VALUES = new Set([
  ...NORMALISATION_CANONICAL_ACTION_VALUES,
  ...NORMALISATION_LEGACY_ACTION_VALUES,
]);

const SEAL_COMMENT_EVIDENCE = Object.freeze({
  "Seal Missing": false,
  "Seal Broken": true,
  "Seal Damaged": true,
  "Seal Number Not Visible": true,
  "Seal Number Unreadable": true,
  "Seal Removed": false,
  "Meter Not Sealed": true,
});

const KEYPAD_COMMENT_EVIDENCE = Object.freeze({
  "Keypad Missing": false,
  "Keypad Not Installed": false,
  "Keypad Integrated With Meter": true,
  "Keypad Serial Number Not Visible": true,
  "Keypad Serial Number Unreadable": true,
  "Keypad Damaged": true,
  "Keypad Inaccessible": false,
});

const CB_COMMENT_EVIDENCE = Object.freeze({
  "Circuit Breaker Missing": false,
  "Circuit Breaker Size Not Visible": true,
  "Circuit Breaker Size Unreadable": true,
  "Circuit Breaker Damaged": true,
  "Circuit Breaker Inaccessible": false,
  "No Dedicated Circuit Breaker": false,
  "Distribution Board Inaccessible": false,
});

function hasRequiredText(value) {
  const text = String(value || "").trim();
  return Boolean(text && text !== "NAv");
}

function hasTaggedMedia(media = [], tag) {
  return (
    Array.isArray(media) &&
    media.some(
      (item) => item?.tag === tag && hasRequiredText(item?.url || item?.uri),
    )
  );
}

function buildFailureResult(code, message) {
  return {
    success: false,
    code: code || "UNKNOWN_ERROR",
    message: message || "Unknown error",
    trnId: "NAv",
  };
}

export function validateElectricityMeterPlacement(value) {
  const placement = String(value || "").trim();

  if (!hasRequiredText(placement)) {
    return buildFailureResult(
      "METER_PLACEMENT_REQUIRED",
      "Electricity meter placement is required",
    );
  }

  if (!ELECTRICITY_PLACEMENTS.has(placement)) {
    return buildFailureResult(
      "INVALID_METER_PLACEMENT",
      "Electricity meter placement must use an approved Meter Placement option",
    );
  }

  return null;
}

function validateGps(gps) {
  const rawLat = gps?.lat;
  const rawLng = gps?.lng;
  const lat = Number(rawLat);
  const lng = Number(rawLng);

  return (
    rawLat != null &&
    rawLng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

function validateOtherAnomalies(value) {
  if (value == null) return null;

  if (!Array.isArray(value)) {
    return buildFailureResult(
      "INVALID_OTHER_ANOMALIES",
      "ast.anomalies.otherAnomalies must be an array",
    );
  }

  const seen = new Set();

  for (const anomaly of value) {
    if (typeof anomaly !== "string" || !OTHER_ANOMALY_VALUES.has(anomaly)) {
      return buildFailureResult(
        "INVALID_OTHER_ANOMALY",
        "ast.anomalies.otherAnomalies contains an unsupported value",
      );
    }

    if (seen.has(anomaly)) {
      return buildFailureResult(
        "DUPLICATE_OTHER_ANOMALY",
        "ast.anomalies.otherAnomalies cannot contain duplicates",
      );
    }

    seen.add(anomaly);
  }

  return null;
}

function validateInfrastructureEvidence({
  value,
  comment,
  photoTag,
  commentEvidence,
  media,
  missingCode,
  missingMessage,
  photoCode,
  photoMessage,
  nonCanonicalOtherCode,
  nonCanonicalOtherMessage,
  required = true,
}) {
  const hasValue = hasRequiredText(value);
  const hasComment = hasRequiredText(comment);

  if (!hasValue && !hasComment) {
    return required ? buildFailureResult(missingCode, missingMessage) : null;
  }

  if (!hasValue && String(comment || "").trim() === "Other") {
    return buildFailureResult(
      nonCanonicalOtherCode,
      nonCanonicalOtherMessage,
    );
  }

  const photoRequired =
    hasValue || (!hasValue && commentEvidence[String(comment).trim()] === true);

  if (photoRequired && !hasTaggedMedia(media, photoTag)) {
    return buildFailureResult(photoCode, photoMessage);
  }

  return null;
}

function validateCanonicalReading({
  value,
  media,
  photoTag,
  missingCode,
  missingMessage,
  photoCode,
  photoMessage,
}) {
  if (!hasRequiredText(value)) {
    return buildFailureResult(missingCode, missingMessage);
  }

  if (!hasTaggedMedia(media, photoTag)) {
    return buildFailureResult(photoCode, photoMessage);
  }

  return null;
}

function validateRemainingCreditV2({ data, meter, media }) {
  const contractVersion = Number(data?.meterDiscoveryContractVersion ?? 0);

  if (
    !Number.isFinite(contractVersion) ||
    contractVersion < METER_DISCOVERY_CONTRACT_VERSION ||
    meter?.type !== "prepaid"
  ) {
    return null;
  }

  const remainingCredit = String(meter?.remainingCredit ?? "").trim();
  const remainingCreditComment = String(
    meter?.remainingCreditComment ?? "",
  ).trim();

  if (remainingCredit) {
    if (!REMAINING_CREDIT_PATTERN.test(remainingCredit)) {
      return buildFailureResult(
        "INVALID_REMAINING_CREDIT",
        "Remaining Credit must be a signed decimal value",
      );
    }

    if (remainingCreditComment) {
      return buildFailureResult(
        "REMAINING_CREDIT_COMMENT_NOT_ALLOWED",
        "Remaining Credit reason must be blank when a value is captured",
      );
    }

    if (!hasTaggedMedia(media, "remainingCreditPhoto")) {
      return buildFailureResult(
        "REMAINING_CREDIT_PHOTO_REQUIRED",
        "Remaining Credit photo is required when a value is captured",
      );
    }

    return null;
  }

  if (!remainingCreditComment) {
    return buildFailureResult(
      "REMAINING_CREDIT_COMMENT_REQUIRED",
      "Remaining Credit reason is required when no value is captured",
    );
  }

  if (REMAINING_CREDIT_STANDARD_REASONS.has(remainingCreditComment)) {
    return null;
  }

  if (remainingCreditComment === "Other") {
    return buildFailureResult(
      "REMAINING_CREDIT_COMMENT_OTHER_REQUIRED",
      "Specify the other Remaining Credit reason",
    );
  }

  if (remainingCreditComment.startsWith(`${REMAINING_CREDIT_OTHER_PREFIX} `)) {
    const otherReason = remainingCreditComment
      .slice(REMAINING_CREDIT_OTHER_PREFIX.length)
      .trim();

    if (otherReason) {
      return null;
    }
  }

  return buildFailureResult(
    "INVALID_REMAINING_CREDIT_COMMENT",
    "Remaining Credit reason must use an approved option or Other with details",
  );
}

/**
 * Validate the canonical Meter Discovery payload emitted by the mobile app.
 *
 * This is intentionally Meter-Discovery-specific. Meter Installation continues
 * to use the legacy shared validator in functions/index.js so this LIVE hotfix
 * cannot relax or otherwise change Meter Installation behaviour.
 *
 * Formik-only helper fields (for example astManufacturerOther/commentOther)
 * are canonicalised by the mobile app before transmission and are therefore
 * not required here. The literal helper value "Other" is non-canonical and
 * must not reach the backend; a different non-listed non-empty text value is
 * treated as the canonical custom explanation and does not require a photo.
 */
export function validateMeterDiscoveryPayload({ data = {} } = {}) {
  const trnId = String(data?.id || "").trim();
  const accessData = data?.accessData || {};
  const hasAccess = accessData?.access?.hasAccess;
  const meterType = data?.meterType;
  const media = data?.media || [];

  if (!trnId.startsWith(METER_DISCOVERY_TRN_PREFIX)) {
    return buildFailureResult(
      "INVALID_TRN_ID",
      `TRN id must start with ${METER_DISCOVERY_TRN_PREFIX}`,
    );
  }

  if (accessData?.trnType !== METER_DISCOVERY_TRN_TYPE) {
    return buildFailureResult(
      "INVALID_TRN_TYPE",
      `trnType must be ${METER_DISCOVERY_TRN_TYPE}`,
    );
  }

  if (!["yes", "no"].includes(hasAccess)) {
    return buildFailureResult(
      "INVALID_ACCESS_VALUE",
      "accessData.access.hasAccess must be yes or no",
    );
  }

  if (hasAccess === "no") {
    if (meterType !== "NA") {
      return buildFailureResult(
        "INVALID_NO_ACCESS_METER_TYPE",
        "No-access submissions must use meterType NA",
      );
    }

    if (!hasRequiredText(accessData?.access?.reason)) {
      return buildFailureResult(
        "NO_ACCESS_REASON_REQUIRED",
        "No-access reason is required",
      );
    }

    if (!hasTaggedMedia(media, "noAccessPhoto")) {
      return buildFailureResult(
        "NO_ACCESS_PHOTO_REQUIRED",
        "No-access photo is required",
      );
    }

    return null;
  }

  if (!["water", "electricity"].includes(meterType)) {
    return buildFailureResult(
      "INVALID_METER_TYPE",
      "Access submissions must use water or electricity meterType",
    );
  }

  const ast = data?.ast || {};
  const astData = ast?.astData || {};
  const meter = astData?.meter || {};

  if (String(astData?.astManufacturer || "").trim() === "Other") {
    return buildFailureResult(
      "NON_CANONICAL_MANUFACTURER_OTHER",
      "ast.astData.astManufacturer must contain the canonical custom manufacturer, not Other",
    );
  }

  // Existing server-owned identity/geography/service-provider integrity gates.
  const requiredTextFields = [
    ["accessData.erfId", accessData?.erfId],
    ["accessData.erfNo", accessData?.erfNo],
    ["accessData.premise.id", accessData?.premise?.id],
    ["accessData.premise.address", accessData?.premise?.address],
    ["accessData.premise.propertyType", accessData?.premise?.propertyType],
    ["ast.astData.astNo", astData?.astNo],
    ["ast.astData.astManufacturer", astData?.astManufacturer],
    ["ast.astData.astName", astData?.astName],
    ["ast.anomalies.anomaly", ast?.anomalies?.anomaly],
    ["ast.anomalies.anomalyDetail", ast?.anomalies?.anomalyDetail],
    ["serviceProvider.id", data?.serviceProvider?.id],
    ["serviceProvider.name", data?.serviceProvider?.name],
  ];

  const missingField = requiredTextFields.find(
    ([, value]) => !hasRequiredText(value),
  );

  if (missingField) {
    return buildFailureResult(
      "MISSING_REQUIRED_FIELD",
      `${missingField[0]} is required`,
    );
  }

  const requiredParentFields = [
    "countryPcode",
    "provincePcode",
    "dmPcode",
    "lmPcode",
    "wardPcode",
  ];
  const missingParent = requiredParentFields.find(
    (key) => !hasRequiredText(accessData?.parents?.[key]),
  );

  if (missingParent) {
    return buildFailureResult(
      "MISSING_REQUIRED_PARENT",
      `accessData.parents.${missingParent} is required`,
    );
  }

  if (!validateGps(ast?.location?.gps)) {
    return buildFailureResult(
      "INVALID_METER_GPS",
      "ast.location.gps must contain valid numeric lat and lng",
    );
  }

  if (!METER_CATEGORIES.has(meter?.category)) {
    return buildFailureResult(
      "INVALID_METER_CATEGORY",
      "Meter category must be Normal or Bulk",
    );
  }

  if (!METER_SUBTYPES.has(meter?.type)) {
    return buildFailureResult(
      "INVALID_METER_SUBTYPE",
      "Meter type must be prepaid or conventional",
    );
  }

  const remainingCreditError = validateRemainingCreditV2({
    data,
    meter,
    media,
  });
  if (remainingCreditError) return remainingCreditError;

  if (!METER_DISCOVERY_STATUSES.has(data?.status?.state)) {
    return buildFailureResult(
      "INVALID_METER_STATUS",
      "status.state must be one of CONNECTED, DISCONNECTED",
    );
  }

  if (!hasTaggedMedia(media, "astNoPhoto")) {
    return buildFailureResult(
      "METER_PHOTO_REQUIRED",
      "Meter number photo is required",
    );
  }

  const anomaly = String(ast?.anomalies?.anomaly || "").trim();
  if (anomaly !== "Meter Ok" && !hasTaggedMedia(media, "anomalyPhoto")) {
    return buildFailureResult(
      "ANOMALY_PHOTO_REQUIRED",
      "Anomaly photo is required",
    );
  }

  const otherAnomaliesError = validateOtherAnomalies(
    ast?.anomalies?.otherAnomalies,
  );
  if (otherAnomaliesError) return otherAnomaliesError;

  if (meterType === "water") {
    const creationReading =
      data?.mreadings?.[0]?.reading ?? ast?.meterReading ?? "";
    const creationTokenReading =
      data?.treadings?.[0]?.tokenReading ?? ast?.tokenReading ?? "";

    if (meter?.type === "conventional") {
      return validateCanonicalReading({
        value: creationReading,
        media,
        photoTag: "meterReadingPhoto",
        missingCode: "METER_READING_REQUIRED",
        missingMessage: "Conventional water meter reading is required",
        photoCode: "METER_READING_PHOTO_REQUIRED",
        photoMessage: "Meter reading photo is required",
      });
    }

    return validateCanonicalReading({
      value: creationTokenReading,
      media,
      photoTag: "tokenReadingPhoto",
      missingCode: "TOKEN_READING_REQUIRED",
      missingMessage: "Prepaid water token reading is required",
      photoCode: "TOKEN_READING_PHOTO_REQUIRED",
      photoMessage: "Token reading photo is required",
    });
  }

  const placementError = validateElectricityMeterPlacement(
    ast?.location?.placement,
  );
  if (placementError) return placementError;

  if (!ELECTRICITY_PHASES.has(meter?.phase)) {
    return buildFailureResult(
      "INVALID_METER_PHASE",
      "Electricity meter phase must be single or three",
    );
  }

  if (!hasRequiredText(ast?.ogs?.hasOffGridSupply)) {
    return buildFailureResult(
      "OFF_GRID_STATUS_REQUIRED",
      "Off-grid supply status is required",
    );
  }

  const normalisationActions = ast?.normalisation?.actionTaken;
  if (!Array.isArray(normalisationActions) || normalisationActions.length === 0) {
    return buildFailureResult(
      "NORMALISATION_ACTIONS_REQUIRED",
      "ast.normalisation.actionTaken must be a non-empty array",
    );
  }

  if (
    normalisationActions.some(
      (action) =>
        typeof action !== "string" ||
        !NORMALISATION_ACTION_VALUES.has(action),
    )
  ) {
    return buildFailureResult(
      "INVALID_NORMALISATION_ACTION",
      "ast.normalisation.actionTaken contains an unsupported action",
    );
  }

  const uniqueNormalisationActions = new Set(normalisationActions);
  if (uniqueNormalisationActions.size !== normalisationActions.length) {
    return buildFailureResult(
      "DUPLICATE_NORMALISATION_ACTION",
      "ast.normalisation.actionTaken cannot contain duplicates",
    );
  }

  if (
    normalisationActions.includes("none") &&
    normalisationActions.length !== 1
  ) {
    return buildFailureResult(
      "NORMALISATION_NONE_NOT_EXCLUSIVE",
      "Normalisation action none cannot be combined with another action",
    );
  }

  const sealError = validateInfrastructureEvidence({
    value: meter?.seal?.sealNo,
    comment: meter?.seal?.comment,
    photoTag: "sealPhoto",
    commentEvidence: SEAL_COMMENT_EVIDENCE,
    media,
    missingCode: "SEAL_NUMBER_OR_COMMENT_REQUIRED",
    missingMessage: "Electricity meter seal number or comment is required",
    photoCode: "SEAL_PHOTO_REQUIRED",
    photoMessage: "Seal photo is required",
    nonCanonicalOtherCode: "NON_CANONICAL_SEAL_COMMENT_OTHER",
    nonCanonicalOtherMessage:
      "Seal comment must contain the canonical custom explanation, not Other",
  });
  if (sealError) return sealError;

  const cbError = validateInfrastructureEvidence({
    value: meter?.cb?.size,
    comment: meter?.cb?.comment,
    photoTag: "astCbPhoto",
    commentEvidence: CB_COMMENT_EVIDENCE,
    media,
    missingCode: "CB_SIZE_OR_COMMENT_REQUIRED",
    missingMessage: "Electricity meter circuit breaker size or comment is required",
    photoCode: "CB_PHOTO_REQUIRED",
    photoMessage: "Circuit Breaker photo is required",
    nonCanonicalOtherCode: "NON_CANONICAL_CB_COMMENT_OTHER",
    nonCanonicalOtherMessage:
      "Circuit Breaker comment must contain the canonical custom explanation, not Other",
    required: false,
  });
  if (cbError) return cbError;

  if (meter?.type === "prepaid") {
    const keypadError = validateInfrastructureEvidence({
      value: meter?.keypad?.serialNo,
      comment: meter?.keypad?.comment,
      photoTag: "keypadPhoto",
      commentEvidence: KEYPAD_COMMENT_EVIDENCE,
      media,
      missingCode: "KEYPAD_SERIAL_OR_COMMENT_REQUIRED",
      missingMessage: "Prepaid keypad serial number or comment is required",
      photoCode: "KEYPAD_PHOTO_REQUIRED",
      photoMessage: "Keypad photo is required",
      nonCanonicalOtherCode: "NON_CANONICAL_KEYPAD_COMMENT_OTHER",
      nonCanonicalOtherMessage:
        "Keypad comment must contain the canonical custom explanation, not Other",
      required: false,
    });
    if (keypadError) return keypadError;
  }

  if (
    ast?.ogs?.hasOffGridSupply === "yes" &&
    !hasTaggedMedia(media, "ogsPhoto")
  ) {
    return buildFailureResult(
      "OFF_GRID_PHOTO_REQUIRED",
      "Off-Grid Supply photo is required",
    );
  }

  const hasNormalisationIntervention = normalisationActions.some(
    (action) => action !== "none",
  );
  if (
    hasNormalisationIntervention &&
    !hasTaggedMedia(media, "normalisationPhoto")
  ) {
    return buildFailureResult(
      "NORMALISATION_PHOTO_REQUIRED",
      "Photo proof of Normalisation is required",
    );
  }

  return null;
}

export const METER_DISCOVERY_VALIDATION_METADATA = Object.freeze({
  otherAnomalyValues: Object.freeze([...OTHER_ANOMALY_VALUES]),
  normalisationActionValues: Object.freeze([...NORMALISATION_ACTION_VALUES]),
  sealCommentEvidence: SEAL_COMMENT_EVIDENCE,
  keypadCommentEvidence: KEYPAD_COMMENT_EVIDENCE,
  cbCommentEvidence: CB_COMMENT_EVIDENCE,
  electricityPlacements: Object.freeze([...ELECTRICITY_PLACEMENTS]),
  remainingCreditCommentReasons: Object.freeze([
    ...REMAINING_CREDIT_COMMENT_REASONS,
  ]),
  meterDiscoveryContractVersion: METER_DISCOVERY_CONTRACT_VERSION,
});
