/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useCallback, useEffect, useMemo, useState } from "react";

import MeterLocationModal from "./MeterLocationModal";
import SalesTbRefsModal from "./SalesTbRefsModal";
import SalesGpsMapSection from "./SalesGpsMapSection";
import SalesRangeFilterModal from "./SalesRangeFilterModal";
import {
  TARGET_FILTERS,
  compareNatural,
  EMPTY_SALES_RANGE_FILTER,
  formatCurrencyFromCents,
  formatNumber,
  getMonthLabel,
  getSalesRangeFilterButtonLabel,
  getTargetFilterLabel,
  includesText,
  isSalesRangeFilterActive,
  matchesSalesRangeFilter,
  matchesTargetFilter,
} from "../salesUtils";

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 5;
const DEFAULT_SORT = { key: "updatedAt", direction: "desc" };

const SALES_CATEGORY_ORDER = [
  "Normal - No Leakage Flag",
  "CAT1 - Zero Purchaser",
  "CAT2 - Ghost Purchaser (1-3 mo)",
  "CAT3 - Micro Purchaser (<R400)",
  "CAT4 - Long Gap (4+ months)",
  "CAT5 - Stopped Purchasing",
  "CAT6 - Low kWh per Rand",
  "CAT8 - Energy Without Purchase",
];

const RISK_TIER_ORDER = [
  "Normal",
  "Low Risk",
  "Medium Risk",
  "High Risk",
  "Critical",
];

const DEFAULT_COLUMN_VISIBILITY = {
  wardNo: true,
  geofence: true,
  tbRefs: true,
  leakageCategory: true,
  riskTier: false,
  riskScore: false,
  addressLine1: true,
  town: true,
  sgCode: true,
  erfNo: true,
  totalSalesC: false,
  latest12MonthsSalesC: true,
  sales2024C: false,
  sales2025C: false,
  sales2026C: false,
};

const COLUMN_OPTIONS = [
  { key: "wardNo", label: "Ward No" },
  { key: "geofence", label: "Geofences" },
  { key: "tbRefs", label: "TB IDs" },
  { key: "leakageCategory", label: "Sales Category" },
  { key: "riskTier", label: "Risk Tier" },
  { key: "riskScore", label: "Risk Score" },
  { key: "addressLine1", label: "Address" },
  { key: "town", label: "Town" },
  { key: "sgCode", label: "SG Code" },
  { key: "erfNo", label: "Erf No" },
  { key: "totalSalesC", label: "Total Sales" },
  { key: "latest12MonthsSalesC", label: "Latest 12 Months" },
  { key: "sales2024C", label: "Total Sales 2024" },
  { key: "sales2025C", label: "Total Sales 2025" },
  { key: "sales2026C", label: "Total Sales 2026" },
];

const STICKY_COLUMN_WIDTHS = {
  select: 54,
  meterNo: 155,
  wardNo: 105,
  geofence: 220,
  tbRefs: 130,
  leakageCategory: 260,
  riskTier: 135,
  riskScore: 110,
  addressLine1: 260,
  town: 135,
  sgCode: 230,
  erfNo: 110,
  totalSalesC: 145,
  latest12MonthsSalesC: 165,
  sales2024C: 150,
  sales2025C: 150,
  sales2026C: 150,
};

const EMPTY_FILTERS = {
  meterNo: "",
  wardNo: "ALL",
  geofenceId: "ALL",
  tbId: "ALL",
  leakageCategory: "ALL",
  riskTier: "ALL",
  riskScore: "",
  addressLine1: "",
  town: "ALL",
  sgCode: "",
  erfNo: "",
  salesRanges: {},
};

function SortButton({ label, sortKey, sortConfig, onSort }) {
  const isActive = sortConfig.key === sortKey;
  const directionLabel = isActive
    ? sortConfig.direction === "asc"
      ? "↑"
      : "↓"
    : "↕";

  return (
    <button
      type="button"
      style={styles.sortButton}
      onClick={() => onSort(sortKey)}
      title={`Sort by ${label}`}
    >
      <span>{label}</span>
      <span>{directionLabel}</span>
    </button>
  );
}

function FilterInput({ value, onChange, placeholder, type = "text", min, step }) {
  return (
    <input
      type={type}
      min={min}
      step={step}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      style={styles.headerInput}
    />
  );
}

function SalesRangeFilterButton({ filter, onClick }) {
  const active = isSalesRangeFilterActive(filter);

  return (
    <button
      type="button"
      style={{
        ...styles.rangeFilterButton,
        ...(active ? styles.rangeFilterButtonActive : null),
      }}
      onClick={onClick}
      title={active ? "Edit active sales range filter" : "Open sales range filter"}
    >
      <span style={styles.rangeFilterCheckbox} aria-hidden="true">
        {active ? "☑" : "☐"}
      </span>
      <span style={styles.rangeFilterLabel}>
        {getSalesRangeFilterButtonLabel(filter)}
      </span>
    </button>
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

function getVisibleConfigurableKeys(columnVisibility) {
  return COLUMN_OPTIONS.map((option) => option.key).filter(
    (key) => columnVisibility[key],
  );
}

function buildStickyLayout(columnVisibility) {
  const orderedKeys = [
    "select",
    "meterNo",
    ...getVisibleConfigurableKeys(columnVisibility),
  ];

  let left = 0;

  return orderedKeys.reduce((layout, key) => {
    const width = STICKY_COLUMN_WIDTHS[key];
    layout[key] = { left, width };
    left += width;
    return layout;
  }, {});
}

function getStickyStyle(columnKey, stickyLayout, isHeader = false) {
  const config = stickyLayout[columnKey];
  if (!config) return {};

  const visibleKeys = Object.keys(stickyLayout);
  const isLastSticky = visibleKeys[visibleKeys.length - 1] === columnKey;

  return {
    position: "sticky",
    left: `${config.left}px`,
    width: `${config.width}px`,
    minWidth: `${config.width}px`,
    maxWidth: `${config.width}px`,
    zIndex: isHeader ? 8 : 3,
    background: isHeader ? "#e2e8f0" : "#ffffff",
    boxShadow: isLastSticky ? "5px 0 10px rgba(15, 23, 42, 0.09)" : undefined,
  };
}

function getRowGeofenceRefs(row = {}) {
  return Array.isArray(row?.geofenceRefs)
    ? row.geofenceRefs.filter((ref) => ref?.id)
    : [];
}

function getRowGeofenceLabel(row = {}) {
  const names = getRowGeofenceRefs(row)
    .map((ref) => String(ref?.name || ref?.id || "").trim())
    .filter(Boolean);

  return names.join(", ");
}

function getRowTbRefs(row = {}) {
  return Array.isArray(row?.tbRefs)
    ? row.tbRefs
        .map((ref) => ({
          ...ref,
          id: typeof ref?.id === "string" ? ref.id.trim() : "",
        }))
        .filter((ref) => ref.id)
    : [];
}

function normalizeWardNumber(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const numeric = Number(text.replace(/\D/g, ""));
  return Number.isFinite(numeric) ? String(numeric) : text.toUpperCase();
}

function getRowMapMeterId(row = {}) {
  return String(row?.id || row?.meterNo || "").trim();
}

function rowHasGpsPointForWard(row = {}, selectedWardNo = "") {
  const normalizedSelectedWard = normalizeWardNumber(selectedWardNo);
  if (!normalizedSelectedWard) return false;

  const rowWardNumbers = Array.isArray(row?.wardNumbers)
    ? row.wardNumbers.map(normalizeWardNumber)
    : [];
  const candidates = Array.isArray(row?.erfCandidates)
    ? row.erfCandidates
    : [];

  return candidates.some((candidate) => {
    const latitude = Number(candidate?.latitude);
    const longitude = Number(candidate?.longitude);
    const candidateWardNo = normalizeWardNumber(candidate?.wardNumber);
    const belongsToWard = candidateWardNo
      ? candidateWardNo === normalizedSelectedWard
      : rowWardNumbers.includes(normalizedSelectedWard);

    return (
      candidate?.hasValidGps === true &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      belongsToWard
    );
  });
}

function getTbCountLabel(row = {}) {
  const count = getRowTbRefs(row).length;
  return `${count} ${count === 1 ? "TB" : "TBs"}`;
}

function getOrderedUniqueOptions(rows, fieldName, preferredOrder = []) {
  const preferredIndex = new Map(
    preferredOrder.map((value, index) => [value, index]),
  );

  return Array.from(
    new Set(
      rows
        .map((row) => String(row?.[fieldName] || "").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => {
    const leftIndex = preferredIndex.has(left)
      ? preferredIndex.get(left)
      : Number.MAX_SAFE_INTEGER;
    const rightIndex = preferredIndex.has(right)
      ? preferredIndex.get(right)
      : Number.MAX_SAFE_INTEGER;

    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return compareNatural(left, right);
  });
}

function getSortValue(row, sortKey) {
  if (sortKey.startsWith("month:")) {
    const monthKey = sortKey.slice("month:".length);
    return Number(row?.monthlySalesC?.[monthKey] || 0);
  }

  if (
    [
      "totalSalesC",
      "latest12MonthsSalesC",
      "sales2024C",
      "sales2025C",
      "sales2026C",
      "riskScore",
    ].includes(sortKey)
  ) {
    return Number(row?.[sortKey] || 0);
  }

  if (sortKey === "updatedAt") return Number(row?.updatedAtMs || 0);
  if (sortKey === "wardNo") return row?.wardNumberLabel || "";
  if (sortKey === "geofence") return getRowGeofenceLabel(row);
  if (sortKey === "tbRefs") return getRowTbRefs(row).length;
  if (sortKey === "leakageCategory") return row?.leakageCategory || "";
  if (sortKey === "riskTier") return row?.riskTier || "";
  if (sortKey === "addressLine1") return row?.addressLine1 || "";
  if (sortKey === "town") return row?.town || "";
  if (sortKey === "sgCode") return row?.sgCode || "";
  if (sortKey === "erfNo") return row?.erfNo || "";

  return row?.meterNo || "";
}

function compareRows(left, right, sortConfig) {
  const comparison = compareNatural(
    getSortValue(left, sortConfig.key),
    getSortValue(right, sortConfig.key),
  );

  return sortConfig.direction === "asc" ? comparison : -comparison;
}

function AggregateHeader({
  label,
  columnKey,
  sortConfig,
  onSort,
  filter,
  onOpenFilter,
}) {
  return (
    <>
      <SortButton
        label={label}
        sortKey={columnKey}
        sortConfig={sortConfig}
        onSort={onSort}
      />
      <SalesRangeFilterButton filter={filter} onClick={onOpenFilter} />
    </>
  );
}

export default function SalesMetersTable({
  rows = [],
  monthKeys = [],
  targetFilter = TARGET_FILTERS.ALL,
  selectedIds,
  onSelectedIdsChange,
}) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [columnVisibility, setColumnVisibility] = useState(
    DEFAULT_COLUMN_VISIBILITY,
  );
  const [showColumnControls, setShowColumnControls] = useState(false);
  const [showGpsMap, setShowGpsMap] = useState(false);
  const [sortConfig, setSortConfig] = useState(DEFAULT_SORT);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [activeRangeFilterKey, setActiveRangeFilterKey] = useState(null);
  const [mapRow, setMapRow] = useState(null);
  const [tbRefsRow, setTbRefsRow] = useState(null);
  const [wardGeofenceOptions, setWardGeofenceOptions] = useState([]);
  const [hoveredMapMeterId, setHoveredMapMeterId] = useState("");
  const [focusedMapMeterId, setFocusedMapMeterId] = useState("");
  const [mapFocusRequest, setMapFocusRequest] = useState(0);

  const latestMonthKey = monthKeys[0] || "2026-06";
  const stickyLayout = useMemo(
    () => buildStickyLayout(columnVisibility),
    [columnVisibility],
  );

  const visibleConfigurableKeys = useMemo(
    () => getVisibleConfigurableKeys(columnVisibility),
    [columnVisibility],
  );

  const fixedTableWidth = useMemo(() => {
    return Object.values(stickyLayout).reduce(
      (total, config) => total + config.width,
      0,
    );
  }, [stickyLayout]);

  const townOptions = useMemo(() => {
    return Array.from(
      new Set(rows.map((row) => String(row?.town || "").trim()).filter(Boolean)),
    ).sort(compareNatural);
  }, [rows]);

  const wardOptions = useMemo(() => {
    return Array.from(
      new Set(
        rows.flatMap((row) =>
          Array.isArray(row?.wardNumbers) ? row.wardNumbers : [],
        ),
      ),
    ).sort(compareNatural);
  }, [rows]);

  const salesGeofenceOptions = useMemo(() => {
    const byId = new Map();

    rows.forEach((row) => {
      getRowGeofenceRefs(row).forEach((ref) => {
        if (byId.has(ref.id)) return;

        byId.set(ref.id, {
          id: ref.id,
          name: String(ref.name || ref.id),
        });
      });
    });

    return Array.from(byId.values()).sort((left, right) =>
      compareNatural(left.name, right.name),
    );
  }, [rows]);

  const geofenceOptions = useMemo(() => {
    const byId = new Map();

    salesGeofenceOptions.forEach((geofence) => {
      byId.set(geofence.id, geofence);
    });

    wardGeofenceOptions.forEach((geofence) => {
      byId.set(geofence.id, geofence);
    });

    return Array.from(byId.values()).sort((left, right) =>
      compareNatural(left.name, right.name),
    );
  }, [salesGeofenceOptions, wardGeofenceOptions]);

  const salesLmPcode = useMemo(() => {
    return (
      rows.find((row) => String(row?.lmPcode || "").trim())?.lmPcode || ""
    );
  }, [rows]);

  const tbIdOptions = useMemo(() => {
    return Array.from(
      new Set(
        rows.flatMap((row) =>
          getRowTbRefs(row).map((ref) => ref.id),
        ),
      ),
    ).sort(compareNatural);
  }, [rows]);

  const salesCategoryOptions = useMemo(
    () =>
      getOrderedUniqueOptions(
        rows,
        "leakageCategory",
        SALES_CATEGORY_ORDER,
      ),
    [rows],
  );

  const riskTierOptions = useMemo(
    () => getOrderedUniqueOptions(rows, "riskTier", RISK_TIER_ORDER),
    [rows],
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [targetFilter]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const matchesMonthlyFilters = monthKeys.every((monthKey) => {
        return matchesSalesRangeFilter(
          row?.monthlySalesC?.[monthKey],
          filters.salesRanges?.[`month:${monthKey}`],
        );
      });

      const rowGeofenceRefs = getRowGeofenceRefs(row);
      const matchesGeofence =
        filters.geofenceId === "ALL" ||
        (filters.geofenceId === "NONE" && rowGeofenceRefs.length === 0) ||
        rowGeofenceRefs.some((ref) => ref.id === filters.geofenceId);

      const rowTbRefs = getRowTbRefs(row);
      let matchesTb = true;

      if (filters.tbId === "NONE") matchesTb = rowTbRefs.length === 0;
      else if (filters.tbId === "ANY") matchesTb = rowTbRefs.length > 0;
      else if (filters.tbId !== "ALL") {
        matchesTb = rowTbRefs.some((ref) => ref.id === filters.tbId);
      }

      const riskScoreFilter = String(filters.riskScore || "").trim();
      const matchesRiskScore =
        riskScoreFilter === "" ||
        (row?.riskScore !== null &&
          row?.riskScore !== undefined &&
          Number(row.riskScore) === Number(riskScoreFilter));

      return (
        matchesTargetFilter(row, targetFilter, latestMonthKey) &&
        includesText(row?.meterNo, filters.meterNo) &&
        (filters.wardNo === "ALL" || row?.wardNumbers?.includes(filters.wardNo)) &&
        matchesGeofence &&
        matchesTb &&
        (filters.leakageCategory === "ALL" ||
          row?.leakageCategory === filters.leakageCategory) &&
        (filters.riskTier === "ALL" || row?.riskTier === filters.riskTier) &&
        matchesRiskScore &&
        includesText(row?.addressLine1, filters.addressLine1) &&
        (filters.town === "ALL" || row?.town === filters.town) &&
        includesText(row?.sgCode, filters.sgCode) &&
        includesText(row?.erfNo, filters.erfNo) &&
        matchesSalesRangeFilter(
          row?.totalSalesC,
          filters.salesRanges?.totalSalesC,
        ) &&
        matchesSalesRangeFilter(
          row?.latest12MonthsSalesC,
          filters.salesRanges?.latest12MonthsSalesC,
        ) &&
        matchesSalesRangeFilter(
          row?.sales2024C,
          filters.salesRanges?.sales2024C,
        ) &&
        matchesSalesRangeFilter(
          row?.sales2025C,
          filters.salesRanges?.sales2025C,
        ) &&
        matchesSalesRangeFilter(
          row?.sales2026C,
          filters.salesRanges?.sales2026C,
        ) &&
        matchesMonthlyFilters
      );
    });
  }, [rows, filters, monthKeys, targetFilter, latestMonthKey]);

  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((left, right) =>
      compareRows(left, right, sortConfig),
    );
  }, [filteredRows, sortConfig]);

  const totalRows = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safeCurrentPage = Math.max(1, Math.min(currentPage, totalPages));
  const pageStartIndex = totalRows === 0 ? 0 : (safeCurrentPage - 1) * pageSize;
  const pageEndIndex = Math.min(pageStartIndex + pageSize, totalRows);
  const paginatedRows = useMemo(
    () => sortedRows.slice(pageStartIndex, pageEndIndex),
    [sortedRows, pageStartIndex, pageEndIndex],
  );

  const selectedIdSet = selectedIds || new Set();
  const pageIds = paginatedRows.map((row) => row.id).filter(Boolean);

  const hasActiveColumnFilters =
    Boolean(String(filters.meterNo || "").trim()) ||
    filters.wardNo !== "ALL" ||
    filters.geofenceId !== "ALL" ||
    filters.tbId !== "ALL" ||
    filters.leakageCategory !== "ALL" ||
    filters.riskTier !== "ALL" ||
    Boolean(String(filters.riskScore || "").trim()) ||
    Boolean(String(filters.addressLine1 || "").trim()) ||
    filters.town !== "ALL" ||
    Boolean(String(filters.sgCode || "").trim()) ||
    Boolean(String(filters.erfNo || "").trim()) ||
    Object.values(filters.salesRanges || {}).some((filter) =>
      isSalesRangeFilterActive(filter),
    );

  const hasActiveFilter =
    targetFilter !== TARGET_FILTERS.ALL || hasActiveColumnFilters;

  const headerSelectionIds = hasActiveFilter
    ? sortedRows.map((row) => row.id).filter(Boolean)
    : pageIds;

  const selectedHeaderScopeCount = headerSelectionIds.reduce(
    (count, id) => count + (selectedIdSet.has(id) ? 1 : 0),
    0,
  );

  const allHeaderScopeRowsSelected =
    headerSelectionIds.length > 0 &&
    selectedHeaderScopeCount === headerSelectionIds.length;

  const someHeaderScopeRowsSelected =
    selectedHeaderScopeCount > 0 && !allHeaderScopeRowsSelected;

  const headerSelectionLabel = hasActiveFilter
    ? `Select all ${formatNumber(headerSelectionIds.length)} filtered meters`
    : `Select all ${formatNumber(headerSelectionIds.length)} meters on this page`;

  function clearMapRowInteraction() {
    setHoveredMapMeterId("");
    setFocusedMapMeterId("");
  }

  function toggleGpsMap() {
    setShowGpsMap((current) => {
      if (current) clearMapRowInteraction();
      return !current;
    });
  }

  function updateFilter(key, value) {
    setCurrentPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function updateWardFilter(value) {
    clearMapRowInteraction();
    setCurrentPage(1);
    setWardGeofenceOptions([]);
    setFilters((current) => ({
      ...current,
      wardNo: value,
      geofenceId: "ALL",
    }));
  }

  const handleWardGeofencesChange = useCallback((nextGeofences = []) => {
    const byId = new Map();

    (Array.isArray(nextGeofences) ? nextGeofences : []).forEach((geofence) => {
      const id = String(geofence?.id || "").trim();
      const name = String(geofence?.name || id).trim();

      if (!id) return;

      byId.set(id, {
        id,
        name: name || id,
      });
    });

    const normalized = Array.from(byId.values()).sort((left, right) =>
      compareNatural(left.name, right.name),
    );

    setWardGeofenceOptions((current) => {
      const currentSignature = current
        .map((geofence) => `${geofence.id}::${geofence.name}`)
        .join("|");
      const nextSignature = normalized
        .map((geofence) => `${geofence.id}::${geofence.name}`)
        .join("|");

      return currentSignature === nextSignature ? current : normalized;
    });
  }, []);

  function updateGeofenceFilter(value) {
    clearMapRowInteraction();
    updateFilter("geofenceId", value);
  }

  function focusAddressOnMap(row) {
    const meterId = getRowMapMeterId(row);

    if (
      !showGpsMap ||
      filters.wardNo === "ALL" ||
      !meterId ||
      !rowHasGpsPointForWard(row, filters.wardNo)
    ) {
      return;
    }

    setFocusedMapMeterId(meterId);
    setMapFocusRequest((current) => current + 1);
  }

  function applyRangeFilter(filterKey, nextFilter) {
    setCurrentPage(1);
    setFilters((current) => ({
      ...current,
      salesRanges: {
        ...current.salesRanges,
        [filterKey]: nextFilter,
      },
    }));
    setActiveRangeFilterKey(null);
  }

  function clearRangeFilter(filterKey) {
    setCurrentPage(1);
    setFilters((current) => {
      const nextSalesRanges = { ...current.salesRanges };
      delete nextSalesRanges[filterKey];

      return {
        ...current,
        salesRanges: nextSalesRanges,
      };
    });
    setActiveRangeFilterKey(null);
  }

  function handleSort(sortKey) {
    setCurrentPage(1);
    setSortConfig((current) => {
      if (current.key !== sortKey) return { key: sortKey, direction: "asc" };
      if (current.direction === "asc") {
        return { key: sortKey, direction: "desc" };
      }
      return DEFAULT_SORT;
    });
  }

  function handlePageChange(nextPage) {
    const normalizedPage = Number(nextPage);
    const clampedPage = Math.max(
      1,
      Math.min(Number.isFinite(normalizedPage) ? normalizedPage : 1, totalPages),
    );
    setCurrentPage(clampedPage);
  }

  function handlePageSizeChange(nextPageSize) {
    const normalizedPageSize = Number(nextPageSize);
    const nextSize = PAGE_SIZE_OPTIONS.includes(normalizedPageSize)
      ? normalizedPageSize
      : DEFAULT_PAGE_SIZE;
    setPageSize(nextSize);
    setCurrentPage(1);
  }

  function toggleRow(rowId) {
    const nextSelected = new Set(selectedIdSet);

    if (nextSelected.has(rowId)) nextSelected.delete(rowId);
    else nextSelected.add(rowId);

    onSelectedIdsChange(nextSelected);
  }

  function toggleHeaderSelection() {
    const nextSelected = new Set(selectedIdSet);

    if (allHeaderScopeRowsSelected) {
      headerSelectionIds.forEach((id) => nextSelected.delete(id));
    } else {
      headerSelectionIds.forEach((id) => nextSelected.add(id));
    }

    onSelectedIdsChange(nextSelected);
  }

  function toggleColumn(columnKey) {
    const willHide = columnVisibility[columnKey] === true;

    setColumnVisibility((current) => ({
      ...current,
      [columnKey]: !current[columnKey],
    }));

    if (!willHide) return;

    setCurrentPage(1);
    setFilters((current) => {
      const nextSalesRanges = { ...current.salesRanges };
      delete nextSalesRanges[columnKey];

      return {
        ...current,
        wardNo: columnKey === "wardNo" ? "ALL" : current.wardNo,
        geofenceId:
          columnKey === "wardNo" || columnKey === "geofence"
            ? "ALL"
            : current.geofenceId,
        tbId: columnKey === "tbRefs" ? "ALL" : current.tbId,
        leakageCategory:
          columnKey === "leakageCategory"
            ? "ALL"
            : current.leakageCategory,
        riskTier: columnKey === "riskTier" ? "ALL" : current.riskTier,
        riskScore: columnKey === "riskScore" ? "" : current.riskScore,
        addressLine1:
          columnKey === "addressLine1" ? "" : current.addressLine1,
        town: columnKey === "town" ? "ALL" : current.town,
        sgCode: columnKey === "sgCode" ? "" : current.sgCode,
        erfNo: columnKey === "erfNo" ? "" : current.erfNo,
        salesRanges: nextSalesRanges,
      };
    });

    if (sortConfig.key === columnKey) setSortConfig(DEFAULT_SORT);
  }

  function resetColumnFilters() {
    clearMapRowInteraction();
    setFilters(EMPTY_FILTERS);
    setSortConfig(DEFAULT_SORT);
    setCurrentPage(1);
  }

  function getRangeFilterColumnLabel(filterKey) {
    const labels = {
      totalSalesC: "Total Sales",
      latest12MonthsSalesC: "Latest 12 Months",
      sales2024C: "Total Sales 2024",
      sales2025C: "Total Sales 2025",
      sales2026C: "Total Sales 2026",
    };

    if (labels[filterKey]) return labels[filterKey];

    return `${getMonthLabel(filterKey.slice("month:".length))} Sales`;
  }

  const totalColumnCount =
    2 + visibleConfigurableKeys.length + monthKeys.length;

  return (
    <section style={styles.panel}>
      <div style={styles.sectionHeader}>
        <div>
          <p style={styles.eyebrow}>Sales Meters</p>
          <h2 style={styles.sectionTitle}>Monthly meter vending history</h2>
          <p style={styles.sectionSubtitle}>
            {getTargetFilterLabel(targetFilter)} · {formatNumber(totalRows)} of{" "}
            {formatNumber(rows.length)} meters
          </p>
        </div>

        <div style={styles.headerActions}>
          <button
            type="button"
            style={styles.columnsButton}
            onClick={toggleGpsMap}
            aria-expanded={showGpsMap}
          >
            {showGpsMap ? "Hide GPS Map" : "Show GPS Map"}
          </button>
          <button
            type="button"
            style={styles.columnsButton}
            onClick={() => setShowColumnControls((current) => !current)}
          >
            {showColumnControls ? "Hide Column Controls" : "Show / Hide Columns"}
          </button>

          <button type="button" style={styles.resetButton} onClick={resetColumnFilters}>
            Reset Column Filters
          </button>
        </div>
      </div>

      {showColumnControls ? (
        <div style={styles.columnControls}>
          <div style={styles.fixedColumnsNote}>
            Always visible: Select, Meter Number and monthly totals
          </div>

          <div style={styles.columnToggleGrid}>
            {COLUMN_OPTIONS.map((option) => (
              <label key={option.key} style={styles.columnToggleLabel}>
                <input
                  type="checkbox"
                  checked={columnVisibility[option.key]}
                  onChange={() => toggleColumn(option.key)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {showGpsMap ? (
        <SalesGpsMapSection
          rows={filteredRows}
          lmPcode={salesLmPcode}
          wardOptions={wardOptions}
          selectedWardNo={filters.wardNo === "ALL" ? "" : filters.wardNo}
          selectedGeofenceId={
            filters.geofenceId === "ALL" ? "" : filters.geofenceId
          }
          onSelectedWardNoChange={(wardNo) =>
            updateWardFilter(wardNo || "ALL")
          }
          onSelectedGeofenceIdChange={(geofenceId) =>
            updateGeofenceFilter(geofenceId || "ALL")
          }
          onWardGeofencesChange={handleWardGeofencesChange}
          hoveredMeterId={hoveredMapMeterId}
          focusedMeterId={focusedMapMeterId}
          focusRequest={mapFocusRequest}
        />
      ) : null}
      <PaginationControls
        currentPage={safeCurrentPage}
        pageSize={pageSize}
        totalPages={totalPages}
        totalRows={totalRows}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
      />

      <div style={styles.tableWrap}>
        <table
          className="data-table"
          style={{
            ...styles.table,
            minWidth: `${fixedTableWidth + monthKeys.length * 122}px`,
          }}
        >
          <thead>
            <tr>
              <th style={{ ...styles.headerCell, ...getStickyStyle("select", stickyLayout, true) }}>
                <input
                  type="checkbox"
                  ref={(checkbox) => {
                    if (checkbox) checkbox.indeterminate = someHeaderScopeRowsSelected;
                  }}
                  checked={allHeaderScopeRowsSelected}
                  onChange={toggleHeaderSelection}
                  disabled={headerSelectionIds.length === 0}
                  aria-label={headerSelectionLabel}
                  title={headerSelectionLabel}
                />
              </th>

              <th style={{ ...styles.headerCell, ...getStickyStyle("meterNo", stickyLayout, true) }}>
                <SortButton
                  label="Meter Number"
                  sortKey="meterNo"
                  sortConfig={sortConfig}
                  onSort={handleSort}
                />
                <FilterInput
                  value={filters.meterNo}
                  onChange={(value) => updateFilter("meterNo", value)}
                  placeholder="Meter number"
                />
              </th>

              {columnVisibility.wardNo ? (
                <th style={{ ...styles.headerCell, ...getStickyStyle("wardNo", stickyLayout, true) }}>
                  <SortButton
                    label="Ward No"
                    sortKey="wardNo"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <select
                    value={filters.wardNo}
                    onChange={(event) =>
                      updateWardFilter(event.target.value)
                    }
                    style={styles.headerSelect}
                  >
                    <option value="ALL">All wards</option>
                    {wardOptions.map((wardNo) => (
                      <option key={wardNo} value={wardNo}>
                        Ward {wardNo}
                      </option>
                    ))}
                  </select>
                </th>
              ) : null}

              {columnVisibility.geofence ? (
                <th
                  style={{
                    ...styles.headerCell,
                    ...getStickyStyle("geofence", stickyLayout, true),
                  }}
                >
                  <SortButton
                    label="Geofences"
                    sortKey="geofence"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <select
                    value={filters.geofenceId}
                    onChange={(event) =>
                      updateGeofenceFilter(event.target.value)
                    }
                    style={styles.headerSelect}
                  >
                    <option value="ALL">All geofences</option>
                    <option value="NONE">No geofence</option>
                    {geofenceOptions.map((geofence) => (
                      <option key={geofence.id} value={geofence.id}>
                        {geofence.name}
                      </option>
                    ))}
                  </select>
                </th>
              ) : null}

              {columnVisibility.tbRefs ? (
                <th
                  style={{
                    ...styles.headerCell,
                    ...getStickyStyle("tbRefs", stickyLayout, true),
                  }}
                >
                  <SortButton
                    label="TB IDs"
                    sortKey="tbRefs"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <select
                    value={filters.tbId}
                    onChange={(event) =>
                      updateFilter("tbId", event.target.value)
                    }
                    style={styles.headerSelect}
                  >
                    <option value="ALL">All TBs</option>
                    <option value="NONE">No TB</option>
                    <option value="ANY">In one or more TBs</option>
                    {tbIdOptions.map((tbId) => (
                      <option key={tbId} value={tbId}>
                        {tbId}
                      </option>
                    ))}
                  </select>
                </th>
              ) : null}

              {columnVisibility.leakageCategory ? (
                <th
                  style={{
                    ...styles.headerCell,
                    ...getStickyStyle("leakageCategory", stickyLayout, true),
                  }}
                >
                  <SortButton
                    label="Sales Category"
                    sortKey="leakageCategory"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <select
                    value={filters.leakageCategory}
                    onChange={(event) =>
                      updateFilter("leakageCategory", event.target.value)
                    }
                    style={styles.headerSelect}
                  >
                    <option value="ALL">All categories</option>
                    {salesCategoryOptions.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </th>
              ) : null}

              {columnVisibility.riskTier ? (
                <th
                  style={{
                    ...styles.headerCell,
                    ...getStickyStyle("riskTier", stickyLayout, true),
                  }}
                >
                  <SortButton
                    label="Risk Tier"
                    sortKey="riskTier"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <select
                    value={filters.riskTier}
                    onChange={(event) =>
                      updateFilter("riskTier", event.target.value)
                    }
                    style={styles.headerSelect}
                  >
                    <option value="ALL">All risk tiers</option>
                    {riskTierOptions.map((riskTier) => (
                      <option key={riskTier} value={riskTier}>
                        {riskTier}
                      </option>
                    ))}
                  </select>
                </th>
              ) : null}

              {columnVisibility.riskScore ? (
                <th
                  style={{
                    ...styles.headerCell,
                    ...getStickyStyle("riskScore", stickyLayout, true),
                  }}
                >
                  <SortButton
                    label="Risk Score"
                    sortKey="riskScore"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <FilterInput
                    type="number"
                    min="0"
                    step="1"
                    value={filters.riskScore}
                    onChange={(value) => updateFilter("riskScore", value)}
                    placeholder="Exact score"
                  />
                </th>
              ) : null}

              {columnVisibility.addressLine1 ? (
                <th style={{ ...styles.headerCell, ...getStickyStyle("addressLine1", stickyLayout, true) }}>
                  <SortButton
                    label="Address"
                    sortKey="addressLine1"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <FilterInput
                    value={filters.addressLine1}
                    onChange={(value) => updateFilter("addressLine1", value)}
                    placeholder="Address"
                  />
                </th>
              ) : null}

              {columnVisibility.town ? (
                <th style={{ ...styles.headerCell, ...getStickyStyle("town", stickyLayout, true) }}>
                  <SortButton
                    label="Town"
                    sortKey="town"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <select
                    value={filters.town}
                    onChange={(event) => updateFilter("town", event.target.value)}
                    style={styles.headerSelect}
                  >
                    <option value="ALL">All towns</option>
                    {townOptions.map((town) => (
                      <option key={town} value={town}>
                        {town}
                      </option>
                    ))}
                  </select>
                </th>
              ) : null}

              {columnVisibility.sgCode ? (
                <th style={{ ...styles.headerCell, ...getStickyStyle("sgCode", stickyLayout, true) }}>
                  <SortButton
                    label="SG Code"
                    sortKey="sgCode"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <FilterInput
                    value={filters.sgCode}
                    onChange={(value) => updateFilter("sgCode", value)}
                    placeholder="SG code"
                  />
                </th>
              ) : null}

              {columnVisibility.erfNo ? (
                <th style={{ ...styles.headerCell, ...getStickyStyle("erfNo", stickyLayout, true) }}>
                  <SortButton
                    label="Erf No"
                    sortKey="erfNo"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <FilterInput
                    value={filters.erfNo}
                    onChange={(value) => updateFilter("erfNo", value)}
                    placeholder="Erf no"
                  />
                </th>
              ) : null}

              {columnVisibility.totalSalesC ? (
                <th style={{ ...styles.headerCell, ...getStickyStyle("totalSalesC", stickyLayout, true) }}>
                  <AggregateHeader
                    label="Total Sales"
                    columnKey="totalSalesC"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                    filter={filters.salesRanges?.totalSalesC}
                    onOpenFilter={() => setActiveRangeFilterKey("totalSalesC")}
                  />
                </th>
              ) : null}

              {columnVisibility.latest12MonthsSalesC ? (
                <th style={{ ...styles.headerCell, ...getStickyStyle("latest12MonthsSalesC", stickyLayout, true) }}>
                  <AggregateHeader
                    label="Latest 12 Months"
                    columnKey="latest12MonthsSalesC"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                    filter={filters.salesRanges?.latest12MonthsSalesC}
                    onOpenFilter={() => setActiveRangeFilterKey("latest12MonthsSalesC")}
                  />
                </th>
              ) : null}

              {columnVisibility.sales2024C ? (
                <th style={{ ...styles.headerCell, ...getStickyStyle("sales2024C", stickyLayout, true) }}>
                  <AggregateHeader
                    label="Total Sales 2024"
                    columnKey="sales2024C"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                    filter={filters.salesRanges?.sales2024C}
                    onOpenFilter={() => setActiveRangeFilterKey("sales2024C")}
                  />
                </th>
              ) : null}

              {columnVisibility.sales2025C ? (
                <th style={{ ...styles.headerCell, ...getStickyStyle("sales2025C", stickyLayout, true) }}>
                  <AggregateHeader
                    label="Total Sales 2025"
                    columnKey="sales2025C"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                    filter={filters.salesRanges?.sales2025C}
                    onOpenFilter={() => setActiveRangeFilterKey("sales2025C")}
                  />
                </th>
              ) : null}

              {columnVisibility.sales2026C ? (
                <th style={{ ...styles.headerCell, ...getStickyStyle("sales2026C", stickyLayout, true) }}>
                  <AggregateHeader
                    label="Total Sales 2026"
                    columnKey="sales2026C"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                    filter={filters.salesRanges?.sales2026C}
                    onOpenFilter={() => setActiveRangeFilterKey("sales2026C")}
                  />
                </th>
              ) : null}

              {monthKeys.map((monthKey) => (
                <th key={monthKey} style={styles.monthHeaderCell}>
                  <SortButton
                    label={getMonthLabel(monthKey)}
                    sortKey={`month:${monthKey}`}
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <SalesRangeFilterButton
                    filter={filters.salesRanges?.[`month:${monthKey}`]}
                    onClick={() => setActiveRangeFilterKey(`month:${monthKey}`)}
                  />
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {paginatedRows.length === 0 ? (
              <tr>
                <td colSpan={totalColumnCount} style={styles.noRowsCell}>
                  No sales meters match the current targeting and column filters.
                </td>
              </tr>
            ) : (
              paginatedRows.map((row) => (
                <tr key={row.id}>
                  <td style={{ ...styles.bodyCell, ...getStickyStyle("select", stickyLayout) }}>
                    <input
                      type="checkbox"
                      checked={selectedIdSet.has(row.id)}
                      onChange={() => toggleRow(row.id)}
                      aria-label={`Select meter ${row.meterNo}`}
                    />
                  </td>

                  <td style={{ ...styles.bodyCell, ...styles.meterCell, ...getStickyStyle("meterNo", stickyLayout) }}>
                    <button
                      type="button"
                      style={styles.meterLink}
                      onClick={() => setMapRow(row)}
                      title={`Open meter ${row.meterNo} on map`}
                    >
                      {row.meterNo || "NAv"}
                    </button>
                  </td>

                  {columnVisibility.wardNo ? (
                    <td style={{ ...styles.bodyCell, ...getStickyStyle("wardNo", stickyLayout) }} title={row.wardNumberLabel || "NAv"}>
                      {row.wardNumberLabel || "NAv"}
                    </td>
                  ) : null}

                  {columnVisibility.geofence ? (
                    <td
                      style={{
                        ...styles.bodyCell,
                        ...getStickyStyle("geofence", stickyLayout),
                      }}
                      title={getRowGeofenceLabel(row) || "No geofence"}
                    >
                      {getRowGeofenceLabel(row) || "No geofence"}
                    </td>
                  ) : null}

                  {columnVisibility.tbRefs ? (
                    <td
                      style={{
                        ...styles.bodyCell,
                        ...getStickyStyle("tbRefs", stickyLayout),
                        textAlign: "center",
                      }}
                    >
                      {getRowTbRefs(row).length > 0 ? (
                        <button
                          type="button"
                          onClick={() => setTbRefsRow(row)}
                          title={`Open Targeted Batch references for meter ${row.meterNo}`}
                          style={{
                            border: "1px solid #2563eb",
                            borderRadius: "999px",
                            padding: "0.32rem 0.58rem",
                            background: "#eff6ff",
                            color: "#1d4ed8",
                            fontSize: "0.75rem",
                            fontWeight: 900,
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {getTbCountLabel(row)}
                        </button>
                      ) : (
                        <span
                          style={{
                            color: "#94a3b8",
                            fontSize: "0.75rem",
                            fontWeight: 800,
                            whiteSpace: "nowrap",
                          }}
                        >
                          0 TBs
                        </span>
                      )}
                    </td>
                  ) : null}

                  {columnVisibility.leakageCategory ? (
                    <td
                      style={{
                        ...styles.bodyCell,
                        ...styles.categoryCell,
                        ...getStickyStyle("leakageCategory", stickyLayout),
                      }}
                      title={row.leakageCategory || "NAv"}
                    >
                      {row.leakageCategory || "NAv"}
                    </td>
                  ) : null}

                  {columnVisibility.riskTier ? (
                    <td
                      style={{
                        ...styles.bodyCell,
                        ...getStickyStyle("riskTier", stickyLayout),
                      }}
                    >
                      {row.riskTier || "NAv"}
                    </td>
                  ) : null}

                  {columnVisibility.riskScore ? (
                    <td
                      style={{
                        ...styles.bodyCell,
                        ...styles.numberCell,
                        ...getStickyStyle("riskScore", stickyLayout),
                      }}
                    >
                      {row.riskScore ?? "NAv"}
                    </td>
                  ) : null}

                  {columnVisibility.addressLine1 ? (() => {
                    const mapMeterId = getRowMapMeterId(row);
                    const canFocusAddressOnMap =
                      showGpsMap &&
                      filters.wardNo !== "ALL" &&
                      Boolean(mapMeterId) &&
                      rowHasGpsPointForWard(row, filters.wardNo);
                    const isFocusedAddress =
                      canFocusAddressOnMap &&
                      focusedMapMeterId === mapMeterId;

                    return (
                      <td
                        style={{
                          ...styles.bodyCell,
                          ...styles.addressCell,
                          ...getStickyStyle("addressLine1", stickyLayout),
                        }}
                        title={
                          canFocusAddressOnMap
                            ? `Hover to highlight and click to zoom to ${
                                row.addressLine1 || "this meter"
                              }`
                            : row.addressLine1 || "NAv"
                        }
                      >
                        {canFocusAddressOnMap ? (
                          <button
                            type="button"
                            style={{
                              ...styles.addressMapButton,
                              ...(isFocusedAddress
                                ? styles.addressMapButtonFocused
                                : null),
                            }}
                            onMouseEnter={() =>
                              setHoveredMapMeterId(mapMeterId)
                            }
                            onMouseLeave={() =>
                              setHoveredMapMeterId((current) =>
                                current === mapMeterId ? "" : current,
                              )
                            }
                            onFocus={() => setHoveredMapMeterId(mapMeterId)}
                            onBlur={() =>
                              setHoveredMapMeterId((current) =>
                                current === mapMeterId ? "" : current,
                              )
                            }
                            onClick={() => focusAddressOnMap(row)}
                            aria-label={`Zoom map to meter ${
                              row.meterNo || mapMeterId
                            } at ${row.addressLine1 || "the selected address"}`}
                          >
                            {row.addressLine1 || "NAv"}
                          </button>
                        ) : (
                          row.addressLine1 || "NAv"
                        )}
                      </td>
                    );
                  })() : null}

                  {columnVisibility.town ? (
                    <td style={{ ...styles.bodyCell, ...getStickyStyle("town", stickyLayout) }}>
                      {row.town || "NAv"}
                    </td>
                  ) : null}

                  {columnVisibility.sgCode ? (
                    <td style={{ ...styles.bodyCell, ...styles.sgCodeCell, ...getStickyStyle("sgCode", stickyLayout) }} title={row.sgCode || "NAv"}>
                      {row.sgCode || "NAv"}
                    </td>
                  ) : null}

                  {columnVisibility.erfNo ? (
                    <td style={{ ...styles.bodyCell, ...getStickyStyle("erfNo", stickyLayout) }} title={row.erfNo || "NAv"}>
                      {row.erfNo || "NAv"}
                    </td>
                  ) : null}

                  {columnVisibility.totalSalesC ? (
                    <td style={{ ...styles.bodyCell, ...styles.moneyCell, ...getStickyStyle("totalSalesC", stickyLayout) }}>
                      {formatCurrencyFromCents(row.totalSalesC)}
                    </td>
                  ) : null}

                  {columnVisibility.latest12MonthsSalesC ? (
                    <td style={{ ...styles.bodyCell, ...styles.moneyCell, ...getStickyStyle("latest12MonthsSalesC", stickyLayout) }}>
                      {formatCurrencyFromCents(row.latest12MonthsSalesC)}
                    </td>
                  ) : null}

                  {columnVisibility.sales2024C ? (
                    <td style={{ ...styles.bodyCell, ...styles.moneyCell, ...getStickyStyle("sales2024C", stickyLayout) }}>
                      {formatCurrencyFromCents(row.sales2024C)}
                    </td>
                  ) : null}

                  {columnVisibility.sales2025C ? (
                    <td style={{ ...styles.bodyCell, ...styles.moneyCell, ...getStickyStyle("sales2025C", stickyLayout) }}>
                      {formatCurrencyFromCents(row.sales2025C)}
                    </td>
                  ) : null}

                  {columnVisibility.sales2026C ? (
                    <td style={{ ...styles.bodyCell, ...styles.moneyCell, ...getStickyStyle("sales2026C", stickyLayout) }}>
                      {formatCurrencyFromCents(row.sales2026C)}
                    </td>
                  ) : null}

                  {monthKeys.map((monthKey) => (
                    <td key={monthKey} style={{ ...styles.bodyCell, ...styles.moneyCell }}>
                      {formatCurrencyFromCents(row?.monthlySalesC?.[monthKey] || 0)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PaginationControls
        currentPage={safeCurrentPage}
        pageSize={pageSize}
        totalPages={totalPages}
        totalRows={totalRows}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
      />

      {activeRangeFilterKey ? (
        <SalesRangeFilterModal
          columnLabel={getRangeFilterColumnLabel(activeRangeFilterKey)}
          filter={
            filters.salesRanges?.[activeRangeFilterKey] ||
            EMPTY_SALES_RANGE_FILTER
          }
          onApply={(nextFilter) =>
            applyRangeFilter(activeRangeFilterKey, nextFilter)
          }
          onClear={() => clearRangeFilter(activeRangeFilterKey)}
          onClose={() => setActiveRangeFilterKey(null)}
        />
      ) : null}

      {tbRefsRow ? (
        <SalesTbRefsModal
          row={tbRefsRow}
          onClose={() => setTbRefsRow(null)}
        />
      ) : null}

      {mapRow ? (
        <MeterLocationModal row={mapRow} onClose={() => setMapRow(null)} />
      ) : null}
    </section>
  );
}

const styles = {
  panel: {
    background: "#ffffff",
    border: "1px solid rgba(148, 163, 184, 0.26)",
    borderRadius: "1rem",
    boxShadow: "0 14px 30px rgba(15, 23, 42, 0.06)",
    overflow: "hidden",
  },
  sectionHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "1rem",
    flexWrap: "wrap",
  },
  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: "0.72rem",
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  sectionTitle: {
    margin: "0.2rem 0 0",
    color: "#0f172a",
    fontSize: "1.1rem",
  },
  sectionSubtitle: {
    margin: "0.35rem 0 0",
    color: "#64748b",
    fontSize: "0.86rem",
  },
  headerActions: {
    display: "flex",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  columnsButton: {
    border: "1px solid #2563eb",
    background: "#eff6ff",
    color: "#1d4ed8",
    borderRadius: "0.7rem",
    padding: "0.55rem 0.75rem",
    fontWeight: 850,
    cursor: "pointer",
  },
  resetButton: {
    border: "1px solid rgba(148, 163, 184, 0.45)",
    background: "#ffffff",
    color: "#334155",
    borderRadius: "0.7rem",
    padding: "0.55rem 0.75rem",
    fontWeight: 800,
    cursor: "pointer",
  },
  columnControls: {
    display: "grid",
    gap: "0.65rem",
    padding: "0.85rem 1rem",
    borderTop: "1px solid #e2e8f0",
    background: "#f8fafc",
  },
  fixedColumnsNote: {
    color: "#64748b",
    fontSize: "0.76rem",
    fontWeight: 750,
  },
  columnToggleGrid: {
    display: "flex",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  columnToggleLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    minHeight: "2.1rem",
    padding: "0.38rem 0.58rem",
    border: "1px solid #cbd5e1",
    borderRadius: "0.6rem",
    background: "#ffffff",
    color: "#334155",
    fontSize: "0.78rem",
    fontWeight: 800,
    cursor: "pointer",
  },
  tableWrap: {
    width: "100%",
    maxHeight: "64vh",
    overflow: "auto",
    borderTop: "1px solid rgba(148, 163, 184, 0.22)",
    borderBottom: "1px solid rgba(148, 163, 184, 0.22)",
  },
  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    fontSize: "0.82rem",
  },
  headerCell: {
    position: "sticky",
    top: 0,
    zIndex: 6,
    background: "#e2e8f0",
    color: "#0f172a",
    padding: "0.65rem",
    borderRight: "1px solid #cbd5e1",
    borderBottom: "1px solid #cbd5e1",
    textAlign: "left",
    verticalAlign: "top",
  },
  monthHeaderCell: {
    position: "sticky",
    top: 0,
    zIndex: 5,
    width: "122px",
    minWidth: "122px",
    maxWidth: "122px",
    background: "#e2e8f0",
    color: "#0f172a",
    padding: "0.65rem",
    borderRight: "1px solid #cbd5e1",
    borderBottom: "1px solid #cbd5e1",
    textAlign: "left",
    verticalAlign: "top",
  },
  sortButton: {
    width: "100%",
    border: 0,
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.4rem",
    padding: 0,
    fontWeight: 900,
    textAlign: "left",
  },
  rangeFilterButton: {
    width: "100%",
    minWidth: 0,
    minHeight: "2rem",
    marginTop: "0.4rem",
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    border: "1px solid #cbd5e1",
    borderRadius: "0.45rem",
    padding: "0.36rem 0.45rem",
    background: "#ffffff",
    color: "#475569",
    cursor: "pointer",
    boxSizing: "border-box",
    fontSize: "0.72rem",
    fontWeight: 800,
    textAlign: "left",
  },
  rangeFilterButtonActive: {
    borderColor: "#2563eb",
    background: "#eff6ff",
    color: "#1d4ed8",
  },
  rangeFilterCheckbox: {
    flex: "0 0 auto",
    fontSize: "0.85rem",
    lineHeight: 1,
  },
  rangeFilterLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  headerInput: {
    width: "100%",
    minWidth: 0,
    marginTop: "0.4rem",
    border: "1px solid #cbd5e1",
    borderRadius: "0.45rem",
    padding: "0.36rem 0.45rem",
    fontSize: "0.72rem",
    background: "#ffffff",
    boxSizing: "border-box",
  },
  headerSelect: {
    width: "100%",
    minWidth: 0,
    marginTop: "0.4rem",
    border: "1px solid #cbd5e1",
    borderRadius: "0.45rem",
    padding: "0.36rem 0.45rem",
    fontSize: "0.72rem",
    background: "#ffffff",
    boxSizing: "border-box",
  },
  bodyCell: {
    padding: "0.72rem 0.65rem",
    borderRight: "1px solid #e2e8f0",
    borderBottom: "1px solid #e2e8f0",
    color: "#334155",
    background: "#ffffff",
    verticalAlign: "top",
  },
  meterCell: {
    fontWeight: 850,
    color: "#0f172a",
    whiteSpace: "nowrap",
  },
  meterLink: {
    border: 0,
    padding: 0,
    background: "transparent",
    color: "#1d4ed8",
    font: "inherit",
    fontWeight: 900,
    textDecoration: "underline",
    textUnderlineOffset: "2px",
    cursor: "pointer",
  },
  categoryCell: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  addressCell: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  addressMapButton: {
    maxWidth: "100%",
    border: 0,
    padding: 0,
    background: "transparent",
    color: "#334155",
    font: "inherit",
    textAlign: "left",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    cursor: "pointer",
    textDecoration: "underline",
    textDecorationStyle: "dotted",
    textUnderlineOffset: "3px",
  },
  addressMapButtonFocused: {
    color: "#1d4ed8",
    fontWeight: 850,
    textDecorationStyle: "solid",
  },
  sgCodeCell: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  numberCell: {
    textAlign: "right",
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
  },
  moneyCell: {
    textAlign: "right",
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
  },
  noRowsCell: {
    padding: "2rem",
    color: "#64748b",
    textAlign: "center",
  },
  paginationBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "1rem",
    padding: "0.75rem 0.9rem",
    flexWrap: "wrap",
  },
  paginationSummary: {
    color: "#64748b",
    fontSize: "0.82rem",
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
    color: "#64748b",
    fontSize: "0.82rem",
    fontWeight: 700,
  },
  pageSizeSelect: {
    border: "1px solid rgba(148, 163, 184, 0.45)",
    borderRadius: "0.55rem",
    padding: "0.34rem 0.45rem",
    fontSize: "0.82rem",
  },
  paginationButton: {
    border: "1px solid rgba(148, 163, 184, 0.42)",
    background: "#fff",
    color: "#0f172a",
    borderRadius: "0.6rem",
    padding: "0.36rem 0.58rem",
    fontWeight: 800,
    cursor: "pointer",
  },
  pageCountLabel: {
    color: "#334155",
    fontSize: "0.82rem",
    fontWeight: 800,
    padding: "0 0.2rem",
  },
};
