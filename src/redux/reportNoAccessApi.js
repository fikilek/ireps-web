import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { collection, onSnapshot, query, where } from "firebase/firestore";

import { db } from "../firebase";

const NO_ACCESS_REPORT_COLLECTION = "report_trn_no_access";
const NO_ACCESS_REPORT_LM_FIELD = "parents.lmPcode";

function normalizeNoAccessRow(id, data) {
  return {
    id: data?.id || id,

    lmPcode: data?.parents?.lmPcode || "NAv",
    wardPcode: data?.parents?.wardPcode || "NAv",

    activityDate: data?.activityDate || "NAv",

    reason: data?.access?.reason || "NAv",
    hasAccess: data?.access?.hasAccess || "NAv",

    erfId: data?.erf?.id || "NAv",
    erfNo: data?.erf?.no || "NAv",

    premiseId: data?.premise?.id || "NAv",
    premiseAddress: data?.premise?.address || "NAv",
    premisePropertyType: data?.premise?.propertyType || "NAv",

    trnType: data?.trn?.type || "NAv",
    trnCreatedAt: data?.trn?.createdAt || "NAv",
    trnUpdatedAt: data?.trn?.updatedAt || "NAv",

    userUid: data?.user?.uid || "NAv",
    userName: data?.user?.name || "NAv",

    reportType: data?.reportType || "NAv",

    updatedAt: data?.metadata?.updatedAt || data?.metadata?.createdAt || "NAv",
  };
}

function sortNoAccessRows(a, b) {
  const dateCompare = String(b.activityDate).localeCompare(
    String(a.activityDate),
  );

  if (dateCompare !== 0) return dateCompare;

  return String(a.erfNo).localeCompare(String(b.erfNo), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export const reportNoAccessApi = createApi({
  reducerPath: "reportNoAccessApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getNoAccessRowsByLm: builder.query({
      queryFn: () => ({ data: [] }),

      async onCacheEntryAdded(
        lmPcode,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        if (!lmPcode) return;

        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          const reportRef = collection(db, NO_ACCESS_REPORT_COLLECTION);

          const reportQuery = query(
            reportRef,
            where(NO_ACCESS_REPORT_LM_FIELD, "==", lmPcode),
          );

          unsubscribe = onSnapshot(
            reportQuery,
            (snapshot) => {
              const rows = snapshot.docs
                .map((documentSnapshot) =>
                  normalizeNoAccessRow(
                    documentSnapshot.id,
                    documentSnapshot.data(),
                  ),
                )
                .sort(sortNoAccessRows);

              updateCachedData((draft) => {
                draft.splice(0, draft.length, ...rows);
              });
            },
            (error) => {
              console.error("reportNoAccessApi stream error:", error);
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

export const { useGetNoAccessRowsByLmQuery } = reportNoAccessApi;
