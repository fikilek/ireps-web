// registry/wardHelpers.js

import { FieldValue } from "firebase-admin/firestore";

/**
 * Build deterministic ward registry id
 * Format: LM__WARD
 */
export const buildWardRegistryId = (lmPcode, wardPcode) => {
  if (!lmPcode || !wardPcode) return "NAv";
  return `${lmPcode}__${wardPcode}`;
};

/**
 * Bucket any dataset by wardPcode
 * getWardPcode is a function that extracts wardPcode from the item
 */
export const bucketItemsByWard = (items = [], getWardPcode) => {
  const map = {};

  for (const item of items) {
    const wardPcode = getWardPcode(item) || "UNKNOWN";

    if (!map[wardPcode]) {
      map[wardPcode] = [];
    }

    map[wardPcode].push(item);
  }

  return map;
};

/**
 * Build metadata block
 * - preserve created*
 * - update updated*
 */
export const buildWardRegistryMetadata = (existingDoc) => {
  const now = FieldValue.serverTimestamp();

  return {
    createdAt: existingDoc?.metadata?.createdAt || now,
    createdByUid: existingDoc?.metadata?.createdByUid || "SYSTEM",
    createdByUser:
      existingDoc?.metadata?.createdByUser || "Ward Registry Builder",

    updatedAt: now,
    updatedByUid: "SYSTEM",
    updatedByUser: "Ward Registry Builder",
  };
};

/**
 * Safe text fallback
 */
export const safeText = (value) => {
  if (value === null || value === undefined || value === "") {
    return "NAv";
  }
  return value;
};

/**
 * Safe number fallback
 */
export const safeNumber = (value) => {
  if (typeof value !== "number" || isNaN(value)) {
    return 0;
  }
  return value;
};
