import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { collection, getDocs } from "firebase/firestore";

import { db } from "../firebase";

const DEMO_SALES_COLLECTION = "demo_sales_meters";

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

function normalizeDemoSalesRow(id, data = {}, requestedLmPcode = "") {
  const monthlySalesC =
    data.monthlySalesC && typeof data.monthlySalesC === "object"
      ? normalizeNumberMap(data.monthlySalesC)
      : normalizeRandMapToCents(data.Sales);

  const monthlyUnits =
    data.monthlyUnits && typeof data.monthlyUnits === "object"
      ? normalizeNumberMap(data.monthlyUnits)
      : normalizeNumberMap(data.Units);

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
  const derivedSales2026C = sumCalendarYear(monthlySalesC, 2026);

  const customerName = data.customerName || data.Customer || data.Surname || "";

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
    standNumber: String(
      data.standNumber || data.StandNumber || erfNumbers[0] || "",
    ),
    accountNumber: String(data.accountNumber || data.AccountNumber || ""),
    customerName: String(customerName),
    lmPcode: String(data.lmPcode || requestedLmPcode || ""),
    demoData: data.demoData !== false,
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
    salesPeriodFrom: String(data.salesPeriodFrom || earliestMonthKey),
    salesPeriodTo: String(data.salesPeriodTo || latestMonthKey),
    sourceFileName: String(data.sourceFileName || "END 2026-07-29.xlsx"),
    sourceRow: asNumber(data.sourceRow || data.SourceEndRow),
    erfNumbers,
    erfCandidates,
    wardNumbers,
    wardNumberLabel: wardNumbers.length ? wardNumbers.join(", ") : "NAv",
    gpsMatchStatus: String(data.GpsMatchStatus || data.gpsMatchStatus || ""),
    hasUsableGps:
      data.HasUsableGps === true ||
      data.hasUsableGps === true ||
      erfCandidates.some((candidate) => candidate.hasValidGps),
    geofenceRefs: normalizeGeofenceRefs(
      data.geofenceRefs || data.GeoFenceRefs || [],
    ),
    trnBatchIds: Array.isArray(data.trnBatchIds) ? data.trnBatchIds : [],
  };
}

function sortDemoSalesRows(left, right) {
  return String(left.meterNo).localeCompare(String(right.meterNo), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export const demoSalesApi = createApi({
  reducerPath: "demoSalesApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getDemoSalesByLmPcode: builder.query({
      async queryFn(lmPcode) {
        if (!lmPcode) return { data: [] };

        try {
          const snapshot = await getDocs(collection(db, DEMO_SALES_COLLECTION));

          const rows = snapshot.docs
            .map((documentSnapshot) =>
              normalizeDemoSalesRow(
                documentSnapshot.id,
                documentSnapshot.data(),
                lmPcode,
              ),
            )
            .filter((row) => row.lmPcode === lmPcode)
            .sort(sortDemoSalesRows);

          return { data: rows };
        } catch (error) {
          console.error("demoSalesApi query error:", error);

          return {
            error: {
              status: "CUSTOM_ERROR",
              error: error?.message || "Could not load demo prepaid sales.",
            },
          };
        }
      },
      keepUnusedDataFor: 300,
    }),
  }),
});

export const { useGetDemoSalesByLmPcodeQuery } = demoSalesApi;
