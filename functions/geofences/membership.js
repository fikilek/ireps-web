// /functions/geofences/membership.js

/* eslint-disable no-undef */

import { getFirestore } from "firebase-admin/firestore";

import {
  appendGeoFenceId,
  appendGeoFenceRef,
  doesEntityBelongToGeoFence,
  extractAstPoint,
  extractErfPoint,
  extractPremisePoint,
  normalizeGeoFenceIds,
  normalizeGeoFenceRefs,
} from "./helpers.js";

/* =====================================================
   GENERIC HELPERS
   ===================================================== */

export const chunkArray = (items = [], size = 200) => {
  if (!Array.isArray(items) || !items.length) return [];
  if (!Number.isFinite(size) || size <= 0) return [items];

  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

export const primitiveArraysEqual = (left = [], right = []) => {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;

  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }

  return true;
};

export const geoFenceRefsEqual = (left = [], right = []) => {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;

  for (let i = 0; i < left.length; i += 1) {
    if (left[i]?.id !== right[i]?.id) return false;
    if (left[i]?.name !== right[i]?.name) return false;
  }

  return true;
};

// export const arraysEqual = (left = [], right = []) => {
//   if (left === right) return true;
//   if (!Array.isArray(left) || !Array.isArray(right)) return false;
//   if (left.length !== right.length) return false;

//   for (let i = 0; i < left.length; i += 1) {
//     if (left[i] !== right[i]) return false;
//   }

//   return true;
// };

export const buildMembershipUpdate = ({
  docRef,
  existingGeoFenceIds,
  existingGeoFenceRefs,
  geoFenceId,
  geoFenceName,
}) => {
  const currentGeoFenceIds = normalizeGeoFenceIds(existingGeoFenceIds || []);
  const nextGeoFenceIds = normalizeGeoFenceIds(
    appendGeoFenceId(currentGeoFenceIds, geoFenceId),
  );

  const currentGeoFenceRefs = normalizeGeoFenceRefs(existingGeoFenceRefs || []);
  const nextGeoFenceRefs = normalizeGeoFenceRefs(
    appendGeoFenceRef(currentGeoFenceRefs, {
      id: geoFenceId,
      name: geoFenceName,
    }),
  );

  const idsUnchanged = primitiveArraysEqual(
    currentGeoFenceIds,
    nextGeoFenceIds,
  );

  const refsUnchanged = geoFenceRefsEqual(
    currentGeoFenceRefs,
    nextGeoFenceRefs,
  );

  if (idsUnchanged && refsUnchanged) {
    return null;
  }

  return {
    ref: docRef,
    data: {
      geofenceIds: nextGeoFenceIds,
      geofenceRefs: nextGeoFenceRefs,
    },
  };
};

// export const buildMembershipUpdate = ({
//   docRef,
//   existingGeoFenceIds,
//   geoFenceId,
// }) => {
//   const currentGeoFenceIds = normalizeGeoFenceIds(existingGeoFenceIds || []);
//   const nextGeoFenceIds = normalizeGeoFenceIds(
//     appendGeoFenceId(currentGeoFenceIds, geoFenceId),
//   );

//   if (arraysEqual(currentGeoFenceIds, nextGeoFenceIds)) {
//     return null;
//   }

//   return {
//     ref: docRef,
//     data: {
//       geofenceIds: nextGeoFenceIds,
//     },
//   };
// };

/* =====================================================
   COLLECT ENTITY UPDATES
   ===================================================== */

export const collectGeoFenceErfUpdates = ({
  erfDocs = [],
  geoFenceId,
  geoFenceName,
  bbox,
  polygonPoints,
}) => {
  const updates = [];

  for (const erfDoc of erfDocs) {
    const erfData = erfDoc.data() || {};
    const point = extractErfPoint(erfData);

    if (!point) continue;

    const belongs = doesEntityBelongToGeoFence({
      point,
      bbox,
      polygonPoints,
    });

    if (!belongs) continue;

    const update = buildMembershipUpdate({
      docRef: erfDoc.ref,
      existingGeoFenceIds: erfData?.geofenceIds,
      existingGeoFenceRefs: erfData?.geofenceRefs,
      geoFenceId,
      geoFenceName,
    });

    // const update = buildMembershipUpdate({
    //   docRef: erfDoc.ref,
    //   existingGeoFenceIds: erfData?.geofenceIds,
    //   geoFenceId,
    // });

    if (update) {
      updates.push(update);
    }
  }

  return updates;
};

export const collectGeoFencePremiseUpdates = ({
  premiseDocs = [],
  geoFenceId,
  geoFenceName,
  bbox,
  polygonPoints,
}) => {
  const updates = [];

  for (const premiseDoc of premiseDocs) {
    const premiseData = premiseDoc.data() || {};
    const point = extractPremisePoint(premiseData);

    if (!point) continue;

    const belongs = doesEntityBelongToGeoFence({
      point,
      bbox,
      polygonPoints,
    });

    if (!belongs) continue;

    const update = buildMembershipUpdate({
      docRef: premiseDoc.ref,
      existingGeoFenceIds: premiseData?.geofenceIds,
      existingGeoFenceRefs: premiseData?.geofenceRefs,
      geoFenceId,
      geoFenceName,
    });

    // const update = buildMembershipUpdate({
    //   docRef: premiseDoc.ref,
    //   existingGeoFenceIds: premiseData?.geofenceIds,
    //   geoFenceId,
    // });

    if (update) {
      updates.push(update);
    }
  }

  return updates;
};

export const collectGeoFenceAstUpdates = ({
  astDocs = [],
  geoFenceId,
  geoFenceName,
  bbox,
  polygonPoints,
}) => {
  const updates = [];

  for (const astDoc of astDocs) {
    const astData = astDoc.data() || {};
    const point = extractAstPoint(astData);

    if (!point) continue;

    const belongs = doesEntityBelongToGeoFence({
      point,
      bbox,
      polygonPoints,
    });

    if (!belongs) continue;

    const update = buildMembershipUpdate({
      docRef: astDoc.ref,
      existingGeoFenceIds: astData?.geofenceIds,
      existingGeoFenceRefs: astData?.geofenceRefs,
      geoFenceId,
      geoFenceName,
    });

    // const update = buildMembershipUpdate({
    //   docRef: astDoc.ref,
    //   existingGeoFenceIds: astData?.geofenceIds,
    //   geoFenceId,
    // });

    if (update) {
      updates.push(update);
    }
  }

  return updates;
};

/* =====================================================
   COMMIT UPDATES IN BATCHES
   ===================================================== */

export const commitGeoFenceMembershipUpdates = async ({
  db,
  updates = [],
  batchSize = 200,
}) => {
  if (!db) {
    db = getFirestore();
  }

  if (!Array.isArray(updates) || updates.length === 0) {
    return {
      batchesCommitted: 0,
      docsUpdated: 0,
    };
  }

  const chunks = chunkArray(updates, batchSize);
  let batchesCommitted = 0;
  let docsUpdated = 0;

  for (const chunk of chunks) {
    const batch = db.batch();

    for (const update of chunk) {
      batch.update(update.ref, update.data);
    }

    await batch.commit();

    batchesCommitted += 1;
    docsUpdated += chunk.length;
  }

  return {
    batchesCommitted,
    docsUpdated,
  };
};

/* =====================================================
   RECOMPUTE AUTHORITATIVE COUNTS
   ===================================================== */

export const recomputeGeoFenceCounts = async ({
  db,
  geoFenceId,
  lmPcode,
  wardPcode,
}) => {
  if (!db) {
    db = getFirestore();
  }

  const erfCountSnapshot = await db
    .collection("ireps_erfs")
    .where("admin.localMunicipality.pcode", "==", lmPcode)
    .where("admin.ward.pcode", "==", wardPcode)
    .where("geofenceIds", "array-contains", geoFenceId)
    .count()
    .get();

  const premiseCountSnapshot = await db
    .collection("premises")
    .where("parents.lmPcode", "==", lmPcode)
    .where("parents.wardPcode", "==", wardPcode)
    .where("geofenceIds", "array-contains", geoFenceId)
    .count()
    .get();

  const astCountSnapshot = await db
    .collection("asts")
    .where("accessData.parents.lmPcode", "==", lmPcode)
    .where("accessData.parents.wardPcode", "==", wardPcode)
    .where("geofenceIds", "array-contains", geoFenceId)
    .count()
    .get();

  return {
    erfs: erfCountSnapshot.data().count || 0,
    premises: premiseCountSnapshot.data().count || 0,
    meters: astCountSnapshot.data().count || 0,
  };
};
