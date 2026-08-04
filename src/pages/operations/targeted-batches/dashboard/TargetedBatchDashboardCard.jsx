/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { Link } from "react-router-dom";

import {
  buildCoverageBar,
  buildTargetedBatchMetrics,
  formatCoveragePercent,
  getBatchAllocationStatus,
  getBatchExecutionStatus,
  getBatchId,
  getBatchWorkflowStatus,
  getBatchTarget,
  getBatchUpdatedAt,
  isBatchAllocated,
} from "./targetedBatchDashboardModel";
import {
  formatDateTime,
  formatNumber,
} from "../targetedBatchUtils";
import styles from "./targetedBatchDashboardStyles";

function CoverageMetric({ label, fromValue, toValue }) {
  return (
    <div style={styles.coverageShell}>
      <div style={styles.coverageTitle}>{label}</div>
      <div style={styles.coverageRow}>
        <strong style={styles.coverageFlow}>
          {formatNumber(fromValue)} → {formatNumber(toValue)}
        </strong>
        <span style={styles.coverageBar}>
          {buildCoverageBar(toValue, fromValue)}
        </span>
        <strong style={styles.coveragePercent}>
          {formatCoveragePercent(toValue, fromValue)}
        </strong>
      </div>
    </div>
  );
}

function TbFunnel({ metrics }) {
  const rows = [
    {
      label: "Original Meters",
      value: metrics.originalMeters,
    },
    {
      label: "Meters Found",
      value: metrics.metersFound,
    },
    {
      label: "Meters Different",
      value: metrics.metersDifferent,
    },
    {
      label: "Premises In Progress",
      value: metrics.premisesInProgress,
    },
    {
      label: "No Access",
      value: metrics.noAccess,
    },
  ];

  return (
    <div style={styles.funnelShell}>
      <p style={styles.funnelTitle}>TB Funnel</p>

      <div style={styles.funnelRows}>
        {rows.map((row) => (
          <div key={row.label} style={styles.funnelRow}>
            <span style={styles.funnelLabel}>{row.label}</span>
            <strong style={styles.funnelValue}>
              {formatNumber(row.value)}
            </strong>
            <span style={styles.funnelBar}>
              {buildCoverageBar(row.value, metrics.originalMeters)}
            </span>
            <strong style={styles.funnelPercent}>
              {formatCoveragePercent(
                row.value,
                metrics.originalMeters,
              )}
            </strong>
          </div>
        ))}
      </div>

      <div style={styles.funnelFooter}>
        <span>
          Found coverage:{" "}
          <strong>
            {formatCoveragePercent(
              metrics.metersFound,
              metrics.originalMeters,
            )}
          </strong>
        </span>
        <span>
          Mismatch rate:{" "}
          <strong>
            {formatCoveragePercent(
              metrics.metersDifferent,
              metrics.metersFound,
            )}
          </strong>
        </span>
        <span>
          No Access:{" "}
          <strong>
            {formatCoveragePercent(
              metrics.noAccess,
              metrics.originalMeters,
            )}{" "}
            of original meters
          </strong>
        </span>
      </div>
    </div>
  );
}

export default function TargetedBatchDashboardCard({
  batch,
  rows = [],
}) {
  const tbId = getBatchId(batch);
  const metrics = buildTargetedBatchMetrics(batch, rows);
  const target = getBatchTarget(batch);
  const allocated = isBatchAllocated(batch);
  const allocationStatus = getBatchAllocationStatus(batch);
  const workflowStatus = getBatchWorkflowStatus(batch);
  const executionStatus = getBatchExecutionStatus(batch);
  const encodedTbId = encodeURIComponent(tbId);
  const sourceLabel =
    batch?.source?.label ||
    batch?.source?.type ||
    "Targeted Batch";
  const lmPcode = batch?.scope?.lmPcode || "NAv";
  const lmName = batch?.scope?.lmName || "NAv";

  return (
    <article style={styles.card}>
      <div style={styles.cardTop}>
        <div>
          <p style={styles.eyebrow}>TB Dashboard</p>
          <h3 style={styles.cardTitle}>{tbId}</h3>
          <p style={styles.cardSubtitle}>
            {sourceLabel} • {lmName} ({lmPcode}) •{" "}
            {formatNumber(metrics.originalMeters)} original meters
          </p>
          <p style={styles.fileName}>
            Target:{" "}
            {target.id
              ? `${target.type} • ${target.name}`
              : "Not allocated"}
          </p>
          <p style={styles.fileName}>
            Updated: {formatDateTime(getBatchUpdatedAt(batch))}
          </p>
        </div>

        <div style={styles.statusStack}>
          <span
            style={styles.statusPill}
            title={`Allocation: ${allocationStatus}`}
          >
            {workflowStatus}
          </span>
          <span style={styles.attentionPill}>
            {executionStatus}
          </span>
          {metrics.noAccess > 0 ? (
            <span style={styles.dangerPill}>
              NO ACCESS: {formatNumber(metrics.noAccess)}
            </span>
          ) : null}
        </div>
      </div>

      <div style={styles.coverageGrid}>
        <CoverageMetric
          label="Original Meters → Meters Found"
          fromValue={metrics.originalMeters}
          toValue={metrics.metersFound}
        />

        <CoverageMetric
          label="Meters Found → Meters Different"
          fromValue={metrics.metersFound}
          toValue={metrics.metersDifferent}
        />
      </div>

      <TbFunnel metrics={metrics} />

      <div style={styles.cardActions}>
        <Link
          to={`/sales?tbId=${encodedTbId}&view=map`}
          style={styles.primaryButton}
          title="Open the Prepaid Sales GPS map filtered to this Targeted Batch."
        >
          Open Map
        </Link>

        <Link
          to={`/operations/targeted-batches/${encodedTbId}`}
          style={styles.secondaryButton}
        >
          Open TB Rows
        </Link>

        {allocated ? (
          <span
            style={styles.allocatedButton}
            role="link"
            aria-disabled="true"
            tabIndex={0}
            title="Allocation prohibited: this Targeted Batch is already allocated."
          >
            Allocated
          </span>
        ) : (
          <Link
            to={`/operations/targeted-batches/${encodedTbId}/allocation`}
            style={styles.secondaryButton}
          >
            Open Allocation
          </Link>
        )}

        <Link
          to={`/operations/targeted-batches/${encodedTbId}/final-report`}
          style={styles.secondaryButton}
        >
          Open Final Report
        </Link>
      </div>
    </article>
  );
}
