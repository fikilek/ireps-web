/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { inspectSalesTbRefsIntegrity, readTbRefBatchId, resolveSalesTargetedBatchMembership } from "../../../../functions/salesAllMeters/sales-batch-policy.js";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useGetPermanentSalesBatchesQuery } from "../../../redux/salesTargetedBatchApi";
import { useBatchGeofence } from "./use-batch-geofence.js";
import { NO_GEOFENCE_LABEL } from "../../operations/targeted-batches/batch-geofence-label.js";

import { acceptanceText, allocationText, batchTypeText, workStatusText } from "./sales-tb-refs-model.js";

// The batch behind one reference: read live, so the window always shows how the batch stands now.
function BatchSummary({ lmPcode, tbId, salesId }) {
  const { data } = useGetPermanentSalesBatchesQuery(lmPcode && tbId ? { lmPcode, tbId } : skipToken, { skip: !lmPcode || !tbId });
  const batch = data?.batch || null;
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const geofence = useBatchGeofence(lmPcode, batch?.geofenceId);

  if (!lmPcode || !tbId) return null;
  if (!data?.ready && !batch) return <p style={styles.batchNote}>Reading the batch…</p>;
  if (!batch) return <p style={styles.batchNote}>This batch cannot be read. It may have been deleted.</p>;

  const meterRow = rows.find(item => item?.sourceSalesAllMeterId === salesId) || null;
  const details = [
    ["Created", `${formatDate(batch.metadata?.createdAt)}${batch.metadata?.createdByUser ? ` by ${batch.metadata.createdByUser}` : ""}`],
    ["Geofence", !batch.geofenceId ? NO_GEOFENCE_LABEL : geofence?.name || batch.geofenceId],
    ["Batch type", batchTypeText(batch)],
    ["Ward", batch.scope?.wardName || (batch.scope?.wardNumber ? `Ward ${batch.scope.wardNumber}` : "NAv")],
    ["Allocated to", allocationText(batch)],
    ["Acceptance", acceptanceText(batch.acceptance?.status)],
    ["Batch status", workStatusText(batch.execution?.status || batch.status)],
    ["Meters in the batch", data?.ready ? String(rows.length) : "Counting…"],
  ];
  const meterDetails = meterRow ? [
    ["Row number", meterRow.rowNo ? `Row ${meterRow.rowNo}` : asText(meterRow.id)],
    ["Row status", workStatusText(meterRow.execution?.status || meterRow.completionStatus)],
    ["ERF", meterRow.location?.erfNo ? `ERF ${meterRow.location.erfNo}` : asText(meterRow.refs?.erfId)],
    ["Premise ID", asText(meterRow.refs?.premiseId, "None yet")],
  ] : [];

  return (
    <>
      <dl style={styles.detailGrid}>
        {details.map(([label, value]) => (
          <div key={label} style={styles.detailItem}>
            <dt style={styles.detailLabel}>{label}</dt>
            <dd style={styles.detailValue}>{asText(value)}</dd>
          </div>
        ))}
      </dl>

      {meterDetails.length ? (
        <div style={styles.fieldWorkSection}>
          <h3 style={styles.fieldWorkTitle}>This meter in the batch</h3>
          <dl style={styles.detailGrid}>
            {meterDetails.map(([label, value]) => (
              <div key={label} style={styles.detailItem}>
                <dt style={styles.detailLabel}>{label}</dt>
                <dd style={styles.detailValue}>{asText(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      <Link to={`/operations/targeted-batches/${encodeURIComponent(tbId)}`} style={styles.openRowsLink}>
        Open the batch's rows
      </Link>
    </>
  );
}

function asText(value, fallback = "NAv") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function formatDate(value) {
  if (!value) return "NAv";

  try {
    if (typeof value?.toDate === "function") {
      return value.toDate().toLocaleString();
    }

    if (Number.isFinite(Number(value?.seconds))) {
      return new Date(Number(value.seconds) * 1000).toLocaleString();
    }

    const date =
      value instanceof Date
        ? value
        : typeof value === "number"
          ? new Date(value)
          : new Date(String(value));

    if (!Number.isNaN(date.getTime())) return date.toLocaleString();
  } catch {
    // Fall through to the original value.
  }

  return asText(value);
}

function getFieldWorkRows(fieldWork = {}) {
  const outcome =
    fieldWork.outcomeLabel ||
    fieldWork.outcomeCode ||
    fieldWork.outcome ||
    "";

  return [
    ["Status", fieldWork.status],
    ["Outcome", outcome],
    ["Targeted meter", fieldWork.targetedMeterNo],
    ["Discovered meter", fieldWork.discoveredMeterNo],
    ["Meter match", fieldWork.meterMatch],
    ["Premise ID", fieldWork.premiseId],
    ["Meter ID", fieldWork.meterId],
    ["TRN ID", fieldWork.trnId],
    ["Submitted", fieldWork.submittedAt ? formatDate(fieldWork.submittedAt) : ""],
    ["Updated", fieldWork.updatedAt ? formatDate(fieldWork.updatedAt) : ""],
  ].filter(([, value]) => String(value ?? "").trim());
}

export default function SalesTbRefsModal({ row, onClose }) {
  const tbRefs = Array.isArray(row?.tbRefs) ? row.tbRefs.map(ref => ref && typeof ref === "object" ? ref : {}) : [];

  const membership = resolveSalesTargetedBatchMembership(row);
  const integrity = inspectSalesTbRefsIntegrity(row?.tbRefs);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  if (typeof document === "undefined" || !row) return null;

  return createPortal(
    <div
      style={styles.overlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        style={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sales-tb-refs-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={styles.header}>
          <div>
            <p style={styles.eyebrow}>Sales Meter</p>
            <h2 id="sales-tb-refs-modal-title" style={styles.title}>
              Targeted Batch References
            </h2>
            <p style={styles.subtitle}>
              Meter {row.meterNo || "NAv"} · {tbRefs.length}{" "}
              {tbRefs.length === 1 ? "TB" : "TBs"}
            </p>
          </div>

          <button
            type="button"
            style={styles.closeButton}
            onClick={onClose}
            aria-label="Close Targeted Batch references"
          >
            ✕
          </button>
        </div>

        <div style={styles.body}>
          <p>Current membership: {membership.state === "MEMBER" ? membership.tbId : membership.state === "NONE" ? "None" : "Unresolved"}</p>
          {!integrity.valid && <p role="alert">Historical linkage integrity: {integrity.issues.join(", ")}</p>}
          {tbRefs.length === 0 ? (
            <div style={styles.emptyState}>
              No historical Targeted Batch references are recorded.
            </div>
          ) : (
            <div style={styles.list}>
              {tbRefs.map((ref, index) => {
                const fieldWork =
                  ref?.fieldWork && typeof ref.fieldWork === "object"
                    ? ref.fieldWork
                    : null;
                const fieldWorkRows = fieldWork
                  ? getFieldWorkRows(fieldWork)
                  : [];

                return (
                  <article
                    key={`${readTbRefBatchId(ref)}-${index}`}
                    style={styles.referenceCard}
                  >
                    <div style={styles.referenceHeader}>
                      <span style={styles.referenceNumber}>{index + 1}</span>
                      <div>
                        <p style={styles.referenceLabel}>TB ID</p>
                        <strong style={styles.referenceId}>
                          {readTbRefBatchId(ref) || "Invalid historical reference"}
                        </strong>
                        {membership.state === "MEMBER" && membership.tbId === readTbRefBatchId(ref) ? (
                          <span style={styles.currentChip}>The batch this meter is in now</span>
                        ) : null}
                      </div>
                    </div>

                    <BatchSummary
                      lmPcode={row.lmPcode}
                      tbId={readTbRefBatchId(ref)}
                      salesId={row.id || row.meterNoNormalized || row.meterNo}
                    />

                    <dl style={styles.detailGrid}>
                      <div style={styles.detailItem}>
                        <dt style={styles.detailLabel}>Date added</dt>
                        <dd style={styles.detailValue}>
                          {formatDate(ref.date)}
                        </dd>
                      </div>

                      {ref.rowId ? (
                        <div style={styles.detailItem}>
                          <dt style={styles.detailLabel}>TB Row ID</dt>
                          <dd style={styles.detailValue}>
                            {asText(ref.rowId)}
                          </dd>
                        </div>
                      ) : null}
                    </dl>

                    {fieldWorkRows.length > 0 ? (
                      <div style={styles.fieldWorkSection}>
                        <h3 style={styles.fieldWorkTitle}>Field Work</h3>
                        <dl style={styles.detailGrid}>
                          {fieldWorkRows.map(([label, value]) => (
                            <div key={label} style={styles.detailItem}>
                              <dt style={styles.detailLabel}>{label}</dt>
                              <dd style={styles.detailValue}>
                                {asText(value)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <div style={styles.footer}>
          <button type="button" style={styles.doneButton} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 3300,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1rem",
    background: "rgba(15, 23, 42, 0.65)",
    backdropFilter: "blur(2px)",
  },
  card: {
    width: "min(820px, 100%)",
    maxHeight: "calc(100vh - 2rem)",
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr) auto",
    borderRadius: "1rem",
    background: "#ffffff",
    boxShadow: "0 28px 80px rgba(15, 23, 42, 0.36)",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "1rem",
    padding: "1rem 1.15rem",
    borderBottom: "1px solid #e2e8f0",
  },
  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: "0.7rem",
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  title: {
    margin: "0.2rem 0 0",
    color: "#0f172a",
    fontSize: "1.25rem",
  },
  subtitle: {
    margin: "0.35rem 0 0",
    color: "#64748b",
    fontSize: "0.86rem",
  },
  closeButton: {
    border: 0,
    background: "transparent",
    color: "#64748b",
    cursor: "pointer",
    fontSize: "1rem",
    fontWeight: 900,
  },
  body: {
    minHeight: 0,
    padding: "1rem 1.15rem",
    overflowY: "auto",
    background: "#f8fafc",
  },
  list: {
    display: "grid",
    gap: "0.8rem",
  },
  referenceCard: {
    padding: "0.9rem",
    border: "1px solid #cbd5e1",
    borderRadius: "0.85rem",
    background: "#ffffff",
  },
  referenceHeader: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },
  referenceNumber: {
    width: "2rem",
    height: "2rem",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "999px",
    background: "#dbeafe",
    color: "#1d4ed8",
    fontSize: "0.78rem",
    fontWeight: 900,
    flex: "0 0 auto",
  },
  referenceLabel: {
    margin: 0,
    color: "#64748b",
    fontSize: "0.68rem",
    fontWeight: 900,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },
  referenceId: {
    display: "block",
    marginTop: "0.15rem",
    color: "#0f172a",
    fontSize: "0.92rem",
    overflowWrap: "anywhere",
  },
  detailGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "0.65rem",
    margin: "0.8rem 0 0",
  },
  detailItem: {
    minWidth: 0,
    padding: "0.6rem",
    borderRadius: "0.65rem",
    background: "#f8fafc",
  },
  detailLabel: {
    color: "#64748b",
    fontSize: "0.68rem",
    fontWeight: 850,
    textTransform: "uppercase",
  },
  detailValue: {
    margin: "0.2rem 0 0",
    color: "#0f172a",
    fontSize: "0.8rem",
    fontWeight: 750,
    overflowWrap: "anywhere",
  },
  batchNote: {
    margin: "0.35rem 0 0",
    color: "#64748b",
    fontSize: "0.82rem",
  },
  currentChip: {
    display: "inline-block",
    marginTop: "0.3rem",
    padding: "0.15rem 0.45rem",
    borderRadius: "999px",
    background: "#eff6ff",
    color: "#1d4ed8",
    fontSize: "0.68rem",
    fontWeight: 900,
  },
  openRowsLink: {
    display: "inline-flex",
    alignItems: "center",
    marginTop: "0.6rem",
    color: "#1d4ed8",
    fontWeight: 800,
    fontSize: "0.82rem",
  },
  fieldWorkSection: {
    marginTop: "0.8rem",
    paddingTop: "0.8rem",
    borderTop: "1px solid #e2e8f0",
  },
  fieldWorkTitle: {
    margin: 0,
    color: "#334155",
    fontSize: "0.82rem",
  },
  emptyState: {
    padding: "2rem",
    border: "1px dashed #cbd5e1",
    borderRadius: "0.85rem",
    background: "#ffffff",
    color: "#64748b",
    textAlign: "center",
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    padding: "0.9rem 1.15rem",
    borderTop: "1px solid #e2e8f0",
  },
  doneButton: {
    border: "1px solid #2563eb",
    borderRadius: "0.65rem",
    padding: "0.55rem 0.9rem",
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 900,
    cursor: "pointer",
  },
};
