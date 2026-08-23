import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { collection, onSnapshot, query, where } from "firebase/firestore";

import { db } from "../firebase";

const WARD_REGISTRY_COLLECTION = "registry_wards";
const WARD_REGISTRY_LM_FIELD = "localMunicipality.pcode";

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

    updatedByUser: data?.metadata?.updatedByUser || data?.metadata?.createdByUser || "NAv",
    updatedAt: serializeRegistryDateValue(data?.metadata?.updatedAt || data?.metadata?.createdAt),
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

function buildRegistryWardRows(snapshot) {
  return snapshot.docs
    .map((documentSnapshot) =>
      normalizeWardRegistryRow(
        documentSnapshot.id,
        documentSnapshot.data(),
      ),
    )
    .sort(sortWardRows);
}

function readInitialRegistryWardRows(registryWardsQuery, signal) {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = () => {};

    const finish = (result) => {
      if (settled) return;

      settled = true;
      signal?.removeEventListener("abort", handleAbort);
      unsubscribe();
      resolve(result);
    };

    const handleAbort = () => {
      finish({
        error: {
          status: "CUSTOM_ERROR",
          error: "Registry ward stream request was cancelled.",
        },
      });
    };

    if (signal?.aborted) {
      handleAbort();
      return;
    }

    signal?.addEventListener("abort", handleAbort, { once: true });

    const streamUnsubscribe = onSnapshot(
      registryWardsQuery,
      (snapshot) => {
        const rows = buildRegistryWardRows(snapshot);
        const fromCache = snapshot.metadata?.fromCache === true;

        if (fromCache && rows.length === 0) return;

        finish({ data: rows });
      },
      (error) => {
        finish({
          error: {
            status: "CUSTOM_ERROR",
            error: error?.message || "Could not load the Ward Registry stream.",
          },
        });
      },
    );

    unsubscribe = streamUnsubscribe;

    if (settled) {
      unsubscribe();
    }
  });
}

export const registryWardsApi = createApi({
  reducerPath: "registryWardsApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getRegistryWardsByLm: builder.query({
      queryFn: (lmPcode, { signal }) => {
        if (!lmPcode) return { data: [] };

        const registryWardsQuery = query(
          collection(db, WARD_REGISTRY_COLLECTION),
          where(WARD_REGISTRY_LM_FIELD, "==", lmPcode),
        );

        return readInitialRegistryWardRows(registryWardsQuery, signal);
      },

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
              const rows = buildRegistryWardRows(snapshot);

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
