import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { getFunctions, httpsCallable } from "firebase/functions";

const DEFAULT_PAGE_SIZE = 25;
const MAX_SESSION_LIMIT = 200;

function normalizeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function normalizeOptionalFilter(value) {
  const text = normalizeText(value, "");
  if (!text || text.toUpperCase() === "ALL") return null;
  return text;
}

function normalizePageSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(size, 200);
}

function normalizeListSessionsResult(result = {}) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  return {
    ...result,
    rows,
  };
}

export const mreadStagingApi = createApi({
  reducerPath: "mreadStagingApi",
  baseQuery: fakeBaseQuery(),
  tagTypes: ["MreadStagingSessions", "MreadStagingRows"],
  endpoints: (builder) => ({
    listMreadStagingSessions: builder.query({
      async queryFn(args = {}) {
        try {
          const functions = getFunctions();
          const callable = httpsCallable(functions, "listMreadStagingSessions");
          const payload = {
            lmPcode: normalizeText(args?.lmPcode, ""),
            limit: Number(args?.limit || MAX_SESSION_LIMIT),
          };

          const response = await callable(payload);
          const result = response?.data || {};

          if (result?.ok !== true) {
            return {
              error: {
                status: result?.code || "MREAD_STAGING_SESSIONS_ERROR",
                data: result,
                message:
                  result?.message || "Could not load MREAD staging sessions",
              },
            };
          }

          return { data: normalizeListSessionsResult(result) };
        } catch (error) {
          return {
            error: {
              status: error?.code || "MREAD_STAGING_SESSIONS_EXCEPTION",
              data: error,
              message:
                error?.message || "Could not load MREAD staging sessions",
            },
          };
        }
      },
      providesTags: (result) =>
        result?.rows?.map((row) => ({
          type: "MreadStagingSessions",
          id: row?.id || row?.stagingId || "UNKNOWN",
        })) || [{ type: "MreadStagingSessions", id: "LIST" }],
    }),

    listMreadStagingRows: builder.query({
      async queryFn(args = {}) {
        try {
          const functions = getFunctions();
          const callable = httpsCallable(functions, "listMreadStagingRows");
          const payload = {
            stagingId: normalizeText(args?.stagingId, ""),
            wardPcode: normalizeOptionalFilter(args?.wardPcode),
            geofence: normalizeOptionalFilter(args?.geofence),
            meterKind: normalizeOptionalFilter(args?.meterKind),
            meterType: normalizeOptionalFilter(args?.meterType),
            phase: normalizeOptionalFilter(args?.phase),
            premiseType: normalizeOptionalFilter(args?.premiseType),
            search: normalizeOptionalFilter(args?.search),
            pageSize: normalizePageSize(args?.pageSize),
            cursor: normalizeText(args?.cursor, ""),
          };

          const response = await callable(payload);
          const result = response?.data || {};

          if (result?.ok !== true) {
            return {
              error: {
                status: result?.code || "MREAD_STAGING_ROWS_ERROR",
                data: result,
                message: result?.message || "Could not load MREAD staging rows",
              },
            };
          }

          return { data: result };
        } catch (error) {
          return {
            error: {
              status: error?.code || "MREAD_STAGING_ROWS_EXCEPTION",
              data: error,
              message: error?.message || "Could not load MREAD staging rows",
            },
          };
        }
      },
      providesTags: (result) =>
        result?.rows?.map((row) => ({
          type: "MreadStagingRows",
          id: row?.rowId || "UNKNOWN",
        })) || [{ type: "MreadStagingRows", id: "LIST" }],
    }),
  }),
});

export const {
  useListMreadStagingSessionsQuery,
  useListMreadStagingRowsQuery,
} = mreadStagingApi;
