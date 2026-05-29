// src/redux/geofencesApi.js

import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import {
  collection,
  getFirestore,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

function byName(left, right) {
  return String(left?.name || "").localeCompare(String(right?.name || ""));
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeGeoFenceRefs(value) {
  if (Array.isArray(value?.geofenceRefs)) return value.geofenceRefs;
  if (Array.isArray(value?.ast?.geofenceRefs)) return value.ast.geofenceRefs;

  return [];
}

function hasGeoFenceRef(value, geoFenceId) {
  const refs = normalizeGeoFenceRefs(value);
  return refs.some((ref) => ref?.id === geoFenceId);
}

function hasNoGeoFence(value) {
  return normalizeGeoFenceRefs(value).length === 0;
}

function getCoordinatePoint(value) {
  const lat = Number(value?.lat ?? value?.latitude);
  const lng = Number(value?.lng ?? value?.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    lat,
    lng,
    latitude: lat,
    longitude: lng,
  };
}

/* =====================================================
   AST / METER HELPERS
   ===================================================== */

function getAstId(ast) {
  return (
    ast?.id ||
    ast?.astId ||
    ast?.ast?.astData?.astId ||
    ast?.astData?.astId ||
    ast?.trnId ||
    ""
  );
}

function getAstMeterNo(ast) {
  return (
    ast?.ast?.astData?.astNo ||
    ast?.ast?.astData?.meterNo ||
    ast?.astData?.astNo ||
    ast?.meterNo ||
    ast?.id ||
    "NAv"
  );
}

function getAstPoint(ast) {
  return (
    getCoordinatePoint(ast?.ast?.location?.gps) ||
    getCoordinatePoint(ast?.location?.gps) ||
    getCoordinatePoint(ast?.gps) ||
    null
  );
}

function isAstRemoved(ast) {
  const state = String(ast?.status?.state || ast?.status || "").toUpperCase();
  return state === "REMOVED";
}

function decorateAstDoc(doc) {
  const data = doc.data() || {};

  return {
    id: doc.id,
    ...data,
    __source: "AST",
    __astId: getAstId({ id: doc.id, ...data }) || doc.id,
    __meterNo: getAstMeterNo({ id: doc.id, ...data }),
    __point: getAstPoint(data),
    __geofenceRefs: normalizeGeoFenceRefs(data),
    __hasNoGeofence: hasNoGeoFence(data),
  };
}

/* =====================================================
   TC ROW HELPERS
   ===================================================== */

function getRowLmPcode(row) {
  return (
    row?.ast?.parents?.lmPcode ||
    row?.ast?.accessData?.parents?.lmPcode ||
    row?.ast?.lmPcode ||
    row?.upload?.lmPcode ||
    row?.parents?.lmPcode ||
    ""
  );
}

function getRowWardPcode(row) {
  return (
    row?.ast?.parents?.wardPcode ||
    row?.ast?.accessData?.parents?.wardPcode ||
    row?.ast?.wardPcode ||
    row?.upload?.wardPcode ||
    row?.parents?.wardPcode ||
    ""
  );
}

function getRowAstId(row) {
  return (
    row?.astId ||
    row?.ast?.id ||
    row?.ast?.astId ||
    row?.backend?.astId ||
    row?.backend?.matchedAstId ||
    ""
  );
}

function getRowMeterNo(row) {
  return (
    row?.ast?.meterNo ||
    row?.ast?.astNo ||
    row?.ast?.astData?.astNo ||
    row?.ast?.ast?.astData?.astNo ||
    row?.backend?.meterNo ||
    row?.frontend?.meterNo ||
    row?.meterNo ||
    "NAv"
  );
}

function getRowGps(row) {
  return (
    getCoordinatePoint(row?.ast?.gps) ||
    getCoordinatePoint(row?.ast?.location?.gps) ||
    getCoordinatePoint(row?.ast?.ast?.location?.gps) ||
    getCoordinatePoint(row?.ast?.astData?.location?.gps) ||
    getCoordinatePoint(row?.backend?.gps) ||
    null
  );
}

function getRowGeoFenceRefs(row) {
  if (Array.isArray(row?.geofenceRefs)) return row.geofenceRefs;
  if (Array.isArray(row?.ast?.geofenceRefs)) return row.ast.geofenceRefs;

  return [];
}

function decorateTcRow(doc) {
  const row = doc.data() || {};
  const geofenceRefs = getRowGeoFenceRefs(row);

  return {
    id: doc.id,
    ...row,
    __source: "TC_ROW",
    __astId: getRowAstId(row),
    __meterNo: getRowMeterNo(row),
    __gps: getRowGps(row),
    __lmPcode: getRowLmPcode(row),
    __wardPcode: getRowWardPcode(row),
    __geofenceRefs: geofenceRefs,
    __hasNoGeofence: geofenceRefs.length === 0,
  };
}

function sortTcMeters(left, right) {
  return String(left?.__meterNo || "").localeCompare(
    String(right?.__meterNo || ""),
  );
}

/* =====================================================
   PREMISE HELPERS
   ===================================================== */

function getPremiseId(premise) {
  return premise?.premiseId || premise?.id || "";
}

function getPremisePoint(premise) {
  return getCoordinatePoint(premise?.geometry?.centroid) || null;
}

function decoratePremiseDoc(doc) {
  const data = doc.data() || {};

  return {
    id: doc.id,
    ...data,
    __source: "PREMISE",
    __premiseId: getPremiseId({ id: doc.id, ...data }) || doc.id,
    __point: getPremisePoint(data),
    __geofenceRefs: normalizeGeoFenceRefs(data),
  };
}

/* =====================================================
   ERF HELPERS
   ===================================================== */

function getErfId(erf) {
  return erf?.erfId || erf?.id || "";
}

function getErfNo(erf) {
  return (
    erf?.erfNo ||
    erf?.erf?.erfNo ||
    erf?.erf?.number ||
    erf?.sg?.erfNo ||
    erf?.sg?.parcelNo ||
    erf?.sg?.parcelNumber ||
    erf?.admin?.erfNo ||
    erf?.admin?.parcelNo ||
    "NAv"
  );
}

function getErfPoint(erf) {
  return getCoordinatePoint(erf?.centroid) || null;
}

function decorateErfDoc(doc) {
  const data = doc.data() || {};

  return {
    id: doc.id,
    ...data,
    __source: "ERF",
    __erfId: getErfId({ id: doc.id, ...data }) || doc.id,
    __erfNo: getErfNo(data),
    __point: getErfPoint(data),
    __geofenceRefs: normalizeGeoFenceRefs(data),
  };
}

export const geofencesApi = createApi({
  reducerPath: "geofencesApi",
  baseQuery: fakeBaseQuery(),
  tagTypes: ["GeoFences", "NoGeoFenceMeters", "GeoFenceMembers", "TcMeters"],

  endpoints: (builder) => ({
    getGeoFencesByWard: builder.query({
      queryFn: () => ({ data: [] }),

      async onCacheEntryAdded(
        { lmPcode, wardPcode },
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        if (!lmPcode || !wardPcode) return;

        const db = getFirestore();

        const q = query(
          collection(db, "geo_fences"),
          where("parents.lmPcode", "==", lmPcode),
          where("parents.wardPcode", "==", wardPcode),
          where("status", "==", "ACTIVE"),
        );

        let unsubscribe = () => {};

        try {
          await cacheDataLoaded;

          unsubscribe = onSnapshot(q, (snapshot) => {
            const rows = snapshot.docs
              .map((doc) => ({
                id: doc.id,
                ...doc.data(),
              }))
              .sort(byName);

            updateCachedData(() => rows);
          });
        } catch (error) {
          console.log("getGeoFencesByWard stream error", error);
        }

        await cacheEntryRemoved;
        unsubscribe();
      },
    }),

    getNoGeofenceMetersByWard: builder.query({
      queryFn: () => ({ data: [] }),

      async onCacheEntryAdded(
        { lmPcode, wardPcode },
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        if (!lmPcode || !wardPcode) return;

        const db = getFirestore();

        const q = query(
          collection(db, "asts"),
          where("accessData.parents.lmPcode", "==", lmPcode),
          where("accessData.parents.wardPcode", "==", wardPcode),
        );

        let unsubscribe = () => {};

        try {
          await cacheDataLoaded;

          unsubscribe = onSnapshot(q, (snapshot) => {
            const rows = snapshot.docs
              .map(decorateAstDoc)
              .filter((row) => !isAstRemoved(row))
              .filter((row) => row.__hasNoGeofence)
              .filter((row) => Boolean(row.__point))
              .sort((left, right) =>
                String(left.__meterNo).localeCompare(String(right.__meterNo)),
              );

            updateCachedData(() => rows);
          });
        } catch (error) {
          console.log("getNoGeofenceMetersByWard stream error", error);
        }

        await cacheEntryRemoved;
        unsubscribe();
      },
    }),

    getGeofenceMemberMetersByWard: builder.query({
      queryFn: () => ({ data: [] }),

      async onCacheEntryAdded(
        { lmPcode, wardPcode, geoFenceId },
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        if (!lmPcode || !wardPcode || !geoFenceId) return;

        const db = getFirestore();

        const q = query(
          collection(db, "asts"),
          where("accessData.parents.lmPcode", "==", lmPcode),
          where("accessData.parents.wardPcode", "==", wardPcode),
        );

        let unsubscribe = () => {};

        try {
          await cacheDataLoaded;

          unsubscribe = onSnapshot(q, (snapshot) => {
            const rows = snapshot.docs
              .map(decorateAstDoc)
              .filter((row) => !isAstRemoved(row))
              .filter((row) => hasGeoFenceRef(row, geoFenceId))
              .filter((row) => Boolean(row.__point))
              .sort((left, right) =>
                String(left.__meterNo).localeCompare(String(right.__meterNo)),
              );

            updateCachedData(() => rows);
          });
        } catch (error) {
          console.log("getGeofenceMemberMetersByWard stream error", error);
        }

        await cacheEntryRemoved;
        unsubscribe();
      },
    }),

    getGeofenceMemberPremisesByWard: builder.query({
      queryFn: () => ({ data: [] }),

      async onCacheEntryAdded(
        { lmPcode, wardPcode, geoFenceId },
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        if (!lmPcode || !wardPcode || !geoFenceId) return;

        const db = getFirestore();

        const q = query(
          collection(db, "premises"),
          where("parents.lmPcode", "==", lmPcode),
          where("parents.wardPcode", "==", wardPcode),
        );

        let unsubscribe = () => {};

        try {
          await cacheDataLoaded;

          unsubscribe = onSnapshot(q, (snapshot) => {
            const rows = snapshot.docs
              .map(decoratePremiseDoc)
              .filter((row) => hasGeoFenceRef(row, geoFenceId))
              .filter((row) => Boolean(row.__point))
              .sort((left, right) =>
                String(left.__premiseId).localeCompare(
                  String(right.__premiseId),
                ),
              );

            updateCachedData(() => rows);
          });
        } catch (error) {
          console.log("getGeofenceMemberPremisesByWard stream error", error);
        }

        await cacheEntryRemoved;
        unsubscribe();
      },
    }),

    getGeofenceMemberErfsByWard: builder.query({
      queryFn: () => ({ data: [] }),

      async onCacheEntryAdded(
        { lmPcode, wardPcode, geoFenceId },
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        if (!lmPcode || !wardPcode || !geoFenceId) return;

        const db = getFirestore();

        const q = query(
          collection(db, "ireps_erfs"),
          where("admin.localMunicipality.pcode", "==", lmPcode),
          where("admin.ward.pcode", "==", wardPcode),
        );

        let unsubscribe = () => {};

        try {
          await cacheDataLoaded;

          unsubscribe = onSnapshot(q, (snapshot) => {
            const rows = snapshot.docs
              .map(decorateErfDoc)
              .filter((row) => hasGeoFenceRef(row, geoFenceId))
              .sort((left, right) =>
                String(left.__erfNo).localeCompare(String(right.__erfNo)),
              );

            updateCachedData(() => rows);
          });
        } catch (error) {
          console.log("getGeofenceMemberErfsByWard stream error", error);
        }

        await cacheEntryRemoved;
        unsubscribe();
      },
    }),

    getTcMetersForGeofence: builder.query({
      queryFn: () => ({ data: [] }),

      async onCacheEntryAdded(
        { tcId, lmPcode, wardPcode },
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        if (!tcId || !lmPcode || !wardPcode) return;

        const db = getFirestore();
        const normalizedTcId = normalizeText(tcId);

        const queryState = new Map();

        function publishRows() {
          const byId = new Map();

          queryState.forEach((rows) => {
            rows.forEach((row) => {
              byId.set(row.id, row);
            });
          });

          const rows = Array.from(byId.values())
            .filter((row) => {
              return row.__lmPcode === lmPcode && row.__wardPcode === wardPcode;
            })
            .sort(sortTcMeters);

          updateCachedData(() => rows);
        }

        const unsubscribeFns = [];

        try {
          await cacheDataLoaded;

          const queries = [
            {
              key: "rootTcId",
              q: query(
                collection(db, "tc_rows"),
                where("tcId", "==", normalizedTcId),
              ),
            },
            {
              key: "uploadTcId",
              q: query(
                collection(db, "tc_rows"),
                where("upload.tcId", "==", normalizedTcId),
              ),
            },
          ];

          queries.forEach(({ key, q }) => {
            const unsubscribe = onSnapshot(
              q,
              (snapshot) => {
                const rows = snapshot.docs.map(decorateTcRow);
                queryState.set(key, rows);
                publishRows();
              },
              (error) => {
                console.log("getTcMetersForGeofence stream error", {
                  key,
                  message: error?.message || String(error),
                });
              },
            );

            unsubscribeFns.push(unsubscribe);
          });
        } catch (error) {
          console.log("getTcMetersForGeofence setup error", error);
        }

        await cacheEntryRemoved;

        unsubscribeFns.forEach((unsubscribe) => unsubscribe());
      },
    }),

    createGeoFence: builder.mutation({
      async queryFn(payload) {
        try {
          const functions = getFunctions();
          const callable = httpsCallable(functions, "createGeoFence");
          const result = await callable(payload);

          return {
            data: result.data,
          };
        } catch (error) {
          return {
            error: {
              message: error?.message || "Failed to create geofence.",
              code: error?.code || "UNKNOWN",
            },
          };
        }
      },
    }),
  }),
});

export const {
  useGetGeoFencesByWardQuery,
  useGetNoGeofenceMetersByWardQuery,
  useGetGeofenceMemberMetersByWardQuery,
  useGetGeofenceMemberPremisesByWardQuery,
  useGetGeofenceMemberErfsByWardQuery,
  useGetTcMetersForGeofenceQuery,
  useCreateGeoFenceMutation,
} = geofencesApi;
