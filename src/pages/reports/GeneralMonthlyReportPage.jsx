/* eslint-disable no-unused-vars -- JSX tags are used by React. */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";

import { functions } from "../../firebase";
import BatchCreationModal from "../operations/targeted-batches/draft/batch-creation-modal.jsx";
import { downloadBrowserArtifact } from "../../utils/reportPlatform/downloadBrowserArtifact.js";
import { generateGeneralMonthlyReportManaged } from "./generalMonthlyReportArtifact.js";
import { getDefaultReportMonth } from "./generalMonthlyReportMonthModel.js";

// General Monthly Report (GMR 1.1.0): Field Data and Field Stats for one month.
// GMR-R028: a confirmation window before, the steps while it runs, and a result
// window afterwards, whether it worked or not.

const GMR_LM_PCODE = "ZA5241";
const GMR_GENERATION_MODE = "MONTHLY_GMR";

const STEP_ORDER = ["READ", "BUILD", "SAVE", "DOWNLOAD"];

const requestGmrDataset = httpsCallable(functions, "generateGeneralMonthlyReportCallable", {
  timeout: 150_000,
});

function formatReportMonth(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return "";
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)).toLocaleString("en-ZA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function currentJohannesburgMonthKey() {
  const parts = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return year && month ? `${year}-${month}` : "";
}

function formatElapsed(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function plainError(error) {
  const message = String(error?.message || "").replace(/^Firebase:\s*/i, "").trim();
  return message || "Something went wrong.";
}

function stepLabels(monthLabel) {
  return {
    READ: `Reading ${monthLabel}'s transactions`,
    BUILD: "Building Field Data and Field Stats",
    SAVE: "Saving to Generated Reports",
    DOWNLOAD: "Starting the download",
  };
}

// Error Register (GMR-R030): what failed at each step, and what to do.
function failureLines(step, error) {
  const reason = plainError(error);
  if (step === "READ") return [`The month's transactions could not be read: ${reason}`, "Nothing was saved. Try again."];
  if (step === "BUILD") return [`The workbook could not be built: ${reason}`, "Nothing was saved. Try again; if it fails again, report it."];
  if (step === "SAVE") return [`The workbook was built but could not be saved to Generated Reports: ${reason}`, "You can still download this copy now. Try again later to save it."];
  return [reason];
}

export default function GeneralMonthlyReportPage() {
  const navigate = useNavigate();
  const [reportMonth, setReportMonth] = useState(() => getDefaultReportMonth());
  const [phase, setPhase] = useState("idle");
  const [step, setStep] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState(null);
  const startedAtRef = useRef(null);
  const maxReportMonth = currentJohannesburgMonthKey();
  const monthLabel = formatReportMonth(reportMonth);
  const isCurrentMonth = reportMonth && reportMonth === maxReportMonth;

  useEffect(() => {
    if (phase !== "working") return undefined;
    const timer = window.setInterval(() => {
      if (startedAtRef.current) {
        setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  async function handleGenerate() {
    startedAtRef.current = Date.now();
    setElapsedSeconds(0);
    setResult(null);
    setFailure(null);
    setPhase("working");

    let currentStep = "READ";
    setStep(currentStep);

    try {
      const response = await requestGmrDataset({
        lmPcode: GMR_LM_PCODE,
        mode: GMR_GENERATION_MODE,
        reportMonth,
      });
      const dataset = response?.data;

      const managed = await generateGeneralMonthlyReportManaged({
        dataset,
        generatedAt: new Date(),
        onStep: (next) => {
          currentStep = next;
          setStep(next);
        },
      });

      setResult({ dataset, managed });
      setPhase("done");
    } catch (error) {
      setFailure({ step: currentStep, error, artifact: error?.gmrArtifact || null });
      setPhase("failed");
    } finally {
      startedAtRef.current = null;
    }
  }

  const labels = stepLabels(monthLabel || "the month");
  const steps = STEP_ORDER.map((key) => ({
    key,
    label: labels[key],
    active: key === step,
    done: STEP_ORDER.indexOf(key) < STEP_ORDER.indexOf(step),
  }));

  const summary = result?.dataset?.summary || null;
  const unplacedCount = summary?.unplacedCount || 0;
  const resultMonthLabel = result?.dataset?.reportingPeriodLabel || monthLabel;

  return (
    <>
      <header className="console-header">
        <div>
          <p className="eyebrow">Reports</p>
          <h1>General Monthly Report</h1>
          <p className="muted">
            Every field transaction for one month, one row each, with the counts per
            field worker and per team.
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
            <label className="muted" htmlFor="gmr-report-month">Reporting month</label>
            <input
              id="gmr-report-month"
              type="month"
              value={reportMonth}
              max={maxReportMonth || undefined}
              onChange={(event) => setReportMonth(event.target.value)}
              disabled={phase === "working"}
              style={styles.monthInput}
            />
          </div>
          <div>
            <div className="muted">Workbook</div>
            <strong>Field Data and Field Stats</strong>
          </div>
          <div>
            <div className="muted">Which transactions</div>
            <strong>All types, including no access, counted in the month they reached the server</strong>
          </div>
        </div>

        <div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setPhase("confirm")}
            disabled={phase === "working" || !reportMonth}
          >
            {reportMonth ? `Generate ${monthLabel} report` : "Choose a reporting month"}
          </button>
        </div>
      </section>

      {result ? (
        <section className="panel">
          <p className="eyebrow">Last report</p>
          <h2>{resultMonthLabel}</h2>
          <div style={styles.factGrid}>
            <Fact label="Transactions on Field Data" value={summary?.payableTotal ?? 0} />
            <Fact label="Not on Field Data" value={unplacedCount} warn={unplacedCount > 0} />
            <Fact label="File" value={result.managed?.artifact?.fileName || ""} />
          </div>
          <p className="muted" style={styles.footerText}>
            Saved in Generated Reports until someone deletes it.
          </p>
        </section>
      ) : null}

      {phase === "confirm" ? (
        <BatchCreationModal
          title={`Generate the ${monthLabel} General Monthly Report?`}
          lines={[
            `Endumeni. Every field transaction that reached the server in ${monthLabel}, one row each, with Field Stats per field worker and per team.`,
            ...(isCurrentMonth ? [`${monthLabel} is not over yet, so the report will say it is incomplete.`] : []),
            "The workbook is saved to Generated Reports and then downloaded.",
          ]}
          actions={[
            { label: "Generate", primary: true, onClick: handleGenerate },
            { label: "Cancel", onClick: () => setPhase("idle") },
          ]}
          escapeAction={() => setPhase("idle")}
        />
      ) : null}

      {phase === "working" ? (
        <BatchCreationModal
          title={`Generating the ${monthLabel} report`}
          steps={steps}
          lines={[`Elapsed ${formatElapsed(elapsedSeconds)}`]}
          working
        />
      ) : null}

      {phase === "done" && result ? (
        <BatchCreationModal
          title={`The ${resultMonthLabel} report is ready`}
          tone={unplacedCount > 0 ? "warning" : "info"}
          lines={[
            `${(summary?.payableTotal ?? 0).toLocaleString()} transactions on Field Data.`,
            ...(unplacedCount > 0
              ? [`${unplacedCount} submitted transaction${unplacedCount === 1 ? "" : "s"} could not be placed on Field Data. They are listed at the bottom of Field Stats; report them before issuing this report.`]
              : []),
            `Saved to Generated Reports as ${result.managed?.artifact?.fileName}.`,
            result.managed?.downloaded
              ? "The download has started."
              : "Your browser did not start the download. Use Download again.",
          ]}
          actions={[
            { label: "Download again", primary: !result.managed?.downloaded, onClick: () => downloadBrowserArtifact(result.managed.artifact) },
            { label: "Open Generated Reports", onClick: () => navigate("/reports/generated") },
            { label: "Close", primary: Boolean(result.managed?.downloaded), onClick: () => setPhase("idle") },
          ]}
          escapeAction={() => setPhase("idle")}
        />
      ) : null}

      {phase === "failed" && failure ? (
        <BatchCreationModal
          title="The report was not generated"
          tone="error"
          lines={failureLines(failure.step, failure.error)}
          actions={[
            ...(failure.artifact
              ? [{ label: "Download this copy", primary: true, onClick: () => downloadBrowserArtifact(failure.artifact) }]
              : []),
            { label: "Try again", primary: !failure.artifact, onClick: () => setPhase("confirm") },
            { label: "Close", onClick: () => setPhase("idle") },
          ]}
          escapeAction={() => setPhase("idle")}
        />
      ) : null}
    </>
  );
}

function Fact({ label, value, warn = false }) {
  return (
    <div style={styles.fact}>
      <span className="muted" style={styles.factLabel}>{label}</span>
      <strong style={{ ...styles.factValue, ...(warn ? styles.warnValue : {}) }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </strong>
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
  monthInput: {
    display: "block",
    width: "100%",
    maxWidth: "220px",
    minHeight: "40px",
    marginTop: "4px",
    padding: "8px 10px",
    border: "1px solid rgba(148, 163, 184, 0.5)",
    borderRadius: "10px",
    background: "#ffffff",
    font: "inherit",
    fontWeight: 700,
    color: "#1e293b",
  },
  factGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "12px",
    marginTop: "12px",
  },
  fact: {
    display: "grid",
    gap: "4px",
    padding: "12px 14px",
    borderRadius: "12px",
    border: "1px solid rgba(148, 163, 184, 0.28)",
  },
  factLabel: {
    fontSize: "12px",
  },
  factValue: {
    fontSize: "18px",
    overflowWrap: "anywhere",
  },
  warnValue: {
    color: "#b45309",
  },
  footerText: {
    marginTop: "14px",
    marginBottom: 0,
  },
};
