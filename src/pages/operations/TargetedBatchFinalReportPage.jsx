/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { Link, useParams } from "react-router-dom";
import { useSelector } from "react-redux";

import {
  formatCurrencyFromCents,
  formatDateTime,
  formatNumber,
} from "./targeted-batches/targetedBatchUtils";

export default function TargetedBatchFinalReportPage() {
  const { tbId } = useParams();
  const draft = useSelector((state) => state.targetedBatchDraft?.draft || null);

  const decodedTbId = decodeURIComponent(tbId || "");
  const draftMatchesRoute = draft?.id === decodedTbId;
  const rows =
    draftMatchesRoute && Array.isArray(draft?.rows) ? draft.rows : [];
  const totalSalesC = rows.reduce(
    (total, row) => total + Number(row?.totalSalesC || 0),
    0,
  );

  if (!draftMatchesRoute) {
    return (
      <section style={styles.page}>
        <Link to="/operations/targeted-batches" style={styles.backLink}>
          ← Back to TB Uploads
        </Link>

        <div style={styles.errorNotice}>
          <strong>TB upload not available</strong>
          <p style={styles.noticeText}>
            The requested TB ID is not present in the current Redux draft.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section style={styles.page}>
      <div style={styles.topActionRow}>
        <Link
          to={`/operations/targeted-batches/${encodeURIComponent(draft.id)}`}
          style={styles.backLink}
        >
          ← Back to TB Rows
        </Link>
      </div>

      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Operations / TB Final Report</p>
          <h2 style={styles.title}>TB Final Report</h2>
          <p style={styles.subtitle}>{draft.id}</p>
        </div>

        <span style={styles.draftBadge}>DRAFT</span>
      </div>

      <div style={styles.noticePanel}>
        <strong>Frontend draft report</strong>
        <p style={styles.noticeText}>
          This report currently summarizes the frontend TB draft. The final
          authoritative report will be produced from the permanent backend
          Targeted Batch and its assessed rows.
        </p>
      </div>

      <div style={styles.infoGrid}>
        <InfoCard label="TB ID" value={draft.id} />
        <InfoCard label="Source" value={draft.sourceLabel || draft.sourceType} />
        <InfoCard
          label="LM"
          value={`${draft.lmPcode || "NAv"} · ${draft.lmName || "NAv"}`}
        />
        <InfoCard label="Created" value={formatDateTime(draft.createdAt)} />
        <InfoCard label="Total Rows" value={formatNumber(rows.length)} />
        <InfoCard
          label="Selected Sales Value"
          value={formatCurrencyFromCents(totalSalesC)}
        />
      </div>
    </section>
  );
}

function InfoCard({ label, value }) {
  return (
    <article style={styles.infoCard}>
      <span style={styles.infoLabel}>{label}</span>
      <strong style={styles.infoValue}>{value || "NAv"}</strong>
    </article>
  );
}

const styles = {
  page: {
    padding: 24,
  },
  topActionRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  backLink: {
    color: "#1d4ed8",
    fontWeight: 900,
    textDecoration: "none",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 18,
    flexWrap: "wrap",
  },
  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  title: {
    margin: "8px 0 6px",
    fontSize: 30,
    color: "#0f172a",
  },
  subtitle: {
    margin: 0,
    color: "#64748b",
  },
  draftBadge: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    padding: "7px 10px",
    background: "#fef3c7",
    color: "#92400e",
    fontSize: 11,
    fontWeight: 900,
  },
  noticePanel: {
    padding: 18,
    marginBottom: 16,
    border: "1px solid #bfdbfe",
    borderRadius: 18,
    background: "#eff6ff",
    color: "#1e3a8a",
  },
  noticeText: {
    margin: "8px 0 0",
    lineHeight: 1.55,
  },
  infoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: 12,
  },
  infoCard: {
    padding: 14,
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    background: "#ffffff",
  },
  infoLabel: {
    display: "block",
    marginBottom: 6,
    color: "#64748b",
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  infoValue: {
    display: "block",
    color: "#0f172a",
    fontSize: 14,
    lineHeight: 1.4,
    wordBreak: "break-word",
  },
  errorNotice: {
    marginTop: 16,
    padding: 18,
    border: "1px solid #fecaca",
    borderRadius: 18,
    background: "#fef2f2",
    color: "#991b1b",
  },
};
