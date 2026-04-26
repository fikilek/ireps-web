import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import {
  collection,
  documentId,
  endAt,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  startAt,
  where,
} from "firebase/firestore";

import { db } from "../firebase";

const ERF_REGISTRY_COLLECTION = "registry_erfs";

const ERF_REGISTRY_LM_FIELD = "registry.lmPcode";
const ERF_REGISTRY_WARD_FIELD = "registry.wardPcode";
const ERF_REGISTRY_TYPE_FIELD = "registry.type";
const ERF_REGISTRY_SEARCH_FIELD = "registry.searchableText";

const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_SEARCH_LIMIT = 50;

function safeNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function normalizeSearchText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeErfRegistryRow(id, data) {
  const counts = data?.counts || {};

  return {
    id,

    erfId: data?.erf?.id || data?.id || id,
    erfNo: data?.erf?.erfNo || "NAv",
    erfType: data?.erf?.type || data?.registry?.type || "NAv",
    erfStatus: data?.erf?.status || data?.registry?.status || "NAv",

    lmPcode: data?.registry?.lmPcode || data?.geography?.lmPcode || "NAv",
    wardPcode: data?.registry?.wardPcode || data?.geography?.wardPcode || "NAv",

    searchableText: data?.registry?.searchableText || "",

    premiseCount: safeNumber(counts?.premises),

    electricityMeterCount: safeNumber(counts?.electricityMeters),
    waterMeterCount: safeNumber(counts?.waterMeters),
    meterCount: safeNumber(counts?.totalMeters),

    trnsAccessCount: safeNumber(counts?.trnsAccess),
    trnsNaCount: safeNumber(counts?.trnsNa),
    trnsTotalCount: safeNumber(counts?.trnsTotal),

    updatedAt: data?.metadata?.updatedAt || data?.metadata?.createdAt || "NAv",
  };
}

function sortErfRows(a, b) {
  return String(a.erfNo).localeCompare(String(b.erfNo), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export const registryErfsApi = createApi({
  reducerPath: "registryErfsApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getRegistryErfsPageByWard: builder.query({
      async queryFn({
        wardPcode,
        cursorId = null,
        pageSize = DEFAULT_PAGE_SIZE,
      }) {
        try {
          if (!wardPcode) {
            return {
              data: {
                rows: [],
                nextCursorId: null,
                hasMore: false,
              },
            };
          }

          const registryErfsRef = collection(db, ERF_REGISTRY_COLLECTION);

          const constraints = [
            where(ERF_REGISTRY_WARD_FIELD, "==", wardPcode),
            orderBy(documentId()),
          ];

          if (cursorId) {
            constraints.push(startAfter(cursorId));
          }

          constraints.push(limit(pageSize));

          const registryErfsQuery = query(registryErfsRef, ...constraints);
          const snapshot = await getDocs(registryErfsQuery);

          const rows = snapshot.docs.map((documentSnapshot) =>
            normalizeErfRegistryRow(
              documentSnapshot.id,
              documentSnapshot.data(),
            ),
          );

          const lastDocument = snapshot.docs[snapshot.docs.length - 1];

          return {
            data: {
              rows,
              nextCursorId: lastDocument?.id || null,
              hasMore: rows.length === pageSize,
            },
          };
        } catch (error) {
          console.error("getRegistryErfsPageByWard error:", error);

          return {
            error: {
              message: error.message || "Failed to load ERF registry page",
              code: error.code || "unknown",
            },
          };
        }
      },
    }),

    searchRegistryErfsByLm: builder.query({
      async queryFn({
        lmPcode,
        searchText,
        erfType = "",
        resultLimit = DEFAULT_SEARCH_LIMIT,
      }) {
        try {
          const cleanedSearchText = normalizeSearchText(searchText);

          if (!lmPcode || !cleanedSearchText) {
            return {
              data: {
                rows: [],
                wasLimited: false,
              },
            };
          }

          const registryErfsRef = collection(db, ERF_REGISTRY_COLLECTION);

          const constraints = [where(ERF_REGISTRY_LM_FIELD, "==", lmPcode)];

          if (erfType) {
            constraints.push(where(ERF_REGISTRY_TYPE_FIELD, "==", erfType));
          }

          constraints.push(orderBy(ERF_REGISTRY_SEARCH_FIELD));
          constraints.push(startAt(cleanedSearchText));
          constraints.push(endAt(`${cleanedSearchText}\uf8ff`));
          constraints.push(limit(resultLimit));

          const registryErfsQuery = query(registryErfsRef, ...constraints);
          const snapshot = await getDocs(registryErfsQuery);

          const rows = snapshot.docs
            .map((documentSnapshot) =>
              normalizeErfRegistryRow(
                documentSnapshot.id,
                documentSnapshot.data(),
              ),
            )
            .sort(sortErfRows);

          return {
            data: {
              rows,
              wasLimited: rows.length === resultLimit,
            },
          };
        } catch (error) {
          console.error("searchRegistryErfsByLm error:", error);

          return {
            error: {
              message: error.message || "Failed to search ERF registry",
              code: error.code || "unknown",
            },
          };
        }
      },
    }),
  }),
});

export const {
  useGetRegistryErfsPageByWardQuery,
  useLazyGetRegistryErfsPageByWardQuery,
  useLazySearchRegistryErfsByLmQuery,
} = registryErfsApi;
