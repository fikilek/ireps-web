/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { formatCurrencyFromCents, formatNumber } from "../targetedBatchUtils";
import { tbRowsStyles as styles } from "./targetedBatchRowsStyles";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

function getStatusTone(value) {
  const normalized = String(value || "").toUpperCase();

  if (["ACCEPT", "ACCEPTED", "COMPLETED", "PASSED", "ALLOCATED", "CREATED", "LINKED"].includes(normalized)) {
    return { background: "#dcfce7", color: "#166534" };
  }

  if (["REJECT", "REJECTED", "FAILED", "CANCELLED"].includes(normalized)) {
    return { background: "#fee2e2", color: "#991b1b" };
  }

  if (["NOT_APPLICABLE", "N/A"].includes(normalized)) {
    return { background: "#e2e8f0", color: "#475569" };
  }

  return { background: "#fef3c7", color: "#92400e" };
}

function StatusBadge({ value }) {
  return (
    <span style={{ ...styles.statusBadge, ...getStatusTone(value) }}>
      {value || "NAv"}
    </span>
  );
}

function Pagination({
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
        Showing {formatNumber(startRow)}–{formatNumber(endRow)} of{" "}
        {formatNumber(totalRows)} filtered rows
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
          Page {currentPage} of {totalPages}
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

function ReferenceStack({ row }) {
  const references = [
    ["TB Row", row.tbRowId || "PENDING_BACKEND"],
    ["Source", row.sourceReference],
    ["AST", row.astId || "NAv"],
    ["Premise", row.premiseId || "NAv"],
    ["MD TRN", row.meterDiscoveryTrnId || "NAv"],
  ];

  return (
    <div style={styles.referenceStack}>
      {references.map(([label, value]) => (
        <div key={label} style={styles.referenceLine}>
          <strong>{label}:</strong> {value}
        </div>
      ))}
    </div>
  );
}

export default function TargetedBatchRowsTable({
  rows,
  totalRows,
  currentPage,
  pageSize,
  totalPages,
  onPageChange,
  onPageSizeChange,
}) {
  return (
    <>
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Row</th>
              <th style={styles.th}>Outcome</th>
              <th style={styles.th}>Rejection Reason</th>
              <th style={styles.th}>Meter No</th>
              <th style={styles.th}>Account</th>
              <th style={styles.th}>Customer</th>
              <th style={styles.th}>Address</th>
              <th style={styles.th}>Town</th>
              <th style={styles.th}>SG Code</th>
              <th style={styles.th}>AST Match</th>
              <th style={styles.th}>Proposed TRN</th>
              <th style={styles.th}>Allocation</th>
              <th style={styles.th}>Field Acceptance</th>
              <th style={styles.th}>Premise</th>
              <th style={styles.th}>Meter Discovery</th>
              <th style={styles.th}>Completion</th>
              <th style={styles.th}>Exact References</th>
              <th style={styles.th}>Total Sales</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={18} style={styles.td}>
                  No TB rows match the current filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.rowKey}>
                  <td style={styles.td}>{row.rowNo}</td>
                  <td style={styles.td}><StatusBadge value={row.outcome} /></td>
                  <td style={styles.td}>{row.rejectionReason || "—"}</td>
                  <td style={{ ...styles.td, ...styles.strongCell }}>{row.meterNo || "NAv"}</td>
                  <td style={styles.td}>{row.accountNumber || "NAv"}</td>
                  <td style={styles.td}>{row.customerName || "NAv"}</td>
                  <td style={styles.td}>{row.address || "NAv"}</td>
                  <td style={styles.td}>{row.town || "NAv"}</td>
                  <td style={styles.td}>{row.sgCode || "NAv"}</td>
                  <td style={styles.td}><StatusBadge value={row.astMatchStatus} /></td>
                  <td style={styles.td}>{row.proposedTrnType}</td>
                  <td style={styles.td}>
                    <StatusBadge value={row.allocationStatus} />
                    {row.allocationTarget ? (
                      <div style={styles.referenceLine}>{row.allocationTarget.label}</div>
                    ) : null}
                  </td>
                  <td style={styles.td}><StatusBadge value={row.fieldAcceptanceStatus} /></td>
                  <td style={styles.td}><StatusBadge value={row.premiseStatus} /></td>
                  <td style={styles.td}><StatusBadge value={row.meterDiscoveryStatus} /></td>
                  <td style={styles.td}><StatusBadge value={row.completionStatus} /></td>
                  <td style={styles.td}><ReferenceStack row={row} /></td>
                  <td style={styles.td}>
                    {row.totalSalesC === null
                      ? "NAv"
                      : formatCurrencyFromCents(row.totalSalesC)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        currentPage={currentPage}
        pageSize={pageSize}
        totalPages={totalPages}
        totalRows={totalRows}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </>
  );
}
