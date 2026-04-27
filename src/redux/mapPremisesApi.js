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

  const premiseId = data?.id || id;

  return {
    // Preserve backend shape first.
    ...data,

    // Stable identity fields for UI convenience.
    id: premiseId,
    premiseId,

    // Convenience flat fields.
    // These do NOT replace the backend nested fields because they use new names.
    lmPcode: data?.parents?.lmPcode || "NAv",
    wardPcode: data?.parents?.wardPcode || "NAv",

    premiseAddress: buildPremiseAddress(data?.address),
    propertyTypeLabel: data?.propertyType?.type || "NAv",
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
  const erfCompare = String(a.erfNo || "").localeCompare(
    String(b.erfNo || ""),
    undefined,
    {
      numeric: true,
      sensitivity: "base",
    },
  );

  if (erfCompare !== 0) return erfCompare;

  return String(a.premiseAddress || "").localeCompare(
    String(b.premiseAddress || ""),
    undefined,
    {
      numeric: true,
      sensitivity: "base",
    },
  );
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
