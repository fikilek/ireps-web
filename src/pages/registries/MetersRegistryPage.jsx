/* eslint-disable no-unused-vars -- JSX tags are consumed by React; this ESLint profile does not track them. */
import { irepsTableDateRange as getUpdatedAtFilterRange } from "../../components/table/irepsTableModel.js";
import IrepsTable, { IrepsTableFilterInput } from "../../components/table/IrepsTable";
import { useCallback, useMemo, useState } from "react";
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
import MeterMediaGalleryModal from "./components/MeterMediaGalleryModal";
import ItoLaunchButtons from "../../components/ito/ItoLaunchButtons";
import { ITO_COLUMN_LABEL } from "../../components/ito/itoTransactions";
import MeterNoAccessHistoryModal from "./components/MeterNoAccessHistoryModal";
import MeterReportPreviewModal from "./components/MeterReportPreviewModal";
import RegistrationGuardModal from "./components/RegistrationGuardModal";
import TrnReportPreviewModal from "./components/TrnReportPreviewModal";

const EMPTY_METER_FILTERS = {
  meterNo: "",
  meterType: "ALL",
  meterKind: "ALL",
  meterPhase: "ALL",
  visibility: "ALL",
  status: "ALL",
  erfNo: "",
  premiseAddress: "",
  premiseUnitName: "",
  premiseUnitNo: "",
  premiseType: "ALL",
  registration: "ALL",
  // DR-R001 3.2 and 3.3: each count filters on its own. The office types the
  // number it is looking for — 0 for never, 1, 2 — the way the TRN Registry's
  // media count is typed.
  noAccessCount: "",
  disconnectionCount: "",
  reconnectionCount: "",
};

// DR-R001 section 4: a Manager and a supervisor launch this work.
const CREDIT_CONTROL_ROLES = ["MNG", "SPV"];

// DR-R001 3.1: a meter carries the id of the transaction that created it, so
// how it came into iREPS is read straight off that id. No new field, no guess.
const REGISTRATIONS = {
  DISCOVERED: { label: "Discovered", prefix: "TRN_MDIS_" },
  INSTALLED: { label: "Installed", prefix: "TRN_MINST_" },
};

function registrationOf(row) {
  const id = String(row?.id || "").toUpperCase();

  if (id.startsWith(REGISTRATIONS.INSTALLED.prefix)) return "INSTALLED";
  if (id.startsWith(REGISTRATIONS.DISCOVERED.prefix)) return "DISCOVERED";

  return "NAv";
}

function registrationLabel(row) {
  return REGISTRATIONS[registrationOf(row)]?.label || "NAv";
}

function readMeterCount(row, key) {
  const value = Number(row?.counts?.[key]);

  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

// Type the number you are looking for: 0 for the meters it never happened to,
// 2 for the ones it happened to twice. An empty box filters nothing, and
// anything that is not a number is ignored rather than emptying the register.
function matchesCountFilter(count, filterValue) {
  const typed = String(filterValue ?? "").trim();

  if (!typed) return true;

  const wanted = Number(typed);

  return Number.isFinite(wanted) ? count === Math.trunc(wanted) : true;
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

  if (key === "registration") return registrationLabel(row);

  // DR-R001 3.2 and 3.3: the meter's own numbers sort as numbers.
  if (key === "noAccessCount") return readMeterCount(row, "noAccess");
  if (key === "disconnectionCount") return readMeterCount(row, "disconnections");
  if (key === "reconnectionCount") return readMeterCount(row, "reconnections");

  return "";
}

// The register's own pills: anything that opens a window wears the one the
// TRN Registry uses, and the two actions wear it in the colour of the work.
function MeterActionIcon() {
  return (
    <svg viewBox="0 0 24 24" style={styles.actionSvgIcon} aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="7" y="6.5" width="10" height="5" rx="1" fill="currentColor" opacity=".35" />
      <circle cx="9" cy="16" r="1.4" fill="currentColor" />
      <circle cx="15" cy="16" r="1.4" fill="currentColor" />
    </svg>
  );
}

function ErfActionIcon() {
  return (
    <svg viewBox="0 0 24 24" style={styles.actionSvgIcon} aria-hidden="true">
      <path d="M4 7.5 10 4.5l4 3 6-3v12l-6 3-4-3-6 3z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function DiscoveredActionIcon() {
  return (
    <svg viewBox="0 0 24 24" style={styles.actionSvgIcon} aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15.8 15.8 20 20" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function InstalledActionIcon() {
  return (
    <svg viewBox="0 0 24 24" style={styles.actionSvgIcon} aria-hidden="true">
      <path d="M12 3v7" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M7.5 10h9v4.5a4.5 4.5 0 0 1-9 0z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 19v2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function MediaActionIcon() {
  return (
    <svg viewBox="0 0 24 24" style={styles.actionSvgIcon} aria-hidden="true">
      <rect x="3" y="6.5" width="18" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 6.5 10 4h4l1.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function ReportActionIcon() {
  return (
    <svg viewBox="0 0 24 24" style={styles.actionSvgIcon} aria-hidden="true">
      <path d="M6 3h8l4 4v14H6z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M14 3v4h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 12h6M9 15.5h6M9 8.5h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function PremiseActionIcon() {
  return (
    <svg viewBox="0 0 24 24" style={styles.actionSvgIcon} aria-hidden="true">
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.4" fill="currentColor" />
    </svg>
  );
}

function DataActionButton({ children, onClick, title, icon, compact }) {
  return (
    <button
      type="button"
      style={compact ? styles.compactDataActionButton : styles.dataActionButton}
      onClick={onClick}
      title={title}
    >
      <span style={styles.dataActionIconWrap}>{icon}</span>
      <span>{children}</span>
    </button>
  );
}

// A greyed button says why when you hover it, the way Unallocate does on the
// TB Register (DR-R001 3.2 and section 6).
function WorkButton({ children, onClick, disabled, busy, title, tone }) {
  const activeStyle =
    tone === "reconnect" ? styles.reconnectButton : styles.workButton;

  return (
    <button
      type="button"
      style={disabled ? styles.workButtonDisabled : activeStyle}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {busy ? "Checking…" : children}
    </button>
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

  const selectedWardPcode = getSelectedWardPcodeFromGeo(geoState);

  const [filters, setFilters] = useState(EMPTY_METER_FILTERS);

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

  // DR-R001 section 4 and 3.2: only a Manager and a supervisor launch this
  // work, so only they see the Credit control columns.
  const canLaunchCreditControl = CREDIT_CONTROL_ROLES.includes(
    String(role || "").toUpperCase(),
  );

  const [meterDetailsId, setMeterDetailsId] = useState(null);
  const [mapView, setMapView] = useState(null);
  const [noAccessMeter, setNoAccessMeter] = useState(null);
  const [mediaMeter, setMediaMeter] = useState(null);
  const [registrationTrnId, setRegistrationTrnId] = useState(null);
  const [reportMeter, setReportMeter] = useState(null);
  const [guardRefusal, setGuardRefusal] = useState(null);
  const [checkingMeterId, setCheckingMeterId] = useState(null);
  // Which of the five was pressed, so that button alone shows the wait.
  const [checkingWork, setCheckingWork] = useState(null);

  const [checkMeterRegistration] = useCheckMeterRegistrationMutation();

  // The pins for the map window: the meter's own position, and its premise.
  const { data: pinMeter } = useGetMeterByIdQuery(mapView?.meterId ?? skipToken);
  const { data: pinPremise } = useGetPremiseByIdQuery(
    mapView?.premiseId ?? skipToken,
  );

  const mapPins = useMemo(() => {
    const pins = [];

    const premiseLat = Number(pinPremise?.location?.lat ?? pinPremise?.gps?.lat);
    const premiseLng = Number(pinPremise?.location?.lng ?? pinPremise?.gps?.lng);

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
  async function launchIto(row, work) {
    if (checkingMeterId) return;

    setCheckingMeterId(row.id);
    setCheckingWork(work);

    try {
      const outcome = await checkMeterRegistration(row.id).unwrap();

      if (outcome?.success) {
        navigate(`/operations/ito/${row.id}/${work}`);
        return;
      }

      setGuardRefusal({
        meterId: row.id,
        meterNo: row.meterNo,
        message: outcome?.message,
        checks: outcome?.data?.checks || outcome?.checks || [],
      });
    } catch {
      setGuardRefusal({
        meterId: row.id,
        meterNo: row.meterNo,
        message:
          "This meter could not be checked, so nothing has been sent out. Try again.",
        checks: [],
      });
    } finally {
      setCheckingMeterId(null);
      setCheckingWork(null);
    }
  }

  const filterRegistryRows = useCallback((rows, tableFilters) => {
    const filters = {
      ...EMPTY_METER_FILTERS,
      ...tableFilters
    };
    for (const key of Object.keys(EMPTY_METER_FILTERS)) {
      if (EMPTY_METER_FILTERS[key] === "ALL" && !filters[key]) filters[key] = "ALL";
    }
    const updatedAtFilter = tableFilters.updatedAt || EMPTY_UPDATED_AT_FILTER;
    return rows.filter(row => {
      if (filters.premiseType !== "ALL" && String(row.premisePropertyType || "NAv").trim().toLowerCase() !== filters.premiseType.trim().toLowerCase()) return false;
      const statusText = row.statusState || row.status || "NAv";
      return includesText(row.meterNo, filters.meterNo) && (filters.meterType === "ALL" || String(row.meterType || "").toLowerCase() === filters.meterType.toLowerCase()) && (filters.meterKind === "ALL" || String(row.meterKind || "").toLowerCase() === filters.meterKind.toLowerCase()) && (filters.meterPhase === "ALL" || String(row.meterPhase || "").toLowerCase() === filters.meterPhase.toLowerCase()) && (filters.visibility === "ALL" || String(row.visibility || "").toUpperCase() === filters.visibility) && (filters.status === "ALL" || String(statusText || "").toUpperCase() === filters.status) && includesText(row.erfNo, filters.erfNo) && includesText(`${row.premiseAddress || ""} ${row.premiseId || ""}`, filters.premiseAddress)
        && (filters.registration === "ALL" || registrationOf(row) === filters.registration)
        && includesText(row.premiseUnitName, filters.premiseUnitName)
        && includesText(row.premiseUnitNo, filters.premiseUnitNo)
        // DR-R001 3.2 and 3.3: never disconnected, disconnected more than
        // once, nobody could get in — each count filters on its own.
        && matchesCountFilter(readMeterCount(row, "noAccess"), filters.noAccessCount)
        && matchesCountFilter(readMeterCount(row, "disconnections"), filters.disconnectionCount)
        && matchesCountFilter(readMeterCount(row, "reconnections"), filters.reconnectionCount)
        && matchesUpdatedAtFilter(row.updatedAt, updatedAtFilter);
    });
  }, []);

  const filteredMeterRows = useMemo(() => filterRegistryRows(meterRows, filters), [meterRows, filters, filterRegistryRows]);

  const totals = filteredMeterRows.reduce(
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
        header: "Property Type",
        value: (row) => row.premisePropertyType || "NAv",
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
        header: "Unit Name",
        value: (row) => row.premiseUnitName || "NAv",
      },
      {
        header: "Unit No",
        value: (row) => row.premiseUnitNo || "NAv",
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

  function resetMeterRegistryControls() {
    setFilters(EMPTY_METER_FILTERS);

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

  // Owner, 1 October: no band of group headings on this register — the
  // columns speak for themselves. Each column keeps its `group` so the bands
  // can come back as one line if that changes.
  const registryColumns = [{
    key: "meterNo",
    label: "Meter No",
    group: "identity",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "meterNo"),
    sortValue: row => getSortValue(row, "meterNo"),
    render: row => {
      return (
        <DataActionButton
          onClick={() => setMeterDetailsId(row.id)}
          title="Open this meter's details"
          icon={<MeterActionIcon />}
        >
          {row.meterNo}
        </DataActionButton>
      );
    }
  }, {
    key: "meterType",
    label: "Type",
    group: "identity",
    filter: "select",
    sortable: true,
    value: row => getSortValue(row, "meterType"),
    sortValue: row => getSortValue(row, "meterType"),
    render: row => {
      return <>{getMeterTypeLabel(row.meterType)}</>;
    },
    filterAllValue: "ALL",
    filterOptions: [{
      value: "electricity",
      label: "Electricity"
    }, {
      value: "water",
      label: "Water"
    }]
  }, {
    key: "meterKind",
    label: "Kind",
    group: "identity",
    filter: "select",
    sortable: true,
    value: row => getSortValue(row, "meterKind"),
    sortValue: row => getSortValue(row, "meterKind"),
    render: row => {
      return <>{getMeterKindLabel(row.meterKind)}</>;
    },
    filterAllValue: "ALL",
    filterOptions: [...meterKindOptions.map(meterKind => ({
      value: meterKind,
      label: getMeterKindLabel(meterKind)
    }))]
  }, {
    key: "meterPhase",
    label: "Phase",
    group: "identity",
    filter: "select",
    sortable: true,
    value: row => getSortValue(row, "meterPhase"),
    sortValue: row => getSortValue(row, "meterPhase"),
    render: row => {
      return <>{getMeterPhaseLabel(row.meterPhase)}</>;
    },
    filterAllValue: "ALL",
    filterOptions: [...meterPhaseOptions.map(meterPhase => ({
      value: meterPhase,
      label: getMeterPhaseLabel(meterPhase)
    }))]
  }, {
    key: "visibility",
    label: "Visibility",
    group: "state",
    filter: "select",
    sortable: true,
    value: row => getSortValue(row, "visibility"),
    sortValue: row => getSortValue(row, "visibility"),
    render: row => {
      return <>{row.visibility}</>;
    },
    filterAllValue: "ALL",
    filterOptions: [{
      value: "VISIBLE",
      label: "Visible"
    }, {
      value: "INVISIBLE",
      label: "Invisible"
    }]
  }, {
    key: "erfNo",
    label: "ERF No",
    group: "location",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "erfNo"),
    sortValue: row => getSortValue(row, "erfNo"),
    render: row => {
      return (
        <DataActionButton
          compact
          onClick={() =>
            setMapView({
              erfId: row.erfId,
              erfNo: row.erfNo,
              wardPcode: row?.parents?.wardPcode,
            })
          }
          title="Where this ERF is"
          icon={<ErfActionIcon />}
        >
          {row.erfNo}
        </DataActionButton>
      );
    }
  }, {
    key: "premiseType",
    label: "Property Type",
    group: "location",
    filter: "select",
    filterAllValue: "ALL",
    sortable: true,
    value: row => row.premisePropertyType || "NAv",
    sortValue: row => row.premisePropertyType === "NAv" ? null : row.premisePropertyType,
    sortEmptyLast: true,
  }, {
    key: "premiseAddress",
    label: "Premise Address",
    group: "location",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "premiseAddress"),
    sortValue: row => getSortValue(row, "premiseAddress"),
    render: row => {
      return (
        <>
          <DataActionButton
            compact
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
            icon={<PremiseActionIcon />}
          >
            {row.premiseAddress || "NAv"}
          </DataActionButton>
        </>
      );
    }
  }, {
    key: "premiseUnitName",
    label: "Unit Name",
    filter: "text",
    sortable: true,
    value: row => row.premiseUnitName || "NAv",
    sortValue: row => row.premiseUnitName === "NAv" ? null : row.premiseUnitName,
    sortEmptyLast: true,
    cellStyle: { minWidth: "10rem", maxWidth: "18rem", whiteSpace: "normal" },
  }, {
    key: "premiseUnitNo",
    label: "Unit No",
    filter: "text",
    sortable: true,
    value: row => row.premiseUnitNo || "NAv",
    sortValue: row => row.premiseUnitNo === "NAv" ? null : row.premiseUnitNo,
    sortEmptyLast: true,
    cellStyle: { minWidth: "6rem" },
  }, {
    // How this meter came into iREPS, and the transaction that put it there.
    key: "registration",
    label: "Registered by",
    group: "identity",
    filter: "select",
    sortable: true,
    value: row => registrationLabel(row),
    sortValue: row => registrationLabel(row),
    filterAllValue: "ALL",
    filterOptions: [
      { value: "DISCOVERED", label: "Discovered" },
      { value: "INSTALLED", label: "Installed" },
    ],
    render: row => {
      const kind = registrationOf(row);

      if (kind === "NAv") {
        return <span className="muted">NAv</span>;
      }

      return (
        <DataActionButton
          compact
          onClick={() => setRegistrationTrnId(row.id)}
          title={`Open the ${REGISTRATIONS[kind].label.toLowerCase()} transaction that created this meter`}
          icon={kind === "INSTALLED" ? <InstalledActionIcon /> : <DiscoveredActionIcon />}
        >
          {REGISTRATIONS[kind].label}
        </DataActionButton>
      );
    }
  }, {
    key: "media",
    label: "Media",
    group: "location",
    render: row => {
      return (
        <DataActionButton
          compact
          onClick={() =>
            setMediaMeter({
              id: row.id,
              meterNo: row.meterNo,
              premiseAddress: row.premiseAddress,
            })
          }
          title="Every picture of this meter: its registration and all its work"
          icon={<MediaActionIcon />}
        >
          Pictures
        </DataActionButton>
      );
    }
  }, {
    key: "meterReport",
    label: "Meter Report",
    group: "location",
    render: row => {
      return (
        <DataActionButton
          compact
          onClick={() =>
            setReportMeter({
              id: row.id,
              meterNo: row.meterNo,
              premiseAddress: row.premiseAddress,
            })
          }
          title="The meter's whole record, to read and download"
          icon={<ReportActionIcon />}
        >
          Report
        </DataActionButton>
      );
    }
  }, {
    key: "updatedAt",
    label: "updatedAt",
    group: "record",
    filter: "date",
    sortable: true,
    value: row => getSortValue(row, "updatedAt"),
    sortValue: row => getSortValue(row, "updatedAt"),
    render: row => {
      return <>{formatUpdatedAt(row.updatedAt)}</>;
    }
  },
  // DR-R001 3.3: can anyone even get to this meter, read before send somebody
  // to it. Its own column, outside the Credit control group, and the number is
  // a button that opens the visits behind it.
  ...(canLaunchCreditControl ? [{
    key: "noAccessCount",
    label: "No Access",
    group: "access",
    filter: "text",
    renderFilter: ({ filters: tableFilters, setFilter }) => (
      <IrepsTableFilterInput
        value={tableFilters.noAccessCount || ""}
        onChange={value => setFilter("noAccessCount", value.replace(/[^0-9]/g, ""))}
        placeholder="0, 1, 2…"
        inputMode="numeric"
      />
    ),
    sortable: true,
    value: row => readMeterCount(row, "noAccess"),
    sortValue: row => readMeterCount(row, "noAccess"),
    render: row => {
      return (
        <button
          type="button"
          style={styles.countChip}
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
        </button>
      );
    }
  }, {
    key: "status",
    label: "Status",
    group: "state",
    filter: "select",
    sortable: true,
    value: row => getSortValue(row, "status"),
    sortValue: row => getSortValue(row, "status"),
    render: row => {
      return <>{row.statusState || row.status || "NAv"}</>;
    },
    filterAllValue: "ALL",
    filterOptions: [{
      value: "FIELD",
      label: "FIELD"
    }, {
      value: "CONNECTED",
      label: "CONNECTED"
    }, {
      value: "DISCONNECTED",
      label: "DISCONNECTED"
    }, {
      value: "REMOVED",
      label: "REMOVED"
    }, {
      value: "DECOMMISSIONED",
      label: "DECOMMISSIONED"
    }]
  }, {
    // DR-R001 3.2 (1.10.0, owner 9 October 2026): ONE BUTTON PER TRANSACTION,
    // each carrying the meter's own count, replacing the Credit control group
    // of two buttons and their two count columns.
    //
    // The transaction is decided here, on the row. The ITO page that opens
    // next only says why, and to whom.
    key: "itoLaunch",
    label: ITO_COLUMN_LABEL,
    group: "credit",
    render: row => (
      <ItoLaunchButtons
        row={row}
        busy={checkingMeterId === row.id}
        checkingWork={checkingWork}
        onLaunch={launchIto}
      />
    )
  }] : [])];

  // Owner, 1 October: every cell sits in the middle of its row and reads
  // from the left, so a tall row (an address over two lines, a pill) does
  // not leave its neighbours floating at the top.
  const centredColumns = registryColumns.map((column) => ({
    ...column,
    cellStyle: { verticalAlign: "middle", ...column.cellStyle },
  }));

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
              : `${formatNumber(filteredMeterRows.length)} meters`}
          </div>

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
          <strong>{formatNumber(filteredMeterRows.length)}</strong>
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

            <div className="table-wrap">
              <IrepsTable
                key={`${activeLmPcode}:${effectiveSelectedWardPcode}`}
                title="Meters Registry"
        stickyHeader
        stickyFirstColumn
        topScrollbar
        maxHeight="68vh"
                rows={meterRows}
                columns={centredColumns}
                rowKey={row => row.id}
                filters={filters}
                onFiltersChange={setFilters}
                filteredRows={filteredMeterRows}
                filterRows={filterRegistryRows}
                defaultSort={{
                  key: "updatedAt",
                  direction: "desc"
                }}
                downloads={{
                  registryName: "Meter Registry",
                  rowsLabel: "meters",
                  columns: quickDownloadColumns,
                  fileBaseName: "meters_registry",
                  scope: quickDownloadScope
                }}
              />
            </div>

          </>
        ) : null}
      </section>

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

      {/* The transaction that created this meter, in the window the TRN
          Registry opens for any transaction. */}
      {registrationTrnId ? (
        <TrnReportPreviewModal
          trnId={registrationTrnId}
          onClose={() => setRegistrationTrnId(null)}
        />
      ) : null}

      {mediaMeter ? (
        <MeterMediaGalleryModal
          meterId={mediaMeter.id}
          meterNo={mediaMeter.meterNo}
          premiseAddress={mediaMeter.premiseAddress}
          onClose={() => setMediaMeter(null)}
        />
      ) : null}

      {reportMeter ? (
        <MeterReportPreviewModal
          meterId={reportMeter.id}
          meterNo={reportMeter.meterNo}
          premiseAddress={reportMeter.premiseAddress}
          onClose={() => setReportMeter(null)}
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

  smallMuted: {
    fontSize: "0.72rem",
    marginTop: "0.25rem",
  },
  // The TRN Registry's pill, for anything that opens a window.
  dataActionButton: {
    minHeight: "2.5rem",
    display: "inline-flex",
    alignItems: "center",
    gap: "0.48rem",
    border: "1px solid #bfdbfe",
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "0.38rem 0.62rem",
    font: "inherit",
    fontWeight: 850,
    cursor: "pointer",
    borderRadius: "0.65rem",
    textAlign: "left",
    whiteSpace: "nowrap",
  },
  compactDataActionButton: {
    minHeight: "2.5rem",
    display: "inline-flex",
    alignItems: "center",
    gap: "0.42rem",
    border: "1px solid #bfdbfe",
    background: "#f8fbff",
    color: "#1d4ed8",
    padding: "0.38rem 0.54rem",
    font: "inherit",
    fontWeight: 850,
    cursor: "pointer",
    borderRadius: "0.65rem",
    whiteSpace: "nowrap",
  },
  dataActionIconWrap: {
    width: "1.55rem",
    height: "1.55rem",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 auto",
    borderRadius: "0.45rem",
    background: "#dbeafe",
  },
  actionSvgIcon: {
    display: "block",
    width: "1.05rem",
    height: "1.05rem",
  },
  // DR-R001 3.3: the No Access number is a button.
  countChip: {
    minHeight: "2.5rem",
    minWidth: "3.2rem",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #fcd9b6",
    background: "#fff7ed",
    color: "#9a3412",
    padding: "0.38rem 0.62rem",
    font: "inherit",
    fontWeight: 850,
    fontVariantNumeric: "tabular-nums",
    cursor: "pointer",
    borderRadius: "0.65rem",
  },
  countValue: {
    display: "inline-block",
    minWidth: "2rem",
    fontWeight: 850,
    fontVariantNumeric: "tabular-nums",
  },
  // Disconnect and Reconnect: the same pill, in the colour of the work.
  workButton: {
    minHeight: "2.5rem",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #c2410c",
    background: "#ea580c",
    color: "#ffffff",
    padding: "0.38rem 0.75rem",
    font: "inherit",
    fontWeight: 850,
    cursor: "pointer",
    borderRadius: "0.65rem",
    whiteSpace: "nowrap",
  },
  reconnectButton: {
    minHeight: "2.5rem",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #15803d",
    background: "#16a34a",
    color: "#ffffff",
    padding: "0.38rem 0.75rem",
    font: "inherit",
    fontWeight: 850,
    cursor: "pointer",
    borderRadius: "0.65rem",
    whiteSpace: "nowrap",
  },
  workButtonDisabled: {
    minHeight: "2.5rem",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #e2e8f0",
    background: "#f1f5f9",
    color: "#94a3b8",
    padding: "0.38rem 0.75rem",
    font: "inherit",
    fontWeight: 850,
    cursor: "not-allowed",
    borderRadius: "0.65rem",
    whiteSpace: "nowrap",
  },
};
