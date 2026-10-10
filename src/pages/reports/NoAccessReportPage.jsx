import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGetNoAccessRowsByLmQuery } from "../../redux/reportNoAccessApi";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";

// ONE CLOCK. This page kept its own copy that did `value.slice(0, 19)`,
// which chops the Z off a UTC timestamp and prints it as if it were the
// reader's own clock - two hours behind, every time (owner, 11 October
// 2026). The shared formatter converts instead of truncating.
import { formatSastDateTime as formatUpdatedAt } from "../../utils/formatSastDateTime";

function getActiveLmPcode(activeWorkbase) {
  return (
    activeWorkbase?.lmPcode ||
    activeWorkbase?.pcode ||
    activeWorkbase?.id ||
    activeWorkbase?.localMunicipalityId ||
    null
  );
}

function formatNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toLocaleString() : "0";
}

function getTodayIsoDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function getWardLabel(wardRows, wardPcode) {
  const ward = wardRows.find((row) => row.wardPcode === wardPcode);

  if (ward?.wardNumber) {
    return `Ward ${ward.wardNumber}`;
  }

  return wardPcode || "NAv";
}

export default function NoAccessReportPage() {
  const { activeWorkbase } = useAuth();

  const [selectedWardPcode, setSelectedWardPcode] = useState("");
  const [selectedDate, setSelectedDate] = useState("");

  const activeLmPcode = getActiveLmPcode(activeWorkbase);

  const activeWorkbaseName =
    activeWorkbase?.name ||
    activeWorkbase?.lmName ||
    activeWorkbase?.id ||
    activeWorkbase?.pcode ||
    "NAv";

  const {
    data: noAccessRows = [],
    isLoading,
    isFetching,
    error,
  } = useGetNoAccessRowsByLmQuery(activeLmPcode || skipToken);

  const { data: wardRows = [] } = useGetRegistryWardsByLmQuery(
    activeLmPcode || skipToken,
  );

  const filteredRows = useMemo(() => {
    return noAccessRows.filter((row) => {
      const matchesWard = selectedWardPcode
        ? row.wardPcode === selectedWardPcode
        : true;

      const matchesDate = selectedDate
        ? row.activityDate === selectedDate
        : true;

      return matchesWard && matchesDate;
    });
  }, [noAccessRows, selectedWardPcode, selectedDate]);

  const reasonSummary = useMemo(() => {
    const reasonMap = new Map();

    filteredRows.forEach((row) => {
      const reason = row.reason || "NAv";
      reasonMap.set(reason, (reasonMap.get(reason) || 0) + 1);
    });

    return Array.from(reasonMap.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);
  }, [filteredRows]);

  const userSummary = useMemo(() => {
    const userMap = new Map();

    filteredRows.forEach((row) => {
      const userName = row.userName || "NAv";
      userMap.set(userName, (userMap.get(userName) || 0) + 1);
    });

    return Array.from(userMap.entries())
      .map(([userName, count]) => ({ userName, count }))
      .sort((a, b) => b.count - a.count);
  }, [filteredRows]);

  const groups = new Map(filteredRows.filter((row) => row.groupId).map((row) => [row.groupId, row.groupStatus]));
  const openGroups = [...groups.values()].filter((status) => status === "OPEN").length;
  const closedGroups = [...groups.values()].filter((status) => status === "CLOSED").length;
  const topReason = reasonSummary[0]?.reason || "NAv";
  const topUser = userSummary[0]?.userName || "NAv";

  function handleClearFilters() {
    setSelectedWardPcode("");
    setSelectedDate("");
  }

  function handleTodayFilter() {
    setSelectedDate(getTodayIsoDate());
  }

  return (
    <>
      <header className="console-header">
        <div>
          <p className="eyebrow">Report</p>
          <h1>No Access Report</h1>

          <p className="muted">
            Showing no-access visits for {activeWorkbaseName}. Groups close only after a later successful access at the same premise. Dates and appointments are shown in SAST.
          </p>

          <Link className="text-link" to="/reports">
            ← Back to Reports
          </Link>
        </div>

        <div className="role-pill">
          {isFetching
            ? "Streaming..."
            : `${formatNumber(filteredRows.length)} rows`}
        </div>
      </header>

      <section className="filter-panel">
        <label>
          Ward
          <select
            value={selectedWardPcode}
            onChange={(event) => setSelectedWardPcode(event.target.value)}
          >
            <option value="">All wards</option>

            {wardRows.map((ward) => (
              <option key={ward.wardPcode} value={ward.wardPcode}>
                Ward {ward.wardNumber}
              </option>
            ))}
          </select>
        </label>

        <label>
          Activity Date
          <input
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
          />
        </label>

        <div className="filter-actions">
          <button type="button" onClick={handleTodayFilter}>
            Today
          </button>

          <button
            type="button"
            className="ghost-button"
            onClick={handleClearFilters}
          >
            Clear
          </button>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="stat-card"><span>Open groups</span><strong>{openGroups}</strong></div>
        <div className="stat-card"><span>Closed groups</span><strong>{closedGroups}</strong></div>
        <div className="stat-card"><span>Unknown sequence</span><strong>{filteredRows.filter((row) => row.groupStatus === "UNKNOWN").length}</strong></div>
        <div className="stat-card">
          <span>No Access Rows</span>
          <strong>{formatNumber(filteredRows.length)}</strong>
        </div>

        <div className="stat-card">
          <span>All LM Rows</span>
          <strong>{formatNumber(noAccessRows.length)}</strong>
        </div>

        <div className="stat-card">
          <span>Reasons</span>
          <strong>{formatNumber(reasonSummary.length)}</strong>
        </div>

        <div className="stat-card">
          <span>Users</span>
          <strong>{formatNumber(userSummary.length)}</strong>
        </div>

        <div className="stat-card">
          <span>Most common reason</span>
          <strong>{topReason}</strong>
        </div>

        <div className="stat-card">
          <span>Top User</span>
          <strong>{topUser}</strong>
        </div>

        <div className="stat-card">
          <span>LM PCode</span>
          <strong>{activeLmPcode || "NAv"}</strong>
        </div>

        <div className="stat-card">
          <span>Date Filter</span>
          <strong>{selectedDate || "All"}</strong>
        </div>
      </section>

      <section className="table-panel">
        {error ? (
          <div className="empty-state error-box">
            <h2>Could not load No Access report</h2>
            <p className="muted">
              Refresh the report. If it remains unavailable, contact the office.
            </p>
          </div>
        ) : null}

        {isLoading ? (
          <div className="empty-state">
            <h2>Loading No Access report...</h2>
            <p className="muted">Opening Firestore stream.</p>
          </div>
        ) : null}

        {!isLoading && filteredRows.length === 0 && !error ? (
          <div className="empty-state">
            <h2>No No Access rows found</h2>
            <p className="muted">
              No matching rows were found for the current LM/filter selection.
            </p>
          </div>
        ) : null}

        {filteredRows.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Ward</th>
                  <th>ERF No</th>
                  <th>Premise Address</th>
                  <th>Property Type</th>
                  <th>Reason</th>
                  <th>Appointment (SAST)</th>
                  <th>Group</th>
                  <th>Closing evidence</th>
                  <th>User</th>
                  <th>TRN Type</th>
                  <th>Updated</th>
                </tr>
              </thead>

              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.activityDate}</td>
                    <td>{getWardLabel(wardRows, row.wardPcode)}</td>
                    <td>{row.erfNo}</td>
                    <td>{row.premiseAddress}</td>
                    <td>{row.premisePropertyType}</td>
                    <td>{row.reason}</td>
                    <td>{row.appointment ? formatUpdatedAt(row.appointment) : "None"}</td>
                    <td>{row.groupStatus}</td>
                    <td>{row.closingProof ? `${row.closingProof.trnType}: ${row.closingProof.trnId} · ${formatUpdatedAt(row.closingProof.at)} · ${row.closingProof.worker}` : "—"}</td>
                    <td>{row.userName}</td>
                    <td>{row.trnType}</td>
                    <td>{formatUpdatedAt(row.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </>
  );
}
