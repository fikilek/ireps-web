/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useMemo, useState } from "react";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGetElectricityPopulationByLmQuery } from "../../redux/reportElectricityPopulationApi";
import {
  EMD_HELP_STORIES,
  formatCurrencyRands,
  formatNumber,
  formatPercent,
  formatUnitsKwh,
  normalizeElectricityPopulationDoc,
  pickActiveMonth,
} from "./models/electricityMeterPopulationModel.js";
import { getDashboardEyebrow } from "../sales/salesUtils";

import "./ProjectPopulationDashboardPage.css";

function getActiveLmPcode(activeWorkbase) {
  return (
    activeWorkbase?.lmPcode ||
    activeWorkbase?.pcode ||
    activeWorkbase?.id ||
    activeWorkbase?.localMunicipalityId ||
    null
  );
}

function getActiveWorkbaseName(activeWorkbase) {
  return (
    activeWorkbase?.name ||
    activeWorkbase?.lmName ||
    activeWorkbase?.id ||
    activeWorkbase?.pcode ||
    "NAv"
  );
}

function Icon({ name }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };

  if (name === "meter") {
    return (
      <svg {...common}>
        <rect x="4" y="3" width="16" height="18" rx="3" />
        <path d="M8 15h8" />
        <path d="M9 10a3 3 0 0 1 6 0" />
        <path d="M12 10l2-2" />
      </svg>
    );
  }

  if (name === "status" || name === "check") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 2.5 2.5L16.5 8.5" />
      </svg>
    );
  }

  if (name === "plus" || name === "new") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v8M8 12h8" />
      </svg>
    );
  }

  if (name === "refresh" || name === "replacement") {
    return (
      <svg {...common}>
        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
        <path d="M16 16h5v5" />
      </svg>
    );
  }

  if (name === "removed" || name === "trash") {
    return (
      <svg {...common}>
        <path d="M3 6h18" />
        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
        <line x1="10" x2="10" y1="11" y2="17" />
        <line x1="14" x2="14" y1="11" y2="17" />
      </svg>
    );
  }

  return null;
}

function KpiCard({ label, value, detail, tone, icon, onHelp }) {
  return (
    <article className={`meter-exec-kpi meter-exec-kpi--${tone}`}>
      <div className="meter-exec-kpi__icon">
        <Icon name={icon} />
      </div>
      <div className="meter-exec-kpi__copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      <Icon name={icon} />
      {onHelp && (
        <button
          type="button"
          className="meter-info-dot meter-info-dot--kpi"
          onClick={onHelp}
          title={`Learn about ${label}`}
          aria-label={`Learn about ${label}`}
        >
          i
        </button>
      )}
    </article>
  );
}

function buildBuyingDonutGradient(buyingCount, notBuyingCount) {
  const total = buyingCount + notBuyingCount;
  if (!total || total <= 0) {
    return "conic-gradient(#e2e8f0 0deg 360deg)";
  }
  const buyingDeg = (buyingCount / total) * 360;
  return `conic-gradient(#0f9f95 0deg ${buyingDeg}deg, #ffffff ${buyingDeg}deg ${buyingDeg + 0.75}deg, #f97316 ${buyingDeg + 0.75}deg 360deg)`;
}

export default function ProjectPopulationDashboardPage() {
  const { activeWorkbase } = useAuth();
  const activeLmPcode = getActiveLmPcode(activeWorkbase);
  const activeWorkbaseName = getActiveWorkbaseName(activeWorkbase);

  const {
    data: rawMonths = [],
    isLoading,
    isFetching,
    error,
  } = useGetElectricityPopulationByLmQuery(activeLmPcode || skipToken);

  const sortedMonths = useMemo(() => {
    return [...rawMonths].sort((a, b) => String(a.month).localeCompare(String(b.month)));
  }, [rawMonths]);

  const [selectedMonthKey, setSelectedMonthKey] = useState("");

  const activeMonthKey = useMemo(() => {
    return pickActiveMonth(sortedMonths, selectedMonthKey);
  }, [sortedMonths, selectedMonthKey]);

  const currentMonthData = useMemo(() => {
    const found = sortedMonths.find((m) => m.month === activeMonthKey);
    return found ? normalizeElectricityPopulationDoc(found) : null;
  }, [sortedMonths, activeMonthKey]);

  const [activeHelpKey, setActiveHelpKey] = useState(null);
  const activeHelpStory = activeHelpKey ? EMD_HELP_STORIES[activeHelpKey] : null;

  if (!activeLmPcode) {
    return (
      <div className="meter-dashboard-page meter-dashboard-page--executive">
        <section className="meter-state-card meter-state-card--warning">
          <div>
            <h2>No Active Workbase</h2>
            <p>Select an active workbase before opening the Electricity Meter Population Dashboard.</p>
          </div>
        </section>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="meter-dashboard-page meter-dashboard-page--executive">
        <section className="meter-state-card" aria-live="polite" aria-busy="true">
          <div className="meter-spinner" aria-hidden="true" />
          <div>
            <h2>Loading Electricity Meter Population...</h2>
            <p>Connecting to the live materialized population stream for {activeLmPcode}.</p>
          </div>
        </section>
      </div>
    );
  }

  if (error) {
    return (
      <div className="meter-dashboard-page meter-dashboard-page--executive">
        <section className="meter-state-card meter-state-card--error">
          <div>
            <h2>Could Not Load Population Stream</h2>
            <p>
              The streaming population records could not be loaded for {activeLmPcode}. Please ensure security rules
              permit access and retry.
            </p>
          </div>
        </section>
      </div>
    );
  }

  if (!currentMonthData) {
    return (
      <div className="meter-dashboard-page meter-dashboard-page--executive">
        <section className="meter-state-card meter-state-card--warning">
          <div>
            <h2>No Population Records Found</h2>
            <p>
              No monthly population rollups exist for municipality {activeLmPcode} ({activeWorkbaseName}).
            </p>
          </div>
        </section>
      </div>
    );
  }

  const {
    totalMeters,
    buying,
    notBuying,
    buyingShare,
    notBuyingShare,
    salesTotalC,
    unitsTotal,
    avgSalesPerBuyingMeterC,
    avgUnitsPerBuyingMeter,
    classifiedTotal,
    normal,
    targeted,
    normalShare,
    targetedShare,
    movements,
    monthLabel,
  } = currentMonthData;

  const donutGradient = buildBuyingDonutGradient(buying, notBuying);

  return (
    <div className="meter-dashboard-page meter-dashboard-page--executive">
      {/* EXECUTIVE HEADER */}
      <section className="meter-exec-header">
        <div>
          <p className="meter-exec-eyebrow">{getDashboardEyebrow(activeWorkbase)}</p>
          <h2>Electricity Meter Population</h2>
          <p>
            Original Contour vending population &amp; token purchase activity for {monthLabel || activeMonthKey}.
          </p>
        </div>

        <div className="meter-exec-header__controls">
          {sortedMonths.length > 1 && (
            <div className="meter-exec-month-strip">
              <span className="meter-exec-month-strip__label">Vending Month:</span>
              <div className="meter-exec-month-buttons">
                {sortedMonths.map((m) => {
                  const isSelected = m.month === activeMonthKey;
                  const isLatest = m.month === sortedMonths.at(-1)?.month;
                  return (
                    <button
                      key={m.month}
                      type="button"
                      className={`meter-exec-month-btn ${isSelected ? "meter-exec-month-btn--active" : ""}`}
                      onClick={() => setSelectedMonthKey(m.month)}
                    >
                      <span>{m.monthLabel || m.month}</span>
                      {isLatest && <span className="meter-exec-month-badge">Latest</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="meter-exec-snapshot">
            <span className="meter-live-dot" aria-hidden="true" />
            <strong>{isFetching ? "Streaming" : "Live Stream"}</strong>
          </div>
          <div className="meter-exec-workbase">{activeLmPcode}</div>
        </div>
      </section>

      {/* TOP KPI CARDS (UNIFIED EXECUTIVE 5-CARD GRID) */}
      <section className="meter-exec-kpis--5">
        <KpiCard
          label="Total Meters"
          value={formatNumber(totalMeters)}
          detail="Active on Contour vending list"
          tone="blue"
          icon="meter"
          onHelp={() => setActiveHelpKey("kpi-total")}
        />
        <KpiCard
          label="Unchanged"
          value={movements.unchanged != null ? formatNumber(movements.unchanged) : "0"}
          detail="Continuing from previous month"
          tone="teal"
          icon="status"
          onHelp={() => setActiveHelpKey("kpi-unchanged")}
        />
        <KpiCard
          label="New"
          value={movements.newMeters != null ? formatNumber(movements.newMeters) : "0"}
          detail="Newly added on vending list"
          tone="blue"
          icon="plus"
          onHelp={() => setActiveHelpKey("kpi-new")}
        />
        <KpiCard
          label="Replacements"
          value={movements.replacements != null ? formatNumber(movements.replacements) : "0"}
          detail="Replaced old meters on list"
          tone="purple"
          icon="replacement"
          onHelp={() => setActiveHelpKey("kpi-replacements")}
        />
        <KpiCard
          label="Removed / Out of Service"
          value={movements.removed != null ? formatNumber(movements.removed) : "0"}
          detail="Dropped from list · not in total"
          tone="red"
          icon="removed"
          onHelp={() => setActiveHelpKey("kpi-removed")}
        />
      </section>

      {/* MAIN 3-PANEL EXECUTIVE GRID */}
      <section className="meter-exec-main-grid">
        {/* PANEL 1: DONUT BREAKDOWN (BUYING VS NOT BUYING) */}
        <article className="meter-exec-panel">
          <div className="meter-exec-panel__title">
            <div>
              <h3>Buying vs Not Buying</h3>
              <span>Monthly token purchase split (Contour list)</span>
            </div>
            <button
              type="button"
              className="meter-info-dot"
              onClick={() => setActiveHelpKey("card-donut")}
              title="Learn about Buying vs Not Buying"
              aria-label="Learn about Buying vs Not Buying"
            >
              i
            </button>
          </div>

          <div className="meter-status-layout">
            <div
              className="meter-status-donut"
              style={{ background: donutGradient }}
              aria-label="Buying vs Not Buying breakdown"
            >
              <div className="meter-status-donut__center">
                <strong>{formatNumber(totalMeters)}</strong>
                <span>On Contour List</span>
              </div>
            </div>

            <div className="meter-pop-legend">
              <div className="meter-pop-legend__row">
                <div className="meter-pop-legend__category">
                  <span className="meter-pop-legend__dot" style={{ background: "#0f9f95" }} />
                  <span>Buying (&gt; R 0)</span>
                </div>
                <div className="meter-pop-legend__values">
                  <strong style={{ color: "#0f9f95" }}>{formatNumber(buying)}</strong>
                  <span>{formatPercent(buying, totalMeters)}</span>
                </div>
              </div>

              <div
                className="meter-pop-legend__row"
                style={{ borderColor: "#fed7aa", background: "#fff7ed" }}
              >
                <div className="meter-pop-legend__category">
                  <span className="meter-pop-legend__dot" style={{ background: "#f97316" }} />
                  <span>Not Buying (R 0)</span>
                </div>
                <div className="meter-pop-legend__values">
                  <strong style={{ color: "#ea580c" }}>{formatNumber(notBuying)}</strong>
                  <span>{formatPercent(notBuying, totalMeters)}</span>
                </div>
              </div>
            </div>
          </div>
        </article>

        {/* PANEL 2: VENDING & TARGETING PROFILE (2 SPLIT BARS) */}
        <article className="meter-exec-panel">
          <div className="meter-exec-panel__title">
            <div>
              <h3>Vending &amp; Targeting Profile</h3>
              <span>Monthly purchase split &amp; leakage classification</span>
            </div>
            <button
              type="button"
              className="meter-info-dot"
              onClick={() => setActiveHelpKey("card-scope")}
              title="Learn about Vending & Targeting Profile"
              aria-label="Learn about Vending & Targeting Profile"
            >
              i
            </button>
          </div>

          {/* BAR 1: BUYING VS NOT BUYING */}
          <div className="meter-scope-block">
            <div className="meter-scope-block__head">
              <span className="meter-scope-block__title">Buying vs not buying (R 0)</span>
              <span className="meter-scope-block__sub">Monthly purchase activity</span>
            </div>
            <div className="meter-scope-bar" role="img" aria-label="Buying vs not buying meters">
              <span
                className="meter-scope-bar__seg"
                style={{
                  width: `${buyingShare}%`,
                  background: "linear-gradient(90deg, #0f9f95, #0db0a4)",
                }}
                title={`Buying (> R 0): ${formatNumber(buying)} (${formatPercent(buying, totalMeters)})`}
              >
                {buyingShare >= 14 && (
                  <span className="meter-scope-bar__label">
                    {formatNumber(buying)} ({formatPercent(buying, totalMeters)})
                  </span>
                )}
              </span>
              <span
                className="meter-scope-bar__seg"
                style={{
                  width: `${notBuyingShare}%`,
                  background: "linear-gradient(90deg, #f97316, #ff8a35)",
                }}
                title={`Not Buying (R 0): ${formatNumber(notBuying)} (${formatPercent(notBuying, totalMeters)})`}
              >
                {notBuyingShare >= 14 && (
                  <span className="meter-scope-bar__label">
                    {formatNumber(notBuying)} ({formatPercent(notBuying, totalMeters)})
                  </span>
                )}
              </span>
            </div>
            <div className="meter-scope-legend">
              <span className="meter-scope-legend__item">
                <i className="meter-scope-legend__dot" style={{ background: "#0f9f95" }} />
                Buying (&gt; R 0) <strong>{formatNumber(buying)}</strong> ({formatPercent(buying, totalMeters)})
              </span>
              <span className="meter-scope-legend__item">
                <i className="meter-scope-legend__dot" style={{ background: "#f97316" }} />
                Not Buying (R 0) <strong>{formatNumber(notBuying)}</strong> ({formatPercent(notBuying, totalMeters)})
              </span>
            </div>
          </div>

          {/* BAR 2: NORMAL VS TARGETED */}
          <div className="meter-scope-block">
            <div className="meter-scope-block__head">
              <span className="meter-scope-block__title">Normal vs targeted (CAT 1–8)</span>
              <span className="meter-scope-block__sub">Mpilo 30-month purchase analysis</span>
            </div>
            <div className="meter-scope-bar" role="img" aria-label="Normal vs Targeted meters">
              <span
                className="meter-scope-bar__seg"
                style={{
                  width: `${normalShare}%`,
                  background: "linear-gradient(90deg, #2563eb, #3b82f6)",
                }}
                title={`Normal: ${formatNumber(normal)} (${formatPercent(normal, classifiedTotal)})`}
              >
                {normalShare >= 14 && (
                  <span className="meter-scope-bar__label">
                    {formatNumber(normal)} ({formatPercent(normal, classifiedTotal)})
                  </span>
                )}
              </span>
              <span
                className="meter-scope-bar__seg"
                style={{
                  width: `${targetedShare}%`,
                  background: "linear-gradient(90deg, #ea580c, #f97316)",
                }}
                title={`Targeted: ${formatNumber(targeted)} (${formatPercent(targeted, classifiedTotal)})`}
              >
                {targetedShare >= 14 && (
                  <span className="meter-scope-bar__label">
                    {formatNumber(targeted)} ({formatPercent(targeted, classifiedTotal)})
                  </span>
                )}
              </span>
            </div>
            <div className="meter-scope-legend">
              <span className="meter-scope-legend__item">
                <i className="meter-scope-legend__dot" style={{ background: "#2563eb" }} />
                Normal <strong>{formatNumber(normal)}</strong> ({formatPercent(normal, classifiedTotal)})
              </span>
              <span className="meter-scope-legend__item">
                <i className="meter-scope-legend__dot" style={{ background: "#f97316" }} />
                Targeted (CAT 1–8) <strong>{formatNumber(targeted)}</strong> ({formatPercent(targeted, classifiedTotal)})
              </span>
            </div>
          </div>
        </article>

        {/* PANEL 3: MONTHLY VENDING SUMMARY */}
        <article className="meter-exec-panel">
          <div className="meter-exec-panel__title">
            <div>
              <h3>Monthly Vending Summary</h3>
              <span>Original Contour &amp; Mpilo source figures</span>
            </div>
            <button
              type="button"
              className="meter-info-dot"
              onClick={() => setActiveHelpKey("card-notes")}
              title="Learn about Monthly Vending Summary"
              aria-label="Learn about Monthly Vending Summary"
            >
              i
            </button>
          </div>

          <div className="meter-key-notes-list">
            {/* GROUP 1: MONTHLY PURCHASE ACTIVITY */}
            <div className="meter-note-group">
              <div className="meter-note-group__title">
                <span>1. Monthly Purchase Activity</span>
                <span className="meter-note-group__badge">Contour List</span>
              </div>
              <div className="meter-note-row">
                <span className="meter-note-row__label">
                  <i className="meter-scope-legend__dot" style={{ background: "#0f9f95" }} />
                  Buying Meters (&gt; R 0)
                </span>
                <div className="meter-note-row__values">
                  <strong>{formatNumber(buying)}</strong>
                  <span>{formatPercent(buying, totalMeters)}</span>
                </div>
              </div>
              <div className="meter-note-row">
                <span className="meter-note-row__label">
                  <i className="meter-scope-legend__dot" style={{ background: "#f97316" }} />
                  Not Buying (R 0 in Month)
                </span>
                <div className="meter-note-row__values">
                  <strong style={{ color: "#ea580c" }}>{formatNumber(notBuying)}</strong>
                  <span>{formatPercent(notBuying, totalMeters)}</span>
                </div>
              </div>
              <div className="meter-note-row meter-note-row--total">
                <span className="meter-note-row__label">
                  <strong>Total Supplier List Meters</strong>
                </span>
                <div className="meter-note-row__values">
                  <strong style={{ color: "#135bd8" }}>{formatNumber(totalMeters)}</strong>
                  <span style={{ fontWeight: 800 }}>100%</span>
                </div>
              </div>
            </div>

            {/* GROUP 2: TOKEN REVENUE & UNITS */}
            <div className="meter-note-group">
              <div className="meter-note-group__title">
                <span>2. Token Revenue &amp; Units</span>
                <span className="meter-note-group__badge">Purchases</span>
              </div>
              <div className="meter-note-row">
                <span className="meter-note-row__label">
                  <i className="meter-scope-legend__dot" style={{ background: "#135bd8" }} />
                  Total Token Purchases
                </span>
                <div className="meter-note-row__values">
                  <strong>{formatCurrencyRands(salesTotalC)}</strong>
                </div>
              </div>
              <div className="meter-note-row">
                <span className="meter-note-row__label">
                  <i className="meter-scope-legend__dot" style={{ background: "#0f9f95" }} />
                  Total Units Purchased
                </span>
                <div className="meter-note-row__values">
                  <strong>{formatUnitsKwh(unitsTotal)}</strong>
                </div>
              </div>
              <div className="meter-note-row meter-note-row--total">
                <span className="meter-note-row__label">Avg per Buying Meter</span>
                <div className="meter-note-row__values">
                  <strong>
                    {formatCurrencyRands(avgSalesPerBuyingMeterC)} · {formatUnitsKwh(avgUnitsPerBuyingMeter)}
                  </strong>
                </div>
              </div>
            </div>

            {/* GROUP 3: MPILO CATEGORY SPLIT */}
            <div className="meter-note-group">
              <div className="meter-note-group__title">
                <span>3. Mpilo Category Split</span>
                <span className="meter-note-group__badge">{formatNumber(classifiedTotal)} Classified</span>
              </div>
              <div className="meter-note-row">
                <span className="meter-note-row__label">
                  <i className="meter-scope-legend__dot" style={{ background: "#2563eb" }} />
                  Normal Buyers
                </span>
                <div className="meter-note-row__values">
                  <strong>{formatNumber(normal)}</strong>
                  <span>{formatPercent(normal, classifiedTotal)}</span>
                </div>
              </div>
              <div className="meter-note-row">
                <span className="meter-note-row__label">
                  <i className="meter-scope-legend__dot" style={{ background: "#f97316" }} />
                  Targeted (CAT 1–8)
                </span>
                <div className="meter-note-row__values">
                  <strong style={{ color: "#ea580c" }}>{formatNumber(targeted)}</strong>
                  <span>{formatPercent(targeted, classifiedTotal)}</span>
                </div>
              </div>
            </div>
          </div>
        </article>
      </section>

      {/* FOOTER */}
      <footer className="meter-exec-footer">
        <span>Original Contour &amp; Mpilo Vending Files · {activeWorkbaseName}</span>
        <span>·</span>
        <span>Prepaid sales stream active</span>
        <span>·</span>
        <span>Real-time sync</span>
      </footer>

      {/* ACADEMY STORY HELP MODAL */}
      <div
        className={`meter-modal-overlay ${activeHelpStory ? "meter-modal-overlay--open" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setActiveHelpKey(null);
        }}
      >
        {activeHelpStory && (
          <div className="meter-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div className="meter-modal-header">
              <span className="meter-modal-badge">{activeHelpStory.badge}</span>
              <button
                type="button"
                className="meter-modal-close"
                onClick={() => setActiveHelpKey(null)}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>
            <h3 className="meter-modal-title" id="modal-title">{activeHelpStory.title}</h3>
            <div
              className="meter-modal-body"
              dangerouslySetInnerHTML={{ __html: activeHelpStory.body }}
            />
            <div className="meter-modal-footer">
              <span>iREPS Intelligence</span>
              <a
                href="#academy"
                className="meter-modal-academy"
                onClick={(e) => {
                  e.preventDefault();
                  alert("iREPS Academy course integration coming soon!");
                }}
              >
                Open in iREPS Academy &rarr;
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
