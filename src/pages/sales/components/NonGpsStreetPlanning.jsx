/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { formatNumber } from "../salesUtils";

function includesSearch(value, searchText) {
  const needle = String(searchText || "").trim().toLowerCase();
  if (!needle) return true;
  return String(value || "").toLowerCase().includes(needle);
}

function CountCell({ value }) {
  return <td style={styles.numberCell}>{formatNumber(value || 0)}</td>;
}

export default function NonGpsStreetPlanning({
  towns = [],
  selectedTownKey = "",
  searchText = "",
  onSearchTextChange,
  onOpenTown,
  onBackToTowns,
  onOpenStreet,
}) {
  const selectedTown = towns.find((town) => town.key === selectedTownKey) || null;

  if (!selectedTown) {
    const visibleTowns = towns.filter((town) =>
      includesSearch(town.town, searchText),
    );

    return (
      <section style={styles.panel}>
        <div style={styles.panelHeader}>
          <div>
            <p style={styles.eyebrow}>Street Planning</p>
            <h2 style={styles.title}>Town / Area</h2>
            <p style={styles.subtitle}>
              Open a Town / Area to view its street planning groups.
            </p>
          </div>

          <input
            type="search"
            value={searchText}
            onChange={(event) => onSearchTextChange?.(event.target.value)}
            placeholder="Search Town / Area"
            style={styles.searchInput}
          />
        </div>

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.headerCell}>Town / Area</th>
                <th style={styles.headerCell}>Streets</th>
                <th style={styles.headerCell}>Meters</th>
                <th style={styles.headerCell}>Outstanding</th>
                <th style={styles.headerCell}>Already Batched</th>
                <th style={styles.headerCell}>Discovered</th>
              </tr>
            </thead>
            <tbody>
              {visibleTowns.length === 0 ? (
                <tr>
                  <td colSpan={6} style={styles.emptyCell}>
                    No Town / Area matches the current search.
                  </td>
                </tr>
              ) : (
                visibleTowns.map((town) => (
                  <tr key={town.key}>
                    <td style={styles.bodyCell}>
                      <button
                        type="button"
                        style={styles.linkButton}
                        onClick={() => onOpenTown?.(town.key)}
                      >
                        {town.town || "NAv"}
                      </button>
                    </td>
                    <CountCell value={town.streetCount} />
                    <CountCell value={town.counters.total} />
                    <CountCell value={town.counters.outstanding} />
                    <CountCell value={town.counters.alreadyBatched} />
                    <CountCell value={town.counters.discovered} />
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  const visibleStreets = selectedTown.streets.filter((street) =>
    includesSearch(street.streetLabel, searchText),
  );

  return (
    <section style={styles.panel}>
      <div style={styles.panelHeader}>
        <div>
          <button type="button" style={styles.backButton} onClick={onBackToTowns}>
            ← Back to Town / Area
          </button>
          <p style={styles.eyebrow}>Street Planning</p>
          <h2 style={styles.title}>{selectedTown.town}</h2>
          <p style={styles.subtitle}>
            Open a street to view the complete No-GPS target population.
          </p>
        </div>

        <input
          type="search"
          value={searchText}
          onChange={(event) => onSearchTextChange?.(event.target.value)}
          placeholder="Search street"
          style={styles.searchInput}
        />
      </div>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.headerCell}>Street</th>
              <th style={styles.headerCell}>Total</th>
              <th style={styles.headerCell}>Outstanding</th>
              <th style={styles.headerCell}>Already Batched</th>
              <th style={styles.headerCell}>Discovered</th>
            </tr>
          </thead>
          <tbody>
            {visibleStreets.length === 0 ? (
              <tr>
                <td colSpan={5} style={styles.emptyCell}>
                  No street matches the current search.
                </td>
              </tr>
            ) : (
              visibleStreets.map((street) => (
                <tr key={street.key}>
                  <td style={styles.bodyCell}>
                    <button
                      type="button"
                      style={styles.linkButton}
                      onClick={() => onOpenStreet?.(street.key)}
                    >
                      {street.streetLabel || "Unnamed street"}
                    </button>
                  </td>
                  <CountCell value={street.counters.total} />
                  <CountCell value={street.counters.outstanding} />
                  <CountCell value={street.counters.alreadyBatched} />
                  <CountCell value={street.counters.discovered} />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const styles = {
  panel: {
    border: "1px solid #dbe3ef",
    borderRadius: "1rem",
    background: "#ffffff",
    overflow: "hidden",
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
  },
  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: "1rem",
    padding: "1rem 1.1rem",
    borderBottom: "1px solid #e2e8f0",
  },
  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: "0.72rem",
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  title: { margin: "0.18rem 0 0", color: "#0f172a", fontSize: "1.15rem" },
  subtitle: { margin: "0.3rem 0 0", color: "#64748b", fontSize: "0.86rem" },
  searchInput: {
    width: "min(320px, 100%)",
    border: "1px solid #cbd5e1",
    borderRadius: "0.65rem",
    padding: "0.62rem 0.72rem",
    font: "inherit",
  },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", minWidth: "760px" },
  headerCell: {
    padding: "0.72rem 0.8rem",
    borderBottom: "1px solid #dbe3ef",
    background: "#f8fafc",
    color: "#475569",
    fontSize: "0.75rem",
    textAlign: "left",
    whiteSpace: "nowrap",
  },
  bodyCell: {
    padding: "0.72rem 0.8rem",
    borderBottom: "1px solid #edf2f7",
    color: "#334155",
    fontSize: "0.84rem",
  },
  numberCell: {
    padding: "0.72rem 0.8rem",
    borderBottom: "1px solid #edf2f7",
    color: "#334155",
    fontSize: "0.84rem",
    fontVariantNumeric: "tabular-nums",
  },
  linkButton: {
    border: 0,
    padding: 0,
    background: "transparent",
    color: "#1d4ed8",
    fontWeight: 800,
    cursor: "pointer",
    textAlign: "left",
  },
  backButton: {
    border: 0,
    padding: 0,
    marginBottom: "0.55rem",
    background: "transparent",
    color: "#475569",
    fontWeight: 800,
    cursor: "pointer",
  },
  emptyCell: {
    padding: "1.25rem",
    textAlign: "center",
    color: "#64748b",
  },
};
