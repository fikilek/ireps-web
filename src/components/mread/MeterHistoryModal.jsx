import { useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, getFirestore, limit, query, where } from "firebase/firestore";

import RegistryIdText from "../RegistryIdText";

const NAv = "NAv";
const BASELINE_READING_SOURCES = new Set([
  "AST_CREATION",
  "METER_DISCOVERY",
  "METER_INSTALLATION",
]);

function safeText(value, fallback = NAv) {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function isMeaningfulText(value) {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  if (!text) return false;

  return !["nav", "n/av", "n/a", "na", "null", "undefined"].includes(
    text.toLowerCase(),
  );
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

function firstMeaningfulValue(...values) {
  for (const value of values) {
    if (value === 0) return value;
    if (isMeaningfulText(value)) return value;
  }
  return null;
}

function firstText(...values) {
  const value = firstValue(...values);
  return safeText(value);
}

function firstMeaningfulText(...values) {
  for (const value of values) {
    if (isMeaningfulText(value)) return String(value).trim();
  }
  return NAv;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function formatNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toLocaleString() : "0";
}

function formatReading(value) {
  if (value === 0 || value === "0") return "0";
  if (value === null || value === undefined || value === "") return NAv;
  return String(value);
}

function formatDateTime(value) {
  if (!value || value === NAv) return NAv;

  if (typeof value === "string") {
    return value.slice(0, 19).replace("T", " ");
  }

  if (typeof value?.toDate === "function") {
    return value.toDate().toLocaleString();
  }

  if (typeof value?.seconds === "number") {
    return new Date(value.seconds * 1000).toLocaleString();
  }

  return NAv;
}

function getReadingAtMs(value) {
  if (!value || value === NAv) return null;

  if (typeof value?.toDate === "function") {
    const millis = value.toDate().getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  if (typeof value?.seconds === "number") {
    const millis = value.seconds * 1000;
    return Number.isFinite(millis) ? millis : null;
  }

  const millis = Date.parse(String(value));
  return Number.isFinite(millis) ? millis : null;
}

function compareNatural(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;

  return String(a || "").localeCompare(String(b || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function getMeterNo(row = {}) {
  return firstText(
    row.meterNo,
    row?.meter?.astNo,
    row?.meter?.meterNo,
    row.astNo,
    row?.raw?.meterNo,
    row?.raw?.meter?.astNo,
    row?.raw?.meter?.meterNo,
  );
}

function getAstId(row = {}) {
  return firstText(
    row.astId,
    row?.refs?.astId,
    row?.meter?.astId,
    row.sourceAstId,
    row?.raw?.astId,
    row?.raw?.refs?.astId,
    row?.raw?.meter?.astId,
    row?.raw?.sourceAstId,
  );
}

function getAstDocIdFromRow(row = {}) {
  const astId = getAstId(row);
  if (astId === NAv) return "";
  const astPath = String(astId).trim();
  return astPath.startsWith("asts/") ? astPath.split("/").pop() : astPath;
}

function getCompletedAt(row = {}) {
  return firstValue(row.completedAt, row?.source?.completedAt, row?.raw?.completedAt, row?.raw?.source?.completedAt);
}

function getOutcome(row = {}) {
  return firstText(row?.outcome?.outcome, row.outcome, row?.raw?.outcome?.outcome, row?.raw?.outcome);
}

function getOutcomeLabel(outcome) {
  if (outcome === "SUCCESSFUL_READING") return "Successful Reading";
  if (outcome === "UNSUCCESSFUL_READING") return "Unsuccessful Reading";
  if (outcome === "NO_ACCESS") return "No Access";
  return outcome || NAv;
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
  return firstValue(row.currentReading, row?.reading?.currentReading, row?.raw?.currentReading, row?.raw?.reading?.currentReading);
}

function getPreviousReading(row = {}) {
  return firstValue(row.previousReading, row.prevReading, row?.reading?.previousReading, row?.raw?.previousReading, row?.raw?.prevReading, row?.raw?.reading?.previousReading);
}

function getConsumption(row = {}) {
  return firstValue(row.consumption, row?.reading?.consumption, row?.raw?.consumption, row?.raw?.reading?.consumption);
}

function getReadingAt(row = {}) {
  const outcome = getOutcome(row);
  const readingAt = firstMeaningfulValue(row.readingAt, row.currentReadingDate, row?.reading?.readingAt, row?.raw?.readingAt, row?.raw?.currentReadingDate, row?.raw?.reading?.readingAt);

  if (outcome === "SUCCESSFUL_READING") {
    return firstMeaningfulValue(readingAt, getCompletedAt(row));
  }

  return null;
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
    row?.raw?.reading?.sincePreviousReading,
    row?.raw?.reading?.daysSinceLastReading,
    row["reading.sincePreviousReading"],
    row["reading.daysSinceLastReading"],
  );
  if (!value) return NAv;
  if (typeof value === "string") return safeText(value);
  if (typeof value === "object") return safeText(value.display);

  return safeText(value);
}

function getSincePreviousReadingMinutes(row = {}) {
  if (getOutcome(row) !== "SUCCESSFUL_READING") return null;

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

  return Number.isFinite(minutes) ? minutes : null;
}

function getTrnId(row = {}) {
  return firstText(row.trnId, row?.source?.trnId, row.id, row.__id, row?.raw?.trnId, row?.raw?.source?.trnId);
}

function getCapturedByName(row = {}) {
  return firstText(row.capturedByName, row?.actor?.capturedByName, row?.raw?.capturedByName, row?.raw?.actor?.capturedByName);
}

function getCapturedByUid(row = {}) {
  return firstText(row.capturedByUid, row?.actor?.capturedByUid, row?.raw?.capturedByUid, row?.raw?.actor?.capturedByUid);
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

function getMeterTypeLabel(value) {
  const text = safeText(value, "").toLowerCase();
  if (text === "electricity") return "Electricity";
  if (text === "water") return "Water";
  return value || NAv;
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
        outcomeLabel: isBaselineReading ? "Baseline Reading" : "Successful Reading",
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
      const trnId = getTrnId(registryRow);
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
        key: `registry-${trnId || registryRow?.id || registryRow?.__id || index}`,
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

function mergeMeterHistoryRows({ astRows = [], registryRows = [], selectedRow = {} } = {}) {
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

function isRegistryIdentifierLabel(label = "") {
  const cleanLabel = String(label || "").toLowerCase();
  return (
    cleanLabel.includes(" id") ||
    cleanLabel.endsWith("id") ||
    cleanLabel.includes("uid") ||
    cleanLabel.includes("path") ||
    cleanLabel.includes("pcode")
  );
}

function CompactDetailLine({ label, value }) {
  const displayValue =
    value === null || value === undefined || value === "" ? NAv : String(value);
  const isIdentifier = isRegistryIdentifierLabel(label);

  return (
    <div style={styles.detailLine}>
      <span className="muted">{label}</span>
      {isIdentifier ? (
        <RegistryIdText value={displayValue} />
      ) : (
        <strong>{displayValue}</strong>
      )}
    </div>
  );
}

function CompactCardLine({ label, value, identifier = false, style = null }) {
  const displayValue =
    value === null || value === undefined || value === "" ? NAv : String(value);

  return (
    <div style={{ ...styles.historyCardLine, ...(style || {}) }}>
      <span className="muted">{label}</span>
      {identifier ? (
        <div style={styles.historyCardIdentifier}>
          <RegistryIdText value={displayValue} />
        </div>
      ) : (
        <strong>{displayValue}</strong>
      )}
    </div>
  );
}

function getReadByDisplay(value) {
  const displayValue = safeText(value);
  if (displayValue === NAv) return NAv;

  const firstLine = String(displayValue)
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean);

  return firstLine || displayValue;
}

function LoadingSpinner({
  title = "Loading MREAD registry...",
  message = "Opening Firestore stream.",
} = {}) {
  return (
    <div style={styles.loadingBlock} role="status" aria-live="polite">
      <span style={styles.spinner} aria-hidden="true" />
      <div>
        <h2>{title}</h2>
        <p className="muted">{message}</p>
      </div>
    </div>
  );
}

function getFiniteNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function formatChartNumber(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return NAv;
  if (Math.abs(numberValue) >= 1000000) return `${(numberValue / 1000000).toFixed(1)}m`;
  if (Math.abs(numberValue) >= 1000) return `${(numberValue / 1000).toFixed(1)}k`;
  if (Number.isInteger(numberValue)) return numberValue.toLocaleString();

  return Number(numberValue.toFixed(2)).toLocaleString();
}

function formatChartDateLabel(value) {
  const millis = getReadingAtMs(value);
  if (millis === null) return NAv;

  return new Date(millis).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
  });
}

function getHistoryCycleLabel(item = {}) {
  const raw = item?.raw || {};
  const cycleLabel = firstMeaningfulText(
    item.cycleLabel,
    item.cycleId,
    raw.cycleLabel,
    raw.cycleName,
    raw.cycleId,
    raw?.selectedCycle?.cycleLabel,
    raw?.selectedCycle?.cycleName,
    raw?.selectedCycle?.cycleId,
    raw?.billingCycle?.cycleLabel,
    raw?.billingCycle?.cycleName,
    raw?.billingCycle?.cycleId,
    "",
  );

  if (cycleLabel !== NAv) {
    const cycleMatch = String(cycleLabel).match(/CYCLE[_\s-]?(\d+)/i);
    return cycleMatch?.[1] ? `Cycle ${cycleMatch[1]}` : cycleLabel;
  }

  const millis = getReadingAtMs(firstValue(item.readingAt, item.completedAt));
  if (millis === null) return "Unassigned cycle";

  return new Date(millis).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
}

function buildReadingTrendData(historyRows = []) {
  return historyRows
    .map((item) => ({
      label: formatChartDateLabel(item.readingAt),
      sortTime: getReadingAtMs(item.readingAt),
      reading: getFiniteNumber(item.readingNumber),
    }))
    .filter((item) => item.sortTime !== null && item.reading !== null)
    .sort((left, right) => left.sortTime - right.sortTime)
    .map((item, index) => ({
      ...item,
      label: item.label === NAv ? `R${index + 1}` : item.label,
    }));
}

function buildConsumptionPerReadingData(historyRows = []) {
  return historyRows
    .map((item) => ({
      label: formatChartDateLabel(item.readingAt),
      sortTime: getReadingAtMs(firstValue(item.readingAt, item.completedAt)),
      consumption: getFiniteNumber(item.consumption),
    }))
    .filter((item) => item.sortTime !== null && item.consumption !== null)
    .sort((left, right) => left.sortTime - right.sortTime)
    .map((item, index) => ({
      ...item,
      label: item.label === NAv ? `R${index + 1}` : item.label,
    }));
}

function buildConsumptionPerCycleData(historyRows = []) {
  const cycleMap = new Map();

  historyRows.forEach((item) => {
    const consumption = getFiniteNumber(item.consumption);
    if (consumption === null) return;

    const cycleLabel = getHistoryCycleLabel(item);
    const sortTime = getReadingAtMs(firstValue(item.readingAt, item.completedAt)) || 0;
    const existing = cycleMap.get(cycleLabel) || {
      label: cycleLabel,
      consumption: 0,
      sortTime,
    };

    existing.consumption += consumption;
    existing.sortTime = Math.min(existing.sortTime || sortTime, sortTime);
    cycleMap.set(cycleLabel, existing);
  });

  return Array.from(cycleMap.values()).sort((left, right) => {
    if (left.sortTime !== right.sortTime) return left.sortTime - right.sortTime;
    return compareNatural(left.label, right.label);
  });
}

function getChartScale(values = [], height = 160, topPadding = 18, bottomPadding = 34) {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  const rawMin = finiteValues.length ? Math.min(...finiteValues) : 0;
  const rawMax = finiteValues.length ? Math.max(...finiteValues) : 1;
  let minValue = rawMin;
  let maxValue = rawMax;

  if (minValue === maxValue) {
    minValue -= Math.max(1, Math.abs(minValue) * 0.1);
    maxValue += Math.max(1, Math.abs(maxValue) * 0.1);
  }

  const plotHeight = height - topPadding - bottomPadding;

  return {
    minValue,
    maxValue,
    yForValue(value) {
      const ratio = (value - minValue) / (maxValue - minValue);
      return topPadding + plotHeight - ratio * plotHeight;
    },
  };
}

function ChartFrame({ title, description, children }) {
  return (
    <div style={styles.chartFrame}>
      <div style={styles.chartFrameHeader}>
        <div>
          <h4 style={styles.chartTitle}>{title}</h4>
          <p className="muted" style={styles.chartDescription}>
            {description}
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}

function EmptyChart({ message }) {
  return (
    <div style={styles.emptyChart}>
      <p className="muted">{message}</p>
    </div>
  );
}

function ReadingTrendChart({ data = [] }) {
  if (data.length < 2) {
    return (
      <ChartFrame
        title="Reading Trend"
        description="Successful reading values plotted over time."
      >
        <EmptyChart message="At least two successful readings are needed to draw a trend." />
      </ChartFrame>
    );
  }

  const height = 230;
  const leftPadding = 52;
  const rightPadding = 24;
  const chartWidth = Math.max(760, data.length * 80);
  const scale = getChartScale(data.map((item) => item.reading), height);
  const usableWidth = chartWidth - leftPadding - rightPadding;
  const points = data.map((item, index) => {
    const x =
      data.length === 1
        ? leftPadding + usableWidth / 2
        : leftPadding + (index / (data.length - 1)) * usableWidth;
    const y = scale.yForValue(item.reading);

    return {
      ...item,
      x,
      y,
    };
  });
  const polylinePoints = points.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <ChartFrame
      title="Reading Trend"
      description="Successful reading values plotted over time."
    >
      <div style={styles.chartScroll}>
        <svg
          role="img"
          aria-label="Reading trend line graph"
          viewBox={`0 0 ${chartWidth} ${height}`}
          style={{ ...styles.chartSvg, minWidth: `${chartWidth}px` }}
        >
          <line
            x1={leftPadding}
            y1={scale.yForValue(scale.minValue)}
            x2={chartWidth - rightPadding}
            y2={scale.yForValue(scale.minValue)}
            stroke="rgba(148, 163, 184, 0.55)"
          />
          <line
            x1={leftPadding}
            y1={18}
            x2={leftPadding}
            y2={height - 34}
            stroke="rgba(148, 163, 184, 0.55)"
          />
          <text x="8" y="26" style={styles.chartAxisLabel}>
            {formatChartNumber(scale.maxValue)}
          </text>
          <text x="8" y={height - 38} style={styles.chartAxisLabel}>
            {formatChartNumber(scale.minValue)}
          </text>
          <polyline
            points={polylinePoints}
            fill="none"
            stroke="#2563eb"
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {points.map((point, index) => (
            <g key={`${point.label}-${index}`}>
              <circle cx={point.x} cy={point.y} r="4.5" fill="#2563eb">
                <title>{`${point.label}: ${formatChartNumber(point.reading)}`}</title>
              </circle>
              {index === 0 || index === points.length - 1 || index % 2 === 0 ? (
                <text
                  x={point.x}
                  y={height - 12}
                  textAnchor="middle"
                  style={styles.chartAxisLabel}
                >
                  {point.label}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      </div>
    </ChartFrame>
  );
}

function ConsumptionBarChart({ title, description, data = [] }) {
  if (data.length === 0) {
    return (
      <ChartFrame title={title} description={description}>
        <EmptyChart message="No consumption values are available for this graph yet." />
      </ChartFrame>
    );
  }

  const height = 230;
  const leftPadding = 52;
  const rightPadding = 24;
  const chartWidth = Math.max(760, data.length * 90);
  const values = data.map((item) => item.consumption);
  const scale = getChartScale([0, ...values], height);
  const usableWidth = chartWidth - leftPadding - rightPadding;
  const barSlot = usableWidth / data.length;
  const barWidth = Math.max(18, Math.min(54, barSlot * 0.58));
  const zeroY = scale.yForValue(0);

  return (
    <ChartFrame title={title} description={description}>
      <div style={styles.chartScroll}>
        <svg
          role="img"
          aria-label={`${title} bar graph`}
          viewBox={`0 0 ${chartWidth} ${height}`}
          style={{ ...styles.chartSvg, minWidth: `${chartWidth}px` }}
        >
          <line
            x1={leftPadding}
            y1={zeroY}
            x2={chartWidth - rightPadding}
            y2={zeroY}
            stroke="rgba(148, 163, 184, 0.75)"
          />
          <line
            x1={leftPadding}
            y1={18}
            x2={leftPadding}
            y2={height - 34}
            stroke="rgba(148, 163, 184, 0.55)"
          />
          <text x="8" y="26" style={styles.chartAxisLabel}>
            {formatChartNumber(scale.maxValue)}
          </text>
          <text x="8" y={height - 38} style={styles.chartAxisLabel}>
            {formatChartNumber(scale.minValue)}
          </text>

          {data.map((item, index) => {
            const x = leftPadding + index * barSlot + (barSlot - barWidth) / 2;
            const valueY = scale.yForValue(item.consumption);
            const y = Math.min(valueY, zeroY);
            const barHeight = Math.max(2, Math.abs(zeroY - valueY));

            return (
              <g key={`${item.label}-${index}`}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  rx="6"
                  fill="#0f766e"
                >
                  <title>{`${item.label}: ${formatChartNumber(item.consumption)}`}</title>
                </rect>
                <text
                  x={x + barWidth / 2}
                  y={height - 12}
                  textAnchor="middle"
                  style={styles.chartAxisLabel}
                >
                  {item.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </ChartFrame>
  );
}

function MeterReadingGraphs({ historyRows = [] }) {
  const readingTrendData = buildReadingTrendData(historyRows);
  const consumptionPerReadingData = buildConsumptionPerReadingData(historyRows);
  const consumptionPerCycleData = buildConsumptionPerCycleData(historyRows);

  return (
    <div style={styles.graphStack}>
      <ReadingTrendChart data={readingTrendData} />
      <ConsumptionBarChart
        title="Consumption Per Reading"
        description="Consumption calculated for each successful reading interval."
        data={consumptionPerReadingData}
      />
      <ConsumptionBarChart
        title="Consumption Per Cycle"
        description="Total consumption grouped by available cycle label, falling back to reading month when a cycle label is missing."
        data={consumptionPerCycleData}
      />
    </div>
  );
}

function toFiniteCoordinate(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function isValidLatLng(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function normalizeLatLng(lat, lng, source = "") {
  const latitude = toFiniteCoordinate(lat);
  const longitude = toFiniteCoordinate(lng);

  if (!isValidLatLng(latitude, longitude)) return null;

  return {
    lat: latitude,
    lng: longitude,
    source,
  };
}

function extractLatLngFromValue(value, source = "") {
  if (!value) return null;

  if (typeof value?.latitude === "number" && typeof value?.longitude === "number") {
    return normalizeLatLng(value.latitude, value.longitude, source);
  }

  const latLng = normalizeLatLng(
    firstValue(value.lat, value.latitude, value.y, value._lat),
    firstValue(value.lng, value.lon, value.long, value.longitude, value.x, value._long),
    source,
  );
  if (latLng) return latLng;

  if (Array.isArray(value) && value.length >= 2) {
    const first = toFiniteCoordinate(value[0]);
    const second = toFiniteCoordinate(value[1]);

    const geoJsonOrder = normalizeLatLng(second, first, source);
    if (geoJsonOrder) return geoJsonOrder;

    return normalizeLatLng(first, second, source);
  }

  if (Array.isArray(value?.coordinates) && value.coordinates.length >= 2) {
    return extractLatLngFromValue(value.coordinates, source);
  }

  return null;
}

function getMeterLatLng(astDoc = {}, row = {}) {
  const candidates = [
    ["AST nested location GPS", astDoc?.ast?.location?.gps],
    ["AST nested location", astDoc?.ast?.location],
    ["AST location GPS", astDoc?.location?.gps],
    ["AST location", astDoc.location],
    ["AST coordinates", astDoc.coordinates],
    ["AST coordinate", astDoc.coordinate],
    ["AST GPS", astDoc.gps],
    ["AST geo", astDoc.geo],
    ["AST geoPoint", astDoc.geoPoint],
    ["AST geopoint", astDoc.geopoint],
    ["AST point", astDoc.point],
    ["AST position", astDoc.position],
    ["AST spatial location GPS", astDoc?.spatial?.location?.gps],
    ["AST spatial location", astDoc?.spatial?.location],
    ["AST spatial point", astDoc?.spatial?.point],
    ["AST geometry", astDoc.geometry],
    ["AST geometry coordinates", astDoc?.geometry?.coordinates],
    ["Access location GPS", astDoc?.accessData?.location?.gps],
    ["Access location", astDoc?.accessData?.location],
    ["Access GPS", astDoc?.accessData?.gps],
    ["Access point", astDoc?.accessData?.point],
    ["Access meter location", astDoc?.accessData?.meter?.location],
    ["AST data location", astDoc?.ast?.astData?.location],
    ["AST data GPS", astDoc?.ast?.astData?.gps],
    ["Row location", row.location],
    ["Row GPS", row.gps],
    ["Row coordinates", row.coordinates],
    ["Row reading GPS", row.readingGps],
    ["Row reading location", row.readingLocation],
    ["Row meter location", row?.meter?.location],
    ["Raw location", row?.raw?.location],
    ["Raw GPS", row?.raw?.gps],
    ["Raw reading GPS", row?.raw?.readingGps],
  ];

  for (const [source, value] of candidates) {
    const latLng = extractLatLngFromValue(value, source);
    if (latLng) return latLng;
  }

  const nestedAstGpsLatLng = normalizeLatLng(
    firstValue(astDoc?.ast?.location?.gps?.lat, astDoc?.ast?.location?.gps?.latitude),
    firstValue(
      astDoc?.ast?.location?.gps?.lng,
      astDoc?.ast?.location?.gps?.lon,
      astDoc?.ast?.location?.gps?.long,
      astDoc?.ast?.location?.gps?.longitude,
    ),
    "AST nested location GPS",
  );
  if (nestedAstGpsLatLng) return nestedAstGpsLatLng;

  const directAstLatLng = normalizeLatLng(
    firstValue(astDoc.lat, astDoc.latitude, astDoc.gpsLat, astDoc.gpsLatitude),
    firstValue(astDoc.lng, astDoc.lon, astDoc.long, astDoc.longitude, astDoc.gpsLng, astDoc.gpsLongitude),
    "AST direct latitude/longitude",
  );
  if (directAstLatLng) return directAstLatLng;

  return normalizeLatLng(
    firstValue(row.lat, row.latitude, row.gpsLat, row.gpsLatitude),
    firstValue(row.lng, row.lon, row.long, row.longitude, row.gpsLng, row.gpsLongitude),
    "Row direct latitude/longitude",
  );
}

function formatCoordinate(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toFixed(6) : NAv;
}

function buildOpenStreetMapEmbedUrl(latLng) {
  if (!latLng) return "";
  const delta = 0.0028;
  const minLng = latLng.lng - delta;
  const minLat = latLng.lat - delta;
  const maxLng = latLng.lng + delta;
  const maxLat = latLng.lat + delta;

  return `https://www.openstreetmap.org/export/embed.html?bbox=${minLng}%2C${minLat}%2C${maxLng}%2C${maxLat}&layer=mapnik&marker=${latLng.lat}%2C${latLng.lng}`;
}

function buildExternalMapUrl(latLng) {
  if (!latLng) return "";
  return `https://www.google.com/maps/search/?api=1&query=${latLng.lat},${latLng.lng}`;
}

function MeterSpatialMap({ astDoc = {}, row = {} }) {
  const latLng = getMeterLatLng(astDoc, row);
  const mapUrl = buildOpenStreetMapEmbedUrl(latLng);
  const externalMapUrl = buildExternalMapUrl(latLng);

  return (
    <div style={styles.mapStack}>
      {latLng ? (
        <div style={styles.mapPane}>
          <iframe
            title={`Meter location map for ${getAstMeterNo(astDoc)}`}
            src={mapUrl}
            style={styles.mapIframe}
            loading="lazy"
          />
        </div>
      ) : (
        <div style={styles.mapMissingPane}>
          <h4 style={styles.chartTitle}>No meter coordinates available</h4>
          <p className="muted" style={{ margin: "0.35rem 0 0" }}>
            The AST loaded correctly, but no usable latitude/longitude was found
            on the AST or selected row.
          </p>
        </div>
      )}

      <div style={styles.mapInfoGrid}>
        <CompactCardLine label="Meter No" value={getAstMeterNo(astDoc)} />
        <CompactCardLine label="AST ID" value={astDoc.id || getAstDocIdFromRow(row)} identifier />
        <CompactCardLine label="Premise Address" value={getAstPremiseAddress(astDoc)} />
        <CompactCardLine label="Ward Pcode" value={getAstWardPcode(astDoc)} identifier />
        <CompactCardLine
          label="Latitude"
          value={latLng ? formatCoordinate(latLng.lat) : NAv}
        />
        <CompactCardLine
          label="Longitude"
          value={latLng ? formatCoordinate(latLng.lng) : NAv}
        />
        <CompactCardLine
          label="Coordinate Source"
          value={latLng?.source || NAv}
        />
        {latLng ? (
          <a
            href={externalMapUrl}
            target="_blank"
            rel="noreferrer"
            style={styles.openMapLink}
          >
            Open in Google Maps
          </a>
        ) : null}
      </div>
    </div>
  );
}

function getAstLookupKeys(row = {}) {
  return [
    row?.astNo,
    row?.meterNo,
    row?.master?.id,
    row?.ast?.astData?.astNo,
    row?.ast?.astData?.meterNo,
    row?.accessData?.meterNo,
  ]
    .map((value) => normalizeText(value).toUpperCase())
    .filter(Boolean);
}

async function fetchAstByMeterNo(db, meterNo) {
  if (!isMeaningfulText(meterNo)) return null;

  const wanted = normalizeText(meterNo).toUpperCase();
  const queryFields = [
    "astNo",
    "meterNo",
    "master.id",
    "ast.astData.astNo",
    "ast.astData.meterNo",
    "accessData.meterNo",
  ];

  for (const fieldPath of queryFields) {
    try {
      const astSnap = await getDocs(
        query(
          collection(db, "asts"),
          where(fieldPath, "==", meterNo),
          limit(2),
        ),
      );

      for (const astDoc of astSnap.docs) {
        const data = { id: astDoc.id, ...astDoc.data() };
        if (getAstLookupKeys(data).includes(wanted)) return data;
      }
    } catch (error) {
      // Some nested fields may not be indexed or present in all environments.
      // Continue trying the other known AST meter-number fields.
    }
  }

  return null;
}

export default function MeterHistoryModal({ row, registryRows = [], onClose }) {
  const astId = getAstDocIdFromRow(row);
  const meterNo = getMeterNo(row);
  const [astState, setAstState] = useState({
    loading: true,
    error: "",
    ast: null,
  });
  const [historyViewMode, setHistoryViewMode] = useState("table");

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
            error: astId
              ? `Meter AST not found: ${astId}`
              : isMeaningfulText(meterNo)
                ? `Meter AST not found for meter number ${meterNo}.`
                : "No AST ID or meter number available on this row.",
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
      style={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mread-meter-history-title"
    >
      <div style={styles.modalCardLarge}>
        <div style={styles.modalHeader}>
          <div>
            <p className="eyebrow">Meter Details & Reading History</p>
            <h2 id="mread-meter-history-title">{meterNo}</h2>
          </div>

          <div style={styles.modalHeaderActions}>
            <div style={styles.historyViewToggle} aria-label="History view">
              <button
                type="button"
                style={{
                  ...styles.historyViewToggleButton,
                  ...(historyViewMode === "table"
                    ? styles.historyViewToggleButtonActive
                    : {}),
                }}
                onClick={() => setHistoryViewMode("table")}
              >
                Table
              </button>
              <button
                type="button"
                style={{
                  ...styles.historyViewToggleButton,
                  ...(historyViewMode === "graphs"
                    ? styles.historyViewToggleButtonActive
                    : {}),
                }}
                onClick={() => setHistoryViewMode("graphs")}
              >
                Graphs
              </button>
              <button
                type="button"
                style={{
                  ...styles.historyViewToggleButton,
                  ...(historyViewMode === "map"
                    ? styles.historyViewToggleButtonActive
                    : {}),
                }}
                onClick={() => setHistoryViewMode("map")}
              >
                Map
              </button>
            </div>

            <button
              type="button"
              style={styles.modalCloseButton}
              onClick={onClose}
            >
              Close Meter
            </button>
          </div>
        </div>

        <div style={styles.modalBody}>
          {astState.loading ? <LoadingSpinner /> : null}

          {!astState.loading && astState.error ? (
            <div className="empty-state">
              <h2>Could not load meter details</h2>
              <p className="muted">{astState.error}</p>
            </div>
          ) : null}

          {!astState.loading && !astState.error && astDoc ? (
            <div style={styles.meterHistoryStack}>
              <section style={styles.detailsSection}>
                <h3>Meter Details</h3>
                <div style={styles.detailsTwoColumnGrid}>
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

              <section style={styles.detailsSection}>
                <div style={styles.readingSummaryGrid}>
                  <div style={styles.readingSummaryTile}>
                    <span className="muted">First Reading</span>
                    <strong>{formatSummaryMetric(readingSummary.firstReading)}</strong>
                  </div>
                  <div style={styles.readingSummaryTile}>
                    <span className="muted">Last Reading</span>
                    <strong>{formatSummaryMetric(readingSummary.lastReading)}</strong>
                  </div>
                  <div style={styles.readingSummaryTile}>
                    <span className="muted">Total Consumption</span>
                    <strong>{formatSummaryMetric(readingSummary.totalConsumption)}</strong>
                  </div>
                  <div style={styles.readingSummaryTile}>
                    <span className="muted">Avg / Day</span>
                    <strong>{formatSummaryMetric(readingSummary.averagePerDay)}</strong>
                  </div>
                  <div style={styles.readingSummaryTile}>
                    <span className="muted">Avg / Week</span>
                    <strong>{formatSummaryMetric(readingSummary.averagePerWeek)}</strong>
                  </div>
                  <div style={styles.readingSummaryTile}>
                    <span className="muted">Avg / Month</span>
                    <strong>{formatSummaryMetric(readingSummary.averagePerMonth)}</strong>
                  </div>
                  <div style={styles.readingSummaryTile}>
                    <span className="muted">Avg / Year</span>
                    <strong>{formatSummaryMetric(readingSummary.averagePerYear)}</strong>
                  </div>
                </div>
              </section>

              <section style={styles.detailsSection}>
                <div style={styles.sectionHeaderRow}>
                  <div>
                    <h3>
                      {historyViewMode === "graphs"
                        ? "Meter Reading Graphs"
                        : historyViewMode === "map"
                          ? "Meter Spatial Location"
                          : "Meter Reading / Attempt History"}
                    </h3>
                    <p className="muted">
                      {historyViewMode === "graphs"
                        ? "Reading trend and consumption graphs using the same history rows."
                        : historyViewMode === "map"
                          ? "Spatial view from the same AST identity loaded by this modal."
                          : "Registry attempts and cached readings for this meter."}
                    </p>
                  </div>
                  <span style={styles.statusPill}>
                    {formatNumber(historyRows.length)} attempt(s)
                  </span>
                </div>

                {historyViewMode === "map" ? (
                  <MeterSpatialMap astDoc={astDoc} row={row} />
                ) : historyRows.length === 0 ? (
                  <p className="muted">
                    No registry attempts or cached meter readings found for this meter.
                  </p>
                ) : historyViewMode === "graphs" ? (
                  <MeterReadingGraphs historyRows={historyRows} />
                ) : (
                  <div style={styles.historyAttemptList}>
                    {historyRows.map((item) => (
                      <article key={item.key} style={styles.historyAttemptRow}>
                        <div style={styles.historyAttemptContent}>
                          <div style={styles.historyAttemptPrimaryCards}>
                            <div style={styles.historyInfoCard}>
                              <span className="muted">Date / Time</span>
                              <strong style={styles.historyCardDate}>
                                {formatDateTime(item.readingAt)}
                              </strong>
                            </div>

                            <div style={styles.historyInfoCard}>
                              <span className="muted">Outcome</span>
                              <strong>{item.outcomeLabel || NAv}</strong>
                            </div>

                            <div style={styles.historyMetricCard}>
                              <span className="muted">Reading</span>
                              <strong>{formatReading(item.reading)}</strong>
                            </div>

                            <div style={styles.historyMetricCard}>
                              <span className="muted">Previous</span>
                              <strong>{formatReading(item.previousReading)}</strong>
                            </div>

                            <div style={styles.historyMetricCard}>
                              <span className="muted">Consumption</span>
                              <strong>{formatReading(item.consumption)}</strong>
                            </div>
                          </div>

                          <div style={styles.historyAttemptSecondaryCards}>
                            <CompactCardLine
                              label="Days Since Last Reading"
                              value={item.sincePreviousReadingDisplay}
                            />

                            <CompactCardLine label="Reason" value={item.reason || NAv} />

                            <CompactCardLine
                              label="Read By"
                              value={getReadByDisplay(item.capturedBy)}
                            />

                            <CompactCardLine label="TRN" value={item.trnId} identifier />

                            <CompactCardLine label="Source" value={item.source} />
                          </div>
                        </div>
                      </article>
                    ))}
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

const styles = {
  modalCloseButton: {
    border: "1px solid rgba(148, 163, 184, 0.55)",
    background: "#f8fafc",
    color: "#0f172a",
    borderRadius: "999px",
    padding: "0.45rem 0.8rem",
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.08)",
  },
  modalHeaderActions: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  historyViewToggle: {
    display: "inline-flex",
    alignItems: "center",
    border: "1px solid rgba(148, 163, 184, 0.55)",
    background: "#f8fafc",
    borderRadius: "999px",
    padding: "0.18rem",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.08)",
  },
  historyViewToggleButton: {
    border: 0,
    background: "transparent",
    color: "#475569",
    borderRadius: "999px",
    padding: "0.35rem 0.75rem",
    fontSize: "0.78rem",
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  historyViewToggleButtonActive: {
    background: "#0f172a",
    color: "#ffffff",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.18)",
  },
  statusPill: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: "999px",
    padding: "0.2rem 0.55rem",
    fontSize: "0.72rem",
    fontWeight: 800,
    background: "rgba(148, 163, 184, 0.16)",
    color: "#334155",
    whiteSpace: "nowrap",
  },
  secondaryId: {
    marginTop: "0.18rem",
    fontSize: "0.68rem",
    lineHeight: 1.25,
    color: "#64748b",
    wordBreak: "break-word",
  },
  secondaryIdCompact: {
    marginTop: "0.18rem",
    fontSize: "0.62rem",
    lineHeight: 1.15,
    color: "#64748b",
    wordBreak: "break-word",
    maxHeight: "1.45rem",
    overflow: "hidden",
  },
  loadingBlock: {
    minHeight: "160px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "1rem",
    textAlign: "left",
  },
  spinner: {
    width: "34px",
    height: "34px",
    borderRadius: "999px",
    border: "4px solid rgba(148, 163, 184, 0.25)",
    borderTopColor: "#2563eb",
    animation: "ireps-spin 0.9s linear infinite",
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1.5rem",
    background: "rgba(15, 23, 42, 0.58)",
  },
  modalCardLarge: {
    width: "min(1120px, 96vw)",
    height: "min(88vh, 900px)",
    maxHeight: "88vh",
    overflow: "hidden",
    background: "#fff",
    borderRadius: "1.2rem",
    boxShadow: "0 24px 70px rgba(15, 23, 42, 0.28)",
    display: "flex",
    flexDirection: "column",
  },
  modalHeader: {
    flex: "0 0 auto",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "1rem",
    borderBottom: "1px solid rgba(148, 163, 184, 0.32)",
    padding: "1rem 1.25rem",
    background: "#fff",
    position: "sticky",
    top: 0,
    zIndex: 5,
    boxShadow: "0 8px 18px rgba(15, 23, 42, 0.08)",
  },
  modalBody: {
    flex: "1 1 auto",
    minHeight: 0,
    overflowY: "auto",
    overscrollBehavior: "contain",
    padding: "1.25rem",
  },
  detailsTwoColumnGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
    gap: "1.1rem",
    marginTop: 0,
    alignItems: "start",
  },
  detailsSection: {
    border: "1px solid rgba(148, 163, 184, 0.24)",
    borderRadius: "0.95rem",
    padding: "0.9rem",
    background: "rgba(248, 250, 252, 0.72)",
  },
  detailLine: {
    display: "grid",
    gridTemplateColumns: "120px 1fr",
    gap: "0.75rem",
    padding: "0.42rem 0",
    borderTop: "1px solid rgba(148, 163, 184, 0.18)",
  },
  meterHistoryStack: {
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
  },
  sectionHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "1rem",
    marginBottom: "0.75rem",
  },
  readingSummaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
    gap: "0.55rem",
  },
  readingSummaryTile: {
    border: "1px solid rgba(148, 163, 184, 0.22)",
    borderRadius: "0.75rem",
    padding: "0.55rem 0.65rem",
    background: "rgba(255, 255, 255, 0.78)",
    display: "flex",
    flexDirection: "column",
    gap: "0.2rem",
    minWidth: 0,
  },
  historyAttemptList: {
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
  },
  historyAttemptRow: {
    width: "100%",
    minWidth: 0,
    border: "1px solid rgba(148, 163, 184, 0.28)",
    borderRadius: "0.9rem",
    padding: "0.75rem",
    background: "rgba(255, 255, 255, 0.9)",
    boxShadow: "0 8px 18px rgba(15, 23, 42, 0.06)",
  },
  historyAttemptContent: {
    display: "flex",
    flexDirection: "column",
    gap: "0.55rem",
  },
  historyAttemptPrimaryCards: {
    display: "grid",
    gridTemplateColumns: "minmax(170px, 1.35fr) minmax(170px, 1.2fr) repeat(3, minmax(130px, 0.8fr))",
    gap: "0.55rem",
    alignItems: "stretch",
  },
  historyAttemptSecondaryCards: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: "0.55rem",
    alignItems: "stretch",
  },
  historyInfoCard: {
    minWidth: 0,
    border: "1px solid rgba(148, 163, 184, 0.18)",
    borderRadius: "0.65rem",
    padding: "0.45rem 0.5rem",
    background: "rgba(248, 250, 252, 0.8)",
    display: "flex",
    flexDirection: "column",
    gap: "0.16rem",
    overflowWrap: "anywhere",
  },
  historyCardDate: {
    display: "block",
    marginTop: "0.16rem",
    fontSize: "0.82rem",
    color: "#0f172a",
  },
  historyMetricCard: {
    minWidth: 0,
    border: "1px solid rgba(148, 163, 184, 0.18)",
    borderRadius: "0.65rem",
    padding: "0.45rem 0.5rem",
    background: "rgba(248, 250, 252, 0.8)",
    display: "flex",
    flexDirection: "column",
    gap: "0.16rem",
    overflowWrap: "anywhere",
  },
  historyCardLine: {
    minWidth: 0,
    border: "1px solid rgba(148, 163, 184, 0.18)",
    borderRadius: "0.65rem",
    padding: "0.45rem 0.5rem",
    background: "rgba(248, 250, 252, 0.8)",
    display: "flex",
    flexDirection: "column",
    gap: "0.14rem",
    fontSize: "0.74rem",
    lineHeight: 1.22,
    overflowWrap: "anywhere",
  },
  historyCardIdentifier: {
    maxHeight: "2.4rem",
    overflow: "hidden",
    overflowWrap: "anywhere",
  },
  graphStack: {
    display: "grid",
    gap: "0.85rem",
  },
  chartFrame: {
    border: "1px solid rgba(148, 163, 184, 0.26)",
    borderRadius: "0.9rem",
    background: "rgba(255, 255, 255, 0.94)",
    boxShadow: "0 8px 18px rgba(15, 23, 42, 0.05)",
    overflow: "hidden",
  },
  chartFrameHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "0.8rem 0.9rem 0.25rem",
  },
  chartTitle: {
    margin: 0,
    color: "#0f172a",
    fontSize: "0.98rem",
  },
  chartDescription: {
    margin: "0.2rem 0 0",
  },
  chartScroll: {
    overflowX: "auto",
    padding: "0.3rem 0.7rem 0.7rem",
  },
  chartSvg: {
    width: "100%",
    height: "230px",
    display: "block",
  },
  chartAxisLabel: {
    fill: "#64748b",
    fontSize: "11px",
    fontWeight: 700,
  },
  emptyChart: {
    minHeight: "120px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1rem",
    textAlign: "center",
  },
  mapStack: {
    display: "grid",
    gap: "0.85rem",
  },
  mapPane: {
    minHeight: "360px",
    border: "1px solid rgba(148, 163, 184, 0.28)",
    borderRadius: "0.9rem",
    overflow: "hidden",
    background: "rgba(226, 232, 240, 0.45)",
    boxShadow: "0 8px 18px rgba(15, 23, 42, 0.05)",
  },
  mapIframe: {
    width: "100%",
    height: "360px",
    border: 0,
    display: "block",
  },
  mapMissingPane: {
    minHeight: "220px",
    border: "1px dashed rgba(148, 163, 184, 0.65)",
    borderRadius: "0.9rem",
    background: "rgba(248, 250, 252, 0.86)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "1rem",
    textAlign: "center",
  },
  mapInfoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: "0.55rem",
    alignItems: "stretch",
  },
  openMapLink: {
    minWidth: 0,
    border: "1px solid rgba(37, 99, 235, 0.32)",
    borderRadius: "0.65rem",
    padding: "0.55rem 0.65rem",
    background: "rgba(37, 99, 235, 0.08)",
    color: "#1d4ed8",
    fontWeight: 800,
    textDecoration: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
};
