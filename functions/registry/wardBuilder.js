// registry/wardBuilder.js

import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/logger";

import {
  buildWardRegistryId,
  buildWardRegistryMetadata,
  safeText,
} from "./wardHelpers.js";

import {
  loadWardCounts,
  computeWardOperationalStatus,
} from "./wardCounters.js";

const buildWardRegistryRow = async ({
  db,
  lmPcode,
  wardPcode,
  wardData = null,
  existingDoc = null,
}) => {
  if (!db) {
    throw new Error("db is required");
  }

  if (!lmPcode) {
    throw new Error("lmPcode is required");
  }

  if (!wardPcode) {
    throw new Error("wardPcode is required");
  }

  let ward = wardData;

  if (!ward) {
    const wardSnap = await db.collection("wards").doc(wardPcode).get();

    if (!wardSnap.exists) {
      throw new Error(`Ward not found: ${wardPcode}`);
    }

    ward = {
      id: wardSnap.id,
      ...wardSnap.data(),
    };
  }

  const counts = await loadWardCounts({
    db,
    lmPcode,
    wardPcode,
  });

  const isOperationallyActive = computeWardOperationalStatus({
    totalErfs: counts.totalErfs,
    premises: counts.premises,
    totalMeters: counts.totalMeters,
    trns: counts.trns,
  });

  const id = buildWardRegistryId(lmPcode, wardPcode);
  const metadata = buildWardRegistryMetadata(existingDoc);

  return {
    id,

    province: {
      pcode: ward?.parents?.provinceId || "NAv",
      name: "NAv",
    },

    district: {
      pcode: ward?.parents?.districtId || "NAv",
      name: "NAv",
    },

    localMunicipality: {
      pcode: ward?.parents?.localMunicipalityId || lmPcode || "NAv",
      name: "NAv",
    },

    ward: {
      pcode: ward?.id || wardPcode || "NAv",
      name: safeText(ward?.name),
      number: ward?.code || "NAv",
    },

    counts,

    status: {
      isOperationallyActive,
    },

    metadata,
  };
};

/**
 * Rebuild Ward Registry for one specific ward only.
 */
export const rebuildWardRegistryRow = async ({
  lmPcode,
  wardPcode,
  reason = "WARD_REGISTRY_ROW_REBUILD",
} = {}) => {
  const db = getFirestore();

  if (!lmPcode) {
    throw new Error("lmPcode is required");
  }

  if (!wardPcode) {
    throw new Error("wardPcode is required");
  }

  const id = buildWardRegistryId(lmPcode, wardPcode);
  const existingSnap = await db.collection("registry_wards").doc(id).get();
  const existingDoc = existingSnap.exists ? existingSnap.data() : null;

  logger.info("rebuildWardRegistryRow -- START", {
    lmPcode,
    wardPcode,
    reason,
  });

  const row = await buildWardRegistryRow({
    db,
    lmPcode,
    wardPcode,
    existingDoc,
  });

  await db.collection("registry_wards").doc(row.id).set(row, { merge: true });

  logger.info("rebuildWardRegistryRow -- SUCCESS", {
    id: row.id,
    lmPcode,
    wardPcode,
    reason,
    counts: row.counts,
  });

  return row;
};

/**
 * Rebuild Ward Registry for a single LM
 */
export const rebuildWardRegistryForLm = async (lmPcode) => {
  console.log(`Ward Registry rebuild started for LM: ${lmPcode}`);

  try {
    const db = getFirestore();

    if (!lmPcode) {
      throw new Error("lmPcode is required");
    }

    logger.info("========================================");
    logger.info("rebuildWardRegistryForLm -- START", { lmPcode });

    // ===============================
    // STEP 1: Load light source data only
    // ===============================

    const wardsSnap = await db
      .collection("wards")
      .where("parents.localMunicipalityId", "==", lmPcode)
      .get();

    const wards = wardsSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    console.log(`Loaded wards: ${wards.length}`);

    const existingSnap = await db
      .collection("registry_wards")
      .where("localMunicipality.pcode", "==", lmPcode)
      .get();

    const existingDocsMap = {};

    for (const doc of existingSnap.docs) {
      existingDocsMap[doc.id] = doc.data();
    }

    console.log(`Loaded existing ward registry docs: ${existingSnap.size}`);

    // ===============================
    // STEP 2: Build ward rows using aggregate count queries
    // ===============================

    const rows = [];

    for (const ward of wards) {
      const wardPcode = ward?.id;

      if (!wardPcode) continue;

      console.log(`Building ward row for ward: ${wardPcode}`);

      const id = buildWardRegistryId(lmPcode, wardPcode);
      const existingDoc = existingDocsMap[id];

      const row = await buildWardRegistryRow({
        db,
        lmPcode,
        wardPcode,
        wardData: ward,
        existingDoc,
      });

      rows.push(row);
    }

    console.log(`Built ward rows: ${rows.length}`);

    // ===============================
    // STEP 3: Write to Firestore
    // ===============================

    const batch = db.batch();

    for (const row of rows) {
      const docRef = db.collection("registry_wards").doc(row.id);
      batch.set(docRef, row, { merge: true });
    }

    await batch.commit();

    console.log(`Ward registry updated: ${rows.length} rows`);
    console.log(`Ward Registry rebuild completed for LM: ${lmPcode}`);
  } catch (error) {
    console.error("Ward Registry rebuild failed:", error);
    throw error;
  }
};
