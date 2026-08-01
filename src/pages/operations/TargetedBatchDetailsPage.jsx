/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSelector } from "react-redux";

import {
  formatCurrencyFromCents,
  formatDateTime,
  formatNumber,
} from "./targeted-batches/targetedBatchUtils";

const QUICK_FILTERS = [
  { key: "ALL", label: "All Rows" },
  { key: "MATCHED", label: "AST Matched" },
  { key: "NOT_MATCHED", label: "AST Not Matched" },
  { key: "NOT_CHECKED", label: "AST Not Checked" },
];

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

function normalizeValue(value) {
  return String(value || "").trim().toUpperCase();
}

function getMatchStatus(row) {
  return normalizeValue(row?.astMatchStatus || "NOT_CHECKED") || "NOT_CHECKED";
}

function applyQuickFilter(rows, activeFilter) {
  if (activeFilter === "ALL") return rows;
  return rows.filter((row) => getMatchStatus(row) === activeFilter);
}

function buildSummary(rows) {
  return rows.reduce(
    (summary, row) => {
      const status = getMatchStatus(row);
      if (status === "MATCHED") summary.matched += 1;
      else if (status === "NOT_MATCHED") summary.notMatched += 1;
      else summary.notChecked += 1;
      summary.totalSalesC += Number(row?.totalSalesC || 0);
      return summary;
    },
    {
      total: rows.length,
      matched: 0,
      notMatched: 0,
      notChecked: 0,
      totalSalesC: 0,
    },
  );
}

function getPageBounds({ pageIndex, pageSize, totalRows }) {
  if (totalRows === 0) {
    return {
      pageCount: 1,
      safePageIndex: 0,
      startIndex: 0,
      endIndex: 0,
      displayStart: 0,
      displayEnd: 0,
    };
  }

  const pageCount = Math.max(Math.ceil(totalRows / pageSize), 1);
  const safePageIndex = Math.min(Math.max(pageIndex, 0), pageCount - 1);
  const startIndex = safePageIndex * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalRows);

  return {
    pageCount,
    safePageIndex,
    startIndex,
    endIndex,
    displayStart: startIndex + 1,
    displayEnd: endIndex,
  };
}

function SummaryCard({ label, value, detail }) {
  return (
    <article style={styles.summaryCard}>
      <span style={styles.summaryLabel}>{label}</span>
      <strong style={styles.summaryValue}>{value}</strong>
      {detail ? <span style={styles.summaryDetail}>{detail}</span> : null}
    </article>
  );
}

function Th({ children }) {
  return <th style={styles.th}>{children}</th>;
}

function Td({ children, colSpan, strong }) {
  return (
    <td
      colSpan={colSpan}
      style={{
        ...styles.td,
        ...(strong ? styles.strongCell : null),
      }}
    >
      {children}
    </td>
  );
}

function Badge({ children, tone = "neutral" }) {
  const toneStyle = {
    success: styles.successBadge,
    warning: styles.warningBadge,
    neutral: styles.neutralBadge,
  }[tone];

  return <span style={{ ...styles.badge, ...toneStyle }}>{children}</span>;
}

export default function TargetedBatchDetailsPage() {
  const { tbId } = useParams();
  const draft = useSelector((state) => state.targetedBatchDraft?.draft || null);

  const [activeFilter, setActiveFilter] = useState("ALL");
  const [meterSearch, setMeterSearch] = useState("");
  const [townSearch, setTownSearch] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [pageIndex, setPageIndex] = useState(0);

  const decodedTbId = decodeURIComponent(tbId || "");
  const draftMatchesRoute = draft?.id === decodedTbId;
  const rows = useMemo(
    () => (draftMatchesRoute && Array.isArray(draft?.rows) ? draft.rows : []),
    [draft, draftMatchesRoute],
  );

  const summary = useMemo(() => buildSummary(rows), [rows]);

  const filteredRows = useMemo(() => {
    const quickFilteredRows = applyQuickFilter(rows, activeFilter);
    const normalizedMeterSearch = normalizeValue(meterSearch);
    const normalizedTownSearch = normalizeValue(townSearch);

    return quickFilteredRows.filter((row) => {
      if (
        normalizedMeterSearch &&
        !normalizeValue(row?.meterNo).includes(normalizedMeterSearch)
      ) {
        return false;
      }

      if (
        normalizedTownSearch &&
        !normalizeValue(row?.town).includes(normalizedTownSearch)
      ) {
        return false;
      }

      return true;
    });
  }, [rows, activeFilter, meterSearch, townSearch]);

  const pageBounds = getPageBounds({
    pageIndex,
    pageSize,
    totalRows: filteredRows.length,
  });

  const pagedRows = filteredRows.slice(
    pageBounds.startIndex,
    pageBounds.endIndex,
  );

  function selectQuickFilter(nextFilter) {
    setActiveFilter(nextFilter);
    setPageIndex(0);
  }

  function updatePageSize(value) {
    setPageSize(Number(value));
    setPageIndex(0);
  }

  if (!draftMatchesRoute) {
    return (
      <section style={styles.page}>
        <div style={styles.topActionRow}>
          <Link to="/operations/targeted-batches" style={styles.backLink}>
            ← Back to TB Uploads
          </Link>
        </div>

        <div style={styles.errorNotice}>
          <strong>TB upload not available</strong>
          <p style={styles.noticeText}>
            The requested TB ID is not present in the current Redux draft. The
            frontend stage does not yet reload permanent TB data after a browser
            refresh.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section style={styles.page}>
      <div style={styles.topActionRow}>
        <Link to="/operations/targeted-batches" style={styles.backLink}>
          ← Back to TB Uploads
        </Link>

        <Link
          to={`/operations/targeted-batches/${encodeURIComponent(draft.id)}/dashboard`}
          style={styles.headerActionLink}
        >
          TB Dashboard
        </Link>

        <Link
          to={`/operations/targeted-batches/${encodeURIComponent(draft.id)}/final-report`}
          style={styles.headerActionLink}
        >
          Final Report
        </Link>

        <Link
          to={`/operations/targeted-batches/${encodeURIComponent(draft.id)}/allocation`}
          style={styles.allocationActionLink}
          title="Allocate accepted Targeted Batch work to a TEAM or Service Provider."
        >
          Targeted Batch Allocation
        </Link>
      </div>

      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Operations / TB Upload Details</p>
          <h2 style={styles.title}>{draft.id}</h2>
          <p style={styles.subtitle}>
            Review all meter rows received in this Targeted Batch frontend
            draft.
          </p>
        </div>

        <Badge tone={draft.status === "READY_FOR_BACKEND" ? "success" : "warning"}>
          {draft.status || "DRAFT"}
        </Badge>
      </div>

      <div style={styles.infoPanel}>
        <div style={styles.infoGrid}>
          <InfoItem label="Source" value={draft.sourceLabel || draft.sourceType} />
          <InfoItem label="LM" value={`${draft.lmPcode || "NAv"} · ${draft.lmName || "NAv"}`} />
          <InfoItem label="Created" value={formatDateTime(draft.createdAt)} />
          <InfoItem label="File" value={draft.fileName || "Prepaid Sales selection"} />
          <InfoItem label="Sales Period From" value={draft.salesPeriodFrom || "NAv"} />
          <InfoItem label="Sales Period To" value={draft.salesPeriodTo || "NAv"} />
          <InfoItem label="Selection Reason" value={draft.selectionReason || "NAv"} />
          <InfoItem
            label="Frontend Validation"
            value={draft.validation?.passed === false ? "FAILED" : "PASSED / NAv"}
          />
        </div>
      </div>

      <div style={styles.summaryGrid}>
        <SummaryCard label="Total Rows" value={formatNumber(summary.total)} />
        <SummaryCard label="AST Matched" value={formatNumber(summary.matched)} />
        <SummaryCard label="AST Not Matched" value={formatNumber(summary.notMatched)} />
        <SummaryCard label="AST Not Checked" value={formatNumber(summary.notChecked)} />
        <SummaryCard
          label="Selected Sales Value"
          value={formatCurrencyFromCents(summary.totalSalesC)}
        />
      </div>

      <div style={styles.stickyPanel}>
        <div style={styles.panelHeader}>
          <div>
            <h3 style={styles.panelTitle}>TB Rows</h3>
            <p style={styles.panelSubtitle}>
              Current row-level values received from the TB CSV file or
              Prepaid Sales selection. Backend row outcomes are not created yet.
            </p>
          </div>

          <div style={styles.rowCountBadge}>
            Showing {pageBounds.displayStart}–{pageBounds.displayEnd} of{" "}
            {filteredRows.length} filtered rows
          </div>
        </div>

        <div style={styles.filterRow}>
          {QUICK_FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              style={{
                ...styles.filterButton,
                ...(activeFilter === filter.key
                  ? styles.filterButtonActive
                  : null),
              }}
              onClick={() => selectQuickFilter(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div style={styles.columnFilterRow}>
          <input
            type="search"
            value={meterSearch}
            onChange={(event) => {
              setMeterSearch(event.target.value);
              setPageIndex(0);
            }}
            placeholder="Search Meter No"
            style={styles.filterInput}
          />
          <input
            type="search"
            value={townSearch}
            onChange={(event) => {
              setTownSearch(event.target.value);
              setPageIndex(0);
            }}
            placeholder="Search Town"
            style={styles.filterInput}
          />
        </div>

        {filteredRows.length === 0 ? (
          <div style={styles.notice}>No TB rows match this filter.</div>
        ) : (
          <>
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <Th>Row No</Th>
                    <Th>Meter No</Th>
                    <Th>Address</Th>
                    <Th>Town</Th>
                    <Th>SG Code</Th>
                    <Th>Selection Reason</Th>
                    <Th>AST Match</Th>
                    <Th>Proposed TRN</Th>
                    <Th>Total Sales</Th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((row, index) => (
                    <tr key={row.id || `${row.meterNo}-${pageBounds.startIndex + index}`}>
                      <Td>{row.rowNo || pageBounds.startIndex + index + 1}</Td>
                      <Td strong>{row.meterNo || "NAv"}</Td>
                      <Td>{row.addressLine1 || "NAv"}</Td>
                      <Td>{row.town || "NAv"}</Td>
                      <Td>{row.standNumber || "NAv"}</Td>
                      <Td>{row.actionReason || "NAv"}</Td>
                      <Td>{row.astMatchStatus || "NOT_CHECKED"}</Td>
                      <Td>{row.proposedTrnType || "NAv"}</Td>
                      <Td>
                        {row.totalSalesC === null || row.totalSalesC === undefined
                          ? "NAv"
                          : formatCurrencyFromCents(row.totalSalesC)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={styles.paginationBar}>
              <div style={styles.paginationSummary}>
                Showing {pageBounds.displayStart}–{pageBounds.displayEnd} of{" "}
                {filteredRows.length} rows
              </div>

              <div style={styles.paginationControls}>
                <label style={styles.pageSizeLabel}>
                  Rows per page
                  <select
                    value={pageSize}
                    onChange={(event) => updatePageSize(event.target.value)}
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
                  onClick={() => setPageIndex(0)}
                  disabled={pageBounds.safePageIndex <= 0}
                >
                  First
                </button>
                <button
                  type="button"
                  style={styles.paginationButton}
                  onClick={() => setPageIndex((current) => Math.max(current - 1, 0))}
                  disabled={pageBounds.safePageIndex <= 0}
                >
                  Previous
                </button>
                <span style={styles.pageCountLabel}>
                  Page {pageBounds.safePageIndex + 1} of {pageBounds.pageCount}
                </span>
                <button
                  type="button"
                  style={styles.paginationButton}
                  onClick={() =>
                    setPageIndex((current) =>
                      Math.min(current + 1, pageBounds.pageCount - 1),
                    )
                  }
                  disabled={pageBounds.safePageIndex >= pageBounds.pageCount - 1}
                >
                  Next
                </button>
                <button
                  type="button"
                  style={styles.paginationButton}
                  onClick={() => setPageIndex(pageBounds.pageCount - 1)}
                  disabled={pageBounds.safePageIndex >= pageBounds.pageCount - 1}
                >
                  Last
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function InfoItem({ label, value }) {
  return (
    <div style={styles.infoItem}>
      <span style={styles.infoLabel}>{label}</span>
      <strong style={styles.infoValue}>{value || "NAv"}</strong>
    </div>
  );
}

const styles = {
  page: {
    padding: 24,
  },
  topActionRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 12,
    marginBottom: 16,
    flexWrap: "wrap",
  },
  backLink: {
    color: "#1d4ed8",
    fontWeight: 900,
    textDecoration: "none",
  },
  headerActionLink: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #bfdbfe",
    borderRadius: 14,
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "10px 14px",
    fontWeight: 900,
    textDecoration: "none",
  },
  allocationActionLink: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #86efac",
    borderRadius: 14,
    background: "#dcfce7",
    color: "#166534",
    padding: "10px 14px",
    fontWeight: 900,
    textDecoration: "none",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 18,
    flexWrap: "wrap",
  },
  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  title: {
    margin: "8px 0 6px",
    fontSize: 30,
    color: "#0f172a",
  },
  subtitle: {
    margin: 0,
    color: "#64748b",
    lineHeight: 1.5,
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    padding: "7px 10px",
    fontSize: 11,
    fontWeight: 900,
  },
  successBadge: {
    background: "#dcfce7",
    color: "#166534",
  },
  warningBadge: {
    background: "#fef3c7",
    color: "#92400e",
  },
  neutralBadge: {
    background: "#f1f5f9",
    color: "#475569",
  },
  infoPanel: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 24,
    padding: 18,
    marginBottom: 16,
  },
  infoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: 12,
  },
  infoItem: {
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    background: "#f8fafc",
    padding: 12,
  },
  infoLabel: {
    display: "block",
    color: "#64748b",
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 5,
  },
  infoValue: {
    display: "block",
    color: "#0f172a",
    fontSize: 13,
    lineHeight: 1.4,
    wordBreak: "break-word",
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 12,
    marginBottom: 16,
  },
  summaryCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 16,
  },
  summaryLabel: {
    display: "block",
    fontSize: 12,
    fontWeight: 800,
    color: "#64748b",
    marginBottom: 8,
  },
  summaryValue: {
    fontSize: 23,
    color: "#0f172a",
  },
  summaryDetail: {
    display: "block",
    marginTop: 7,
    color: "#64748b",
    fontSize: 11,
  },
  stickyPanel: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 24,
    padding: 18,
  },
  panelHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14,
    flexWrap: "wrap",
  },
  panelTitle: {
    margin: 0,
    fontSize: 18,
    color: "#0f172a",
  },
  panelSubtitle: {
    margin: "6px 0 0",
    color: "#64748b",
    fontSize: 13,
  },
  rowCountBadge: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    padding: "7px 10px",
    background: "#f1f5f9",
    color: "#475569",
    fontSize: 11,
    fontWeight: 900,
  },
  filterRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  filterButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 999,
    background: "#ffffff",
    color: "#475569",
    padding: "7px 10px",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
  },
  filterButtonActive: {
    borderColor: "#2563eb",
    background: "#eff6ff",
    color: "#1d4ed8",
  },
  columnFilterRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 14,
  },
  filterInput: {
    border: "1px solid #cbd5e1",
    borderRadius: 12,
    padding: "10px 12px",
    minWidth: 190,
    background: "#ffffff",
  },
  notice: {
    padding: 16,
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    background: "#f8fafc",
    color: "#475569",
  },
  errorNotice: {
    padding: 18,
    border: "1px solid #fecaca",
    borderRadius: 18,
    background: "#fef2f2",
    color: "#991b1b",
  },
  noticeText: {
    margin: "8px 0 0",
    lineHeight: 1.5,
  },
  tableWrap: {
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: 1280,
  },
  th: {
    textAlign: "left",
    fontSize: 11,
    color: "#475569",
    background: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
    padding: "12px 10px",
    whiteSpace: "nowrap",
  },
  td: {
    fontSize: 12,
    color: "#334155",
    borderBottom: "1px solid #f1f5f9",
    padding: "12px 10px",
    verticalAlign: "top",
  },
  strongCell: {
    color: "#0f172a",
    fontWeight: 900,
  },
  paginationBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    paddingTop: 14,
    flexWrap: "wrap",
  },
  paginationSummary: {
    color: "#64748b",
    fontSize: 12,
  },
  paginationControls: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    flexWrap: "wrap",
  },
  pageSizeLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    color: "#64748b",
    fontSize: 12,
    fontWeight: 800,
  },
  pageSizeSelect: {
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    background: "#ffffff",
    padding: "7px 9px",
  },
  paginationButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    background: "#ffffff",
    color: "#334155",
    padding: "7px 9px",
    fontSize: 12,
    fontWeight: 800,
    cursor: "pointer",
  },
  pageCountLabel: {
    color: "#475569",
    fontSize: 12,
    fontWeight: 800,
  },
};
