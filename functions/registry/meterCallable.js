/* eslint-disable no-undef */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { rebuildMeterRegistryRow } from "./meterRegistryRowRebuild.js";

export const rebuildMeterRegistryRowCallable = onCall(async (request) => {
  try {
    const caller = request.auth;

    if (!caller?.uid) {
      throw new HttpsError(
        "unauthenticated",
        "You must be authenticated to rebuild meter registry row",
      );
    }

    const astId = request.data?.astId;

    if (!astId) {
      throw new HttpsError("invalid-argument", "astId is required");
    }

    logger.info("rebuildMeterRegistryRowCallable ---- START", {
      astId,
      callerUid: caller.uid,
    });

    const row = await rebuildMeterRegistryRow(astId);

    logger.info("rebuildMeterRegistryRowCallable ---- SUCCESS", {
      astId,
      callerUid: caller.uid,
    });

    return {
      success: true,
      message: "Meter registry row rebuilt successfully",
      astId,
      row: row || null,
    };
  } catch (error) {
    logger.error("rebuildMeterRegistryRowCallable ---- ERROR", {
      message: error?.message || String(error),
      stack: error?.stack || "",
    });

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      error?.message || "Failed to rebuild meter registry row",
    );
  }
});
