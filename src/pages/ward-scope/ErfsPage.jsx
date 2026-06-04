import { useMemo, useState } from "react";

import WardScopeHeader from "./components/WardScopeHeader";
import { useWarehouse } from "../../context/WarehouseContext";

const EMPTY_COLUMN_FILTERS = {
  erfNo: "",
  type: "",
  ward: "",
  lm: "",
  premises: "",
  erfId: "",
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

const getErfKey = (erf) => erf?.erfId || erf?.id || erf?.erfNo || "NAv";

const getErfNo = (erf) => erf?.erfNo || erf?.sg?.parcelNo || "NAv";

const getErfType = (erf) => erf?.type || erf?.erfType || "NAv";

const getPremiseCount = (erf) => {
  if (Array.isArray(erf?.premiseIds)) return erf.premiseIds.length;
  if (Array.isArray(erf?.premises)) return erf.premises.length;
  if (typeof erf?.premiseCount === "number") return erf.premiseCount;

  return 0;
};

function applyColumnFilters(erfs, columnFilters) {
  return erfs.filter((erf) => {
    return (
      matchesTextFilter(getErfNo(erf), columnFilters.erfNo) &&
      matchesTextFilter(getErfType(erf), columnFilters.type) &&
      matchesTextFilter(erf?.wardPcode || "NAv", columnFilters.ward) &&
      matchesTextFilter(erf?.lmPcode || "NAv", columnFilters.lm) &&
      matchesTextFilter(getPremiseCount(erf), columnFilters.premises) &&
      matchesTextFilter(erf?.erfId || erf?.id || "NAv", columnFilters.erfId)
    );
  });
}

export default function ErfsPage() {
  const { all, filtered, sync, loading } = useWarehouse();
  const [columnFilters, setColumnFilters] = useState(EMPTY_COLUMN_FILTERS);

  const allErfs = all?.erfs || [];
  const erfs = filtered?.erfs || [];
  const erfsSync = sync?.erfs || {};
  const selectedWardPcode = sync?.scope?.wardPcode || erfsSync?.wardPcode || "";
  const hasColumnFilters = hasActiveColumnFilters(columnFilters);
  const visibleErfs = useMemo(
    () => applyColumnFilters(erfs, columnFilters),
    [erfs, columnFilters],
  );
  const isWaitingForErfs =
    Boolean(selectedWardPcode) &&
    erfs.length === 0 &&
    (loading ||
      erfsSync?.status === "pending" ||
      erfsSync?.status === "loading" ||
      erfsSync?.status === "syncing");

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
        stats={[
          {
            label: "Ward ERFs",
            value: loading
              ? "Loading..."
              : erfsSync?.status === "ready"
                ? allErfs.length
                : erfsSync?.status || "idle",
          },
          {
            label: "Premises Loaded",
            value: filtered?.prems?.length || 0,
          },
        ]}
      />

      <section className="table-panel">
        <div className="load-more-row">
          <div>
            <strong>Operational ERFs</strong>
            <p className="muted">
              ERFs are loaded through the Ward Warehouse for the selected ward.
            </p>
          </div>

          <div className="filter-summary">
            <strong>{erfsSync?.status || "idle"}</strong>
            <span>{visibleErfs.length} visible rows</span>
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
              Choose a ward above to load operational ERFs from the warehouse.
            </p>
          </div>
        ) : isWaitingForErfs ? (
          <LoadingRowsState label="Loading ERFs" />
        ) : erfs.length === 0 ? (
          <div className="empty-state">
            <h2>No ERFs loaded</h2>
            <p className="muted">
              ERF sync status: {erfsSync?.status || "idle"}. If this remains
              empty, we will check the Firestore query/index for ireps_erfs.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
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
                      field="type"
                      label="Type"
                      value={columnFilters.type}
                      onChange={updateColumnFilter}
                    />
                  </th>
                  <th>
                    <ColumnHeaderFilter
                      field="ward"
                      label="Ward"
                      value={columnFilters.ward}
                      onChange={updateColumnFilter}
                    />
                  </th>
                  <th>
                    <ColumnHeaderFilter
                      field="lm"
                      label="LM"
                      value={columnFilters.lm}
                      onChange={updateColumnFilter}
                    />
                  </th>
                  <th>
                    <ColumnHeaderFilter
                      field="premises"
                      label="Premises"
                      value={columnFilters.premises}
                      onChange={updateColumnFilter}
                    />
                  </th>
                  <th>
                    <ColumnHeaderFilter
                      field="erfId"
                      label="ERF ID"
                      value={columnFilters.erfId}
                      onChange={updateColumnFilter}
                    />
                  </th>
                </tr>
              </thead>

              <tbody>
                {visibleErfs.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No ERFs match the column filters.</td>
                  </tr>
                ) : (
                  visibleErfs.map((erf) => (
                    <tr key={getErfKey(erf)}>
                      <td>{getErfNo(erf)}</td>
                      <td>{getErfType(erf)}</td>
                      <td>{erf?.wardPcode || "NAv"}</td>
                      <td>{erf?.lmPcode || "NAv"}</td>
                      <td>{getPremiseCount(erf)}</td>
                      <td>{erf?.erfId || erf?.id || "NAv"}</td>
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
