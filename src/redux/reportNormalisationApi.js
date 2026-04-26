import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { collection, onSnapshot, query, where } from "firebase/firestore";

import { db } from "../firebase";

const NORMALISATION_REPORT_COLLECTION = "report_trn_normalisation";
const NORMALISATION_REPORT_LM_FIELD = "parents.lmPcode";

function safeNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function normalizeActionName(action) {
  if (!action || action === "NAv") return "NAv";

  if (String(action).toLowerCase() === "none") {
    return "None";
  }

  return action;
}

function normalizeActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return ["NAv"];
  }

  return actions.map(normalizeActionName);
}

function normalizeNormalisationRow(id, data) {
  const normalisation = data?.normalisation || {};
  const counts = data?.counts || {};

  const actions = normalizeActions(normalisation?.actions);

  return {
    id: data?.id || id,

    lmPcode: data?.parents?.lmPcode || "NAv",

    activityDate: data?.activityDate || "NAv",

    actionCount: safeNumber(normalisation?.actionCount),
    actions,
    actionsText: actions.join(", "),
    combinationKey: normalisation?.combinationKey || "NAv",

    trnCount: safeNumber(counts?.trns),

    reportType: data?.reportType || "NAv",

    updatedAt: data?.metadata?.updatedAt || data?.metadata?.createdAt || "NAv",
  };
}

function sortNormalisationRows(a, b) {
  const dateCompare = String(b.activityDate).localeCompare(
    String(a.activityDate),
  );

  if (dateCompare !== 0) return dateCompare;

  const countCompare = b.trnCount - a.trnCount;

  if (countCompare !== 0) return countCompare;

  return String(a.actionsText).localeCompare(String(b.actionsText), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export const reportNormalisationApi = createApi({
  reducerPath: "reportNormalisationApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getNormalisationRowsByLm: builder.query({
      queryFn: () => ({ data: [] }),

      async onCacheEntryAdded(
        lmPcode,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        if (!lmPcode) return;

        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          const reportRef = collection(db, NORMALISATION_REPORT_COLLECTION);

          const reportQuery = query(
            reportRef,
            where(NORMALISATION_REPORT_LM_FIELD, "==", lmPcode),
          );

          unsubscribe = onSnapshot(
            reportQuery,
            (snapshot) => {
              const rows = snapshot.docs
                .map((documentSnapshot) =>
                  normalizeNormalisationRow(
                    documentSnapshot.id,
                    documentSnapshot.data(),
                  ),
                )
                .sort(sortNormalisationRows);

              updateCachedData((draft) => {
                draft.splice(0, draft.length, ...rows);
              });
            },
            (error) => {
              console.error("reportNormalisationApi stream error:", error);
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

export const { useGetNormalisationRowsByLmQuery } = reportNormalisationApi;
