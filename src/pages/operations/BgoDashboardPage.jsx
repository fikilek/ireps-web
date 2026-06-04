import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useGetTcUploadsQuery } from "../../redux/tcApi";
import {
  useGetBgoBatchesByTcIdQuery,
  useGetBgoRowsByTcIdQuery,
} from "../../redux/bgoApi";

const FILTER_ALL = "ALL";

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

function matchesFilter(value, selectedValue) {
  if (selectedValue === FILTER_ALL) return true;
  return String(valueOrNav(value)) === selectedValue;
}

export default function BgoDashboardPage() {
  const [selectedTrnType, setSelectedTrnType] = useState(FILTER_ALL);
  const [selectedAttention, setSelectedAttention] = useState(FILTER_ALL);

  const {
    data: uploads = [],
    isLoading,
    isFetching,
    isError,
  } = useGetTcUploadsQuery({ limit: 100 });

  const trnTypeOptions = useMemo(() => {
    return Array.from(new Set(uploads.map((upload) => upload.trnType).filter(Boolean))).sort();
  }, [uploads]);

  const visibleUploads = useMemo(() => {
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
  }, [uploads, selectedTrnType, selectedAttention]);

  return (
    <section style={styles.page}>
      <div style={styles.hero}>
        <div>
          <p style={styles.eyebrow}>Operations / BGO Dashboard</p>
          <h2 style={styles.title}>BGO Dashboard</h2>
          <p style={styles.description}>
            TC upload control view for validation quality, BGO readiness,
            allocation progress, field execution, and management attention.
          </p>
        </div>

        <div style={styles.heroBadge}>
          {isFetching ? "CONNECTING STREAM" : "LIVE TC UPLOADS"}
        </div>
      </div>

      <div style={styles.filterPanel}>
        <div>
          <p style={styles.sectionMiniTitle}>Filters</p>
          <p style={styles.mutedText}>
            Landing cards stream lightweight summaries from tc_uploads. Full row/TRN drill-down remains inside each upload dashboard.
          </p>
        </div>

        <div style={styles.filterControls}>
          <select
            value={selectedTrnType}
            onChange={(event) => setSelectedTrnType(event.target.value)}
            style={styles.filterInput}
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

      <div style={styles.uploadGrid}>
        {isLoading ? (
          <article style={styles.emptyCard}>
            <p style={styles.eyebrow}>Loading</p>
            <h3 style={styles.emptyTitle}>Connecting to tc_uploads stream...</h3>
            <p style={styles.mutedText}>The dashboard will show one card per TC upload file.</p>
          </article>
        ) : null}

        {!isLoading && visibleUploads.length === 0 ? (
          <article style={styles.emptyCard}>
            <p style={styles.eyebrow}>No dashboard cards</p>
            <h3 style={styles.emptyTitle}>No TC uploads match the current filter.</h3>
            <p style={styles.mutedText}>Upload TC files or clear the filters to see BGO dashboard cards.</p>
          </article>
        ) : null}

        {!isLoading
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
