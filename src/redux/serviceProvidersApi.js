import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import {
  collection,
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

function getMncPcodes(serviceProvider = {}) {
  return asArray(serviceProvider.clients)
    .filter((client) => {
      const clientType = String(client?.clientType || "").trim().toUpperCase();
      const relationshipType = String(client?.relationshipType || "")
        .trim()
        .toUpperCase();

      return clientType === "LM" && relationshipType === "MNC";
    })
    .map((client) => String(client?.id || "").trim())
    .filter(Boolean);
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
  const mncPcodes = getMncPcodes(data);

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
    // The municipalities this provider is the MAIN CONTRACTOR for. Flattened
    // here so no screen has to read `raw.clients` and work the relationship out
    // again; `components/serviceProviders/providerHierarchy.js` is the one well
    // that interprets them.
    mncPcodes,
    isMainContractor: mncPcodes.length > 0,
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

// NO CAP. Owner, 13 October 2026: "why do u need to do limits ? ... get all
// .. u will never reach even 50".
//
// A cap on a directory is a silent truncation: the screens that read this ask
// "who is there", and a reader cut off at an arbitrary number cannot tell a
// missing person from an absent one. A worker left out of the directory loses
// his name, his role and his provider on every screen that looks him up, and
// nothing says why. These collections are tens of records, not thousands.
function buildServiceProvidersQuery() {
  return query(
    collection(db, SERVICE_PROVIDERS_COLLECTION),
  );
}

function buildServiceProviderRows(snapshot) {
  return snapshot.docs
    .map((docSnapshot) => normalizeServiceProviderDoc(docSnapshot))
    .filter(Boolean)
    .filter((serviceProvider) => serviceProvider.status === "ACTIVE")
    // EVERY ACTIVE PROVIDER, main contractors included. Until 13 October 2026
    // this also kept `.filter((sp) => sp.isSubcontractor)`, so a stream named
    // "available service providers" returned SUBCONTRACTORS ONLY and no main
    // contractor was ever in it. On LIVE, where RSTE is the only provider and
    // has no subcontractors, it therefore returned an EMPTY LIST - and nothing
    // said so. No hierarchy can be worked out from a list with every parent
    // removed, which is why the ITO page could not tell whose worker was whose.
    //
    // The BGO pages did want subcontractors only for their allocation targets.
    // That restriction now lives on those pages, where it applies and can be
    // seen, instead of being hidden in the stream every other screen reads.
    .sort(sortServiceProviders);
}

function readInitialServiceProviders(arg, signal) {
  const serviceProvidersQuery = buildServiceProvidersQuery();

  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = () => {};

    const finish = (result) => {
      if (settled) return;

      settled = true;
      signal?.removeEventListener("abort", handleAbort);
      unsubscribe();
      resolve(result);
    };

    const handleAbort = () => {
      finish({
        error: {
          status: "CUSTOM_ERROR",
          error: "Service Provider directory stream request was cancelled.",
        },
      });
    };

    if (signal?.aborted) {
      handleAbort();
      return;
    }

    signal?.addEventListener("abort", handleAbort, { once: true });

    const streamUnsubscribe = onSnapshot(
      serviceProvidersQuery,
      // Web Data Copy rules WD-R001.3: the server's confirmation of an unchanged
      // (even empty) saved copy arrives only as a metadata change.
      { includeMetadataChanges: true },
      (snapshot) => {
        const serviceProviders = buildServiceProviderRows(snapshot);
        const fromCache = snapshot.metadata?.fromCache === true;

        // Web Data Copy rules WD-R001.3: the saved copy may hold only part of
        // the list, so the first answer shown is the server's.
        if (fromCache) return;

        finish({ data: serviceProviders });
      },
      (error) => {
        finish({
          error: {
            status: "CUSTOM_ERROR",
            error:
              error?.message ||
              "Could not load the Service Provider directory stream.",
          },
        });
      },
    );

    unsubscribe = streamUnsubscribe;

    if (settled) {
      unsubscribe();
    }
  });
}

export const serviceProvidersApi = createApi({
  reducerPath: "serviceProvidersApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getAvailableServiceProviders: builder.query({
      queryFn: (arg, { signal }) => readInitialServiceProviders(arg, signal),
      async onCacheEntryAdded(
        arg,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          const serviceProvidersQuery = buildServiceProvidersQuery();

          unsubscribe = onSnapshot(
            serviceProvidersQuery,
            (snapshot) => {
              const serviceProviders = buildServiceProviderRows(snapshot);

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
