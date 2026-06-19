/* eslint-disable no-undef */

import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

export const DATA_CLEANSING_SYSTEM_UID = "SYSTEM";
export const DATA_CLEANSING_SYSTEM_USER = "Data Cleansing Sync";

export function normalizeAccountNo(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function sanitizeIdSegment(value, fallback = "NAv") {
  const cleaned = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 180);

  return cleaned || fallback;
}

export function toNAv(value) {
  const clean = String(value || "").trim();
  return clean || "NAv";
}

export function cleanJson(value) {
  return JSON.parse(
    JSON.stringify(value || {}, (key, itemValue) =>
      itemValue === undefined ? null : itemValue,
    ),
  );
}

export function getActorFromCallable(request = {}) {
  const caller = request?.auth || null;

  return {
    uid: caller?.uid || DATA_CLEANSING_SYSTEM_UID,
    name:
      caller?.token?.name ||
      caller?.token?.email ||
      caller?.token?.displayName ||
      caller?.uid ||
      DATA_CLEANSING_SYSTEM_USER,
  };
}

export function buildMetadata({
  createdAt = null,
  createdByUid = null,
  createdByUser = null,
  updatedAt = null,
  updatedByUid = null,
  updatedByUser = null,
  fallbackUid = DATA_CLEANSING_SYSTEM_UID,
  fallbackUser = DATA_CLEANSING_SYSTEM_USER,
} = {}) {
  const now = new Date().toISOString();
  const finalCreatedAt = createdAt || now;
  const finalCreatedByUid = createdByUid || fallbackUid;
  const finalCreatedByUser = createdByUser || fallbackUser;

  return {
    createdAt: finalCreatedAt,
    createdByUid: finalCreatedByUid,
    createdByUser: finalCreatedByUser,
    updatedAt: updatedAt || now,
    updatedByUid: updatedByUid || finalCreatedByUid,
    updatedByUser: updatedByUser || finalCreatedByUser,
  };
}

export function buildFieldAccountDataId({ timestampMs = Date.now(), premiseId }) {
  return `FAD_${timestampMs}_${sanitizeIdSegment(premiseId)}`;
}

export function buildAccountMasterId({ lmPcode = "NAv", accountNoNormalized }) {
  return `ACC_${sanitizeIdSegment(lmPcode)}_${sanitizeIdSegment(accountNoNormalized)}`;
}

export function buildFailureResult(code, message, extra = {}) {
  return {
    success: false,
    code: code || "UNKNOWN_ERROR",
    message: message || "Unknown error",
    fieldAccountDataId: "NAv",
    ...extra,
  };
}

export function buildSuccessResult(fieldAccountDataId, message, extra = {}) {
  return {
    success: true,
    code: "SUCCESS",
    message: message || "Account data saved successfully",
    fieldAccountDataId: fieldAccountDataId || "NAv",
    ...extra,
  };
}

export function formatPremiseAddress(premise = {}) {
  return [
    premise?.address?.strNo,
    premise?.address?.strName,
    premise?.address?.strType,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ") || "NAv";
}

export function getPremisePropertyType(premise = {}) {
  return premise?.propertyType?.type || premise?.propertyType?.name || "NAv";
}

export function buildPremiseSnapshot(premiseId, premise = {}) {
  return {
    premiseId: premiseId || premise?.id || "NAv",
    erfId: premise?.erfId || "NAv",
    erfNo: premise?.erfNo || "NAv",
    address: formatPremiseAddress(premise),
    propertyType: getPremisePropertyType(premise),
  };
}

export function buildGeography(premise = {}) {
  const parents = premise?.parents || {};

  return {
    countryPcode: parents?.countryPcode || "NAv",
    provincePcode: parents?.provincePcode || "NAv",
    districtPcode: parents?.districtPcode || parents?.dmPcode || "NAv",
    lmPcode: parents?.lmPcode || "NAv",
    wardPcode: parents?.wardPcode || "NAv",
  };
}

export function cleanOwner(owner = {}) {
  const ownerType =
    owner?.ownerType === "JURISTIC_PERSON" ? "JURISTIC_PERSON" : "NATURAL_PERSON";

  return {
    ownerType,
    naturalPerson: {
      name: toNAv(owner?.naturalPerson?.name),
      surname: toNAv(owner?.naturalPerson?.surname),
      idNumber: toNAv(owner?.naturalPerson?.idNumber),
    },
    juristicPerson: {
      registeredName: toNAv(owner?.juristicPerson?.registeredName),
      registrationNumber: toNAv(owner?.juristicPerson?.registrationNumber),
      tradingName: toNAv(owner?.juristicPerson?.tradingName),
    },
    contact: {
      phone: toNAv(owner?.contact?.phone),
      whatsapp: toNAv(owner?.contact?.whatsapp),
      email: toNAv(owner?.contact?.email),
    },
  };
}

export function cleanOccupant(occupant = {}) {
  return {
    name: toNAv(occupant?.name),
    surname: toNAv(occupant?.surname),
    idNumber: toNAv(occupant?.idNumber),
    relationshipToOwner: toNAv(occupant?.relationshipToOwner),
    contact: {
      phone: toNAv(occupant?.contact?.phone),
      whatsapp: toNAv(occupant?.contact?.whatsapp),
      email: toNAv(occupant?.contact?.email),
    },
  };
}

export function cleanAccounts(accounts = []) {
  const seen = new Set();
  const cleanedAccounts = [];

  for (const item of Array.isArray(accounts) ? accounts : []) {
    const accountNo = normalizeAccountNo(item?.accountNo);
    if (!accountNo || seen.has(accountNo)) continue;

    seen.add(accountNo);
    cleanedAccounts.push({ accountNo });
  }

  return cleanedAccounts;
}

export function validateAccountDataPayload(data = {}) {
  const premiseId = String(data?.premiseId || "").trim();
  const accounts = cleanAccounts(data?.accounts || []);

  if (!premiseId || premiseId === "NAv") {
    return {
      valid: false,
      code: "INVALID_PREMISE_ID",
      message: "premiseId is required",
      premiseId: premiseId || "NAv",
      accounts,
    };
  }

  if (accounts.length === 0) {
    return {
      valid: false,
      code: "INVALID_ACCOUNTS",
      message: "At least one valid account number is required",
      premiseId,
      accounts,
    };
  }

  return {
    valid: true,
    premiseId,
    accounts,
  };
}

export function buildFieldAccountDataDoc({
  fieldAccountDataId,
  premiseId,
  premise = {},
  payload = {},
  accounts = [],
  actorUid = DATA_CLEANSING_SYSTEM_UID,
  actorName = DATA_CLEANSING_SYSTEM_USER,
  now = new Date().toISOString(),
} = {}) {
  const metadata = buildMetadata({
    createdAt: now,
    createdByUid: actorUid,
    createdByUser: actorName,
    updatedAt: now,
    updatedByUid: actorUid,
    updatedByUser: actorName,
  });

  return cleanJson({
    id: fieldAccountDataId,
    premise: buildPremiseSnapshot(premiseId, premise),
    geography: buildGeography(premise),
    owner: cleanOwner(payload?.owner || {}),
    occupant: cleanOccupant(payload?.occupant || {}),
    accounts,
    media: Array.isArray(payload?.media) ? payload.media : [],
    processing: {
      accountMasterStatus: "PENDING",
      accountMasterIds: [],
      errorCode: "NAv",
      errorMessage: "NAv",
      processedAt: "NAv",
    },
    metadata,
  });
}

export function buildAccountMasterDoc({
  accountMasterId,
  accountNoNormalized,
  fieldData = {},
  existingAccountMaster = null,
  now = new Date().toISOString(),
} = {}) {
  const existingMetadata = existingAccountMaster?.metadata || {};
  const fieldMetadata = fieldData?.metadata || {};

  return cleanJson({
    id: accountMasterId,
    account: {
      accountNo: accountNoNormalized,
      accountNoNormalized,
    },
    premise: fieldData?.premise || {},
    geography: fieldData?.geography || {},
    owner: fieldData?.owner || cleanOwner({}),
    occupant: fieldData?.occupant || cleanOccupant({}),
    refs: {
      latestFieldAccountDataId: fieldData?.id || "NAv",
      billingMasterId: "NAv",
    },
    metadata: buildMetadata({
      createdAt: existingMetadata?.createdAt || now,
      createdByUid:
        existingMetadata?.createdByUid || fieldMetadata?.createdByUid || DATA_CLEANSING_SYSTEM_UID,
      createdByUser:
        existingMetadata?.createdByUser || fieldMetadata?.createdByUser || DATA_CLEANSING_SYSTEM_USER,
      updatedAt: now,
      updatedByUid: DATA_CLEANSING_SYSTEM_UID,
      updatedByUser: "Account Master Sync",
    }),
  });
}

function getAstMeterNo(astData = {}) {
  return normalizeAccountNo(
    astData?.ast?.astData?.astNo ||
      astData?.astData?.astNo ||
      astData?.master?.id ||
      astData?.meterNo ||
      "",
  );
}

function getAstStatusState(astData = {}) {
  return String(astData?.status?.state || astData?.status || "FIELD").toUpperCase();
}

function isRemovedAstMeter(astData = {}) {
  return getAstStatusState(astData) === "REMOVED";
}

function getRegistryMeterStatusState(row = {}) {
  return String(row?.statusState || row?.status?.state || "FIELD").toUpperCase();
}

function isRemovedRegistryMeter(row = {}) {
  return getRegistryMeterStatusState(row) === "REMOVED";
}

function getRegistryMeterNo(row = {}) {
  return normalizeAccountNo(row?.meterNo || row?.master?.id || "");
}

export async function getAstMetersForPremise({ db, premiseId }) {
  const snapshot = await db
    .collection("asts")
    .where("accessData.premise.id", "==", premiseId)
    .get();

  return snapshot.docs
    .map((doc) => {
      const data = doc.data() || {};
      const meterNo = getAstMeterNo(data);

      if (!meterNo) return null;
      if (isRemovedAstMeter(data)) return null;

      return {
        meterId: doc.id,
        meterNo,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.meterNo).localeCompare(String(b.meterNo)));
}

export async function getRegistryMetersForPremise({ db, premiseId }) {
  const snapshot = await db
    .collection("registry_meters")
    .where("premiseId", "==", premiseId)
    .get();

  return snapshot.docs
    .map((doc) => {
      const data = doc.data() || {};
      const meterNo = getRegistryMeterNo(data);

      if (!meterNo) return null;
      if (isRemovedRegistryMeter(data)) return null;

      return {
        meterId: data?.meterId || doc.id,
        meterNo,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.meterNo).localeCompare(String(b.meterNo)));
}

function buildMeterKey(item = {}) {
  return `${item?.meterId || "NAv"}|${item?.meterNo || "NAv"}`;
}

export function buildMeterReconciliation({ astMeters = [], registryMeters = [] } = {}) {
  const astKeys = new Set(astMeters.map(buildMeterKey));
  const registryKeys = new Set(registryMeters.map(buildMeterKey));

  const missingRegistryRows = astMeters.filter(
    (item) => !registryKeys.has(buildMeterKey(item)),
  );

  const orphanRegistryRows = registryMeters.filter(
    (item) => !astKeys.has(buildMeterKey(item)),
  );

  const exceptions = [];

  missingRegistryRows.forEach((item) => {
    exceptions.push({
      code: "AST_METER_MISSING_REGISTRY_ROW",
      severity: "WARNING",
      meterId: item.meterId,
      meterNo: item.meterNo,
      message: "AST meter exists for this premise but registry_meters row was not found.",
    });
  });

  orphanRegistryRows.forEach((item) => {
    exceptions.push({
      code: "REGISTRY_METER_NOT_FOUND_IN_ASTS",
      severity: "WARNING",
      meterId: item.meterId,
      meterNo: item.meterNo,
      message: "registry_meters row exists for this premise but matching AST was not found.",
    });
  });

  return {
    status: exceptions.length === 0 ? "BALANCED" : "WARNING",
    exceptions,
    checkedAt: new Date().toISOString(),
  };
}

function getUpdatedAtMs(item = {}) {
  const raw = item?.metadata?.updatedAt || item?.metadata?.createdAt || "";
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

export async function getAccountMastersForPremise({ db, premiseId }) {
  const snapshot = await db
    .collection("account_master")
    .where("premise.premiseId", "==", premiseId)
    .get();

  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .sort((a, b) => getUpdatedAtMs(b) - getUpdatedAtMs(a));
}

export function buildRegistryAccountsRow({
  premiseId,
  premise = {},
  accountMasters = [],
  astMeters = [],
  registryMeters = [],
  existingRegistry = null,
  latestFieldAccountDataId = "NAv",
} = {}) {
  const latestMaster = accountMasters[0] || {};
  const accountMasterIds = accountMasters.map((item) => item.id).filter(Boolean);
  const accounts = accountMasters
    .map((item) => ({ accountNo: item?.account?.accountNoNormalized || item?.account?.accountNo || "" }))
    .filter((item) => item.accountNo)
    .sort((a, b) => String(a.accountNo).localeCompare(String(b.accountNo)));

  const now = new Date().toISOString();
  const existingMetadata = existingRegistry?.metadata || {};
  const reconciliation = buildMeterReconciliation({ astMeters, registryMeters });

  const resolvedLatestFieldAccountDataId =
    latestFieldAccountDataId && latestFieldAccountDataId !== "NAv"
      ? latestFieldAccountDataId
      : latestMaster?.refs?.latestFieldAccountDataId || "NAv";

  return cleanJson({
    id: premiseId,
    premise: buildPremiseSnapshot(premiseId, premise),
    geography: buildGeography(premise),
    owner: latestMaster?.owner || cleanOwner({}),
    occupant: latestMaster?.occupant || cleanOccupant({}),
    accounts,
    meters: astMeters,
    refs: {
      accountMasterIds,
      latestFieldAccountDataId: resolvedLatestFieldAccountDataId,
      billingMasterIds: [],
    },
    reconciliation,
    export: {
      lastExportBatchId: existingRegistry?.export?.lastExportBatchId || "NAv",
      lastExportedAt: existingRegistry?.export?.lastExportedAt || "NAv",
      lastExportedByUid: existingRegistry?.export?.lastExportedByUid || "NAv",
      lastExportedByUser: existingRegistry?.export?.lastExportedByUser || "NAv",
    },
    metadata: buildMetadata({
      createdAt: existingMetadata?.createdAt || now,
      createdByUid: existingMetadata?.createdByUid || DATA_CLEANSING_SYSTEM_UID,
      createdByUser: existingMetadata?.createdByUser || "Account Registry Sync",
      updatedAt: now,
      updatedByUid: DATA_CLEANSING_SYSTEM_UID,
      updatedByUser: "Account Registry Sync",
    }),
  });
}

export async function rebuildRegistryAccountsForPremise({
  premiseId,
  latestFieldAccountDataId = "NAv",
} = {}) {
  const db = getFirestore();

  if (!premiseId || premiseId === "NAv") {
    throw new Error("premiseId is required to rebuild registry_accounts");
  }

  const premiseRef = db.collection("premises").doc(premiseId);
  const registryRef = db.collection("registry_accounts").doc(premiseId);
  const premiseSnap = await premiseRef.get();

  if (!premiseSnap.exists) {
    await registryRef.delete().catch(() => null);

    logger.warn("rebuildRegistryAccountsForPremise -- premise missing, row removed", {
      premiseId,
    });

    return null;
  }

  const premise = premiseSnap.data() || {};
  const existingRegistrySnap = await registryRef.get();
  const accountMasters = await getAccountMastersForPremise({ db, premiseId });
  const astMeters = await getAstMetersForPremise({ db, premiseId });
  const registryMeters = await getRegistryMetersForPremise({ db, premiseId });

  const row = buildRegistryAccountsRow({
    premiseId,
    premise,
    accountMasters,
    astMeters,
    registryMeters,
    existingRegistry: existingRegistrySnap.exists ? existingRegistrySnap.data() : null,
    latestFieldAccountDataId,
  });

  await registryRef.set(row, { merge: true });

  logger.info("rebuildRegistryAccountsForPremise -- SUCCESS", {
    premiseId,
    accountsCount: row.accounts.length,
    metersCount: row.meters.length,
    reconciliationStatus: row.reconciliation.status,
  });

  return row;
}

export function mergeAccountRefs(existingRefs = [], newRefs = []) {
  const map = new Map();

  for (const item of Array.isArray(existingRefs) ? existingRefs : []) {
    const accountMasterId = String(item?.accountMasterId || "").trim();
    if (!accountMasterId) continue;
    map.set(accountMasterId, { accountMasterId });
  }

  for (const item of Array.isArray(newRefs) ? newRefs : []) {
    const accountMasterId = String(item?.accountMasterId || "").trim();
    if (!accountMasterId) continue;
    map.set(accountMasterId, { accountMasterId });
  }

  return Array.from(map.values()).sort((a, b) =>
    String(a.accountMasterId).localeCompare(String(b.accountMasterId)),
  );
}
