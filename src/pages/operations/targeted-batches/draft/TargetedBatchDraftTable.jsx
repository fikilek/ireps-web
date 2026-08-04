/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { Fragment } from "react";

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

function RowDecisionBadge({ decision }) {
  const normalized = String(decision || "").toUpperCase();

  if (!normalized) return "NAv";

  return (
    <span
      style={{
        ...styles.rowDecisionBadge,
        ...(normalized === "ACCEPT"
          ? styles.rowAcceptBadge
          : styles.rowRejectBadge),
      }}
    >
      {normalized}
    </span>
  );
}

function getBatchLabel(row = {}) {
  return row?.wardName ||
    row?.wardNumberLabel ||
    (row?.wardNumber ? `Ward ${row.wardNumber}` : "Ward NAv");
}

export default function TargetedBatchDraftTable({
  rows,
  totalRows,
  currentPage,
  pageSize,
  totalPages,
  showRowDecision,
  showBatchGrouping = false,
  onPageChange,
  onPageSizeChange,
}) {
  const baseColumnCount = showBatchGrouping ? 16 : 12;
  const columnCount = showRowDecision ? baseColumnCount + 2 : baseColumnCount;

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
        <table
          style={{
            ...styles.table,
            minWidth: showRowDecision
              ? "2380px"
              : showBatchGrouping
                ? "2700px"
                : styles.table.minWidth,
          }}
        >
          <thead>
            <tr>
              <th style={styles.headerCell}>Row</th>
              {showBatchGrouping ? (
                <>
                  <th style={styles.headerCell}>Proposed Batch</th>
                  <th style={styles.headerCell}>Ward</th>
                  <th style={styles.headerCell}>Ward PCode</th>
                  <th style={styles.headerCell}>ERF No</th>
                </>
              ) : null}
              {showRowDecision ? (
                <>
                  <th style={styles.headerCell}>Row Outcome</th>
                  <th style={styles.headerCell}>Rejection Reason</th>
                </>
              ) : null}
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
                <td colSpan={columnCount} style={styles.noRowsCell}>
                  No draft rows match the current filters.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const previousRow = rows[index - 1];
                const showGroupHeader =
                  showBatchGrouping &&
                  (!previousRow ||
                    previousRow?.draftBatchKey !== row?.draftBatchKey);

                return (
                  <Fragment
                    key={
                      row.salesAllMeterId ||
                      row.sourceSalesAllMeterId ||
                      row.id ||
                      `${row.meterNo}-${index}`
                    }
                  >
                    {showGroupHeader ? (
                      <tr>
                        <td colSpan={columnCount} style={styles.batchGroupRow}>
                          <div style={styles.batchGroupContent}>
                            <div>
                              <strong style={styles.batchGroupTitle}>
                                Proposed Batch {row?.batchSequence || "NAv"} ·{" "}
                                {getBatchLabel(row)}
                              </strong>
                              <span style={styles.batchGroupMeta}>
                                {row?.wardPcode || "NAv"} · One ward only
                              </span>
                            </div>
                            <code style={styles.batchGroupId}>
                              {row?.proposedTbId || "NAv"}
                            </code>
                          </div>
                        </td>
                      </tr>
                    ) : null}

                    <tr>
                      <td style={styles.bodyCell}>
                        {row.batchRowNo || row.rowNo || index + 1}
                      </td>
                      {showBatchGrouping ? (
                        <>
                          <td style={{ ...styles.bodyCell, ...styles.idCell }}>
                            {row.proposedTbId || "NAv"}
                          </td>
                          <td style={styles.bodyCell}>{getBatchLabel(row)}</td>
                          <td style={{ ...styles.bodyCell, ...styles.idCell }}>
                            {row.wardPcode || "NAv"}
                          </td>
                          <td style={styles.bodyCell}>{row.erfNo || "NAv"}</td>
                        </>
                      ) : null}
                      {showRowDecision ? (
                        <>
                          <td style={styles.bodyCell}>
                            <RowDecisionBadge decision={row.rowDecision} />
                          </td>
                          <td
                            style={{
                              ...styles.bodyCell,
                              ...styles.rejectionCell,
                            }}
                          >
                            {row.rowDecision === "REJECT"
                              ? row.rowDecisionReason || "Reason missing"
                              : "—"}
                          </td>
                        </>
                      ) : null}
                      <td style={{ ...styles.bodyCell, ...styles.idCell }}>
                        {row.salesAllMeterId ||
                          row.sourceSalesAllMeterId ||
                          "NAv"}
                      </td>
                      <td style={{ ...styles.bodyCell, ...styles.meterCell }}>
                        {row.meterNo || "NAv"}
                      </td>
                      <td style={styles.bodyCell}>
                        {row.accountNumber || "NAv"}
                      </td>
                      <td style={styles.bodyCell}>
                        {row.customerName || "NAv"}
                      </td>
                      <td style={{ ...styles.bodyCell, ...styles.addressCell }}>
                        {row.addressLine1 || "NAv"}
                      </td>
                      <td style={styles.bodyCell}>{row.town || "NAv"}</td>
                      <td style={{ ...styles.bodyCell, ...styles.sgCell }}>
                        {row.sgCode || "NAv"}
                      </td>
                      <td style={{ ...styles.bodyCell, ...styles.reasonCell }}>
                        {row.actionReason || "NAv"}
                      </td>
                      <td style={styles.bodyCell}>
                        {row.astMatchStatus || "NOT_CHECKED"}
                      </td>
                      <td style={styles.bodyCell}>
                        {row.proposedTrnType || "NAv"}
                      </td>
                      <td style={{ ...styles.bodyCell, ...styles.moneyCell }}>
                        {row.totalSalesC === null ||
                        row.totalSalesC === undefined
                          ? "NAv"
                          : formatCurrencyFromCents(row.totalSalesC)}
                      </td>
                    </tr>
                  </Fragment>
                );
              })
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
