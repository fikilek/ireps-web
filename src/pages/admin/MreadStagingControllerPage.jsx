import { useEffect, useMemo, useState } from "react";

import { useAuth } from "../../auth/useAuth";
import { useListMreadStagingCyclesQuery } from "../../redux/mreadStagingCyclesApi";

const STATUS_OPTIONS = ["ALL", "DRAFT", "CLOSED", "FUTURE"];
const DEFAULT_LM_PCODE = "ZA2157";

function normalizeText(value, fallback = "NAv") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function readWorkbaseId(activeWorkbase) {
  return (
    activeWorkbase?.id ||
    activeWorkbase?.pcode ||
    activeWorkbase?.lmPcode ||
    DEFAULT_LM_PCODE
  );
}

function formatDateTime(value) {
  if (!value) return "NAv";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString("en-ZA", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusStyle(status) {
  const normalizedStatus = normalizeText(status, "").toUpperCase();

  if (normalizedStatus === "DRAFT") {
    return {
      background: "#dbeafe",
      color: "#1d4ed8",
      border: "1px solid #93c5fd",
    };
  }

  if (normalizedStatus === "CLOSED") {
    return {
      background: "#f1f5f9",
      color: "#475569",
      border: "1px solid #cbd5e1",
    };
  }

  return {
    background: "#f8fafc",
    color: "#64748b",
    border: "1px solid #e2e8f0",
  };
}

function SummaryCard({ label, value, helper }) {
  return (
    <div style={styles.summaryCard}>
      <div style={styles.summaryLabel}>{label}</div>
      <div style={styles.summaryValue}>{value}</div>
      {helper ? <div style={styles.summaryHelper}>{helper}</div> : null}
    </div>
  );
}

function DetailRow({ label, value }) {
  const displayValue = value === null || value === undefined || value === "" ? "NAv" : value;

  return (
    <div style={styles.detailRow}>
      <div style={styles.detailLabel}>{label}</div>
      <div style={styles.detailValue}>{displayValue}</div>
    </div>
  );
}

export default function MreadStagingControllerPage() {
  const { role, activeWorkbase } = useAuth();

  const [lmPcode, setLmPcode] = useState(() => readWorkbaseId(activeWorkbase));
  const [billingPeriod, setBillingPeriod] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [selectedCycle, setSelectedCycle] = useState(null);

  useEffect(() => {
    setLmPcode(readWorkbaseId(activeWorkbase));
  }, [activeWorkbase]);

  const queryArgs = useMemo(
    () => ({
      lmPcode: normalizeText(lmPcode, DEFAULT_LM_PCODE),
      billingPeriod: billingPeriod === "ALL" ? null : billingPeriod,
      status: status === "ALL" ? null : status,
      limit: 200,
    }),
    [billingPeriod, lmPcode, status],
  );

  const {
    data,
    error: queryError,
    isFetching,
    refetch,
  } = useListMreadStagingCyclesQuery(queryArgs);

  const rows = useMemo(() => (Array.isArray(data?.rows) ? data.rows : []), [data]);
  const summary = data?.summary || null;

  useEffect(() => {
    setSelectedCycle((current) => {
      if (!rows.length) return null;
      if (!current) return rows[0];
      return rows.find((row) => row.cycleId === current.cycleId) || rows[0];
    });
  }, [rows]);

  const billingPeriodOptions = useMemo(() => {
    const periods = Array.from(
      new Set(rows.map((row) => row.billingPeriod).filter(Boolean)),
    ).sort();

    return Array.from(new Set(["ALL", "2025/26", "2026/27", ...periods]));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return rows;

    return rows.filter((row) => {
      const haystack = [
        row.cycleId,
        row.cycleLabel,
        row.billingPeriod,
        row.status,
        row.window?.display,
        row.activeStagingId,
      ]
        .map((value) => normalizeText(value, "").toLowerCase())
        .join(" ");

      return haystack.includes(term);
    });
  }, [rows, search]);

  const activeDraftText = summary?.activeDraft
    ? `${summary.activeDraft.cycleLabel} • ${summary.activeDraft.window}`
    : "No DRAFT cycle returned";

  const errorMessage =
    queryError?.message ||
    queryError?.data?.message ||
    queryError?.error ||
    "";

  return (
    <div style={styles.page}>
      <section style={styles.hero}>
        <div>
          <p style={styles.eyebrow}>Admin / Controller</p>
          <h1 style={styles.title}>MREAD Staging Controller</h1>
          <p style={styles.subtitle}>
            Read-only view of configured MREAD staging cycles.
          </p>
        </div>

        <div style={styles.roleBadge}>Role: {role || "NAv"}</div>
      </section>

      <section style={styles.notice}>
        Controller data is created by backend setup scripts. This page does not
        create, edit, close, delete, or generate MREAD staging rows.
      </section>

      <section style={styles.filtersCard}>
        <label style={styles.filterLabel}>
          LM
          <input
            value={lmPcode}
            onChange={(event) => setLmPcode(event.target.value)}
            style={styles.input}
            placeholder="ZA2157"
          />
        </label>

        <label style={styles.filterLabel}>
          Billing Period
          <select
            value={billingPeriod}
            onChange={(event) => setBillingPeriod(event.target.value)}
            style={styles.input}
          >
            {billingPeriodOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label style={styles.filterLabel}>
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            style={styles.input}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label style={styles.filterLabel}>
          Search
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={styles.input}
            placeholder="Cycle, status, staging id..."
          />
        </label>

        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          style={styles.primaryButton}
        >
          {isFetching ? "Loading..." : "Refresh"}
        </button>
      </section>

      {errorMessage ? <section style={styles.errorBox}>{errorMessage}</section> : null}

      <section style={styles.summaryGrid}>
        <SummaryCard label="Total Cycles" value={summary?.total ?? rows.length} />
        <SummaryCard label="Closed" value={summary?.closed ?? 0} />
        <SummaryCard label="Draft" value={summary?.draft ?? 0} />
        <SummaryCard label="Future" value={summary?.future ?? 0} />
        <SummaryCard label="Active Draft" value={summary?.activeDraft?.cycleLabel || "NAv"} helper={activeDraftText} />
      </section>

      <section style={styles.contentGrid}>
        <div style={styles.tableCard}>
          <div style={styles.cardHeader}>
            <div>
              <h2 style={styles.cardTitle}>Configured Cycles</h2>
              <p style={styles.cardSubtitle}>
                Showing {filteredRows.length} of {rows.length} controller rows.
              </p>
            </div>
          </div>

          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Cycle</th>
                  <th style={styles.th}>Billing Period</th>
                  <th style={styles.th}>Window</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Iteration</th>
                  <th style={styles.th}>Active Staging</th>
                  <th style={styles.th}>Rows</th>
                  <th style={styles.th}>Last Generated</th>
                  <th style={styles.th}>Action</th>
                </tr>
              </thead>

              <tbody>
                {filteredRows.map((row) => {
                  const selected = selectedCycle?.cycleId === row.cycleId;

                  return (
                    <tr
                      key={row.cycleId}
                      style={selected ? styles.selectedTr : styles.tr}
                    >
                      <td style={styles.tdStrong}>{row.cycleLabel}</td>
                      <td style={styles.td}>{row.billingPeriod}</td>
                      <td style={styles.td}>{row.window?.display || "NAv"}</td>
                      <td style={styles.td}>
                        <span style={{ ...styles.statusBadge, ...statusStyle(row.status) }}>
                          {row.status}
                        </span>
                      </td>
                      <td style={styles.td}>{row.currentIteration}</td>
                      <td style={styles.td}>{row.activeStagingId || "NAv"}</td>
                      <td style={styles.td}>{row.summary?.totalRows ?? 0}</td>
                      <td style={styles.td}>{formatDateTime(row.lastGenerated?.generatedAt || row.lastGenerated?.at)}</td>
                      <td style={styles.td}>
                        <button
                          type="button"
                          onClick={() => setSelectedCycle(row)}
                          style={styles.secondaryButton}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {!filteredRows.length && !isFetching ? (
                  <tr>
                    <td colSpan="9" style={styles.emptyTd}>
                      No MREAD staging cycles found for the selected filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <aside style={styles.detailCard}>
          <div style={styles.cardHeaderCompact}>
            <h2 style={styles.cardTitle}>Cycle Detail</h2>
          </div>

          {selectedCycle ? (
            <div style={styles.detailStack}>
              <DetailRow label="Cycle ID" value={selectedCycle.cycleId} />
              <DetailRow label="LM" value={selectedCycle.lmPcode} />
              <DetailRow label="Billing Period" value={selectedCycle.billingPeriod} />
              <DetailRow label="Cycle No" value={selectedCycle.cycleNoText || selectedCycle.cycleNo} />
              <DetailRow label="Cycle Code" value={selectedCycle.cycleCode} />
              <DetailRow label="Window" value={selectedCycle.window?.display} />
              <DetailRow label="Start Date" value={selectedCycle.window?.startDate} />
              <DetailRow label="End Date" value={selectedCycle.window?.endDate} />
              <DetailRow label="Status" value={selectedCycle.status} />
              <DetailRow label="Current Iteration" value={selectedCycle.currentIteration} />
              <DetailRow label="Active Staging ID" value={selectedCycle.activeStagingId} />
              <DetailRow label="Total Rows" value={selectedCycle.summary?.totalRows ?? 0} />
              <DetailRow label="Successful Reads" value={selectedCycle.summary?.successfulReads ?? 0} />
              <DetailRow label="No Access" value={selectedCycle.summary?.noAccess ?? 0} />
              <DetailRow label="Unsuccessful" value={selectedCycle.summary?.unsuccessful ?? 0} />
              <DetailRow label="Script" value={selectedCycle.metadata?.source?.scriptName} />
              <DetailRow label="Script Version" value={selectedCycle.metadata?.source?.scriptVersion} />
              <DetailRow label="As Of Date" value={selectedCycle.metadata?.source?.asOfDate} />
              <DetailRow label="Updated At" value={formatDateTime(selectedCycle.metadata?.updatedAt)} />
              <DetailRow label="Updated By" value={selectedCycle.metadata?.updatedByUser} />
            </div>
          ) : (
            <p style={styles.emptyDetail}>Select a cycle to inspect its controller metadata.</p>
          )}
        </aside>
      </section>
    </div>
  );
}

const styles = {
  page: {
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
    padding: "1rem",
  },
  hero: {
    display: "flex",
    justifyContent: "space-between",
    gap: "1rem",
    alignItems: "flex-start",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "1.25rem",
    padding: "1.2rem",
  },
  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: "0.78rem",
    fontWeight: 850,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  title: {
    margin: "0.2rem 0",
    color: "#0f172a",
    fontSize: "1.65rem",
    fontWeight: 900,
  },
  subtitle: {
    margin: 0,
    color: "#64748b",
    fontSize: "0.95rem",
  },
  roleBadge: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    padding: "0.5rem 0.75rem",
    borderRadius: "999px",
    fontSize: "0.82rem",
    fontWeight: 800,
  },
  notice: {
    background: "#fffbeb",
    color: "#92400e",
    border: "1px solid #fcd34d",
    borderRadius: "1rem",
    padding: "0.85rem 1rem",
    fontSize: "0.92rem",
    fontWeight: 650,
  },
  filtersCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "1.25rem",
    padding: "1rem",
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(140px, 1fr)) auto",
    gap: "0.8rem",
    alignItems: "end",
  },
  filterLabel: {
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
    fontSize: "0.78rem",
    fontWeight: 800,
    color: "#334155",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  input: {
    border: "1px solid #cbd5e1",
    borderRadius: "0.75rem",
    padding: "0.65rem 0.75rem",
    fontSize: "0.95rem",
    color: "#0f172a",
    background: "#ffffff",
  },
  primaryButton: {
    border: 0,
    background: "#0f172a",
    color: "#ffffff",
    borderRadius: "0.8rem",
    padding: "0.72rem 1rem",
    fontWeight: 850,
    cursor: "pointer",
  },
  secondaryButton: {
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#0f172a",
    borderRadius: "0.7rem",
    padding: "0.42rem 0.65rem",
    fontWeight: 800,
    cursor: "pointer",
  },
  errorBox: {
    background: "#fef2f2",
    color: "#991b1b",
    border: "1px solid #fecaca",
    borderRadius: "1rem",
    padding: "0.85rem 1rem",
    fontWeight: 700,
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(5, minmax(140px, 1fr))",
    gap: "0.8rem",
  },
  summaryCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "1rem",
    padding: "0.9rem",
  },
  summaryLabel: {
    color: "#64748b",
    fontSize: "0.78rem",
    fontWeight: 850,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  summaryValue: {
    marginTop: "0.25rem",
    color: "#0f172a",
    fontSize: "1.4rem",
    fontWeight: 900,
  },
  summaryHelper: {
    marginTop: "0.25rem",
    color: "#64748b",
    fontSize: "0.78rem",
    lineHeight: 1.4,
  },
  contentGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 360px",
    gap: "1rem",
    alignItems: "start",
  },
  tableCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "1.25rem",
    overflow: "hidden",
  },
  detailCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "1.25rem",
    padding: "1rem",
    position: "sticky",
    top: "1rem",
  },
  cardHeader: {
    padding: "1rem",
    borderBottom: "1px solid #e2e8f0",
  },
  cardHeaderCompact: {
    paddingBottom: "0.75rem",
    borderBottom: "1px solid #e2e8f0",
  },
  cardTitle: {
    margin: 0,
    color: "#0f172a",
    fontSize: "1rem",
    fontWeight: 900,
  },
  cardSubtitle: {
    margin: "0.25rem 0 0",
    color: "#64748b",
    fontSize: "0.85rem",
  },
  tableWrap: {
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: "1040px",
  },
  th: {
    textAlign: "left",
    padding: "0.75rem",
    background: "#f8fafc",
    color: "#475569",
    fontSize: "0.76rem",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    borderBottom: "1px solid #e2e8f0",
  },
  tr: {
    borderBottom: "1px solid #f1f5f9",
  },
  selectedTr: {
    borderBottom: "1px solid #bfdbfe",
    background: "#eff6ff",
  },
  td: {
    padding: "0.75rem",
    color: "#334155",
    fontSize: "0.86rem",
    verticalAlign: "top",
  },
  tdStrong: {
    padding: "0.75rem",
    color: "#0f172a",
    fontSize: "0.88rem",
    fontWeight: 850,
    verticalAlign: "top",
  },
  statusBadge: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: "999px",
    padding: "0.22rem 0.5rem",
    fontSize: "0.72rem",
    fontWeight: 900,
  },
  emptyTd: {
    padding: "1.5rem",
    textAlign: "center",
    color: "#64748b",
    fontWeight: 700,
  },
  detailStack: {
    display: "flex",
    flexDirection: "column",
    gap: "0.55rem",
    paddingTop: "0.75rem",
  },
  detailRow: {
    display: "grid",
    gridTemplateColumns: "130px 1fr",
    gap: "0.65rem",
    alignItems: "start",
    borderBottom: "1px solid #f1f5f9",
    paddingBottom: "0.45rem",
  },
  detailLabel: {
    color: "#64748b",
    fontSize: "0.76rem",
    fontWeight: 850,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  detailValue: {
    color: "#0f172a",
    fontSize: "0.85rem",
    fontWeight: 650,
    overflowWrap: "anywhere",
  },
  emptyDetail: {
    color: "#64748b",
    fontSize: "0.9rem",
    lineHeight: 1.5,
  },
};
