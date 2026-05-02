// registry/erfSyncCallable.js

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";

// -----------------------------
// 🚀 Start ERF Registry Sync Job
// -----------------------------
export const startErfRegistrySyncCallable = onCall(async (request) => {
  const db = getFirestore();

  try {
    const auth = request.auth;
    const data = request.data || {};

    if (!auth?.uid) {
      throw new HttpsError(
        "unauthenticated",
        "You must be signed in to start ERF registry sync.",
      );
    }

    const lmPcode = data?.lmPcode || "NAv";

    if (!lmPcode || lmPcode === "NAv") {
      throw new HttpsError("invalid-argument", "lmPcode is required.");
    }

    const userSnap = await db.collection("users").doc(auth.uid).get();
    const user = userSnap.exists ? userSnap.data() : null;

    const role = user?.employment?.role || "NAv";
    const displayName =
      user?.profile?.displayName ||
      user?.name ||
      user?.email ||
      auth.token?.email ||
      "SYSTEM";

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
        "You do not have permission to start ERF registry sync.",
      );
    }

    const now = new Date().toISOString();

    const jobRef = await db.collection("jobs_registry_erfs").add({
      type: "REBUILD_ERF_REGISTRY",
      scope: {
        mode: "LM",
        lmPcode,
      },
      status: "PENDING",
      progress: {
        total: 0,
        processed: 0,
        succeeded: 0,
        failed: 0,
      },
      error: "NAv",
      metadata: {
        createdAt: now,
        createdByUid: auth.uid,
        createdByUser: displayName,
        updatedAt: now,
        updatedByUid: auth.uid,
        updatedByUser: displayName,
      },
    });

    return {
      ok: true,
      jobId: jobRef.id,
      lmPcode,
      message: "ERF registry sync job created successfully.",
    };
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      error?.message || "Failed to start ERF registry sync.",
    );
  }
});
