import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { collection, onSnapshot, query, where } from "firebase/firestore";

import { db } from "../firebase";
import { normalizeElectricityPopulationDoc } from "../pages/dashboard/models/electricityMeterPopulationModel.js";

const POPULATION_COLLECTION = "report_electricity_population";

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
                updateCachedData((draft) => {
                  draft.splice(0, draft.length);
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
              console.error("[reportElectricityPopulationApi] stream listener error:", error);
              updateCachedData((draft) => {
                draft.splice(0, draft.length);
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
