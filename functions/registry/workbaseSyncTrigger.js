import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

import { rebuildWorkbaseRegistryRow } from "./workbaseBuilder.js";

export const onWorkbaseRegistryJobCreated = onDocumentCreated(
  "registry_jobs/{jobId}",
  async (event) => {
    try {
      const db = getFirestore();

      const snap = event.data;
      if (!snap) return;

      const job = snap.data();
      const jobId = event.params.jobId;

      if (!job) return;
      if (job.jobType !== "WORKBASE_REGISTRY_SYNC") return;
      if (job.status !== "QUEUED") return;

      logger.info("onWorkbaseRegistryJobCreated -- START", { jobId });

      const jobRef = db.collection("registry_jobs").doc(jobId);

      await jobRef.update({
        status: "RUNNING",
        startedAt: FieldValue.serverTimestamp(),
        "metadata.updatedAt": FieldValue.serverTimestamp(),
        "metadata.updatedByUid": "SYSTEM",
        "metadata.updatedByUser": "Registry Sync Trigger",
      });

      const lmsSnap = await db.collection("lms").get();
      const totalLms = lmsSnap.size || 0;

      await jobRef.update({
        totalLms,
        "metadata.updatedAt": FieldValue.serverTimestamp(),
        "metadata.updatedByUid": "SYSTEM",
        "metadata.updatedByUser": "Registry Sync Trigger",
      });

      let processedLms = 0;
      let succeededLms = 0;
      let failedLms = 0;
      const failedLmPcodes = [];

      for (const lmDoc of lmsSnap.docs) {
        const lmPcode = lmDoc.id;

        try {
          await rebuildWorkbaseRegistryRow(lmPcode);
          succeededLms += 1;
        } catch (error) {
          failedLms += 1;
          failedLmPcodes.push(lmPcode);

          logger.error("onWorkbaseRegistryJobCreated -- LM FAILED", {
            jobId,
            lmPcode,
            error: error?.message || "Unknown error",
          });
        }

        processedLms += 1;

        const progressPct =
          totalLms > 0 ? Math.round((processedLms / totalLms) * 100) : 0;

        await jobRef.update({
          processedLms,
          succeededLms,
          failedLms,
          failedLmPcodes,
          lastProcessedLmPcode: lmPcode,
          progressPct,
          "metadata.updatedAt": FieldValue.serverTimestamp(),
          "metadata.updatedByUid": "SYSTEM",
          "metadata.updatedByUser": "Registry Sync Trigger",
        });
      }

      await jobRef.update({
        status: "COMPLETED",
        completedAt: FieldValue.serverTimestamp(),
        progressPct: 100,
        "metadata.updatedAt": FieldValue.serverTimestamp(),
        "metadata.updatedByUid": "SYSTEM",
        "metadata.updatedByUser": "Registry Sync Trigger",
      });

      logger.info("onWorkbaseRegistryJobCreated -- SUCCESS", {
        jobId,
        totalLms,
        succeededLms,
        failedLms,
      });
    } catch (error) {
      logger.error("onWorkbaseRegistryJobCreated -- ERROR", {
        error: error?.message || "Unknown error",
        stack: error?.stack || "No stack",
      });

      const db = getFirestore();
      const jobId = event.params?.jobId;

      if (jobId) {
        await db.collection("registry_jobs").doc(jobId).update({
          status: "FAILED",
          completedAt: FieldValue.serverTimestamp(),
          "metadata.updatedAt": FieldValue.serverTimestamp(),
          "metadata.updatedByUid": "SYSTEM",
          "metadata.updatedByUser": "Registry Sync Trigger",
        });
      }
    }
  },
);
