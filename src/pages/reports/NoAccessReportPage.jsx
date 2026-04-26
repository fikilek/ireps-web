import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGetNoAccessRowsByLmQuery } from "../../redux/reportNoAccessApi";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";

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

function formatUpdatedAt(value) {
  if (!value || value === "NAv") return "NAv";

  if (typeof value === "string") {
    return value.slice(0, 19).replace("T", " ");
  }

  if (typeof value?.toDate === "function") {
    return value.toDate().toLocaleString();
  }

  return "NAv";
}

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
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
            Showing TRN-derived no-access report rows for {activeWorkbaseName}.
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
          <span>Top Reason</span>
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
              Check Firestore rules, report_trn_no_access, or the LM field used
              by the query.
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
