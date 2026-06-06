import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGetRegistryMetersByWardQuery } from "../../redux/registryMetersApi";
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

function getMeterTypeLabel(meterType) {
  if (meterType === "electricity") return "Electricity";
  if (meterType === "water") return "Water";
  return meterType || "NAv";
}

function getMeterStatusLabel(statusState) {
  const normalizedStatus = String(statusState || "NAv").toUpperCase();

  if (normalizedStatus === "REMOVED") return "REMOVED";
  if (normalizedStatus === "CONNECTED") return "CONNECTED";
  if (normalizedStatus === "DISCONNECTED") return "DISCONNECTED";
  if (normalizedStatus === "FIELD") return "FIELD";

  return normalizedStatus || "NAv";
}

export default function MetersRegistryPage() {
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
    return wardRows.find((ward) => ward.meterCount > 0) || wardRows[0] || null;
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
    data: meterRows = [],
    isLoading,
    isFetching,
    error,
  } = useGetRegistryMetersByWardQuery(effectiveSelectedWardPcode || skipToken);

  const totals = meterRows.reduce(
    (accumulator, row) => {
      if (row.meterType === "electricity") {
        accumulator.electricity += 1;
      }

      if (row.meterType === "water") {
        accumulator.water += 1;
      }

      if (row.visibility === "VISIBLE") {
        accumulator.visible += 1;
      }

      if (row.visibility === "INVISIBLE") {
        accumulator.invisible += 1;
      }

      if (String(row.statusState || "").toUpperCase() === "REMOVED") {
        accumulator.removed += 1;
      }

      return accumulator;
    },
    {
      electricity: 0,
      water: 0,
      visible: 0,
      invisible: 0,
      removed: 0,
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
          <h1>Meter Registry</h1>

          <p className="muted">
            Showing backend-shaped meter registry rows for {activeWorkbaseName}.
          </p>

          <Link className="text-link" to="/registries">
            ← Back to Registries
          </Link>
        </div>

        <div className="role-pill">
          {isFetching
            ? "Streaming..."
            : `${formatNumber(meterRows.length)} meters`}
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
                Ward {ward.wardNumber} · {formatNumber(ward.meterCount)} meters
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
          <span>Meters</span>
          <strong>{formatNumber(meterRows.length)}</strong>
        </div>

        <div className="stat-card">
          <span>Ward Meter Count</span>
          <strong>{formatNumber(selectedWard?.meterCount || 0)}</strong>
        </div>

        <div className="stat-card">
          <span>Electricity</span>
          <strong>{formatNumber(totals.electricity)}</strong>
        </div>

        <div className="stat-card">
          <span>Water</span>
          <strong>{formatNumber(totals.water)}</strong>
        </div>

        <div className="stat-card">
          <span>Visible</span>
          <strong>{formatNumber(totals.visible)}</strong>
        </div>

        <div className="stat-card">
          <span>Invisible</span>
          <strong>{formatNumber(totals.invisible)}</strong>
        </div>

        <div className="stat-card">
          <span>Removed</span>
          <strong>{formatNumber(totals.removed)}</strong>
        </div>

        <div className="stat-card">
          <span>LM PCode</span>
          <strong>{activeLmPcode || "NAv"}</strong>
        </div>

        <div className="stat-card">
          <span>Selected Ward</span>
          <strong>{selectedWard?.wardNumber || "NAv"}</strong>
        </div>
      </section>

      <section className="table-panel">
        {!effectiveSelectedWardPcode ? (
          <div className="empty-state">
            <h2>Select a ward</h2>
            <p className="muted">
              Meter Registry is ward-scoped for clean operational browsing.
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="empty-state error-box">
            <h2>Could not load meter registry</h2>
            <p className="muted">
              Check Firestore rules, registry_meters, or the ward field used by
              the query.
            </p>
          </div>
        ) : null}

        {isLoading ? (
          <div className="empty-state">
            <h2>Loading meter registry...</h2>
            <p className="muted">Opening Firestore stream.</p>
          </div>
        ) : null}

        {!isLoading &&
        effectiveSelectedWardPcode &&
        meterRows.length === 0 &&
        !error ? (
          <div className="empty-state">
            <h2>No meter registry rows found</h2>
            <p className="muted">
              No meters were returned for ward {effectiveSelectedWardPcode}.
            </p>
          </div>
        ) : null}

        {meterRows.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Meter No</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Visibility</th>
                  <th>ERF No</th>
                  <th>Premise Address</th>
                  <th>Premise Type</th>
                  <th>Premise ID</th>
                  <th>Created By</th>
                  <th>Updated</th>
                </tr>
              </thead>

              <tbody>
                {meterRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.meterNo}</td>
                    <td>{getMeterTypeLabel(row.meterType)}</td>
                    <td>{getMeterStatusLabel(row.statusState)}</td>
                    <td>{row.visibility}</td>
                    <td>{row.erfNo}</td>
                    <td>{row.premiseAddress}</td>
                    <td>{row.premisePropertyType}</td>
                    <td>{row.premiseId}</td>
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
