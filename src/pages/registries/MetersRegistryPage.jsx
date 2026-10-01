/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "../../context/GeoContext";
import { useGetRegistryMetersByWardQuery } from "../../redux/registryMetersApi";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";
// DR-R001 3.1, 3.2 and 3.3: Credit control is launched from this register.
import {
  useCheckMeterRegistrationMutation,
  useGetMeterByIdQuery,
  useGetPremiseByIdQuery,
} from "../../redux/creditControlApi";
import BoundaryMapModal from "./components/BoundaryMapModal";
import MeterDeepDetailsModal from "./components/MeterDeepDetailsModal";
import MeterNoAccessHistoryModal from "./components/MeterNoAccessHistoryModal";
import RegistrationGuardModal from "./components/RegistrationGuardModal";
import {
  DatetimeFilterButton,
  DatetimeFilterModal,
} from "../../components/DatetimeFilter";
import DownloadButtons from "../../components/DownloadButtons";

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 5;

const EMPTY_METER_FILTERS = {
  meterNo: "",
  meterType: "ALL",
  meterKind: "ALL",
  meterPhase: "ALL",
  visibility: "ALL",
  status: "ALL",
  erfNo: "",
  premiseAddress: "",
  premiseType: "",
  // DR-R001 3.2 and 3.3: the office asks "never disconnected", "disconnected
  // more than once", "nobody could get in" — so each count filters on its own.
  noAccessCount: "ALL",
  disconnectionCount: "ALL",
  reconnectionCount: "ALL",
};

// DR-R001 section 4: a Manager and a supervisor launch this work. Nobody else
// sees the Credit control columns.
const CREDIT_CONTROL_ROLES = ["MNG", "SPV"];

function readMeterCount(row, key) {
  const value = Number(row?.counts?.[key]);

  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function matchesCountFilter(count, filterValue) {
  if (filterValue === "NONE") return count === 0;
  if (filterValue === "SOME") return count > 0;
  if (filterValue === "MANY") return count > 1;

  return true;
}

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

function getWardLabel(ward) {
  if (!ward) return "NAv";
  return `Ward ${ward.wardNumber}`;
}

function getMeterTypeLabel(meterType) {
  if (meterType === "electricity") return "Electricity";
  if (meterType === "water") return "Water";
  return meterType || "NAv";
}

function getRegistryLabel(value) {
  const text = String(value || "")
    .trim()
    .replace(/[_-]+/g, " ");

  if (!text || text === "NAv") return "NAv";

  return text
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function getMeterKindLabel(meterKind) {
  return getRegistryLabel(meterKind);
}

function getMeterPhaseLabel(meterPhase) {
  return getRegistryLabel(meterPhase);
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

function getWardNumberFromPcode(wardPcode = "") {
  const match = String(wardPcode || "").match(/(\d{1,3})$/);
  const numberValue = Number(match?.[1] || 0);

  return Number.isFinite(numberValue) ? numberValue : 0;
}

function getSelectedWardPcodeFromGeo(geoState) {
  const selectedWard = geoState?.selectedWard || null;

  return (
    selectedWard?.id || selectedWard?.pcode || selectedWard?.wardPcode || ""
  );
}

function buildRegistryWardSelection(ward, fallbackWardPcode = "") {
  const wardPcode =
    ward?.wardPcode || ward?.pcode || ward?.id || fallbackWardPcode || "";

  if (!wardPcode) return null;

  const wardNumber =
    ward?.wardNumber ||
    ward?.code ||
    getWardNumberFromPcode(wardPcode) ||
    "NAv";

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

function compareNatural(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;

  return String(a || "").localeCompare(String(b || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function buildFilterOptions(rows, key) {
  return Array.from(
    new Set(
      rows
        .map((row) => row?.[key])
        .filter((value) => value && value !== "NAv"),
    ),
  ).sort(compareNatural);
}

// A cell that opens something. The same look the TRN Registry gives its own.
function CellButton({ children, onClick, title }) {
  return (
    <button type="button" style={styles.cellButton} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

// Disconnect and Reconnect. A greyed button says why when you hover it, the way
// Unallocate does on the TB Register (DR-R001 3.2 and section 6).
function WorkButton({ children, onClick, disabled, busy, title }) {
  return (
    <button
      type="button"
      style={disabled ? styles.workButtonDisabled : styles.workButton}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {busy ? "Checking…" : children}
    </button>
  );
}

function getSortValue(row, key) {
  if (key === "meterNo") return row.meterNo || "";
  if (key === "meterType") return getMeterTypeLabel(row.meterType);
  if (key === "meterKind") return getMeterKindLabel(row.meterKind);
  if (key === "meterPhase") return getMeterPhaseLabel(row.meterPhase);
  if (key === "visibility") return row.visibility || "";
  if (key === "status") return row.statusState || row.status || "";
  if (key === "erfNo") return row.erfNo || "";
  if (key === "premiseAddress") return row.premiseAddress || "";
  if (key === "premiseType") return row.premisePropertyType || "";
  if (key === "updatedAt") return getUpdatedAtMs(row.updatedAt);

  // DR-R001 3.2 and 3.3: the meter's own numbers sort as numbers.
  if (key === "noAccessCount") return readMeterCount(row, "noAccess");
  if (key === "disconnectionCount") return readMeterCount(row, "disconnections");
  if (key === "reconnectionCount") return readMeterCount(row, "reconnections");

  return "";
}

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
    >
      <span>{label}</span>
      <span>{directionLabel}</span>
    </button>
  );
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
      <div className="muted">
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

function startOfDay(date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0,
  );
}

function endOfDay(date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  );
}

function addDays(date, days) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    0,
    0,
    0,
    0,
  );
}

function parseDateOnly(value) {
  if (!value) return null;

  const [year, month, day] = String(value).split("-").map(Number);

  if (!year || !month || !day) return null;

  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getUpdatedAtFilterRange(filter = EMPTY_UPDATED_AT_FILTER) {
  const mode = filter?.mode || "ALL";
  const now = new Date();
  const todayStart = startOfDay(now);

  if (mode === "TODAY") {
    return { start: todayStart, end: endOfDay(now) };
  }

  if (mode === "YESTERDAY") {
    const yesterday = addDays(todayStart, -1);
    return { start: startOfDay(yesterday), end: endOfDay(yesterday) };
  }

  if (mode === "PAST_3_DAYS") {
    return { start: addDays(todayStart, -2), end: endOfDay(now) };
  }

  if (mode === "THIS_WEEK") {
    const sunday = addDays(todayStart, -todayStart.getDay());
    const saturday = addDays(sunday, 6);
    return { start: startOfDay(sunday), end: endOfDay(saturday) };
  }

  if (mode === "THIS_MONTH") {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const lastDay = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );
    return { start: firstDay, end: lastDay };
  }

  if (mode === "CUSTOM") {
    const startDate = parseDateOnly(filter?.startDate);
    const endDate = parseDateOnly(filter?.endDate);

    return {
      start: startDate ? startOfDay(startDate) : null,
      end: endDate ? endOfDay(endDate) : null,
    };
  }

  return { start: null, end: null };
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

export default function MetersRegistryPage() {
  const { activeWorkbase, role } = useAuth();
  const { geoState, updateGeo } = useGeo();
  const navigate = useNavigate();

  // DR-R001 section 4 and 3.2.
  const canLaunchCreditControl = CREDIT_CONTROL_ROLES.includes(
    String(role || "").toUpperCase(),
  );

  const [meterDetailsId, setMeterDetailsId] = useState(null);
  const [mapView, setMapView] = useState(null);
  const [noAccessMeter, setNoAccessMeter] = useState(null);
  const [guardRefusal, setGuardRefusal] = useState(null);
  const [checkingMeterId, setCheckingMeterId] = useState(null);

  const [checkMeterRegistration] = useCheckMeterRegistrationMutation();

  // The pins for the map window: the meter's own position, and its premise.
  const { data: pinMeter } = useGetMeterByIdQuery(mapView?.meterId ?? skipToken);
  const { data: pinPremise } = useGetPremiseByIdQuery(
    mapView?.premiseId ?? skipToken,
  );

  const mapPins = useMemo(() => {
    const pins = [];

    const premiseLat = Number(
      pinPremise?.location?.lat ?? pinPremise?.gps?.lat,
    );
    const premiseLng = Number(
      pinPremise?.location?.lng ?? pinPremise?.gps?.lng,
    );

    if (Number.isFinite(premiseLat) && Number.isFinite(premiseLng)) {
      pins.push({
        kind: "PREMISE",
        lat: premiseLat,
        lng: premiseLng,
        label: pinPremise?.address || "Premise",
      });
    }

    const meterLat = Number(pinMeter?.ast?.location?.lat);
    const meterLng = Number(pinMeter?.ast?.location?.lng);

    if (Number.isFinite(meterLat) && Number.isFinite(meterLng)) {
      pins.push({
        kind: "METER",
        lat: meterLat,
        lng: meterLng,
        label: pinMeter?.ast?.astData?.astNo || "Meter",
      });
    }

    return pins;
  }, [pinMeter, pinPremise]);

  // DR-R001 3.1: the guard runs before the window opens, so a meter iREPS
  // cannot account for never reaches a worker. The same check runs again on
  // the server when the work is issued.
  async function launchCreditControl(row, work) {
    if (checkingMeterId) return;

    setCheckingMeterId(row.id);

    try {
      const outcome = await checkMeterRegistration(row.id).unwrap();

      if (outcome?.success) {
        navigate(`/operations/credit-control/${row.id}/${work}`);
        return;
      }

      setGuardRefusal({
        meterId: row.id,
        meterNo: row.meterNo,
        message: outcome?.message,
        checks: outcome?.data?.checks || outcome?.checks || [],
      });
    } catch (error) {
      setGuardRefusal({
        meterId: row.id,
        meterNo: row.meterNo,
        message:
          "This meter could not be checked, so nothing has been sent out. Try again.",
        checks: [],
      });
    } finally {
      setCheckingMeterId(null);
    }
  }

  const selectedWardPcode = getSelectedWardPcodeFromGeo(geoState);
  const [sortConfig, setSortConfig] = useState({
    key: "updatedAt",
    direction: "desc",
  });
  const [filters, setFilters] = useState(EMPTY_METER_FILTERS);
  const [updatedAtFilter, setUpdatedAtFilter] = useState(
    EMPTY_UPDATED_AT_FILTER,
  );
  const [isUpdatedAtFilterOpen, setIsUpdatedAtFilterOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

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
    const registryWard =
      wardRows.find((ward) => ward.wardPcode === selectedWardPcode) || null;
    return buildRegistryWardSelection(registryWard, selectedWardPcode);
  }, [wardRows, selectedWardPcode]);

  const effectiveSelectedWardPcode = selectedWard?.wardPcode || "";

  const {
    data: meterRows = [],
    isLoading,
    isFetching,
    error,
  } = useGetRegistryMetersByWardQuery(effectiveSelectedWardPcode || skipToken);
  const meterKindOptions = useMemo(
    () => buildFilterOptions(meterRows, "meterKind"),
    [meterRows],
  );

  const meterPhaseOptions = useMemo(
    () => buildFilterOptions(meterRows, "meterPhase"),
    [meterRows],
  );

  const filteredMeterRows = useMemo(() => {
    return meterRows.filter((row) => {
      const statusText = row.statusState || row.status || "NAv";

      return (
        includesText(row.meterNo, filters.meterNo) &&
        (filters.meterType === "ALL" ||
          String(row.meterType || "").toLowerCase() ===
            filters.meterType.toLowerCase()) &&
        (filters.meterKind === "ALL" ||
          String(row.meterKind || "").toLowerCase() ===
            filters.meterKind.toLowerCase()) &&
        (filters.meterPhase === "ALL" ||
          String(row.meterPhase || "").toLowerCase() ===
            filters.meterPhase.toLowerCase()) &&
        (filters.visibility === "ALL" ||
          String(row.visibility || "").toUpperCase() === filters.visibility) &&
        (filters.status === "ALL" ||
          String(statusText || "").toUpperCase() === filters.status) &&
        includesText(row.erfNo, filters.erfNo) &&
        includesText(
          `${row.premiseAddress || ""} ${row.premiseId || ""}`,
          filters.premiseAddress,
        ) &&
        includesText(row.premisePropertyType, filters.premiseType) &&
        matchesCountFilter(
          readMeterCount(row, "noAccess"),
          filters.noAccessCount,
        ) &&
        matchesCountFilter(
          readMeterCount(row, "disconnections"),
          filters.disconnectionCount,
        ) &&
        matchesCountFilter(
          readMeterCount(row, "reconnections"),
          filters.reconnectionCount,
        ) &&
        matchesUpdatedAtFilter(row.updatedAt, updatedAtFilter)
      );
    });
  }, [meterRows, filters, updatedAtFilter]);

  const sortedMeterRows = useMemo(() => {
    const rows = [...filteredMeterRows];

    rows.sort((a, b) => {
      const comparison = compareNatural(
        getSortValue(a, sortConfig.key),
        getSortValue(b, sortConfig.key),
      );
      return sortConfig.direction === "asc" ? comparison : -comparison;
    });

    return rows;
  }, [filteredMeterRows, sortConfig]);

  const totalRows = sortedMeterRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safeCurrentPage = Math.max(1, Math.min(currentPage, totalPages));
  const pageStartIndex = totalRows === 0 ? 0 : (safeCurrentPage - 1) * pageSize;
  const pageEndIndex = Math.min(pageStartIndex + pageSize, totalRows);
  const paginatedMeterRows = useMemo(() => {
    return sortedMeterRows.slice(pageStartIndex, pageEndIndex);
  }, [sortedMeterRows, pageStartIndex, pageEndIndex]);

  const totals = sortedMeterRows.reduce(
    (accumulator, row) => {
      if (row.meterType === "electricity") accumulator.electricity += 1;
      if (row.meterType === "water") accumulator.water += 1;
      if (row.visibility === "VISIBLE") accumulator.visible += 1;
      if (row.visibility === "INVISIBLE") accumulator.invisible += 1;
      return accumulator;
    },
    { electricity: 0, water: 0, visible: 0, invisible: 0 },
  );

  const quickDownloadColumns = useMemo(
    () => [
      {
        header: "Meter No",
        value: (row) => row.meterNo || "NAv",
      },
      {
        header: "Type",
        value: (row) => getMeterTypeLabel(row.meterType),
      },
      {
        header: "Kind",
        value: (row) => getMeterKindLabel(row.meterKind),
      },
      {
        header: "Phase",
        value: (row) => getMeterPhaseLabel(row.meterPhase),
      },
      {
        header: "Visibility",
        value: (row) => row.visibility || "NAv",
      },
      {
        header: "Status",
        value: (row) => row.statusState || row.status || "NAv",
      },
      {
        header: "ERF No",
        value: (row) => row.erfNo || "NAv",
      },
      {
        header: "Premise Address",
        value: (row) => {
          const address = row.premiseAddress || "NAv";
          const premiseId = row.premiseId || "NAv";
          return `${address}
${premiseId}`;
        },
      },
      {
        header: "Premise Type",
        value: (row) => row.premisePropertyType || "NAv",
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
      lmName: activeWorkbaseName,
      lmPcode: activeLmPcode || "NAv",
      wardLabel: getWardLabel(selectedWard),
      wardPcode: effectiveSelectedWardPcode || "NAv",
    }),
    [
      activeWorkbaseName,
      activeLmPcode,
      selectedWard,
      effectiveSelectedWardPcode,
    ],
  );

  function updateFilter(key, value) {
    setCurrentPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function handleSort(sortKey) {
    setCurrentPage(1);
    setSortConfig((current) => {
      if (current.key !== sortKey) return { key: sortKey, direction: "asc" };
      if (current.direction === "asc")
        return { key: sortKey, direction: "desc" };
      return { key: "updatedAt", direction: "desc" };
    });
  }

  function resetMeterRegistryControls() {
    setFilters(EMPTY_METER_FILTERS);
    setUpdatedAtFilter(EMPTY_UPDATED_AT_FILTER);
    setSortConfig({ key: "updatedAt", direction: "desc" });
    setCurrentPage(1);
  }

  function handlePageChange(nextPage) {
    const normalizedPage = Number(nextPage);
    const clampedPage = Math.max(
      1,
      Math.min(
        Number.isFinite(normalizedPage) ? normalizedPage : 1,
        totalPages,
      ),
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

  function handleWardChange(event) {
    const nextWardPcode = event.target.value;
    const nextWard =
      wardRows.find((ward) => ward.wardPcode === nextWardPcode) || null;

    resetMeterRegistryControls();

    updateGeo({
      selectedWard: buildRegistryWardSelection(nextWard, nextWardPcode),
      lastSelectionType: nextWardPcode ? "WARD" : null,
    });
  }

  return (
    <>
      <header className="console-header" style={styles.fixedRegistryHeader}>
        <div>
          <h1>Meter Registry</h1>

          <p className="muted">Showing backend-shaped meter registry rows.</p>

          <Link className="text-link" to="/registries">
            ← Back to Registries
          </Link>
        </div>

        <div className="topbar-right">
          <div className="workbase-pill">{activeWorkbaseName}</div>
          <div className="role-pill">{role || "NAv"}</div>
          <div className="role-pill">
            {isFetching
              ? "Streaming..."
              : `${formatNumber(sortedMeterRows.length)} meters`}
          </div>
          <DownloadButtons
            registryName="Meter Registry"
            rowsLabel="meters"
            visibleRows={sortedMeterRows}
            columns={quickDownloadColumns}
            fileBaseName="meters_registry"
            scope={quickDownloadScope}
          />
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
          <span>Filtered Rows</span>
          <strong>{formatNumber(sortedMeterRows.length)}</strong>
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
          <>
            <PaginationControls
              currentPage={safeCurrentPage}
              pageSize={pageSize}
              totalPages={totalPages}
              totalRows={totalRows}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  {canLaunchCreditControl ? (
                    <tr>
                      <th colSpan={11} style={styles.groupHeaderSpacer} />
                      <th colSpan={4} style={styles.creditControlGroup}>
                        Credit control
                      </th>
                    </tr>
                  ) : null}
                  <tr>
                  <th>
                    <SortButton
                      label="Meter No"
                      sortKey="meterNo"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.meterNo}
                      onChange={(value) => updateFilter("meterNo", value)}
                      placeholder="Meter no"
                    />
                  </th>
                  <th>
                    <SortButton
                      label="Type"
                      sortKey="meterType"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterSelect
                      value={filters.meterType}
                      onChange={(value) => updateFilter("meterType", value)}
                    >
                      <option value="ALL">All</option>
                      <option value="electricity">Electricity</option>
                      <option value="water">Water</option>
                    </FilterSelect>
                  </th>
                  <th>
                    <SortButton
                      label="Kind"
                      sortKey="meterKind"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterSelect
                      value={filters.meterKind}
                      onChange={(value) => updateFilter("meterKind", value)}
                    >
                      <option value="ALL">All</option>
                      {meterKindOptions.map((meterKind) => (
                        <option key={meterKind} value={meterKind}>
                          {getMeterKindLabel(meterKind)}
                        </option>
                      ))}
                    </FilterSelect>
                  </th>
                  <th>
                    <SortButton
                      label="Phase"
                      sortKey="meterPhase"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterSelect
                      value={filters.meterPhase}
                      onChange={(value) => updateFilter("meterPhase", value)}
                    >
                      <option value="ALL">All</option>
                      {meterPhaseOptions.map((meterPhase) => (
                        <option key={meterPhase} value={meterPhase}>
                          {getMeterPhaseLabel(meterPhase)}
                        </option>
                      ))}
                    </FilterSelect>
                  </th>
                  <th>
                    <SortButton
                      label="Visibility"
                      sortKey="visibility"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterSelect
                      value={filters.visibility}
                      onChange={(value) => updateFilter("visibility", value)}
                    >
                      <option value="ALL">All</option>
                      <option value="VISIBLE">Visible</option>
                      <option value="INVISIBLE">Invisible</option>
                    </FilterSelect>
                  </th>
                  <th>
                    <SortButton
                      label="Status"
                      sortKey="status"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterSelect
                      value={filters.status}
                      onChange={(value) => updateFilter("status", value)}
                    >
                      <option value="ALL">All</option>
                      <option value="FIELD">FIELD</option>
                      <option value="CONNECTED">CONNECTED</option>
                      <option value="DISCONNECTED">DISCONNECTED</option>
                      <option value="REMOVED">REMOVED</option>
                      <option value="DECOMMISSIONED">DECOMMISSIONED</option>
                    </FilterSelect>
                  </th>
                  <th>
                    <SortButton
                      label="ERF No"
                      sortKey="erfNo"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.erfNo}
                      onChange={(value) => updateFilter("erfNo", value)}
                      placeholder="ERF"
                    />
                  </th>
                  <th>
                    <SortButton
                      label="Premise Address"
                      sortKey="premiseAddress"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.premiseAddress}
                      onChange={(value) =>
                        updateFilter("premiseAddress", value)
                      }
                      placeholder="Address / ID"
                    />
                  </th>
                  <th>
                    <SortButton
                      label="Premise Type"
                      sortKey="premiseType"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.premiseType}
                      onChange={(value) => updateFilter("premiseType", value)}
                      placeholder="Type"
                    />
                  </th>
                  <th>
                    <SortButton
                      label="updatedAt"
                      sortKey="updatedAt"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <DatetimeFilterButton
                      filter={updatedAtFilter}
                      onClick={() => setIsUpdatedAtFilterOpen(true)}
                    />
                  </th>

                  {canLaunchCreditControl ? (
                    <>
                      {/* DR-R001 3.3: can anyone even get to this meter, read
                          before send somebody to it. Its own column, outside
                          the Credit control group. */}
                      <th>
                        <SortButton
                          label="No Access"
                          sortKey="noAccessCount"
                          sortConfig={sortConfig}
                          onSort={handleSort}
                        />
                        <FilterSelect
                          value={filters.noAccessCount}
                          onChange={(value) =>
                            updateFilter("noAccessCount", value)
                          }
                        >
                          <option value="ALL">All</option>
                          <option value="NONE">Never refused</option>
                          <option value="SOME">Refused at least once</option>
                          <option value="MANY">Refused more than once</option>
                        </FilterSelect>
                      </th>

                      <th>
                        <SortButton
                          label="Disconnections"
                          sortKey="disconnectionCount"
                          sortConfig={sortConfig}
                          onSort={handleSort}
                        />
                        <FilterSelect
                          value={filters.disconnectionCount}
                          onChange={(value) =>
                            updateFilter("disconnectionCount", value)
                          }
                        >
                          <option value="ALL">All</option>
                          <option value="NONE">Never disconnected</option>
                          <option value="SOME">Disconnected at least once</option>
                          <option value="MANY">Disconnected more than once</option>
                        </FilterSelect>
                      </th>
                      <th aria-label="Disconnect" />

                      <th>
                        <SortButton
                          label="Reconnections"
                          sortKey="reconnectionCount"
                          sortConfig={sortConfig}
                          onSort={handleSort}
                        />
                        <FilterSelect
                          value={filters.reconnectionCount}
                          onChange={(value) =>
                            updateFilter("reconnectionCount", value)
                          }
                        >
                          <option value="ALL">All</option>
                          <option value="NONE">Never reconnected</option>
                          <option value="SOME">Reconnected at least once</option>
                          <option value="MANY">Reconnected more than once</option>
                        </FilterSelect>
                      </th>
                      <th aria-label="Reconnect" />
                    </>
                  ) : null}
                </tr>
              </thead>

                <tbody>
                  {sortedMeterRows.length === 0 ? (
                    <tr>
                      <td colSpan={canLaunchCreditControl ? 15 : 10} className="muted">
                        No meters match the current filters. Clear or adjust a
                        column filter above.
                      </td>
                    </tr>
                  ) : (
                    paginatedMeterRows.map((row) => {
                      const statusState = String(
                        row.statusState || row.status || "NAv",
                      ).toUpperCase();

                      const canDisconnect = statusState === "CONNECTED";
                      const canReconnect = statusState === "DISCONNECTED";
                      const isChecking = checkingMeterId === row.id;

                      return (
                      <tr key={row.id}>
                        <td>
                          {/* The TRN Registry's own windows, brought across. */}
                          <CellButton
                            onClick={() => setMeterDetailsId(row.id)}
                            title="Meter details"
                          >
                            {row.meterNo}
                          </CellButton>
                        </td>
                        <td>{getMeterTypeLabel(row.meterType)}</td>
                        <td>{getMeterKindLabel(row.meterKind)}</td>
                        <td>{getMeterPhaseLabel(row.meterPhase)}</td>
                        <td>{row.visibility}</td>
                        <td>{statusState}</td>
                        <td>
                          <CellButton
                            onClick={() =>
                              setMapView({
                                erfId: row.erfId,
                                erfNo: row.erfNo,
                                wardPcode: row?.parents?.wardPcode,
                              })
                            }
                            title="Where this ERF is"
                          >
                            {row.erfNo}
                          </CellButton>
                        </td>
                        <td>
                          <CellButton
                            onClick={() =>
                              setMapView({
                                erfId: row.erfId,
                                erfNo: row.erfNo,
                                wardPcode: row?.parents?.wardPcode,
                                premiseId: row.premiseId,
                                meterId: row.id,
                              })
                            }
                            title="Where this premise and its meter are"
                          >
                            <strong>{row.premiseAddress || "NAv"}</strong>
                          </CellButton>
                          <div className="muted" style={styles.smallMuted}>
                            {row.premiseId || "NAv"}
                          </div>
                        </td>
                        <td>{row.premisePropertyType}</td>
                        <td>{formatUpdatedAt(row.updatedAt)}</td>

                        {canLaunchCreditControl ? (
                          <>
                            <td>
                              <CellButton
                                onClick={() =>
                                  setNoAccessMeter({
                                    id: row.id,
                                    meterNo: row.meterNo,
                                    premiseAddress: row.premiseAddress,
                                  })
                                }
                                title="Every visit that could not reach this meter"
                              >
                                {readMeterCount(row, "noAccess")}
                              </CellButton>
                            </td>

                            <td style={styles.countCell}>
                              {readMeterCount(row, "disconnections")}
                            </td>
                            <td>
                              <WorkButton
                                disabled={!canDisconnect || isChecking}
                                busy={isChecking}
                                title={
                                  canDisconnect
                                    ? "Send a disconnection for this meter"
                                    : statusState === "DISCONNECTED"
                                      ? "This meter is already disconnected"
                                      : "This meter is out of service"
                                }
                                onClick={() =>
                                  launchCreditControl(row, "disconnect")
                                }
                              >
                                Disconnect
                              </WorkButton>
                            </td>

                            <td style={styles.countCell}>
                              {readMeterCount(row, "reconnections")}
                            </td>
                            <td>
                              <WorkButton
                                disabled={!canReconnect || isChecking}
                                busy={isChecking}
                                title={
                                  canReconnect
                                    ? "Send a reconnection for this meter"
                                    : statusState === "CONNECTED"
                                      ? "This meter is already connected"
                                      : "This meter is out of service"
                                }
                                onClick={() =>
                                  launchCreditControl(row, "reconnect")
                                }
                              >
                                Reconnect
                              </WorkButton>
                            </td>
                          </>
                        ) : null}
                      </tr>
                      );
                    })
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
          </>
        ) : null}
      </section>

      {isUpdatedAtFilterOpen ? (
        <DatetimeFilterModal
          filter={updatedAtFilter}
          onApply={(nextFilter) => {
            setCurrentPage(1);
            setUpdatedAtFilter(nextFilter);
            setIsUpdatedAtFilterOpen(false);
          }}
          onClear={() => {
            setCurrentPage(1);
            setUpdatedAtFilter(EMPTY_UPDATED_AT_FILTER);
            setIsUpdatedAtFilterOpen(false);
          }}
          onClose={() => setIsUpdatedAtFilterOpen(false)}
        />
      ) : null}

      {/* The windows this register opens: the meter itself, where it is, its
          No Access history, and the refusal when iREPS cannot account for it
          (DR-R001 3.1, 3.2 and 3.3). */}
      {meterDetailsId ? (
        <MeterDeepDetailsModal
          meterId={meterDetailsId}
          onClose={() => setMeterDetailsId(null)}
        />
      ) : null}

      {mapView ? (
        <BoundaryMapModal
          mode="ERF"
          erfId={mapView.erfId}
          erfNo={mapView.erfNo}
          wardPcode={mapView.wardPcode}
          pins={mapPins}
          onClose={() => setMapView(null)}
        />
      ) : null}

      {noAccessMeter ? (
        <MeterNoAccessHistoryModal
          meterId={noAccessMeter.id}
          meterNo={noAccessMeter.meterNo}
          premiseAddress={noAccessMeter.premiseAddress}
          onClose={() => setNoAccessMeter(null)}
        />
      ) : null}

      {guardRefusal ? (
        <RegistrationGuardModal
          meterId={guardRefusal.meterId}
          meterNo={guardRefusal.meterNo}
          message={guardRefusal.message}
          checks={guardRefusal.checks}
          onClose={() => setGuardRefusal(null)}
        />
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
    paddingRight: "1.25rem",
    paddingBottom: "0.85rem",
    paddingLeft: "1.25rem",
    boxSizing: "border-box",
    boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
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
  smallMuted: {
    fontSize: "0.72rem",
    marginTop: "0.25rem",
  },
  groupHeaderSpacer: {
    borderBottom: 0,
    background: "transparent",
  },
  creditControlGroup: {
    textAlign: "center",
    fontSize: "0.72rem",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#b45309",
    background: "#fff7ed",
  },
  countCell: {
    fontVariantNumeric: "tabular-nums",
    textAlign: "right",
    paddingRight: "0.6rem",
  },
  cellButton: {
    background: "transparent",
    border: 0,
    padding: 0,
    color: "#1d4ed8",
    cursor: "pointer",
    font: "inherit",
    textAlign: "left",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  },
  workButton: {
    border: "1px solid #b45309",
    background: "#b45309",
    color: "#fff",
    borderRadius: "6px",
    padding: "4px 10px",
    fontSize: "0.78rem",
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  workButtonDisabled: {
    border: "1px solid #cbd5e1",
    background: "#f1f5f9",
    color: "#94a3b8",
    borderRadius: "6px",
    padding: "4px 10px",
    fontSize: "0.78rem",
    fontWeight: 600,
    cursor: "not-allowed",
    whiteSpace: "nowrap",
  },
  paginationBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "1rem",
    padding: "0.75rem 0.9rem",
    flexWrap: "wrap",
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
