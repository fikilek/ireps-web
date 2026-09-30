// The one place an iREPS table's colours, spacing and type are written.
// A page never writes a table colour of its own: it supplies columns and rows,
// and the table looks the same everywhere (owner, 2026-09-23: "when I look at
// the table that represents sales … I mustn't even know I'm on sales table").
export const IREPS_TABLE_TOKENS = Object.freeze({
  text: "#0f172a",
  mutedText: "#475569",
  accent: "#1d4ed8",
  border: "#e2e8f0",
  filterBorder: "#cbd5f5",

  headBackground: "#eef2ff",
  bandBackground: "#e0e7ff",
  filterRowBackground: "#f8fafc",
  toolbarBackground: "#f8fafc",
  rowBackground: "#ffffff",
  stripeBackground: "#f8fafc",

  radius: 10,
  cellPadding: "10px 12px",
  fontSize: 12,
  headingFontSize: 12,
});
