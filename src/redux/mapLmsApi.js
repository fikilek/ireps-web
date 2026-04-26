import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { doc, onSnapshot } from "firebase/firestore";

import { db } from "../firebase";

const LMS_COLLECTION = "lms";

function normalizeLmRow(id, data) {
  return {
    id: data?.id || id,
    name: data?.name || "NAv",

    bbox: data?.bbox || null,
    centroid: data?.centroid || null,
    geometry: data?.geometry || null,

    districtName: data?.parentNames?.district || "NAv",
    provinceName: data?.parentNames?.province || "NAv",

    updatedAt: data?.metadata?.updatedAt || data?.metadata?.createdAt || "NAv",
  };
}

export const mapLmsApi = createApi({
  reducerPath: "mapLmsApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getLmBoundaryById: builder.query({
      queryFn: () => ({ data: null }),

      async onCacheEntryAdded(
        lmPcode,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        if (!lmPcode) return;

        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          const lmRef = doc(db, LMS_COLLECTION, lmPcode);

          unsubscribe = onSnapshot(
            lmRef,
            (snapshot) => {
              if (!snapshot.exists()) {
                updateCachedData(() => null);
                return;
              }

              const row = normalizeLmRow(snapshot.id, snapshot.data());

              updateCachedData(() => row);
            },
            (error) => {
              console.error("mapLmsApi stream error:", error);
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

export const { useGetLmBoundaryByIdQuery } = mapLmsApi;
