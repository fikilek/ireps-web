import { pendingStream, streamQueryHook, failStream } from "./streamReadiness.js";
import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { collection, doc, onSnapshot } from "firebase/firestore";

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
      queryFn: () => ({ data: pendingStream(null) }),

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
                updateCachedData(() => ({ value: null, ready: true, error: null }));
                return;
              }

              const row = normalizeLmRow(snapshot.id, snapshot.data());

              updateCachedData(() => ({ value: row, ready: true, error: null }));
            },
            (error) => {
              console.error("mapLmsApi stream error:", error);
              updateCachedData(draft => failStream(draft, error));
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
    getAllLms: builder.query({
      async queryFn() {
        return { data: [] };
      },

      async onCacheEntryAdded(
        _arg,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          const lmsRef = collection(db, "lms");

          unsubscribe = onSnapshot(lmsRef, (snapshot) => {
            const rows = snapshot.docs
              .map((docSnap) => ({
                id: docSnap.id,
                ...docSnap.data(),
              }))
              .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

            updateCachedData(() => rows);
          });
        } catch (error) {
          console.error("getAllLms stream error:", error);
        }

        await cacheEntryRemoved;

        if (unsubscribe) {
          unsubscribe();
        }
      },
    }),
  }),
});

export const { useGetLmBoundaryByIdQuery: useGetLmBoundaryByIdQueryRaw, useGetAllLmsQuery } = mapLmsApi;

export const useGetLmBoundaryByIdQuery = streamQueryHook(useGetLmBoundaryByIdQueryRaw);
