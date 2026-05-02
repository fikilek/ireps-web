// registry/erfSyncTrigger.js

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

import { buildErfRegistryRow } from "./erfBuilder.js";
import {
  countPremisesForErf,
  countElectricityMetersForErf,
  countWaterMetersForErf,
} from "./erfCounters.js";

// -----------------------------
// ⚙️ Trigger: ERF Registry Job Created
// -----------------------------
export const onErfRegistryJobCreated = onDocumentCreated(
  "jobs_registry_erfs/{jobId}",
  async (event) => {
    const db = getFirestore();

    const jobId = event.params.jobId;
    const jobRef = db.collection("jobs_registry_erfs").doc(jobId);

    const systemUpdaterUid = "SYSTEM";
    const systemUpdaterUser = "ERF Sync Trigger";

    try {
      const jobSnap = await jobRef.get();
      const job = jobSnap.data();

      if (!job) {
        logger.error("ERF registry job not found", { jobId });
        return;
      }

      const lmPcode = job?.scope?.lmPcode;

      if (!lmPcode) {
        throw new Error("Missing lmPcode in job scope");
      }

      await jobRef.update({
        status: "RUNNING",
        "metadata.updatedAt": new Date().toISOString(),
        "metadata.updatedByUid": systemUpdaterUid,
        "metadata.updatedByUser": systemUpdaterUser,
      });

      // -----------------------------
      // 📥 Load ERFs for LM only
      // -----------------------------
      const erfsSnap = await db
        .collection("ireps_erfs")
        .where("admin.localMunicipality.pcode", "==", lmPcode)
        .get();

      const erfDocs = erfsSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      const totalErfs = erfDocs.length;

      await jobRef.update({
        "progress.total": totalErfs,
        "progress.processed": 0,
        "progress.succeeded": 0,
        "progress.failed": 0,
        "metadata.updatedAt": new Date().toISOString(),
        "metadata.updatedByUid": systemUpdaterUid,
        "metadata.updatedByUser": systemUpdaterUser,
      });

      // -----------------------------
      // 🏗️ Build + Write Rows
      // -----------------------------
      const batchSize = 300;
      let batch = db.batch();
      let opCount = 0;

      let processed = 0;
      let succeeded = 0;
      let failed = 0;

      const sourceErfIds = new Set();

      for (const erfDoc of erfDocs) {
        try {
          const erfId = erfDoc?.erfId || erfDoc.id;
          sourceErfIds.add(erfId);

          const premisesCount = await countPremisesForErf(erfId);
          const electricityMetersCount =
            await countElectricityMetersForErf(erfId);
          const waterMetersCount = await countWaterMetersForErf(erfId);

          const row = buildErfRegistryRow({
            erfDoc,
            counts: {
              premises: premisesCount,
              electricityMeters: electricityMetersCount,
              waterMeters: waterMetersCount,
            },
            syncJobId: jobId,
          });

          const ref = db.collection("registry_erfs").doc(row.id);
          batch.set(ref, row, { merge: true });

          opCount++;
          succeeded++;
        } catch (rowError) {
          failed++;

          logger.error("ERF registry row build failed", {
            jobId,
            erfId: erfDoc?.erfId || erfDoc?.id || "NAv",
            message: rowError?.message || "Unknown row error",
          });
        }

        processed++;

        if (opCount >= batchSize) {
          await batch.commit();
          batch = db.batch();
          opCount = 0;
        }

        if (processed % 25 === 0 || processed === totalErfs) {
          await jobRef.update({
            "progress.processed": processed,
            "progress.succeeded": succeeded,
            "progress.failed": failed,
            "metadata.updatedAt": new Date().toISOString(),
            "metadata.updatedByUid": systemUpdaterUid,
            "metadata.updatedByUser": systemUpdaterUser,
          });
        }
      }

      if (opCount > 0) {
        await batch.commit();
      }

      // -----------------------------
      // 🧹 Delete stale rows for LM
      // -----------------------------
      const existingSnap = await db
        .collection("registry_erfs")
        .where("registry.lmPcode", "==", lmPcode)
        .get();

      let deleteBatch = db.batch();
      let deleteCount = 0;

      for (const doc of existingSnap.docs) {
        if (!sourceErfIds.has(doc.id)) {
          deleteBatch.delete(doc.ref);
          deleteCount++;

          if (deleteCount >= batchSize) {
            await deleteBatch.commit();
            deleteBatch = db.batch();
            deleteCount = 0;
          }
        }
      }

      if (deleteCount > 0) {
        await deleteBatch.commit();
      }

      await jobRef.update({
        status: "COMPLETED",
        "progress.processed": processed,
        "progress.succeeded": succeeded,
        "progress.failed": failed,
        "metadata.updatedAt": new Date().toISOString(),
        "metadata.updatedByUid": systemUpdaterUid,
        "metadata.updatedByUser": systemUpdaterUser,
      });

      logger.info("ERF registry sync completed", {
        jobId,
        lmPcode,
        totalErfs,
        succeeded,
        failed,
      });
    } catch (error) {
      logger.error("ERF registry sync failed", {
        jobId,
        message: error?.message || "Unknown sync error",
        stack: error?.stack || "No stack",
      });

      await jobRef.update({
        status: "ERROR",
        error: error?.message || "Unknown sync error",
        "metadata.updatedAt": new Date().toISOString(),
        "metadata.updatedByUid": systemUpdaterUid,
        "metadata.updatedByUser": systemUpdaterUser,
      });
    }
  },
);
