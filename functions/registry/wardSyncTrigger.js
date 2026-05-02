// registry/wardSyncTrigger.js

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { rebuildWardRegistryForLm } from "./wardBuilder.js";

/**
 * Trigger: Process Ward Registry Sync Jobs
 */
export const onWardRegistryJobCreated = onDocumentCreated(
  "registry_jobs/{jobId}",
  async (event) => {
    const db = getFirestore();

    const jobId = event.params.jobId;
    const jobData = event.data?.data();

    if (!jobData) return;

    if (jobData.type !== "WARD_REGISTRY_SYNC") return;

    console.log(`Ward sync job detected: ${jobId}`);

    const jobRef = db.collection("registry_jobs").doc(jobId);

    try {
      await jobRef.update({
        status: "PROCESSING",
        "metadata.updatedAt": FieldValue.serverTimestamp(),
        "metadata.updatedByUid": "SYSTEM",
        "metadata.updatedByUser": "Ward Sync Trigger",
      });

      const lmPcodes = jobData?.payload?.lmPcodes || [];
      let processed = 0;

      for (const lmPcode of lmPcodes) {
        try {
          console.log(`Processing LM: ${lmPcode}`);

          await rebuildWardRegistryForLm(lmPcode);

          processed++;

          await jobRef.update({
            "progress.processed": processed,
            "metadata.updatedAt": FieldValue.serverTimestamp(),
            "metadata.updatedByUid": "SYSTEM",
            "metadata.updatedByUser": "Ward Sync Trigger",
          });

          console.log(`Progress: ${processed}/${lmPcodes.length}`);
        } catch (lmError) {
          console.error(`LM failed: ${lmPcode}`, lmError);
        }
      }

      await jobRef.update({
        status: "COMPLETED",
        "metadata.updatedAt": FieldValue.serverTimestamp(),
        "metadata.updatedByUid": "SYSTEM",
        "metadata.updatedByUser": "Ward Sync Trigger",
      });

      console.log(`Ward sync job completed: ${jobId}`);
    } catch (error) {
      console.error("Ward sync trigger failed:", error);

      await jobRef.update({
        status: "FAILED",
        "metadata.updatedAt": FieldValue.serverTimestamp(),
        "metadata.updatedByUid": "SYSTEM",
        "metadata.updatedByUser": "Ward Sync Trigger",
      });
    }
  },
);
