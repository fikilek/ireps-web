// /functions/geofences/callables.js

/* eslint-disable no-undef */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";

import {
  validateCreateGeoFencePayload,
  normalizeGeoFencePoints,
  buildGeoFenceBoundingBox,
  buildGeoFenceCentroid,
  getActorUserDoc,
  getAllServiceProviders,
  getUserDisplayName,
  assertCanCreateGeoFence,
} from "./helpers.js";

/* =====================================================
   CREATE GEOFENCE
   ===================================================== */

export const createGeoFence = onCall(async (request) => {
  const db = getFirestore();

  const actorUid = request.auth?.uid || null;
  if (!actorUid) {
    throw new HttpsError("unauthenticated", "Authentication is required.");
  }

  const { name, description, parents, rawPoints } =
    validateCreateGeoFencePayload(request.data || {});

  const actorUserDoc = await getActorUserDoc(db, actorUid);
  const allServiceProviders = await getAllServiceProviders(db);

  await assertCanCreateGeoFence({
    actorUserDoc,
    allServiceProviders,
  });

  const actorName = getUserDisplayName(actorUserDoc);

  const points = normalizeGeoFencePoints(rawPoints);

  if (points.length < 3) {
    throw new HttpsError(
      "invalid-argument",
      "A geofence must have at least 3 valid coordinate points.",
    );
  }

  const bbox = buildGeoFenceBoundingBox(points);
  const centroid = buildGeoFenceCentroid(points);

  const geoFenceRef = db.collection("geo_fences").doc();
  const now = new Date().toISOString();

  await geoFenceRef.set({
    id: geoFenceRef.id,
    name,
    description,
    status: "ACTIVE",

    geometry: {
      type: "Polygon",
      points,
      centroid,
      bbox,
    },

    parents,

    counts: {
      erfs: 0,
      premises: 0,
      meters: 0,
    },

    metadata: {
      createdAt: now,
      createdByUid: actorUid,
      createdByUser: actorName,
      updatedAt: now,
      updatedByUid: actorUid,
      updatedByUser: actorName,
    },
  });

  return {
    success: true,
    geofenceId: geoFenceRef.id,
    counts: {
      erfs: 0,
      premises: 0,
      meters: 0,
    },
  };
});
