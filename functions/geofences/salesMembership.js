// /functions/geofences/salesMembership.js

/* eslint-disable no-undef */

import {
  appendGeoFenceRef,
  doesEntityBelongToGeoFence,
  normalizeGeoFenceRefs,
} from "./helpers.js";

function normalizeScopeValue(value) {
  return String(value || "").trim().toUpperCase();
}

function geoFenceRefsEqual(left = [], right = []) {
  const cleanLeft = normalizeGeoFenceRefs(left);
  const cleanRight = normalizeGeoFenceRefs(right);

  if (cleanLeft.length !== cleanRight.length) return false;

  return cleanLeft.every(
    (item, index) =>
      item?.id === cleanRight[index]?.id &&
      item?.name === cleanRight[index]?.name,
  );
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

  return {
    latitude,
    longitude,
  };
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
  return sales?.HasUsableGps === true || sales?.hasUsableGps === true;
}

export const collectGeoFenceDemoSalesUpdates = ({
  salesDocs = [],
  geoFenceId,
  geoFenceName,
  lmPcode,
  wardPcode,
  bbox,
  polygonPoints,
}) => {
  const updates = [];
  let memberCount = 0;
  let candidatePointsChecked = 0;

  for (const salesDoc of salesDocs) {
    const sales = salesDoc.data() || {};

    if (!hasUsableSalesGps(sales)) continue;

    const candidates = getSalesErfCandidates(sales);
    let belongs = false;

    for (const candidate of candidates) {
      if (!candidateMatchesScope(candidate, lmPcode, wardPcode)) {
        continue;
      }

      const point = extractSalesCandidatePoint(candidate);
      if (!point) continue;

      candidatePointsChecked += 1;

      if (
        doesEntityBelongToGeoFence({
          point,
          bbox,
          polygonPoints,
        })
      ) {
        belongs = true;
        break;
      }
    }

    if (!belongs) continue;

    memberCount += 1;

    const currentGeoFenceRefs = normalizeGeoFenceRefs(
      sales?.geofenceRefs || [],
    );

    const nextGeoFenceRefs = appendGeoFenceRef(currentGeoFenceRefs, {
      id: geoFenceId,
      name: geoFenceName,
    });

    if (geoFenceRefsEqual(currentGeoFenceRefs, nextGeoFenceRefs)) {
      continue;
    }

    updates.push({
      ref: salesDoc.ref,
      data: {
        geofenceRefs: nextGeoFenceRefs,
      },
    });
  }

  return {
    updates,
    memberCount,
    candidatePointsChecked,
  };
};
