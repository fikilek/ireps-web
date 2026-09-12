import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { collection, onSnapshot, query, where } from "firebase/firestore";

import { db, functions } from "../firebase";
import { httpsCallable } from "firebase/functions";
import { useMemo, useSyncExternalStore } from "react";
import { getDefaultSalesMonth } from "../pages/sales/models/salesMonthModel.js";
import { skipToken } from "@reduxjs/toolkit/query";
import { useAuth } from "../auth/useAuth";
import { inspectSalesTbRefsIntegrity } from "../pages/sales/models/salesTbRefsIntegrityModel";
import {
  getGovernedCategoryMonths,
  normalizeSalesMonthlyCategories,
  projectSalesCategoryMonth,
} from "../pages/sales/models/salesCategoryModel";

const SALES_COLLECTION = "sales-all-meters";
const STREAM_RELEASE_DELAY_MS = 1_000;
const MAX_UPDATE_DIAGNOSTIC_LOGS = 10;

const salesStreams = new Map();
let salesSession = { uid: null, generation: 0 };
const sessionSubscribers = new Set();
const sessionCleanups = new Set();
const subscribeSession = listener => { sessionSubscribers.add(listener); return () => sessionSubscribers.delete(listener); };
export const getSalesReadSession = () => salesSession;
export function isSalesReadScopeCurrent(scope) {
  return Boolean(scope?.uid) && scope.uid === salesSession.uid && scope.session === salesSession.generation;
}
export function registerSalesSessionCleanup(cleanup) {
  sessionCleanups.add(cleanup);
  return () => sessionCleanups.delete(cleanup);
}
export function setSalesReadSession(uid) {
  if (salesSession.uid === uid) return false;
  salesSession = { uid, generation: salesSession.generation + 1 };
  for (const cleanup of sessionCleanups) cleanup();
  sessionCleanups.clear();
  for (const stream of salesStreams.values()) {
    stream.closed = true;
    clearTimeout(stream.releaseTimer);
    stream.unsubscribeFirestore();
    for (const subscriber of stream.subscribers) subscriber.onError?.({ status: "CUSTOM_ERROR", error: "Sales session ended." });
  }
  salesStreams.clear();
  for (const listener of sessionSubscribers) listener();
  return true;
}
export function useSalesReadScope(lmPcode) {
  const { uid } = useAuth();
  const session = useSyncExternalStore(subscribeSession, getSalesReadSession);
  return useMemo(() => uid && uid === session.uid
    ? { uid, session: session.generation, lmPcode }
    : null, [uid, session, lmPcode]);
}
function salesStreamKey(scope) { return JSON.stringify([scope.uid, scope.session, scope.lmPcode]); }

function asNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function hasFiniteNumber(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}



function normalizeNumberMap(value = {}) {
  return Object.entries(value || {}).reduce((accumulator, [key, itemValue]) => {
    accumulator[key] = asNumber(itemValue);
    return accumulator;
  }, {});
}

function normalizeRandMapToCents(value = {}) {
  return Object.entries(value || {}).reduce((accumulator, [key, itemValue]) => {
    accumulator[key] = Math.round(asNumber(itemValue) * 100);
    return accumulator;
  }, {});
}

function getSortedMonthKeys(monthlySalesC = {}, monthlyUnits = {}) {
  return Array.from(
    new Set([
      ...Object.keys(monthlySalesC || {}),
      ...Object.keys(monthlyUnits || {}),
    ]),
  ).sort((left, right) => String(right).localeCompare(String(left)));
}

function sumValues(valueMap = {}) {
  return Object.values(valueMap || {}).reduce(
    (total, value) => total + asNumber(value),
    0,
  );
}

function sumLatestMonths(monthlySalesC, monthKeys, count) {
  return monthKeys
    .slice(0, count)
    .reduce(
      (total, monthKey) => total + asNumber(monthlySalesC?.[monthKey]),
      0,
    );
}

function sumCalendarYear(monthlySalesC, year) {
  const prefix = `${year}-`;

  return Object.entries(monthlySalesC || {}).reduce(
    (total, [monthKey, value]) =>
      String(monthKey).startsWith(prefix) ? total + asNumber(value) : total,
    0,
  );
}

function getMonthsWithoutSales(monthlySalesC, monthKeys) {
  let count = 0;

  for (const monthKey of monthKeys) {
    if (asNumber(monthlySalesC?.[monthKey]) > 0) break;
    count += 1;
  }

  return count;
}

function getLastPositiveSalesMonth(monthlySalesC, monthKeys) {
  return (
    monthKeys.find((monthKey) => asNumber(monthlySalesC?.[monthKey]) > 0) ||
    null
  );
}

function normalizeErfCandidate(candidate = {}) {
  const rawLatitude = candidate.Latitude ?? candidate.latitude;
  const rawLongitude = candidate.Longitude ?? candidate.longitude;
  const latitude = Number(rawLatitude);
  const longitude = Number(rawLongitude);

  return {
    erfId: String(candidate.ErfId || candidate.erfId || ""),
    erfNumber: String(candidate.ErfNumber || candidate.erfNumber || ""),
    wardNumber: String(candidate.WardNumber || candidate.wardNumber || ""),
    wardPcode: String(candidate.WardPcode || candidate.wardPcode || ""),
    lmPcode: String(candidate.LmPcode || candidate.lmPcode || ""),
    latitude,
    longitude,
    hasValidGps:
      hasFiniteNumber(rawLatitude) &&
      hasFiniteNumber(rawLongitude) &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180,
  };
}

function uniqueNonBlank(values = []) {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  ).sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }),
  );
}

function normalizeGeofenceRefs(value = []) {
  const seen = new Set();

  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const id = String(item?.id || "").trim();
      const name = String(item?.name || id).trim();

      if (!id) return null;

      return {
        id,
        name: name || id,
      };
    })
    .filter((item) => {
      if (!item?.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((left, right) =>
      String(left.name || left.id).localeCompare(
        String(right.name || right.id),
        undefined,
        { numeric: true, sensitivity: "base" },
      ),
    );
}

function toSerializableValue(value) {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value ?? null;
  }

  if (value instanceof Date) {
    const milliseconds = value.getTime();
    return Number.isFinite(milliseconds) ? value.toISOString() : null;
  }

  if (
    typeof value?.toMillis === "function" ||
    typeof value?.toDate === "function" ||
    Number.isFinite(Number(value?.seconds))
  ) {
    return toSerializableTimestamp(value);
  }

  if (
    value?.constructor?.name === "GeoPoint" &&
    hasFiniteNumber(value.latitude) &&
    hasFiniteNumber(value.longitude)
  ) {
    return {
      latitude: Number(value.latitude),
      longitude: Number(value.longitude),
    };
  }

  if (
    value?.constructor?.name === "DocumentReference" &&
    typeof value.path === "string"
  ) {
    return value.path;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toSerializableValue(item));
  }

  if (typeof value === "object") {
    return Object.entries(value).reduce((accumulator, [key, itemValue]) => {
      accumulator[key] = toSerializableValue(itemValue);
      return accumulator;
    }, {});
  }

  return String(value);
}

function toSerializableTimestamp(value) {
  const milliseconds = getTimestampMs(value);
  return milliseconds > 0 ? new Date(milliseconds).toISOString() : null;
}

function normalizeFieldWork(value) {
  if (!value || typeof value !== "object") return null;

  const serializableValue = toSerializableValue(value);

  return {
    ...serializableValue,
    submittedAt: toSerializableTimestamp(value.submittedAt),
    updatedAt: toSerializableTimestamp(value.updatedAt),
  };
}

function normalizeAuthoritativeAddress(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      strNo: "",
      strName: "",
      strType: "",
    };
  }

  return {
    strNo: String(value.strNo ?? ""),
    strName: String(value.strName ?? ""),
    strType: String(value.strType ?? ""),
  };
}

function normalizeTbRefs(value = []) {
  const seen = new Set();

  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const id = String(item?.id || item?.tbId || "").trim();
      const rowId = String(item?.rowId || item?.tbRowId || "").trim();

      if (!id) return null;

      return {
        ...toSerializableValue(item),
        id,
        rowId: rowId || null,
        date: toSerializableTimestamp(
          item?.date ?? item?.addedAt ?? item?.createdAt ?? null,
        ),
        fieldWork: normalizeFieldWork(item?.fieldWork),
      };
    })
    .filter((item) => {
      if (!item) return false;
      const key = `${item.id}::${item.rowId || ""}`;

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => {
      const leftDate = String(left?.date || "");
      const rightDate = String(right?.date || "");
      const dateComparison = rightDate.localeCompare(leftDate);

      if (dateComparison !== 0) return dateComparison;

      return String(left.id).localeCompare(String(right.id), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
}

function getTimestampMs(value) {
  if (!value) return 0;

  if (typeof value?.toMillis === "function") {
    const milliseconds = Number(value.toMillis());
    return Number.isFinite(milliseconds) ? milliseconds : 0;
  }

  if (typeof value?.toDate === "function") {
    const milliseconds = value.toDate().getTime();
    return Number.isFinite(milliseconds) ? milliseconds : 0;
  }

  if (Number.isFinite(Number(value?.seconds))) {
    const seconds = Number(value.seconds);
    const nanoseconds = Number(value?.nanoseconds || 0);
    return seconds * 1000 + nanoseconds / 1_000_000;
  }

  const milliseconds = new Date(value).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : 0;
}

export function normalizeSalesRow(id, data = {}) {
  const monthlySalesC =
    data.monthlySalesC && typeof data.monthlySalesC === "object"
      ? normalizeNumberMap(data.monthlySalesC)
      : normalizeRandMapToCents(data.Sales);

  const monthlyUnits =
    data.monthlyUnits && typeof data.monthlyUnits === "object"
      ? normalizeNumberMap(data.monthlyUnits)
      : normalizeNumberMap(data.Units);

  const monthlyCategories = normalizeSalesMonthlyCategories(
    data.monthlyCategories,
  );
  const categoryRow = { monthlyCategories };
  const categoryMonthKeys = getGovernedCategoryMonths(categoryRow);

  const monthKeys = getSortedMonthKeys(monthlySalesC, monthlyUnits);
  const latestMonthKey = monthKeys[0] || "";
  const earliestMonthKey = monthKeys[monthKeys.length - 1] || "";

  const derivedTotalSalesC = Math.round(sumValues(monthlySalesC));
  const derivedTotalUnits = sumValues(monthlyUnits);
  const derivedSales3MonthsC = sumLatestMonths(monthlySalesC, monthKeys, 3);
  const derivedSales6MonthsC = sumLatestMonths(monthlySalesC, monthKeys, 6);
  const derivedSales12MonthsC = sumLatestMonths(monthlySalesC, monthKeys, 12);
  const derivedSales2024C = sumCalendarYear(monthlySalesC, 2024);
  const derivedSales2025C = sumCalendarYear(monthlySalesC, 2025);
  const rawTbRefs = data.tbRefs !== undefined ? data.tbRefs : data.TbRefs;
  const derivedSales2026C = sumCalendarYear(monthlySalesC, 2026);

  const customerName = data.customerName || data.customerSurname || data.Customer || data.Surname || "";

  const erfNumbers = Array.isArray(data.ErfNumbers)
    ? data.ErfNumbers
    : Array.isArray(data.erfNumbers)
      ? data.erfNumbers
      : [];

  const rawCandidates = Array.isArray(data.ErfCandidates)
    ? data.ErfCandidates
    : Array.isArray(data.erfCandidates)
      ? data.erfCandidates
      : [];

  const erfCandidates = rawCandidates.map(normalizeErfCandidate);
  const wardNumbers = uniqueNonBlank(
    erfCandidates.map((candidate) => candidate.wardNumber),
  );

  return {
    id,
    meterNo: String(
      data.meterNo || data.meterNoNormalized || data.MeterNumber || id || "NAv",
    ),
    meterNoNormalized: String(
      data.meterNoNormalized || data.meterNo || data.MeterNumber || id || "NAv",
    ),
    addressLine1: String(
      data.addressLine1 || data.AddressLine1 || data.PostalAddress1 || "",
    ),
    addressLine2: String(
      data.addressLine2 || data.AddressLine2 || data.PostalAddress2 || "",
    ),
    town: String(data.town || data.Town || data.PostalAddressTown || "NAv"),
    adr: normalizeAuthoritativeAddress(data.adr),
    standNumber: String(
      data.standNumber || data.StandNumber || erfNumbers[0] || "",
    ),
    sgCode: String(data.sgCode || "").trim(),
    erfNo: String(data.erfNo || "").trim(),
    accountNumber: String(data.accountNo ?? data.accountNumber ?? data.AccountNumber ?? ""),
    customerName: String(customerName),
    lmPcode: String(data.lmPcode || ""),
    provider: data.provider ?? null,
    customerNo: data.customerNo ?? null,
    customerSurname: data.customerSurname ?? null,
    accountNo: data.accountNo ?? null,
    accountNormalized: data.accountNormalized ?? null,
    monthlyTotalsC: normalizeNumberMap(data.monthlyTotalsC),
    totalAmountC: data.totalAmountC ?? null,
    salesStatus: data.salesStatus ?? null,
    previousMeterNumber: data.previousMeterNumber ?? null,
    installationDate: data.installationDate ?? null,
    previousInstallationDate: data.previousInstallationDate ?? null,
    metadata: data.metadata ? {
      createdAt: toSerializableTimestamp(data.metadata.createdAt),
      createdByUid: data.metadata.createdByUid ?? null,
      createdByUser: data.metadata.createdByUser ?? null,
      updatedAt: toSerializableTimestamp(data.metadata.updatedAt),
      updatedByUid: data.metadata.updatedByUid ?? null,
      updatedByUser: data.metadata.updatedByUser ?? null,
    } : null,
    createdAt: toSerializableTimestamp(data.metadata?.createdAt),
    updatedAt: toSerializableTimestamp(data.metadata?.updatedAt),
    createdAtMs: getTimestampMs(data.metadata?.createdAt),
    updatedAtMs: getTimestampMs(data.metadata?.updatedAt),
    demoData: data.demoData ?? null,
    masterVisibility:
      typeof data?.master?.visibility === "string"
        ? data.master.visibility
        : null,
    astId: data.astId || null,
    astMatchStatus: String(data.astMatchStatus || "NOT_CHECKED"),
    proposedTrnType: data.proposedTrnType || null,
    lastPositiveSalesMonth:
      data.lastPositiveSalesMonth ||
      getLastPositiveSalesMonth(monthlySalesC, monthKeys),
    monthsWithoutSales: hasFiniteNumber(data.monthsWithoutSales)
      ? asNumber(data.monthsWithoutSales)
      : getMonthsWithoutSales(monthlySalesC, monthKeys),
    latestMonthSalesC: hasFiniteNumber(data.latestMonthSalesC)
      ? asNumber(data.latestMonthSalesC)
      : asNumber(monthlySalesC?.[latestMonthKey]),
    sales3MonthsC: hasFiniteNumber(data.sales3MonthsC)
      ? asNumber(data.sales3MonthsC)
      : derivedSales3MonthsC,
    sales6MonthsC: hasFiniteNumber(data.sales6MonthsC)
      ? asNumber(data.sales6MonthsC)
      : derivedSales6MonthsC,
    sales12MonthsC: hasFiniteNumber(data.sales12MonthsC)
      ? asNumber(data.sales12MonthsC)
      : derivedSales12MonthsC,
    latest12MonthsSalesC: hasFiniteNumber(data.latest12MonthsSalesC)
      ? asNumber(data.latest12MonthsSalesC)
      : derivedSales12MonthsC,
    sales2024C: hasFiniteNumber(data.sales2024C)
      ? asNumber(data.sales2024C)
      : derivedSales2024C,
    sales2025C: hasFiniteNumber(data.sales2025C)
      ? asNumber(data.sales2025C)
      : derivedSales2025C,
    sales2026C: hasFiniteNumber(data.sales2026C)
      ? asNumber(data.sales2026C)
      : derivedSales2026C,
    totalSalesC: hasFiniteNumber(data.totalSalesC)
      ? asNumber(data.totalSalesC)
      : derivedTotalSalesC,
    totalUnits: hasFiniteNumber(data.totalUnits)
      ? asNumber(data.totalUnits)
      : derivedTotalUnits,
    monthlySalesC,
    monthlyUnits,
    monthlyCategories,
    categoryMonthKeys,
    salesPeriodFrom: String(data.salesPeriodFrom || earliestMonthKey),
    salesPeriodTo: String(data.salesPeriodTo || latestMonthKey),
    sourceFileName: String(data.sourceFileName || ""),
    sourceRow: asNumber(data.sourceRow || data.SourceEndRow),
    erfNumbers,
    erfCandidates,
    wardNumbers,
    wardNumberLabel: wardNumbers.length ? wardNumbers.join(", ") : "NAv",
    gpsMatchStatus: String(data.GpsMatchStatus || data.gpsMatchStatus || ""),
    // Match the geofence creation trigger's lowercase Firestore eligibility gate.
    geofenceGpsEligible: data.hasUsableGps === true,
    gpsAvailable: typeof data.hasUsableGps === "boolean" || typeof data.HasUsableGps === "boolean" || erfCandidates.some(candidate => candidate.hasValidGps),
    hasUsableGps:
      data.HasUsableGps === true ||
      data.hasUsableGps === true ||
      erfCandidates.some((candidate) => candidate.hasValidGps),
    geofenceRefs: normalizeGeofenceRefs(
      data.geofenceRefs || data.GeoFenceRefs || [],
    ),
    // Preserve absent/null/string distinctions without serializing malformed
    // objects (for example a Timestamp) into apparently valid scalar IDs.
    ...(Object.hasOwn(data, "targetedBatchId")
      ? data.targetedBatchId === null || typeof data.targetedBatchId === "string"
        ? { targetedBatchId: data.targetedBatchId }
        : { targetedBatchIdInvalid: true }
      : {}),
    tbRefs: normalizeTbRefs(rawTbRefs),
    tbRefsIntegrity: inspectSalesTbRefsIntegrity(rawTbRefs),
    trnBatchIds: uniqueNonBlank(
      Array.isArray(data.trnBatchIds) ? data.trnBatchIds : [],
    ),
  };
}

function sortSalesRows(left, right) {
  const updatedAtComparison =
    Number(right?.updatedAtMs || 0) - Number(left?.updatedAtMs || 0);

  if (updatedAtComparison !== 0) return updatedAtComparison;

  return String(left?.meterNo || "").localeCompare(
    String(right?.meterNo || ""),
    undefined,
    {
      numeric: true,
      sensitivity: "base",
    },
  );
}

function normalizeLmPcode(value) {
  return String(value || "").trim();
}

function normalizeSnapshotDocument(documentSnapshot, lmPcode) {
  const row = normalizeSalesRow(
    documentSnapshot.id,
    documentSnapshot.data(),
  );

  return row.lmPcode === lmPcode ? row : null;
}

function buildRowsFromStream(stream) {
  return Array.from(stream.rowsById.values()).sort(sortSalesRows);
}

function createSalesStream(scope) {
  const normalizedLmPcode = normalizeLmPcode(scope.lmPcode);
  const startedAtMs = Date.now();

  const stream = {
    key: salesStreamKey(scope),
    scope,
    lmPcode: normalizedLmPcode,
    subscribers: new Set(),
    rowsById: new Map(),
    latestRows: null,
    latestError: null,
    initialized: false,
    serverConfirmed: false,
    updateDiagnosticCount: 0,
    releaseTimer: null,
    unsubscribeFirestore: () => {},
  };

  const salesQuery = query(
    collection(db, SALES_COLLECTION),
    where("lmPcode", "==", normalizedLmPcode),
  );

  stream.unsubscribeFirestore = onSnapshot(
    salesQuery,
    (snapshot) => {
      if (stream.closed || !isSalesReadScopeCurrent(scope)) return;
      const normalizationStartedAtMs = Date.now();
      const isInitialSnapshot = !stream.initialized;
      const changes = isInitialSnapshot
        ? snapshot.docs.map((documentSnapshot) => ({
            type: "added",
            doc: documentSnapshot,
          }))
        : snapshot.docChanges();

      for (const change of changes) {
        const documentId = change.doc.id;

        if (change.type === "removed") {
          stream.rowsById.delete(documentId);
          continue;
        }

        const normalizedRow = normalizeSnapshotDocument(
          change.doc,
          normalizedLmPcode,
        );

        if (normalizedRow) {
          stream.rowsById.set(documentId, normalizedRow);
        } else {
          stream.rowsById.delete(documentId);
        }
      }

      stream.initialized = true;
      stream.latestRows = buildRowsFromStream(stream);
      stream.latestError = null;

      const fromCache = snapshot.metadata?.fromCache === true;
      const normalizationMs = Date.now() - normalizationStartedAtMs;
      const elapsedMs = Date.now() - startedAtMs;

      if (isInitialSnapshot) {
        console.info("[salesApi] Sales stream first snapshot", {
          lmPcode: normalizedLmPcode,
          rows: stream.latestRows.length,
          fromCache,
          elapsedMs,
          normalizationMs,
        });
      } else if (
        changes.length > 0 &&
        stream.updateDiagnosticCount < MAX_UPDATE_DIAGNOSTIC_LOGS
      ) {
        stream.updateDiagnosticCount += 1;

        console.info("[salesApi] Sales stream update", {
          lmPcode: normalizedLmPcode,
          changedDocuments: changes.length,
          rows: stream.latestRows.length,
          fromCache,
          normalizationMs,
          diagnosticNumber: stream.updateDiagnosticCount,
          diagnosticLimit: MAX_UPDATE_DIAGNOSTIC_LOGS,
        });
      }

      if (!fromCache && !stream.serverConfirmed) {
        stream.serverConfirmed = true;

        console.info("[salesApi] Sales stream server confirmed", {
          lmPcode: normalizedLmPcode,
          rows: stream.latestRows.length,
          elapsedMs,
        });
      }

      for (const subscriber of stream.subscribers) {
        subscriber.onRows?.({
          rows: stream.latestRows,
          fromCache,
          serverConfirmed: stream.serverConfirmed,
        });
      }
    },
    (error) => {
      if (stream.closed || !isSalesReadScopeCurrent(scope)) return;
      stream.latestRows = null;
      stream.latestError = {
        status: "CUSTOM_ERROR",
        error: error?.message || "Could not load Sales.",
      };

      console.error("[salesApi] Sales stream error", {
        lmPcode: normalizedLmPcode,
        code: error?.code || null,
        message: stream.latestError.error,
      });

      for (const subscriber of stream.subscribers) {
        subscriber.onError?.(stream.latestError);
      }
    },
  );

  salesStreams.set(stream.key, stream);
  return stream;
}

function getOrCreateSalesStream(scope) {
  const existingStream = salesStreams.get(salesStreamKey(scope));

  if (existingStream?.latestError) {
    clearTimeout(existingStream.releaseTimer);
    existingStream.closed = true;
    existingStream.unsubscribeFirestore();
    const replacement = createSalesStream(scope);
    replacement.subscribers = existingStream.subscribers;
    return replacement;
  }

  if (existingStream) {
    if (existingStream.releaseTimer) {
      clearTimeout(existingStream.releaseTimer);
      existingStream.releaseTimer = null;
    }

    return existingStream;
  }

  return createSalesStream(scope);
}

function scheduleSalesStreamRelease(stream) {
  stream = salesStreams.get(stream.key) || stream;
  if (stream.subscribers.size > 0 || stream.releaseTimer) return;

  stream.releaseTimer = setTimeout(() => {
    if (stream.subscribers.size > 0) {
      stream.releaseTimer = null;
      return;
    }

    stream.unsubscribeFirestore();
    if (salesStreams.get(stream.key) === stream) salesStreams.delete(stream.key);
  }, STREAM_RELEASE_DELAY_MS);
}

function subscribeToSalesStream(
  scope,
  { onRows = null, onError = null } = {},
) {
  const stream = getOrCreateSalesStream(scope);
  const subscriber = { onRows, onError };

  stream.subscribers.add(subscriber);

  if (stream.latestRows) {
    onRows?.({
      rows: stream.latestRows,
      fromCache: !stream.serverConfirmed,
      serverConfirmed: stream.serverConfirmed,
    });
  } else if (stream.latestError) {
    onError?.(stream.latestError);
  }

  return () => {
    stream.subscribers.delete(subscriber);
    scheduleSalesStreamRelease(stream);
  };
}

function readInitialSalesStream(scope, signal) {
  const normalizedLmPcode = normalizeLmPcode(scope?.lmPcode);

  if (!normalizedLmPcode || !isSalesReadScopeCurrent(scope)) {
    return Promise.resolve({ error: { status: "CUSTOM_ERROR", error: "Sales read scope is unavailable." } });
  }

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
          error: "Sales stream request was cancelled.",
        },
      });
    };

    if (signal?.aborted) {
      handleAbort();
      return;
    }

    signal?.addEventListener("abort", handleAbort, { once: true });

    const streamUnsubscribe = subscribeToSalesStream(
      scope,
      {
        onRows: ({ rows, fromCache }) => {
          const hasUsableInitialResult = !fromCache || rows.length > 0;

          if (!hasUsableInitialResult) return;
          finish({ data: { rows, streamError: null } });
        },
        onError: (error) => finish({ error }),
      },
    );

    unsubscribe = streamUnsubscribe;

    if (settled) {
      unsubscribe();
    }
  });
}

export const salesApi = createApi({
  reducerPath: "salesApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getSalesGovernance: builder.query({
      async queryFn({ lmPcode }) {
        try { return { data: (await httpsCallable(functions, "getSalesGovernedMonths")({ lmPcode, provider: "contour" })).data }; }
        catch (error) { return { error: { status: "CUSTOM_ERROR", error: error.message } }; }
      },
      keepUnusedDataFor: 60,
    }),
    getSalesByLmPcode: builder.query({
      queryFn: (scope, { signal }) =>
        readInitialSalesStream(scope, signal),

      async onCacheEntryAdded(
        scope,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const normalizedLmPcode = normalizeLmPcode(scope.lmPcode);

        if (!normalizedLmPcode || !isSalesReadScopeCurrent(scope)) return;

        let cacheReady = false;
        let latestRows = null;
        let latestError = null;

        const unsubscribe = subscribeToSalesStream(scope, {
          onRows: ({ rows }) => {
            latestRows = rows;
            latestError = null;

            if (cacheReady) {
              updateCachedData(() => ({ rows, streamError: null }));
            }
          },
          onError: (error) => {
            latestRows = null;
            latestError = error;
            if (cacheReady && isSalesReadScopeCurrent(scope)) updateCachedData(() => ({ rows: [], streamError: error }));
            console.error("[salesApi] Cache stream error", {
              lmPcode: normalizedLmPcode,
              message: error?.error || "Unknown Sales stream error.",
            });
          },
        });

        try {
          await cacheDataLoaded;
          cacheReady = true;

          if (!isSalesReadScopeCurrent(scope)) return;
          if (latestError) updateCachedData(() => ({ rows: [], streamError: latestError }));

          if (latestRows) {
            updateCachedData(() => ({ rows: latestRows, streamError: null }));
          }

          await cacheEntryRemoved;
        } catch (error) {
          console.error("[salesApi] Cache lifecycle error", {
            lmPcode: normalizedLmPcode,
            message: error?.message || String(error),
          });
        } finally {
          unsubscribe();
        }
      },

      keepUnusedDataFor: 300,
    }),
  }),
});

export function useGetSalesGovernanceQuery(scope, options) {
  const readScope = useSalesReadScope(scope?.lmPcode);
  const enabled = readScope && scope !== skipToken && scope?.lmPcode && !options?.skip;
  const result = salesApi.useGetSalesGovernanceQuery(enabled ? readScope : skipToken, options);
  return { ...result, data: enabled ? result.currentData : undefined, currentData: enabled ? result.currentData : undefined };
}
export function useGetSalesByLmPcodeQuery(scope, options) {
  const readScope = useSalesReadScope(scope?.lmPcode);
  const raw = salesApi.useGetSalesByLmPcodeQuery(readScope && scope !== skipToken && scope?.lmPcode ? readScope : skipToken, options);
  const enabled = readScope && scope !== skipToken && scope?.lmPcode && !options?.skip;
  const current = enabled ? raw.currentData : undefined;
  const error = raw.error || current?.streamError;
  const rows = !enabled || error ? undefined : current?.rows;
  return { ...raw, data: rows, currentData: rows, error,
    isError: Boolean(error), isSuccess: raw.isSuccess && !error,
    status: error ? "rejected" : raw.status };
}

export function useGetSalesCategoryViewQuery(scope, options) {
  const raw = useGetSalesByLmPcodeQuery(scope, options);
  const readScope = useSalesReadScope(scope?.lmPcode);
  const scopeKey = readScope ? JSON.stringify(readScope) : "";
  const defaultMonth = useMemo(() => { void scopeKey; return getDefaultSalesMonth(); }, [scopeKey]);
  const month = scope?.month === undefined ? defaultMonth : scope.month;
  const rows = useMemo(() => raw.currentData?.map(row => projectSalesCategoryMonth(row, month)), [raw.currentData, month]);
  return { ...raw, data: rows, currentData: rows, categoryMonth: month };
}
