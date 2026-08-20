import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

const ALLOWED_REGISTRY_ROLES = new Set(["SPU", "ADM", "MNG", "SPV"]);
const FIREBASE_STORAGE_DOWNLOAD_HOST = "firebasestorage.googleapis.com";
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

function cleanText(value) {
  return String(value || "").trim();
}

function getCallerRole(request, userData = {}) {
  return cleanText(
    userData?.employment?.role ||
      userData?.role ||
      request?.auth?.token?.role ||
      "",
  ).toUpperCase();
}

function getWorkbaseIds(userData = {}) {
  const values = Array.isArray(userData?.access?.workbases)
    ? userData.access.workbases
    : [];
  const ids = values
    .map((item) => cleanText(typeof item === "string" ? item : item?.id))
    .filter(Boolean);

  const activeWorkbaseId = cleanText(userData?.access?.activeWorkbase?.id);
  if (activeWorkbaseId) ids.push(activeWorkbaseId);

  return new Set(ids);
}

async function assertTrnReadAccess({ request, trnData }) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const db = getFirestore();
  const userSnap = await db.collection("users").doc(request.auth.uid).get();
  const userData = userSnap.exists ? userSnap.data() || {} : {};
  const role = getCallerRole(request, userData);

  if (!ALLOWED_REGISTRY_ROLES.has(role)) {
    throw new HttpsError(
      "permission-denied",
      "This user may not read TRN Registry media.",
    );
  }

  if (role === "SPU" || role === "ADM") return;

  const trnLmPcode = cleanText(trnData?.accessData?.parents?.lmPcode);
  const workbaseIds = getWorkbaseIds(userData);

  if (!trnLmPcode || !workbaseIds.has(trnLmPcode)) {
    throw new HttpsError(
      "permission-denied",
      "This TRN is outside the user's assigned workbases.",
    );
  }
}

function getConfiguredStorageBuckets() {
  const buckets = new Set();
  const projectId = cleanText(
    process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT,
  );

  if (projectId) {
    buckets.add(`${projectId}.appspot.com`);
    buckets.add(`${projectId}.firebasestorage.app`);
  }

  const firebaseConfigText = cleanText(process.env.FIREBASE_CONFIG);
  if (firebaseConfigText) {
    try {
      const firebaseConfig = JSON.parse(firebaseConfigText);
      const configuredBucket = cleanText(firebaseConfig?.storageBucket);
      if (configuredBucket) buckets.add(configuredBucket);
    } catch (error) {
      logger.warn("TRN media callable could not parse FIREBASE_CONFIG.", {
        message: error?.message || String(error),
      });
    }
  }

  return buckets;
}

function assertTrustedMediaUrl(value) {
  let mediaUrl;

  try {
    mediaUrl = new URL(cleanText(value));
  } catch {
    throw new HttpsError(
      "failed-precondition",
      "The selected TRN media URL is invalid.",
    );
  }

  if (
    mediaUrl.protocol !== "https:" ||
    mediaUrl.hostname !== FIREBASE_STORAGE_DOWNLOAD_HOST
  ) {
    throw new HttpsError(
      "failed-precondition",
      "The selected TRN media is not stored in an approved Firebase Storage URL.",
    );
  }

  const pathMatch = mediaUrl.pathname.match(/^\/v0\/b\/([^/]+)\/o\//);
  const bucket = pathMatch ? decodeURIComponent(pathMatch[1]) : "";
  const configuredBuckets = getConfiguredStorageBuckets();

  if (!bucket || !configuredBuckets.has(bucket)) {
    throw new HttpsError(
      "permission-denied",
      "The selected TRN media belongs to an unexpected Storage bucket.",
    );
  }

  return mediaUrl.toString();
}

function normalizeContentType(value, mediaUrl) {
  const contentType = cleanText(value).toLowerCase().split(";")[0];
  if (contentType === "image/jpeg" || contentType === "image/jpg") {
    return "image/jpeg";
  }
  if (contentType === "image/png") return "image/png";

  const pathname = new URL(mediaUrl).pathname.toLowerCase();
  if (/\.jpe?g$/.test(pathname)) return "image/jpeg";
  if (/\.png$/.test(pathname)) return "image/png";

  return null;
}

async function fetchImageBytes(mediaUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(mediaUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new HttpsError(
        "unavailable",
        `TRN media download failed with HTTP ${response.status}.`,
      );
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_MEDIA_BYTES) {
      throw new HttpsError(
        "resource-exhausted",
        "The selected TRN image is too large for Quick TRN PDF embedding.",
      );
    }

    const contentType = normalizeContentType(
      response.headers.get("content-type"),
      mediaUrl,
    );

    if (!contentType) {
      throw new HttpsError(
        "failed-precondition",
        "The selected TRN media is not a supported JPG or PNG image.",
      );
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) {
      throw new HttpsError("unavailable", "The selected TRN image is empty.");
    }
    if (bytes.length > MAX_MEDIA_BYTES) {
      throw new HttpsError(
        "resource-exhausted",
        "The selected TRN image is too large for Quick TRN PDF embedding.",
      );
    }

    return { bytes, contentType };
  } catch (error) {
    if (error instanceof HttpsError) throw error;

    if (error?.name === "AbortError") {
      throw new HttpsError("deadline-exceeded", "TRN media download timed out.");
    }

    throw new HttpsError(
      "unavailable",
      error?.message || "TRN media could not be downloaded.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeCallableDate(value) {
  if (!value) return null;

  if (typeof value === "string") return value;

  if (typeof value?.toDate === "function") {
    return value.toDate().toISOString();
  }

  if (typeof value?.seconds === "number") {
    return new Date(value.seconds * 1000).toISOString();
  }

  return null;
}

function getPremiseIdFromTrn(trnData = {}) {
  return cleanText(
    trnData?.accessData?.premise?.id ||
      trnData?.premiseId ||
      "",
  );
}

function getPremiseMediaMetadata(premiseData = {}) {
  const media = Array.isArray(premiseData?.media) ? premiseData.media : [];

  return media
    .map((item, mediaIndex) => ({
      mediaIndex,
      tag: cleanText(item?.tag) || null,
      type: cleanText(item?.type) || null,
      created: {
        at: normalizeCallableDate(item?.created?.at),
        byUser: cleanText(item?.created?.byUser) || null,
      },
      available: Boolean(cleanText(item?.url || item?.uri)),
    }))
    .filter((item) => item.available);
}

function buildPremiseContext(premiseData = {}) {
  const address =
    premiseData?.address && typeof premiseData.address === "object"
      ? premiseData.address
      : {};
  const propertyType = premiseData?.propertyType;
  const propertyTypeObject =
    propertyType && typeof propertyType === "object" ? propertyType : {};

  return {
    address: {
      strNo: cleanText(address?.strNo) || null,
      strName: cleanText(address?.strName) || null,
      strType: cleanText(address?.strType) || null,
      suburbName: cleanText(address?.suburbName) || null,
    },
    property: {
      type:
        cleanText(
          typeof propertyType === "string"
            ? propertyType
            : propertyTypeObject?.type,
        ) || null,
      name:
        cleanText(
          propertyTypeObject?.name ||
            premiseData?.propertyName ||
            "",
        ) || null,
      unitNo:
        cleanText(
          propertyTypeObject?.unitNo ||
            propertyTypeObject?.UnitNo ||
            premiseData?.unitNo ||
            premiseData?.unitNumber ||
            "",
        ) || null,
    },
    occupancyStatus:
      cleanText(premiseData?.occupancy?.status) || null,
    media: getPremiseMediaMetadata(premiseData),
  };
}

async function getLinkedPremise({ db, trnData }) {
  const premiseId = getPremiseIdFromTrn(trnData);

  if (!premiseId || premiseId === "NAv") {
    return {
      premiseId: null,
      premiseData: null,
    };
  }

  const premiseSnap = await db.collection("premises").doc(premiseId).get();

  return {
    premiseId,
    premiseData: premiseSnap.exists ? premiseSnap.data() || {} : null,
  };
}

function assertMediaIndex(mediaIndex) {
  if (!Number.isInteger(mediaIndex) || mediaIndex < 0) {
    throw new HttpsError(
      "invalid-argument",
      "mediaIndex must be a non-negative integer.",
    );
  }
}

async function loadMediaResult({
  media,
  mediaIndex,
  trnId,
  source,
  callerUid,
}) {
  assertMediaIndex(mediaIndex);

  if (mediaIndex >= media.length) {
    throw new HttpsError(
      "not-found",
      `The requested ${source.toLowerCase()} media item does not exist.`,
    );
  }

  const mediaItem = media[mediaIndex] || {};
  const mediaUrl = assertTrustedMediaUrl(mediaItem.url || mediaItem.uri);
  const { bytes, contentType } = await fetchImageBytes(mediaUrl);

  logger.info("getQuickTrnMediaCallable -- SUCCESS", {
    trnId,
    source,
    mediaIndex,
    mediaTag: cleanText(mediaItem.tag) || "NAv",
    contentType,
    byteLength: bytes.length,
    callerUid,
  });

  return {
    trnId,
    source,
    mediaIndex,
    contentType,
    byteLength: bytes.length,
    bytesBase64: bytes.toString("base64"),
  };
}

export const getQuickTrnMediaCallable = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const trnId = cleanText(request.data?.trnId);
  const action = cleanText(request.data?.action || "TRN_MEDIA").toUpperCase();

  if (!trnId) {
    throw new HttpsError("invalid-argument", "trnId is required.");
  }

  if (!["TRN_MEDIA", "PREMISE_CONTEXT", "PREMISE_MEDIA"].includes(action)) {
    throw new HttpsError(
      "invalid-argument",
      "Unsupported Quick TRN media action.",
    );
  }

  const db = getFirestore();
  const trnSnap = await db.collection("trns").doc(trnId).get();

  if (!trnSnap.exists) {
    throw new HttpsError("not-found", "The exact TRN was not found.");
  }

  const trnData = trnSnap.data() || {};
  await assertTrnReadAccess({ request, trnData });

  if (action === "PREMISE_CONTEXT") {
    const { premiseId, premiseData } = await getLinkedPremise({
      db,
      trnData,
    });

    logger.info("getQuickTrnMediaCallable -- PREMISE_CONTEXT", {
      trnId,
      premiseId: premiseId || "NAv",
      premiseFound: Boolean(premiseData),
      callerUid: request.auth.uid,
    });

    return {
      trnId,
      premiseFound: Boolean(premiseData),
      premise: premiseData ? buildPremiseContext(premiseData) : null,
    };
  }

  const mediaIndex = Number(request.data?.mediaIndex);

  if (action === "PREMISE_MEDIA") {
    const { premiseId, premiseData } = await getLinkedPremise({
      db,
      trnData,
    });

    if (!premiseId || !premiseData) {
      throw new HttpsError(
        "not-found",
        "The TRN-linked authoritative premise was not found.",
      );
    }

    const premiseMedia = Array.isArray(premiseData.media)
      ? premiseData.media
      : [];

    return loadMediaResult({
      media: premiseMedia,
      mediaIndex,
      trnId,
      source: "PREMISE",
      callerUid: request.auth.uid,
    });
  }

  const trnMedia = Array.isArray(trnData.media) ? trnData.media : [];

  return loadMediaResult({
    media: trnMedia,
    mediaIndex,
    trnId,
    source: "TRN",
    callerUid: request.auth.uid,
  });
});
