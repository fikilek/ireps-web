import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import { useAuth } from "../../auth/useAuth";
import { db } from "../../firebase";

const ALL_FILTER = "ALL";

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeUpper(value) {
  return cleanText(value).toUpperCase();
}

function getActiveLmPcode(activeWorkbase) {
  return cleanText(
    activeWorkbase?.lmPcode ||
      activeWorkbase?.pcode ||
      activeWorkbase?.id ||
      activeWorkbase?.localMunicipalityId,
  );
}

function getActiveWorkbaseName(activeWorkbase) {
  return cleanText(
    activeWorkbase?.name ||
      activeWorkbase?.lmName ||
      activeWorkbase?.id ||
      activeWorkbase?.pcode ||
      "NAv",
  );
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateTime(value) {
  const millis = toMillis(value);
  if (!millis) return "NAv";

  return new Date(millis).toLocaleString();
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function getSalesPeriod(batch = {}) {
  const from = cleanText(batch?.selection?.salesPeriodFrom);
  const to = cleanText(batch?.selection?.salesPeriodTo);

  if (from && to) return from === to ? from : `${from} to ${to}`;
  return from || to || "NAv";
}

function getBatchProgress(batch = {}) {
  const counts = batch?.counts || {};
  const total = Number(counts?.totalRows || 0);
  const started = Math.min(
    total,
    Math.max(0, Number(counts?.executionStartedRows || 0)),
  );
  const completed = Math.min(
    total,
    Math.max(0, Number(counts?.completedRows || 0)),
  );

  return {
    total,
    notStarted: Math.max(total - started, 0),
    inProgress: Math.max(started - completed, 0),
    completed,
  };
}

function getLastActivityValue(batch = {}) {
  const candidates = [
    batch?.metadata?.updatedAt,
    batch?.execution?.completedAt,
    batch?.execution?.startedAt,
    batch?.acceptance?.acceptedAt,
    batch?.acceptance?.rejectedAt,
    batch?.allocation?.completedAt,
    batch?.metadata?.createdAt,
  ];

  return candidates.reduce((latest, value) => {
    return toMillis(value) > toMillis(latest) ? value : latest;
  }, null);
}

function getAcceptanceStatus(batch = {}) {
  return normalizeUpper(batch?.acceptance?.status) || "NOT_READY";
}

function getExecutionStatus(batch = {}) {
  return normalizeUpper(batch?.execution?.status) || "NOT_STARTED";
}

function getTargetType(batch = {}) {
  return normalizeUpper(batch?.allocation?.targetType) || "UNALLOCATED";
}

function getTargetText(batch = {}) {
  const targetName = cleanText(batch?.allocation?.targetName);
  const targetType = getTargetType(batch);

  if (!targetName) return "Unallocated";
  return `${targetType} • ${targetName}`;
}

function statusTone(status = "") {
  switch (normalizeUpper(status)) {
    case "ACCEPTED":
    case "COMPLETED":
    case "ALLOCATED":
      return "success";
    case "IN_PROGRESS":
    case "WAITING":
    case "WAITING_ACCEPTANCE":
      return "warning";
    case "REJECTED":
    case "FAILED":
    case "CANCELLED":
      return "danger";
    default:
      return "neutral";
  }
}

function StatusBadge({ value }) {
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

export default function SalesReportingPage() {
  const { activeWorkbase } = useAuth();
  const activeLmPcode = getActiveLmPcode(activeWorkbase);
  const activeWorkbaseName = getActiveWorkbaseName(activeWorkbase);

  const [batches, setBatches] = useState([]);
  const [streamReady, setStreamReady] = useState(false);
  const [streamError, setStreamError] = useState(null);

  const [searchText, setSearchText] = useState("");
  const [wardFilter, setWardFilter] = useState(ALL_FILTER);
  const [periodFilter, setPeriodFilter] = useState(ALL_FILTER);
  const [targetTypeFilter, setTargetTypeFilter] = useState(ALL_FILTER);
  const [acceptanceFilter, setAcceptanceFilter] = useState(ALL_FILTER);
  const [executionFilter, setExecutionFilter] = useState(ALL_FILTER);

  useEffect(() => {
    setBatches([]);
    setStreamReady(false);
    setStreamError(null);

    if (!activeLmPcode) {
      setStreamReady(true);
      return undefined;
    }

    const batchesQuery = query(
      collection(db, "tb_uploads"),
      where("scope.lmPcode", "==", activeLmPcode),
    );

    const unsubscribe = onSnapshot(
      batchesQuery,
      (snapshot) => {
        const nextBatches = snapshot.docs
          .map((documentSnapshot) => ({
            id: documentSnapshot.id,
            ...documentSnapshot.data(),
          }))
          .sort(
            (left, right) =>
              toMillis(right?.metadata?.createdAt) -
              toMillis(left?.metadata?.createdAt),
          );

        setBatches(nextBatches);
        setStreamReady(true);
        setStreamError(null);
      },
      (error) => {
        console.error("[SALES REPORTING][TB STREAM]", error);
        setStreamError(error);
        setStreamReady(true);
      },
    );

    return () => unsubscribe();
  }, [activeLmPcode]);

  const filterOptions = useMemo(() => {
    const unique = (values) =>
      Array.from(new Set(values.filter(Boolean))).sort((left, right) =>
        String(left).localeCompare(String(right)),
      );

    return {
      wards: unique(
        batches.map(
          (batch) =>
            cleanText(batch?.scope?.wardName) ||
            cleanText(batch?.scope?.wardNumber) ||
            cleanText(batch?.scope?.wardPcode),
        ),
      ),
      periods: unique(batches.map(getSalesPeriod)),
      targetTypes: unique(batches.map(getTargetType)),
      acceptanceStatuses: unique(batches.map(getAcceptanceStatus)),
      executionStatuses: unique(batches.map(getExecutionStatus)),
    };
  }, [batches]);

  const filteredBatches = useMemo(() => {
    const search = normalizeUpper(searchText);

    return batches.filter((batch) => {
      const ward =
        cleanText(batch?.scope?.wardName) ||
        cleanText(batch?.scope?.wardNumber) ||
        cleanText(batch?.scope?.wardPcode) ||
        "NAv";

      const searchableText = normalizeUpper(
        [
          batch?.id,
          batch?.selection?.reason,
          batch?.scope?.lmName,
          batch?.scope?.lmPcode,
          ward,
          batch?.allocation?.targetName,
          batch?.allocation?.targetType,
          getSalesPeriod(batch),
        ].join(" "),
      );

      if (search && !searchableText.includes(search)) return false;
      if (wardFilter !== ALL_FILTER && ward !== wardFilter) return false;
      if (
        periodFilter !== ALL_FILTER &&
        getSalesPeriod(batch) !== periodFilter
      ) {
        return false;
      }
      if (
        targetTypeFilter !== ALL_FILTER &&
        getTargetType(batch) !== targetTypeFilter
      ) {
        return false;
      }
      if (
        acceptanceFilter !== ALL_FILTER &&
        getAcceptanceStatus(batch) !== acceptanceFilter
      ) {
        return false;
      }
      if (
        executionFilter !== ALL_FILTER &&
        getExecutionStatus(batch) !== executionFilter
      ) {
        return false;
      }

      return true;
    });
  }, [
    batches,
    searchText,
    wardFilter,
    periodFilter,
    targetTypeFilter,
    acceptanceFilter,
    executionFilter,
  ]);

  const summary = useMemo(() => {
    return batches.reduce(
      (accumulator, batch) => {
        const progress = getBatchProgress(batch);

        accumulator.batches += 1;
        accumulator.rows += progress.total;
        accumulator.inProgress += progress.inProgress;
        accumulator.completed += progress.completed;

        return accumulator;
      },
      {
        batches: 0,
        rows: 0,
        inProgress: 0,
        completed: 0,
      },
    );
  }, [batches]);

  function clearFilters() {
    setSearchText("");
    setWardFilter(ALL_FILTER);
    setPeriodFilter(ALL_FILTER);
    setTargetTypeFilter(ALL_FILTER);
    setAcceptanceFilter(ALL_FILTER);
    setExecutionFilter(ALL_FILTER);
  }

  return (
    <section style={styles.page}>
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Sales / Reporting</p>
          <h1 style={styles.title}>Sales Reporting</h1>
          <p style={styles.subtitle}>
            One live reporting row per permanent Targeted Batch. Open a batch
            to inspect its field outcomes row by row.
          </p>
        </div>

        <div style={styles.liveBadge}>
          <span style={styles.liveDot} />
          Live Targeted Batches
        </div>
      </header>

      {!activeLmPcode ? (
        <div style={styles.notice}>
          Activate a Local Municipality workbase before opening Sales
          Reporting.
        </div>
      ) : null}

      <div style={styles.summaryGrid}>
        <SummaryCard
          label="Targeted Batches"
          value={summary.batches}
          helper={activeWorkbaseName}
        />
        <SummaryCard
          label="Sales Rows"
          value={summary.rows}
          helper="Across all visible batches"
        />
        <SummaryCard
          label="In Progress"
          value={summary.inProgress}
          helper="Rows active in the field"
        />
        <SummaryCard
          label="Completed"
          value={summary.completed}
          helper="Rows completed in the field"
        />
      </div>

      <section style={styles.panel}>
        <div style={styles.panelHeader}>
          <div>
            <h2 style={styles.panelTitle}>Targeted Batch Reports</h2>
            <p style={styles.panelSubtitle}>
              Filters apply locally to the complete live workbase stream.
            </p>
          </div>

          <strong style={styles.resultCount}>
            {formatNumber(filteredBatches.length)} shown
          </strong>
        </div>

        <div style={styles.filters}>
          <label style={styles.filterField}>
            <span style={styles.filterLabel}>Search</span>
            <input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="TB ID, reason, ward or target"
              style={styles.filterInput}
            />
          </label>

          <label style={styles.filterField}>
            <span style={styles.filterLabel}>Sales Period</span>
            <select
              value={periodFilter}
              onChange={(event) => setPeriodFilter(event.target.value)}
              style={styles.filterInput}
            >
              <option value={ALL_FILTER}>All Sales Periods</option>
              {filterOptions.periods.map((period) => (
                <option key={period} value={period}>
                  {period}
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
            <span style={styles.filterLabel}>Target Type</span>
            <select
              value={targetTypeFilter}
              onChange={(event) => setTargetTypeFilter(event.target.value)}
              style={styles.filterInput}
            >
              <option value={ALL_FILTER}>All Targets</option>
              {filterOptions.targetTypes.map((targetType) => (
                <option key={targetType} value={targetType}>
                  {targetType.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>

          <label style={styles.filterField}>
            <span style={styles.filterLabel}>Acceptance</span>
            <select
              value={acceptanceFilter}
              onChange={(event) => setAcceptanceFilter(event.target.value)}
              style={styles.filterInput}
            >
              <option value={ALL_FILTER}>All Acceptance States</option>
              {filterOptions.acceptanceStatuses.map((status) => (
                <option key={status} value={status}>
                  {status.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>

          <label style={styles.filterField}>
            <span style={styles.filterLabel}>Execution</span>
            <select
              value={executionFilter}
              onChange={(event) => setExecutionFilter(event.target.value)}
              style={styles.filterInput}
            >
              <option value={ALL_FILTER}>All Execution States</option>
              {filterOptions.executionStatuses.map((status) => (
                <option key={status} value={status}>
                  {status.replaceAll("_", " ")}
                </option>
              ))}
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
                <Th>Targeted Batch ID</Th>
                <Th>Created</Th>
                <Th>Sales Period</Th>
                <Th>Selection Reason</Th>
                <Th>Scope</Th>
                <Th>Allocated To</Th>
                <Th>Acceptance</Th>
                <Th>Total Rows</Th>
                <Th>Not Started</Th>
                <Th>In Progress</Th>
                <Th>Completed</Th>
                <Th>Last Activity</Th>
                <Th>Report</Th>
              </tr>
            </thead>

            <tbody>
              {!streamReady ? (
                <tr>
                  <Td colSpan={13}>
                    <div style={styles.loadingState}>
                      <span style={styles.spinner} />
                      Loading live Targeted Batch reports...
                    </div>
                  </Td>
                </tr>
              ) : null}

              {streamReady && streamError ? (
                <tr>
                  <Td colSpan={13}>
                    <div style={styles.errorState}>
                      <strong>Targeted Batch report stream failed.</strong>
                      <span>
                        {streamError?.message ||
                          "The live reporting stream could not be opened."}
                      </span>
                    </div>
                  </Td>
                </tr>
              ) : null}

              {streamReady &&
              !streamError &&
              filteredBatches.length === 0 ? (
                <tr>
                  <Td colSpan={13}>
                    {batches.length === 0
                      ? "No permanent Targeted Batches exist in this workbase yet."
                      : "No Targeted Batches match the selected filters."}
                  </Td>
                </tr>
              ) : null}

              {streamReady &&
                !streamError &&
                filteredBatches.map((batch) => {
                  const progress = getBatchProgress(batch);
                  const ward =
                    cleanText(batch?.scope?.wardName) ||
                    cleanText(batch?.scope?.wardNumber) ||
                    cleanText(batch?.scope?.wardPcode) ||
                    "NAv";

                  return (
                    <tr key={batch.id}>
                      <Td>
                        <strong style={styles.batchId}>{batch.id}</strong>
                      </Td>
                      <Td>{formatDateTime(batch?.metadata?.createdAt)}</Td>
                      <Td>{getSalesPeriod(batch)}</Td>
                      <Td>
                        {cleanText(batch?.selection?.reason) || "NAv"}
                      </Td>
                      <Td>
                        <strong>
                          {cleanText(batch?.scope?.lmName) ||
                            activeWorkbaseName}
                        </strong>
                        <div style={styles.secondaryText}>Ward {ward}</div>
                      </Td>
                      <Td>{getTargetText(batch)}</Td>
                      <Td>
                        <StatusBadge value={getAcceptanceStatus(batch)} />
                      </Td>
                      <Td>{formatNumber(progress.total)}</Td>
                      <Td>{formatNumber(progress.notStarted)}</Td>
                      <Td>{formatNumber(progress.inProgress)}</Td>
                      <Td>{formatNumber(progress.completed)}</Td>
                      <Td>{formatDateTime(getLastActivityValue(batch))}</Td>
                      <Td>
                        <Link
                          to={`/sales/reporting/${encodeURIComponent(batch.id)}`}
                          style={styles.openButton}
                        >
                          Open Report
                        </Link>
                      </Td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

const styles = {
  page: {
    display: "grid",
    gap: 18,
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
    maxWidth: 760,
    margin: "8px 0 0",
    color: "#64748b",
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 1.6,
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
    fontSize: 12,
    fontWeight: 900,
  },

  liveDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#16a34a",
  },

  notice: {
    borderRadius: 14,
    border: "1px solid #fde68a",
    background: "#fffbeb",
    color: "#92400e",
    padding: 14,
    fontWeight: 800,
  },

  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
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
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
  },

  summaryValue: {
    color: "#0f172a",
    fontSize: 26,
    lineHeight: 1.1,
  },

  summaryHelper: {
    color: "#94a3b8",
    fontSize: 11,
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
    minWidth: 1640,
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
    fontSize: 12,
    fontWeight: 700,
    verticalAlign: "top",
  },

  batchId: {
    color: "#0f172a",
    whiteSpace: "nowrap",
  },

  secondaryText: {
    marginTop: 3,
    color: "#64748b",
    fontSize: 10,
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

  openButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 34,
    borderRadius: 10,
    background: "#0f172a",
    color: "#ffffff",
    padding: "6px 11px",
    fontSize: 10,
    fontWeight: 900,
    textDecoration: "none",
    whiteSpace: "nowrap",
  },

  loadingState: {
    display: "inline-flex",
    alignItems: "center",
    gap: 9,
    color: "#475569",
    fontWeight: 800,
  },

  spinner: {
    width: 16,
    height: 16,
    borderRadius: "50%",
    border: "2px solid #bfdbfe",
    borderTopColor: "#2563eb",
    animation: "spin 0.8s linear infinite",
  },

  errorState: {
    display: "grid",
    gap: 4,
    color: "#991b1b",
  },
};
