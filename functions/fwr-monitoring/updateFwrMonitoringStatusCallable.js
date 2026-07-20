import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const LIVE_LOCATIONS_COLLECTION = "fwr_live_locations";
const MONITORED_ROLES = new Set(["FWR", "SPV"]);
const ALLOWED_STATUSES = new Set(["SIGNED_OUT"]);

function normalizeRole(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

async function requireMonitoredUser(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const uid = request.auth.uid;
  const claimRole = normalizeRole(request.auth.token?.role);

  if (MONITORED_ROLES.has(claimRole)) {
    return { uid, role: claimRole };
  }

  const db = getFirestore();
  const userSnap = await db.collection("users").doc(uid).get();

  if (!userSnap.exists) {
    throw new HttpsError("permission-denied", "User profile not found.");
  }

  const userData = userSnap.data() || {};
  const profileRole = normalizeRole(
    userData?.employment?.role || userData?.role,
  );

  if (!MONITORED_ROLES.has(profileRole)) {
    throw new HttpsError(
      "permission-denied",
      "Only FWR and SPV users may update monitoring status.",
    );
  }

  return { uid, role: profileRole };
}

function normalizeMonitoringStatus(value) {
  const monitoringStatus = String(value || "")
    .trim()
    .toUpperCase();

  if (!ALLOWED_STATUSES.has(monitoringStatus)) {
    throw new HttpsError(
      "invalid-argument",
      "monitoringStatus must be SIGNED_OUT.",
    );
  }

  return monitoringStatus;
}

export const updateFwrMonitoringStatusCallable = onCall(async (request) => {
  const { uid } = await requireMonitoredUser(request);

  logger.info("updateFwrMonitoringStatusCallable -- START", { uid });

  try {
    const monitoringStatus = normalizeMonitoringStatus(
      request.data?.monitoringStatus,
    );

    const db = getFirestore();
    const locationRef = db.collection(LIVE_LOCATIONS_COLLECTION).doc(uid);
    const locationSnap = await locationRef.get();

    if (!locationSnap.exists) {
      logger.info(
        "updateFwrMonitoringStatusCallable -- NO LOCATION DOCUMENT",
        { uid, monitoringStatus },
      );

      return {
        success: true,
        updated: false,
        uid,
        monitoringStatus,
        reason: "NO_LIVE_LOCATION_DOCUMENT",
      };
    }

    await locationRef.update({
      monitoringStatus,
      receivedAt: FieldValue.serverTimestamp(),
    });

    logger.info("updateFwrMonitoringStatusCallable -- SUCCESS", {
      uid,
      monitoringStatus,
    });

    return {
      success: true,
      updated: true,
      uid,
      monitoringStatus,
    };
  } catch (error) {
    logger.error("updateFwrMonitoringStatusCallable -- ERROR", {
      uid,
      code: error?.code || "unknown",
      message: error?.message || String(error),
    });

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      "Could not update the monitoring status.",
    );
  }
});
