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
            status: normalizeOptionalFilter(args?.status),
            limit: Number(args?.limit || 200),
          };

          const response = await callable(payload);
          const result = response?.data || {};

          if (result?.ok !== true) {
            return {
              error: {
                status: result?.code || "MREAD_STAGING_CYCLES_ERROR",
                data: result,
                message: result?.message || "Could not load MREAD staging cycles",
              },
            };
          }

          return { data: result };
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

          const payload = {
            cycleId,
          };

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
