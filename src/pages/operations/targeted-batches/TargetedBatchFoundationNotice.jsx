/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { Link } from "react-router-dom";

export default function TargetedBatchFoundationNotice({
  eyebrow,
  title,
  description,
  primaryAction = null,
  secondaryAction = null,
  children = null,
}) {
  return (
    <section style={styles.card}>
      <div>
        <p style={styles.eyebrow}>{eyebrow}</p>
        <h2 style={styles.title}>{title}</h2>
        <p style={styles.description}>{description}</p>
      </div>

      {children ? <div style={styles.content}>{children}</div> : null}

      {primaryAction || secondaryAction ? (
        <div style={styles.actions}>
          {primaryAction ? (
            <Link to={primaryAction.to} style={styles.primaryLink}>
              {primaryAction.label}
            </Link>
          ) : null}
          {secondaryAction ? (
            <Link to={secondaryAction.to} style={styles.secondaryLink}>
              {secondaryAction.label}
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

const styles = {
  card: {
    display: "grid",
    gap: 18,
    padding: 24,
    border: "1px solid #e2e8f0",
    borderRadius: 24,
    background: "#ffffff",
    boxShadow: "0 16px 38px rgba(15, 23, 42, 0.07)",
  },
  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  title: {
    margin: "8px 0 0",
    color: "#0f172a",
    fontSize: 28,
  },
  description: {
    margin: "10px 0 0",
    maxWidth: 840,
    color: "#64748b",
    lineHeight: 1.55,
  },
  content: {
    minWidth: 0,
  },
  actions: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },
  primaryLink: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    background: "#0f172a",
    color: "#ffffff",
    padding: "10px 14px",
    fontSize: 13,
    fontWeight: 900,
    textDecoration: "none",
  },
  secondaryLink: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #cbd5e1",
    borderRadius: 12,
    background: "#f8fafc",
    color: "#0f172a",
    padding: "10px 14px",
    fontSize: 13,
    fontWeight: 900,
    textDecoration: "none",
  },
};
