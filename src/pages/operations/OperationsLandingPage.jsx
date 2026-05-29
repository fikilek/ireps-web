import { Link } from "react-router-dom";

const operationModules = [
  {
    title: "TC Uploads",
    description:
      "Upload, validate, and prepare TRN candidate rows before BGO consumes them.",
    path: "/operations/tc-uploads",
    status: "Active",
    active: true,
  },
  {
    title: "BGO",
    description:
      "Create bulk operation TRNs from validated TC rows and geofence scope.",
    path: "/operations/bgo",
    status: "Coming Soon",
    active: false,
  },
  {
    title: "Operational Teams",
    description:
      "Manage teams for allocation, assignment, and field execution grouping.",
    path: "/operations/teams",
    status: "Coming Soon",
    active: false,
  },
  {
    title: "Geo-Fences",
    description:
      "Manage operational geospatial work areas for planning and batch work.",
    path: "/operations/geo-fences",
    status: "Coming Soon",
    active: false,
  },
  {
    title: "WMS Dashboard",
    description:
      "Monitor office-issued workorders, activity, acceptance, and completion.",
    path: "/operations/wms-dashboard",
    status: "Coming Soon",
    active: false,
  },
];

export default function OperationsLandingPage() {
  return (
    <section style={styles.page}>
      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Operations</p>
          <h2 style={styles.title}>Operations Control Centre</h2>
          <p style={styles.subtitle}>
            Plan, prepare, validate, and monitor operational work before it
            reaches field execution.
          </p>
        </div>
      </div>

      <div style={styles.notice}>
        <strong>TC Uploads v1:</strong> TC prepares candidate rows for BGO. TC
        does not create TRNs and does not issue workorders.
      </div>

      <div style={styles.grid}>
        {operationModules.map((module) => (
          <OperationCard key={module.title} module={module} />
        ))}
      </div>
    </section>
  );
}

function OperationCard({ module }) {
  const cardContent = (
    <>
      <div style={styles.cardTopRow}>
        <div style={styles.cardIcon}>{module.title.slice(0, 2)}</div>
        <span
          style={{
            ...styles.statusBadge,
            ...(module.active ? styles.activeBadge : styles.futureBadge),
          }}
        >
          {module.status}
        </span>
      </div>

      <h3 style={styles.cardTitle}>{module.title}</h3>
      <p style={styles.cardText}>{module.description}</p>

      <div style={styles.cardFooter}>
        <span>{module.active ? "Open module" : "Preview route"}</span>
        <span>→</span>
      </div>
    </>
  );

  return (
    <Link
      to={module.path}
      style={{
        ...styles.card,
        ...(module.active ? styles.activeCard : styles.futureCard),
      }}
    >
      {cardContent}
    </Link>
  );
}

const styles = {
  page: {
    padding: 24,
  },
  header: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 24,
    padding: 24,
    marginBottom: 16,
  },
  eyebrow: {
    margin: 0,
    fontSize: 12,
    fontWeight: 900,
    color: "#2563eb",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  title: {
    margin: "8px 0 8px",
    fontSize: 28,
    color: "#0f172a",
  },
  subtitle: {
    margin: 0,
    maxWidth: 760,
    color: "#64748b",
    lineHeight: 1.6,
  },
  notice: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1e3a8a",
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    fontSize: 14,
    lineHeight: 1.5,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 16,
  },
  card: {
    display: "block",
    textDecoration: "none",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 22,
    padding: 18,
    color: "#0f172a",
    boxShadow: "0 10px 25px rgba(15, 23, 42, 0.05)",
  },
  activeCard: {
    opacity: 1,
  },
  futureCard: {
    opacity: 0.82,
  },
  cardTopRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 16,
  },
  cardIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#eef2ff",
    color: "#3730a3",
    fontWeight: 900,
  },
  statusBadge: {
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 900,
  },
  activeBadge: {
    background: "#dcfce7",
    color: "#166534",
  },
  futureBadge: {
    background: "#f1f5f9",
    color: "#64748b",
  },
  cardTitle: {
    margin: "0 0 8px",
    fontSize: 17,
    color: "#0f172a",
  },
  cardText: {
    margin: 0,
    minHeight: 66,
    color: "#64748b",
    fontSize: 13,
    lineHeight: 1.5,
  },
  cardFooter: {
    marginTop: 18,
    paddingTop: 14,
    borderTop: "1px solid #e2e8f0",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    color: "#2563eb",
    fontSize: 13,
    fontWeight: 900,
  },
};
