import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import {
  collection,
  limit,
  onSnapshot,
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

function parseErfGeometry(value, erfId) {
  if (!value) return null;

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      console.error("[MAP ERFS] Invalid ERF geometry JSON.", {
        erfId,
        code: error?.code || "INVALID_GEOMETRY_JSON",
        message: error?.message || String(error),
        stack: error?.stack || null,
      });
      return null;
    }
  }

  return value;
}

function buildErfNo(sg) {
  const parcelNo = sg?.parcelNo;
  const portion = Number(sg?.portion ?? 0);

  if (parcelNo == null || String(parcelNo).trim() === "") {
    return "NAv";
  }

  return portion > 0
    ? `${String(parcelNo).trim()}/${portion}`
    : String(parcelNo).trim();
}

function normalizeErfViewportRow(id, data) {
  const erfId = data?.erfId || id;

  return {
    id,
    erfId,
    erfNo: buildErfNo(data?.sg),

    wardPcode: data?.admin?.ward?.pcode || "NAv",
    lmPcode: data?.admin?.localMunicipality?.pcode || "NAv",

    type: data?.erf?.type || "NAv",
    status: data?.erf?.status || "NAv",

    bbox: data?.bbox || null,
    centroid: data?.centroid || null,
    geometry: parseErfGeometry(data?.geometry, erfId),

    premiseIds: Array.isArray(data?.premises) ? data.premises : [],

    updatedAt:
      data?.metadata?.updatedAt ||
      data?.metadata?.createdAt ||
      "NAv",
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
  return String(a?.erfNo || "").localeCompare(
    String(b?.erfNo || ""),
    undefined,
    {
      numeric: true,
      sensitivity: "base",
    },
  );
}

function emptyResult({
  wardPcode = null,
  bounds = null,
  status = "idle",
  lastError = null,
} = {}) {
  return {
    rows: [],
    wasLimited: false,
    sync: {
      status,
      wardPcode,
      bounds,
      firstSnapshotAt: 0,
      lastSyncAt: 0,
      lastError,
      source: "firestore-stream",
      size: 0,
      visibleSize: 0,
    },
  };
}

function buildErfViewportQuery({
  wardPcode,
  bounds,
  maxRows = DEFAULT_MAX_ROWS,
}) {
  return query(
    collection(db, ERFS_COLLECTION),
    where(ERF_WARD_FIELD, "==", wardPcode),
    where(ERF_CENTROID_LAT_FIELD, ">=", bounds.south),
    where(ERF_CENTROID_LAT_FIELD, "<=", bounds.north),
    orderBy(ERF_CENTROID_LAT_FIELD),
    limit(maxRows),
  );
}

function buildStreamResult(
  snapshot,
  {
    wardPcode,
    bounds,
    maxRows = DEFAULT_MAX_ROWS,
    firstSnapshotAt = 0,
  },
) {
  const rows = snapshot.docs
    .map((documentSnapshot) =>
      normalizeErfViewportRow(
        documentSnapshot.id,
        documentSnapshot.data(),
      ),
    )
    .filter((row) => isInsideViewport(row, bounds))
    .sort(sortErfs);

  const now = Date.now();

  return {
    rows,
    wasLimited: snapshot.docs.length >= maxRows,
    sync: {
      status: "ready",
      wardPcode,
      bounds,
      firstSnapshotAt: firstSnapshotAt || now,
      lastSyncAt: now,
      lastError: null,
      source: "firestore-stream",
      size: snapshot.size,
      visibleSize: rows.length,
    },
  };
}

export const mapErfsApi = createApi({
  reducerPath: "mapErfsApi",
  baseQuery: fakeBaseQuery(),

  endpoints: (builder) => ({
    getVisibleErfsByWardViewport: builder.query({
      queryFn({ wardPcode, bounds } = {}) {
        if (!wardPcode || !bounds) {
          return {
            data: emptyResult({
              wardPcode: wardPcode || null,
              bounds: bounds || null,
            }),
          };
        }

        return {
          data: emptyResult({
            wardPcode,
            bounds,
            status: "syncing",
          }),
        };
      },

      async onCacheEntryAdded(
        args,
        {
          updateCachedData,
          cacheDataLoaded,
          cacheEntryRemoved,
        },
      ) {
        const {
          wardPcode,
          bounds,
          maxRows = DEFAULT_MAX_ROWS,
        } = args || {};

        if (!wardPcode || !bounds) return;

        try {
          await cacheDataLoaded;
        } catch (_error) {
          return;
        }

        let firstSnapshotAt = 0;
        let unsubscribe = null;

        updateCachedData((draft) => {
          draft.rows = Array.isArray(draft.rows) ? draft.rows : [];
          draft.wasLimited = Boolean(draft.wasLimited);
          draft.sync = draft.sync || {};
          draft.sync.status = "syncing";
          draft.sync.wardPcode = wardPcode;
          draft.sync.bounds = bounds;
          draft.sync.lastError = null;
          draft.sync.source = "firestore-stream";
        });

        try {
          console.log("[MAP ERFS] Starting Firestore viewport stream.", {
            wardPcode,
            bounds,
            maxRows,
          });

          unsubscribe = onSnapshot(
            buildErfViewportQuery({
              wardPcode,
              bounds,
              maxRows,
            }),
            (snapshot) => {
              const isFirstSnapshot = !firstSnapshotAt;

              if (isFirstSnapshot) {
                firstSnapshotAt = Date.now();
              }

              const nextResult = buildStreamResult(snapshot, {
                wardPcode,
                bounds,
                maxRows,
                firstSnapshotAt,
              });

              updateCachedData((draft) => {
                draft.rows = nextResult.rows;
                draft.wasLimited = nextResult.wasLimited;
                draft.sync = nextResult.sync;
              });

              console.log(
                isFirstSnapshot
                  ? "[MAP ERFS] First viewport snapshot loaded."
                  : "[MAP ERFS] Viewport snapshot updated.",
                {
                  wardPcode,
                  firestoreSize: snapshot.size,
                  visibleSize: nextResult.rows.length,
                  changeCount: snapshot.docChanges().length,
                },
              );
            },
            (error) => {
              console.error("[MAP ERFS] Firestore viewport stream failed.", {
                wardPcode,
                bounds,
                code: error?.code || "UNKNOWN_STREAM_ERROR",
                message: error?.message || String(error),
                stack: error?.stack || null,
              });

              updateCachedData((draft) => {
                draft.rows = Array.isArray(draft.rows) ? draft.rows : [];
                draft.wasLimited = Boolean(draft.wasLimited);
                draft.sync = draft.sync || {};
                draft.sync.status = "error";
                draft.sync.wardPcode = wardPcode;
                draft.sync.bounds = bounds;
                draft.sync.lastError = String(
                  error?.message ||
                    error ||
                    "Unknown Firestore stream error",
                );
                draft.sync.lastSyncAt = Date.now();
                draft.sync.source = "firestore-stream";
              });
            },
          );
        } catch (error) {
          console.error("[MAP ERFS] Failed to start viewport stream.", {
            wardPcode,
            bounds,
            code: error?.code || "STREAM_SETUP_FAILED",
            message: error?.message || String(error),
            stack: error?.stack || null,
          });

          updateCachedData((draft) => {
            draft.rows = Array.isArray(draft.rows) ? draft.rows : [];
            draft.wasLimited = Boolean(draft.wasLimited);
            draft.sync = draft.sync || {};
            draft.sync.status = "error";
            draft.sync.wardPcode = wardPcode;
            draft.sync.bounds = bounds;
            draft.sync.lastError = String(
              error?.message ||
                error ||
                "Failed to start ERF stream",
            );
            draft.sync.lastSyncAt = Date.now();
            draft.sync.source = "firestore-stream";
          });
        }

        await cacheEntryRemoved;

        if (typeof unsubscribe === "function") {
          unsubscribe();
        }

        console.log("[MAP ERFS] Firestore viewport stream stopped.", {
          wardPcode,
        });
      },
    }),
  }),
});

export const {
  useLazyGetVisibleErfsByWardViewportQuery,
} = mapErfsApi;
