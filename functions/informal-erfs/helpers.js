import area from "@turf/area";
import bbox from "@turf/bbox";
import booleanIntersects from "@turf/boolean-intersects";
import booleanValid from "@turf/boolean-valid";
import booleanWithin from "@turf/boolean-within";
import centerOfMass from "@turf/center-of-mass";
import { feature, polygon } from "@turf/helpers";
import kinks from "@turf/kinks";
import { FieldValue } from "firebase-admin/firestore";

import {
  doesEntityBelongToGeoFence,
  normalizeGeoFenceRefs,
} from "../geofences/helpers.js";

const ALLOWED_ROLES = new Set(["MNG", "SPV", "FWR"]);
const MIN_BOUNDARY_VERTICES = 3;
const MAX_BOUNDARY_VERTICES = 100;
const INFORMAL_ERF_ID_PATTERN =
  /^IE-(ZA\d{7})-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{4})$/;
const INFORMAL_ERF_NUMBER_PATTERN = /^IE\d{6}$/;

const LAT_LNG_KEYS = new Set(["lat", "lng"]);
const DEVICE_LOCATION_KEYS = new Set([
  "latitude",
  "longitude",
  "accuracyM",
  "altitudeM",
  "headingDegrees",
  "speedMps",
  "capturedAtMs",
]);
const SITE_PHOTO_KEYS = new Set([
  "tag",
  "type",
  "storagePath",
  "url",
  "capturedAtMs",
  "gps",
]);

const APPROVED_REASON_CODES = new Set([
  "NO_FORMAL_ERF",
  "UNMAPPED_INFORMAL_AREA",
  "METER_OUTSIDE_MAPPED_ERF",
  "SERVICE_CONNECTION_WITHOUT_ERF",
  "CADASTRAL_DATA_INCOMPLETE",
  "FORMAL_ERF_NOT_IDENTIFIABLE",
  "OTHER",
]);

export function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function asTrimmedString(value) {
  return String(value ?? "").trim();
}

export function assertOnlyAllowedKeys(value, allowedKeys, fieldName) {
  if (!isPlainObject(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }

  const unsupportedKeys = Object.keys(value)
    .filter((key) => !allowedKeys.has(key))
    .sort();

  if (unsupportedKeys.length > 0) {
    throw new Error(
      `${fieldName} contains unsupported fields: ${unsupportedKeys.join(", ")}.`,
    );
  }

  return value;
}

export function asFiniteNumber(value, fieldName) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be a finite number.`);
  }

  return parsed;
}

export function asNullableFiniteNumber(value, fieldName) {
  if (value == null || value === "") return null;
  return asFiniteNumber(value, fieldName);
}

export function assertPositiveEpochMs(value, fieldName) {
  const parsed = asFiniteNumber(value, fieldName);

  if (parsed <= 0) {
    throw new Error(`${fieldName} must be a positive epoch millisecond value.`);
  }

  return Math.trunc(parsed);
}

export function assertValidLatLng(value, fieldName) {
  assertOnlyAllowedKeys(value, LAT_LNG_KEYS, fieldName);

  const lat = asFiniteNumber(value.lat, `${fieldName}.lat`);
  const lng = asFiniteNumber(value.lng, `${fieldName}.lng`);

  if (lat < -90 || lat > 90) {
    throw new Error(`${fieldName}.lat must be between -90 and 90.`);
  }

  if (lng < -180 || lng > 180) {
    throw new Error(`${fieldName}.lng must be between -180 and 180.`);
  }

  if (lat === 0 && lng === 0) {
    throw new Error(`${fieldName} cannot be 0,0.`);
  }

  return { lat, lng };
}

export function assertValidDeviceLocation(value) {
  assertOnlyAllowedKeys(
    value,
    DEVICE_LOCATION_KEYS,
    "deviceLocation",
  );

  const latitude = asFiniteNumber(
    value.latitude,
    "deviceLocation.latitude",
  );
  const longitude = asFiniteNumber(
    value.longitude,
    "deviceLocation.longitude",
  );

  if (latitude < -90 || latitude > 90) {
    throw new Error(
      "deviceLocation.latitude must be between -90 and 90.",
    );
  }

  if (longitude < -180 || longitude > 180) {
    throw new Error(
      "deviceLocation.longitude must be between -180 and 180.",
    );
  }

  if (latitude === 0 && longitude === 0) {
    throw new Error("deviceLocation cannot be 0,0.");
  }

  return {
    latitude,
    longitude,
    accuracyM: asNullableFiniteNumber(
      value.accuracyM,
      "deviceLocation.accuracyM",
    ),
    altitudeM: asNullableFiniteNumber(
      value.altitudeM,
      "deviceLocation.altitudeM",
    ),
    headingDegrees: asNullableFiniteNumber(
      value.headingDegrees,
      "deviceLocation.headingDegrees",
    ),
    speedMps: asNullableFiniteNumber(
      value.speedMps,
      "deviceLocation.speedMps",
    ),
    capturedAtMs: assertPositiveEpochMs(
      value.capturedAtMs,
      "deviceLocation.capturedAtMs",
    ),
  };
}

function assertValidInformalErfWallClockTimestamp(match) {
  const year = Number(match[2]);
  const month = Number(match[3]);
  const day = Number(match[4]);
  const hour = Number(match[5]);
  const minute = Number(match[6]);
  const second = Number(match[7]);

  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    throw new Error(
      "erfId must contain a real Johannesburg YYYYMMDD-hhmmss date and time.",
    );
  }

  // The ID stores Johannesburg wall-clock components without an offset.
  // UTC setters are used only to detect calendar normalization safely.
  const roundTrip = new Date(0);
  roundTrip.setUTCFullYear(year, month - 1, day);
  roundTrip.setUTCHours(hour, minute, second, 0);

  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day ||
    roundTrip.getUTCHours() !== hour ||
    roundTrip.getUTCMinutes() !== minute ||
    roundTrip.getUTCSeconds() !== second
  ) {
    throw new Error(
      "erfId must contain a real Johannesburg YYYYMMDD-hhmmss date and time.",
    );
  }
}

export function assertInformalErfId(erfId, wardPcode) {
  const cleanErfId = asTrimmedString(erfId);
  const cleanWardPcode = asTrimmedString(wardPcode).toUpperCase();
  const currentMatch = cleanErfId.match(INFORMAL_ERF_ID_PATTERN);

  if (!currentMatch) {
    throw new Error(
      "erfId must follow IE-{wardPcode}-YYYYMMDD-hhmmss-XXXX, for example IE-ZA7423006-20260724-225238-8629.",
    );
  }

  if (currentMatch[1] !== cleanWardPcode) {
    throw new Error(
      "The wardPcode embedded in erfId must match the submitted wardPcode.",
    );
  }

  assertValidInformalErfWallClockTimestamp(currentMatch);

  return cleanErfId;
}

export function normalizeReason(reasonCode, reasonOther) {
  const code = asTrimmedString(reasonCode).toUpperCase();

  if (!APPROVED_REASON_CODES.has(code)) {
    throw new Error("reasonCode is not an approved Informal ERF reason.");
  }

  const otherText = asTrimmedString(reasonOther);

  if (code === "OTHER" && !otherText) {
    throw new Error("reasonOther is required when reasonCode is OTHER.");
  }

  if (otherText.length > 250) {
    throw new Error("reasonOther cannot exceed 250 characters.");
  }

  return {
    code,
    otherText: code === "OTHER" ? otherText : null,
  };
}

function parseFirebaseStorageDownloadUrl(value, fieldName) {
  const cleanUrl = asTrimmedString(value);

  if (!cleanUrl) {
    throw new Error(`${fieldName} is required.`);
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(cleanUrl);
  } catch {
    throw new Error(`${fieldName} must be a valid URL.`);
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error(`${fieldName} must use HTTPS.`);
  }

  if (parsedUrl.hostname !== "firebasestorage.googleapis.com") {
    throw new Error(
      `${fieldName} must be a Firebase Storage download URL.`,
    );
  }

  const pathMatch = parsedUrl.pathname.match(
    /^\/v0\/b\/([^/]+)\/o\/(.+)$/,
  );

  if (!pathMatch) {
    throw new Error(`${fieldName} does not identify a Storage object.`);
  }

  let bucketName;
  let storagePath;

  try {
    bucketName = decodeURIComponent(pathMatch[1]);
    storagePath = decodeURIComponent(pathMatch[2]);
  } catch {
    throw new Error(`${fieldName} contains an invalid bucket or object path.`);
  }

  return {
    url: cleanUrl,
    bucketName,
    storagePath,
  };
}

function assertPhotoDownloadUrl(
  value,
  storagePath,
  expectedBucketName,
  fieldName,
) {
  const cleanExpectedBucketName = asTrimmedString(expectedBucketName);

  if (!cleanExpectedBucketName) {
    throw new Error("The configured Firebase Storage bucket is unavailable.");
  }

  const parsed = parseFirebaseStorageDownloadUrl(value, fieldName);

  if (parsed.bucketName !== cleanExpectedBucketName) {
    throw new Error(
      `${fieldName} must use the configured Firebase Storage bucket.`,
    );
  }

  if (parsed.storagePath !== storagePath) {
    throw new Error(
      `${fieldName} must point to the same object as media.storagePath.`,
    );
  }

  return parsed.url;
}

export function normalizeSitePhotos(
  media,
  erfId,
  expectedBucketName,
) {
  if (!Array.isArray(media)) {
    throw new Error("media must be an array.");
  }

  if (media.length === 0) {
    throw new Error(
      "At least one uploaded informalErfSitePhoto is required.",
    );
  }

  const expectedPrefix = `informal_erfs/${erfId}/`;

  return media.map((item, index) => {
    const fieldName = `media[${index}]`;

    assertOnlyAllowedKeys(item, SITE_PHOTO_KEYS, fieldName);

    if (asTrimmedString(item.tag) !== "informalErfSitePhoto") {
      throw new Error(
        `${fieldName}.tag must be informalErfSitePhoto.`,
      );
    }

    if (asTrimmedString(item.type) !== "image") {
      throw new Error(`${fieldName}.type must be image.`);
    }

    const storagePath = asTrimmedString(item.storagePath);

    if (!storagePath) {
      throw new Error(
        `${fieldName}.storagePath is required before server submission.`,
      );
    }

    if (!storagePath.startsWith(expectedPrefix)) {
      throw new Error(
        `${fieldName}.storagePath must start with ${expectedPrefix}.`,
      );
    }

    const gps =
      item.gps == null
        ? null
        : assertValidLatLng(item.gps, `${fieldName}.gps`);

    const capturedAtMs = assertPositiveEpochMs(
      item.capturedAtMs,
      `${fieldName}.capturedAtMs`,
    );
    const capturedAtIso = new Date(capturedAtMs).toISOString();
    const url = assertPhotoDownloadUrl(
      item.url,
      storagePath,
      expectedBucketName,
      `${fieldName}.url`,
    );

    return {
      tag: "informalErfSitePhoto",
      type: "image",
      storagePath,
      url,
      createdAt: capturedAtIso,
      updatedAt: capturedAtIso,
      gps,
    };
  });
}

export function getActorContext(userData, authToken = {}) {
  const role = asTrimmedString(
    userData?.employment?.role || userData?.role || authToken?.role,
  ).toUpperCase();

  if (!ALLOWED_ROLES.has(role)) {
    throw new Error("Only MNG, SPV, or FWR may create an Informal ERF.");
  }

  const accountStatus = asTrimmedString(
    userData?.accountStatus ||
      userData?.status?.state ||
      userData?.status?.lifecycle ||
      userData?.status,
  ).toUpperCase();

  if (accountStatus !== "ACTIVE") {
    throw new Error("The user account is not active.");
  }

  const activeWorkbase = userData?.access?.activeWorkbase;
  const activeWorkbaseId = asTrimmedString(
    typeof activeWorkbase === "string"
      ? activeWorkbase
      : activeWorkbase?.id ||
          activeWorkbase?.pcode ||
          activeWorkbase?.lmPcode,
  ).toUpperCase();

  if (!activeWorkbaseId) {
    throw new Error("The user has no active workbase.");
  }

  const profile = userData?.profile || {};
  const displayName =
    asTrimmedString(profile?.displayName) ||
    asTrimmedString(
      [profile?.name, profile?.surname].filter(Boolean).join(" "),
    ) ||
    asTrimmedString(authToken?.name) ||
    asTrimmedString(authToken?.email) ||
    "iREPS User";

  return {
    role,
    accountStatus,
    activeWorkbaseId,
    displayName,
  };
}

export function assertCanonicalParentDocuments({
  lmPcode,
  wardPcode,
  lmSnap,
  wardSnap,
}) {
  if (!lmSnap?.exists) {
    throw new Error(`Local Municipality ${lmPcode} was not found.`);
  }

  if (!wardSnap?.exists) {
    throw new Error(`Ward ${wardPcode} was not found.`);
  }

  const lmData = lmSnap.data() || {};
  const wardData = wardSnap.data() || {};

  const storedLmPcode = asTrimmedString(
    lmData?.pcode || lmData?.id || lmSnap.id,
  ).toUpperCase();
  const storedWardPcode = asTrimmedString(
    wardData?.pcode || wardData?.id || wardSnap.id,
  ).toUpperCase();
  const wardParentLmPcode = asTrimmedString(
    wardData?.parents?.localMunicipalityId ||
      wardData?.parents?.lmPcode ||
      wardData?.parents?.localMunicipalityPcode,
  ).toUpperCase();

  if (storedLmPcode && storedLmPcode !== lmPcode) {
    throw new Error(`LM document identity does not match ${lmPcode}.`);
  }

  if (storedWardPcode && storedWardPcode !== wardPcode) {
    throw new Error(`Ward document identity does not match ${wardPcode}.`);
  }

  if (wardParentLmPcode !== lmPcode) {
    throw new Error(`Ward ${wardPcode} does not belong to LM ${lmPcode}.`);
  }

  return { lmData, wardData };
}

export function buildAdminHierarchy({
  lmPcode,
  wardPcode,
  lmData,
  wardData,
}) {
  const lmParents = lmData?.parents || {};
  const lmParentNames = lmData?.parentNames || {};
  const wardParents = wardData?.parents || {};
  const wardParentNames = wardData?.parentNames || {};

  const countryPcode = asTrimmedString(
    lmParents?.countryId ||
      lmParents?.countryPcode ||
      wardParents?.countryId ||
      wardParents?.countryPcode,
  ).toUpperCase();
  const provincePcode = asTrimmedString(
    lmParents?.provinceId ||
      lmParents?.provincePcode ||
      wardParents?.provinceId ||
      wardParents?.provincePcode,
  ).toUpperCase();
  const districtPcode = asTrimmedString(
    lmParents?.districtId ||
      lmParents?.dmPcode ||
      wardParents?.districtId ||
      wardParents?.dmPcode,
  ).toUpperCase();

  const countryName =
    asTrimmedString(lmParentNames?.country) ||
    asTrimmedString(wardParentNames?.country) ||
    "South Africa";
  const provinceName =
    asTrimmedString(lmParentNames?.province) ||
    asTrimmedString(wardParentNames?.province);
  const districtName =
    asTrimmedString(lmParentNames?.district) ||
    asTrimmedString(wardParentNames?.district);
  const lmName = asTrimmedString(lmData?.name);
  const wardName =
    asTrimmedString(wardData?.name) ||
    (wardData?.code != null ? `Ward ${wardData.code}` : "");

  if (
    !countryPcode ||
    !provincePcode ||
    !districtPcode ||
    !provinceName ||
    !districtName ||
    !lmName ||
    !wardName
  ) {
    throw new Error(
      "The LM or ward document is missing canonical admin hierarchy fields.",
    );
  }

  return {
    country: { name: countryName, pcode: countryPcode },
    province: { name: provinceName, pcode: provincePcode },
    district: { name: districtName, pcode: districtPcode },
    localMunicipality: { name: lmName, pcode: lmPcode },
    ward: { name: wardName, pcode: wardPcode },
  };
}

function sameCoordinate(left, right) {
  return left?.lat === right?.lat && left?.lng === right?.lng;
}

export function normalizeBoundaryPoints(rawPoints) {
  if (!Array.isArray(rawPoints)) {
    throw new Error("boundaryPoints must be an array.");
  }

  const points = rawPoints.map((point, index) =>
    assertValidLatLng(point, `boundaryPoints[${index}]`),
  );

  if (
    points.length > MIN_BOUNDARY_VERTICES &&
    sameCoordinate(points[0], points[points.length - 1])
  ) {
    points.pop();
  }

  const seen = new Set();

  for (const point of points) {
    const key = `${point.lat}|${point.lng}`;

    if (seen.has(key)) {
      throw new Error(
        "boundaryPoints cannot contain duplicate non-closing vertices.",
      );
    }

    seen.add(key);
  }

  if (points.length < MIN_BOUNDARY_VERTICES) {
    throw new Error(
      `boundaryPoints must contain at least ${MIN_BOUNDARY_VERTICES} unique vertices.`,
    );
  }

  if (points.length > MAX_BOUNDARY_VERTICES) {
    throw new Error(
      `boundaryPoints cannot contain more than ${MAX_BOUNDARY_VERTICES} unique vertices.`,
    );
  }

  return points;
}

function parseJsonObject(value, fieldName) {
  if (typeof value === "string") {
    const text = value.trim();

    if (!text) {
      throw new Error(`${fieldName} is empty.`);
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${fieldName} is not valid JSON.`);
    }
  }

  if (isPlainObject(value)) {
    return value;
  }

  throw new Error(`${fieldName} must be a GeoJSON object or JSON string.`);
}

export function parseGeoJsonFeature(value, fieldName = "geometry") {
  const parsed = parseJsonObject(value, fieldName);

  if (parsed?.type === "Feature") {
    if (!isPlainObject(parsed.geometry) || !parsed.geometry.type) {
      throw new Error(`${fieldName} does not contain a valid geometry.`);
    }

    return parsed;
  }

  if (!parsed?.type || !Object.prototype.hasOwnProperty.call(parsed, "coordinates")) {
    throw new Error(`${fieldName} does not contain a valid GeoJSON geometry.`);
  }

  return feature(parsed);
}

export function buildCanonicalPolygon(rawPoints) {
  const boundaryPoints = normalizeBoundaryPoints(rawPoints);
  const ring = boundaryPoints.map(({ lat, lng }) => [lng, lat]);
  ring.push([...ring[0]]);

  const polygonFeature = polygon([ring]);

  if (!booleanValid(polygonFeature)) {
    throw new Error("boundaryPoints produce an invalid polygon.");
  }

  const selfIntersections = kinks(polygonFeature);

  if (selfIntersections.features.length > 0) {
    throw new Error("boundaryPoints produce a self-intersecting polygon.");
  }

  const areaM2 = area(polygonFeature);

  if (!Number.isFinite(areaM2) || areaM2 <= 0) {
    throw new Error("boundaryPoints produce a zero or invalid polygon area.");
  }

  const [minLng, minLat, maxLng, maxLat] = bbox(polygonFeature, {
    recompute: true,
  });
  const centerFeature = centerOfMass(polygonFeature);
  const [centerLng, centerLat] = centerFeature?.geometry?.coordinates || [];

  if (
    ![minLng, minLat, maxLng, maxLat, centerLng, centerLat].every(
      Number.isFinite,
    )
  ) {
    throw new Error("The canonical polygon metrics could not be calculated.");
  }

  return {
    boundaryPoints,
    feature: polygonFeature,
    geometry: polygonFeature.geometry,
    geometryJson: JSON.stringify(polygonFeature.geometry),
    bbox: { minLat, minLng, maxLat, maxLng },
    centroid: { lat: centerLat, lng: centerLng },
    areaM2,
  };
}

export function assertCandidateInsideWard(candidateFeature, wardGeometryValue) {
  const wardFeature = parseGeoJsonFeature(
    wardGeometryValue,
    "ward.geometry",
  );

  if (
    wardFeature.geometry.type !== "Polygon" &&
    wardFeature.geometry.type !== "MultiPolygon"
  ) {
    throw new Error("ward.geometry must be a Polygon or MultiPolygon.");
  }

  if (!booleanValid(wardFeature)) {
    throw new Error("ward.geometry is invalid.");
  }

  if (!booleanWithin(candidateFeature, wardFeature)) {
    throw new Error(
      "The complete Informal ERF polygon must remain inside the selected ward.",
    );
  }

  return true;
}

export function bboxIntersects(left, right) {
  return !(
    left.maxLat < right.minLat ||
    left.minLat > right.maxLat ||
    left.maxLng < right.minLng ||
    left.minLng > right.maxLng
  );
}

export function assertNoExistingErfIntersection({
  candidateFeature,
  candidateBbox,
  erfDocs,
  erfId,
}) {
  let bboxCandidates = 0;
  let geometryChecks = 0;

  for (const erfDoc of erfDocs) {
    if (erfDoc.id === erfId) continue;

    const existing = erfDoc.data() || {};
    const existingBbox = existing?.bbox;
    const hasCanonicalBbox =
      isPlainObject(existingBbox) &&
      ["minLat", "minLng", "maxLat", "maxLng"].every((key) =>
        Number.isFinite(Number(existingBbox[key])),
      );

    let existingFeature = null;
    let normalizedExistingBbox = null;

    if (hasCanonicalBbox) {
      normalizedExistingBbox = {
        minLat: Number(existingBbox.minLat),
        minLng: Number(existingBbox.minLng),
        maxLat: Number(existingBbox.maxLat),
        maxLng: Number(existingBbox.maxLng),
      };
    } else {
      // Pre-production noncompliant Informal ERFs may not have a complete
      // canonical bbox. Derive a temporary bbox from stored geometry so they
      // remain collision targets until the approved cleanup is completed.
      existingFeature = parseGeoJsonFeature(
        existing?.geometry,
        `ireps_erfs/${erfDoc.id}.geometry`,
      );
      const [minLng, minLat, maxLng, maxLat] = bbox(existingFeature, {
        recompute: true,
      });

      if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) {
        throw new Error(
          `ireps_erfs/${erfDoc.id} has no usable bbox or geometry.`,
        );
      }

      normalizedExistingBbox = { minLat, minLng, maxLat, maxLng };
    }

    if (!bboxIntersects(candidateBbox, normalizedExistingBbox)) continue;

    bboxCandidates += 1;

    if (!existingFeature) {
      existingFeature = parseGeoJsonFeature(
        existing?.geometry,
        `ireps_erfs/${erfDoc.id}.geometry`,
      );
    }

    const existingType = asTrimmedString(
      existing?.erf?.type || "FORMAL",
    ).toUpperCase();
    const geometryType = existingFeature.geometry.type;

    if (geometryType === "Point" && existingType === "INFORMAL") {
      // Pre-production noncompliant Point records remain collision targets
      // until the approved cleanup is completed.
    } else if (
      geometryType !== "Polygon" &&
      geometryType !== "MultiPolygon"
    ) {
      throw new Error(
        `ireps_erfs/${erfDoc.id}.geometry has unsupported type ${geometryType}.`,
      );
    } else if (!booleanValid(existingFeature)) {
      throw new Error(`ireps_erfs/${erfDoc.id}.geometry is invalid.`);
    }

    geometryChecks += 1;

    if (
      booleanIntersects(candidateFeature, existingFeature, {
        ignoreSelfIntersections: false,
      })
    ) {
      return {
        collision: true,
        existingErfId: erfDoc.id,
        existingErfType: existingType,
        existingErfNo: existing?.sg?.parcelNo || "NAv",
        bboxCandidates,
        geometryChecks,
      };
    }
  }

  return {
    collision: false,
    bboxCandidates,
    geometryChecks,
  };
}

export function resolveGeoFenceRefs({ geoFenceDocs, centroid }) {
  const point = {
    latitude: centroid.lat,
    longitude: centroid.lng,
  };
  const matches = [];

  for (const geoFenceDoc of geoFenceDocs) {
    const geoFence = geoFenceDoc.data() || {};

    if (asTrimmedString(geoFence?.status).toUpperCase() !== "ACTIVE") {
      continue;
    }

    const polygonPoints = (Array.isArray(geoFence?.geometry?.points)
      ? [...geoFence.geometry.points]
      : []
    )
      .sort((left, right) => Number(left?.order ?? 0) - Number(right?.order ?? 0))
      .map((item) => ({
        latitude: Number(item?.latitude ?? item?.lat),
        longitude: Number(item?.longitude ?? item?.lng),
      }))
      .filter(
        (item) =>
          Number.isFinite(item.latitude) &&
          Number.isFinite(item.longitude),
      );

    if (
      doesEntityBelongToGeoFence({
        point,
        bbox: geoFence?.geometry?.bbox || null,
        polygonPoints,
      })
    ) {
      matches.push({
        id: geoFenceDoc.id,
        name:
          asTrimmedString(geoFence?.name) ||
          asTrimmedString(geoFence?.description) ||
          geoFenceDoc.id,
      });
    }
  }

  return normalizeGeoFenceRefs(matches);
}

export function allocateInformalErfNumber(counterData = {}) {
  const rawLastNumber = counterData?.lastNumber ?? 0;
  const lastNumber = Number(rawLastNumber);

  if (!Number.isInteger(lastNumber) || lastNumber < 0) {
    throw new Error(
      "ireps_counters/informal_erfs.lastNumber must be a non-negative integer.",
    );
  }

  const nextNumber = lastNumber + 1;

  if (nextNumber > 999999) {
    throw new Error("The global Informal ERF number range is exhausted.");
  }

  const parcelNo = `IE${String(nextNumber).padStart(6, "0")}`;

  if (!INFORMAL_ERF_NUMBER_PATTERN.test(parcelNo)) {
    throw new Error("The next Informal ERF parcel number is invalid.");
  }

  return { lastNumber: nextNumber, parcelNo };
}

export function buildInformalErfDocument({
  erfId,
  admin,
  canonicalPolygon,
  parcelNo,
  geofenceRefs,
  reason,
  deviceLocation,
  sitePhotos,
  actorUid,
  actorName,
}) {
  const createdAt = FieldValue.serverTimestamp();
  const updatedAt = FieldValue.serverTimestamp();
  const canonicalMedia = sitePhotos.map((photo) => ({
    created: {
      at: photo.createdAt,
      byUid: actorUid,
      byUser: actorName,
    },
    gps: photo.gps,
    tag: photo.tag,
    type: photo.type,
    updated: {
      at: photo.updatedAt,
      byUid: actorUid,
      byUser: actorName,
    },
    url: photo.url,
  }));

  return {
    erfId,
    admin,
    bbox: canonicalPolygon.bbox,
    centroid: canonicalPolygon.centroid,
    erf: {
      area: canonicalPolygon.areaM2,
      source: "IREPS",
      status: "S",
      type: "INFORMAL",
    },
    geofenceRefs: normalizeGeoFenceRefs(geofenceRefs),
    geometry: canonicalPolygon.geometryJson,
    metadata: {
      createdAt,
      createdByUid: actorUid,
      createdByUser: actorName,
      updatedAt,
      updatedByUid: actorUid,
      updatedByUser: actorName,
    },
    premises: [],
    sg: {
      dateStamp: null,
      majRegion: null,
      minRegion: null,
      parcelNo,
      portion: 0,
      prclKey: erfId,
      prclType: "E",
    },
    informalErfData: {
      reasonCode: reason.code,
      reasonOther: reason.otherText,
      media: canonicalMedia,
      deviceLocation,
    },
  };
}

function normalizeComparableCoordinate(value, fieldName) {
  const parsed = asFiniteNumber(value, fieldName);
  return Object.is(parsed, -0) ? 0 : parsed;
}

function buildCanonicalPolygonSignature(value, fieldName) {
  const polygonFeature = parseGeoJsonFeature(value, fieldName);

  if (polygonFeature?.geometry?.type !== "Polygon") {
    throw new Error(`${fieldName} must contain a Polygon.`);
  }

  const rings = polygonFeature.geometry.coordinates;

  if (!Array.isArray(rings) || rings.length !== 1) {
    throw new Error(`${fieldName} must contain exactly one polygon ring.`);
  }

  const rawRing = rings[0];

  if (!Array.isArray(rawRing)) {
    throw new Error(`${fieldName} has no usable polygon ring.`);
  }

  const points = rawRing.map((coordinate, index) => {
    if (!Array.isArray(coordinate) || coordinate.length !== 2) {
      throw new Error(
        `${fieldName}.coordinates[0][${index}] must contain [lng, lat].`,
      );
    }

    return [
      normalizeComparableCoordinate(
        coordinate[0],
        `${fieldName}.coordinates[0][${index}][0]`,
      ),
      normalizeComparableCoordinate(
        coordinate[1],
        `${fieldName}.coordinates[0][${index}][1]`,
      ),
    ];
  });

  if (
    points.length > 1 &&
    points[0][0] === points[points.length - 1][0] &&
    points[0][1] === points[points.length - 1][1]
  ) {
    points.pop();
  }

  if (points.length < MIN_BOUNDARY_VERTICES) {
    throw new Error(
      `${fieldName} must contain at least ${MIN_BOUNDARY_VERTICES} vertices.`,
    );
  }

  const candidates = [];

  for (const orientation of [points, [...points].reverse()]) {
    for (let index = 0; index < orientation.length; index += 1) {
      const rotated = [
        ...orientation.slice(index),
        ...orientation.slice(0, index),
      ];
      candidates.push(JSON.stringify(rotated));
    }
  }

  candidates.sort();
  return candidates[0];
}

function normalizeComparableInstant(value, fieldName) {
  const cleanValue = asTrimmedString(value);
  const parsedMs = Date.parse(cleanValue);

  if (!cleanValue || !Number.isFinite(parsedMs)) {
    throw new Error(`${fieldName} must be a valid timestamp.`);
  }

  return new Date(parsedMs).toISOString();
}

function normalizeComparableMediaItem({
  item,
  fieldName,
  incoming,
}) {
  if (!isPlainObject(item)) {
    throw new Error(`${fieldName} must be an object.`);
  }

  const tag = asTrimmedString(item.tag);
  const type = asTrimmedString(item.type);

  if (tag !== "informalErfSitePhoto" || type !== "image") {
    throw new Error(`${fieldName} has an invalid tag or type.`);
  }

  const parsedUrl = parseFirebaseStorageDownloadUrl(
    item.url,
    `${fieldName}.url`,
  );
  const gps =
    item.gps == null
      ? null
      : assertValidLatLng(item.gps, `${fieldName}.gps`);
  const capturedAt = normalizeComparableInstant(
    incoming ? item.createdAt : item?.created?.at,
    incoming ? `${fieldName}.createdAt` : `${fieldName}.created.at`,
  );

  if (incoming && parsedUrl.storagePath !== item.storagePath) {
    throw new Error(
      `${fieldName}.url must identify the submitted storagePath.`,
    );
  }

  return {
    tag,
    type,
    bucketName: parsedUrl.bucketName,
    storagePath: parsedUrl.storagePath,
    capturedAt,
    gps,
  };
}

function normalizeComparableMedia(media, fieldName, incoming) {
  if (!Array.isArray(media) || media.length === 0) {
    throw new Error(`${fieldName} must contain at least one photograph.`);
  }

  return media
    .map((item, index) =>
      normalizeComparableMediaItem({
        item,
        fieldName: `${fieldName}[${index}]`,
        incoming,
      }),
    )
    .map((item) => JSON.stringify(item))
    .sort();
}

function sameComparableValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function createSubmissionConflictError(mismatches) {
  const normalizedMismatches = Array.from(new Set(mismatches)).sort();
  const error = new Error(
    "The erfId is already used by a different completed Informal ERF submission.",
  );

  error.businessCode = "INFORMAL_ERF_ID_CONFLICT";
  error.mismatches = normalizedMismatches;
  return error;
}

export function assertSameCompletedSubmission({
  existing,
  erfId,
  lmPcode,
  wardPcode,
  actorUid,
  canonicalPolygon,
  reason,
  deviceLocation,
  sitePhotos,
}) {
  const identityMatches =
    existing?.erfId === erfId &&
    existing?.sg?.prclKey === erfId &&
    asTrimmedString(existing?.erf?.type).toUpperCase() === "INFORMAL" &&
    asTrimmedString(
      existing?.admin?.localMunicipality?.pcode,
    ).toUpperCase() === lmPcode &&
    asTrimmedString(existing?.admin?.ward?.pcode).toUpperCase() ===
      wardPcode &&
    existing?.metadata?.createdByUid === actorUid;

  if (!identityMatches) {
    throw createSubmissionConflictError(["identity"]);
  }

  const parcelNo = asTrimmedString(existing?.sg?.parcelNo);

  if (!INFORMAL_ERF_NUMBER_PATTERN.test(parcelNo)) {
    throw createSubmissionConflictError(["parcelNo"]);
  }

  let existingGeometrySignature;
  let incomingGeometrySignature;
  let existingReason;
  let existingDeviceLocation;
  let normalizedExistingMedia;
  let normalizedIncomingMedia;

  try {
    existingGeometrySignature = buildCanonicalPolygonSignature(
      existing?.geometry,
      "existing.geometry",
    );
    incomingGeometrySignature = buildCanonicalPolygonSignature(
      canonicalPolygon?.geometry,
      "incoming.geometry",
    );
    existingReason = normalizeReason(
      existing?.informalErfData?.reasonCode,
      existing?.informalErfData?.reasonOther,
    );
    existingDeviceLocation = assertValidDeviceLocation(
      existing?.informalErfData?.deviceLocation,
    );
    normalizedExistingMedia = normalizeComparableMedia(
      existing?.informalErfData?.media,
      "existing.informalErfData.media",
      false,
    );
    normalizedIncomingMedia = normalizeComparableMedia(
      sitePhotos,
      "incoming.media",
      true,
    );
  } catch {
    throw createSubmissionConflictError(["canonicalContent"]);
  }

  const mismatches = [];

  if (existingGeometrySignature !== incomingGeometrySignature) {
    mismatches.push("boundary");
  }

  if (existingReason.code !== reason?.code) {
    mismatches.push("reasonCode");
  }

  if (existingReason.otherText !== reason?.otherText) {
    mismatches.push("reasonOther");
  }

  if (!sameComparableValue(existingDeviceLocation, deviceLocation)) {
    mismatches.push("deviceLocation");
  }

  if (!sameComparableValue(normalizedExistingMedia, normalizedIncomingMedia)) {
    mismatches.push("media");
  }

  if (mismatches.length > 0) {
    throw createSubmissionConflictError(mismatches);
  }

  return {
    parcelNo,
    geofenceRefs: normalizeGeoFenceRefs(existing?.geofenceRefs || []),
  };
}
