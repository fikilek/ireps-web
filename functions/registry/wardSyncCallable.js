// registry/wardSyncCallable.js

import { onCall } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

/**
 * Callable: Start Ward Registry Sync job
 */
export const startWardRegistrySyncCallable = onCall(async () => {
  console.log("Ward Registry Sync requested");

  try {
    const db = getFirestore();

    // 1. Load all LMs
    const lmsSnap = await db.collection("lms").get();

    const lmPcodes = lmsSnap.docs
      .map((doc) => doc?.data()?.id || doc.id)
      .filter(Boolean);

    console.log(`LMs found: ${lmPcodes.length}`);

    if (!lmPcodes.length) {
      throw new Error("No LMs found");
    }

    // 2. Create job document
    const jobRef = db.collection("registry_jobs").doc();

    const job = {
      type: "WARD_REGISTRY_SYNC",
      status: "PENDING",

      payload: {
        lmPcodes,
      },

      progress: {
        total: lmPcodes.length,
        processed: 0,
      },

      metadata: {
        createdAt: FieldValue.serverTimestamp(),
        createdByUid: "SYSTEM",
        createdByUser: "Ward Sync Callable",
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: "SYSTEM",
        updatedByUser: "Ward Sync Callable",
      },
    };

    await jobRef.set(job);

    console.log(`Ward sync job created: ${jobRef.id}`);

    return {
      success: true,
      jobId: jobRef.id,
      totalLms: lmPcodes.length,
      message: "Ward registry sync job started",
    };
  } catch (error) {
    console.error("Ward sync callable failed:", error);
    throw new Error("Failed to start ward registry sync");
  }
});
