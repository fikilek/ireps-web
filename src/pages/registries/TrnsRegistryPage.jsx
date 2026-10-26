/* eslint-disable no-unused-vars -- JSX tags are consumed by React; this ESLint profile does not track them. */
import { irepsTableDateRange as getDateFilterRange } from "../../components/table/irepsTableModel.js";
import DataActionButton, {
  ErfActionIcon,
  MediaActionIcon,
  MeterActionIcon,
  WardActionIcon,
} from "../../components/table/DataActionButton";
import IrepsTable from "../../components/table/IrepsTable";
import QaPill from "../../components/table/QaPill";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGetRegistryTrnsByLmPcodeQuery } from "../../redux/trnsApi";
import BoundaryMapModal from "./components/BoundaryMapModal";
import MeterDeepDetailsModal from "./components/MeterDeepDetailsModal";
import TrnMediaGalleryModal from "./components/TrnMediaGalleryModal";
import TrnReportPreviewModal from "./components/TrnReportPreviewModal";
import TrnFieldCommentsModal from "./components/TrnFieldCommentsModal";
import FieldCommentIcon from "./components/FieldCommentIcon";
import { fieldCommentMediaUrls } from "../../utils/fieldComments.js";
import TrnQaModal from "./components/TrnQaModal";
import TrnQaNotifications from "./components/TrnQaNotifications";
import { qaDate } from "../../utils/qaDisplay.js";
import {
  getTrnUpdatedByUser,
  getTrnHistoryCount,
  formatQaStatusDate,
  TRN_QA_STATUS_OPTIONS,
} from "../../utils/trnQa.js";
import { useGetAvailableServiceProvidersQuery } from "../../redux/serviceProvidersApi";
import { isMainContractor, parentIdOf, resolveMainContractor, mncPcodesOf } from "../../components/serviceProviders/providerHierarchy.js";

const DEFAULT_SORT = { key: "lastUpdatedAt", direction: "desc" };

// Unified TRN Lifecycle v3: only workflow.state determines the QA lifecycle.
const QA_STATUS_OPTIONS = ["COMPLETED", "QA FAIL", "QA PASS"];
function qaLifecycleStatus(row) {
  const state = String(row?.workflowState || "").trim().toUpperCase();
  return QA_STATUS_OPTIONS.includes(state) ? state : "NOT_ELIGIBLE";
}
function qaLifecycleLabel(row) {
  const state = qaLifecycleStatus(row);
  return state === "COMPLETED" ? "QA PENDING" :
    state === "NOT_ELIGIBLE" ? "Awaiting submission / check required" : state;
}


// A no access reads orange, the whole row (owner, 4 October 2026).
//
// A worker could not reach the meter, so the row has no meter number, no reading and no state
// - it is a visit, not a measurement, and it should not have to be read column by column to be
// told apart from the work that got in.
//
// The app's orange is #f97316, which is right for a stripe or a chip and too thin to read as
// words on white. This is the darker stop of the same family.
const NO_ACCESS_ROW_COLOUR = "#c2410c";

function registryRowStyle(row) {
  return String(row?.hasAccess).toUpperCase() === "NO"
    ? { color: NO_ACCESS_ROW_COLOUR }
    : undefined;
}

const TRN_TYPE_OPTIONS = [
  "METER_COMMISSIONING",
  "METER_DISCOVERY",
  "METER_DISCONNECTION",
  "METER_INSPECTION",
  "METER_INSTALLATION",
  "METER_READING",
  "METER_RECONNECTION",
  "METER_REMOVAL",
];

const AST_STATE_OPTIONS = [
  "FIELD",
  "CONNECTED",
  "DISCONNECTED",
  "REMOVED",
  "NAv",
];

const EMPTY_TRN_FILTERS = {
  trnId: "",
  meterNo: "",
  premiseAddress: "",
  premisePropertyType: "ALL",
  unitName: "",
  unitNo: "",
  erfNo: "",
  wardNo: "",
  mediaCount: "",
  trnType: "ALL",
  hasAccess: "ALL",
  accessReason: "",
  meterType: "ALL",
  astState: "ALL",
  anomaly: "",
  anomalyDetail: "",
  normalisation: "",
  createdByUser: "",
  updatedByUser: "",
  completedByUser: "",
  qaState: "ALL",
};

const EMPTY_DATETIME_FILTER = {
  mode: "ALL",
  startDate: "",
  endDate: "",
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
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toLocaleString() : "0";
}

function ReportDocumentIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      style={styles.reportIcon}
    >
      <path
        d="M6.75 2.75h7.1l3.4 3.4v15.1H6.75a2 2 0 0 1-2-2V4.75a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M13.75 2.95v3.8h3.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M8.25 11h5.9M8.25 14.5h7.5M8.25 18h5.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}





// The owner, 3 October 2026: "can we fix createdAt? it's 2 hrs behind."
//
// It was not behind - it was UTC, printed with no label. The record is right: TR-R002 keeps
// every stored time in UTC and the NA-R005 id is the one deliberate exception. What was wrong
// was this function: for a string it did `value.slice(0, 19)`, which CHOPS the ISO text and
// hands over the UTC digits as if they were local. A capture at 18:35 in Dundee read 16:35.
//
// It also behaved two ways: a Firestore Timestamp went through toLocaleString() and came out
// in the reader's own timezone, while a string came out in UTC. The same column, two clocks,
// depending on which shape the row happened to hold.
//
// Africa/Johannesburg is named rather than left to the browser. The work happened in South
// Africa, so a manager reading the registry from anywhere must see the time the worker saw.
// SAST is UTC+2 all year, with no daylight saving.
const SAST = "Africa/Johannesburg";

function formatDateTime(value) {
  if (!value || value === "NAv") return "NAv";

  const date =
    typeof value?.toDate === "function" ? value.toDate() : new Date(value);

  if (Number.isNaN(date?.getTime?.())) return "NAv";

  const parts = new Intl.DateTimeFormat("en-ZA", {
    timeZone: SAST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .formatToParts(date)
    .reduce((out, part) => ({ ...out, [part.type]: part.value }), {});

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function getDateMs(value) {
  if (!value || value === "NAv") return null;

  if (typeof value?.toDate === "function") {
    const ms = value.toDate().getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
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

function getRegistryLabel(value) {
  const text = String(value || "")
    .trim()
    .replace(/[_-]+/g, " ");

  if (!text || ["NAV", "NA"].includes(text.toUpperCase())) return "NAv";

  return text
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function getAccessLabel(value) {
  const normalized = String(value || "NAv")
    .trim()
    .toUpperCase();
  if (normalized === "YES") return "Yes";
  if (normalized === "NO") return "No";
  return "NAv";
}

function isActionableValue(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();

  return Boolean(
    normalized && !["NAV", "N/AV", "N/A", "NA", "-"].includes(normalized),
  );
}

function getCompactTrnId(trnId, wardPcode) {
  const fullTrnId = String(trnId || "").trim();
  if (!isActionableValue(fullTrnId)) return "NAv";

  const segments = fullTrnId.split("_").filter(Boolean);

  // NA-R005 (1.12.0): a no access ends in _NA, so the last segment is no longer what tells one
  // record from another - every no access would compact to the same thing. The suffix is taken
  // from the segment BEFORE it, and the compact id keeps the NA so a reader still sees it.
  const isNoAccess = segments.at(-1) === "NA";
  const identifying = (isNoAccess ? segments.at(-2) : segments.at(-1)) || "";
  const suffix = identifying.slice(-4);
  const ward = isActionableValue(wardPcode)
    ? String(wardPcode).trim()
    : (isNoAccess ? segments.at(-3) : segments.at(-2)) || "";

  const tail = isNoAccess ? "_NA" : "";

  if (ward && suffix) return `...${ward}_${suffix}${tail}`;
  if (suffix) return `...${suffix}${tail}`;

  return `...${fullTrnId.slice(-4)}`;
}

function isMissingSortValue(value) {
  if (value === null || value === undefined || value === "") return true;
  return String(value).trim().toUpperCase() === "NAV";
}

function getSortValue(row, key) {
  if (key === "wardNo") return Number(row.wardNo);
  if (key === "mediaCount") return Number(row.mediaCount);
  if (key === "lastUpdatedAt") return getDateMs(row.lastUpdatedAt);

  return row?.[key] ?? "";
}

function getDateValue(value) {
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

function matchesDateFilter(value, filter = EMPTY_DATETIME_FILTER) {
  if (!filter || filter.mode === "ALL") return true;

  const rowDate = getDateValue(value);
  if (!rowDate) return false;

  const { start, end } = getDateFilterRange(filter);
  if (start && rowDate < start) return false;
  if (end && rowDate > end) return false;

  return true;
}

export default function TrnsRegistryPage() {
  const { activeWorkbase, role, uid, profile, serviceProvider } = useAuth();
  const { data: providers = [] } = useGetAvailableServiceProvidersQuery();
  const reviewerProvider = providers.find(item => item.id === serviceProvider?.id);
  const reviewerRole = profile?.accountStatus === "ACTIVE" && ["MNG", "SPV"].includes(role)
    && isMainContractor(reviewerProvider) && !parentIdOf(reviewerProvider);
  const [selectedQa, setSelectedQa] = useState(null);
  const [qaSaveCount, setQaSaveCount] = useState(0);
  const activeLmPcode = getActiveLmPcode(activeWorkbase);
  const activeWorkbaseName =
    activeWorkbase?.name ||
    activeWorkbase?.lmName ||
    activeWorkbase?.id ||
    activeWorkbase?.pcode ||
    "NAv";

  // Arriving from the ITO button's open-job mark: ?meter=<number> opens this
  // register on that meter alone, so the office lands on the job it asked
  // about rather than on 246 rows. Or arriving from TB QA: ?trnId=<id>.
  const [filters, setFilters] = useState(() => {
    const searchParams =
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search);
    const askedTrn = searchParams?.get("trnId") || searchParams?.get("trn");
    const askedMeter = searchParams?.get("meter");

    if (askedTrn) {
      return { ...EMPTY_TRN_FILTERS, trnId: askedTrn };
    }
    if (askedMeter) {
      return { ...EMPTY_TRN_FILTERS, meterNo: askedMeter };
    }
    return EMPTY_TRN_FILTERS;
  });

  const [showTrnId, setShowTrnId] = useState(() => {
    if (typeof window === "undefined") return false;
    const searchParams = new URLSearchParams(window.location.search);
    return Boolean(searchParams.get("trnId") || searchParams.get("trn"));
  });
  const [selectedMeterTrnId, setSelectedMeterTrnId] = useState(null);
  const [selectedMediaTrnId, setSelectedMediaTrnId] = useState(null);
  const [selectedCommentsTrnId, setSelectedCommentsTrnId] = useState(null);
  const [selectedReportTrnId, setSelectedReportTrnId] = useState(null);
  const [selectedBoundary, setSelectedBoundary] = useState(null);

  const {
    data: trnRows = [],
    isLoading,
    isFetching,
    error,
  } = useGetRegistryTrnsByLmPcodeQuery(activeLmPcode || skipToken);

  const filterRegistryRows = useCallback((rows, tableFilters) => {
    const filters = {
      ...EMPTY_TRN_FILTERS,
      ...tableFilters
    };
    for (const key of Object.keys(EMPTY_TRN_FILTERS)) {
      if (EMPTY_TRN_FILTERS[key] === "ALL" && !filters[key]) filters[key] = "ALL";
    }
    const updatedAtFilter = tableFilters.lastUpdatedAt || EMPTY_DATETIME_FILTER;
    return rows.filter(row => {
      if (!matchesDateFilter(row.lastUpdatedAt, updatedAtFilter)) return false;
      if (!matchesSelect(qaLifecycleStatus(row), filters.qaState)) return false;
      if (!matchesSelect(row.premisePropertyType, filters.premisePropertyType)) return false;
      const mediaFilterIsEmpty = filters.mediaCount === "";
      const mediaFilterValue = Number(filters.mediaCount);
      const mediaMatches = mediaFilterIsEmpty || Number.isFinite(mediaFilterValue) && Number(row.mediaCount) === mediaFilterValue;
      return includesText(row.trnId, filters.trnId) && includesText(row.meterNo, filters.meterNo) && includesText(row.premiseAddress, filters.premiseAddress) && includesText(row.unitName, filters.unitName) && includesText(row.unitNo, filters.unitNo) && includesText(row.erfNo, filters.erfNo) && includesText(row.wardNo, filters.wardNo) && mediaMatches && matchesSelect(row.trnType, filters.trnType) && matchesSelect(row.hasAccess, filters.hasAccess) && includesText(row.accessReason, filters.accessReason) && matchesSelect(row.meterType, filters.meterType) && matchesSelect(row.astState, filters.astState) && includesText(row.anomaly, filters.anomaly) && includesText(row.anomalyDetail, filters.anomalyDetail) && includesText(row.normalisation, filters.normalisation) && includesText(row.createdByUser, filters.createdByUser) && (includesText(getTrnUpdatedByUser(row), filters.updatedByUser || filters.completedByUser) || includesText(row.completedByUser, filters.updatedByUser || filters.completedByUser));
    });
  }, []);

  const filteredTrnRows = useMemo(() => filterRegistryRows(trnRows, filters), [trnRows, filters, filterRegistryRows]);

  const totals = useMemo(() => {
    return filteredTrnRows.reduce(
      (accumulator, row) => {
        if (String(row.hasAccess).toUpperCase() === "YES")
          accumulator.hasAccess += 1;
        if (String(row.hasAccess).toUpperCase() === "NO")
          accumulator.noAccess += 1;
        if (String(row.meterType).toUpperCase() === "ELECTRICITY")
          accumulator.electricity += 1;
        if (String(row.meterType).toUpperCase() === "WATER")
          accumulator.water += 1;
        if (String(row.workflowState).toUpperCase() === "COMPLETED")
          accumulator.completed += 1;
        accumulator.media += Number(row.mediaCount) || 0;
        return accumulator;
      },
      {
        hasAccess: 0,
        noAccess: 0,
        electricity: 0,
        water: 0,
        completed: 0,
        media: 0,
      },
    );
  }, [filteredTrnRows]);

  const quickDownloadColumns = useMemo(
    () => [
      { header: "Meter No", value: (row) => row.meterNo || "NAv" },
      { header: "Property Type", value: (row) => row.premisePropertyType || "NAv" },
      {
        header: "Address",
        value: (row) => row.premiseAddress || "NAv",
      },
      { header: "Unit Name", value: (row) => row.unitName || "NAv" },
      { header: "Unit No", value: (row) => row.unitNo || "NAv" },
      { header: "ERF No", value: (row) => row.erfNo || "NAv" },
      { header: "Ward No", value: (row) => row.wardNo || "NAv" },
      { header: "Media Count", value: (row) => Number(row.mediaCount) || 0 },
      { header: "TRN Type", value: (row) => row.trnType || "NAv" },
      { header: "Has Access", value: (row) => getAccessLabel(row.hasAccess) },
      {
        header: "No Access Reason",
        value: (row) => [row.accessReason || "NAv", row.returnAppointmentLabel].filter(Boolean).join("\n"),
      },
      {
        header: "Meter Type",
        value: (row) => getRegistryLabel(row.meterType),
      },
      { header: "AST State", value: (row) => row.astState || "NAv" },
      { header: "Anomaly", value: (row) => row.anomaly || "NAv" },
      {
        header: "Anomaly Detail",
        value: (row) => row.anomalyDetail || "NAv",
      },
      {
        header: "Normalisation",
        value: (row) => row.normalisation || "NAv",
      },
      { header: "Field Comment Text", value: row => row.fieldComments?.text || "NAv" },
      { header: "Field Comment Photo", value: row => fieldCommentMediaUrls(row.fieldComments?.photos) },
      { header: "Field Comment Voice Clip", value: row => fieldCommentMediaUrls(row.fieldComments?.voiceClips) },
      { header: "Field Comment Video", value: row => fieldCommentMediaUrls(row.fieldComments?.videos) },
      {
        header: "Created By User",
        value: (row) => row.createdByUser || "NAv",
      },
      { header: "Updated By User", value: (row) => getTrnUpdatedByUser(row) },
      { header: "Completed By User", value: (row) => row.completedByUser || "NAv" },
      { header: "Updated At", value: (row) => formatDateTime(row.lastUpdatedAt) },
      { header: "updatedAt", value: (row) => formatDateTime(row.lastUpdatedAt) },
      { header: "TRN ID", value: (row) => row.trnId || "NAv" },
      { header: "QA Status", value: row => qaLifecycleLabel(row) },
      { header: "QA Reviewer", value: row => row.qa?.reviewedByUser || "NAv" },
      { header: "QA At", value: row => qaDate(row.qa?.reviewedAt) },
    ],
    [],
  );

  const quickDownloadScope = useMemo(
    () => ({
      lmName: activeWorkbaseName,
      lmPcode: activeLmPcode || "NAv",
      trnType: filters.trnType === "ALL" ? "All TRN Types" : filters.trnType,
    }),
    [activeWorkbaseName, activeLmPcode, filters.trnType],
  );

  function updateFilter(key, value) {

    setFilters((current) => ({ ...current, [key]: value }));
  }

  const registryColumns = [...(showTrnId ? [{
    key: "trnId",
    label: "TRN ID",
    filter: "text",
    sortable: true,
    value: row => {
      const value = getSortValue(row, "trnId");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    sortValue: row => {
      const value = getSortValue(row, "trnId");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    render: row => {
      return <><span style={styles.trnIdDisplay} title={row.trnId || "NAv"}>
                                    {getCompactTrnId(row.trnId, row.wardPcode)}
                                  </span></>;
    },
    sortEmptyLast: true,

    cellStyle: styles.idCell
  }] : []), {
    key: "meterNo",
    label: "Meter No",
    filter: "text",
    sortable: true,
    value: row => {
      const value = getSortValue(row, "meterNo");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    sortValue: row => {
      const value = getSortValue(row, "meterNo");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    render: row => {
      return <>{isActionableValue(row.meterNo) ? <DataActionButton icon={<MeterActionIcon />} title="Open meter details from this TRN" onClick={() => setSelectedMeterTrnId(row.trnId)}>{row.meterNo}</DataActionButton> : "NAv"}</>;
    },
    sortEmptyLast: true,

    cellStyle: styles.meterCell
  }, {
    key: "trnType",
    label: "TRN Type",
    filter: "select",
    sortable: true,
    value: row => {
      const value = getSortValue(row, "trnType");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    sortValue: row => {
      const value = getSortValue(row, "trnType");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    render: row => {
      return <>{row.trnType || "NAv"}</>;
    },
    filterAllValue: "ALL",
    filterOptions: [...TRN_TYPE_OPTIONS.map(trnType => ({
      value: trnType,
      label: trnType
    }))],
    sortEmptyLast: true,

  }, {
    key: "premisePropertyType",
    label: "Property Type",
    filter: "select",
    filterAllValue: "ALL",
    sortable: true,
    value: row => row.premisePropertyType || "NAv",
    sortValue: row => isMissingSortValue(row.premisePropertyType) ? null : row.premisePropertyType,
    render: row => row.premisePropertyType || "NAv",
    sortEmptyLast: true,
  }, {
    key: "premiseAddress",
    label: "Address",
    filter: "text",
    sortable: true,
    value: row => {
      const value = getSortValue(row, "premiseAddress");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    sortValue: row => {
      const value = getSortValue(row, "premiseAddress");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    render: row => {
      return <>{row.premiseAddress || "NAv"}</>;
    },
    sortEmptyLast: true,

    cellStyle: styles.addressCell
  }, {
    key: "unitName",
    label: "Unit Name",
    filter: "text",
    sortable: true,
    value: row => isMissingSortValue(row.unitName) ? null : row.unitName,
    render: row => row.unitName || "NAv",
    sortEmptyLast: true,
    cellStyle: { minWidth: "10rem", maxWidth: "18rem", whiteSpace: "normal" },
  }, {
    key: "unitNo",
    label: "Unit No",
    filter: "text",
    sortable: true,
    value: row => isMissingSortValue(row.unitNo) ? null : row.unitNo,
    render: row => row.unitNo || "NAv",
    sortEmptyLast: true,
    cellStyle: { minWidth: "6rem" },
  }, {
    key: "erfNo",
    label: "ERF No",
    filter: "text",
    sortable: true,
    value: row => {
      const value = getSortValue(row, "erfNo");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    sortValue: row => {
      const value = getSortValue(row, "erfNo");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    render: row => {
      return <>{isActionableValue(row.erfId) && isActionableValue(row.erfNo) ? <DataActionButton compact icon={<ErfActionIcon />} title={`Open ERF ${row.erfNo} boundary`} onClick={() => setSelectedBoundary({
          mode: "ERF",
          trnId: row.trnId,
          erfId: row.erfId,
          erfNo: row.erfNo,
          wardPcode: row.wardPcode,
          wardNo: row.wardNo
        })}>{row.erfNo}</DataActionButton> : row.erfNo || "NAv"}</>;
    },
    sortEmptyLast: true,

  }, {
    key: "wardNo",
    label: "Ward No",
    filter: "text",
    sortable: true,
    value: row => {
      const value = getSortValue(row, "wardNo");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    sortValue: row => {
      const value = getSortValue(row, "wardNo");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    render: row => {
      return <>{isActionableValue(row.wardPcode) && isActionableValue(row.wardNo) ? <DataActionButton compact icon={<WardActionIcon />} title={`Open Ward ${row.wardNo} boundary`} onClick={() => setSelectedBoundary({
          mode: "WARD",
          trnId: row.trnId,
          erfId: row.erfId,
          erfNo: row.erfNo,
          wardPcode: row.wardPcode,
          wardNo: row.wardNo
        })}>{row.wardNo}</DataActionButton> : row.wardNo || "NAv"}</>;
    },
    sortEmptyLast: true,

  }, {
    key: "mediaCount",
    label: "Media",
    filter: "text",
    sortable: true,
    value: row => {
      const value = getSortValue(row, "mediaCount");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    sortValue: row => {
      const value = getSortValue(row, "mediaCount");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    render: row => {
      // The count IS the chip's word, and a TRN with no media shows the same
      // chip disabled rather than a differently-shaped grey one: nothing to
      // open, and it says so without pretending to be a second kind of cell.
      return <>{Number(row.mediaCount) > 0 ? <DataActionButton compact icon={<MediaActionIcon />} haspopup="dialog" title={`Open ${formatNumber(row.mediaCount)} media item${Number(row.mediaCount) === 1 ? "" : "s"} from TRN ${row.trnId}`} onClick={() => setSelectedMediaTrnId(row.trnId)}>{formatNumber(row.mediaCount)}</DataActionButton> : <DataActionButton compact disabled icon={<MediaActionIcon />} title="No media captured for this TRN">0</DataActionButton>}</>;
    },
    sortEmptyLast: true,

    cellStyle: styles.iconCell
  }, {
    key: "actions",
    label: "",
    filter: null,
    sortable: false,
    value: row => {
      const value = getSortValue(row, "actions");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    sortValue: row => {
      const value = getSortValue(row, "actions");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    render: row => {
      return <><button type="button" style={styles.reportActionButton} onClick={() => setSelectedReportTrnId(row.trnId)} title={`Open TRN report preview for ${row.trnId}`} aria-label={`Open TRN report preview for ${row.trnId}`}>
                                  <ReportDocumentIcon />
                                </button></>;
    },
    sortEmptyLast: true,

    cellStyle: styles.iconCell
  }, {
    key: "hasAccess",
    label: "Has Access",
    filter: "select",
    sortable: true,
    value: row => {
      const value = getSortValue(row, "hasAccess");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    sortValue: row => {
      const value = getSortValue(row, "hasAccess");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    render: row => {
      return <>{getAccessLabel(row.hasAccess)}</>;
    },
    filterAllValue: "ALL",
    filterOptions: [{
      value: "YES",
      label: "YES"
    }, {
      value: "NO",
      label: "NO"
    }],
    sortEmptyLast: true,

  }, {
    key: "accessReason",
    label: "No Access Reason",
    filter: "text",
    sortable: true,
    value: row => {
      const value = getSortValue(row, "accessReason");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    sortValue: row => {
      const value = getSortValue(row, "accessReason");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    render: row => {
      return <div style={{ display: "grid", gap: 4, minWidth: 165 }}>
        <span style={{ fontWeight: row.returnAppointmentLabel ? 600 : undefined }}>{row.accessReason || "NAv"}</span>
        {row.returnAppointmentLabel && <span style={{ whiteSpace: "nowrap" }}>{row.returnAppointmentLabel}</span>}
      </div>;
    },
    sortEmptyLast: true,

  }, {
    key: "meterType",
    label: "Meter Type",
    filter: "select",
    sortable: true,
    value: row => {
      const value = getSortValue(row, "meterType");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    sortValue: row => {
      const value = getSortValue(row, "meterType");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    render: row => {
      return <>{getRegistryLabel(row.meterType)}</>;
    },
    filterAllValue: "ALL",
    filterOptions: [{
      value: "ELECTRICITY",
      label: "ELECTRICITY"
    }, {
      value: "WATER",
      label: "WATER"
    }, {
      value: "NA",
      label: "NA"
    }],
    sortEmptyLast: true,

  }, {
    key: "astState",
    label: "AST State",
    filter: "select",
    sortable: true,
    value: row => {
      const value = getSortValue(row, "astState");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    sortValue: row => {
      const value = getSortValue(row, "astState");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    render: row => {
      return <>{row.astState || "NAv"}</>;
    },
    filterAllValue: "ALL",
    filterOptions: [...AST_STATE_OPTIONS.map(state => ({
      value: state,
      label: state
    }))],
    sortEmptyLast: true,

  }, {
    key: "anomaly",
    label: "Anomaly",
    filter: "text",
    sortable: true,
    value: row => {
      const value = getSortValue(row, "anomaly");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    sortValue: row => {
      const value = getSortValue(row, "anomaly");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    render: row => {
      return <>{row.anomaly || "NAv"}</>;
    },
    sortEmptyLast: true,

    cellStyle: styles.findingCell
  }, {
    key: "anomalyDetail",
    label: "Anomaly Detail",
    filter: "text",
    sortable: true,
    value: row => {
      const value = getSortValue(row, "anomalyDetail");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    sortValue: row => {
      const value = getSortValue(row, "anomalyDetail");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    render: row => {
      return <>{row.anomalyDetail || "NAv"}</>;
    },
    sortEmptyLast: true,

    cellStyle: styles.findingCell
  }, {
    key: "normalisation",
    label: "Normalisation",
    filter: "text",
    sortable: true,
    value: row => {
      const value = getSortValue(row, "normalisation");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    sortValue: row => {
      const value = getSortValue(row, "normalisation");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    render: row => {
      return <>{row.normalisation || "NAv"}</>;
    },
    sortEmptyLast: true,

    cellStyle: styles.findingCell
  }, {
    key: "fieldComments",
    label: "Field Comments",
    filter: null,
    sortable: false,
    value: row => row.fieldComments?.text || "NAv",
    render: row => {
      const comments = row.fieldComments;
      const available = [
        ["text", "Text", comments?.text && comments.text !== "NAv" ? 1 : 0],
        ["photo", "Photo", comments?.photos?.length || 0],
        ["voice", "Voice Clip", comments?.voiceClips?.length || 0],
        ["video", "Video", comments?.videos?.length || 0],
      ].filter(([, , count]) => count > 0);
      return <div style={styles.commentCell}>
        <DataActionButton compact icon={<FieldCommentIcon />} title={`Open field comments for ${row.trnId}`} haspopup="dialog" onClick={() => setSelectedCommentsTrnId(row.trnId)}>FC</DataActionButton>
        <div style={styles.commentAvailability}>
          {available.length ? available.map(([kind, label, count]) => <span key={kind} role="img" aria-label={`${label}: ${count}`} title={`${label}: ${count}`}><FieldCommentIcon kind={kind} /></span>) : <span>NAv</span>}
        </div>
      </div>;
    },
  }, {
    key: "createdByUser",
    label: "Created By User",
    filter: "text",
    sortable: true,
    value: row => {
      const value = getSortValue(row, "createdByUser");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    sortValue: row => {
      const value = getSortValue(row, "createdByUser");
      return isMissingSortValue(value) || Number.isNaN(value) ? null : value;
    },
    render: row => {
      return <>{row.createdByUser || "NAv"}</>;
    },
    sortEmptyLast: true,

  }, {
    key: "updatedByUser",
    label: "Updated By User",
    filter: "text",
    sortable: true,
    value: row => getTrnUpdatedByUser(row),
    sortValue: row => isMissingSortValue(getTrnUpdatedByUser(row)) ? null : getTrnUpdatedByUser(row),
    render: row => <>{getTrnUpdatedByUser(row)}</>,
    sortEmptyLast: true,
  }, {
    key: "lastUpdatedAt",
    label: "updatedAt",
    filter: "date",
    sortable: true,
    value: row => getDateMs(row.lastUpdatedAt),
    sortValue: row => getDateMs(row.lastUpdatedAt),
    render: row => <>{formatDateTime(row.lastUpdatedAt)}</>,
    sortEmptyLast: true,
  }, {
    key: "qaState", label: "QA Status", filter: "select", filterAllValue: "ALL", sortable: true,
    minWidth: "10.5rem",
    cellStyle: styles.qaCell,
    filterOptions: [
      { value: "ALL", label: "ALL" },
      { value: "COMPLETED", label: "QA PENDING" },
      { value: "QA PASS", label: "QA PASS" },
      { value: "QA FAIL", label: "QA FAIL" },
      { value: "NOT_ELIGIBLE", label: "Awaiting submission / check required" },
    ],
    value: row => qaLifecycleStatus(row),
    render: row => {
      const rawStatus = qaLifecycleStatus(row);
      const status = rawStatus === "COMPLETED" ? "QA PENDING" : rawStatus;
      const isEligible = rawStatus !== "NOT_ELIGIBLE";
      return (
        <div className="qa-status-cell">
          <QaPill
            status={status}
            label={qaLifecycleLabel(row)}
            disabled={!isEligible}
            onClick={isEligible ? () => setSelectedQa({ trnId: row.trnId, action: "", mode: "review" }) : undefined}
            title={isEligible ? `Open QA Review for ${row.trnId}` : "Not eligible for QA review"}
            ariaLabel={`QA Status: ${qaLifecycleLabel(row)}`}
          />
          {rawStatus === "COMPLETED" && row.qa?.lastAmendment
            ? <small>Corrected by {row.qa.lastAmendment.byUser}<br />{qaDate(row.qa.lastAmendment.at)}</small>
            : row.qa?.reviewedByUser && <small>{row.qa.reviewedByUser}<br />{qaDate(row.qa.reviewedAt)}</small>}
        </div>
      );
    },
  }, {
    key: "qaHistory", label: "QA History", sortable: false,
    minWidth: "10.5rem",
    cellStyle: styles.qaCell,
    render: row => {
      const isEligible = qaLifecycleStatus(row) !== "NOT_ELIGIBLE";
      if (!isEligible) return null;
      const historyCount = getTrnHistoryCount(row);
      return (
        <div style={{ position: "relative", display: "inline-block" }} title={`${historyCount} QA history event${historyCount === 1 ? "" : "s"}`}>
          <DataActionButton
            compact
            haspopup="dialog"
            title="QA Review / History"
            onClick={() => setSelectedQa({ trnId: row.trnId, action: "", mode: "history" })}
          >
            QA History
          </DataActionButton>
          <span
            style={{
              position: "absolute",
              top: "-7px",
              right: "-7px",
              background: "#1d4ed8",
              color: "#ffffff",
              borderRadius: "9999px",
              fontSize: "10px",
              fontWeight: 700,
              minWidth: "16px",
              height: "16px",
              lineHeight: "16px",
              textAlign: "center",
              padding: "0 4px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
              pointerEvents: "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            aria-label={`${historyCount} history events`}
          >
            {historyCount}
          </span>
        </div>
      );
    },
  }];

  return (
    <>
      <header className="console-header" style={styles.fixedRegistryHeader}>
        <div>
          <h1>TRN Registry</h1>

          <p className="muted">
            Submitted transactions, evidence and quality assurance for this workbase.
          </p>

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
              : `${formatNumber(filteredTrnRows.length)} TRNs`}
          </div>

        </div>
      </header>

      <TrnQaNotifications uid={uid} onOpen={trnId => setSelectedQa({ trnId, action: "" })} />
      <section className="filter-panel">
        <label>
          Main TRN Type
          <select
            value={filters.trnType}
            onChange={(event) => updateFilter("trnType", event.target.value)}
          >
            <option value="ALL">ALL</option>
            {TRN_TYPE_OPTIONS.map((trnType) => (
              <option key={trnType} value={trnType}>
                {trnType}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          role="switch"
          aria-label="Show TRN ID"
          aria-checked={showTrnId}
          title={showTrnId ? "Hide TRN ID column" : "Show TRN ID column"}
          onClick={() => setShowTrnId(current => !current)}
          style={{
            ...styles.columnVisibilityToggle,
            background: showTrnId ? "#eff6ff" : "#f8fafc",
            borderColor: showTrnId ? "#bfdbfe" : "#e2e8f0",
            color: showTrnId ? "#1d4ed8" : "#475569",
          }}
        >
          <span>TRN ID</span>
          <span aria-hidden="true" style={{ ...styles.visibilityTrack, background: showTrnId ? "#2563eb" : "#94a3b8" }}>
            <span style={{ ...styles.visibilityThumb, transform: showTrnId ? "translateX(12px)" : "translateX(0)" }} />
          </span>
        </button>

        <div className="filter-summary">
          <strong>
            {filters.trnType === "ALL" ? "All TRN Types" : filters.trnType}
          </strong>
          <span>
            {formatNumber(filteredTrnRows.length)} of{" "}
            {formatNumber(trnRows.length)} TRNs
          </span>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="stat-card">
          <span>TRNs</span>
          <strong>{formatNumber(trnRows.length)}</strong>
        </div>
        <div className="stat-card">
          <span>Filtered Rows</span>
          <strong>{formatNumber(filteredTrnRows.length)}</strong>
        </div>
        <div className="stat-card">
          <span>Has Access</span>
          <strong>{formatNumber(totals.hasAccess)}</strong>
        </div>
        <div className="stat-card">
          <span>No Access</span>
          <strong>{formatNumber(totals.noAccess)}</strong>
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
          <span>Completed</span>
          <strong>{formatNumber(totals.completed)}</strong>
        </div>
        <div className="stat-card">
          <span>Media Files</span>
          <strong>{formatNumber(totals.media)}</strong>
        </div>
      </section>

      <section className="table-panel">
        {!activeLmPcode ? (
          <div className="empty-state">
            <h2>No active workbase</h2>
            <p className="muted">
              Activate a Local Municipality workbase before opening the TRN
              Registry.
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="empty-state error-box">
            <h2>Could not load TRN Registry</h2>
            <p className="muted">
              Check Firestore rules and the accessData.parents.lmPcode field
              used by the query.
            </p>
          </div>
        ) : null}

        {isLoading ? (
          <div className="empty-state">
            <h2>Loading TRN Registry...</h2>
            <p className="muted">Opening the Firestore TRN stream.</p>
          </div>
        ) : null}

        {!isLoading && activeLmPcode && trnRows.length === 0 && !error ? (
          <div className="empty-state">
            <h2>No TRNs found</h2>
            <p className="muted">
              No TRNs were returned for {activeWorkbaseName}.
            </p>
          </div>
        ) : null}

        {trnRows.length > 0 ? (
          <>

            <div className="table-wrap">
              <IrepsTable
                key={activeLmPcode}
                title="TRN Registry"
                stickyHeader
                stickyColumnKey="meterNo"
                topScrollbar
                maxHeight="68vh"
                rows={trnRows}
                columns={registryColumns}
                rowKey={row => row.trnId}
                rowStyle={registryRowStyle}
                filters={filters}
                onFiltersChange={setFilters}
                filteredRows={filteredTrnRows}
                filterRows={filterRegistryRows}
                defaultSort={DEFAULT_SORT}
                resetPageKey={qaSaveCount}
                downloads={{
                  registryName: "TRN Registry",
                  rowsLabel: "TRNs",
                  columns: quickDownloadColumns,
                  fileBaseName: "trns_registry",
                  scope: quickDownloadScope
                }}
              />
            </div>

          </>
        ) : null}
      </section>

      {selectedQa && (
        <TrnQaModal
          key={`${selectedQa.trnId}-${selectedQa.mode || "review"}`}
          trnId={selectedQa.trnId}
          mode={selectedQa.mode || "review"}
          initialAction={selectedQa.action}
          onSaved={() => setQaSaveCount(count => count + 1)}
          onClose={() => setSelectedQa(null)}
        />
      )}
      {selectedMeterTrnId ? (
        <MeterDeepDetailsModal
          trnId={selectedMeterTrnId}
          onClose={() => setSelectedMeterTrnId(null)}
        />
      ) : null}

      {selectedMediaTrnId ? (
        <TrnMediaGalleryModal
          key={selectedMediaTrnId}
          trnId={selectedMediaTrnId}
          onClose={() => setSelectedMediaTrnId(null)}
        />
      ) : null}

      {selectedReportTrnId ? (
        <TrnReportPreviewModal
          key={selectedReportTrnId}
          trnId={selectedReportTrnId}
          onClose={() => setSelectedReportTrnId(null)}
        />
      ) : null}

      {selectedCommentsTrnId ? (
        <TrnFieldCommentsModal key={`${activeLmPcode}-${selectedCommentsTrnId}`} trnId={selectedCommentsTrnId} onClose={() => setSelectedCommentsTrnId(null)} />
      ) : null}

      {selectedBoundary ? (
        <BoundaryMapModal
          key={`${selectedBoundary.mode}-${
            selectedBoundary.mode === "ERF"
              ? selectedBoundary.erfId
              : selectedBoundary.wardPcode
          }`}
          mode={selectedBoundary.mode}
          trnId={selectedBoundary.trnId}
          erfId={selectedBoundary.erfId}
          erfNo={selectedBoundary.erfNo}
          wardPcode={selectedBoundary.wardPcode}
          wardNo={selectedBoundary.wardNo}
          onClose={() => setSelectedBoundary(null)}
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

  idCell: {
    minWidth: "12rem",
    maxWidth: "15rem",
    fontWeight: 750,
    whiteSpace: "nowrap",
  },
  trnIdDisplay: {
    display: "inline-block",
    cursor: "help",
    whiteSpace: "nowrap",
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
  meterCell: {
    minWidth: "10rem",
    fontWeight: 800,
  },
  addressCell: {
    minWidth: "15rem",
    maxWidth: "22rem",
    whiteSpace: "normal",
  },
  findingCell: {
    minWidth: "12rem",
    maxWidth: "20rem",
    whiteSpace: "normal",
  },
  qaCell: {
    minWidth: "10.5rem",
    width: "10.5rem",
  },
  commentCell: { display: "grid", gap: "8px", justifyItems: "start", minWidth: "7.5rem" },
  commentAvailability: { display: "flex", gap: "7px", color: "#64748b", fontSize: "12px" },
  iconCell: {
    minWidth: "6rem",
    textAlign: "center",
    whiteSpace: "nowrap",
  },

  reportActionButton: {
    width: "2.5rem",
    height: "2.5rem",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #bfdbfe",
    background: "#eff6ff",
    color: "#2563eb",
    padding: 0,
    font: "inherit",
    cursor: "pointer",
    borderRadius: "0.65rem",
  },
  reportIcon: {
    display: "block",
    width: "1.5rem",
    height: "1.5rem",
  },

};
