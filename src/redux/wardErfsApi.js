import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";

const getErfNo = (data) => {
  if (data?.erfNo) return data.erfNo;

  const parcelNo = data?.sg?.parcelNo;
  const portion = data?.sg?.portion;

  if (!parcelNo) return "NAv";

  const portionNumber = Number(portion || 0);

  if (portionNumber > 0) {
    return `${parcelNo}/${portionNumber}`;
  }

  return String(parcelNo);
};

const normaliseErf = (docSnap) => {
  const data = docSnap.data() || {};

  const erfId = data?.erfId || data?.id || docSnap.id;

  return {
    ...data,

    // Keep selectors simple.
    id: erfId,
    erfId,

    erfNo: getErfNo(data),
    type: data?.type || data?.erfType || "NAv",
    status: data?.status || "NAv",

    lmPcode:
      data?.admin?.localMunicipality?.pcode ||
      data?.parents?.lmPcode ||
      data?.lmPcode ||
      "NAv",

    wardPcode:
      data?.admin?.ward?.pcode ||
      data?.parents?.wardPcode ||
      data?.wardPcode ||
      "NAv",

    wardName: data?.admin?.ward?.name || data?.wardName || "NAv",

    centroid: data?.centroid || null,
    bbox: data?.bbox || null,
    geometry: data?.geometry || null,

    premiseIds: Array.isArray(data?.premiseIds) ? data.premiseIds : [],
    metadata: data?.metadata || {},
  };
};

const sortErfs = (rows) => {
  return [...rows].sort((a, b) => {
    const aNo = String(a?.erfNo || "");
    const bNo = String(b?.erfNo || "");

    return aNo.localeCompare(bNo, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
};

export const wardErfsApi = createApi({
  reducerPath: "mapWardErfsApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getErfsByWard: builder.query({
      queryFn: () => ({ data: [] }),

      async onCacheEntryAdded(
        { lmPcode, wardPcode },
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        if (!wardPcode) return;

        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          const erfsQuery = query(
            collection(db, "ireps_erfs"),
            where("admin.ward.pcode", "==", wardPcode),
          );

          unsubscribe = onSnapshot(erfsQuery, (snapshot) => {
            const rows = snapshot.docs.map(normaliseErf).filter((erf) => {
              if (!lmPcode) return true;
              return erf?.lmPcode === lmPcode;
            });

            updateCachedData(() => sortErfs(rows));
          });
        } catch (error) {
          console.error("mapWardErfsApi snapshot error:", error);
        }

        await cacheEntryRemoved;

        if (unsubscribe) {
          unsubscribe();
        }
      },
    }),
  }),
});

export const { useGetErfsByWardQuery } = wardErfsApi;
