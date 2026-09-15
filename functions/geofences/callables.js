// /functions/geofences/callables.js


import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { createSalesBatchGeofence } from "../targetedBatches/sales-batch-geofence.js";
import { createProofCodec, salesBatchProofKey, callableFailure } from "../targetedBatches/sales-batch-resolution.js";
import { checkGeofenceName, findDuplicateGeofence, duplicateGeofenceNameMessage } from "./geofence-name.js";

import {
  validateCreateGeoFencePayload,
  normalizeGeoFencePoints,
  buildGeoFenceDocument,
  getActorUserDoc,
  getAllServiceProviders,
  getUserDisplayName,
  assertCanCreateGeoFence,
} from "./helpers.js";

/* =====================================================
   CREATE GEOFENCE
   ===================================================== */

export async function createGeoFenceRequest({ db, request, codec }) {

  const actorUid = request.auth?.uid || null;
  if (!actorUid) {
    throw new HttpsError("unauthenticated", "Authentication is required.");
  }

  const { name, description, parents, rawPoints } =
    validateCreateGeoFencePayload(request.data || {});

  // Geofences rules GF-R001: every new geofence, area or batch, is named
  // "Gf W<Ward number> <name>" for its own Ward.
  const nameCheck = checkGeofenceName(name, parents?.wardPcode);
  if (!nameCheck.ok) {
    throw new HttpsError("invalid-argument", nameCheck.reason);
  }

  if (request.data?.targetedBatch !== undefined) {
    return createSalesBatchGeofence({ db, request, codec, name, description, parents, rawPoints });
  }

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

  const geoFenceRef = db.collection("geo_fences").doc();
  // Geofences rules GF-R002: no two active geofences in a Ward share a name. Reading the Ward's
  // geofences inside the transaction makes a concurrent create of the same name conflict.
  await db.runTransaction(async (tx) => {
    const wardFences = await tx.get(db.collection("geo_fences").where("parents.wardPcode", "==", parents.wardPcode));
    const duplicate = findDuplicateGeofence(name, wardFences.docs.map((doc) => doc.data()));
    if (duplicate) throw new HttpsError("already-exists", duplicateGeofenceNameMessage(duplicate));
    tx.create(geoFenceRef, buildGeoFenceDocument({
      id: geoFenceRef.id, name, description, parents, points, actorUid, actorName, now: new Date().toISOString(),
    }));
  });

  return {
    success: true,
    geofenceId: geoFenceRef.id,
    counts: {
      erfs: 0,
      premises: 0,
      meters: 0,
      salesMeters: 0,
    },
  };
}

export const createGeoFence = onCall({ secrets: [salesBatchProofKey], timeoutSeconds: 180, memory: "1GiB" }, async request => {
  try {
    return await createGeoFenceRequest({ db: getFirestore(), request,
      codec: request.data?.targetedBatch !== undefined ? createProofCodec(salesBatchProofKey.value()) : null });
  } catch (error) {
    if (request.data?.targetedBatch !== undefined) return callableFailure(error);
    throw error;
  }
});
