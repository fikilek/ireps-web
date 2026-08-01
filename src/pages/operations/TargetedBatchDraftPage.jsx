/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { Link, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";

import {
  clearTargetedBatchDraft,
  confirmTargetedBatchDraft,
  reopenTargetedBatchDraft,
  selectTargetedBatchDraft,
} from "../../redux/targetedBatchDraftSlice";
import TargetedBatchDraftReview from "./targeted-batches/TargetedBatchDraftReview";
import { downloadTargetedBatchDraft } from "./targeted-batches/targetedBatchUtils";

export default function TargetedBatchDraftPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const draft = useSelector(selectTargetedBatchDraft);

  function handleClearDraft() {
    const confirmed = window.confirm(
      "Clear the current Targeted Batch frontend draft? This does not delete any Firestore data.",
    );

    if (!confirmed) return;

    dispatch(clearTargetedBatchDraft());
    navigate("/operations/targeted-batches", { replace: true });
  }

  return (
    <section style={styles.page}>
      <div style={styles.backRow}>
        <Link to="/operations/targeted-batches" style={styles.backLink}>
          ← Back to TB Uploads
        </Link>
        <Link to="/sales" style={styles.backLink}>
          Open Prepaid Sales
        </Link>
      </div>

      {!draft ? (
        <div style={styles.emptyCard}>
          <p style={styles.eyebrow}>Targeted Batch Draft</p>
          <h2 style={styles.title}>No frontend draft is available</h2>
          <p style={styles.description}>
            Start from Prepaid Sales or upload a controlled TB CSV file. Package
            1 creates the common draft route but does not write to Firestore.
          </p>
          <div style={styles.actions}>
            <Link to="/operations/targeted-batches" style={styles.primaryLink}>
              Open TB Uploads
            </Link>
            <Link to="/sales" style={styles.secondaryLink}>
              Open Prepaid Sales
            </Link>
          </div>
        </div>
      ) : (
        <TargetedBatchDraftReview
          draft={draft}
          onClear={handleClearDraft}
          onDownload={() => downloadTargetedBatchDraft(draft)}
          onConfirm={() => dispatch(confirmTargetedBatchDraft())}
          onReopen={() => dispatch(reopenTargetedBatchDraft())}
        />
      )}
    </section>
  );
}

const styles = {
  page: {
    display: "grid",
    gap: 16,
    padding: 24,
    minWidth: 0,
  },
  backRow: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },
  backLink: {
    display: "inline-flex",
    alignItems: "center",
    border: "1px solid #cbd5e1",
    borderRadius: 999,
    background: "#ffffff",
    color: "#0f172a",
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 900,
    textDecoration: "none",
  },
  emptyCard: {
    padding: 24,
    border: "1px dashed #cbd5e1",
    borderRadius: 22,
    background: "#f8fafc",
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
    fontSize: 24,
  },
  description: {
    margin: "10px 0 0",
    maxWidth: 760,
    color: "#64748b",
    lineHeight: 1.55,
  },
  actions: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 18,
  },
  primaryLink: {
    display: "inline-flex",
    borderRadius: 12,
    background: "#2563eb",
    color: "#ffffff",
    padding: "10px 14px",
    fontWeight: 900,
    textDecoration: "none",
  },
  secondaryLink: {
    display: "inline-flex",
    border: "1px solid #cbd5e1",
    borderRadius: 12,
    background: "#ffffff",
    color: "#0f172a",
    padding: "10px 14px",
    fontWeight: 900,
    textDecoration: "none",
  },
};
