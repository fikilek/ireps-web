// Shared by new installation submissions and historical QA amendments.
import { isTrnIdForWork, trnIdShapeMessage } from '../transactions/trnId.js';
import { assertNoAccessMedia } from '../noAccess/recordNoAccess.js';
import { anomalyPhotoRequired } from '../meterDiscovery/validation.js';
import { validateMeterInstallationElectricity } from './validation.js';

function hasRequiredText(value) {
  const text = String(value || "").trim();
  return text && text !== "NAv";
}

function hasTaggedMedia(media = [], tag) {
  return (
    Array.isArray(media) &&
    media.some(
      (item) => item?.tag === tag && hasRequiredText(item?.url || item?.uri),
    )
  );
}

function buildFailureResult(code, message, extra = null) {
  return {
    success: false,
    code: code || "UNKNOWN_ERROR",
    message: message || "Unknown error",
    trnId: "NAv",
    // RG-R001 1.1.0 section 4: the sentence the worker reads. Our own message stays beside it, for us.
    ...(extra || {}),
  };
}

export function validateMeterCreationPayload({
  data = {},
  expectedTrnType,
  expectedTrnPrefix,
  allowedStatuses,
}) {
  const trnId = String(data?.id || "").trim();
  const hasAccess = data?.accessData?.access?.hasAccess;
  const meterType = data?.meterType;

  // NA-R005: the work's own prefix, or TRN_NA_ before it where the worker could not get in.
  if (!isTrnIdForWork(trnId, expectedTrnPrefix)) {
    return buildFailureResult("INVALID_TRN_ID", trnIdShapeMessage(expectedTrnPrefix));
  }

  if (data?.accessData?.trnType !== expectedTrnType) {
    return buildFailureResult(
      "INVALID_TRN_TYPE",
      `trnType must be ${expectedTrnType}`,
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

    if (!hasRequiredText(data?.accessData?.access?.reason)) {
      return buildFailureResult(
        "NO_ACCESS_REASON_REQUIRED",
        "No-access reason is required",
      );
    }

    try {
      assertNoAccessMedia(data?.media, data?.accessData?.access, { uploaded: true });
    } catch (error) {
      return buildFailureResult(error.code, error.message);
    }

    return null;
  }

  if (!["water", "electricity"].includes(meterType)) {
    return buildFailureResult(
      "INVALID_METER_TYPE",
      "Access submissions must use water or electricity meterType",
    );
  }

  const accessData = data?.accessData || {};
  const ast = data?.ast || {};
  const astData = ast?.astData || {};
  const meter = astData?.meter || {};
  const media = data?.media || [];

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

  const rawLat = ast?.location?.gps?.lat;
  const rawLng = ast?.location?.gps?.lng;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (
    rawLat == null ||
    rawLng == null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180 ||
    (lat === 0 && lng === 0)
  ) {
    return buildFailureResult(
      "INVALID_METER_GPS",
      "ast.location.gps must contain valid numeric lat and lng",
    );
  }

  if (!["Normal", "Bulk"].includes(meter?.category)) {
    return buildFailureResult(
      "INVALID_METER_CATEGORY",
      "Meter category must be Normal or Bulk",
    );
  }

  if (!["prepaid", "conventional"].includes(meter?.type)) {
    return buildFailureResult(
      "INVALID_METER_SUBTYPE",
      "Meter type must be prepaid or conventional",
    );
  }

  if (
    allowedStatuses.length > 0 &&
    !allowedStatuses.includes(data?.status?.state)
  ) {
    return buildFailureResult(
      "INVALID_METER_STATUS",
      `status.state must be one of ${allowedStatuses.join(", ")}`,
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
  // Every detail except Operationally Ok needs its picture, so a Meter Ok
  // bridge or bypass suspicion cannot be filed without evidence.
  if (
    anomalyPhotoRequired(anomaly, anomalyDetail) &&
    !hasTaggedMedia(media, "anomalyPhoto")
  ) {
    return buildFailureResult(
      "ANOMALY_PHOTO_REQUIRED",
      "Anomaly photo is required",
    );
  }

  if (meterType === "electricity") {
    if (!["single", "three"].includes(meter?.phase)) {
      return buildFailureResult(
        "INVALID_METER_PHASE",
        "Electricity meter phase must be single or three",
      );
    }

    const electricityValidationError = validateMeterInstallationElectricity({
      meter,
      location: ast?.location,
      media,
    });
    if (electricityValidationError) return electricityValidationError;
  }

  const creationReading =
    data?.mreadings?.[0]?.reading || ast?.meterReading || "";
  const creationTokenReading =
    data?.treadings?.[0]?.tokenReading || ast?.tokenReading || "";
  if (
    meter?.type === "conventional" &&
    hasRequiredText(creationReading) &&
    !hasTaggedMedia(media, "meterReadingPhoto")
  ) {
    return buildFailureResult(
      "METER_READING_PHOTO_REQUIRED",
      "Meter reading photo is required",
    );
  }

  if (
    meter?.type === "prepaid" &&
    hasRequiredText(creationTokenReading) &&
    !hasTaggedMedia(media, "tokenReadingPhoto")
  ) {
    return buildFailureResult(
      "TOKEN_READING_PHOTO_REQUIRED",
      "Token reading photo is required",
    );
  }

  return null;
}

