import { Link, useParams } from "react-router-dom";

export default function SalesBatchReportPage() {
  const { tbId } = useParams();

  return (
    <section style={styles.page}>
      <div>
        <p style={styles.eyebrow}>Sales / Reporting / Targeted Batch</p>
        <h1 style={styles.title}>Targeted Batch Report</h1>
        <p style={styles.subtitle}>
          {tbId || "Targeted Batch"}
        </p>
      </div>

      <div style={styles.panel}>
        <h2 style={styles.panelTitle}>Field Result Rows</h2>
        <p style={styles.panelText}>
          The batch summary page is now connected. The live row-level field
          outcome table will be built here as the next controlled component.
        </p>

        <Link to="/sales/reporting" style={styles.backButton}>
          Back to Sales Reporting
        </Link>
      </div>
    </section>
  );
}

const styles = {
  page: {
    display: "grid",
    gap: 18,
  },

  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: 12,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },

  title: {
    margin: "4px 0 0",
    color: "#0f172a",
    fontSize: 30,
  },

  subtitle: {
    margin: "8px 0 0",
    color: "#475569",
    fontSize: 14,
    fontWeight: 800,
  },

  panel: {
    borderRadius: 18,
    border: "1px solid #e2e8f0",
    background: "#ffffff",
    padding: 20,
  },

  panelTitle: {
    margin: 0,
    color: "#0f172a",
    fontSize: 18,
  },

  panelText: {
    maxWidth: 720,
    color: "#64748b",
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1.6,
  },

  backButton: {
    display: "inline-flex",
    marginTop: 8,
    borderRadius: 10,
    background: "#0f172a",
    color: "#ffffff",
    padding: "9px 13px",
    fontSize: 11,
    fontWeight: 900,
    textDecoration: "none",
  },
};
