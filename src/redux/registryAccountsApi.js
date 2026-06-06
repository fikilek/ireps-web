import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import { db } from "../firebase";

const ACCOUNT_REGISTRY_COLLECTION = "registry_accounts";
const FIELD_ACCOUNT_DATA_COLLECTION = "field_account_data";

const ACCOUNT_REGISTRY_WARD_FIELD = "geography.wardPcode";
const FIELD_ACCOUNT_DATA_PREMISE_FIELD = "premise.premiseId";

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatOwnerLabel(owner = {}) {
  if (owner?.ownerType === "JURISTIC_PERSON") {
    return (
      owner?.juristicPerson?.registeredName ||
      owner?.juristicPerson?.tradingName ||
      "NAv"
    );
  }

  const fullName = [owner?.naturalPerson?.name, owner?.naturalPerson?.surname]
    .map((item) => String(item || "").trim())
    .filter((item) => item && item !== "NAv")
    .join(" ");

  return fullName || "NAv";
}

function formatOccupantLabel(occupant = {}) {
  const fullName = [occupant?.name, occupant?.surname]
    .map((item) => String(item || "").trim())
    .filter((item) => item && item !== "NAv")
    .join(" ");

  return fullName || "NAv";
}

function getFadTime(fieldAccountDataId = "") {
  const match = String(fieldAccountDataId || "").match(/^FAD_(\d+)_/);
  const value = Number(match?.[1] || 0);

  return Number.isFinite(value) ? value : 0;
}

function normalizeAccountList(accounts = []) {
  return safeArray(accounts)
    .map((account) => ({
      accountNo: account?.accountNo || "NAv",
    }))
    .sort((a, b) =>
      String(a.accountNo).localeCompare(String(b.accountNo), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
}

function normalizeMeterList(meters = []) {
  return safeArray(meters)
    .map((meter) => ({
      meterId: meter?.meterId || meter?.id || "NAv",
      meterNo: meter?.meterNo || "NAv",
    }))
    .sort((a, b) =>
      String(a.meterNo).localeCompare(String(b.meterNo), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
}

function normalizeRegistryAccountRow(id, data = {}) {
  const accounts = normalizeAccountList(data?.accounts);
  const meters = normalizeMeterList(data?.meters);
  const refs = data?.refs || {};
  const latestFieldAccountDataId = refs?.latestFieldAccountDataId || "NAv";
  const reconciliation = data?.reconciliation || {};

  return {
    id,

    premiseId: data?.premise?.premiseId || data?.id || id,
    premiseAddress: data?.premise?.address || "NAv",
    propertyType: data?.premise?.propertyType || "NAv",

    erfId: data?.premise?.erfId || "NAv",
    erfNo: data?.premise?.erfNo || "NAv",

    lmPcode: data?.geography?.lmPcode || "NAv",
    wardPcode: data?.geography?.wardPcode || "NAv",

    owner: data?.owner || {},
    ownerLabel: formatOwnerLabel(data?.owner || {}),
    ownerType: data?.owner?.ownerType || "NAv",

    occupant: data?.occupant || {},
    occupantLabel: formatOccupantLabel(data?.occupant || {}),

    accounts,
    accountCount: accounts.length,

    meters,
    meterCount: meters.length,

    reconciliation,
    reconciliationStatus: reconciliation?.status || "NAv",
    reconciliationExceptions: safeArray(reconciliation?.exceptions),

    refs: {
      accountMasterIds: safeArray(refs?.accountMasterIds),
      billingMasterIds: safeArray(refs?.billingMasterIds),
      latestFieldAccountDataId,
    },

    historyStatus:
      latestFieldAccountDataId && latestFieldAccountDataId !== "NAv"
        ? "HAS_HISTORY"
        : "NO_HISTORY",
    historySortValue: getFadTime(latestFieldAccountDataId),

    updatedAt: data?.metadata?.updatedAt || data?.metadata?.createdAt || "NAv",
    createdAt: data?.metadata?.createdAt || "NAv",
  };
}

function normalizeFieldAccountDataRow(id, data = {}) {
  const accounts = normalizeAccountList(data?.accounts);
  const media = safeArray(data?.media);

  return {
    id,
    capturedAt: data?.metadata?.createdAt || data?.metadata?.updatedAt || "NAv",
    capturedByUser: data?.metadata?.createdByUser || "NAv",
    updatedAt: data?.metadata?.updatedAt || "NAv",
    updatedByUser: data?.metadata?.updatedByUser || "NAv",

    premise: data?.premise || {},
    geography: data?.geography || {},

    accounts,
    accountNos: accounts.map((account) => account.accountNo),

    owner: data?.owner || {},
    ownerLabel: formatOwnerLabel(data?.owner || {}),

    occupant: data?.occupant || {},
    occupantLabel: formatOccupantLabel(data?.occupant || {}),

    media,
    mediaCount: media.length,

    processing: data?.processing || {},
    processingStatus: data?.processing?.accountMasterStatus || "NAv",
  };
}

function getUpdatedAtMs(item = {}) {
  const raw = item?.updatedAt || item?.capturedAt || item?.createdAt || "";
  const ms = new Date(raw).getTime();

  return Number.isNaN(ms) ? 0 : ms;
}

function sortRegistryAccountRows(a, b) {
  const wardCompare = String(a.wardPcode).localeCompare(
    String(b.wardPcode),
    undefined,
    { numeric: true, sensitivity: "base" },
  );

  if (wardCompare !== 0) return wardCompare;

  const erfCompare = String(a.erfNo).localeCompare(String(b.erfNo), undefined, {
    numeric: true,
    sensitivity: "base",
  });

  if (erfCompare !== 0) return erfCompare;

  return String(a.premiseAddress).localeCompare(
    String(b.premiseAddress),
    undefined,
    { numeric: true, sensitivity: "base" },
  );
}

function sortHistoryRows(a, b) {
  return getUpdatedAtMs(b) - getUpdatedAtMs(a);
}

export const registryAccountsApi = createApi({
  reducerPath: "registryAccountsApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getRegistryAccountsByWard: builder.query({
      queryFn: () => ({ data: [] }),

      async onCacheEntryAdded(
        wardPcode,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        if (!wardPcode) return;

        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          const registryAccountsRef = collection(
            db,
            ACCOUNT_REGISTRY_COLLECTION,
          );

          const registryAccountsQuery = query(
            registryAccountsRef,
            where(ACCOUNT_REGISTRY_WARD_FIELD, "==", wardPcode),
          );

          unsubscribe = onSnapshot(
            registryAccountsQuery,
            (snapshot) => {
              const rows = snapshot.docs
                .map((documentSnapshot) =>
                  normalizeRegistryAccountRow(
                    documentSnapshot.id,
                    documentSnapshot.data(),
                  ),
                )
                .sort(sortRegistryAccountRows);

              updateCachedData((draft) => {
                draft.splice(0, draft.length, ...rows);
              });
            },
            (error) => {
              console.error("registryAccountsApi stream error:", error);
            },
          );

          await cacheEntryRemoved;
        } finally {
          if (unsubscribe) {
            unsubscribe();
          }
        }
      },
    }),

    getFieldAccountDataHistoryByPremise: builder.query({
      async queryFn(premiseId) {
        try {
          if (!premiseId) {
            return { data: [] };
          }

          const fieldAccountDataRef = collection(
            db,
            FIELD_ACCOUNT_DATA_COLLECTION,
          );

          const fieldAccountDataQuery = query(
            fieldAccountDataRef,
            where(FIELD_ACCOUNT_DATA_PREMISE_FIELD, "==", premiseId),
          );

          const snapshot = await getDocs(fieldAccountDataQuery);

          const rows = snapshot.docs
            .map((documentSnapshot) =>
              normalizeFieldAccountDataRow(
                documentSnapshot.id,
                documentSnapshot.data(),
              ),
            )
            .sort(sortHistoryRows);

          return { data: rows };
        } catch (error) {
          console.error("getFieldAccountDataHistoryByPremise error:", error);

          return {
            error: {
              message:
                error.message || "Failed to load field account data history",
              code: error.code || "unknown",
            },
          };
        }
      },
    }),
  }),
});

export const {
  useGetRegistryAccountsByWardQuery,
  useLazyGetFieldAccountDataHistoryByPremiseQuery,
} = registryAccountsApi;
