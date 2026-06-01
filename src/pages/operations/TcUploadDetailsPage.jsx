import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  useGetTcRowsByTcIdQuery,
  useGetTcUploadByIdQuery,
} from "../../redux/tcApi";

const QUICK_FILTERS = [
  { key: "ALL", label: "All Rows" },
  { key: "READY_FOR_BGO", label: "Ready for BGO" },
  { key: "NEEDS_ATTENTION", label: "Needs Attention" },
  { key: "NOT_FOUND", label: "Not Found" },
  { key: "NOT_ELIGIBLE", label: "Not Eligible" },
  { key: "NO_GEOFENCE", label: "No Geofence" },
  {
    key: "BLOCKED_ACTIVE_SAME_OPERATION_TRN",
    label: "Blocked Active Same Operation",
  },
  { key: "USED_BY_BGO", label: "Used by BGO" },
];

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const STATS_VIEW_OPTIONS = [
  { key: "BALANCE", label: "Balance View" },
  { key: "BGO_READY", label: "BGO Ready View" },
  { key: "ELIGIBLE", label: "Eligible View" },
  { key: "GEOFENCE", label: "Geofence View" },
  { key: "BLOCKED", label: "Blocked View" },
];

const NO_GEOFENCE_FILTER_VALUE = "NO_GEOFENCE";

const EMPTY_COLUMN_FILTERS = {
  found: "ALL",
  wardNo: "ALL",
  status: "ALL",
  meterType: "ALL",
  propertyType: "ALL",
  eligible: "ALL",
  geofence: "ALL",
  blocked: "ALL",
  bgoReady: "ALL",
  reason: "ALL",
  bgoUsed: "ALL",
};

const HELP_TEXT = {
  file: "The original CSV file name uploaded into TC. The same content should not be uploaded again once idempotency is added.",
  trnType:
    "The selected operation type for this TC upload, for example METER_DISCONNECTION. TC prepares candidate rows only; it does not create TRNs.",
  lmWard:
    "The local municipality and optional ward scope stamped on the upload.",
  validation:
    "Backend validation state for the upload. VALIDATED_WITH_EXCEPTIONS means validation completed but some rows need attention.",
  bgo: "BGO readiness state at upload level. READY_FOR_BGO means at least some rows can be consumed by BGO.",

  totalRows: "Total CSV rows uploaded into this TC file.",
  foundRows:
    "Rows where the uploaded meter number matched an existing iREPS AST/meter.",
  notFoundRows:
    "Rows where the uploaded meter number could not be matched to an existing iREPS AST/meter.",
  eligibleRows:
    "Matched rows allowed for the selected operation type. Example: CONNECTED meters are eligible for METER_DISCONNECTION.",
  notEligibleRows:
    "Rows that were found, but the current meter status does not allow this operation.",
  noGeofenceRows:
    "Found rows where geofenceRefs is empty. These rows need geofence work before BGO can use them.",
  readyRows:
    "Rows ready for BGO. BGO Ready? is TRUE only when the row passed upload validation, meter was found, meter is eligible, geofenceRefs exists, row is not duplicate, no active same-operation TRN exists, row is not already used, and no batchId exists.",
  blockedRows:
    "Rows blocked because the meter already has active or pending work for the same operation type.",
  usedRows:
    "Rows already consumed by BGO. Once BGO uses a row, it must not be used again for another batch.",

  foundColumn:
    "Allowed values: FOUND / NOT_FOUND. FOUND means the uploaded meter number matched an iREPS AST/meter. NOT_FOUND means no AST/meter match was found.",
  wardNoColumn:
    "The ward number derived from the matched AST ward pcode. Example: ZA7423006 displays as Ward 6.",
  statusColumn:
    "The current AST/meter status in iREPS, for example FIELD, CONNECTED, DISCONNECTED, or REMOVED.",
  meterColumn:
    "Click the meter number to open the meter GPS location modal. If the meter has no GPS, the modal will say so.",
  meterTypeColumn:
    "The service type of the matched meter, normally electricity or water.",
  eligibleColumn:
    "Allowed values: TRUE / FALSE. TRUE means the matched meter can go through the selected operation. Example: for DCN, CONNECTED can be disconnected; for RCN, DISCONNECTED can be reconnected; for REM, FIELD/CONNECTED/DISCONNECTED can be removed; for MREAD, FIELD/CONNECTED/DISCONNECTED conventional meters can be read; for INSP, FIELD/CONNECTED/DISCONNECTED/REMOVED can be inspected.",
  propertyTypeColumn:
    "The Premise Form property type from the linked premise, for example Residential, Business, Church, or another approved property classification.",
  addressColumn:
    "Click the premise address to open the premise GPS map. The modal shows ERF number and premise address.",
  geofenceColumn:
    "Shows the geofenceRefs names attached to the matched AST. Allowed filter values: All, NO_GEOFENCE, and actual geofence names. NO_GEOFENCE means the row needs geofence work before BGO can use it.",
  blockedColumn:
    "Allowed values: TRUE / FALSE. TRUE means the matched meter already has an active or pending TRN for the same operation, for example an active MDCN blocks another MDCN.",
  bgoReadyColumn:
    "Allowed values: TRUE / FALSE only. TRUE means BGO can consume this row now. FALSE means BGO must not consume it. The Reason / TC Decision column explains why.",
  reasonColumn:
    "Controlled decision values: READY_FOR_BGO, FRONTEND_INVALID, NOT_FOUND, NOT_ELIGIBLE, NEEDS_GEOFENCE, BLOCKED_ACTIVE_SAME_OPERATION_TRN, DUPLICATE_METER_IN_UPLOAD, USED_BY_BGO.",
  bgoUsedColumn:
    "Allowed values: TRUE / FALSE. TRUE means the row was already consumed into a BGO batch and must not be used again.",
  tcRowsPanel:
    "TC Rows classify every CSV/XLS row before BGO. BGO Ready? is TRUE only when: 1) row passed upload format validation, 2) meter was found, 3) meter is eligible for selected operation, 4) meter has geofenceRefs, 5) row is not duplicate in this upload, 6) meter has no active/pending same-operation TRN, 7) row has not already been used by BGO, and 8) row has no batchId yet.\n\nExamples:\nMeter found + eligible + geofenced + unused = TRUE / READY_FOR_BGO.\nMeter not found = FALSE / NOT_FOUND.\nFIELD meter in a DCN upload = FALSE / NOT_ELIGIBLE.\nEligible meter without geofence = FALSE / NEEDS_GEOFENCE.\nSame meter already has active MDCN = FALSE / BLOCKED_ACTIVE_SAME_OPERATION_TRN.\nDuplicate meter in same CSV/XLS upload = FALSE / DUPLICATE_METER_IN_UPLOAD.\nRow already consumed into BGO = FALSE / USED_BY_BGO.",
  eligibilityRules:
    "Eligibility Rules:\nDCN / Disconnection: Can this meter be disconnected? Eligible status: CONNECTED only.\nRCN / Reconnection: Can this meter be reconnected? Eligible status: DISCONNECTED only.\nREM / Removal: Can this meter be removed/decommissioned? Eligible statuses: FIELD, CONNECTED, DISCONNECTED.\nMREAD / Meter Reading: Can this meter be read? Eligible statuses: FIELD, CONNECTED, DISCONNECTED, conventional meters only.\nINSP / Inspection: Can this meter be inspected? Eligible statuses: FIELD, CONNECTED, DISCONNECTED, REMOVED.",
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function valueOrNav(value) {
  if (value === null || value === undefined || value === "") return "NAv";
  return value;
}

function normalizeOptionValue(value) {
  const text = String(valueOrNav(value)).trim();
  return text ? text.toUpperCase() : "NAV";
}

function toTitleCase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/(^|\s|_)([a-z])/g, (_match, prefix, letter) => {
      const nextPrefix = prefix === "_" ? " " : prefix;
      return `${nextPrefix}${letter.toUpperCase()}`;
    });
}

function getGeofenceRefs(row) {
  return asArray(row?.geofenceRefs);
}

function getPremisePropertyType(row) {
  return valueOrNav(row?.premise?.propertyType?.type);
}

function getPremiseAddress(row) {
  return valueOrNav(row?.premise?.address);
}

function getWardNo(row) {
  return valueOrNav(row?.ast?.wardNo);
}

function normalizePropertyType(value) {
  return normalizeOptionValue(value);
}

function getGpsCoordinates(gps) {
  const latitude = Number(gps?.latitude);
  const longitude = Number(gps?.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function formatGps(gps) {
  const coordinates = getGpsCoordinates(gps);

  if (!coordinates) return "GPS not available";

  return `${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}`;
}

function getGeofenceOptionValue(ref) {
  return `GEOFENCE:${ref?.id || ref?.name || "NAv"}`;
}

function getGeofenceLabel(row) {
  const geofenceRefs = getGeofenceRefs(row);

  if (geofenceRefs.length === 0) {
    return "NO_GEOFENCE";
  }

  return geofenceRefs
    .map((ref) => ref?.name || ref?.id)
    .filter(Boolean)
    .join(", ");
}

function rowCanLaunchGeofenceRepair(row) {
  return row?.backend?.matched === true && getGeofenceRefs(row).length === 0;
}

function getRowLmPcode(row, upload) {
  return (
    row?.ast?.lmPcode ||
    row?.ast?.parents?.lmPcode ||
    row?.ast?.accessData?.parents?.lmPcode ||
    row?.backend?.parents?.lmPcode ||
    row?.upload?.lmPcode ||
    upload?.lmPcode ||
    ""
  );
}

function getRowWardPcode(row, upload) {
  return (
    row?.ast?.wardPcode ||
    row?.ast?.parents?.wardPcode ||
    row?.ast?.accessData?.parents?.wardPcode ||
    row?.backend?.parents?.wardPcode ||
    row?.upload?.wardPcode ||
    upload?.wardPcode ||
    ""
  );
}

// function getRowLmPcode(row, upload) {
//   return (
//     row?.ast?.parents?.lmPcode ||
//     row?.ast?.accessData?.parents?.lmPcode ||
//     row?.backend?.parents?.lmPcode ||
//     row?.upload?.lmPcode ||
//     upload?.lmPcode ||
//     ""
//   );
// }

// function getRowWardPcode(row, upload) {
//   return (
//     row?.ast?.parents?.wardPcode ||
//     row?.ast?.accessData?.parents?.wardPcode ||
//     row?.backend?.parents?.wardPcode ||
//     row?.upload?.wardPcode ||
//     upload?.wardPcode ||
//     ""
//   );
// }

function getRowFocusAstId(row) {
  return (
    row?.astId ||
    row?.ast?.id ||
    row?.ast?.astId ||
    row?.ast?.trnId ||
    row?.backend?.astId ||
    row?.backend?.matchedAstId ||
    row?.backend?.matchedAst?.id ||
    row?.id ||
    ""
  );
}

function buildGeoFenceRepairUrl({ row, upload, tcId }) {
  const lmPcode = getRowLmPcode(row, upload);
  const wardPcode = getRowWardPcode(row, upload);
  const focusAstId = getRowFocusAstId(row);

  const params = new URLSearchParams();

  if (lmPcode) params.set("lmPcode", lmPcode);
  if (wardPcode) params.set("wardPcode", wardPcode);
  if (tcId) params.set("tcId", tcId);
  if (focusAstId) params.set("focusAstId", focusAstId);

  return `/operations/geo-fences?${params.toString()}`;
}

function rowHasSelectedGeofence(row, selectedGeofence) {
  if (selectedGeofence === "ALL") return true;

  const geofenceRefs = getGeofenceRefs(row);

  if (selectedGeofence === NO_GEOFENCE_FILTER_VALUE) {
    return row?.backend?.matched === true && geofenceRefs.length === 0;
  }

  return geofenceRefs.some(
    (ref) => getGeofenceOptionValue(ref) === selectedGeofence,
  );
}

function getFoundFilterValue(row) {
  return row?.backend?.matched === true ? "FOUND" : "NOT_FOUND";
}

function getEligibleFilterValue(row) {
  return row?.backend?.eligible === true ? "TRUE" : "FALSE";
}

function getBooleanFilterValue(value) {
  return value === true ? "TRUE" : "FALSE";
}

function hasMeaningfulValue(value) {
  if (value === null || value === undefined) return false;

  const normalizedValue = String(value).trim().toUpperCase();

  return (
    normalizedValue !== "" &&
    normalizedValue !== "NAV" &&
    normalizedValue !== "N/A" &&
    normalizedValue !== "NA" &&
    normalizedValue !== "NULL" &&
    normalizedValue !== "UNDEFINED"
  );
}

function hasBgoBatchId(row) {
  return hasMeaningfulValue(row?.bgo?.batchId);
}

function isBgoUsed(row) {
  return row?.bgo?.used === true || hasBgoBatchId(row);
}

function isBgoReady(row) {
  return (
    row?.bgo?.ready === true &&
    row?.bgo?.readinessState === "READY_FOR_BGO" &&
    isBgoUsed(row) !== true
  );
}

function getBlockedFilterValue(row) {
  return getBooleanFilterValue(
    row?.backend?.alreadyHasActiveSameOperationTrn === true,
  );
}

function getBgoReadyFilterValue(row) {
  return getBooleanFilterValue(isBgoReady(row));
}

function getBgoUsedFilterValue(row) {
  return getBooleanFilterValue(isBgoUsed(row));
}

function getPrimaryReason(row) {
  const reasonCodes = asArray(row?.backend?.reasonCodes);

  if (isBgoUsed(row)) return "USED_BY_BGO";
  if (isBgoReady(row)) return "READY_FOR_BGO";
  if (row?.frontend?.valid === false) return "FRONTEND_INVALID";
  if (reasonCodes.length > 0) return reasonCodes[0];
  if (row?.backend?.notFound === true || row?.backend?.matched === false)
    return "NOT_FOUND";
  if (row?.backend?.notEligible === true || row?.backend?.eligible === false) {
    return "NOT_ELIGIBLE";
  }
  if (row?.backend?.alreadyHasActiveSameOperationTrn === true) {
    return "BLOCKED_ACTIVE_SAME_OPERATION_TRN";
  }
  if (
    row?.backend?.duplicateInUpload === true ||
    row?.frontend?.duplicateInUpload === true
  ) {
    return "DUPLICATE_METER_IN_UPLOAD";
  }
  if (row?.backend?.matched === true && getGeofenceRefs(row).length === 0) {
    return "NEEDS_GEOFENCE";
  }
  if (row?.bgo?.readinessState) return row.bgo.readinessState;

  return "NAv";
}

function getRowReason(row) {
  return getPrimaryReason(row);
}

function rowNeedsAttention(row) {
  return (
    !isBgoReady(row) ||
    row?.backend?.notFound === true ||
    row?.backend?.notEligible === true ||
    row?.backend?.alreadyHasActiveSameOperationTrn === true ||
    getGeofenceRefs(row).length === 0 ||
    row?.frontend?.valid !== true
  );
}

function applyQuickFilter(rows, activeFilter) {
  if (activeFilter === "READY_FOR_BGO") {
    return rows.filter((row) => isBgoReady(row));
  }

  if (activeFilter === "NEEDS_ATTENTION") {
    return rows.filter(rowNeedsAttention);
  }

  if (activeFilter === "NOT_FOUND") {
    return rows.filter((row) => row?.backend?.notFound === true);
  }

  if (activeFilter === "NOT_ELIGIBLE") {
    return rows.filter((row) => row?.backend?.notEligible === true);
  }

  if (activeFilter === "NO_GEOFENCE") {
    return rows.filter(
      (row) =>
        row?.backend?.matched === true && getGeofenceRefs(row).length === 0,
    );
  }

  if (activeFilter === "BLOCKED_ACTIVE_SAME_OPERATION_TRN") {
    return rows.filter(
      (row) => row?.backend?.alreadyHasActiveSameOperationTrn === true,
    );
  }

  if (activeFilter === "USED_BY_BGO") {
    return rows.filter((row) => isBgoUsed(row));
  }

  return rows;
}

function applyColumnFilters(rows, columnFilters) {
  return rows.filter((row) => {
    if (
      columnFilters.found !== "ALL" &&
      getFoundFilterValue(row) !== columnFilters.found
    ) {
      return false;
    }

    if (
      columnFilters.wardNo !== "ALL" &&
      normalizeOptionValue(getWardNo(row)) !== columnFilters.wardNo
    ) {
      return false;
    }

    if (
      columnFilters.status !== "ALL" &&
      normalizeOptionValue(row?.ast?.statusState) !== columnFilters.status
    ) {
      return false;
    }

    if (
      columnFilters.meterType !== "ALL" &&
      normalizeOptionValue(row?.ast?.meterType) !== columnFilters.meterType
    ) {
      return false;
    }

    if (
      columnFilters.propertyType !== "ALL" &&
      normalizePropertyType(getPremisePropertyType(row)) !==
        columnFilters.propertyType
    ) {
      return false;
    }

    if (
      columnFilters.eligible !== "ALL" &&
      getEligibleFilterValue(row) !== columnFilters.eligible
    ) {
      return false;
    }

    if (!rowHasSelectedGeofence(row, columnFilters.geofence)) {
      return false;
    }

    if (
      columnFilters.blocked !== "ALL" &&
      getBlockedFilterValue(row) !== columnFilters.blocked
    ) {
      return false;
    }

    if (
      columnFilters.bgoReady !== "ALL" &&
      getBgoReadyFilterValue(row) !== columnFilters.bgoReady
    ) {
      return false;
    }

    if (
      columnFilters.reason !== "ALL" &&
      normalizeOptionValue(getPrimaryReason(row)) !== columnFilters.reason
    ) {
      return false;
    }

    if (
      columnFilters.bgoUsed !== "ALL" &&
      getBgoUsedFilterValue(row) !== columnFilters.bgoUsed
    ) {
      return false;
    }

    return true;
  });
}

function getUniqueOptions(rows, getter) {
  return Array.from(
    new Set(
      rows
        .map((row) => normalizeOptionValue(getter(row)))
        .filter((value) => value && value !== "NAV"),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function buildFilterOptions(rows = []) {
  const geofenceMap = new Map();

  rows.forEach((row) => {
    getGeofenceRefs(row).forEach((ref) => {
      const value = getGeofenceOptionValue(ref);
      const label = ref?.name || ref?.id || "NAv";

      if (value !== "GEOFENCE:NAv" && !geofenceMap.has(value)) {
        geofenceMap.set(value, label);
      }
    });
  });

  return {
    wards: getUniqueOptions(rows, getWardNo),
    statuses: getUniqueOptions(rows, (row) => row?.ast?.statusState),
    meterTypes: getUniqueOptions(rows, (row) => row?.ast?.meterType),
    propertyTypes: getUniqueOptions(rows, getPremisePropertyType),
    reasons: getUniqueOptions(rows, getPrimaryReason),
    geofences: Array.from(geofenceMap.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label)),
  };
}

function getEligibleReviewPath(row) {
  if (row?.backend?.eligible !== true) return null;
  if (isBgoReady(row)) return "READY";
  if (isBgoUsed(row)) return "USED";
  if (row?.backend?.alreadyHasActiveSameOperationTrn === true) return "BLOCKED";
  if (getGeofenceRefs(row).length === 0) return "NEEDS_GEOFENCE";
  return "OTHER";
}

function isFoundRow(row) {
  return row?.backend?.matched === true;
}

function isNotEligibleRow(row) {
  return isFoundRow(row) && row?.backend?.notEligible === true;
}

function isBlockedSameOperationRow(row) {
  return row?.backend?.alreadyHasActiveSameOperationTrn === true;
}

function isBgoNotReadyRow(row) {
  return isFoundRow(row) && !isBgoReady(row) && !isBgoUsed(row);
}

function buildGeofenceBgoSplit(rows = []) {
  const geofenceMap = new Map();

  rows.forEach((row) => {
    if (!isFoundRow(row)) return;

    const geofenceRefs = getGeofenceRefs(row);
    const refs =
      geofenceRefs.length > 0
        ? geofenceRefs
        : [{ id: NO_GEOFENCE_FILTER_VALUE, name: "No Geofence" }];

    refs.forEach((ref) => {
      const id = ref?.id || ref?.name || NO_GEOFENCE_FILTER_VALUE;
      const name = ref?.name || ref?.id || "No Geofence";

      if (!geofenceMap.has(id)) {
        geofenceMap.set(id, {
          id,
          name,
          found: 0,
          ready: 0,
          used: 0,
          notReady: 0,
        });
      }

      const current = geofenceMap.get(id);
      current.found += 1;

      if (isBgoReady(row)) {
        current.ready += 1;
      } else if (isBgoUsed(row)) {
        current.used += 1;
      } else {
        current.notReady += 1;
      }
    });
  });

  return Array.from(geofenceMap.values()).sort((left, right) => {
    if (left.id === NO_GEOFENCE_FILTER_VALUE) return 1;
    if (right.id === NO_GEOFENCE_FILTER_VALUE) return -1;
    return left.name.localeCompare(right.name);
  });
}

function buildRowSummary(rows = []) {
  const totalRows = rows.length;
  const foundRows = rows.filter((row) => row?.backend?.matched === true).length;
  const notFoundRows = rows.filter(
    (row) => row?.backend?.notFound === true,
  ).length;
  const eligibleRows = rows.filter(
    (row) => row?.backend?.eligible === true,
  ).length;
  const notEligibleRows = rows.filter(
    (row) => row?.backend?.notEligible === true,
  ).length;
  const withGeofenceRows = rows.filter(
    (row) => row?.backend?.matched === true && getGeofenceRefs(row).length > 0,
  ).length;
  const noGeofenceRows = rows.filter(
    (row) =>
      row?.backend?.matched === true && getGeofenceRefs(row).length === 0,
  ).length;
  const readyRows = rows.filter((row) => isBgoReady(row)).length;
  const usedRows = rows.filter((row) => isBgoUsed(row)).length;
  const bgoForwardRows = readyRows + usedRows;
  const bgoNotReadyRows = rows.filter((row) => isBgoNotReadyRow(row)).length;
  const blockedRows = rows.filter((row) =>
    isBlockedSameOperationRow(row),
  ).length;
  const notEligibleBlockedRows = rows.filter(
    (row) => isNotEligibleRow(row) && isBlockedSameOperationRow(row),
  ).length;
  const notEligibleOnlyRows = Math.max(
    notEligibleRows - notEligibleBlockedRows,
    0,
  );

  const eligibleReadyRows = rows.filter(
    (row) => getEligibleReviewPath(row) === "READY",
  ).length;
  const eligibleNeedsGeofenceRows = rows.filter(
    (row) => getEligibleReviewPath(row) === "NEEDS_GEOFENCE",
  ).length;
  const eligibleBlockedRows = rows.filter(
    (row) => getEligibleReviewPath(row) === "BLOCKED",
  ).length;
  const eligibleOtherRows = rows.filter(
    (row) => getEligibleReviewPath(row) === "OTHER",
  ).length;

  return {
    totalRows,
    foundRows,
    notFoundRows,
    eligibleRows,
    notEligibleRows,
    withGeofenceRows,
    noGeofenceRows,
    readyRows,
    usedRows,
    bgoForwardRows,
    bgoNotReadyRows,
    blockedRows,
    notEligibleBlockedRows,
    notEligibleOnlyRows,
    eligibleReadyRows,
    eligibleNeedsGeofenceRows,
    eligibleBlockedRows,
    eligibleOtherRows,
  };
}

function hasActiveColumnFilters(columnFilters) {
  return Object.values(columnFilters).some((value) => value !== "ALL");
}

function getPageBounds({ pageIndex, pageSize, totalRows }) {
  if (totalRows === 0) {
    return {
      pageCount: 1,
      safePageIndex: 0,
      startIndex: 0,
      endIndex: 0,
      displayStart: 0,
      displayEnd: 0,
    };
  }

  const pageCount = Math.max(Math.ceil(totalRows / pageSize), 1);
  const safePageIndex = Math.min(Math.max(pageIndex, 0), pageCount - 1);
  const startIndex = safePageIndex * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalRows);

  return {
    pageCount,
    safePageIndex,
    startIndex,
    endIndex,
    displayStart: startIndex + 1,
    displayEnd: endIndex,
  };
}

export default function TcUploadDetailsPage() {
  const { tcId } = useParams();
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState("ALL");
  const [columnFilters, setColumnFilters] = useState(EMPTY_COLUMN_FILTERS);
  const [pageSize, setPageSize] = useState(25);
  const [pageIndex, setPageIndex] = useState(0);
  const [locationModal, setLocationModal] = useState(null);

  const {
    data: upload,
    isLoading: isUploadLoading,
    isError: isUploadError,
    error: uploadError,
  } = useGetTcUploadByIdQuery(tcId);

  const {
    data: rows = [],
    isLoading: areRowsLoading,
    isError: areRowsError,
    error: rowsError,
  } = useGetTcRowsByTcIdQuery(tcId);

  const summary = useMemo(() => buildRowSummary(rows), [rows]);
  const filterOptions = useMemo(() => buildFilterOptions(rows), [rows]);

  const canOpenBgo =
    summary.readyRows > 0 ||
    summary.usedRows > 0 ||
    ["READY_FOR_BGO", "PARTIALLY_USED", "USED"].includes(
      String(upload?.bgoStatus || "")
        .trim()
        .toUpperCase(),
    );

  const quickFilteredRows = useMemo(
    () => applyQuickFilter(rows, activeFilter),
    [rows, activeFilter],
  );

  const filteredRows = useMemo(
    () => applyColumnFilters(quickFilteredRows, columnFilters),
    [quickFilteredRows, columnFilters],
  );

  const pageBounds = getPageBounds({
    pageIndex,
    pageSize,
    totalRows: filteredRows.length,
  });

  const pagedRows = filteredRows.slice(
    pageBounds.startIndex,
    pageBounds.endIndex,
  );

  const isLoading = isUploadLoading || areRowsLoading;
  const isError = isUploadError || areRowsError;
  const errorMessage =
    uploadError?.message ||
    rowsError?.message ||
    "Failed to load TC upload details.";

  function selectQuickFilter(nextFilter) {
    setActiveFilter(nextFilter);
    setPageIndex(0);
  }

  function updateColumnFilter(field, value) {
    setColumnFilters((current) => ({
      ...current,
      [field]: value,
    }));
    setPageIndex(0);
  }

  function clearColumnFilters() {
    setColumnFilters(EMPTY_COLUMN_FILTERS);
    setPageIndex(0);
  }

  function updatePageSize(value) {
    setPageSize(Number(value));
    setPageIndex(0);
  }

  function openMeterLocation(row) {
    const meterNo = valueOrNav(row?.input?.meterNo || row?.ast?.astNo);

    setLocationModal({
      title: "Meter GPS Location",
      subtitle: "Meter position from the matched AST record.",
      gps: row?.ast?.gps || null,
      facts: [
        { label: "Meter No", value: meterNo },
        { label: "Status", value: valueOrNav(row?.ast?.statusState) },
        { label: "Meter Type", value: valueOrNav(row?.ast?.meterType) },
        { label: "Ward No", value: getWardNo(row) },
        { label: "ERF No", value: valueOrNav(row?.ast?.erfNo) },
      ],
    });
  }

  function openPremiseLocation(row) {
    setLocationModal({
      title: "Premise GPS Location",
      subtitle: "Premise position from the linked premise record.",
      gps: row?.premise?.gps || null,
      facts: [
        { label: "ERF No", value: valueOrNav(row?.ast?.erfNo) },
        { label: "Premise Address", value: getPremiseAddress(row) },
        { label: "Property Type", value: getPremisePropertyType(row) },
        { label: "Ward No", value: getWardNo(row) },
      ],
    });
  }

  function openGeoFenceRepair(row) {
    if (!rowCanLaunchGeofenceRepair(row)) return;

    const repairUrl = buildGeoFenceRepairUrl({
      row,
      upload,
      tcId,
    });
    console.log("Navigating to geofence repair URL:", repairUrl);

    navigate(repairUrl);
  }

  return (
    <section style={styles.page}>
      <div style={styles.topActionRow}>
        <Link to="/operations/tc-uploads" style={styles.backLink}>
          ← Back to TC Uploads
        </Link>

        <Link
          to={`/operations/tc-uploads/${tcId}/final-report`}
          style={styles.headerActionLink}
        >
          Final Report
        </Link>

        {canOpenBgo ? (
          <Link
            to={`/operations/tc-uploads/${tcId}/bgo`}
            style={styles.bgoActionLink}
          >
            Open BGO
          </Link>
        ) : (
          <button
            type="button"
            style={styles.bgoActionDisabled}
            disabled
            title="BGO opens when rows are ready for BGO or already used by BGO."
          >
            Open BGO
          </button>
        )}
      </div>

      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Operations / TC Upload Details</p>
          <h2 style={styles.title}>{tcId}</h2>
          <p style={styles.subtitle}>
            Review candidate rows, validation results, geofence readiness, and
            BGO usage state.
          </p>
        </div>

        <Badge tone={upload?.writeState === "READY" ? "success" : "warning"}>
          {upload?.writeState || "LOADING"}
        </Badge>
      </div>

      {isLoading ? (
        <div style={styles.notice}>Loading real TC rows...</div>
      ) : null}

      {isError ? <div style={styles.errorNotice}>{errorMessage}</div> : null}

      {!isLoading && !isError ? (
        <>
          <UploadInfoPanel upload={upload} />

          <TcStatsViewPanel summary={summary} rows={rows} />

          <div style={styles.stickyPanel}>
            <div style={styles.panelHeader}>
              <div>
                <div style={styles.panelTitleRow}>
                  <h3 style={styles.panelTitle}>TC Rows</h3>
                  <HelpIcon text={HELP_TEXT.tcRowsPanel} />
                  <HelpLabel
                    label="Eligibility Rules"
                    helpText={HELP_TEXT.eligibilityRules}
                  />
                </div>
                <p style={styles.panelSubtitle}>
                  TC Rows clean, validate, classify, and explain every uploaded
                  CSV/XLS row before BGO. BGO only consumes rows where BGO
                  Ready? is TRUE.
                </p>
              </div>

              <div style={styles.rowCountBadge}>
                Showing {pageBounds.displayStart}–{pageBounds.displayEnd} of{" "}
                {filteredRows.length} filtered rows
              </div>
            </div>

            <div style={styles.filterRow}>
              {QUICK_FILTERS.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  style={{
                    ...styles.filterButton,
                    ...(activeFilter === filter.key
                      ? styles.filterButtonActive
                      : null),
                  }}
                  onClick={() => selectQuickFilter(filter.key)}
                >
                  {filter.label}
                </button>
              ))}

              {hasActiveColumnFilters(columnFilters) ? (
                <button
                  type="button"
                  style={styles.clearFilterButton}
                  onClick={clearColumnFilters}
                >
                  Clear Column Filters
                </button>
              ) : null}
            </div>

            {filteredRows.length === 0 ? (
              <div style={styles.notice}>No rows match this filter.</div>
            ) : (
              <>
                <div style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <Th>Row No</Th>
                        <Th helpText={HELP_TEXT.meterColumn}>Meter No</Th>
                        <Th helpText={HELP_TEXT.addressColumn}>Address</Th>
                        <Th>Account</Th>
                        <Th helpText={HELP_TEXT.foundColumn}>Found?</Th>
                        <Th>ERF</Th>
                        <Th helpText={HELP_TEXT.wardNoColumn}>Ward No</Th>
                        <Th helpText={HELP_TEXT.statusColumn}>Meter Status</Th>
                        <Th helpText={HELP_TEXT.meterTypeColumn}>Meter Type</Th>
                        <Th helpText={HELP_TEXT.eligibleColumn}>Eligible?</Th>
                        <Th helpText={HELP_TEXT.propertyTypeColumn}>
                          Property Type
                        </Th>
                        <Th helpText={HELP_TEXT.geofenceColumn}>Geofence</Th>
                        <Th helpText={HELP_TEXT.blockedColumn}>Blocked?</Th>
                        <Th helpText={HELP_TEXT.bgoReadyColumn}>BGO Ready?</Th>
                        <Th helpText={HELP_TEXT.reasonColumn}>
                          Reason / TC Decision
                        </Th>
                        <Th helpText={HELP_TEXT.bgoUsedColumn}>BGO Used?</Th>
                        <Th>BGO Batch</Th>
                      </tr>

                      <tr>
                        <FilterTh />
                        <FilterTh />
                        <FilterTh />
                        <FilterTh />
                        <FilterTh>
                          <select
                            style={styles.filterSelect}
                            value={columnFilters.found}
                            onChange={(event) =>
                              updateColumnFilter("found", event.target.value)
                            }
                          >
                            <option value="ALL">All</option>
                            <option value="FOUND">FOUND</option>
                            <option value="NOT_FOUND">NOT_FOUND</option>
                          </select>
                        </FilterTh>
                        <FilterTh />
                        <FilterTh>
                          <select
                            style={styles.filterSelect}
                            value={columnFilters.wardNo}
                            onChange={(event) =>
                              updateColumnFilter("wardNo", event.target.value)
                            }
                          >
                            <option value="ALL">All</option>
                            {filterOptions.wards.map((wardNo) => (
                              <option key={wardNo} value={wardNo}>
                                Ward {wardNo}
                              </option>
                            ))}
                          </select>
                        </FilterTh>
                        <FilterTh>
                          <select
                            style={styles.filterSelect}
                            value={columnFilters.status}
                            onChange={(event) =>
                              updateColumnFilter("status", event.target.value)
                            }
                          >
                            <option value="ALL">All</option>
                            {filterOptions.statuses.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                        </FilterTh>
                        <FilterTh>
                          <select
                            style={styles.filterSelect}
                            value={columnFilters.meterType}
                            onChange={(event) =>
                              updateColumnFilter(
                                "meterType",
                                event.target.value,
                              )
                            }
                          >
                            <option value="ALL">All</option>
                            {filterOptions.meterTypes.map((meterType) => (
                              <option key={meterType} value={meterType}>
                                {toTitleCase(meterType)}
                              </option>
                            ))}
                          </select>
                        </FilterTh>
                        <FilterTh>
                          <select
                            style={styles.filterSelect}
                            value={columnFilters.eligible}
                            onChange={(event) =>
                              updateColumnFilter("eligible", event.target.value)
                            }
                          >
                            <option value="ALL">All</option>
                            <option value="TRUE">TRUE</option>
                            <option value="FALSE">FALSE</option>
                          </select>
                        </FilterTh>
                        <FilterTh>
                          <select
                            style={styles.filterSelect}
                            value={columnFilters.propertyType}
                            onChange={(event) =>
                              updateColumnFilter(
                                "propertyType",
                                event.target.value,
                              )
                            }
                          >
                            <option value="ALL">All</option>
                            {filterOptions.propertyTypes.map((propertyType) => (
                              <option key={propertyType} value={propertyType}>
                                {toTitleCase(propertyType)}
                              </option>
                            ))}
                          </select>
                        </FilterTh>
                        <FilterTh>
                          <select
                            style={styles.filterSelect}
                            value={columnFilters.geofence}
                            onChange={(event) =>
                              updateColumnFilter("geofence", event.target.value)
                            }
                          >
                            <option value="ALL">All</option>
                            <option value={NO_GEOFENCE_FILTER_VALUE}>
                              NO_GEOFENCE
                            </option>
                            {filterOptions.geofences.map((geofence) => (
                              <option
                                key={geofence.value}
                                value={geofence.value}
                              >
                                {geofence.label}
                              </option>
                            ))}
                          </select>
                        </FilterTh>
                        <FilterTh>
                          <select
                            style={styles.filterSelect}
                            value={columnFilters.blocked}
                            onChange={(event) =>
                              updateColumnFilter("blocked", event.target.value)
                            }
                          >
                            <option value="ALL">All</option>
                            <option value="TRUE">TRUE</option>
                            <option value="FALSE">FALSE</option>
                          </select>
                        </FilterTh>
                        <FilterTh>
                          <select
                            style={styles.filterSelect}
                            value={columnFilters.bgoReady}
                            onChange={(event) =>
                              updateColumnFilter("bgoReady", event.target.value)
                            }
                          >
                            <option value="ALL">All</option>
                            <option value="TRUE">TRUE</option>
                            <option value="FALSE">FALSE</option>
                          </select>
                        </FilterTh>
                        <FilterTh>
                          <select
                            style={styles.filterSelect}
                            value={columnFilters.reason}
                            onChange={(event) =>
                              updateColumnFilter("reason", event.target.value)
                            }
                          >
                            <option value="ALL">All</option>
                            {filterOptions.reasons.map((reason) => (
                              <option key={reason} value={reason}>
                                {reason}
                              </option>
                            ))}
                          </select>
                        </FilterTh>
                        <FilterTh>
                          <select
                            style={styles.filterSelect}
                            value={columnFilters.bgoUsed}
                            onChange={(event) =>
                              updateColumnFilter("bgoUsed", event.target.value)
                            }
                          >
                            <option value="ALL">All</option>
                            <option value="TRUE">TRUE</option>
                            <option value="FALSE">FALSE</option>
                          </select>
                        </FilterTh>
                        <FilterTh />
                      </tr>
                    </thead>

                    <tbody>
                      {pagedRows.map((row) => (
                        <tr key={row.id}>
                          <Td strong>{row.rowNo}</Td>
                          <Td strong>
                            <LocationCellButton
                              label={valueOrNav(
                                row.input?.meterNo || row.ast?.astNo,
                              )}
                              onClick={() => openMeterLocation(row)}
                            />
                          </Td>
                          <Td>
                            <LocationCellButton
                              label={getPremiseAddress(row)}
                              onClick={() => openPremiseLocation(row)}
                            />
                          </Td>
                          <Td>{valueOrNav(row.input?.accountNo)}</Td>
                          <Td>
                            <Badge
                              tone={row.backend?.matched ? "success" : "danger"}
                            >
                              {row.backend?.matched ? "FOUND" : "NOT_FOUND"}
                            </Badge>
                          </Td>
                          <Td>{valueOrNav(row.ast?.erfNo)}</Td>
                          <Td>{getWardNo(row)}</Td>
                          <Td>{valueOrNav(row.ast?.statusState)}</Td>
                          <Td>{valueOrNav(row.ast?.meterType)}</Td>
                          <Td>
                            <Badge
                              tone={
                                row.backend?.eligible ? "success" : "danger"
                              }
                            >
                              {row.backend?.eligible ? "TRUE" : "FALSE"}
                            </Badge>
                          </Td>
                          <Td>{getPremisePropertyType(row)}</Td>
                          <Td>
                            <GeofenceCell
                              row={row}
                              onRepair={() => openGeoFenceRepair(row)}
                            />
                          </Td>
                          <Td>
                            <Badge
                              tone={
                                row.backend?.alreadyHasActiveSameOperationTrn
                                  ? "danger"
                                  : "success"
                              }
                            >
                              {getBlockedFilterValue(row)}
                            </Badge>
                          </Td>
                          <Td>
                            <Badge
                              tone={isBgoReady(row) ? "success" : "warning"}
                            >
                              {getBgoReadyFilterValue(row)}
                            </Badge>
                          </Td>
                          <Td>
                            <Badge
                              tone={isBgoReady(row) ? "success" : "warning"}
                            >
                              {getRowReason(row)}
                            </Badge>
                          </Td>
                          <Td>
                            <Badge
                              tone={isBgoUsed(row) ? "warning" : "neutral"}
                            >
                              {getBgoUsedFilterValue(row)}
                            </Badge>
                          </Td>
                          <Td>{valueOrNav(row.bgo?.batchId)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <PaginationBar
                  pageBounds={pageBounds}
                  pageSize={pageSize}
                  totalRows={filteredRows.length}
                  onPageSizeChange={updatePageSize}
                  onPrevious={() => setPageIndex(pageBounds.safePageIndex - 1)}
                  onNext={() => setPageIndex(pageBounds.safePageIndex + 1)}
                />
              </>
            )}
          </div>
        </>
      ) : null}

      {locationModal ? (
        <LocationMapModal
          modal={locationModal}
          onClose={() => setLocationModal(null)}
        />
      ) : null}
    </section>
  );
}

function UploadInfoPanel({ upload }) {
  return (
    <div style={styles.uploadPanel}>
      <div style={styles.fileInfoCard}>
        <HelpLabel label="File" helpText={HELP_TEXT.file} />
        <strong style={styles.fileName}>{upload?.fileName || "NAv"}</strong>
      </div>

      <div style={styles.uploadMetaGrid}>
        <InfoCard
          label="TRN Type"
          value={upload?.trnType || "NAv"}
          helpText={HELP_TEXT.trnType}
        />
        <InfoCard
          label="LM / Ward"
          value={`${upload?.lmPcode || "NAv"} / ${upload?.wardPcode || "NAv"}`}
          helpText={HELP_TEXT.lmWard}
        />
        <InfoCard
          label="Validation"
          helpText={HELP_TEXT.validation}
          value={
            <Badge tone="warning">{upload?.validationState || "NAv"}</Badge>
          }
        />
        <InfoCard
          label="BGO"
          helpText={HELP_TEXT.bgo}
          value={
            <Badge
              tone={
                upload?.bgoStatus === "READY_FOR_BGO" ? "success" : "neutral"
              }
            >
              {upload?.bgoStatus || "NAv"}
            </Badge>
          }
        />
      </div>
    </div>
  );
}

function InfoCard({ label, value, helpText }) {
  return (
    <div style={styles.infoCard}>
      <HelpLabel label={label} helpText={helpText} />
      <strong style={styles.infoValue}>{value}</strong>
    </div>
  );
}

function TcStatsViewPanel({ summary, rows }) {
  const [activeView, setActiveView] = useState("BALANCE");

  return (
    <div style={styles.decisionPanel}>
      <div style={styles.decisionHeader}>
        <div>
          <h3 style={styles.decisionTitle}>TC Stats View</h3>
          <p style={styles.decisionSubtitle}>
            One stats window with one selected view at a time. Every view keeps
            the numbers balanced and explains how rows move toward BGO.
          </p>
        </div>
      </div>

      <div style={styles.statsTabRow}>
        {STATS_VIEW_OPTIONS.map((view) => (
          <button
            key={view.key}
            type="button"
            style={{
              ...styles.statsTabButton,
              ...(activeView === view.key ? styles.statsTabButtonActive : null),
            }}
            onClick={() => setActiveView(view.key)}
          >
            {view.label}
          </button>
        ))}
      </div>

      {activeView === "BALANCE" ? <BalanceStatsView summary={summary} /> : null}
      {activeView === "BGO_READY" ? <BgoReadyStatsView summary={summary} /> : null}
      {activeView === "ELIGIBLE" ? <EligibleStatsView summary={summary} /> : null}
      {activeView === "GEOFENCE" ? (
        <GeofenceStatsView summary={summary} rows={rows} />
      ) : null}
      {activeView === "BLOCKED" ? <BlockedStatsView summary={summary} /> : null}
    </div>
  );
}

function BalanceStatsView({ summary }) {
  return (
    <div style={styles.statsViewBody}>
      <StatsEquationRow
        title="Matching"
        leftValue={summary.totalRows}
        leftLabel="Total Rows"
        parts={[
          { label: "Found", value: summary.foundRows },
          { label: "Not Found", value: summary.notFoundRows },
        ]}
      />

      <StatsEquationRow
        title="Eligibility"
        leftValue={summary.foundRows}
        leftLabel="Found"
        parts={[
          { label: "Eligible", value: summary.eligibleRows },
          { label: "Not Eligible", value: summary.notEligibleRows },
        ]}
      />

      <StatsEquationRow
        title="BGO Movement"
        leftValue={summary.foundRows}
        leftLabel="Found"
        parts={[
          { label: "BGO Ready", value: summary.readyRows },
          { label: "Used by BGO", value: summary.usedRows },
          { label: "BGO Not Ready", value: summary.bgoNotReadyRows },
        ]}
      />

      <StatsEquationRow
        title="BGO Not Ready"
        leftValue={summary.bgoNotReadyRows}
        leftLabel="BGO Not Ready"
        parts={[
          { label: "Not Eligible", value: summary.notEligibleRows },
          { label: "Eligible Blocked", value: summary.eligibleBlockedRows },
          { label: "Needs Geofence", value: summary.eligibleNeedsGeofenceRows },
          { label: "Other", value: summary.eligibleOtherRows },
        ]}
      />
    </div>
  );
}

function BgoReadyStatsView({ summary }) {
  return (
    <div style={styles.statsViewBody}>
      <TreeRoot
        label="Found"
        value={summary.foundRows}
        childrenNodes={[
          {
            label: "BGO Ready / Used by BGO",
            value: summary.bgoForwardRows,
            childrenNodes: [
              { label: "BGO Ready", value: summary.readyRows },
              { label: "Used by BGO", value: summary.usedRows },
            ],
          },
          {
            label: "BGO Not Ready",
            value: summary.bgoNotReadyRows,
            childrenNodes: [
              {
                label: "Not Eligible",
                value: summary.notEligibleRows,
                childrenNodes: [
                  {
                    label: "Not Eligible Only",
                    value: summary.notEligibleOnlyRows,
                  },
                  {
                    label: "Not Eligible + Blocked Same Operation",
                    value: summary.notEligibleBlockedRows,
                  },
                ],
              },
              {
                label: "Eligible Blocked Same Operation",
                value: summary.eligibleBlockedRows,
              },
              {
                label: "Needs Geofence",
                value: summary.eligibleNeedsGeofenceRows,
              },
              { label: "Other BGO Not Ready", value: summary.eligibleOtherRows },
            ],
          },
        ]}
      />
    </div>
  );
}

function EligibleStatsView({ summary }) {
  return (
    <div style={styles.statsViewBody}>
      <TreeRoot
        label="Found"
        value={summary.foundRows}
        childrenNodes={[
          {
            label: "Eligible",
            value: summary.eligibleRows,
            childrenNodes: [
              { label: "Ready for BGO", value: summary.readyRows },
              {
                label: "Used by BGO",
                value: summary.usedRows,
              },
              {
                label: "Eligible Blocked Same Operation",
                value: summary.eligibleBlockedRows,
              },
              {
                label: "Needs Geofence",
                value: summary.eligibleNeedsGeofenceRows,
              },
              { label: "Other Eligible Not Ready", value: summary.eligibleOtherRows },
            ],
          },
          {
            label: "Not Eligible",
            value: summary.notEligibleRows,
            childrenNodes: [
              { label: "Not Eligible Only", value: summary.notEligibleOnlyRows },
              {
                label: "Not Eligible + Blocked Same Operation",
                value: summary.notEligibleBlockedRows,
              },
            ],
          },
        ]}
      />
    </div>
  );
}

function GeofenceStatsView({ summary, rows }) {
  const geofenceRows = buildGeofenceBgoSplit(rows);
  const totals = geofenceRows.reduce(
    (acc, row) => ({
      found: acc.found + row.found,
      ready: acc.ready + row.ready,
      used: acc.used + row.used,
      notReady: acc.notReady + row.notReady,
    }),
    { found: 0, ready: 0, used: 0, notReady: 0 },
  );

  return (
    <div style={styles.statsViewBody}>
      <StatsEquationRow
        title="Geofence View"
        leftValue={summary.foundRows}
        leftLabel="Found"
        parts={[
          { label: "With Geofence", value: summary.withGeofenceRows },
          { label: "No Geofence", value: summary.noGeofenceRows },
        ]}
      />

      <div style={styles.geofenceSplitBox}>
        <h4 style={styles.statsSectionTitle}>Per Geofence BGO Split</h4>
        <div style={styles.geofenceSplitTableWrap}>
          <table style={styles.geofenceSplitTable}>
            <thead>
              <tr>
                <th style={styles.geofenceSplitTh}>Geofence</th>
                <th style={styles.geofenceSplitThNumber}>Found</th>
                <th style={styles.geofenceSplitThNumber}>BGO Ready</th>
                <th style={styles.geofenceSplitThNumber}>Used by BGO</th>
                <th style={styles.geofenceSplitThNumber}>BGO Not Ready</th>
              </tr>
            </thead>
            <tbody>
              {geofenceRows.map((row) => (
                <tr key={row.id}>
                  <td style={styles.geofenceSplitTd}>{row.name}</td>
                  <td style={styles.geofenceSplitTdNumber}>{row.found}</td>
                  <td style={styles.geofenceSplitTdNumber}>{row.ready}</td>
                  <td style={styles.geofenceSplitTdNumber}>{row.used}</td>
                  <td style={styles.geofenceSplitTdNumber}>{row.notReady}</td>
                </tr>
              ))}
              <tr>
                <td style={styles.geofenceSplitTotalTd}>Totals</td>
                <td style={styles.geofenceSplitTotalNumber}>{totals.found}</td>
                <td style={styles.geofenceSplitTotalNumber}>{totals.ready}</td>
                <td style={styles.geofenceSplitTotalNumber}>{totals.used}</td>
                <td style={styles.geofenceSplitTotalNumber}>{totals.notReady}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function BlockedStatsView({ summary }) {
  return (
    <div style={styles.statsViewBody}>
      <TreeRoot
        label="Blocked Same Operation"
        value={summary.blockedRows}
        childrenNodes={[
          {
            label: "Eligible Blocked Same Operation",
            value: summary.eligibleBlockedRows,
          },
          {
            label: "Not Eligible + Blocked Same Operation",
            value: summary.notEligibleBlockedRows,
          },
        ]}
      />
      <p style={styles.statsNote}>
        Blocked Same Operation is a flag view. It can overlap with Not Eligible,
        so this view explains the split separately.
      </p>
    </div>
  );
}

function StatsEquationRow({ title, leftValue, leftLabel, parts }) {
  return (
    <div style={styles.statsEquationRow}>
      <div style={styles.statsEquationTitle}>{title}</div>
      <div style={styles.statsEquationContent}>
        <span style={styles.statsEquationLeft}>
          <strong>{leftValue}</strong> {leftLabel}
        </span>
        <span style={styles.statsEquationEquals}>=</span>
        <span style={styles.statsEquationParts}>
          {parts.map((part, index) => (
            <span key={part.label} style={styles.statsEquationPart}>
              {index > 0 ? <span style={styles.statsEquationPlus}>+</span> : null}
              <strong>{part.value}</strong> {part.label}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

function TreeRoot({ label, value, childrenNodes }) {
  return (
    <div style={styles.treeBox}>
      <TreeNode label={label} value={value} childrenNodes={childrenNodes} />
    </div>
  );
}

function TreeNode({ label, value, childrenNodes, depth = 0 }) {
  const hasChildren = asArray(childrenNodes).length > 0;

  return (
    <div style={styles.treeNodeWrap}>
      <div style={{ ...styles.treeNodeLine, paddingLeft: depth * 24 }}>
        {depth > 0 ? <span style={styles.treeConnector}>└──</span> : null}
        <span style={styles.treeValue}>{value}</span>
        <span style={styles.treeLabel}>{label}</span>
      </div>

      {hasChildren
        ? childrenNodes.map((node) => (
            <TreeNode
              key={`${node.label}-${node.value}-${depth}`}
              label={node.label}
              value={node.value}
              childrenNodes={node.childrenNodes}
              depth={depth + 1}
            />
          ))
        : null}
    </div>
  );
}

function HelpLabel({ label, helpText }) {
  return (
    <span style={styles.helpLabelWrap}>
      <span style={styles.summaryLabel}>{label}</span>
      {helpText ? <HelpIcon text={helpText} /> : null}
    </span>
  );
}

function HelpIcon({ text }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <span
      style={styles.helpIconWrap}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
      onFocus={() => setIsOpen(true)}
      onBlur={() => setIsOpen(false)}
    >
      <button type="button" style={styles.helpIcon} aria-label="Help">
        ?
      </button>

      {isOpen ? <span style={styles.helpPopup}>{text}</span> : null}
    </span>
  );
}

function GeofenceCell({ row, onRepair }) {
  const label = getGeofenceLabel(row);

  if (!rowCanLaunchGeofenceRepair(row)) {
    return <span>{label}</span>;
  }

  return (
    <button
      type="button"
      style={styles.noGeofenceRepairButton}
      onClick={onRepair}
      title="Open Geo-Fences on this meter"
    >
      <span style={styles.noGeofenceRepairMain}>NO_GEOFENCE</span>
      <span style={styles.noGeofenceRepairSub}>Open map</span>
    </button>
  );
}

function LocationCellButton({ label, onClick }) {
  const displayLabel = label || "NAv";

  return (
    <button
      type="button"
      style={styles.locationCellButton}
      onClick={onClick}
      title={displayLabel}
    >
      <span style={styles.locationCellText}>{displayLabel}</span>
      <span style={styles.locationCellIcon}>⌖</span>
    </button>
  );
}

function LocationMapModal({ modal, onClose }) {
  const coordinates = getGpsCoordinates(modal?.gps);
  const delta = 0.003;
  const mapUrl = coordinates
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${
        coordinates.longitude - delta
      }%2C${coordinates.latitude - delta}%2C${
        coordinates.longitude + delta
      }%2C${coordinates.latitude + delta}&layer=mapnik&marker=${
        coordinates.latitude
      }%2C${coordinates.longitude}`
    : null;
  const externalMapUrl = coordinates
    ? `https://www.google.com/maps?q=${coordinates.latitude},${coordinates.longitude}`
    : null;

  return (
    <div style={styles.modalBackdrop}>
      <div style={styles.mapModalCard}>
        <div style={styles.mapModalHeader}>
          <div>
            <p style={styles.eyebrow}>GPS / Map</p>
            <h3 style={styles.mapModalTitle}>
              {modal?.title || "GPS Location"}
            </h3>
            <p style={styles.mapModalSubtitle}>{modal?.subtitle || "NAv"}</p>
          </div>

          <button type="button" style={styles.closeButton} onClick={onClose}>
            ×
          </button>
        </div>

        <div style={styles.mapFactsGrid}>
          {asArray(modal?.facts).map((fact) => (
            <div key={fact.label} style={styles.mapFactCard}>
              <span style={styles.mapFactLabel}>{fact.label}</span>
              <strong style={styles.mapFactValue}>{fact.value || "NAv"}</strong>
            </div>
          ))}

          <div style={styles.mapFactCard}>
            <span style={styles.mapFactLabel}>GPS</span>
            <strong style={styles.mapFactValue}>{formatGps(modal?.gps)}</strong>
          </div>
        </div>

        {coordinates ? (
          <>
            <div style={styles.mapFrameWrap}>
              <iframe
                title={modal?.title || "GPS map"}
                src={mapUrl}
                style={styles.mapFrame}
              />
            </div>

            <a
              href={externalMapUrl}
              target="_blank"
              rel="noreferrer"
              style={styles.openExternalMapLink}
            >
              Open in Google Maps
            </a>
          </>
        ) : (
          <div style={styles.mapUnavailable}>
            GPS is not available for this record yet. The row can still be
            reviewed, but no map can be displayed until GPS exists on the linked
            meter document or premise geometry centroid.
          </div>
        )}
      </div>
    </div>
  );
}

function PaginationBar({
  pageBounds,
  pageSize,
  totalRows,
  onPageSizeChange,
  onPrevious,
  onNext,
}) {
  const isPreviousDisabled = pageBounds.safePageIndex <= 0;
  const isNextDisabled = pageBounds.safePageIndex >= pageBounds.pageCount - 1;

  return (
    <div style={styles.paginationBar}>
      <div style={styles.paginationText}>
        Showing {pageBounds.displayStart}–{pageBounds.displayEnd} of {totalRows}{" "}
        rows • Page {pageBounds.safePageIndex + 1} of {pageBounds.pageCount}
      </div>

      <div style={styles.paginationControls}>
        <label style={styles.pageSizeLabel}>
          Rows per page
          <select
            style={styles.pageSizeSelect}
            value={pageSize}
            onChange={(event) => onPageSizeChange(event.target.value)}
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
          style={{
            ...styles.paginationButton,
            ...(isPreviousDisabled ? styles.disabledButton : null),
          }}
          disabled={isPreviousDisabled}
          onClick={onPrevious}
        >
          Previous
        </button>

        <button
          type="button"
          style={{
            ...styles.paginationButton,
            ...(isNextDisabled ? styles.disabledButton : null),
          }}
          disabled={isNextDisabled}
          onClick={onNext}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function Badge({ children, tone = "neutral" }) {
  const toneStyle =
    tone === "success"
      ? styles.successBadge
      : tone === "warning"
        ? styles.warningBadge
        : tone === "danger"
          ? styles.dangerBadge
          : styles.neutralBadge;

  return <span style={{ ...styles.badge, ...toneStyle }}>{children}</span>;
}

function Th({ children, helpText }) {
  return (
    <th style={styles.th}>
      <span style={styles.thLabelWrap}>
        <span>{children}</span>
        {helpText ? <HelpIcon text={helpText} /> : null}
      </span>
    </th>
  );
}

function FilterTh({ children }) {
  return <th style={styles.filterTh}>{children}</th>;
}

function Td({ children, strong = false }) {
  return (
    <td style={{ ...styles.td, ...(strong ? styles.strongCell : null) }}>
      {children}
    </td>
  );
}

const styles = {
  page: {
    padding: 24,
  },
  backLink: {
    display: "inline-flex",
    marginBottom: 14,
    color: "#2563eb",
    fontWeight: 900,
    textDecoration: "none",
  },
  header: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 24,
    padding: 24,
    marginBottom: 16,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  eyebrow: {
    margin: 0,
    fontSize: 12,
    fontWeight: 900,
    color: "#2563eb",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  title: {
    margin: "8px 0 8px",
    fontSize: 26,
    color: "#0f172a",
    wordBreak: "break-word",
  },
  subtitle: {
    margin: 0,
    maxWidth: 760,
    color: "#64748b",
    lineHeight: 1.6,
  },
  uploadPanel: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    display: "grid",
    gap: 14,
  },
  fileInfoCard: {
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    padding: 14,
    background: "#f8fafc",
  },
  fileName: {
    display: "block",
    marginTop: 6,
    color: "#0f172a",
    fontSize: 15,
    lineHeight: 1.5,
    whiteSpace: "normal",
    wordBreak: "break-word",
  },
  uploadMetaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 12,
  },
  infoCard: {
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    padding: 14,
    background: "#ffffff",
  },
  infoValue: {
    display: "block",
    marginTop: 6,
    color: "#0f172a",
    fontSize: 14,
    lineHeight: 1.45,
  },
  decisionPanel: {
    background: "#ffffff",
    border: "1px solid #dbeafe",
    borderRadius: 22,
    padding: 16,
    marginBottom: 16,
  },
  decisionHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14,
  },
  decisionTitle: {
    margin: 0,
    color: "#0f172a",
    fontSize: 18,
  },
  decisionSubtitle: {
    margin: "6px 0 0",
    color: "#64748b",
    fontSize: 13,
    lineHeight: 1.5,
  },
  funnelGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))",
    gap: 12,
  },
  mathLineCard: {
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    padding: 14,
    background: "#f8fafc",
  },
  mathTitle: {
    color: "#1d4ed8",
    fontSize: 12,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  mathEquation: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    color: "#334155",
    fontSize: 13,
    lineHeight: 1.6,
  },
  mathLeft: {
    color: "#0f172a",
  },
  mathEquals: {
    color: "#64748b",
    fontWeight: 900,
  },
  mathParts: {
    display: "inline-flex",
    flexWrap: "wrap",
    gap: 6,
  },
  mathPart: {
    display: "inline-flex",
    gap: 4,
    alignItems: "center",
  },
  mathPlus: {
    color: "#64748b",
    fontWeight: 900,
  },
  geofenceBreakdownBox: {
    marginTop: 14,
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    padding: 14,
    background: "#ffffff",
  },
  geofencePills: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  geofencePill: {
    border: "1px solid #cbd5e1",
    background: "#f8fafc",
    color: "#334155",
    borderRadius: 999,
    padding: "7px 10px",
    fontSize: 12,
  },
  statsTabRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    borderTop: "1px solid #e2e8f0",
    paddingTop: 14,
    marginBottom: 14,
  },
  statsTabButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 999,
    background: "#ffffff",
    color: "#334155",
    padding: "9px 12px",
    fontWeight: 900,
    cursor: "pointer",
  },
  statsTabButtonActive: {
    borderColor: "#2563eb",
    background: "#eff6ff",
    color: "#1d4ed8",
  },
  statsViewBody: {
    display: "grid",
    gap: 12,
  },
  statsEquationRow: {
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    padding: 14,
    background: "#f8fafc",
  },
  statsEquationTitle: {
    color: "#1d4ed8",
    fontSize: 12,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  statsEquationContent: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    color: "#334155",
    fontSize: 14,
    lineHeight: 1.6,
  },
  statsEquationLeft: {
    color: "#0f172a",
  },
  statsEquationEquals: {
    color: "#64748b",
    fontWeight: 900,
  },
  statsEquationParts: {
    display: "inline-flex",
    flexWrap: "wrap",
    gap: 6,
  },
  statsEquationPart: {
    display: "inline-flex",
    gap: 4,
    alignItems: "center",
  },
  statsEquationPlus: {
    color: "#64748b",
    fontWeight: 900,
  },
  treeBox: {
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    padding: 16,
    background: "#f8fafc",
    color: "#334155",
    overflowX: "auto",
  },
  treeNodeWrap: {
    display: "grid",
    gap: 5,
  },
  treeNodeLine: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    minHeight: 28,
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    fontSize: 13,
    whiteSpace: "nowrap",
  },
  treeConnector: {
    color: "#94a3b8",
    fontWeight: 900,
  },
  treeValue: {
    color: "#0f172a",
    fontWeight: 900,
  },
  treeLabel: {
    color: "#334155",
    fontWeight: 800,
  },
  statsNote: {
    margin: 0,
    color: "#64748b",
    fontSize: 13,
    lineHeight: 1.6,
  },
  statsSectionTitle: {
    margin: "0 0 10px",
    color: "#0f172a",
    fontSize: 14,
  },
  geofenceSplitBox: {
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    padding: 14,
    background: "#ffffff",
  },
  geofenceSplitTableWrap: {
    overflowX: "auto",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
  },
  geofenceSplitTable: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    minWidth: 650,
  },
  geofenceSplitTh: {
    textAlign: "left",
    background: "#f8fafc",
    color: "#475569",
    borderBottom: "1px solid #e2e8f0",
    padding: "11px 12px",
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  geofenceSplitThNumber: {
    textAlign: "right",
    background: "#f8fafc",
    color: "#475569",
    borderBottom: "1px solid #e2e8f0",
    padding: "11px 12px",
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  geofenceSplitTd: {
    color: "#334155",
    borderBottom: "1px solid #f1f5f9",
    padding: "11px 12px",
    fontSize: 13,
    fontWeight: 800,
  },
  geofenceSplitTdNumber: {
    color: "#0f172a",
    borderBottom: "1px solid #f1f5f9",
    padding: "11px 12px",
    textAlign: "right",
    fontSize: 13,
    fontWeight: 900,
  },
  geofenceSplitTotalTd: {
    color: "#0f172a",
    background: "#f8fafc",
    padding: "12px",
    fontSize: 13,
    fontWeight: 900,
  },
  geofenceSplitTotalNumber: {
    color: "#0f172a",
    background: "#f8fafc",
    padding: "12px",
    textAlign: "right",
    fontSize: 13,
    fontWeight: 900,
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 12,
    marginBottom: 16,
  },
  summaryCard: {
    position: "relative",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 16,
    minHeight: 92,
  },
  helpLabelWrap: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    position: "relative",
  },
  summaryLabel: {
    display: "inline-block",
    fontSize: 12,
    fontWeight: 900,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  summaryValue: {
    display: "block",
    marginTop: 8,
    fontSize: 26,
    color: "#0f172a",
  },
  filteredSummaryValue: {
    position: "absolute",
    right: 14,
    bottom: 10,
    color: "#2563eb",
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: 999,
    minWidth: 28,
    height: 24,
    padding: "0 8px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 13,
    fontWeight: 900,
    lineHeight: 1,
  },
  helpIconWrap: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    zIndex: 20,
  },
  helpIcon: {
    width: 18,
    height: 18,
    borderRadius: 999,
    border: "1px solid #93c5fd",
    background: "#eff6ff",
    color: "#1d4ed8",
    fontSize: 11,
    fontWeight: 900,
    lineHeight: "16px",
    cursor: "help",
    padding: 0,
  },
  helpPopup: {
    position: "absolute",
    top: 24,
    left: 0,
    width: 360,
    maxWidth: "75vw",
    background: "#0f172a",
    color: "#ffffff",
    borderRadius: 14,
    padding: "10px 12px",
    fontSize: 12,
    lineHeight: 1.5,
    fontWeight: 700,
    whiteSpace: "pre-line",
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.28)",
    zIndex: 5000,
    textTransform: "none",
    letterSpacing: 0,
  },
  stickyPanel: {
    position: "sticky",
    top: 12,
    maxHeight: "calc(100vh - 24px)",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 24,
    padding: 18,
    display: "flex",
    flexDirection: "column",
    minHeight: 520,
    overflow: "hidden",
    zIndex: 10,
  },
  panelTitleRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  panelHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14,
    flexShrink: 0,
  },
  panelTitle: {
    margin: 0,
    fontSize: 18,
    color: "#0f172a",
  },
  panelSubtitle: {
    margin: "6px 0 0",
    color: "#64748b",
    fontSize: 13,
    lineHeight: 1.5,
  },
  rowCountBadge: {
    border: "1px solid #cbd5e1",
    background: "#f8fafc",
    color: "#475569",
    borderRadius: 999,
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  filterRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 14,
    flexShrink: 0,
  },
  filterButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 999,
    background: "#ffffff",
    color: "#334155",
    padding: "9px 12px",
    fontWeight: 900,
    cursor: "pointer",
  },
  filterButtonActive: {
    borderColor: "#2563eb",
    background: "#eff6ff",
    color: "#1d4ed8",
  },
  clearFilterButton: {
    border: "1px solid #fbbf24",
    borderRadius: 999,
    background: "#fffbeb",
    color: "#92400e",
    padding: "9px 12px",
    fontWeight: 900,
    cursor: "pointer",
  },
  tableWrap: {
    overflow: "auto",
    flex: 1,
    minHeight: 300,
    border: "1px solid #e2e8f0",
    borderRadius: 16,
  },
  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    minWidth: 2050,
  },
  th: {
    position: "sticky",
    top: 0,
    zIndex: 4,
    textAlign: "left",
    fontSize: 11,
    color: "#475569",
    background: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
    padding: "12px 10px",
    whiteSpace: "nowrap",
  },
  thLabelWrap: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  },
  filterTh: {
    position: "sticky",
    top: 39,
    zIndex: 3,
    textAlign: "left",
    background: "#ffffff",
    borderBottom: "1px solid #e2e8f0",
    padding: "8px 10px",
    whiteSpace: "nowrap",
  },
  filterSelect: {
    width: "100%",
    minWidth: 120,
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    padding: "7px 8px",
    background: "#ffffff",
    color: "#334155",
    fontSize: 12,
    fontWeight: 800,
  },
  td: {
    fontSize: 12,
    color: "#334155",
    borderBottom: "1px solid #f1f5f9",
    padding: "12px 10px",
    whiteSpace: "nowrap",
    verticalAlign: "top",
    background: "#ffffff",
  },
  strongCell: {
    color: "#0f172a",
    fontWeight: 900,
  },
  noGeofenceRepairButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    border: "1px solid #fed7aa",
    background: "#fff7ed",
    color: "#9a3412",
    borderRadius: 999,
    padding: "7px 10px",
    fontSize: 11,
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  noGeofenceRepairMain: {
    color: "#9a3412",
    fontWeight: 900,
  },
  noGeofenceRepairSub: {
    color: "#2563eb",
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: 999,
    padding: "2px 6px",
    fontSize: 10,
    fontWeight: 900,
  },
  locationCellButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    border: "1px solid #bfdbfe",
    background: "#eff6ff",
    color: "#1d4ed8",
    borderRadius: 999,
    padding: "7px 10px",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
    maxWidth: 520,
    whiteSpace: "nowrap",
    textAlign: "left",
  },
  locationCellText: {
    display: "inline-block",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: 470,
  },
  locationCellIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 17,
    height: 17,
    borderRadius: 999,
    background: "#dbeafe",
    color: "#1d4ed8",
    fontSize: 11,
    flexShrink: 0,
  },
  paginationBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    borderTop: "1px solid #e2e8f0",
    paddingTop: 12,
    marginTop: 12,
    flexShrink: 0,
  },
  paginationText: {
    color: "#475569",
    fontSize: 12,
    fontWeight: 900,
  },
  paginationControls: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  pageSizeLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    color: "#475569",
    fontSize: 12,
    fontWeight: 900,
  },
  pageSizeSelect: {
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    padding: "7px 8px",
    background: "#ffffff",
    color: "#334155",
    fontWeight: 900,
  },
  paginationButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 12,
    background: "#ffffff",
    color: "#334155",
    padding: "9px 12px",
    fontWeight: 900,
    cursor: "pointer",
  },
  disabledButton: {
    opacity: 0.55,
    cursor: "not-allowed",
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    padding: "5px 9px",
    fontSize: 10,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  successBadge: {
    background: "#dcfce7",
    color: "#166534",
  },
  warningBadge: {
    background: "#fef3c7",
    color: "#92400e",
  },
  dangerBadge: {
    background: "#fee2e2",
    color: "#991b1b",
  },
  neutralBadge: {
    background: "#f1f5f9",
    color: "#475569",
  },
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 23, 42, 0.58)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    zIndex: 9000,
  },
  mapModalCard: {
    width: "min(920px, 100%)",
    maxHeight: "92vh",
    overflowY: "auto",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 24,
    boxShadow: "0 30px 80px rgba(15, 23, 42, 0.35)",
    padding: 20,
  },
  mapModalHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
    marginBottom: 14,
  },
  mapModalTitle: {
    margin: "8px 0 6px",
    color: "#0f172a",
    fontSize: 22,
  },
  mapModalSubtitle: {
    margin: 0,
    color: "#64748b",
    fontSize: 13,
    lineHeight: 1.5,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    cursor: "pointer",
    fontSize: 24,
    lineHeight: 1,
    flexShrink: 0,
  },
  mapFactsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 10,
    marginBottom: 14,
  },
  mapFactCard: {
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 12,
    background: "#f8fafc",
  },
  mapFactLabel: {
    display: "block",
    color: "#64748b",
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 5,
  },
  mapFactValue: {
    display: "block",
    color: "#0f172a",
    fontSize: 13,
    lineHeight: 1.45,
    wordBreak: "break-word",
  },
  mapFrameWrap: {
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    overflow: "hidden",
    height: 420,
    background: "#f8fafc",
  },
  mapFrame: {
    width: "100%",
    height: "100%",
    border: 0,
  },
  openExternalMapLink: {
    display: "inline-flex",
    marginTop: 12,
    color: "#2563eb",
    fontWeight: 900,
    textDecoration: "none",
  },
  mapUnavailable: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    color: "#92400e",
    borderRadius: 16,
    padding: 16,
    fontSize: 13,
    fontWeight: 800,
    lineHeight: 1.6,
  },
  notice: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    padding: 16,
    color: "#475569",
    fontWeight: 800,
    marginBottom: 16,
  },
  errorNotice: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 16,
    padding: 16,
    color: "#991b1b",
    fontWeight: 800,
    marginBottom: 16,
  },

  topActionRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 14,
  },

  headerActionLink: {
    display: "inline-flex",
    alignItems: "center",
    border: "1px solid #bfdbfe",
    borderRadius: 999,
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 900,
    textDecoration: "none",
  },

  bgoActionLink: {
    display: "inline-flex",
    alignItems: "center",
    border: "1px solid #bbf7d0",
    borderRadius: 999,
    background: "#dcfce7",
    color: "#166534",
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 900,
    textDecoration: "none",
  },

  bgoActionDisabled: {
    display: "inline-flex",
    alignItems: "center",
    border: "1px solid #e2e8f0",
    borderRadius: 999,
    background: "#f8fafc",
    color: "#94a3b8",
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 900,
    cursor: "not-allowed",
  },
};
