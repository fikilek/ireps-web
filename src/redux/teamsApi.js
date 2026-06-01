import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import {
  collection,
  limit as limitQuery,
  onSnapshot,
  query,
} from "firebase/firestore";

import { db } from "../firebase";

const TEAMS_COLLECTION = "teams";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function valueOrNav(value) {
  if (value === null || value === undefined || value === "") return "NAv";
  return value;
}

function normalizeDateValue(value) {
  if (!value) return null;

  if (typeof value === "string") return value;

  if (typeof value?.toDate === "function") {
    return value.toDate().toISOString();
  }

  return String(value);
}

function normalizeTeamDoc(docSnap) {
  if (!docSnap || !docSnap.exists()) return null;

  const data = docSnap.data() || {};
  const team = data.team || {};
  const scope = data.scope || {};
  const ownership = data.ownership || {};
  const metadata = data.metadata || {};

  const status = String(valueOrNav(team.status || data.status)).toUpperCase();
  const name = valueOrNav(team.name || data.name || docSnap.id);

  return {
    id: data.id || docSnap.id,
    type: "TEAM",
    name,
    label: name,
    status,
    code: valueOrNav(team.code || data.code),
    description: valueOrNav(team.description || data.description),
    memberUserIds: asArray(scope.memberUserIds),
    serviceProviderIds: asArray(scope.serviceProviderIds),
    memberCount: asArray(scope.memberUserIds).length,
    serviceProviderCount: asArray(scope.serviceProviderIds).length,
    mncServiceProviderId: valueOrNav(ownership.mncServiceProviderId),
    mncServiceProviderName: valueOrNav(ownership.mncServiceProviderName),
    metadata: {
      ...metadata,
      createdAt: normalizeDateValue(metadata.createdAt || data.createdAt),
      updatedAt: normalizeDateValue(metadata.updatedAt || data.updatedAt),
    },
    raw: data,
  };
}

function sortTeams(left, right) {
  return String(left?.name || left?.id || "").localeCompare(
    String(right?.name || right?.id || ""),
  );
}

function resolveLimit(arg, fallback = 500) {
  const value = typeof arg === "number" ? arg : arg?.limit;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

export const teamsApi = createApi({
  reducerPath: "teamsApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getAvailableTeams: builder.query({
      queryFn: () => ({ data: [] }),
      async onCacheEntryAdded(
        arg,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const maxResults = resolveLimit(arg, 500);
        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          const collectionRef = collection(db, TEAMS_COLLECTION);
          const teamsQuery = query(collectionRef, limitQuery(maxResults));

          unsubscribe = onSnapshot(
            teamsQuery,
            (snapshot) => {
              const teams = snapshot.docs
                .map((docSnapshot) => normalizeTeamDoc(docSnapshot))
                .filter(Boolean)
                .filter((team) => team.status === "ACTIVE")
                .sort(sortTeams);

              updateCachedData((draft) => {
                draft.splice(0, draft.length, ...teams);
              });
            },
            (error) => {
              console.error("teamsApi getAvailableTeams stream error:", error);
            },
          );

          await cacheEntryRemoved;
        } finally {
          if (unsubscribe) unsubscribe();
        }
      },
    }),
  }),
});

export const { useGetAvailableTeamsQuery } = teamsApi;
