import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { collection, onSnapshot, query, where } from "firebase/firestore";

import { db } from "../firebase";

const GEO_FENCES_COLLECTION = "geo_fences";
const GEO_FENCES_LM_FIELD = "parents.lmPcode";

function safeNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function normalizeGeoFenceRow(id, data) {
  const counts = data?.counts || {};
  const geometry = data?.geometry || {};

  return {
    id: data?.id || id,
    name: data?.name || "NAv",
    description: data?.description || "NAv",
    status: data?.status || "NAv",

    lmPcode: data?.parents?.lmPcode || "NAv",
    wardPcode: data?.parents?.wardPcode || "NAv",

    geometry,
    bbox: geometry?.bbox || null,
    centroid: geometry?.centroid || null,
    points: Array.isArray(geometry?.points) ? geometry.points : [],

    erfCount: safeNumber(counts?.erfs),
    premiseCount: safeNumber(counts?.premises),
    meterCount: safeNumber(counts?.meters),

    createdByUser: data?.metadata?.createdByUser || "NAv",
    updatedAt: data?.metadata?.updatedAt || data?.metadata?.createdAt || "NAv",
  };
}

function sortGeoFenceRows(a, b) {
  return String(a.name).localeCompare(String(b.name), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export const mapGeofencesApi = createApi({
  reducerPath: "mapGeofencesApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getGeoFencesByLm: builder.query({
      queryFn: () => ({ data: [] }),

      async onCacheEntryAdded(
        lmPcode,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        if (!lmPcode) return;

        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          const geoFencesRef = collection(db, GEO_FENCES_COLLECTION);

          const geoFencesQuery = query(
            geoFencesRef,
            where(GEO_FENCES_LM_FIELD, "==", lmPcode),
          );

          unsubscribe = onSnapshot(
            geoFencesQuery,
            (snapshot) => {
              const rows = snapshot.docs
                .map((documentSnapshot) =>
                  normalizeGeoFenceRow(
                    documentSnapshot.id,
                    documentSnapshot.data(),
                  ),
                )
                .filter((row) => row.status === "ACTIVE")
                .sort(sortGeoFenceRows);

              updateCachedData((draft) => {
                draft.splice(0, draft.length, ...rows);
              });
            },
            (error) => {
              console.error("mapGeofencesApi stream error:", error);
            },
          );

          await cacheEntryRemoved;
        } finally {
          if (unsubscribe) {
            unsubscribe();
          }
        }
      },
    }),
  }),
});

export const { useGetGeoFencesByLmQuery } = mapGeofencesApi;
