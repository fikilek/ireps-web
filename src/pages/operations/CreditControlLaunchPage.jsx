/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
// DR-R001 section 3: the window where a disconnection or a reconnection is
// issued — the meter and its history on one side, the map and the field
// workers on the other.
//
// STEP 3 BUILDS THAT WINDOW. This page stands in its place so the chain from
// the Meter Registry can be walked and tested now: the guard has already
// passed by the time this opens, and it shows which meter and which work were
// asked for.
import { Link, useParams } from "react-router-dom";

import { useGetMeterByIdQuery } from "../../redux/creditControlApi";

const WORK_LABELS = {
  disconnect: "Disconnection",
  reconnect: "Reconnection",
};

export default function CreditControlLaunchPage() {
  const { astId, work } = useParams();
  const { data: meter, isLoading } = useGetMeterByIdQuery(astId);

  const workLabel = WORK_LABELS[String(work || "").toLowerCase()] || "Work";

  return (
    <section className="page">
      <header style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Credit control</div>
          <h1 style={styles.title}>
            {workLabel} · {meter?.ast?.astData?.astNo || astId}
          </h1>
          <p className="muted" style={styles.sub}>
            {isLoading
              ? "Reading the meter…"
              : meter?.accessData?.premise?.address || "NAv"}
          </p>
        </div>

        <Link className="text-link" to="/registries/meters">
          ← Back to the Meter Registry
        </Link>
      </header>

      <div style={styles.card}>
        <h2 style={styles.cardTitle}>This meter can be worked on</h2>
        <p style={styles.cardText}>
          The meter and the registration that created it agree, so this
          {` ${workLabel.toLowerCase()} `}
          can be issued. The screen that issues it — the map with the ERF, the
          premise and the meter, the field workers with their distances and
          whether they are moving, and the window that sends the work to one of
          them — is the next step of this work.
        </p>
        <dl style={styles.facts}>
          <div style={styles.fact}>
            <dt style={styles.factLabel}>Meter</dt>
            <dd style={styles.factValue}>
              {meter?.ast?.astData?.astNo || "NAv"}
            </dd>
          </div>
          <div style={styles.fact}>
            <dt style={styles.factLabel}>Status</dt>
            <dd style={styles.factValue}>{meter?.status?.state || "NAv"}</dd>
          </div>
          <div style={styles.fact}>
            <dt style={styles.factLabel}>ERF</dt>
            <dd style={styles.factValue}>
              {meter?.accessData?.erfNo || "NAv"}
            </dd>
          </div>
          <div style={styles.fact}>
            <dt style={styles.factLabel}>Disconnections</dt>
            <dd style={styles.factValue}>{meter?.counts?.disconnections || 0}</dd>
          </div>
          <div style={styles.fact}>
            <dt style={styles.factLabel}>Reconnections</dt>
            <dd style={styles.factValue}>{meter?.counts?.reconnections || 0}</dd>
          </div>
          <div style={styles.fact}>
            <dt style={styles.factLabel}>No Access</dt>
            <dd style={styles.factValue}>{meter?.counts?.noAccess || 0}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

const styles = {
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "1rem",
    flexWrap: "wrap",
    marginBottom: "1rem",
  },
  eyebrow: {
    fontSize: "0.72rem",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#b45309",
  },
  title: { margin: "0.15rem 0 0", fontSize: "1.35rem" },
  sub: { margin: "0.25rem 0 0" },
  card: {
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    background: "#fff",
    padding: "1rem 1.1rem",
    maxWidth: "720px",
  },
  cardTitle: { margin: "0 0 0.4rem", fontSize: "1.05rem" },
  cardText: { margin: "0 0 0.9rem", lineHeight: 1.55 },
  facts: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "0.75rem",
    margin: 0,
  },
  fact: { margin: 0 },
  factLabel: {
    fontSize: "0.7rem",
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "#64748b",
  },
  factValue: {
    margin: "0.15rem 0 0",
    fontSize: "1rem",
    fontVariantNumeric: "tabular-nums",
  },
};
