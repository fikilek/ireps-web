import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

export async function getLmByPcode(lmPcode) {
  try {
    const db = getFirestore();

    logger.info("getLmByPcode", { lmPcode });

    if (!lmPcode) {
      throw new Error("lmPcode is required");
    }

    const docRef = db.collection("lms").doc(lmPcode);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      logger.warn("LM not found", { lmPcode });
      return null;
    }

    return {
      id: docSnap.id,
      ...docSnap.data(),
    };
  } catch (error) {
    logger.error("getLmByPcode ERROR", { lmPcode, error: error.message });
    throw error;
  }
}

export async function getTerritorialChain(lm) {
  try {
    if (!lm) {
      throw new Error("LM is required");
    }

    return {
      countryPcode: lm?.parents?.countryId || "NAv",
      countryName: lm?.parentNames?.country || "NAv",

      provincePcode: lm?.parents?.provinceId || "NAv",
      provinceName: lm?.parentNames?.province || "NAv",

      districtPcode: lm?.parents?.districtId || "NAv",
      districtName: lm?.parentNames?.district || "NAv",
    };
  } catch (error) {
    logger.error("getTerritorialChain ERROR", { error: error.message });
    throw error;
  }
}

export async function getWardCount(lmPcode) {
  try {
    const db = getFirestore();

    logger.info("getWardCount", { lmPcode });

    if (!lmPcode) {
      throw new Error("lmPcode is required");
    }

    const snapshot = await db
      .collection("wards")
      .where("parents.localMunicipalityId", "==", lmPcode)
      .get();

    const count = snapshot.size || 0;

    logger.info("getWardCount RESULT", { lmPcode, count });

    return count;
  } catch (error) {
    logger.error("getWardCount ERROR", { lmPcode, error: error.message });
    throw error;
  }
}
