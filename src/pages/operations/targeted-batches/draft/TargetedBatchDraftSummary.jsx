/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import {
  formatCurrencyFromCents,
  formatNumber,
} from "../targetedBatchUtils";
import { draftReviewStyles as styles } from "./targetedBatchDraftReviewStyles";

function SummaryCard({ label, value }) {
  return (
    <div style={styles.summaryCard}>
      <span>{label}</span>
      <strong style={styles.summaryValue}>{value}</strong>
    </div>
  );
}

export default function TargetedBatchDraftSummary({
  draft,
  totalRows,
  summary,
  integrity,
}) {
  const salesSource = draft?.source?.type === "PREPAID_SALES";

  return (
    <>
      <div style={styles.summaryGrid}>
        <SummaryCard label="Draft Rows" value={formatNumber(totalRows)} />
        <SummaryCard
          label={salesSource ? "Sales All Meter IDs" : "Source Row IDs"}
          value={formatNumber(
            salesSource
              ? draft?.authoritativeIds?.salesAllMeterIds?.length
              : draft?.authoritativeIds?.uploadRowIds?.length,
          )}
        />
        <SummaryCard
          label="Selected Sales Value"
          value={formatCurrencyFromCents(summary.totalSalesC)}
        />
        <SummaryCard
          label="AST Matched"
          value={formatNumber(summary.astMatched)}
        />
        <SummaryCard
          label="AST Not Matched"
          value={formatNumber(summary.astNotMatched)}
        />
        <SummaryCard
          label="Validation"
          value={draft?.validation?.status || "DRAFT"}
        />
        <SummaryCard
          label="Selection Reason"
          value={draft?.selection?.reason || "NAv"}
        />
        <SummaryCard
          label="Confirmation Gate"
          value={integrity?.canConfirm ? "READY" : "BLOCKED"}
        />
      </div>

      {salesSource ? (
        <div style={styles.sourceNotice}>
          <strong>Sales-originated Targeted Batch</strong>
          <p style={styles.sourceNoticeParagraph}>
            The selected meters came directly from Prepaid Sales. The handoff
            preserves one authoritative Sales All Meters identity per draft row.
          </p>
          <p style={styles.sourceNoticeParagraph}>
            Sales period: {draft?.selection?.salesPeriodFrom || "NAv"} to{" "}
            {draft?.selection?.salesPeriodTo || "NAv"}. Local Municipality:{" "}
            {draft?.scope?.lmPcode || "NAv"} · {draft?.scope?.lmName || "NAv"}.
          </p>
        </div>
      ) : (
        <div style={styles.sourceNotice}>
          <strong>CSV-originated Targeted Batch</strong>
          <p style={styles.sourceNoticeParagraph}>
            Source file: {draft?.source?.fileName || "NAv"}. Whole-file
            validation status: {draft?.validation?.status || "DRAFT"}.
          </p>
        </div>
      )}

      {!integrity?.canConfirm ? (
        <div style={styles.integrityPanel}>
          <strong>Draft confirmation is blocked</strong>
          <ul style={styles.integrityList}>
            {(integrity?.blockers || []).map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
