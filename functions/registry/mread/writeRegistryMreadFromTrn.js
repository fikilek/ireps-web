import * as logger from "firebase-functions/logger";

import {
  REGISTRY_MREAD_COLLECTION,
  isCanonicalMreadOutcome,
} from "./constants.js";
import { mapTrnMreadToRegistryMread } from "./mapTrnMreadToRegistryMread.js";

function readString(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function normalizeUpper(value) {
  return readString(value).toUpperCase();
}

function readMreadTrnType(trn = {}) {
  return normalizeUpper(
    trn?.accessData?.trnType ||
      trn?.trnType ||
      trn?.origin?.trnType ||
      trn?.assignment?.instruction?.code ||
      "",
  );
}

function isMreadTrn(trn = {}) {
  const trnType = readMreadTrnType(trn);
  return trnType === "METER_READING" || trnType === "TRN_MREAD";
}

function readWorkflowState(trn = {}) {
  return normalizeUpper(trn?.workflow?.state || trn?.workflowState || "");
}

function readMreadAstId(trn = {}) {
  return readString(
    trn?.ast?.astData?.astId ||
      trn?.sourceAstId ||
      trn?.astId ||
      trn?.accessData?.astId ||
      "",
  );
}

export async function writeRegistryMreadFromTrn({
  db,
  trnId,
  source = "UNKNOWN",
  now = new Date(),
} = {}) {
  if (!db) {
    throw new Error("WRITE_REGISTRY_MREAD_DB_REQUIRED");
  }

  const safeTrnId = readString(trnId);

  if (!safeTrnId) {
    throw new Error("WRITE_REGISTRY_MREAD_TRN_ID_REQUIRED");
  }

  const trnRef = db.collection("trns").doc(safeTrnId);
  const trnSnap = await trnRef.get();

  if (!trnSnap.exists) {
    throw new Error(`WRITE_REGISTRY_MREAD_TRN_NOT_FOUND:${safeTrnId}`);
  }

  const trn = {
    id: trnSnap.id,
    ...trnSnap.data(),
  };

  if (!isMreadTrn(trn)) {
    throw new Error(`WRITE_REGISTRY_MREAD_NOT_MREAD_TRN:${safeTrnId}`);
  }

  const workflowState = readWorkflowState(trn);

  if (workflowState !== "COMPLETED") {
    throw new Error(
      `WRITE_REGISTRY_MREAD_TRN_NOT_COMPLETED:${safeTrnId}:${workflowState || "UNKNOWN"}`,
    );
  }

  const outcome = readString(trn?.executionOutcome?.outcome);

  if (!isCanonicalMreadOutcome(outcome)) {
    throw new Error(
      `WRITE_REGISTRY_MREAD_NON_CANONICAL_OUTCOME:${safeTrnId}:${outcome || "MISSING"}`,
    );
  }

  let ast = null;
  const astId = readMreadAstId(trn);

  if (astId) {
    try {
      const astSnap = await db.collection("asts").doc(astId).get();
      if (astSnap.exists) {
        ast = {
          id: astSnap.id,
          ...astSnap.data(),
        };
      }
    } catch (astError) {
      logger.warn("registry_mread AST enrichment failed", {
        trnId: safeTrnId,
        astId,
        message: astError?.message || String(astError),
      });
    }
  }

  const registryRow = mapTrnMreadToRegistryMread({
    trn,
    trnId: safeTrnId,
    trnPath: `trns/${safeTrnId}`,
    now,
    ast,
  });

  if (!registryRow || typeof registryRow !== "object") {
    throw new Error(`WRITE_REGISTRY_MREAD_EMPTY_ROW:${safeTrnId}`);
  }

  if (registryRow.id !== safeTrnId) {
    throw new Error(
      `WRITE_REGISTRY_MREAD_ROW_ID_MISMATCH:${safeTrnId}:${registryRow.id || "MISSING"}`,
    );
  }

  const registryRef = db.collection(REGISTRY_MREAD_COLLECTION).doc(safeTrnId);

  await registryRef.set(
    {
      ...registryRow,
      id: safeTrnId,
    },
    { merge: true },
  );

  logger.info("registry_mread row written from completed MREAD TRN", {
    trnId: safeTrnId,
    registryPath: `${REGISTRY_MREAD_COLLECTION}/${safeTrnId}`,
    outcome,
    source,
  });

  return {
    ok: true,
    trnId: safeTrnId,
    registryId: safeTrnId,
    registryPath: `${REGISTRY_MREAD_COLLECTION}/${safeTrnId}`,
    outcome,
  };
}
