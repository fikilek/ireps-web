import { formatNumber } from "../salesUtils";
import "./NonGpsKpi.css";

export default function NonGpsBatchingSummary({ counters = {} }) {
  return (
    <section aria-label="Targeted Batching" className="non-gps-kpi-section non-gps-kpi-section--batching">
      <p className="non-gps-kpi-heading">
        TARGETED BATCHING
      </p>
      <div className="non-gps-kpi-grid non-gps-kpi-grid--batching">
        {[["Batchable", counters.batchable], ["Not Batchable", counters.notBatchable]].map(([label, value]) => (
          <div key={label} className="non-gps-kpi-card">
            <span className="non-gps-kpi-label">{label}</span>
            <strong className="non-gps-kpi-value">{formatNumber(value || 0)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
