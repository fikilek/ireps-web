// registry/wardCallable.js

import { onCall } from "firebase-functions/v2/https";
import { rebuildWardRegistryForLm } from "./wardBuilder.js";

/**
 * Callable: Rebuild Ward Registry for a single LM
 */
export const rebuildWardRegistryForLmCallable = onCall(async (request) => {
  const { lmPcode } = request.data || {};

  if (!lmPcode) {
    throw new Error("lmPcode is required");
  }

  console.log(`Callable triggered → Ward Registry rebuild for LM: ${lmPcode}`);

  try {
    await rebuildWardRegistryForLm(lmPcode);

    return {
      success: true,
      message: `Ward registry rebuilt for LM: ${lmPcode}`,
    };
  } catch (error) {
    console.error("Callable failed:", error);

    throw new Error("Ward registry rebuild failed");
  }
});
