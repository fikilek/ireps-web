/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useEffect, useMemo, useRef, useState } from "react";

import { formatNumber } from "../salesUtils";

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 10;

const EMPTY_TOWN_FILTERS = Object.freeze({
  town: "",
  streets: "",
  meters: "",
  outstanding: "",
  alreadyBatched: "",
  discovered: "",
});

const EMPTY_STREET_FILTERS = Object.freeze({
  street: "",
  total: "",
  outstanding: "",
  alreadyBatched: "",
  discovered: "",
});

function includesSearch(value, searchText) {
  const needle = String(searchText || "").trim().toLowerCase();
  if (!needle) return true;
  return String(value || "").toLowerCase().includes(needle);
}

function matchesCountFilter(value, filterValue) {
  const filter = String(filterValue || "").trim();
  if (!filter) return true;

  const expected = Number(filter);
  if (!Number.isFinite(expected)) return true;

  return Number(value || 0) === expected;
}

function compareValues(left, right) {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left ?? "").localeCompare(String(right ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function SortButton({ label, sortKey, sortConfig, onSort }) {
  const active = sortConfig.key === sortKey;
  const indicator = active
    ? sortConfig.direction === "asc"
      ? "↑"
      : "↓"
    : "↕";

  return (
    <button
      type="button"
      style={{
        ...styles.sortButton,
        ...(active ? styles.sortButtonActive : null),
      }}
      onClick={() => onSort(sortKey)}
      title={`Sort by ${label}`}
    >
      <span>{label}</span>
      <span aria-hidden="true">{indicator}</span>
    </button>
  );
}

function ColumnFilter({
  value,
  onChange,
  placeholder,
  type = "text",
}) {
  return (
    <input
      type={type}
      min={type === "number" ? 0 : undefined}
      step={type === "number" ? 1 : undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      style={styles.headerInput}
      aria-label={placeholder}
    />
  );
}

function CountCell({ value }) {
  return <td style={styles.numberCell}>{formatNumber(value || 0)}</td>;
}

function StreetSelectionCheckbox({
  street,
  selectedIds,
  onToggleStreet,
}) {
  const checkboxRef = useRef(null);
  const outstandingTargets = (street?.targets || []).filter(
    (target) => target?.selectable === true,
  );
  const selectedCount = outstandingTargets.filter((target) =>
    selectedIds?.has(target.id),
  ).length;
  const allSelected =
    outstandingTargets.length > 0 &&
    selectedCount === outstandingTargets.length;
  const partiallySelected =
    selectedCount > 0 && selectedCount < outstandingTargets.length;

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = partiallySelected;
    }
  }, [partiallySelected]);

  return (
    <input
      ref={checkboxRef}
      type="checkbox"
      checked={allSelected}
      disabled={outstandingTargets.length === 0}
      onChange={() => onToggleStreet?.(street)}
      aria-label={`Select Outstanding meters on ${street?.streetLabel || "street"}`}
      aria-checked={partiallySelected ? "mixed" : allSelected}
      title={
        outstandingTargets.length === 0
          ? "No Outstanding meters are available on this street"
          : partiallySelected
            ? `${selectedCount} of ${outstandingTargets.length} Outstanding meters selected`
            : `Select Outstanding meters on this street`
      }
    />
  );
}

function PaginationControls({
  currentPage,
  pageSize,
  totalPages,
  totalRows,
  onPageChange,
  onPageSizeChange,
}) {
  if (totalRows === 0) return null;

  const startRow = (currentPage - 1) * pageSize + 1;
  const endRow = Math.min(currentPage * pageSize, totalRows);

  return (
    <div style={styles.paginationBar}>
      <div style={styles.paginationSummary}>
        Showing {formatNumber(startRow)}-{formatNumber(endRow)} of{" "}
        {formatNumber(totalRows)} rows
      </div>

      <div style={styles.paginationControls}>
        <label style={styles.pageSizeLabel}>
          Rows per page
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            style={styles.pageSizeSelect}
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          style={styles.paginationButton}
          onClick={() => onPageChange(1)}
          disabled={currentPage <= 1}
        >
          First
        </button>

        <button
          type="button"
          style={styles.paginationButton}
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
        >
          Previous
        </button>

        <span style={styles.pageCountLabel}>
          Page {formatNumber(currentPage)} of {formatNumber(totalPages)}
        </span>

        <button
          type="button"
          style={styles.paginationButton}
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
        >
          Next
        </button>

        <button
          type="button"
          style={styles.paginationButton}
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage >= totalPages}
        >
          Last
        </button>
      </div>
    </div>
  );
}

function getTownSortValue(town, key) {
  if (key === "town") return town?.town || "";
  if (key === "streets") return Number(town?.streetCount || 0);
  if (key === "meters") return Number(town?.counters?.total || 0);
  if (key === "outstanding") return Number(town?.counters?.outstanding || 0);
  if (key === "alreadyBatched") {
    return Number(town?.counters?.alreadyBatched || 0);
  }
  if (key === "discovered") return Number(town?.counters?.discovered || 0);
  return town?.town || "";
}

function getStreetSortValue(street, key) {
  if (key === "street") return street?.streetLabel || "";
  if (key === "total") return Number(street?.counters?.total || 0);
  if (key === "outstanding") return Number(street?.counters?.outstanding || 0);
  if (key === "alreadyBatched") {
    return Number(street?.counters?.alreadyBatched || 0);
  }
  if (key === "discovered") return Number(street?.counters?.discovered || 0);
  return street?.streetLabel || "";
}

function sortRows(rows, sortConfig, getSortValue) {
  return [...rows].sort((left, right) => {
    const comparison = compareValues(
      getSortValue(left, sortConfig.key),
      getSortValue(right, sortConfig.key),
    );

    return sortConfig.direction === "asc" ? comparison : -comparison;
  });
}

function TownHeader({
  sortConfig,
  filters,
  onSort,
  onFilterChange,
}) {
  return (
    <thead>
      <tr>
        <th style={styles.headerCell}>
          <SortButton
            label="Town / Area"
            sortKey="town"
            sortConfig={sortConfig}
            onSort={onSort}
          />
        </th>
        <th style={styles.headerCell}>
          <SortButton
            label="Streets"
            sortKey="streets"
            sortConfig={sortConfig}
            onSort={onSort}
          />
        </th>
        <th style={styles.headerCell}>
          <SortButton
            label="Meters"
            sortKey="meters"
            sortConfig={sortConfig}
            onSort={onSort}
          />
        </th>
        <th style={styles.headerCell}>
          <SortButton
            label="Outstanding"
            sortKey="outstanding"
            sortConfig={sortConfig}
            onSort={onSort}
          />
        </th>
        <th style={styles.headerCell}>
          <SortButton
            label="Already Batched"
            sortKey="alreadyBatched"
            sortConfig={sortConfig}
            onSort={onSort}
          />
        </th>
        <th style={styles.headerCell}>
          <SortButton
            label="Discovered"
            sortKey="discovered"
            sortConfig={sortConfig}
            onSort={onSort}
          />
        </th>
      </tr>
      <tr>
        <th style={styles.filterCell}>
          <ColumnFilter
            value={filters.town}
            onChange={(value) => onFilterChange("town", value)}
            placeholder="Filter Town / Area"
          />
        </th>
        <th style={styles.filterCell}>
          <ColumnFilter
            value={filters.streets}
            onChange={(value) => onFilterChange("streets", value)}
            placeholder="Exact count"
            type="number"
          />
        </th>
        <th style={styles.filterCell}>
          <ColumnFilter
            value={filters.meters}
            onChange={(value) => onFilterChange("meters", value)}
            placeholder="Exact count"
            type="number"
          />
        </th>
        <th style={styles.filterCell}>
          <ColumnFilter
            value={filters.outstanding}
            onChange={(value) => onFilterChange("outstanding", value)}
            placeholder="Exact count"
            type="number"
          />
        </th>
        <th style={styles.filterCell}>
          <ColumnFilter
            value={filters.alreadyBatched}
            onChange={(value) => onFilterChange("alreadyBatched", value)}
            placeholder="Exact count"
            type="number"
          />
        </th>
        <th style={styles.filterCell}>
          <ColumnFilter
            value={filters.discovered}
            onChange={(value) => onFilterChange("discovered", value)}
            placeholder="Exact count"
            type="number"
          />
        </th>
      </tr>
    </thead>
  );
}

function StreetHeader({
  sortConfig,
  filters,
  onSort,
  onFilterChange,
}) {
  return (
    <thead>
      <tr>
        <th style={styles.headerCell}>Select</th>
        <th style={styles.headerCell}>
          <SortButton
            label="Street"
            sortKey="street"
            sortConfig={sortConfig}
            onSort={onSort}
          />
        </th>
        <th style={styles.headerCell}>
          <SortButton
            label="Total"
            sortKey="total"
            sortConfig={sortConfig}
            onSort={onSort}
          />
        </th>
        <th style={styles.headerCell}>
          <SortButton
            label="Outstanding"
            sortKey="outstanding"
            sortConfig={sortConfig}
            onSort={onSort}
          />
        </th>
        <th style={styles.headerCell}>
          <SortButton
            label="Already Batched"
            sortKey="alreadyBatched"
            sortConfig={sortConfig}
            onSort={onSort}
          />
        </th>
        <th style={styles.headerCell}>
          <SortButton
            label="Discovered"
            sortKey="discovered"
            sortConfig={sortConfig}
            onSort={onSort}
          />
        </th>
      </tr>
      <tr>
        <th style={styles.filterCell} aria-hidden="true" />
        <th style={styles.filterCell}>
          <ColumnFilter
            value={filters.street}
            onChange={(value) => onFilterChange("street", value)}
            placeholder="Filter street"
          />
        </th>
        <th style={styles.filterCell}>
          <ColumnFilter
            value={filters.total}
            onChange={(value) => onFilterChange("total", value)}
            placeholder="Exact count"
            type="number"
          />
        </th>
        <th style={styles.filterCell}>
          <ColumnFilter
            value={filters.outstanding}
            onChange={(value) => onFilterChange("outstanding", value)}
            placeholder="Exact count"
            type="number"
          />
        </th>
        <th style={styles.filterCell}>
          <ColumnFilter
            value={filters.alreadyBatched}
            onChange={(value) => onFilterChange("alreadyBatched", value)}
            placeholder="Exact count"
            type="number"
          />
        </th>
        <th style={styles.filterCell}>
          <ColumnFilter
            value={filters.discovered}
            onChange={(value) => onFilterChange("discovered", value)}
            placeholder="Exact count"
            type="number"
          />
        </th>
      </tr>
    </thead>
  );
}

export default function NonGpsStreetPlanning({
  towns = [],
  selectedTownKey = "",
  searchText = "",
  onSearchTextChange,
  onOpenTown,
  onBackToTowns,
  onOpenStreet,
  selectedIds = new Set(),
  onToggleStreet,
}) {
  const [townPage, setTownPage] = useState(1);
  const [townPageSize, setTownPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [townSort, setTownSort] = useState({
    key: "town",
    direction: "asc",
  });
  const [townFilters, setTownFilters] = useState({ ...EMPTY_TOWN_FILTERS });

  const [streetPage, setStreetPage] = useState(1);
  const [streetPageSize, setStreetPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [streetSort, setStreetSort] = useState({
    key: "street",
    direction: "asc",
  });
  const [streetFilters, setStreetFilters] = useState({
    ...EMPTY_STREET_FILTERS,
  });

  const selectedTown =
    towns.find((town) => town.key === selectedTownKey) || null;

  const filteredTowns = useMemo(() => {
    const rows = towns.filter(
      (town) =>
        includesSearch(town.town, searchText) &&
        includesSearch(town.town, townFilters.town) &&
        matchesCountFilter(town.streetCount, townFilters.streets) &&
        matchesCountFilter(town.counters.total, townFilters.meters) &&
        matchesCountFilter(
          town.counters.outstanding,
          townFilters.outstanding,
        ) &&
        matchesCountFilter(
          town.counters.alreadyBatched,
          townFilters.alreadyBatched,
        ) &&
        matchesCountFilter(town.counters.discovered, townFilters.discovered),
    );

    return sortRows(rows, townSort, getTownSortValue);
  }, [searchText, townFilters, townSort, towns]);

  const townTotalPages = Math.max(
    1,
    Math.ceil(filteredTowns.length / townPageSize),
  );
  const safeTownPage = Math.min(townPage, townTotalPages);
  const pagedTowns = filteredTowns.slice(
    (safeTownPage - 1) * townPageSize,
    safeTownPage * townPageSize,
  );

  const filteredStreets = useMemo(() => {
    if (!selectedTown) return [];

    const rows = selectedTown.streets.filter(
      (street) =>
        includesSearch(street.streetLabel, searchText) &&
        includesSearch(street.streetLabel, streetFilters.street) &&
        matchesCountFilter(street.counters.total, streetFilters.total) &&
        matchesCountFilter(
          street.counters.outstanding,
          streetFilters.outstanding,
        ) &&
        matchesCountFilter(
          street.counters.alreadyBatched,
          streetFilters.alreadyBatched,
        ) &&
        matchesCountFilter(
          street.counters.discovered,
          streetFilters.discovered,
        ),
    );

    return sortRows(rows, streetSort, getStreetSortValue);
  }, [searchText, selectedTown, streetFilters, streetSort]);

  const streetTotalPages = Math.max(
    1,
    Math.ceil(filteredStreets.length / streetPageSize),
  );
  const safeStreetPage = Math.min(streetPage, streetTotalPages);
  const pagedStreets = filteredStreets.slice(
    (safeStreetPage - 1) * streetPageSize,
    safeStreetPage * streetPageSize,
  );

  function updateSort(setSort, key) {
    setSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));

    if (setSort === setTownSort) setTownPage(1);
    else setStreetPage(1);
  }

  function updateTownFilter(key, value) {
    setTownFilters((current) => ({ ...current, [key]: value }));
    setTownPage(1);
  }

  function updateStreetFilter(key, value) {
    setStreetFilters((current) => ({ ...current, [key]: value }));
    setStreetPage(1);
  }

  function handleTownSearchChange(value) {
    setTownPage(1);
    onSearchTextChange?.(value);
  }

  function handleStreetSearchChange(value) {
    setStreetPage(1);
    onSearchTextChange?.(value);
  }

  function handleOpenTown(townKey) {
    setStreetPage(1);
    setStreetFilters({ ...EMPTY_STREET_FILTERS });
    onOpenTown?.(townKey);
  }

  function handleBackToTowns() {
    setStreetPage(1);
    setStreetFilters({ ...EMPTY_STREET_FILTERS });
    onBackToTowns?.();
  }

  if (!selectedTown) {
    return (
      <section style={styles.panel}>
        <div style={styles.panelHeader}>
          <div>
            <p style={styles.eyebrow}>Street Planning</p>
            <h2 style={styles.title}>Town / Area</h2>
            <p style={styles.subtitle}>
              Open a Town / Area to view its street planning groups.
            </p>
          </div>

          <input
            type="search"
            value={searchText}
            onChange={(event) => handleTownSearchChange(event.target.value)}
            placeholder="Search Town / Area"
            style={styles.searchInput}
          />
        </div>

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <TownHeader
              sortConfig={townSort}
              filters={townFilters}
              onSort={(key) => updateSort(setTownSort, key)}
              onFilterChange={updateTownFilter}
            />
            <tbody>
              {pagedTowns.length === 0 ? (
                <tr>
                  <td colSpan={6} style={styles.emptyCell}>
                    No Town / Area matches the current filters.
                  </td>
                </tr>
              ) : (
                pagedTowns.map((town) => (
                  <tr key={town.key}>
                    <td style={styles.bodyCell}>
                      <button
                        type="button"
                        style={styles.linkButton}
                        onClick={() => handleOpenTown(town.key)}
                      >
                        {town.town || "NAv"}
                      </button>
                    </td>
                    <CountCell value={town.streetCount} />
                    <CountCell value={town.counters.total} />
                    <CountCell value={town.counters.outstanding} />
                    <CountCell value={town.counters.alreadyBatched} />
                    <CountCell value={town.counters.discovered} />
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <PaginationControls
          currentPage={safeTownPage}
          pageSize={townPageSize}
          totalPages={townTotalPages}
          totalRows={filteredTowns.length}
          onPageChange={setTownPage}
          onPageSizeChange={(value) => {
            setTownPageSize(value);
            setTownPage(1);
          }}
        />
      </section>
    );
  }

  return (
    <section style={styles.panel}>
      <div style={styles.panelHeader}>
        <div>
          <button
            type="button"
            style={styles.backButton}
            onClick={handleBackToTowns}
          >
            ← Back to Town / Area
          </button>
          <p style={styles.eyebrow}>Street Planning</p>
          <h2 style={styles.title}>{selectedTown.town}</h2>
          <p style={styles.subtitle}>
            Open a street to view the complete No-GPS target population.
          </p>
        </div>

        <input
          type="search"
          value={searchText}
          onChange={(event) => handleStreetSearchChange(event.target.value)}
          placeholder="Search street"
          style={styles.searchInput}
        />
      </div>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <StreetHeader
            sortConfig={streetSort}
            filters={streetFilters}
            onSort={(key) => updateSort(setStreetSort, key)}
            onFilterChange={updateStreetFilter}
          />
          <tbody>
            {pagedStreets.length === 0 ? (
              <tr>
                <td colSpan={6} style={styles.emptyCell}>
                  No street matches the current filters.
                </td>
              </tr>
            ) : (
              pagedStreets.map((street) => (
                <tr key={street.key}>
                  <td style={styles.bodyCell}>
                    <StreetSelectionCheckbox
                      street={street}
                      selectedIds={selectedIds}
                      onToggleStreet={onToggleStreet}
                    />
                  </td>
                  <td style={styles.bodyCell}>
                    <button
                      type="button"
                      style={styles.linkButton}
                      onClick={() => onOpenStreet?.(street.key)}
                    >
                      {street.streetLabel || "Unnamed street"}
                    </button>
                  </td>
                  <CountCell value={street.counters.total} />
                  <CountCell value={street.counters.outstanding} />
                  <CountCell value={street.counters.alreadyBatched} />
                  <CountCell value={street.counters.discovered} />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PaginationControls
        currentPage={safeStreetPage}
        pageSize={streetPageSize}
        totalPages={streetTotalPages}
        totalRows={filteredStreets.length}
        onPageChange={setStreetPage}
        onPageSizeChange={(value) => {
          setStreetPageSize(value);
          setStreetPage(1);
        }}
      />
    </section>
  );
}

const styles = {
  panel: {
    border: "1px solid #dbe3ef",
    borderRadius: "1rem",
    background: "#ffffff",
    overflow: "hidden",
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
  },
  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: "1rem",
    padding: "1rem 1.1rem",
    borderBottom: "1px solid #e2e8f0",
  },
  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: "0.72rem",
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  title: {
    margin: "0.18rem 0 0",
    color: "#0f172a",
    fontSize: "1.15rem",
  },
  subtitle: {
    margin: "0.3rem 0 0",
    color: "#64748b",
    fontSize: "0.86rem",
  },
  searchInput: {
    width: "min(320px, 100%)",
    border: "1px solid #cbd5e1",
    borderRadius: "0.65rem",
    padding: "0.62rem 0.72rem",
    font: "inherit",
  },
  tableWrap: {
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: "920px",
  },
  headerCell: {
    padding: "0.58rem 0.7rem 0.35rem",
    borderBottom: "1px solid #e2e8f0",
    background: "#f8fafc",
    color: "#475569",
    fontSize: "0.75rem",
    textAlign: "left",
    whiteSpace: "nowrap",
  },
  filterCell: {
    padding: "0 0.7rem 0.55rem",
    borderBottom: "1px solid #dbe3ef",
    background: "#f8fafc",
  },
  sortButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35rem",
    border: 0,
    padding: 0,
    background: "transparent",
    color: "#475569",
    font: "inherit",
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  sortButtonActive: {
    color: "#1d4ed8",
  },
  headerInput: {
    width: "100%",
    minWidth: "96px",
    boxSizing: "border-box",
    border: "1px solid #cbd5e1",
    borderRadius: "0.48rem",
    background: "#ffffff",
    padding: "0.42rem 0.5rem",
    color: "#334155",
    fontSize: "0.74rem",
    font: "inherit",
  },
  bodyCell: {
    padding: "0.72rem 0.8rem",
    borderBottom: "1px solid #edf2f7",
    color: "#334155",
    fontSize: "0.84rem",
  },
  numberCell: {
    padding: "0.72rem 0.8rem",
    borderBottom: "1px solid #edf2f7",
    color: "#334155",
    fontSize: "0.84rem",
    fontVariantNumeric: "tabular-nums",
  },
  linkButton: {
    border: 0,
    padding: 0,
    background: "transparent",
    color: "#1d4ed8",
    fontWeight: 800,
    cursor: "pointer",
    textAlign: "left",
  },
  backButton: {
    border: 0,
    padding: 0,
    marginBottom: "0.55rem",
    background: "transparent",
    color: "#475569",
    fontWeight: 800,
    cursor: "pointer",
  },
  emptyCell: {
    padding: "1.25rem",
    textAlign: "center",
    color: "#64748b",
  },
  paginationBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    flexWrap: "wrap",
    padding: "0.75rem 0.9rem",
    borderTop: "1px solid #e2e8f0",
    background: "#f8fafc",
  },
  paginationSummary: {
    color: "#64748b",
    fontSize: "0.78rem",
    fontWeight: 700,
  },
  paginationControls: {
    display: "flex",
    alignItems: "center",
    gap: "0.45rem",
    flexWrap: "wrap",
  },
  pageSizeLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    color: "#475569",
    fontSize: "0.78rem",
    fontWeight: 700,
  },
  pageSizeSelect: {
    border: "1px solid #cbd5e1",
    borderRadius: "0.5rem",
    background: "#ffffff",
    padding: "0.34rem 0.45rem",
    color: "#334155",
    font: "inherit",
  },
  paginationButton: {
    border: "1px solid #cbd5e1",
    borderRadius: "0.5rem",
    background: "#ffffff",
    color: "#334155",
    padding: "0.38rem 0.58rem",
    fontSize: "0.76rem",
    fontWeight: 800,
    cursor: "pointer",
  },
  pageCountLabel: {
    color: "#475569",
    fontSize: "0.78rem",
    fontWeight: 800,
    whiteSpace: "nowrap",
  },
};
