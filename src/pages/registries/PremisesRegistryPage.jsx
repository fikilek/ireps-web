/* eslint-disable no-unused-vars -- JSX tags are consumed by React; this ESLint profile does not track them. */
import { irepsTableDateRange as getUpdatedAtFilterRange } from "../../components/table/irepsTableModel.js";
import DataActionButton from "../../components/table/DataActionButton";
import IrepsTable from "../../components/table/IrepsTable";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "../../context/GeoContext";
import { useGetRegistryPremisesByWardQuery } from "../../redux/registryPremisesApi";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";
import { useGetAvailableServiceProvidersQuery } from "../../redux/serviceProvidersApi";
import { isMainContractor, parentIdOf } from "../../components/serviceProviders/providerHierarchy.js";

// ONE CLOCK. This page kept its own copy that did `value.slice(0, 19)`,
// which chops the Z off a UTC timestamp and prints it as if it were the
// reader's own clock - two hours behind, every time (owner, 11 October
// 2026). The shared formatter converts instead of truncating.
import { formatSastDateTime as formatUpdatedAt } from "../../utils/formatSastDateTime";
import { qaDate } from "../../utils/qaDisplay.js";
import {
  PREMISE_QA_STATUS_OPTIONS,
  getPremiseQaStatus,
  getPremiseQaLabel,
  DEMO_QA_PREMISES,
} from "../../utils/premiseQa.js";
import PremiseQaModal from "./components/PremiseQaModal";
import "./components/PremiseQaModal.css";

const EMPTY_PREMISE_FILTERS = {
  erfNo: "",
  addressText: "",
  propertyTypeType: "",
  propertyTypeName: "",
  unitNo: "",
  occupancyStatus: "ALL",
  electricityMeterCount: "",
  waterMeterCount: "",
  meterCount: "",
  qaStatus: "ALL",
};

const DEFAULT_SORT = { key: "updatedAt", direction: "desc" };

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
  if (["Pending", "Unavailable", "Incomplete"].includes(value)) return value;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toLocaleString() : "0";
}

function getUpdatedAtMs(value) {
  if (!value || value === "NAv") return 0;

  if (typeof value?.toDate === "function") {
    const ms = value.toDate().getTime();
    return Number.isFinite(ms) ? ms : 0;
  }

  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function getWardLabel(ward) {
  if (!ward) return "NAv";
  return `Ward ${ward.wardNumber}`;
}

function normalizeFilterText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function includesText(value, filterValue) {
  const filterText = normalizeFilterText(filterValue);
  if (!filterText) return true;

  return normalizeFilterText(value).includes(filterText);
}

function matchesSelect(value, selectedValue) {
  if (!selectedValue || selectedValue === "ALL") return true;

  return (
    String(value || "NAv")
      .trim()
      .toUpperCase() === String(selectedValue).trim().toUpperCase()
  );
}

function getCountText(value) {
  return String(Number(value) || 0);
}

function getWardNumberFromPcode(wardPcode = "") {
  const match = String(wardPcode || "").match(/(\d{1,3})$/);
  const numberValue = Number(match?.[1] || 0);

  return Number.isFinite(numberValue) ? numberValue : 0;
}

function getSelectedWardPcodeFromGeo(geoState) {
  const selectedWard = geoState?.selectedWard || null;

  return selectedWard?.id || selectedWard?.pcode || selectedWard?.wardPcode || "";
}

function buildRegistryWardSelection(ward, fallbackWardPcode = "") {
  const wardPcode = ward?.wardPcode || ward?.pcode || ward?.id || fallbackWardPcode || "";

  if (!wardPcode) return null;

  const wardNumber = ward?.wardNumber || ward?.code || getWardNumberFromPcode(wardPcode) || "NAv";

  return {
    ...(ward || {}),
    id: wardPcode,
    pcode: wardPcode,
    wardPcode,
    code: wardNumber,
    wardNumber,
    name: ward?.wardName || ward?.name || `Ward ${wardNumber}`,
  };
}

function getSortValue(row, key) {
  if (key === "erfNo") return row.erfNo || "";
  if (key === "addressText") return row.addressText || "";
  if (key === "propertyTypeType") return row.propertyTypeType || "";
  if (key === "propertyTypeName") return row.propertyTypeName || "";
  if (key === "unitNo") return row.unitNo || "";
  if (key === "occupancyStatus") return row.occupancyStatus || "";
  if (key === "electricityMeterCount") return row.electricityMeterCount || 0;
  if (key === "waterMeterCount") return row.waterMeterCount || 0;
  if (key === "meterCount") return row.meterCount || 0;
  if (key === "updatedAt") return getUpdatedAtMs(row.updatedAt);
  if (key === "qaStatus") return getPremiseQaStatus(row);

  return "";
}

const EMPTY_UPDATED_AT_FILTER = {
  mode: "ALL",
  startDate: "",
  endDate: "",
};

function getUpdatedAtDate(value) {
  if (!value || value === "NAv") return null;

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value?.seconds === "number") {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function matchesUpdatedAtFilter(value, filter = EMPTY_UPDATED_AT_FILTER) {
  if (!filter || filter.mode === "ALL") return true;

  const rowDate = getUpdatedAtDate(value);
  if (!rowDate) return false;

  const { start, end } = getUpdatedAtFilterRange(filter);

  if (start && rowDate < start) return false;
  if (end && rowDate > end) return false;

  return true;
}

export default function PremisesRegistryPage() {
  const { activeWorkbase, role, uid, profile, serviceProvider } = useAuth();
  const { geoState, updateGeo } = useGeo();
  const { data: providers = [] } = useGetAvailableServiceProvidersQuery();

  const reviewerProvider = providers.find(item => item.id === serviceProvider?.id);
  const reviewerRole =
    profile?.accountStatus === "ACTIVE" &&
    ["MNG", "SPV", "SPU", "ADM"].includes(role) &&
    isMainContractor(reviewerProvider) &&
    !parentIdOf(reviewerProvider);

  const selectedWardPcode = getSelectedWardPcodeFromGeo(geoState);

  const [filters, setFilters] = useState(() => {
    const searchParams =
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search);
    const askedPremise =
      searchParams?.get("premiseId") || searchParams?.get("premise");

    return askedPremise
      ? { ...EMPTY_PREMISE_FILTERS, addressText: askedPremise }
      : EMPTY_PREMISE_FILTERS;
  });

  const [qaPreviewMode, setQaPreviewMode] = useState(() => {
    if (typeof window === "undefined") return false;
    const searchParams = new URLSearchParams(window.location.search);
    return searchParams.get("qaPreview") === "true" || searchParams.get("preview") === "qa";
  });

  const [selectedQa, setSelectedQa] = useState(null);
  const [localQaOverrides, setLocalQaOverrides] = useState({});

  const activeLmPcode = getActiveLmPcode(activeWorkbase);

  const activeWorkbaseName =
    activeWorkbase?.name ||
    activeWorkbase?.lmName ||
    activeWorkbase?.id ||
    activeWorkbase?.pcode ||
    "NAv";

  const { data: wardRows = [], isLoading: wardsLoading } =
    useGetRegistryWardsByLmQuery(activeLmPcode || skipToken);

  const selectedWard = useMemo(() => {
    const registryWard = wardRows.find((ward) => ward.wardPcode === selectedWardPcode) || null;
    return buildRegistryWardSelection(registryWard, selectedWardPcode);
  }, [wardRows, selectedWardPcode]);

  const effectiveSelectedWardPcode = selectedWard?.wardPcode || "";

  const {
    data: rawPremiseRows = [],
    isLoading,
    isFetching,
    error,
  } = useGetRegistryPremisesByWardQuery(effectiveSelectedWardPcode || skipToken);

  // Combine rows: in preview mode, demo premises are included to demonstrate all 4 QA states safely
  const premiseRows = useMemo(() => {
    const baseRows = qaPreviewMode ? [...DEMO_QA_PREMISES, ...rawPremiseRows] : rawPremiseRows;
    if (Object.keys(localQaOverrides).length === 0) return baseRows;

    return baseRows.map(row => {
      const override = localQaOverrides[row.id] || localQaOverrides[row.premiseId];
      if (!override) return row;
      return {
        ...row,
        qa: {
          ...(row.qa || {}),
          ...override,
        },
      };
    });
  }, [qaPreviewMode, rawPremiseRows, localQaOverrides]);

  const filterRegistryRows = useCallback((rows, tableFilters) => {
    const activeFilters = {
      ...EMPTY_PREMISE_FILTERS,
      ...tableFilters,
    };
    for (const key of Object.keys(EMPTY_PREMISE_FILTERS)) {
      if (EMPTY_PREMISE_FILTERS[key] === "ALL" && !activeFilters[key]) {
        activeFilters[key] = "ALL";
      }
    }
    const updatedAtFilter = tableFilters.updatedAt || EMPTY_UPDATED_AT_FILTER;
    return rows.filter(row => {
      if (!matchesSelect(getPremiseQaStatus(row), activeFilters.qaStatus)) return false;
      return (
        includesText(row.erfNo, activeFilters.erfNo) &&
        includesText(`${row.addressText || ""} ${row.premiseId || ""}`, activeFilters.addressText) &&
        includesText(row.propertyTypeType, activeFilters.propertyTypeType) &&
        includesText(row.propertyTypeName, activeFilters.propertyTypeName) &&
        includesText(row.unitNo, activeFilters.unitNo) &&
        (activeFilters.occupancyStatus === "ALL" ||
          String(row.occupancyStatus || "").toUpperCase() === activeFilters.occupancyStatus) &&
        includesText(getCountText(row.electricityMeterCount), activeFilters.electricityMeterCount) &&
        includesText(getCountText(row.waterMeterCount), activeFilters.waterMeterCount) &&
        includesText(getCountText(row.meterCount), activeFilters.meterCount) &&
        matchesUpdatedAtFilter(row.updatedAt, updatedAtFilter)
      );
    });
  }, []);

  const filteredPremiseRows = useMemo(
    () => filterRegistryRows(premiseRows, filters),
    [premiseRows, filters, filterRegistryRows]
  );

  const totals = filteredPremiseRows.reduce(
    (accumulator, row) => {
      accumulator.electricityMeters += row.electricityMeterCount || 0;
      accumulator.waterMeters += row.waterMeterCount || 0;
      accumulator.meters += row.meterCount || 0;
      if (row.occupancyStatus === "Accessed") accumulator.accessed += 1;
      if (row.occupancyStatus === "Occupied") accumulator.occupied += 1;
      return accumulator;
    },
    { electricityMeters: 0, waterMeters: 0, meters: 0, accessed: 0, occupied: 0 },
  );

  const quickDownloadColumns = useMemo(
    () => [
      {
        header: "Premise Address",
        value: (row) => {
          const address = row.addressText || "NAv";
          const premiseId = row.premiseId || "NAv";
          return `${address}\n${premiseId}`;
        },
      },
      {
        header: "ERF No",
        value: (row) => row.erfNo || "NAv",
      },
      {
        header: "Property Type",
        value: (row) => row.propertyTypeType || "NAv",
      },
      {
        header: "Name",
        value: (row) => row.propertyTypeName || "NAv",
      },
      {
        header: "Unit",
        value: (row) => row.unitNo || "NAv",
      },
      {
        header: "Occupancy",
        value: (row) => row.occupancyStatus || "NAv",
      },
      {
        header: "Electricity",
        value: (row) => row.electricityMeterCount || 0,
      },
      {
        header: "Water",
        value: (row) => row.waterMeterCount || 0,
      },
      {
        header: "Total Meters",
        value: (row) => row.meterCount || 0,
      },
      {
        header: "updatedAt",
        value: (row) => formatUpdatedAt(row.updatedAt),
      },
      {
        header: "QA Status",
        value: (row) => getPremiseQaLabel(row),
      },
      {
        header: "QA Reviewer",
        value: (row) => row.qa?.reviewedByUser || "NAv",
      },
      {
        header: "QA At",
        value: (row) => qaDate(row.qa?.reviewedAt),
      },
    ],
    [],
  );

  const quickDownloadScope = useMemo(
    () => ({
      lmName: activeWorkbaseName,
      lmPcode: activeLmPcode || "NAv",
      wardLabel: getWardLabel(selectedWard),
      wardPcode: effectiveSelectedWardPcode || "NAv",
    }),
    [activeWorkbaseName, activeLmPcode, selectedWard, effectiveSelectedWardPcode],
  );

  function resetTableControls() {
    setFilters(EMPTY_PREMISE_FILTERS);
  }

  function handleWardChange(event) {
    const nextWardPcode = event.target.value;
    const nextWard = wardRows.find((ward) => ward.wardPcode === nextWardPcode) || null;

    resetTableControls();

    updateGeo({
      selectedWard: buildRegistryWardSelection(nextWard, nextWardPcode),
      lastSelectionType: nextWardPcode ? "WARD" : null,
    });
  }

  const registryColumns = [
    {
      key: "addressText",
      label: "Premise Address",
      filter: "text",
      sortable: true,
      value: row => getSortValue(row, "addressText"),
      sortValue: row => getSortValue(row, "addressText"),
      render: row => {
        return (
          <>
            <strong>{row.addressText || "NAv"}</strong>
            <div className="muted" style={styles.smallMuted}>
              {row.premiseId || row.id || "NAv"}
            </div>
          </>
        );
      },
    },
    {
      key: "erfNo",
      label: "ERF No",
      filter: "text",
      sortable: true,
      value: row => getSortValue(row, "erfNo"),
      sortValue: row => getSortValue(row, "erfNo"),
      render: row => {
        return <>{row.erfNo}</>;
      },
    },
    {
      key: "propertyTypeType",
      label: "Property Type",
      filter: "text",
      sortable: true,
      value: row => getSortValue(row, "propertyTypeType"),
      sortValue: row => getSortValue(row, "propertyTypeType"),
      render: row => {
        return <>{row.propertyTypeType}</>;
      },
    },
    {
      key: "propertyTypeName",
      label: "Name",
      filter: "text",
      sortable: true,
      value: row => getSortValue(row, "propertyTypeName"),
      sortValue: row => getSortValue(row, "propertyTypeName"),
      render: row => {
        return <>{row.propertyTypeName}</>;
      },
    },
    {
      key: "unitNo",
      label: "Unit",
      filter: "text",
      sortable: true,
      value: row => getSortValue(row, "unitNo"),
      sortValue: row => getSortValue(row, "unitNo"),
      render: row => {
        return <>{row.unitNo}</>;
      },
    },
    {
      key: "occupancyStatus",
      label: "Occupancy",
      filter: "select",
      sortable: true,
      value: row => getSortValue(row, "occupancyStatus"),
      sortValue: row => getSortValue(row, "occupancyStatus"),
      render: row => {
        return <>{row.occupancyStatus}</>;
      },
      filterAllValue: "ALL",
      filterOptions: [
        { value: "ACCESSED", label: "Accessed" },
        { value: "OCCUPIED", label: "Occupied" },
        { value: "VACANT", label: "Vacant" },
        { value: "NAV", label: "NAv" },
      ],
    },
    {
      key: "electricityMeterCount",
      label: "Electricity",
      filter: "text",
      sortable: true,
      value: row => getSortValue(row, "electricityMeterCount"),
      sortValue: row => getSortValue(row, "electricityMeterCount"),
      render: row => {
        return <>{formatNumber(row.electricityMeterCount)}</>;
      },
    },
    {
      key: "waterMeterCount",
      label: "Water",
      filter: "text",
      sortable: true,
      value: row => getSortValue(row, "waterMeterCount"),
      sortValue: row => getSortValue(row, "waterMeterCount"),
      render: row => {
        return <>{formatNumber(row.waterMeterCount)}</>;
      },
    },
    {
      key: "meterCount",
      label: "Total Meters",
      filter: "text",
      sortable: true,
      value: row => getSortValue(row, "meterCount"),
      sortValue: row => getSortValue(row, "meterCount"),
      render: row => {
        return <>{formatNumber(row.meterCount)}</>;
      },
    },
    {
      key: "updatedAt",
      label: "updatedAt",
      filter: "date",
      sortable: true,
      value: row => getSortValue(row, "updatedAt"),
      sortValue: row => getSortValue(row, "updatedAt"),
      render: row => {
        return <>{formatUpdatedAt(row.updatedAt)}</>;
      },
    },
    {
      key: "qaStatus",
      label: "QA Status",
      filter: "select",
      filterAllValue: "ALL",
      sortable: true,
      filterOptions: [
        { value: "ALL", label: "ALL" },
        { value: "QA PENDING", label: "Awaiting QA review" },
        { value: "QA PASS", label: "QA PASS" },
        { value: "QA FAIL", label: "QA FAIL" },
        { value: "QA NAv", label: "QA NAv" },
      ],
      value: row => getPremiseQaStatus(row),
      sortValue: row => getPremiseQaStatus(row),
      render: row => {
        const status = getPremiseQaStatus(row);
        const isPending = status === "QA PENDING";
        const submitterUid = row.metadata?.createdByUid || row.qa?.lastSubmittedByUid;
        const isSelf = submitterUid && submitterUid === uid;
        const mayReview = (reviewerRole || qaPreviewMode) && isPending && !isSelf;

        return (
          <div className="qa-status-cell">
            <div className="qa-cell">
              <strong>{getPremiseQaLabel(row)}</strong>
              {mayReview && (
                <select
                  aria-label={`QA decision for premise ${row.premiseId || row.id}`}
                  value=""
                  onChange={event => {
                    if (event.target.value) {
                      setSelectedQa({ premise: row, action: event.target.value });
                    }
                  }}
                >
                  <option value="">Choose QA…</option>
                  <option value="PASS">QA Pass</option>
                  <option value="FAIL">QA Fail</option>
                </select>
              )}
            </div>
            {isPending && row.qa?.resubmissionCount > 0 && row.qa?.lastSubmittedByUser ? (
              <small>
                Corrected by {row.qa.lastSubmittedByUser}
                <br />
                {qaDate(row.qa.lastSubmittedAt)}
              </small>
            ) : row.qa?.reviewedByUser ? (
              <small>
                {row.qa.reviewedByUser}
                <br />
                {qaDate(row.qa.reviewedAt)}
              </small>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "qaHistory",
      label: "QA History",
      sortable: false,
      render: row => {
        const status = getPremiseQaStatus(row);
        return status !== "QA NAv" ? (
          <DataActionButton
            compact
            haspopup="dialog"
            title="QA Review / History"
            onClick={() => setSelectedQa({ premise: row, action: "" })}
          >
            QA Review / History
          </DataActionButton>
        ) : null;
      },
    },
  ];

  return (
    <>
      <header className="console-header" style={styles.fixedRegistryHeader}>
        <div>
          <h1>Premise Registry</h1>

          <p className="muted">
            Premises, service connections and quality assurance for this workbase.
          </p>

          <Link className="text-link" to="/registries">
            ← Back to Registries
          </Link>
        </div>

        <div className="topbar-right">
          <div className="workbase-pill">{activeWorkbaseName}</div>
          <div className="role-pill">{role || "NAv"}</div>
          <div className="role-pill">
            {isFetching ? "Streaming..." : `${formatNumber(filteredPremiseRows.length)} premises`}
          </div>
        </div>
      </header>

      {qaPreviewMode && (
        <section className="qa-preview-banner" role="status">
          <div>
            <strong>QA Preview Mode Active:</strong> Displaying isolated sample premises to safely demonstrate{" "}
            <code>QA NAv</code>, <code>QA PENDING</code>, <code>QA PASS</code> and <code>QA FAIL</code>. Live documents are untouched.
          </div>
          <button
            type="button"
            onClick={() => setQaPreviewMode(false)}
            style={{
              padding: "4px 8px",
              fontSize: "12px",
              cursor: "pointer",
              borderRadius: "4px",
              border: "1px solid #d97706",
              background: "#fff",
              color: "#92400e",
            }}
          >
            Exit Preview
          </button>
        </section>
      )}

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
                Ward {ward.wardNumber} · {formatNumber(ward.premiseCount)} premises
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          role="switch"
          aria-label="Toggle QA Preview Samples"
          aria-checked={qaPreviewMode}
          title={qaPreviewMode ? "Hide QA Preview Samples" : "Show QA Preview Samples"}
          onClick={() => setQaPreviewMode(current => !current)}
          style={{
            ...styles.columnVisibilityToggle,
            background: qaPreviewMode ? "#eff6ff" : "#f8fafc",
            borderColor: qaPreviewMode ? "#bfdbfe" : "#e2e8f0",
            color: qaPreviewMode ? "#1d4ed8" : "#475569",
          }}
        >
          <span>QA Preview</span>
          <span
            aria-hidden="true"
            style={{
              ...styles.visibilityTrack,
              background: qaPreviewMode ? "#2563eb" : "#94a3b8",
            }}
          >
            <span
              style={{
                ...styles.visibilityThumb,
                transform: qaPreviewMode ? "translateX(12px)" : "translateX(0)",
              }}
            />
          </span>
        </button>

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
          <span>Filtered Rows</span>
          <strong>{formatNumber(filteredPremiseRows.length)}</strong>
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
      </section>

      <section className="table-panel">
        {!effectiveSelectedWardPcode && !qaPreviewMode ? (
          <div className="empty-state">
            <h2>Select a ward</h2>
            <p className="muted">
              Premise Registry is ward-scoped for clean operational browsing. Or toggle QA Preview above to inspect sample QA states.
            </p>
          </div>
        ) : null}

        {error && !qaPreviewMode ? (
          <div className="empty-state error-box">
            <h2>Could not load premise registry</h2>
            <p className="muted">
              Check Firestore rules, registry_premises, or the ward field used by the query.
            </p>
          </div>
        ) : null}

        {isLoading && !qaPreviewMode ? (
          <div className="empty-state">
            <h2>Loading premise registry...</h2>
            <p className="muted">Opening Firestore stream.</p>
          </div>
        ) : null}

        {!isLoading && effectiveSelectedWardPcode && premiseRows.length === 0 && !error ? (
          <div className="empty-state">
            <h2>No premise registry rows found</h2>
            <p className="muted">
              No premises were returned for ward {effectiveSelectedWardPcode}.
            </p>
          </div>
        ) : null}

        {premiseRows.length > 0 ? (
          <div className="table-wrap">
            <IrepsTable
              key={`${activeLmPcode}:${effectiveSelectedWardPcode}:${qaPreviewMode}`}
              title="Premises Registry"
              rows={premiseRows}
              columns={registryColumns}
              rowKey={row => row.id}
              filters={filters}
              onFiltersChange={setFilters}
              filteredRows={filteredPremiseRows}
              filterRows={filterRegistryRows}
              defaultSort={DEFAULT_SORT}
              downloads={{
                registryName: "Premise Registry",
                rowsLabel: "premises",
                columns: quickDownloadColumns,
                fileBaseName: "premises_registry",
                scope: quickDownloadScope,
              }}
            />
          </div>
        ) : null}
      </section>

      {selectedQa && (
        <PremiseQaModal
          key={selectedQa.premise?.id || selectedQa.premise?.premiseId}
          premise={selectedQa.premise}
          initialAction={selectedQa.action}
          reviewerRole={reviewerRole || qaPreviewMode}
          onSaved={({ premiseId, qa }) => {
            setLocalQaOverrides(prev => ({
              ...prev,
              [premiseId]: qa,
            }));
          }}
          onClose={() => setSelectedQa(null)}
        />
      )}
    </>
  );
}

const styles = {
  fixedRegistryHeader: {
    position: "sticky",
    top: 0,
    zIndex: 30,
    background: "#f8fafc",
    paddingTop: "0.35rem",
    paddingBottom: "0.85rem",
    boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
  },

  smallMuted: {
    fontSize: "0.72rem",
    marginTop: "0.25rem",
  },

  columnVisibilityToggle: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    alignSelf: "end",
    flex: "0 0 auto",
    width: "auto",
    minHeight: "34px",
    padding: "6px 10px 6px 12px",
    border: "1px solid",
    borderRadius: "999px",
    fontFamily: "inherit",
    fontSize: "12px",
    fontWeight: 700,
    whiteSpace: "nowrap",
    cursor: "pointer",
  },
  visibilityTrack: {
    display: "inline-flex",
    alignItems: "center",
    width: "30px",
    height: "18px",
    padding: "3px",
    boxSizing: "border-box",
    borderRadius: "999px",
  },
  visibilityThumb: {
    width: "12px",
    height: "12px",
    borderRadius: "50%",
    background: "#ffffff",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.18)",
  },
};
