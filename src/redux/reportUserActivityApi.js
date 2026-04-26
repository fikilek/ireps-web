import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { collection, onSnapshot, query, where } from "firebase/firestore";

import { db } from "../firebase";

const USER_ACTIVITY_REPORT_COLLECTION = "report_trn_user_activity";
const USER_ACTIVITY_REPORT_LM_FIELD = "parents.lmPcode";

function safeNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function normalizeUserActivityRow(id, data) {
  const counts = data?.counts || {};
  const user = data?.user || {};

  return {
    id: data?.id || id,

    lmPcode: data?.parents?.lmPcode || "NAv",

    userUid: user?.uid || "NAv",
    userName: user?.name || "NAv",
    userRole: user?.role || "NAv",

    serviceProviderId: user?.serviceProviderId || "NAv",
    serviceProviderName: user?.serviceProviderName || "NAv",

    teamId: user?.teamId || "NAv",
    teamName: user?.teamName || "NAv",

    totalTrns: safeNumber(counts?.totalTrns),
    meterDiscoveryTrns: safeNumber(counts?.meterDiscoveryTrns),
    noAccessTrns: safeNumber(counts?.noAccessTrns),

    meterInspectionTrns: safeNumber(counts?.meterInspectionTrns),
    meterInstallationTrns: safeNumber(counts?.meterInstallationTrns),
    meterRemovalTrns: safeNumber(counts?.meterRemovalTrns),
    meterDisconnectionTrns: safeNumber(counts?.meterDisconnectionTrns),
    meterReconnectionTrns: safeNumber(counts?.meterReconnectionTrns),
    otherTrns: safeNumber(counts?.otherTrns),

    reportType: data?.reportType || "NAv",

    updatedAt: data?.metadata?.updatedAt || data?.metadata?.createdAt || "NAv",
  };
}

function sortUserActivityRows(a, b) {
  if (b.totalTrns !== a.totalTrns) {
    return b.totalTrns - a.totalTrns;
  }

  return String(a.userName).localeCompare(String(b.userName), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export const reportUserActivityApi = createApi({
  reducerPath: "reportUserActivityApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getUserActivityRowsByLm: builder.query({
      queryFn: () => ({ data: [] }),

      async onCacheEntryAdded(
        lmPcode,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        if (!lmPcode) return;

        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          const reportRef = collection(db, USER_ACTIVITY_REPORT_COLLECTION);

          const reportQuery = query(
            reportRef,
            where(USER_ACTIVITY_REPORT_LM_FIELD, "==", lmPcode),
          );

          unsubscribe = onSnapshot(
            reportQuery,
            (snapshot) => {
              const rows = snapshot.docs
                .map((documentSnapshot) =>
                  normalizeUserActivityRow(
                    documentSnapshot.id,
                    documentSnapshot.data(),
                  ),
                )
                .sort(sortUserActivityRows);

              updateCachedData((draft) => {
                draft.splice(0, draft.length, ...rows);
              });
            },
            (error) => {
              console.error("reportUserActivityApi stream error:", error);
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

export const { useGetUserActivityRowsByLmQuery } = reportUserActivityApi;
