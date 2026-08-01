/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useMemo } from "react";
import { useSelector } from "react-redux";

import { selectTargetedBatchDraft } from "../../redux/targetedBatchDraftSlice";
import {
  getTargetedBatchDraftView,
  TARGETED_BATCH_COLLECTIONS,
} from "../../redux/targetedBatchDraftModel";
import TargetedBatchFoundationNotice from "./targeted-batches/TargetedBatchFoundationNotice";

export default function TargetedBatchDashboardPage() {
  const draft = useSelector(selectTargetedBatchDraft);
  const currentDraft = useMemo(
    () => getTargetedBatchDraftView(draft),
    [draft],
  );

  return (
    <section style={styles.page}>
      <TargetedBatchFoundationNotice
        eyebrow="Operations / TB Dashboard"
        title="Targeted Batch Dashboard"
        description="Package 1 establishes the overall monitoring route and frontend shell. Live batch cards will be connected only after the tb_uploads parent summaries and tb_rows candidate truth are available from the backend."
        primaryAction={{
          label: "Open TB Uploads",
          to: "/operations/targeted-batches",
        }}
        secondaryAction={
          currentDraft
            ? {
                label: "Review Current Draft",
                to: "/operations/targeted-batches/draft",
              }
            : null
        }
      >
        <div style={styles.grid}>
          <InfoCard
            label="Parent collection"
            value={TARGETED_BATCH_COLLECTIONS.uploads}
          />
          <InfoCard
            label="Row truth collection"
            value={TARGETED_BATCH_COLLECTIONS.rows}
          />
          <InfoCard
            label="Frontend draft"
            value={currentDraft ? currentDraft.status : "NONE"}
          />
        </div>

        <div style={styles.notice}>
          No Firestore query or write is introduced by this page. Validation,
          allocation, acceptance, premise, meter-discovery and completion metrics
          remain intentionally unpopulated until backend integration.
        </div>
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
  grid: {
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
    fontSize: 16,
    overflowWrap: "anywhere",
  },
  notice: {
    marginTop: 14,
    padding: 14,
    border: "1px solid #bfdbfe",
    borderRadius: 16,
    background: "#eff6ff",
    color: "#1e3a8a",
    lineHeight: 1.5,
    fontSize: 13,
    fontWeight: 750,
  },
};
