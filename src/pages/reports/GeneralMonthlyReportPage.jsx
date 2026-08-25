import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { httpsCallable } from "firebase/functions";

import { functions } from "../../firebase";
import { generateGeneralMonthlyReportManaged } from "./generalMonthlyReportArtifact.js";

const GMR_LM_PCODE = "ZA5241";
const GMR_GENERATION_MODE = "FULL_FIELD_POPULATION";

const GMR_JOURNEY = [
  "Field capture",
  "Meter discovery",
  "Premises",
  "Sales / vending",
  "Findings",
  "Interventions",
  "Evidence",
  "Workbook",
];

const GMR_STORY_MESSAGES = [
  "Field discoveries provide the meter, field worker, finding, GPS and evidence trail.",
  "Premise information adds the property and address context around every field-found meter.",
  "Municipal sales history is reconciled without converting unavailable evidence into a false zero.",
  "Findings and normalisation actions are preserved so the workbook can be traced back to field evidence.",
  "Field Data and Field Stats are assembled from the same canonical meter population.",
  "The finished XLSX is saved through Generated Reports before the browser download is started.",
];

const requestGmrDataset = httpsCallable(
  functions,
  "generateGeneralMonthlyReportCallable",
);

function formatNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toLocaleString() : "0";
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatCompletedAt(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "Not Available";
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function errorMessage(error) {
  const message = String(error?.message || "").trim();
  return message || "The General Monthly Report could not be generated.";
}

export default function GeneralMonthlyReportPage() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [lastResult, setLastResult] = useState(null);
  const [generationSummary, setGenerationSummary] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [storyMessageIndex, setStoryMessageIndex] = useState(0);
  const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);
  const startedAtRef = useRef(null);

  useEffect(() => {
    if (!isGenerating) return undefined;

    const timer = window.setInterval(() => {
      if (!startedAtRef.current) return;
      setElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000)),
      );
    }, 1000);

    const storyTimer = window.setInterval(() => {
      setStoryMessageIndex((current) => (current + 1) % GMR_STORY_MESSAGES.length);
    }, 3600);

    return () => {
      window.clearInterval(timer);
      window.clearInterval(storyTimer);
    };
  }, [isGenerating]);

  useEffect(() => {
    if (!isSuccessModalOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") setIsSuccessModalOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isSuccessModalOpen]);

  async function handleGenerate() {
    if (isGenerating) return;

    startedAtRef.current = Date.now();
    setElapsedSeconds(0);
    setStoryMessageIndex(0);
    setIsSuccessModalOpen(false);
    setIsGenerating(true);
    setError("");
    setLastResult(null);
    setGenerationSummary(null);
    setStatusMessage("Preparing the full Endumeni GMR field population...");

    try {
      const response = await requestGmrDataset({
        lmPcode: GMR_LM_PCODE,
        mode: GMR_GENERATION_MODE,
      });
      const dataset = response?.data;

      if (!dataset || !Array.isArray(dataset.rows)) {
        throw new Error("GMR dataset generation returned an invalid response.");
      }

      setGenerationSummary(dataset.summary || null);
      setStatusMessage("Building, storing, and downloading the GMR Excel workbook...");

      const generatedAt = new Date();
      const managed = await generateGeneralMonthlyReportManaged({
        dataset,
        generatedAt,
      });

      const completedAt = new Date();
      const durationSeconds = Math.max(
        0,
        Math.round((completedAt.getTime() - startedAtRef.current) / 1000),
      );

      setElapsedSeconds(durationSeconds);
      setLastResult({
        dataset,
        managed,
        generatedAt,
        completedAt,
        durationSeconds,
      });
      setStatusMessage(
        managed.downloaded
          ? "GMR generated successfully, saved to Generated Reports, and downloaded."
          : "GMR generated successfully and saved to Generated Reports. The browser did not start the download automatically.",
      );
      setIsSuccessModalOpen(true);
    } catch (generationError) {
      setError(errorMessage(generationError));
      setStatusMessage("");
    } finally {
      setIsGenerating(false);
      startedAtRef.current = null;
    }
  }

  const summary = lastResult?.dataset?.summary || null;

  return (
    <>
      <style>{`
        @keyframes gmrSpin {
          to { transform: rotate(360deg); }
        }
        @keyframes gmrPacket {
          0% { left: 1%; opacity: 0; }
          8% { opacity: 1; }
          92% { opacity: 1; }
          100% { left: calc(100% - 22px); opacity: 0; }
        }
        @keyframes gmrFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        @keyframes gmrPulse {
          0%, 100% { opacity: 0.45; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.08); }
        }
        @keyframes gmrModalIn {
          from { opacity: 0; transform: translateY(12px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .gmr-modal-action {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 44px;
          padding: 0 18px;
          border-radius: 12px;
          border: 1px solid transparent;
          font: inherit;
          font-weight: 800;
          line-height: 1;
          text-decoration: none;
          cursor: pointer;
          transition: transform 0.16s ease, box-shadow 0.16s ease, background 0.16s ease, border-color 0.16s ease;
        }
        .gmr-modal-action:hover {
          transform: translateY(-1px);
        }
        .gmr-modal-action:focus-visible {
          outline: 3px solid rgba(37, 99, 235, 0.28);
          outline-offset: 2px;
        }
        .gmr-modal-action-secondary {
          background: #ffffff;
          color: #1e293b;
          border-color: rgba(148, 163, 184, 0.48);
        }
        .gmr-modal-action-secondary:hover {
          background: #f8fafc;
          border-color: rgba(100, 116, 139, 0.58);
        }
      `}</style>

      <header className="console-header">
        <div>
          <p className="eyebrow">Reports</p>
          <h1>General Monthly Report</h1>
          <p className="muted">
            Builder v0.1 generates a point-in-time Endumeni audit and revenue
            workbook for the full current field meter population.
          </p>
          <Link className="text-link" to="/reports">
            ← Back to Reports
          </Link>
        </div>

        <div className="topbar-right">
          <Link className="ghost-button" to="/reports/generated">
            Generated Reports
          </Link>
        </div>
      </header>

      <section className="panel" style={styles.configPanel}>
        <div style={styles.configGrid}>
          <div>
            <div className="muted">Municipality</div>
            <strong>Endumeni</strong>
          </div>
          <div>
            <div className="muted">Generation Mode</div>
            <strong>Full Field Population</strong>
          </div>
          <div>
            <div className="muted">Population Rule</div>
            <strong>All current Endumeni Meter Registry / Assets meters</strong>
          </div>
          <div>
            <div className="muted">Output</div>
            <strong>XLSX Workbook</strong>
          </div>
        </div>

        <div style={styles.actions}>
          <button
            type="button"
            className="secondary-button"
            onClick={handleGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? "Generating GMR..." : "Generate GMR"}
          </button>
        </div>
      </section>

      {isGenerating ? (
        <section className="panel" style={styles.generationPanel}>
          <div style={styles.generationHeader}>
            <div style={styles.spinner} aria-hidden="true" />
            <div style={styles.generationHeaderText}>
              <p className="eyebrow" style={styles.generationEyebrow}>
                GMR generation is active
              </p>
              <h2 style={styles.generationTitle}>Building Endumeni Workbook</h2>
              <p className="muted" style={styles.generationStatus}>
                {statusMessage}
              </p>
            </div>
            <div style={styles.elapsedCard}>
              <span className="muted">Elapsed</span>
              <strong style={styles.elapsedValue}>{formatDuration(elapsedSeconds)}</strong>
            </div>
          </div>

          <div style={styles.journeyShell}>
            <div style={styles.journeyTrack}>
              <div style={styles.journeyLine} />
              <div style={styles.dataPacket} />
              {GMR_JOURNEY.map((label, index) => (
                <div
                  key={label}
                  style={{
                    ...styles.journeyStep,
                    animation: `gmrFloat 3s ease-in-out ${index * 0.18}s infinite`,
                  }}
                >
                  <span style={styles.journeyNumber}>{String(index + 1).padStart(2, "0")}</span>
                  <span style={styles.journeyLabel}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={styles.storyGrid}>
            <div style={styles.storyCard}>
              <div className="muted" style={styles.storyLabel}>
                What the GMR engine is assembling
              </div>
              <strong style={styles.storyMessage}>
                {GMR_STORY_MESSAGES[storyMessageIndex]}
              </strong>
            </div>

            <div style={styles.factGrid}>
              {generationSummary ? (
                <>
                  <GenerationFact label="Meters loaded" value={generationSummary.selectedTotal} />
                  <GenerationFact label="Visible" value={generationSummary.visibleSelected} />
                  <GenerationFact label="Invisible" value={generationSummary.invisibleSelected} />
                </>
              ) : (
                <>
                  <GenerationFact label="Municipality" value="Endumeni" />
                  <GenerationFact label="Population" value="Full field" />
                  <GenerationFact label="Output" value="XLSX" />
                  <GenerationFact label="Missing data" value="Not Available" />
                </>
              )}
            </div>
          </div>

          <p className="muted" style={styles.truthNote}>
            The animation explains the GMR data journey. Only the elapsed time,
            current operation and figures shown above are live generation facts.
          </p>
        </section>
      ) : null}

      {!isGenerating && statusMessage ? (
        <section className="panel" style={styles.messagePanel}>
          <strong>{statusMessage}</strong>
        </section>
      ) : null}

      {error ? (
        <section className="panel" style={styles.errorPanel}>
          <strong>GMR generation failed</strong>
          <p style={styles.messageText}>{error}</p>
        </section>
      ) : null}

      {summary ? (
        <section className="panel">
          <p className="eyebrow">Last Generated Report</p>
          <h2>Full field population snapshot</h2>

          <div style={styles.populationEquation}>
            <SummaryCard label="Total Meters" value={summary.selectedTotal} />
            <div style={styles.equationSymbol} aria-hidden="true">=</div>
            <SummaryCard label="Visible" value={summary.visibleSelected} />
            <div style={styles.equationSymbol} aria-hidden="true">+</div>
            <SummaryCard label="Invisible" value={summary.invisibleSelected} />
          </div>

          <p className="muted" style={styles.footerText}>
            The workbook is stored in Generated Reports for the standard managed
            report retention period.
          </p>
        </section>
      ) : null}

      {isSuccessModalOpen && lastResult ? (
        <div style={styles.modalBackdrop} role="presentation">
          <div
            style={styles.successModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="gmr-success-title"
          >
            <div style={styles.successIcon} aria-hidden="true">
              ✓
            </div>
            <p className="eyebrow" style={styles.modalEyebrow}>
              Generation complete
            </p>
            <h2 id="gmr-success-title" style={styles.modalTitle}>
              General Monthly Report Generated Successfully
            </h2>
            <p className="muted" style={styles.modalIntro}>
              The Endumeni workbook has been built and saved to Generated Reports.
            </p>

            <div style={styles.modalStatsGrid}>
              <ModalStat label="Processing time" value={formatDuration(lastResult.durationSeconds)} />
              <ModalStat label="Meters processed" value={formatNumber(lastResult.dataset?.summary?.selectedTotal)} />
              <ModalStat label="Visible" value={formatNumber(lastResult.dataset?.summary?.visibleSelected)} />
              <ModalStat label="Invisible" value={formatNumber(lastResult.dataset?.summary?.invisibleSelected)} />
            </div>

            <div style={styles.generatedReceipt}>
              <span className="muted">Generated</span>
              <strong>{formatCompletedAt(lastResult.completedAt)}</strong>
            </div>

            <div style={styles.fileReceipt}>
              <span className="muted">Workbook</span>
              <strong style={styles.fileName}>{lastResult.managed?.artifact?.fileName || "GMR workbook"}</strong>
            </div>

            <div style={styles.modalActions}>
              <button
                type="button"
                className="gmr-modal-action gmr-modal-action-secondary"
                onClick={() => setIsSuccessModalOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function GenerationFact({ label, value }) {
  const numeric = typeof value === "number";
  return (
    <div style={styles.generationFact}>
      <span className="muted" style={styles.generationFactLabel}>
        {label}
      </span>
      <strong style={styles.generationFactValue}>
        {numeric ? formatNumber(value) : value}
      </strong>
    </div>
  );
}

function ModalStat({ label, value }) {
  return (
    <div style={styles.modalStat}>
      <span className="muted" style={styles.modalStatLabel}>
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function SummaryCard({ label, value }) {
  return (
    <div style={styles.summaryCard}>
      <div className="muted">{label}</div>
      <div style={styles.summaryValue}>{formatNumber(value)}</div>
    </div>
  );
}

const styles = {
  configPanel: {
    display: "grid",
    gap: "20px",
  },
  configGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: "16px",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-start",
  },
  generationPanel: {
    marginBottom: "16px",
    overflow: "hidden",
    position: "relative",
    background:
      "linear-gradient(135deg, rgba(239, 246, 255, 0.94), rgba(255, 255, 255, 0.98) 46%, rgba(240, 253, 250, 0.92))",
  },
  generationHeader: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    gap: "16px",
    alignItems: "center",
  },
  spinner: {
    width: "44px",
    height: "44px",
    borderRadius: "50%",
    border: "4px solid rgba(37, 99, 235, 0.16)",
    borderTopColor: "#2563eb",
    animation: "gmrSpin 0.85s linear infinite",
  },
  generationHeaderText: {
    minWidth: 0,
  },
  generationEyebrow: {
    marginBottom: "4px",
  },
  generationTitle: {
    marginTop: 0,
    marginBottom: "4px",
  },
  generationStatus: {
    margin: 0,
  },
  elapsedCard: {
    display: "grid",
    gap: "4px",
    minWidth: "112px",
    padding: "10px 14px",
    borderRadius: "14px",
    background: "rgba(255, 255, 255, 0.82)",
    border: "1px solid rgba(148, 163, 184, 0.28)",
    textAlign: "right",
  },
  elapsedValue: {
    fontSize: "22px",
    fontVariantNumeric: "tabular-nums",
  },
  journeyShell: {
    marginTop: "24px",
    overflowX: "auto",
    paddingBottom: "6px",
  },
  journeyTrack: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "repeat(8, minmax(112px, 1fr))",
    gap: "10px",
    minWidth: "980px",
    padding: "20px 6px 10px",
  },
  journeyLine: {
    position: "absolute",
    top: "37px",
    left: "7%",
    right: "7%",
    height: "2px",
    background: "linear-gradient(90deg, #2563eb, #0f766e)",
    opacity: 0.28,
  },
  dataPacket: {
    position: "absolute",
    top: "29px",
    left: "1%",
    width: "18px",
    height: "18px",
    borderRadius: "50%",
    background: "#2563eb",
    boxShadow: "0 0 0 7px rgba(37, 99, 235, 0.12)",
    animation: "gmrPacket 8s ease-in-out infinite",
    zIndex: 2,
  },
  journeyStep: {
    position: "relative",
    zIndex: 3,
    display: "grid",
    justifyItems: "center",
    gap: "8px",
    padding: "0 4px",
    textAlign: "center",
  },
  journeyNumber: {
    display: "grid",
    placeItems: "center",
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    background: "#ffffff",
    border: "2px solid rgba(37, 99, 235, 0.34)",
    color: "#1d4ed8",
    fontSize: "12px",
    fontWeight: 800,
    boxShadow: "0 6px 18px rgba(15, 23, 42, 0.08)",
  },
  journeyLabel: {
    fontSize: "12px",
    fontWeight: 700,
    color: "#334155",
  },
  storyGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.35fr) minmax(320px, 1fr)",
    gap: "16px",
    marginTop: "18px",
  },
  storyCard: {
    minHeight: "94px",
    display: "grid",
    alignContent: "center",
    gap: "8px",
    padding: "16px",
    borderRadius: "14px",
    background: "rgba(15, 23, 42, 0.035)",
    border: "1px solid rgba(148, 163, 184, 0.22)",
  },
  storyLabel: {
    fontSize: "12px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  storyMessage: {
    lineHeight: 1.5,
  },
  factGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "10px",
  },
  generationFact: {
    display: "grid",
    alignContent: "center",
    gap: "4px",
    minHeight: "74px",
    padding: "12px",
    borderRadius: "12px",
    background: "rgba(255, 255, 255, 0.76)",
    border: "1px solid rgba(148, 163, 184, 0.24)",
  },
  generationFactLabel: {
    fontSize: "12px",
  },
  generationFactValue: {
    fontSize: "17px",
  },
  truthNote: {
    marginTop: "14px",
    marginBottom: 0,
    fontSize: "12px",
  },
  messagePanel: {
    marginBottom: "16px",
  },
  errorPanel: {
    marginBottom: "16px",
    borderColor: "rgba(185, 28, 28, 0.35)",
  },
  messageText: {
    marginBottom: 0,
  },
  populationEquation: {
    display: "grid",
    gridTemplateColumns: "minmax(180px, 1fr) auto minmax(180px, 1fr) auto minmax(180px, 1fr)",
    alignItems: "stretch",
    gap: "12px",
    marginTop: "16px",
    maxWidth: "860px",
  },
  equationSymbol: {
    display: "grid",
    placeItems: "center",
    minWidth: "28px",
    fontSize: "28px",
    fontWeight: 900,
    color: "#64748b",
  },
  summaryCard: {
    border: "1px solid rgba(148, 163, 184, 0.28)",
    borderRadius: "12px",
    padding: "14px",
  },
  summaryValue: {
    marginTop: "6px",
    fontSize: "24px",
    fontWeight: 700,
  },
  footerText: {
    marginTop: "18px",
    marginBottom: 0,
  },
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    display: "grid",
    placeItems: "center",
    padding: "24px",
    background: "rgba(15, 23, 42, 0.56)",
    backdropFilter: "blur(4px)",
  },
  successModal: {
    width: "min(760px, 100%)",
    maxHeight: "calc(100vh - 48px)",
    overflowY: "auto",
    padding: "28px",
    borderRadius: "22px",
    background: "#ffffff",
    boxShadow: "0 30px 80px rgba(15, 23, 42, 0.26)",
    animation: "gmrModalIn 0.22s ease-out",
  },
  successIcon: {
    display: "grid",
    placeItems: "center",
    width: "52px",
    height: "52px",
    marginBottom: "16px",
    borderRadius: "50%",
    background: "rgba(5, 150, 105, 0.12)",
    color: "#047857",
    fontSize: "28px",
    fontWeight: 900,
    animation: "gmrPulse 1.5s ease-in-out infinite",
  },
  modalEyebrow: {
    marginBottom: "5px",
  },
  modalTitle: {
    marginTop: 0,
    marginBottom: "8px",
  },
  modalIntro: {
    marginTop: 0,
  },
  modalStatsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "10px",
    marginTop: "20px",
  },
  modalStat: {
    display: "grid",
    gap: "4px",
    minHeight: "70px",
    padding: "12px",
    borderRadius: "12px",
    border: "1px solid rgba(148, 163, 184, 0.24)",
    background: "rgba(248, 250, 252, 0.8)",
  },
  modalStatLabel: {
    fontSize: "12px",
  },
  generatedReceipt: {
    display: "grid",
    gap: "5px",
    marginTop: "16px",
    padding: "14px",
    borderRadius: "12px",
    background: "rgba(248, 250, 252, 0.9)",
    border: "1px solid rgba(148, 163, 184, 0.24)",
  },
  fileReceipt: {
    display: "grid",
    gap: "5px",
    marginTop: "16px",
    padding: "14px",
    borderRadius: "12px",
    background: "rgba(37, 99, 235, 0.055)",
    border: "1px solid rgba(37, 99, 235, 0.14)",
  },
  fileName: {
    overflowWrap: "anywhere",
  },
  modalActions: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: "10px",
    marginTop: "22px",
    paddingTop: "2px",
  },
};
