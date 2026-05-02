// registry/erfCallable.js

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

import { buildErfRegistryRow } from "./erfBuilder.js";
import {
  countPremisesForErf,
  countElectricityMetersForErf,
  countWaterMetersForErf,
} from "./erfCounters.js";

// -----------------------------
// 🔁 Rebuild ERF Registry For LM
// Direct callable rebuild
// -----------------------------
export const rebuildErfRegistryForLmCallable = onCall(async (request) => {
  const db = getFirestore();

  try {
    const auth = request.auth;
    const data = request.data || {};

    if (!auth?.uid) {
      throw new HttpsError(
        "unauthenticated",
        "You must be signed in to rebuild ERF registry.",
      );
    }

    const lmPcode = data?.lmPcode || "NAv";

    if (!lmPcode || lmPcode === "NAv") {
      throw new HttpsError("invalid-argument", "lmPcode is required.");
    }

    const userSnap = await db.collection("users").doc(auth.uid).get();
    const user = userSnap.exists ? userSnap.data() : null;

    const role =
      user?.employment?.role || user?.profile?.employment?.role || "NAv";

    const allowedRoles = [
      "spu",
      "adm",
      "mng",
      "spv",
      "SPU",
      "ADM",
      "MNG",
      "SPV",
    ];

    if (!allowedRoles.includes(role)) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to rebuild ERF registry.",
      );
    }

    logger.info("ERF callable start", {
      uid: auth.uid,
      lmPcode,
      role,
    });

    // -----------------------------
    // 📥 Load ERFs only
    // -----------------------------
    const erfsSnap = await db
      .collection("ireps_erfs")
      .where("admin.localMunicipality.pcode", "==", lmPcode)
      .get();

    const erfDocs = erfsSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    logger.info("ERF callable ERFs loaded", {
      lmPcode,
      count: erfDocs.length,
    });

    // -----------------------------
    // 🏗️ Build + Write Rows
    // -----------------------------
    const batchSize = 300;
    let batch = db.batch();
    let opCount = 0;

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
          syncJobId: "NAv",
        });

        const ref = db.collection("registry_erfs").doc(row.id);

        batch.set(ref, row, { merge: true });
        opCount++;
        succeeded++;
      } catch (rowError) {
        failed++;

        logger.error("ERF callable row build failed", {
          erfId: erfDoc?.erfId || erfDoc?.id || "NAv",
          message: rowError?.message || "Unknown row error",
        });
      }

      if (opCount >= batchSize) {
        await batch.commit();
        batch = db.batch();
        opCount = 0;
      }
    }

    if (opCount > 0) {
      await batch.commit();
    }

    // -----------------------------
    // 🧹 Delete stale rows
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

    logger.info("ERF callable completed", {
      lmPcode,
      totalErfs: erfDocs.length,
      succeeded,
      failed,
    });

    return {
      ok: true,
      lmPcode,
      totalErfs: erfDocs.length,
      succeeded,
      failed,
      message: "ERF registry rebuild completed successfully.",
    };
  } catch (error) {
    logger.error("ERF callable failed", {
      message: error?.message || "Unknown callable error",
      stack: error?.stack || "No stack",
    });

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      error?.message || "Failed to rebuild ERF registry.",
    );
  }
});
