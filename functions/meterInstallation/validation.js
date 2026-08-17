import {
  METER_DISCOVERY_VALIDATION_METADATA,
  validateElectricityMeterPlacement,
} from "../meterDiscovery/validation.js";

const {
  sealCommentEvidence: SEAL_COMMENT_EVIDENCE,
  keypadCommentEvidence: KEYPAD_COMMENT_EVIDENCE,
  cbCommentEvidence: CB_COMMENT_EVIDENCE,
} = METER_DISCOVERY_VALIDATION_METADATA;

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

/**
 * Validate the electricity Infrastructure subsection for Meter Installation.
 *
 * Locked parity rule with Meter Discovery:
 * - Seal is mandatory via Seal Number OR canonical Seal Comment.
 * - Keypad is optional for prepaid meters.
 * - CB is optional.
 * - Supplied values require their evidence photo.
 * - Comment reasons marked photo-required still require evidence.
 * - Literal "Other" is Formik-only and must be canonicalised by mobile before
 *   submission; a non-listed custom explanation is accepted as canonical text.
 */
export function validateMeterInstallationInfrastructure({
  meter = {},
  media = [],
} = {}) {
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

  return null;
}

export function validateMeterInstallationElectricity({
  meter = {},
  location = {},
  media = [],
} = {}) {
  const placementError = validateElectricityMeterPlacement(location?.placement);
  if (placementError) return placementError;

  return validateMeterInstallationInfrastructure({ meter, media });
}

export const METER_INSTALLATION_INFRASTRUCTURE_METADATA = Object.freeze({
  sealCommentEvidence: SEAL_COMMENT_EVIDENCE,
  keypadCommentEvidence: KEYPAD_COMMENT_EVIDENCE,
  cbCommentEvidence: CB_COMMENT_EVIDENCE,
  electricityPlacements:
    METER_DISCOVERY_VALIDATION_METADATA.electricityPlacements,
});
