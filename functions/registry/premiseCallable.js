import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";
import { rebuildPremiseRegistryRow } from "./premiseRegistryRowRebuild.js";

export const rebuildPremiseRegistryRowCallable = onCall(async (request) => {
  const premiseId = request.data?.premiseId;

  if (!premiseId) {
    throw new HttpsError("invalid-argument", "premiseId is required");
  }

  try {
    await rebuildPremiseRegistryRow(premiseId);

    return {
      success: true,
      premiseId,
      message: "Premise registry row rebuilt successfully.",
    };
  } catch (error) {
    logger.error("rebuildPremiseRegistryRowCallable ---- ERROR", {
      premiseId,
      message: error?.message || String(error),
    });

    throw new HttpsError(
      "internal",
      error?.message || "Failed to rebuild premise registry row",
    );
  }
});

export const deletePremiseRegistryRow = async (premiseId) => {
  const db = getFirestore();
  await db
    .collection("registry_premises")
    .doc(premiseId)
    .delete()
    .catch(() => null);
};
