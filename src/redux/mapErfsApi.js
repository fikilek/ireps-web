import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { db } from "../firebase";

const ERFS_COLLECTION = "ireps_erfs";
const ERF_WARD_FIELD = "admin.ward.pcode";
const ERF_CENTROID_LAT_FIELD = "centroid.lat";

const DEFAULT_MAX_ROWS = 800;

function safeNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function buildErfNo(sg) {
  const parcelNo = sg?.parcelNo;
  const portion = Number(sg?.portion || 0);

  if (!parcelNo && parcelNo !== 0) return "NAv";

  if (portion > 0) {
    return `${parcelNo}/${portion}`;
  }

  return `${parcelNo}`;
}

function normalizeErfViewportRow(id, data) {
  return {
    id,
    erfId: data?.erfId || id,
    erfNo: buildErfNo(data?.sg),

    wardPcode: data?.admin?.ward?.pcode || "NAv",
    lmPcode: data?.admin?.localMunicipality?.pcode || "NAv",

    type: data?.erf?.type || "NAv",
    status: data?.erf?.status || "NAv",

    bbox: data?.bbox || null,
    centroid: data?.centroid || null,
    geometry: data?.geometry || null,

    premiseIds: Array.isArray(data?.premises) ? data.premises : [],

    updatedAt: data?.metadata?.updatedAt || data?.metadata?.createdAt || "NAv",
  };
}

function isInsideViewport(row, bounds) {
  const lat = safeNumber(row?.centroid?.lat);
  const lng = safeNumber(row?.centroid?.lng);

  if (lat === null || lng === null) return false;

  return (
    lat >= bounds.south &&
    lat <= bounds.north &&
    lng >= bounds.west &&
    lng <= bounds.east
  );
}

function sortErfs(a, b) {
  return String(a.erfNo).localeCompare(String(b.erfNo), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export const mapErfsApi = createApi({
  reducerPath: "mapErfsApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getVisibleErfsByWardViewport: builder.query({
      async queryFn({ wardPcode, bounds, maxRows = DEFAULT_MAX_ROWS }) {
        try {
          if (!wardPcode || !bounds) {
            return {
              data: {
                rows: [],
                wasLimited: false,
              },
            };
          }

          const erfsRef = collection(db, ERFS_COLLECTION);

          /*
            Firestore can efficiently filter by selected ward and latitude.
            We then filter longitude client-side.

            If Firestore asks for a composite index, click the console index link.
          */
          const erfsQuery = query(
            erfsRef,
            where(ERF_WARD_FIELD, "==", wardPcode),
            where(ERF_CENTROID_LAT_FIELD, ">=", bounds.south),
            where(ERF_CENTROID_LAT_FIELD, "<=", bounds.north),
            orderBy(ERF_CENTROID_LAT_FIELD),
            limit(maxRows),
          );

          const snapshot = await getDocs(erfsQuery);

          const rows = snapshot.docs
            .map((documentSnapshot) =>
              normalizeErfViewportRow(
                documentSnapshot.id,
                documentSnapshot.data(),
              ),
            )
            .filter((row) => isInsideViewport(row, bounds))
            .sort(sortErfs);

          return {
            data: {
              rows,
              wasLimited: snapshot.docs.length >= maxRows,
            },
          };
        } catch (error) {
          console.error("getVisibleErfsByWardViewport error:", error);

          return {
            error: {
              message: error.message || "Failed to load visible ERFs",
              code: error.code || "unknown",
            },
          };
        }
      },
    }),
  }),
});

export const { useLazyGetVisibleErfsByWardViewportQuery } = mapErfsApi;
