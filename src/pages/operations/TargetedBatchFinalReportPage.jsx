/* eslint-disable no-unused-vars -- JSX tags are used by React. */
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { useGetPermanentSalesBatchesQuery } from "../../redux/salesTargetedBatchApi";
export default function TargetedBatchFinalReportPage() {
  const { tbId } = useParams(), { activeWorkbase } = useAuth();
  const lmPcode = activeWorkbase?.lmPcode || activeWorkbase?.pcode || activeWorkbase?.id || activeWorkbase?.localMunicipalityId;
  const { data } = useGetPermanentSalesBatchesQuery({ lmPcode, tbId }, { skip: !lmPcode || !tbId });
  const batch = data?.batch;
  return <section style={styles.page}>
    <Link to="/operations/targeted-batches" style={styles.backLink}>Back to TB Register</Link>
    <h1>TB Final Report</h1><p>{tbId}</p>
    {!data?.ready ? <p role="status">{data?.error || "Loading permanent Targeted Batch…"}</p>
      : !batch ? <p>Permanent Targeted Batch unavailable.</p>
      : <div style={styles.noticePanel}><strong>{batch.finalReport?.status || "Unavailable"}</strong>
        <p>{batch.finalReport?.status === "DRAFT" ? "The final report has not been produced. This page reads the permanent batch and its TB Rows." : "Report status is supplied by the permanent Targeted Batch."}</p>
        <p>{data.rows.length} permanent rows · {batch.source?.type} · {batch.scope?.lmName}</p>
        <Link to={`/operations/targeted-batches/${encodeURIComponent(tbId)}`}>Open TB Rows</Link>
      </div>}
  </section>;
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
