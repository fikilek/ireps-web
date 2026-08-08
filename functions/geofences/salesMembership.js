// /functions/geofences/salesMembership.js

/* eslint-disable no-undef */

import { FieldValue } from "firebase-admin/firestore";

import {
  doesEntityBelongToGeoFence,
} from "./helpers.js";


function chunkArray(items = [], size = 200) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizeScopeValue(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeRefId(value) {
  return String(value || "").trim();
}

function normalizeRefName(value) {
  return String(value ?? "").trim();
}

function getSalesErfCandidates(sales = {}) {
  const candidates = sales?.ErfCandidates ?? sales?.erfCandidates;
  return Array.isArray(candidates) ? candidates : [];
}

function extractSalesCandidatePoint(candidate = {}) {
  const latitude = Number(candidate?.Latitude ?? candidate?.latitude);
  const longitude = Number(candidate?.Longitude ?? candidate?.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function candidateMatchesScope(candidate = {}, lmPcode, wardPcode) {
  const candidateLmPcode = normalizeScopeValue(
    candidate?.LmPcode ?? candidate?.lmPcode,
  );
  const candidateWardPcode = normalizeScopeValue(
    candidate?.WardPcode ?? candidate?.wardPcode,
  );

  return (
    candidateLmPcode === normalizeScopeValue(lmPcode) &&
    candidateWardPcode === normalizeScopeValue(wardPcode)
  );
}

function hasUsableSalesGps(sales = {}) {
  return sales?.hasUsableGps === true || sales?.HasUsableGps === true;
}

function inspectExistingGeoFenceRef(sales = {}, geoFenceId, geoFenceName) {
  const refs = Array.isArray(sales?.geofenceRefs) ? sales.geofenceRefs : [];
  const normalizedId = normalizeRefId(geoFenceId);
  const normalizedName = normalizeRefName(geoFenceName);
  const matches = refs.filter(
    (ref) => normalizeRefId(ref?.id).toUpperCase() === normalizedId.toUpperCase(),
  );

  if (matches.length > 1) {
    return {
      state: "CONFLICT",
      code: "GEOFENCE_REF_DUPLICATE_LOGICAL_ID",
      existingRefs: matches,
    };
  }

  if (matches.length === 1) {
    const existingRawName = matches[0]?.name;
    const existingName = normalizeRefName(existingRawName);

    if (existingRawName !== undefined && existingRawName !== null &&
        existingName !== normalizedName) {
      return {
        state: "CONFLICT",
        code: "GEOFENCE_REF_NAME_CONFLICT",
        existingRefs: matches,
      };
    }

    return { state: "ALREADY_LINKED", existingRefs: matches };
  }

  return { state: "ADD", existingRefs: [] };
}

export const collectGeoFenceSalesUpdates = ({
  salesDocs = [],
  geoFenceId,
  geoFenceName,
  lmPcode,
  wardPcode,
  bbox,
  polygonPoints,
}) => {
  const updates = [];
  const conflicts = [];
  let memberCount = 0;
  let candidatePointsChecked = 0;

  const canonicalRef = {
    id: normalizeRefId(geoFenceId),
    name: normalizeRefName(geoFenceName),
  };

  for (const salesDoc of salesDocs) {
    const sales = salesDoc.data() || {};

    if (!hasUsableSalesGps(sales)) continue;

    const candidates = getSalesErfCandidates(sales);
    let belongs = false;

    for (const candidate of candidates) {
      if (!candidateMatchesScope(candidate, lmPcode, wardPcode)) continue;

      const point = extractSalesCandidatePoint(candidate);
      if (!point) continue;

      candidatePointsChecked += 1;

      if (doesEntityBelongToGeoFence({ point, bbox, polygonPoints })) {
        belongs = true;
        break;
      }
    }

    if (!belongs) continue;

    memberCount += 1;

    const existing = inspectExistingGeoFenceRef(
      sales,
      canonicalRef.id,
      canonicalRef.name,
    );

    if (existing.state === "CONFLICT") {
      conflicts.push({
        salesDocId: salesDoc.id,
        salesPath: salesDoc.ref?.path || null,
        code: existing.code,
        geoFenceId: canonicalRef.id,
        geoFenceName: canonicalRef.name,
        existingRefs: existing.existingRefs,
      });
      continue;
    }

    if (existing.state === "ALREADY_LINKED") continue;

    updates.push({
      ref: salesDoc.ref,
      geoFenceRef: canonicalRef,
    });
  }

  return {
    updates,
    conflicts,
    memberCount,
    candidatePointsChecked,
  };
};

export const commitGeoFenceSalesMembershipUpdates = async ({
  db,
  updates = [],
  conflicts = [],
  batchSize = 200,
}) => {
  if (Array.isArray(conflicts) && conflicts.length > 0) {
    const error = new Error(
      `Sales geofence membership integrity conflict on ${conflicts.length} document(s).`,
    );
    error.code = "SALES_GEOFENCE_MEMBERSHIP_INTEGRITY_CONFLICT";
    error.details = { conflicts: conflicts.slice(0, 20) };
    throw error;
  }

  if (!Array.isArray(updates) || updates.length === 0) {
    return { batchesCommitted: 0, docsUpdated: 0 };
  }

  const chunks = chunkArray(updates, batchSize);
  let batchesCommitted = 0;
  let docsUpdated = 0;

  for (const chunk of chunks) {
    const batch = db.batch();

    for (const update of chunk) {
      batch.update(update.ref, {
        geofenceRefs: FieldValue.arrayUnion(update.geoFenceRef),
      });
    }

    await batch.commit();
    batchesCommitted += 1;
    docsUpdated += chunk.length;
  }

  return { batchesCommitted, docsUpdated };
};
