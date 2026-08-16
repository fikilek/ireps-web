/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useMemo, useState } from "react";

import { formatNumber } from "../salesUtils";

function includesSearch(target, searchText) {
  const needle = String(searchText || "").trim().toLowerCase();
  if (!needle) return true;

  return [
    target?.meterNo,
    target?.accountNumber,
    target?.town,
    target?.canonicalAddress,
    target?.classification,
    ...(target?.exceptionReasons || []),
  ].some((value) => String(value || "").toLowerCase().includes(needle));
}

export default function NonGpsExceptions({ exceptions = [] }) {
  const [searchText, setSearchText] = useState("");

  const visibleRows = useMemo(
    () => exceptions.filter((target) => includesSearch(target, searchText)),
    [exceptions, searchText],
  );

  return (
    <section style={styles.panel}>
      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Data Exceptions</p>
          <h2 style={styles.title}>
            Non GPS Exceptions / Unplaced ({formatNumber(exceptions.length)})
          </h2>
          <p style={styles.subtitle}>
            These records remain visible but cannot be selected. NGP does not
            edit or invent address data.
          </p>
        </div>

        <input
          type="search"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="Search meter, account or reason"
          style={styles.searchInput}
        />
      </div>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.headerCell}>Meter Number</th>
              <th style={styles.headerCell}>Account Number</th>
              <th style={styles.headerCell}>Existing Address</th>
              <th style={styles.headerCell}>Town / Area</th>
              <th style={styles.headerCell}>Classification</th>
              <th style={styles.headerCell}>Exception Reason</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={6} style={styles.emptyCell}>
                  No exceptions match the current search.
                </td>
              </tr>
            ) : (
              visibleRows.map((target) => (
                <tr key={target.id}>
                  <td style={styles.bodyCell}>{target.meterNo || "NAv"}</td>
                  <td style={styles.bodyCell}>
                    {target.accountNumber || "NAv"}
                  </td>
                  <td style={styles.bodyCell}>
                    {target.canonicalAddress || "Unresolved canonical address"}
                  </td>
                  <td style={styles.bodyCell}>{target.town || "NAv"}</td>
                  <td style={styles.bodyCell}>{target.classification || "NAv"}</td>
                  <td style={styles.bodyCell}>
                    {(target.visibilityReasons || target.exceptionReasons || []).join("; ") ||
                      "Planning data integrity exception"}
                  </td>
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
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: "1rem",
    padding: "1rem 1.1rem",
    borderBottom: "1px solid #e2e8f0",
  },
  eyebrow: {
    margin: 0,
    color: "#b45309",
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
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", minWidth: "920px" },
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
    verticalAlign: "top",
  },
  emptyCell: { padding: "1.25rem", textAlign: "center", color: "#64748b" },
};
