/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useMemo, useState } from "react";

import { formatNumber } from "../salesUtils";
import { NGP_CLASSIFICATIONS } from "../models/nonGpsBatchPlanningModel";

function classificationStyle(classification) {
  if (classification === NGP_CLASSIFICATIONS.OUTSTANDING) {
    return { background: "#eff6ff", color: "#1d4ed8" };
  }

  if (classification === NGP_CLASSIFICATIONS.ALREADY_BATCHED) {
    return { background: "#fef3c7", color: "#92400e" };
  }

  if (classification === NGP_CLASSIFICATIONS.DISCOVERED) {
    return { background: "#dcfce7", color: "#166534" };
  }

  return { background: "#f1f5f9", color: "#475569" };
}

function includesSearch(target, searchText) {
  const needle = String(searchText || "").trim().toLowerCase();
  if (!needle) return true;

  return [
    target?.canonicalAddress,
    target?.meterNo,
    target?.accountNumber,
    target?.classification,
  ].some((value) => String(value || "").toLowerCase().includes(needle));
}

export default function NonGpsStreetDetail({
  street,
  selectedIds = new Set(),
  onToggleTarget,
  onBack,
}) {
  const [searchText, setSearchText] = useState("");

  const visibleTargets = useMemo(
    () => street.targets.filter((target) => includesSearch(target, searchText)),
    [searchText, street.targets],
  );

  return (
    <section style={styles.panel}>
      <div style={styles.header}>
        <div>
          <button type="button" style={styles.backButton} onClick={onBack}>
            ← Back to streets
          </button>
          <p style={styles.eyebrow}>Street Detail</p>
          <h2 style={styles.title}>
            {street.town} / {street.streetLabel || "Unnamed street"}
          </h2>
          <p style={styles.subtitle}>
            The complete street population remains visible. Only Outstanding
            targets can be selected for the current 1–20 meter batch.
          </p>
        </div>

        <input
          type="search"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="Search meter, account or address"
          style={styles.searchInput}
        />
      </div>

      <div style={styles.summaryGrid}>
        <div style={styles.summaryCard}>
          <span style={styles.summaryLabel}>Total</span>
          <strong style={styles.summaryValue}>
            {formatNumber(street.counters.total)}
          </strong>
        </div>
        <div style={styles.summaryCard}>
          <span style={styles.summaryLabel}>Outstanding</span>
          <strong style={styles.summaryValue}>
            {formatNumber(street.counters.outstanding)}
          </strong>
        </div>
        <div style={styles.summaryCard}>
          <span style={styles.summaryLabel}>Already Batched</span>
          <strong style={styles.summaryValue}>
            {formatNumber(street.counters.alreadyBatched)}
          </strong>
        </div>
        <div style={styles.summaryCard}>
          <span style={styles.summaryLabel}>Discovered</span>
          <strong style={styles.summaryValue}>
            {formatNumber(street.counters.discovered)}
          </strong>
        </div>
      </div>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.headerCell}>Select</th>
              <th style={styles.headerCell}>Address</th>
              <th style={styles.headerCell}>Meter Number</th>
              <th style={styles.headerCell}>Account Number</th>
              <th style={styles.headerCell}>Planning Status</th>
            </tr>
          </thead>
          <tbody>
            {visibleTargets.length === 0 ? (
              <tr>
                <td colSpan={5} style={styles.emptyCell}>
                  No street targets match the current search.
                </td>
              </tr>
            ) : (
              visibleTargets.map((target) => {
                const selectable =
                  target.classification === NGP_CLASSIFICATIONS.OUTSTANDING;
                const checked = selectable && selectedIds.has(target.id);

                return (
                  <tr key={target.id}>
                    <td style={styles.bodyCell}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!selectable}
                        onChange={() => onToggleTarget?.(target)}
                        aria-label={`Select ${target.meterNo || target.canonicalAddress}`}
                        title={
                          selectable
                            ? "Select Outstanding target"
                            : `${target.classification} — not selectable`
                        }
                      />
                    </td>
                    <td style={styles.bodyCell}>
                      {target.canonicalAddress || "NAv"}
                    </td>
                    <td style={styles.bodyCell}>{target.meterNo || "NAv"}</td>
                    <td style={styles.bodyCell}>
                      {target.accountNumber || "NAv"}
                    </td>
                    <td style={styles.bodyCell}>
                      <span
                        style={{
                          ...styles.statusBadge,
                          ...classificationStyle(target.classification),
                        }}
                      >
                        {target.classification.replaceAll("_", " ")}
                      </span>
                    </td>
                  </tr>
                );
              })
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
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: "1rem",
    padding: "1rem 1.1rem",
    borderBottom: "1px solid #e2e8f0",
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
    width: "min(360px, 100%)",
    border: "1px solid #cbd5e1",
    borderRadius: "0.65rem",
    padding: "0.62rem 0.72rem",
    font: "inherit",
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "0.75rem",
    padding: "1rem 1.1rem 0",
  },
  summaryCard: {
    display: "grid",
    gap: "0.22rem",
    padding: "0.8rem",
    border: "1px solid #e2e8f0",
    borderRadius: "0.75rem",
    background: "#f8fafc",
  },
  summaryLabel: { color: "#64748b", fontSize: "0.75rem", fontWeight: 800 },
  summaryValue: { color: "#0f172a", fontSize: "1.25rem" },
  selectionBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "1rem",
    margin: "1rem 1.1rem",
    padding: "0.85rem",
    border: "1px solid #bfdbfe",
    borderRadius: "0.8rem",
    background: "#eff6ff",
    color: "#1e3a8a",
  },
  selectionHint: { display: "block", marginTop: "0.2rem", fontSize: "0.78rem" },
  selectionActions: { display: "flex", alignItems: "center", gap: "0.65rem" },
  selectionStatus: {
    borderRadius: "999px",
    padding: "0.32rem 0.58rem",
    fontSize: "0.72rem",
    fontWeight: 900,
  },
  selectionStatusReady: { background: "#dcfce7", color: "#166534" },
  selectionStatusWaiting: { background: "#e2e8f0", color: "#475569" },
  clearButton: {
    border: "1px solid #93c5fd",
    borderRadius: "0.6rem",
    background: "#ffffff",
    color: "#1d4ed8",
    padding: "0.5rem 0.7rem",
    fontWeight: 800,
    cursor: "pointer",
  },
  errorBox: {
    margin: "0 1.1rem 1rem",
    padding: "0.75rem",
    border: "1px solid #fecaca",
    borderRadius: "0.7rem",
    background: "#fef2f2",
    color: "#991b1b",
    fontSize: "0.84rem",
  },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", minWidth: "820px" },
  headerCell: {
    padding: "0.72rem 0.8rem",
    borderTop: "1px solid #e2e8f0",
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
    verticalAlign: "top",
  },
  statusBadge: {
    display: "inline-flex",
    borderRadius: "999px",
    padding: "0.3rem 0.5rem",
    fontSize: "0.7rem",
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  emptyCell: { padding: "1.25rem", textAlign: "center", color: "#64748b" },
};
