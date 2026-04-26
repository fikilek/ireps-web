import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { collection, onSnapshot, query, where } from "firebase/firestore";

import { db } from "../firebase";

const WARD_REGISTRY_COLLECTION = "registry_wards";
const WARD_REGISTRY_LM_FIELD = "localMunicipality.pcode";

function safeNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function normalizeWardRegistryRow(id, data) {
  const counts = data?.counts || {};

  return {
    id,

    lmPcode: data?.localMunicipality?.pcode || "NAv",
    lmName: data?.localMunicipality?.name || "NAv",

    districtPcode: data?.district?.pcode || "NAv",
    districtName: data?.district?.name || "NAv",

    provincePcode: data?.province?.pcode || "NAv",
    provinceName: data?.province?.name || "NAv",

    wardPcode: data?.ward?.pcode || id,
    wardNumber: data?.ward?.number ?? "NAv",
    wardName: data?.ward?.name || "NAv",

    isOperationallyActive: data?.status?.isOperationallyActive === true,

    formalErfCount: safeNumber(counts?.formalErfs),
    informalErfCount: safeNumber(counts?.informalErfs),
    totalErfCount: safeNumber(counts?.totalErfs),

    premiseCount: safeNumber(counts?.premises),

    electricityMeterCount: safeNumber(counts?.electricityMeters),
    waterMeterCount: safeNumber(counts?.waterMeters),
    meterCount: safeNumber(counts?.totalMeters),

    trnCount: safeNumber(counts?.trns),

    updatedAt: data?.metadata?.updatedAt || data?.metadata?.createdAt || "NAv",
  };
}

function sortWardRows(a, b) {
  const aNumber = Number(a.wardNumber);
  const bNumber = Number(b.wardNumber);

  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) {
    return aNumber - bNumber;
  }

  return String(a.wardName).localeCompare(String(b.wardName));
}

export const registryWardsApi = createApi({
  reducerPath: "registryWardsApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getRegistryWardsByLm: builder.query({
      queryFn: () => ({ data: [] }),

      async onCacheEntryAdded(
        lmPcode,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        if (!lmPcode) return;

        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          const registryWardsRef = collection(db, WARD_REGISTRY_COLLECTION);

          const registryWardsQuery = query(
            registryWardsRef,
            where(WARD_REGISTRY_LM_FIELD, "==", lmPcode),
          );

          unsubscribe = onSnapshot(
            registryWardsQuery,
            (snapshot) => {
              const rows = snapshot.docs
                .map((documentSnapshot) =>
                  normalizeWardRegistryRow(
                    documentSnapshot.id,
                    documentSnapshot.data(),
                  ),
                )
                .sort(sortWardRows);

              updateCachedData((draft) => {
                draft.splice(0, draft.length, ...rows);
              });
            },
            (error) => {
              console.error("registryWardsApi stream error:", error);
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

export const { useGetRegistryWardsByLmQuery } = registryWardsApi;
