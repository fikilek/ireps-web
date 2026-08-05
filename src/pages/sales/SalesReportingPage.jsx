export default function SalesReportingPage() {
  return (
    <section className="panel">
      <p className="eyebrow">Sales</p>
      <h1>Sales Reporting</h1>

      <p className="muted">
        This page will report Targeted Batch field outcomes at batch level,
        with row-level drill-down when a batch is opened.
      </p>

      <div className="placeholder-grid">
        <div className="placeholder-card">
          <h3>Targeted Batch Summary</h3>
          <p className="muted">
            One reporting row per Targeted Batch, including allocation,
            acceptance, progress and completion totals.
          </p>
        </div>

        <div className="placeholder-card">
          <h3>Field Outcomes</h3>
          <p className="muted">
            Report premise results, meter discovery, No Access attempts and
            completed field execution.
          </p>
        </div>

        <div className="placeholder-card">
          <h3>Batch Drill-down</h3>
          <p className="muted">
            Open a Targeted Batch to inspect the outcome of every sales row.
          </p>
        </div>
      </div>
    </section>
  );
}
