import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

export async function countErfs(lmPcode) {
  try {
    const db = getFirestore();

    logger.info("countErfs -- START", { lmPcode });

    if (!lmPcode) {
      throw new Error("lmPcode is required");
    }

    const formalQuery = db
      .collection("ireps_erfs")
      .where("admin.localMunicipality.pcode", "==", lmPcode)
      .where("erf.type", "==", "FORMAL");

    const informalQuery = db
      .collection("ireps_erfs")
      .where("admin.localMunicipality.pcode", "==", lmPcode)
      .where("erf.type", "==", "INFORMAL");

    const [formalSnap, informalSnap] = await Promise.all([
      formalQuery.count().get(),
      informalQuery.count().get(),
    ]);

    const formalErfCount = formalSnap.data().count || 0;
    const informalErfCount = informalSnap.data().count || 0;

    logger.info("countErfs -- RESULT", {
      lmPcode,
      formalErfCount,
      informalErfCount,
    });

    return {
      formalErfCount,
      informalErfCount,
    };
  } catch (error) {
    logger.error("countErfs -- ERROR", {
      lmPcode,
      message: error?.message || "Unknown error",
      stack: error?.stack || "No stack",
    });
    throw error;
  }
}

export async function countPremises(lmPcode) {
  try {
    const db = getFirestore();

    logger.info("countPremises -- START", { lmPcode });

    if (!lmPcode) {
      throw new Error("lmPcode is required");
    }

    const query = db
      .collection("premises")
      .where("parents.lmPcode", "==", lmPcode);

    const snap = await query.count().get();

    const premiseCount = snap.data().count || 0;

    logger.info("countPremises -- RESULT", {
      lmPcode,
      premiseCount,
    });

    return premiseCount;
  } catch (error) {
    logger.error("countPremises -- ERROR", {
      lmPcode,
      message: error?.message || "Unknown error",
      stack: error?.stack || "No stack",
    });
    throw error;
  }
}

export async function countMeters(lmPcode) {
  try {
    const db = getFirestore();

    logger.info("countMeters -- START", { lmPcode });

    if (!lmPcode) {
      throw new Error("lmPcode is required");
    }

    const query = db
      .collection("asts")
      .where("accessData.parents.lmPcode", "==", lmPcode);

    const snap = await query.count().get();

    const meterCount = snap.data().count || 0;

    logger.info("countMeters -- RESULT", {
      lmPcode,
      meterCount,
    });

    return meterCount;
  } catch (error) {
    logger.error("countMeters -- ERROR", {
      lmPcode,
      message: error?.message || "Unknown error",
      stack: error?.stack || "No stack",
    });
    throw error;
  }
}

export async function countTrns(lmPcode) {
  try {
    const db = getFirestore();

    logger.info("countTrns -- START", { lmPcode });

    if (!lmPcode) {
      throw new Error("lmPcode is required");
    }

    const query = db
      .collection("trns")
      .where("accessData.parents.lmPcode", "==", lmPcode);

    const snap = await query.count().get();

    const trnCount = snap.data().count || 0;

    logger.info("countTrns -- RESULT", {
      lmPcode,
      trnCount,
    });

    return trnCount;
  } catch (error) {
    logger.error("countTrns -- ERROR", {
      lmPcode,
      message: error?.message || "Unknown error",
      stack: error?.stack || "No stack",
    });
    throw error;
  }
}
