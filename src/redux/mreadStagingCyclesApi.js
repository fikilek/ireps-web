// src/redux/mreadStagingCyclesApi.js

import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { getFunctions, httpsCallable } from "firebase/functions";

const DEFAULT_LM_PCODE = "ZA2157";

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

function getCycleStartDate(row = {}) {
  return normalizeText(row?.window?.startDate, "");
}

function sortCyclesByStartDateDesc(left = {}, right = {}) {
  const leftStart = getCycleStartDate(left);
  const rightStart = getCycleStartDate(right);

  if (leftStart !== rightStart) return rightStart.localeCompare(leftStart);

  return String(right?.cycleId || "").localeCompare(String(left?.cycleId || ""));
}

function normalizeCycleRow(row = {}) {
  return {
    ...row,
    availability: row?.isFuture === true ? "FUTURE" : "AVAILABLE",
    isFuture: row?.isFuture === true,
    isCurrentCycle: row?.isCurrentCycle === true,
  };
}

function normalizeControllerResult(result = {}) {
  const rows = Array.isArray(result?.rows)
    ? result.rows.map(normalizeCycleRow).sort(sortCyclesByStartDateDesc)
    : [];

  const fallbackCounts = rows.reduce(
    (acc, row) => {
      if (row.isFuture) acc.future += 1;
      else acc.available += 1;
      if (row.isCurrentCycle) acc.current += 1;
      return acc;
    },
    { available: 0, future: 0, current: 0 },
  );

  return {
    ...result,
    rows,
    summary: {
      ...(result?.summary || {}),
      available: result?.summary?.available ?? fallbackCounts.available,
      future: result?.summary?.future ?? fallbackCounts.future,
      current: result?.summary?.current ?? fallbackCounts.current,
    },
  };
}

export const mreadStagingCyclesApi = createApi({
  reducerPath: "mreadStagingCyclesApi",
  baseQuery: fakeBaseQuery(),
  tagTypes: ["MreadStagingCycles"],
  endpoints: (builder) => ({
    listMreadStagingCycles: builder.query({
      async queryFn(args = {}) {
        try {
          const functions = getFunctions();
          const callable = httpsCallable(functions, "listMreadStagingCycles");

          const payload = {
            lmPcode: normalizeText(args?.lmPcode, DEFAULT_LM_PCODE),
            billingPeriod: normalizeOptionalFilter(args?.billingPeriod),
            includeFuture: args?.includeFuture === true,
            limit: Number(args?.limit || 200),
          };

          const response = await callable(payload);
          const result = response?.data || {};

          if (result?.ok !== true) {
            return {
              error: {
                status: result?.code || "MREAD_STAGING_CYCLES_ERROR",
                data: result,
                message:
                  result?.message || "Could not load MREAD staging cycles",
              },
            };
          }

          return { data: normalizeControllerResult(result) };
        } catch (error) {
          return {
            error: {
              status: error?.code || "MREAD_STAGING_CYCLES_EXCEPTION",
              data: error,
              message: error?.message || "Could not load MREAD staging cycles",
            },
          };
        }
      },
      providesTags: (result) => {
        const rowTags = Array.isArray(result?.rows)
          ? result.rows.map((row) => ({
              type: "MreadStagingCycles",
              id: row?.cycleId || row?.id || "UNKNOWN",
            }))
          : [];

        return [{ type: "MreadStagingCycles", id: "LIST" }, ...rowTags];
      },
    }),

    generateMreadStaging: builder.mutation({
      async queryFn(args = {}) {
        try {
          const cycleId = normalizeText(args?.cycleId, "");

          if (!cycleId) {
            return {
              error: {
                status: "CYCLE_ID_REQUIRED",
                data: { code: "CYCLE_ID_REQUIRED" },
                message: "cycleId is required to generate MREAD staging",
              },
            };
          }

          const functions = getFunctions();
          const callable = httpsCallable(functions, "generateMreadStaging");

          const payload = { cycleId };

          if (args?.dryRun === true) {
            payload.dryRun = true;
          }

          const response = await callable(payload);
          const result = response?.data || {};

          if (result?.ok !== true) {
            return {
              error: {
                status: result?.code || "GENERATE_MREAD_STAGING_ERROR",
                data: result,
                message: result?.message || "Could not generate MREAD staging",
              },
            };
          }

          return { data: result };
        } catch (error) {
          return {
            error: {
              status:
                error?.code ||
                error?.details?.code ||
                "GENERATE_MREAD_STAGING_EXCEPTION",
              data: error?.details || error,
              message:
                error?.message ||
                error?.details?.message ||
                "Could not generate MREAD staging",
            },
          };
        }
      },
      invalidatesTags: (result, error, args = {}) => [
        { type: "MreadStagingCycles", id: "LIST" },
        {
          type: "MreadStagingCycles",
          id: args?.cycleId || result?.cycleId || "UNKNOWN",
        },
      ],
    }),
  }),
});

export const {
  useListMreadStagingCyclesQuery,
  useGenerateMreadStagingMutation,
} = mreadStagingCyclesApi;
