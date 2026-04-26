import { Link } from "react-router-dom";

export default function ReportsLandingPage() {
  return (
    <section className="panel">
      <p className="eyebrow">Reports</p>

      <h1>iREPS Operational Reports</h1>

      <p className="muted">
        TRN-derived reports for field activity, access outcomes, anomalies, and
        normalisation.
      </p>

      <div className="placeholder-grid">
        <Link className="module-card" to="/reports/no-access">
          <h3>No Access Report</h3>
          <p className="muted">
            Track field visits where access was denied, blocked, unsafe, or
            otherwise unavailable.
          </p>
        </Link>

        <Link className="module-card" to="/reports/user-activity">
          <h3>User Activity Report</h3>
          <p className="muted">
            View TRN activity totals by user, role, service provider, and team.
          </p>
        </Link>

        <Link className="module-card" to="/reports/anomaly">
          <h3>Anomaly Report</h3>
          <p className="muted">
            View daily and summary TRN anomaly counts by anomaly type and
            detail.
          </p>
        </Link>

        <Link className="module-card" to="/reports/normalisation">
          <h3>Normalisation Report</h3>
          <p className="muted">
            View daily and summary TRN normalisation actions such as disconnect,
            reconnect, fines, removals, and new installations.
          </p>
        </Link>
      </div>
    </section>
  );
}
