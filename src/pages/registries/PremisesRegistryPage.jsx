import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGetRegistryPremisesByWardQuery } from "../../redux/registryPremisesApi";
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

function getWardLabel(ward) {
  if (!ward) return "NAv";
  return `Ward ${ward.wardNumber}`;
}

export default function PremisesRegistryPage() {
  const { activeWorkbase } = useAuth();

  const [selectedWardPcode, setSelectedWardPcode] = useState("");

  const activeLmPcode = getActiveLmPcode(activeWorkbase);

  const activeWorkbaseName =
    activeWorkbase?.name ||
    activeWorkbase?.lmName ||
    activeWorkbase?.id ||
    activeWorkbase?.pcode ||
    "NAv";

  const { data: wardRows = [], isLoading: wardsLoading } =
    useGetRegistryWardsByLmQuery(activeLmPcode || skipToken);

  const defaultWard = useMemo(() => {
    return (
      wardRows.find((ward) => ward.premiseCount > 0) || wardRows[0] || null
    );
  }, [wardRows]);

  const userSelectedWard = useMemo(() => {
    return (
      wardRows.find((ward) => ward.wardPcode === selectedWardPcode) || null
    );
  }, [wardRows, selectedWardPcode]);

  const effectiveSelectedWardPcode =
    userSelectedWard?.wardPcode || defaultWard?.wardPcode || "";

  const selectedWard = userSelectedWard || defaultWard;

  const {
    data: premiseRows = [],
    isLoading,
    isFetching,
    error,
  } = useGetRegistryPremisesByWardQuery(
    effectiveSelectedWardPcode || skipToken,
  );

  const totals = premiseRows.reduce(
    (accumulator, row) => {
      accumulator.electricityMeters += row.electricityMeterCount;
      accumulator.waterMeters += row.waterMeterCount;
      accumulator.meters += row.meterCount;

      if (row.occupancyStatus === "Accessed") {
        accumulator.accessed += 1;
      }

      if (row.occupancyStatus === "Occupied") {
        accumulator.occupied += 1;
      }

      return accumulator;
    },
    {
      electricityMeters: 0,
      waterMeters: 0,
      meters: 0,
      accessed: 0,
      occupied: 0,
    },
  );

  function handleWardChange(event) {
    setSelectedWardPcode(event.target.value);
  }

  return (
    <>
      <header className="console-header">
        <div>
          <p className="eyebrow">Registry</p>
          <h1>Premise Registry</h1>

          <p className="muted">
            Showing backend-shaped premise registry rows for{" "}
            {activeWorkbaseName}.
          </p>

          <Link className="text-link" to="/registries">
            ← Back to Registries
          </Link>
        </div>

        <div className="role-pill">
          {isFetching
            ? "Streaming..."
            : `${formatNumber(premiseRows.length)} premises`}
        </div>
      </header>

      <section className="filter-panel">
        <label>
          Ward
          <select
            value={effectiveSelectedWardPcode}
            onChange={handleWardChange}
            disabled={wardsLoading || wardRows.length === 0}
          >
            <option value="">Select ward</option>

            {wardRows.map((ward) => (
              <option key={ward.wardPcode} value={ward.wardPcode}>
                Ward {ward.wardNumber} · {formatNumber(ward.premiseCount)}{" "}
                premises
              </option>
            ))}
          </select>
        </label>

        <div className="filter-summary">
          <strong>{getWardLabel(selectedWard)}</strong>
          <span>{effectiveSelectedWardPcode || "No ward selected"}</span>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="stat-card">
          <span>Premises</span>
          <strong>{formatNumber(premiseRows.length)}</strong>
        </div>

        <div className="stat-card">
          <span>Ward Premise Count</span>
          <strong>{formatNumber(selectedWard?.premiseCount || 0)}</strong>
        </div>

        <div className="stat-card">
          <span>Total Meters</span>
          <strong>{formatNumber(totals.meters)}</strong>
        </div>

        <div className="stat-card">
          <span>Electricity</span>
          <strong>{formatNumber(totals.electricityMeters)}</strong>
        </div>

        <div className="stat-card">
          <span>Water</span>
          <strong>{formatNumber(totals.waterMeters)}</strong>
        </div>

        <div className="stat-card">
          <span>Accessed</span>
          <strong>{formatNumber(totals.accessed)}</strong>
        </div>

        <div className="stat-card">
          <span>Occupied</span>
          <strong>{formatNumber(totals.occupied)}</strong>
        </div>

        <div className="stat-card">
          <span>LM PCode</span>
          <strong>{activeLmPcode || "NAv"}</strong>
        </div>
      </section>

      <section className="table-panel">
        {!effectiveSelectedWardPcode ? (
          <div className="empty-state">
            <h2>Select a ward</h2>
            <p className="muted">
              Premise Registry is ward-scoped for clean operational browsing.
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="empty-state error-box">
            <h2>Could not load premise registry</h2>
            <p className="muted">
              Check Firestore rules, registry_premises, or the ward field used
              by the query.
            </p>
          </div>
        ) : null}

        {isLoading ? (
          <div className="empty-state">
            <h2>Loading premise registry...</h2>
            <p className="muted">Opening Firestore stream.</p>
          </div>
        ) : null}

        {!isLoading &&
        effectiveSelectedWardPcode &&
        premiseRows.length === 0 &&
        !error ? (
          <div className="empty-state">
            <h2>No premise registry rows found</h2>
            <p className="muted">
              No premises were returned for ward {effectiveSelectedWardPcode}.
            </p>
          </div>
        ) : null}

        {premiseRows.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Premise</th>
                  <th>ERF No</th>
                  <th>Address</th>
                  <th>Property Type</th>
                  <th>Name</th>
                  <th>Unit</th>
                  <th>Occupancy</th>
                  <th>Electricity</th>
                  <th>Water</th>
                  <th>Total Meters</th>
                  <th>Created By</th>
                  <th>Updated</th>
                </tr>
              </thead>

              <tbody>
                {premiseRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.premiseId}</td>
                    <td>{row.erfNo}</td>
                    <td>{row.addressText}</td>
                    <td>{row.propertyTypeType}</td>
                    <td>{row.propertyTypeName}</td>
                    <td>{row.unitNo}</td>
                    <td>{row.occupancyStatus}</td>
                    <td>{formatNumber(row.electricityMeterCount)}</td>
                    <td>{formatNumber(row.waterMeterCount)}</td>
                    <td>{formatNumber(row.meterCount)}</td>
                    <td>{row.createdByUser}</td>
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
