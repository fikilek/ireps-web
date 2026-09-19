/* eslint-disable no-unused-vars -- JSX tags are used by React. */
// Targeted Batch rules TB-R057 (1.3.55): Batch Stats. How the batches and their meters stand, and how
// many CAT meters are still to be batched and why. A backend Function counts every number when the
// page opens and on Refresh; nothing is stored. While it counts, or after a failure, no number shows.
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGetBatchStatsByLmQuery } from "../../redux/salesTargetedBatchApi";
import { getActiveLmName, getActiveLmPcode } from "./targeted-batches/dashboard/targetedBatchDashboardModel";
import { Donut, Dot, Legend, ShareList, StackedBars, VerticalBars } from "./targeted-batches/stats/BatchStatsCharts.jsx";
import {
  BATCH_TYPES,
  STATUSES,
  batchStatsErrorText,
  chartScale,
  formatNumber,
  formatReadAt,
  otherReasonsText,
  plural,
  shownReasons,
  statusCounts,
  teamTypeCells,
  toCount,
  townLabel,
} from "./targeted-batches/stats/batchStatsModel.js";

const INK = "#0f172a";
const MUTED = "#64748b";
const LINE = "#e2e8f0";
const PAGE = "#f8fafc";

const [GPS_TYPE, NON_GPS_TYPE, OTHER_TYPE] = BATCH_TYPES;
const statusParts = (counts, keyPrefix = "") => STATUSES.map((status) => ({ key: `${keyPrefix}${status.key}`, label: status.label, color: status.color, value: toCount(counts?.[status.key]) }));
const statusSegments = (counts, name) => STATUSES.map((status) => ({ key: status.key, value: toCount(counts?.[status.key]), color: status.color, title: `${name}, ${status.label}: ${formatNumber(counts?.[status.key])}` }));

export default function BatchStatsPage() {
  const { activeWorkbase } = useAuth();
  const lmPcode = getActiveLmPcode(activeWorkbase);
  const lmName = getActiveLmName(activeWorkbase);
  // Counted afresh whenever the page opens (the answer is never kept, TB-R057).
  const { currentData: stats, isFetching, isError, error, refetch } = useGetBatchStatsByLmQuery(lmPcode ? { lmPcode } : skipToken, { refetchOnMountOrArgChange: true });
  const showNumbers = Boolean(lmPcode && stats && !isFetching && !isError);

  return (
    <section style={styles.page}>
      <header style={styles.header}>
        <div style={styles.headerText}>
          <p style={styles.eyebrow}>Operations / TB Register / Batch Stats</p>
          <h2 style={styles.title}>Batch Stats</h2>
          {lmPcode ? <p style={styles.subtitle}>How the batches and their meters stand for {lmName}.</p> : null}
        </div>
        <div style={styles.headerSide}>
          <Link to="/operations/targeted-batches" style={styles.secondaryButton}>Back to TB Register</Link>
          {lmPcode ? (
            <div style={styles.readRow}>
              {showNumbers && formatReadAt(stats.generatedAt) ? <span style={styles.readAt}>Read {formatReadAt(stats.generatedAt)}</span> : null}
              <button type="button" style={{ ...styles.plainButton, ...(isFetching ? styles.disabledButton : null) }} disabled={isFetching} onClick={() => refetch()}>
                Refresh
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {!lmPcode ? (
        <div style={styles.errorNotice}>Activate a Local Municipality workbase to see Batch Stats.</div>
      ) : isFetching ? (
        <div style={styles.loadingPanel} role="status" aria-live="polite">
          <span className="ireps-spinner" style={styles.spinner} aria-hidden="true" />
          <div>
            <strong style={styles.loadingTitle}>Counting the batches and meters…</strong>
            <p style={styles.loadingText}>This can take up to a minute.</p>
          </div>
        </div>
      ) : isError ? (
        <div style={styles.errorNotice} role="alert">
          <span>Batch Stats could not be counted. {batchStatsErrorText(error)}</span>
          <button type="button" style={styles.tryAgainButton} onClick={() => refetch()}>Try again</button>
        </div>
      ) : showNumbers ? (
        <>
          <BatchesPart batches={stats.batches} />
          <MetersPart meters={stats.meters} />
          <TeamsPart teams={Array.isArray(stats.teams) ? stats.teams : []} />
          <StillToBatchPart stillToBatch={stats.stillToBatch || {}} fencesSkipped={toCount(stats.fencesSkipped)} />
        </>
      ) : null}
    </section>
  );
}

function Panel({ title, subtitle, children }) {
  return (
    <section style={styles.panel}>
      <div>
        <h3 style={styles.panelTitle}>{title}</h3>
        <p style={styles.panelSubtitle}>{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function Card({ title, grow = 1, basis = 360, children }) {
  return (
    <div style={{ ...styles.card, flex: `${grow} 1 ${basis}px` }}>
      <h4 style={styles.cardTitle}>{title}</h4>
      {children}
    </div>
  );
}

function Tile({ label, value, color }) {
  return (
    <div style={styles.tile}>
      <span style={styles.tileLabel}>{color ? <Dot color={color} /> : null}{label}</span>
      <strong style={styles.tileValue}>{formatNumber(value)}</strong>
    </div>
  );
}

// A table that scrolls sideways inside its own frame, never the page.
function Table({ head, children }) {
  return (
    <div style={styles.tableFrame}>
      <table style={styles.table}>
        <thead><tr>{head.map(([label, right]) => <th key={label} style={{ ...styles.th, textAlign: right ? "right" : "left" }}>{label}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Cell({ children, right, bold }) {
  return <td style={{ ...styles.td, textAlign: right ? "right" : "left", fontWeight: bold ? 900 : 400 }}>{children}</td>;
}

function QuietLine({ children }) {
  return <p style={styles.quietLine}>{children}</p>;
}

// Part 1: batches by the type TB Register shows.
function BatchesPart({ batches = {} }) {
  const types = BATCH_TYPES.filter((type) => type !== OTHER_TYPE || toCount(batches.OTHER) > 0)
    .map((type) => ({ key: type.key, label: type.label, color: type.color, value: toCount(batches[type.key]) }));
  return (
    <Panel title="Batches" subtitle="Every batch, split by batch type.">
      <div style={styles.tiles}>
        <Tile label="Total batches" value={batches.total} />
        {types.map((type) => <Tile key={type.key} label={`${type.label} batches`} value={type.value} color={type.color} />)}
      </div>
      <div style={styles.cardRow}>
        <Card title="Batch types">
          <VerticalBars bars={types.map((type) => ({ ...type, title: `${type.label} batches: ${formatNumber(type.value)}` }))} scale={chartScale(types.map((type) => type.value))} />
        </Card>
        <Card title="Batch types">
          <div style={styles.donutBeside}>
            <Donut parts={types} size={180} centre={formatNumber(batches.total)} caption="batches" name="Batches" />
            <ShareList parts={types.map((type) => ({ ...type, label: `${type.label} (${formatNumber(type.value)})` }))} />
          </div>
        </Card>
      </div>
    </Panel>
  );
}

// Part 2: every batch row by its status (TB-R054: Sales VISIBLE counts as Completed).
function MetersPart({ meters = {} }) {
  const lines = [
    { key: "ALL", label: "All batches", counts: statusCounts(meters.ALL), bold: true },
    { key: "GPS", label: GPS_TYPE.label, counts: statusCounts(meters.GPS) },
    { key: "NON_GPS", label: NON_GPS_TYPE.label, counts: statusCounts(meters.NON_GPS) },
    { key: "OTHER", label: OTHER_TYPE.label, counts: statusCounts(meters.OTHER) },
  ].filter((line) => line.key !== "OTHER" || line.counts.total > 0);
  return (
    <Panel title="Meters in batches" subtitle="Every meter in a batch, by status: all batches, then GPS and Non-GPS.">
      <Table head={[["Batch type"], ["Meters", true], ...STATUSES.map((status) => [status.label, true])]}>
        {lines.map((line) => (
          <tr key={line.key}>
            <Cell bold={line.bold}>{line.label}</Cell>
            <Cell right bold>{formatNumber(line.counts.total)}</Cell>
            {STATUSES.map((status) => <Cell key={status.key} right bold={line.bold}>{formatNumber(line.counts[status.key])}</Cell>)}
          </tr>
        ))}
      </Table>
      <div style={styles.cardRow}>
        <Card title="Meters by status" grow={3} basis={460}>
          <StackedBars
            rows={lines.map((line) => ({ key: line.key, label: line.label, segments: statusSegments(line.counts, line.label) }))}
            scale={chartScale(lines.map((line) => line.counts.total))}
          />
          <Legend items={STATUSES} />
        </Card>
        <Card title="Share by status" grow={2} basis={320}>
          <div style={styles.donutRow}>
            {lines.map((line) => (
              <div key={line.key} style={styles.donutColumn}>
                <strong style={styles.donutName}>{line.label}</strong>
                <Donut parts={statusParts(line.counts)} size={132} caption="meters" name={line.label} />
                <ShareList parts={statusParts(line.counts)} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Panel>
  );
}

// Part 3: the same per TEAM or SP, named as TB Register's Allocated To column; Not allocated last.
function TeamsPart({ teams }) {
  const hasOther = teams.some((team) => statusCounts(team?.meters?.OTHER).total > 0);
  const barRows = teams.flatMap((team, index) => [
    { key: `${team.key}:GPS`, group: team.name, label: GPS_TYPE.label, sub: true, gapTop: index ? 8 : 0, segments: statusSegments(team?.meters?.GPS, `${team.name}, ${GPS_TYPE.label}`) },
    { key: `${team.key}:NON_GPS`, label: NON_GPS_TYPE.label, sub: true, segments: statusSegments(team?.meters?.NON_GPS, `${team.name}, ${NON_GPS_TYPE.label}`) },
    ...(statusCounts(team?.meters?.OTHER).total ? [{ key: `${team.key}:OTHER`, label: OTHER_TYPE.label, sub: true, segments: statusSegments(team.meters.OTHER, `${team.name}, ${OTHER_TYPE.label}`) }] : []),
  ]);
  return (
    <Panel title="Teams" subtitle="The same breakdown for each team the batches are allocated to.">
      {teams.length ? (
        <>
          <Table
            head={[
              ["Team"],
              ["Batches (GPS / Non-GPS)"],
              ["GPS meters (Not Started / In Progress / Completed)"],
              ["Total GPS meters", true],
              ["Non-GPS meters (Not Started / In Progress / Completed)"],
              ["Total Non-GPS meters", true],
            ]}
          >
            {teams.map((team) => {
              const cells = teamTypeCells(team);
              return (
                <tr key={team.key}>
                  <Cell bold>{team.name}</Cell>
                  <Cell>{cells.batches}</Cell>
                  <Cell>{cells.gps.text}</Cell>
                  <Cell right bold>{formatNumber(cells.gps.total)}</Cell>
                  <Cell>{cells.nonGps.text}</Cell>
                  <Cell right bold>{formatNumber(cells.nonGps.total)}</Cell>
                </tr>
              );
            })}
          </Table>
          {hasOther ? <QuietLine>Meters in batches of neither type are not in the GPS or Non-GPS columns; they are in each team&apos;s Other bar and donut.</QuietLine> : null}
          <div style={styles.cardRow}>
            <Card title="Meters by team">
              <StackedBars rows={barRows} scale={chartScale(barRows.map((row) => row.segments.reduce((sum, segment) => sum + segment.value, 0)))} labelWidth={130} />
              <Legend items={STATUSES} />
            </Card>
            <Card title="Share by status, each team">
              <div style={styles.teamDonuts}>
                {teams.map((team) => (
                  <div key={team.key} style={styles.teamDonut}>
                    <Donut parts={statusParts(team?.meters?.ALL)} size={104} caption="all meters" name={team.name} />
                    <div style={styles.teamDonutText}>
                      <strong style={styles.donutName}>{team.name}</strong>
                      <ShareList parts={statusParts(team?.meters?.ALL)} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      ) : (
        <QuietLine>There are no batches yet.</QuietLine>
      )}
    </Panel>
  );
}

// Part 4: CAT meters from Sales that are Not Started and in no batch, by town and why.
function StillToBatchPart({ stillToBatch, fencesSkipped }) {
  const towns = Array.isArray(stillToBatch.towns) ? stillToBatch.towns : [];
  const totals = stillToBatch.totals || {};
  const reasons = shownReasons(totals);
  const found = toCount(stillToBatch.foundWithoutBatch);
  const unclear = toCount(stillToBatch.unclearLink);
  const otherText = toCount(totals.OTHER) > 0 ? otherReasonsText(stillToBatch.otherReasons) : "";
  const rowTotal = (counts) => reasons.reduce((sum, reason) => sum + toCount(counts?.[reason.key]), 0);
  const allTotal = toCount(totals.total) || rowTotal(totals);
  return (
    <Panel title="CAT meters still to batch" subtitle="CAT meters from Sales that are Not Started and in no batch yet, by town and why.">
      {towns.length ? (
        <>
          <Table head={[["Town"], ...reasons.map((reason) => [reason.label, true]), ["Total", true]]}>
            {towns.map((town) => (
              <tr key={town.town ?? "No town"}>
                <Cell bold>{townLabel(town.town)}</Cell>
                {reasons.map((reason) => <Cell key={reason.key} right>{formatNumber(town.counts?.[reason.key])}</Cell>)}
                <Cell right bold>{formatNumber(toCount(town.total) || rowTotal(town.counts))}</Cell>
              </tr>
            ))}
            <tr style={styles.totalRow}>
              <Cell bold>Total</Cell>
              {reasons.map((reason) => <Cell key={reason.key} right bold>{formatNumber(totals[reason.key])}</Cell>)}
              <Cell right bold>{formatNumber(allTotal)}</Cell>
            </tr>
          </Table>
          <div style={styles.cardRow}>
            <Card title="Still to batch, by town" grow={3} basis={460}>
              <StackedBars
                rows={towns.map((town) => ({
                  key: town.town ?? "No town",
                  label: townLabel(town.town),
                  segments: reasons.map((reason) => ({ key: reason.key, value: toCount(town.counts?.[reason.key]), color: reason.color, textColor: reason.textColor, title: `${townLabel(town.town)}, ${reason.label}: ${formatNumber(town.counts?.[reason.key])}` })),
                }))}
                scale={chartScale(towns.map((town) => rowTotal(town.counts)))}
              />
              <Legend items={reasons} />
            </Card>
            <Card title="Why they are not in a batch" grow={2} basis={320}>
              <div style={styles.donutStack}>
                <Donut parts={reasons.map((reason) => ({ key: reason.key, label: reason.label, color: reason.color, value: toCount(totals[reason.key]) }))} size={150} centre={formatNumber(allTotal)} caption="meters" name="Still to batch" />
                <ShareList parts={reasons.map((reason) => ({ key: reason.key, label: reason.label, color: reason.color, value: toCount(totals[reason.key]) }))} />
              </div>
            </Card>
          </div>
        </>
      ) : (
        <QuietLine>No CAT meter from Sales is still to batch.</QuietLine>
      )}
      {otherText ? <QuietLine>{otherText}</QuietLine> : null}
      {found ? (
        <QuietLine>
          <strong style={styles.quietStrong}>{formatNumber(found)} more CAT {plural(found, "meter", "meters")}</strong>
          {found === 1
            ? " is in no batch because it was already found (Completed). It needs no batch, so it is not counted above."
            : " are in no batch because they were already found (Completed). They need no batch, so they are not counted above."}
        </QuietLine>
      ) : null}
      {unclear ? (
        <QuietLine>
          {unclear === 1
            ? "1 CAT meter has an unclear batch link (in more than one batch, or naming a batch that does not exist). It is not counted above; the office checks it."
            : `${formatNumber(unclear)} CAT meters have an unclear batch link (in more than one batch, or naming a batch that does not exist). They are not counted above; the office checks them.`}
        </QuietLine>
      ) : null}
      {fencesSkipped ? (
        <QuietLine>
          {fencesSkipped === 1
            ? "1 geofence could not be read, so it was not used for “GPS, inside a geofence already drawn”."
            : `${formatNumber(fencesSkipped)} geofences could not be read, so they were not used for “GPS, inside a geofence already drawn”.`}
        </QuietLine>
      ) : null}
    </Panel>
  );
}

const styles = {
  page: { display: "flex", flexDirection: "column", gap: 24, minWidth: 0, color: INK, fontFamily: "Arial, Helvetica, sans-serif" },
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" },
  headerText: { minWidth: 0, flex: "1 1 320px" },
  eyebrow: { margin: 0, color: "#2563eb", fontSize: 12, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" },
  title: { margin: "8px 0 6px", fontSize: 30, fontWeight: 900, color: INK },
  subtitle: { margin: 0, color: MUTED, fontSize: 14, lineHeight: 1.5, maxWidth: 780 },
  headerSide: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 },
  readRow: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" },
  readAt: { fontSize: 12, color: MUTED, fontWeight: 700 },
  secondaryButton: { display: "inline-flex", alignItems: "center", justifyContent: "center", border: "1px solid #2563eb", borderRadius: 14, background: "#eff6ff", color: "#1d4ed8", padding: "11px 16px", fontWeight: 900, fontSize: 15, textDecoration: "none", whiteSpace: "nowrap" },
  plainButton: { display: "inline-flex", alignItems: "center", justifyContent: "center", border: "1px solid #cbd5e1", borderRadius: 12, background: "#ffffff", color: "#475569", padding: "7px 12px", fontWeight: 900, fontSize: 13, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" },
  disabledButton: { opacity: 0.55, cursor: "not-allowed" },
  loadingPanel: { display: "flex", alignItems: "center", gap: 14, background: "#ffffff", border: `1px solid ${LINE}`, borderRadius: 24, padding: "22px 24px" },
  spinner: { width: 28, height: 28, borderWidth: 3 },
  loadingTitle: { fontSize: 15, color: INK },
  loadingText: { margin: "4px 0 0", fontSize: 13, color: MUTED },
  errorNotice: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: 14, border: "1px solid #fecaca", borderRadius: 16, background: "#fef2f2", color: "#991b1b", fontSize: 13, fontWeight: 800 },
  tryAgainButton: { border: "1px solid #fca5a5", borderRadius: 12, background: "#ffffff", color: "#991b1b", padding: "8px 14px", fontWeight: 900, fontSize: 13, fontFamily: "inherit", cursor: "pointer" },
  panel: { background: "#ffffff", border: `1px solid ${LINE}`, borderRadius: 24, padding: "22px clamp(14px, 2.5vw, 24px)", display: "flex", flexDirection: "column", gap: 18, minWidth: 0 },
  panelTitle: { margin: 0, fontSize: 18, fontWeight: 900, color: INK },
  panelSubtitle: { margin: "6px 0 0", fontSize: 13, color: MUTED },
  tiles: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: 12 },
  tile: { background: "#ffffff", border: `1px solid ${LINE}`, borderRadius: 18, padding: 16 },
  tileLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, color: MUTED, marginBottom: 8 },
  tileValue: { fontSize: 28, color: INK, fontVariantNumeric: "tabular-nums" },
  cardRow: { display: "flex", flexWrap: "wrap", gap: 16, minWidth: 0 },
  card: { background: "#ffffff", border: `1px solid ${LINE}`, borderRadius: 18, padding: "18px clamp(14px, 2vw, 20px)", display: "flex", flexDirection: "column", gap: 16, minWidth: 0, boxSizing: "border-box" },
  cardTitle: { margin: 0, fontSize: 14, fontWeight: 900, color: INK },
  donutBeside: { display: "flex", alignItems: "center", justifyContent: "center", gap: "20px 36px", flexGrow: 1, flexWrap: "wrap" },
  donutRow: { display: "flex", justifyContent: "space-around", gap: 16, flexWrap: "wrap" },
  donutColumn: { display: "flex", flexDirection: "column", alignItems: "center", gap: 12 },
  donutName: { fontSize: 13, color: INK },
  donutStack: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, flexGrow: 1 },
  teamDonuts: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 250px), 1fr))", gap: "22px 16px" },
  teamDonut: { display: "flex", alignItems: "center", gap: 14, minWidth: 0 },
  teamDonutText: { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 },
  tableFrame: { border: `1px solid ${LINE}`, borderRadius: 14, overflowX: "auto", maxWidth: "100%" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { padding: "10px 12px", fontSize: 11, fontWeight: 900, color: INK, background: PAGE, borderBottom: `1px solid ${LINE}`, verticalAlign: "bottom" },
  td: { padding: "11px 12px", fontSize: 13, color: INK, borderBottom: `1px solid ${LINE}`, fontVariantNumeric: "tabular-nums" },
  totalRow: { background: PAGE },
  quietLine: { margin: 0, padding: "12px 14px", borderRadius: 12, background: PAGE, border: `1px solid ${LINE}`, fontSize: 13, color: MUTED },
  quietStrong: { color: INK },
};
