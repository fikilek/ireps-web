/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useMemo, useState } from "react";

import { getTargetedBatchDraftView } from "../../../redux/targetedBatchDraftModel";
import {
  formatCurrencyFromCents,
  formatDateTime,
  formatNumber,
} from "./targetedBatchUtils";

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 10;

function PaginationControls({
  currentPage,
  pageSize,
  totalPages,
  totalRows,
  onPageChange,
  onPageSizeChange,
}) {
  if (totalRows === 0) return null;

  const startRow = (currentPage - 1) * pageSize + 1;
  const endRow = Math.min(currentPage * pageSize, totalRows);

  return (
    <div style={styles.paginationBar}>
      <div style={styles.paginationSummary}>
        Showing {formatNumber(startRow)}-{formatNumber(endRow)} of{" "}
        {formatNumber(totalRows)} rows
      </div>

      <div style={styles.paginationControls}>
        <label style={styles.pageSizeLabel}>
          Rows per page
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            style={styles.pageSizeSelect}
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
          style={styles.paginationButton}
          onClick={() => onPageChange(1)}
          disabled={currentPage <= 1}
        >
          First
        </button>
        <button
          type="button"
          style={styles.paginationButton}
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
        >
          Previous
        </button>
        <span style={styles.pageCountLabel}>
          Page {formatNumber(currentPage)} of {formatNumber(totalPages)}
        </span>
        <button
          type="button"
          style={styles.paginationButton}
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
        >
          Next
        </button>
        <button
          type="button"
          style={styles.paginationButton}
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage >= totalPages}
        >
          Last
        </button>
      </div>
    </div>
  );
}

function SourceBadge({ sourceType }) {
  const salesSource = sourceType === "PREPAID_SALES";

  return (
    <span
      style={{
        ...styles.sourceBadge,
        ...(salesSource ? styles.salesBadge : styles.uploadBadge),
      }}
    >
      {salesSource ? "Prepaid Sales" : "CSV Upload"}
    </span>
  );
}

export default function TargetedBatchDraftReview({
  draft,
  onClear,
  onDownload,
  onConfirm,
  onReopen,
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const currentDraft = useMemo(() => getTargetedBatchDraftView(draft), [draft]);
  const rows = useMemo(
    () => (Array.isArray(currentDraft?.displayRows) ? currentDraft.displayRows : []),
    [currentDraft],
  );
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safeCurrentPage = Math.max(1, Math.min(currentPage, totalPages));
  const pageStartIndex = totalRows === 0 ? 0 : (safeCurrentPage - 1) * pageSize;
  const pageEndIndex = Math.min(pageStartIndex + pageSize, totalRows);
  const paginatedRows = useMemo(
    () => rows.slice(pageStartIndex, pageEndIndex),
    [rows, pageStartIndex, pageEndIndex],
  );

  const summary = useMemo(() => {
    return rows.reduce(
      (accumulator, row) => {
        const matchStatus = String(row.astMatchStatus || "NOT_CHECKED").toUpperCase();
        if (matchStatus === "MATCHED") accumulator.astMatched += 1;
        else if (matchStatus === "NOT_MATCHED") accumulator.astNotMatched += 1;
        else accumulator.astNotChecked += 1;

        accumulator.totalSalesC += Number(row.totalSalesC || 0);
        return accumulator;
      },
      {
        astMatched: 0,
        astNotMatched: 0,
        astNotChecked: 0,
        totalSalesC: 0,
      },
    );
  }, [rows]);

  function handlePageChange(nextPage) {
    const normalizedPage = Number(nextPage);
    const clampedPage = Math.max(
      1,
      Math.min(Number.isFinite(normalizedPage) ? normalizedPage : 1, totalPages),
    );
    setCurrentPage(clampedPage);
  }

  function handlePageSizeChange(nextPageSize) {
    const normalizedPageSize = Number(nextPageSize);
    const nextSize = PAGE_SIZE_OPTIONS.includes(normalizedPageSize)
      ? normalizedPageSize
      : DEFAULT_PAGE_SIZE;
    setPageSize(nextSize);
    setCurrentPage(1);
  }

  const readyForBackend = currentDraft?.status === "READY_FOR_BACKEND";

  return (
    <section style={styles.panel}>
      <div style={styles.header}>
        <div>
          <div style={styles.titleRow}>
            <p style={styles.eyebrow}>Current Draft</p>
            <SourceBadge sourceType={currentDraft?.sourceType} />
          </div>
          <h2 style={styles.title}>{currentDraft?.id || "Targeted Batch Draft"}</h2>
          <p style={styles.subtitle}>
            {currentDraft?.lmPcode || "NAv"} · {currentDraft?.lmName || "NAv"} · Created{" "}
            {formatDateTime(currentDraft?.createdAt)}
          </p>
        </div>

        <div style={styles.headerActions}>
          <span
            style={{
              ...styles.statusBadge,
              ...(readyForBackend ? styles.readyStatus : styles.draftStatus),
            }}
          >
            {readyForBackend ? "Ready for Backend" : "Draft"}
          </span>
          <button type="button" style={styles.secondaryButton} onClick={onDownload}>
            Download Draft
          </button>
          <button type="button" style={styles.dangerButton} onClick={onClear}>
            Clear Draft
          </button>
        </div>
      </div>

      <div style={styles.metadataGrid}>
        <div style={styles.metadataCard}>
          <span>Source</span>
          <strong>{currentDraft?.sourceLabel || "NAv"}</strong>
        </div>
        <div style={styles.metadataCard}>
          <span>Meters</span>
          <strong>{formatNumber(totalRows)}</strong>
        </div>
        <div style={styles.metadataCard}>
          <span>AST Matched</span>
          <strong>{formatNumber(summary.astMatched)}</strong>
        </div>
        <div style={styles.metadataCard}>
          <span>AST Not Matched</span>
          <strong>{formatNumber(summary.astNotMatched)}</strong>
        </div>
        <div style={styles.metadataCard}>
          <span>AST Not Checked</span>
          <strong>{formatNumber(summary.astNotChecked)}</strong>
        </div>
        <div style={styles.metadataCard}>
          <span>Selection Reason</span>
          <strong style={styles.metadataReason}>
            {currentDraft?.selectionReason || "NAv"}
          </strong>
        </div>
      </div>

      {currentDraft?.sourceType === "PREPAID_SALES" ? (
        <div style={styles.sourceNotice}>
          <strong>Sales-originated batch</strong>
          <p>
            The selected prepaid sales meters were transferred directly from the
            Sales page. No CSV file upload was required.
          </p>
          <p>
            Sales period: {currentDraft?.salesPeriodFrom || "NAv"} to{" "}
            {currentDraft?.salesPeriodTo || "NAv"}. Selected sales value:{" "}
            {formatCurrencyFromCents(summary.totalSalesC)}.
          </p>
        </div>
      ) : (
        <div style={styles.sourceNotice}>
          <strong>CSV-upload batch</strong>
          <p>
            Source file: {currentDraft?.fileName || "NAv"}. Frontend validation status:{" "}
            {currentDraft?.validation?.passed ? "PASSED" : "FAILED"}.
          </p>
        </div>
      )}

      <PaginationControls
        currentPage={safeCurrentPage}
        pageSize={pageSize}
        totalPages={totalPages}
        totalRows={totalRows}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
      />

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.headerCell}>Row</th>
              <th style={styles.headerCell}>Meter Number</th>
              <th style={styles.headerCell}>Address</th>
              <th style={styles.headerCell}>Town</th>
              <th style={styles.headerCell}>SG Code</th>
              <th style={styles.headerCell}>Reason</th>
              <th style={styles.headerCell}>AST Match</th>
              <th style={styles.headerCell}>Proposed TRN</th>
              <th style={styles.headerCell}>Total Sales</th>
            </tr>
          </thead>
          <tbody>
            {paginatedRows.map((row, index) => (
              <tr key={row.id || `${row.meterNo}-${index}`}>
                <td style={styles.bodyCell}>{row.rowNo || pageStartIndex + index + 1}</td>
                <td style={{ ...styles.bodyCell, ...styles.meterCell }}>
                  {row.meterNo || "NAv"}
                </td>
                <td style={{ ...styles.bodyCell, ...styles.addressCell }}>
                  {row.addressLine1 || "NAv"}
                </td>
                <td style={styles.bodyCell}>{row.town || "NAv"}</td>
                <td style={{ ...styles.bodyCell, ...styles.sgCell }}>
                  {row.standNumber || "NAv"}
                </td>
                <td style={{ ...styles.bodyCell, ...styles.reasonCell }}>
                  {row.actionReason || "NAv"}
                </td>
                <td style={styles.bodyCell}>{row.astMatchStatus || "NOT_CHECKED"}</td>
                <td style={styles.bodyCell}>{row.proposedTrnType || "NAv"}</td>
                <td style={{ ...styles.bodyCell, ...styles.moneyCell }}>
                  {row.totalSalesC === null || row.totalSalesC === undefined
                    ? "NAv"
                    : formatCurrencyFromCents(row.totalSalesC)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PaginationControls
        currentPage={safeCurrentPage}
        pageSize={pageSize}
        totalPages={totalPages}
        totalRows={totalRows}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
      />

      <div style={styles.confirmPanel}>
        <div>
          <strong>
            {readyForBackend
              ? "Draft confirmed and ready for backend integration"
              : "Review the meters before confirming the draft"}
          </strong>
          <p>
            This frontend release prepares and confirms the targeted batch in
            Redux only. It does not write a targeted-batch document or create
            TRNs in Firestore.
          </p>
        </div>

        {readyForBackend ? (
          <button type="button" style={styles.secondaryButton} onClick={onReopen}>
            Reopen Draft
          </button>
        ) : (
          <button type="button" style={styles.primaryButton} onClick={onConfirm}>
            Confirm Draft
          </button>
        )}
      </div>
    </section>
  );
}

const styles = {
  panel: {
    background: "#ffffff",
    border: "1px solid rgba(148, 163, 184, 0.28)",
    borderRadius: "1rem",
    boxShadow: "0 14px 30px rgba(15, 23, 42, 0.06)",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "1rem",
    padding: "1rem",
    flexWrap: "wrap",
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: "0.72rem",
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  title: {
    margin: "0.25rem 0 0",
    color: "#0f172a",
  },
  subtitle: {
    margin: "0.35rem 0 0",
    color: "#64748b",
  },
  sourceBadge: {
    borderRadius: "999px",
    padding: "0.18rem 0.5rem",
    fontSize: "0.68rem",
    fontWeight: 900,
    textTransform: "uppercase",
  },
  salesBadge: {
    background: "#dbeafe",
    color: "#1d4ed8",
  },
  uploadBadge: {
    background: "#fef3c7",
    color: "#92400e",
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  statusBadge: {
    borderRadius: "999px",
    padding: "0.42rem 0.65rem",
    fontSize: "0.72rem",
    fontWeight: 900,
    textTransform: "uppercase",
  },
  draftStatus: {
    background: "#f1f5f9",
    color: "#475569",
  },
  readyStatus: {
    background: "#dcfce7",
    color: "#166534",
  },
  metadataGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "0.65rem",
    padding: "0 1rem 1rem",
  },
  metadataCard: {
    display: "flex",
    flexDirection: "column",
    gap: "0.3rem",
    padding: "0.8rem",
    border: "1px solid #e2e8f0",
    borderRadius: "0.75rem",
    background: "#f8fafc",
    color: "#64748b",
  },
  metadataReason: {
    color: "#0f172a",
    fontSize: "0.86rem",
  },
  sourceNotice: {
    margin: "0 1rem 1rem",
    padding: "0.85rem",
    border: "1px solid #bfdbfe",
    borderRadius: "0.75rem",
    background: "#eff6ff",
    color: "#1e3a8a",
  },
  tableWrap: {
    width: "100%",
    overflow: "auto",
    borderTop: "1px solid #e2e8f0",
    borderBottom: "1px solid #e2e8f0",
  },
  table: {
    width: "100%",
    minWidth: "1450px",
    borderCollapse: "separate",
    borderSpacing: 0,
    fontSize: "0.82rem",
  },
  headerCell: {
    position: "sticky",
    top: 0,
    zIndex: 2,
    padding: "0.7rem",
    borderRight: "1px solid #cbd5e1",
    borderBottom: "1px solid #cbd5e1",
    background: "#e2e8f0",
    color: "#0f172a",
    textAlign: "left",
  },
  bodyCell: {
    padding: "0.7rem",
    borderRight: "1px solid #e2e8f0",
    borderBottom: "1px solid #e2e8f0",
    background: "#ffffff",
    color: "#334155",
    verticalAlign: "top",
  },
  meterCell: {
    fontWeight: 850,
    color: "#0f172a",
    whiteSpace: "nowrap",
  },
  addressCell: {
    minWidth: "220px",
  },
  sgCell: {
    minWidth: "220px",
  },
  reasonCell: {
    minWidth: "220px",
  },
  moneyCell: {
    textAlign: "right",
    whiteSpace: "nowrap",
  },
  confirmPanel: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "1rem",
    padding: "1rem",
    background: "#f8fafc",
    flexWrap: "wrap",
  },
  primaryButton: {
    border: "1px solid #1d4ed8",
    borderRadius: "0.7rem",
    padding: "0.55rem 0.8rem",
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 850,
    cursor: "pointer",
  },
  secondaryButton: {
    border: "1px solid #cbd5e1",
    borderRadius: "0.7rem",
    padding: "0.55rem 0.8rem",
    background: "#ffffff",
    color: "#334155",
    fontWeight: 850,
    cursor: "pointer",
  },
  dangerButton: {
    border: "1px solid #fecaca",
    borderRadius: "0.7rem",
    padding: "0.55rem 0.8rem",
    background: "#fff1f2",
    color: "#b91c1c",
    fontWeight: 850,
    cursor: "pointer",
  },
  paginationBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "1rem",
    padding: "0.75rem 0.9rem",
    flexWrap: "wrap",
  },
  paginationSummary: {
    color: "#64748b",
    fontSize: "0.82rem",
  },
  paginationControls: {
    display: "flex",
    alignItems: "center",
    gap: "0.45rem",
    flexWrap: "wrap",
  },
  pageSizeLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    color: "#64748b",
    fontSize: "0.82rem",
    fontWeight: 700,
  },
  pageSizeSelect: {
    border: "1px solid rgba(148, 163, 184, 0.45)",
    borderRadius: "0.55rem",
    padding: "0.34rem 0.45rem",
    fontSize: "0.82rem",
  },
  paginationButton: {
    border: "1px solid rgba(148, 163, 184, 0.42)",
    background: "#fff",
    color: "#0f172a",
    borderRadius: "0.6rem",
    padding: "0.36rem 0.58rem",
    fontWeight: 800,
    cursor: "pointer",
  },
  pageCountLabel: {
    color: "#334155",
    fontSize: "0.82rem",
    fontWeight: 800,
    padding: "0 0.2rem",
  },
};
