import { Link } from "react-router-dom";

const operationModules = [
  {
    title: "TRN BGO Register",
    icon: "TR",
    description:
      "Upload, validate, and manage bulk transaction batches (disconnections, readings, inspections) for BGO field execution.",
    path: "/operations/trn-bgo",
    status: "Active",
    active: true,
  },
  {
    title: "TB Register",
    icon: "TB",
    description:
      "Targeted Batches register for field campaigns, surveys, and targeted meter work.",
    path: "/operations/targeted-batches",
    status: "Active",
    active: true,
  },
  {
    title: "MD BGO Register",
    icon: "MD",
    description:
      "Geofence-based Meter Discovery batch planning, ERF selection, and field allocation.",
    path: "/operations/bgo",
    status: "Active",
    active: true,
  },
  {
    title: "Dashboard",
    icon: "DB",
    description:
      "Central operational control dashboard monitoring TB, BGO, and ITO field progress.",
    path: "/operations/dashboard",
    status: "Active",
    active: true,
  },
  {
    title: "Operational Teams",
    icon: "Op",
    description:
      "Manage teams for allocation, assignment, and field execution grouping.",
    path: "/operations/teams",
    status: "Active",
    active: true,
  },
  {
    title: "Geo-Fences",
    icon: "Ge",
    description:
      "Manage operational geospatial work areas for planning and batch work.",
    path: "/operations/geo-fences",
    status: "Active",
    active: true,
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
        <div style={styles.cardIcon}>{module.icon || module.title.slice(0, 2)}</div>
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
