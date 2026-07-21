// src/redux/fwrLiveLocationsApi.js

import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import {
  collection,
  limit as limitQuery,
  onSnapshot,
  query,
} from "firebase/firestore";

import { db } from "../firebase";

const FWR_LIVE_LOCATIONS_COLLECTION = "fwr_live_locations";
const DEFAULT_LIMIT = 5000;

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;

  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function timestampToMs(value) {
  if (!value) return null;

  if (typeof value?.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value?.seconds === "number") {
    const nanoseconds = Number(value?.nanoseconds || 0);
    return value.seconds * 1000 + Math.floor(nanoseconds / 1_000_000);
  }

  const normalized = Number(value);
  if (Number.isFinite(normalized)) return normalized;

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeMonitoringStatus(value) {
  const normalized = String(value || "ACTIVE")
    .trim()
    .toUpperCase();

  return normalized || "ACTIVE";
}

function normalizeLiveLocationDoc(docSnapshot) {
  if (!docSnapshot?.exists()) return null;

  const data = docSnapshot.data() || {};
  const location = data.location || {};
  const uid = String(data.uid || docSnapshot.id || "").trim();

  if (!uid) return null;

  return {
    id: docSnapshot.id,
    uid,
    location: {
      latitude: toFiniteNumber(location.latitude),
      longitude: toFiniteNumber(location.longitude),
      accuracyM: toFiniteNumber(location.accuracyM),
      altitudeM: toFiniteNumber(location.altitudeM),
      headingDegrees: toFiniteNumber(location.headingDegrees),
      speedMps: toFiniteNumber(location.speedMps),
    },
    capturedAtMs: timestampToMs(data.capturedAtMs),
    receivedAtMs: timestampToMs(data.receivedAt),
    monitoringStatus: normalizeMonitoringStatus(data.monitoringStatus),
  };
}

function sortLiveLocations(left, right) {
  return String(left?.uid || "").localeCompare(String(right?.uid || ""));
}

function resolveLimit(arg, fallback = DEFAULT_LIMIT) {
  const value = typeof arg === "number" ? arg : arg?.limit;
  const normalized = Number(value);

  return Number.isFinite(normalized) && normalized > 0
    ? Math.trunc(normalized)
    : fallback;
}

const INITIAL_STREAM_STATE = Object.freeze({
  locations: [],
  ready: false,
  streamError: null,
  snapshotCount: 0,
});

export const fwrLiveLocationsApi = createApi({
  reducerPath: "fwrLiveLocationsApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getFwrLiveLocations: builder.query({
      queryFn: () => ({
        data: {
          ...INITIAL_STREAM_STATE,
          locations: [],
        },
      }),

      async onCacheEntryAdded(
        arg,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const maxResults = resolveLimit(arg);
        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          console.log("[FWR MONITORING WEB] Live-location stream starting.", {
            collection: FWR_LIVE_LOCATIONS_COLLECTION,
            limit: maxResults,
          });

          const collectionRef = collection(
            db,
            FWR_LIVE_LOCATIONS_COLLECTION,
          );
          const liveLocationsQuery = query(
            collectionRef,
            limitQuery(maxResults),
          );

          unsubscribe = onSnapshot(
            liveLocationsQuery,
            (snapshot) => {
              const locations = snapshot.docs
                .map((docSnapshot) =>
                  normalizeLiveLocationDoc(docSnapshot),
                )
                .filter(Boolean)
                .sort(sortLiveLocations);

              updateCachedData((draft) => {
                draft.locations = locations;
                draft.ready = true;
                draft.streamError = null;
                draft.snapshotCount += 1;
              });

              console.log(
                "[FWR MONITORING WEB] Live-location snapshot received.",
                {
                  documents: locations.length,
                },
              );
            },
            (error) => {
              console.error(
                "[FWR MONITORING WEB] Live-location stream failed.",
                {
                  code: error?.code || "UNKNOWN",
                  message: error?.message || String(error),
                },
              );

              updateCachedData((draft) => {
                draft.ready = true;
                draft.streamError = {
                  code: error?.code || "UNKNOWN",
                  message:
                    error?.message ||
                    "The live-location stream could not be opened.",
                };
              });
            },
          );

          await cacheEntryRemoved;
        } finally {
          if (unsubscribe) unsubscribe();

          console.log("[FWR MONITORING WEB] Live-location stream stopped.");
        }
      },
    }),
  }),
});

export const { useGetFwrLiveLocationsQuery } = fwrLiveLocationsApi;
