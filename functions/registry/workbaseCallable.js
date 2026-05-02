import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

import { rebuildWorkbaseRegistryRow } from "./workbaseBuilder.js";

export const rebuildWorkbaseRegistryRowCallable = onCall(async (request) => {
  try {
    const lmPcode = request?.data?.lmPcode;

    if (!lmPcode) {
      throw new HttpsError("invalid-argument", "lmPcode is required");
    }

    logger.info("Callable rebuild triggered", { lmPcode });

    const row = await rebuildWorkbaseRegistryRow(lmPcode);

    return {
      success: true,
      lmPcode,
      rowId: row?.id,
    };
  } catch (error) {
    logger.error("Callable error", { error });

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      error?.message || "Failed to rebuild workbase registry row",
    );
  }
});
