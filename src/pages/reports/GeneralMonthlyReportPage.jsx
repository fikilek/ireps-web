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
const GR_GENERATION_MODE = "GENERAL_REPORT";

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

function johannesburgParts() {
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
}

function currentJohannesburgDay() {
  const parts = johannesburgParts();
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return get("year") && get("month") && get("day") ? `${get("year")}-${get("month")}-${get("day")}` : "";
}

const MONTH_ABBREVIATIONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDay(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const [, year, month, day] = match;
  return `${Number(day)} ${MONTH_ABBREVIATIONS[Number(month) - 1]} ${year}`;
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
  // GMR-R037: one choice first, then only what that choice needs.
  const [reportKind, setReportKind] = useState("GMR");
  const [reportMonth, setReportMonth] = useState(() => getDefaultReportMonth());
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [phase, setPhase] = useState("idle");
  const [step, setStep] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState(null);
  const startedAtRef = useRef(null);
  const maxReportMonth = currentJohannesburgMonthKey();
  const today = currentJohannesburgDay();
  const isGeneralReport = reportKind === "GR";
  const monthLabel = formatReportMonth(reportMonth);
  const rangeLabel = startDate && endDate ? `${formatDay(startDate)} to ${formatDay(endDate)}` : "";
  const periodLabel = isGeneralReport ? rangeLabel : monthLabel;
  const isCurrentMonth = !isGeneralReport && reportMonth && reportMonth === maxReportMonth;
  const rangeBackwards = isGeneralReport && startDate && endDate && startDate > endDate;
  const canGenerate = isGeneralReport ? Boolean(startDate && endDate && !rangeBackwards) : Boolean(reportMonth);
  const reportName = isGeneralReport ? "General Report" : "General Monthly Report";

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
        mode: isGeneralReport ? GR_GENERATION_MODE : GMR_GENERATION_MODE,
        ...(isGeneralReport ? { startDate, endDate } : { reportMonth }),
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

  const labels = stepLabels(periodLabel || "the period");
  const steps = STEP_ORDER.map((key) => ({
    key,
    label: labels[key],
    active: key === step,
    done: STEP_ORDER.indexOf(key) < STEP_ORDER.indexOf(step),
  }));

  const summary = result?.dataset?.summary || null;
  const unplacedCount = summary?.unplacedCount || 0;
  const resultMonthLabel = result?.dataset?.periodLabel || result?.dataset?.reportingPeriodLabel || periodLabel;
  const resultIsGeneral = result?.dataset?.isPaymentRecord === false;

  return (
    <>
      <header className="console-header">
        <div>
          <p className="eyebrow">Reports</p>
          <h1>{reportName}</h1>
          <p className="muted">
            {isGeneralReport
              ? "Every field transaction between two dates, one row each, with the counts per field worker and per team. For looking only — never the record the municipality pays on."
              : "Every field transaction for one month, one row each, with the counts per field worker and per team. This is the record the municipality pays on."}
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
            <label className="muted" htmlFor="gmr-report-kind">Report</label>
            <select
              id="gmr-report-kind"
              value={reportKind}
              onChange={(event) => setReportKind(event.target.value)}
              disabled={phase === "working"}
              style={styles.monthInput}
            >
              <option value="GMR">General Monthly Report — one month, the payment record</option>
              <option value="GR">General Report — any dates, for looking</option>
            </select>
          </div>

          {isGeneralReport ? (
            <>
              <div>
                <label className="muted" htmlFor="gr-start-date">Start date</label>
                <input
                  id="gr-start-date"
                  type="date"
                  value={startDate}
                  max={today || undefined}
                  onChange={(event) => setStartDate(event.target.value)}
                  disabled={phase === "working"}
                  style={styles.monthInput}
                />
              </div>
              <div>
                <label className="muted" htmlFor="gr-end-date">End date</label>
                <input
                  id="gr-end-date"
                  type="date"
                  value={endDate}
                  max={today || undefined}
                  onChange={(event) => setEndDate(event.target.value)}
                  disabled={phase === "working"}
                  style={styles.monthInput}
                />
                {rangeBackwards ? (
                  <p style={styles.warnValue}>The start date must be on or before the end date.</p>
                ) : null}
              </div>
            </>
          ) : (
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
          )}
          <div>
            <div className="muted">Workbook</div>
            <strong>Field Data and Field Stats</strong>
          </div>
          <div>
            <div className="muted">Which transactions</div>
            <strong>All types, including no access, counted when they reached the server</strong>
          </div>
        </div>

        <div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setPhase("confirm")}
            disabled={phase === "working" || !canGenerate}
          >
            {canGenerate
              ? `Generate ${periodLabel} report`
              : isGeneralReport ? "Choose a start and end date" : "Choose a reporting month"}
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
          title={`Generate the ${periodLabel} ${reportName}?`}
          lines={[
            `Endumeni. Every field transaction that reached the server ${isGeneralReport ? `between ${periodLabel}` : `in ${periodLabel}`}, one row each, with Field Stats per field worker and per team.`,
            ...(isCurrentMonth ? [`${monthLabel} is not over yet, so the report will say it is incomplete.`] : []),
            ...(isGeneralReport ? ["A General Report is for looking. Two ranges can hold the same work twice, so it says on its own face that it is not the payment record."] : []),
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
          title={`Generating the ${periodLabel} report`}
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
            ...(resultIsGeneral ? ["This is a General Report: for looking, never for payment."] : []),
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
