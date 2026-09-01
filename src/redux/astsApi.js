import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import {
  collection,
  doc,
  limit as firestoreLimit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { db } from "../firebase";

function toMillis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getAstUpdatedAt(ast) {
  return ast?.metadata?.updatedAt || ast?.metadata?.createdAt;
}

function sortAstsByUpdatedAtDesc(list) {
  if (!Array.isArray(list)) return;

  list.sort(
    (a, b) => toMillis(getAstUpdatedAt(b)) - toMillis(getAstUpdatedAt(a)),
  );
}

function mapAstDoc(docSnap) {
  return {
    id: docSnap.id,
    ...docSnap.data(),
  };
}

function resolveLmPcode(arg) {
  return String(typeof arg === "string" ? arg : arg?.lmPcode || "").trim();
}

function resolveLimit(arg, fallback = 5000) {
  const rawLimit = typeof arg === "object" ? arg?.limit : null;
  const numericLimit = Number(rawLimit);

  return Number.isFinite(numericLimit) && numericLimit > 0
    ? numericLimit
    : fallback;
}

function createSalesWorkStatusAstStreamState(status = "idle") {
  return {
    items: [],
    sync: {
      status,
      fromCache: null,
      error: null,
    },
  };
}

function mapSalesWorkStatusAstDoc(docSnap) {
  const data = docSnap.data() || {};

  return {
    id: docSnap.id,
    meterNo:
      data?.ast?.astData?.astNo ||
      data?.astData?.astNo ||
      data?.master?.id ||
      "",
    masterId: data?.master?.id || "",
    lmPcode: data?.accessData?.parents?.lmPcode || "",
  };
}

export const astsApi = createApi({
  reducerPath: "astsApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getAstsByLmPcode: builder.query({
      queryFn: () => ({ data: [] }),

      async onCacheEntryAdded(
        arg,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const lmPcode = resolveLmPcode(arg);
        const maxRows = resolveLimit(arg);
        let unsubscribe = () => {};

        try {
          await cacheDataLoaded;

          if (!lmPcode) return;

          const astsQuery = query(
            collection(db, "asts"),
            where("accessData.parents.lmPcode", "==", lmPcode),
            firestoreLimit(maxRows),
          );

          unsubscribe = onSnapshot(
            astsQuery,
            (snapshot) => {
              updateCachedData(() => {
                const next = snapshot.docs.map(mapAstDoc);
                sortAstsByUpdatedAtDesc(next);
                return next;
              });
            },
            (error) => {
              console.error("❌ [AST_LM_SNAPSHOT_ERROR]:", error);
            },
          );
        } catch (error) {
          console.error("❌ [AST_LM_STREAM_ERROR]:", error);
        }

        await cacheEntryRemoved;
        unsubscribe();
      },
    }),

    getSalesWorkStatusAstsByLmPcode: builder.query({
      queryFn: (lmPcode) => ({
        data: createSalesWorkStatusAstStreamState(
          resolveLmPcode(lmPcode) ? "syncing" : "ready",
        ),
      }),

      async onCacheEntryAdded(
        lmPcode,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const normalizedLmPcode = resolveLmPcode(lmPcode);
        if (!normalizedLmPcode) return;

        let unsubscribe = () => {};

        try {
          await cacheDataLoaded;

          const astsQuery = query(
            collection(db, "asts"),
            where("accessData.parents.lmPcode", "==", normalizedLmPcode),
          );

          unsubscribe = onSnapshot(
            astsQuery,
            { includeMetadataChanges: true },
            (snapshot) => {
              const fromCache = snapshot.metadata?.fromCache === true;
              const items = snapshot.docs.map(mapSalesWorkStatusAstDoc);

              updateCachedData((draft) => {
                draft.items = items;
                draft.sync.status = fromCache ? "syncing" : "ready";
                draft.sync.fromCache = fromCache;
                draft.sync.error = null;
              });
            },
            (error) => {
              console.error("âŒ [SALES_WORK_STATUS_AST_STREAM_ERROR]:", error);

              updateCachedData((draft) => {
                draft.sync.status = "error";
                draft.sync.error = {
                  code: error?.code || "AST_STREAM_ERROR",
                  message:
                    error?.message ||
                    "Could not load AST evidence for Sales work status.",
                };
              });
            },
          );

          await cacheEntryRemoved;
        } finally {
          unsubscribe();
        }
      },

      keepUnusedDataFor: 30,
    }),

    getAstById: builder.query({
      queryFn: () => ({ data: null }),

      async onCacheEntryAdded(
        id,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        let unsubscribe = () => {};

        try {
          await cacheDataLoaded;

          if (!id) return;

          const docRef = doc(db, "asts", id);

          unsubscribe = onSnapshot(
            docRef,
            (docSnap) => {
              updateCachedData(() => {
                if (!docSnap.exists()) return null;

                return mapAstDoc(docSnap);
              });
            },
            (error) => {
              console.error("❌ [AST_DOCUMENT_SNAPSHOT_ERROR]:", error);
            },
          );
        } catch (error) {
          console.error("❌ [AST_DOCUMENT_ERROR]:", error);
        }

        await cacheEntryRemoved;
        unsubscribe();
      },
    }),

    getAstsByLmPcodeWardPcode: builder.query({
      queryFn: () => ({ data: [] }),

      async onCacheEntryAdded(
        { lmPcode, wardPcode },
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        let unsubscribe = () => {};

        try {
          await cacheDataLoaded;

          if (!lmPcode || !wardPcode) return;

          const q = query(
            collection(db, "asts"),
            where("accessData.parents.lmPcode", "==", lmPcode),
            where("accessData.parents.wardPcode", "==", wardPcode),
            orderBy("metadata.updatedAt", "desc"),
          );

          unsubscribe = onSnapshot(
            q,
            (snapshot) => {
              updateCachedData(() => {
                const next = snapshot.docs.map(mapAstDoc);
                sortAstsByUpdatedAtDesc(next);
                return next;
              });
            },
            (error) => {
              console.error("❌ [AST_WARD_SNAPSHOT_ERROR]:", error);
            },
          );
        } catch (error) {
          console.error("❌ [AST_WARD_STREAM_ERROR]:", error);
        }

        await cacheEntryRemoved;
        unsubscribe();
      },
    }),
  }),
});

export const {
  useGetAstByIdQuery,
  useGetAstsByLmPcodeQuery,
  useGetSalesWorkStatusAstsByLmPcodeQuery,
  useGetAstsByLmPcodeWardPcodeQuery,
} = astsApi;
