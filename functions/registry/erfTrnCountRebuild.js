import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { rebuildErfBaseRow } from "./erfBaseRowRebuild.js";

export const rebuildErfTrnCount = async (erfId) => {
  const db = getFirestore();

  if (!erfId || erfId === "NAv") return;

  try {
    await rebuildErfBaseRow(erfId);

    // 📊 NA TRN count
    const naSnap = await db
      .collection("trns")
      .where("accessData.erfId", "==", erfId)
      .where("accessData.access.hasAccess", "==", "no")
      .count()
      .get();

    const trnsNa = naSnap.data().count || 0;

    // 📊 ACCESS TRN count
    const accessSnap = await db
      .collection("trns")
      .where("accessData.erfId", "==", erfId)
      .where("accessData.access.hasAccess", "==", "yes")
      .count()
      .get();

    const trnsAccess = accessSnap.data().count || 0;

    // 📊 TOTAL TRN count
    const trnsTotal = trnsNa + trnsAccess;

    // 📝 Update ONLY TRN count fields and flat metadata.updated*
    const now = new Date().toISOString();

    await db.collection("registry_erfs").doc(erfId).update({
      "counts.trnsNa": trnsNa,
      "counts.trnsAccess": trnsAccess,
      "counts.trnsTotal": trnsTotal,
      "metadata.updatedAt": now,
      "metadata.updatedByUid": "SYSTEM",
      "metadata.updatedByUser": "ERF Registry Rebuild",
    });

    logger.info("ERF TRN counts rebuilt", {
      erfId,
      trnsNa,
      trnsAccess,
      trnsTotal,
    });

    return {
      trnsNa,
      trnsAccess,
      trnsTotal,
    };
  } catch (err) {
    logger.error("rebuildErfTrnCount failed", { erfId, err });
    throw err;
  }
};
