/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import {
  formatCurrencyFromCents,
  formatNumber,
} from "../targetedBatchUtils";
import { draftReviewStyles as styles } from "./targetedBatchDraftReviewStyles";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

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

export default function TargetedBatchDraftTable({
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
      <PaginationControls
        currentPage={currentPage}
        pageSize={pageSize}
        totalPages={totalPages}
        totalRows={totalRows}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.headerCell}>Row</th>
              <th style={styles.headerCell}>Sales All Meter ID</th>
              <th style={styles.headerCell}>Meter Number</th>
              <th style={styles.headerCell}>Account Number</th>
              <th style={styles.headerCell}>Customer</th>
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
            {rows.length === 0 ? (
              <tr>
                <td colSpan={12} style={styles.noRowsCell}>
                  No draft rows match the current filters.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr
                  key={
                    row.salesAllMeterId ||
                    row.sourceSalesAllMeterId ||
                    row.id ||
                    `${row.meterNo}-${index}`
                  }
                >
                  <td style={styles.bodyCell}>{row.rowNo || index + 1}</td>
                  <td style={{ ...styles.bodyCell, ...styles.idCell }}>
                    {row.salesAllMeterId || row.sourceSalesAllMeterId || "NAv"}
                  </td>
                  <td style={{ ...styles.bodyCell, ...styles.meterCell }}>
                    {row.meterNo || "NAv"}
                  </td>
                  <td style={styles.bodyCell}>{row.accountNumber || "NAv"}</td>
                  <td style={styles.bodyCell}>{row.customerName || "NAv"}</td>
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
                  <td style={styles.bodyCell}>
                    {row.astMatchStatus || "NOT_CHECKED"}
                  </td>
                  <td style={styles.bodyCell}>{row.proposedTrnType || "NAv"}</td>
                  <td style={{ ...styles.bodyCell, ...styles.moneyCell }}>
                    {row.totalSalesC === null || row.totalSalesC === undefined
                      ? "NAv"
                      : formatCurrencyFromCents(row.totalSalesC)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PaginationControls
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
