import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { buildPremiseRegistryRow } from "./premiseRegistryRowBuilder.js";
import { rebuildPremiseMeterCounts } from "./premiseMeterCountsRebuild.js";

export const rebuildPremiseRegistryRow = async (premiseId) => {
  const db = getFirestore();

  const premiseRef = db.collection("premises").doc(premiseId);
  const registryRef = db.collection("registry_premises").doc(premiseId);

  const premiseSnap = await premiseRef.get();

  if (!premiseSnap.exists) {
    await registryRef.delete().catch(() => null);

    logger.log("rebuildPremiseRegistryRow ---- premise missing, row removed", {
      premiseId,
    });

    return null;
  }

  const premise = premiseSnap.data() || {};
  const row = buildPremiseRegistryRow(premiseId, premise);

  await registryRef.set(row, { merge: true });
  await rebuildPremiseMeterCounts(premiseId);

  logger.log("rebuildPremiseRegistryRow ---- success", {
    premiseId,
    erfId: row?.erfId || "NAv",
    lmPcode: row?.parents?.lmPcode || "NAv",
    wardPcode: row?.parents?.wardPcode || "NAv",
  });

  return true;
};
