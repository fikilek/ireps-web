import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const LIVE_LOCATIONS_COLLECTION = "fwr_live_locations";
const MONITORED_ROLES = new Set(["FWR", "SPV"]);

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
      "Only FWR and SPV users may submit monitoring locations.",
    );
  }

  return { uid, role: profileRole };
}

function requireFiniteNumber(value, fieldName) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    throw new HttpsError(
      "invalid-argument",
      `${fieldName} must be a finite number.`,
    );
  }

  return numberValue;
}

function nullableFiniteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeLocation(rawLocation) {
  if (
    !rawLocation ||
    typeof rawLocation !== "object" ||
    Array.isArray(rawLocation)
  ) {
    throw new HttpsError(
      "invalid-argument",
      "A location object is required.",
    );
  }

  const latitude = requireFiniteNumber(
    rawLocation.latitude,
    "location.latitude",
  );
  const longitude = requireFiniteNumber(
    rawLocation.longitude,
    "location.longitude",
  );

  if (latitude < -90 || latitude > 90) {
    throw new HttpsError(
      "invalid-argument",
      "location.latitude must be between -90 and 90.",
    );
  }

  if (longitude < -180 || longitude > 180) {
    throw new HttpsError(
      "invalid-argument",
      "location.longitude must be between -180 and 180.",
    );
  }

  const rawAccuracyM = nullableFiniteNumber(rawLocation.accuracyM);
  const rawHeadingDegrees = nullableFiniteNumber(rawLocation.headingDegrees);
  const rawSpeedMps = nullableFiniteNumber(rawLocation.speedMps);

  return {
    latitude,
    longitude,
    accuracyM:
      rawAccuracyM !== null && rawAccuracyM >= 0 ? rawAccuracyM : null,
    altitudeM: nullableFiniteNumber(rawLocation.altitudeM),
    headingDegrees:
      rawHeadingDegrees !== null &&
      rawHeadingDegrees >= 0 &&
      rawHeadingDegrees < 360
        ? rawHeadingDegrees
        : null,
    speedMps: rawSpeedMps !== null && rawSpeedMps >= 0 ? rawSpeedMps : null,
  };
}

function normalizeCapturedAtMs(value) {
  const capturedAtMs = requireFiniteNumber(value, "capturedAtMs");

  if (capturedAtMs <= 0) {
    throw new HttpsError(
      "invalid-argument",
      "capturedAtMs must be a positive millisecond timestamp.",
    );
  }

  return Math.trunc(capturedAtMs);
}

export const submitFwrLocationCallable = onCall(async (request) => {
  const { uid } = await requireMonitoredUser(request);

  logger.info("submitFwrLocationCallable -- START", { uid });

  try {
    const location = normalizeLocation(request.data?.location);
    const capturedAtMs = normalizeCapturedAtMs(request.data?.capturedAtMs);

    const db = getFirestore();
    const locationRef = db.collection(LIVE_LOCATIONS_COLLECTION).doc(uid);

    await locationRef.set({
      uid,
      location,
      capturedAtMs,
      receivedAt: FieldValue.serverTimestamp(),
      monitoringStatus: "ACTIVE",
    });

    logger.info("submitFwrLocationCallable -- SUCCESS", {
      uid,
      capturedAtMs,
    });

    return {
      success: true,
      uid,
      monitoringStatus: "ACTIVE",
      capturedAtMs,
    };
  } catch (error) {
    logger.error("submitFwrLocationCallable -- ERROR", {
      uid,
      code: error?.code || "unknown",
      message: error?.message || String(error),
    });

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      "Could not save the live monitoring location.",
    );
  }
});
