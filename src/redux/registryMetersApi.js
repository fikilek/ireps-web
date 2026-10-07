import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { collection, onSnapshot, query, where } from "firebase/firestore";

import { db } from "../firebase";
import { normalizeMeterRegistryRow } from "./meterRegistryRowModel.js";

const METER_REGISTRY_COLLECTION = "registry_meters";
const METER_REGISTRY_WARD_FIELD = "parents.wardPcode";
const METER_REGISTRY_LM_FIELD = "parents.lmPcode";

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

  const kindCompare = String(a.meterKind).localeCompare(
    String(b.meterKind),
    undefined,
    {
      numeric: true,
      sensitivity: "base",
    },
  );

  if (kindCompare !== 0) return kindCompare;

  const phaseCompare = String(a.meterPhase).localeCompare(
    String(b.meterPhase),
    undefined,
    {
      numeric: true,
      sensitivity: "base",
    },
  );

  if (phaseCompare !== 0) return phaseCompare;

  return String(a.meterNo).localeCompare(String(b.meterNo), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function buildRegistryMeterRows(snapshot) {
  return snapshot.docs
    .map((documentSnapshot) =>
      normalizeMeterRegistryRow(
        documentSnapshot.id,
        documentSnapshot.data(),
      ),
    )
    .sort(sortMeterRows);
}

function readInitialRegistryMeterRows(registryMetersQuery, signal) {
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
          error: "Registry meter stream request was cancelled.",
        },
      });
    };

    if (signal?.aborted) {
      handleAbort();
      return;
    }

    signal?.addEventListener("abort", handleAbort, { once: true });

    const streamUnsubscribe = onSnapshot(
      registryMetersQuery,
      // Web Data Copy rules WD-R001.3: the server's confirmation of an unchanged
      // (even empty) saved copy arrives only as a metadata change.
      { includeMetadataChanges: true },
      (snapshot) => {
        const rows = buildRegistryMeterRows(snapshot);
        const fromCache = snapshot.metadata?.fromCache === true;

        // An empty local cache is not proof that the registry is empty.
        // Keep RTK Query in its initial loading state until Firestore
        // confirms the first snapshot from the server.
        // Web Data Copy rules WD-R001.3: the saved copy may hold only part of
        // the list, so the first answer shown is the server's.
        if (fromCache) return;

        finish({ data: rows });
      },
      (error) => {
        finish({
          error: {
            status: "CUSTOM_ERROR",
            error: error?.message || "Could not load the Meter Registry stream.",
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

export { normalizeMeterRegistryRow };

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
    getRegistryMetersByLm: builder.query({
      queryFn: (lmPcode, { signal }) => {
        if (!lmPcode) return { data: [] };

        const registryMetersQuery = query(
          collection(db, METER_REGISTRY_COLLECTION),
          where(METER_REGISTRY_LM_FIELD, "==", lmPcode),
        );

        return readInitialRegistryMeterRows(registryMetersQuery, signal);
      },

      async onCacheEntryAdded(
        lmPcode,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        if (!lmPcode) return;

        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          const registryMetersRef = collection(db, METER_REGISTRY_COLLECTION);

          const registryMetersQuery = query(
            registryMetersRef,
            where(METER_REGISTRY_LM_FIELD, "==", lmPcode),
          );

          unsubscribe = onSnapshot(
            registryMetersQuery,
            (snapshot) => {
              const rows = buildRegistryMeterRows(snapshot);

              updateCachedData((draft) => {
                draft.splice(0, draft.length, ...rows);
              });
            },
            (error) => {
              console.error("registryMetersApi LM stream error:", error);
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

export const {
  useGetRegistryMetersByWardQuery,
  useGetRegistryMetersByLmQuery,
} = registryMetersApi;
