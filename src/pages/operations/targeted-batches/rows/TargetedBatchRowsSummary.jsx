/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { formatNumber } from "../targetedBatchUtils";
import { tbRowsStyles as styles } from "./targetedBatchRowsStyles";

const SUMMARY_ITEMS = [
  ["Total Rows", "total"],
  ["ACCEPT", "accepted"],
  ["REJECT", "rejected"],
  ["Allocatable", "allocatable"],
  ["Allocated", "allocated"],
  ["Premise Linked", "premiseLinked"],
  ["MD Completed", "meterDiscoveryCompleted"],
  ["Completed", "completed"],
];

export default function TargetedBatchRowsSummary({ summary }) {
  return (
    <div style={styles.summaryGrid}>
      {SUMMARY_ITEMS.map(([label, key]) => (
        <article key={key} style={styles.summaryCard}>
          <span style={styles.summaryLabel}>{label}</span>
          <strong style={styles.summaryValue}>
            {formatNumber(summary?.[key] || 0)}
          </strong>
        </article>
      ))}
    </div>
  );
}
