import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import {
  useGetRegistryErfsPageByWardQuery,
  useLazyGetRegistryErfsPageByWardQuery,
  useLazySearchRegistryErfsByLmQuery,
} from "../../redux/registryErfsApi";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";

const ERF_PAGE_SIZE = 200;
const ERF_SEARCH_LIMIT = 50;

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

function getUpdatedAtMs(value) {
  if (!value || value === "NAv") return 0;

  if (typeof value?.toDate === "function") {
    const ms = value.toDate().getTime();
    return Number.isFinite(ms) ? ms : 0;
  }

  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function sortErfRows(a, b) {
  const updatedCompare = getUpdatedAtMs(b.updatedAt) - getUpdatedAtMs(a.updatedAt);

  if (updatedCompare !== 0) return updatedCompare;

  return String(a.erfNo).localeCompare(String(b.erfNo), undefined, {
    numeric: true,
    sensitivity: "base",
  });
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

function FilterInput({ value, onChange, placeholder }) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      style={styles.headerInput}
    />
  );
}

function FilterSelect({ value, onChange, children }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={styles.headerSelect}
    >
      {children}
    </select>
  );
}

export default function ErfsRegistryPage() {
  const { activeWorkbase } = useAuth();

  const [selectedWardPcode, setSelectedWardPcode] = useState("");
  const [browseFilters, setBrowseFilters] = useState({
    erfNo: "",
    erfType: "ALL",
    premiseCount: "",
    electricityMeterCount: "",
    waterMeterCount: "",
    meterCount: "",
    trnsAccessCount: "",
    trnsNaCount: "",
    trnsTotalCount: "",
    updatedAt: "",
  });

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

  const defaultWard = useMemo(() => {
    return (
      wardRows.find((ward) => ward.totalErfCount > 0) || wardRows[0] || null
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

  const firstPageQueryArg = effectiveSelectedWardPcode
    ? {
        wardPcode: effectiveSelectedWardPcode,
        cursorId: null,
        pageSize: ERF_PAGE_SIZE,
      }
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

    wardRows.forEach((ward) => {
      lookup.set(ward.wardPcode, ward);
    });

    return lookup;
  }, [wardRows]);

  const firstPageRows = firstPageData?.rows || [];

  const activeExtraBrowseRows =
    extraBrowseWardPcode === effectiveSelectedWardPcode ? extraBrowseRows : [];

  const sortedBrowseRows = useMemo(() => {
    return [...firstPageRows, ...activeExtraBrowseRows].sort(sortErfRows);
  }, [firstPageRows, activeExtraBrowseRows]);

  const filteredBrowseRows = useMemo(() => {
    return sortedBrowseRows.filter((row) => {
      return (
        includesText(row.erfNo, browseFilters.erfNo) &&
        (browseFilters.erfType === "ALL" ||
          String(row.erfType || "NAv").toUpperCase() ===
            browseFilters.erfType) &&
        includesText(getCountText(row.premiseCount), browseFilters.premiseCount) &&
        includesText(
          getCountText(row.electricityMeterCount),
          browseFilters.electricityMeterCount,
        ) &&
        includesText(getCountText(row.waterMeterCount), browseFilters.waterMeterCount) &&
        includesText(getCountText(row.meterCount), browseFilters.meterCount) &&
        includesText(getCountText(row.trnsAccessCount), browseFilters.trnsAccessCount) &&
        includesText(getCountText(row.trnsNaCount), browseFilters.trnsNaCount) &&
        includesText(getCountText(row.trnsTotalCount), browseFilters.trnsTotalCount) &&
        includesText(formatUpdatedAt(row.updatedAt), browseFilters.updatedAt)
      );
    });
  }, [sortedBrowseRows, browseFilters]);

  const hasActiveBrowseFilters = Object.values(browseFilters).some((value) => {
    return value && value !== "ALL";
  });

  const activeNextCursorId =
    extraBrowseWardPcode === effectiveSelectedWardPcode && nextCursorId
      ? nextCursorId
      : firstPageData?.nextCursorId || null;

  const activeHasMore =
    extraBrowseWardPcode === effectiveSelectedWardPcode &&
    hasMoreOverride !== null
      ? hasMoreOverride
      : Boolean(firstPageData?.hasMore);

  const isBrowseFetching = isFirstPageFetching || isLoadMoreFetching;

  function handleBrowseWardChange(event) {
    const nextWardPcode = event.target.value;

    setSelectedWardPcode(nextWardPcode);
    setBrowseFilters({
      erfNo: "",
      erfType: "ALL",
      premiseCount: "",
      electricityMeterCount: "",
      waterMeterCount: "",
      meterCount: "",
      trnsAccessCount: "",
      trnsNaCount: "",
      trnsTotalCount: "",
      updatedAt: "",
    });
    setExtraBrowseRows([]);
    setExtraBrowseWardPcode(nextWardPcode);
    setNextCursorId(null);
    setHasMoreOverride(null);
    setBrowseError("");
  }

  function updateBrowseFilter(key, value) {
    setBrowseFilters((currentFilters) => ({
      ...currentFilters,
      [key]: value,
    }));
  }

  async function handleLoadMore() {
    if (!effectiveSelectedWardPcode || !activeHasMore || isBrowseFetching) {
      return;
    }

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

        const newRows = (result.rows || []).filter(
          (row) => !existingIds.has(row.id),
        );

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

    if (ward?.wardNumber) {
      return `Ward ${ward.wardNumber}`;
    }

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
    {
      premises: 0,
      electricityMeters: 0,
      waterMeters: 0,
      meters: 0,
      trnsAccess: 0,
      trnsNa: 0,
      trnsTotal: 0,
    },
  );

  const selectedWardTotalErfs = selectedWard?.totalErfCount || 0;
  const hasBrowseError = Boolean(browseError || firstPageError);

  return (
    <>
      <header className="console-header">
        <div>
          <p className="eyebrow">Registry</p>
          <h1>ERF Registry</h1>

          <p className="muted">
            Browse ERFs by ward, or find a specific ERF across{" "}
            {activeWorkbaseName}.
          </p>

          <Link className="text-link" to="/registries">
            ← Back to Registries
          </Link>
        </div>

        <div className="topbar-right">
          <button
            className="primary-button"
            type="button"
            onClick={handleOpenSearchModal}
          >
            Find ERF
          </button>

          <div className="role-pill">
            {isBrowseFetching
              ? "Loading..."
              : `${formatNumber(sortedBrowseRows.length)} loaded`}
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
                Ward {ward.wardNumber}
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
          <strong>{formatNumber(sortedBrowseRows.length)}</strong>
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

      <section className="notice-panel">
        <strong>Browse and search are separate</strong>
        <p className="muted">
          Browsing is ward-scoped and lazy-loaded. Find ERF searches across the
          full active LM, even if the ERF is not loaded in the current table.
        </p>
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
            <p className="muted">
              {browseError || "Failed to load ERF registry rows."}
            </p>
          </div>
        ) : null}

        {isBrowseFetching && sortedBrowseRows.length === 0 ? (
          <div className="empty-state">
            <h2>Loading ERF registry...</h2>
            <p className="muted">Loading first page.</p>
          </div>
        ) : null}

        {!isBrowseFetching &&
        effectiveSelectedWardPcode &&
        sortedBrowseRows.length === 0 &&
        !hasBrowseError ? (
          <div className="empty-state">
            <h2>No ERF registry rows found</h2>
            <p className="muted">
              No rows were returned for ward {effectiveSelectedWardPcode}.
            </p>
          </div>
        ) : null}

        {sortedBrowseRows.length > 0 && filteredBrowseRows.length === 0 ? (
          <div className="empty-state">
            <h2>No ERFs match the current filters</h2>
            <p className="muted">
              Clear or adjust the column filters to see more rows.
            </p>
          </div>
        ) : null}

        {filteredBrowseRows.length > 0 ? (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>
                      <div>ERF No</div>
                      <FilterInput
                        value={browseFilters.erfNo}
                        onChange={(value) => updateBrowseFilter("erfNo", value)}
                        placeholder="Filter ERF"
                      />
                    </th>

                    <th>
                      <div>Type</div>
                      <FilterSelect
                        value={browseFilters.erfType}
                        onChange={(value) => updateBrowseFilter("erfType", value)}
                      >
                        <option value="ALL">All</option>
                        <option value="FORMAL">Formal</option>
                        <option value="INFORMAL">Informal</option>
                        <option value="NAV">NAv</option>
                      </FilterSelect>
                    </th>

                    <th>
                      <div>Premises</div>
                      <FilterInput
                        value={browseFilters.premiseCount}
                        onChange={(value) => updateBrowseFilter("premiseCount", value)}
                        placeholder="Filter"
                      />
                    </th>

                    <th>
                      <div>Electricity</div>
                      <FilterInput
                        value={browseFilters.electricityMeterCount}
                        onChange={(value) =>
                          updateBrowseFilter("electricityMeterCount", value)
                        }
                        placeholder="Filter"
                      />
                    </th>

                    <th>
                      <div>Water</div>
                      <FilterInput
                        value={browseFilters.waterMeterCount}
                        onChange={(value) => updateBrowseFilter("waterMeterCount", value)}
                        placeholder="Filter"
                      />
                    </th>

                    <th>
                      <div>Total Meters</div>
                      <FilterInput
                        value={browseFilters.meterCount}
                        onChange={(value) => updateBrowseFilter("meterCount", value)}
                        placeholder="Filter"
                      />
                    </th>

                    <th>
                      <div>Access TRNs</div>
                      <FilterInput
                        value={browseFilters.trnsAccessCount}
                        onChange={(value) => updateBrowseFilter("trnsAccessCount", value)}
                        placeholder="Filter"
                      />
                    </th>

                    <th>
                      <div>No Access</div>
                      <FilterInput
                        value={browseFilters.trnsNaCount}
                        onChange={(value) => updateBrowseFilter("trnsNaCount", value)}
                        placeholder="Filter"
                      />
                    </th>

                    <th>
                      <div>Total TRNs</div>
                      <FilterInput
                        value={browseFilters.trnsTotalCount}
                        onChange={(value) => updateBrowseFilter("trnsTotalCount", value)}
                        placeholder="Filter"
                      />
                    </th>

                    <th>
                      <div>Updated</div>
                      <FilterInput
                        value={browseFilters.updatedAt}
                        onChange={(value) => updateBrowseFilter("updatedAt", value)}
                        placeholder="YYYY-MM-DD"
                      />
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {filteredBrowseRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.erfNo}</td>
                      <td>{row.erfType}</td>
                      <td>{formatNumber(row.premiseCount)}</td>
                      <td>{formatNumber(row.electricityMeterCount)}</td>
                      <td>{formatNumber(row.waterMeterCount)}</td>
                      <td>{formatNumber(row.meterCount)}</td>
                      <td>{formatNumber(row.trnsAccessCount)}</td>
                      <td>{formatNumber(row.trnsNaCount)}</td>
                      <td>{formatNumber(row.trnsTotalCount)}</td>
                      <td>{formatUpdatedAt(row.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="load-more-row">
              <div>
                <strong>
                  {hasActiveBrowseFilters
                    ? `${formatNumber(filteredBrowseRows.length)} filtered from ${formatNumber(sortedBrowseRows.length)} loaded`
                    : `${formatNumber(sortedBrowseRows.length)} of ${formatNumber(selectedWardTotalErfs)} ward ERFs loaded`}
                </strong>
                <p className="muted">
                  {activeHasMore
                    ? "More ERFs are available."
                    : "All loaded pages are complete."}
                </p>
              </div>

              <button
                className="secondary-button"
                type="button"
                onClick={handleLoadMore}
                disabled={!activeHasMore || isBrowseFetching}
              >
                {isBrowseFetching
                  ? "Loading..."
                  : activeHasMore
                    ? "Load More"
                    : "All Loaded"}
              </button>
            </div>
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
                  This search is active-LM-wide. It is not restricted to the
                  selected browse ward.
                </p>
              </div>

              <button
                className="icon-button"
                type="button"
                onClick={handleCloseSearchModal}
              >
                ×
              </button>
            </div>

            <form className="modal-search-form" onSubmit={handleSearchSubmit}>
              <label>
                ERF No
                <input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Example: 203 or 203/2"
                />
              </label>

              <label>
                Type
                <select
                  value={searchType}
                  onChange={(event) => setSearchType(event.target.value)}
                >
                  <option value="">All</option>
                  <option value="FORMAL">Formal</option>
                  <option value="INFORMAL">Informal</option>
                </select>
              </label>

              <div className="filter-actions">
                <button type="submit" disabled={isSearchFetching}>
                  {isSearchFetching ? "Searching..." : "Search"}
                </button>

                <button
                  type="button"
                  className="ghost-button"
                  onClick={handleClearSearch}
                >
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
                  Showing the first {formatNumber(ERF_SEARCH_LIMIT)} matches.
                  Refine the ERF number if you need fewer results.
                </p>
              </div>
            ) : null}

            {!searchError && !lastSearchLabel && searchRows.length === 0 ? (
              <div className="empty-state">
                <h2>Search for an ERF</h2>
                <p className="muted">
                  Enter an ERF number. The search will check the full active LM.
                </p>
              </div>
            ) : null}

            {!isSearchFetching &&
            lastSearchLabel &&
            searchRows.length === 0 &&
            !searchError ? (
              <div className="empty-state">
                <h2>No ERFs found</h2>
                <p className="muted">
                  No registry rows matched {lastSearchLabel}.
                </p>
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
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>ERF No</th>
                      <th>Ward</th>
                      <th>Type</th>
                      <th>Premises</th>
                      <th>Electricity</th>
                      <th>Water</th>
                      <th>Total Meters</th>
                      <th>No Access</th>
                      <th>Total TRNs</th>
                      <th>Updated</th>
                    </tr>
                  </thead>

                  <tbody>
                    {[...searchRows].sort(sortErfRows).map((row) => (
                      <tr key={row.id}>
                        <td>{row.erfNo}</td>
                        <td>{getWardDisplay(row.wardPcode)}</td>
                        <td>{row.erfType}</td>
                        <td>{formatNumber(row.premiseCount)}</td>
                        <td>{formatNumber(row.electricityMeterCount)}</td>
                        <td>{formatNumber(row.waterMeterCount)}</td>
                        <td>{formatNumber(row.meterCount)}</td>
                        <td>{formatNumber(row.trnsNaCount)}</td>
                        <td>{formatNumber(row.trnsTotalCount)}</td>
                        <td>{formatUpdatedAt(row.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}


const styles = {
  headerInput: {
    width: "100%",
    minWidth: "7.5rem",
    marginTop: "0.4rem",
    border: "1px solid #cbd5e1",
    borderRadius: "0.45rem",
    padding: "0.36rem 0.45rem",
    fontSize: "0.72rem",
  },
  headerSelect: {
    width: "100%",
    minWidth: "7.5rem",
    marginTop: "0.4rem",
    border: "1px solid #cbd5e1",
    borderRadius: "0.45rem",
    padding: "0.36rem 0.45rem",
    fontSize: "0.72rem",
    background: "#ffffff",
  },
};
