/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useEffect, useState } from "react";

import {
  TARGETED_BATCH_COLUMN_GUIDE,
  TARGETED_BATCH_MAX_ROWS,
  buildTargetedBatchReadFailure,
  downloadTargetedBatchTemplate,
  formatNumber,
  validateTargetedBatchCsv,
} from "./targetedBatchUtils";

export default function TargetedBatchUploadModal({
  onClose,
  onSubmit,
  hasExistingDraft = false,
}) {
  const [fileName, setFileName] = useState("");
  const [precheck, setPrecheck] = useState(null);
  const [isReading, setIsReading] = useState(false);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  async function handleFileChange(event) {
    const file = event.target.files?.[0] || null;

    setPrecheck(null);
    setFileName(file?.name || "");

    if (!file) return;

    setIsReading(true);

    try {
      const text = await file.text();
      setPrecheck(
        validateTargetedBatchCsv({
          fileName: file.name,
          text,
        }),
      );
    } catch (error) {
      setPrecheck(
        buildTargetedBatchReadFailure({
          fileName: file.name,
          message: error?.message || "The selected file could not be read.",
        }),
      );
    } finally {
      setIsReading(false);
    }
  }

  function handleSubmit() {
    if (!precheck || isReading) return;
    onSubmit(precheck);
  }

  const fileAccepted = precheck?.fileDecision === "ACCEPTED";
  const fileRejected = precheck?.fileDecision === "REJECTED";

  return (
    <div
      style={styles.overlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div style={styles.card} role="dialog" aria-modal="true">
        <div style={styles.header}>
          <div>
            <p style={styles.eyebrow}>TB Upload</p>
            <h2 style={styles.title}>Upload TB File</h2>
            <p style={styles.subtitle}>
              Validate the complete CSV file, then assess every accepted-file row.
            </p>
          </div>

          <button type="button" style={styles.closeButton} onClick={onClose}>
            ✕
          </button>
        </div>

        <div style={styles.body}>
          <section style={styles.noticeBox}>
            <strong>Controlled two-stage CSV assessment</strong>
            <p style={styles.noticeText}>
              Stage 1 gives the complete file one outcome: ACCEPTED or REJECTED.
              An accepted file is then assessed row by row, where every row
              receives ACCEPT or REJECT and every rejected row receives a reason.
              The file may contain up to {formatNumber(TARGETED_BATCH_MAX_ROWS)} rows.
            </p>

            {hasExistingDraft ? (
              <p style={styles.existingDraftNotice}>
                A current Targeted Batch draft already exists. Continuing with an
                ACCEPTED CSV will ask before replacing that active draft.
              </p>
            ) : null}

            <button
              type="button"
              style={styles.templateButton}
              onClick={downloadTargetedBatchTemplate}
            >
              Download CSV Template
            </button>
          </section>

          <label style={styles.fileLabel}>
            Select TB upload CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              style={styles.fileInput}
            />
          </label>

          <section style={styles.guidePanel}>
            <h3 style={styles.guideTitle}>Official column order</h3>
            <div style={styles.guideGrid}>
              {TARGETED_BATCH_COLUMN_GUIDE.map((column) => (
                <div key={column.name} style={styles.guideCard}>
                  <strong>{column.name}</strong>
                  <span>{column.required ? "Required" : "Optional"}</span>
                  <p>{column.meaning}</p>
                </div>
              ))}
            </div>
          </section>

          {isReading ? (
            <section style={styles.resultPanel}>
              <strong>Reading {fileName}...</strong>
            </section>
          ) : null}

          {precheck ? (
            <section
              style={{
                ...styles.resultPanel,
                ...(fileAccepted ? styles.successPanel : styles.errorPanel),
              }}
            >
              <div style={styles.resultHeader}>
                <div>
                  <div style={styles.decisionRow}>
                    <strong>Whole-file decision</strong>
                    <span
                      style={{
                        ...styles.decisionBadge,
                        ...(fileAccepted
                          ? styles.acceptedBadge
                          : styles.rejectedBadge),
                      }}
                    >
                      {precheck.fileDecision}
                    </span>
                  </div>
                  <p style={styles.resultFile}>{precheck.fileName}</p>
                </div>

                <div style={styles.resultCounts}>
                  <span>{formatNumber(precheck.totalRows)} file rows</span>
                  {fileAccepted ? (
                    <>
                      <span>{formatNumber(precheck.acceptedRows)} ACCEPT</span>
                      <span>{formatNumber(precheck.rejectedRows)} REJECT</span>
                    </>
                  ) : null}
                </div>
              </div>

              {precheck.errors.length > 0 ? (
                <div style={styles.messageList}>
                  <strong>File rejection reason(s)</strong>
                  {precheck.errors.map((message) => (
                    <p key={message}>• {message}</p>
                  ))}
                </div>
              ) : null}

              {precheck.warnings.length > 0 ? (
                <div style={styles.warningList}>
                  {precheck.warnings.map((message) => (
                    <p key={message}>• {message}</p>
                  ))}
                </div>
              ) : null}

              {precheck.invalidRowDetails.length > 0 ? (
                <div style={styles.invalidRows}>
                  <strong>First rejected rows</strong>
                  {precheck.invalidRowDetails.slice(0, 10).map((row) => (
                    <p key={`${row.sourceLine}-${row.rowNo}-${row.meterNo}`}>
                      Line {row.sourceLine}: {row.reasons.join(" ")}
                    </p>
                  ))}
                </div>
              ) : null}

              {fileAccepted ? (
                <p style={styles.outcomeHelpText}>
                  Continuing creates a frontend CSV draft containing every assessed
                  row. REJECT rows remain visible for audit and cannot proceed as
                  accepted work.
                </p>
              ) : (
                <p style={styles.outcomeHelpText}>
                  Recording this result adds the rejected file to the frontend TB
                  Upload Register. No TB rows are prepared for a rejected file.
                </p>
              )}
            </section>
          ) : null}
        </div>

        <div style={styles.footer}>
          <button type="button" style={styles.secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            style={{
              ...styles.primaryButton,
              ...(fileRejected ? styles.rejectedSubmitButton : null),
              ...(!precheck || isReading ? styles.disabledButton : null),
            }}
            onClick={handleSubmit}
            disabled={!precheck || isReading}
          >
            {fileAccepted
              ? "Continue to Draft Review"
              : fileRejected
                ? "Record Rejected File"
                : "Assess File"}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    display: "grid",
    placeItems: "center",
    padding: "1rem",
    background: "rgba(15, 23, 42, 0.62)",
  },
  card: {
    width: "min(980px, 96vw)",
    maxHeight: "92vh",
    display: "flex",
    flexDirection: "column",
    borderRadius: "1rem",
    background: "#ffffff",
    boxShadow: "0 28px 70px rgba(15, 23, 42, 0.34)",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "1rem 1.1rem",
    borderBottom: "1px solid #e2e8f0",
  },
  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: "0.72rem",
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  title: {
    margin: "0.2rem 0 0",
    color: "#0f172a",
  },
  subtitle: {
    margin: "0.35rem 0 0",
    color: "#64748b",
  },
  closeButton: {
    width: "2.2rem",
    height: "2.2rem",
    border: "1px solid #cbd5e1",
    borderRadius: "999px",
    background: "#ffffff",
    cursor: "pointer",
  },
  body: {
    display: "grid",
    gap: "1rem",
    padding: "1rem 1.1rem",
    overflowY: "auto",
  },
  noticeBox: {
    padding: "0.9rem",
    border: "1px solid #bfdbfe",
    borderRadius: "0.8rem",
    background: "#eff6ff",
    color: "#1e3a8a",
  },
  noticeText: {
    margin: "0.35rem 0 0.7rem",
    lineHeight: 1.5,
  },
  existingDraftNotice: {
    margin: "0 0 0.7rem",
    padding: "0.65rem",
    borderRadius: "0.65rem",
    background: "#fef3c7",
    color: "#92400e",
    fontWeight: 750,
  },
  templateButton: {
    border: "1px solid #2563eb",
    borderRadius: "0.65rem",
    padding: "0.5rem 0.7rem",
    background: "#ffffff",
    color: "#1d4ed8",
    fontWeight: 850,
    cursor: "pointer",
  },
  fileLabel: {
    display: "grid",
    gap: "0.45rem",
    color: "#334155",
    fontWeight: 850,
  },
  fileInput: {
    border: "1px dashed #94a3b8",
    borderRadius: "0.8rem",
    padding: "0.9rem",
    background: "#f8fafc",
  },
  guidePanel: {
    padding: "0.9rem",
    border: "1px solid #e2e8f0",
    borderRadius: "0.8rem",
  },
  guideTitle: {
    margin: "0 0 0.7rem",
    color: "#0f172a",
    fontSize: "0.95rem",
  },
  guideGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "0.6rem",
  },
  guideCard: {
    padding: "0.7rem",
    borderRadius: "0.7rem",
    background: "#f8fafc",
    color: "#334155",
  },
  resultPanel: {
    padding: "0.9rem",
    border: "1px solid #cbd5e1",
    borderRadius: "0.8rem",
    background: "#f8fafc",
  },
  successPanel: {
    borderColor: "#86efac",
    background: "#f0fdf4",
  },
  errorPanel: {
    borderColor: "#fca5a5",
    background: "#fef2f2",
  },
  resultHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "1rem",
    flexWrap: "wrap",
  },
  decisionRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.55rem",
    flexWrap: "wrap",
  },
  decisionBadge: {
    borderRadius: "999px",
    padding: "0.25rem 0.55rem",
    fontSize: "0.72rem",
    fontWeight: 900,
  },
  acceptedBadge: {
    background: "#dcfce7",
    color: "#166534",
  },
  rejectedBadge: {
    background: "#fee2e2",
    color: "#991b1b",
  },
  resultFile: {
    margin: "0.2rem 0 0",
    color: "#64748b",
  },
  resultCounts: {
    display: "flex",
    gap: "0.45rem",
    flexWrap: "wrap",
  },
  messageList: {
    marginTop: "0.7rem",
    color: "#991b1b",
  },
  warningList: {
    marginTop: "0.7rem",
    color: "#92400e",
  },
  invalidRows: {
    marginTop: "0.7rem",
    paddingTop: "0.7rem",
    borderTop: "1px solid rgba(148, 163, 184, 0.35)",
    color: "#475569",
  },
  outcomeHelpText: {
    margin: "0.8rem 0 0",
    color: "#475569",
    lineHeight: 1.5,
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.6rem",
    padding: "0.9rem 1.1rem",
    borderTop: "1px solid #e2e8f0",
  },
  secondaryButton: {
    border: "1px solid #cbd5e1",
    borderRadius: "0.7rem",
    padding: "0.55rem 0.8rem",
    background: "#ffffff",
    color: "#334155",
    fontWeight: 850,
    cursor: "pointer",
  },
  primaryButton: {
    border: "1px solid #1d4ed8",
    borderRadius: "0.7rem",
    padding: "0.55rem 0.8rem",
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 850,
    cursor: "pointer",
  },
  rejectedSubmitButton: {
    borderColor: "#b91c1c",
    background: "#b91c1c",
  },
  disabledButton: {
    opacity: 0.48,
    cursor: "not-allowed",
  },
};
