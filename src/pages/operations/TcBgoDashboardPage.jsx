import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import {
  useGetTcRowsByTcIdQuery,
  useGetTcUploadByIdQuery,
} from "../../redux/tcApi";
import {
  useGetBgoBatchesByTcIdQuery,
  useGetBgoRowsByTcIdQuery,
} from "../../redux/bgoApi";
import { useGetTrnsByTcIdQuery } from "../../redux/trnsApi";

function asNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function valueOrNav(value) {
  if (value === null || value === undefined || value === "") return "NAv";
  return value;
}

const DETAIL_ROW_DISPLAY_LIMIT = 500;
const FILTER_ALL = "ALL";

function cleanFilterValue(value) {
  const clean = String(valueOrNav(value)).trim();
  return clean || "NAv";
}

function getUniqueFilterOptions(rows = [], key) {
  return Array.from(
    new Set(
      asArray(rows)
        .map((row) => cleanFilterValue(row?.[key]))
        .filter((value) => value && value !== "NAv"),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function matchesSelectFilter(value, selectedValue) {
  if (selectedValue === FILTER_ALL) return true;
  return cleanFilterValue(value) === selectedValue;
}

function matchesTextFilter(value, searchText = "") {
  const search = String(searchText || "").trim().toLowerCase();

  if (!search) return true;

  return String(valueOrNav(value)).toLowerCase().includes(search);
}

function hasMeaningfulValue(value) {
  if (value === null || value === undefined) return false;

  const text = String(value).trim().toUpperCase();

  return (
    text !== "" &&
    text !== "NAV" &&
    text !== "N/A" &&
    text !== "NA" &&
    text !== "NULL" &&
    text !== "UNDEFINED"
  );
}

function formatNumber(value) {
  return asNumber(value).toLocaleString("en-ZA");
}

function normalizeUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatTime(value) {
  const date = toDate(value);
  if (!date) return "NAv";

  return date.toLocaleTimeString("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTime(value) {
  const date = toDate(value);
  if (!date) return "NAv";

  return date.toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(startValue, endValue) {
  const start = toDate(startValue);
  const end = toDate(endValue);

  if (!start || !end) return "NAv";

  const totalMinutes = Math.max(
    0,
    Math.round((end.getTime() - start.getTime()) / 60000),
  );

  if (totalMinutes < 60) return `${totalMinutes}m`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours < 24) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}


function getFirstDateValue(values = []) {
  const dates = asArray(values)
    .map((value) => toDate(value))
    .filter(Boolean)
    .sort((left, right) => left.getTime() - right.getTime());

  return dates[0]?.toISOString() || null;
}

function getDashboardCounts(upload = {}) {
  const source = upload || {};

  return source.dashboardSummary?.counts || source.raw?.dashboardSummary?.counts || {};
}

function getDashboardTime(upload = {}) {
  const source = upload || {};

  return source.dashboardSummary?.time || source.raw?.dashboardSummary?.time || {};
}

function getDashboardAttention(upload = {}) {
  const source = upload || {};

  return source.dashboardSummary?.attention || source.raw?.dashboardSummary?.attention || {};
}

function getReportStatus(upload = {}) {
  return String(
    upload?.report?.status ||
      upload?.finalReport?.status ||
      upload?.reportStatus ||
      "DRAFT",
  )
    .trim()
    .toUpperCase();
}

function getGeofenceRefs(row = {}) {
  return asArray(row.geofenceRefs || row.ast?.geofenceRefs);
}

function getFirstGeofenceName(row = {}) {
  const refs = getGeofenceRefs(row);

  if (refs.length === 0) return "NAv";

  return valueOrNav(refs[0]?.name || refs[0]?.id);
}

function getMeterNo(row = {}) {
  return valueOrNav(row.input?.meterNo || row.ast?.astNo || row.meterNo);
}

function getErfNo(row = {}) {
  return valueOrNav(row.ast?.erfNo || row.erfNo || row.backend?.erfNo);
}

function getAddress(row = {}) {
  return valueOrNav(row.premise?.address || row.input?.premiseAddress);
}

function getTcRowIdFromBgoRow(row = {}) {
  return valueOrNav(
    row.tcRowId ||
      row.tcRow?.id ||
      row.rowId ||
      row.sourceTcRowId ||
      row.source?.tcRowId,
  );
}

function getBatchIdFromBgoRow(row = {}) {
  return valueOrNav(row.bgoBatchId || row.batchId || row.batch?.id);
}

function getBatchIdFromTcRow(row = {}) {
  return valueOrNav(row.bgo?.batchId || row.batchId || row.raw?.bgo?.batchId);
}

function getChildTrnIdFromBgoRow(row = {}) {
  return valueOrNav(row.trnId || row.childTrnId || row.trn?.id || row.workflow?.trnId);
}

function getChildTrnIdFromTcRow(row = {}) {
  return valueOrNav(row.bgo?.trnId || row.bgo?.childTrnId || row.raw?.bgo?.trnId);
}

function getTrnIdFromSource(source = {}) {
  return valueOrNav(
    source.trnId ||
      source.id ||
      source.trn?.id ||
      source.trn?.trnId ||
      source.childTrnId ||
      source.refs?.trnId ||
      source.bgo?.trnId,
  );
}

function buildTrnsById(trns = []) {
  const byId = new Map();

  trns.forEach((trn) => {
    const ids = [
      trn?.id,
      trn?.trnId,
      trn?.raw?.id,
      trn?.raw?.trnId,
    ].filter(hasMeaningfulValue);

    ids.forEach((id) => byId.set(String(id), trn));
  });

  return byId;
}

function buildTrnsByBatchId(trns = []) {
  const byBatchId = new Map();

  trns.forEach((trn) => {
    const batchId = valueOrNav(
      trn?.bgoBatchId ||
        trn?.batchId ||
        trn?.raw?.bgoBatchId ||
        trn?.raw?.batchId ||
        trn?.raw?.bgo?.batchId ||
        trn?.raw?.origin?.bgoBatchId ||
        trn?.raw?.refs?.bgoBatchId,
    );

    if (!hasMeaningfulValue(batchId)) return;

    if (!byBatchId.has(batchId)) {
      byBatchId.set(batchId, []);
    }

    byBatchId.get(batchId).push(trn);
  });

  return byBatchId;
}

function getTrnForRow({ row, bgoRow, trnsById }) {
  const candidateIds = [
    getChildTrnIdFromBgoRow(bgoRow || {}),
    getChildTrnIdFromTcRow(row || {}),
    getTrnIdFromSource(bgoRow || {}),
    bgoRow?.trn?.id,
    bgoRow?.trn?.trnId,
  ].filter(hasMeaningfulValue);

  for (const candidateId of candidateIds) {
    const trn = trnsById.get(String(candidateId));
    if (trn) return trn;
  }

  return null;
}

function getWorkflowState(source = {}) {
  return valueOrNav(
    source.workflowState ||
      source.workflow?.state ||
      source.trnWorkflowState ||
      source.trn?.workflow?.state ||
      source.trn?.workflowState ||
      source.bgo?.workflowState,
  );
}

function getExecutionOutcome(source = {}) {
  const directOutcome =
    source.executionOutcomeCode ||
    source.outcomeCode ||
    source.executionOutcome ||
    source.outcome ||
    source.trn?.executionOutcomeCode ||
    source.trn?.executionOutcome ||
    source.trn?.outcome ||
    source.bgo?.executionOutcomeCode ||
    source.bgo?.executionOutcome;

  if (typeof directOutcome === "object" && directOutcome !== null) {
    return valueOrNav(
      directOutcome.code ||
        directOutcome.id ||
        directOutcome.state ||
        directOutcome.status ||
        directOutcome.outcome ||
        directOutcome.result ||
        directOutcome.answer ||
        directOutcome.label ||
        directOutcome.name,
    );
  }

  return valueOrNav(directOutcome);
}

function isSuccessOutcome(value) {
  const outcome = normalizeUpper(value);

  return outcome === "SUCCESS" || outcome === "SUCCESSFUL" || outcome === "ACCESS_YES";
}

function isCompletedState(value) {
  return normalizeUpper(value) === "COMPLETED";
}

function isCancelledState(value) {
  return normalizeUpper(value) === "CANCELLED" || normalizeUpper(value) === "CANCELED";
}

function hasBgoBatchId(row) {
  return hasMeaningfulValue(getBatchIdFromTcRow(row));
}

function isBgoUsed(row) {
  return row?.bgo?.used === true || hasBgoBatchId(row);
}

function isBgoReadyCurrent(row) {
  return (
    row?.bgo?.ready === true &&
    row?.bgo?.readinessState === "READY_FOR_BGO" &&
    isBgoUsed(row) !== true
  );
}

function isFound(row) {
  return row?.backend?.matched === true;
}

function isNotFound(row) {
  return row?.backend?.notFound === true || row?.backend?.matched === false;
}

function isNotEligible(row) {
  return row?.backend?.notEligible === true || row?.backend?.eligible === false;
}

function isBlocked(row) {
  return row?.backend?.alreadyHasActiveSameOperationTrn === true;
}

function needsGeofence(row) {
  return isFound(row) && getGeofenceRefs(row).length === 0;
}

function isBgoReadyOrIssued(row = {}) {
  return (
    isFound(row) &&
    (isBgoUsed(row) === true ||
      (row?.bgo?.ready === true && row?.bgo?.readinessState === "READY_FOR_BGO"))
  );
}

function isDuplicateMeterRow(row = {}) {
  return row?.backend?.duplicateMeterInUpload === true;
}

function buildNotReadyBreakdownFromRows(rows = []) {
  const breakdown = {
    needsGeofenceRows: 0,
    notEligibleRows: 0,
    blockedActiveSameOperationRows: 0,
    duplicateMeterRows: 0,
    otherNotReadyRows: 0,
  };

  asArray(rows)
    .filter((row) => isFound(row) && isBgoReadyOrIssued(row) !== true)
    .forEach((row) => {
      // Keep the breakdown as a partition, not overlapping buckets.
      // This makes: BGO Not Ready = sum of breakdown rows.
      if (needsGeofence(row)) {
        breakdown.needsGeofenceRows += 1;
        return;
      }

      if (isBlocked(row)) {
        breakdown.blockedActiveSameOperationRows += 1;
        return;
      }

      if (isDuplicateMeterRow(row)) {
        breakdown.duplicateMeterRows += 1;
        return;
      }

      if (isNotEligible(row)) {
        breakdown.notEligibleRows += 1;
        return;
      }

      breakdown.otherNotReadyRows += 1;
    });

  return breakdown;
}

function buildNotReadyBreakdownFromSummary({
  sourceUpload = {},
  sourceSummary = {},
  bgoNotReadyRows = 0,
} = {}) {
  const rawBreakdown = {
    needsGeofenceRows: asNumber(
      sourceUpload.needsGeofenceRows ?? sourceSummary.needsGeofenceRows,
    ),
    blockedActiveSameOperationRows: asNumber(
      sourceUpload.blockedActiveSameOperationRows ??
        sourceSummary.blockedActiveSameOperationRows,
    ),
    duplicateMeterRows: asNumber(
      sourceUpload.duplicateMeterRows ?? sourceSummary.duplicateMeterRows,
    ),
    notEligibleRows: asNumber(
      sourceUpload.notEligibleRows ?? sourceSummary.notEligibleRows,
    ),
  };

  // Summary buckets can overlap. Keep the rendered chart reconciled to
  // bgoNotReadyRows by capping in priority order and sending remainder to Other.
  let remaining = Math.max(asNumber(bgoNotReadyRows), 0);

  const needsGeofenceRows = Math.min(rawBreakdown.needsGeofenceRows, remaining);
  remaining -= needsGeofenceRows;

  const blockedActiveSameOperationRows = Math.min(
    rawBreakdown.blockedActiveSameOperationRows,
    remaining,
  );
  remaining -= blockedActiveSameOperationRows;

  const duplicateMeterRows = Math.min(rawBreakdown.duplicateMeterRows, remaining);
  remaining -= duplicateMeterRows;

  const notEligibleRows = Math.min(rawBreakdown.notEligibleRows, remaining);
  remaining -= notEligibleRows;

  return {
    needsGeofenceRows,
    blockedActiveSameOperationRows,
    duplicateMeterRows,
    notEligibleRows,
    otherNotReadyRows: remaining,
  };
}

function buildBgoRowsByTcRowId(bgoRows = []) {
  const map = new Map();

  bgoRows.forEach((row) => {
    const tcRowId = getTcRowIdFromBgoRow(row);
    if (!hasMeaningfulValue(tcRowId)) return;
    map.set(tcRowId, row);
  });

  return map;
}

function buildBgoRowsByBatchId(bgoRows = []) {
  const map = new Map();

  bgoRows.forEach((row) => {
    const batchId = getBatchIdFromBgoRow(row);
    if (!hasMeaningfulValue(batchId)) return;

    if (!map.has(batchId)) map.set(batchId, []);
    map.get(batchId).push(row);
  });

  return map;
}

function getRowBgoRow(row = {}, bgoRowsByTcRowId = new Map()) {
  return bgoRowsByTcRowId.get(row.id) || bgoRowsByTcRowId.get(row.raw?.id) || null;
}

function calculateUploadMetrics({ upload = {}, tcRows = [], bgoRows = [], trns = [] } = {}) {
  const sourceUpload = upload || {};
  const sourceSummary = sourceUpload.summary || {};
  const safeTcRows = asArray(tcRows);
  const safeBgoRows = asArray(bgoRows);
  const safeTrns = asArray(trns);

  const dashboardCounts = getDashboardCounts(sourceUpload);
  const hasRows = safeTcRows.length > 0;
  const hasTrns = safeTrns.length > 0;

  const currentReadyRows = safeTcRows.filter(isBgoReadyCurrent).length;
  const usedRowsFromTc = safeTcRows.filter(isBgoUsed).length;
  const issuedRowsFromBgoRows = safeBgoRows.length;
  const issuedRowsFromTrns = safeTrns.length;

  const issuedToBgoRows = asNumber(
    dashboardCounts.issuedToBgoRows ??
      dashboardCounts.issuedRows ??
      Math.max(
        asNumber(sourceUpload.usedRows ?? sourceSummary.usedRows),
        usedRowsFromTc,
        issuedRowsFromBgoRows,
        issuedRowsFromTrns,
      ),
  );

  const foundRows = hasRows
    ? safeTcRows.filter(isFound).length
    : asNumber(
        dashboardCounts.foundRows ?? sourceUpload.foundRows ?? sourceSummary.foundRows,
      );

  const notFoundRows = hasRows
    ? safeTcRows.filter(isNotFound).length
    : asNumber(
        dashboardCounts.notFoundRows ?? sourceUpload.notFoundRows ?? sourceSummary.notFoundRows,
      );

  const totalRows = hasRows
    ? safeTcRows.length
    : asNumber(dashboardCounts.totalRows ?? sourceUpload.totalRows ?? sourceSummary.totalRows);

  const notYetIssuedRows = hasRows
    ? currentReadyRows
    : asNumber(
        dashboardCounts.notYetIssuedRows ??
          sourceUpload.readyRows ??
          sourceUpload.remainingRows ??
          sourceSummary.readyRows ??
          sourceSummary.remainingRows,
      );

  // BGO readiness is scoped to FOUND rows only.
  // Not Found rows belong to the upload review layer and must not inflate
  // the BGO Ready vs Not Ready chart.
  const rawBgoReadyRows = asNumber(
    dashboardCounts.bgoReadyRows ?? issuedToBgoRows + notYetIssuedRows,
  );
  const bgoReadyRows = Math.min(foundRows, Math.max(rawBgoReadyRows, 0));

  // The BGO Ready vs Not Ready chart must reconcile to FOUND rows only:
  // Found = BGO Ready + BGO Not Ready.
  // Do not use dashboardCounts.bgoNotReadyRows or reason-bucket totals here,
  // because those can include overlap or upload-review rows such as Not Found.
  const bgoNotReadyRows = Math.max(foundRows - bgoReadyRows, 0);

  const notReadyBreakdown = hasRows
    ? buildNotReadyBreakdownFromRows(safeTcRows)
    : buildNotReadyBreakdownFromSummary({
        sourceUpload,
        sourceSummary,
        bgoNotReadyRows,
      });

  const needsGeofenceRows = notReadyBreakdown.needsGeofenceRows;
  const notEligibleRows = notReadyBreakdown.notEligibleRows;
  const blockedActiveSameOperationRows =
    notReadyBreakdown.blockedActiveSameOperationRows;
  const duplicateMeterRows = notReadyBreakdown.duplicateMeterRows;
  const otherNotReadyRows = notReadyBreakdown.otherNotReadyRows;

  const executionSources = hasTrns ? safeTrns : safeBgoRows;
  const completedSources = executionSources.filter((item) =>
    isCompletedState(getWorkflowState(item)),
  );
  const cancelledSources = executionSources.filter((item) =>
    isCancelledState(getWorkflowState(item)),
  );
  const successfulSources = completedSources.filter((item) =>
    isSuccessOutcome(getExecutionOutcome(item)),
  );
  const unsuccessfulSources = completedSources.filter(
    (item) =>
      hasMeaningfulValue(getExecutionOutcome(item)) &&
      !isSuccessOutcome(getExecutionOutcome(item)),
  );

  const executedRows = asNumber(
    dashboardCounts.executedRows ??
      dashboardCounts.completedRows ??
      completedSources.length,
  );
  const cancelledRows = asNumber(
    dashboardCounts.cancelledRows ?? dashboardCounts.cancelled ?? cancelledSources.length,
  );
  const notExecutedRows = asNumber(
    dashboardCounts.notExecutedRows ?? Math.max(issuedToBgoRows - executedRows - cancelledRows, 0),
  );
  const successfulRows = asNumber(
    dashboardCounts.successfulRows ?? dashboardCounts.successRows ?? successfulSources.length,
  );
  const unsuccessfulRows = asNumber(
    dashboardCounts.unsuccessfulRows ?? dashboardCounts.failedRows ?? unsuccessfulSources.length,
  );

  return {
    totalRows,
    foundRows,
    notFoundRows,
    bgoReadyRows,
    bgoNotReadyRows,
    issuedToBgoRows,
    notYetIssuedRows,
    executedRows,
    notExecutedRows,
    cancelledRows,
    successfulRows,
    unsuccessfulRows,
    needsGeofenceRows,
    notEligibleRows,
    blockedActiveSameOperationRows,
    duplicateMeterRows,
    otherNotReadyRows,
  };
}

function getPrimaryStatus(metrics) {
  if (
    metrics.issuedToBgoRows > 0 &&
    metrics.executedRows + metrics.cancelledRows >= metrics.issuedToBgoRows
  ) {
    return "COMPLETED";
  }

  if (
    metrics.issuedToBgoRows > 0 &&
    metrics.executedRows + metrics.cancelledRows < metrics.issuedToBgoRows
  ) {
    return "IN PROGRESS";
  }

  if (metrics.issuedToBgoRows > 0 && metrics.notYetIssuedRows > 0) {
    return "BGO ALLOCATION INCOMPLETE";
  }

  if (metrics.bgoReadyRows > 0 && metrics.issuedToBgoRows === 0) {
    return "READY FOR BGO ALLOCATION";
  }

  if (metrics.bgoNotReadyRows > 0) return "BGO READINESS REQUIRED";
  if (metrics.notFoundRows > 0) return "UPLOAD REVIEW REQUIRED";

  return "UPLOADED";
}

function getAttentionFlags(upload, metrics) {
  const dashboardAttention = getDashboardAttention(upload);
  const flags = new Set(asArray(dashboardAttention.reasons));

  if (metrics.notFoundRows > 0) flags.add("UPLOAD REVIEW REQUIRED");
  if (metrics.bgoNotReadyRows > 0) flags.add("BGO READINESS REQUIRED");
  if (metrics.issuedToBgoRows > 0 && metrics.notYetIssuedRows > 0) {
    flags.add("BGO ALLOCATION INCOMPLETE");
  }
  if (
    metrics.issuedToBgoRows > 0 &&
    metrics.executedRows + metrics.cancelledRows < metrics.issuedToBgoRows
  ) {
    flags.add("IN PROGRESS");
  }
  if (metrics.unsuccessfulRows > 0) flags.add("ATTENTION REQUIRED");

  return Array.from(flags);
}

function buildTrackerStages(upload = {}, metrics = {}, bgoBatches = [], trns = []) {
  const sourceUpload = upload || {};
  const time = getDashboardTime(sourceUpload);
  const metadata = sourceUpload.metadata || {};
  const raw = sourceUpload.raw || {};
  const safeBgoBatches = asArray(bgoBatches);
  const safeTrns = asArray(trns);

  const uploadedAt = getFirstDateValue([
    time.uploadedAt,
    metadata.createdAt,
    raw.createdAt,
    raw.metadata?.createdAt,
  ]);

  const tcRowsCreatedAt = getFirstDateValue([
    time.tcRowsCreatedAt,
    raw.tcRowsCreatedAt,
    raw.rowsCreatedAt,
    metadata.updatedAt,
    raw.metadata?.updatedAt,
  ]);

  const firstBgoAt = getFirstDateValue([
    time.firstBgoAt,
    raw.firstBgoAt,
    ...safeBgoBatches.map(
      (batch) =>
        batch?.metadata?.createdAt ||
        batch?.raw?.metadata?.createdAt ||
        batch?.raw?.createdAt ||
        batch?.createdAt,
    ),
  ]);

  const firstIssuedAt =
    getFirstDateValue([
      time.firstIssuedAt,
      raw.firstIssuedAt,
      ...safeTrns.map(
        (trn) =>
          trn?.workflow?.issuedAt ||
          trn?.raw?.workflow?.issuedAt ||
          trn?.metadata?.createdAt ||
          trn?.raw?.metadata?.createdAt ||
          trn?.raw?.createdAt,
      ),
    ]) || firstBgoAt;

  const firstAcceptedAt = getFirstDateValue([
    time.firstAcceptedAt,
    raw.firstAcceptedAt,
    ...safeBgoBatches.map(
      (batch) =>
        batch?.workflow?.acceptedAt ||
        batch?.raw?.workflow?.acceptedAt ||
        batch?.raw?.bgo?.acceptedAt ||
        batch?.raw?.assignment?.acceptedRejectedAt,
    ),
    ...safeTrns.map(
      (trn) =>
        trn?.workflow?.acceptedAt ||
        trn?.raw?.workflow?.acceptedAt ||
        trn?.raw?.bgo?.acceptedAt ||
        trn?.assignment?.acceptedRejectedAt ||
        trn?.raw?.assignment?.acceptedRejectedAt,
    ),
  ]);

  const completedTrns = safeTrns.filter((trn) => isCompletedState(getWorkflowState(trn)));
  const firstCompletedAt = getFirstDateValue([
    time.firstCompletedAt,
    time.lastCompletedAt,
    raw.firstCompletedAt,
    raw.lastCompletedAt,
    ...completedTrns.map(
      (trn) =>
        trn?.workflow?.completedAt ||
        trn?.raw?.workflow?.completedAt ||
        trn?.metadata?.updatedAt ||
        trn?.raw?.metadata?.updatedAt,
    ),
  ]);

  const isFullyCompleted =
    metrics.issuedToBgoRows > 0 &&
    metrics.executedRows + metrics.cancelledRows >= metrics.issuedToBgoRows;

  const hasPartialCompletion =
    metrics.issuedToBgoRows > 0 &&
    metrics.executedRows + metrics.cancelledRows > 0 &&
    metrics.executedRows + metrics.cancelledRows < metrics.issuedToBgoRows;

  const stageInputs = [
    {
      code: "UPLOAD_VERIFY",
      label: "UPLOAD / VERIFY",
      timestamp: uploadedAt,
      status: uploadedAt || sourceUpload.id ? "DONE" : "WAITING",
      previousTimestamp: null,
      help:
        "File upload and backend validation. These happen together in the current TC upload flow.",
    },
    {
      code: "TC_ROWS",
      label: "TC ROWS",
      timestamp: tcRowsCreatedAt,
      status: metrics.totalRows > 0 ? "DONE" : "WAITING",
      previousTimestamp: uploadedAt,
      help:
        "TC rows were created and evaluated from the uploaded file. The duration before this card is from upload/verify to TC row creation.",
    },
    {
      code: "BGO",
      label: "BGO",
      timestamp: firstBgoAt,
      status: metrics.issuedToBgoRows > 0 ? "DONE" : "WAITING",
      previousTimestamp: tcRowsCreatedAt || uploadedAt,
      help:
        "BGO batch creation started from eligible TC rows. The duration before this card is from TC rows to first BGO batch creation.",
    },
    {
      code: "ISSUED",
      label: "ISSUED",
      timestamp: firstIssuedAt,
      status: metrics.issuedToBgoRows > 0 ? "DONE" : "WAITING",
      previousTimestamp: firstBgoAt || tcRowsCreatedAt || uploadedAt,
      help:
        "First child TRN was issued from the BGO batch. The duration before this card is from BGO creation to first issue.",
    },
    {
      code: "ACCEPTED",
      label: "ACCEPTED",
      timestamp: firstAcceptedAt,
      status: firstAcceptedAt ? "DONE" : "WAITING",
      previousTimestamp: firstIssuedAt || firstBgoAt || uploadedAt,
      help:
        "First BGO/child work acceptance happened. The duration before this card is from first issue to first acceptance.",
    },
    {
      code: "COMPLETED",
      label: "COMPLETED",
      timestamp: firstCompletedAt,
      status: isFullyCompleted ? "DONE" : hasPartialCompletion ? "PARTIAL" : "WAITING",
      previousTimestamp: firstAcceptedAt || firstIssuedAt || firstBgoAt || uploadedAt,
      help:
        "First child TRN completion happened. The duration before this card is from first acceptance to first completion. Status stays PARTIAL until all issued child TRNs are complete.",
    },
  ];

  return stageInputs.map((stage) => {
    const formattedDuration =
      stage.previousTimestamp && stage.timestamp
        ? formatDuration(stage.previousTimestamp, stage.timestamp)
        : "";

    return {
      ...stage,
      displayTimestamp: stage.timestamp ? formatTime(stage.timestamp) : "",
      durationFromPrevious: formattedDuration === "NAv" ? "" : formattedDuration,
    };
  });
}

function TrackerStage({ stage }) {
  const stageStatusStyle =
    stage.status === "PARTIAL"
      ? styles.stagePartial
      : stage.status === "WAITING"
        ? styles.stageWaiting
        : styles.stageDone;

  const statusPillStyle =
    stage.status === "PARTIAL"
      ? styles.stageStatusPartial
      : stage.status === "WAITING"
        ? styles.stageStatusWaiting
        : styles.stageStatusDone;

  return (
    <div style={{ ...styles.stageCard, ...stageStatusStyle }}>
      <strong>{stage.label}</strong>
      <span>{stage.displayTimestamp}</span>
      <small style={{ ...styles.stageStatusPill, ...statusPillStyle }}>
        {stage.status}
      </small>

      <span
        aria-label={`${stage.label} help`}
        title={stage.help}
        style={styles.stageHelpIcon}
      >
        ?
      </span>
    </div>
  );
}

function UploadLifecycleTracker({ upload, metrics, bgoBatches, trns }) {
  const trackerStages = useMemo(
    () => buildTrackerStages(upload, metrics, bgoBatches, trns),
    [upload, metrics, bgoBatches, trns],
  );

  return (
    <div style={styles.trackerShell}>
      <p style={styles.sectionMiniTitle}>TC Upload Lifecycle Tracker</p>

      <div style={styles.trackerRow}>
        {trackerStages.flatMap((stage, index) => {
          const items = [<TrackerStage key={stage.code} stage={stage} />];

          if (index < trackerStages.length - 1) {
            const nextStage = trackerStages[index + 1];

            items.push(
              <div key={`${stage.code}-connector`} style={styles.trackerConnectorBlock}>
                <span style={styles.durationLabel}>
                  {nextStage?.durationFromPrevious || ""}
                </span>
                <span style={styles.connector}>→</span>
              </div>,
            );
          }

          return items;
        })}
      </div>
    </div>
  );
}


function getDateTimeValue(values = []) {
  return getFirstDateValue(values);
}

function formatTrackingTime(value) {
  const formatted = formatTime(value);
  return formatted === "NAv" ? "" : formatted;
}

function getTrackingStageStyle(status = "") {
  const cleanStatus = normalizeUpper(status).replace(/_/g, " ");

  if (
    cleanStatus === "DONE" ||
    cleanStatus === "FOUND" ||
    cleanStatus === "ISSUED" ||
    cleanStatus === "ACCEPTED" ||
    cleanStatus === "SUCCESS" ||
    cleanStatus === "SUCCESSFUL"
  ) {
    return styles.trackingStatusSuccess;
  }

  if (
    cleanStatus === "NOT FOUND" ||
    cleanStatus === "FAILED" ||
    cleanStatus === "CANCELLED" ||
    cleanStatus === "CANCELED" ||
    cleanStatus === "BLOCKED"
  ) {
    return styles.trackingStatusDanger;
  }

  if (
    cleanStatus === "NOT DONE" ||
    cleanStatus === "NOT READY" ||
    cleanStatus === "NO ACCESS" ||
    cleanStatus === "NO READING" ||
    cleanStatus.includes("NO GEOFENCE")
  ) {
    return styles.trackingStatusWarning;
  }

  return styles.trackingStatusNeutral;
}

function normalizeTrackingStatus(status = "") {
  const cleanStatus = String(status || "").trim();

  if (!hasMeaningfulValue(cleanStatus)) return "—";

  return cleanStatus.replace(/_/g, " ").toUpperCase();
}

function getRowUploadVerifyTime(row = {}, upload = {}) {
  return getDateTimeValue([
    row?.metadata?.createdAt,
    row?.raw?.metadata?.createdAt,
    upload?.metadata?.createdAt,
    upload?.raw?.metadata?.createdAt,
    upload?.raw?.createdAt,
  ]);
}

function getRowTcTime(row = {}) {
  return getDateTimeValue([
    row?.backend?.bgoEvaluation?.evaluatedAt,
    row?.backend?.refreshedFromAstAt,
    row?.metadata?.updatedAt,
    row?.metadata?.createdAt,
    row?.raw?.metadata?.updatedAt,
    row?.raw?.metadata?.createdAt,
  ]);
}

function getRowBgoCreatedTime(row = {}, bgoRow = {}) {
  return getDateTimeValue([
    row?.bgo?.usedAt,
    row?.bgo?.updatedAt,
    row?.raw?.bgo?.usedAt,
    row?.raw?.bgo?.updatedAt,
    bgoRow?.metadata?.createdAt,
    bgoRow?.raw?.metadata?.createdAt,
    bgoRow?.raw?.createdAt,
  ]);
}

function getTrnIssuedTime(trn = {}, bgoRow = {}) {
  return getDateTimeValue([
    trn?.workflow?.issuedAt,
    trn?.raw?.workflow?.issuedAt,
    trn?.metadata?.createdAt,
    trn?.raw?.metadata?.createdAt,
    trn?.raw?.createdAt,
    bgoRow?.workflow?.issuedAt,
    bgoRow?.raw?.workflow?.issuedAt,
    bgoRow?.metadata?.createdAt,
    bgoRow?.raw?.metadata?.createdAt,
  ]);
}

function getTrnAcceptedTime(trn = {}, bgoRow = {}) {
  return getDateTimeValue([
    trn?.workflow?.acceptedAt,
    trn?.raw?.workflow?.acceptedAt,
    trn?.assignment?.acceptedRejectedAt,
    trn?.raw?.assignment?.acceptedRejectedAt,
    trn?.bgo?.acceptedAt,
    trn?.raw?.bgo?.acceptedAt,
    bgoRow?.workflow?.acceptedAt,
    bgoRow?.raw?.workflow?.acceptedAt,
    bgoRow?.assignment?.acceptedRejectedAt,
    bgoRow?.raw?.assignment?.acceptedRejectedAt,
    bgoRow?.bgo?.acceptedAt,
    bgoRow?.raw?.bgo?.acceptedAt,
  ]);
}

function getTrnCompletedTime(trn = {}, bgoRow = {}) {
  return getDateTimeValue([
    trn?.workflow?.completedAt,
    trn?.raw?.workflow?.completedAt,
    trn?.completedAt,
    trn?.raw?.completedAt,
    trn?.metadata?.updatedAt,
    trn?.raw?.metadata?.updatedAt,
    bgoRow?.workflow?.completedAt,
    bgoRow?.raw?.workflow?.completedAt,
    bgoRow?.completedAt,
    bgoRow?.raw?.completedAt,
  ]);
}

function getTcRowTrackingStatus(row = {}) {
  if (isNotFound(row)) return "NOT FOUND";
  if (isBlocked(row)) return "BLOCKED";
  if (needsGeofence(row)) return "NO GEOFENCE";
  if (isNotEligible(row)) return "NOT READY";
  if (isFound(row)) return "FOUND";
  return "NOT READY";
}

function buildMeterTrackingRows({ upload = {}, tcRows = [], bgoRowsByTcRowId = new Map(), trnsById = new Map() } = {}) {
  return asArray(tcRows).map((row) => {
    const bgoRow = getRowBgoRow(row, bgoRowsByTcRowId);
    const trn = getTrnForRow({ row, bgoRow, trnsById });
    const executionSource = trn || bgoRow || row;
    const workflowState = getWorkflowState(executionSource);
    const outcome = getExecutionOutcome(executionSource);
    const childTrnId = valueOrNav(
      getTrnIdFromSource(trn || {}) ||
        getChildTrnIdFromBgoRow(bgoRow || {}) ||
        getChildTrnIdFromTcRow(row),
    );

    const hasChildTrn = hasMeaningfulValue(childTrnId);
    const uploadVerifyTime = getRowUploadVerifyTime(row, upload);
    const tcRowTime = getRowTcTime(row);
    const bgoCreatedTime = getRowBgoCreatedTime(row, bgoRow || {});
    const issuedTime = getTrnIssuedTime(trn || {}, bgoRow || {});
    const acceptedTime = getTrnAcceptedTime(trn || {}, bgoRow || {});
    const completedTime = isCompletedState(workflowState)
      ? getTrnCompletedTime(trn || {}, bgoRow || {})
      : null;

    let completedStatus = "—";

    if (isCancelledState(workflowState)) {
      completedStatus = "CANCELLED";
    } else if (isCompletedState(workflowState)) {
      if (isSuccessOutcome(outcome)) {
        completedStatus = "SUCCESS";
      } else if (hasMeaningfulValue(outcome)) {
        completedStatus = outcome;
      } else {
        completedStatus = "DONE";
      }
    } else if (hasChildTrn || isBgoUsed(row) || bgoRow) {
      completedStatus = "NOT DONE";
    }

    const acceptedStatus = acceptedTime ? "ACCEPTED" : hasChildTrn ? "NOT DONE" : "—";
    const issuedStatus = hasChildTrn ? "ISSUED" : isBgoReadyCurrent(row) ? "NOT ISSUED" : "—";
    const bgoStatus = isBgoUsed(row) || bgoRow ? "DONE" : isBgoReadyCurrent(row) ? "NOT DONE" : "—";

    return {
      id: row?.id || row?.raw?.id || `${row?.rowNo || row?.input?.rowNo}-${getMeterNo(row)}`,
      meter: getMeterNo(row),
      uploadVerify: { status: "DONE", time: uploadVerifyTime },
      tcRow: { status: getTcRowTrackingStatus(row), time: tcRowTime },
      bgoCreated: { status: bgoStatus, time: bgoCreatedTime },
      issued: { status: issuedStatus, time: issuedTime },
      accepted: { status: acceptedStatus, time: acceptedTime },
      completed: { status: completedStatus, time: completedTime },
    };
  });
}

function MeterTrackingStageCell({ stage }) {
  const status = normalizeTrackingStatus(stage?.status);
  const time = formatTrackingTime(stage?.time);

  return (
    <td style={styles.meterTrackingCell}>
      <span style={{ ...styles.trackingStatusPill, ...getTrackingStageStyle(status) }}>
        {status}
      </span>
      {time ? <small style={styles.trackingTime}>{time}</small> : null}
    </td>
  );
}

function getTrackingStageFilterOptions(rows = [], stageKey) {
  return Array.from(
    new Set(
      asArray(rows)
        .map((row) => normalizeTrackingStatus(row?.[stageKey]?.status))
        .filter((value) => value && value !== "—"),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function matchesTrackingStageFilter(stage = {}, selectedValue) {
  if (selectedValue === FILTER_ALL) return true;
  return normalizeTrackingStatus(stage?.status) === selectedValue;
}

function MeterTrackingFilterSelect({ value, onChange, options = [] }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={styles.tableFilterSelect}
    >
      <option value={FILTER_ALL}>All</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function MeterTrackingPanel({ rows = [] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [meterSearchText, setMeterSearchText] = useState("");
  const [selectedUploadVerify, setSelectedUploadVerify] = useState(FILTER_ALL);
  const [selectedTcRow, setSelectedTcRow] = useState(FILTER_ALL);
  const [selectedBgoCreated, setSelectedBgoCreated] = useState(FILTER_ALL);
  const [selectedIssued, setSelectedIssued] = useState(FILTER_ALL);
  const [selectedAccepted, setSelectedAccepted] = useState(FILTER_ALL);
  const [selectedCompleted, setSelectedCompleted] = useState(FILTER_ALL);

  const uploadVerifyOptions = useMemo(
    () => getTrackingStageFilterOptions(rows, "uploadVerify"),
    [rows],
  );
  const tcRowOptions = useMemo(
    () => getTrackingStageFilterOptions(rows, "tcRow"),
    [rows],
  );
  const bgoCreatedOptions = useMemo(
    () => getTrackingStageFilterOptions(rows, "bgoCreated"),
    [rows],
  );
  const issuedOptions = useMemo(
    () => getTrackingStageFilterOptions(rows, "issued"),
    [rows],
  );
  const acceptedOptions = useMemo(
    () => getTrackingStageFilterOptions(rows, "accepted"),
    [rows],
  );
  const completedOptions = useMemo(
    () => getTrackingStageFilterOptions(rows, "completed"),
    [rows],
  );

  const filteredRows = useMemo(() => {
    return asArray(rows).filter((row) => {
      return (
        matchesTextFilter(row.meter, meterSearchText) &&
        matchesTrackingStageFilter(row.uploadVerify, selectedUploadVerify) &&
        matchesTrackingStageFilter(row.tcRow, selectedTcRow) &&
        matchesTrackingStageFilter(row.bgoCreated, selectedBgoCreated) &&
        matchesTrackingStageFilter(row.issued, selectedIssued) &&
        matchesTrackingStageFilter(row.accepted, selectedAccepted) &&
        matchesTrackingStageFilter(row.completed, selectedCompleted)
      );
    });
  }, [
    rows,
    meterSearchText,
    selectedUploadVerify,
    selectedTcRow,
    selectedBgoCreated,
    selectedIssued,
    selectedAccepted,
    selectedCompleted,
  ]);

  const visibleRows = filteredRows.slice(0, DETAIL_ROW_DISPLAY_LIMIT);

  return (
    <section style={styles.meterTrackingPanel}>
      <div style={styles.meterTrackingHeader}>
        <div>
          <p style={styles.sectionMiniTitle}>Individual Meter Tracking</p>
          <p style={styles.mutedText}>
            Tracks each meter from upload/verify through TC row, BGO creation, issue, acceptance and completion.
          </p>
        </div>

        <div style={styles.meterTrackingHeaderActions}>
          {isOpen ? (
            <span style={styles.tableCountPill}>
              {formatNumber(filteredRows.length)} / {formatNumber(rows.length)} meters
            </span>
          ) : null}

          <button
            type="button"
            onClick={() => setIsOpen((currentValue) => !currentValue)}
            style={styles.meterTrackingToggle}
          >
            {isOpen ? "Hide Meter Tracking ▲" : "Show Meter Tracking ▼"}
          </button>
        </div>
      </div>

      {isOpen ? (
        <>
          <div style={styles.meterTrackingTableWrap}>
            <table style={styles.meterTrackingTable}>
              <thead>
                <tr>
                  <th style={styles.meterTrackingMeterHeader}>Meter</th>
                  <th>Upload / Verify</th>
                  <th>TC Row</th>
                  <th>BGO Created</th>
                  <th>Issued</th>
                  <th>Accepted</th>
                  <th>Completed</th>
                </tr>
                <tr>
                  <th style={styles.tableFilterCell}>
                    <input
                      value={meterSearchText}
                      onChange={(event) => setMeterSearchText(event.target.value)}
                      placeholder="Search meter"
                      style={styles.tableFilterInput}
                    />
                  </th>
                  <th style={styles.tableFilterCell}>
                    <MeterTrackingFilterSelect
                      value={selectedUploadVerify}
                      onChange={setSelectedUploadVerify}
                      options={uploadVerifyOptions}
                    />
                  </th>
                  <th style={styles.tableFilterCell}>
                    <MeterTrackingFilterSelect
                      value={selectedTcRow}
                      onChange={setSelectedTcRow}
                      options={tcRowOptions}
                    />
                  </th>
                  <th style={styles.tableFilterCell}>
                    <MeterTrackingFilterSelect
                      value={selectedBgoCreated}
                      onChange={setSelectedBgoCreated}
                      options={bgoCreatedOptions}
                    />
                  </th>
                  <th style={styles.tableFilterCell}>
                    <MeterTrackingFilterSelect
                      value={selectedIssued}
                      onChange={setSelectedIssued}
                      options={issuedOptions}
                    />
                  </th>
                  <th style={styles.tableFilterCell}>
                    <MeterTrackingFilterSelect
                      value={selectedAccepted}
                      onChange={setSelectedAccepted}
                      options={acceptedOptions}
                    />
                  </th>
                  <th style={styles.tableFilterCell}>
                    <MeterTrackingFilterSelect
                      value={selectedCompleted}
                      onChange={setSelectedCompleted}
                      options={completedOptions}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={styles.emptyTableCell}>
                      No meter rows available for tracking yet.
                    </td>
                  </tr>
                ) : null}

                {rows.length > 0 && filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={styles.emptyTableCell}>
                      No meters match the current tracking filter selection.
                    </td>
                  </tr>
                ) : null}

                {visibleRows.map((row) => (
                  <tr key={row.id}>
                    <td style={styles.meterTrackingMeterCell}>{row.meter}</td>
                    <MeterTrackingStageCell stage={row.uploadVerify} />
                    <MeterTrackingStageCell stage={row.tcRow} />
                    <MeterTrackingStageCell stage={row.bgoCreated} />
                    <MeterTrackingStageCell stage={row.issued} />
                    <MeterTrackingStageCell stage={row.accepted} />
                    <MeterTrackingStageCell stage={row.completed} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredRows.length > DETAIL_ROW_DISPLAY_LIMIT ? (
            <p style={styles.tableFootnote}>
              Showing first {formatNumber(DETAIL_ROW_DISPLAY_LIMIT)} filtered meters. Narrow the column filters to reduce the list.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function AttentionFlags({ upload, metrics }) {
  const flags = getAttentionFlags(upload, metrics);
  const primaryStatus = getPrimaryStatus(metrics);

  return (
    <div style={styles.attentionPanel}>
      <div>
        <p style={styles.sectionMiniTitle}>Management attention</p>
        <p style={styles.mutedText}>
          Primary status: <strong>{primaryStatus}</strong>. Time threshold flags come next.
        </p>
      </div>

      <div style={styles.flagWrap}>
        {flags.length ? (
          flags.map((flag) => (
            <span key={flag} style={styles.warningPill}>
              {flag}
            </span>
          ))
        ) : (
          <span style={styles.goodPill}>NO ATTENTION FLAGS</span>
        )}
      </div>
    </div>
  );
}

function SummaryCards({ metrics }) {
  const groups = [
    {
      title: "Upload Validation",
      cards: [
        { label: "Total Rows", value: metrics.totalRows, hint: "All rows in uploaded file" },
        { label: "Found", value: metrics.foundRows, hint: "Matched to iREPS ASTs" },
        { label: "Not Found", value: metrics.notFoundRows, hint: "Outside BGO until reviewed" },
      ],
    },
    {
      title: "BGO Readiness / Issue",
      cards: [
        { label: "BGO Eligible", value: metrics.bgoReadyRows, hint: "Found rows that qualified for BGO" },
        { label: "BGO Not Ready", value: metrics.bgoNotReadyRows, hint: "Found rows blocked before BGO" },
        { label: "Issued to BGO", value: metrics.issuedToBgoRows, hint: "Rows already consumed by BGO" },
        { label: "Not Yet Issued", value: metrics.notYetIssuedRows, hint: "Eligible rows not yet allocated" },
      ],
    },
    {
      title: "Field Execution",
      cards: [
        { label: "Executed", value: metrics.executedRows, hint: "Completed child TRNs" },
        { label: "Not Executed", value: metrics.notExecutedRows, hint: "Issued but not complete" },
        { label: "Successful", value: metrics.successfulRows, hint: "Successful field outcome" },
        { label: "Unsuccessful", value: metrics.unsuccessfulRows, hint: "NO_ACCESS or failed outcome" },
      ],
    },
  ];

  return (
    <div style={styles.summaryGroups}>
      {groups.map((group) => (
        <section key={group.title} style={styles.summaryGroup}>
          <div style={styles.summaryGroupHeader}>
            <p style={styles.summaryGroupTitle}>{group.title}</p>
          </div>

          <div style={styles.summaryCompactGrid}>
            {group.cards.map((card) => (
              <article key={card.label} style={styles.summaryCard}>
                <div style={styles.summaryCardHeader}>
                  <span style={styles.summaryCardLabel}>{card.label}</span>
                  <span
                    aria-label={`${card.label} help`}
                    title={card.hint}
                    style={styles.summaryHelpIcon}
                  >
                    ?
                  </span>
                </div>

                <strong style={styles.summaryCardValue}>
                  {formatNumber(card.value)}
                </strong>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function MiniBar({ label, value, total }) {
  const percent = total > 0 ? Math.round((asNumber(value) / total) * 100) : 0;

  return (
    <div style={styles.chartItem}>
      <div style={styles.chartItemHeader}>
        <span>{label}</span>
        <strong>
          {formatNumber(value)} / {formatNumber(total)}
        </strong>
      </div>
      <div style={styles.chartTrack}>
        <div style={{ ...styles.chartFill, width: `${Math.min(100, percent)}%` }} />
      </div>
      <small>{percent}%</small>
    </div>
  );
}

function ChartPanel({ title, rows = [] }) {
  const total = rows.reduce((sum, row) => sum + asNumber(row.value), 0);

  return (
    <article style={styles.chartCard}>
      <p style={styles.sectionMiniTitle}>{title}</p>
      <div style={styles.chartBars}>
        {rows.map((row) => (
          <MiniBar key={row.label} label={row.label} value={row.value} total={total} />
        ))}
      </div>
    </article>
  );
}

function ChartsSection({ metrics }) {
  return (
    <div style={styles.chartGrid}>
      <ChartPanel
        title="Found vs Not Found"
        rows={[
          { label: "Found", value: metrics.foundRows },
          { label: "Not Found", value: metrics.notFoundRows },
        ]}
      />
      <ChartPanel
        title="BGO Ready vs Not Ready"
        rows={[
          { label: "Ready", value: metrics.bgoReadyRows },
          { label: "Not Ready", value: metrics.bgoNotReadyRows },
        ]}
      />
      <ChartPanel
        title="BGO Not Ready Breakdown"
        rows={[
          { label: "No Geofence", value: metrics.needsGeofenceRows },
          { label: "Blocked", value: metrics.blockedActiveSameOperationRows },
          { label: "Duplicate", value: metrics.duplicateMeterRows },
          { label: "Not Eligible", value: metrics.notEligibleRows },
          ...(metrics.otherNotReadyRows > 0
            ? [{ label: "Other", value: metrics.otherNotReadyRows }]
            : []),
        ]}
      />
      <ChartPanel
        title="Execution Progress"
        rows={[
          { label: "Executed", value: metrics.executedRows },
          { label: "Not Executed", value: metrics.notExecutedRows },
          { label: "Cancelled", value: metrics.cancelledRows },
        ]}
      />
    </div>
  );
}

function getTargetText(source = {}) {
  const targetType = valueOrNav(source.targetType || source.target?.type);
  const targetName = valueOrNav(source.targetName || source.target?.name);

  if (targetType !== "NAv" || targetName !== "NAv") {
    return `${targetType} • ${targetName}`;
  }

  return valueOrNav(source.targetText);
}

function getGeofenceText(source = {}) {
  return valueOrNav(source.geofenceName || source.geofenceRef?.name || source.geofence?.name);
}

function buildDisplayBgoBatchId({ tcId, batchId, index }) {
  const cleanBatchId = String(batchId || "").trim();

  if (cleanBatchId.startsWith(`${tcId}_BGO_GF`)) return cleanBatchId;

  return `${tcId}_BGO_GF${String(index + 1).padStart(3, "0")}`;
}

function buildBatchRows({ tcId, bgoBatches = [], bgoRows = [], tcRows = [], trnsByBatchId = new Map() }) {
  const grouped = new Map();
  const bgoRowsByBatchId = buildBgoRowsByBatchId(bgoRows);

  bgoBatches.forEach((batch, index) => {
    const actualBatchId = valueOrNav(batch.bgoBatchId || batch.batchId || batch.id);
    if (!hasMeaningfulValue(actualBatchId)) return;

    const rows = bgoRowsByBatchId.get(actualBatchId) || [];
    const trns = trnsByBatchId.get(actualBatchId) || [];

    grouped.set(actualBatchId, {
      actualBatchId,
      displayBatchId: buildDisplayBgoBatchId({ tcId, batchId: actualBatchId, index }),
      geofence: getGeofenceText(batch),
      target: getTargetText(batch),
      rows,
      trns,
      rowCount: asNumber(batch.summary?.totalRows ?? batch.rowCount ?? rows.length),
      childTrns: asNumber(
        batch.summary?.totalTrnsCreated ??
          batch.trnCount ??
          Math.max(
            rows.filter((row) => hasMeaningfulValue(getChildTrnIdFromBgoRow(row))).length,
            trns.length,
          ),
      ),
      state: valueOrNav(getWorkflowState(batch)),
    });
  });

  bgoRows.forEach((row, index) => {
    const actualBatchId = getBatchIdFromBgoRow(row);
    if (!hasMeaningfulValue(actualBatchId)) return;

    if (!grouped.has(actualBatchId)) {
      grouped.set(actualBatchId, {
        actualBatchId,
        displayBatchId: buildDisplayBgoBatchId({ tcId, batchId: actualBatchId, index }),
        geofence: getGeofenceText(row),
        target: getTargetText(row),
        rows: [],
        trns: trnsByBatchId.get(actualBatchId) || [],
        rowCount: 0,
        childTrns: 0,
        state: valueOrNav(getWorkflowState(row)),
      });
    }

    grouped.get(actualBatchId).rows.push(row);
  });

  trnsByBatchId.forEach((trns, actualBatchId) => {
    if (!hasMeaningfulValue(actualBatchId)) return;

    if (!grouped.has(actualBatchId)) {
      grouped.set(actualBatchId, {
        actualBatchId,
        displayBatchId: buildDisplayBgoBatchId({
          tcId,
          batchId: actualBatchId,
          index: grouped.size,
        }),
        geofence: "NAv",
        target: "NAv",
        rows: [],
        trns,
        rowCount: 0,
        childTrns: trns.length,
        state: "TRN_STREAM",
      });
    } else {
      grouped.get(actualBatchId).trns = trns;
    }
  });

  if (grouped.size === 0) {
    const fallback = new Map();

    tcRows.filter(isBgoUsed).forEach((row) => {
      const actualBatchId = getBatchIdFromTcRow(row);
      if (!hasMeaningfulValue(actualBatchId)) return;

      if (!fallback.has(actualBatchId)) {
        fallback.set(actualBatchId, {
          actualBatchId,
          displayBatchId: buildDisplayBgoBatchId({
            tcId,
            batchId: actualBatchId,
            index: fallback.size,
          }),
          geofence: getFirstGeofenceName(row),
          target: "NAv",
          rows: [],
          trns: trnsByBatchId.get(actualBatchId) || [],
          rowCount: 0,
          childTrns: 0,
          state: "TC_ROW_USED",
        });
      }

      fallback.get(actualBatchId).rows.push(row);
    });

    fallback.forEach((value, key) => grouped.set(key, value));
  }

  return Array.from(grouped.values())
    .map((item) => {
      const rows = asArray(item.rows);
      const trns = asArray(item.trns);
      const executionSources = trns.length ? trns : rows;
      const completedRows = executionSources.filter((row) =>
        isCompletedState(getWorkflowState(row)),
      );
      const cancelledRows = executionSources.filter((row) =>
        isCancelledState(getWorkflowState(row)),
      );
      const successfulRows = completedRows.filter((row) =>
        isSuccessOutcome(getExecutionOutcome(row)),
      );
      const unsuccessfulRows = completedRows.filter(
        (row) =>
          hasMeaningfulValue(getExecutionOutcome(row)) &&
          !isSuccessOutcome(getExecutionOutcome(row)),
      );
      const rowCount = item.rowCount || Math.max(rows.length, trns.length);
      const executed = completedRows.length;
      const cancelled = cancelledRows.length;

      return {
        ...item,
        rowCount,
        childTrns:
          item.childTrns ||
          Math.max(
            rows.filter((row) => hasMeaningfulValue(getChildTrnIdFromBgoRow(row))).length,
            trns.length,
          ),
        executed,
        notExecuted: Math.max(rowCount - executed - cancelled, 0),
        successful: successfulRows.length,
        unsuccessful: unsuccessfulRows.length,
        state: valueOrNav(item.state),
      };
    })
    .sort((left, right) => left.displayBatchId.localeCompare(right.displayBatchId));
}


function compactBgoBatchId(value = "") {
  const cleanValue = String(value || "").trim();

  if (!cleanValue) return "NAv";

  const gfMatch = cleanValue.match(/(GF\d+)$/i);
  if (gfMatch?.[1]) return `...${gfMatch[1].toUpperCase()}`;

  if (cleanValue.length <= 16) return cleanValue;

  return `...${cleanValue.slice(-12)}`;
}

function getFlagPillStyle(flag = "") {
  const cleanFlag = String(flag || "").trim().toUpperCase();

  if (cleanFlag === "DONE") return styles.doneFlagPill;
  if (cleanFlag === "NOT DONE") return styles.notDoneFlagPill;
  if (cleanFlag === "NOT FOUND") return styles.notFoundFlagPill;
  if (cleanFlag === "NOT READY") return styles.notReadyFlagPill;
  if (cleanFlag === "NOT READY / NO GEOFENCE") return styles.noGeofenceFlagPill;
  if (cleanFlag === "BLOCKED") return styles.blockedFlagPill;
  if (cleanFlag === "CANCELLED") return styles.cancelledFlagPill;
  if (cleanFlag.includes("NO_ACCESS") || cleanFlag.includes("NO ACCESS")) {
    return styles.noAccessFlagPill;
  }
  if (cleanFlag.includes("NO_READING") || cleanFlag.includes("NO READING")) {
    return styles.noReadingFlagPill;
  }

  return styles.defaultFlagPill;
}

function getBatchStatePillStyle(state = "") {
  const cleanState = String(state || "").trim().toUpperCase();

  if (cleanState === "ACCEPTED") return styles.acceptedStatePill;
  if (cleanState === "ISSUED") return styles.issuedStatePill;
  if (cleanState === "COMPLETED") return styles.completedStatePill;
  if (cleanState === "REJECTED") return styles.rejectedStatePill;
  if (cleanState === "CANCELLED") return styles.cancelledStatePill;

  return styles.neutralStatePill;
}

function BatchBreakdownTable({ rows = [], focusBatchId }) {
  return (
    <section style={styles.panel}>
      <div style={styles.panelHeader}>
        <div>
          <p style={styles.sectionMiniTitle}>BGO batch / geofence breakdown</p>
          <p style={styles.mutedText}>
            Live from BGO batches/rows where available, with tc_rows fallback.
          </p>
        </div>
      </div>

      <div style={styles.batchTableWrap}>
        <table style={styles.batchTable}>
          <thead>
            <tr>
              <th style={{ ...styles.batchHeaderCell, ...styles.batchBatchHeaderCell }}>BGO Batch</th>
              <th style={{ ...styles.batchHeaderCell, ...styles.batchTextHeaderCell }}>Geofence</th>
              <th style={{ ...styles.batchHeaderCell, ...styles.batchTextHeaderCell }}>Target</th>
              <th style={{ ...styles.batchHeaderCell, ...styles.batchNumberHeaderCell }}>Rows</th>
              <th style={{ ...styles.batchHeaderCell, ...styles.batchNumberHeaderCell }}>Child TRNs</th>
              <th style={{ ...styles.batchHeaderCell, ...styles.batchStateHeaderCell }}>State</th>
              <th style={{ ...styles.batchHeaderCell, ...styles.batchNumberHeaderCell }}>Executed</th>
              <th style={{ ...styles.batchHeaderCell, ...styles.batchNumberHeaderCell }}>Not Executed</th>
              <th style={{ ...styles.batchHeaderCell, ...styles.batchNumberHeaderCell }}>Successful</th>
              <th style={{ ...styles.batchHeaderCell, ...styles.batchNumberHeaderCell }}>Unsuccessful</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} style={styles.emptyTableCell}>
                  No BGO batches have been created for this upload yet.
                </td>
              </tr>
            ) : null}

            {rows.map((row) => {
              const isFocused =
                hasMeaningfulValue(focusBatchId) &&
                (focusBatchId === row.actualBatchId || focusBatchId === row.displayBatchId);

              return (
                <tr
                  key={row.actualBatchId || row.displayBatchId}
                  style={isFocused ? { ...styles.batchRow, ...styles.focusedTableRow } : styles.batchRow}
                >
                  <td
                    title={row.actualBatchId || row.displayBatchId}
                    style={{ ...styles.batchCell, ...styles.compactBatchIdCell }}
                  >
                    {compactBgoBatchId(row.displayBatchId || row.actualBatchId)}
                  </td>
                  <td style={{ ...styles.batchCell, ...styles.batchTextCell }} title={row.geofence}>
                    {row.geofence}
                  </td>
                  <td style={{ ...styles.batchCell, ...styles.batchTextCell }} title={row.target}>
                    {row.target}
                  </td>
                  <td style={{ ...styles.batchCell, ...styles.batchNumberCell }}>{formatNumber(row.rowCount)}</td>
                  <td style={{ ...styles.batchCell, ...styles.batchNumberCell }}>{formatNumber(row.childTrns)}</td>
                  <td style={{ ...styles.batchCell, ...styles.batchStateCell }}>
                    <span style={getBatchStatePillStyle(row.state)}>{row.state}</span>
                  </td>
                  <td style={{ ...styles.batchCell, ...styles.batchNumberCell }}>{formatNumber(row.executed)}</td>
                  <td style={{ ...styles.batchCell, ...styles.batchNumberCell }}>{formatNumber(row.notExecuted)}</td>
                  <td style={{ ...styles.batchCell, ...styles.batchNumberCell }}>{formatNumber(row.successful)}</td>
                  <td style={{ ...styles.batchCell, ...styles.batchNumberCell }}>{formatNumber(row.unsuccessful)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function getRowFlag({ row, bgoRow }) {
  if (isNotFound(row)) return "NOT FOUND";
  if (isNotEligible(row)) return "NOT READY";
  if (needsGeofence(row)) return "NOT READY / NO GEOFENCE";
  if (isBlocked(row)) return "BLOCKED";

  const workflowState = getWorkflowState(bgoRow || row);
  const outcome = getExecutionOutcome(bgoRow || row);

  if (isBgoUsed(row) || bgoRow) {
    if (isCancelledState(workflowState)) return "CANCELLED";
    if (isCompletedState(workflowState)) {
      if (isSuccessOutcome(outcome)) return "DONE";
      if (hasMeaningfulValue(outcome)) return outcome;
      return "DONE / OUTCOME NAv";
    }

    return "NOT DONE";
  }

  if (isBgoReadyCurrent(row)) return "NOT ISSUED";

  return "NOT READY";
}

function buildDetailRows({ tcRows = [], bgoRowsByTcRowId = new Map(), trnsById = new Map() }) {
  return tcRows.map((row) => {
    const bgoRow = getRowBgoRow(row, bgoRowsByTcRowId);
    const trn = getTrnForRow({ row, bgoRow, trnsById });
    const executionSource = trn || bgoRow || row;
    const workflowState = valueOrNav(getWorkflowState(executionSource));
    const outcome = valueOrNav(getExecutionOutcome(executionSource));
    const batchId = valueOrNav(getBatchIdFromBgoRow(bgoRow || trn || {}) || getBatchIdFromTcRow(row));
    const childTrn = valueOrNav(
      getTrnIdFromSource(trn || {}) ||
        getChildTrnIdFromBgoRow(bgoRow || {}) ||
        getChildTrnIdFromTcRow(row),
    );

    return {
      id: row.id,
      rowNo: valueOrNav(row.rowNo || row.input?.rowNo),
      meter: getMeterNo(row),
      erf: getErfNo(row),
      address: getAddress(row),
      geofence: getFirstGeofenceName(row),
      batchId,
      childTrn,
      workflowState,
      outcome,
      flag: getRowFlag({ row, bgoRow: executionSource }),
    };
  });
}

function TrnDetailTable({ rows = [] }) {
  const [meterSearchText, setMeterSearchText] = useState("");
  const [erfSearchText, setErfSearchText] = useState("");
  const [addressSearchText, setAddressSearchText] = useState("");
  const [selectedGeofence, setSelectedGeofence] = useState(FILTER_ALL);
  const [selectedState, setSelectedState] = useState(FILTER_ALL);
  const [selectedOutcome, setSelectedOutcome] = useState(FILTER_ALL);
  const [selectedFlag, setSelectedFlag] = useState(FILTER_ALL);

  const geofenceOptions = useMemo(
    () => getUniqueFilterOptions(rows, "geofence"),
    [rows],
  );
  const stateOptions = useMemo(
    () => getUniqueFilterOptions(rows, "workflowState"),
    [rows],
  );
  const outcomeOptions = useMemo(
    () => getUniqueFilterOptions(rows, "outcome"),
    [rows],
  );
  const flagOptions = useMemo(
    () => getUniqueFilterOptions(rows, "flag"),
    [rows],
  );

  const filteredRows = useMemo(() => {
    return asArray(rows).filter((row) => {
      return (
        matchesTextFilter(row.meter, meterSearchText) &&
        matchesTextFilter(row.erf, erfSearchText) &&
        matchesTextFilter(row.address, addressSearchText) &&
        matchesSelectFilter(row.geofence, selectedGeofence) &&
        matchesSelectFilter(row.workflowState, selectedState) &&
        matchesSelectFilter(row.outcome, selectedOutcome) &&
        matchesSelectFilter(row.flag, selectedFlag)
      );
    });
  }, [
    rows,
    meterSearchText,
    erfSearchText,
    addressSearchText,
    selectedGeofence,
    selectedState,
    selectedOutcome,
    selectedFlag,
  ]);

  const visibleRows = filteredRows.slice(0, DETAIL_ROW_DISPLAY_LIMIT);

  return (
    <section style={styles.panel}>
      <div style={styles.panelHeader}>
        <div>
          <p style={styles.sectionMiniTitle}>Row / TRN detail flags</p>
          <p style={styles.mutedText}>
            User-facing row status. Use the filter row directly below the table headings.
          </p>
        </div>

        <span style={styles.tableCountPill}>
          {formatNumber(filteredRows.length)} / {formatNumber(rows.length)} rows
        </span>
      </div>

      <div style={styles.tableWrap}>
        <table style={styles.detailTable}>
          <thead>
            <tr>
              <th>Row</th>
              <th>Meter</th>
              <th>ERF</th>
              <th>Address</th>
              <th>Geofence</th>
              <th>State</th>
              <th>Outcome</th>
              <th>Flag</th>
            </tr>
            <tr>
              <th style={styles.tableFilterCell}></th>
              <th style={styles.tableFilterCell}>
                <input
                  value={meterSearchText}
                  onChange={(event) => setMeterSearchText(event.target.value)}
                  placeholder="Search meter"
                  style={styles.tableFilterInput}
                />
              </th>
              <th style={styles.tableFilterCell}>
                <input
                  value={erfSearchText}
                  onChange={(event) => setErfSearchText(event.target.value)}
                  placeholder="Search ERF"
                  style={styles.tableFilterInput}
                />
              </th>
              <th style={styles.tableFilterCell}>
                <input
                  value={addressSearchText}
                  onChange={(event) => setAddressSearchText(event.target.value)}
                  placeholder="Search address"
                  style={styles.tableFilterInput}
                />
              </th>
              <th style={styles.tableFilterCell}>
                <select
                  value={selectedGeofence}
                  onChange={(event) => setSelectedGeofence(event.target.value)}
                  style={styles.tableFilterSelect}
                >
                  <option value={FILTER_ALL}>All</option>
                  {geofenceOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </th>
              <th style={styles.tableFilterCell}>
                <select
                  value={selectedState}
                  onChange={(event) => setSelectedState(event.target.value)}
                  style={styles.tableFilterSelect}
                >
                  <option value={FILTER_ALL}>All</option>
                  {stateOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </th>
              <th style={styles.tableFilterCell}>
                <select
                  value={selectedOutcome}
                  onChange={(event) => setSelectedOutcome(event.target.value)}
                  style={styles.tableFilterSelect}
                >
                  <option value={FILTER_ALL}>All</option>
                  {outcomeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </th>
              <th style={styles.tableFilterCell}>
                <select
                  value={selectedFlag}
                  onChange={(event) => setSelectedFlag(event.target.value)}
                  style={styles.tableFilterSelect}
                >
                  <option value={FILTER_ALL}>All</option>
                  {flagOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} style={styles.emptyTableCell}>
                  No TC rows streamed yet for this upload.
                </td>
              </tr>
            ) : null}

            {rows.length > 0 && filteredRows.length === 0 ? (
              <tr>
                <td colSpan={8} style={styles.emptyTableCell}>
                  No rows match the current search/filter selection.
                </td>
              </tr>
            ) : null}

            {visibleRows.map((row) => (
              <tr key={row.id || `${row.rowNo}-${row.meter}`}>
                <td>{row.rowNo}</td>
                <td>{row.meter}</td>
                <td>{row.erf}</td>
                <td>{row.address}</td>
                <td>{row.geofence}</td>
                <td>{row.workflowState}</td>
                <td>{row.outcome}</td>
                <td>
                  <span style={getFlagPillStyle(row.flag)}>
                    {row.flag}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredRows.length > DETAIL_ROW_DISPLAY_LIMIT ? (
        <p style={styles.tableFootnote}>
          Showing first {formatNumber(DETAIL_ROW_DISPLAY_LIMIT)} filtered rows. Narrow the search or filters to reduce the list.
        </p>
      ) : null}
    </section>
  );
}

export default function TcBgoDashboardPage() {
  const { tcId } = useParams();
  const [searchParams] = useSearchParams();
  const focusBatchId = searchParams.get("focusBatchId") || "";

  const {
    data: upload,
    isLoading: isUploadLoading,
    isError: isUploadError,
    error: uploadError,
  } = useGetTcUploadByIdQuery(tcId);

  const {
    data: tcRows = [],
    isLoading: areRowsLoading,
    isError: areRowsError,
    error: rowsError,
  } = useGetTcRowsByTcIdQuery(tcId);

  const {
    data: bgoBatches = [],
    isLoading: areBgoBatchesLoading,
    isError: areBgoBatchesError,
    error: bgoBatchesError,
  } = useGetBgoBatchesByTcIdQuery({ tcId, limit: 300 }, { skip: !tcId });

  const {
    data: bgoRows = [],
    isLoading: areBgoRowsLoading,
    isError: areBgoRowsError,
    error: bgoRowsError,
  } = useGetBgoRowsByTcIdQuery({ tcId, limit: 1000 }, { skip: !tcId });

  const {
    data: trns = [],
    isLoading: areTrnsLoading,
    isError: areTrnsError,
    error: trnsError,
  } = useGetTrnsByTcIdQuery({ tcId, limit: 1000 }, { skip: !tcId });

  const metrics = useMemo(
    () => calculateUploadMetrics({ upload, tcRows, bgoRows, trns }),
    [upload, tcRows, bgoRows, trns],
  );

  const bgoRowsByTcRowId = useMemo(() => buildBgoRowsByTcRowId(bgoRows), [bgoRows]);
  const trnsById = useMemo(() => buildTrnsById(trns), [trns]);
  const trnsByBatchId = useMemo(() => buildTrnsByBatchId(trns), [trns]);

  const batchRows = useMemo(
    () => buildBatchRows({ tcId, bgoBatches, bgoRows, tcRows, trnsByBatchId }),
    [tcId, bgoBatches, bgoRows, tcRows, trnsByBatchId],
  );

  const detailRows = useMemo(
    () => buildDetailRows({ tcRows, bgoRowsByTcRowId, trnsById }),
    [tcRows, bgoRowsByTcRowId, trnsById],
  );

  const meterTrackingRows = useMemo(
    () => buildMeterTrackingRows({ upload, tcRows, bgoRowsByTcRowId, trnsById }),
    [upload, tcRows, bgoRowsByTcRowId, trnsById],
  );

  const loadingText = [
    isUploadLoading ? "upload" : null,
    areRowsLoading ? "tc rows" : null,
    areBgoBatchesLoading ? "bgo batches" : null,
    areBgoRowsLoading ? "bgo rows" : null,
    areTrnsLoading ? "child trns" : null,
  ]
    .filter(Boolean)
    .join(", ");

  const errorMessage =
    uploadError?.message ||
    rowsError?.message ||
    bgoBatchesError?.message ||
    bgoRowsError?.message ||
    trnsError?.message ||
    "Could not stream one or more dashboard sources.";

  return (
    <section style={styles.page}>
      <div style={styles.backRow}>
        <Link to="/operations/bgo-dashboard" style={styles.backLink}>
          ← Back to BGO Dashboard
        </Link>
        <Link to={`/operations/tc-uploads/${tcId}`} style={styles.backLink}>
          Open TC Rows
        </Link>
        <Link to={`/operations/tc-uploads/${tcId}/bgo`} style={styles.backLink}>
          Open BGO Allocation
        </Link>
        <Link to={`/operations/tc-uploads/${tcId}/final-report`} style={styles.backLink}>
          Final Report ({getReportStatus(upload)})
        </Link>
      </div>

      <div style={styles.hero}>
        <div>
          <p style={styles.eyebrow}>Operations / BGO Dashboard / TC Upload</p>
          <h2 style={styles.title}>{tcId}</h2>
          <p style={styles.description}>
            {valueOrNav(upload?.trnType)} • {valueOrNav(upload?.lmPcode)} • {formatNumber(metrics.totalRows)} rows
          </p>
          <p style={styles.fileName}>{valueOrNav(upload?.fileName)}</p>
          <p style={styles.mutedText}>
            Uploaded: {formatDateTime(upload?.metadata?.createdAt || upload?.raw?.createdAt)}
          </p>
        </div>

        <div style={styles.heroStatusStack}>
          <span style={styles.statusPill}>{getPrimaryStatus(metrics)}</span>
          <span style={styles.streamPill}>
            {loadingText ? `STREAMING ${loadingText}` : "LIVE DETAIL STREAMS"}
          </span>
        </div>
      </div>

      {isUploadError || areRowsError || areBgoBatchesError || areBgoRowsError || areTrnsError ? (
        <div style={styles.errorPanel}>{errorMessage}</div>
      ) : null}

      <UploadLifecycleTracker
        upload={upload || { id: tcId }}
        metrics={metrics}
        bgoBatches={bgoBatches}
        trns={trns}
      />
      <MeterTrackingPanel rows={meterTrackingRows} />
      <AttentionFlags upload={upload || {}} metrics={metrics} />
      <SummaryCards metrics={metrics} />
      <ChartsSection metrics={metrics} />
      <BatchBreakdownTable rows={batchRows} focusBatchId={focusBatchId} />
      <TrnDetailTable rows={detailRows} />
    </section>
  );
}

const styles = {
  page: {
    display: "grid",
    gap: 20,
    width: "100%",
    maxWidth: "100%",
    overflowX: "hidden",
  },
  backRow: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },
  backLink: {
    textDecoration: "none",
    color: "#0F172A",
    background: "#FFFFFF",
    border: "1px solid #E2E8F0",
    borderRadius: 999,
    padding: "8px 12px",
    fontSize: 13,
    fontWeight: 800,
  },
  hero: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "flex-start",
    flexWrap: "wrap",
    padding: 24,
    borderRadius: 24,
    background: "#FFFFFF",
    border: "1px solid #E2E8F0",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
  },
  eyebrow: {
    margin: 0,
    color: "#64748B",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  title: {
    margin: "8px 0 0",
    color: "#0F172A",
    fontSize: 26,
    lineHeight: 1.15,
    wordBreak: "break-word",
  },
  description: {
    margin: "10px 0 0",
    color: "#334155",
    fontWeight: 800,
    lineHeight: 1.55,
  },
  fileName: {
    margin: "6px 0 0",
    color: "#64748B",
    fontSize: 14,
    wordBreak: "break-word",
  },
  mutedText: {
    margin: "6px 0 0",
    color: "#64748B",
    fontSize: 14,
    lineHeight: 1.45,
  },
  heroStatusStack: {
    display: "flex",
    gap: 8,
    alignItems: "flex-end",
    flexDirection: "column",
  },
  statusPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "8px 12px",
    borderRadius: 999,
    background: "#ECFEFF",
    color: "#155E75",
    fontSize: 12,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  streamPill: {
    display: "inline-flex",
    padding: "7px 10px",
    borderRadius: 999,
    background: "#F8FAFC",
    color: "#475569",
    border: "1px solid #E2E8F0",
    fontSize: 12,
    fontWeight: 900,
  },
  errorPanel: {
    padding: 14,
    borderRadius: 16,
    background: "#FEF2F2",
    color: "#991B1B",
    border: "1px solid #FECACA",
    fontWeight: 800,
  },
  sectionMiniTitle: {
    margin: 0,
    color: "#0F172A",
    fontSize: 13,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  trackerShell: {
    display: "grid",
    gap: 16,
    padding: 20,
    borderRadius: 24,
    background: "#FFFFFF",
    border: "1px solid #E2E8F0",
    overflowX: "auto",
  },
  trackerRow: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    minWidth: 940,
  },
  trackerConnectorBlock: {
    minWidth: 64,
    display: "grid",
    gap: 3,
    justifyItems: "center",
    alignItems: "center",
  },
  durationLabel: {
    minHeight: 18,
    color: "#475569",
    fontSize: 12,
    fontWeight: 900,
    textAlign: "center",
    whiteSpace: "nowrap",
  },
  stageCard: {
    position: "relative",
    minWidth: 126,
    minHeight: 82,
    display: "grid",
    gap: 5,
    alignContent: "center",
    padding: "12px 28px 12px 12px",
    borderRadius: 18,
    textAlign: "center",
  },
  stageDone: {
    background: "#DCFCE7",
    border: "1px solid #86EFAC",
    color: "#14532D",
  },
  stagePartial: {
    background: "#FEF3C7",
    border: "1px solid #FCD34D",
    color: "#92400E",
  },
  stageWaiting: {
    background: "#F8FAFC",
    border: "1px solid #CBD5E1",
    color: "#475569",
  },
  stageStatusPill: {
    justifySelf: "center",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "3px 8px",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: "0.04em",
  },
  stageStatusDone: {
    background: "#BBF7D0",
    color: "#166534",
  },
  stageStatusPartial: {
    background: "#FDE68A",
    color: "#92400E",
  },
  stageStatusWaiting: {
    background: "#E2E8F0",
    color: "#475569",
  },
  stageHelpIcon: {
    position: "absolute",
    right: 8,
    bottom: 8,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 18,
    height: 18,
    borderRadius: 999,
    background: "#EFF6FF",
    border: "1px solid #BFDBFE",
    color: "#1D4ED8",
    fontSize: 12,
    fontWeight: 900,
    cursor: "help",
  },
  connector: {
    color: "#94A3B8",
    fontWeight: 900,
    fontSize: 18,
    lineHeight: 1,
  },
  meterTrackingPanel: {
    display: "grid",
    gap: 14,
    padding: 18,
    borderRadius: 22,
    background: "#FFFFFF",
    border: "1px solid #E2E8F0",
  },
  meterTrackingHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
  },
  meterTrackingToggle: {
    border: "1px solid #BFDBFE",
    borderRadius: 999,
    padding: "9px 13px",
    background: "#EFF6FF",
    color: "#1D4ED8",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  meterTrackingTableWrap: {
    overflowX: "auto",
    border: "1px solid #E2E8F0",
    borderRadius: 18,
    background: "#FFFFFF",
  },
  meterTrackingTable: {
    width: "100%",
    minWidth: 940,
    borderCollapse: "separate",
    borderSpacing: 0,
    tableLayout: "fixed",
    fontSize: 13,
  },
  meterTrackingMeterHeader: {
    width: 150,
    textAlign: "left",
  },
  meterTrackingMeterCell: {
    padding: "12px 10px",
    borderBottom: "1px solid #EEF2F7",
    color: "#0F172A",
    fontWeight: 700,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  meterTrackingCell: {
    padding: "10px 8px",
    borderBottom: "1px solid #EEF2F7",
    textAlign: "center",
    verticalAlign: "middle",
  },
  trackingStatusPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 84,
    padding: "5px 8px",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 950,
    textTransform: "uppercase",
    letterSpacing: "0.035em",
    whiteSpace: "nowrap",
  },
  trackingStatusSuccess: {
    background: "#DCFCE7",
    color: "#166534",
    border: "1px solid #BBF7D0",
  },
  trackingStatusWarning: {
    background: "#FEF3C7",
    color: "#92400E",
    border: "1px solid #FDE68A",
  },
  trackingStatusDanger: {
    background: "#FEE2E2",
    color: "#991B1B",
    border: "1px solid #FECACA",
  },
  trackingStatusNeutral: {
    background: "#F1F5F9",
    color: "#475569",
    border: "1px solid #E2E8F0",
  },
  trackingTime: {
    display: "block",
    marginTop: 5,
    color: "#64748B",
    fontSize: 11,
    fontWeight: 800,
  },
  attentionPanel: {
    display: "flex",
    justifyContent: "space-between",
    gap: 14,
    alignItems: "center",
    flexWrap: "wrap",
    padding: 18,
    borderRadius: 20,
    background: "#FFFBEB",
    border: "1px solid #FDE68A",
  },
  flagWrap: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  warningPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 10px",
    borderRadius: 999,
    background: "#FFF7ED",
    color: "#9A3412",
    border: "1px solid #FED7AA",
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  goodPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 10px",
    borderRadius: 999,
    background: "#F0FDF4",
    color: "#166534",
    border: "1px solid #BBF7D0",
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  summaryGroups: {
    display: "grid",
    gap: 14,
  },
  summaryGroup: {
    minWidth: 0,
    padding: 14,
    borderRadius: 20,
    background: "#F8FAFC",
    border: "1px solid #E2E8F0",
  },
  summaryGroupHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
  },
  summaryGroupTitle: {
    margin: 0,
    color: "#0F172A",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  summaryCompactGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 10,
  },
  summaryCard: {
    minWidth: 0,
    padding: "10px 12px",
    borderRadius: 16,
    background: "#FFFFFF",
    border: "1px solid #E2E8F0",
    boxShadow: "0 8px 20px rgba(15, 23, 42, 0.045)",
  },
  summaryCardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  summaryCardLabel: {
    minWidth: 0,
    color: "#475569",
    fontSize: 12,
    fontWeight: 800,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  summaryCardValue: {
    display: "block",
    marginTop: 8,
    color: "#0F172A",
    fontSize: 26,
    lineHeight: 1,
    fontWeight: 900,
    fontVariantNumeric: "tabular-nums",
  },
  summaryHelpIcon: {
    flex: "0 0 auto",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 18,
    height: 18,
    borderRadius: 999,
    background: "#E0F2FE",
    border: "1px solid #BAE6FD",
    color: "#0369A1",
    fontSize: 12,
    fontWeight: 900,
    cursor: "help",
  },
  chartGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 14,
  },
  chartCard: {
    padding: 18,
    borderRadius: 20,
    background: "#FFFFFF",
    border: "1px solid #E2E8F0",
  },
  chartBars: {
    display: "grid",
    gap: 12,
    marginTop: 14,
  },
  chartItem: {
    display: "grid",
    gap: 6,
  },
  chartItemHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    color: "#334155",
    fontSize: 13,
  },
  chartTrack: {
    height: 10,
    borderRadius: 999,
    background: "#E2E8F0",
    overflow: "hidden",
  },
  chartFill: {
    height: "100%",
    borderRadius: 999,
    background: "#2563EB",
  },
  panel: {
    display: "grid",
    gap: 14,
    padding: 20,
    borderRadius: 24,
    background: "#FFFFFF",
    border: "1px solid #E2E8F0",
  },
  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
  },
  batchTableWrap: {
    overflowX: "auto",
    border: "1px solid #E2E8F0",
    borderRadius: 18,
    background: "#FFFFFF",
    boxShadow: "0 10px 25px rgba(15, 23, 42, 0.04)",
  },
  batchTable: {
    width: "100%",
    minWidth: 980,
    borderCollapse: "separate",
    borderSpacing: 0,
    tableLayout: "fixed",
    fontSize: 13,
  },
  batchHeaderCell: {
    padding: "12px 10px",
    background: "#F8FAFC",
    color: "#334155",
    borderBottom: "1px solid #E2E8F0",
    fontSize: 11,
    fontWeight: 950,
    textTransform: "uppercase",
    letterSpacing: "0.045em",
    whiteSpace: "nowrap",
  },
  batchBatchHeaderCell: {
    width: 92,
    textAlign: "left",
  },
  batchTextHeaderCell: {
    width: 155,
    textAlign: "left",
  },
  batchNumberHeaderCell: {
    width: 82,
    textAlign: "center",
  },
  batchStateHeaderCell: {
    width: 112,
    textAlign: "center",
  },
  batchRow: {
    background: "#FFFFFF",
  },
  batchCell: {
    padding: "11px 10px",
    borderBottom: "1px solid #EEF2F7",
    color: "#0F172A",
    verticalAlign: "middle",
  },
  batchTextCell: {
    textAlign: "left",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    fontWeight: 400,
  },
  batchNumberCell: {
    textAlign: "center",
    fontWeight: 400,
    fontVariantNumeric: "tabular-nums",
  },
  batchStateCell: {
    textAlign: "center",
  },
  statePillBase: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 82,
    padding: "5px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 950,
    textTransform: "uppercase",
    letterSpacing: "0.035em",
  },
  acceptedStatePill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 82,
    padding: "5px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 950,
    textTransform: "uppercase",
    letterSpacing: "0.035em",
    background: "#DBEAFE",
    color: "#1D4ED8",
    border: "1px solid #BFDBFE",
  },
  issuedStatePill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 82,
    padding: "5px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 950,
    textTransform: "uppercase",
    letterSpacing: "0.035em",
    background: "#FEF3C7",
    color: "#92400E",
    border: "1px solid #FDE68A",
  },
  completedStatePill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 82,
    padding: "5px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 950,
    textTransform: "uppercase",
    letterSpacing: "0.035em",
    background: "#DCFCE7",
    color: "#166534",
    border: "1px solid #BBF7D0",
  },
  rejectedStatePill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 82,
    padding: "5px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 950,
    textTransform: "uppercase",
    letterSpacing: "0.035em",
    background: "#FEE2E2",
    color: "#991B1B",
    border: "1px solid #FECACA",
  },
  cancelledStatePill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 82,
    padding: "5px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 950,
    textTransform: "uppercase",
    letterSpacing: "0.035em",
    background: "#E2E8F0",
    color: "#334155",
    border: "1px solid #CBD5E1",
  },
  neutralStatePill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 82,
    padding: "5px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 950,
    textTransform: "uppercase",
    letterSpacing: "0.035em",
    background: "#F1F5F9",
    color: "#475569",
    border: "1px solid #E2E8F0",
  },
  flagPillBase: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 92,
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 950,
    textTransform: "uppercase",
    letterSpacing: "0.035em",
    whiteSpace: "nowrap",
  },
  doneFlagPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 92,
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 950,
    textTransform: "uppercase",
    letterSpacing: "0.035em",
    whiteSpace: "nowrap",
    background: "#DCFCE7",
    color: "#166534",
    border: "1px solid #BBF7D0",
  },
  notDoneFlagPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 92,
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 950,
    textTransform: "uppercase",
    letterSpacing: "0.035em",
    whiteSpace: "nowrap",
    background: "#FEF3C7",
    color: "#92400E",
    border: "1px solid #FDE68A",
  },
  notFoundFlagPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 92,
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 950,
    textTransform: "uppercase",
    letterSpacing: "0.035em",
    whiteSpace: "nowrap",
    background: "#FFEDD5",
    color: "#9A3412",
    border: "1px solid #FED7AA",
  },
  notReadyFlagPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 92,
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 950,
    textTransform: "uppercase",
    letterSpacing: "0.035em",
    whiteSpace: "nowrap",
    background: "#FEF9C3",
    color: "#854D0E",
    border: "1px solid #FEF08A",
  },
  noGeofenceFlagPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 92,
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 950,
    textTransform: "uppercase",
    letterSpacing: "0.035em",
    whiteSpace: "nowrap",
    background: "#EDE9FE",
    color: "#5B21B6",
    border: "1px solid #DDD6FE",
  },
  blockedFlagPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 92,
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 950,
    textTransform: "uppercase",
    letterSpacing: "0.035em",
    whiteSpace: "nowrap",
    background: "#FEE2E2",
    color: "#991B1B",
    border: "1px solid #FECACA",
  },
  cancelledFlagPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 92,
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 950,
    textTransform: "uppercase",
    letterSpacing: "0.035em",
    whiteSpace: "nowrap",
    background: "#E2E8F0",
    color: "#334155",
    border: "1px solid #CBD5E1",
  },
  noAccessFlagPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 92,
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 950,
    textTransform: "uppercase",
    letterSpacing: "0.035em",
    whiteSpace: "nowrap",
    background: "#FAE8FF",
    color: "#86198F",
    border: "1px solid #F5D0FE",
  },
  noReadingFlagPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 92,
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 950,
    textTransform: "uppercase",
    letterSpacing: "0.035em",
    whiteSpace: "nowrap",
    background: "#E0F2FE",
    color: "#075985",
    border: "1px solid #BAE6FD",
  },
  defaultFlagPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 92,
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 950,
    textTransform: "uppercase",
    letterSpacing: "0.035em",
    whiteSpace: "nowrap",
    background: "#F1F5F9",
    color: "#475569",
    border: "1px solid #E2E8F0",
  },
  tableWrap: {
    overflowX: "auto",
  },
  compactBatchIdCell: {
    width: 92,
    maxWidth: 92,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    fontWeight: 400,
    color: "#1E3A8A",
    textAlign: "left",
  },
  tableFilterCell: {
    paddingTop: 6,
    paddingBottom: 10,
    background: "#F8FAFC",
    verticalAlign: "top",
  },
  tableFilterInput: {
    minWidth: 120,
    width: "100%",
    border: "1px solid #CBD5E1",
    borderRadius: 10,
    padding: "7px 9px",
    color: "#0F172A",
    fontSize: 12,
    fontWeight: 800,
    background: "#FFFFFF",
  },
  tableFilterSelect: {
    minWidth: 120,
    width: "100%",
    border: "1px solid #CBD5E1",
    borderRadius: 10,
    padding: "7px 9px",
    color: "#0F172A",
    fontSize: 12,
    fontWeight: 800,
    background: "#FFFFFF",
  },
  tableCountPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "7px 10px",
    borderRadius: 999,
    background: "#EFF6FF",
    color: "#1D4ED8",
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  table: {
    width: "100%",
    minWidth: 1100,
    borderCollapse: "separate",
    borderSpacing: 0,
    fontSize: 13,
  },
  detailTable: {
    width: "100%",
    minWidth: 920,
    borderCollapse: "separate",
    borderSpacing: 0,
    fontSize: 13,
  },
  emptyTableCell: {
    padding: 16,
    color: "#64748B",
    textAlign: "center",
  },
  focusedTableRow: {
    background: "#EFF6FF",
    outline: "2px solid #3B82F6",
  },
  tableFootnote: {
    margin: 0,
    color: "#64748B",
    fontSize: 13,
  },
};
