import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { collection, onSnapshot, query, where } from "firebase/firestore";

import { db } from "../firebase";

const REGISTRY_MREAD_COLLECTION = "registry_mread";
const REGISTRY_MREAD_WARD_FIELD = "geography.wardPcode";

function serializeRegistryDateValue(value) {
  if (!value || value === "NAv") return "NAv";

  if (typeof value === "string") return value;

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? "NAv" : date.toISOString();
  }

  if (typeof value?.toMillis === "function") {
    const date = new Date(value.toMillis());
    return Number.isNaN(date.getTime()) ? "NAv" : date.toISOString();
  }

  if (typeof value?.seconds === "number") {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? "NAv" : date.toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "NAv" : date.toISOString();
}

function isMeaningfulRegistryText(value) {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  if (!text) return false;
  return !["nav", "n/av", "n/a", "na", "null", "undefined"].includes(
    text.toLowerCase(),
  );
}

function firstMeaningfulRegistryText(...values) {
  for (const value of values) {
    if (isMeaningfulRegistryText(value)) return String(value).trim();
  }
  return "NAv";
}

function normalizeRegistryMediaRefs(value) {
  const refs = [];

  const addRef = (item) => {
    if (!item) return;

    if (typeof item === "string") {
      const url = item.trim();
      if (url) refs.push({ url, tag: "meterReadingEvidence", type: "image" });
      return;
    }

    if (Array.isArray(item)) {
      item.forEach(addRef);
      return;
    }

    if (typeof item !== "object") return;

    const url = String(
      item.url ||
        item.uri ||
        item.href ||
        item.link ||
        item.mediaUrl ||
        item.imageUrl ||
        item.downloadUrl ||
        item.storageUrl ||
        "",
    ).trim();

    if (!url) return;

    refs.push({
      ...item,
      url,
      tag: item.tag || item.type || "meterReadingEvidence",
      type: item.type || "image",
    });
  };

  addRef(value);

  const seenUrls = new Set();
  return refs.filter((item) => {
    if (seenUrls.has(item.url)) return false;
    seenUrls.add(item.url);
    return true;
  });
}

function normalizeRegistryMediaTags({ mediaRefs = [], evidence = {} } = {}) {
  const tags = Array.isArray(evidence?.mediaTags) ? evidence.mediaTags : [];

  return Array.from(
    new Set(
      [...tags, ...mediaRefs.map((item) => item?.tag)]
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  );
}

function normalizeRegistryMreadRow(id, data) {
  const outcome = data?.outcome?.outcome || data?.outcome || "NAv";
  const reasonText = firstMeaningfulRegistryText(data?.outcome?.reasonText);
  const noAccessReason =
    outcome === "NO_ACCESS"
      ? firstMeaningfulRegistryText(
          data?.outcome?.noAccessReason,
          data?.outcome?.reasonText,
          data?.outcome?.reasonCode,
        )
      : "NAv";
  const unsuccessfulReason =
    outcome === "UNSUCCESSFUL_READING"
      ? firstMeaningfulRegistryText(
          data?.outcome?.unsuccessfulReason,
          data?.outcome?.unsuccesfulReason,
          data?.outcome?.reasonText,
          data?.outcome?.reasonCode,
        )
      : "NAv";
  const billingReadiness = data?.billingReadiness?.status || "NAv";
  const completedAt = serializeRegistryDateValue(
    data?.source?.completedAt || data?.metadata?.updatedAt || data?.metadata?.createdAt,
  );
  const sincePreviousReading = data?.reading?.sincePreviousReading || null;
  const sincePreviousReadingDisplay =
    typeof sincePreviousReading === "string"
      ? sincePreviousReading
      : sincePreviousReading?.display || "NAv";
  const sincePreviousReadingMinutes = Number(
    sincePreviousReading?.totalMinutes,
  );
  const sincePreviousReadingValue = Number(sincePreviousReading?.value);
  const evidence = data?.evidence || {};
  const mediaRefs = normalizeRegistryMediaRefs(evidence?.mediaRefs);
  const mediaTags = normalizeRegistryMediaTags({ mediaRefs, evidence });
  const photoCount = Number(evidence?.photoCount || mediaRefs.length || 0);
  const hasPhoto = Boolean(evidence?.hasPhoto || mediaRefs.length > 0 || photoCount > 0);

  return {
    id,
    trnId: data?.source?.trnId || data?.id || id,
    trnPath: data?.source?.trnPath || `trns/${id}`,

    outcome,
    reasonCode: data?.outcome?.reasonCode || "NAv",
    reasonText,
    outcomeReasonText: reasonText,
    noAccessReason,
    unsuccessfulReason,

    currentReading: data?.reading?.currentReading ?? null,
    readingAt: serializeRegistryDateValue(data?.reading?.readingAt),
    previousReading: data?.reading?.previousReading ?? null,
    consumption: data?.reading?.consumption ?? null,
    sincePreviousReading,
    sincePreviousReadingDisplay,
    sincePreviousReadingMinutes: Number.isFinite(sincePreviousReadingMinutes)
      ? sincePreviousReadingMinutes
      : null,
    sincePreviousReadingUnit:
      typeof sincePreviousReading === "object" && sincePreviousReading?.unit
        ? sincePreviousReading.unit
        : "NAv",
    sincePreviousReadingValue: Number.isFinite(sincePreviousReadingValue)
      ? sincePreviousReadingValue
      : null,

    meterNo: data?.meter?.astNo || data?.meter?.meterNo || "NAv",
    astNo: data?.meter?.astNo || "NAv",
    astId: data?.meter?.astId || "NAv",
    meterType: data?.meter?.meterType || "NAv",
    meterKind: data?.meter?.meterKind || "NAv",
    statusState: data?.meter?.statusState || "NAv",
    visibility: data?.meter?.visibility || "NAv",

    premiseId: data?.premise?.premiseId || "NAv",
    erfId: data?.premise?.erfId || "NAv",
    erfNo: data?.premise?.erfNo || "NAv",
    premiseAddress: data?.premise?.address || "NAv",
    propertyType: data?.premise?.propertyType || "NAv",
    suburbName: data?.premise?.suburbName || "NAv",

    countryPcode: data?.geography?.countryPcode || "NAv",
    provincePcode: data?.geography?.provincePcode || "NAv",
    dmPcode: data?.geography?.dmPcode || "NAv",
    dmName: data?.geography?.dmName || "NAv",
    lmPcode: data?.geography?.lmPcode || "NAv",
    lmName: data?.geography?.lmName || "NAv",
    wardPcode: data?.geography?.wardPcode || "NAv",
    wardNo: data?.geography?.wardNo || "NAv",
    geofenceId: data?.geography?.geofenceId || "NAv",
    geofenceName: data?.geography?.geofenceName || "NAv",

    capturedByUid: data?.actor?.capturedByUid || "NAv",
    capturedByName: data?.actor?.capturedByName || "NAv",
    capturedByRole: data?.actor?.capturedByRole || "NAv",
    teamId: data?.actor?.teamId || "NAv",
    teamName: data?.actor?.teamName || "NAv",
    spId: data?.actor?.spId || "NAv",
    spName: data?.actor?.spName || "NAv",

    assignedToType: data?.assignment?.assignedToType || "NAv",
    assignedToId: data?.assignment?.assignedToId || "NAv",
    assignedToName: data?.assignment?.assignedToName || "NAv",

    streamType: data?.stream?.streamType || "NAv",
    bgoId: data?.stream?.bgoId || "NAv",
    bgoRowId: data?.stream?.bgoRowId || "NAv",
    batchId: data?.stream?.batchId || "NAv",

    billingReadiness,
    billingReasonCodes: data?.billingReadiness?.reasonCodes || [],

    hasPhoto,
    photoCount,
    mediaTags,
    mediaRefs,
    evidenceMediaRefs: mediaRefs,
    evidence: {
      ...evidence,
      hasPhoto,
      photoCount,
      mediaTags,
      mediaRefs,
    },
    notes: evidence?.notes || "NAv",
    gps: evidence?.gps || null,

    reviewStatus: data?.review?.status || "NAv",
    requiresDataFix: Boolean(data?.dataQuality?.requiresDataFix),
    missingFields: data?.dataQuality?.missingFields || [],
    warnings: data?.dataQuality?.warnings || [],

    completedAt,
    updatedAt: serializeRegistryDateValue(data?.metadata?.updatedAt || data?.metadata?.createdAt),
    updatedByUser: data?.metadata?.updatedByUser || data?.metadata?.createdByUser || "NAv",
    raw: data,
  };
}

function getCompletedAtMs(row) {
  if (!row.completedAt || row.completedAt === "NAv") return 0;
  const ms = new Date(row.completedAt).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function sortMreadRows(a, b) {
  return getCompletedAtMs(b) - getCompletedAtMs(a);
}

function buildRegistryMreadWardQuery(wardPcode) {
  const registryMreadRef = collection(db, REGISTRY_MREAD_COLLECTION);
  return query(
    registryMreadRef,
    where(REGISTRY_MREAD_WARD_FIELD, "==", wardPcode),
  );
}

function mapRegistryMreadSnapshot(snapshot) {
  return snapshot.docs
    .map((documentSnapshot) =>
      normalizeRegistryMreadRow(documentSnapshot.id, documentSnapshot.data()),
    )
    .sort(sortMreadRows);
}

function waitForInitialRegistryMreadRows(wardPcode) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = null;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (unsubscribe) unsubscribe();
      callback(value);
    };

    unsubscribe = onSnapshot(
      buildRegistryMreadWardQuery(wardPcode),
      (snapshot) => finish(resolve, mapRegistryMreadSnapshot(snapshot)),
      (error) => finish(reject, error),
    );
  });
}

export const registryMreadApi = createApi({
  reducerPath: "registryMreadApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getRegistryMreadByWard: builder.query({
      async queryFn(wardPcode) {
        if (!wardPcode) return { data: [] };

        try {
          const rows = await waitForInitialRegistryMreadRows(wardPcode);
          return { data: rows };
        } catch (error) {
          console.error("registryMreadApi initial load error:", error);
          return {
            error: {
              message: error?.message || "Failed to open registry_mread stream.",
            },
          };
        }
      },

      async onCacheEntryAdded(
        wardPcode,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        if (!wardPcode) return;

        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          unsubscribe = onSnapshot(
            buildRegistryMreadWardQuery(wardPcode),
            (snapshot) => {
              const rows = mapRegistryMreadSnapshot(snapshot);

              updateCachedData((draft) => {
                draft.splice(0, draft.length, ...rows);
              });
            },
            (error) => {
              console.error("registryMreadApi stream error:", error);
            },
          );

          await cacheEntryRemoved;
        } finally {
          if (unsubscribe) unsubscribe();
        }
      },
    }),
  }),
});

export const { useGetRegistryMreadByWardQuery } = registryMreadApi;
