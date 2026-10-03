/* eslint-disable no-unused-vars -- JSX tags are consumed by React; this ESLint profile does not track them. */
import { irepsTableDateRange as getUpdatedAtFilterRange } from "../../components/table/irepsTableModel.js";
import IrepsTable from "../../components/table/IrepsTable";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "../../context/GeoContext";
import { useGetRegistryErfsPageByWardQuery,
  useLazyGetRegistryErfsPageByWardQuery,
  useLazySearchRegistryErfsByLmQuery,
} from "../../redux/registryErfsApi";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";
const ERF_PAGE_SIZE = 200;
const ERF_SEARCH_LIMIT = 50;

const EMPTY_ROWS = [];

const EMPTY_ERF_BROWSE_FILTERS = {
  erfNo: "",
  erfType: "ALL",
  premiseCount: "",
  electricityMeterCount: "",
  waterMeterCount: "",
  meterCount: "",
  trnsAccessCount: "",
  trnsNaCount: "",
  trnsTotalCount: "",
};

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
  if (key === "erfType") return row.erfType || "";
  if (key === "premiseCount") return row.premiseCount || 0;
  if (key === "electricityMeterCount") return row.electricityMeterCount || 0;
  if (key === "waterMeterCount") return row.waterMeterCount || 0;
  if (key === "meterCount") return row.meterCount || 0;
  if (key === "trnsAccessCount") return row.trnsAccessCount || 0;
  if (key === "trnsNaCount") return row.trnsNaCount || 0;
  if (key === "trnsTotalCount") return row.trnsTotalCount || 0;
  if (key === "updatedAt") return getUpdatedAtMs(row.updatedAt);

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

export default function ErfsRegistryPage() {
  const { activeWorkbase, role } = useAuth();
  const { geoState, updateGeo } = useGeo();

  const selectedWardPcode = getSelectedWardPcodeFromGeo(geoState);
  const [browseFilters, setBrowseFilters] = useState(EMPTY_ERF_BROWSE_FILTERS);
  const updatedAtFilter = browseFilters.updatedAt || EMPTY_UPDATED_AT_FILTER;

  const [extraBrowseRows, setExtraBrowseRows] = useState([]);
  const [extraBrowseWardPcode, setExtraBrowseWardPcode] = useState("");
  const [nextCursorId, setNextCursorId] = useState(null);
  const [hasMoreOverride, setHasMoreOverride] = useState(null);
  const [browseError, setBrowseError] = useState("");

  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchType, setSearchType] = useState("");
  const [searchRows, setSearchRows] = useState([]);
  const [searchError, setSearchError] = useState("");
  const [lastSearchLabel, setLastSearchLabel] = useState("");
  const [wasSearchLimited, setWasSearchLimited] = useState(false);

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

  const firstPageQueryArg = effectiveSelectedWardPcode
    ? { wardPcode: effectiveSelectedWardPcode, cursorId: null, pageSize: ERF_PAGE_SIZE }
    : skipToken;

  const {
    data: firstPageData,
    isFetching: isFirstPageFetching,
    error: firstPageError,
  } = useGetRegistryErfsPageByWardQuery(firstPageQueryArg);

  const [loadErfsPage, { isFetching: isLoadMoreFetching }] =
    useLazyGetRegistryErfsPageByWardQuery();

  const [searchErfsByLm, { isFetching: isSearchFetching }] =
    useLazySearchRegistryErfsByLmQuery();

  const wardLookup = useMemo(() => {
    const lookup = new Map();
    wardRows.forEach((ward) => lookup.set(ward.wardPcode, ward));
    return lookup;
  }, [wardRows]);

  const firstPageRows = firstPageData?.rows || EMPTY_ROWS;
  const activeExtraBrowseRows = useMemo(() => {
    return extraBrowseWardPcode === effectiveSelectedWardPcode
      ? extraBrowseRows
      : EMPTY_ROWS;
  }, [effectiveSelectedWardPcode, extraBrowseRows, extraBrowseWardPcode]);

  const browseRows = useMemo(() => {
    return [...firstPageRows, ...activeExtraBrowseRows];
  }, [firstPageRows, activeExtraBrowseRows]);

  const filterRegistryRows = useCallback((rows, tableFilters) => {
    const browseFilters = {
      ...EMPTY_ERF_BROWSE_FILTERS,
      ...tableFilters
    };
    for (const key of Object.keys(EMPTY_ERF_BROWSE_FILTERS)) {
      if (EMPTY_ERF_BROWSE_FILTERS[key] === "ALL" && !browseFilters[key]) browseFilters[key] = "ALL";
    }
    const updatedAtFilter = tableFilters.updatedAt || EMPTY_UPDATED_AT_FILTER;
    return rows.filter(row => {
      const erfType = String(row.erfType || "NAv").toUpperCase();
      return includesText(row.erfNo, browseFilters.erfNo) && (browseFilters.erfType === "ALL" || erfType === browseFilters.erfType) && includesText(getCountText(row.premiseCount), browseFilters.premiseCount) && includesText(getCountText(row.electricityMeterCount), browseFilters.electricityMeterCount) && includesText(getCountText(row.waterMeterCount), browseFilters.waterMeterCount) && includesText(getCountText(row.meterCount), browseFilters.meterCount) && includesText(getCountText(row.trnsAccessCount), browseFilters.trnsAccessCount) && includesText(getCountText(row.trnsNaCount), browseFilters.trnsNaCount) && includesText(getCountText(row.trnsTotalCount), browseFilters.trnsTotalCount) && matchesUpdatedAtFilter(row.updatedAt, updatedAtFilter);
    });
  }, []);

  const filteredBrowseRows = useMemo(() => filterRegistryRows(browseRows, browseFilters), [browseRows, browseFilters, filterRegistryRows]);

  const hasActiveBrowseFilters = Object.values(browseFilters).some((value) => value && value !== "ALL") || updatedAtFilter.mode !== "ALL";

  const activeNextCursorId =
    extraBrowseWardPcode === effectiveSelectedWardPcode && nextCursorId
      ? nextCursorId
      : firstPageData?.nextCursorId || null;

  const activeHasMore =
    extraBrowseWardPcode === effectiveSelectedWardPcode && hasMoreOverride !== null
      ? hasMoreOverride
      : Boolean(firstPageData?.hasMore);

  const isBrowseFetching = isFirstPageFetching || isLoadMoreFetching;

  function resetBrowseControls(nextWardPcode) {
    setBrowseFilters(EMPTY_ERF_BROWSE_FILTERS);

    setExtraBrowseRows([]);
    setExtraBrowseWardPcode(nextWardPcode || "");
    setNextCursorId(null);
    setHasMoreOverride(null);
    setBrowseError("");
  }

  function handleBrowseWardChange(event) {
    const nextWardPcode = event.target.value;
    const nextWard = wardRows.find((ward) => ward.wardPcode === nextWardPcode) || null;

    resetBrowseControls(nextWardPcode);

    updateGeo({
      selectedWard: buildRegistryWardSelection(nextWard, nextWardPcode),
      lastSelectionType: nextWardPcode ? "WARD" : null,
    });
  }

  async function handleLoadMore() {
    if (!effectiveSelectedWardPcode || !activeHasMore || isBrowseFetching) return;

    try {
      const result = await loadErfsPage({
        wardPcode: effectiveSelectedWardPcode,
        cursorId: activeNextCursorId,
        pageSize: ERF_PAGE_SIZE,
      }).unwrap();

      setExtraBrowseRows((currentRows) => {
        const existingIds = new Set([
          ...firstPageRows.map((row) => row.id),
          ...currentRows.map((row) => row.id),
        ]);

        const newRows = (result.rows || []).filter((row) => !existingIds.has(row.id));
        return [...currentRows, ...newRows];
      });

      setExtraBrowseWardPcode(effectiveSelectedWardPcode);
      setNextCursorId(result.nextCursorId || null);
      setHasMoreOverride(Boolean(result.hasMore));
      setBrowseError("");
    } catch (error) {
      console.error("Failed to load more ERF rows:", error);
      setBrowseError("Failed to load more ERF registry rows.");
    }
  }

  async function handleSearchSubmit(event) {
    event.preventDefault();

    const cleanedSearchText = searchText.trim();

    setSearchError("");
    setSearchRows([]);
    setLastSearchLabel("");
    setWasSearchLimited(false);

    if (!activeLmPcode) {
      setSearchError("No active LM found on your profile.");
      return;
    }

    if (!cleanedSearchText) {
      setSearchError("Please enter an ERF number.");
      return;
    }

    try {
      const result = await searchErfsByLm({
        lmPcode: activeLmPcode,
        searchText: cleanedSearchText,
        erfType: searchType,
        resultLimit: ERF_SEARCH_LIMIT,
      }).unwrap();

      setSearchRows(result.rows || []);
      setWasSearchLimited(Boolean(result.wasLimited));
      setLastSearchLabel(`ERF starts with "${cleanedSearchText}"`);
    } catch (error) {
      console.error("ERF search failed:", error);
      setSearchError("ERF search failed. Check console and Firestore indexes.");
    }
  }

  function handleOpenSearchModal() {
    setIsSearchModalOpen(true);
    setSearchError("");
  }

  function handleCloseSearchModal() {
    setIsSearchModalOpen(false);
  }

  function handleClearSearch() {
    setSearchText("");
    setSearchType("");
    setSearchRows([]);
    setSearchError("");
    setLastSearchLabel("");
    setWasSearchLimited(false);
  }

  function getWardDisplay(wardPcode) {
    const ward = wardLookup.get(wardPcode);

    if (ward?.wardNumber) return `Ward ${ward.wardNumber}`;
    return wardPcode || "NAv";
  }

  const browseTotals = filteredBrowseRows.reduce(
    (accumulator, row) => {
      accumulator.premises += row.premiseCount;
      accumulator.electricityMeters += row.electricityMeterCount;
      accumulator.waterMeters += row.waterMeterCount;
      accumulator.meters += row.meterCount;
      accumulator.trnsAccess += row.trnsAccessCount;
      accumulator.trnsNa += row.trnsNaCount;
      accumulator.trnsTotal += row.trnsTotalCount;
      return accumulator;
    },
    { premises: 0, electricityMeters: 0, waterMeters: 0, meters: 0, trnsAccess: 0, trnsNa: 0, trnsTotal: 0 },
  );

  const quickDownloadColumns = useMemo(
    () => [
      {
        header: "ERF No",
        value: (row) => row.erfNo || "NAv",
      },
      {
        header: "Type",
        value: (row) => row.erfType || "NAv",
      },
      {
        header: "Premises",
        value: (row) => row.premiseCount || 0,
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
        header: "Access TRNs",
        value: (row) => row.trnsAccessCount || 0,
      },
      {
        header: "No Access",
        value: (row) => row.trnsNaCount || 0,
      },
      {
        header: "Total TRNs",
        value: (row) => row.trnsTotalCount || 0,
      },
      {
        header: "updatedAt",
        value: (row) => formatUpdatedAt(row.updatedAt),
      },
    ],
    [],
  );

  const quickDownloadScope = useMemo(
    () => ({
      label: `${activeWorkbaseName} / ${getWardLabel(selectedWard)} / loaded rows only`,
      lmName: activeWorkbaseName,
      lmPcode: activeLmPcode || "NAv",
      wardLabel: getWardLabel(selectedWard),
      wardPcode: effectiveSelectedWardPcode || "NAv",
    }),
    [activeWorkbaseName, activeLmPcode, selectedWard, effectiveSelectedWardPcode],
  );

  const selectedWardTotalErfs = selectedWard?.totalErfCount || 0;
  const hasBrowseError = Boolean(browseError || firstPageError);

  const registryColumns = [{
    key: "erfNo",
    label: "ERF No",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "erfNo"),
    sortValue: row => getSortValue(row, "erfNo"),
    render: row => {
      return <>{row.erfNo}</>;
    }
  }, {
    key: "erfType",
    label: "Type",
    filter: "select",
    sortable: true,
    value: row => getSortValue(row, "erfType"),
    sortValue: row => getSortValue(row, "erfType"),
    render: row => {
      return <>{row.erfType}</>;
    },
    filterAllValue: "ALL",
    filterOptions: [{
      value: "FORMAL",
      label: "Formal"
    }, {
      value: "INFORMAL",
      label: "Informal"
    }, {
      value: "NAV",
      label: "NAv"
    }]
  }, {
    key: "premiseCount",
    label: "Premises",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "premiseCount"),
    sortValue: row => getSortValue(row, "premiseCount"),
    render: row => {
      return <>{formatNumber(row.premiseCount)}</>;
    }
  }, {
    key: "electricityMeterCount",
    label: "Electricity",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "electricityMeterCount"),
    sortValue: row => getSortValue(row, "electricityMeterCount"),
    render: row => {
      return <>{formatNumber(row.electricityMeterCount)}</>;
    }
  }, {
    key: "waterMeterCount",
    label: "Water",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "waterMeterCount"),
    sortValue: row => getSortValue(row, "waterMeterCount"),
    render: row => {
      return <>{formatNumber(row.waterMeterCount)}</>;
    }
  }, {
    key: "meterCount",
    label: "Total Meters",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "meterCount"),
    sortValue: row => getSortValue(row, "meterCount"),
    render: row => {
      return <>{formatNumber(row.meterCount)}</>;
    }
  }, {
    key: "trnsAccessCount",
    label: "Access TRNs",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "trnsAccessCount"),
    sortValue: row => getSortValue(row, "trnsAccessCount"),
    render: row => {
      return <>{formatNumber(row.trnsAccessCount)}</>;
    }
  }, {
    key: "trnsNaCount",
    label: "No Access",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "trnsNaCount"),
    sortValue: row => getSortValue(row, "trnsNaCount"),
    render: row => {
      return <>{formatNumber(row.trnsNaCount)}</>;
    }
  }, {
    key: "trnsTotalCount",
    label: "Total TRNs",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "trnsTotalCount"),
    sortValue: row => getSortValue(row, "trnsTotalCount"),
    render: row => {
      return <>{formatNumber(row.trnsTotalCount)}</>;
    }
  }, {
    key: "updatedAt",
    label: "updatedAt",
    filter: "date",
    sortable: true,
    value: row => getSortValue(row, "updatedAt"),
    sortValue: row => getSortValue(row, "updatedAt"),
    render: row => {
      return <>{formatUpdatedAt(row.updatedAt)}</>;
    }
  }];

  return (
    <>
      <header className="console-header" style={styles.fixedRegistryHeader}>
        <div>
          <h1>ERF Registry</h1>

          <p className="muted">Browse ERFs by ward, or find a specific ERF across the active LM.</p>

          <Link className="text-link" to="/registries">
            ← Back to Registries
          </Link>
        </div>

        <div className="topbar-right">
          <button className="primary-button" type="button" onClick={handleOpenSearchModal}>
            Find ERF
          </button>

          <div className="workbase-pill">{activeWorkbaseName}</div>
          <div className="role-pill">{role || "NAv"}</div>
          <div className="role-pill">
            {isBrowseFetching ? "Loading..." : `${formatNumber(browseRows.length)} loaded`}
          </div>

        </div>
      </header>

      <section className="filter-panel">
        <label>
          Browse Ward
          <select
            value={effectiveSelectedWardPcode}
            onChange={handleBrowseWardChange}
            disabled={wardsLoading || wardRows.length === 0}
          >
            <option value="">Select ward</option>

            {wardRows.map((ward) => (
              <option key={ward.wardPcode} value={ward.wardPcode}>
                Ward {ward.wardNumber} · {formatNumber(ward.totalErfCount)} ERFs
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
          <span>Loaded ERFs</span>
          <strong>{formatNumber(browseRows.length)}</strong>
        </div>

        <div className="stat-card">
          <span>Filtered Rows</span>
          <strong>{formatNumber(filteredBrowseRows.length)}</strong>
        </div>

        <div className="stat-card">
          <span>Ward Total ERFs</span>
          <strong>{formatNumber(selectedWardTotalErfs)}</strong>
        </div>

        <div className="stat-card">
          <span>Premises Loaded</span>
          <strong>{formatNumber(browseTotals.premises)}</strong>
        </div>

        <div className="stat-card">
          <span>Total Meters Loaded</span>
          <strong>{formatNumber(browseTotals.meters)}</strong>
        </div>

        <div className="stat-card">
          <span>Electricity Loaded</span>
          <strong>{formatNumber(browseTotals.electricityMeters)}</strong>
        </div>

        <div className="stat-card">
          <span>Water Loaded</span>
          <strong>{formatNumber(browseTotals.waterMeters)}</strong>
        </div>

        <div className="stat-card">
          <span>No Access TRNs Loaded</span>
          <strong>{formatNumber(browseTotals.trnsNa)}</strong>
        </div>

        <div className="stat-card">
          <span>Total TRNs Loaded</span>
          <strong>{formatNumber(browseTotals.trnsTotal)}</strong>
        </div>
      </section>

      <section className="table-panel">
        {!effectiveSelectedWardPcode ? (
          <div className="empty-state">
            <h2>Select a ward</h2>
            <p className="muted">
              ERF Registry browsing is ward-scoped to avoid loading the full LM.
            </p>
          </div>
        ) : null}

        {hasBrowseError ? (
          <div className="empty-state error-box">
            <h2>Could not load ERF registry</h2>
            <p className="muted">{browseError || "Failed to load ERF registry rows."}</p>
          </div>
        ) : null}

        {isBrowseFetching && browseRows.length === 0 ? (
          <div className="empty-state">
            <h2>Loading ERF registry...</h2>
            <p className="muted">Loading first page.</p>
          </div>
        ) : null}

        {!isBrowseFetching && effectiveSelectedWardPcode && browseRows.length === 0 && !hasBrowseError ? (
          <div className="empty-state">
            <h2>No ERF registry rows found</h2>
            <p className="muted">No rows were returned for ward {effectiveSelectedWardPcode}.</p>
          </div>
        ) : null}

        {browseRows.length > 0 ? (
          <>

            <div className="table-wrap">
              <IrepsTable
                key={`${activeLmPcode}:${effectiveSelectedWardPcode}`}
                title="ERF Registry"
                rows={browseRows}
                columns={registryColumns}
                rowKey={row => row.id}
                filters={browseFilters}
                onFiltersChange={setBrowseFilters}
                filteredRows={filteredBrowseRows}
                filterRows={filterRegistryRows}
                defaultSort={{
                  key: "updatedAt",
                  direction: "desc"
                }}
                downloads={{
                  registryName: "ERF Registry",
                  rowsLabel: "ERFs",
                  columns: quickDownloadColumns,
                  fileBaseName: "erfs_registry",
                  scope: quickDownloadScope
                }}
              />
            </div>

            {activeHasMore || isBrowseFetching ? (
              <div className="load-more-row">
                <div>
                  <strong>
                    {hasActiveBrowseFilters
                      ? `${formatNumber(filteredBrowseRows.length)} filtered from ${formatNumber(browseRows.length)} loaded`
                      : `${formatNumber(browseRows.length)} of ${formatNumber(selectedWardTotalErfs)} ward ERFs loaded`}
                  </strong>
                  <p className="muted">
                    {isBrowseFetching ? "Loading ERFs..." : "More ERFs are available."}
                  </p>
                </div>

                <button
                  className="secondary-button"
                  type="button"
                  onClick={handleLoadMore}
                  disabled={!activeHasMore || isBrowseFetching}
                >
                  {isBrowseFetching ? "Loading..." : "Load More"}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      {isSearchModalOpen ? (
        <div className="modal-backdrop">
          <div className="modal-card wide-modal">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Find ERF</p>
                <h2>Search across {activeWorkbaseName}</h2>
                <p className="muted">
                  This search is active-LM-wide. It is not restricted to the selected browse ward.
                </p>
              </div>

              <button className="icon-button" type="button" onClick={handleCloseSearchModal}>
                ×
              </button>
            </div>

            <form className="modal-search-form" onSubmit={handleSearchSubmit}>
              <label>
                ERF No
                <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Example: 203 or 203/2" />
              </label>

              <label>
                Type
                <select value={searchType} onChange={(event) => setSearchType(event.target.value)}>
                  <option value="">All</option>
                  <option value="FORMAL">Formal</option>
                  <option value="INFORMAL">Informal</option>
                </select>
              </label>

              <div className="filter-actions">
                <button type="submit" disabled={isSearchFetching}>
                  {isSearchFetching ? "Searching..." : "Search"}
                </button>

                <button type="button" className="ghost-button" onClick={handleClearSearch}>
                  Clear
                </button>
              </div>
            </form>

            {searchError ? (
              <div className="empty-state error-box">
                <h2>Search problem</h2>
                <p className="muted">{searchError}</p>
              </div>
            ) : null}

            {wasSearchLimited ? (
              <div className="notice-panel">
                <strong>Many matches found</strong>
                <p className="muted">
                  Showing the first {formatNumber(ERF_SEARCH_LIMIT)} matches. Refine the ERF number if you need fewer results.
                </p>
              </div>
            ) : null}

            {!searchError && !lastSearchLabel && searchRows.length === 0 ? (
              <div className="empty-state">
                <h2>Search for an ERF</h2>
                <p className="muted">Enter an ERF number. The search will check the full active LM.</p>
              </div>
            ) : null}

            {!isSearchFetching && lastSearchLabel && searchRows.length === 0 && !searchError ? (
              <div className="empty-state">
                <h2>No ERFs found</h2>
                <p className="muted">No registry rows matched {lastSearchLabel}.</p>
              </div>
            ) : null}

            {isSearchFetching ? (
              <div className="empty-state">
                <h2>Searching...</h2>
                <p className="muted">Searching ERFs in active LM.</p>
              </div>
            ) : null}

            {searchRows.length > 0 ? (
              <div className="table-wrap modal-table-wrap">
                <IrepsTable
                title="ERF search results"
                rows={searchRows}
                columns={[{
                  key: "erfNo",
                  label: "ERF No",
                  filter: "text",
                  value: row => row.erfNo,
                  render: row => <>{row.erfNo}</>
                }, {
                  key: "wardPcode",
                  label: "Ward",
                  filter: "select",
                  value: row => getWardDisplay(row.wardPcode),
                  render: row => <>{getWardDisplay(row.wardPcode)}</>
                }, {
                  key: "erfType",
                  label: "Type",
                  filter: "select",
                  value: row => row.erfType,
                  render: row => <>{row.erfType}</>
                }, {
                  key: "premiseCount",
                  label: "Premises",
                  filter: "text",
                  value: row => row.premiseCount,
                  render: row => <>{formatNumber(row.premiseCount)}</>
                }, {
                  key: "electricityMeterCount",
                  label: "Electricity",
                  filter: "text",
                  value: row => row.electricityMeterCount,
                  render: row => <>{formatNumber(row.electricityMeterCount)}</>
                }, {
                  key: "waterMeterCount",
                  label: "Water",
                  filter: "text",
                  value: row => row.waterMeterCount,
                  render: row => <>{formatNumber(row.waterMeterCount)}</>
                }, {
                  key: "meterCount",
                  label: "Total Meters",
                  filter: "text",
                  value: row => row.meterCount,
                  render: row => <>{formatNumber(row.meterCount)}</>
                }, {
                  key: "trnsNaCount",
                  label: "No Access",
                  filter: "text",
                  value: row => row.trnsNaCount,
                  render: row => <>{formatNumber(row.trnsNaCount)}</>
                }, {
                  key: "trnsTotalCount",
                  label: "Total TRNs",
                  filter: "text",
                  value: row => row.trnsTotalCount,
                  render: row => <>{formatNumber(row.trnsTotalCount)}</>
                }, {
                  key: "updatedAt",
                  label: "updatedAt",
                  filter: "date",
                  value: row => getUpdatedAtMs(row.updatedAt),
                  render: row => <>{formatUpdatedAt(row.updatedAt)}</>
                }]}
                defaultSort={{
                  key: "erfNo",
                  direction: "asc"
                }}
                downloads={{
                  fileBaseName: "erf_search",
                  scope: {
                    label: "Loaded search matches",
                    lmPcode: activeLmPcode
                  },
                  columns: [{
                    header: "ERF No",
                    value: row => row.erfNo
                  }, {
                    header: "Ward",
                    value: row => getWardDisplay(row.wardPcode)
                  }, {
                    header: "Type",
                    value: row => row.erfType
                  }, {
                    header: "Premises",
                    value: row => row.premiseCount
                  }, {
                    header: "Electricity",
                    value: row => row.electricityMeterCount
                  }, {
                    header: "Water",
                    value: row => row.waterMeterCount
                  }, {
                    header: "Total Meters",
                    value: row => row.meterCount
                  }, {
                    header: "No Access",
                    value: row => row.trnsNaCount
                  }, {
                    header: "Total TRNs",
                    value: row => row.trnsTotalCount
                  }, {
                    header: "updatedAt",
                    value: row => formatUpdatedAt(row.updatedAt)
                  }]
                }}
              />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

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

};
