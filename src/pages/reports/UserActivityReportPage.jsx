import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGetUserActivityRowsByLmQuery } from "../../redux/reportUserActivityApi";

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

export default function UserActivityReportPage() {
  const { activeWorkbase } = useAuth();

  const [selectedRole, setSelectedRole] = useState("");
  const [selectedServiceProvider, setSelectedServiceProvider] = useState("");

  const activeLmPcode = getActiveLmPcode(activeWorkbase);

  const activeWorkbaseName =
    activeWorkbase?.name ||
    activeWorkbase?.lmName ||
    activeWorkbase?.id ||
    activeWorkbase?.pcode ||
    "NAv";

  const {
    data: userActivityRows = [],
    isLoading,
    isFetching,
    error,
  } = useGetUserActivityRowsByLmQuery(activeLmPcode || skipToken);

  const roleOptions = useMemo(() => {
    return Array.from(
      new Set(userActivityRows.map((row) => row.userRole).filter(Boolean)),
    ).sort();
  }, [userActivityRows]);

  const serviceProviderOptions = useMemo(() => {
    return Array.from(
      new Set(
        userActivityRows
          .map((row) => row.serviceProviderName)
          .filter((name) => name && name !== "NAv"),
      ),
    ).sort();
  }, [userActivityRows]);

  const filteredRows = useMemo(() => {
    return userActivityRows.filter((row) => {
      const matchesRole = selectedRole ? row.userRole === selectedRole : true;

      const matchesServiceProvider = selectedServiceProvider
        ? row.serviceProviderName === selectedServiceProvider
        : true;

      return matchesRole && matchesServiceProvider;
    });
  }, [userActivityRows, selectedRole, selectedServiceProvider]);

  const totals = filteredRows.reduce(
    (accumulator, row) => {
      accumulator.totalTrns += row.totalTrns;
      accumulator.meterDiscoveryTrns += row.meterDiscoveryTrns;
      accumulator.noAccessTrns += row.noAccessTrns;
      accumulator.meterInspectionTrns += row.meterInspectionTrns;
      accumulator.meterInstallationTrns += row.meterInstallationTrns;
      accumulator.meterRemovalTrns += row.meterRemovalTrns;
      accumulator.meterDisconnectionTrns += row.meterDisconnectionTrns;
      accumulator.meterReconnectionTrns += row.meterReconnectionTrns;
      accumulator.otherTrns += row.otherTrns;
      return accumulator;
    },
    {
      totalTrns: 0,
      meterDiscoveryTrns: 0,
      noAccessTrns: 0,
      meterInspectionTrns: 0,
      meterInstallationTrns: 0,
      meterRemovalTrns: 0,
      meterDisconnectionTrns: 0,
      meterReconnectionTrns: 0,
      otherTrns: 0,
    },
  );

  const topUser = filteredRows[0]?.userName || "NAv";

  function handleClearFilters() {
    setSelectedRole("");
    setSelectedServiceProvider("");
  }

  return (
    <>
      <header className="console-header">
        <div>
          <p className="eyebrow">Report</p>
          <h1>User Activity Report</h1>

          <p className="muted">
            Showing TRN-derived user activity totals for {activeWorkbaseName}.
          </p>

          <Link className="text-link" to="/reports">
            ← Back to Reports
          </Link>
        </div>

        <div className="role-pill">
          {isFetching
            ? "Streaming..."
            : `${formatNumber(filteredRows.length)} users`}
        </div>
      </header>

      <section className="filter-panel">
        <label>
          Role
          <select
            value={selectedRole}
            onChange={(event) => setSelectedRole(event.target.value)}
          >
            <option value="">All roles</option>

            {roleOptions.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>

        <label>
          Service Provider
          <select
            value={selectedServiceProvider}
            onChange={(event) => setSelectedServiceProvider(event.target.value)}
          >
            <option value="">All service providers</option>

            {serviceProviderOptions.map((serviceProviderName) => (
              <option key={serviceProviderName} value={serviceProviderName}>
                {serviceProviderName}
              </option>
            ))}
          </select>
        </label>

        <div className="filter-actions">
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
          <span>Users</span>
          <strong>{formatNumber(filteredRows.length)}</strong>
        </div>

        <div className="stat-card">
          <span>Total TRNs</span>
          <strong>{formatNumber(totals.totalTrns)}</strong>
        </div>

        <div className="stat-card">
          <span>Meter Discovery</span>
          <strong>{formatNumber(totals.meterDiscoveryTrns)}</strong>
        </div>

        <div className="stat-card">
          <span>No Access</span>
          <strong>{formatNumber(totals.noAccessTrns)}</strong>
        </div>

        <div className="stat-card">
          <span>Top User</span>
          <strong>{topUser}</strong>
        </div>

        <div className="stat-card">
          <span>Service Providers</span>
          <strong>{formatNumber(serviceProviderOptions.length)}</strong>
        </div>

        <div className="stat-card">
          <span>LM PCode</span>
          <strong>{activeLmPcode || "NAv"}</strong>
        </div>

        <div className="stat-card">
          <span>Role Filter</span>
          <strong>{selectedRole || "All"}</strong>
        </div>
      </section>

      <section className="table-panel">
        {error ? (
          <div className="empty-state error-box">
            <h2>Could not load User Activity report</h2>
            <p className="muted">
              Check Firestore rules, report_trn_user_activity, or the LM field
              used by the query.
            </p>
          </div>
        ) : null}

        {isLoading ? (
          <div className="empty-state">
            <h2>Loading User Activity report...</h2>
            <p className="muted">Opening Firestore stream.</p>
          </div>
        ) : null}

        {!isLoading && filteredRows.length === 0 && !error ? (
          <div className="empty-state">
            <h2>No User Activity rows found</h2>
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
                  <th>User</th>
                  <th>Role</th>
                  <th>Service Provider</th>
                  <th>Team</th>
                  <th>Total TRNs</th>
                  <th>Meter Discovery</th>
                  <th>No Access</th>
                  <th>Inspection</th>
                  <th>Installation</th>
                  <th>Removal</th>
                  <th>Disconnection</th>
                  <th>Reconnection</th>
                  <th>Other</th>
                  <th>Updated</th>
                </tr>
              </thead>

              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.userName}</td>
                    <td>{row.userRole}</td>
                    <td>{row.serviceProviderName}</td>
                    <td>{row.teamName}</td>
                    <td>{formatNumber(row.totalTrns)}</td>
                    <td>{formatNumber(row.meterDiscoveryTrns)}</td>
                    <td>{formatNumber(row.noAccessTrns)}</td>
                    <td>{formatNumber(row.meterInspectionTrns)}</td>
                    <td>{formatNumber(row.meterInstallationTrns)}</td>
                    <td>{formatNumber(row.meterRemovalTrns)}</td>
                    <td>{formatNumber(row.meterDisconnectionTrns)}</td>
                    <td>{formatNumber(row.meterReconnectionTrns)}</td>
                    <td>{formatNumber(row.otherTrns)}</td>
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
