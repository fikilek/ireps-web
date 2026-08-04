/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { httpsCallable } from "firebase/functions";

import { functions } from "../../firebase";
import {
  clearTargetedBatchDraft,
  selectTargetedBatchDraft,
} from "../../redux/targetedBatchDraftSlice";
import TargetedBatchConfirmModal from "./targeted-batches/TargetedBatchConfirmModal";
import TargetedBatchDraftReview from "./targeted-batches/TargetedBatchDraftReview";
import { downloadTargetedBatchDraft } from "./targeted-batches/targetedBatchUtils";

export default function TargetedBatchDraftPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const draft = useSelector(selectTargetedBatchDraft);
  const [isCreating, setIsCreating] = useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [creationFeedback, setCreationFeedback] = useState(null);

  function handleClearDraft() {
    const confirmed = window.confirm(
      "Clear the current TB Draft? No permanent Targeted Batch has been created from this draft.",
    );

    if (!confirmed) return;

    dispatch(clearTargetedBatchDraft());
    navigate("/operations/targeted-batches", { replace: true });
  }

  function openConfirmModal() {
    if (!draft || isCreating) return;
    setIsConfirmModalOpen(true);
  }

  function closeConfirmModal() {
    if (isCreating) return;
    setIsConfirmModalOpen(false);
  }

  async function handleConfirmDraft() {
    if (!draft || isCreating) return;

    setIsConfirmModalOpen(false);
    setIsCreating(true);
    setCreationFeedback(null);

    try {
      const createTargetedBatch = httpsCallable(
        functions,
        "onCreateTargetedBatchCallable",
      );
      const response = await createTargetedBatch({ draft });
      const result = response?.data || {};

      if (result?.success !== true) {
        const error = new Error(
          result?.message || "Targeted Batch creation failed.",
        );
        error.code = result?.code || "TARGETED_BATCH_CREATE_FAILED";
        throw error;
      }

      if (
        String(result?.creationState || "")
          .trim()
          .toUpperCase() !== "READY"
      ) {
        const error = new Error(
          "The backend did not confirm that the Targeted Batch is READY.",
        );
        error.code = "TARGETED_BATCH_NOT_READY";
        throw error;
      }

      const createdBatches = Array.isArray(result?.batches)
        ? result.batches
            .map((batch) => ({
              tbId: String(batch?.tbId || "").trim(),
              wardPcode: String(batch?.wardPcode || "").trim(),
              wardNumber: String(batch?.wardNumber || "").trim(),
              rowCount: Number(batch?.rowCount || batch?.expectedRows || 0),
            }))
            .filter((batch) => batch.tbId)
        : [];
      const fallbackTbId = String(result?.tbId || "").trim();
      const permanentBatches =
        createdBatches.length > 0
          ? createdBatches
          : fallbackTbId
            ? [{ tbId: fallbackTbId, rowCount: Number(result?.expectedRows || 0) }]
            : [];

      if (permanentBatches.length === 0) {
        const error = new Error(
          "The backend response did not include any permanent Targeted Batch IDs.",
        );
        error.code = "TARGETED_BATCH_IDS_MISSING";
        throw error;
      }

      dispatch(clearTargetedBatchDraft());

      if (permanentBatches.length === 1) {
        navigate(
          `/operations/targeted-batches/${encodeURIComponent(
            permanentBatches[0].tbId,
          )}/allocation`,
          { replace: true },
        );
        return;
      }

      navigate("/operations/targeted-batches", {
        replace: true,
        state: {
          targetedBatchCreation: {
            success: true,
            creationGroupId: result?.creationGroupId || null,
            createdBatchCount: permanentBatches.length,
            createdRowCount: Number(result?.createdRowCount || 0),
            batches: permanentBatches,
          },
        },
      });
    } catch (error) {
      setCreationFeedback({
        type: "error",
        code:
          String(error?.code || "")
            .trim()
            .replace(/^functions\//, "")
            .toUpperCase() || "TARGETED_BATCH_CREATE_FAILED",
        message:
          String(error?.message || "").trim() ||
          "Targeted Batch creation failed.",
      });
      setIsCreating(false);
    }
  }

  return (
    <section style={styles.page}>
      <div style={styles.backRow}>
        <Link to="/operations/targeted-batches" style={styles.backLink}>
          ← Back to TB Register
        </Link>
        <Link to="/sales" style={styles.backLink}>
          Open Prepaid Sales
        </Link>
      </div>

      {!draft ? (
        <div style={styles.emptyCard}>
          <p style={styles.eyebrow}>Operations / TB Draft</p>
          <h2 style={styles.title}>No TB Draft is available</h2>
          <p style={styles.description}>
            Start from Prepaid Sales by selecting meters and opening TB Draft.
            Ward-compliant proposed batches are prepared locally from the Sales
            selection. Permanent Targeted Batches and TB Rows are created only by
            the controlled backend confirmation step.
          </p>
          <div style={styles.actions}>
            <Link to="/operations/targeted-batches" style={styles.primaryLink}>
              Open TB Register
            </Link>
            <Link to="/sales" style={styles.secondaryLink}>
              Open Prepaid Sales
            </Link>
          </div>
        </div>
      ) : (
        <TargetedBatchDraftReview
          draft={draft}
          isCreating={isCreating}
          creationFeedback={creationFeedback}
          onConfirm={openConfirmModal}
          onClear={handleClearDraft}
          onDownload={() => downloadTargetedBatchDraft(draft)}
        />
      )}

      {draft && isConfirmModalOpen ? (
        <TargetedBatchConfirmModal
          draft={draft}
          isCreating={isCreating}
          onCancel={closeConfirmModal}
          onConfirm={handleConfirmDraft}
        />
      ) : null}
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
