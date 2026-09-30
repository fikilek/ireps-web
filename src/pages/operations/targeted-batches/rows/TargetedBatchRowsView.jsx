/* eslint-disable no-unused-vars -- JSX tags are consumed by React. */
import { useMemo, useState } from "react";
import { formatDateTime } from "../targetedBatchUtils";
import TargetedBatchRowsSummary from "./TargetedBatchRowsSummary";
import TargetedBatchRowsTable from "./TargetedBatchRowsTable";
import { buildTargetedBatchWorkSummary } from "./targetedBatchRowsModel.js";
import { tbRowsStyles as styles } from "./targetedBatchRowsStyles";

function BatchDetail({ label, value, wide = false }) {
  return <div style={wide ? styles.infoWide : undefined}>
    <dt style={styles.infoLabel}>{label}</dt>
    <dd style={styles.infoValue}>{value || "NAv"}</dd>
  </div>;
}

export default function TargetedBatchRowsView({ batch, rows, takeOut, toolbar }) {
  const [filters, setFilters] = useState({});
  const summary = useMemo(() => buildTargetedBatchWorkSummary(rows), [rows]);
  const showFile = batch.source?.fileName && !String(batch.source?.type || "").startsWith("PREPAID_SALES");
  const processingIssue = /FAIL|ERROR|REJECT/.test(`${batch.validation?.status || ""} ${batch.creation?.state || ""}`);

  return <>
    <section style={styles.infoPanel} aria-label="Batch Details">
      <h3 style={styles.batchDetailsTitle}>Batch Details</h3>
      <dl style={styles.infoGrid}>
        <BatchDetail label="Source" value={batch.source?.label} />
        <BatchDetail label="LM" value={`${batch.scope?.lmPcode || "NAv"} · ${batch.scope?.lmName || "NAv"}`} />
        <BatchDetail label="Created" value={formatDateTime(batch.createdAt)} />
      </dl>
      <dl style={{ display: "grid", gap: 12, margin: "14px 0 0" }}>
        {showFile ? <BatchDetail label="File Name" value={batch.source.fileName} wide /> : null}
        <BatchDetail label="Selection Reason" value={batch.selection?.reason} wide />
      </dl>
      {processingIssue ? <p role="alert" style={styles.processingAlert}>This batch needs attention. Check its processing details.</p> : null}
      <details style={styles.processingDetails} open={processingIssue || undefined}>
        <summary style={styles.processingToggle}>Processing details</summary>
        <dl style={styles.processingGrid}>
          <BatchDetail label="Validation" value={batch.validation?.status} />
          <BatchDetail label="Creation State" value={batch.creation?.state} />
        </dl>
      </details>
    </section>

    <TargetedBatchRowsSummary summary={summary} selected={filters.workStatus || ""}
      onSelect={workStatus => setFilters(current => ({ ...current, workStatus }))} />
    <TargetedBatchRowsTable rows={rows} batch={batch} filters={filters} onFiltersChange={setFilters}
      takeOut={takeOut} toolbar={toolbar} />
  </>;
}
