/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useMemo } from "react";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGetSalesByLmPcodeQuery } from "../../redux/salesApi";
import {
  formatNumber,
  getActiveLmPcode,
  getActiveWorkbaseName,
} from "../sales/salesUtils";
import { hasUsableSalesGps } from "../sales/models/salesGpsModel";
import { getOperationalSalesCategory } from "../sales/models/salesTargetedBatchReadModel";

import "./ProjectPopulationDashboardPage.css";

function formatPercent(value) {
  if (!Number.isFinite(value)) return "0.0%";
  return `${value.toFixed(1)}%`;
}

function formatAxisNumber(value) {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1000) {
    const thousands = value / 1000;
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}K`;
  }
  return formatNumber(value);
}

function formatSnapshotDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-ZA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(value);
}

function formatDateTime(value) {
  if (!value) return "Live now";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Live now";

  return new Intl.DateTimeFormat("en-ZA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function isNormalSalesCategory(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[_]+/g, " ");

  return (
    normalized === "NORMAL" ||
    normalized.startsWith("NORMAL ") ||
    normalized.startsWith("NORMAL-") ||
    normalized.includes("NO LEAKAGE FLAG")
  );
}

function getLatestSalesUpdate(rows = []) {
  let latestMs = 0;

  rows.forEach((row) => {
    const candidates = [
      Number(row?.updatedAtMs || 0),
      Number(row?.createdAtMs || 0),
    ];

    candidates.forEach((candidate) => {
      if (Number.isFinite(candidate) && candidate > latestMs) {
        latestMs = candidate;
      }
    });
  });

  return latestMs > 0 ? new Date(latestMs) : null;
}

function buildPopulationReadModel(rows = []) {
  let withGps = 0;
  let normalPopulation = 0;

  rows.forEach((row) => {
    if (hasUsableSalesGps(row)) {
      withGps += 1;
    }

    const category = getOperationalSalesCategory(row);
    if (isNormalSalesCategory(category)) {
      normalPopulation += 1;
    }
  });

  const total = rows.length;
  const withoutGps = total - withGps;
  const fieldTarget = Math.max(0, total - normalPopulation);
  const gpsCoverage = total > 0 ? (withGps / total) * 100 : 0;
  const withoutGpsShare = total > 0 ? (withoutGps / total) * 100 : 0;
  const normalShare = total > 0 ? (normalPopulation / total) * 100 : 0;
  const fieldTargetShare = total > 0 ? (fieldTarget / total) * 100 : 0;

  const scopeAxisMax = Math.max(1, total);
  const scopeTickOne = Math.round(total * 0.25);
  const scopeTickTwo = Math.round(total * 0.5);
  const scopeTickThree = Math.round(total * 0.75);

  return {
    total,
    withGps,
    withoutGps,
    normalPopulation,
    fieldTarget,
    gpsCoverage,
    withoutGpsShare,
    normalShare,
    fieldTargetShare,
    scopeAxisMax,
    scopeTickOne,
    scopeTickTwo,
    scopeTickThree,
    latestUpdate: getLatestSalesUpdate(rows),
  };
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

  if (name === "population") {
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2.5" />
        <circle cx="4" cy="10" r="2" />
        <path d="M3 20c.5-3.4 2.4-5.2 6-5.2s5.5 1.8 6 5.2" />
        <path d="M14 14.5c3.6-.4 6 1.4 6.7 4.7" />
      </svg>
    );
  }

  if (name === "gps") {
    return (
      <svg {...common}>
        <path d="M12 21s6-5.3 6-11A6 6 0 0 0 6 10c0 5.7 6 11 6 11Z" />
        <circle cx="12" cy="10" r="2.4" />
        <path d="M5 21h14" />
      </svg>
    );
  }

  if (name === "noGps") {
    return (
      <svg {...common}>
        <path d="M5 16a9 9 0 0 1 12.7-8" />
        <path d="M8 18a6 6 0 0 1 7.4-7.3" />
        <path d="M11 20a3 3 0 0 1 2.3-3" />
        <path d="M3 3l18 18" />
      </svg>
    );
  }

  if (name === "target") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      </svg>
    );
  }

  if (name === "calendar") {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 2v6M17 2v6M3 10h18" />
      </svg>
    );
  }

  if (name === "filter") {
    return (
      <svg {...common}>
        <path d="M4 5h16l-6.4 7.2V19l-3.2 1v-7.8L4 5Z" />
      </svg>
    );
  }

  if (name === "note") {
    return (
      <svg {...common}>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </svg>
    );
  }

  return null;
}

function KpiCard({ label, value, detail, tone, icon }) {
  return (
    <article className={`population-exec-kpi population-exec-kpi--${tone}`}>
      <div className="population-exec-kpi__icon">
        <Icon name={icon} />
      </div>
      <div className="population-exec-kpi__copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      <div className="population-exec-kpi__ghost">
        <Icon name={icon} />
      </div>
    </article>
  );
}

function ClipboardIllustration() {
  return (
    <svg
      className="population-notes-illustration"
      viewBox="0 0 190 145"
      aria-hidden="true"
    >
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M38 116c-13-16-17-36-8-54M45 117c-3-25 5-45 23-61M153 117c14-19 16-40 5-58M145 116c5-22-1-42-18-60" opacity=".18" strokeWidth="3" />
        <rect x="66" y="30" width="72" height="94" rx="8" opacity=".5" strokeWidth="5" />
        <path d="M84 30v-8h36v8" opacity=".55" strokeWidth="5" />
        <rect x="78" y="50" width="12" height="12" rx="2" opacity=".6" strokeWidth="3" />
        <rect x="78" y="72" width="12" height="12" rx="2" opacity=".6" strokeWidth="3" />
        <rect x="78" y="94" width="12" height="12" rx="2" opacity=".6" strokeWidth="3" />
        <path d="m81 56 3 3 5-7M81 78l3 3 5-7M81 100l3 3 5-7" opacity=".8" strokeWidth="2.5" />
        <path d="M100 56h24M100 78h24M100 100h18" opacity=".35" strokeWidth="3" />
        <path d="m140 43 13-18 8 6-13 18-9 5 1-11Z" opacity=".75" strokeWidth="3" />
      </g>
    </svg>
  );
}

function LoadingState() {
  return (
    <section className="population-state-card" aria-live="polite" aria-busy="true">
      <div className="population-spinner" aria-hidden="true" />
      <div>
        <h2>Loading Project Population...</h2>
        <p>Connecting to the live Sales stream for the active workbase.</p>
      </div>
    </section>
  );
}

export default function ProjectPopulationDashboardPage() {
  const { activeWorkbase } = useAuth();
  const activeLmPcode = getActiveLmPcode(activeWorkbase);
  const activeWorkbaseName = getActiveWorkbaseName(activeWorkbase);

  const {
    data: salesRows = [],
    isLoading,
    isFetching,
    error,
  } = useGetSalesByLmPcodeQuery(activeLmPcode || skipToken);

  const population = useMemo(
    () => buildPopulationReadModel(salesRows),
    [salesRows],
  );

  if (!activeLmPcode) {
    return (
      <div className="population-dashboard-page population-dashboard-page--executive">
        <section className="population-state-card">
          <div>
            <h2>No active workbase selected</h2>
            <p>Select an active workbase before opening Project Population.</p>
          </div>
        </section>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="population-dashboard-page population-dashboard-page--executive">
        <LoadingState />
      </div>
    );
  }

  if (error) {
    return (
      <div className="population-dashboard-page population-dashboard-page--executive">
        <section className="population-state-card population-state-card--error">
          <div>
            <h2>Could not load Project Population</h2>
            <p>The live Sales stream could not be loaded for {activeLmPcode}.</p>
          </div>
        </section>
      </div>
    );
  }

  const scopeDenominator = Math.max(1, population.total);
  const gpsScopeWidth = (population.withGps / scopeDenominator) * 100;
  const nonGpsScopeWidth = (population.withoutGps / scopeDenominator) * 100;
  const normalScopeWidth = (population.normalPopulation / scopeDenominator) * 100;
  const targetScopeWidth = (population.fieldTarget / scopeDenominator) * 100;
  return (
    <div className="population-dashboard-page population-dashboard-page--executive">
      <header className="population-exec-header">
        <div>
          <p className="population-exec-eyebrow">Dashboard v1 Â· Population Overview</p>
          <h2>Dashboard v1 â€” Population Overview</h2>
          <p>
            Live project population, GPS readiness and field-discovery scope for {activeWorkbaseName}.
          </p>
        </div>

        <div className="population-exec-header__controls" aria-label="Population snapshot scope">
          <div className="population-exec-date-control">
            <Icon name="calendar" />
            <span>{formatSnapshotDate()}</span>
          </div>
          <div className="population-exec-filter-control" title="Full active LM Sales population">
            <Icon name="filter" />
            <span>All Sales</span>
          </div>
        </div>
      </header>

      {population.total === 0 ? (
        <section className="population-state-card">
          <div>
            <h2>No Sales population found</h2>
            <p>No Sales records were returned for {activeLmPcode}.</p>
          </div>
        </section>
      ) : (
        <>
          <section className="population-exec-kpis" aria-label="Population KPIs">
            <KpiCard
              label="Total Population"
              value={formatNumber(population.total)}
              detail="Total project Sales meters"
              tone="blue"
              icon="population"
            />
            <KpiCard
              label="With GPS"
              value={formatNumber(population.withGps)}
              detail={`${formatPercent(population.gpsCoverage)} of total population`}
              tone="teal"
              icon="gps"
            />
            <KpiCard
              label="Without GPS"
              value={formatNumber(population.withoutGps)}
              detail={`${formatPercent(population.withoutGpsShare)} of total population`}
              tone="orange"
              icon="noGps"
            />
            <KpiCard
              label="Field Target"
              value={formatNumber(population.fieldTarget)}
              detail={`${formatPercent(population.fieldTargetShare)} of total population`}
              tone="blue"
              icon="target"
            />
          </section>

          <section className="population-exec-main-grid">
            <article className="population-exec-panel population-exec-panel--split">
              <div className="population-exec-panel__title">
                <h3>Population Split</h3>
                <span className="population-info-dot" title="GPS availability across the full project population">i</span>
              </div>

              <div className="population-exec-donut-wrap">
                <div
                  className="population-exec-donut"
                  style={{ "--gps-share": `${population.gpsCoverage * 3.6}deg` }}
                  role="img"
                  aria-label={`${formatPercent(population.gpsCoverage)} with GPS and ${formatPercent(population.withoutGpsShare)} without GPS`}
                >
                  <span className="population-exec-donut__percent population-exec-donut__percent--gps">
                    {formatPercent(population.gpsCoverage)}
                  </span>
                  <span className="population-exec-donut__percent population-exec-donut__percent--non-gps">
                    {formatPercent(population.withoutGpsShare)}
                  </span>
                  <div className="population-exec-donut__center">
                    <strong>{formatNumber(population.total)}</strong>
                    <span>Total Population</span>
                  </div>
                </div>
              </div>

              <div className="population-exec-split-legend">
                <div>
                  <span className="population-exec-swatch population-exec-swatch--gps" />
                  <div>
                    <strong>With GPS</strong>
                    <small>{formatNumber(population.withGps)} ({formatPercent(population.gpsCoverage)})</small>
                  </div>
                </div>
                <div>
                  <span className="population-exec-swatch population-exec-swatch--non-gps" />
                  <div>
                    <strong>Without GPS</strong>
                    <small>{formatNumber(population.withoutGps)} ({formatPercent(population.withoutGpsShare)})</small>
                  </div>
                </div>
              </div>
            </article>

            <article className="population-exec-panel population-exec-panel--scope">
              <div className="population-exec-panel__title">
                <h3>Project Scope</h3>
                <span className="population-info-dot" title="Two distributions across the same total Sales population">i</span>
              </div>

              <div className="population-exec-scope-total">
                <span>Total Project Population</span>
                <strong>{formatNumber(population.total)}</strong>
              </div>

              <div className="population-exec-scope-comparison">
                <div className="population-exec-scope-row">
                  <div className="population-exec-scope-row__heading">
                    <strong>GPS Distribution</strong>
                    <span>Same {formatNumber(population.total)}-meter scale</span>
                  </div>

                  <div
                    className="population-exec-scope-bar population-exec-scope-bar--comparison"
                    role="img"
                    aria-label={`${formatNumber(population.withGps)} with GPS and ${formatNumber(population.withoutGps)} without GPS`}
                  >
                    <span
                      className="population-exec-scope-bar__gps"
                      style={{ width: `${gpsScopeWidth}%` }}
                    />
                    <span
                      className="population-exec-scope-bar__non-gps"
                      style={{ width: `${nonGpsScopeWidth}%` }}
                    />
                  </div>

                  <div className="population-exec-scope-row__legend">
                    <div>
                      <span><i className="population-exec-dot population-exec-dot--gps" />With GPS</span>
                      <strong>{formatNumber(population.withGps)}</strong>
                      <b>{formatPercent(population.gpsCoverage)}</b>
                    </div>
                    <div>
                      <span><i className="population-exec-dot population-exec-dot--non-gps" />Without GPS</span>
                      <strong>{formatNumber(population.withoutGps)}</strong>
                      <b>{formatPercent(population.withoutGpsShare)}</b>
                    </div>
                  </div>
                </div>

                <div className="population-exec-scope-row">
                  <div className="population-exec-scope-row__heading">
                    <strong>Sales Category Distribution</strong>
                    <span>Normal vs all CATs excluding Normal</span>
                  </div>

                  <div
                    className="population-exec-scope-bar population-exec-scope-bar--comparison"
                    role="img"
                    aria-label={`${formatNumber(population.normalPopulation)} Normal and ${formatNumber(population.fieldTarget)} All Categories excluding Normal`}
                  >
                    <span
                      className="population-exec-scope-bar__normal"
                      style={{ width: `${normalScopeWidth}%` }}
                    />
                    <span
                      className="population-exec-scope-bar__target"
                      style={{ width: `${targetScopeWidth}%` }}
                    />
                  </div>

                  <div className="population-exec-scope-row__legend">
                    <div>
                      <span><i className="population-exec-dot population-exec-dot--normal" />Normal</span>
                      <strong>{formatNumber(population.normalPopulation)}</strong>
                      <b>{formatPercent(population.normalShare)}</b>
                    </div>
                    <div>
                      <span><i className="population-exec-dot population-exec-dot--target" />All Categories</span>
                      <strong>{formatNumber(population.fieldTarget)}</strong>
                      <b>{formatPercent(population.fieldTargetShare)}</b>
                    </div>
                  </div>
                </div>
              </div>

              <div className="population-exec-axis population-exec-axis--shared" aria-hidden="true">
                <span>0</span>
                <span>{formatAxisNumber(population.scopeTickOne)}</span>
                <span>{formatAxisNumber(population.scopeTickTwo)}</span>
                <span>{formatAxisNumber(population.scopeTickThree)}</span>
                <span>{formatAxisNumber(population.scopeAxisMax)}</span>
              </div>

              <p className="population-exec-scope-note">
                Both bars use the same end-to-end Sales population scale. Field Target is all Sales meters excluding Normal.
              </p>
            </article>
            <article className="population-exec-panel population-exec-panel--notes">
              <div className="population-exec-notes-title">
                <span className="population-exec-notes-icon"><Icon name="note" /></span>
                <h3>Key Notes</h3>
              </div>

              <ul className="population-exec-notes-list">
                <li><strong>{formatNumber(population.total)}</strong> total project meters</li>
                <li><strong>{formatNumber(population.withGps)}</strong> GPS-enabled</li>
                <li><strong>{formatNumber(population.withoutGps)}</strong> without usable GPS</li>
                <li><strong>{formatNumber(population.fieldTarget)}</strong> field-discovery target</li>
              </ul>

              <div className="population-exec-notes-target">
                Field Target = Total Population - Normal ({formatNumber(population.total)} - {formatNumber(population.normalPopulation)} = {formatNumber(population.fieldTarget)}).
              </div>

              <ClipboardIllustration />
            </article>
          </section>

          <footer className="population-exec-footer">
            <span className={`population-live-dot${isFetching ? " population-live-dot--syncing" : ""}`} aria-hidden="true" />
            <span>
              Last updated: {formatDateTime(population.latestUpdate)} Â· {isFetching ? "Syncing live Sales" : "Live Sales"} Â· {activeLmPcode}
            </span>
          </footer>
        </>
      )}
    </div>
  );
}
