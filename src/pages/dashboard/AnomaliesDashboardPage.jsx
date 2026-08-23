/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useMemo, useState } from "react";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGetAvailableTeamsQuery } from "../../redux/teamsApi";
import { useGetRegistryTrnsByLmPcodeQuery } from "../../redux/trnsApi";
import { useGetUsersDirectoryQuery } from "../../redux/usersApi";

import "./AnomaliesDashboardPage.css";

const METER_DISCOVERY_TYPE = "METER_DISCOVERY";
const TOTAL_SERIES_KEY = "TOTAL";
const DAY_MS = 24 * 60 * 60 * 1000;

const TREND_FILTER_MODES = [
  { key: "ALL", label: "All" },
  { key: "USERS", label: "Users" },
  { key: "TEAMS", label: "Teams" },
];

const TREND_GROUP_MODES = [
  { key: "MAIN", label: "Main Anomaly" },
  { key: "SUB", label: "Sub Anomaly" },
];

const KNOWN_MAIN_COLORS = new Map([
  ["METER OK", "#0f9f95"],
  ["METER NOT ON PORTAL", "#2563eb"],
  ["METER FAULTY", "#f97316"],
  ["METER DAMAGED", "#7c3aed"],
  ["ILLEGALLY CONNECTED", "#dc2626"],
  ["OTHER", "#64748b"],
]);

const FALLBACK_COLORS = [
  "#0f9f95",
  "#f97316",
  "#2563eb",
  "#7c3aed",
  "#f59e0b",
  "#0f7c86",
  "#db2777",
  "#64748b",
  "#16a34a",
  "#0891b2",
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
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeLabel(value) {
  return String(value || "").trim();
}

function hasMeaningfulValue(value) {
  const text = normalizeLabel(value);
  return Boolean(text && !["NAV", "N/A", "-"].includes(text.toUpperCase()));
}

function anomalyKey(value) {
  return normalizeCode(value);
}

function subAnomalyKey(mainAnomaly, detail) {
  return `${anomalyKey(mainAnomaly)}::${anomalyKey(detail)}`;
}

function colorHash(value) {
  const text = String(value || "");
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function getMainColor(label) {
  const known = KNOWN_MAIN_COLORS.get(anomalyKey(label));
  if (known) return known;

  return FALLBACK_COLORS[colorHash(anomalyKey(label)) % FALLBACK_COLORS.length];
}

function getSubColor(mainLabel, detailLabel) {
  const key = `${anomalyKey(mainLabel)}::${anomalyKey(detailLabel)}`;
  return FALLBACK_COLORS[colorHash(key) % FALLBACK_COLORS.length];
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
  if (!value || value === "NAv") return "Live";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Live";

  return new Intl.DateTimeFormat("en-ZA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function buildMainBreakdown(rows) {
  const mainMap = new Map();

  rows.forEach((row) => {
    const mainLabel = normalizeLabel(row?.anomaly);
    if (!mainLabel) return;

    const mainKey = anomalyKey(mainLabel);
    const current = mainMap.get(mainKey) || {
      key: mainKey,
      label: mainLabel,
      count: 0,
      detailMap: new Map(),
    };

    current.count += 1;

    const detailLabel = hasMeaningfulValue(row?.anomalyDetail)
      ? normalizeLabel(row.anomalyDetail)
      : "No Detail Recorded";
    const detailKey = anomalyKey(detailLabel);
    const detail = current.detailMap.get(detailKey) || {
      key: detailKey,
      label: detailLabel,
      count: 0,
    };

    detail.count += 1;
    current.detailMap.set(detailKey, detail);
    mainMap.set(mainKey, current);
  });

  return Array.from(mainMap.values())
    .map((row) => ({
      key: row.key,
      label: row.label,
      count: row.count,
      color: getMainColor(row.label),
      details: Array.from(row.detailMap.values()).sort(
        (left, right) =>
          right.count - left.count ||
          left.label.localeCompare(right.label, undefined, {
            numeric: true,
            sensitivity: "base",
          }),
      ),
    }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.label.localeCompare(right.label, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
    );
}

function buildSubSeries(rows) {
  const subMap = new Map();

  rows.forEach((row) => {
    const mainLabel = normalizeLabel(row?.anomaly);
    if (!mainLabel) return;

    const detailLabel = hasMeaningfulValue(row?.anomalyDetail)
      ? normalizeLabel(row.anomalyDetail)
      : "No Detail Recorded";
    const key = subAnomalyKey(mainLabel, detailLabel);
    const current = subMap.get(key) || {
      key,
      label: detailLabel,
      parentLabel: mainLabel,
      count: 0,
      color: getSubColor(mainLabel, detailLabel),
    };

    current.count += 1;
    subMap.set(key, current);
  });

  return Array.from(subMap.values()).sort(
    (left, right) =>
      right.count - left.count ||
      left.parentLabel.localeCompare(right.parentLabel, undefined, {
        numeric: true,
        sensitivity: "base",
      }) ||
      left.label.localeCompare(right.label, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
  );
}

function buildDonutGradient(rows, total) {
  if (!total) return "conic-gradient(#e2e8f0 0deg 360deg)";

  let cursor = 0;
  const stops = rows.map((row) => {
    const start = cursor;
    const end = cursor + (row.count / total) * 360;
    cursor = end;
    return `${row.color} ${start}deg ${end}deg`;
  });

  if (cursor < 360) stops.push(`#e2e8f0 ${cursor}deg 360deg`);
  return `conic-gradient(${stops.join(", ")})`;
}

function buildDonutLabels(rows, total) {
  if (!total) return [];

  let cursor = 0;

  return rows.flatMap((row) => {
    const share = (row.count / total) * 100;
    const sweep = (row.count / total) * 360;
    const midpoint = cursor + sweep / 2 - 90;
    cursor += sweep;

    if (share < 5) return [];

    const radians = (midpoint * Math.PI) / 180;
    const radius = 36;

    return [{
      key: row.key,
      label: formatPercent(share),
      left: 50 + Math.cos(radians) * radius,
      top: 50 + Math.sin(radians) * radius,
    }];
  });
}

function getUniqueMeterCount(rows) {
  const meterNos = new Set();

  rows.forEach((row) => {
    const meterNo = hasMeaningfulValue(row?.meterNo)
      ? normalizeLabel(row.meterNo)
      : hasMeaningfulValue(row?.astNo)
        ? normalizeLabel(row.astNo)
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

function filterTrendRows(rows, mode, selectedUserIds, selectedTeamIds, teams) {
  if (mode === "USERS" && selectedUserIds.length > 0) {
    const allowedUserIds = new Set(selectedUserIds.map((id) => String(id)));

    return rows.filter((row) => {
      const uid = hasMeaningfulValue(row?.createdByUid)
        ? normalizeLabel(row.createdByUid)
        : "";
      return Boolean(uid && allowedUserIds.has(uid));
    });
  }

  if (mode === "TEAMS" && selectedTeamIds.length > 0) {
    const selectedTeamIdSet = new Set(selectedTeamIds.map((id) => String(id)));
    const allowedUserIds = new Set();

    teams.forEach((team) => {
      const teamId = normalizeLabel(team?.id);
      if (!teamId || !selectedTeamIdSet.has(teamId)) return;

      (team?.memberUserIds || []).forEach((uidValue) => {
        const uid = normalizeLabel(uidValue);
        if (uid) allowedUserIds.add(uid);
      });
    });

    return rows.filter((row) => {
      const uid = hasMeaningfulValue(row?.createdByUid)
        ? normalizeLabel(row.createdByUid)
        : "";
      return Boolean(uid && allowedUserIds.has(uid));
    });
  }

  return rows;
}

function buildDailyTrend(rows, days, mode, now = new Date()) {
  const today = startOfLocalDay(now);
  const start = addDays(today, -(days - 1));
  const countsByDate = new Map();

  rows.forEach((row) => {
    const key = dateKey(row?.createdAt);
    if (!key) return;

    const current = countsByDate.get(key) || { [TOTAL_SERIES_KEY]: 0 };
    current[TOTAL_SERIES_KEY] += 1;

    const seriesKey =
      mode === "SUB"
        ? subAnomalyKey(
            row?.anomaly,
            hasMeaningfulValue(row?.anomalyDetail)
              ? row.anomalyDetail
              : "No Detail Recorded",
          )
        : anomalyKey(row?.anomaly);

    current[seriesKey] = (current[seriesKey] || 0) + 1;
    countsByDate.set(key, current);
  });

  return Array.from({ length: days }, (_, index) => {
    const date = addDays(start, index);
    const key = dateKey(date);

    return {
      date,
      key,
      counts: countsByDate.get(key) || { [TOTAL_SERIES_KEY]: 0 },
    };
  });
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

  if (name === "alert") {
    return (
      <svg {...common}>
        <path d="M10.3 3.4 2.7 17a2 2 0 0 0 1.75 3h15.1a2 2 0 0 0 1.75-3L13.7 3.4a2 2 0 0 0-3.4 0Z" />
        <path d="M12 8v5M12 17h.01" />
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

  if (name === "types") {
    return (
      <svg {...common}>
        <circle cx="5" cy="6" r="1" />
        <circle cx="5" cy="12" r="1" />
        <circle cx="5" cy="18" r="1" />
        <path d="M9 6h11M9 12h11M9 18h11" />
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
        <path d="M4 5h16l-6 7v6l-4 2v-8z" />
      </svg>
    );
  }

  return null;
}

function KpiCard({ label, value, detail, tone, icon }) {
  return (
    <article className={`anomaly-kpi anomaly-kpi--${tone}`}>
      <div className="anomaly-kpi__icon">
        <Icon name={icon} />
      </div>
      <div className="anomaly-kpi__copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      <Icon name={icon} />
    </article>
  );
}

function TypeBreakdown({ rows, total }) {
  const gradient = buildDonutGradient(rows, total);
  const donutLabels = buildDonutLabels(rows, total);

  return (
    <div className="anomaly-type-layout">
      <div className="anomaly-type-donut" style={{ background: gradient }}>
        {donutLabels.map((label) => (
          <span
            className="anomaly-type-donut__label"
            key={label.key}
            style={{ left: `${label.left}%`, top: `${label.top}%` }}
          >
            {label.label}
          </span>
        ))}
        <div className="anomaly-type-donut__center">
          <strong>{formatNumber(total)}</strong>
          <span>Total Anomalies</span>
        </div>
      </div>

      <div className="anomaly-type-table">
        <div className="anomaly-type-table__head">
          <span>Anomaly Type / Detail</span>
          <span>Count</span>
          <span>%</span>
        </div>

        {rows.length ? (
          rows.map((row) => {
            const share = total > 0 ? (row.count / total) * 100 : 0;

            return (
              <div className="anomaly-type-group" key={row.key}>
                <div className="anomaly-type-table__row anomaly-type-table__row--main">
                  <div>
                    <i style={{ background: row.color }} aria-hidden="true" />
                    <strong>{row.label}</strong>
                  </div>
                  <b>{formatNumber(row.count)}</b>
                  <span>{formatPercent(share)}</span>
                </div>

                {row.details.map((detail) => {
                  const detailShare = total > 0 ? (detail.count / total) * 100 : 0;

                  return (
                    <div
                      className="anomaly-type-table__row anomaly-type-table__row--detail"
                      key={`${row.key}-${detail.key}`}
                    >
                      <div>
                        <span className="anomaly-detail-branch" aria-hidden="true">└</span>
                        <span>{detail.label}</span>
                      </div>
                      <b>{formatNumber(detail.count)}</b>
                      <span>{formatPercent(detailShare)}</span>
                    </div>
                  );
                })}
              </div>
            );
          })
        ) : (
          <p className="anomaly-empty-copy">No Meter Discovery anomalies are currently recorded.</p>
        )}
      </div>
    </div>
  );
}

function TrendChart({ dailyRows, series }) {
  const width = 820;
  const height = 300;
  const margin = { top: 22, right: 22, bottom: 44, left: 48 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const values = series.flatMap((item) =>
    dailyRows.map((row) => row.counts?.[item.key] || 0),
  );
  const rawMax = Math.max(1, ...values);
  const stepSize =
    rawMax <= 5
      ? 1
      : rawMax <= 10
        ? 2
        : rawMax <= 50
          ? 10
          : rawMax <= 100
            ? 20
            : Math.ceil(rawMax / 5 / 10) * 10;
  const maxY = Math.max(stepSize, Math.ceil(rawMax / stepSize) * stepSize);
  const ticks = Array.from({ length: 5 }, (_, index) =>
    Math.round((maxY / 4) * index),
  );

  const xForIndex = (index) =>
    margin.left +
    (dailyRows.length <= 1 ? 0 : (index / (dailyRows.length - 1)) * plotWidth);
  const yForValue = (value) =>
    margin.top + plotHeight - (Math.max(0, value) / maxY) * plotHeight;

  const plottedSeries = series.map((item) => {
    const points = dailyRows.map((row, index) => {
      const count = row.counts?.[item.key] || 0;
      return {
        ...row,
        count,
        x: xForIndex(index),
        y: yForValue(count),
      };
    });

    return {
      ...item,
      points,
      path: points
        .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
        .join(" "),
    };
  });

  const labelEvery = Math.max(1, Math.ceil(dailyRows.length / 7));
  const showValueLabels = plottedSeries.length <= 2;
  const windowTotal = dailyRows.reduce(
    (sum, row) => sum + Number(row.counts?.[TOTAL_SERIES_KEY] || 0),
    0,
  );

  return (
    <div className="anomaly-trend-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Daily anomaly trend">
        {ticks.map((tick) => {
          const y = yForValue(tick);
          return (
            <g key={tick}>
              <line
                x1={margin.left}
                x2={width - margin.right}
                y1={y}
                y2={y}
                className="anomaly-chart-gridline"
              />
              <text
                x={margin.left - 12}
                y={y + 4}
                textAnchor="end"
                className="anomaly-chart-axis"
              >
                {formatNumber(tick)}
              </text>
            </g>
          );
        })}

        {plottedSeries.map((item) => (
          <g key={item.key}>
            {item.path ? (
              <path
                d={item.path}
                className={`anomaly-chart-line${
                  item.key === TOTAL_SERIES_KEY ? " anomaly-chart-line--total" : ""
                }`}
                style={{ stroke: item.color }}
              />
            ) : null}

            {item.points.map((point) => (
              <g key={`${item.key}-${point.key}`}>
                <title>{`${item.tooltipLabel || item.label} · ${formatShortDate(point.date)} · ${formatNumber(point.count)}`}</title>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={item.key === TOTAL_SERIES_KEY ? "5.2" : "4.4"}
                  className="anomaly-chart-point"
                  style={{ fill: item.color, stroke: item.color }}
                />
                {showValueLabels && point.count > 0 ? (
                  <text
                    x={point.x}
                    y={Math.max(14, point.y - 10)}
                    textAnchor="middle"
                    className="anomaly-chart-value"
                    style={{ fill: item.color }}
                  >
                    {formatNumber(point.count)}
                  </text>
                ) : null}
              </g>
            ))}
          </g>
        ))}

        {dailyRows.map((row, index) =>
          index % labelEvery === 0 || index === dailyRows.length - 1 ? (
            <text
              key={row.key}
              x={xForIndex(index)}
              y={height - 16}
              textAnchor="middle"
              className="anomaly-chart-axis anomaly-chart-axis--date"
            >
              {formatShortDate(row.date)}
            </text>
          ) : null,
        )}
      </svg>

      {windowTotal === 0 ? (
        <div className="anomaly-chart-empty">No anomalies were captured in the selected trend window.</div>
      ) : null}
    </div>
  );
}

function LoadingState() {
  return (
    <section className="anomaly-state-card" aria-live="polite" aria-busy="true">
      <div className="anomaly-spinner" aria-hidden="true" />
      <div>
        <h2>Loading Anomalies Dashboard...</h2>
        <p>Connecting to the live Meter Discovery TRN stream for the active workbase.</p>
      </div>
    </section>
  );
}

export default function AnomaliesDashboardPage() {
  const { activeWorkbase } = useAuth();
  const activeLmPcode = getActiveLmPcode(activeWorkbase);
  const activeWorkbaseName = getActiveWorkbaseName(activeWorkbase);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [windowDays, setWindowDays] = useState(7);
  const [trendMode, setTrendMode] = useState("MAIN");
  const [trendFilterMode, setTrendFilterMode] = useState("ALL");
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState([]);
  const [hiddenMainSeriesKeys, setHiddenMainSeriesKeys] = useState([]);
  const [hiddenSubSeriesKeys, setHiddenSubSeriesKeys] = useState([]);

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

  const meterDiscoveryRows = useMemo(
    () => trnRows.filter((row) => normalizeCode(row?.trnType) === METER_DISCOVERY_TYPE),
    [trnRows],
  );

  // NA / NAv means no anomaly classification for Meter Discovery.
  // All other Meter Discovery anomaly values, including Meter Ok, remain in scope.
  const anomalyRows = useMemo(
    () =>
      meterDiscoveryRows.filter(
        (row) => !["NA", "NAV", "N/A"].includes(normalizeCode(row?.anomaly)),
      ),
    [meterDiscoveryRows],
  );

  const mainBreakdown = useMemo(() => buildMainBreakdown(anomalyRows), [anomalyRows]);
  const affectedMeters = useMemo(() => getUniqueMeterCount(anomalyRows), [anomalyRows]);
  const latestUpdate = useMemo(() => getLatestUpdate(anomalyRows), [anomalyRows]);

  const todayKey = dateKey(new Date());
  const todayCount = useMemo(
    () => anomalyRows.filter((row) => dateKey(row?.createdAt) === todayKey).length,
    [anomalyRows, todayKey],
  );

  const filteredTrendRows = useMemo(
    () => filterTrendRows(anomalyRows, trendFilterMode, selectedUserIds, selectedTeamIds, teams),
    [anomalyRows, selectedTeamIds, selectedUserIds, teams, trendFilterMode],
  );

  const trendSourceSeries = useMemo(
    () => (trendMode === "SUB" ? buildSubSeries(filteredTrendRows) : buildMainBreakdown(filteredTrendRows)),
    [filteredTrendRows, trendMode],
  );

  const dailyTrend = useMemo(
    () => buildDailyTrend(filteredTrendRows, windowDays, trendMode),
    [filteredTrendRows, trendMode, windowDays],
  );

  const currentHiddenKeys =
    trendMode === "SUB" ? hiddenSubSeriesKeys : hiddenMainSeriesKeys;

  const lineOptions = useMemo(() => {
    const total = {
      key: TOTAL_SERIES_KEY,
      label: "Total Anomalies",
      tooltipLabel: "Total Anomalies",
      color: "#0d5ed7",
    };

    const anomalySeries = trendSourceSeries.map((row) => ({
      key: row.key,
      label: row.label,
      tooltipLabel: row.parentLabel ? `${row.parentLabel} · ${row.label}` : row.label,
      parentLabel: row.parentLabel,
      color: row.color,
    }));

    return [total, ...anomalySeries];
  }, [trendSourceSeries]);

  const visibleLineOptions = useMemo(() => {
    const visible = lineOptions.filter((line) => !currentHiddenKeys.includes(line.key));
    return visible.length ? visible : lineOptions.slice(0, 1);
  }, [currentHiddenKeys, lineOptions]);

  const changeTrendFilterMode = (mode) => {
    setTrendFilterMode(mode);
    if (mode !== "USERS") setSelectedUserIds([]);
    if (mode !== "TEAMS") setSelectedTeamIds([]);
  };

  const toggleUser = (userId) => {
    setSelectedUserIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  };

  const toggleTeam = (teamId) => {
    setSelectedTeamIds((current) =>
      current.includes(teamId)
        ? current.filter((id) => id !== teamId)
        : [...current, teamId],
    );
  };

  const toggleLine = (seriesKey) => {
    const setter = trendMode === "SUB" ? setHiddenSubSeriesKeys : setHiddenMainSeriesKeys;

    setter((current) => {
      const isHidden = current.includes(seriesKey);
      if (isHidden) return current.filter((key) => key !== seriesKey);

      const visibleCount = lineOptions.filter((line) => !current.includes(line.key)).length;
      if (visibleCount <= 1) return current;

      return [...current, seriesKey];
    });
  };

  const userSummary =
    selectedUserIds.length === 0
      ? "All Users"
      : selectedUserIds.length === 1
        ? "1 User Selected"
        : `${selectedUserIds.length} Users Selected`;

  const teamSummary =
    selectedTeamIds.length === 0
      ? "All Teams"
      : selectedTeamIds.length === 1
        ? "1 Team Selected"
        : `${selectedTeamIds.length} Teams Selected`;

  const lineSummary =
    visibleLineOptions.length === lineOptions.length
      ? `All ${lineOptions.length} Lines`
      : visibleLineOptions.length === 1
        ? visibleLineOptions[0]?.label || "1 Line Selected"
        : `${visibleLineOptions.length} Lines Selected`;

  if (!activeLmPcode) {
    return (
      <div className="anomaly-dashboard-page">
        <section className="anomaly-state-card anomaly-state-card--warning">
          <div>
            <h2>No Active Workbase</h2>
            <p>Select an active workbase before opening the Anomalies Dashboard.</p>
          </div>
        </section>
      </div>
    );
  }

  if (trnsLoading || usersLoading || teamsLoading) {
    return (
      <div className="anomaly-dashboard-page">
        <LoadingState />
      </div>
    );
  }

  if (trnsError) {
    return (
      <div className="anomaly-dashboard-page">
        <section className="anomaly-state-card anomaly-state-card--error">
          <div>
            <h2>Could Not Load Anomalies Dashboard</h2>
            <p>The live TRN stream could not be opened for {activeLmPcode}.</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="anomaly-dashboard-page">
      <section className="anomaly-header">
        <div>
          <p className="anomaly-eyebrow">Dashboard · Anomalies</p>
          <h2>Anomalies Dashboard</h2>
          <p>
            Live anomaly visibility from Meter Discovery TRNs only for {activeWorkbaseName}.
          </p>
        </div>

        <div className="anomaly-header__controls">
          <div className="anomaly-date-control" title="Dashboard date">
            <Icon name="calendar" />
            <strong>{formatLongDate(new Date())}</strong>
            <span>⌄</span>
          </div>

          <button
            type="button"
            className={`anomaly-filter-button${filtersOpen ? " is-active" : ""}`}
            onClick={() => setFiltersOpen((current) => !current)}
            aria-expanded={filtersOpen}
          >
            <Icon name="filter" />
            Filters
          </button>
        </div>
      </section>

      {filtersOpen ? (
        <section className="anomaly-filter-panel">
          <div className="anomaly-filter-controls">
            <label className="anomaly-filter-control">
              <span>Daily Trend Window</span>
              <select
                value={windowDays}
                onChange={(event) => setWindowDays(Number(event.target.value))}
              >
                <option value={7}>Last 7 Days</option>
                <option value={14}>Last 14 Days</option>
                <option value={30}>Last 30 Days</option>
              </select>
            </label>

            <div className="anomaly-filter-control">
              <span>Trend By</span>
              <div className="anomaly-segmented-control" role="group" aria-label="Group anomaly trend by">
                {TREND_GROUP_MODES.map((mode) => (
                  <button
                    type="button"
                    key={mode.key}
                    className={trendMode === mode.key ? "is-active" : ""}
                    aria-pressed={trendMode === mode.key}
                    onClick={() => setTrendMode(mode.key)}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="anomaly-filter-control">
              <span>Trend Filter By</span>
              <div className="anomaly-segmented-control" role="group" aria-label="Filter anomaly trend by">
                {TREND_FILTER_MODES.map((mode) => (
                  <button
                    type="button"
                    key={mode.key}
                    className={trendFilterMode === mode.key ? "is-active" : ""}
                    aria-pressed={trendFilterMode === mode.key}
                    onClick={() => changeTrendFilterMode(mode.key)}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            {trendFilterMode === "USERS" ? (
              <div className="anomaly-filter-control">
                <span>Users</span>
                <details className="anomaly-multi-filter anomaly-attribution-filter">
                  <summary>{userSummary}</summary>
                  <div className="anomaly-multi-filter__menu">
                    <label className="anomaly-multi-filter__option anomaly-multi-filter__option--plain">
                      <input
                        type="checkbox"
                        checked={selectedUserIds.length === 0}
                        onChange={() => setSelectedUserIds([])}
                      />
                      <span>All Users</span>
                    </label>
                    <div className="anomaly-multi-filter__divider" />
                    {users.map((user) => {
                      const userId = normalizeLabel(user?.uid || user?.id);
                      if (!userId) return null;

                      const checked = selectedUserIds.includes(userId);
                      const userLabel =
                        user?.displayName || user?.name || user?.email || userId;

                      return (
                        <label
                          className="anomaly-multi-filter__option anomaly-multi-filter__option--plain"
                          key={userId}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleUser(userId)}
                          />
                          <span>{userLabel}</span>
                        </label>
                      );
                    })}
                  </div>
                </details>
              </div>
            ) : null}

            {trendFilterMode === "TEAMS" ? (
              <div className="anomaly-filter-control">
                <span>Teams</span>
                <details className="anomaly-multi-filter anomaly-attribution-filter">
                  <summary>{teamSummary}</summary>
                  <div className="anomaly-multi-filter__menu">
                    <label className="anomaly-multi-filter__option anomaly-multi-filter__option--plain">
                      <input
                        type="checkbox"
                        checked={selectedTeamIds.length === 0}
                        onChange={() => setSelectedTeamIds([])}
                      />
                      <span>All Teams</span>
                    </label>
                    <div className="anomaly-multi-filter__divider" />
                    {teams.map((team) => {
                      const teamId = normalizeLabel(team?.id);
                      if (!teamId) return null;

                      const checked = selectedTeamIds.includes(teamId);
                      const teamLabel = team?.name || team?.label || teamId;

                      return (
                        <label
                          className="anomaly-multi-filter__option anomaly-multi-filter__option--plain"
                          key={teamId}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleTeam(teamId)}
                          />
                          <span>{teamLabel}</span>
                        </label>
                      );
                    })}
                  </div>
                </details>
              </div>
            ) : null}

            <div className="anomaly-filter-control">
              <span>Anomaly Lines To Show</span>
              <details className="anomaly-multi-filter anomaly-line-filter">
                <summary>{lineSummary}</summary>
                <div className="anomaly-multi-filter__menu anomaly-line-filter__menu">
                  {lineOptions.map((line) => {
                    const checked = visibleLineOptions.some((item) => item.key === line.key);
                    const isOnlySelected = checked && visibleLineOptions.length === 1;

                    return (
                      <label className="anomaly-multi-filter__option" key={line.key}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isOnlySelected}
                          onChange={() => toggleLine(line.key)}
                        />
                        <i style={{ background: line.color }} aria-hidden="true" />
                        <span>
                          {line.parentLabel ? `${line.parentLabel} · ${line.label}` : line.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </details>
            </div>
          </div>

          <div className="anomaly-filter-live">
            <span className="anomaly-live-dot" />
            <strong>{trnsFetching ? "Streaming updates" : "Live Meter Discovery TRNs"}</strong>
            <small>{activeLmPcode}</small>
          </div>
        </section>
      ) : null}

      <section className="anomaly-kpis">
        <KpiCard
          label="Total Anomalies"
          value={formatNumber(anomalyRows.length)}
          detail="Meter Discovery anomaly entries"
          tone="blue"
          icon="alert"
        />
        <KpiCard
          label="Affected Meters"
          value={formatNumber(affectedMeters)}
          detail="Unique meters with anomalies"
          tone="teal"
          icon="gauge"
        />
        <KpiCard
          label="Main Anomaly Types"
          value={formatNumber(mainBreakdown.length)}
          detail="Distinct main anomaly categories"
          tone="orange"
          icon="types"
        />
        <KpiCard
          label="Today"
          value={formatNumber(todayCount)}
          detail="Anomalies captured today"
          tone="blue"
          icon="calendar"
        />
      </section>

      <section className="anomaly-main-grid">
        <article className="anomaly-panel anomaly-type-panel">
          <div className="anomaly-panel__title">
            <div>
              <h3>Anomaly Type Breakdown</h3>
              <span>Main anomaly categories with sub-anomaly detail</span>
            </div>
            <span className="anomaly-info-dot">i</span>
          </div>

          <TypeBreakdown rows={mainBreakdown} total={anomalyRows.length} />
        </article>

        <article className="anomaly-panel anomaly-trend-panel">
          <div className="anomaly-panel__title">
            <div>
              <h3>
                Daily Anomaly Trend ({trendMode === "SUB" ? "By Sub Anomaly" : "By Main Anomaly"})
              </h3>
              <span>
                Actual anomalies captured from Meter Discovery TRNs over the selected window
              </span>
            </div>
            <span className="anomaly-info-dot">i</span>
          </div>

          <TrendChart dailyRows={dailyTrend} series={visibleLineOptions} />
        </article>
      </section>

      <footer className="anomaly-footer">
        <span className="anomaly-live-dot" aria-hidden="true" />
        <span>
          Last updated: <strong>{formatDateTime(latestUpdate)}</strong>
          {" · "}Source: <strong>trns</strong>
          {" · "}TRN type: <strong>METER_DISCOVERY</strong>
          {usersError || teamsError ? " · User/team filter directory is partially unavailable" : ""}
        </span>
      </footer>
    </div>
  );
}
