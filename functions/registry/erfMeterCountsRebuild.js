import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { rebuildErfBaseRow } from "./erfBaseRowRebuild.js";

export const rebuildErfMeterCounts = async (erfId) => {
  const db = getFirestore();

  if (!erfId || erfId === "NAv") return;

  try {
    await rebuildErfBaseRow(erfId);

    // ⚡ Electricity meters
    const electricitySnap = await db
      .collection("asts")
      .where("accessData.erfId", "==", erfId)
      .where("meterType", "==", "electricity")
      .count()
      .get();

    const electricityMeters = electricitySnap.data().count || 0;

    // 💧 Water meters
    const waterSnap = await db
      .collection("asts")
      .where("accessData.erfId", "==", erfId)
      .where("meterType", "==", "water")
      .count()
      .get();

    const waterMeters = waterSnap.data().count || 0;

    const totalMeters = electricityMeters + waterMeters;

    // 📝 Update ONLY meter count fields and flat metadata.updated*
    const now = new Date().toISOString();

    await db.collection("registry_erfs").doc(erfId).update({
      "counts.electricityMeters": electricityMeters,
      "counts.waterMeters": waterMeters,
      "counts.totalMeters": totalMeters,
      "metadata.updatedAt": now,
      "metadata.updatedByUid": "SYSTEM",
      "metadata.updatedByUser": "ERF Registry Rebuild",
    });

    logger.info("ERF meter counts rebuilt", {
      erfId,
      electricityMeters,
      waterMeters,
      totalMeters,
    });

    return {
      electricityMeters,
      waterMeters,
      totalMeters,
    };
  } catch (err) {
    logger.error("rebuildErfMeterCounts failed", { erfId, err });
    throw err;
  }
};
