/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useMemo } from "react";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGetRegistryMetersByLmQuery } from "../../redux/registryMetersApi";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";

import "./MetersRegistryDashboardPage.css";

const STATUS_COLORS = [
  "#0f9f95",
  "#f97316",
  "#2563eb",
  "#7c3aed",
  "#94a3b8",
  "#0ea5c6",
  "#16a34a",
  "#d97706",
];

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

function formatNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toLocaleString("en-ZA") : "0";
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "0.0%";
  return `${value.toFixed(1)}%`;
}

function normalizeCode(value) {
  const text = String(value || "")
    .trim()
    .toUpperCase();

  return text && text !== "NAV" ? text : "NAv";
}

function titleCase(value) {
  const text = String(value || "")
    .trim()
    .replace(/[_-]+/g, " ");

  if (!text || text.toUpperCase() === "NAV") return "NAv";

  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function hasRegistryLink(value) {
  const text = String(value || "").trim();
  return Boolean(text && text.toUpperCase() !== "NAV");
}

function countBy(rows, valueGetter, labelFormatter = titleCase) {
  const counts = new Map();

  rows.forEach((row) => {
    const raw = valueGetter(row);
    const label = labelFormatter(raw);
    counts.set(label, (counts.get(label) || 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.label.localeCompare(right.label, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
    );
}

function buildMeterRegistryReadModel(rows = [], wards = []) {
  const total = rows.length;
  let electricity = 0;
  let water = 0;
  let visible = 0;
  let invisible = 0;
  let linkedPremise = 0;
  let linkedErf = 0;

  rows.forEach((row) => {
    const meterType = String(row?.meterType || "").trim().toLowerCase();
    const visibility = normalizeCode(row?.visibility);

    if (meterType === "electricity") electricity += 1;
    if (meterType === "water") water += 1;
    if (visibility === "VISIBLE") visible += 1;
    if (visibility === "INVISIBLE") invisible += 1;
    if (hasRegistryLink(row?.premiseId)) linkedPremise += 1;
    if (hasRegistryLink(row?.erfId)) linkedErf += 1;
  });

  const otherType = Math.max(0, total - electricity - water);
  const visibleShare = total > 0 ? (visible / total) * 100 : 0;
  const invisibleShare = total > 0 ? (invisible / total) * 100 : 0;
  const premiseLinkShare = total > 0 ? (linkedPremise / total) * 100 : 0;
  const erfLinkShare = total > 0 ? (linkedErf / total) * 100 : 0;

  const statuses = countBy(
    rows,
    (row) => row?.statusState || row?.status,
    (value) => normalizeCode(value),
  );

  const kinds = countBy(rows, (row) => row?.meterKind);
  const phases = countBy(rows, (row) => row?.meterPhase);

  const wardLookup = new Map(
    wards.map((ward) => [
      ward?.wardPcode,
      ward?.wardNumber !== undefined && ward?.wardNumber !== "NAv"
        ? `Ward ${ward.wardNumber}`
        : ward?.wardName || ward?.wardPcode || "NAv",
    ]),
  );

  const wardCounts = new Map();

  rows.forEach((row) => {
    const wardPcode = row?.wardPcode || "NAv";
    const label = wardLookup.get(wardPcode) || wardPcode;
    wardCounts.set(label, (wardCounts.get(label) || 0) + 1);
  });

  const wardsByMeterCount = Array.from(wardCounts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.label.localeCompare(right.label, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
    );

  const connected =
    statuses.find((row) => normalizeCode(row.label) === "CONNECTED")?.count || 0;
  const disconnected =
    statuses.find((row) => normalizeCode(row.label) === "DISCONNECTED")?.count || 0;

  return {
    total,
    electricity,
    water,
    otherType,
    visible,
    invisible,
    visibleShare,
    invisibleShare,
    linkedPremise,
    linkedErf,
    premiseLinkShare,
    erfLinkShare,
    statuses,
    kinds,
    phases,
    wardsByMeterCount,
    connected,
    disconnected,
    connectedShare: total > 0 ? (connected / total) * 100 : 0,
    maxWardCount: wardsByMeterCount[0]?.count || 0,
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

  if (name === "status") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 2.5 2.5L16.5 8.5" />
      </svg>
    );
  }

  if (name === "eye") {
    return (
      <svg {...common}>
        <path d="M2.8 12s3.3-5 9.2-5 9.2 5 9.2 5-3.3 5-9.2 5-9.2-5-9.2-5Z" />
        <circle cx="12" cy="12" r="2.5" />
      </svg>
    );
  }

  if (name === "ward") {
    return (
      <svg {...common}>
        <path d="M12 21s6-5.3 6-11A6 6 0 0 0 6 10c0 5.7 6 11 6 11Z" />
        <circle cx="12" cy="10" r="2.2" />
      </svg>
    );
  }

  return null;
}

function KpiCard({ label, value, detail, tone, icon }) {
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
    </article>
  );
}

function buildStatusGradient(statuses, total) {
  if (!total || statuses.length === 0) {
    return "conic-gradient(#e2e8f0 0deg 360deg)";
  }

  let cursor = 0;
  const stops = statuses.map((row, index) => {
    const start = cursor;
    const end = cursor + (row.count / total) * 360;
    cursor = end;
    const color = STATUS_COLORS[index % STATUS_COLORS.length];
    return `${color} ${start}deg ${end}deg`;
  });

  if (cursor < 360) {
    stops.push(`#e2e8f0 ${cursor}deg 360deg`);
  }

  return `conic-gradient(${stops.join(", ")})`;
}

function MeterTypeTable({ registry }) {
  const rows = [
    { label: "Electricity", count: registry.electricity, tone: "teal", icon: "⚡" },
    { label: "Water", count: registry.water, tone: "blue", icon: "◉" },
  ];

  if (registry.otherType > 0) {
    rows.push({
      label: "Other / Unknown",
      count: registry.otherType,
      tone: "orange",
      icon: "•",
    });
  }

  return (
    <div className="meter-type-table">
      <div className="meter-type-table__head">
        <span>Category</span>
        <span>Meters</span>
        <span>% of Total</span>
      </div>

      {rows.map((row) => {
        const share = registry.total > 0 ? (row.count / registry.total) * 100 : 0;

        return (
          <div className="meter-type-table__row" key={row.label}>
            <div className="meter-type-table__category">
              <span className={`meter-type-table__icon meter-type-table__icon--${row.tone}`}>
                {row.icon}
              </span>
              <strong>{row.label}</strong>
            </div>
            <strong>{formatNumber(row.count)}</strong>
            <span>{formatPercent(share)}</span>
          </div>
        );
      })}

      <div className="meter-type-table__total">
        <strong>Total</strong>
        <strong>{formatNumber(registry.total)}</strong>
        <strong>100%</strong>
      </div>
    </div>
  );
}

function WardChart({ rows, maxCount }) {
  const visibleRows = rows.slice(0, 10);

  if (visibleRows.length === 0) {
    return <p className="meter-empty-copy">No ward-linked meter rows are available.</p>;
  }

  return (
    <div className="meter-ward-chart">
      <div className="meter-ward-chart__plot">
        <div className="meter-ward-chart__grid" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        <div className="meter-ward-chart__bars">
          {visibleRows.map((row) => {
            const height = maxCount > 0 ? (row.count / maxCount) * 100 : 0;

            return (
              <div className="meter-ward-chart__bar-wrap" key={row.label}>
                <strong>{formatNumber(row.count)}</strong>
                <div className="meter-ward-chart__bar-track">
                  <span style={{ height: `${Math.max(height, row.count ? 8 : 0)}%` }} />
                </div>
                <small>{row.label}</small>
              </div>
            );
          })}
        </div>
      </div>

      <div className="meter-ward-chart__summary">
        <span>Top Ward</span>
        <strong>{visibleRows[0]?.label || "NAv"}</strong>
        <b>{formatNumber(visibleRows[0]?.count || 0)}</b>

        <hr />

        <span>Lowest Ward</span>
        <strong>{visibleRows[visibleRows.length - 1]?.label || "NAv"}</strong>
        <b>{formatNumber(visibleRows[visibleRows.length - 1]?.count || 0)}</b>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <section className="meter-state-card" aria-live="polite" aria-busy="true">
      <div className="meter-spinner" aria-hidden="true" />
      <div>
        <h2>Loading Meters Registry...</h2>
        <p>Connecting to the live Meter Registry stream for the active workbase.</p>
      </div>
    </section>
  );
}

export default function MetersRegistryDashboardPage() {
  const { activeWorkbase } = useAuth();
  const activeLmPcode = getActiveLmPcode(activeWorkbase);
  const activeWorkbaseName = getActiveWorkbaseName(activeWorkbase);

  const {
    data: meterRows = [],
    isLoading: metersLoading,
    isFetching: metersFetching,
    error: metersError,
  } = useGetRegistryMetersByLmQuery(activeLmPcode || skipToken);

  const {
    data: wardRows = [],
    isLoading: wardsLoading,
    error: wardsError,
  } = useGetRegistryWardsByLmQuery(activeLmPcode || skipToken);

  const registry = useMemo(
    () => buildMeterRegistryReadModel(meterRows, wardRows),
    [meterRows, wardRows],
  );

  const statusGradient = useMemo(
    () => buildStatusGradient(registry.statuses, registry.total),
    [registry.statuses, registry.total],
  );

  const topWard = registry.wardsByMeterCount[0];
  const connectedShare = registry.connectedShare;

  if (!activeLmPcode) {
    return (
      <div className="meter-dashboard-page meter-dashboard-page--executive">
        <section className="meter-state-card meter-state-card--warning">
          <div>
            <h2>No Active Workbase</h2>
            <p>Select an active workbase before opening Meters Registry.</p>
          </div>
        </section>
      </div>
    );
  }

  if (metersLoading || wardsLoading) {
    return (
      <div className="meter-dashboard-page meter-dashboard-page--executive">
        <LoadingState />
      </div>
    );
  }

  if (metersError || wardsError) {
    return (
      <div className="meter-dashboard-page meter-dashboard-page--executive">
        <section className="meter-state-card meter-state-card--error">
          <div>
            <h2>Could Not Load Meters Registry</h2>
            <p>
              The live registry stream could not be opened for {activeLmPcode}.
            </p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="meter-dashboard-page meter-dashboard-page--executive">
      <section className="meter-exec-header">
        <div>
          <p className="meter-exec-eyebrow">Dashboard v1</p>
          <h2>Meters Registry</h2>
          <p>
            Live meter registry snapshot for {activeWorkbaseName}. All values below
            are derived from the current Registry stream.
          </p>
        </div>

        <div className="meter-exec-header__controls">
          <div className="meter-exec-snapshot">
            <span className="meter-live-dot" aria-hidden="true" />
            <strong>{metersFetching ? "Streaming" : "Live Registry"}</strong>
          </div>
          <div className="meter-exec-workbase">{activeLmPcode}</div>
        </div>
      </section>

      <section className="meter-exec-kpis">
        <KpiCard
          label="Total Meters"
          value={formatNumber(registry.total)}
          detail="Registered meter assets"
          tone="blue"
          icon="meter"
        />
        <KpiCard
          label="Connected"
          value={formatNumber(registry.connected)}
          detail={`${formatPercent(connectedShare)} of registry`}
          tone="teal"
          icon="status"
        />
        <KpiCard
          label="Visible"
          value={formatNumber(registry.visible)}
          detail={`${formatPercent(registry.visibleShare)} of registry`}
          tone="orange"
          icon="eye"
        />
        <KpiCard
          label="Wards"
          value={formatNumber(registry.wardsByMeterCount.length)}
          detail="Wards represented"
          tone="blue"
          icon="ward"
        />
      </section>

      <section className="meter-exec-main-grid">
        <article className="meter-exec-panel meter-exec-panel--status">
          <div className="meter-exec-panel__title">
            <div>
              <h3>Meter Status Distribution</h3>
              <span>Current lifecycle state</span>
            </div>
            <span className="meter-info-dot">i</span>
          </div>

          <div className="meter-status-layout">
            <div
              className="meter-status-donut"
              style={{ background: statusGradient }}
              aria-label="Meter status distribution"
            >
              <div className="meter-status-donut__center">
                <strong>{formatNumber(registry.total)}</strong>
                <span>Total Meters</span>
              </div>
            </div>

            <div className="meter-status-legend">
              {registry.statuses.slice(0, 6).map((row, index) => {
                const share =
                  registry.total > 0 ? (row.count / registry.total) * 100 : 0;

                return (
                  <div key={row.label}>
                    <span
                      className="meter-status-legend__dot"
                      style={{
                        background: STATUS_COLORS[index % STATUS_COLORS.length],
                      }}
                    />
                    <strong>{titleCase(row.label)}</strong>
                    <b>
                      {formatNumber(row.count)} ({formatPercent(share)})
                    </b>
                  </div>
                );
              })}
            </div>
          </div>
        </article>

        <article className="meter-exec-panel meter-exec-panel--coverage">
          <div className="meter-exec-panel__title">
            <div>
              <h3>Registry Coverage</h3>
              <span>Visibility and asset linkage</span>
            </div>
            <span className="meter-info-dot">i</span>
          </div>

          <div className="meter-coverage-total">
            <span>Total Meters</span>
            <strong>{formatNumber(registry.total)}</strong>
          </div>

          <div className="meter-coverage-stack">
            <div
              className="meter-coverage-stack__visible"
              style={{ width: `${registry.visibleShare}%` }}
            >
              {registry.visible > 0 ? (
                <span>
                  {formatNumber(registry.visible)} ({formatPercent(registry.visibleShare)})
                </span>
              ) : null}
            </div>
            <div
              className="meter-coverage-stack__invisible"
              style={{ width: `${registry.invisibleShare}%` }}
            >
              {registry.invisible > 0 ? (
                <span>
                  {formatNumber(registry.invisible)} ({formatPercent(registry.invisibleShare)})
                </span>
              ) : null}
            </div>
          </div>

          <div className="meter-coverage-legend">
            <div>
              <span className="meter-coverage-legend__dot meter-coverage-legend__dot--visible" />
              <small>Visible</small>
              <strong>{formatNumber(registry.visible)}</strong>
              <b>{formatPercent(registry.visibleShare)}</b>
            </div>
            <div>
              <span className="meter-coverage-legend__dot meter-coverage-legend__dot--invisible" />
              <small>Invisible</small>
              <strong>{formatNumber(registry.invisible)}</strong>
              <b>{formatPercent(registry.invisibleShare)}</b>
            </div>
          </div>

          <div className="meter-linkage-summary">
            <div>
              <span>Premise Linked</span>
              <strong>{formatNumber(registry.linkedPremise)}</strong>
              <small>{formatPercent(registry.premiseLinkShare)}</small>
            </div>
            <div>
              <span>ERF Linked</span>
              <strong>{formatNumber(registry.linkedErf)}</strong>
              <small>{formatPercent(registry.erfLinkShare)}</small>
            </div>
          </div>
        </article>

        <article className="meter-exec-panel meter-exec-panel--types">
          <div className="meter-exec-panel__title">
            <div>
              <h3>By Meter Type</h3>
              <span>Current registry composition</span>
            </div>
            <span className="meter-info-dot">i</span>
          </div>

          <MeterTypeTable registry={registry} />

          {registry.kinds.length > 0 ? (
            <div className="meter-kind-summary">
              <span>Meter Kind</span>
              <div>
                {registry.kinds.slice(0, 3).map((row) => (
                  <b key={row.label}>
                    {row.label}: {formatNumber(row.count)}
                  </b>
                ))}
              </div>
            </div>
          ) : null}
        </article>
      </section>

      <section className="meter-exec-bottom-grid">
        <article className="meter-exec-panel meter-exec-panel--wards">
          <div className="meter-exec-panel__title">
            <div>
              <h3>Ward / Area Snapshot</h3>
              <span>Meters by Ward</span>
            </div>
            <span className="meter-info-dot">i</span>
          </div>

          <WardChart
            rows={registry.wardsByMeterCount}
            maxCount={registry.maxWardCount}
          />
        </article>

        <article className="meter-exec-panel meter-exec-panel--notes">
          <div className="meter-exec-panel__title">
            <div>
              <h3>Key Notes</h3>
              <span>Live registry highlights</span>
            </div>
          </div>

          <ul className="meter-key-notes">
            <li>
              <span />
              <p>
                <strong>{formatNumber(registry.total)}</strong> total meters currently
                registered.
              </p>
            </li>
            <li>
              <span />
              <p>
                <strong>{formatNumber(registry.connected)}</strong> connected meters (
                {formatPercent(connectedShare)}).
              </p>
            </li>
            <li>
              <span />
              <p>
                <strong>{formatNumber(registry.visible)}</strong> visible meters (
                {formatPercent(registry.visibleShare)}).
              </p>
            </li>
            <li>
              <span />
              <p>
                <strong>{formatNumber(registry.linkedPremise)}</strong> meters linked
                to a premise ({formatPercent(registry.premiseLinkShare)}).
              </p>
            </li>
            {topWard ? (
              <li>
                <span />
                <p>
                  <strong>{topWard.label}</strong> is the largest represented ward with{" "}
                  {formatNumber(topWard.count)} meters.
                </p>
              </li>
            ) : null}
          </ul>

          <div className="meter-notes-illustration" aria-hidden="true">
            <svg viewBox="0 0 160 120">
              <path
                d="M32 96c20-19 31-43 29-72M128 97c-18-20-25-43-19-69"
                fill="none"
                stroke="currentColor"
                strokeWidth="5"
                opacity=".12"
              />
              <rect x="52" y="19" width="61" height="78" rx="8" />
              <path d="M67 19v-7h31v7M67 39h31M67 55h31M67 71h22" />
              <path d="m119 78 18-40 9 4-18 40-12 9Z" />
            </svg>
          </div>
        </article>
      </section>

      <footer className="meter-exec-footer">
        <span className="meter-live-dot" aria-hidden="true" />
        <span>
          Live source: <strong>registry_meters</strong> · {activeWorkbaseName}
        </span>
      </footer>
    </div>
  );
}
