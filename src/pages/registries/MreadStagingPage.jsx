import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  query,
  where,
} from "firebase/firestore";

import { useAuth } from "../../auth/useAuth";
import {
  useListMreadStagingSessionsQuery,
  useListMreadStagingRowsQuery,
} from "../../redux/mreadStagingApi";
import { useListMreadStagingCyclesQuery } from "../../redux/mreadStagingCyclesApi";
import { useGetRegistryMreadByWardQuery } from "../../redux/registryMreadApi";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";
import { useGetWardBoundariesByLmQuery } from "../../redux/mapWardsApi";
import { useGeo } from "../../context/GeoContext";
import DownloadButtons from "../../components/DownloadButtons";
import RegistryIdText from "../../components/RegistryIdText";
import SharedMeterHistoryModal from "../../components/mread/MeterHistoryModal";

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 5;
const ROWS_FETCH_LIMIT = 1000;
const DEFAULT_TABLE_SORT = { key: "", direction: "asc" };
const NAv = "NAv";

function safeText(value, fallback = NAv) {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function formatNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toLocaleString() : NAv;
}

function formatDateTime(value) {
  if (!value || value === NAv) return NAv;

  if (typeof value === "string") {
    const text = value.trim();
    if (!text || text === NAv) return NAv;
    return text.slice(0, 19).replace("T", " ");
  }

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? value.toLocaleString() : NAv;
  }

  if (typeof value?.toDate === "function") {
    return value.toDate().toLocaleString();
  }

  const seconds = value?.seconds ?? value?._seconds;
  if (typeof seconds === "number") {
    return new Date(seconds * 1000).toLocaleString();
  }

  return NAv;
}

function markJsxOnlyComponentUsage(...components) {
  return components.length;
}

function isMeaningfulText(value) {
  const text = safeText(value, "");
  return Boolean(text && text !== NAv && text.toUpperCase() !== "ALL");
}

function getActiveLmPcode(activeWorkbase) {
  return (
    activeWorkbase?.lmPcode ||
    activeWorkbase?.pcode ||
    activeWorkbase?.id ||
    activeWorkbase?.localMunicipalityId ||
    ""
  );
}

function getWardLabel(ward) {
  if (!ward) return NAv;

  const wardNumber = safeText(ward.wardNumber || ward.code, "");
  if (wardNumber && wardNumber !== NAv) return `Ward ${wardNumber}`;

  return safeText(ward.wardName || ward.name || ward.wardPcode);
}

function getWardPcode(ward) {
  return safeText(ward?.wardPcode || ward?.pcode || ward?.id || ward?.code, "");
}

function formatWardLabelFromNumber(value) {
  const text = safeText(value, "");
  if (!text || text === NAv) return "";

  const wardTextMatch = text.match(/^ward\s+(\d{1,3})$/i);
  if (wardTextMatch?.[1]) return `Ward ${Number(wardTextMatch[1])}`;

  if (/^\d{1,3}$/.test(text)) {
    const numberValue = Number(text);
    return Number.isFinite(numberValue) && numberValue > 0
      ? `Ward ${numberValue}`
      : "";
  }

  return "";
}

function getWardLabelForPcode(wardPcode, wardRows = []) {
  const cleanWardPcode = safeText(wardPcode, "");
  if (!cleanWardPcode || cleanWardPcode === NAv) return NAv;

  const directWardLabel = formatWardLabelFromNumber(cleanWardPcode);
  if (directWardLabel) return directWardLabel;

  const matchedWard = wardRows.find(
    (ward) => getWardPcode(ward) === cleanWardPcode,
  );
  if (matchedWard) return getWardLabel(matchedWard);

  const wardNumberMatch = cleanWardPcode.match(/(\d{1,3})$/);
  if (wardNumberMatch?.[1]) {
    const wardNumber = Number(wardNumberMatch[1]);
    if (Number.isFinite(wardNumber) && wardNumber > 0)
      return `Ward ${wardNumber}`;
  }

  return cleanWardPcode;
}

function getRowWardLabel(row, wardRows = []) {
  const directWardLabel =
    formatWardLabelFromNumber(row?.wardNo) ||
    formatWardLabelFromNumber(row?.wardNumber);

  if (directWardLabel) return directWardLabel;

  return getWardLabelForPcode(
    row?.wardPcode ||
      row?.geography?.wardPcode ||
      row?.ward ||
      row?.wardCode ||
      row?.pcode,
    wardRows,
  );
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function includesText(value, filterValue) {
  const filterText = normalizeText(filterValue);
  if (!filterText) return true;
  return normalizeText(value).includes(filterText);
}

function firstValue(...values) {
  for (const value of values) {
    if (value === 0) return value;
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return value;
    }
  }

  return null;
}

function firstMeaningfulText(...values) {
  for (const value of values) {
    if (isMeaningfulText(value)) return String(value).trim();
  }

  return NAv;
}

function firstText(...values) {
  const value = firstValue(...values);
  return safeText(value);
}

function firstMeaningfulValue(...values) {
  for (const value of values) {
    if (value === 0) return value;
    if (isMeaningfulText(value)) return value;
  }

  return null;
}

function formatReading(value) {
  if (value === 0 || value === "0") return "0";
  if (value === null || value === undefined || value === "") return NAv;
  return String(value);
}

function getTableFilterValue(row, key) {
  if (key === "meterNo") return getMeterNo(row);
  if (key === "premiseType")
    return safeText(row?.premiseType || row?.propertyType, "");

  if (["currentReading", "prevReading", "consumption"].includes(key)) {
    const rawValue = row?.[key];
    const dateValue =
      key === "currentReading"
        ? formatReadingTimestamp(getCurrentReadingDateTime(row))
        : key === "prevReading"
          ? formatReadingTimestamp(getPreviousReadingDateTime(row))
          : "";

    return `${safeText(rawValue, "")} ${formatNumber(rawValue)} ${dateValue}`.trim();
  }

  return safeText(row?.[key], "");
}

function getUniqueFilterOptions(rows, key) {
  return Array.from(
    new Set(
      rows
        .map((row) => getTableFilterValue(row, key))
        .filter((value) => value && value !== NAv),
    ),
  ).sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true }),
  );
}

function formatTableValue(row, key, actions = {}) {
  if (key === "meterNo") {
    const meterNo = getMeterNo(row);

    return (
      <button
        type="button"
        className="text-link"
        style={meterNoButtonStyle}
        onClick={() => actions.onMeterClick?.(row)}
        title="Open meter details and reading history"
      >
        {meterNo}
      </button>
    );
  }

  if (key === "currentReading") {
    return (
      <ReadingValueWithDate
        value={row?.currentReading}
        dateTime={getCurrentReadingDateTime(row)}
      />
    );
  }

  if (key === "prevReading") {
    return (
      <ReadingValueWithDate
        value={row?.prevReading}
        dateTime={getPreviousReadingDateTime(row)}
      />
    );
  }

  if (
    [
      "consumption",
      "successfulReads",
      "unsuccessful",
      "noAccess",
      "mediaEvidence",
    ].includes(key)
  ) {
    return formatNumber(row?.[key]);
  }

  return safeText(row?.[key]);
}

function compareNatural(left, right) {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left || "").localeCompare(String(right || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function getNumberSortValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(numberValue) ? numberValue : null;
}

function getWardSortValue(value) {
  const match = safeText(value, "").match(/(\d{1,3})/);
  const numberValue = Number(match?.[1] || 0);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

function getTableSortValue(row, key) {
  if (
    [
      "currentReading",
      "prevReading",
      "consumption",
      "successfulReads",
      "unsuccessful",
      "noAccess",
      "mediaEvidence",
    ].includes(key)
  ) {
    return getNumberSortValue(row?.[key]);
  }

  if (key === "meterNo") return getMeterNo(row);
  if (key === "wardLabel") return getWardSortValue(row?.wardLabel);
  if (key === "premiseType")
    return safeText(row?.premiseType || row?.propertyType, "");

  return safeText(row?.[key], "");
}

function sortTableRows(rows, sortConfig) {
  if (!sortConfig?.key) return rows;

  const directionMultiplier = sortConfig.direction === "desc" ? -1 : 1;

  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftValue = getTableSortValue(left.row, sortConfig.key);
      const rightValue = getTableSortValue(right.row, sortConfig.key);
      const leftMissing =
        leftValue === null ||
        leftValue === undefined ||
        leftValue === "" ||
        leftValue === NAv;
      const rightMissing =
        rightValue === null ||
        rightValue === undefined ||
        rightValue === "" ||
        rightValue === NAv;

      if (leftMissing && rightMissing) return left.index - right.index;
      if (leftMissing) return 1;
      if (rightMissing) return -1;

      const result = compareNatural(leftValue, rightValue);
      if (result !== 0) return result * directionMultiplier;

      return left.index - right.index;
    })
    .map((item) => item.row);
}

function SortButton({ label, sortKey, sortConfig, onSort }) {
  const isActive = sortConfig.key === sortKey;
  const directionLabel = isActive
    ? sortConfig.direction === "asc"
      ? "↑"
      : "↓"
    : "↕";

  return (
    <button
      type="button"
      style={sortButtonStyle}
      onClick={() => onSort(sortKey)}
    >
      <span>{label}</span>
      <span aria-hidden="true">{directionLabel}</span>
    </button>
  );
}

function mergeWardOptions(...wardSources) {
  const byPcode = new Map();

  wardSources.flat().forEach((ward) => {
    const wardPcode = getWardPcode(ward);
    if (!wardPcode || wardPcode === NAv) return;

    byPcode.set(wardPcode, {
      ...(byPcode.get(wardPcode) || {}),
      ...ward,
      id: wardPcode,
      pcode: wardPcode,
      wardPcode,
    });
  });

  return Array.from(byPcode.values()).sort((left, right) => {
    const leftNumber = Number(left.wardNumber || left.code || 0);
    const rightNumber = Number(right.wardNumber || right.code || 0);

    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber - rightNumber;
    }

    return getWardLabel(left).localeCompare(getWardLabel(right));
  });
}

function readCycleGeneratedAt(cycle) {
  return (
    cycle?.lastGenerated?.generatedAt ||
    cycle?.lastGenerated?.at ||
    cycle?.metadata?.updatedAt ||
    null
  );
}

function buildSessionFromCycle(cycle) {
  const stagingId = safeText(cycle?.activeStagingId, "");
  if (!isMeaningfulText(stagingId)) return null;

  const summary = cycle?.summary || {};

  return {
    id: stagingId,
    stagingId,
    tableId: stagingId,
    tableStatus: safeText(cycle?.status),
    cycleId: safeText(cycle?.cycleId),
    lmPcode: safeText(cycle?.lmPcode),
    windowDisplay: safeText(cycle?.window?.display),
    generatedAt: readCycleGeneratedAt(cycle),
    generatedByUser: safeText(cycle?.lastGenerated?.generatedByUser),
    generationIteration: Number(cycle?.lastGenerated?.iteration || 0),
    rowCount: Number(summary?.totalRows || 0),
    successfulReads: Number(summary?.successfulReads || 0),
    noAccess: Number(summary?.noAccess || 0),
    unsuccessful: Number(summary?.unsuccessful || 0),
    mediaEvidence: Number(summary?.mediaEvidence || 0),
    source: "cycle",
  };
}

function hasUsableValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return isMeaningfulText(value);
  return true;
}

function pickValue(...values) {
  return values.find(hasUsableValue);
}

function getCurrentReadingDateTime(row = {}) {
  return pickValue(
    row.currentReadingAt,
    row.currentReadingDateTime,
    row.currentReadingDate,
    row.currentReadAt,
    row.currentReadDate,
    row.readingAt,
    row.readingDate,
    row.current?.readingAt,
    row.current?.readingDate,
    row.currentReading?.readingAt,
    row.currentReading?.readingDate,
    row.reading?.currentReadingAt,
    row.reading?.currentReadingDate,
    row.reading?.readingAt,
    row.raw?.currentReadingAt,
    row.raw?.currentReadingDate,
    row.raw?.readingAt,
    row.raw?.reading?.currentReadingAt,
    row.raw?.reading?.currentReadingDate,
    row.raw?.reading?.readingAt,
  );
}

function getPreviousReadingDateTime(row = {}) {
  return pickValue(
    row.prevReadingAt,
    row.prevReadingDateTime,
    row.prevReadingDate,
    row.previousReadingAt,
    row.previousReadingDateTime,
    row.previousReadingDate,
    row.previousReadAt,
    row.previousReadDate,
    row.baseReadingAt,
    row.baseReadingDate,
    row.previous?.readingAt,
    row.previous?.readingDate,
    row.prev?.readingAt,
    row.prev?.readingDate,
    row.base?.readingAt,
    row.base?.readingDate,
    row.previousReading?.readingAt,
    row.previousReading?.readingDate,
    row.reading?.prevReadingAt,
    row.reading?.prevReadingDate,
    row.reading?.previousReadingAt,
    row.reading?.previousReadingDate,
    row.raw?.prevReadingAt,
    row.raw?.prevReadingDate,
    row.raw?.previousReadingAt,
    row.raw?.previousReadingDate,
    row.raw?.reading?.prevReadingAt,
    row.raw?.reading?.prevReadingDate,
    row.raw?.reading?.previousReadingAt,
    row.raw?.reading?.previousReadingDate,
  );
}

function formatReadingTimestamp(value) {
  const display = formatDateTime(value);
  return display === NAv ? NAv : display;
}

function ReadingValueWithDate({ value, dateTime }) {
  return (
    <div style={readingValueStackStyle}>
      <strong>{formatNumber(value)}</strong>
      <span style={readingMetaStyle}>{formatReadingTimestamp(dateTime)}</span>
    </div>
  );
}

function getMeterNo(row = {}) {
  return firstText(
    row.meterNo,
    row.astNo,
    row?.meter?.astNo,
    row?.meter?.meterNo,
    row?.meterSnapshot?.astNo,
    row?.meterSnapshot?.meterNo,
    row?.ast?.astData?.astNo,
    row?.ast?.astData?.meterNo,
    row?.raw?.meterNo,
    row?.raw?.astNo,
    row?.raw?.meter?.astNo,
    row?.raw?.meter?.meterNo,
  );
}

function getAstId(row = {}) {
  return firstMeaningfulText(
    row.astId,
    row?.refs?.astId,
    row.astDocId,
    row?.refs?.astDocId,
    row.astRef,
    row.astPath,
    row.sourceAstId,
    row.sourceAstDocId,
    row.meterAstId,
    row.assetId,
    row?.meter?.astId,
    row?.meter?.astDocId,
    row?.meter?.ref,
    row?.meter?.path,
    row?.source?.astId,
    row?.source?.astDocId,
    row?.source?.sourceAstId,
    row?.meterSnapshot?.astId,
    row?.meterSnapshot?.astDocId,
    row?.ast?.id,
    row?.ast?.astId,
    row?.ast?.docId,
    row?.ast?.path,
    row?.astSnapshot?.id,
    row?.astSnapshot?.astId,
    row?.raw?.astId,
    row?.raw?.refs?.astId,
    row?.raw?.astDocId,
    row?.raw?.refs?.astDocId,
    row?.raw?.astRef,
    row?.raw?.astPath,
    row?.raw?.sourceAstId,
    row?.raw?.meterAstId,
    row?.raw?.meter?.astId,
    row?.raw?.meter?.astDocId,
    row?.raw?.source?.astId,
    row?.raw?.source?.astDocId,
  );
}

function normalizeAstDocId(value) {
  if (!isMeaningfulText(value)) return "";

  const astPath = String(value).trim();
  if (astPath.startsWith("asts/")) return astPath.split("/").pop();
  if (astPath.includes("/asts/")) {
    const parts = astPath.split("/asts/").pop().split("/");
    return parts[0] || "";
  }

  return astPath;
}

function getAstDocIdFromRow(row = {}) {
  return normalizeAstDocId(getAstId(row));
}

function getAstDocIdFromRegistryRows(registryRows = [], selectedRow = {}) {
  const selectedAstId = getAstDocIdFromRow(selectedRow);
  if (selectedAstId) return selectedAstId;

  const selectedMeterNo = normalizeText(getMeterNo(selectedRow));
  if (!selectedMeterNo) return "";

  const matchedRow = registryRows.find((registryRow) => {
    const registryMeterNo = normalizeText(getMeterNo(registryRow));
    return registryMeterNo && registryMeterNo === selectedMeterNo;
  });

  return matchedRow ? getAstDocIdFromRow(matchedRow) : "";
}

const AST_METER_NO_LOOKUP_FIELDS = [
  "astNo",
  "meterNo",
  "master.id",
  "ast.astData.astNo",
  "ast.astData.meterNo",
  "ast.astData.meter.meterNo",
  "accessData.meterNo",
  "accessData.meter.astNo",
];

async function fetchAstByMeterNo(db, meterNo) {
  if (!isMeaningfulText(meterNo)) return null;

  for (const fieldName of AST_METER_NO_LOOKUP_FIELDS) {
    const astQuery = query(
      collection(db, "asts"),
      where(fieldName, "==", meterNo),
      limit(1),
    );
    const astSnap = await getDocs(astQuery);
    const firstDoc = astSnap.docs[0];

    if (firstDoc) {
      return {
        id: firstDoc.id,
        ...firstDoc.data(),
      };
    }
  }

  return null;
}

function getOutcome(row = {}) {
  return firstText(
    row?.outcome?.outcome,
    row.outcome,
    row.executionOutcome?.outcome,
  );
}

function getOutcomeLabel(outcome) {
  if (outcome === "SUCCESSFUL_READING") return "Successful Reading";
  if (outcome === "UNSUCCESSFUL_READING") return "Unsuccessful Reading";
  if (outcome === "NO_ACCESS") return "No Access";
  return outcome || NAv;
}

function getCompletedAt(row = {}) {
  return firstValue(
    row.completedAt,
    row?.source?.completedAt,
    row?.metadata?.completedAt,
  );
}

function getReadingAt(row = {}) {
  const outcome = getOutcome(row);
  const readingAt = firstMeaningfulValue(
    row.readingAt,
    row?.reading?.readingAt,
  );

  if (outcome === "SUCCESSFUL_READING") {
    return firstMeaningfulValue(readingAt, getCompletedAt(row));
  }

  return null;
}

function getReasonText(row = {}) {
  const outcome = getOutcome(row);

  if (outcome === "NO_ACCESS") {
    return firstMeaningfulText(
      row.noAccessReason,
      row.reasonText,
      row.outcomeReasonText,
      row?.outcome?.noAccessReason,
      row?.outcome?.reasonText,
      row?.raw?.outcome?.noAccessReason,
      row?.raw?.outcome?.reasonText,
    );
  }

  if (outcome === "UNSUCCESSFUL_READING") {
    return firstMeaningfulText(
      row.unsuccessfulReason,
      row.reasonText,
      row.outcomeReasonText,
      row?.outcome?.unsuccessfulReason,
      row?.outcome?.reasonText,
      row?.raw?.outcome?.unsuccessfulReason,
      row?.raw?.outcome?.reasonText,
    );
  }

  return NAv;
}

function getCurrentReading(row = {}) {
  return firstValue(
    row.currentReading,
    row?.reading?.currentReading,
    row.reading,
  );
}

function getPreviousReading(row = {}) {
  return firstValue(
    row.previousReading,
    row.prevReading,
    row?.reading?.previousReading,
  );
}

function getConsumption(row = {}) {
  return firstValue(row.consumption, row?.reading?.consumption);
}

function getSincePreviousReadingDisplay(row = {}) {
  if (getOutcome(row) !== "SUCCESSFUL_READING") return NAv;

  const display = firstValue(
    row.sincePreviousReadingDisplay,
    row.daysSinceLastReadingDisplay,
    row?.sincePreviousReading?.display,
    row?.daysSinceLastReading?.display,
    row?.reading?.sincePreviousReading?.display,
    row?.reading?.daysSinceLastReading?.display,
    row?.raw?.reading?.sincePreviousReading?.display,
    row?.raw?.reading?.daysSinceLastReading?.display,
    row["reading.sincePreviousReading.display"],
    row["reading.daysSinceLastReading.display"],
  );

  if (display) return safeText(display);

  const value = firstValue(
    row.sincePreviousReading,
    row.daysSinceLastReading,
    row?.reading?.sincePreviousReading,
    row?.reading?.daysSinceLastReading,
  );
  if (!value) return NAv;
  if (typeof value === "string") return safeText(value);
  if (typeof value === "object") return safeText(value.display);

  return safeText(value);
}

function getSincePreviousReadingMinutes(row = {}) {
  if (getOutcome(row) !== "SUCCESSFUL_READING") return 0;

  const minutes = Number(
    firstValue(
      row.sincePreviousReadingMinutes,
      row.daysSinceLastReadingMinutes,
      row?.sincePreviousReading?.totalMinutes,
      row?.daysSinceLastReading?.totalMinutes,
      row?.reading?.sincePreviousReading?.totalMinutes,
      row?.reading?.daysSinceLastReading?.totalMinutes,
      row?.raw?.reading?.sincePreviousReading?.totalMinutes,
      row?.raw?.reading?.daysSinceLastReading?.totalMinutes,
    ),
  );

  return Number.isFinite(minutes) ? minutes : 0;
}

function getCapturedByName(row = {}) {
  return firstText(row.capturedByName, row?.actor?.capturedByName);
}

function getCapturedByUid(row = {}) {
  return firstText(row.capturedByUid, row?.actor?.capturedByUid);
}

function getMeterTypeLabel(value) {
  const text = safeText(value, "").toLowerCase();
  if (text === "electricity") return "Electricity";
  if (text === "water") return "Water";
  return value || NAv;
}

function getAstMeterNo(astDoc = {}) {
  return firstText(
    astDoc?.astNo,
    astDoc?.meterNo,
    astDoc?.ast?.astData?.astNo,
    astDoc?.ast?.astData?.meterNo,
    astDoc?.master?.id,
  );
}

function getAstMeterType(astDoc = {}) {
  return firstText(astDoc?.meterType, astDoc?.ast?.astData?.meter?.serviceType);
}

function getAstMeterKind(astDoc = {}) {
  return firstText(
    astDoc?.meterKind,
    astDoc?.ast?.astData?.meter?.kind,
    astDoc?.ast?.astData?.meter?.type,
  );
}

function getAstStatus(astDoc = {}) {
  return firstText(astDoc?.statusState, astDoc?.status?.state);
}

function getAstPremiseAddress(astDoc = {}) {
  return firstText(
    astDoc?.premiseAddress,
    astDoc?.accessData?.premise?.address,
  );
}

function getAstPremiseId(astDoc = {}) {
  return firstText(astDoc?.premiseId, astDoc?.accessData?.premise?.id);
}

function getAstErfNo(astDoc = {}) {
  return firstText(astDoc?.erfNo, astDoc?.accessData?.erfNo);
}

function getAstWardPcode(astDoc = {}) {
  return firstText(astDoc?.wardPcode, astDoc?.accessData?.parents?.wardPcode);
}

function getAstUpdatedAt(astDoc = {}) {
  return firstValue(
    astDoc?.updatedAt,
    astDoc?.metadata?.updatedAt,
    astDoc?.__updateTime__,
  );
}

const BASELINE_READING_SOURCES = new Set([
  "AST_CREATION",
  "METER_DISCOVERY",
  "METER_INSTALLATION",
]);

function isBaselineReadingSource(source = "") {
  return BASELINE_READING_SOURCES.has(
    String(source || "")
      .trim()
      .toUpperCase(),
  );
}

function getAstMreadings(astDoc = {}) {
  const readings = Array.isArray(astDoc?.mreadings) ? astDoc.mreadings : [];

  const sortedReadings = readings
    .map((item, index) => {
      const readingValue = firstText(item?.reading, item?.currentReading);
      const readingNumber = Number(readingValue);
      const source = firstText(item?.source);
      const storedSincePreviousReadingDisplay = firstText(
        item?.sincePreviousReadingDisplay,
        item?.daysSinceLastReadingDisplay,
        item?.sincePreviousReading?.display,
        item?.daysSinceLastReading?.display,
        item?.["sincePreviousReading.display"],
        item?.["daysSinceLastReading.display"],
      );
      const rawSincePreviousReadingMinutes = Number(
        firstValue(
          item?.sincePreviousReadingMinutes,
          item?.daysSinceLastReadingMinutes,
          item?.sincePreviousReading?.totalMinutes,
          item?.daysSinceLastReading?.totalMinutes,
          item?.["sincePreviousReading.totalMinutes"],
          item?.["daysSinceLastReading.totalMinutes"],
        ),
      );
      const isBaselineReading = isBaselineReadingSource(source);

      return {
        raw: item,
        index,
        key: `${item?.trnId || "mread"}-${item?.readingAt || index}`,
        readingAt: firstValue(
          item?.readingAt,
          item?.completedAt,
          item?.createdAt,
        ),
        reading: readingValue,
        readingNumber: Number.isFinite(readingNumber) ? readingNumber : null,
        trnId: firstText(item?.trnId, item?.sourceTrnId),
        source,
        outcomeLabel: isBaselineReading
          ? "Baseline Reading"
          : "Successful Reading",
        reason: NAv,
        capturedBy: firstText(
          item?.capturedByName,
          item?.capturedBy?.name,
          item?.actor?.name,
          item?.createdByUser,
          item?.updatedByUser,
        ),
        capturedByUid: firstText(
          item?.capturedByUid,
          item?.capturedBy?.uid,
          item?.actor?.uid,
          item?.createdByUid,
          item?.updatedByUid,
        ),
        sincePreviousReadingDisplay:
          storedSincePreviousReadingDisplay !== NAv
            ? storedSincePreviousReadingDisplay
            : isBaselineReading
              ? "0"
              : NAv,
        sincePreviousReadingMinutes: Number.isFinite(
          rawSincePreviousReadingMinutes,
        )
          ? rawSincePreviousReadingMinutes
          : isBaselineReading
            ? 0
            : null,
      };
    })
    .filter((item) => item.readingAt || item.readingNumber !== null)
    .sort((a, b) =>
      String(b.readingAt || "").localeCompare(String(a.readingAt || "")),
    );

  return sortedReadings.map((item, index) => {
    const previousRow = sortedReadings[index + 1] || null;
    const previousReading = previousRow?.readingNumber ?? null;
    const consumption =
      item.readingNumber !== null && previousReading !== null
        ? item.readingNumber - previousReading
        : null;

    return {
      ...item,
      previousReading,
      consumption,
    };
  });
}

function isSameMeterHistoryTarget(row = {}, selectedRow = {}) {
  const selectedAstId = getAstDocIdFromRow(selectedRow);
  const rowAstId = getAstDocIdFromRow(row);

  if (isMeaningfulText(selectedAstId) && isMeaningfulText(rowAstId)) {
    return selectedAstId === rowAstId;
  }

  const selectedMeterNo = getMeterNo(selectedRow);
  const rowMeterNo = getMeterNo(row);

  return (
    isMeaningfulText(selectedMeterNo) &&
    isMeaningfulText(rowMeterNo) &&
    normalizeText(selectedMeterNo) === normalizeText(rowMeterNo)
  );
}

function getRegistryMreadHistoryRows(registryRows = [], selectedRow = {}) {
  return registryRows
    .filter((registryRow) => isSameMeterHistoryTarget(registryRow, selectedRow))
    .map((registryRow, index) => {
      const outcome = getOutcome(registryRow);
      const isSuccessfulReading = outcome === "SUCCESSFUL_READING";
      const trnId = firstText(
        registryRow.trnId,
        registryRow?.source?.trnId,
        registryRow.id,
      );
      const currentReading = getCurrentReading(registryRow);
      const currentReadingNumber = Number(currentReading);
      const previousReading = getPreviousReading(registryRow);
      const previousReadingNumber = Number(previousReading);
      const consumption = getConsumption(registryRow);
      const consumptionNumber = Number(consumption);
      const completedAt = firstMeaningfulValue(getCompletedAt(registryRow));
      const readingAt = isSuccessfulReading
        ? firstMeaningfulValue(getReadingAt(registryRow), completedAt)
        : completedAt;

      return {
        raw: registryRow,
        index,
        key: `registry-${trnId || registryRow?.id || index}`,
        readingAt,
        completedAt,
        reading:
          isSuccessfulReading && Number.isFinite(currentReadingNumber)
            ? currentReading
            : NAv,
        readingNumber:
          isSuccessfulReading && Number.isFinite(currentReadingNumber)
            ? currentReadingNumber
            : null,
        previousReading:
          isSuccessfulReading && Number.isFinite(previousReadingNumber)
            ? previousReadingNumber
            : null,
        consumption:
          isSuccessfulReading && Number.isFinite(consumptionNumber)
            ? consumptionNumber
            : null,
        trnId,
        source: outcome === "NO_ACCESS" ? "NO_ACCESS" : "METER_READING",
        outcomeLabel: getOutcomeLabel(outcome),
        reason: getReasonText(registryRow),
        capturedBy: getCapturedByName(registryRow),
        capturedByUid: getCapturedByUid(registryRow),
        sincePreviousReadingDisplay: isSuccessfulReading
          ? getSincePreviousReadingDisplay(registryRow)
          : NAv,
        sincePreviousReadingMinutes: isSuccessfulReading
          ? getSincePreviousReadingMinutes(registryRow)
          : null,
      };
    });
}

function getReadingAtMs(value) {
  if (!value || value === NAv) return null;

  if (typeof value?.toDate === "function") {
    const millis = value.toDate().getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  const seconds = value?.seconds ?? value?._seconds;
  if (typeof seconds === "number") {
    const millis = seconds * 1000;
    return Number.isFinite(millis) ? millis : null;
  }

  const millis = Date.parse(String(value));
  return Number.isFinite(millis) ? millis : null;
}

function mergeMeterHistoryRows({
  astRows = [],
  registryRows = [],
  selectedRow = {},
} = {}) {
  const mergedRows = [];
  const seenTrnIds = new Set();

  getRegistryMreadHistoryRows(registryRows, selectedRow).forEach((item) => {
    const trnId = firstMeaningfulText(item.trnId, "");
    if (trnId) seenTrnIds.add(trnId);
    mergedRows.push(item);
  });

  astRows.forEach((item, index) => {
    const trnId = firstMeaningfulText(item.trnId, "");

    if (trnId && seenTrnIds.has(trnId)) return;
    if (trnId) seenTrnIds.add(trnId);

    mergedRows.push({
      ...item,
      key: `ast-${item.key || item.trnId || index}`,
      outcomeLabel: item.outcomeLabel || "Successful Reading",
      reason: item.reason || NAv,
    });
  });

  return mergedRows.sort((a, b) => {
    const bTime = getReadingAtMs(firstValue(b.readingAt, b.completedAt));
    const aTime = getReadingAtMs(firstValue(a.readingAt, a.completedAt));

    if (aTime !== null && bTime !== null) return bTime - aTime;
    if (bTime !== null) return 1;
    if (aTime !== null) return -1;

    return compareNatural(String(b.readingAt || ""), String(a.readingAt || ""));
  });
}

function formatSummaryMetric(value) {
  if (value === null || value === undefined || value === "") return NAv;

  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return NAv;

  const roundedValue =
    Math.abs(numberValue) >= 100
      ? Math.round(numberValue)
      : Number(numberValue.toFixed(2));

  return roundedValue.toLocaleString();
}

function buildMeterReadingSummary(historyRows = []) {
  const validRows = historyRows
    .filter((item) => item?.readingNumber !== null)
    .map((item, index) => ({
      ...item,
      readingAtMs: getReadingAtMs(item?.readingAt),
      originalIndex: index,
    }))
    .sort((a, b) => {
      if (a.readingAtMs !== null && b.readingAtMs !== null) {
        return a.readingAtMs - b.readingAtMs;
      }

      if (a.readingAtMs !== null) return -1;
      if (b.readingAtMs !== null) return 1;

      return b.originalIndex - a.originalIndex;
    });

  const firstRow = validRows[0] || null;
  const lastRow = validRows[validRows.length - 1] || null;
  const firstReading = firstRow?.readingNumber ?? null;
  const lastReading = lastRow?.readingNumber ?? null;
  const totalConsumption =
    firstReading !== null && lastReading !== null
      ? lastReading - firstReading
      : null;

  const elapsedDays =
    firstRow?.readingAtMs !== null &&
    lastRow?.readingAtMs !== null &&
    lastRow?.readingAtMs > firstRow?.readingAtMs
      ? (lastRow.readingAtMs - firstRow.readingAtMs) / 86400000
      : null;

  const averagePerDay =
    totalConsumption !== null && elapsedDays !== null && elapsedDays > 0
      ? totalConsumption / elapsedDays
      : null;

  return {
    firstReading,
    lastReading,
    totalConsumption,
    averagePerDay,
    averagePerWeek: averagePerDay !== null ? averagePerDay * 7 : null,
    averagePerMonth: averagePerDay !== null ? averagePerDay * 30.4375 : null,
    averagePerYear: averagePerDay !== null ? averagePerDay * 365.25 : null,
  };
}

function CompactDetailLine({ label, value }) {
  const displayValue =
    value === null || value === undefined || value === "" ? NAv : String(value);

  return (
    <div style={detailLineStyle}>
      <span style={detailLabelStyle}>{label}</span>
      {label.toLowerCase().includes("id") ||
      label.toLowerCase().includes("pcode") ? (
        <RegistryIdText value={displayValue} />
      ) : (
        <strong>{displayValue}</strong>
      )}
    </div>
  );
}

function MeterHistoryModal({ row, registryRows = [], onClose }) {
  const astId = getAstDocIdFromRegistryRows(registryRows, row);
  const meterNo = getMeterNo(row);
  const [astState, setAstState] = useState({
    loading: true,
    error: "",
    ast: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadAst() {
      setAstState({ loading: true, error: "", ast: null });

      try {
        const db = getFirestore();
        let astDoc = null;

        if (astId) {
          const astSnap = await getDoc(doc(db, "asts", astId));

          if (cancelled) return;

          if (astSnap.exists()) {
            astDoc = {
              id: astSnap.id,
              ...astSnap.data(),
            };
          }
        }

        if (!astDoc) {
          astDoc = await fetchAstByMeterNo(db, meterNo);
          if (cancelled) return;
        }

        if (!astDoc) {
          setAstState({
            loading: false,
            error: isMeaningfulText(meterNo)
              ? `Meter AST not found for meter number ${meterNo}.`
              : "No AST ID or meter number available on this staging row.",
            ast: null,
          });
          return;
        }

        setAstState({
          loading: false,
          error: "",
          ast: astDoc,
        });
      } catch (error) {
        if (cancelled) return;
        setAstState({
          loading: false,
          error: error?.message || "Could not load meter details.",
          ast: null,
        });
      }
    }

    loadAst();

    return () => {
      cancelled = true;
    };
  }, [astId, meterNo]);

  const astDoc = astState.ast || {};
  const historyRows = mergeMeterHistoryRows({
    astRows: getAstMreadings(astDoc),
    registryRows,
    selectedRow: row,
  });
  const readingSummary = buildMeterReadingSummary(historyRows);

  return (
    <div
      style={modalOverlayStyle}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mread-staging-meter-history-title"
    >
      <div style={modalCardLargeStyle}>
        <div style={modalHeaderStyle}>
          <div>
            <p style={modalEyebrowStyle}>Meter Details & Reading History</p>
            <h2 id="mread-staging-meter-history-title" style={{ margin: 0 }}>
              {meterNo}
            </h2>
          </div>

          <button type="button" style={modalCloseButtonStyle} onClick={onClose}>
            Close Meter
          </button>
        </div>

        <div style={modalBodyStyle}>
          {astState.loading ? (
            <div style={loadingBlockStyle} role="status" aria-live="polite">
              <span style={spinnerStyle} aria-hidden="true" />
              <div>
                <h2 style={{ margin: 0 }}>Loading meter details...</h2>
                <p style={mutedTextStyle}>
                  Reading the AST and meter-reading history.
                </p>
              </div>
            </div>
          ) : null}

          {!astState.loading && astState.error ? (
            <div style={emptyStateStyle}>
              <h2 style={{ marginTop: 0 }}>Could not load meter details</h2>
              <p style={mutedTextStyle}>{astState.error}</p>
            </div>
          ) : null}

          {!astState.loading && !astState.error && astDoc ? (
            <div style={meterHistoryStackStyle}>
              <section style={detailsSectionStyle}>
                <h3 style={{ marginTop: 0 }}>Meter Details</h3>
                <div style={detailsTwoColumnGridStyle}>
                  <div>
                    <CompactDetailLine
                      label="Meter No"
                      value={getAstMeterNo(astDoc)}
                    />
                    <CompactDetailLine
                      label="AST ID"
                      value={astDoc.id || astId}
                    />
                    <CompactDetailLine
                      label="Meter Type"
                      value={getMeterTypeLabel(getAstMeterType(astDoc))}
                    />
                    <CompactDetailLine
                      label="Meter Kind"
                      value={getAstMeterKind(astDoc)}
                    />
                    <CompactDetailLine
                      label="Status"
                      value={getAstStatus(astDoc)}
                    />
                  </div>

                  <div>
                    <CompactDetailLine
                      label="Premise Address"
                      value={getAstPremiseAddress(astDoc)}
                    />
                    <CompactDetailLine
                      label="Premise ID"
                      value={getAstPremiseId(astDoc)}
                    />
                    <CompactDetailLine
                      label="ERF No"
                      value={getAstErfNo(astDoc)}
                    />
                    <CompactDetailLine
                      label="Ward Pcode"
                      value={getAstWardPcode(astDoc)}
                    />
                    <CompactDetailLine
                      label="Updated At"
                      value={formatDateTime(getAstUpdatedAt(astDoc))}
                    />
                  </div>
                </div>
              </section>

              <section style={detailsSectionStyle}>
                <div style={readingSummaryGridStyle}>
                  <div style={readingSummaryTileStyle}>
                    <span style={mutedTextStyle}>First Reading</span>
                    <strong>
                      {formatSummaryMetric(readingSummary.firstReading)}
                    </strong>
                  </div>
                  <div style={readingSummaryTileStyle}>
                    <span style={mutedTextStyle}>Last Reading</span>
                    <strong>
                      {formatSummaryMetric(readingSummary.lastReading)}
                    </strong>
                  </div>
                  <div style={readingSummaryTileStyle}>
                    <span style={mutedTextStyle}>Total Consumption</span>
                    <strong>
                      {formatSummaryMetric(readingSummary.totalConsumption)}
                    </strong>
                  </div>
                  <div style={readingSummaryTileStyle}>
                    <span style={mutedTextStyle}>Avg / Day</span>
                    <strong>
                      {formatSummaryMetric(readingSummary.averagePerDay)}
                    </strong>
                  </div>
                  <div style={readingSummaryTileStyle}>
                    <span style={mutedTextStyle}>Avg / Week</span>
                    <strong>
                      {formatSummaryMetric(readingSummary.averagePerWeek)}
                    </strong>
                  </div>
                  <div style={readingSummaryTileStyle}>
                    <span style={mutedTextStyle}>Avg / Month</span>
                    <strong>
                      {formatSummaryMetric(readingSummary.averagePerMonth)}
                    </strong>
                  </div>
                  <div style={readingSummaryTileStyle}>
                    <span style={mutedTextStyle}>Avg / Year</span>
                    <strong>
                      {formatSummaryMetric(readingSummary.averagePerYear)}
                    </strong>
                  </div>
                </div>
              </section>

              <section style={detailsSectionStyle}>
                <div style={sectionHeaderRowStyle}>
                  <div>
                    <h3 style={{ margin: 0 }}>
                      Meter Reading / Attempt History
                    </h3>
                    <p style={mutedTextStyle}>
                      Registry attempts and cached readings for this meter.
                    </p>
                  </div>
                  <span style={statusPillStyle}>
                    {formatNumber(historyRows.length)} attempt(s)
                  </span>
                </div>

                {historyRows.length === 0 ? (
                  <p style={mutedTextStyle}>
                    No registry attempts or cached meter readings found for this
                    meter.
                  </p>
                ) : (
                  <div style={historyTableWrapStyle}>
                    <table style={historyTableStyle}>
                      <thead>
                        <tr>
                          <th style={historyHeaderCellStyle}>Date/Time</th>
                          <th style={historyHeaderCellStyle}>
                            Days Since Last Reading
                          </th>
                          <th style={historyHeaderCellStyle}>Outcome</th>
                          <th style={historyHeaderCellStyle}>Reason</th>
                          <th style={historyHeaderCellStyle}>Reading</th>
                          <th style={historyHeaderCellStyle}>Prev Reading</th>
                          <th style={historyHeaderCellStyle}>Consumption</th>
                          <th style={historyCompactHeaderCellStyle}>Read By</th>
                          <th style={historyTrnHeaderCellStyle}>TRN</th>
                          <th style={historySourceHeaderCellStyle}>Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {historyRows.map((item) => (
                          <tr key={item.key}>
                            <td style={historyCellStyle}>
                              {formatDateTime(item.readingAt)}
                            </td>
                            <td style={historyCellStyle}>
                              {item.sincePreviousReadingDisplay}
                            </td>
                            <td style={historyCellStyle}>
                              {item.outcomeLabel || NAv}
                            </td>
                            <td style={historyCellStyle}>
                              {item.reason || NAv}
                            </td>
                            <td style={historyCellStyle}>
                              <strong>{formatReading(item.reading)}</strong>
                            </td>
                            <td style={historyCellStyle}>
                              {formatReading(item.previousReading)}
                            </td>
                            <td style={historyCellStyle}>
                              <strong>{formatReading(item.consumption)}</strong>
                            </td>
                            <td style={historyCompactCellStyle}>
                              <strong style={historyCompactStrongStyle}>
                                {item.capturedBy}
                              </strong>
                              <div style={secondaryIdCompactStyle}>
                                <RegistryIdText value={item.capturedByUid} />
                              </div>
                            </td>
                            <td style={historyTrnCellStyle}>
                              <div style={historyTrnValueStyle}>
                                <RegistryIdText value={item.trnId} />
                              </div>
                            </td>
                            <td style={historySourceCellStyle}>
                              {item.source}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function normalizeSession(session) {
  if (!session) return null;

  const sessionId = pickValue(session.id, session.stagingId, session.tableId);
  const stagingId = pickValue(session.stagingId, session.tableId, session.id);
  const tableId = pickValue(session.tableId, session.stagingId, session.id);

  return {
    ...session,
    id: sessionId,
    stagingId,
    tableId,
    tableStatus: pickValue(session.tableStatus, session.status),
    cycleId: pickValue(
      session.cycleId,
      session.selectedCycle?.cycleId,
      session.cycle?.cycleId,
    ),
    lmPcode: pickValue(session.lmPcode, session.localMunicipalityPcode),
    windowDisplay: pickValue(
      session.windowDisplay,
      session.window?.display,
      session.selectedCycle?.windowDisplay,
      session.selectedCycle?.window?.display,
      session.cycle?.windowDisplay,
      session.cycle?.window?.display,
    ),
    generatedAt: pickValue(
      session.generatedAt,
      session.generated?.at,
      session.lastGenerated?.generatedAt,
      session.lastGenerated?.at,
      session.metadata?.createdAt,
      session.metadata?.updatedAt,
      session.createdAt,
      session.updatedAt,
    ),
  };
}

function mergeSession(existing, incoming) {
  const base = normalizeSession(existing) || {};
  const next = normalizeSession(incoming) || {};

  return {
    ...base,
    ...next,
    id: pickValue(next.id, base.id),
    stagingId: pickValue(
      next.stagingId,
      next.tableId,
      next.id,
      base.stagingId,
      base.tableId,
      base.id,
    ),
    tableId: pickValue(
      next.tableId,
      next.stagingId,
      next.id,
      base.tableId,
      base.stagingId,
      base.id,
    ),
    tableStatus: pickValue(next.tableStatus, base.tableStatus),
    cycleId: pickValue(next.cycleId, base.cycleId),
    lmPcode: pickValue(next.lmPcode, base.lmPcode),
    windowDisplay: pickValue(next.windowDisplay, base.windowDisplay),
    generatedAt: pickValue(next.generatedAt, base.generatedAt),
  };
}

function parseGeneratedStamp(text) {
  const stampMatch = safeText(text, "").match(/(\d{8})_(\d{6})/);
  if (!stampMatch) return 0;

  const [, datePart, timePart] = stampMatch;
  const isoText = `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}T${timePart.slice(0, 2)}:${timePart.slice(2, 4)}:${timePart.slice(4, 6)}`;
  const parsed = Date.parse(isoText);

  return Number.isFinite(parsed) ? parsed : 0;
}

function parseGeneratedTime(value) {
  if (!hasUsableValue(value)) return 0;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0;
    return value < 1000000000000 ? value * 1000 : value;
  }

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : 0;
  }

  if (typeof value?.toMillis === "function") {
    const time = value.toMillis();
    return Number.isFinite(time) ? time : 0;
  }

  if (typeof value?.toDate === "function") {
    const time = value.toDate().getTime();
    return Number.isFinite(time) ? time : 0;
  }

  const seconds = value?.seconds ?? value?._seconds;
  if (typeof seconds === "number") return seconds * 1000;

  const text = safeText(value, "");
  if (!text || text === NAv) return 0;

  const fromStamp = parseGeneratedStamp(text);
  if (fromStamp) return fromStamp;

  const parsed = Date.parse(text.replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getSessionGeneratedStamp(session) {
  const tableId = safeText(
    session?.tableId || session?.stagingId || session?.id,
    "",
  );
  const stampMatch = tableId.match(/(\d{8}_\d{6})$/);

  return stampMatch?.[1] || "";
}

function formatGeneratedStamp(stamp) {
  const stampMatch = safeText(stamp, "").match(/^(\d{8})_(\d{6})$/);
  if (!stampMatch) return NAv;

  const [, datePart, timePart] = stampMatch;
  return `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)} ${timePart.slice(0, 2)}:${timePart.slice(2, 4)}:${timePart.slice(4, 6)}`;
}

function formatSessionGeneratedAt(session) {
  const directGeneratedAt = pickValue(
    session?.generatedAt,
    session?.generated?.at,
    session?.lastGenerated?.generatedAt,
    session?.lastGenerated?.at,
    session?.metadata?.createdAt,
    session?.metadata?.updatedAt,
    session?.createdAt,
    session?.updatedAt,
  );

  const directDisplay = formatDateTime(directGeneratedAt);
  if (directDisplay !== NAv) return directDisplay;

  return formatGeneratedStamp(getSessionGeneratedStamp(session));
}

function getSessionGeneratedSortTime(session) {
  return (
    parseGeneratedTime(session?.generatedAt) ||
    parseGeneratedStamp(session?.tableId) ||
    parseGeneratedStamp(session?.stagingId) ||
    parseGeneratedStamp(session?.id)
  );
}

function sortSessions(left, right) {
  const leftTime = getSessionGeneratedSortTime(left);
  const rightTime = getSessionGeneratedSortTime(right);

  if (leftTime !== rightTime) return rightTime - leftTime;

  const leftTableId = safeText(
    left?.tableId || left?.stagingId || left?.id,
    "",
  );
  const rightTableId = safeText(
    right?.tableId || right?.stagingId || right?.id,
    "",
  );

  return rightTableId.localeCompare(leftTableId);
}

function getSessionCycleLabel(session) {
  const cycleId = safeText(session?.cycleId, "");
  const cycleMatch =
    cycleId.match(/(?:^|_)CYCLE[_-]?(\d+)$/i) ||
    cycleId.match(/CYCLE[_-]?(\d+)/i);

  if (cycleMatch?.[1]) return `Cycle_${cycleMatch[1]}`;

  const cycleLabel = safeText(
    session?.cycleLabel ||
      session?.cycleName ||
      session?.selectedCycle?.label ||
      session?.selectedCycle?.cycleLabel,
    "",
  );

  return isMeaningfulText(cycleLabel)
    ? cycleLabel.replace(/\s+/g, "_")
    : "Cycle";
}

function getStagingSessionLabel(session) {
  const cycleLabel = getSessionCycleLabel(session);
  const generatedStamp = getSessionGeneratedStamp(session);
  const sessionLabel = generatedStamp
    ? `${cycleLabel}_${generatedStamp}`
    : cycleLabel;
  const windowLabel = safeText(session?.windowDisplay || session?.lmPcode, "");

  return windowLabel ? `${sessionLabel} (${windowLabel})` : sessionLabel;
}

const EMPTY_TABLE_FILTERS = {
  meterNo: "",
  currentReading: "",
  prevReading: "",
  consumption: "",
  premiseAddress: "",
  premiseType: "ALL",
  wardLabel: "ALL",
  geofence: "ALL",
  meterKind: "ALL",
  meterType: "ALL",
};

const TABLE_COLUMNS = [
  {
    key: "meterNo",
    header: "Meter No",
    filterType: "text",
    placeholder: "Meter no",
  },
  {
    key: "currentReading",
    header: "Current",
    filterType: "text",
    placeholder: "Current",
  },
  {
    key: "prevReading",
    header: "Previous",
    filterType: "text",
    placeholder: "Previous",
  },
  {
    key: "consumption",
    header: "Consumption",
    filterType: "text",
    placeholder: "Consumption",
  },
  {
    key: "premiseAddress",
    header: "Address",
    filterType: "text",
    placeholder: "Address",
  },
  { key: "premiseType", header: "Property type", filterType: "select" },
  { key: "wardLabel", header: "Ward", filterType: "select" },
  { key: "geofence", header: "Geofence", filterType: "select" },
  { key: "meterKind", header: "Meter Kind", filterType: "select" },
  { key: "meterType", header: "Meter Type", filterType: "select" },
  { key: "successfulReads", header: "Successful" },
  { key: "unsuccessful", header: "Unsuccessful" },
  { key: "noAccess", header: "No Access" },
  { key: "mediaEvidence", header: "Media" },
];

function LoadingSpinner({
  title = "Loading MREAD staging...",
  message = "Opening Firestore stream.",
} = {}) {
  return (
    <div style={loadingBlockStyle} role="status" aria-live="polite">
      <span style={spinnerStyle} aria-hidden="true" />
      <div>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <p style={mutedTextStyle}>{message}</p>
      </div>
    </div>
  );
}

function PaginationControls({
  currentPage,
  pageSize,
  totalPages,
  totalRows,
  onPageChange,
  onPageSizeChange,
}) {
  if (!totalRows) return null;

  const startRow = (currentPage - 1) * pageSize + 1;
  const endRow = Math.min(currentPage * pageSize, totalRows);

  return (
    <div style={paginationBarStyle}>
      <div style={{ color: "#64748b", whiteSpace: "nowrap" }}>
        Showing {formatNumber(startRow)}-{formatNumber(endRow)} of{" "}
        {formatNumber(totalRows)} rows
      </div>

      <div style={paginationControlsStyle}>
        <label style={pageSizeLabelStyle}>
          Rows per page
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            style={pageSizeSelectStyle}
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          style={paginationButtonStyle}
          onClick={() => onPageChange(1)}
          disabled={currentPage <= 1}
        >
          First
        </button>
        <button
          type="button"
          style={paginationButtonStyle}
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
        >
          Previous
        </button>
        <span style={{ color: "#475569", whiteSpace: "nowrap" }}>
          Page {formatNumber(currentPage)} of {formatNumber(totalPages)}
        </span>
        <button
          type="button"
          style={paginationButtonStyle}
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
        >
          Next
        </button>
        <button
          type="button"
          style={paginationButtonStyle}
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage >= totalPages}
        >
          Last
        </button>
      </div>
    </div>
  );
}

export default function MreadStagingPage() {
  const { activeWorkbase, role } = useAuth();
  const { geoState, updateGeo } = useGeo();
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [selectedWardPcode, setSelectedWardPcode] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [tableFilters, setTableFilters] = useState(EMPTY_TABLE_FILTERS);
  const [sortConfig, setSortConfig] = useState(DEFAULT_TABLE_SORT);
  const [selectedMeterRow, setSelectedMeterRow] = useState(null);

  const activeLmPcode = safeText(getActiveLmPcode(activeWorkbase), "");
  const activeWorkbaseName =
    activeWorkbase?.name ||
    activeWorkbase?.lmName ||
    activeWorkbase?.id ||
    activeWorkbase?.pcode ||
    NAv;

  const { data: registryWardRows = [], isLoading: registryWardsLoading } =
    useGetRegistryWardsByLmQuery(activeLmPcode || skipToken);
  const { data: boundaryWardRows = [], isLoading: boundaryWardsLoading } =
    useGetWardBoundariesByLmQuery(activeLmPcode || skipToken);
  const wardRows = useMemo(
    () => mergeWardOptions(registryWardRows, boundaryWardRows),
    [registryWardRows, boundaryWardRows],
  );
  const wardsLoading = registryWardsLoading && boundaryWardsLoading;

  const sessionsArgs = useMemo(() => {
    if (!activeLmPcode || activeLmPcode === NAv) return skipToken;
    return { lmPcode: activeLmPcode };
  }, [activeLmPcode]);

  const sessionsQuery = useListMreadStagingSessionsQuery(sessionsArgs);
  const cyclesQuery = useListMreadStagingCyclesQuery(sessionsArgs);
  const callableSessions = useMemo(
    () => sessionsQuery.data?.rows || [],
    [sessionsQuery.data?.rows],
  );
  const cycleSessions = useMemo(
    () =>
      (cyclesQuery.data?.rows || []).map(buildSessionFromCycle).filter(Boolean),
    [cyclesQuery.data?.rows],
  );
  const sessions = useMemo(() => {
    const byId = new Map();

    cycleSessions.forEach((session) => {
      const normalized = normalizeSession(session);
      if (!normalized?.id) return;
      byId.set(
        normalized.id,
        mergeSession(byId.get(normalized.id), normalized),
      );
    });
    callableSessions.forEach((session) => {
      const normalized = normalizeSession(session);
      if (!normalized?.id) return;
      byId.set(
        normalized.id,
        mergeSession(byId.get(normalized.id), normalized),
      );
    });

    return Array.from(byId.values()).sort(sortSessions);
  }, [callableSessions, cycleSessions]);
  const sessionsErrorMessage = sessionsQuery.error?.message || null;
  const cyclesErrorMessage = cyclesQuery.error?.message || null;
  const sessionsLoading = sessionsQuery.isLoading && cyclesQuery.isLoading;
  const isUsingCycleSessionFallback =
    callableSessions.length === 0 && cycleSessions.length > 0;

  const geoSelectedWardPcode = getWardPcode(geoState?.selectedWard);
  const effectiveSelectedWardPcode = selectedWardPcode || geoSelectedWardPcode;
  const hasWardSelection = isMeaningfulText(effectiveSelectedWardPcode);
  const selectedWard =
    wardRows.find((ward) => ward.wardPcode === effectiveSelectedWardPcode) ||
    geoState?.selectedWard ||
    null;
  const selectedSession = hasWardSelection
    ? sessions.find((session) => session.id === selectedSessionId) ||
      sessions[0] ||
      null
    : null;
  const selectedSessionIdEffective = selectedSession?.id || "";

  const { data: registryMreadRows = [] } = useGetRegistryMreadByWardQuery(
    effectiveSelectedWardPcode || skipToken,
  );

  markJsxOnlyComponentUsage(
    DownloadButtons,
    PaginationControls,
    SortButton,
    MeterHistoryModal,
    RegistryIdText,
  );

  const rowsQuery = useListMreadStagingRowsQuery(
    selectedSessionIdEffective && effectiveSelectedWardPcode
      ? {
          lmPcode: activeLmPcode,
          stagingId: selectedSessionIdEffective,
          pageSize: ROWS_FETCH_LIMIT,
          wardPcode: effectiveSelectedWardPcode,
        }
      : skipToken,
  );

  const rows = useMemo(
    () => rowsQuery.data?.rows || [],
    [rowsQuery.data?.rows],
  );
  const tableRows = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        wardLabel: getRowWardLabel(row, wardRows),
        premiseType: safeText(row.premiseType || row.propertyType, ""),
      })),
    [rows, wardRows],
  );
  const tableFilterOptions = useMemo(
    () =>
      TABLE_COLUMNS.filter((column) => column.filterType === "select").reduce(
        (options, column) => ({
          ...options,
          [column.key]: getUniqueFilterOptions(tableRows, column.key),
        }),
        {},
      ),
    [tableRows],
  );
  const filteredRows = useMemo(
    () =>
      tableRows.filter((row) =>
        TABLE_COLUMNS.every((column) => {
          if (!column.filterType) return true;

          const selectedValue = tableFilters[column.key];
          const rowValue = getTableFilterValue(row, column.key);

          if (column.filterType === "select") {
            return (
              !selectedValue ||
              selectedValue === "ALL" ||
              rowValue === selectedValue
            );
          }

          return includesText(rowValue, selectedValue);
        }),
      ),
    [tableFilters, tableRows],
  );
  const sortedRows = useMemo(
    () => sortTableRows(filteredRows, sortConfig),
    [filteredRows, sortConfig],
  );
  const totalFilteredRows = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalFilteredRows / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const visibleRows = useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * pageSize;
    return sortedRows.slice(startIndex, startIndex + pageSize);
  }, [pageSize, safeCurrentPage, sortedRows]);
  const totalRows = Number(rowsQuery.data?.totalRows ?? rows.length);
  const rowsErrorMessage = rowsQuery.error?.message || null;
  const canLoadRows = Boolean(selectedSession && effectiveSelectedWardPcode);
  const rowsOpening =
    canLoadRows &&
    (rowsQuery.isLoading || (rowsQuery.isFetching && rows.length === 0));
  const rowsSummaryText = !hasWardSelection
    ? "Select a ward scope to load staging rows."
    : !selectedSession
      ? "Choose a staging session to begin."
      : `${formatNumber(totalRows)} staging row(s)`;

  useEffect(() => {
    if (!hasWardSelection || !sessions.length) {
      setSelectedSessionId("");
    }
  }, [hasWardSelection, sessions.length]);

  const handleSessionChange = (event) => {
    setSelectedSessionId(event.target.value);
    setTableFilters(EMPTY_TABLE_FILTERS);
    setSortConfig(DEFAULT_TABLE_SORT);
    setCurrentPage(1);
  };

  const handleWardChange = (event) => {
    const nextWardPcode = event.target.value || "";
    const nextWard =
      wardRows.find((ward) => ward.wardPcode === nextWardPcode) || null;

    setSelectedWardPcode(nextWardPcode);
    updateGeo({
      selectedWard: nextWard
        ? {
            ...nextWard,
            id: nextWard.wardPcode,
            pcode: nextWard.wardPcode,
          }
        : null,
      lastSelectionType: nextWardPcode ? "WARD" : null,
    });
    setTableFilters(EMPTY_TABLE_FILTERS);
    setSortConfig(DEFAULT_TABLE_SORT);
    setCurrentPage(1);
  };

  const handleTableFilterChange = (key) => (event) => {
    setTableFilters((filters) => ({ ...filters, [key]: event.target.value }));
    setCurrentPage(1);
  };

  const handleSort = (key) => {
    setSortConfig((current) => {
      if (current.key !== key) return { key, direction: "asc" };
      return { key, direction: current.direction === "asc" ? "desc" : "asc" };
    });
    setCurrentPage(1);
  };

  const handlePageSizeChange = (nextPageSize) => {
    setPageSize(nextPageSize || DEFAULT_PAGE_SIZE);
    setCurrentPage(1);
  };

  const handlePageChange = (nextPage) => {
    const safeNextPage = Math.max(1, Math.min(nextPage, totalPages));
    setCurrentPage(safeNextPage);
  };

  return (
    <>
      <header className="console-header" style={styles.fixedRegistryHeader}>
        <div>
          <h1>MREAD Staging</h1>

          <p className="muted">
            View preserved MREAD staging sessions and inspect generated rows.
          </p>

          <Link className="text-link" to="/registries">
            ← Back to Registries
          </Link>
        </div>

        <div className="topbar-right">
          <div className="workbase-pill">{activeWorkbaseName}</div>
          <div className="role-pill">{role || NAv}</div>
          <div className="role-pill">
            {rowsQuery.isFetching
              ? "Loading..."
              : `${formatNumber(filteredRows.length)} visible rows`}
          </div>
          <DownloadButtons
            registryName="MREAD Staging"
            rowsLabel="rows"
            visibleRows={sortedRows}
            columns={TABLE_COLUMNS.map((column) => ({
              key: column.key,
              header: column.header,
            }))}
            fileBaseName="mread_staging"
            scope={{
              lmPcode: activeLmPcode || selectedSession?.lmPcode,
              wardPcode: effectiveSelectedWardPcode,
            }}
          />
        </div>
      </header>

      <div style={{ display: "grid", gap: "1.5rem" }}>
        <section
          style={{
            display: "grid",
            gap: "1rem",
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "1rem",
            padding: "1.25rem",
          }}
        >
          <div
            style={{
              display: "grid",
              gap: "1rem",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              alignItems: "start",
            }}
          >
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <div>
                <label
                  htmlFor="ward-select"
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    color: "#475569",
                    fontWeight: 700,
                  }}
                >
                  Ward Scope
                </label>
                <select
                  id="ward-select"
                  value={effectiveSelectedWardPcode}
                  onChange={handleWardChange}
                  disabled={
                    !activeLmPcode || wardsLoading || wardRows.length === 0
                  }
                  style={{
                    width: "100%",
                    minWidth: "180px",
                    padding: "0.75rem 0.9rem",
                    borderRadius: "0.75rem",
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                  }}
                >
                  <option value="">Select ward</option>
                  {wardRows.map((ward) => (
                    <option key={ward.wardPcode} value={ward.wardPcode}>
                      {getWardLabel(ward)} ({ward.wardPcode})
                    </option>
                  ))}
                </select>
              </div>

              {selectedSession ? (
                <div style={{ color: "#475569" }}>
                  <span
                    style={{
                      display: "block",
                      fontWeight: 700,
                      marginBottom: "0.4rem",
                    }}
                  >
                    Cycle ID
                  </span>
                  <span>{safeText(selectedSession.cycleId)}</span>
                </div>
              ) : null}
            </div>

            <div style={{ display: "grid", gap: "0.75rem" }}>
              <div>
                <label
                  htmlFor="session-select"
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    color: "#475569",
                    fontWeight: 700,
                  }}
                >
                  Staging Session
                </label>
                <select
                  id="session-select"
                  value={hasWardSelection ? selectedSessionIdEffective : ""}
                  onChange={handleSessionChange}
                  disabled={
                    !hasWardSelection ||
                    sessionsLoading ||
                    sessions.length === 0
                  }
                  style={{
                    width: "100%",
                    minWidth: "220px",
                    padding: "0.75rem 0.9rem",
                    borderRadius: "0.75rem",
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                  }}
                >
                  <option value="">
                    {!hasWardSelection
                      ? "Select ward first"
                      : sessions.length === 0
                        ? "No staging sessions"
                        : "-- Select a session --"}
                  </option>
                  {hasWardSelection
                    ? sessions.map((session) => (
                        <option key={session.id} value={session.id}>
                          {getStagingSessionLabel(session)}
                        </option>
                      ))
                    : null}
                </select>
                {isUsingCycleSessionFallback && sessionsErrorMessage ? (
                  <p style={{ margin: "0.5rem 0 0", color: "#92400e" }}>
                    Using controller active staging IDs. Session callable
                    returned: {sessionsErrorMessage}
                  </p>
                ) : sessionsErrorMessage ? (
                  <p style={{ margin: "0.5rem 0 0", color: "#b91c1c" }}>
                    {sessionsErrorMessage}
                  </p>
                ) : cyclesErrorMessage ? (
                  <p style={{ margin: "0.5rem 0 0", color: "#b91c1c" }}>
                    {cyclesErrorMessage}
                  </p>
                ) : null}
              </div>

              {selectedSession ? (
                <div style={{ color: "#475569" }}>
                  <span
                    style={{
                      display: "block",
                      fontWeight: 700,
                      marginBottom: "0.4rem",
                    }}
                  >
                    Date Generated
                  </span>
                  <span>{formatSessionGeneratedAt(selectedSession)}</span>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "1rem",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "1rem 1.25rem",
              borderBottom: "1px solid #e2e8f0",
            }}
          >
            <div>
              <p style={{ margin: 0, fontWeight: 700, color: "#0f172a" }}>
                Staging rows
              </p>
              <p style={{ margin: "0.35rem 0 0", color: "#64748b" }}>
                {rowsSummaryText}
              </p>
            </div>
            <PaginationControls
              currentPage={safeCurrentPage}
              pageSize={pageSize}
              totalPages={totalPages}
              totalRows={totalFilteredRows}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          </div>

          <div style={{ overflowX: rowsOpening ? "hidden" : "auto" }}>
            {rowsErrorMessage ? (
              <div
                style={{
                  margin: "1rem",
                  padding: "1rem",
                  background: "#fee2e2",
                  border: "1px solid #fca5a5",
                  borderRadius: "0.75rem",
                  color: "#991b1b",
                }}
              >
                Failed to load staging rows: {rowsErrorMessage}
              </div>
            ) : null}

            {rowsOpening ? (
              <LoadingSpinner
                title="Opening MREAD staging..."
                message="Waiting for the mread_staging rows Firestore stream."
              />
            ) : null}

            {!rowsOpening ? (
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  minWidth: "1120px",
                }}
              >
                <thead style={{ background: "#f8fafc" }}>
                  <tr>
                    {TABLE_COLUMNS.map((column) => (
                      <th
                        key={column.key}
                        style={{
                          textAlign: "left",
                          padding: "0.85rem 1rem",
                          borderBottom: "1px solid #e2e8f0",
                          color: "#475569",
                          fontWeight: 700,
                          fontSize: "0.9rem",
                          verticalAlign: "top",
                        }}
                      >
                        <div style={{ display: "grid", gap: "0.45rem" }}>
                          <SortButton
                            label={column.header}
                            sortKey={column.key}
                            sortConfig={sortConfig}
                            onSort={handleSort}
                          />
                          {column.filterType === "text" ? (
                            <input
                              aria-label={`Filter by ${column.header}`}
                              value={tableFilters[column.key] || ""}
                              onChange={handleTableFilterChange(column.key)}
                              placeholder={column.placeholder || column.header}
                              disabled={!canLoadRows || rowsQuery.isLoading}
                              style={columnFilterInputStyle}
                            />
                          ) : null}
                          {column.filterType === "select" ? (
                            <select
                              aria-label={`Filter by ${column.header}`}
                              value={tableFilters[column.key] || "ALL"}
                              onChange={handleTableFilterChange(column.key)}
                              disabled={!canLoadRows || rowsQuery.isLoading}
                              style={columnFilterSelectStyle}
                            >
                              <option value="ALL">All</option>
                              {(tableFilterOptions[column.key] || []).map(
                                (option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ),
                              )}
                            </select>
                          ) : null}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {canLoadRows ? (
                    visibleRows.length > 0 ? (
                      visibleRows.map((row) => (
                        <tr
                          key={row.rowId}
                          style={{ borderBottom: "1px solid #e2e8f0" }}
                        >
                          {TABLE_COLUMNS.map((column) => (
                            <td
                              key={`${row.rowId}-${column.key}`}
                              style={cellStyle}
                            >
                              {formatTableValue(row, column.key, {
                                onMeterClick: setSelectedMeterRow,
                              })}
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={TABLE_COLUMNS.length}
                          style={{
                            padding: "1.5rem",
                            color: "#64748b",
                            textAlign: "center",
                          }}
                        >
                          {rows.length > 0
                            ? "No rows match the current column filters."
                            : "No rows match the current filter settings."}
                        </td>
                      </tr>
                    )
                  ) : (
                    <tr>
                      <td
                        colSpan={TABLE_COLUMNS.length}
                        style={{
                          padding: "1.5rem",
                          color: "#64748b",
                          textAlign: "center",
                        }}
                      >
                        {selectedSession
                          ? "Select a ward scope above to view table rows."
                          : "Select a staging session above to view table rows."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : null}
          </div>
        </section>
      </div>

      {selectedMeterRow ? (
        <SharedMeterHistoryModal
          row={selectedMeterRow}
          registryRows={registryMreadRows}
          onClose={() => setSelectedMeterRow(null)}
        />
      ) : null}
    </>
  );
}

const styles = {
  fixedRegistryHeader: {
    position: "sticky",
    top: 0,
    zIndex: 30,
    background: "#f8fafc",
    paddingTop: "0.35rem",
    paddingRight: "1.25rem",
    paddingBottom: "0.85rem",
    paddingLeft: "1.25rem",
    boxSizing: "border-box",
    boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
  },
};

const cellStyle = {
  padding: "0.95rem 1rem",
  color: "#0f172a",
  fontSize: "0.9rem",
  lineHeight: 1.4,
  whiteSpace: "nowrap",
  verticalAlign: "top",
};

const readingValueStackStyle = {
  display: "grid",
  gap: "0.18rem",
};

const readingMetaStyle = {
  color: "#64748b",
  fontSize: "0.72rem",
  fontWeight: 500,
};

const sortButtonStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.45rem",
  width: "100%",
  padding: 0,
  border: "none",
  background: "transparent",
  color: "#475569",
  font: "inherit",
  fontWeight: 700,
  cursor: "pointer",
  textAlign: "left",
};

const columnFilterInputStyle = {
  width: "100%",
  minWidth: "120px",
  padding: "0.45rem 0.55rem",
  borderRadius: "0.6rem",
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#0f172a",
  fontSize: "0.82rem",
  fontWeight: 500,
  boxSizing: "border-box",
};

const columnFilterSelectStyle = {
  ...columnFilterInputStyle,
};

const paginationBarStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: "1rem",
  flexWrap: "wrap",
};

const paginationControlsStyle = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  flexWrap: "wrap",
};

const pageSizeLabelStyle = {
  display: "flex",
  alignItems: "center",
  gap: "0.45rem",
  color: "#475569",
  fontWeight: 700,
  whiteSpace: "nowrap",
};

const pageSizeSelectStyle = {
  padding: "0.55rem 0.75rem",
  borderRadius: "0.7rem",
  border: "1px solid #cbd5e1",
  background: "#ffffff",
};

const paginationButtonStyle = {
  padding: "0.55rem 0.8rem",
  borderRadius: "0.75rem",
  border: "1px solid #cbd5e1",
  background: "#f8fafc",
  color: "#0f172a",
  cursor: "pointer",
};

const meterNoButtonStyle = {
  border: 0,
  background: "transparent",
  padding: 0,
  font: "inherit",
  fontWeight: 800,
  cursor: "pointer",
};

const modalOverlayStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "1.5rem",
  background: "rgba(15, 23, 42, 0.55)",
};

const modalCardLargeStyle = {
  width: "min(1180px, 96vw)",
  maxHeight: "90vh",
  display: "flex",
  flexDirection: "column",
  background: "#ffffff",
  borderRadius: "1.25rem",
  boxShadow: "0 24px 80px rgba(15, 23, 42, 0.28)",
  overflow: "hidden",
};

const modalHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "1rem",
  padding: "1.25rem",
  borderBottom: "1px solid #e2e8f0",
};

const modalBodyStyle = {
  overflow: "auto",
  padding: "1.25rem",
};

const modalEyebrowStyle = {
  margin: "0 0 0.35rem",
  color: "#64748b",
  fontSize: "0.75rem",
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const modalCloseButtonStyle = {
  padding: "0.65rem 0.95rem",
  borderRadius: "0.85rem",
  border: "1px solid #cbd5e1",
  background: "#f8fafc",
  color: "#0f172a",
  fontWeight: 700,
  cursor: "pointer",
};

const mutedTextStyle = {
  margin: "0.25rem 0 0",
  color: "#64748b",
};

const loadingBlockStyle = {
  minHeight: "160px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "1rem",
  textAlign: "left",
};

const spinnerStyle = {
  width: "34px",
  height: "34px",
  borderRadius: "999px",
  border: "4px solid rgba(148, 163, 184, 0.25)",
  borderTopColor: "#2563eb",
  animation: "ireps-spin 0.9s linear infinite",
};

const emptyStateStyle = {
  padding: "1.25rem",
  border: "1px solid #e2e8f0",
  borderRadius: "1rem",
  background: "#f8fafc",
};

const meterHistoryStackStyle = {
  display: "grid",
  gap: "1rem",
};

const detailsSectionStyle = {
  border: "1px solid #e2e8f0",
  borderRadius: "1rem",
  padding: "1rem",
  background: "#ffffff",
};

const detailsTwoColumnGridStyle = {
  display: "grid",
  gap: "1rem",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
};

const detailLineStyle = {
  display: "grid",
  gap: "0.15rem",
  padding: "0.55rem 0",
  borderBottom: "1px solid #f1f5f9",
};

const detailLabelStyle = {
  color: "#64748b",
  fontSize: "0.78rem",
  fontWeight: 700,
};

const readingSummaryGridStyle = {
  display: "grid",
  gap: "0.75rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))",
};

const readingSummaryTileStyle = {
  display: "grid",
  gap: "0.35rem",
  padding: "0.85rem",
  border: "1px solid #e2e8f0",
  borderRadius: "0.85rem",
  background: "#f8fafc",
};

const sectionHeaderRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "1rem",
  marginBottom: "0.75rem",
};

const statusPillStyle = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0.35rem 0.65rem",
  borderRadius: "999px",
  background: "#f1f5f9",
  color: "#0f172a",
  fontWeight: 700,
  whiteSpace: "nowrap",
};

const historyTableWrapStyle = {
  overflowX: "hidden",
};

const historyTableStyle = {
  width: "100%",
  minWidth: "0",
  tableLayout: "fixed",
  borderCollapse: "collapse",
};

const historyHeaderCellStyle = {
  textAlign: "left",
  padding: "0.75rem",
  borderBottom: "1px solid #e2e8f0",
  color: "#475569",
  fontWeight: 700,
  background: "#f8fafc",
};

const historyCompactHeaderCellStyle = {
  ...historyHeaderCellStyle,
  width: "86px",
  maxWidth: "86px",
  padding: "0.55rem 0.45rem",
  fontSize: "0.72rem",
};

const historyTrnHeaderCellStyle = {
  ...historyHeaderCellStyle,
  width: "112px",
  maxWidth: "112px",
  padding: "0.55rem 0.45rem",
  fontSize: "0.72rem",
};

const historySourceHeaderCellStyle = {
  ...historyHeaderCellStyle,
  width: "82px",
  maxWidth: "82px",
  padding: "0.55rem 0.45rem",
  fontSize: "0.72rem",
};

const historyCellStyle = {
  padding: "0.75rem",
  borderBottom: "1px solid #e2e8f0",
  color: "#0f172a",
  verticalAlign: "top",
  whiteSpace: "nowrap",
};

const historyCompactCellStyle = {
  ...historyCellStyle,
  maxWidth: "86px",
  padding: "0.55rem 0.45rem",
  fontSize: "0.72rem",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
};

const historyTrnCellStyle = {
  ...historyCellStyle,
  maxWidth: "112px",
  padding: "0.55rem 0.45rem",
  fontSize: "0.7rem",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
};

const historySourceCellStyle = {
  ...historyCellStyle,
  maxWidth: "82px",
  padding: "0.55rem 0.45rem",
  fontSize: "0.72rem",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
};

const historyCompactStrongStyle = {
  fontSize: "0.74rem",
  lineHeight: 1.25,
};

const historyTrnValueStyle = {
  maxHeight: "2.6rem",
  overflow: "hidden",
};

const secondaryIdStyle = {
  marginTop: "0.2rem",
  color: "#64748b",
  fontSize: "0.75rem",
};

const secondaryIdCompactStyle = {
  ...secondaryIdStyle,
  fontSize: "0.64rem",
  lineHeight: 1.2,
  maxHeight: "1.6rem",
  overflow: "hidden",
};
