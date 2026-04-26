import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { collection, onSnapshot, query, where } from "firebase/firestore";

import { db } from "../firebase";

const ANOMALY_REPORT_COLLECTION = "report_trn_anomaly";
const ANOMALY_REPORT_LM_FIELD = "parents.lmPcode";

function safeNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function normalizeAnomalyRow(id, data) {
  const anomaly = data?.anomaly || {};
  const counts = data?.counts || {};

  return {
    id: data?.id || id,

    lmPcode: data?.parents?.lmPcode || "NAv",

    activityDate: data?.activityDate || "NAv",

    anomalyName: anomaly?.name || "NAv",
    anomalyKey: anomaly?.anomalyKey || "NAv",
    anomalyDetail: anomaly?.detail || "NAv",
    anomalyDetailKey: anomaly?.detailKey || "NAv",

    trnCount: safeNumber(counts?.trns),

    reportType: data?.reportType || "NAv",

    updatedAt: data?.metadata?.updatedAt || data?.metadata?.createdAt || "NAv",
  };
}

function sortAnomalyRows(a, b) {
  const dateCompare = String(b.activityDate).localeCompare(
    String(a.activityDate),
  );

  if (dateCompare !== 0) return dateCompare;

  const countCompare = b.trnCount - a.trnCount;

  if (countCompare !== 0) return countCompare;

  return String(a.anomalyName).localeCompare(String(b.anomalyName), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export const reportAnomalyApi = createApi({
  reducerPath: "reportAnomalyApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getAnomalyRowsByLm: builder.query({
      queryFn: () => ({ data: [] }),

      async onCacheEntryAdded(
        lmPcode,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        if (!lmPcode) return;

        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          const reportRef = collection(db, ANOMALY_REPORT_COLLECTION);

          const reportQuery = query(
            reportRef,
            where(ANOMALY_REPORT_LM_FIELD, "==", lmPcode),
          );

          unsubscribe = onSnapshot(
            reportQuery,
            (snapshot) => {
              const rows = snapshot.docs
                .map((documentSnapshot) =>
                  normalizeAnomalyRow(
                    documentSnapshot.id,
                    documentSnapshot.data(),
                  ),
                )
                .sort(sortAnomalyRows);

              updateCachedData((draft) => {
                draft.splice(0, draft.length, ...rows);
              });
            },
            (error) => {
              console.error("reportAnomalyApi stream error:", error);
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

export const { useGetAnomalyRowsByLmQuery } = reportAnomalyApi;
