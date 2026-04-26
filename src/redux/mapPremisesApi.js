import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { collection, onSnapshot, query, where } from "firebase/firestore";

import { db } from "../firebase";

const PREMISES_COLLECTION = "premises";
const PREMISES_WARD_FIELD = "parents.wardPcode";

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildPremiseAddress(address) {
  const parts = [address?.strNo, address?.strName, address?.strType].filter(
    Boolean,
  );

  return parts.length ? parts.join(" ") : "NAv";
}

function normalizePremiseRow(id, data) {
  const centroid = data?.geometry?.centroid || null;
  const electricityMeters = safeArray(data?.services?.electricityMeters);
  const waterMeters = safeArray(data?.services?.waterMeters);

  return {
    id: data?.id || id,
    premiseId: data?.id || id,

    lmPcode: data?.parents?.lmPcode || "NAv",
    wardPcode: data?.parents?.wardPcode || "NAv",

    erfId: data?.erfId || "NAv",
    erfNo: data?.erfNo || "NAv",

    address: buildPremiseAddress(data?.address),
    propertyType: data?.propertyType?.type || "NAv",
    propertyName: data?.propertyType?.name || "",
    unitNo: data?.propertyType?.unitNo || "",

    occupancyStatus: data?.occupancy?.status || "NAv",

    lat: centroid?.lat || null,
    lng: centroid?.lng || null,

    electricityMeterCount: electricityMeters.length,
    waterMeterCount: waterMeters.length,
    totalMeterCount: electricityMeters.length + waterMeters.length,

    updatedAt:
      data?.metadata?.updatedAt ||
      data?.metadata?.updated?.at ||
      data?.metadata?.createdAt ||
      data?.metadata?.created?.at ||
      "NAv",
  };
}

function sortPremiseRows(a, b) {
  const erfCompare = String(a.erfNo).localeCompare(String(b.erfNo), undefined, {
    numeric: true,
    sensitivity: "base",
  });

  if (erfCompare !== 0) return erfCompare;

  return String(a.address).localeCompare(String(b.address), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export const mapPremisesApi = createApi({
  reducerPath: "mapPremisesApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getPremisesByWard: builder.query({
      queryFn: () => ({ data: [] }),

      async onCacheEntryAdded(
        wardPcode,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        if (!wardPcode) return;

        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          const premisesRef = collection(db, PREMISES_COLLECTION);

          const premisesQuery = query(
            premisesRef,
            where(PREMISES_WARD_FIELD, "==", wardPcode),
          );

          unsubscribe = onSnapshot(
            premisesQuery,
            (snapshot) => {
              const rows = snapshot.docs
                .map((documentSnapshot) =>
                  normalizePremiseRow(
                    documentSnapshot.id,
                    documentSnapshot.data(),
                  ),
                )
                .filter(
                  (row) => Number.isFinite(row.lat) && Number.isFinite(row.lng),
                )
                .sort(sortPremiseRows);

              updateCachedData((draft) => {
                draft.splice(0, draft.length, ...rows);
              });
            },
            (error) => {
              console.error("mapPremisesApi stream error:", error);
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

export const { useGetPremisesByWardQuery } = mapPremisesApi;
