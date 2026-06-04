import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { db } from "../firebase";

function sortAstsByUpdatedAtDesc(list) {
  if (!Array.isArray(list)) return;

  list.sort((a, b) => {
    const aAt = a?.accessData?.metadata?.updatedAt || "";
    const bAt = b?.accessData?.metadata?.updatedAt || "";
    return String(bAt).localeCompare(String(aAt));
  });
}

export const astsApi = createApi({
  reducerPath: "astsApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getAstsByLmPcode: builder.query({
      queryFn: () => ({ data: [] }),

      async onCacheEntryAdded(
        lmPcode,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        let unsubscribe = () => {};

        try {
          await cacheDataLoaded;

          if (!lmPcode) return;

          const q = query(
            collection(db, "asts"),
            where("accessData.parents.lmPcode", "==", lmPcode),
            orderBy("accessData.metadata.updatedAt", "desc"),
          );

          unsubscribe = onSnapshot(
            q,
            (snapshot) => {
              updateCachedData(() => {
                const next = snapshot.docs.map((docSnap) => ({
                  id: docSnap.id,
                  ...docSnap.data(),
                }));

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

                return {
                  id: docSnap.id,
                  ...docSnap.data(),
                };
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
            orderBy("accessData.metadata.updatedAt", "desc"),
          );

          unsubscribe = onSnapshot(
            q,
            (snapshot) => {
              updateCachedData(() => {
                const next = snapshot.docs.map((docSnap) => ({
                  id: docSnap.id,
                  ...docSnap.data(),
                }));

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
