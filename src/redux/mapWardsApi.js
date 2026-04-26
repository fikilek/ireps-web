import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { collection, onSnapshot, query, where } from "firebase/firestore";

import { db } from "../firebase";

const WARDS_COLLECTION = "wards";
const WARDS_LM_FIELD = "parents.localMunicipalityId";

function normalizeWardBoundaryRow(id, data) {
  return {
    id: data?.pcode || data?.id || id,
    wardPcode: data?.pcode || data?.id || id,
    wardNumber: data?.code || "NAv",
    name: data?.name || "NAv",

    lmPcode: data?.parents?.localMunicipalityId || "NAv",

    bbox: data?.bbox || null,
    centroid: data?.centroid || null,
    geometry: data?.geometry || null,

    updatedAt: data?.metadata?.updatedAt || data?.metadata?.createdAt || "NAv",
  };
}

function sortWardRows(a, b) {
  return Number(a.wardNumber || 0) - Number(b.wardNumber || 0);
}

export const mapWardsApi = createApi({
  reducerPath: "mapWardsApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getWardBoundariesByLm: builder.query({
      queryFn: () => ({ data: [] }),

      async onCacheEntryAdded(
        lmPcode,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        if (!lmPcode) return;

        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          const wardsRef = collection(db, WARDS_COLLECTION);

          const wardsQuery = query(
            wardsRef,
            where(WARDS_LM_FIELD, "==", lmPcode),
          );

          unsubscribe = onSnapshot(
            wardsQuery,
            (snapshot) => {
              const rows = snapshot.docs
                .map((documentSnapshot) =>
                  normalizeWardBoundaryRow(
                    documentSnapshot.id,
                    documentSnapshot.data(),
                  ),
                )
                .sort(sortWardRows);

              updateCachedData((draft) => {
                draft.splice(0, draft.length, ...rows);
              });
            },
            (error) => {
              console.error("mapWardsApi stream error:", error);
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

export const { useGetWardBoundariesByLmQuery } = mapWardsApi;
