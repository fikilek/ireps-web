// /functions/geofences/helpers.js

/* eslint-disable no-undef */

import { HttpsError } from "firebase-functions/v2/https";

/* =====================================================
   BASIC NORMALIZERS
   ===================================================== */

export const normalizeText = (value) => {
  if (value === undefined || value === null) return "NAv";

  const text = String(value).trim();

  if (!text) return "NAv";

  return text;
};

export const normalizeGeoFenceName = (value) => {
  const text = normalizeText(value);
  return text === "NAv" ? "" : text;
};

export const normalizeGeoFenceDescription = (value) => {
  return normalizeText(value);
};

export const normalizeParents = (parents = {}) => {
  return {
    countryPcode: normalizeText(parents?.countryPcode),
    provincePcode: normalizeText(parents?.provincePcode),
    dmPcode: normalizeText(parents?.dmPcode),
    lmPcode: normalizeText(parents?.lmPcode),
    wardPcode: normalizeText(parents?.wardPcode),
  };
};

/* =====================================================
   VALIDATION
   ===================================================== */

export const validateCreateGeoFencePayload = (data = {}) => {
  const name = normalizeGeoFenceName(data?.name);
  const description = normalizeGeoFenceDescription(data?.description);
  const parents = normalizeParents(data?.parents || {});
  const rawPoints = Array.isArray(data?.points) ? data.points : [];

  if (!name) {
    throw new HttpsError("invalid-argument", "Geofence name is required.");
  }

  if (rawPoints.length < 3) {
    throw new HttpsError(
      "invalid-argument",
      "A geofence must have at least 3 points.",
    );
  }

  if (parents?.lmPcode === "NAv") {
    throw new HttpsError("invalid-argument", "Local Municipality is required.");
  }

  if (parents?.wardPcode === "NAv") {
    throw new HttpsError("invalid-argument", "Ward is required.");
  }

  return {
    name,
    description,
    parents,
    rawPoints,
  };
};

/* =====================================================
   GEOMETRY HELPERS
   ===================================================== */

export const normalizeGeoFencePoints = (points = []) => {
  if (!Array.isArray(points)) return [];

  return points
    .map((point, index) => ({
      latitude: Number(point?.latitude),
      longitude: Number(point?.longitude),
      order: index,
    }))
    .filter(
      (point) =>
        Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
    );
};

export const buildGeoFenceBoundingBox = (points = []) => {
  if (!Array.isArray(points) || points.length === 0) {
    return null;
  }

  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);

  return {
    minLatitude: Math.min(...latitudes),
    maxLatitude: Math.max(...latitudes),
    minLongitude: Math.min(...longitudes),
    maxLongitude: Math.max(...longitudes),
  };
};

export const buildGeoFenceCentroid = (points = []) => {
  if (!Array.isArray(points) || points.length === 0) {
    return null;
  }

  const totals = points.reduce(
    (acc, point) => {
      acc.latitude += point.latitude;
      acc.longitude += point.longitude;
      return acc;
    },
    { latitude: 0, longitude: 0 },
  );

  return {
    latitude: totals.latitude / points.length,
    longitude: totals.longitude / points.length,
  };
};

export const isPointInBoundingBox = (point, bbox) => {
  if (!point || !bbox) return false;

  return (
    point.latitude >= bbox.minLatitude &&
    point.latitude <= bbox.maxLatitude &&
    point.longitude >= bbox.minLongitude &&
    point.longitude <= bbox.maxLongitude
  );
};

export const isPointInsidePolygon = (point, polygonPoints = []) => {
  if (!point || !Array.isArray(polygonPoints) || polygonPoints.length < 3) {
    return false;
  }

  let inside = false;

  for (
    let currentIndex = 0, previousIndex = polygonPoints.length - 1;
    currentIndex < polygonPoints.length;
    previousIndex = currentIndex++
  ) {
    const currentLongitude = polygonPoints[currentIndex].longitude;
    const currentLatitude = polygonPoints[currentIndex].latitude;
    const previousLongitude = polygonPoints[previousIndex].longitude;
    const previousLatitude = polygonPoints[previousIndex].latitude;

    const intersects =
      currentLatitude > point.latitude !== previousLatitude > point.latitude &&
      point.longitude <
        ((previousLongitude - currentLongitude) *
          (point.latitude - currentLatitude)) /
          (previousLatitude - currentLatitude) +
          currentLongitude;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
};

/* =====================================================
   GEOFENCE MEMBERSHIP HELPERS
   ===================================================== */

export const appendGeoFenceId = (existingGeoFenceIds = [], geoFenceId) => {
  const cleanIds = Array.isArray(existingGeoFenceIds)
    ? existingGeoFenceIds
    : [];
  const cleanGeoFenceId = String(geoFenceId || "").trim();

  if (!cleanGeoFenceId) return cleanIds;
  if (cleanIds.includes(cleanGeoFenceId)) return cleanIds;

  return [...cleanIds, cleanGeoFenceId];
};

export const removeGeoFenceId = (existingGeoFenceIds = [], geoFenceId) => {
  const cleanIds = Array.isArray(existingGeoFenceIds)
    ? existingGeoFenceIds
    : [];
  const cleanGeoFenceId = String(geoFenceId || "").trim();

  if (!cleanGeoFenceId) return cleanIds;

  return cleanIds.filter((id) => id !== cleanGeoFenceId);
};

export const normalizeGeoFenceIds = (geoFenceIds = []) => {
  const seen = new Set();

  return (Array.isArray(geoFenceIds) ? geoFenceIds : [])
    .map((id) => String(id || "").trim())
    .filter((id) => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
};

export const normalizeGeoFenceRef = (value = {}) => {
  const id = String(value?.id || "").trim();
  const name = normalizeText(value?.name);

  if (!id) return null;

  return {
    id,
    name: name === "NAv" ? id : name,
  };
};

export const normalizeGeoFenceRefs = (geoFenceRefs = []) => {
  const seen = new Set();

  return (Array.isArray(geoFenceRefs) ? geoFenceRefs : [])
    .map((item) => normalizeGeoFenceRef(item))
    .filter((item) => {
      if (!item?.id) return false;
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((left, right) => left.id.localeCompare(right.id));
};

export const appendGeoFenceRef = (
  existingGeoFenceRefs = [],
  geoFenceRef = {},
) => {
  const cleanRefs = normalizeGeoFenceRefs(existingGeoFenceRefs);
  const cleanRef = normalizeGeoFenceRef(geoFenceRef);

  if (!cleanRef) return cleanRefs;

  const withoutSameId = cleanRefs.filter((item) => item.id !== cleanRef.id);

  return normalizeGeoFenceRefs([...withoutSameId, cleanRef]);
};

/* =====================================================
   ENTITY POINT EXTRACTION
   ===================================================== */

export const extractErfPoint = (erf = {}) => {
  const lat = Number(erf?.centroid?.lat);
  const lng = Number(erf?.centroid?.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    latitude: lat,
    longitude: lng,
  };
};

export const extractPremisePoint = (premise = {}) => {
  const lat = Number(premise?.geometry?.centroid?.lat);
  const lng = Number(premise?.geometry?.centroid?.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    latitude: lat,
    longitude: lng,
  };
};

export const extractAstPoint = (ast = {}) => {
  const lat = Number(ast?.ast?.location?.gps?.lat);
  const lng = Number(ast?.ast?.location?.gps?.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    latitude: lat,
    longitude: lng,
  };
};

export const normalizeCoordinatePoint = (value) => {
  const latitude = Number(value?.latitude ?? value?.lat);
  const longitude = Number(value?.longitude ?? value?.lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    latitude,
    longitude,
  };
};

/* =====================================================
   SERVICE PROVIDER / PERMISSION HELPERS
   ===================================================== */

export const getActorUserDoc = async (db, actorUid) => {
  const actorSnap = await db.collection("users").doc(actorUid).get();

  if (!actorSnap.exists) {
    throw new HttpsError("not-found", "Actor user profile not found.");
  }

  return {
    uid: actorSnap.id,
    ...actorSnap.data(),
  };
};

export const getAllServiceProviders = async (db) => {
  const snap = await db.collection("serviceProviders").get();

  return snap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
};

export const getUserDisplayName = (userDoc = {}) => {
  return (
    userDoc?.profile?.displayName ||
    userDoc?.profile?.name ||
    userDoc?.metadata?.updatedByUser ||
    userDoc?.metadata?.createdByUser ||
    "System"
  );
};

export const isMncServiceProvider = (serviceProvider = {}) => {
  const clients = Array.isArray(serviceProvider?.clients)
    ? serviceProvider.clients
    : [];

  return clients.some(
    (client) =>
      client?.clientType === "LM" &&
      client?.relationshipType === "MNC" &&
      client?.id,
  );
};

export const isSubcServiceProvider = (serviceProvider = {}) => {
  const clients = Array.isArray(serviceProvider?.clients)
    ? serviceProvider.clients
    : [];

  return clients.some(
    (client) =>
      client?.clientType === "SP" &&
      client?.relationshipType === "SUBC" &&
      client?.id,
  );
};

export const assertCanCreateGeoFence = async ({
  actorUserDoc,
  allServiceProviders,
}) => {
  const actorRole = String(actorUserDoc?.employment?.role || "").trim();

  if (["SPU", "ADM", "MNG"].includes(actorRole)) {
    return true;
  }

  if (actorRole === "SPV") {
    const actorServiceProviderId = String(
      actorUserDoc?.employment?.serviceProvider?.id || "",
    ).trim();

    if (!actorServiceProviderId) {
      throw new HttpsError(
        "permission-denied",
        "Supervisor is not linked to a valid service provider.",
      );
    }

    const actorServiceProvider = (allServiceProviders || []).find(
      (serviceProvider) => serviceProvider?.id === actorServiceProviderId,
    );

    if (!actorServiceProvider) {
      throw new HttpsError(
        "permission-denied",
        "Supervisor service provider could not be resolved.",
      );
    }

    if (!isMncServiceProvider(actorServiceProvider)) {
      throw new HttpsError(
        "permission-denied",
        "Only MNC supervisors may create geofences.",
      );
    }

    return true;
  }

  throw new HttpsError(
    "permission-denied",
    "You are not allowed to create geofences.",
  );
};

/* =====================================================
   ENTITY SCOPE HELPERS
   ===================================================== */

export const isEntityInLmWardScope = (entity = {}, lmPcode, wardPcode) => {
  const entityLmPcode = normalizeText(entity?.parents?.lmPcode);
  const entityWardPcode = normalizeText(entity?.parents?.wardPcode);

  return entityLmPcode === lmPcode && entityWardPcode === wardPcode;
};

/* =====================================================
   MEMBERSHIP RESOLUTION
   ===================================================== */

export const doesEntityBelongToGeoFence = ({ point, bbox, polygonPoints }) => {
  if (!point) return false;
  if (!bbox) return false;
  if (!Array.isArray(polygonPoints) || polygonPoints.length < 3) return false;

  if (!isPointInBoundingBox(point, bbox)) {
    return false;
  }

  return isPointInsidePolygon(point, polygonPoints);
};
