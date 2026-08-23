/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useMemo, useState } from "react";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGetAvailableTeamsQuery } from "../../redux/teamsApi";
import { useGetRegistryTrnsByLmPcodeQuery } from "../../redux/trnsApi";
import { useGetUsersDirectoryQuery } from "../../redux/usersApi";

import "./TrnRegistryDashboardPage.css";

const TYPE_CONFIG = [
  { key: "METER_DISCOVERY", label: "Meter Discovery", color: "#0f9f95" },
  { key: "NO_ACCESS", label: "No Access", color: "#f97316" },
  { key: "METER_INSPECTION", label: "Inspection", color: "#2563eb" },
  { key: "METER_INSTALLATION", label: "Installation", color: "#7c3aed" },
  { key: "METER_REMOVAL", label: "Removal", color: "#f59e0b" },
  { key: "METER_DISCONNECTION", label: "Disconnection", color: "#0f7c86" },
  { key: "METER_RECONNECTION", label: "Reconnection", color: "#63c7bd" },
  { key: "OTHER", label: "Other", color: "#94a3b8" },
];

const CHART_LINE_COLORS = {
  TOTAL: "#0d5ed7",
  METER_DISCOVERY: "#0f9f95",
  NO_ACCESS: "#f97316",
  METER_INSPECTION: "#7c3aed",
  METER_INSTALLATION: "#d946ef",
  METER_REMOVAL: "#f59e0b",
  METER_DISCONNECTION: "#dc2626",
  METER_RECONNECTION: "#16a34a",
  METER_COMMISSIONING: "#4f46e5",
  METER_READING: "#0891b2",
  OTHER: "#64748b",
};

const TOTAL_SERIES = {
  key: "TOTAL",
  label: "Total TRNs",
  color: CHART_LINE_COLORS.TOTAL,
};

const CHART_TRN_TYPE_CONFIG = [
  { key: "METER_DISCOVERY", label: "Meter Discovery" },
  { key: "METER_INSPECTION", label: "Inspection" },
  { key: "METER_INSTALLATION", label: "Installation" },
  { key: "METER_REMOVAL", label: "Removal" },
  { key: "METER_DISCONNECTION", label: "Disconnection" },
  { key: "METER_RECONNECTION", label: "Reconnection" },
  { key: "METER_COMMISSIONING", label: "Commissioning" },
  { key: "METER_READING", label: "Meter Reading" },
];

const CHART_TRN_TYPE_KEYS = new Set(
  CHART_TRN_TYPE_CONFIG.map((series) => series.key),
);

const CHART_SERIES_CONFIG = [
  TOTAL_SERIES,
  { key: "NO_ACCESS", label: "No Access", color: CHART_LINE_COLORS.NO_ACCESS },
  ...CHART_TRN_TYPE_CONFIG.map((series) => ({
    ...series,
    color: CHART_LINE_COLORS[series.key],
  })),
  { key: "OTHER", label: "Other", color: CHART_LINE_COLORS.OTHER },
];

const PRODUCTION_FILTER_MODES = [
  { key: "ALL", label: "All" },
  { key: "USERS", label: "Users" },
  { key: "TEAMS", label: "Teams" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

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

function hasMeaningfulValue(value) {
  const text = String(value || "").trim();
  return Boolean(text && !["NAV", "NAV", "-", "N/A"].includes(text.toUpperCase()));
}

function startOfLocalDay(value = new Date()) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function dateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat("en-ZA", {
    month: "short",
    day: "numeric",
  }).format(value);
}

function formatLongDate(value) {
  return new Intl.DateTimeFormat("en-ZA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(value);
}

function formatDateTime(value) {
  if (!value || value === "NAv") return "NAv";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "NAv";

  return new Intl.DateTimeFormat("en-ZA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function classifyTrn(trn) {
  const hasAccess = normalizeCode(trn?.hasAccess);
  const trnType = normalizeCode(trn?.trnType);

  if (hasAccess === "NO" || trnType === "NO_ACCESS" || trnType === "NA") {
    return "NO_ACCESS";
  }

  if (TYPE_CONFIG.some((entry) => entry.key === trnType && entry.key !== "OTHER")) {
    return trnType;
  }

  return "OTHER";
}

function buildTypeRows(rows) {
  const counts = new Map(TYPE_CONFIG.map((entry) => [entry.key, 0]));

  rows.forEach((row) => {
    const key = classifyTrn(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return TYPE_CONFIG.map((entry) => ({
    ...entry,
    count: counts.get(entry.key) || 0,
  })).filter((entry) => entry.key !== "OTHER" || entry.count > 0);
}

function buildTypeGradient(typeRows, total) {
  if (!total) return "conic-gradient(#e2e8f0 0deg 360deg)";

  let cursor = 0;

  const stops = typeRows.map((row) => {
    const start = cursor;
    const end = cursor + (row.count / total) * 360;
    cursor = end;
    return `${row.color} ${start}deg ${end}deg`;
  });

  if (cursor < 360) {
    stops.push(`#e2e8f0 ${cursor}deg 360deg`);
  }

  return `conic-gradient(${stops.join(", ")})`;
}

function buildDailyProduction(rows, days, now = new Date()) {
  const today = startOfLocalDay(now);
  const start = addDays(today, -(days - 1));
  const countsByDate = new Map();

  rows.forEach((row) => {
    const key = dateKey(row?.createdAt);
    if (!key) return;

    const trnType = normalizeCode(row?.trnType);
    const hasAccess = normalizeCode(row?.hasAccess);
    const current = countsByDate.get(key) || { TOTAL: 0 };

    current.TOTAL += 1;

    if (CHART_TRN_TYPE_KEYS.has(trnType)) {
      current[trnType] = (current[trnType] || 0) + 1;
    } else if (!["NO_ACCESS", "NA", "NAV", "NAv"].includes(trnType)) {
      current.OTHER = (current.OTHER || 0) + 1;
    }

    if (hasAccess === "NO" || trnType === "NO_ACCESS" || trnType === "NA") {
      current.NO_ACCESS = (current.NO_ACCESS || 0) + 1;
    }

    countsByDate.set(key, current);
  });

  const actual = Array.from({ length: days }, (_, index) => {
    const date = addDays(start, index);
    const key = dateKey(date);
    const counts = countsByDate.get(key) || { TOTAL: 0 };

    return {
      date,
      key,
      count: counts.TOTAL || 0,
      counts,
      forecast: false,
    };
  });

  const total = actual.reduce((sum, row) => sum + row.count, 0);
  const average = days > 0 ? total / days : 0;
  const forecastCount = Math.round(average);

  const forecast = Array.from({ length: 3 }, (_, index) => {
    const date = addDays(today, index + 1);
    return {
      date,
      key: dateKey(date),
      count: forecastCount,
      forecast: true,
    };
  });

  return {
    actual,
    forecast,
    average,
    total,
    todayCount: countsByDate.get(dateKey(today))?.TOTAL || 0,
  };
}

function filterProductionRows(
  rows,
  mode,
  selectedUserIds,
  selectedTeamIds,
  teams,
) {
  if (mode === "USERS" && selectedUserIds.length > 0) {
    const allowedUserIds = new Set(selectedUserIds.map((id) => String(id)));

    return rows.filter((row) => {
      const uid = hasMeaningfulValue(row?.createdByUid)
        ? String(row.createdByUid).trim()
        : "";
      return Boolean(uid && allowedUserIds.has(uid));
    });
  }

  if (mode === "TEAMS" && selectedTeamIds.length > 0) {
    const selectedTeamIdSet = new Set(selectedTeamIds.map((id) => String(id)));
    const allowedUserIds = new Set();

    teams.forEach((team) => {
      const teamId = String(team?.id || "").trim();
      if (!teamId || !selectedTeamIdSet.has(teamId)) return;

      (team?.memberUserIds || []).forEach((uidValue) => {
        const uid = String(uidValue || "").trim();
        if (uid) allowedUserIds.add(uid);
      });
    });

    return rows.filter((row) => {
      const uid = hasMeaningfulValue(row?.createdByUid)
        ? String(row.createdByUid).trim()
        : "";
      return Boolean(uid && allowedUserIds.has(uid));
    });
  }

  return rows;
}

function buildRawTopUsers(rows, users) {
  const namesByUid = new Map(
    users
      .map((user) => [
        String(user?.uid || user?.id || "").trim(),
        user?.displayName || user?.name || user?.email,
      ])
      .filter(([uid]) => Boolean(uid)),
  );

  const usersByKey = new Map();

  rows.forEach((row) => {
    const uid = hasMeaningfulValue(row?.createdByUid)
      ? String(row.createdByUid).trim()
      : "";
    const fallbackName = hasMeaningfulValue(row?.createdByUser)
      ? String(row.createdByUser).trim()
      : "";
    const key = uid || (fallbackName ? `name:${fallbackName}` : "");

    if (!key) return;

    const current = usersByKey.get(key) || {
      id: key,
      uid,
      name: uid && hasMeaningfulValue(namesByUid.get(uid))
        ? namesByUid.get(uid)
        : fallbackName || uid,
      count: 0,
    };

    current.count += 1;
    usersByKey.set(key, current);
  });

  return Array.from(usersByKey.values()).sort(
    (left, right) =>
      right.count - left.count ||
      String(left.name).localeCompare(String(right.name), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
  );
}

function buildTopTeams(rows, teams) {
  const memberships = new Map();

  [...teams]
    .sort((left, right) =>
      String(left?.name || "").localeCompare(String(right?.name || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    )
    .forEach((team) => {
      (team?.memberUserIds || []).forEach((uidValue) => {
        const uid = String(uidValue || "").trim();
        if (!uid) return;

        const memberTeams = memberships.get(uid) || [];
        memberTeams.push(team);
        memberships.set(uid, memberTeams);
      });
    });

  const counts = new Map();

  rows.forEach((row) => {
    const uid = hasMeaningfulValue(row?.createdByUid)
      ? String(row.createdByUid).trim()
      : "";

    if (!uid) return;

    const memberTeams = memberships.get(uid) || [];
    if (memberTeams.length !== 1) return;

    const team = memberTeams[0];
    const key = String(team?.id || team?.name || "").trim();
    if (!key) return;

    const current = counts.get(key) || {
      id: key,
      name: team?.name || key,
      count: 0,
    };

    current.count += 1;
    counts.set(key, current);
  });

  return Array.from(counts.values()).sort(
    (left, right) =>
      right.count - left.count ||
      String(left.name).localeCompare(String(right.name), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
  );
}

function getUniqueMeterCount(rows) {
  const meterNos = new Set();

  rows.forEach((row) => {
    const meterNo = hasMeaningfulValue(row?.meterNo)
      ? String(row.meterNo).trim()
      : hasMeaningfulValue(row?.astNo)
        ? String(row.astNo).trim()
        : "";

    if (meterNo) meterNos.add(meterNo);
  });

  return meterNos.size;
}

function getLatestUpdate(rows) {
  let latest = null;

  rows.forEach((row) => {
    const value = row?.lastUpdatedAt || row?.createdAt;
    if (!value || value === "NAv") return;

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return;
    if (!latest || date > latest) latest = date;
  });

  return latest;
}

function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return "NA";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
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

  if (name === "document") {
    return (
      <svg {...common}>
        <path d="M6 2h8l4 4v16H6z" />
        <path d="M14 2v5h5M9 12h6M9 16h6" />
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

  if (name === "trend") {
    return (
      <svg {...common}>
        <path d="m4 17 5-5 4 3 7-8" />
        <path d="M15 7h5v5" />
      </svg>
    );
  }

  if (name === "gauge") {
    return (
      <svg {...common}>
        <path d="M4 17a8 8 0 1 1 16 0" />
        <path d="m12 13 4-4M7 17h10" />
      </svg>
    );
  }

  if (name === "filter") {
    return (
      <svg {...common}>
        <path d="M4 5h16l-6 7v6l-4 2v-8z" />
      </svg>
    );
  }

  return null;
}

function KpiCard({ label, value, detail, tone, icon }) {
  return (
    <article className={`trn-exec-kpi trn-exec-kpi--${tone}`}>
      <div className="trn-exec-kpi__icon">
        <Icon name={icon} />
      </div>
      <div className="trn-exec-kpi__copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      <Icon name={icon} />
    </article>
  );
}

function ProductionChart({ production, selectedSeries }) {
  const showForecast = selectedSeries.includes("TOTAL");
  const rows = showForecast
    ? [...production.actual, ...production.forecast]
    : production.actual;
  const width = 760;
  const height = 286;
  const margin = { top: 20, right: 24, bottom: 48, left: 48 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const visibleSeries = CHART_SERIES_CONFIG.filter((series) =>
    selectedSeries.includes(series.key),
  );

  const actualValues = visibleSeries.flatMap((series) =>
    production.actual.map((row) => row.counts?.[series.key] || 0),
  );
  const forecastValues = showForecast
    ? production.forecast.map((row) => row.count)
    : [];
  const rawMax = Math.max(1, ...actualValues, ...forecastValues);
  const stepSize =
    rawMax <= 10 ? 2 : rawMax <= 50 ? 10 : rawMax <= 100 ? 20 : Math.ceil(rawMax / 5 / 10) * 10;
  const maxY = Math.max(stepSize, Math.ceil(rawMax / stepSize) * stepSize);
  const ticks = Array.from({ length: 5 }, (_, index) =>
    Math.round((maxY / 4) * index),
  );

  const xForIndex = (index) =>
    margin.left + (rows.length <= 1 ? 0 : (index / (rows.length - 1)) * plotWidth);
  const yForValue = (value) =>
    margin.top + plotHeight - (Math.max(0, value) / maxY) * plotHeight;

  const actualSeries = visibleSeries.map((series) => {
    const points = production.actual.map((row, index) => {
      const count = row.counts?.[series.key] || 0;
      return {
        ...row,
        count,
        x: xForIndex(index),
        y: yForValue(count),
      };
    });

    return {
      ...series,
      points,
      path: points
        .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
        .join(" "),
    };
  });

  const forecastPoints = showForecast
    ? production.forecast.map((row, index) => ({
        ...row,
        x: xForIndex(production.actual.length + index),
        y: yForValue(row.count),
      }))
    : [];

  const totalSeries = actualSeries.find((series) => series.key === "TOTAL");
  const forecastSeed = totalSeries?.points?.[totalSeries.points.length - 1];
  const forecastPath = [forecastSeed, ...forecastPoints]
    .filter(Boolean)
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");

  const labelEvery = Math.max(1, Math.ceil(production.actual.length / 7));
  const showValueLabels = visibleSeries.length === 1;

  return (
    <div className="trn-production-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Daily TRN production">
        {ticks.map((tick) => {
          const y = yForValue(tick);
          return (
            <g key={tick}>
              <line
                x1={margin.left}
                x2={width - margin.right}
                y1={y}
                y2={y}
                className="trn-chart-gridline"
              />
              <text x={margin.left - 12} y={y + 4} textAnchor="end" className="trn-chart-axis">
                {formatNumber(tick)}
              </text>
            </g>
          );
        })}

        {actualSeries.map((series) => (
          <g key={series.key}>
            {series.path ? (
              <path
                d={series.path}
                className="trn-chart-line"
                style={{ stroke: series.color }}
              />
            ) : null}
            {series.points.map((point) => (
              <g key={`${series.key}-${point.key}`}>
                <title>{`${series.label} · ${formatShortDate(point.date)} · ${formatNumber(point.count)}`}</title>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="5.5"
                  className="trn-chart-point"
                  style={{ fill: series.color, stroke: series.color }}
                />
                {showValueLabels ? (
                  <text
                    x={point.x}
                    y={Math.max(14, point.y - 12)}
                    textAnchor="middle"
                    className="trn-chart-value"
                    style={{ fill: series.color }}
                  >
                    {formatNumber(point.count)}
                  </text>
                ) : null}
              </g>
            ))}
          </g>
        ))}

        {forecastPath ? (
          <path
            d={forecastPath}
            className="trn-chart-line trn-chart-line--forecast"
            style={{ stroke: TOTAL_SERIES.color }}
          />
        ) : null}

        {production.actual.map((row, index) => (
          (index % labelEvery === 0 || index === production.actual.length - 1) ? (
            <text
              key={row.key}
              x={xForIndex(index)}
              y={height - 18}
              textAnchor="middle"
              className="trn-chart-axis trn-chart-axis--date"
            >
              {formatShortDate(row.date)}
            </text>
          ) : null
        ))}

        {forecastPoints.map((point) => (
          <g key={point.key}>
            <title>{`Total TRNs Forecast · ${formatShortDate(point.date)} · ${formatNumber(point.count)}`}</title>
            <circle
              cx={point.x}
              cy={point.y}
              r="5.5"
              className="trn-chart-point trn-chart-point--forecast"
              style={{ stroke: TOTAL_SERIES.color }}
            />
            {showValueLabels ? (
              <text
                x={point.x}
                y={Math.max(14, point.y - 12)}
                textAnchor="middle"
                className="trn-chart-value"
                style={{ fill: TOTAL_SERIES.color }}
              >
                {formatNumber(point.count)}
              </text>
            ) : null}
            <text
              x={point.x}
              y={height - 18}
              textAnchor="middle"
              className="trn-chart-axis trn-chart-axis--date"
            >
              {formatShortDate(point.date)}
            </text>
          </g>
        ))}
      </svg>

      <div className="trn-chart-legend">
        {visibleSeries.map((series) => (
          <span key={series.key}>
            <i style={{ borderTopColor: series.color }} />
            {series.label}
          </span>
        ))}
        {showForecast ? (
          <span>
            <i
              className="trn-chart-legend__forecast"
              style={{ borderTopColor: TOTAL_SERIES.color }}
            />
            Total TRNs Forecast
          </span>
        ) : null}
      </div>
    </div>
  );
}

function TypeBreakdown({ rows, total }) {
  const gradient = buildTypeGradient(rows, total);

  return (
    <div className="trn-type-layout">
      <div className="trn-type-donut" style={{ background: gradient }}>
        <div className="trn-type-donut__center">
          <strong>{formatNumber(total)}</strong>
          <span>Total TRNs</span>
        </div>
      </div>

      <div className="trn-type-table">
        <div className="trn-type-table__head">
          <span />
          <span>Count</span>
          <span>%</span>
        </div>

        {rows.map((row) => {
          const share = total > 0 ? (row.count / total) * 100 : 0;
          return (
            <div className="trn-type-table__row" key={row.key}>
              <div>
                <i style={{ background: row.color }} />
                <strong>{row.label}</strong>
              </div>
              <b>{formatNumber(row.count)}</b>
              <span>{formatPercent(share)}</span>
            </div>
          );
        })}

        <div className="trn-type-table__total">
          <strong>Total</strong>
          <strong>{formatNumber(total)}</strong>
          <strong>100%</strong>
        </div>
      </div>
    </div>
  );
}

function RankingPanel({ title, rows, total, kind }) {
  const visibleRows = rows.slice(0, 3);
  const maxCount = visibleRows[0]?.count || 0;

  return (
    <article className="trn-exec-panel trn-ranking-panel">
      <div className="trn-exec-panel__title">
        <h3>{title}</h3>
        <span className="trn-info-dot">i</span>
      </div>

      {visibleRows.length ? (
        <div className="trn-ranking-table">
          <div className="trn-ranking-table__head">
            <span>Rank</span>
            <span>{kind === "team" ? "Team" : "User"}</span>
            <span>Total TRNs</span>
            <span>% of Total</span>
          </div>

          {visibleRows.map((row, index) => {
            const share = total > 0 ? (row.count / total) * 100 : 0;
            const barShare = maxCount > 0 ? (row.count / maxCount) * 100 : 0;

            return (
              <div className="trn-ranking-row" key={row.id || row.name}>
                <span className={`trn-rank-badge trn-rank-badge--${index + 1}`}>{index + 1}</span>

                <div className="trn-ranking-person">
                  <span className={`trn-ranking-avatar trn-ranking-avatar--${kind}`}>
                    {kind === "team" ? "●●" : initials(row.name)}
                  </span>
                  <strong title={row.name}>{row.name}</strong>
                </div>

                <div className="trn-ranking-count">
                  <strong>{formatNumber(row.count)}</strong>
                  <span><i style={{ width: `${barShare}%` }} /></span>
                </div>

                <b>{formatPercent(share)}</b>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="trn-empty-copy">No attributed {kind === "team" ? "team" : "user"} activity is available.</p>
      )}
    </article>
  );
}

function LoadingState() {
  return (
    <section className="trn-state-card" aria-live="polite" aria-busy="true">
      <div className="trn-spinner" aria-hidden="true" />
      <div>
        <h2>Loading TRN Registry...</h2>
        <p>Connecting to the live TRN stream for the active workbase.</p>
      </div>
    </section>
  );
}

export default function TrnRegistryDashboardPage() {
  const { activeWorkbase } = useAuth();
  const activeLmPcode = getActiveLmPcode(activeWorkbase);
  const activeWorkbaseName = getActiveWorkbaseName(activeWorkbase);

  const [windowDays, setWindowDays] = useState(7);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [productionFilterMode, setProductionFilterMode] = useState("ALL");
  const [selectedProductionUserIds, setSelectedProductionUserIds] = useState([]);
  const [selectedProductionTeamIds, setSelectedProductionTeamIds] = useState([]);
  const [selectedProductionSeries, setSelectedProductionSeries] = useState(["TOTAL"]);

  const {
    data: trnRows = [],
    isLoading: trnsLoading,
    isFetching: trnsFetching,
    error: trnsError,
  } = useGetRegistryTrnsByLmPcodeQuery(activeLmPcode || skipToken);

  const {
    data: users = [],
    isLoading: usersLoading,
    error: usersError,
  } = useGetUsersDirectoryQuery();

  const {
    data: teams = [],
    isLoading: teamsLoading,
    error: teamsError,
  } = useGetAvailableTeamsQuery();

  const totalTrns = trnRows.length;

  const productionRows = useMemo(
    () =>
      filterProductionRows(
        trnRows,
        productionFilterMode,
        selectedProductionUserIds,
        selectedProductionTeamIds,
        teams,
      ),
    [
      productionFilterMode,
      selectedProductionTeamIds,
      selectedProductionUserIds,
      teams,
      trnRows,
    ],
  );

  const production = useMemo(
    () => buildDailyProduction(productionRows, windowDays),
    [productionRows, windowDays],
  );

  const typeRows = useMemo(() => buildTypeRows(trnRows), [trnRows]);
  const uniqueMeters = useMemo(() => getUniqueMeterCount(trnRows), [trnRows]);
  const topUsers = useMemo(() => buildRawTopUsers(trnRows, users), [trnRows, users]);
  const topTeams = useMemo(() => buildTopTeams(trnRows, teams), [trnRows, teams]);
  const latestUpdate = useMemo(() => getLatestUpdate(trnRows), [trnRows]);

  const changeProductionFilterMode = (mode) => {
    setProductionFilterMode(mode);

    if (mode !== "USERS") setSelectedProductionUserIds([]);
    if (mode !== "TEAMS") setSelectedProductionTeamIds([]);
  };

  const toggleProductionUser = (userId) => {
    setSelectedProductionUserIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  };

  const toggleProductionTeam = (teamId) => {
    setSelectedProductionTeamIds((current) =>
      current.includes(teamId)
        ? current.filter((id) => id !== teamId)
        : [...current, teamId],
    );
  };

  const productionUserSummary =
    selectedProductionUserIds.length === 0
      ? "All Users"
      : selectedProductionUserIds.length === 1
        ? "1 User Selected"
        : `${selectedProductionUserIds.length} Users Selected`;

  const productionTeamSummary =
    selectedProductionTeamIds.length === 0
      ? "All Teams"
      : selectedProductionTeamIds.length === 1
        ? "1 Team Selected"
        : `${selectedProductionTeamIds.length} Teams Selected`;

  const toggleProductionSeries = (seriesKey) => {
    setSelectedProductionSeries((current) => {
      if (current.includes(seriesKey)) {
        if (current.length === 1) return current;
        return current.filter((key) => key !== seriesKey);
      }

      return [...current, seriesKey];
    });
  };

  const productionSeriesSummary = useMemo(() => {
    if (selectedProductionSeries.length === 1) {
      return (
        CHART_SERIES_CONFIG.find(
          (series) => series.key === selectedProductionSeries[0],
        )?.label || "1 line selected"
      );
    }

    return `${selectedProductionSeries.length} lines selected`;
  }, [selectedProductionSeries]);

  if (!activeLmPcode) {
    return (
      <div className="trn-dashboard-page">
        <section className="trn-state-card trn-state-card--warning">
          <div>
            <h2>No Active Workbase</h2>
            <p>Select an active workbase before opening TRN Registry.</p>
          </div>
        </section>
      </div>
    );
  }

  if (trnsLoading || usersLoading || teamsLoading) {
    return (
      <div className="trn-dashboard-page">
        <LoadingState />
      </div>
    );
  }

  if (trnsError) {
    return (
      <div className="trn-dashboard-page">
        <section className="trn-state-card trn-state-card--error">
          <div>
            <h2>Could Not Load TRN Registry</h2>
            <p>The live TRN stream could not be opened for {activeLmPcode}.</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="trn-dashboard-page">
      <section className="trn-exec-header">
        <div>
          <p className="trn-exec-eyebrow">Dashboard v1</p>
          <h2>TRN Registry</h2>
          <p>
            Live TRN production, daily field trends, type mix and production leaders for{" "}
            {activeWorkbaseName}.
          </p>
        </div>

        <div className="trn-exec-header__controls">
          <div className="trn-date-control" title="Dashboard date">
            <Icon name="calendar" />
            <strong>{formatLongDate(new Date())}</strong>
            <span>⌄</span>
          </div>

          <button
            type="button"
            className={`trn-filter-button${filtersOpen ? " is-active" : ""}`}
            onClick={() => setFiltersOpen((current) => !current)}
            aria-expanded={filtersOpen}
          >
            <Icon name="filter" />
            Filters
          </button>
        </div>
      </section>

      {filtersOpen ? (
        <section className="trn-filter-panel">
          <div className="trn-filter-controls">
            <label className="trn-filter-control">
              <span>Daily Production Window</span>
              <select
                value={windowDays}
                onChange={(event) => setWindowDays(Number(event.target.value))}
              >
                <option value={7}>Last 7 Days</option>
                <option value={14}>Last 14 Days</option>
                <option value={30}>Last 30 Days</option>
              </select>
            </label>

            <div className="trn-filter-control">
              <span>Filter By</span>
              <div
                className="trn-production-filter-mode"
                role="group"
                aria-label="Filter Daily TRN Production by"
              >
                {PRODUCTION_FILTER_MODES.map((mode) => (
                  <button
                    type="button"
                    key={mode.key}
                    className={productionFilterMode === mode.key ? "is-active" : ""}
                    aria-pressed={productionFilterMode === mode.key}
                    onClick={() => changeProductionFilterMode(mode.key)}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            {productionFilterMode === "USERS" ? (
              <div className="trn-filter-control">
                <span>Users</span>
                <details className="trn-series-filter trn-attribution-filter">
                  <summary>{productionUserSummary}</summary>
                  <div className="trn-series-filter__menu">
                    <label className="trn-series-filter__option trn-series-filter__option--plain">
                      <input
                        type="checkbox"
                        checked={selectedProductionUserIds.length === 0}
                        onChange={() => setSelectedProductionUserIds([])}
                      />
                      <span>All Users</span>
                    </label>
                    <div className="trn-series-filter__divider" />
                    {users.map((user) => {
                      const userId = String(user?.uid || user?.id || "").trim();
                      if (!userId) return null;

                      const checked = selectedProductionUserIds.includes(userId);
                      const userLabel =
                        user?.displayName || user?.name || user?.email || userId;

                      return (
                        <label
                          className="trn-series-filter__option trn-series-filter__option--plain"
                          key={userId}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleProductionUser(userId)}
                          />
                          <span>{userLabel}</span>
                        </label>
                      );
                    })}
                  </div>
                </details>
              </div>
            ) : null}

            {productionFilterMode === "TEAMS" ? (
              <div className="trn-filter-control">
                <span>Teams</span>
                <details className="trn-series-filter trn-attribution-filter">
                  <summary>{productionTeamSummary}</summary>
                  <div className="trn-series-filter__menu">
                    <label className="trn-series-filter__option trn-series-filter__option--plain">
                      <input
                        type="checkbox"
                        checked={selectedProductionTeamIds.length === 0}
                        onChange={() => setSelectedProductionTeamIds([])}
                      />
                      <span>All Teams</span>
                    </label>
                    <div className="trn-series-filter__divider" />
                    {teams.map((team) => {
                      const teamId = String(team?.id || "").trim();
                      if (!teamId) return null;

                      const checked = selectedProductionTeamIds.includes(teamId);
                      const teamLabel = team?.name || team?.label || teamId;

                      return (
                        <label
                          className="trn-series-filter__option trn-series-filter__option--plain"
                          key={teamId}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleProductionTeam(teamId)}
                          />
                          <span>{teamLabel}</span>
                        </label>
                      );
                    })}
                  </div>
                </details>
              </div>
            ) : null}

            <div className="trn-filter-control">
              <span>TRN Types To Show</span>
              <details className="trn-series-filter">
                <summary>{productionSeriesSummary}</summary>
                <div className="trn-series-filter__menu">
                  {CHART_SERIES_CONFIG.map((series) => {
                    const checked = selectedProductionSeries.includes(series.key);
                    const isOnlySelected = checked && selectedProductionSeries.length === 1;

                    return (
                      <label className="trn-series-filter__option" key={series.key}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isOnlySelected}
                          onChange={() => toggleProductionSeries(series.key)}
                        />
                        <i style={{ background: series.color }} aria-hidden="true" />
                        <span>{series.label}</span>
                      </label>
                    );
                  })}
                </div>
              </details>
            </div>
          </div>

          <div className="trn-filter-live">
            <span className="trn-live-dot" />
            <strong>{trnsFetching ? "Streaming updates" : "Live TRN Registry"}</strong>
            <small>{activeLmPcode}</small>
          </div>
        </section>
      ) : null}

      <section className="trn-exec-kpis">
        <KpiCard
          label="Total TRNs"
          value={formatNumber(totalTrns)}
          detail="Live registry population"
          tone="blue"
          icon="document"
        />
        <KpiCard
          label="Today"
          value={formatNumber(production.todayCount)}
          detail="TRNs created today"
          tone="teal"
          icon="calendar"
        />
        <KpiCard
          label="Avg / Day"
          value={formatNumber(Math.round(production.average))}
          detail={`Rolling ${windowDays}-day average`}
          tone="orange"
          icon="trend"
        />
        <KpiCard
          label="Unique Meters"
          value={formatNumber(uniqueMeters)}
          detail="Distinct meter numbers in TRNs"
          tone="blue"
          icon="gauge"
        />
      </section>

      <section className="trn-exec-main-grid">
        <article className="trn-exec-panel trn-production-panel">
          <div className="trn-exec-panel__title">
            <div>
              <h3>Daily TRN Production</h3>
              <span>Selected daily production lines with Total TRN forecast</span>
            </div>
            <span className="trn-info-dot">i</span>
          </div>

          <ProductionChart production={production} selectedSeries={selectedProductionSeries} />
        </article>

        <article className="trn-exec-panel trn-type-panel">
          <div className="trn-exec-panel__title">
            <div>
              <h3>TRN Type Breakdown</h3>
              <span>Live registry composition</span>
            </div>
            <span className="trn-info-dot">i</span>
          </div>

          <TypeBreakdown rows={typeRows} total={totalTrns} />
        </article>
      </section>

      <section className="trn-exec-bottom-grid">
        <RankingPanel title="Top Users" rows={topUsers} total={totalTrns} kind="user" />
        <RankingPanel title="Top Teams" rows={topTeams} total={totalTrns} kind="team" />
      </section>

      <footer className="trn-exec-footer">
        <span className="trn-live-dot" aria-hidden="true" />
        <span>
          Last updated: <strong>{latestUpdate ? formatDateTime(latestUpdate) : "Live"}</strong>
          {" · "}Source: <strong>trns</strong>
          {usersError || teamsError ? " · User/team directory attribution is partially unavailable" : ""}
        </span>
      </footer>
    </div>
  );
}
