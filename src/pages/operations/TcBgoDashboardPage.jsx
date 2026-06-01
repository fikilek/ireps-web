import { useMemo } from "react";
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

function buildTrackerStages(upload = {}, metrics = {}) {
  const sourceUpload = upload || {};
  const time = getDashboardTime(sourceUpload);
  const metadata = sourceUpload.metadata || {};
  const raw = sourceUpload.raw || {};

  const uploadedAt = time.uploadedAt || metadata.createdAt || raw.createdAt;
  const fileVerifiedAt =
    time.fileVerifiedAt || raw.fileVerifiedAt || raw.validationCompletedAt || null;
  const tcRowsCreatedAt =
    time.tcRowsCreatedAt || raw.tcRowsCreatedAt || raw.rowsCreatedAt || metadata.updatedAt;
  const firstBgoAt = time.firstBgoAt || raw.firstBgoAt || null;
  const firstIssuedAt = time.firstIssuedAt || raw.firstIssuedAt || firstBgoAt;
  const firstAcceptedAt = time.firstAcceptedAt || raw.firstAcceptedAt || null;
  const lastCompletedAt = time.lastCompletedAt || raw.lastCompletedAt || null;

  const stageInputs = [
    {
      code: "UPLOADED",
      label: "UPLOADED",
      timestamp: uploadedAt,
      done: Boolean(uploadedAt || sourceUpload.id),
      previousTimestamp: null,
    },
    {
      code: "VERIFIED",
      label: "VERIFIED",
      timestamp: fileVerifiedAt,
      done: Boolean(
        fileVerifiedAt ||
          sourceUpload.validationState === "VALIDATED" ||
          sourceUpload.validationState === "VALIDATED_WITH_EXCEPTIONS",
      ),
      previousTimestamp: uploadedAt,
    },
    {
      code: "TC_ROWS",
      label: "TC ROWS",
      timestamp: tcRowsCreatedAt,
      done: metrics.totalRows > 0,
      previousTimestamp: fileVerifiedAt || uploadedAt,
    },
    {
      code: "BGO",
      label: "BGO",
      timestamp: firstBgoAt,
      done: metrics.issuedToBgoRows > 0,
      previousTimestamp: tcRowsCreatedAt || fileVerifiedAt || uploadedAt,
    },
    {
      code: "ISSUED",
      label: "ISSUED",
      timestamp: firstIssuedAt,
      done: metrics.issuedToBgoRows > 0,
      previousTimestamp: firstBgoAt || tcRowsCreatedAt || uploadedAt,
    },
    {
      code: "ACCEPTED",
      label: "ACCEPTED",
      timestamp: firstAcceptedAt,
      done: Boolean(firstAcceptedAt),
      previousTimestamp: firstIssuedAt || firstBgoAt || uploadedAt,
    },
    {
      code: "COMPLETED",
      label: "COMPLETED",
      timestamp: lastCompletedAt,
      done:
        metrics.issuedToBgoRows > 0 &&
        metrics.executedRows + metrics.cancelledRows >= metrics.issuedToBgoRows,
      previousTimestamp: firstAcceptedAt || firstIssuedAt || firstBgoAt || uploadedAt,
    },
  ];

  return stageInputs.map((stage) => ({
    ...stage,
    displayTimestamp: stage.done || stage.timestamp ? formatTime(stage.timestamp) : "NAv",
    status: stage.done ? "DONE" : "WAITING",
    durationFromPrevious:
      stage.done && stage.previousTimestamp && stage.timestamp
        ? formatDuration(stage.previousTimestamp, stage.timestamp)
        : stage.done
          ? "NAv"
          : "WAITING",
  }));
}

function TrackerStage({ stage, isLast }) {
  return (
    <div style={styles.trackerStageWrap}>
      {stage.durationFromPrevious ? (
        <div style={styles.durationLabel}>{stage.durationFromPrevious}</div>
      ) : (
        <div style={styles.durationLabelSpacer} />
      )}

      <div style={styles.stageAndConnector}>
        <div
          style={{
            ...styles.stageCard,
            ...(stage.status === "WAITING" ? styles.stageWaiting : {}),
          }}
        >
          <strong>{stage.label}</strong>
          <span>{stage.displayTimestamp}</span>
          <small>{stage.status}</small>
        </div>

        {!isLast ? <div style={styles.connector}>→</div> : null}
      </div>
    </div>
  );
}

function UploadLifecycleTracker({ upload, metrics }) {
  const trackerStages = useMemo(
    () => buildTrackerStages(upload, metrics),
    [upload, metrics],
  );

  return (
    <div style={styles.trackerShell}>
      <p style={styles.sectionMiniTitle}>TC Upload Lifecycle Tracker</p>

      <div style={styles.trackerRow}>
        {trackerStages.map((stage, index) => (
          <TrackerStage
            key={stage.code}
            stage={stage}
            isLast={index === trackerStages.length - 1}
          />
        ))}
      </div>
    </div>
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
  const cards = [
    { label: "Total Rows", value: metrics.totalRows, hint: "All rows in upload file" },
    { label: "Found", value: metrics.foundRows, hint: "Matched to iREPS ASTs" },
    { label: "Not Found", value: metrics.notFoundRows, hint: "Outside BGO until reviewed" },
    { label: "BGO Ready", value: metrics.bgoReadyRows, hint: "Ready or already issued" },
    { label: "BGO Not Ready", value: metrics.bgoNotReadyRows, hint: "Blocked before BGO" },
    { label: "Issued to BGO", value: metrics.issuedToBgoRows, hint: "Rows already consumed by BGO" },
    { label: "Not Yet Issued", value: metrics.notYetIssuedRows, hint: "Ready but not allocated" },
    { label: "Executed", value: metrics.executedRows, hint: "Completed child TRNs" },
    { label: "Not Executed", value: metrics.notExecutedRows, hint: "Issued but not complete" },
    { label: "Successful", value: metrics.successfulRows, hint: "Successful field outcome" },
    { label: "Unsuccessful", value: metrics.unsuccessfulRows, hint: "NO_ACCESS or failed outcome" },
  ];

  return (
    <div style={styles.summaryGrid}>
      {cards.map((card) => (
        <article key={card.label} style={styles.summaryCard}>
          <p>{card.label}</p>
          <strong>{formatNumber(card.value)}</strong>
          <span>{card.hint}</span>
        </article>
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

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th>BGO Batch</th>
              <th>Geofence</th>
              <th>Target</th>
              <th>Rows</th>
              <th>Child TRNs</th>
              <th>State</th>
              <th>Executed</th>
              <th>Not Executed</th>
              <th>Successful</th>
              <th>Unsuccessful</th>
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
                  style={isFocused ? styles.focusedTableRow : null}
                >
                  <td>{row.displayBatchId}</td>
                  <td>{row.geofence}</td>
                  <td>{row.target}</td>
                  <td>{formatNumber(row.rowCount)}</td>
                  <td>{formatNumber(row.childTrns)}</td>
                  <td>{row.state}</td>
                  <td>{formatNumber(row.executed)}</td>
                  <td>{formatNumber(row.notExecuted)}</td>
                  <td>{formatNumber(row.successful)}</td>
                  <td>{formatNumber(row.unsuccessful)}</td>
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
  return (
    <section style={styles.panel}>
      <div style={styles.panelHeader}>
        <div>
          <p style={styles.sectionMiniTitle}>Row / TRN detail flags</p>
          <p style={styles.mutedText}>
            Live TC row flags with child TRN workflow state/outcome where linked. Time intelligence comes next.
          </p>
        </div>
      </div>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th>Row</th>
              <th>Meter</th>
              <th>ERF</th>
              <th>Address</th>
              <th>Geofence</th>
              <th>BGO Batch</th>
              <th>Child TRN</th>
              <th>State</th>
              <th>Outcome</th>
              <th>Flag</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} style={styles.emptyTableCell}>
                  No TC rows streamed yet for this upload.
                </td>
              </tr>
            ) : null}

            {rows.slice(0, 100).map((row) => (
              <tr key={row.id || `${row.rowNo}-${row.meter}`}>
                <td>{row.rowNo}</td>
                <td>{row.meter}</td>
                <td>{row.erf}</td>
                <td>{row.address}</td>
                <td>{row.geofence}</td>
                <td>{row.batchId}</td>
                <td>{row.childTrn}</td>
                <td>{row.workflowState}</td>
                <td>{row.outcome}</td>
                <td>
                  <span style={row.flag === "DONE" ? styles.goodPill : styles.warningPill}>
                    {row.flag}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > 100 ? (
        <p style={styles.tableFootnote}>
          Showing first 100 rows. Filters and pagination come in a later dashboard step.
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

      <UploadLifecycleTracker upload={upload || { id: tcId }} metrics={metrics} />
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
    alignItems: "flex-start",
    minWidth: 900,
  },
  trackerStageWrap: {
    display: "grid",
    gap: 6,
  },
  durationLabel: {
    height: 18,
    color: "#475569",
    fontSize: 12,
    fontWeight: 900,
    textAlign: "center",
  },
  durationLabelSpacer: {
    height: 18,
  },
  stageAndConnector: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  stageCard: {
    minWidth: 112,
    display: "grid",
    gap: 4,
    padding: "12px 10px",
    borderRadius: 18,
    background: "#DCFCE7",
    border: "1px solid #86EFAC",
    color: "#14532D",
    textAlign: "center",
  },
  stageWaiting: {
    background: "#F8FAFC",
    border: "1px solid #CBD5E1",
    color: "#475569",
  },
  connector: {
    color: "#94A3B8",
    fontWeight: 900,
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
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 14,
  },
  summaryCard: {
    minWidth: 0,
    padding: 16,
    borderRadius: 18,
    background: "#FFFFFF",
    border: "1px solid #E2E8F0",
    boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
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
  tableWrap: {
    overflowX: "auto",
  },
  table: {
    width: "100%",
    minWidth: 1100,
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
