/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useSelector } from "react-redux";

import { selectTargetedBatchDraft } from "../../redux/targetedBatchDraftSlice";
import { getTargetedBatchDraftView } from "../../redux/targetedBatchDraftModel";
import TargetedBatchFoundationNotice from "./targeted-batches/TargetedBatchFoundationNotice";
import { formatNumber } from "./targeted-batches/targetedBatchUtils";

export default function TargetedBatchDetailDashboardPage() {
  const { tbId = "" } = useParams();
  const draft = useSelector(selectTargetedBatchDraft);
  const currentDraft = useMemo(
    () => getTargetedBatchDraftView(draft),
    [draft],
  );
  const draftMatchesRoute = currentDraft?.id === tbId;

  return (
    <section style={styles.page}>
      <TargetedBatchFoundationNotice
        eyebrow="Operations / TB Dashboard / Batch"
        title={tbId || "Targeted Batch Dashboard"}
        description="Package 1 establishes the individual Targeted Batch dashboard route. Exact candidate monitoring will later be read from tb_rows and reconciled to the tb_uploads parent summary."
        primaryAction={{
          label: "Back to TB Dashboard",
          to: "/operations/tb-dashboard",
        }}
        secondaryAction={{
          label: "Open TB Rows",
          to: `/operations/targeted-batches/${encodeURIComponent(tbId)}`,
        }}
      >
        {draftMatchesRoute ? (
          <div style={styles.previewGrid}>
            <InfoCard label="Source" value={currentDraft.source.label} />
            <InfoCard
              label="Municipality"
              value={`${currentDraft.scope.lmPcode || "NAv"} · ${currentDraft.scope.lmName || "NAv"}`}
            />
            <InfoCard label="Draft state" value={currentDraft.status} />
            <InfoCard
              label="Display rows"
              value={formatNumber(currentDraft.displayRows.length)}
            />
          </div>
        ) : (
          <div style={styles.emptyNotice}>
            No matching frontend draft is currently available for this TB ID.
            Permanent dashboard data is not connected in Package 1.
          </div>
        )}
      </TargetedBatchFoundationNotice>
    </section>
  );
}

function InfoCard({ label, value }) {
  return (
    <article style={styles.infoCard}>
      <span style={styles.infoLabel}>{label}</span>
      <strong style={styles.infoValue}>{value}</strong>
    </article>
  );
}

const styles = {
  page: {
    padding: 24,
  },
  previewGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: 12,
  },
  infoCard: {
    display: "grid",
    gap: 6,
    padding: 14,
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    background: "#f8fafc",
  },
  infoLabel: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  infoValue: {
    color: "#0f172a",
    fontSize: 15,
    overflowWrap: "anywhere",
  },
  emptyNotice: {
    padding: 14,
    border: "1px dashed #cbd5e1",
    borderRadius: 16,
    background: "#f8fafc",
    color: "#64748b",
    lineHeight: 1.5,
    fontWeight: 750,
  },
};
