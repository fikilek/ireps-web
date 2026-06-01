import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import {
  collection,
  limit as limitQuery,
  onSnapshot,
  query,
} from "firebase/firestore";

import { db } from "../firebase";

const USERS_COLLECTION = "users";

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

function buildDisplayName(profile = {}, fallback = "NAv") {
  const explicitDisplayName = String(profile.displayName || "").trim();

  if (explicitDisplayName) return explicitDisplayName;

  const nameParts = [profile.name, profile.surname]
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  if (nameParts.length > 0) return nameParts.join(" ");

  return valueOrNav(profile.email || fallback);
}

function normalizeUserDoc(docSnap) {
  if (!docSnap || !docSnap.exists()) return null;

  const data = docSnap.data() || {};
  const profile = data.profile || {};
  const employment = data.employment || {};
  const serviceProvider = employment.serviceProvider || {};
  const onboarding = data.onboarding || {};
  const metadata = data.metadata || {};

  const id = data.uid || data.id || docSnap.id;
  const role = String(valueOrNav(employment.role || data.role)).toUpperCase();
  const accountStatus = String(valueOrNav(data.accountStatus)).toUpperCase();
  const onboardingStatus = String(valueOrNav(onboarding.status)).toUpperCase();

  return {
    id,
    uid: data.uid || docSnap.id,
    type: "USER",
    displayName: buildDisplayName(profile, id),
    name: valueOrNav(profile.name),
    surname: valueOrNav(profile.surname),
    email: valueOrNav(profile.email || data.email || data.auth?.email),
    role,
    accountStatus,
    onboardingStatus,
    serviceProviderId: valueOrNav(serviceProvider.id),
    serviceProviderName: valueOrNav(serviceProvider.name),
    isOperationalMember: ["FWR", "SPV"].includes(role),
    isReady:
      accountStatus === "ACTIVE" &&
      ["COMPLETED", "WORKBASE_REQUIRED", "PENDING"].includes(onboardingStatus),
    metadata: {
      ...metadata,
      createdAt: normalizeDateValue(metadata.createdAt || data.createdAt),
      updatedAt: normalizeDateValue(metadata.updatedAt || data.updatedAt),
    },
    raw: data,
  };
}

function sortUsers(left, right) {
  return String(left?.displayName || left?.id || "").localeCompare(
    String(right?.displayName || right?.id || ""),
  );
}

function resolveLimit(arg, fallback = 1000) {
  const value = typeof arg === "number" ? arg : arg?.limit;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

export const usersApi = createApi({
  reducerPath: "usersApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getUsersDirectory: builder.query({
      queryFn: () => ({ data: [] }),
      async onCacheEntryAdded(
        arg,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const maxResults = resolveLimit(arg, 1000);
        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          const collectionRef = collection(db, USERS_COLLECTION);
          const usersQuery = query(collectionRef, limitQuery(maxResults));

          unsubscribe = onSnapshot(
            usersQuery,
            (snapshot) => {
              const users = snapshot.docs
                .map((docSnapshot) => normalizeUserDoc(docSnapshot))
                .filter(Boolean)
                .sort(sortUsers);

              updateCachedData((draft) => {
                draft.splice(0, draft.length, ...users);
              });
            },
            (error) => {
              console.error("usersApi getUsersDirectory stream error:", error);
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

export const { useGetUsersDirectoryQuery } = usersApi;
