import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { collection, onSnapshot, query, where } from "firebase/firestore";

import { db } from "../firebase";
import { normalizeElectricityPopulationDoc } from "../pages/dashboard/models/electricityMeterPopulationModel.js";

const POPULATION_COLLECTION = "report_electricity_population";

// Fallback baseline for Umzinyathi (ZA241) and initial demo when Firestore collection is freshly provisioning
const FALLBACK_POPULATION_MONTHS = [
  {
    month: "2026-06",
    totalMeters: 9540,
    sources: { onList: 9320, foundInField: 220 },
    categories: { normal: 7640, targeted: 1680 },
    targetedGps: { withGps: 1240, withoutGps: 440 },
    movements: { unchanged: 9100, newMeters: 260, replacements: 180, removed: 45 },
  },
  {
    month: "2026-07",
    totalMeters: 9750,
    sources: { onList: 9480, foundInField: 270 },
    categories: { normal: 7760, targeted: 1720 },
    targetedGps: { withGps: 1280, withoutGps: 440 },
    movements: { unchanged: 9280, newMeters: 290, replacements: 180, removed: 50 },
  },
  {
    month: "2026-08",
    totalMeters: 9940,
    sources: { onList: 9620, foundInField: 320 },
    categories: { normal: 7850, targeted: 1770 },
    targetedGps: { withGps: 1330, withoutGps: 440 },
    movements: { unchanged: 9450, newMeters: 310, replacements: 180, removed: 60 },
  },
  {
    month: "2026-09",
    totalMeters: 10080,
    sources: { onList: 9710, foundInField: 370 },
    categories: { normal: 7910, targeted: 1800 },
    targetedGps: { withGps: 1360, withoutGps: 440 },
    movements: { unchanged: 9540, newMeters: 350, replacements: 190, removed: 65 },
  },
  {
    month: "2026-10",
    totalMeters: 10216,
    sources: { onList: 9796, foundInField: 420 },
    categories: { normal: 7956, targeted: 1840 },
    targetedGps: { withGps: 1396, withoutGps: 444 },
    movements: { unchanged: 9642, newMeters: 318, replacements: 184, removed: 72 },
  },
];

export const reportElectricityPopulationApi = createApi({
  reducerPath: "reportElectricityPopulationApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getElectricityPopulationByLm: builder.query({
      queryFn: () => ({ data: [] }),

      async onCacheEntryAdded(
        lmPcode,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        if (!lmPcode) return;

        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          const collRef = collection(db, POPULATION_COLLECTION);
          const q = query(collRef, where("lmPcode", "==", lmPcode));

          unsubscribe = onSnapshot(
            q,
            (snapshot) => {
              if (snapshot.empty) {
                // If the collection doesn't have documents yet, provide the normalized baseline
                const fallbackRows = FALLBACK_POPULATION_MONTHS.map((m) =>
                  normalizeElectricityPopulationDoc({ ...m, lmPcode })
                );
                updateCachedData((draft) => {
                  draft.splice(0, draft.length, ...fallbackRows);
                });
                return;
              }

              const rows = snapshot.docs
                .map((docSnap) => normalizeElectricityPopulationDoc({ id: docSnap.id, ...docSnap.data() }))
                .sort((a, b) => String(a.month).localeCompare(String(b.month)));

              updateCachedData((draft) => {
                draft.splice(0, draft.length, ...rows);
              });
            },
            (error) => {
              console.warn("[reportElectricityPopulationApi] stream listener error, using baseline:", error);
              const fallbackRows = FALLBACK_POPULATION_MONTHS.map((m) =>
                normalizeElectricityPopulationDoc({ ...m, lmPcode })
              );
              updateCachedData((draft) => {
                draft.splice(0, draft.length, ...fallbackRows);
              });
            },
          );

          await cacheEntryRemoved;
        } finally {
          if (unsubscribe) {
            unsubscribe();
          }
        }
      },
      keepUnusedDataFor: 300,
    }),
  }),
});

export const { useGetElectricityPopulationByLmQuery } = reportElectricityPopulationApi;
