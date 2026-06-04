import { useMemo, useState } from "react";

import WardScopeHeader from "./components/WardScopeHeader";
import { useWarehouse } from "../../context/WarehouseContext";

const EMPTY_COLUMN_FILTERS = {
  address: "",
  suburb: "",
  erfNo: "",
  propertyType: "",
  propertyName: "",
  unitNo: "",
  electricity: "",
  water: "",
  totalMeters: "",
  premiseId: "",
};


const COLUMN_HEADER_FILTER_WRAP_STYLE = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const COLUMN_HEADER_LABEL_STYLE = {
  fontWeight: 800,
  whiteSpace: "nowrap",
};

const COLUMN_FILTER_INPUT_STYLE = {
  width: "100%",
  minWidth: 86,
  boxSizing: "border-box",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  background: "#fff",
  color: "#0f172a",
  fontSize: 11,
  padding: "6px 8px",
};

const CLEAR_FILTERS_BUTTON_STYLE = {
  border: "1px solid #fbbf24",
  borderRadius: 999,
  background: "#fffbeb",
  color: "#92400e",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 800,
  padding: "8px 12px",
};

const LOADING_STATE_STYLE = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const SPINNER_STYLE = {
  width: 16,
  height: 16,
  border: "3px solid #e2e8f0",
  borderTopColor: "#2563eb",
  borderRadius: "50%",
  animation: "irepsWardScopeSpin 0.8s linear infinite",
};

function normalizeFilterText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function matchesTextFilter(value, filterValue) {
  const needle = normalizeFilterText(filterValue);

  if (!needle) return true;

  return normalizeFilterText(value).includes(needle);
}

function hasActiveColumnFilters(columnFilters) {
  return Object.values(columnFilters).some((value) => normalizeFilterText(value));
}

function ColumnHeaderFilter({ label, field, value, onChange, placeholder }) {
  return (
    <div style={COLUMN_HEADER_FILTER_WRAP_STYLE}>
      <span style={COLUMN_HEADER_LABEL_STYLE}>{label}</span>
      <input
        aria-label={`Filter ${label}`}
        placeholder={placeholder || "Filter"}
        style={COLUMN_FILTER_INPUT_STYLE}
        type="text"
        value={value || ""}
        onChange={(event) => onChange(field, event.target.value)}
      />
    </div>
  );
}

function LoadingRowsState({ label }) {
  return (
    <div className="empty-state">
      <style>{`@keyframes irepsWardScopeSpin { to { transform: rotate(360deg); } }`}</style>
      <div style={LOADING_STATE_STYLE}>
        <span aria-hidden="true" style={SPINNER_STYLE} />
        <div>
          <h2>{label}</h2>
          <p className="muted">Waiting for the Ward Warehouse stream.</p>
        </div>
      </div>
    </div>
  );
}

const getPremiseKey = (premise) =>
  premise?.premiseId || premise?.id || premise?.address || "NAv";

const getPremiseId = (premise) => premise?.premiseId || premise?.id || "NAv";

const getPremiseAddress = (premise) => {
  if (typeof premise?.address === "string") return premise.address;

  const address = premise?.address || {};

  const parts = [address?.strNo, address?.strName, address?.strType].filter(
    Boolean,
  );

  if (parts.length) return parts.join(" ");

  return premise?.fullAddress || premise?.premiseAddress || "NAv";
};

const getSuburb = (premise) => {
  if (typeof premise?.address === "string") return premise.address;

  const suburb = premise?.address?.suburbName || "";

  return suburb;
};

const getPropertyType = (premise) => {
  if (typeof premise?.propertyType === "string") return premise.propertyType;

  return premise?.propertyType?.type || premise?.type || "NAv";
};

const getPropertyName = (premise) => {
  if (typeof premise?.propertyName === "string") return premise.propertyName;

  return premise?.propertyType?.name || "NAv";
};

const getUnitNo = (premise) => {
  return (
    premise?.propertyType?.unitNo ||
    premise?.propertyType?.UnitNo ||
    premise?.unitNo ||
    premise?.unitNumber ||
    ""
  );
};

const getErfNo = (premise) => {
  return premise?.erfNo || premise?.erf?.erfNo || "NAv";
};

const getErfId = (premise) => {
  return premise?.erfId || premise?.erf?.id || "NAv";
};

const getElectricityMeterCount = (premise) => {
  return (
    premise?.electricityMeterCount ||
    premise?.counts?.electricityMeters ||
    premise?.counts?.electricityMeterCount ||
    0
  );
};

const getWaterMeterCount = (premise) => {
  return (
    premise?.waterMeterCount ||
    premise?.counts?.waterMeters ||
    premise?.counts?.waterMeterCount ||
    0
  );
};

const getTotalMeterCount = (premise) => {
  return (
    premise?.totalMeterCount ||
    premise?.meterCount ||
    premise?.counts?.totalMeters ||
    getElectricityMeterCount(premise) + getWaterMeterCount(premise)
  );
};

function applyColumnFilters(premises, columnFilters) {
  return premises.filter((premise) => {
    return (
      matchesTextFilter(getPremiseAddress(premise), columnFilters.address) &&
      matchesTextFilter(getSuburb(premise), columnFilters.suburb) &&
      matchesTextFilter(getErfNo(premise), columnFilters.erfNo) &&
      matchesTextFilter(getPropertyType(premise), columnFilters.propertyType) &&
      matchesTextFilter(getPropertyName(premise), columnFilters.propertyName) &&
      matchesTextFilter(getUnitNo(premise), columnFilters.unitNo) &&
      matchesTextFilter(
        getElectricityMeterCount(premise),
        columnFilters.electricity,
      ) &&
      matchesTextFilter(getWaterMeterCount(premise), columnFilters.water) &&
      matchesTextFilter(getTotalMeterCount(premise), columnFilters.totalMeters) &&
      matchesTextFilter(getPremiseId(premise), columnFilters.premiseId)
    );
  });
}

export default function PremisesPage() {
  const { all, filtered, sync, selected, loading } = useWarehouse();
  const [columnFilters, setColumnFilters] = useState(EMPTY_COLUMN_FILTERS);

  const allPremises = all?.prems || [];
  const premises = filtered?.prems || [];
  const premisesSync = sync?.premises || sync?.prems || {};
  const selectedWardPcode =
    sync?.scope?.wardPcode || premisesSync?.wardPcode || "";
  const selectedGeofence = selected?.geofence || null;
  const activeGeofenceLabel =
    selectedGeofence?.name || selectedGeofence?.id || "None";
  const hasColumnFilters = hasActiveColumnFilters(columnFilters);
  const visiblePremises = useMemo(
    () => applyColumnFilters(premises, columnFilters),
    [premises, columnFilters],
  );
  const isWaitingForPremises =
    Boolean(selectedWardPcode) &&
    premises.length === 0 &&
    (loading ||
      premisesSync?.status === "pending" ||
      premisesSync?.status === "loading" ||
      premisesSync?.status === "syncing");

  function updateColumnFilter(field, value) {
    setColumnFilters((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function clearColumnFilters() {
    setColumnFilters(EMPTY_COLUMN_FILTERS);
  }

  return (
    <>
      <WardScopeHeader
        showGeofenceLens
        geofenceClearLabel="All ward premises"
        stats={[
          {
            label: "Ward Premises",
            value: loading
              ? "Loading..."
              : premisesSync?.status === "ready"
                ? allPremises.length
                : premisesSync?.status || "idle",
          },
          {
            label: "Visible Premises",
            value: visiblePremises.length,
          },
          {
            label: "Active Geofence",
            value: activeGeofenceLabel,
          },
          {
            label: "Meters Loaded",
            value: filtered?.meters?.length || 0,
          },
        ]}
      />

      <section className="table-panel">
        <div className="load-more-row">
          <div>
            <strong>Operational Premises</strong>
            <p className="muted">
              Premises are loaded through the Ward Warehouse for the selected
              ward.
            </p>
          </div>

          <div className="filter-summary">
            <strong>{premisesSync?.status || "idle"}</strong>
            <span>{visiblePremises.length} visible rows</span>
            {hasColumnFilters ? (
              <button
                type="button"
                style={CLEAR_FILTERS_BUTTON_STYLE}
                onClick={clearColumnFilters}
              >
                Clear filters
              </button>
            ) : null}
          </div>
        </div>

        {!selectedWardPcode ? (
          <div className="empty-state">
            <h2>Select a ward</h2>
            <p className="muted">
              Choose a ward above to load operational premises from the
              warehouse.
            </p>
          </div>
        ) : isWaitingForPremises ? (
          <LoadingRowsState label="Loading premises" />
        ) : premises.length === 0 ? (
          <div className="empty-state">
            <h2>No premises loaded</h2>
            <p className="muted">
              Premise sync status: {premisesSync?.status || "idle"}. If this
              remains empty, we will check the Firestore query/index for
              premises.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>
                    <ColumnHeaderFilter
                      field="address"
                      label="Address"
                      value={columnFilters.address}
                      onChange={updateColumnFilter}
                    />
                  </th>
                  <th>
                    <ColumnHeaderFilter
                      field="suburb"
                      label="SUBURB NAME"
                      value={columnFilters.suburb}
                      onChange={updateColumnFilter}
                    />
                  </th>
                  <th>
                    <ColumnHeaderFilter
                      field="erfNo"
                      label="ERF No"
                      value={columnFilters.erfNo}
                      onChange={updateColumnFilter}
                    />
                  </th>
                  <th>
                    <ColumnHeaderFilter
                      field="propertyType"
                      label="Property Type"
                      value={columnFilters.propertyType}
                      onChange={updateColumnFilter}
                    />
                  </th>
                  <th>
                    <ColumnHeaderFilter
                      field="propertyName"
                      label="Property Name"
                      value={columnFilters.propertyName}
                      onChange={updateColumnFilter}
                    />
                  </th>
                  <th>
                    <ColumnHeaderFilter
                      field="unitNo"
                      label="Unit No"
                      value={columnFilters.unitNo}
                      onChange={updateColumnFilter}
                    />
                  </th>
                  <th>
                    <ColumnHeaderFilter
                      field="electricity"
                      label="Electricity"
                      value={columnFilters.electricity}
                      onChange={updateColumnFilter}
                    />
                  </th>
                  <th>
                    <ColumnHeaderFilter
                      field="water"
                      label="Water"
                      value={columnFilters.water}
                      onChange={updateColumnFilter}
                    />
                  </th>
                  <th>
                    <ColumnHeaderFilter
                      field="totalMeters"
                      label="Total Meters"
                      value={columnFilters.totalMeters}
                      onChange={updateColumnFilter}
                    />
                  </th>
                  <th>
                    <ColumnHeaderFilter
                      field="premiseId"
                      label="Premise ID"
                      value={columnFilters.premiseId}
                      onChange={updateColumnFilter}
                    />
                  </th>
                </tr>
              </thead>

              <tbody>
                {visiblePremises.length === 0 ? (
                  <tr>
                    <td colSpan={10}>No premises match the column filters.</td>
                  </tr>
                ) : (
                  visiblePremises.map((premise) => (
                    <tr key={getPremiseKey(premise)}>
                      <td>{getPremiseAddress(premise)}</td>
                      <td>{getSuburb(premise)}</td>
                      <td title={getErfId(premise)}>{getErfNo(premise)}</td>
                      <td>{getPropertyType(premise)}</td>
                      <td>{getPropertyName(premise)}</td>
                      <td>{getUnitNo(premise)}</td>
                      <td>{getElectricityMeterCount(premise)}</td>
                      <td>{getWaterMeterCount(premise)}</td>
                      <td>{getTotalMeterCount(premise)}</td>
                      <td>{getPremiseId(premise)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
