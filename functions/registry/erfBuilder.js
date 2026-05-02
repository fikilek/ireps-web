// registry/erfBuilder.js

import { buildErfNo, buildErfSearchableText } from "./erfHelpers.js";

import { countTotalMeters } from "./erfCounters.js";

// -----------------------------
// 🏗️ Build ONE ERF registry row
// -----------------------------
export const buildErfRegistryRow = ({
  erfDoc = {},
  counts = {},
  syncJobId = "NAv",
}) => {
  // -----------------------------
  // 🔹 Identity
  // -----------------------------
  const sourceId = erfDoc?.id || "NAv";
  const erfId = erfDoc?.erfId || sourceId;

  // -----------------------------
  // 🔹 ERF fields
  // -----------------------------
  const erfNo = buildErfNo(erfDoc?.sg);
  const erfType = erfDoc?.erf?.type || "NAv";
  const erfStatus = "NAv"; // intentionally not using raw source codes

  // -----------------------------
  // 🔹 Geography
  // -----------------------------
  const provincePcode = erfDoc?.admin?.province?.pcode || "NAv";
  const districtPcode = erfDoc?.admin?.district?.pcode || "NAv";
  const lmPcode = erfDoc?.admin?.localMunicipality?.pcode || "NAv";
  const wardPcode = erfDoc?.admin?.ward?.pcode || "NAv";

  // -----------------------------
  // 🔹 Counts
  // -----------------------------
  const premisesCount = counts?.premises || 0;
  const electricityMetersCount = counts?.electricityMeters || 0;
  const waterMetersCount = counts?.waterMeters || 0;

  const totalMetersCount = countTotalMeters({
    electricityMeters: electricityMetersCount,
    waterMeters: waterMetersCount,
  });

  const trnsCount = 0; // V1 placeholder

  // -----------------------------
  // 🔹 Searchable text
  // -----------------------------
  const searchableText = buildErfSearchableText({
    erfNo,
    type: erfType,
    lmPcode,
    wardPcode,
  });

  // -----------------------------
  // 🔹 Metadata
  // -----------------------------
  const now = new Date().toISOString();
  const lastSourceUpdatedAt = erfDoc?.metadata?.updatedAt || "NAv";

  // -----------------------------
  // 🔹 Final row
  // -----------------------------
  return {
    id: sourceId,

    source: {
      collection: "ireps_erfs",
      sourceId,
    },

    erf: {
      id: erfId,
      erfNo,
      type: erfType,
      status: erfStatus,
    },

    geography: {
      provincePcode,
      districtPcode,
      lmPcode,
      wardPcode,
    },

    counts: {
      premises: premisesCount,
      electricityMeters: electricityMetersCount,
      waterMeters: waterMetersCount,
      totalMeters: totalMetersCount,
      trns: trnsCount,
    },

    registry: {
      lmPcode,
      wardPcode,
      type: erfType,
      status: erfStatus,
      searchableText,
      lastSourceUpdatedAt,
      syncStatus: "READY",
      syncJobId: syncJobId || "NAv",
    },

    metadata: {
      createdAt: now,
      createdByUid: "SYSTEM",
      createdByUser: "ERF Registry Builder",
      updatedAt: now,
      updatedByUid: "SYSTEM",
      updatedByUser: "ERF Registry Builder",
    },
  };
};
