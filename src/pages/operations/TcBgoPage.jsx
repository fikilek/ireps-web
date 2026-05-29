import { Link, useParams } from "react-router-dom";

import { useGetTcUploadByIdQuery } from "../../redux/tcApi";

function valueOrNav(value) {
  if (value === null || value === undefined || value === "") return "NAv";
  return value;
}

function getReportStatus(upload = {}) {
  return String(
    upload?.report?.status || upload?.finalReport?.status || upload?.reportStatus || "DRAFT",
  )
    .trim()
    .toUpperCase();
}

export default function TcBgoPage() {
  const { tcId } = useParams();

  const {
    data: upload,
    isLoading,
    isError,
    error,
  } = useGetTcUploadByIdQuery(tcId);

  const errorMessage =
    error?.message || error?.data?.message || "Failed to load TC upload.";

  return (
    <section style={styles.page}>
      <div style={styles.backRow}>
        <Link to="/operations/tc-uploads" style={styles.backLink}>
          ← Back to TC Uploads
        </Link>
        <Link to={`/operations/tc-uploads/${tcId}`} style={styles.backLink}>
          Open TC Rows
        </Link>
        <Link
          to={`/operations/tc-uploads/${tcId}/final-report`}
          style={styles.backLink}
        >
          Final Report ({getReportStatus(upload)})
        </Link>
      </div>

      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Operations / TC Uploads / BGO</p>
          <h2 style={styles.title}>BGO Dummy Page</h2>
          <p style={styles.subtitle}>
            This is the clickable placeholder for Bulk Geofence Origin linked to
            the selected TC upload. We will use this page to design the live BGO
            UI before wiring child TRN creation.
          </p>
        </div>

        <span style={styles.badge}>DUMMY</span>
      </div>

      {isLoading ? <div style={styles.notice}>Loading upload context...</div> : null}
      {isError ? <div style={styles.errorNotice}>{errorMessage}</div> : null}

      <div style={styles.summaryGrid}>
        <InfoCard label="TC ID" value={tcId} />
        <InfoCard label="TRN Type" value={valueOrNav(upload?.trnType)} />
        <InfoCard label="LM" value={valueOrNav(upload?.lmPcode)} />
        <InfoCard label="Ready Rows" value={valueOrNav(upload?.readyRows)} />
        <InfoCard label="BGO State" value={valueOrNav(upload?.bgoStatus)} />
        <InfoCard label="Report" value={getReportStatus(upload)} />
      </div>

      <div style={styles.panel}>
        <div style={styles.panelHeader}>
          <div>
            <h3 style={styles.panelTitle}>BGO page design target</h3>
            <p style={styles.panelSubtitle}>
              The final BGO page will consume only READY_FOR_BGO TC rows for
              this upload and group them into BGO batches before creating WMS
              child TRNs.
            </p>
          </div>
        </div>

        <div style={styles.flowGrid}>
          <FlowCard
            number="1"
            title="TC Upload"
            text="Parent upload controls lineage and starts the BGO journey."
          />
          <FlowCard
            number="2"
            title="Ready TC Rows"
            text="Rows must be matched, eligible, geofenced, unused, and not blocked."
          />
          <FlowCard
            number="3"
            title="BGO Rows"
            text="One BGO row traces back to one original TC row and prepares work creation."
          />
          <FlowCard
            number="4"
            title="Child TRNs"
            text="BGO will create normal WMS-compatible TRNs when implementation starts."
          />
        </div>
      </div>

      <div style={styles.panel}>
        <h3 style={styles.panelTitle}>Dummy BGO register</h3>
        <p style={styles.panelSubtitle}>
          This table is only a UI placeholder. The live version will stream BGO
          batches, BGO rows, created TRNs, and usage state from Firestore.
        </p>

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <Th>Stage</Th>
                <Th>Collection / Source</Th>
                <Th>Status</Th>
                <Th>Purpose</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td>Parent</Td>
                <Td>bgo_batches</Td>
                <Td>Not implemented</Td>
                <Td>Holding batch for all BGO-ready rows from this TC upload.</Td>
              </tr>
              <tr>
                <Td>Rows</Td>
                <Td>bgo_rows</Td>
                <Td>Not implemented</Td>
                <Td>One row per TC row consumed by BGO.</Td>
              </tr>
              <tr>
                <Td>Work</Td>
                <Td>trns</Td>
                <Td>Not implemented</Td>
                <Td>Normal WMS workorders created from BGO rows.</Td>
              </tr>
              <tr>
                <Td>Report</Td>
                <Td>tc_report_rows</Td>
                <Td>Draft</Td>
                <Td>BGO/TRN section will be populated after BGO creation.</Td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function InfoCard({ label, value }) {
  return (
    <div style={styles.infoCard}>
      <span style={styles.infoLabel}>{label}</span>
      <strong style={styles.infoValue}>{value}</strong>
    </div>
  );
}

function FlowCard({ number, title, text }) {
  return (
    <div style={styles.flowCard}>
      <span style={styles.flowNumber}>{number}</span>
      <strong style={styles.flowTitle}>{title}</strong>
      <p style={styles.flowText}>{text}</p>
    </div>
  );
}

function Th({ children }) {
  return <th style={styles.th}>{children}</th>;
}

function Td({ children }) {
  return <td style={styles.td}>{children}</td>;
}

const styles = {
  page: { padding: 24 },
  backRow: { display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 },
  backLink: {
    display: "inline-flex",
    alignItems: "center",
    border: "1px solid #bfdbfe",
    borderRadius: 999,
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 900,
    textDecoration: "none",
  },
  header: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 24,
    padding: 24,
    marginBottom: 16,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  eyebrow: {
    margin: 0,
    fontSize: 12,
    fontWeight: 900,
    color: "#2563eb",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  title: { margin: "8px 0", fontSize: 28, color: "#0f172a" },
  subtitle: { margin: 0, maxWidth: 760, color: "#64748b", lineHeight: 1.6 },
  badge: {
    borderRadius: 999,
    padding: "7px 10px",
    background: "#fef3c7",
    color: "#92400e",
    fontSize: 11,
    fontWeight: 900,
  },
  notice: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1e3a8a",
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    fontWeight: 800,
  },
  errorNotice: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    fontWeight: 800,
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 12,
    marginBottom: 16,
  },
  infoCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 16,
  },
  infoLabel: {
    display: "block",
    color: "#64748b",
    fontSize: 12,
    fontWeight: 900,
    marginBottom: 8,
  },
  infoValue: { color: "#0f172a", fontSize: 20 },
  panel: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 24,
    padding: 18,
    marginBottom: 16,
  },
  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 14,
  },
  panelTitle: { margin: 0, color: "#0f172a", fontSize: 18 },
  panelSubtitle: { margin: "6px 0 0", color: "#64748b", lineHeight: 1.5 },
  flowGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
  },
  flowCard: {
    border: "1px solid #dbeafe",
    borderRadius: 18,
    background: "#f8fafc",
    padding: 16,
  },
  flowNumber: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    borderRadius: 999,
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 900,
    marginBottom: 10,
  },
  flowTitle: { display: "block", color: "#0f172a", marginBottom: 6 },
  flowText: { margin: 0, color: "#64748b", lineHeight: 1.5, fontSize: 13 },
  tableWrap: { overflowX: "auto", marginTop: 14 },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 760 },
  th: {
    textAlign: "left",
    background: "#f8fafc",
    color: "#475569",
    borderBottom: "1px solid #e2e8f0",
    padding: "12px 10px",
    fontSize: 11,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  td: {
    color: "#334155",
    borderBottom: "1px solid #f1f5f9",
    padding: "12px 10px",
    fontSize: 13,
    lineHeight: 1.5,
    verticalAlign: "top",
  },
};
