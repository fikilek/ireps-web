/* eslint-disable no-unused-vars -- JSX tags are used by React. */
// Targeted Batch rules TB-R045: the Allocation Matrix's TEAM / SP table. The Allocation Matrix page
// and the Allocation Matrix section on TB Register (1.3.51) both show this table, with the numbers
// of useAllocationMatrix.
import { useEffect, useMemo, useRef, useState } from "react";

import { matrixTotals, projectMatrixAllocation } from "./allocationMatrixModel";
import { matrixColumnHelp, matrixLeftOutReasons, matrixLeftOutSummary } from "./allocationMatrixHelp";

const ALL = "ALL";

function cleanText(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return cleanText(value).toUpperCase();
}

function formatNumber(value, maximumFractionDigits = 0) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits,
  });
}

function getErrorMessage(...errors) {
  for (const error of errors) {
    const message =
      cleanText(error?.message) ||
      cleanText(error?.error) ||
      cleanText(error?.data?.message);
    if (message) return message;
  }
  return "";
}

export function Percent({ value }) {
  return <>{formatNumber(value, 1)}%</>;
}

// Rules TB-R045: the number and its percentage of Meters Assigned.
function CountPercent({ count, percent }) {
  return (
    <span style={styles.countPercent}>
      <strong style={styles.countValue}>{formatNumber(count)}</strong>
      <span style={styles.countPct}><Percent value={percent} /></span>
    </span>
  );
}

// Rules TB-R045: every heading has a "?". Resting the pointer on it (briefly) or tapping it opens
// the column's explanation window.
const HELP_HOVER_DELAY_MS = 350;
function HelpIcon({ label, onOpen }) {
  const timer = useRef(null);
  const cancel = () => { clearTimeout(timer.current); timer.current = null; };
  return (
    <button type="button" aria-label={`What ${label} means`} title={`What ${label} means`} style={styles.helpIcon}
      onMouseEnter={() => { cancel(); timer.current = setTimeout(onOpen, HELP_HOVER_DELAY_MS); }}
      onMouseLeave={cancel} onClick={() => { cancel(); onOpen(); }}>
      ?
    </button>
  );
}

export function Th({ children, help = null, onHelp = null, divider = false }) {
  return (
    <th style={{ ...styles.th, ...(divider ? styles.divider : null) }}>
      <span style={styles.thContent}>
        {children}
        {help && onHelp ? <HelpIcon label={String(children)} onOpen={() => onHelp(help)} /> : null}
      </span>
    </th>
  );
}

function HelpWindow({ help, onClose }) {
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  if (!help) return null;
  return (
    <div style={styles.helpBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={help.title} style={styles.helpCard}>
        <div style={styles.helpHeader}>
          <h2 style={styles.helpTitle}>{help.title}</h2>
          <button type="button" aria-label="Close" style={styles.helpClose} onClick={onClose}>×</button>
        </div>
        <div style={styles.helpBody}>
          {help.paragraphs.map((paragraph) => <p key={paragraph} style={styles.helpText}>{paragraph}</p>)}
          {help.formula ? <p style={styles.helpFormula}>{help.formula}</p> : null}
          {help.rows.length ? (
            <table style={styles.helpTable}>
              <tbody>
                {help.rows.map(([name, value]) => (
                  <tr key={name}><td style={styles.helpName}>{name}</td><td style={styles.helpValue}>{value}</td></tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {help.total ? <p style={styles.helpTotal}>{help.total}</p> : null}
        </div>
      </div>
    </div>
  );
}

export function Td({ children, strong = false, colSpan, divider = false, total = false }) {
  return (
    <td
      style={{ ...styles.td, ...(strong ? styles.strongCell : null), ...(total ? styles.totalCell : null), ...(divider ? styles.divider : null) }}
      colSpan={colSpan}
    >
      {children}
    </td>
  );
}

// Rules TB-R045 (1.3.54): batches with inconsistent records are left out of the numbers. A quiet
// line under the table says how many and why; Show which names each, in plain words.
function LeftOutBatches({ issues }) {
  const [showList, setShowList] = useState(false);
  if (!issues?.length) return null;
  return (
    <div style={styles.leftOut}>
      <span>{matrixLeftOutSummary(issues)}</span>{" "}
      <button type="button" style={styles.leftOutToggle} aria-expanded={showList} onClick={() => setShowList((current) => !current)}>
        {showList ? "Hide" : "Show which"}
      </button>
      {showList ? (
        <ul style={styles.leftOutList}>
          {issues.map((issue, index) => (
            <li key={`${issue.batchId}:${index}`}>
              {issue.batchId}{issue.target?.name ? ` (${issue.target.name})` : ""}: {matrixLeftOutReasons(issue)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// `matrix` is useAllocationMatrix's result. `incomingMeters` above 0 adds the allocation preview
// columns (the page opened from the Allocate page).
export function AllocationMatrixTeamSpTable({ matrix, searchText = "", incomingMeters = 0 }) {
  const [targetTypeFilter, setTargetTypeFilter] = useState(ALL);
  const [helpKey, setHelpKey] = useState("");
  const { organisations, matrixRows, loading, error: matrixError } = matrix;
  const { summary: fieldWorkSummary, fetching: fieldWorkFetching, failed: fieldWorkFailed, error: fieldWorkError, refetch: refetchFieldWork } = matrix.fieldWork;
  const projectionActive = incomingMeters > 0;

  const visibleOrganisations = useMemo(() => {
    const search = upper(searchText);
    return matrixRows.filter((organisation) => {
      if (
        targetTypeFilter !== ALL &&
        organisation.type !== targetTypeFilter
      ) {
        return false;
      }
      if (!search) return true;
      return [organisation.name, organisation.id, organisation.type].some(
        (value) => upper(value).includes(search),
      );
    });
  }, [matrixRows, searchText, targetTypeFilter]);

  const help = helpKey ? matrixColumnHelp(helpKey, { organisations: visibleOrganisations, allOrganisations: matrixRows, incomingMeters }) : null;
  const workValue = (value) => (fieldWorkSummary ? formatNumber(value) : fieldWorkFailed ? "—" : "…");
  const workPercent = (value) => (fieldWorkSummary ? <Percent value={value} /> : fieldWorkFailed ? "—" : "…");
  const columnCount = (projectionActive ? 10 : 8) + 5;
  const totals = matrixTotals(visibleOrganisations, matrixRows);
  const matrixErrorMessage = getErrorMessage(matrixError);

  return (
    <>
      <div style={styles.typeFilterRow}>
        {[ALL, "TEAM", "SP"].map((type) => (
          <button
            key={type}
            type="button"
            style={{
              ...styles.filterButton,
              ...(targetTypeFilter === type
                ? styles.filterButtonActive
                : null),
            }}
            onClick={() => setTargetTypeFilter(type)}
          >
            {type === ALL ? "All TEAM / SP" : type}
          </button>
        ))}
        <span style={styles.fieldWorkStatus}>
          {fieldWorkSummary
            ? `Work outside batches as at ${new Date(fieldWorkSummary.generatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
            : fieldWorkFailed
              ? "Work outside batches could not be loaded"
              : "Loading work outside batches…"}
          <button
            type="button"
            style={styles.refreshButton}
            disabled={!matrix.lmPcode || fieldWorkFetching}
            onClick={() => refetchFieldWork()}
          >
            {fieldWorkFetching ? "Refreshing…" : "Refresh"}
          </button>
        </span>
      </div>

      {fieldWorkFailed ? (
        <div style={{ ...styles.errorNotice, marginBottom: 12 }}>
          Work outside batches could not be loaded:{" "}
          {getErrorMessage(fieldWorkError) || "please try Refresh."}
        </div>
      ) : null}

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            {/* Rules TB-R045 (1.3.26): batch work, work outside batches and total work, divided. */}
            <tr>
              <th colSpan={2} style={{ ...styles.bandTh, ...styles.bandIdentity }} />
              <th colSpan={projectionActive ? 8 : 6} style={{ ...styles.bandTh, ...styles.bandSales, ...styles.divider }}>Batches (sales path)</th>
              <th colSpan={3} style={{ ...styles.bandTh, ...styles.bandNormal, ...styles.divider }}>Outside batches (normal path)</th>
              <th colSpan={2} style={{ ...styles.bandTh, ...styles.bandAll, ...styles.divider }}>Total Work</th>
            </tr>
            <tr>
              <Th help="type" onHelp={setHelpKey}>Type</Th>
              <Th help="name" onHelp={setHelpKey}>TEAM / SP</Th>
              <Th help="batches" onHelp={setHelpKey} divider>Batches</Th>
              <Th help="assigned" onHelp={setHelpKey}>Meters Assigned</Th>
              <Th help="notStarted" onHelp={setHelpKey}>Not Started</Th>
              <Th help="inProgress" onHelp={setHelpKey}>In Progress</Th>
              <Th help="completed" onHelp={setHelpKey}>Completed</Th>
              <Th help="batchesShare" onHelp={setHelpKey}>Batches Share</Th>
              {projectionActive ? <Th help="projectedAssigned" onHelp={setHelpKey}>Projected Assigned</Th> : null}
              {projectionActive ? <Th help="projectedBatchesShare" onHelp={setHelpKey}>Projected Batches Share</Th> : null}
              <Th help="transactions" onHelp={setHelpKey} divider>Transactions</Th>
              <Th help="noAccess" onHelp={setHelpKey}>No Access</Th>
              <Th help="transactionsShare" onHelp={setHelpKey}>Transactions Share</Th>
              <Th help="totalWork" onHelp={setHelpKey} divider>Total Work</Th>
              <Th help="totalWorkShare" onHelp={setHelpKey}>Total Work Share</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <Td colSpan={columnCount}>
                  Loading live Allocation Matrix...
                </Td>
              </tr>
            ) : null}
            {!loading && matrixError ? (
              <tr>
                <Td colSpan={columnCount}>
                  <div style={styles.errorNotice}>
                    {matrixErrorMessage ||
                      "The Allocation Matrix could not be loaded."}
                  </div>
                </Td>
              </tr>
            ) : null}
            {!loading && !matrixError && visibleOrganisations.length === 0 ? (
              <tr>
                <Td colSpan={columnCount}>
                  No TEAM/SP targets match the current filters.
                </Td>
              </tr>
            ) : null}
            {!loading &&
              !matrixError &&
              visibleOrganisations.map((organisation) => {
                const projection = projectionActive
                  ? projectMatrixAllocation({
                      organisation,
                      allOrganisations: organisations,
                      incomingMeters,
                    })
                  : null;
                const matrix = organisation.matrix;
                const fieldWork = organisation.fieldWork;
                // Rows with work outside batches only have no batch numbers.
                const noBatches = organisation.fieldWorkOnly;

                return (
                  <tr key={organisation.key}>
                    <Td>
                      <span style={styles.typeBadge}>
                        {organisation.type}
                      </span>
                    </Td>
                    <Td strong>
                      <div style={styles.nameCell}>
                        <span>{organisation.name}</span>
                        <small>
                          {organisation.noTeam
                            ? `${formatNumber(fieldWork.workers.length)} worker(s) in no team`
                            : noBatches
                              ? "Not in the current TEAM list"
                              : `${organisation.memberCount} member(s)`}
                        </small>
                      </div>
                    </Td>
                    <Td divider>{noBatches ? "—" : formatNumber(matrix.batches)}</Td>
                    <Td strong>{noBatches ? "—" : formatNumber(matrix.assigned)}</Td>
                    <Td>{noBatches ? "—" : <CountPercent count={matrix.notStarted} percent={matrix.notStartedPct} />}</Td>
                    <Td>{noBatches ? "—" : <CountPercent count={matrix.inProgress} percent={matrix.inProgressPct} />}</Td>
                    <Td>{noBatches ? "—" : <CountPercent count={matrix.completed} percent={matrix.completedPct} />}</Td>
                    <Td>{noBatches ? "—" : <Percent value={matrix.batchesSharePct} />}</Td>
                    {projectionActive ? (
                      <Td strong>
                        {projection
                          ? formatNumber(projection.projectedAssigned)
                          : noBatches ? "—" : "Not eligible"}
                      </Td>
                    ) : null}
                    {projectionActive ? (
                      <Td>
                        {projection
                          ? <Percent value={projection.projectedBatchesSharePct} />
                          : "—"}
                      </Td>
                    ) : null}
                    <Td divider>{workValue(fieldWork.transactions)}</Td>
                    <Td>{workValue(fieldWork.noAccess)}</Td>
                    <Td>{workPercent(fieldWork.transactionsSharePct)}</Td>
                    <Td divider strong>{workValue(fieldWork.totalWork)}</Td>
                    <Td>{workPercent(fieldWork.totalWorkSharePct)}</Td>
                  </tr>
                );
              })}
          </tbody>
          {/* Rules TB-R045 (1.3.27): the totals of the rows shown. */}
          {!loading && !matrixError && visibleOrganisations.length > 0 ? (
            <tfoot>
              <tr>
                <Td total colSpan={2}>
                  <div style={styles.nameCell}>
                    <span>Total</span>
                    <small>{formatNumber(totals.rows)} row(s) shown</small>
                  </div>
                </Td>
                <Td total divider>{formatNumber(totals.batches)}</Td>
                <Td total>{formatNumber(totals.assigned)}</Td>
                <Td total><CountPercent count={totals.notStarted} percent={totals.notStartedPct} /></Td>
                <Td total><CountPercent count={totals.inProgress} percent={totals.inProgressPct} /></Td>
                <Td total><CountPercent count={totals.completed} percent={totals.completedPct} /></Td>
                <Td total><Percent value={totals.batchesSharePct} /></Td>
                {projectionActive ? <Td total>—</Td> : null}
                {projectionActive ? <Td total>—</Td> : null}
                <Td total divider>{workValue(totals.transactions)}</Td>
                <Td total>{workValue(totals.noAccess)}</Td>
                <Td total>{workPercent(totals.transactionsSharePct)}</Td>
                <Td total divider>{workValue(totals.totalWork)}</Td>
                <Td total>{workPercent(totals.totalWorkSharePct)}</Td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      <LeftOutBatches issues={matrix.integrityIssues} />
      {matrix.salesUnreadRows > 0 ? (
        <div style={styles.leftOut}>
          The Sales meters of {formatNumber(matrix.salesUnreadRows)}{" "}
          {matrix.salesUnreadRows === 1 ? "row" : "rows"} could not be read, so{" "}
          {matrix.salesUnreadRows === 1 ? "that row counts" : "those rows count"} by the batch row status only.
        </div>
      ) : null}
      {help ? <HelpWindow help={help} onClose={() => setHelpKey("")} /> : null}
    </>
  );
}

const styles = {
  // Rules TB-R045: numbers with percentages, "?" icons and the explanation window.
  countPercent: { display: "grid", gap: 2 },
  countValue: { color: "#0f172a", fontSize: 12 },
  countPct: { color: "#64748b", fontSize: 10, fontWeight: 700 },
  thContent: { display: "inline-flex", alignItems: "center", gap: 6 },
  helpIcon: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: 999, border: "1px solid #2563eb", background: "#eff6ff", color: "#1d4ed8", fontSize: 11, fontWeight: 900, cursor: "help", padding: 0, lineHeight: 1 },
  helpBackdrop: { position: "fixed", inset: 0, zIndex: 10000, background: "rgba(15, 23, 42, 0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  helpCard: { width: "min(94vw, 560px)", maxHeight: "86vh", display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: 16, background: "#ffffff", boxShadow: "0 25px 80px rgba(15, 23, 42, 0.32)" },
  helpHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 18px", borderBottom: "1px solid #e2e8f0", flexShrink: 0 },
  helpTitle: { margin: 0, fontSize: 18, color: "#0f172a" },
  helpClose: { border: "none", background: "#f1f5f9", color: "#0f172a", width: 32, height: 32, borderRadius: 16, fontSize: 18, cursor: "pointer" },
  helpBody: { padding: "14px 18px 18px", overflowY: "auto", display: "grid", gap: 10 },
  helpText: { margin: 0, color: "#334155", fontSize: 14, lineHeight: 1.55 },
  helpFormula: { margin: 0, padding: "8px 10px", borderRadius: 10, background: "#eff6ff", color: "#1e3a8a", fontSize: 13, fontWeight: 800 },
  helpTable: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  helpName: { padding: "6px 8px", borderBottom: "1px solid #e2e8f0", color: "#0f172a", fontWeight: 800 },
  helpValue: { padding: "6px 8px", borderBottom: "1px solid #e2e8f0", color: "#334155", textAlign: "right", whiteSpace: "nowrap" },
  helpTotal: { margin: 0, padding: "8px 10px", borderRadius: 10, background: "#f1f5f9", color: "#0f172a", fontSize: 13, fontWeight: 900 },
  // Rules TB-R045 (1.3.26): the column groups and their dividers.
  bandTh: { padding: "6px 10px", borderRight: "1px solid #cbd5e1", borderBottom: "1px solid #cbd5e1", textAlign: "center", fontSize: 10, fontWeight: 900, letterSpacing: "0.05em", textTransform: "uppercase", whiteSpace: "nowrap" },
  bandIdentity: { background: "#f8fafc" },
  bandSales: { background: "#dbeafe", color: "#1e3a8a" },
  bandNormal: { background: "#fef3c7", color: "#92400e" },
  bandAll: { background: "#dcfce7", color: "#166534" },
  divider: { borderLeft: "2px solid #64748b" },
  fieldWorkStatus: { marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8, color: "#64748b", fontSize: 11, fontWeight: 700 },
  refreshButton: { border: "1px solid #cbd5e1", borderRadius: 999, padding: "5px 10px", background: "#ffffff", color: "#1d4ed8", fontSize: 11, fontWeight: 850, cursor: "pointer" },
  errorNotice: {
    border: "1px solid #fecaca",
    background: "#fef2f2",
    color: "#991b1b",
    borderRadius: 12,
    padding: 12,
  },
  // Rules TB-R045 (1.3.54): the quiet line about batches left out, under the table.
  leftOut: { marginTop: 10, color: "#64748b", fontSize: 12, lineHeight: 1.5 },
  leftOutToggle: { border: 0, background: "none", padding: 0, color: "#1d4ed8", fontSize: 12, fontWeight: 800, cursor: "pointer", textDecoration: "underline" },
  leftOutList: { margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 2 },
  typeFilterRow: { display: "flex", gap: 7, marginBottom: 12, flexWrap: "wrap" },
  filterButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 999,
    padding: "7px 10px",
    background: "#ffffff",
    color: "#475569",
    fontWeight: 850,
    cursor: "pointer",
  },
  filterButtonActive: {
    borderColor: "#2563eb",
    background: "#eff6ff",
    color: "#1d4ed8",
  },
  tableWrap: {
    width: "100%",
    overflowX: "auto",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
  },
  table: {
    width: "100%",
    minWidth: 1380,
    borderCollapse: "separate",
    borderSpacing: 0,
    fontSize: 11,
  },
  th: {
    position: "sticky",
    top: 0,
    zIndex: 2,
    padding: "9px 10px",
    borderRight: "1px solid #cbd5e1",
    borderBottom: "1px solid #cbd5e1",
    background: "#e2e8f0",
    color: "#0f172a",
    textAlign: "left",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "9px 10px",
    borderRight: "1px solid #e2e8f0",
    borderBottom: "1px solid #e2e8f0",
    background: "#ffffff",
    color: "#334155",
    verticalAlign: "top",
  },
  strongCell: { color: "#0f172a", fontWeight: 850 },
  totalCell: { background: "#e9eef5", color: "#0f172a", fontWeight: 900, borderTop: "2px solid #64748b" },
  typeBadge: {
    borderRadius: 999,
    padding: "4px 7px",
    background: "#dbeafe",
    color: "#1d4ed8",
    fontSize: 9,
    fontWeight: 900,
  },
  nameCell: { display: "grid", gap: 2 },
};
