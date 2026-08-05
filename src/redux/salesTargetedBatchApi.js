import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { collection, onSnapshot, query, where } from "firebase/firestore";

import { db } from "../firebase";
import {
  buildTargetedBatchHeaders,
  cleanText,
} from "../pages/sales/models/salesTargetedBatchReadModel";

const TARGETED_BATCH_UPLOADS_COLLECTION = "tb_uploads";

function createTargetedBatchHeadersStreamState(status = "idle") {
  return {
    items: [],
    sync: {
      status,
      source: "firestore-stream",
      firstSnapshotAtMs: null,
      lastSyncAtMs: null,
      error: null,
    },
  };
}

function normalizeStreamError(error) {
  return {
    code: cleanText(error?.code) || "TARGETED_BATCH_STREAM_ERROR",
    message:
      cleanText(error?.message) ||
      "The live Targeted Batch reporting stream could not be opened.",
  };
}

export const salesTargetedBatchApi = createApi({
  reducerPath: "salesTargetedBatchApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getTargetedBatchHeadersByLm: builder.query({
      queryFn: (lmPcode) => ({
        data: createTargetedBatchHeadersStreamState(
          cleanText(lmPcode) ? "syncing" : "ready",
        ),
      }),

      async onCacheEntryAdded(
        lmPcode,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const normalizedLmPcode = cleanText(lmPcode);
        if (!normalizedLmPcode) return;

        let unsubscribe = () => {};

        try {
          await cacheDataLoaded;

          const batchesQuery = query(
            collection(db, TARGETED_BATCH_UPLOADS_COLLECTION),
            where("scope.lmPcode", "==", normalizedLmPcode),
          );

          unsubscribe = onSnapshot(
            batchesQuery,
            (snapshot) => {
              const syncedAtMs = Date.now();
              const items = buildTargetedBatchHeaders(snapshot.docs);

              updateCachedData((draft) => {
                draft.items = items;
                draft.sync.status = "ready";
                draft.sync.firstSnapshotAtMs ??= syncedAtMs;
                draft.sync.lastSyncAtMs = syncedAtMs;
                draft.sync.error = null;
              });
            },
            (error) => {
              console.error(
                "[SALES TARGETED BATCH API][HEADER STREAM]",
                error,
              );

              updateCachedData((draft) => {
                draft.sync.status = "error";
                draft.sync.lastSyncAtMs = Date.now();
                draft.sync.error = normalizeStreamError(error);
              });
            },
          );
        } catch (error) {
          console.error(
            "[SALES TARGETED BATCH API][HEADER SETUP]",
            error,
          );

          updateCachedData((draft) => {
            draft.sync.status = "error";
            draft.sync.lastSyncAtMs = Date.now();
            draft.sync.error = normalizeStreamError(error);
          });
        }

        try {
          await cacheEntryRemoved;
        } finally {
          unsubscribe();
        }
      },

      keepUnusedDataFor: 300,
    }),
  }),
});

export const { useGetTargetedBatchHeadersByLmQuery } =
  salesTargetedBatchApi;
