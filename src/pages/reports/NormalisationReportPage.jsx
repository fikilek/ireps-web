import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGetNormalisationRowsByLmQuery } from "../../redux/reportNormalisationApi";

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

export default function NormalisationReportPage() {
  const { activeWorkbase } = useAuth();

  const [selectedDate, setSelectedDate] = useState("");
  const [selectedCombinationKey, setSelectedCombinationKey] = useState("");
  const [viewMode, setViewMode] = useState("DAILY");

  const activeLmPcode = getActiveLmPcode(activeWorkbase);

  const activeWorkbaseName =
    activeWorkbase?.name ||
    activeWorkbase?.lmName ||
    activeWorkbase?.id ||
    activeWorkbase?.pcode ||
    "NAv";

  const {
    data: normalisationRows = [],
    isLoading,
    isFetching,
    error,
  } = useGetNormalisationRowsByLmQuery(activeLmPcode || skipToken);

  const actionOptions = useMemo(() => {
    const lookup = new Map();

    normalisationRows.forEach((row) => {
      if (!row.combinationKey || row.combinationKey === "NAv") return;
      lookup.set(row.combinationKey, row.actionsText || row.combinationKey);
    });

    return Array.from(lookup.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [normalisationRows]);

  const filteredRows = useMemo(() => {
    return normalisationRows.filter((row) => {
      const matchesDate = selectedDate
        ? row.activityDate === selectedDate
        : true;

      const matchesAction = selectedCombinationKey
        ? row.combinationKey === selectedCombinationKey
        : true;

      return matchesDate && matchesAction;
    });
  }, [normalisationRows, selectedDate, selectedCombinationKey]);

  const summaryRows = useMemo(() => {
    const summaryMap = new Map();

    filteredRows.forEach((row) => {
      const key = row.combinationKey || "NAv";

      const existing = summaryMap.get(key) || {
        id: key,
        combinationKey: row.combinationKey,
        actionsText: row.actionsText,
        actionCount: row.actionCount,
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

      return String(a.actionsText).localeCompare(
        String(b.actionsText),
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

      if (row.combinationKey === "none") {
        accumulator.noneTrns += row.trnCount;
      } else {
        accumulator.actionTrns += row.trnCount;
      }

      return accumulator;
    },
    {
      totalTrns: 0,
      actionTrns: 0,
      noneTrns: 0,
    },
  );

  const topAction = summaryRows[0]?.actionsText || "NAv";

  function handleClearFilters() {
    setSelectedDate("");
    setSelectedCombinationKey("");
  }

  function handleTodayFilter() {
    setSelectedDate(getTodayIsoDate());
  }

  return (
    <>
      <header className="console-header">
        <div>
          <p className="eyebrow">Report</p>
          <h1>Normalisation Report</h1>

          <p className="muted">
            Showing TRN-derived normalisation action summaries for{" "}
            {activeWorkbaseName}.
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
          Normalisation Action
          <select
            value={selectedCombinationKey}
            onChange={(event) => setSelectedCombinationKey(event.target.value)}
          >
            <option value="">All actions</option>

            {actionOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
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
          <span>Action TRNs</span>
          <strong>{formatNumber(totals.actionTrns)}</strong>
        </div>

        <div className="stat-card">
          <span>None TRNs</span>
          <strong>{formatNumber(totals.noneTrns)}</strong>
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
          <span>Top Action</span>
          <strong>{topAction}</strong>
        </div>

        <div className="stat-card">
          <span>Date Filter</span>
          <strong>{selectedDate || "All"}</strong>
        </div>
      </section>

      <section className="table-panel">
        {error ? (
          <div className="empty-state error-box">
            <h2>Could not load Normalisation report</h2>
            <p className="muted">
              Check Firestore rules, report_trn_normalisation, or the LM field
              used by the query.
            </p>
          </div>
        ) : null}

        {isLoading ? (
          <div className="empty-state">
            <h2>Loading Normalisation report...</h2>
            <p className="muted">Opening Firestore stream.</p>
          </div>
        ) : null}

        {!isLoading && visibleRows.length === 0 && !error ? (
          <div className="empty-state">
            <h2>No Normalisation rows found</h2>
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
                    <th>Actions</th>
                    <th>Action Count</th>
                    <th>TRNs</th>
                    <th>Combination Key</th>
                    <th>Updated</th>
                  </tr>
                ) : (
                  <tr>
                    <th>Actions</th>
                    <th>Action Count</th>
                    <th>Total TRNs</th>
                    <th>First Date</th>
                    <th>Last Date</th>
                    <th>Combination Key</th>
                  </tr>
                )}
              </thead>

              <tbody>
                {viewMode === "DAILY"
                  ? visibleRows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.activityDate}</td>
                        <td>{row.actionsText}</td>
                        <td>{formatNumber(row.actionCount)}</td>
                        <td>{formatNumber(row.trnCount)}</td>
                        <td>{row.combinationKey}</td>
                        <td>{formatUpdatedAt(row.updatedAt)}</td>
                      </tr>
                    ))
                  : visibleRows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.actionsText}</td>
                        <td>{formatNumber(row.actionCount)}</td>
                        <td>{formatNumber(row.trnCount)}</td>
                        <td>{row.firstDate}</td>
                        <td>{row.lastDate}</td>
                        <td>{row.combinationKey}</td>
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
