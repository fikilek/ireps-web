// registry/erfCounters.js

import { getFirestore } from "firebase-admin/firestore";

// -----------------------------
// 🏠 Count premises for one ERF
// -----------------------------
export const countPremisesForErf = async (erfId) => {
  const db = getFirestore();

  const snap = await db
    .collection("premises")
    .where("erfId", "==", erfId)
    .count()
    .get();

  return snap.data().count || 0;
};

// -----------------------------
// ⚡ Count electricity meters
// -----------------------------
export const countElectricityMetersForErf = async (erfId) => {
  const db = getFirestore();

  const snap = await db
    .collection("asts")
    .where("accessData.erfId", "==", erfId)
    .where("meterType", "==", "electricity")
    .count()
    .get();

  return snap.data().count || 0;
};

// -----------------------------
// 💧 Count water meters
// -----------------------------
export const countWaterMetersForErf = async (erfId) => {
  const db = getFirestore();

  const snap = await db
    .collection("asts")
    .where("accessData.erfId", "==", erfId)
    .where("meterType", "==", "water")
    .count()
    .get();

  return snap.data().count || 0;
};

// -----------------------------
// 🔢 Total meters
// -----------------------------
export const countTotalMeters = ({
  electricityMeters = 0,
  waterMeters = 0,
}) => {
  return electricityMeters + waterMeters;
};
