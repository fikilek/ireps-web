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

// The anomaly details that need no photo. Everything else does, including the
// Meter Ok suspicions (Bridge / Bypass). The phone keeps the same list in
// src/features/meters/formOptions.js; the two must agree or a submission that
// passes on the phone is refused here.
const ANOMALY_DETAILS_WITHOUT_PHOTO = Object.freeze(["Operationally Ok"]);

export function anomalyPhotoRequired(anomaly, anomalyDetail) {
  const name = String(anomaly || "").trim();
  if (!name) return false;

  const detail = String(anomalyDetail || "").trim();
  // No detail: keep the old anomaly-only rule, so a queued or legacy
  // submission captured before this change is not refused for want of a photo.
  if (!detail) return name !== "Meter Ok";

  return !ANOMALY_DETAILS_WITHOUT_PHOTO.includes(detail);
}

const OTHER_ANOMALY_VALUES = new Set([
  "Meter Blocked (By Munic)",
  "Meter Bridged (By Munic)",
  "Incomplete Service Points",
  "Meter Not Registered",
  "Keypad Faulty",
]);

// MN-R001: one list for Meter Discovery and Meter Inspection. The phone keeps the
// same rules in ireps-mobile/src/features/meters/formOptions.js; the two must
// agree, or a capture that passes on the phone is refused on arrival.
const NORMALISATION_NONE = "none";

const NORMALISATION_ON_SITE_FIXES = Object.freeze([
  "Tamper removed",
  "Keypad normalised",
  "Service point completed",
  "Meter registered",
]);

// The two jobs. Each opens its own chain of forms (MN-R001 section 6), so a
// finding carries one of them, never both.
const NORMALISATION_JOB_ACTIONS = Object.freeze([
  "Disconnect meter",
  "Replace meter",
]);

const NORMALISATION_ACTION_VALUES = new Set([
  NORMALISATION_NONE,
  ...NORMALISATION_JOB_ACTIONS,
  ...NORMALISATION_ON_SITE_FIXES,
]);

// The action that follows each finding. Not taking it needs a reason.
const NORMALISATION_EXPECTED_BY_ANOMALY = Object.freeze({
  "Illegally Connected": "Disconnect meter",
  "Meter Damaged": "Replace meter",
  "Meter Faulty": "Replace meter",
});

const NO_ACTION_REASONS = Object.freeze([
  "Threatened or chased away",
  "Customer refused",
  "Unsafe to work on",
  "Meter could not be reached",
  "No meter available to replace",
  "Office said to leave it",
]);

export function normalisationActionsTaken(actionTaken) {
  const actions = Array.isArray(actionTaken) ? actionTaken : [];
  return actions.filter((action) => String(action) !== NORMALISATION_NONE);
}

// A disconnection or a replacement proves itself in the forms that follow, so
// the worker is not asked for the same photograph twice.
export function normalisationPhotoRequired(actionTaken) {
  return normalisationActionsTaken(actionTaken).some(
    (action) => !NORMALISATION_JOB_ACTIONS.includes(action),
  );
}

// What a finding calls for next, and where the numbers of that work are kept
// (MN-R001 section 7). No status word: an empty number means not yet submitted.
// MN-R001 8.3: a fix on the spot ends the problem it addresses, so the meter
// record shows what the worker LEFT while the transaction keeps what they
// FOUND. One fix, one thing it clears.
const FIX_CLEARS_ANOMALY = Object.freeze({
  "Tamper removed": "Illegally Connected",
  "Meter registered": "Meter Not On Portal",
});

const FIX_CLEARS_OTHER_ANOMALY = Object.freeze({
  "Keypad normalised": "Keypad Faulty",
  "Service point completed": "Incomplete Service Points",
  "Meter registered": "Meter Not Registered",
});

// What the meter record should show after the visit.
export function applyFixesToFinding({
  anomaly,
  anomalyDetail,
  otherAnomalies = [],
  actionTaken = [],
}) {
  const actions = (Array.isArray(actionTaken) ? actionTaken : []).map((action) =>
    String(action || "").trim(),
  );
  const found = String(anomaly || "").trim();

  const mainCleared = actions.some(
    (action) => FIX_CLEARS_ANOMALY[action] === found,
  );

  const clearedOthers = new Set(
    actions.map((action) => FIX_CLEARS_OTHER_ANOMALY[action]).filter(Boolean),
  );

  return {
    anomaly: mainCleared ? "Meter Ok" : found,
    anomalyDetail: mainCleared
      ? "Operationally Ok"
      : String(anomalyDetail || "").trim(),
    otherAnomalies: (Array.isArray(otherAnomalies) ? otherAnomalies : [])
      .map((entry) => String(entry || "").trim())
      .filter((entry) => entry && !clearedOthers.has(entry)),
  };
}

export function buildNormalisationFollowUp(actionTaken) {
  const actions = Array.isArray(actionTaken) ? actionTaken : [];
  if (actions.includes("Disconnect meter")) {
    return { required: "METER_DISCONNECTION", disconnectionTrnId: "" };
  }
  if (actions.includes("Replace meter")) {
    return {
      required: "METER_REPLACEMENT",
      removalTrnId: "",
      installationTrnId: "",
    };
  }
  return null;
}

export function expectedNormalisationAction(anomaly) {
  return NORMALISATION_EXPECTED_BY_ANOMALY[String(anomaly || "").trim()] || "";
}

// The whole rule, in one place, used by discovery and by inspection.
export function validateNormalisation({ anomaly, normalisation }) {
  const actions = Array.isArray(normalisation?.actionTaken)
    ? normalisation.actionTaken.map(String)
    : null;

  if (!actions || actions.length === 0) {
    return {
      code: "NORMALISATION_ACTIONS_REQUIRED",
      message: "Say what was done about this finding.",
    };
  }

  if (actions.some((action) => !NORMALISATION_ACTION_VALUES.has(action))) {
    return {
      code: "INVALID_NORMALISATION_ACTION",
      message: "This action is not on the list.",
    };
  }

  if (new Set(actions).size !== actions.length) {
    return {
      code: "DUPLICATE_NORMALISATION_ACTION",
      message: "The same action cannot be chosen twice.",
    };
  }

  if (actions.includes(NORMALISATION_NONE) && actions.length !== 1) {
    return {
      code: "NORMALISATION_NONE_NOT_EXCLUSIVE",
      message: "None cannot be used with another action.",
    };
  }

  if (NORMALISATION_JOB_ACTIONS.every((job) => actions.includes(job))) {
    return {
      code: "NORMALISATION_ONE_JOB_ONLY",
      message: "Choose one: disconnect or replace.",
    };
  }

  const finding = String(anomaly || "").trim();
  const expected = expectedNormalisationAction(finding);
  const reason = String(normalisation?.noActionReason || "").trim();

  // Meter Ok asks for nothing, and must not carry a reason for not acting.
  if (!expected) {
    if (reason) {
      return {
        code: "NORMALISATION_REASON_NOT_EXPECTED",
        message: "A reason for not acting belongs to a finding that needs action.",
      };
    }
    return null;
  }

  if (normalisationActionsTaken(actions).includes(expected)) {
    if (reason) {
      return {
        code: "NORMALISATION_REASON_NOT_EXPECTED",
        message: "The work was done, so there is no reason for not acting.",
      };
    }
    return null;
  }

  if (!reason) {
    return {
      code: "NORMALISATION_REASON_REQUIRED",
      message:
        expected === "Disconnect meter"
          ? "Say why the meter was not disconnected."
          : "Say why the meter was not replaced.",
    };
  }

  // Other is replaced by the words the worker typed before it is sent.
  if (reason === "Other") {
    return {
      code: "NON_CANONICAL_NO_ACTION_REASON_OTHER",
      message: "Type the reason.",
    };
  }

  return null;
}

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

export function validateOtherAnomalies(value) {
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
  const anomalyDetail = String(ast?.anomalies?.anomalyDetail || "").trim();
  if (
    anomalyPhotoRequired(anomaly, anomalyDetail) &&
    !hasTaggedMedia(media, "anomalyPhoto")
  ) {
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

  const normalisationError = validateNormalisation({
    anomaly: ast?.anomalies?.anomaly,
    normalisation: ast?.normalisation,
  });
  if (normalisationError) {
    return buildFailureResult(
      normalisationError.code,
      normalisationError.message,
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

  if (
    normalisationPhotoRequired(ast?.normalisation?.actionTaken) &&
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
  anomalyDetailsWithoutPhoto: ANOMALY_DETAILS_WITHOUT_PHOTO,
  otherAnomalyValues: Object.freeze([...OTHER_ANOMALY_VALUES]),
  normalisationActionValues: Object.freeze([...NORMALISATION_ACTION_VALUES]),
  noActionReasons: NO_ACTION_REASONS,
  sealCommentEvidence: SEAL_COMMENT_EVIDENCE,
  keypadCommentEvidence: KEYPAD_COMMENT_EVIDENCE,
  cbCommentEvidence: CB_COMMENT_EVIDENCE,
  electricityPlacements: Object.freeze([...ELECTRICITY_PLACEMENTS]),
  remainingCreditCommentReasons: Object.freeze([
    ...REMAINING_CREDIT_COMMENT_REASONS,
  ]),
  meterDiscoveryContractVersion: METER_DISCOVERY_CONTRACT_VERSION,
});
