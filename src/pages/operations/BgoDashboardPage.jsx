import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import { useWarehouse } from "@/context/WarehouseContext";
import { useGetTcUploadsQuery } from "../../redux/tcApi";
import {
  useGetBgoBatchesByLmQuery,
  useGetBgoBatchesByTcIdQuery,
  useGetBgoRowsByTcIdQuery,
} from "../../redux/bgoApi";
import { useGetAstsByLmPcodeQuery } from "../../redux/astsApi";
import { useGetPremisesByLmPcodeQuery } from "../../redux/mapPremisesApi";

const FILTER_ALL = "ALL";

const MD_BGO_MODE = "MD_BGO";

function readFirstString(...values) {
  for (const value of values) {
    const clean = String(value || "").trim();
    if (clean) return clean;
  }

  return "";
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

function getActiveLmPcode(activeWorkbase, selectedLm) {
  return readFirstString(
    selectedLm?.pcode,
    selectedLm?.id,
    activeWorkbase?.lmPcode,
    activeWorkbase?.pcode,
    activeWorkbase?.id,
    activeWorkbase?.localMunicipalityId,
  );
}

function getLmName(activeWorkbase, selectedLm) {
  return valueOrNav(
    readFirstString(
      selectedLm?.name,
      selectedLm?.lmName,
      activeWorkbase?.name,
      activeWorkbase?.lmName,
      activeWorkbase?.id,
    ),
  );
}

function getWardPcode(ward = {}) {
  return readFirstString(ward?.pcode, ward?.id, ward?.wardPcode, ward?.code);
}

function getWardNo(ward = {}) {
  const explicit = readFirstString(ward?.wardNo, ward?.no, ward?.number, ward?.code);
  if (explicit) return explicit;

  const pcode = getWardPcode(ward);
  const match = pcode.match(/(\d{3})$/);
  if (!match) return "NAv";

  return String(Number(match[1]) || match[1]);
}

function getWardLabel(ward = {}, fallbackPcode = "") {
  const pcode = getWardPcode(ward) || fallbackPcode;
  const name = readFirstString(ward?.name, ward?.wardName, ward?.label);

  if (name && pcode && !name.includes(pcode)) return `${name} (${pcode})`;
  if (name) return name;

  const wardNo = getWardNo({ ...ward, id: pcode });
  if (wardNo !== "NAv" && pcode) return `Ward ${wardNo} (${pcode})`;
  if (pcode) return pcode;

  return "NAv";
}

function extractWardPcodeFromTrnIds(trnIds = []) {
  for (const trnId of asArray(trnIds)) {
    const match = String(trnId || "").match(/_(ZA\d{7})_/i);
    if (match?.[1]) return match[1].toUpperCase();
  }

  return "";
}

function getBatchRaw(batch = {}) {
  return batch.raw || batch;
}

function getBatchId(batch = {}) {
  const raw = getBatchRaw(batch);
  return readFirstString(batch.bgoBatchId, batch.batchId, batch.id, raw.id, raw.bgo?.batchId);
}

function getBatchScope(batch = {}) {
  const raw = getBatchRaw(batch);
  const trnIds = raw.refs?.trnIds || raw.trnIds || raw.bgo?.trnIds || [];

  return {
    lmPcode: readFirstString(batch.scope?.lmPcode, raw.scope?.lmPcode, raw.sourceUpload?.lmPcode, raw.origin?.lmPcode),
    lmName: readFirstString(batch.scope?.lmName, raw.scope?.lmName, raw.sourceUpload?.lmName),
    wardPcode: readFirstString(
      batch.scope?.wardPcode,
      raw.scope?.wardPcode,
      raw.sourceUpload?.wardPcode,
      raw.origin?.wardPcode,
      extractWardPcodeFromTrnIds(trnIds),
    ),
    wardName: readFirstString(batch.scope?.wardName, raw.scope?.wardName, raw.sourceUpload?.wardName),
  };
}

function getBatchWardPcode(batch = {}) {
  return getBatchScope(batch).wardPcode;
}

function isMdBgoBatch(batch = {}) {
  const raw = getBatchRaw(batch);

  return (
    normalizeUpper(batch.batchMode || raw.bgo?.batchMode) === "BMD" ||
    (normalizeUpper(raw.operationType || batch.operationType) === "METER_DISCOVERY" &&
      normalizeUpper(raw.origin?.sourceModule) === "BULK_METER_DISCOVERY")
  );
}

function getBatchOperationType(batch = {}) {
  const raw = getBatchRaw(batch);
  return valueOrNav(batch.operationType || raw.operationType || raw.trnType);
}

function getBatchWorkflowState(batch = {}) {
  const raw = getBatchRaw(batch);
  return valueOrNav(batch.workflowState || raw.workflow?.state || raw.workflowState || raw.state);
}

function getBatchReleaseState(batch = {}) {
  const raw = getBatchRaw(batch);
  return valueOrNav(batch.releaseState || raw.bgo?.releaseState || raw.releaseState);
}

function getBatchTarget(batch = {}) {
  const raw = getBatchRaw(batch);
  const target =
    batch.target ||
    asArray(raw.assignment?.targets)[0] ||
    raw.target ||
    raw.bgo?.target ||
    {};

  return {
    type: valueOrNav(target.type || batch.targetType || raw.bgo?.targetType),
    name: valueOrNav(target.name || batch.targetName || raw.bgo?.targetName || target.id),
  };
}

function getBatchGeofence(batch = {}) {
  const raw = getBatchRaw(batch);
  const geofenceRef = batch.geofenceRef || raw.geofenceRef || raw.geofence || {};

  return {
    id: valueOrNav(geofenceRef.id || batch.geofenceId || raw.bgo?.geofenceId),
    name: valueOrNav(geofenceRef.name || batch.geofenceName || raw.bgo?.geofenceName),
  };
}

function getBatchUpdatedAt(batch = {}) {
  const raw = getBatchRaw(batch);

  return readFirstString(
    batch.metadata?.updatedAt,
    raw.metadata?.updatedAt,
    raw.workflow?.completedAt,
    raw.workflow?.acceptedAt,
    raw.workflow?.rejectedAt,
    raw.workflow?.cancelledAt,
    raw.workflow?.issuedAt,
    batch.metadata?.createdAt,
    raw.metadata?.createdAt,
  );
}

function getBatchSummary(batch = {}) {
  const raw = getBatchRaw(batch);
  return raw.summary || batch.summary || {};
}

function getBatchReleaseSummary(batch = {}) {
  const raw = getBatchRaw(batch);
  return raw.batchReleaseSummary || batch.batchReleaseSummary || {};
}

function getBatchDerivedSummary(batch = {}) {
  const raw = getBatchRaw(batch);
  return raw.derivedExecutionSummary || batch.derivedExecutionSummary || {};
}

function getMdBgoWorklistErfRefs(batch = {}) {
  const raw = getBatchRaw(batch);

  return asArray(
    raw.worklist?.erfRefs ||
      raw.bgo?.worklist?.erfRefs ||
      raw.erfRefs ||
      batch.worklist?.erfRefs,
  );
}

function getErfRefId(ref = {}) {
  return readFirstString(ref.id, ref.erfId, ref.erf?.id, ref.pcode);
}

function getPremiseId(premise = {}) {
  return readFirstString(premise.id, premise.premiseId, premise.raw?.id);
}

function getPremiseErfId(premise = {}) {
  return readFirstString(
    premise.erfId,
    premise.accessData?.erfId,
    premise.raw?.erfId,
    premise.raw?.accessData?.erfId,
  );
}

function getMeterErfId(meter = {}) {
  const raw = meter.raw || {};

  return readFirstString(
    meter.accessData?.erfId,
    meter.accessData?.erf?.id,
    meter.accessData?.erf?.erfId,
    meter.accessData?.erf?.pcode,
    meter.erfId,
    meter.erf?.id,
    meter.erf?.erfId,
    meter.parents?.erfId,
    meter.links?.erfId,
    raw.accessData?.erfId,
    raw.accessData?.erf?.id,
    raw.accessData?.erf?.erfId,
    raw.erfId,
    raw.parents?.erfId,
    raw.links?.erfId,
  );
}

function getMeterPremiseId(meter = {}) {
  const raw = meter.raw || {};

  return readFirstString(
    meter.accessData?.premise?.id,
    meter.accessData?.premiseId,
    meter.premiseId,
    meter.premise?.id,
    meter.parents?.premiseId,
    meter.links?.premiseId,
    raw.accessData?.premise?.id,
    raw.accessData?.premiseId,
    raw.premiseId,
    raw.premise?.id,
    raw.parents?.premiseId,
    raw.links?.premiseId,
  );
}

function getMdBgoMetrics(batch = {}, liveStats = null) {
  const summary = getBatchSummary(batch);
  const releaseSummary = getBatchReleaseSummary(batch);

  return {
    totalErfs: asNumber(liveStats?.totalErfs ?? summary.erfCount ?? releaseSummary.totalRows),
    totalPremises: asNumber(liveStats?.totalPremises ?? summary.premiseCount),
    totalMeters: asNumber(liveStats?.totalMeters ?? summary.meterCount),
  };
}

function buildMdBgoLiveStatsByBatchId({ batches = [], premises = [], meters = [] }) {
  const premiseList = asArray(premises);
  const meterList = asArray(meters);

  return asArray(batches).reduce((acc, batch) => {
    const batchId = getBatchId(batch);
    const erfRefs = getMdBgoWorklistErfRefs(batch);
    const erfIds = new Set(erfRefs.map(getErfRefId).filter(Boolean));

    if (!batchId || erfIds.size === 0) {
      acc[batchId] = {
        totalErfs: erfRefs.length,
        totalPremises: 0,
        totalMeters: 0,
      };
      return acc;
    }

    const batchPremises = premiseList.filter((premise) =>
      erfIds.has(getPremiseErfId(premise)),
    );

    const premiseIds = new Set(batchPremises.map(getPremiseId).filter(Boolean));

    const batchMeters = meterList.filter((meter) => {
      const meterErfId = getMeterErfId(meter);
      const meterPremiseId = getMeterPremiseId(meter);

      return (
        (meterErfId && erfIds.has(meterErfId)) ||
        (meterPremiseId && premiseIds.has(meterPremiseId))
      );
    });

    acc[batchId] = {
      totalErfs: erfRefs.length,
      totalPremises: batchPremises.length,
      totalMeters: batchMeters.length,
    };

    return acc;
  }, {});
}

function sortBatchesByUpdatedDesc(left, right) {
  const leftDate = String(getBatchUpdatedAt(left) || "");
  const rightDate = String(getBatchUpdatedAt(right) || "");

  if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);

  return String(getBatchId(left)).localeCompare(String(getBatchId(right)));
}

function buildWardOptions({ availableWards = [], batches = [] }) {
  const byPcode = new Map();

  asArray(availableWards).forEach((ward) => {
    const pcode = getWardPcode(ward);
    if (pcode) byPcode.set(pcode, ward);
  });

  asArray(batches).forEach((batch) => {
    const scope = getBatchScope(batch);
    if (scope.wardPcode && !byPcode.has(scope.wardPcode)) {
      byPcode.set(scope.wardPcode, {
        id: scope.wardPcode,
        pcode: scope.wardPcode,
        name: scope.wardName,
      });
    }
  });

  return Array.from(byPcode.values()).sort((left, right) =>
    getWardLabel(left).localeCompare(getWardLabel(right), undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

function buildMdBgoNavigationParams({ lmPcode, batch }) {
  const scope = getBatchScope(batch);
  const geofence = getBatchGeofence(batch);
  const batchId = getBatchId(batch);

  return new URLSearchParams({
    lmPcode: lmPcode || scope.lmPcode || "",
    wardPcode: scope.wardPcode || "",
    bgoBatchId: batchId || "",
    focusGeofenceId: geofence.id !== "NAv" ? geofence.id : "",
    focusGeofenceName: geofence.name !== "NAv" ? geofence.name : "",
  });
}

function createGeofenceMapRoute({ lmPcode, batch }) {
  const params = buildMdBgoNavigationParams({ lmPcode, batch });
  params.set("fitGeofence", "true");

  return `/operations/geo-fences?${params.toString()}`;
}

function createMdBgoRoute({ lmPcode, batch }) {
  const params = buildMdBgoNavigationParams({ lmPcode, batch });

  return `/operations/bgo?${params.toString()}`;
}

function createMdBgoRowsRoute({ lmPcode, batch }) {
  const params = buildMdBgoNavigationParams({ lmPcode, batch });
  params.set("mode", MD_BGO_MODE);

  return `/operations/md-bgo-rows?${params.toString()}`;
}

function createMdBgoFinalReportRoute({ lmPcode, batch }) {
  const params = buildMdBgoNavigationParams({ lmPcode, batch });
  params.set("mode", MD_BGO_MODE);

  return `/operations/bgo-final-report?${params.toString()}`;
}

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

function formatNumber(value) {
  return asNumber(value).toLocaleString("en-ZA");
}

function normalizeUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
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

function getWorkflowState(source = {}) {
  return valueOrNav(
    source.workflowState ||
      source.workflow?.state ||
      source.raw?.workflow?.state ||
      source.raw?.workflowState ||
      source.trn?.workflow?.state ||
      source.trn?.workflowState,
  );
}

function getExecutionOutcome(source = {}) {
  const raw = source.raw || {};
  const directOutcome =
    source.executionOutcomeCode ||
    source.executionOutcome ||
    source.outcome ||
    raw.executionOutcome?.code ||
    raw.executionOutcome?.outcome ||
    raw.executionOutcome?.state ||
    raw.executionOutcomeCode ||
    raw.outcome ||
    source.trn?.executionOutcomeCode ||
    source.trn?.executionOutcome ||
    source.trn?.outcome;

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

function isCompletedState(value) {
  return normalizeUpper(value) === "COMPLETED";
}

function isCancelledState(value) {
  const state = normalizeUpper(value);
  return state === "CANCELLED" || state === "CANCELED";
}

function isSuccessOutcome(value) {
  const outcome = normalizeUpper(value);
  return outcome === "SUCCESS" || outcome === "SUCCESSFUL" || outcome === "ACCESS_YES";
}

function calculateLiveExecutionMetrics(bgoRows = []) {
  const rows = asArray(bgoRows);
  const completedRows = rows.filter((row) => isCompletedState(getWorkflowState(row)));
  const cancelledRows = rows.filter((row) => isCancelledState(getWorkflowState(row)));
  const successfulRows = completedRows.filter((row) =>
    isSuccessOutcome(getExecutionOutcome(row)),
  );
  const unsuccessfulRows = completedRows.filter(
    (row) =>
      hasMeaningfulValue(getExecutionOutcome(row)) &&
      !isSuccessOutcome(getExecutionOutcome(row)),
  );

  return {
    hasLiveRows: rows.length > 0,
    issuedRows: rows.length,
    executedRows: completedRows.length,
    cancelledRows: cancelledRows.length,
    successfulRows: successfulRows.length,
    unsuccessfulRows: unsuccessfulRows.length,
  };
}

function getBatchDerivedExecutionSummary(batch = {}) {
  return (
    batch.derivedExecutionSummary ||
    batch.raw?.derivedExecutionSummary ||
    batch.summary?.derivedExecutionSummary ||
    {}
  );
}

function hasDerivedExecutionSummary(summary = {}) {
  return Object.keys(summary || {}).some((key) => key.startsWith("total"));
}

function calculateDerivedExecutionMetrics(bgoBatches = []) {
  const initialMetrics = {
    hasDerivedSummary: false,
    issuedRows: 0,
    executedRows: 0,
    notExecutedRows: 0,
    cancelledRows: 0,
    successfulRows: 0,
    unsuccessfulRows: 0,
  };

  return asArray(bgoBatches).reduce((metrics, batch) => {
    const summary = getBatchDerivedExecutionSummary(batch);

    if (!hasDerivedExecutionSummary(summary)) {
      return metrics;
    }

    const totalChildTrns = asNumber(
      summary.totalChildTrns ??
        summary.totalTrns ??
        batch.summary?.totalTrnsCreated ??
        batch.summary?.totalRows,
    );
    const totalCompleted = asNumber(summary.totalCompleted);
    const totalCancelled = asNumber(summary.totalCancelled);
    const totalSuccess = asNumber(summary.totalSuccess);
    const totalNoAccess = asNumber(summary.totalNoAccess);
    const totalNoReading = asNumber(summary.totalNoReading);
    const totalNotExecuted = asNumber(
      summary.totalNotExecuted ??
        Math.max(totalChildTrns - totalCompleted - totalCancelled, 0),
    );
    const totalUnsuccessful = asNumber(
      summary.totalUnsuccessful ??
        Math.max(totalCompleted - totalSuccess, 0),
    );

    metrics.hasDerivedSummary = true;
    metrics.issuedRows += totalChildTrns;
    metrics.executedRows += totalCompleted;
    metrics.notExecutedRows += totalNotExecuted;
    metrics.cancelledRows += totalCancelled;
    metrics.successfulRows += totalSuccess;
    metrics.unsuccessfulRows += Math.max(
      totalUnsuccessful,
      totalNoAccess + totalNoReading,
    );

    return metrics;
  }, initialMetrics);
}

function getDashboardCounts(upload = {}) {
  return upload.dashboardSummary?.counts || upload.raw?.dashboardSummary?.counts || {};
}

function getDashboardAttention(upload = {}) {
  return upload.dashboardSummary?.attention || upload.raw?.dashboardSummary?.attention || {};
}

function calculateUploadMetrics(upload = {}, bgoRows = [], bgoBatches = []) {
  const dashboardCounts = getDashboardCounts(upload);
  const liveExecution = calculateLiveExecutionMetrics(bgoRows);
  const derivedExecution = calculateDerivedExecutionMetrics(bgoBatches);

  const totalRows = asNumber(
    dashboardCounts.totalRows ?? upload.totalRows ?? upload.summary?.totalRows,
  );
  const foundRows = asNumber(
    dashboardCounts.foundRows ?? upload.foundRows ?? upload.summary?.foundRows,
  );
  const notFoundRows = asNumber(
    dashboardCounts.notFoundRows ?? upload.notFoundRows ?? upload.summary?.notFoundRows,
  );

  const issuedToBgoRows = Math.max(
    asNumber(
      dashboardCounts.issuedToBgoRows ??
        dashboardCounts.issuedRows ??
        upload.usedRows ??
        upload.summary?.usedRows,
    ),
    derivedExecution.issuedRows,
    liveExecution.issuedRows,
  );

  const notYetIssuedRows = asNumber(
    dashboardCounts.notYetIssuedRows ??
      upload.readyRows ??
      upload.remainingRows ??
      upload.summary?.readyRows ??
      upload.summary?.remainingRows,
  );

  const bgoReadyRows = asNumber(
    dashboardCounts.bgoReadyRows ?? issuedToBgoRows + notYetIssuedRows,
  );

  const knownNotReadyRows =
    asNumber(upload.needsGeofenceRows ?? upload.summary?.needsGeofenceRows) +
    asNumber(upload.notEligibleRows ?? upload.summary?.notEligibleRows) +
    asNumber(
      upload.blockedActiveSameOperationRows ??
        upload.summary?.blockedActiveSameOperationRows,
    ) +
    asNumber(upload.duplicateMeterRows ?? upload.summary?.duplicateMeterRows);

  const bgoNotReadyRows = asNumber(
    dashboardCounts.bgoNotReadyRows ?? Math.max(knownNotReadyRows, foundRows - bgoReadyRows),
  );

  const cancelledRows = derivedExecution.hasDerivedSummary
    ? derivedExecution.cancelledRows
    : liveExecution.hasLiveRows
      ? liveExecution.cancelledRows
      : asNumber(dashboardCounts.cancelledRows ?? dashboardCounts.cancelled ?? 0);
  const executedRows = derivedExecution.hasDerivedSummary
    ? derivedExecution.executedRows
    : liveExecution.hasLiveRows
      ? liveExecution.executedRows
      : asNumber(dashboardCounts.executedRows ?? dashboardCounts.completedRows ?? 0);
  const notExecutedRows = derivedExecution.hasDerivedSummary
    ? derivedExecution.notExecutedRows
    : Math.max(issuedToBgoRows - executedRows - cancelledRows, 0);
  const successfulRows = derivedExecution.hasDerivedSummary
    ? derivedExecution.successfulRows
    : liveExecution.hasLiveRows
      ? liveExecution.successfulRows
      : asNumber(dashboardCounts.successfulRows ?? dashboardCounts.successRows ?? 0);
  const unsuccessfulRows = derivedExecution.hasDerivedSummary
    ? derivedExecution.unsuccessfulRows
    : liveExecution.hasLiveRows
      ? liveExecution.unsuccessfulRows
      : asNumber(dashboardCounts.unsuccessfulRows ?? dashboardCounts.failedRows ?? 0);

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
    needsGeofenceRows: asNumber(
      upload.needsGeofenceRows ?? upload.summary?.needsGeofenceRows,
    ),
    notEligibleRows: asNumber(
      upload.notEligibleRows ?? upload.summary?.notEligibleRows,
    ),
    blockedActiveSameOperationRows: asNumber(
      upload.blockedActiveSameOperationRows ??
        upload.summary?.blockedActiveSameOperationRows,
    ),
    duplicateMeterRows: asNumber(
      upload.duplicateMeterRows ?? upload.summary?.duplicateMeterRows,
    ),
  };
}

function getPrimaryStatus(metrics) {
  if (metrics.issuedToBgoRows > 0 && metrics.executedRows + metrics.cancelledRows >= metrics.issuedToBgoRows) {
    return "COMPLETED";
  }

  if (metrics.issuedToBgoRows > 0 && metrics.executedRows + metrics.cancelledRows < metrics.issuedToBgoRows) {
    return "IN PROGRESS";
  }

  if (metrics.issuedToBgoRows > 0 && metrics.notYetIssuedRows > 0) {
    return "BGO ALLOCATION INCOMPLETE";
  }

  if (metrics.bgoReadyRows > 0 && metrics.issuedToBgoRows === 0) {
    return "READY FOR BGO ALLOCATION";
  }

  if (metrics.bgoNotReadyRows > 0) {
    return "BGO READINESS REQUIRED";
  }

  if (metrics.notFoundRows > 0) {
    return "UPLOAD REVIEW REQUIRED";
  }

  return "UPLOADED";
}

function getAttentionReasons(upload, metrics) {
  const dashboardAttention = getDashboardAttention(upload);
  const backendReasons = asArray(dashboardAttention.reasons);
  const reasons = new Set(backendReasons);

  if (metrics.notFoundRows > 0) {
    reasons.add(`${formatNumber(metrics.notFoundRows)} row(s) not found`);
  }

  if (metrics.bgoNotReadyRows > 0) {
    reasons.add(`${formatNumber(metrics.bgoNotReadyRows)} row(s) not BGO ready`);
  }

  if (metrics.needsGeofenceRows > 0) {
    reasons.add(`${formatNumber(metrics.needsGeofenceRows)} row(s) need geofence`);
  }

  if (metrics.notEligibleRows > 0) {
    reasons.add(`${formatNumber(metrics.notEligibleRows)} row(s) not eligible`);
  }

  if (metrics.blockedActiveSameOperationRows > 0) {
    reasons.add(`${formatNumber(metrics.blockedActiveSameOperationRows)} row(s) blocked by active work`);
  }

  if (metrics.unsuccessfulRows > 0) {
    reasons.add(`${formatNumber(metrics.unsuccessfulRows)} unsuccessful execution(s)`);
  }

  return Array.from(reasons);
}

function getPercent(value, total) {
  if (!total) return 0;

  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

function MetricBar({ label, leftLabel, leftValue, rightLabel, rightValue }) {
  const total = Number(leftValue || 0) + Number(rightValue || 0);
  const leftPercent = getPercent(leftValue, total);

  return (
    <div style={styles.metricBarShell}>
      <div style={styles.metricBarHeader}>
        <span>{label}</span>
        <strong>{formatNumber(total)}</strong>
      </div>

      <div style={styles.metricBarTrack}>
        <div style={{ ...styles.metricBarFill, width: `${leftPercent}%` }} />
      </div>

      <div style={styles.metricBarFooter}>
        <span>
          {leftLabel}: <strong>{formatNumber(leftValue)}</strong>
        </span>
        <span>
          {rightLabel}: <strong>{formatNumber(rightValue)}</strong>
        </span>
      </div>
    </div>
  );
}

function AttentionReasons({ reasons = [] }) {
  if (!reasons.length) {
    return <span style={styles.goodPill}>NO ATTENTION FLAGS</span>;
  }

  return (
    <div style={styles.reasonList}>
      {reasons.map((reason) => (
        <span key={reason} style={styles.warningPill}>
          {reason}
        </span>
      ))}
    </div>
  );
}

function UploadDashboardCard({ upload }) {
  const tcId = upload.id || upload.tcId;

  const { data: bgoBatches = [], isFetching: isFetchingBgoBatches } =
    useGetBgoBatchesByTcIdQuery(
      { tcId, limit: 500 },
      { skip: !tcId },
    );

  const { data: bgoRows = [], isFetching: isFetchingBgoRows } =
    useGetBgoRowsByTcIdQuery(
      { tcId, limit: 1000 },
      { skip: !tcId },
    );

  const metrics = calculateUploadMetrics(upload, bgoRows, bgoBatches);
  const primaryStatus = getPrimaryStatus(metrics);
  const attentionReasons = getAttentionReasons(upload, metrics);
  const tcDashboardPath = `/operations/tc-uploads/${tcId}/bgo-dashboard`;

  return (
    <article style={styles.uploadCard}>
      <div style={styles.cardTop}>
        <div>
          <p style={styles.eyebrow}>TC upload dashboard</p>
          <h3 style={styles.cardTitle}>{tcId}</h3>
          <p style={styles.cardSubtitle}>
            {valueOrNav(upload.trnType)} • {valueOrNav(upload.lmPcode)} • {formatNumber(metrics.totalRows)} rows
          </p>
          <p style={styles.fileName}>{valueOrNav(upload.fileName)}</p>
        </div>

        <div style={styles.cardStatusStack}>
          <span style={styles.statusPill}>{primaryStatus}</span>
          {attentionReasons.length ? (
            <span style={styles.attentionPill}>ATTENTION REQUIRED</span>
          ) : (
            <span style={styles.goodPill}>ON TRACK</span>
          )}
          {isFetchingBgoBatches || isFetchingBgoRows ? (
            <span style={styles.streamMiniPill}>LIVE EXECUTION</span>
          ) : null}
        </div>
      </div>

      <div style={styles.metricsGrid}>
        <MetricBar
          label="Upload result"
          leftLabel="Found"
          leftValue={metrics.foundRows}
          rightLabel="Not found"
          rightValue={metrics.notFoundRows}
        />

        <MetricBar
          label="BGO readiness"
          leftLabel="Ready"
          leftValue={metrics.bgoReadyRows}
          rightLabel="Not ready"
          rightValue={metrics.bgoNotReadyRows}
        />

        <MetricBar
          label="BGO allocation"
          leftLabel="Issued"
          leftValue={metrics.issuedToBgoRows}
          rightLabel="Not issued"
          rightValue={metrics.notYetIssuedRows}
        />

        <MetricBar
          label="Field execution"
          leftLabel="Executed"
          leftValue={metrics.executedRows}
          rightLabel="Not executed"
          rightValue={metrics.notExecutedRows}
        />
      </div>

      <div style={styles.attentionBlock}>
        <p style={styles.sectionMiniTitle}>Management attention</p>
        <AttentionReasons reasons={attentionReasons} />
      </div>

      <div style={styles.cardActions}>
        <Link to={tcDashboardPath} style={styles.primaryButton}>
          Open Dashboard
        </Link>

        <Link to={`/operations/tc-uploads/${tcId}`} style={styles.secondaryButton}>
          Open TC Rows
        </Link>

        <Link to={`/operations/tc-uploads/${tcId}/bgo`} style={styles.secondaryButton}>
          Open BGO
        </Link>

        <Link
          to={`/operations/tc-uploads/${tcId}/final-report`}
          style={styles.secondaryButton}
        >
          Open Final Report
        </Link>
      </div>
    </article>
  );
}

function formatCoveragePercent(value, total) {
  const totalNumber = asNumber(total);
  if (!totalNumber) return "0%";

  const percent = Math.max(0, Math.min(100, (asNumber(value) / totalNumber) * 100));
  const rounded = Math.round(percent * 10) / 10;

  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function buildCoverageBar(value, total, slots = 10) {
  const totalNumber = asNumber(total);
  if (!totalNumber) return "░".repeat(slots);

  const ratio = Math.max(0, Math.min(1, asNumber(value) / totalNumber));
  const filledSlots = Math.max(
    ratio > 0 ? 1 : 0,
    Math.min(slots, Math.round(ratio * slots)),
  );

  return `${"█".repeat(filledSlots)}${"░".repeat(slots - filledSlots)}`;
}

function CoverageMetric({ label, fromValue, toValue }) {
  return (
    <div style={styles.coverageMetricShell}>
      <div style={styles.coverageMetricTitle}>{label}</div>
      <div style={styles.coverageMetricRow}>
        <strong style={styles.coverageFlow}>
          {formatNumber(fromValue)} → {formatNumber(toValue)}
        </strong>
        <span style={styles.coverageBar}>{buildCoverageBar(toValue, fromValue)}</span>
        <strong style={styles.coveragePercent}>
          {formatCoveragePercent(toValue, fromValue)}
        </strong>
      </div>
    </div>
  );
}

function BmdFunnel({ totalErfs, totalPremises, totalMeters }) {
  const rows = [
    { label: "ERFs", value: totalErfs },
    { label: "Premises", value: totalPremises },
    { label: "Meters", value: totalMeters },
  ];

  return (
    <div style={styles.bmdFunnelShell}>
      <p style={styles.bmdFunnelTitle}>BMD Funnel</p>

      <div style={styles.bmdFunnelRows}>
        {rows.map((row) => (
          <div key={row.label} style={styles.bmdFunnelRow}>
            <span style={styles.bmdFunnelLabel}>{row.label}</span>
            <strong style={styles.bmdFunnelValue}>{formatNumber(row.value)}</strong>
            <span style={styles.bmdFunnelBar}>
              {buildCoverageBar(row.value, totalErfs)}
            </span>
          </div>
        ))}
      </div>

      <div style={styles.bmdFunnelFooter}>
        <span>
          Premise coverage:{" "}
          <strong>{formatCoveragePercent(totalPremises, totalErfs)}</strong>
        </span>
        <span>
          Meter coverage:{" "}
          <strong>{formatCoveragePercent(totalMeters, totalPremises)}</strong>
        </span>
      </div>
    </div>
  );
}

function MdBgoDashboardCard({ batch, lmPcode, wardOptions = [], liveStats = null }) {
  const batchId = getBatchId(batch);
  const geofence = getBatchGeofence(batch);
  const target = getBatchTarget(batch);
  const scope = getBatchScope(batch);
  const wardDoc = wardOptions.find((ward) => getWardPcode(ward) === scope.wardPcode) || null;
  const wardLabel = getWardLabel(
    wardDoc || { pcode: scope.wardPcode, name: scope.wardName },
    scope.wardPcode,
  );
  const workflowState = getBatchWorkflowState(batch);
  const releaseState = getBatchReleaseState(batch);
  const operationType = getBatchOperationType(batch);
  const updatedAt = getBatchUpdatedAt(batch);
  const metrics = getMdBgoMetrics(batch, liveStats);
  const hasMapScope =
    hasMeaningfulValue(scope.wardPcode) && hasMeaningfulValue(geofence.id);

  return (
    <article style={styles.uploadCard}>
      <div style={styles.cardTop}>
        <div>
          <p style={styles.eyebrow}>MD BGO dashboard</p>
          <h3 style={styles.cardTitle}>{geofence.name}</h3>
          <p style={styles.cardSubtitle}>
            {operationType} • {wardLabel} • {formatNumber(metrics.totalErfs)} ERFs
          </p>
          <p style={styles.fileName}>{batchId}</p>
          <p style={styles.fileName}>
            Target: {target.type} • {target.name}
          </p>
          <p style={styles.fileName}>Updated: {formatDateTime(updatedAt)}</p>
        </div>

        <div style={styles.cardStatusStack}>
          <span style={styles.statusPill}>{workflowState}</span>
          <span style={styles.attentionPill}>{releaseState}</span>
        </div>
      </div>

      <div style={styles.coverageGrid}>
        <CoverageMetric
          label="ERFs → Premises"
          fromValue={metrics.totalErfs}
          toValue={metrics.totalPremises}
        />
        <CoverageMetric
          label="Premises → Meters"
          fromValue={metrics.totalPremises}
          toValue={metrics.totalMeters}
        />
      </div>

      <BmdFunnel
        totalErfs={metrics.totalErfs}
        totalPremises={metrics.totalPremises}
        totalMeters={metrics.totalMeters}
      />

      <div style={styles.cardActions}>
        {hasMapScope ? (
          <Link to={createGeofenceMapRoute({ lmPcode, batch })} style={styles.primaryButton}>
            Open Map
          </Link>
        ) : null}

        <Link to={createMdBgoRoute({ lmPcode, batch })} style={styles.secondaryButton}>
          Open MD BGO
        </Link>

        <Link
          to={createMdBgoRowsRoute({ lmPcode, batch })}
          style={styles.secondaryButton}
        >
          Open mdBgo Rows
        </Link>

        <Link
          to={createMdBgoFinalReportRoute({ lmPcode, batch })}
          style={styles.secondaryButton}
        >
          Open Final Report
        </Link>
      </div>
    </article>
  );
}

function matchesFilter(value, selectedValue) {
  if (selectedValue === FILTER_ALL) return true;
  return String(valueOrNav(value)) === selectedValue;
}

export default function BgoDashboardPage() {
  const authContext = useAuth();
  const { activeWorkbase } = authContext || {};
  const { geoState } = useGeo();
  const warehouse = useWarehouse();
  const { available = {} } = warehouse || {};

  const selectedLm = geoState?.selectedLm || null;
  const lmPcode = getActiveLmPcode(activeWorkbase, selectedLm);
  const lmName = getLmName(activeWorkbase, selectedLm);

  const [selectedTrnType, setSelectedTrnType] = useState(FILTER_ALL);
  const [selectedAttention, setSelectedAttention] = useState(FILTER_ALL);
  const [selectedWardPcode, setSelectedWardPcode] = useState(FILTER_ALL);
  const [selectedDashboardType, setSelectedDashboardType] = useState(FILTER_ALL);

  const {
    data: uploads = [],
    isLoading,
    isFetching,
    isError,
  } = useGetTcUploadsQuery({ limit: 100 });

  const {
    data: bgoBatches = [],
    isLoading: isLoadingBgoBatches,
    isFetching: isFetchingBgoBatches,
    isError: isBgoBatchesError,
  } = useGetBgoBatchesByLmQuery({ lmPcode, limit: 1000 }, { skip: !lmPcode });

  const {
    data: livePremises = [],
    isLoading: isLoadingLivePremises,
    isFetching: isFetchingLivePremises,
  } = useGetPremisesByLmPcodeQuery({ lmPcode }, { skip: !lmPcode });

  const {
    data: liveMeters = [],
    isLoading: isLoadingLiveMeters,
    isFetching: isFetchingLiveMeters,
  } = useGetAstsByLmPcodeQuery({ lmPcode, limit: 5000 }, { skip: !lmPcode });

  const mdBgoBatches = useMemo(() => {
    return asArray(bgoBatches).filter(isMdBgoBatch).sort(sortBatchesByUpdatedDesc);
  }, [bgoBatches]);

  const liveSourcesReady = !isLoadingLivePremises && !isLoadingLiveMeters;

  const mdBgoLiveStatsByBatchId = useMemo(() => {
    if (!liveSourcesReady) return {};

    return buildMdBgoLiveStatsByBatchId({
      batches: mdBgoBatches,
      premises: livePremises,
      meters: liveMeters,
    });
  }, [liveSourcesReady, mdBgoBatches, livePremises, liveMeters]);

  const wardOptions = useMemo(
    () => buildWardOptions({ availableWards: available?.wards, batches: mdBgoBatches }),
    [available?.wards, mdBgoBatches],
  );

  const trnTypeOptions = useMemo(() => {
    return Array.from(new Set(uploads.map((upload) => upload.trnType).filter(Boolean))).sort();
  }, [uploads]);

  const visibleUploads = useMemo(() => {
    if (selectedDashboardType === MD_BGO_MODE) return [];

    return uploads.filter((upload) => {
      const metrics = calculateUploadMetrics(upload);
      const attentionReasons = getAttentionReasons(upload, metrics);
      const hasAttention = attentionReasons.length > 0;

      const trnTypeMatches = matchesFilter(upload.trnType, selectedTrnType);
      const attentionMatches =
        selectedAttention === FILTER_ALL ||
        (selectedAttention === "ATTENTION" && hasAttention) ||
        (selectedAttention === "NO_ATTENTION" && !hasAttention);

      return trnTypeMatches && attentionMatches;
    });
  }, [uploads, selectedTrnType, selectedAttention, selectedDashboardType]);

  const visibleMdBgoBatches = useMemo(() => {
    if (selectedDashboardType === "AST_BGO") return [];

    return mdBgoBatches.filter((batch) => {
      return (
        selectedWardPcode === FILTER_ALL ||
        getBatchWardPcode(batch) === selectedWardPcode
      );
    });
  }, [mdBgoBatches, selectedWardPcode, selectedDashboardType]);

  const isConnecting =
    isFetching ||
    isFetchingBgoBatches ||
    isFetchingLivePremises ||
    isFetchingLiveMeters;
  const isPageLoading = isLoading || isLoadingBgoBatches;
  const hasVisibleCards = visibleMdBgoBatches.length > 0 || visibleUploads.length > 0;

  return (
    <section style={styles.page}>
      <div style={styles.hero}>
        <div>
          <p style={styles.eyebrow}>Operations / BGO Dashboard</p>
          <h2 style={styles.title}>BGO Dashboard</h2>
          <p style={styles.description}>
            TC upload control view for validation quality, BGO readiness,
            allocation progress, field execution, and management attention.
            MD-BGO allocation cards are added without changing the existing TC dashboard cards.
          </p>
        </div>

        <div style={styles.heroBadge}>
          {isConnecting ? "CONNECTING STREAM" : "LIVE BGO DASHBOARD"}
        </div>
      </div>

      <div style={styles.filterPanel}>
        <div>
          <p style={styles.sectionMiniTitle}>Filters</p>
          <p style={styles.mutedText}>
            LM: <strong>{lmName}</strong> ({lmPcode || "NAv"}) • Ward defaults to All.
            Existing TC upload cards keep their previous layout.
          </p>
        </div>

        <div style={styles.filterControls}>
          <select
            value={selectedDashboardType}
            onChange={(event) => setSelectedDashboardType(event.target.value)}
            style={styles.filterInput}
          >
            <option value={FILTER_ALL}>All Dashboard Cards</option>
            <option value="AST_BGO">AST BGO / TC Upload Cards</option>
            <option value={MD_BGO_MODE}>MD BGO Cards</option>
          </select>

          <select
            value={selectedWardPcode}
            onChange={(event) => setSelectedWardPcode(event.target.value)}
            style={styles.filterInput}
            disabled={!lmPcode || selectedDashboardType === "AST_BGO"}
          >
            <option value={FILTER_ALL}>All Wards</option>
            {wardOptions.map((ward) => {
              const pcode = getWardPcode(ward);
              return (
                <option key={pcode} value={pcode}>
                  {getWardLabel(ward, pcode)}
                </option>
              );
            })}
          </select>

          <select
            value={selectedTrnType}
            onChange={(event) => setSelectedTrnType(event.target.value)}
            style={styles.filterInput}
            disabled={selectedDashboardType === MD_BGO_MODE}
          >
            <option value={FILTER_ALL}>All TRN Types</option>
            {trnTypeOptions.map((trnType) => (
              <option key={trnType} value={trnType}>
                {trnType}
              </option>
            ))}
          </select>

          <select
            value={selectedAttention}
            onChange={(event) => setSelectedAttention(event.target.value)}
            style={styles.filterInput}
            disabled={selectedDashboardType === MD_BGO_MODE}
          >
            <option value={FILTER_ALL}>All Attention States</option>
            <option value="ATTENTION">Attention required</option>
            <option value="NO_ATTENTION">No attention flags</option>
          </select>
        </div>
      </div>

      {isError ? (
        <div style={styles.errorPanel}>
          Could not stream tc_uploads. Check the browser console and Firestore rules.
        </div>
      ) : null}

      {isBgoBatchesError ? (
        <div style={styles.errorPanel}>
          Could not stream bgo_batches for MD-BGO cards. Check the browser console and Firestore rules.
        </div>
      ) : null}

      <div style={styles.uploadGrid}>
        {isPageLoading ? (
          <article style={styles.emptyCard}>
            <p style={styles.eyebrow}>Loading</p>
            <h3 style={styles.emptyTitle}>Connecting to BGO dashboard streams...</h3>
            <p style={styles.mutedText}>The dashboard will show TC upload cards and MD-BGO allocation cards.</p>
          </article>
        ) : null}

        {!isPageLoading && !hasVisibleCards ? (
          <article style={styles.emptyCard}>
            <p style={styles.eyebrow}>No dashboard cards</p>
            <h3 style={styles.emptyTitle}>No BGO dashboard cards match the current filter.</h3>
            <p style={styles.mutedText}>Create BGO allocations or clear the filters to see cards.</p>
          </article>
        ) : null}

        {!isPageLoading
          ? visibleMdBgoBatches.map((batch) => (
              <MdBgoDashboardCard
                key={getBatchId(batch)}
                batch={batch}
                lmPcode={lmPcode}
                wardOptions={wardOptions}
                liveStats={mdBgoLiveStatsByBatchId[getBatchId(batch)] || null}
              />
            ))
          : null}

        {!isPageLoading
          ? visibleUploads.map((upload) => (
              <UploadDashboardCard key={upload.id || upload.tcId} upload={upload} />
            ))
          : null}
      </div>
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
  hero: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "flex-start",
    flexWrap: "wrap",
    minWidth: 0,
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
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  title: {
    margin: "8px 0 0",
    color: "#0F172A",
    fontSize: 28,
    lineHeight: 1.1,
  },
  description: {
    margin: "10px 0 0",
    color: "#475569",
    maxWidth: 820,
    lineHeight: 1.55,
  },
  heroBadge: {
    flex: "0 0 auto",
    padding: "8px 12px",
    borderRadius: 999,
    background: "#EFF6FF",
    color: "#1D4ED8",
    fontSize: 12,
    fontWeight: 900,
  },
  streamMiniPill: {
    padding: "6px 9px",
    borderRadius: 999,
    background: "#ECFEFF",
    color: "#0E7490",
    fontSize: 11,
    fontWeight: 900,
  },
  filterPanel: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "center",
    flexWrap: "wrap",
    minWidth: 0,
    padding: 18,
    borderRadius: 20,
    background: "#F8FAFC",
    border: "1px solid #E2E8F0",
  },
  sectionMiniTitle: {
    margin: 0,
    color: "#0F172A",
    fontSize: 13,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  mutedText: {
    margin: "6px 0 0",
    color: "#64748B",
    fontSize: 14,
    lineHeight: 1.45,
  },
  filterControls: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  filterInput: {
    minWidth: 210,
    maxWidth: "100%",
    border: "1px solid #CBD5E1",
    borderRadius: 999,
    padding: "10px 12px",
    color: "#0F172A",
    fontWeight: 800,
    background: "#FFFFFF",
  },
  errorPanel: {
    padding: 14,
    borderRadius: 18,
    background: "#FEF2F2",
    border: "1px solid #FECACA",
    color: "#991B1B",
    fontWeight: 800,
  },
  uploadGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 18,
    width: "100%",
    maxWidth: "100%",
    alignItems: "start",
  },
  uploadCard: {
    display: "grid",
    gap: 18,
    minWidth: 0,
    overflow: "hidden",
    padding: 20,
    borderRadius: 24,
    background: "#FFFFFF",
    border: "1px solid #E2E8F0",
    boxShadow: "0 16px 40px rgba(15, 23, 42, 0.07)",
  },
  cardTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: 14,
    alignItems: "flex-start",
    flexWrap: "wrap",
    minWidth: 0,
  },
  cardTitle: {
    margin: "6px 0 0",
    color: "#0F172A",
    fontSize: 18,
    lineHeight: 1.25,
    wordBreak: "break-word",
    overflowWrap: "anywhere",
  },
  cardSubtitle: {
    margin: "6px 0 0",
    color: "#334155",
    fontSize: 13,
    fontWeight: 800,
    overflowWrap: "anywhere",
  },
  fileName: {
    margin: "4px 0 0",
    color: "#64748B",
    fontSize: 13,
    overflowWrap: "anywhere",
  },
  cardStatusStack: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 8,
    flexWrap: "wrap",
  },
  statusPill: {
    padding: "7px 10px",
    borderRadius: 999,
    background: "#ECFEFF",
    color: "#0E7490",
    fontSize: 11,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  attentionPill: {
    padding: "7px 10px",
    borderRadius: 999,
    background: "#FEF3C7",
    color: "#92400E",
    fontSize: 11,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  goodPill: {
    display: "inline-flex",
    padding: "7px 10px",
    borderRadius: 999,
    background: "#DCFCE7",
    color: "#166534",
    fontSize: 11,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  warningPill: {
    display: "inline-flex",
    padding: "7px 10px",
    borderRadius: 999,
    background: "#FFF7ED",
    color: "#C2410C",
    border: "1px solid #FED7AA",
    fontSize: 11,
    fontWeight: 900,
    whiteSpace: "normal",
    overflowWrap: "anywhere",
  },
  metricsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 12,
    minWidth: 0,
  },
  coverageGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 12,
    minWidth: 0,
  },
  coverageMetricShell: {
    minWidth: 0,
    padding: 14,
    borderRadius: 18,
    background: "#F8FAFC",
    border: "1px solid #E2E8F0",
  },
  coverageMetricTitle: {
    margin: 0,
    color: "#0F172A",
    fontSize: 13,
    fontWeight: 900,
  },
  coverageMetricRow: {
    display: "grid",
    gridTemplateColumns: "auto minmax(90px, 1fr) auto",
    gap: 10,
    alignItems: "center",
    marginTop: 10,
    minWidth: 0,
  },
  coverageFlow: {
    color: "#0F172A",
    fontSize: 14,
    whiteSpace: "nowrap",
  },
  coverageBar: {
    minWidth: 0,
    color: "#2563EB",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 15,
    fontWeight: 900,
    letterSpacing: "0.02em",
    overflow: "hidden",
    textOverflow: "clip",
    whiteSpace: "nowrap",
  },
  coveragePercent: {
    color: "#0F172A",
    fontSize: 14,
    whiteSpace: "nowrap",
  },
  bmdFunnelShell: {
    display: "grid",
    gap: 10,
    minWidth: 0,
    padding: 14,
    borderRadius: 18,
    background: "#F8FAFC",
    border: "1px solid #E2E8F0",
  },
  bmdFunnelTitle: {
    margin: 0,
    color: "#0F172A",
    fontSize: 13,
    fontWeight: 900,
  },
  bmdFunnelRows: {
    display: "grid",
    gap: 8,
    minWidth: 0,
  },
  bmdFunnelRow: {
    display: "grid",
    gridTemplateColumns: "82px 52px minmax(0, 1fr)",
    gap: 10,
    alignItems: "center",
    minWidth: 0,
  },
  bmdFunnelLabel: {
    color: "#334155",
    fontSize: 13,
    fontWeight: 800,
    whiteSpace: "nowrap",
  },
  bmdFunnelValue: {
    color: "#0F172A",
    fontSize: 13,
    textAlign: "right",
    whiteSpace: "nowrap",
  },
  bmdFunnelBar: {
    minWidth: 0,
    color: "#2563EB",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 15,
    fontWeight: 900,
    letterSpacing: "0.02em",
    overflow: "hidden",
    textOverflow: "clip",
    whiteSpace: "nowrap",
  },
  bmdFunnelFooter: {
    display: "flex",
    gap: 14,
    flexWrap: "wrap",
    color: "#475569",
    fontSize: 12,
    fontWeight: 800,
  },
  metricBarShell: {
    minWidth: 0,
    padding: 12,
    borderRadius: 18,
    background: "#F8FAFC",
    border: "1px solid #E2E8F0",
  },
  metricBarHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    color: "#0F172A",
    fontSize: 13,
    fontWeight: 900,
    overflowWrap: "anywhere",
  },
  metricBarTrack: {
    marginTop: 10,
    height: 10,
    borderRadius: 999,
    background: "#E2E8F0",
    overflow: "hidden",
  },
  metricBarFill: {
    height: "100%",
    borderRadius: 999,
    background: "#2563EB",
  },
  metricBarFooter: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
    marginTop: 8,
    color: "#475569",
    fontSize: 12,
  },
  attentionBlock: {
    minWidth: 0,
    padding: 14,
    borderRadius: 18,
    background: "#FFFBEB",
    border: "1px solid #FDE68A",
  },
  reasonList: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginTop: 10,
  },
  cardActions: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    alignItems: "center",
  },
  primaryButton: {
    textDecoration: "none",
    borderRadius: 999,
    padding: "10px 14px",
    background: "#0F172A",
    color: "#FFFFFF",
    fontWeight: 900,
    fontSize: 13,
    whiteSpace: "nowrap",
  },
  secondaryButton: {
    textDecoration: "none",
    borderRadius: 999,
    padding: "10px 14px",
    background: "#F8FAFC",
    border: "1px solid #CBD5E1",
    color: "#0F172A",
    fontWeight: 900,
    fontSize: 13,
    whiteSpace: "nowrap",
  },
  emptyCard: {
    padding: 22,
    borderRadius: 24,
    background: "#F8FAFC",
    border: "1px dashed #CBD5E1",
  },
  emptyTitle: {
    margin: "8px 0 0",
    color: "#0F172A",
    fontSize: 18,
  },
};
