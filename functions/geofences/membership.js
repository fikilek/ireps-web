// /functions/geofences/membership.js

/* eslint-disable no-undef */

import { getFirestore } from "firebase-admin/firestore";

import {
  appendGeoFenceRef,
  doesEntityBelongToGeoFence,
  extractAstPoint,
  extractErfPoint,
  extractPremisePoint,
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

function hasGeoFenceRef(item = {}, geoFenceId = "") {
  const refs = Array.isArray(item?.geofenceRefs) ? item.geofenceRefs : [];

  return refs.some((ref) => ref?.id === geoFenceId);
}

export const buildMembershipUpdate = ({
  docRef,
  existingGeoFenceRefs,
  geoFenceId,
  geoFenceName,
}) => {
  const currentGeoFenceRefs = normalizeGeoFenceRefs(existingGeoFenceRefs || []);

  const nextGeoFenceRefs = normalizeGeoFenceRefs(
    appendGeoFenceRef(currentGeoFenceRefs, {
      id: geoFenceId,
      name: geoFenceName,
    }),
  );

  const refsUnchanged = geoFenceRefsEqual(
    currentGeoFenceRefs,
    nextGeoFenceRefs,
  );

  if (refsUnchanged) {
    return null;
  }

  return {
    ref: docRef,
    data: {
      geofenceRefs: nextGeoFenceRefs,
    },
  };
};

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
      existingGeoFenceRefs: erfData?.geofenceRefs,
      geoFenceId,
      geoFenceName,
    });

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
      existingGeoFenceRefs: premiseData?.geofenceRefs,
      geoFenceId,
      geoFenceName,
    });

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
      existingGeoFenceRefs: astData?.geofenceRefs,
      geoFenceId,
      geoFenceName,
    });

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

  const erfSnapshot = await db
    .collection("ireps_erfs")
    .where("admin.localMunicipality.pcode", "==", lmPcode)
    .where("admin.ward.pcode", "==", wardPcode)
    .get();

  const premiseSnapshot = await db
    .collection("premises")
    .where("parents.lmPcode", "==", lmPcode)
    .where("parents.wardPcode", "==", wardPcode)
    .get();

  const astSnapshot = await db
    .collection("asts")
    .where("accessData.parents.lmPcode", "==", lmPcode)
    .where("accessData.parents.wardPcode", "==", wardPcode)
    .get();

  const erfs = erfSnapshot.docs.filter((doc) =>
    hasGeoFenceRef(doc.data(), geoFenceId),
  ).length;

  const premises = premiseSnapshot.docs.filter((doc) =>
    hasGeoFenceRef(doc.data(), geoFenceId),
  ).length;

  const meters = astSnapshot.docs.filter((doc) =>
    hasGeoFenceRef(doc.data(), geoFenceId),
  ).length;

  return {
    erfs,
    premises,
    meters,
  };
};
