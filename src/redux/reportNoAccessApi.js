import { deriveNoAccessGroups, noAccessCaptureTime } from "../../functions/noAccess/groups.js";
import { formatStreetAddress, formatPropertyType } from "../../functions/premises/streetAddress.js";
import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { collection, onSnapshot, query, where } from "firebase/firestore";

import { db } from "../firebase";

const NO_ACCESS_REPORT_COLLECTION = "trns";
const NO_ACCESS_REPORT_LM_FIELD = "accessData.parents.lmPcode";

function normalizeNoAccessRow(id, data, group) {
  const captured = noAccessCaptureTime(data);
  return {
    id, lmPcode: data.accessData?.parents?.lmPcode || "NAv", wardPcode: data.accessData?.parents?.wardPcode || "NAv",
    activityDate: captured ? new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(captured)) : "Unknown date",
    reason: data.accessData?.access?.reason || "NAv", appointment: data.accessData?.access?.appointment?.at || null,
    erfId: data.accessData?.erfId || "NAv", erfNo: data.accessData?.erfNo || "NAv",
    premiseId: data.accessData?.premise?.id || "NAv", premiseAddress: formatStreetAddress(data.accessData?.premise?.address) || "NAv",
    premisePropertyType: formatPropertyType(data.accessData?.premise?.propertyType) || "NAv", trnType: data.accessData?.trnType || "NAv",
    userUid: data.metadata?.createdOnDeviceByUid || data.workflow?.completedByUid || data.metadata?.createdByUid,
    userName: data.metadata?.createdOnDeviceByUser || data.workflow?.completedByUser || data.metadata?.createdByUser || "NAv",
    updatedAt: data.metadata?.updatedAt || null,
    groupId: group?.id || null, groupStatus: group?.status || "UNKNOWN", closingProof: group?.closingProof || null,
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
              const transactions = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
              const { groups } = deriveNoAccessGroups(transactions);
              const groupByVisit = new Map(groups.flatMap((group) => group.visitIds.map((id) => [id, group])));
              const rows = transactions.filter((trn) => trn.accessData?.access?.hasAccess === "no")
                .map((trn) => normalizeNoAccessRow(trn.id, trn, groupByVisit.get(trn.id))).sort(sortNoAccessRows);

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
