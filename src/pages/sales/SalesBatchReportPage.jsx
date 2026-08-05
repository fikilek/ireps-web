/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useGetTargetedBatchReportByIdQuery } from "../../redux/salesTargetedBatchApi";

const ALL_FILTER = "ALL";
const TERMINAL_STREAM_STATES = new Set(["ready", "error"]);

const EMPTY_REPORT = {
  batch: null,
  rows: [],
  summary: {
    total: 0,
    notStarted: 0,
    inProgress: 0,
    completed: 0,
    metersDiscovered: 0,
    noAccessAttempts: 0,
  },
  sync: {
    status: "idle",
    sources: {
      batch: "idle",
      rows: "idle",
      sales: "idle",
      premises: "idle",
      trns: "idle",
    },
    error: null,
  },
};

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeUpper(value) {
  return cleanText(value).toUpperCase();
}

function formatDateTime(value) {
  const millis = Number(value || 0);
  return Number.isFinite(millis) && millis > 0
    ? new Date(millis).toLocaleString()
    : "NAv";
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function uniqueNonBlank(values = []) {
  return Array.from(
    new Set(values.map(cleanText).filter(Boolean)),
  ).sort((left, right) =>
    left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

function statusTone(status = "") {
  switch (normalizeUpper(status)) {
    case "TRUE":
    case "COMPLETED":
    case "LINKED":
    case "ACCEPTED":
      return "success";
    case "FALSE":
    case "FAILED":
    case "REJECTED":
      return "danger";
    case "IN_PROGRESS":
      return "warning";
    default:
      return "neutral";
  }
}

function Badge({ value }) {
  const tone = statusTone(value);

  return (
    <span
      style={{
        ...styles.badge,
        ...(tone === "success" ? styles.badgeSuccess : null),
        ...(tone === "warning" ? styles.badgeWarning : null),
        ...(tone === "danger" ? styles.badgeDanger : null),
      }}
    >
      {cleanText(value).replaceAll("_", " ") || "NAv"}
    </span>
  );
}

function SummaryCard({ label, value, helper }) {
  return (
    <article style={styles.summaryCard}>
      <span style={styles.summaryLabel}>{label}</span>
      <strong style={styles.summaryValue}>{formatNumber(value)}</strong>
      <span style={styles.summaryHelper}>{helper}</span>
    </article>
  );
}

function Th({ children }) {
  return <th style={styles.th}>{children}</th>;
}

function Td({ children, colSpan }) {
  return (
    <td style={styles.td} colSpan={colSpan}>
      {children}
    </td>
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

function ModalShell({ title, subtitle, onClose, children, wide = false }) {
  return (
    <div
      style={styles.modalBackdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        style={{
          ...styles.modalCard,
          ...(wide ? styles.modalCardWide : null),
        }}
        role="dialog"
        aria-modal="true"
      >
        <div style={styles.modalHeader}>
          <div>
            <p style={styles.modalEyebrow}>{subtitle}</p>
            <h2 style={styles.modalTitle}>{title}</h2>
          </div>

          <button type="button" style={styles.closeButton} onClick={onClose}>
            ×
          </button>
        </div>

        <div style={styles.modalBody}>{children}</div>
      </div>
    </div>
  );
}

function formatAttemptGps(attempt = {}) {
  const lat = Number(attempt?.point?.lat);
  const lng = Number(attempt?.point?.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "NAv";
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function NoAccessModal({ row, onClose }) {
  const attempts = row?.noAccess?.attempts || [];
  const noAccessCount = Number(row?.noAccess?.count || 0);

  return (
    <ModalShell
      title={`No Access Details — ${formatNumber(noAccessCount)}`}
      subtitle={`Row ${row.rowNo || "NAv"} • ${row.originalMeter.number}`}
      onClose={onClose}
      wide
    >
      {noAccessCount === 0 ? (
        <div style={styles.emptyModalState}>
          No No Access attempts are recorded for this row.
        </div>
      ) : null}

      {noAccessCount > 0 && attempts.length === 0 ? (
        <div style={styles.notice}>
          The Sales TB reference reports {formatNumber(noAccessCount)} No
          Access attempt(s), but detailed TRN records are not available in the
          current live result stream.
        </div>
      ) : null}

      <div style={styles.attemptList}>
        {attempts.map((attempt, index) => (
          <article key={attempt.id || index} style={styles.attemptCard}>
            <div style={styles.attemptHeader}>
              <strong>Attempt {index + 1}</strong>
              <Badge value="NO ACCESS" />
            </div>

            <div style={styles.attemptGrid}>
              <InfoItem
                label="Captured"
                value={formatDateTime(attempt.capturedAtMs)}
              />
              <InfoItem label="Reason" value={attempt.reason} />
              <InfoItem label="Captured By" value={attempt.capturedBy} />
              <InfoItem label="GPS" value={formatAttemptGps(attempt)} />
            </div>

            {attempt.mediaUrls.length > 0 ? (
              <div style={styles.photoGrid}>
                {attempt.mediaUrls.map((url, mediaIndex) => (
                  <a
                    key={`${attempt.id}-${mediaIndex}`}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    style={styles.photoLink}
                  >
                    <img
                      src={url}
                      alt={`No Access attempt ${index + 1}`}
                      style={styles.photo}
                    />
                    <span>Open evidence photo</span>
                  </a>
                ))}
              </div>
            ) : (
              <span style={styles.secondaryText}>
                No evidence photo URL is available in this report record.
              </span>
            )}
          </article>
        ))}
      </div>
    </ModalShell>
  );
}

function RowDetailsModal({ row, onClose }) {
  return (
    <ModalShell
      title={`TB Row ${row.rowNo || "NAv"}`}
      subtitle={row.originalMeter.number}
      onClose={onClose}
      wide
    >
      <div style={styles.detailSection}>
        <h3 style={styles.detailTitle}>Source identity</h3>
        <div style={styles.detailGrid}>
          <InfoItem label="Account" value={row.source.accountNumber} />
          <InfoItem label="Customer" value={row.source.customerName} />
          <InfoItem label="Ward" value={row.scope.wardLabel} />
          <InfoItem label="SG Code" value={row.source.sgCode} />
          <InfoItem label="Sales Document" value={row.source.salesId} />
          <InfoItem label="TB Row ID" value={row.id} />
        </div>
      </div>

      <div style={styles.detailSection}>
        <h3 style={styles.detailTitle}>Meter comparison</h3>
        <div style={styles.detailGrid}>
          <InfoItem label="Original Meter" value={row.originalMeter.number} />
          <InfoItem
            label="Field Meter"
            value={row.fieldMeter.number || "PENDING"}
          />
          <InfoItem
            label="Meter Match"
            value={row.comparison.meterMatch}
          />
          <InfoItem
            label="Field Meter ID"
            value={row.fieldMeter.id || "NAv"}
          />
        </div>
      </div>

      <div style={styles.detailSection}>
        <h3 style={styles.detailTitle}>Address comparison</h3>
        <div style={styles.detailGrid}>
          <InfoItem label="Original Address" value={row.addresses.original} />
          <InfoItem
            label="Field Address"
            value={row.addresses.field || "PENDING"}
          />
          <InfoItem
            label="Address Match"
            value={row.comparison.addressMatch}
          />
          <InfoItem label="Premise ID" value={row.premise.id || "NAv"} />
        </div>
      </div>

      <div style={styles.detailSection}>
        <h3 style={styles.detailTitle}>Field result</h3>
        <div style={styles.detailGrid}>
          <InfoItem label="Execution" value={row.execution.status} />
          <InfoItem
            label="No Access Attempts"
            value={formatNumber(row.noAccess.count)}
          />
          <InfoItem
            label="Last Activity"
            value={formatDateTime(row.execution.lastActivityAtMs)}
          />
          <InfoItem
            label="Category / Reason"
            value={row.source.categoryReason}
          />
        </div>
      </div>
    </ModalShell>
  );
}

export default function SalesBatchReportPage() {
  const { tbId = "" } = useParams();
  const decodedTbId = decodeURIComponent(tbId);

  const { data = EMPTY_REPORT } = useGetTargetedBatchReportByIdQuery(
    decodedTbId,
    { skip: !decodedTbId },
  );

  const batch = data?.batch || null;
  const rows = data?.rows || [];
  const summary = data?.summary || EMPTY_REPORT.summary;
  const sync = data?.sync || EMPTY_REPORT.sync;

  const [searchText, setSearchText] = useState("");
  const [executionFilter, setExecutionFilter] = useState(ALL_FILTER);
  const [wardFilter, setWardFilter] = useState(ALL_FILTER);
  const [meterMatchFilter, setMeterMatchFilter] = useState(ALL_FILTER);
  const [addressMatchFilter, setAddressMatchFilter] = useState(ALL_FILTER);
  const [noAccessFilter, setNoAccessFilter] = useState(ALL_FILTER);
  const [selectedNoAccessRow, setSelectedNoAccessRow] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);

  const sourceStatuses = sync?.sources || EMPTY_REPORT.sync.sources;
  const baseReady =
    TERMINAL_STREAM_STATES.has(sourceStatuses.batch) &&
    TERMINAL_STREAM_STATES.has(sourceStatuses.rows);
  const allReady = Object.values(sourceStatuses).every((status) =>
    TERMINAL_STREAM_STATES.has(status),
  );
  const loadError = cleanText(sync?.error?.message);

  const filterOptions = useMemo(
    () => ({
      wards: uniqueNonBlank(rows.map((row) => row.scope.wardLabel)),
      executions: uniqueNonBlank(rows.map((row) => row.execution.status)),
    }),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const search = normalizeUpper(searchText);

    return rows.filter((row) => {
      const searchable = normalizeUpper(
        [
          row.rowNo,
          row.source.accountNumber,
          row.source.customerName,
          row.scope.wardLabel,
          row.originalMeter.number,
          row.fieldMeter.number || "PENDING",
          row.addresses.original,
          row.addresses.field || "PENDING",
          row.source.sgCode,
          row.source.categoryReason,
        ].join(" "),
      );

      if (search && !searchable.includes(search)) return false;
      if (
        executionFilter !== ALL_FILTER &&
        row.execution.status !== executionFilter
      ) {
        return false;
      }
      if (
        wardFilter !== ALL_FILTER &&
        row.scope.wardLabel !== wardFilter
      ) {
        return false;
      }
      if (
        meterMatchFilter !== ALL_FILTER &&
        row.comparison.meterMatch !== meterMatchFilter
      ) {
        return false;
      }
      if (
        addressMatchFilter !== ALL_FILTER &&
        row.comparison.addressMatch !== addressMatchFilter
      ) {
        return false;
      }
      if (noAccessFilter === "HAS_NA" && row.noAccess.count === 0) {
        return false;
      }
      if (noAccessFilter === "NO_NA" && row.noAccess.count > 0) {
        return false;
      }

      return true;
    });
  }, [
    rows,
    searchText,
    executionFilter,
    wardFilter,
    meterMatchFilter,
    addressMatchFilter,
    noAccessFilter,
  ]);

  function clearFilters() {
    setSearchText("");
    setExecutionFilter(ALL_FILTER);
    setWardFilter(ALL_FILTER);
    setMeterMatchFilter(ALL_FILTER);
    setAddressMatchFilter(ALL_FILTER);
    setNoAccessFilter(ALL_FILTER);
  }

  if (!decodedTbId) {
    return (
      <section style={styles.page}>
        <Link to="/sales/reporting" style={styles.backButton}>
          ← Back to Sales Reporting
        </Link>
        <div style={styles.errorState}>
          The Targeted Batch ID is missing from the route.
        </div>
      </section>
    );
  }

  if (!baseReady) {
    return (
      <section style={styles.page}>
        <Link to="/sales/reporting" style={styles.backButton}>
          ← Back to Sales Reporting
        </Link>

        <div style={styles.loadingState}>
          Loading live Targeted Batch report...
        </div>
      </section>
    );
  }

  if (!batch) {
    return (
      <section style={styles.page}>
        <Link to="/sales/reporting" style={styles.backButton}>
          ← Back to Sales Reporting
        </Link>

        {loadError ? <div style={styles.errorState}>{loadError}</div> : null}

        <div style={styles.errorState}>
          Permanent Targeted Batch {decodedTbId || "NAv"} was not found.
        </div>
      </section>
    );
  }

  return (
    <section style={styles.page}>
      <div style={styles.topRow}>
        <Link to="/sales/reporting" style={styles.backButton}>
          ← Back to Sales Reporting
        </Link>

        <div style={styles.liveBadge}>
          <span style={styles.liveDot} />
          {allReady ? "Live field results" : "Joining live field results..."}
        </div>
      </div>

      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Sales / Reporting / Targeted Batch</p>
          <h1 style={styles.title}>Targeted Batch Report</h1>
          <p style={styles.subtitle}>{batch.id}</p>
        </div>

        <Badge value={batch.execution.status} />
      </header>

      {loadError ? <div style={styles.errorState}>{loadError}</div> : null}

      <section style={styles.batchPanel}>
        <div style={styles.infoGrid}>
          <InfoItem
            label="Sales Period"
            value={batch.selection.salesPeriodLabel}
          />
          <InfoItem
            label="Selection Reason"
            value={batch.selection.reason}
          />
          <InfoItem label="Ward" value={batch.scope.wardLabel} />
          <InfoItem
            label="Allocated To"
            value={batch.allocation.targetLabel}
          />
          <InfoItem label="Acceptance" value={batch.acceptance.status} />
          <InfoItem label="Execution" value={batch.execution.status} />
        </div>
      </section>

      <div style={styles.summaryGrid}>
        <SummaryCard
          label="Total Rows"
          value={summary.total}
          helper="Permanent TB rows"
        />
        <SummaryCard
          label="Not Started"
          value={summary.notStarted}
          helper="No field execution yet"
        />
        <SummaryCard
          label="In Progress"
          value={summary.inProgress}
          helper="Active field rows"
        />
        <SummaryCard
          label="Completed"
          value={summary.completed}
          helper="Completed field rows"
        />
        <SummaryCard
          label="Meters Discovered"
          value={summary.metersDiscovered}
          helper="fieldWork.meterId linked"
        />
        <SummaryCard
          label="No Access Attempts"
          value={summary.noAccessAttempts}
          helper="All recorded attempts"
        />
      </div>

      <section style={styles.panel}>
        <div style={styles.panelHeader}>
          <div>
            <h2 style={styles.panelTitle}>Targeted Batch Field Results</h2>
            <p style={styles.panelSubtitle}>
              Original Sales values are shown next to live field results.
            </p>
          </div>

          <strong style={styles.resultCount}>
            {formatNumber(filteredRows.length)} of{" "}
            {formatNumber(rows.length)} shown
          </strong>
        </div>

        <div style={styles.filters}>
          <label style={styles.filterField}>
            <span style={styles.filterLabel}>Search</span>
            <input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Meter, account, customer, address or SG Code"
              style={styles.filterInput}
            />
          </label>

          <label style={styles.filterField}>
            <span style={styles.filterLabel}>Execution</span>
            <select
              value={executionFilter}
              onChange={(event) => setExecutionFilter(event.target.value)}
              style={styles.filterInput}
            >
              <option value={ALL_FILTER}>All Execution States</option>
              {filterOptions.executions.map((execution) => (
                <option key={execution} value={execution}>
                  {execution.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>

          <label style={styles.filterField}>
            <span style={styles.filterLabel}>Ward</span>
            <select
              value={wardFilter}
              onChange={(event) => setWardFilter(event.target.value)}
              style={styles.filterInput}
            >
              <option value={ALL_FILTER}>All Wards</option>
              {filterOptions.wards.map((ward) => (
                <option key={ward} value={ward}>
                  {ward}
                </option>
              ))}
            </select>
          </label>

          <label style={styles.filterField}>
            <span style={styles.filterLabel}>Meter Match</span>
            <select
              value={meterMatchFilter}
              onChange={(event) => setMeterMatchFilter(event.target.value)}
              style={styles.filterInput}
            >
              <option value={ALL_FILTER}>All Meter Matches</option>
              <option value="TRUE">TRUE</option>
              <option value="FALSE">FALSE</option>
              <option value="PENDING">PENDING</option>
            </select>
          </label>

          <label style={styles.filterField}>
            <span style={styles.filterLabel}>Address Match</span>
            <select
              value={addressMatchFilter}
              onChange={(event) => setAddressMatchFilter(event.target.value)}
              style={styles.filterInput}
            >
              <option value={ALL_FILTER}>All Address Matches</option>
              <option value="TRUE">TRUE</option>
              <option value="FALSE">FALSE</option>
              <option value="PENDING">PENDING</option>
            </select>
          </label>

          <label style={styles.filterField}>
            <span style={styles.filterLabel}>No Access</span>
            <select
              value={noAccessFilter}
              onChange={(event) => setNoAccessFilter(event.target.value)}
              style={styles.filterInput}
            >
              <option value={ALL_FILTER}>All Rows</option>
              <option value="HAS_NA">Has No Access</option>
              <option value="NO_NA">No No Access</option>
            </select>
          </label>

          <button
            type="button"
            style={styles.clearButton}
            onClick={clearFilters}
          >
            Clear Filters
          </button>
        </div>

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <Th>Row</Th>
                <Th>Account</Th>
                <Th>Customer</Th>
                <Th>Ward</Th>
                <Th>Original Meter</Th>
                <Th>Field Meter</Th>
                <Th>Meter Match</Th>
                <Th>Original Address</Th>
                <Th>Field Address</Th>
                <Th>Address Match</Th>
                <Th>Execution</Th>
                <Th>Premise</Th>
                <Th>No Access</Th>
                <Th>Last Activity</Th>
                <Th>Action</Th>
              </tr>
            </thead>

            <tbody>
              {!allReady && rows.length === 0 ? (
                <tr>
                  <Td colSpan={15}>
                    Joining live Sales and field-result records...
                  </Td>
                </tr>
              ) : null}

              {allReady && filteredRows.length === 0 ? (
                <tr>
                  <Td colSpan={15}>
                    {rows.length === 0
                      ? "No permanent TB rows exist for this Targeted Batch."
                      : "No TB rows match the selected filters."}
                  </Td>
                </tr>
              ) : null}

              {filteredRows.map((row) => (
                <tr key={row.id}>
                  <Td>{row.rowNo || "NAv"}</Td>
                  <Td>{row.source.accountNumber}</Td>
                  <Td>{row.source.customerName}</Td>
                  <Td>{row.scope.wardLabel}</Td>
                  <Td>
                    <strong style={styles.primaryCell}>
                      {row.originalMeter.number}
                    </strong>
                  </Td>
                  <Td>
                    <strong style={styles.primaryCell}>
                      {row.fieldMeter.number || "PENDING"}
                    </strong>
                  </Td>
                  <Td>
                    <Badge value={row.comparison.meterMatch} />
                  </Td>
                  <Td>
                    <span style={styles.addressCell}>
                      {row.addresses.original}
                    </span>
                  </Td>
                  <Td>
                    <span style={styles.addressCell}>
                      {row.addresses.field || "PENDING"}
                    </span>
                  </Td>
                  <Td>
                    <Badge value={row.comparison.addressMatch} />
                  </Td>
                  <Td>
                    <Badge value={row.execution.status} />
                  </Td>
                  <Td>
                    <Badge value={row.premise.status} />
                    {row.premise.id ? (
                      <div style={styles.secondaryText}>{row.premise.id}</div>
                    ) : null}
                  </Td>
                  <Td>
                    <button
                      type="button"
                      style={{
                        ...styles.noAccessButton,
                        ...(row.noAccess.count === 0
                          ? styles.noAccessButtonDisabled
                          : null),
                      }}
                      disabled={row.noAccess.count === 0}
                      onClick={() => setSelectedNoAccessRow(row)}
                      title={
                        row.noAccess.count > 0
                          ? "Open No Access details"
                          : "No No Access attempts"
                      }
                    >
                      {formatNumber(row.noAccess.count)}
                    </button>
                  </Td>
                  <Td>{formatDateTime(row.execution.lastActivityAtMs)}</Td>
                  <Td>
                    <button
                      type="button"
                      style={styles.openButton}
                      onClick={() => setSelectedRow(row)}
                    >
                      Open Row
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selectedNoAccessRow ? (
        <NoAccessModal
          row={selectedNoAccessRow}
          onClose={() => setSelectedNoAccessRow(null)}
        />
      ) : null}

      {selectedRow ? (
        <RowDetailsModal
          row={selectedRow}
          onClose={() => setSelectedRow(null)}
        />
      ) : null}
    </section>
  );
}

const styles = {
  page: {
    display: "grid",
    gap: 18,
    minWidth: 0,
  },

  topRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },

  backButton: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 10,
    background: "#0f172a",
    color: "#ffffff",
    padding: "9px 13px",
    fontSize: 11,
    fontWeight: 900,
    textDecoration: "none",
  },

  liveBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    border: "1px solid #bbf7d0",
    background: "#f0fdf4",
    color: "#166534",
    padding: "9px 12px",
    fontSize: 11,
    fontWeight: 900,
  },

  liveDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#16a34a",
  },

  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 18,
    flexWrap: "wrap",
  },

  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: 12,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },

  title: {
    margin: "4px 0 0",
    color: "#0f172a",
    fontSize: 30,
    lineHeight: 1.15,
  },

  subtitle: {
    margin: "8px 0 0",
    color: "#475569",
    fontSize: 14,
    fontWeight: 900,
  },

  batchPanel: {
    borderRadius: 18,
    border: "1px solid #dbeafe",
    background: "#eff6ff",
    padding: 16,
  },

  infoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
  },

  infoItem: {
    minWidth: 0,
    display: "grid",
    gap: 4,
  },

  infoLabel: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
  },

  infoValue: {
    color: "#0f172a",
    fontSize: 12,
    overflowWrap: "anywhere",
  },

  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 12,
  },

  summaryCard: {
    borderRadius: 16,
    border: "1px solid #e2e8f0",
    background: "#ffffff",
    padding: 16,
    display: "grid",
    gap: 4,
  },

  summaryLabel: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
  },

  summaryValue: {
    color: "#0f172a",
    fontSize: 25,
    lineHeight: 1.1,
  },

  summaryHelper: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: 700,
  },

  panel: {
    minWidth: 0,
    borderRadius: 18,
    border: "1px solid #e2e8f0",
    background: "#ffffff",
    overflow: "hidden",
  },

  panelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: 18,
    borderBottom: "1px solid #e2e8f0",
    flexWrap: "wrap",
  },

  panelTitle: {
    margin: 0,
    color: "#0f172a",
    fontSize: 18,
  },

  panelSubtitle: {
    margin: "4px 0 0",
    color: "#64748b",
    fontSize: 12,
    fontWeight: 700,
  },

  resultCount: {
    color: "#1d4ed8",
    fontSize: 12,
  },

  filters: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 10,
    padding: 18,
    background: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
  },

  filterField: {
    display: "grid",
    gap: 5,
  },

  filterLabel: {
    color: "#475569",
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
  },

  filterInput: {
    minHeight: 40,
    width: "100%",
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#0f172a",
    padding: "8px 10px",
    fontSize: 12,
    fontWeight: 700,
    boxSizing: "border-box",
  },

  clearButton: {
    minHeight: 40,
    alignSelf: "end",
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#334155",
    padding: "8px 14px",
    fontSize: 11,
    fontWeight: 900,
    cursor: "pointer",
  },

  tableWrap: {
    width: "100%",
    overflowX: "auto",
  },

  table: {
    width: "100%",
    minWidth: 2050,
    borderCollapse: "collapse",
  },

  th: {
    padding: "11px 12px",
    borderBottom: "1px solid #cbd5e1",
    background: "#f8fafc",
    color: "#475569",
    fontSize: 10,
    fontWeight: 900,
    textAlign: "left",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },

  td: {
    padding: "12px",
    borderBottom: "1px solid #e2e8f0",
    color: "#334155",
    fontSize: 11,
    fontWeight: 700,
    verticalAlign: "top",
  },

  primaryCell: {
    color: "#0f172a",
    whiteSpace: "nowrap",
  },

  addressCell: {
    display: "block",
    minWidth: 170,
    maxWidth: 250,
    lineHeight: 1.45,
  },

  secondaryText: {
    marginTop: 4,
    color: "#64748b",
    fontSize: 9,
    overflowWrap: "anywhere",
  },

  badge: {
    display: "inline-flex",
    borderRadius: 999,
    background: "#f1f5f9",
    color: "#475569",
    padding: "5px 8px",
    fontSize: 9,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },

  badgeSuccess: {
    background: "#dcfce7",
    color: "#166534",
  },

  badgeWarning: {
    background: "#ffedd5",
    color: "#c2410c",
  },

  badgeDanger: {
    background: "#fee2e2",
    color: "#991b1b",
  },

  noAccessButton: {
    minWidth: 38,
    minHeight: 32,
    borderRadius: 9,
    border: "1px solid #fecaca",
    background: "#fee2e2",
    color: "#991b1b",
    fontSize: 11,
    fontWeight: 900,
    cursor: "pointer",
  },

  noAccessButtonDisabled: {
    borderColor: "#e2e8f0",
    background: "#f8fafc",
    color: "#94a3b8",
    cursor: "not-allowed",
  },

  openButton: {
    minHeight: 34,
    borderRadius: 10,
    border: 0,
    background: "#0f172a",
    color: "#ffffff",
    padding: "7px 11px",
    fontSize: 10,
    fontWeight: 900,
    whiteSpace: "nowrap",
    cursor: "pointer",
  },

  loadingState: {
    borderRadius: 14,
    border: "1px solid #bfdbfe",
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: 16,
    fontWeight: 800,
  },

  errorState: {
    borderRadius: 14,
    border: "1px solid #fecaca",
    background: "#fef2f2",
    color: "#991b1b",
    padding: 16,
    fontWeight: 800,
  },

  notice: {
    borderRadius: 12,
    border: "1px solid #fde68a",
    background: "#fffbeb",
    color: "#92400e",
    padding: 13,
    fontSize: 12,
    fontWeight: 800,
  },

  modalBackdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    display: "grid",
    placeItems: "center",
    padding: 20,
    background: "rgba(15, 23, 42, 0.72)",
  },

  modalCard: {
    width: "min(620px, 96vw)",
    maxHeight: "90vh",
    borderRadius: 18,
    background: "#ffffff",
    boxShadow: "0 24px 70px rgba(15, 23, 42, 0.35)",
    overflow: "hidden",
  },

  modalCardWide: {
    width: "min(980px, 96vw)",
  },

  modalHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    padding: 18,
    borderBottom: "1px solid #e2e8f0",
  },

  modalEyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
  },

  modalTitle: {
    margin: "4px 0 0",
    color: "#0f172a",
    fontSize: 20,
  },

  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    border: 0,
    background: "#0f172a",
    color: "#ffffff",
    fontSize: 22,
    lineHeight: 1,
    cursor: "pointer",
  },

  modalBody: {
    maxHeight: "calc(90vh - 84px)",
    overflowY: "auto",
    padding: 18,
  },

  emptyModalState: {
    color: "#64748b",
    fontSize: 13,
    fontWeight: 800,
    textAlign: "center",
    padding: 24,
  },

  attemptList: {
    display: "grid",
    gap: 12,
  },

  attemptCard: {
    borderRadius: 14,
    border: "1px solid #fecaca",
    background: "#fff7f7",
    padding: 14,
  },

  attemptHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },

  attemptGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 12,
  },

  photoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 220px))",
    gap: 10,
    marginTop: 14,
  },

  photoLink: {
    display: "grid",
    gap: 6,
    color: "#1d4ed8",
    fontSize: 10,
    fontWeight: 900,
    textDecoration: "none",
  },

  photo: {
    width: "100%",
    height: 130,
    borderRadius: 10,
    objectFit: "cover",
    background: "#e2e8f0",
  },

  detailSection: {
    display: "grid",
    gap: 10,
    paddingBottom: 16,
    marginBottom: 16,
    borderBottom: "1px solid #e2e8f0",
  },

  detailTitle: {
    margin: 0,
    color: "#0f172a",
    fontSize: 15,
  },

  detailGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: 12,
  },
};
