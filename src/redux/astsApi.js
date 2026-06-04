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
  useGetAstsByLmPcodeWardPcodeQuery,
} = astsApi;
