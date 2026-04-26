import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGetAnomalyRowsByLmQuery } from "../../redux/reportAnomalyApi";

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

function buildAnomalyLabel(row) {
  if (!row) return "NAv";

  if (row.anomalyDetail && row.anomalyDetail !== "NAv") {
    return `${row.anomalyName} - ${row.anomalyDetail}`;
  }

  return row.anomalyName || "NAv";
}

export default function AnomalyReportPage() {
  const { activeWorkbase } = useAuth();

  const [selectedDate, setSelectedDate] = useState("");
  const [selectedAnomalyKey, setSelectedAnomalyKey] = useState("");
  const [selectedDetailKey, setSelectedDetailKey] = useState("");
  const [viewMode, setViewMode] = useState("DAILY");

  const activeLmPcode = getActiveLmPcode(activeWorkbase);

  const activeWorkbaseName =
    activeWorkbase?.name ||
    activeWorkbase?.lmName ||
    activeWorkbase?.id ||
    activeWorkbase?.pcode ||
    "NAv";

  const {
    data: anomalyRows = [],
    isLoading,
    isFetching,
    error,
  } = useGetAnomalyRowsByLmQuery(activeLmPcode || skipToken);

  const anomalyOptions = useMemo(() => {
    const lookup = new Map();

    anomalyRows.forEach((row) => {
      if (!row.anomalyKey || row.anomalyKey === "NAv") return;
      lookup.set(row.anomalyKey, row.anomalyName || row.anomalyKey);
    });

    return Array.from(lookup.entries())
      .map(([key, name]) => ({ key, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [anomalyRows]);

  const detailOptions = useMemo(() => {
    const lookup = new Map();

    anomalyRows.forEach((row) => {
      if (selectedAnomalyKey && row.anomalyKey !== selectedAnomalyKey) return;
      if (!row.anomalyDetailKey || row.anomalyDetailKey === "NAv") return;

      lookup.set(
        row.anomalyDetailKey,
        row.anomalyDetail || row.anomalyDetailKey,
      );
    });

    return Array.from(lookup.entries())
      .map(([key, detail]) => ({ key, detail }))
      .sort((a, b) => a.detail.localeCompare(b.detail));
  }, [anomalyRows, selectedAnomalyKey]);

  const filteredRows = useMemo(() => {
    return anomalyRows.filter((row) => {
      const matchesDate = selectedDate
        ? row.activityDate === selectedDate
        : true;

      const matchesAnomaly = selectedAnomalyKey
        ? row.anomalyKey === selectedAnomalyKey
        : true;

      const matchesDetail = selectedDetailKey
        ? row.anomalyDetailKey === selectedDetailKey
        : true;

      return matchesDate && matchesAnomaly && matchesDetail;
    });
  }, [anomalyRows, selectedDate, selectedAnomalyKey, selectedDetailKey]);

  const summaryRows = useMemo(() => {
    const summaryMap = new Map();

    filteredRows.forEach((row) => {
      const key = `${row.anomalyKey}__${row.anomalyDetailKey}`;

      const existing = summaryMap.get(key) || {
        id: key,
        anomalyName: row.anomalyName,
        anomalyKey: row.anomalyKey,
        anomalyDetail: row.anomalyDetail,
        anomalyDetailKey: row.anomalyDetailKey,
        trnCount: 0,
        firstDate: row.activityDate,
        lastDate: row.activityDate,
      };

      existing.trnCount += row.trnCount;

      if (row.activityDate < existing.firstDate) {
        existing.firstDate = row.activityDate;
      }

      if (row.activityDate > existing.lastDate) {
        existing.lastDate = row.activityDate;
      }

      summaryMap.set(key, existing);
    });

    return Array.from(summaryMap.values()).sort((a, b) => {
      if (b.trnCount !== a.trnCount) return b.trnCount - a.trnCount;

      return String(a.anomalyName).localeCompare(
        String(b.anomalyName),
        undefined,
        {
          numeric: true,
          sensitivity: "base",
        },
      );
    });
  }, [filteredRows]);

  const visibleRows = viewMode === "SUMMARY" ? summaryRows : filteredRows;

  const totals = filteredRows.reduce(
    (accumulator, row) => {
      accumulator.totalTrns += row.trnCount;
      return accumulator;
    },
    {
      totalTrns: 0,
    },
  );

  const topAnomalyRow = summaryRows[0] || null;
  const topAnomalyLabel = topAnomalyRow
    ? buildAnomalyLabel(topAnomalyRow)
    : "NAv";

  function handleClearFilters() {
    setSelectedDate("");
    setSelectedAnomalyKey("");
    setSelectedDetailKey("");
  }

  function handleTodayFilter() {
    setSelectedDate(getTodayIsoDate());
  }

  function handleAnomalyChange(event) {
    setSelectedAnomalyKey(event.target.value);
    setSelectedDetailKey("");
  }

  return (
    <>
      <header className="console-header">
        <div>
          <p className="eyebrow">Report</p>
          <h1>Anomaly Report</h1>

          <p className="muted">
            Showing TRN-derived anomaly summaries for {activeWorkbaseName}.
          </p>

          <Link className="text-link" to="/reports">
            ← Back to Reports
          </Link>
        </div>

        <div className="topbar-right">
          <button
            className="secondary-button"
            type="button"
            onClick={() =>
              setViewMode((current) =>
                current === "DAILY" ? "SUMMARY" : "DAILY",
              )
            }
          >
            {viewMode === "DAILY" ? "Switch to Summary" : "Switch to Daily"}
          </button>

          <div className="role-pill">
            {isFetching
              ? "Streaming..."
              : `${formatNumber(visibleRows.length)} rows`}
          </div>
        </div>
      </header>

      <section className="filter-panel">
        <label>
          Activity Date
          <input
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
          />
        </label>

        <label>
          Anomaly
          <select value={selectedAnomalyKey} onChange={handleAnomalyChange}>
            <option value="">All anomalies</option>

            {anomalyOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Detail
          <select
            value={selectedDetailKey}
            onChange={(event) => setSelectedDetailKey(event.target.value)}
          >
            <option value="">All details</option>

            {detailOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.detail}
              </option>
            ))}
          </select>
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
          <span>View</span>
          <strong>{viewMode}</strong>
        </div>

        <div className="stat-card">
          <span>Total TRNs</span>
          <strong>{formatNumber(totals.totalTrns)}</strong>
        </div>

        <div className="stat-card">
          <span>Daily Rows</span>
          <strong>{formatNumber(filteredRows.length)}</strong>
        </div>

        <div className="stat-card">
          <span>Summary Rows</span>
          <strong>{formatNumber(summaryRows.length)}</strong>
        </div>

        <div className="stat-card">
          <span>Anomaly Types</span>
          <strong>{formatNumber(anomalyOptions.length)}</strong>
        </div>

        <div className="stat-card">
          <span>Top Anomaly</span>
          <strong>{topAnomalyLabel}</strong>
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
            <h2>Could not load Anomaly report</h2>
            <p className="muted">
              Check Firestore rules, report_trn_anomaly, or the LM field used by
              the query.
            </p>
          </div>
        ) : null}

        {isLoading ? (
          <div className="empty-state">
            <h2>Loading Anomaly report...</h2>
            <p className="muted">Opening Firestore stream.</p>
          </div>
        ) : null}

        {!isLoading && visibleRows.length === 0 && !error ? (
          <div className="empty-state">
            <h2>No Anomaly rows found</h2>
            <p className="muted">
              No matching rows were found for the current LM/filter selection.
            </p>
          </div>
        ) : null}

        {visibleRows.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                {viewMode === "DAILY" ? (
                  <tr>
                    <th>Date</th>
                    <th>Anomaly</th>
                    <th>Detail</th>
                    <th>TRNs</th>
                    <th>Updated</th>
                  </tr>
                ) : (
                  <tr>
                    <th>Anomaly</th>
                    <th>Detail</th>
                    <th>Total TRNs</th>
                    <th>First Date</th>
                    <th>Last Date</th>
                  </tr>
                )}
              </thead>

              <tbody>
                {viewMode === "DAILY"
                  ? visibleRows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.activityDate}</td>
                        <td>{row.anomalyName}</td>
                        <td>{row.anomalyDetail}</td>
                        <td>{formatNumber(row.trnCount)}</td>
                        <td>{formatUpdatedAt(row.updatedAt)}</td>
                      </tr>
                    ))
                  : visibleRows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.anomalyName}</td>
                        <td>{row.anomalyDetail}</td>
                        <td>{formatNumber(row.trnCount)}</td>
                        <td>{row.firstDate}</td>
                        <td>{row.lastDate}</td>
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
