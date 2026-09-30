import { formatNumber } from "../targetedBatchUtils";
import { tbRowsStyles as styles } from "./targetedBatchRowsStyles";

const SUMMARY_ITEMS = [
  ["Total Rows", "total", ""],
  ["Not Started", "notStarted", "Not Started"],
  ["In Progress", "inProgress", "In Progress"],
  ["Completed", "completed", "Completed"],
];

export default function TargetedBatchRowsSummary({ summary, selected = "", onSelect }) {
  return <div style={styles.summaryGrid} role="group" aria-label="Filter rows by status">
    {SUMMARY_ITEMS.map(([label, key, value]) => <button
      key={key}
      type="button"
      aria-pressed={selected === value}
      onClick={() => onSelect(value)}
      style={{ ...styles.summaryCard, ...(selected === value ? styles.summaryCardSelected : {}) }}
    >
      <span style={styles.summaryLabel}>{label}</span>
      <strong style={styles.summaryValue}>{formatNumber(summary[key])}</strong>
      <span style={styles.summaryHint}>{selected === value ? "Selected" : value ? "Filter rows" : "All statuses"}</span>
    </button>)}
  </div>;
}
