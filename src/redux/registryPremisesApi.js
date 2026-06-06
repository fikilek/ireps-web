import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { collection, onSnapshot, query, where } from "firebase/firestore";

import { db } from "../firebase";

const PREMISE_REGISTRY_COLLECTION = "registry_premises";
const PREMISE_REGISTRY_WARD_FIELD = "parents.wardPcode";

function safeNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function serializeRegistryDateValue(value) {
  if (!value || value === "NAv") return "NAv";

  if (typeof value === "string") return value;

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? "NAv" : date.toISOString();
  }

  if (typeof value?.toMillis === "function") {
    const date = new Date(value.toMillis());
    return Number.isNaN(date.getTime()) ? "NAv" : date.toISOString();
  }

  if (typeof value?.seconds === "number") {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? "NAv" : date.toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "NAv" : date.toISOString();
}

function buildAddress(address) {
  const strNo = address?.strNo || "";
  const strName = address?.strName || "";
  const strType = address?.strType || "";

  const addressText = [strNo, strName, strType]
    .filter((part) => part && part !== "NAv")
    .join(" ");

  return addressText || "NAv";
}

function normalizePremiseRegistryRow(id, data) {
  const counts = data?.counts || {};
  const propertyType = data?.propertyType || {};

  return {
    id,

    premiseId: data?.premiseId || id,

    erfId: data?.erfId || "NAv",
    erfNo: data?.erfNo || "NAv",

    lmPcode: data?.parents?.lmPcode || "NAv",
    wardPcode: data?.parents?.wardPcode || "NAv",

    addressText: buildAddress(data?.address),
    strNo: data?.address?.strNo || "NAv",
    strName: data?.address?.strName || "NAv",
    strType: data?.address?.strType || "NAv",

    propertyTypeName: propertyType?.name || "NAv",
    propertyTypeType: propertyType?.type || "NAv",
    unitNo: propertyType?.unitNo || "NAv",

    occupancyStatus: data?.occupancy?.status || "NAv",

    electricityMeterCount: safeNumber(counts?.electricityMeters),
    waterMeterCount: safeNumber(counts?.waterMeters),
    meterCount: safeNumber(counts?.totalMeters),

    createdByUser: data?.metadata?.createdByUser || "NAv",
    updatedByUser: data?.metadata?.updatedByUser || data?.metadata?.createdByUser || "NAv",
    updatedAt: serializeRegistryDateValue(data?.metadata?.updatedAt || data?.metadata?.createdAt),
  };
}

function sortPremiseRows(a, b) {
  const erfCompare = String(a.erfNo).localeCompare(String(b.erfNo), undefined, {
    numeric: true,
    sensitivity: "base",
  });

  if (erfCompare !== 0) return erfCompare;

  return String(a.addressText).localeCompare(String(b.addressText), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export const registryPremisesApi = createApi({
  reducerPath: "registryPremisesApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getRegistryPremisesByWard: builder.query({
      queryFn: () => ({ data: [] }),

      async onCacheEntryAdded(
        wardPcode,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        if (!wardPcode) return;

        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          const registryPremisesRef = collection(
            db,
            PREMISE_REGISTRY_COLLECTION,
          );

          const registryPremisesQuery = query(
            registryPremisesRef,
            where(PREMISE_REGISTRY_WARD_FIELD, "==", wardPcode),
          );

          unsubscribe = onSnapshot(
            registryPremisesQuery,
            (snapshot) => {
              const rows = snapshot.docs
                .map((documentSnapshot) =>
                  normalizePremiseRegistryRow(
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
              console.error("registryPremisesApi stream error:", error);
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

export const { useGetRegistryPremisesByWardQuery } = registryPremisesApi;
