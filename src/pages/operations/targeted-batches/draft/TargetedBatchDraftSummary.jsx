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
  const proposedBatches = Array.isArray(draft?.proposedBatches)
    ? draft.proposedBatches
    : [];

  return (
    <>
      <div style={styles.summaryGrid}>
        <SummaryCard label="Draft Rows" value={formatNumber(totalRows)} />

        {salesSource ? (
          <>
            <SummaryCard
              label="Proposed Batches"
              value={formatNumber(proposedBatches.length)}
            />
            <SummaryCard
              label="Ward Groups"
              value={formatNumber(
                new Set(
                  proposedBatches
                    .map((batch) => batch?.scope?.wardPcode)
                    .filter(Boolean),
                ).size,
              )}
            />
            <SummaryCard
              label="Sales All Meter IDs"
              value={formatNumber(
                draft?.authoritativeIds?.salesAllMeterIds?.length,
              )}
            />
            <SummaryCard
              label="Selected Sales Value"
              value={formatCurrencyFromCents(summary.totalSalesC)}
            />
          </>
        ) : (
          <>
            <SummaryCard
              label="Accepted Rows"
              value={formatNumber(summary.acceptedRows)}
            />
            <SummaryCard
              label="Rejected Rows"
              value={formatNumber(summary.rejectedRows)}
            />
          </>
        )}

        <SummaryCard
          label="AST Matched"
          value={formatNumber(summary.astMatched)}
        />
        <SummaryCard
          label="AST Not Matched"
          value={formatNumber(summary.astNotMatched)}
        />
        <SummaryCard
          label={salesSource ? "Rule Status" : "File Decision"}
          value={
            salesSource
              ? draft?.validation?.status || "DRAFT"
              : draft?.validation?.fileDecision || "DRAFT"
          }
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
        <>
          <div style={styles.sourceNotice}>
            <strong>Ward-compliant Sales draft</strong>
            <p style={styles.sourceNoticeParagraph}>
              The frontend has already applied the Targeted Batch rule: every
              proposed batch belongs to exactly one ward. The backend will
              independently confirm and enforce the same grouping before any
              permanent documents are written.
            </p>
            <p style={styles.sourceNoticeParagraph}>
              Creation group: {draft?.creationGroup?.id || "NAv"}. Sales period:{" "}
              {draft?.selection?.salesPeriodFrom || "NAv"} to{" "}
              {draft?.selection?.salesPeriodTo || "NAv"}. Local Municipality:{" "}
              {draft?.scope?.lmPcode || "NAv"} · {draft?.scope?.lmName || "NAv"}.
            </p>
          </div>

          <div style={styles.batchPlanSection}>
            <div style={styles.batchPlanHeadingRow}>
              <div>
                <strong>Proposed Targeted Batches</strong>
                <p style={styles.batchPlanHelpText}>
                  These are the ward groups that will be submitted for backend
                  confirmation and permanent creation.
                </p>
              </div>
              <span style={styles.rulePassedBadge}>Ward rule passed</span>
            </div>

            <div style={styles.batchPlanGrid}>
              {proposedBatches.map((batch, index) => (
                <div
                  key={batch?.draftBatchKey || batch?.tbId || index}
                  style={styles.batchPlanCard}
                >
                  <div style={styles.batchPlanCardHeader}>
                    <span style={styles.batchSequenceBadge}>
                      Batch {index + 1}
                    </span>
                    <span style={styles.rulePassedBadge}>PASSED</span>
                  </div>
                  <strong style={styles.batchPlanWard}>
                    {batch?.scope?.wardName ||
                      (batch?.scope?.wardNumber
                        ? `Ward ${batch.scope.wardNumber}`
                        : "Ward NAv")}
                  </strong>
                  <span style={styles.batchPlanMeta}>
                    {batch?.scope?.wardPcode || "NAv"}
                  </span>
                  <span style={styles.batchPlanMeta}>
                    {formatNumber(batch?.rowCount)} meter
                    {Number(batch?.rowCount) === 1 ? "" : "s"}
                  </span>
                  <code style={styles.batchPlanId}>
                    {batch?.tbId || "NAv"}
                  </code>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div style={styles.sourceNotice}>
          <strong>CSV-originated Targeted Batch</strong>
          <p style={styles.sourceNoticeParagraph}>
            Source file: {draft?.source?.fileName || "NAv"}. Whole-file outcome:{" "}
            {draft?.validation?.fileDecision || "DRAFT"}.
          </p>
          <p style={styles.sourceNoticeParagraph}>
            Every accepted-file row has an ACCEPT or REJECT outcome. REJECT rows
            remain visible with reasons for audit, but only ACCEPT rows may continue
            into the later backend allocation and field-work stages.
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
