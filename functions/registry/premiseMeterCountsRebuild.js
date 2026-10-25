import { getFirestore } from "firebase-admin/firestore";

export const rebuildPremiseMeterCounts = async (premiseId) => {
  const db = getFirestore();

  const electricitySnap = await db
    .collection("asts")
    .where("accessData.premise.id", "==", premiseId)
    .where("meterType", "==", "electricity")
    .count()
    .get();

  const waterSnap = await db
    .collection("asts")
    .where("accessData.premise.id", "==", premiseId)
    .where("meterType", "==", "water")
    .count()
    .get();

  const electricityMeters = electricitySnap.data().count || 0;
  const waterMeters = waterSnap.data().count || 0;
  const totalMeters = electricityMeters + waterMeters;

  await db.collection("registry_premises").doc(premiseId).update({
    "counts.electricityMeters": electricityMeters,
    "counts.waterMeters": waterMeters,
    "counts.totalMeters": totalMeters,
  });

  return {
    electricityMeters,
    waterMeters,
    totalMeters,
  };
};
