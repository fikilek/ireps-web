import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import {
  collection,
  limit as limitQuery,
  onSnapshot,
  query,
} from "firebase/firestore";

import { db } from "../firebase";

const SERVICE_PROVIDERS_COLLECTION = "serviceProviders";

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

function getSubcontractorClient(serviceProvider = {}) {
  return asArray(serviceProvider.clients).find((client) => {
    const clientType = String(client?.clientType || "").trim().toUpperCase();
    const relationshipType = String(client?.relationshipType || "")
      .trim()
      .toUpperCase();

    return clientType === "SP" && relationshipType === "SUBC";
  });
}

function normalizeServiceProviderDoc(docSnap) {
  if (!docSnap || !docSnap.exists()) return null;

  const data = docSnap.data() || {};
  const profile = data.profile || {};
  const owner = data.owner || {};
  const metadata = data.metadata || {};
  const subcClient = getSubcontractorClient(data);

  const status = String(valueOrNav(data.status || data.lifecycleStatus)).toUpperCase();
  const name = valueOrNav(
    profile.tradingName || profile.registeredName || data.name || docSnap.id,
  );

  return {
    id: data.id || docSnap.id,
    type: "SP",
    name,
    label: name,
    status,
    registeredName: valueOrNav(profile.registeredName),
    registrationNumber: valueOrNav(profile.registrationNumber),
    ownerName: valueOrNav(owner.name),
    isSubcontractor: Boolean(subcClient),
    parentServiceProviderId: valueOrNav(subcClient?.id),
    parentServiceProviderName: valueOrNav(subcClient?.name),
    relationshipType: valueOrNav(subcClient?.relationshipType),
    clientType: valueOrNav(subcClient?.clientType),
    metadata: {
      ...metadata,
      createdAt: normalizeDateValue(metadata.createdAt || data.createdAt),
      updatedAt: normalizeDateValue(metadata.updatedAt || data.updatedAt),
    },
    raw: data,
  };
}

function sortServiceProviders(left, right) {
  return String(left?.name || left?.id || "").localeCompare(
    String(right?.name || right?.id || ""),
  );
}

function resolveLimit(arg, fallback = 500) {
  const value = typeof arg === "number" ? arg : arg?.limit;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

export const serviceProvidersApi = createApi({
  reducerPath: "serviceProvidersApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getAvailableServiceProviders: builder.query({
      queryFn: () => ({ data: [] }),
      async onCacheEntryAdded(
        arg,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const maxResults = resolveLimit(arg, 500);
        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          const collectionRef = collection(db, SERVICE_PROVIDERS_COLLECTION);
          const serviceProvidersQuery = query(
            collectionRef,
            limitQuery(maxResults),
          );

          unsubscribe = onSnapshot(
            serviceProvidersQuery,
            (snapshot) => {
              const serviceProviders = snapshot.docs
                .map((docSnapshot) => normalizeServiceProviderDoc(docSnapshot))
                .filter(Boolean)
                .filter((serviceProvider) => serviceProvider.status === "ACTIVE")
                .filter((serviceProvider) => serviceProvider.isSubcontractor)
                .sort(sortServiceProviders);

              updateCachedData((draft) => {
                draft.splice(0, draft.length, ...serviceProviders);
              });
            },
            (error) => {
              console.error(
                "serviceProvidersApi getAvailableServiceProviders stream error:",
                error,
              );
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

export const { useGetAvailableServiceProvidersQuery } = serviceProvidersApi;
