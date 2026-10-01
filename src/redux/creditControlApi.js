// DR-R001 3.1, 3.2 and 3.3 — what the Meter Registry's Credit control columns
// need:
//   - the guard, asked before the window opens, so the office is told that a
//     meter cannot be accounted for before it types anything;
//   - the meter record itself, for the details window;
//   - the meter's No Access history, read from the transactions.
import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as firestoreLimit,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { db } from "../firebase";

const TRNS_COLLECTION = "trns";
const ASTS_COLLECTION = "asts";
const NO_ACCESS_HISTORY_LIMIT = 100;

function readTrnType(data = {}) {
  return data?.accessData?.trnType || data?.trnType || "NAv";
}

export function noAccessHistoryRow(docSnap) {
  const data = docSnap.data() || {};

  return {
    id: docSnap.id,
    when: data?.metadata?.updatedAt || data?.metadata?.createdAt || "NAv",
    worker:
      data?.metadata?.updatedByUser || data?.metadata?.createdByUser || "NAv",
    trnType: readTrnType(data),
    reason: data?.accessData?.access?.reason || "NAv",
  };
}

export const creditControlApi = createApi({
  reducerPath: "creditControlApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    // The guard. A refusal is an answer, not an error: it carries the seven
    // checks so the office can see which link is broken.
    checkMeterRegistration: builder.mutation({
      async queryFn(astId) {
        const meterId = String(astId || "").trim();

        if (!meterId) {
          return {
            data: {
              success: false,
              code: "INVALID_AST_ID",
              message: "No meter was named",
            },
          };
        }

        try {
          const callable = httpsCallable(
            getFunctions(),
            "onCheckMeterRegistrationCallable",
          );

          const response = await callable({ astId: meterId });

          return { data: response?.data || null };
        } catch (error) {
          return {
            error: {
              status: "REGISTRATION_CHECK_FAILED",
              error: error?.message || String(error),
            },
          };
        }
      },
    }),

    getMeterById: builder.query({
      async queryFn(astId) {
        const meterId = String(astId || "").trim();

        if (!meterId) return { data: null };

        try {
          const snapshot = await getDoc(doc(db, ASTS_COLLECTION, meterId));

          return {
            data: snapshot.exists()
              ? { id: snapshot.id, ...snapshot.data() }
              : null,
          };
        } catch (error) {
          return {
            error: {
              status: "METER_READ_FAILED",
              error: error?.message || String(error),
            },
          };
        }
      },
    }),

    // The premise, for its pin on the map beside the meter's own.
    getPremiseById: builder.query({
      async queryFn(premiseId) {
        const id = String(premiseId || "").trim();

        if (!id) return { data: null };

        try {
          const snapshot = await getDoc(doc(db, "premises", id));

          return {
            data: snapshot.exists()
              ? { id: snapshot.id, ...snapshot.data() }
              : null,
          };
        } catch (error) {
          return {
            error: {
              status: "PREMISE_READ_FAILED",
              error: error?.message || String(error),
            },
          };
        }
      },
    }),

    // Every visit to this meter that ended because nobody could reach it,
    // newest first. Needs the composite index declared in
    // firestore.indexes.json (ast.astData.astId, accessData.access.hasAccess,
    // metadata.updatedAt).
    getMeterNoAccessHistory: builder.query({
      async queryFn(astId) {
        const meterId = String(astId || "").trim();

        if (!meterId) return { data: [] };

        try {
          const snapshot = await getDocs(
            query(
              collection(db, TRNS_COLLECTION),
              where("ast.astData.astId", "==", meterId),
              where("accessData.access.hasAccess", "==", "no"),
              orderBy("metadata.updatedAt", "desc"),
              firestoreLimit(NO_ACCESS_HISTORY_LIMIT),
            ),
          );

          return { data: snapshot.docs.map(noAccessHistoryRow) };
        } catch (error) {
          return {
            error: {
              status: "NO_ACCESS_HISTORY_FAILED",
              error: error?.message || String(error),
            },
          };
        }
      },
    }),
  }),
});

export const {
  useCheckMeterRegistrationMutation,
  useGetMeterByIdQuery,
  useGetPremiseByIdQuery,
  useGetMeterNoAccessHistoryQuery,
} = creditControlApi;
