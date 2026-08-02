/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import styles from "./targetedBatchAllocationStyles";
import { valueOrNav } from "./targetedBatchAllocationUtils";

export function Badge({ children, tone = "neutral" }) {
  const toneStyle = {
    success: styles.successBadge,
    warning: styles.warningBadge,
    danger: styles.dangerBadge,
    info: styles.infoBadge,
    neutral: styles.neutralBadge,
  }[tone];

  return <span style={{ ...styles.badge, ...toneStyle }}>{children}</span>;
}

export function InfoCard({ label, value, detail }) {
  return (
    <article style={styles.infoCard}>
      <span style={styles.infoLabel}>{label}</span>
      <strong style={styles.infoValue}>{valueOrNav(value)}</strong>
      {detail ? <span style={styles.infoDetail}>{detail}</span> : null}
    </article>
  );
}

export function SummaryDetailRow({ label, value }) {
  return (
    <div style={styles.summaryDetailRow}>
      <span style={styles.summaryDetailLabel}>{label}</span>
      <strong style={styles.summaryDetailValue}>{valueOrNav(value)}</strong>
    </div>
  );
}

export function Th({ children }) {
  return <th style={styles.th}>{children}</th>;
}

export function Td({ children, colSpan, strong }) {
  return (
    <td
      colSpan={colSpan}
      style={{ ...styles.td, ...(strong ? styles.strongCell : null) }}
    >
      {children}
    </td>
  );
}

export function CodeText({ children }) {
  return <code style={styles.codeText}>{children}</code>;
}
