import { Link } from "react-router-dom";

export default function RegistryLandingPage() {
  return (
    <section className="panel">
      <p className="eyebrow">Registries</p>

      <h1>iREPS Registry Read Models</h1>

      <p className="muted">
        Backend-shaped operational registry data for wards, ERFs, premises, and
        meters.
      </p>

      <div className="placeholder-grid">
        <Link className="module-card" to="/registries/wards">
          <h3>Ward Registry</h3>
          <p className="muted">
            Ward-level operational counts and LM scope visibility.
          </p>
        </Link>
        <Link className="module-card" to="/registries/erfs">
          <h3>ERF Registry</h3>
          <p className="muted">
            Browse ERFs by ward with lazy loading, or find a specific ERF across
            the active LM.
          </p>
        </Link>

        <Link className="module-card" to="/registries/premises">
          <h3>Premise Registry</h3>
          <p className="muted">
            Ward-scoped premise rows linked to ERFs, property types, occupancy,
            and meter counts.
          </p>
        </Link>

        <Link className="module-card" to="/registries/meters">
          <h3>Meter Registry</h3>
          <p className="muted">
            Ward-scoped meter rows linked to ERFs, premises, meter type, and
            visibility.
          </p>
        </Link>
      </div>
    </section>
  );
}
