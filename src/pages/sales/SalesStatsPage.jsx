export default function SalesStatsPage() {
  return (
    <section className="panel">
      <p className="eyebrow">Sales</p>
      <h1>Sales Stats</h1>

      <p className="muted">
        This page will provide aggregated Sales and Targeted Batch analytics,
        trends, performance indicators and visual reporting.
      </p>

      <div className="placeholder-grid">
        <div className="placeholder-card">
          <h3>Sales Performance</h3>
          <p className="muted">
            Summarise meters, vending activity, targeting categories and
            monthly trends.
          </p>
        </div>

        <div className="placeholder-card">
          <h3>Field Performance</h3>
          <p className="muted">
            Analyse completion, premise discovery, meter discovery and
            No Access rates.
          </p>
        </div>

        <div className="placeholder-card">
          <h3>Charts and Comparisons</h3>
          <p className="muted">
            Compare wards, teams, service providers, sales periods and
            Targeted Batch outcomes.
          </p>
        </div>
      </div>
    </section>
  );
}
