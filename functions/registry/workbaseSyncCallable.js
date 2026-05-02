import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

export const startWorkbaseRegistrySyncCallable = onCall(async (request) => {
  try {
    const db = getFirestore();

    const callerUid = request?.auth?.uid || "SYSTEM";
    const callerEmail = request?.auth?.token?.email || "Unknown User";

    const jobRef = db.collection("registry_jobs").doc();

    const job = {
      id: jobRef.id,

      jobType: "WORKBASE_REGISTRY_SYNC",
      status: "QUEUED",

      totalLms: 0,
      processedLms: 0,
      succeededLms: 0,
      failedLms: 0,
      progressPct: 0,

      lastProcessedLmPcode: "NAv",
      failedLmPcodes: [],

      startedAt: null,
      completedAt: null,

      metadata: {
        createdAt: FieldValue.serverTimestamp(),
        createdByUid: callerUid,
        createdByUser: callerEmail,
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: callerUid,
        updatedByUser: callerEmail,
      },
    };

    await jobRef.set(job);

    logger.info("startWorkbaseRegistrySyncCallable -- job created", {
      jobId: jobRef.id,
    });

    return {
      success: true,
      jobId: jobRef.id,
    };
  } catch (error) {
    logger.error("startWorkbaseRegistrySyncCallable -- ERROR", {
      error: error?.message || "Unknown error",
    });

    throw new HttpsError(
      "internal",
      error?.message || "Failed to start workbase registry sync",
    );
  }
});
