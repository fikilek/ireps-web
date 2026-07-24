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
const INFORMAL_ERF_ID_PATTERN = /^IE-(ZA\d{7})-\d{8}-\d{6}-\d{4}$/;
const LEGACY_INFORMAL_ERF_ID_PATTERN = /^IE-\d{8}-\d{6}-\d{4}$/;
const INFORMAL_ERF_NUMBER_PATTERN = /^IE\d{6}$/;

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
  if (!isPlainObject(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }

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
  if (!isPlainObject(value)) {
    throw new Error("deviceLocation must be an object.");
  }

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

export function assertInformalErfId(erfId, wardPcode) {
  const cleanErfId = asTrimmedString(erfId);
  const cleanWardPcode = asTrimmedString(wardPcode).toUpperCase();
  const currentMatch = cleanErfId.match(INFORMAL_ERF_ID_PATTERN);

  if (currentMatch) {
    if (currentMatch[1] !== cleanWardPcode) {
      throw new Error(
        "The wardPcode embedded in erfId must match the submitted wardPcode.",
      );
    }

    return cleanErfId;
  }

  // Preserve idempotent retries for pilot or locally queued submissions that
  // were created before wardPcode became part of the technical ERF identity.
  if (LEGACY_INFORMAL_ERF_ID_PATTERN.test(cleanErfId)) {
    return cleanErfId;
  }

  throw new Error(
    "erfId must follow IE-{wardPcode}-YYYYMMDD-hhmmss-XXXX, for example IE-ZA7423006-20260724-225238-8629.",
  );
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

function normalizeMediaTimestamp(value, fallbackMs, fieldName) {
  const direct = Date.parse(asTrimmedString(value));

  if (Number.isFinite(direct) && direct > 0) {
    return new Date(direct).toISOString();
  }

  if (fallbackMs != null) {
    const fallback = assertPositiveEpochMs(fallbackMs, fieldName);
    return new Date(fallback).toISOString();
  }

  throw new Error(`${fieldName} must contain a valid capture timestamp.`);
}

function assertPhotoDownloadUrl(value, storagePath, fieldName) {
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

  const objectMarker = "/o/";
  const objectMarkerIndex = parsedUrl.pathname.indexOf(objectMarker);

  if (objectMarkerIndex < 0) {
    throw new Error(`${fieldName} does not identify a Storage object.`);
  }

  let urlStoragePath;

  try {
    urlStoragePath = decodeURIComponent(
      parsedUrl.pathname.slice(objectMarkerIndex + objectMarker.length),
    );
  } catch {
    throw new Error(`${fieldName} contains an invalid object path.`);
  }

  if (urlStoragePath !== storagePath) {
    throw new Error(
      `${fieldName} must point to the same object as media.storagePath.`,
    );
  }

  return cleanUrl;
}

export function normalizeSitePhotos(media, erfId) {
  if (!Array.isArray(media)) {
    throw new Error("media must be an array.");
  }

  const expectedPrefix = `informal_erfs/${erfId}/`;

  const sitePhotos = media
    .filter((item) => item?.tag === "informalErfSitePhoto")
    .map((item, index) => {
      const storagePath = asTrimmedString(item?.storagePath);

      if (!storagePath) {
        throw new Error(
          `media[${index}].storagePath is required before server submission.`,
        );
      }

      if (!storagePath.startsWith(expectedPrefix)) {
        throw new Error(
          `media[${index}].storagePath must start with ${expectedPrefix}.`,
        );
      }

      const gps =
        item?.gps == null
          ? null
          : assertValidLatLng(item.gps, `media[${index}].gps`);

      const capturedAtMs =
        item?.capturedAtMs == null
          ? null
          : assertPositiveEpochMs(
              item.capturedAtMs,
              `media[${index}].capturedAtMs`,
            );
      const createdAt = normalizeMediaTimestamp(
        item?.created?.at,
        capturedAtMs,
        `media[${index}].created.at`,
      );
      const updatedAt = normalizeMediaTimestamp(
        item?.updated?.at || item?.created?.at,
        capturedAtMs,
        `media[${index}].updated.at`,
      );
      const url = assertPhotoDownloadUrl(
        item?.url,
        storagePath,
        `media[${index}].url`,
      );

      return {
        tag: "informalErfSitePhoto",
        type: "image",
        storagePath,
        url,
        createdAt,
        updatedAt,
        gps,
      };
    });

  if (sitePhotos.length === 0) {
    throw new Error(
      "At least one uploaded informalErfSitePhoto is required.",
    );
  }

  return sitePhotos;
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
      // Legacy v1 Informal ERFs may not have a complete canonical bbox.
      // Derive a temporary bbox from their stored geometry so they remain
      // collision targets during the v2 migration period.
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
      // Legacy v1 Informal ERFs were Point geometries. Treat the point as a
      // collision target rather than skipping it or accepting unsafe overlap.
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

export function assertSameCompletedSubmission({
  existing,
  erfId,
  lmPcode,
  wardPcode,
  actorUid,
}) {
  const matches =
    existing?.erfId === erfId &&
    existing?.sg?.prclKey === erfId &&
    asTrimmedString(existing?.erf?.type).toUpperCase() === "INFORMAL" &&
    asTrimmedString(
      existing?.admin?.localMunicipality?.pcode,
    ).toUpperCase() === lmPcode &&
    asTrimmedString(existing?.admin?.ward?.pcode).toUpperCase() ===
      wardPcode &&
    existing?.metadata?.createdByUid === actorUid;

  if (!matches) {
    throw new Error(
      "The erfId is already used by a different ERF submission.",
    );
  }

  const parcelNo = asTrimmedString(existing?.sg?.parcelNo);

  if (!INFORMAL_ERF_NUMBER_PATTERN.test(parcelNo)) {
    throw new Error(
      "The existing Informal ERF has no valid canonical sg.parcelNo.",
    );
  }

  return {
    parcelNo,
    geofenceRefs: normalizeGeoFenceRefs(existing?.geofenceRefs || []),
  };
}
