import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
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

export default function WardsRegistryPage() {
  const { activeWorkbase } = useAuth();

  const activeLmPcode = getActiveLmPcode(activeWorkbase);

  const {
    data: wardRows = [],
    isLoading,
    isFetching,
    error,
  } = useGetRegistryWardsByLmQuery(activeLmPcode || skipToken);

  const activeWorkbaseName =
    activeWorkbase?.name ||
    activeWorkbase?.lmName ||
    activeWorkbase?.id ||
    activeWorkbase?.pcode ||
    "NAv";

  const totals = wardRows.reduce(
    (accumulator, row) => {
      accumulator.totalErfs += row.totalErfCount;
      accumulator.premises += row.premiseCount;
      accumulator.electricityMeters += row.electricityMeterCount;
      accumulator.waterMeters += row.waterMeterCount;
      accumulator.meters += row.meterCount;
      accumulator.trns += row.trnCount;
      return accumulator;
    },
    {
      totalErfs: 0,
      premises: 0,
      electricityMeters: 0,
      waterMeters: 0,
      meters: 0,
      trns: 0,
    },
  );

  return (
    <>
      <header className="console-header">
        <div>
          <p className="eyebrow">Registry</p>
          <h1>Ward Registry</h1>
          <p className="muted">
            Showing backend-shaped ward registry rows for {activeWorkbaseName}.
          </p>

          <Link className="text-link" to="/registries">
            ← Back to Registries
          </Link>
        </div>

        <div className="role-pill">
          {isFetching ? "Streaming..." : `${wardRows.length} wards`}
        </div>
      </header>

      <section className="dashboard-grid">
        <div className="stat-card">
          <span>Wards</span>
          <strong>{formatNumber(wardRows.length)}</strong>
        </div>

        <div className="stat-card">
          <span>Total ERFs</span>
          <strong>{formatNumber(totals.totalErfs)}</strong>
        </div>

        <div className="stat-card">
          <span>Premises</span>
          <strong>{formatNumber(totals.premises)}</strong>
        </div>

        <div className="stat-card">
          <span>Total Meters</span>
          <strong>{formatNumber(totals.meters)}</strong>
        </div>

        <div className="stat-card">
          <span>Electricity Meters</span>
          <strong>{formatNumber(totals.electricityMeters)}</strong>
        </div>

        <div className="stat-card">
          <span>Water Meters</span>
          <strong>{formatNumber(totals.waterMeters)}</strong>
        </div>

        <div className="stat-card">
          <span>TRNs</span>
          <strong>{formatNumber(totals.trns)}</strong>
        </div>

        <div className="stat-card">
          <span>LM PCode</span>
          <strong>{activeLmPcode || "NAv"}</strong>
        </div>
      </section>

      <section className="table-panel">
        {!activeLmPcode ? (
          <div className="empty-state">
            <h2>No active workbase</h2>
            <p className="muted">
              Your profile does not currently have an active LM/workbase.
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="empty-state error-box">
            <h2>Could not load ward registry</h2>
            <p className="muted">
              Check Firestore rules, the registry_wards collection, or the LM
              field used by the query.
            </p>
          </div>
        ) : null}

        {isLoading ? (
          <div className="empty-state">
            <h2>Loading ward registry...</h2>
            <p className="muted">Opening Firestore stream.</p>
          </div>
        ) : null}

        {!isLoading && activeLmPcode && wardRows.length === 0 && !error ? (
          <div className="empty-state">
            <h2>No ward registry rows found</h2>
            <p className="muted">
              No rows were returned for LM {activeLmPcode}.
            </p>
          </div>
        ) : null}

        {wardRows.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ward</th>
                  <th>Formal ERFs</th>
                  <th>Informal ERFs</th>
                  <th>Total ERFs</th>
                  <th>Premises</th>
                  <th>Electricity</th>
                  <th>Water</th>
                  <th>Total Meters</th>
                  <th>TRNs</th>
                  <th>Updated</th>
                </tr>
              </thead>

              <tbody>
                {wardRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.wardNumber}</td>
                    <td>{formatNumber(row.formalErfCount)}</td>
                    <td>{formatNumber(row.informalErfCount)}</td>
                    <td>{formatNumber(row.totalErfCount)}</td>
                    <td>{formatNumber(row.premiseCount)}</td>
                    <td>{formatNumber(row.electricityMeterCount)}</td>
                    <td>{formatNumber(row.waterMeterCount)}</td>
                    <td>{formatNumber(row.meterCount)}</td>
                    <td>{formatNumber(row.trnCount)}</td>
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
