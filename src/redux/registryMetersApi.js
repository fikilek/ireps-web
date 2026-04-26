import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { collection, onSnapshot, query, where } from "firebase/firestore";

import { db } from "../firebase";

const METER_REGISTRY_COLLECTION = "registry_meters";
const METER_REGISTRY_WARD_FIELD = "parents.wardPcode";

function normalizeMeterRegistryRow(id, data) {
  return {
    id,

    meterId: data?.meterId || data?.id || id,
    meterNo: data?.meterNo || "NAv",
    meterType: data?.meterType || "NAv",
    visibility: data?.visibility || "NAv",

    erfId: data?.erfId || "NAv",
    erfNo: data?.erfNo || "NAv",

    premiseId: data?.premiseId || "NAv",
    premiseAddress: data?.premiseAddress || "NAv",
    premisePropertyType: data?.premisePropertyType || "NAv",

    lmPcode: data?.parents?.lmPcode || "NAv",
    wardPcode: data?.parents?.wardPcode || "NAv",

    createdByUser: data?.metadata?.createdByUser || "NAv",
    updatedAt: data?.metadata?.updatedAt || data?.metadata?.createdAt || "NAv",
  };
}

function sortMeterRows(a, b) {
  const typeCompare = String(a.meterType).localeCompare(
    String(b.meterType),
    undefined,
    {
      numeric: true,
      sensitivity: "base",
    },
  );

  if (typeCompare !== 0) return typeCompare;

  return String(a.meterNo).localeCompare(String(b.meterNo), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export const registryMetersApi = createApi({
  reducerPath: "registryMetersApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getRegistryMetersByWard: builder.query({
      queryFn: () => ({ data: [] }),

      async onCacheEntryAdded(
        wardPcode,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        if (!wardPcode) return;

        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          const registryMetersRef = collection(db, METER_REGISTRY_COLLECTION);

          const registryMetersQuery = query(
            registryMetersRef,
            where(METER_REGISTRY_WARD_FIELD, "==", wardPcode),
          );

          unsubscribe = onSnapshot(
            registryMetersQuery,
            (snapshot) => {
              const rows = snapshot.docs
                .map((documentSnapshot) =>
                  normalizeMeterRegistryRow(
                    documentSnapshot.id,
                    documentSnapshot.data(),
                  ),
                )
                .sort(sortMeterRows);

              updateCachedData((draft) => {
                draft.splice(0, draft.length, ...rows);
              });
            },
            (error) => {
              console.error("registryMetersApi stream error:", error);
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

export const { useGetRegistryMetersByWardQuery } = registryMetersApi;
