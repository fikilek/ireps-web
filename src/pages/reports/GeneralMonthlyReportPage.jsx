/* eslint-disable no-unused-vars -- JSX tags are used by React. */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
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

// GMR-R037: one page carries both reports, and the Reports menu has an entry
// for each of them, so which report it is stands in the address (owner, 26
// September 2026). Zamo asked for the free date range and would never have
// looked for it inside a page whose name says Monthly.
const GMR_PAGE_PATH = "/reports/general-monthly";
const GR_PAGE_PATH = "/reports/general-report";

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
  const location = useLocation();
  // GMR-R037: one choice first, then only what that choice needs. The address
  // holds the choice, so the menu entry, the heading and this selector can
  // never disagree, and either report can be linked to directly.
  const reportKind = location.pathname.startsWith(GR_PAGE_PATH) ? "GR" : "GMR";
  const chooseReportKind = (value) =>
    navigate(value === "GR" ? GR_PAGE_PATH : GMR_PAGE_PATH, { replace: true });
  const [reportMonth, setReportMonth] = useState(() => getDefaultReportMonth());
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [phase, setPhase] = useState("idle");
  const [step, setStep] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
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
    if (!helpOpen) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setHelpOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen]);

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
              onChange={(event) => chooseReportKind(event.target.value)}
              disabled={phase === "working"}
              style={styles.monthInput}
            >
              <option value="GMR">General Monthly Report</option>
              <option value="GR">General Report</option>
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

        <button
          type="button"
          style={styles.helpButton}
          onClick={() => setHelpOpen(true)}
          aria-label="What these two reports are"
          title="What these two reports are"
        >
          ?
        </button>
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
      {helpOpen ? (
        <div
          style={styles.helpOverlay}
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setHelpOpen(false);
          }}
        >
          <div className="panel" style={styles.helpPanel} role="dialog" aria-modal="true" aria-label="About these reports">
            <div style={styles.helpHeader}>
              <h2 style={styles.helpTitle}>The two reports</h2>
              <button type="button" className="ghost-button" onClick={() => setHelpOpen(false)} autoFocus>
                Close
              </button>
            </div>

            <div style={styles.helpBody}>
            <h3 style={styles.helpHeading}>General Monthly Report</h3>
            <p>
              One calendar month of Endumeni field work. <strong>This is the record the municipality pays on</strong>, so it
              is complete, and a month does not change once it has been reported.
            </p>

            <h3 style={styles.helpHeading}>General Report</h3>
            <p>
              The same report over <strong>any start and end date</strong> — a week, a campaign, a fortnight across two
              months. It is for looking. Two ranges can overlap and hold the same work twice, so it is never used for
              payment, and it says so on its own face: in the file name, above the Field Data headings and at the top of
              Field Stats.
            </p>

            <h3 style={styles.helpHeading}>What is in the workbook</h3>
            <p>
              Two worksheets, and nothing else. <strong>Field Data</strong> — one row per transaction, Zamo&apos;s columns
              first and in his order, then the columns the rules added, then any seventh or later photograph.{" "}
              <strong>Field Stats</strong> — METER AUDIT, NORMALISATION and Teams, each per field worker and then per team,
              with the control lines underneath. The three sections count the same records three ways; if they disagree the
              workbook is not produced.
            </p>

            <h3 style={styles.helpHeading}>Which transactions are counted</h3>
            <p>
              All types, <strong>including no access</strong> — the municipality pays per transaction, and a visit where
              nobody could get in is an attempt that was made and recorded. A transaction is counted in the period it
              reached the server, read in South African time.
            </p>

            <h3 style={styles.helpHeading}>Findings and normalisation</h3>
            <p>
              The Normalisation column reads the finding and what was done about it, joined by a dash:{" "}
              <strong>Meter Ok - None</strong>, <strong>Illegally Connected - Disconnect meter</strong>, and where nothing
              was done, <strong>Illegally Connected - None, reason &quot;Threatened or chased away&quot;</strong> — the
              reason stands beside None, never in place of it. The words are exactly as the field recorded them; the report
              interprets nothing.
            </p>

            <h3 style={styles.helpHeading}>After it is made</h3>
            <p>
              The workbook downloads to this browser and is kept in <strong>Generated Reports</strong> until someone deletes
              it. Only the person who generated a report can list or open it.
            </p>
            </div>
          </div>
        </div>
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
  // The page explains itself behind a "?" rather than on the panel, so the
  // panel holds only what a manager has to choose (owner, 26 September 2026).
  helpButton: {
    position: "absolute",
    right: "16px",
    bottom: "16px",
    width: "44px",
    height: "44px",
    borderRadius: "50%",
    border: "1px solid rgba(148, 163, 184, 0.5)",
    background: "#ffffff",
    color: "#1e293b",
    fontSize: "20px",
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 6px 18px rgba(15, 23, 42, 0.18)",
    zIndex: 40,
  },
  helpOverlay: {
    position: "fixed",
    inset: 0,
    display: "grid",
    placeItems: "center",
    padding: "24px",
    background: "rgba(15, 23, 42, 0.45)",
    zIndex: 50,
  },
  helpPanel: {
    width: "min(720px, 100%)",
    maxHeight: "80vh",
    // The panel itself does not scroll: its title and Close would go with it, and a reader who had
    // scrolled down had no way out of the window (owner, 26 September).
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    padding: 0,
  },
  helpHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    flex: "0 0 auto",
    padding: "20px 24px",
    borderBottom: "1px solid var(--border, #e2e8f0)",
    background: "var(--surface, #ffffff)",
  },
  // Only the words move.
  helpBody: {
    flex: "1 1 auto",
    overflowY: "auto",
    padding: "4px 24px 24px",
  },
  helpTitle: {
    margin: 0,
  },
  helpHeading: {
    margin: "18px 0 6px",
  },
  configPanel: {
    position: "relative",
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
