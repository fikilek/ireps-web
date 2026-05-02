import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { rebuildErfBaseRow } from "./erfBaseRowRebuild.js";

export const rebuildErfPremiseCount = async (erfId) => {
  const db = getFirestore();

  if (!erfId || erfId === "NAv") return;

  try {
    await rebuildErfBaseRow(erfId);
    // 🔢 Fresh premise count
    const snap = await db
      .collection("premises")
      .where("erfId", "==", erfId)
      .count()
      .get();

    const premisesCount = snap.data().count || 0;

    // 📝 Update ONLY premise count field and flat metadata.updated*
    const now = new Date().toISOString();

    await db.collection("registry_erfs").doc(erfId).update({
      "counts.premises": premisesCount,
      "metadata.updatedAt": now,
      "metadata.updatedByUid": "SYSTEM",
      "metadata.updatedByUser": "ERF Registry Rebuild",
    });

    logger.info("ERF premise count rebuilt", {
      erfId,
      premises: premisesCount,
    });

    return premisesCount;
  } catch (err) {
    logger.error("rebuildErfPremiseCount failed", { erfId, err });
    throw err;
  }
};
