import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

import {
  getLmByPcode,
  getTerritorialChain,
  getWardCount,
} from "./workbaseHelpers.js";

import {
  countErfs,
  countPremises,
  countMeters,
  countTrns,
} from "./workbaseCounters.js";

export async function rebuildWorkbaseRegistryRow(lmPcode) {
  try {
    const db = getFirestore();

    if (!lmPcode) {
      throw new Error("lmPcode is required");
    }

    const lm = await getLmByPcode(lmPcode);

    if (!lm) {
      throw new Error(`LM not found for lmPcode: ${lmPcode}`);
    }

    const territorial = await getTerritorialChain(lm);
    const wardCount = await getWardCount(lmPcode);

    const [erfCounts, premiseCount, meterCount, trnCount] = await Promise.all([
      countErfs(lmPcode),
      countPremises(lmPcode),
      countMeters(lmPcode),
      countTrns(lmPcode),
    ]);

    const totalErfCount =
      Number(erfCounts?.formalErfCount || 0) +
      Number(erfCounts?.informalErfCount || 0);

    const isOperationallyActive =
      totalErfCount > 0 ||
      Number(premiseCount || 0) > 0 ||
      Number(meterCount || 0) > 0 ||
      Number(trnCount || 0) > 0;

    const lastActivityAt = "NAv";

    const rowRef = db.collection("registry_workbases").doc(lmPcode);
    const existingSnap = await rowRef.get();
    const existingData = existingSnap.exists ? existingSnap.data() : null;

    const row = {
      id: lmPcode,
      workbaseId: lmPcode,
      lmPcode,
      lmName: lm?.name || "NAv",

      countryPcode: territorial?.countryPcode || "NAv",
      countryName: territorial?.countryName || "NAv",

      provincePcode: territorial?.provincePcode || "NAv",
      provinceName: territorial?.provinceName || "NAv",

      districtPcode: territorial?.districtPcode || "NAv",
      districtName: territorial?.districtName || "NAv",

      wardCount: Number(wardCount || 0),

      formalErfCount: Number(erfCounts?.formalErfCount || 0),
      informalErfCount: Number(erfCounts?.informalErfCount || 0),
      totalErfCount,

      premiseCount: Number(premiseCount || 0),
      meterCount: Number(meterCount || 0),
      trnCount: Number(trnCount || 0),

      hasBoundary: Boolean(lm?.geometry),
      isOperationallyActive,
      lastActivityAt,

      metadata: {
        createdAt:
          existingData?.metadata?.createdAt || FieldValue.serverTimestamp(),
        createdByUid: existingData?.metadata?.createdByUid || "SYSTEM",
        createdByUser:
          existingData?.metadata?.createdByUser || "Registry Builder",

        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: "SYSTEM",
        updatedByUser: "Registry Builder",
      },
    };

    logger.info("Workbase row built", { lmPcode, row });

    await rowRef.set(row, {
      merge: false,
    });

    logger.info("rebuildWorkbaseRegistryRow -- SUCCESS", { lmPcode });
    logger.info("========================================");

    return row;
  } catch (error) {
    logger.error("rebuildWorkbaseRegistryRow -- ERROR", {
      lmPcode,
      error: error.message,
    });
    throw error;
  }
}
