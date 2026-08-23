/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useMemo, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import {
  buildDashboardActivityModel,
  filterDashboardUserRows,
} from "../reports/activityAnalyticsModel";
import useActivityAnalytics from "../reports/useActivityAnalytics";

import "./ActivityReportDashboardPage.css";

const TRN_TYPES = [
  { key: "meterDiscoveryTrns", label: "Discovery", tone: "teal", icon: "search" },
  { key: "noAccessTrns", label: "No Access", tone: "red", icon: "lock" },
  { key: "meterInspectionTrns", label: "Inspection", tone: "orange", icon: "eye" },
  { key: "meterInstallationTrns", label: "Installation", tone: "blue", icon: "tool" },
  { key: "meterRemovalTrns", label: "Removal", tone: "purple", icon: "trash" },
  { key: "meterDisconnectionTrns", label: "Disconnection", tone: "slate", icon: "plug" },
  { key: "meterReconnectionTrns", label: "Reconnection", tone: "green", icon: "reconnect" },
];

const ALL_TIME_DATE_FILTER = { preset: "ALL_TIME", customStart: "", customEnd: "" };

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

function hasValue(value) {
  const text = String(value || "").trim();
  return Boolean(text && text.toUpperCase() !== "NAV");
}

function formatNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toLocaleString("en-ZA") : "0";
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "0.0%";
}

function getInitials(value) {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "--";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function toDate(value) {
  if (!value || String(value).toUpperCase() === "NAV") return null;

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (Number.isFinite(Number(value?.seconds))) {
    const date = new Date(Number(value.seconds) * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value) {
  const date = toDate(value);
  if (!date) return "No activity timestamp";

  return date.toLocaleString("en-ZA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
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

  if (name === "users") {
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2.4" />
        <path d="M3.5 19c.7-3.4 2.5-5.1 5.5-5.1s4.8 1.7 5.5 5.1" />
        <path d="M14.2 14.5c2.9-.5 5.2 1 6.3 4.5" />
      </svg>
    );
  }

  if (name === "provider") {
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="3" />
        <path d="M5.5 20c.8-4 3-6 6.5-6s5.7 2 6.5 6" />
        <path d="M8 4h8" />
      </svg>
    );
  }

  if (name === "teams") {
    return (
      <svg {...common}>
        <circle cx="8" cy="9" r="2.5" />
        <circle cx="16" cy="9" r="2.5" />
        <circle cx="12" cy="6" r="2.4" />
        <path d="M3.5 19c.5-3 2-4.5 4.5-4.5" />
        <path d="M20.5 19c-.5-3-2-4.5-4.5-4.5" />
        <path d="M6.5 20c.6-3.8 2.4-5.7 5.5-5.7s4.9 1.9 5.5 5.7" />
      </svg>
    );
  }

  if (name === "activity") {
    return (
      <svg {...common}>
        <path d="M3 12h4l2-6 4 12 2-6h6" />
      </svg>
    );
  }

  if (name === "search") {
    return (
      <svg {...common}>
        <circle cx="10" cy="10" r="5.5" />
        <path d="m14.5 14.5 5 5" />
      </svg>
    );
  }

  if (name === "lock") {
    return (
      <svg {...common}>
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
    );
  }

  if (name === "eye") {
    return (
      <svg {...common}>
        <path d="M2.8 12s3.3-5 9.2-5 9.2 5 9.2 5-3.3 5-9.2 5-9.2-5-9.2-5Z" />
        <circle cx="12" cy="12" r="2.4" />
      </svg>
    );
  }

  if (name === "tool") {
    return (
      <svg {...common}>
        <path d="M14 6a4 4 0 0 0-5 5L3.5 16.5l4 4L13 15a4 4 0 0 0 5-5l-2.7 2.7-4-4L14 6Z" />
      </svg>
    );
  }

  if (name === "trash") {
    return (
      <svg {...common}>
        <path d="M4 7h16" />
        <path d="M9 7V4h6v3" />
        <path d="m7 7 1 13h8l1-13" />
      </svg>
    );
  }

  if (name === "plug") {
    return (
      <svg {...common}>
        <path d="M8 3v5" />
        <path d="M16 3v5" />
        <path d="M6 8h12v3a6 6 0 0 1-12 0V8Z" />
        <path d="M12 17v4" />
      </svg>
    );
  }

  if (name === "reconnect") {
    return (
      <svg {...common}>
        <path d="M6 8a7 7 0 1 1-1 8" />
        <path d="M6 3v5H1" />
        <path d="M10 8v4" />
        <path d="M14 8v4" />
      </svg>
    );
  }

  if (name === "insight") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5" />
        <path d="M12 16h.01" />
      </svg>
    );
  }

  return null;
}

function KpiCard({ label, value, tone, icon, detail }) {
  return (
    <article className={`activity-kpi activity-kpi--${tone}`}>
      <div className="activity-kpi__icon">
        <Icon name={icon} />
      </div>
      <div className="activity-kpi__copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      <div className="activity-kpi__ghost">
        <Icon name={icon} />
      </div>
    </article>
  );
}


function UserActivityChart({ users, totalActivity }) {
  const topUsers = users.slice(0, 10);
  const max = Math.max(1, ...topUsers.map((row) => row.activityTotal));

  return (
    <div className="activity-user-chart">
      {topUsers.length === 0 ? (
        <div className="activity-empty">No user activity for the selected filters.</div>
      ) : (
        topUsers.map((row) => {
          const count = row.activityTotal;
          const share = totalActivity > 0 ? (count / totalActivity) * 100 : 0;

          return (
            <div className="activity-user-row" key={row.id || row.userUid}>
              <span className="activity-avatar">{getInitials(row.userName)}</span>
              <span className="activity-user-name" title={row.userName}>
                {row.userName || "NAv"}
              </span>
              <div className="activity-user-track">
                <span style={{ width: `${(count / max) * 100}%` }} />
              </div>
              <strong>{formatNumber(count)}</strong>
              <small>{formatPercent(share)}</small>
            </div>
          );
        })
      )}
    </div>
  );
}

function TeamActivityChart({ teams }) {
  const topTeams = teams.slice(0, 10);
  const max = Math.max(1, ...topTeams.map((row) => row.total));

  return (
    <div className="activity-team-chart">
      {topTeams.length === 0 ? (
        <div className="activity-empty">No team activity for the selected filters.</div>
      ) : (
        topTeams.map((row) => {
          const discoveryWidth = (row.discovery / max) * 100;
          const inspectionWidth = (row.inspection / max) * 100;
          const otherWidth = (row.other / max) * 100;

          return (
            <div className="activity-team-row" key={row.id || row.name}>
              <span className="activity-team-name" title={row.name}>
                {row.name}
              </span>
              <div className="activity-team-track">
                {row.discovery > 0 ? (
                  <span
                    className="activity-team-segment activity-team-segment--discovery"
                    style={{ width: `${discoveryWidth}%` }}
                    title={`Discovery: ${formatNumber(row.discovery)}`}
                  >
                    {row.discovery}
                  </span>
                ) : null}
                {row.inspection > 0 ? (
                  <span
                    className="activity-team-segment activity-team-segment--inspection"
                    style={{ width: `${inspectionWidth}%` }}
                    title={`Inspection: ${formatNumber(row.inspection)}`}
                  >
                    {row.inspection}
                  </span>
                ) : null}
                {row.other > 0 ? (
                  <span
                    className="activity-team-segment activity-team-segment--other"
                    style={{ width: `${otherWidth}%` }}
                    title={`Other TRNs: ${formatNumber(row.other)}`}
                  >
                    {row.other}
                  </span>
                ) : null}
              </div>
              <strong>{formatNumber(row.total)}</strong>
            </div>
          );
        })
      )}

      <div className="activity-team-legend">
        <span><i className="activity-legend-dot activity-legend-dot--discovery" />Discovery</span>
        <span><i className="activity-legend-dot activity-legend-dot--inspection" />Inspection</span>
        <span><i className="activity-legend-dot activity-legend-dot--other" />Installation / Other</span>
      </div>
    </div>
  );
}

function TrnBreakdown({ types, total }) {
  return (
    <div className="activity-trn-breakdown">
      {types.map((type) => {
        const share = total > 0 ? (type.count / total) * 100 : 0;

        return (
          <div className={`activity-trn-type activity-trn-type--${type.tone}`} key={type.key}>
            <span className="activity-trn-type__label">{type.label}</span>
            <div className="activity-trn-type__icon">
              <Icon name={type.icon} />
            </div>
            <strong>{formatNumber(type.count)}</strong>
            <small>{formatPercent(share)}</small>
          </div>
        );
      })}
    </div>
  );
}

export default function ActivityReportDashboardPage() {
  const { activeWorkbase } = useAuth();
  const activeLmPcode = getActiveLmPcode(activeWorkbase);
  const activeWorkbaseName = getActiveWorkbaseName(activeWorkbase);
  const [showFilters, setShowFilters] = useState(false);
  const [serviceProviderFilter, setServiceProviderFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");

  const {
    userRows,
    isLoading,
    isFetching,
    error,
  } = useActivityAnalytics({
    lmPcode: activeLmPcode,
    dateFilter: ALL_TIME_DATE_FILTER,
  });

  const filterOptions = useMemo(() => {
    const serviceProviders = Array.from(
      new Set(userRows.map((row) => row?.serviceProviderName).filter(hasValue)),
    ).sort((left, right) => left.localeCompare(right));

    const teams = Array.from(
      new Set(userRows.map((row) => row?.activityTeamName).filter(hasValue)),
    ).sort((left, right) => left.localeCompare(right));

    return { serviceProviders, teams };
  }, [userRows]);

  const filteredUserRows = useMemo(
    () =>
      filterDashboardUserRows(userRows, {
        serviceProvider: serviceProviderFilter,
        team: teamFilter,
      }),
    [userRows, serviceProviderFilter, teamFilter],
  );

  const activity = useMemo(
    () => buildDashboardActivityModel(filteredUserRows, TRN_TYPES),
    [filteredUserRows],
  );

  if (!activeLmPcode) {
    return (
      <section className="activity-dashboard-page">
        <div className="activity-state-card">
          <strong>No active workbase selected</strong>
          <span>Select an active LM workbase to view Activity Report.</span>
        </div>
      </section>
    );
  }

  if (isLoading) {
    return (
      <section className="activity-dashboard-page">
        <div className="activity-state-card">
          <span className="activity-loader" />
          <strong>Loading Activity Report...</strong>
          <span>Connecting to the live User Activity stream.</span>
        </div>
      </section>
    );
  }

  if (error && userRows.length === 0) {
    return (
      <section className="activity-dashboard-page">
        <div className="activity-state-card activity-state-card--error">
          <strong>Activity Report could not be loaded</strong>
          <span>{error?.error || error?.message || "Live report stream failed."}</span>
        </div>
      </section>
    );
  }

  const latestUser = activity.latestRow?.userName || "NAv";
  const latestText = activity.latestRow
    ? `${formatDateTime(activity.latestRow.lastUpdatedAt)} by ${latestUser}`
    : "No activity timestamp available";

  const topUserShare =
    activity.totalActivity > 0 && activity.topUser
      ? (activity.topUser.activityTotal / activity.totalActivity) * 100
      : 0;

  const topTeamShare =
    activity.totalActivity > 0 && activity.topTeam
      ? (activity.topTeam.total / activity.totalActivity) * 100
      : 0;

  const topTypeShare =
    activity.totalActivity > 0 && activity.topType
      ? (activity.topType.count / activity.totalActivity) * 100
      : 0;

  return (
    <section className="activity-dashboard-page">
      <header className="activity-exec-header">
        <div>
          <p className="activity-exec-eyebrow">Dashboard · Activity Report</p>
          <h2>Activity Report</h2>
          <p>Live user, service-provider, team and TRN production activity for {activeWorkbaseName}.</p>
        </div>

        <div className="activity-exec-header__controls">
          <div className="activity-period-control" title="Current v1 read model is all-time">
            <span className="activity-calendar-icon">▦</span>
            <span>All Time</span>
            <span>⌄</span>
          </div>
          <button
            type="button"
            className={`activity-filter-button${showFilters ? " active" : ""}`}
            onClick={() => setShowFilters((current) => !current)}
          >
            <span>▽</span>
            Filters
          </button>
        </div>
      </header>

      {showFilters ? (
        <div className="activity-filter-panel">
          <label>
            <span>Service Provider</span>
            <select
              value={serviceProviderFilter}
              onChange={(event) => setServiceProviderFilter(event.target.value)}
            >
              <option value="">All Service Providers</option>
              {filterOptions.serviceProviders.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>

          <label>
            <span>Team</span>
            <select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
              <option value="">All Teams</option>
              {filterOptions.teams.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => {
              setServiceProviderFilter("");
              setTeamFilter("");
            }}
          >
            Clear
          </button>
        </div>
      ) : null}

      <div className="activity-kpis">
        <KpiCard
          label="Active Users"
          value={formatNumber(activity.activeUsers)}
          tone="blue"
          icon="users"
          detail="Users with classified TRN activity"
        />
        <KpiCard
          label="Service Providers"
          value={formatNumber(activity.serviceProviderCount)}
          tone="teal"
          icon="provider"
          detail="Providers represented in activity"
        />
        <KpiCard
          label="Teams"
          value={formatNumber(activity.teamCount)}
          tone="orange"
          icon="teams"
          detail="Teams represented in activity"
        />
        <KpiCard
          label="Total Activity"
          value={formatNumber(activity.totalActivity)}
          tone="blue"
          icon="activity"
          detail="Classified TRNs in live report"
        />
      </div>

      <div className="activity-main-grid">
        <article className="activity-panel activity-panel--users">
          <div className="activity-panel__title">
            <h3>Activity by User</h3>
            <span className="activity-info-dot">i</span>
          </div>
          <UserActivityChart users={activity.users} totalActivity={activity.totalActivity} />
        </article>

        <article className="activity-panel activity-panel--teams">
          <div className="activity-panel__title">
            <h3>Activity by Team</h3>
            <span className="activity-info-dot">i</span>
          </div>
          <TeamActivityChart teams={activity.teamActivity} />
        </article>
      </div>

      <div className="activity-bottom-grid">
        <article className="activity-panel activity-panel--breakdown">
          <div className="activity-panel__title">
            <h3>TRN Activity Breakdown</h3>
            <span className="activity-info-dot">i</span>
          </div>
          <TrnBreakdown types={activity.typeTotals} total={activity.totalActivity} />
          <p className="activity-rounding-note">Percentages may not total 100% due to rounding.</p>
        </article>

        <article className="activity-panel activity-panel--insights">
          <div className="activity-panel__title">
            <h3>Insights</h3>
            <span className="activity-info-dot">i</span>
          </div>

          <div className="activity-insights-list">
            <div>
              <span className="activity-insight-bullet activity-insight-bullet--teal"><Icon name="users" /></span>
              <p><small>Top User</small><strong>{activity.topUser?.userName || "NAv"}</strong>{activity.topUser ? ` with ${formatNumber(activity.topUser.activityTotal)} activities (${formatPercent(topUserShare)})` : ""}</p>
            </div>
            <div>
              <span className="activity-insight-bullet activity-insight-bullet--orange"><Icon name="teams" /></span>
              <p><small>Top Team</small><strong>{activity.topTeam?.name || "NAv"}</strong>{activity.topTeam ? ` with ${formatNumber(activity.topTeam.total)} activities (${formatPercent(topTeamShare)})` : ""}</p>
            </div>
            <div>
              <span className="activity-insight-bullet activity-insight-bullet--blue"><Icon name="eye" /></span>
              <p><small>Most Common TRN Type</small><strong>{activity.topType?.label || "NAv"}</strong>{activity.topType ? ` at ${formatPercent(topTypeShare)} of total activity` : ""}</p>
            </div>
            <div>
              <span className="activity-insight-bullet activity-insight-bullet--green"><Icon name="activity" /></span>
              <p><small>Latest Activity</small><strong>{latestText}</strong></p>
            </div>
          </div>
        </article>
      </div>

      <footer className="activity-dashboard-footer">
        <span className={isFetching ? "activity-refresh-icon spinning" : "activity-refresh-icon"}>↻</span>
        Live TRN + Users + Teams + Service Providers streams · {activeLmPcode}
      </footer>
    </section>
  );
}
