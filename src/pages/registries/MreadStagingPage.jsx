/* eslint-disable no-unused-vars -- JSX tags are consumed by React; this ESLint profile does not track them. */
import IrepsTable from "../../components/table/IrepsTable";
import { filterIrepsTableRows } from "../../components/table/irepsTableModel.js";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";
import { useAuth } from "../../auth/useAuth";
import { useListMreadStagingSessionsQuery,
  useListMreadStagingRowsQuery,
} from "../../redux/mreadStagingApi";
import { useListMreadStagingCyclesQuery } from "../../redux/mreadStagingCyclesApi";
import { useGetRegistryMreadByWardQuery } from "../../redux/registryMreadApi";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";
import { useGetWardBoundariesByLmQuery } from "../../redux/mapWardsApi";
import { useGeo } from "../../context/GeoContext";

import SharedMeterHistoryModal from "../../components/mread/MeterHistoryModal";
import { FORM_TEXT } from "../../theme/formColors";

const ROWS_FETCH_LIMIT = 1000;
const DEFAULT_TABLE_SORT = { key: "", direction: "asc" };
const NAv = "NAv";

function safeText(value, fallback = NAv) {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function formatNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toLocaleString() : NAv;
}

function formatDateTime(value) {
  if (!value || value === NAv) return NAv;

  if (typeof value === "string") {
    const text = value.trim();
    if (!text || text === NAv) return NAv;
    return text.slice(0, 19).replace("T", " ");
  }

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? value.toLocaleString() : NAv;
  }

  if (typeof value?.toDate === "function") {
    return value.toDate().toLocaleString();
  }

  const seconds = value?.seconds ?? value?._seconds;
  if (typeof seconds === "number") {
    return new Date(seconds * 1000).toLocaleString();
  }

  return NAv;
}

function isMeaningfulText(value) {
  const text = safeText(value, "");
  return Boolean(text && text !== NAv && text.toUpperCase() !== "ALL");
}

function getActiveLmPcode(activeWorkbase) {
  return (
    activeWorkbase?.lmPcode ||
    activeWorkbase?.pcode ||
    activeWorkbase?.id ||
    activeWorkbase?.localMunicipalityId ||
    ""
  );
}

function getWardLabel(ward) {
  if (!ward) return NAv;

  const wardNumber = safeText(ward.wardNumber || ward.code, "");
  if (wardNumber && wardNumber !== NAv) return `Ward ${wardNumber}`;

  return safeText(ward.wardName || ward.name || ward.wardPcode);
}

function getWardPcode(ward) {
  return safeText(ward?.wardPcode || ward?.pcode || ward?.id || ward?.code, "");
}

function formatWardLabelFromNumber(value) {
  const text = safeText(value, "");
  if (!text || text === NAv) return "";

  const wardTextMatch = text.match(/^ward\s+(\d{1,3})$/i);
  if (wardTextMatch?.[1]) return `Ward ${Number(wardTextMatch[1])}`;

  if (/^\d{1,3}$/.test(text)) {
    const numberValue = Number(text);
    return Number.isFinite(numberValue) && numberValue > 0
      ? `Ward ${numberValue}`
      : "";
  }

  return "";
}

function getWardLabelForPcode(wardPcode, wardRows = []) {
  const cleanWardPcode = safeText(wardPcode, "");
  if (!cleanWardPcode || cleanWardPcode === NAv) return NAv;

  const directWardLabel = formatWardLabelFromNumber(cleanWardPcode);
  if (directWardLabel) return directWardLabel;

  const matchedWard = wardRows.find(
    (ward) => getWardPcode(ward) === cleanWardPcode,
  );
  if (matchedWard) return getWardLabel(matchedWard);

  const wardNumberMatch = cleanWardPcode.match(/(\d{1,3})$/);
  if (wardNumberMatch?.[1]) {
    const wardNumber = Number(wardNumberMatch[1]);
    if (Number.isFinite(wardNumber) && wardNumber > 0)
      return `Ward ${wardNumber}`;
  }

  return cleanWardPcode;
}

function getRowWardLabel(row, wardRows = []) {
  const directWardLabel =
    formatWardLabelFromNumber(row?.wardNo) ||
    formatWardLabelFromNumber(row?.wardNumber);

  if (directWardLabel) return directWardLabel;

  return getWardLabelForPcode(
    row?.wardPcode ||
      row?.geography?.wardPcode ||
      row?.ward ||
      row?.wardCode ||
      row?.pcode,
    wardRows,
  );
}

function firstValue(...values) {
  for (const value of values) {
    if (value === 0) return value;
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return value;
    }
  }

  return null;
}

function firstText(...values) {
  const value = firstValue(...values);
  return safeText(value);
}

function getTableFilterValue(row, key) {
  if (key === "meterNo") return getMeterNo(row);
  if (key === "premiseType")
    return safeText(row?.premiseType || row?.propertyType, "");

  if (["currentReading", "prevReading", "consumption"].includes(key)) {
    const rawValue = row?.[key];
    const dateValue =
      key === "currentReading"
        ? formatReadingTimestamp(getCurrentReadingDateTime(row))
        : key === "prevReading"
          ? formatReadingTimestamp(getPreviousReadingDateTime(row))
          : "";

    return `${safeText(rawValue, "")} ${formatNumber(rawValue)} ${dateValue}`.trim();
  }

  return safeText(row?.[key], "");
}

function formatTableValue(row, key, actions = {}) {
  if (key === "meterNo") {
    const meterNo = getMeterNo(row);

    return (
      <button
        type="button"
        className="text-link"
        style={meterNoButtonStyle}
        onClick={() => actions.onMeterClick?.(row)}
        title="Open meter details and reading history"
      >
        {meterNo}
      </button>
    );
  }

  if (key === "currentReading") {
    return (
      <ReadingValueWithDate
        value={row?.currentReading}
        dateTime={getCurrentReadingDateTime(row)}
      />
    );
  }

  if (key === "prevReading") {
    return (
      <ReadingValueWithDate
        value={row?.prevReading}
        dateTime={getPreviousReadingDateTime(row)}
      />
    );
  }

  if (
    [
      "consumption",
      "successfulReads",
      "unsuccessful",
      "noAccess",
      "mediaEvidence",
    ].includes(key)
  ) {
    return formatNumber(row?.[key]);
  }

  return safeText(row?.[key]);
}

function getNumberSortValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(numberValue) ? numberValue : null;
}

function getWardSortValue(value) {
  const match = safeText(value, "").match(/(\d{1,3})/);
  const numberValue = Number(match?.[1] || 0);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

function getTableSortValue(row, key) {
  if (
    [
      "currentReading",
      "prevReading",
      "consumption",
      "successfulReads",
      "unsuccessful",
      "noAccess",
      "mediaEvidence",
    ].includes(key)
  ) {
    return getNumberSortValue(row?.[key]);
  }

  if (key === "meterNo") return getMeterNo(row);
  if (key === "wardLabel") return getWardSortValue(row?.wardLabel);
  if (key === "premiseType")
    return safeText(row?.premiseType || row?.propertyType, "");

  return safeText(row?.[key], "");
}

function mergeWardOptions(...wardSources) {
  const byPcode = new Map();

  wardSources.flat().forEach((ward) => {
    const wardPcode = getWardPcode(ward);
    if (!wardPcode || wardPcode === NAv) return;

    byPcode.set(wardPcode, {
      ...(byPcode.get(wardPcode) || {}),
      ...ward,
      id: wardPcode,
      pcode: wardPcode,
      wardPcode,
    });
  });

  return Array.from(byPcode.values()).sort((left, right) => {
    const leftNumber = Number(left.wardNumber || left.code || 0);
    const rightNumber = Number(right.wardNumber || right.code || 0);

    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber - rightNumber;
    }

    return getWardLabel(left).localeCompare(getWardLabel(right));
  });
}

function readCycleGeneratedAt(cycle) {
  return (
    cycle?.lastGenerated?.generatedAt ||
    cycle?.lastGenerated?.at ||
    cycle?.metadata?.updatedAt ||
    null
  );
}

function buildSessionFromCycle(cycle) {
  const stagingId = safeText(cycle?.activeStagingId, "");
  if (!isMeaningfulText(stagingId)) return null;

  const summary = cycle?.summary || {};

  return {
    id: stagingId,
    stagingId,
    tableId: stagingId,
    tableStatus: safeText(cycle?.status),
    cycleId: safeText(cycle?.cycleId),
    lmPcode: safeText(cycle?.lmPcode),
    windowDisplay: safeText(cycle?.window?.display),
    generatedAt: readCycleGeneratedAt(cycle),
    generatedByUser: safeText(cycle?.lastGenerated?.generatedByUser),
    generationIteration: Number(cycle?.lastGenerated?.iteration || 0),
    rowCount: Number(summary?.totalRows || 0),
    successfulReads: Number(summary?.successfulReads || 0),
    noAccess: Number(summary?.noAccess || 0),
    unsuccessful: Number(summary?.unsuccessful || 0),
    mediaEvidence: Number(summary?.mediaEvidence || 0),
    source: "cycle",
  };
}

function hasUsableValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return isMeaningfulText(value);
  return true;
}

function pickValue(...values) {
  return values.find(hasUsableValue);
}

function getCurrentReadingDateTime(row = {}) {
  return pickValue(
    row.currentReadingAt,
    row.currentReadingDateTime,
    row.currentReadingDate,
    row.currentReadAt,
    row.currentReadDate,
    row.readingAt,
    row.readingDate,
    row.current?.readingAt,
    row.current?.readingDate,
    row.currentReading?.readingAt,
    row.currentReading?.readingDate,
    row.reading?.currentReadingAt,
    row.reading?.currentReadingDate,
    row.reading?.readingAt,
    row.raw?.currentReadingAt,
    row.raw?.currentReadingDate,
    row.raw?.readingAt,
    row.raw?.reading?.currentReadingAt,
    row.raw?.reading?.currentReadingDate,
    row.raw?.reading?.readingAt,
  );
}

function getPreviousReadingDateTime(row = {}) {
  return pickValue(
    row.prevReadingAt,
    row.prevReadingDateTime,
    row.prevReadingDate,
    row.previousReadingAt,
    row.previousReadingDateTime,
    row.previousReadingDate,
    row.previousReadAt,
    row.previousReadDate,
    row.baseReadingAt,
    row.baseReadingDate,
    row.previous?.readingAt,
    row.previous?.readingDate,
    row.prev?.readingAt,
    row.prev?.readingDate,
    row.base?.readingAt,
    row.base?.readingDate,
    row.previousReading?.readingAt,
    row.previousReading?.readingDate,
    row.reading?.prevReadingAt,
    row.reading?.prevReadingDate,
    row.reading?.previousReadingAt,
    row.reading?.previousReadingDate,
    row.raw?.prevReadingAt,
    row.raw?.prevReadingDate,
    row.raw?.previousReadingAt,
    row.raw?.previousReadingDate,
    row.raw?.reading?.prevReadingAt,
    row.raw?.reading?.prevReadingDate,
    row.raw?.reading?.previousReadingAt,
    row.raw?.reading?.previousReadingDate,
  );
}

function formatReadingTimestamp(value) {
  const display = formatDateTime(value);
  return display === NAv ? NAv : display;
}

function ReadingValueWithDate({ value, dateTime }) {
  return (
    <div style={readingValueStackStyle}>
      <strong>{formatNumber(value)}</strong>
      <span style={readingMetaStyle}>{formatReadingTimestamp(dateTime)}</span>
    </div>
  );
}

function getMeterNo(row = {}) {
  return firstText(
    row.meterNo,
    row.astNo,
    row?.meter?.astNo,
    row?.meter?.meterNo,
    row?.meterSnapshot?.astNo,
    row?.meterSnapshot?.meterNo,
    row?.ast?.astData?.astNo,
    row?.ast?.astData?.meterNo,
    row?.raw?.meterNo,
    row?.raw?.astNo,
    row?.raw?.meter?.astNo,
    row?.raw?.meter?.meterNo,
  );
}

function normalizeSession(session) {
  if (!session) return null;

  const sessionId = pickValue(session.id, session.stagingId, session.tableId);
  const stagingId = pickValue(session.stagingId, session.tableId, session.id);
  const tableId = pickValue(session.tableId, session.stagingId, session.id);

  return {
    ...session,
    id: sessionId,
    stagingId,
    tableId,
    tableStatus: pickValue(session.tableStatus, session.status),
    cycleId: pickValue(
      session.cycleId,
      session.selectedCycle?.cycleId,
      session.cycle?.cycleId,
    ),
    lmPcode: pickValue(session.lmPcode, session.localMunicipalityPcode),
    windowDisplay: pickValue(
      session.windowDisplay,
      session.window?.display,
      session.selectedCycle?.windowDisplay,
      session.selectedCycle?.window?.display,
      session.cycle?.windowDisplay,
      session.cycle?.window?.display,
    ),
    generatedAt: pickValue(
      session.generatedAt,
      session.generated?.at,
      session.lastGenerated?.generatedAt,
      session.lastGenerated?.at,
      session.metadata?.createdAt,
      session.metadata?.updatedAt,
      session.createdAt,
      session.updatedAt,
    ),
  };
}

function mergeSession(existing, incoming) {
  const base = normalizeSession(existing) || {};
  const next = normalizeSession(incoming) || {};

  return {
    ...base,
    ...next,
    id: pickValue(next.id, base.id),
    stagingId: pickValue(
      next.stagingId,
      next.tableId,
      next.id,
      base.stagingId,
      base.tableId,
      base.id,
    ),
    tableId: pickValue(
      next.tableId,
      next.stagingId,
      next.id,
      base.tableId,
      base.stagingId,
      base.id,
    ),
    tableStatus: pickValue(next.tableStatus, base.tableStatus),
    cycleId: pickValue(next.cycleId, base.cycleId),
    lmPcode: pickValue(next.lmPcode, base.lmPcode),
    windowDisplay: pickValue(next.windowDisplay, base.windowDisplay),
    generatedAt: pickValue(next.generatedAt, base.generatedAt),
  };
}

function parseGeneratedStamp(text) {
  const stampMatch = safeText(text, "").match(/(\d{8})_(\d{6})/);
  if (!stampMatch) return 0;

  const [, datePart, timePart] = stampMatch;
  const isoText = `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}T${timePart.slice(0, 2)}:${timePart.slice(2, 4)}:${timePart.slice(4, 6)}`;
  const parsed = Date.parse(isoText);

  return Number.isFinite(parsed) ? parsed : 0;
}

function parseGeneratedTime(value) {
  if (!hasUsableValue(value)) return 0;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0;
    return value < 1000000000000 ? value * 1000 : value;
  }

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : 0;
  }

  if (typeof value?.toMillis === "function") {
    const time = value.toMillis();
    return Number.isFinite(time) ? time : 0;
  }

  if (typeof value?.toDate === "function") {
    const time = value.toDate().getTime();
    return Number.isFinite(time) ? time : 0;
  }

  const seconds = value?.seconds ?? value?._seconds;
  if (typeof seconds === "number") return seconds * 1000;

  const text = safeText(value, "");
  if (!text || text === NAv) return 0;

  const fromStamp = parseGeneratedStamp(text);
  if (fromStamp) return fromStamp;

  const parsed = Date.parse(text.replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getSessionGeneratedStamp(session) {
  const tableId = safeText(
    session?.tableId || session?.stagingId || session?.id,
    "",
  );
  const stampMatch = tableId.match(/(\d{8}_\d{6})$/);

  return stampMatch?.[1] || "";
}

function formatGeneratedStamp(stamp) {
  const stampMatch = safeText(stamp, "").match(/^(\d{8})_(\d{6})$/);
  if (!stampMatch) return NAv;

  const [, datePart, timePart] = stampMatch;
  return `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)} ${timePart.slice(0, 2)}:${timePart.slice(2, 4)}:${timePart.slice(4, 6)}`;
}

function formatSessionGeneratedAt(session) {
  const directGeneratedAt = pickValue(
    session?.generatedAt,
    session?.generated?.at,
    session?.lastGenerated?.generatedAt,
    session?.lastGenerated?.at,
    session?.metadata?.createdAt,
    session?.metadata?.updatedAt,
    session?.createdAt,
    session?.updatedAt,
  );

  const directDisplay = formatDateTime(directGeneratedAt);
  if (directDisplay !== NAv) return directDisplay;

  return formatGeneratedStamp(getSessionGeneratedStamp(session));
}

function getSessionGeneratedSortTime(session) {
  return (
    parseGeneratedTime(session?.generatedAt) ||
    parseGeneratedStamp(session?.tableId) ||
    parseGeneratedStamp(session?.stagingId) ||
    parseGeneratedStamp(session?.id)
  );
}

function sortSessions(left, right) {
  const leftTime = getSessionGeneratedSortTime(left);
  const rightTime = getSessionGeneratedSortTime(right);

  if (leftTime !== rightTime) return rightTime - leftTime;

  const leftTableId = safeText(
    left?.tableId || left?.stagingId || left?.id,
    "",
  );
  const rightTableId = safeText(
    right?.tableId || right?.stagingId || right?.id,
    "",
  );

  return rightTableId.localeCompare(leftTableId);
}

function getSessionCycleLabel(session) {
  const cycleId = safeText(session?.cycleId, "");
  const cycleMatch =
    cycleId.match(/(?:^|_)CYCLE[_-]?(\d+)$/i) ||
    cycleId.match(/CYCLE[_-]?(\d+)/i);

  if (cycleMatch?.[1]) return `Cycle_${cycleMatch[1]}`;

  const cycleLabel = safeText(
    session?.cycleLabel ||
      session?.cycleName ||
      session?.selectedCycle?.label ||
      session?.selectedCycle?.cycleLabel,
    "",
  );

  return isMeaningfulText(cycleLabel)
    ? cycleLabel.replace(/\s+/g, "_")
    : "Cycle";
}

function getStagingSessionLabel(session) {
  const cycleLabel = getSessionCycleLabel(session);
  const generatedStamp = getSessionGeneratedStamp(session);
  const sessionLabel = generatedStamp
    ? `${cycleLabel}_${generatedStamp}`
    : cycleLabel;
  const windowLabel = safeText(session?.windowDisplay || session?.lmPcode, "");

  return windowLabel ? `${sessionLabel} (${windowLabel})` : sessionLabel;
}

const EMPTY_TABLE_FILTERS = {
  meterNo: "",
  currentReading: "",
  prevReading: "",
  consumption: "",
  premiseAddress: "",
  premiseType: "ALL",
  wardLabel: "ALL",
  geofence: "ALL",
  meterKind: "ALL",
  meterType: "ALL",
};

const TABLE_COLUMNS = [
  {
    key: "meterNo",
    header: "Meter No",
    filterType: "text",
    placeholder: "Meter no",
  },
  {
    key: "currentReading",
    header: "Current",
    filterType: "text",
    placeholder: "Current",
  },
  {
    key: "prevReading",
    header: "Previous",
    filterType: "text",
    placeholder: "Previous",
  },
  {
    key: "consumption",
    header: "Consumption",
    filterType: "text",
    placeholder: "Consumption",
  },
  {
    key: "premiseAddress",
    header: "Address",
    filterType: "text",
    placeholder: "Address",
  },
  { key: "premiseType", header: "Property type", filterType: "select" },
  { key: "wardLabel", header: "Ward", filterType: "select" },
  { key: "geofence", header: "Geofence", filterType: "select" },
  { key: "meterKind", header: "Meter Kind", filterType: "select" },
  { key: "meterType", header: "Meter Type", filterType: "select" },
  { key: "successfulReads", header: "Successful" },
  { key: "unsuccessful", header: "Unsuccessful" },
  { key: "noAccess", header: "No Access" },
  { key: "mediaEvidence", header: "Media" },
];

function LoadingSpinner({
  title = "Loading MREAD staging...",
  message = "Opening Firestore stream.",
} = {}) {
  return (
    <div style={loadingBlockStyle} role="status" aria-live="polite">
      <span style={spinnerStyle} aria-hidden="true" />
      <div>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <p style={mutedTextStyle}>{message}</p>
      </div>
    </div>
  );
}

export default function MreadStagingPage() {
  const { activeWorkbase, role } = useAuth();
  const { geoState, updateGeo } = useGeo();
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [selectedWardPcode, setSelectedWardPcode] = useState("");

  const [tableFilters, setTableFilters] = useState(EMPTY_TABLE_FILTERS);

  const [selectedMeterRow, setSelectedMeterRow] = useState(null);

  const activeLmPcode = safeText(getActiveLmPcode(activeWorkbase), "");
  const activeWorkbaseName =
    activeWorkbase?.name ||
    activeWorkbase?.lmName ||
    activeWorkbase?.id ||
    activeWorkbase?.pcode ||
    NAv;

  const { data: registryWardRows = [], isLoading: registryWardsLoading } =
    useGetRegistryWardsByLmQuery(activeLmPcode || skipToken);
  const { data: boundaryWardRows = [], isLoading: boundaryWardsLoading } =
    useGetWardBoundariesByLmQuery(activeLmPcode || skipToken);
  const wardRows = useMemo(
    () => mergeWardOptions(registryWardRows, boundaryWardRows),
    [registryWardRows, boundaryWardRows],
  );
  const wardsLoading = registryWardsLoading && boundaryWardsLoading;

  const sessionsArgs = useMemo(() => {
    if (!activeLmPcode || activeLmPcode === NAv) return skipToken;
    return { lmPcode: activeLmPcode };
  }, [activeLmPcode]);

  const sessionsQuery = useListMreadStagingSessionsQuery(sessionsArgs);
  const cyclesQuery = useListMreadStagingCyclesQuery(sessionsArgs);
  const callableSessions = useMemo(
    () => sessionsQuery.data?.rows || [],
    [sessionsQuery.data?.rows],
  );
  const cycleSessions = useMemo(
    () =>
      (cyclesQuery.data?.rows || []).map(buildSessionFromCycle).filter(Boolean),
    [cyclesQuery.data?.rows],
  );
  const sessions = useMemo(() => {
    const byId = new Map();

    cycleSessions.forEach((session) => {
      const normalized = normalizeSession(session);
      if (!normalized?.id) return;
      byId.set(
        normalized.id,
        mergeSession(byId.get(normalized.id), normalized),
      );
    });
    callableSessions.forEach((session) => {
      const normalized = normalizeSession(session);
      if (!normalized?.id) return;
      byId.set(
        normalized.id,
        mergeSession(byId.get(normalized.id), normalized),
      );
    });

    return Array.from(byId.values()).sort(sortSessions);
  }, [callableSessions, cycleSessions]);
  const sessionsErrorMessage = sessionsQuery.error?.message || null;
  const cyclesErrorMessage = cyclesQuery.error?.message || null;
  const sessionsLoading = sessionsQuery.isLoading && cyclesQuery.isLoading;
  const isUsingCycleSessionFallback =
    callableSessions.length === 0 && cycleSessions.length > 0;

  const geoSelectedWardPcode = getWardPcode(geoState?.selectedWard);
  const effectiveSelectedWardPcode = selectedWardPcode || geoSelectedWardPcode;
  const hasWardSelection = isMeaningfulText(effectiveSelectedWardPcode);

  const selectedSession = hasWardSelection
    ? sessions.find((session) => session.id === selectedSessionId) ||
      sessions[0] ||
      null
    : null;
  const selectedSessionIdEffective = selectedSession?.id || "";

  const { data: registryMreadRows = [] } = useGetRegistryMreadByWardQuery(
    effectiveSelectedWardPcode || skipToken,
  );

  const rowsQuery = useListMreadStagingRowsQuery(
    selectedSessionIdEffective && effectiveSelectedWardPcode
      ? {
          lmPcode: activeLmPcode,
          stagingId: selectedSessionIdEffective,
          pageSize: ROWS_FETCH_LIMIT,
          wardPcode: effectiveSelectedWardPcode,
        }
      : skipToken,
  );

  const rows = useMemo(
    () => rowsQuery.data?.rows || [],
    [rowsQuery.data?.rows],
  );
  const tableRows = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        wardLabel: getRowWardLabel(row, wardRows),
        premiseType: safeText(row.premiseType || row.propertyType, ""),
      })),
    [rows, wardRows],
  );

  const registryColumns = TABLE_COLUMNS.map(column => ({
    key: column.key,
    label: column.header,
    filter: column.filterType || null,
    filterAllValue: "ALL",
    sortable: true,
    filterDisabled: !selectedSession || !effectiveSelectedWardPcode || rowsQuery.isLoading,
    value: row => getTableFilterValue(row, column.key),
    sortEmptyLast: true,
    sortValue: row => {
      const value = getTableSortValue(row, column.key);
      return value === NAv ? null : value;
    },
    exportValue: row => column.key === "meterNo" ? getMeterNo(row) : row[column.key] ?? "",
    render: row => formatTableValue(row, column.key, {
      onMeterClick: setSelectedMeterRow
    }),
    minWidth: column.key === "premiseAddress" ? 200 : 130
  }));
  const filteredRows = useMemo(() => filterIrepsTableRows(tableRows, registryColumns, {
    filters: tableFilters
  }), [tableRows, tableFilters, registryColumns]);

  const totalRows = Number(rowsQuery.data?.totalRows ?? rows.length);
  const rowsErrorMessage = rowsQuery.error?.message || null;
  const canLoadRows = Boolean(selectedSession && effectiveSelectedWardPcode);
  const rowsOpening =
    canLoadRows &&
    (rowsQuery.isLoading || (rowsQuery.isFetching && rows.length === 0));
  const rowsSummaryText = !hasWardSelection
    ? "Select a ward scope to load staging rows."
    : !selectedSession
      ? "Choose a staging session to begin."
      : `${formatNumber(totalRows)} staging row(s)`;

  const handleSessionChange = (event) => {
    setSelectedSessionId(event.target.value);
    setTableFilters(EMPTY_TABLE_FILTERS);

  };

  const handleWardChange = (event) => {
    const nextWardPcode = event.target.value || "";
    const nextWard =
      wardRows.find((ward) => ward.wardPcode === nextWardPcode) || null;

    setSelectedWardPcode(nextWardPcode);
    updateGeo({
      selectedWard: nextWard
        ? {
            ...nextWard,
            id: nextWard.wardPcode,
            pcode: nextWard.wardPcode,
          }
        : null,
      lastSelectionType: nextWardPcode ? "WARD" : null,
    });
    setTableFilters(EMPTY_TABLE_FILTERS);

  };

  return (
    <>
      <header className="console-header" style={styles.fixedRegistryHeader}>
        <div>
          <h1>MREAD Staging</h1>

          <p className="muted">
            View preserved MREAD staging sessions and inspect generated rows.
          </p>

          <Link className="text-link" to="/registries">
            ← Back to Registries
          </Link>
        </div>

        <div className="topbar-right">
          <div className="workbase-pill">{activeWorkbaseName}</div>
          <div className="role-pill">{role || NAv}</div>
          <div className="role-pill">
            {rowsQuery.isFetching
              ? "Loading..."
              : `${formatNumber(filteredRows.length)} visible rows`}
          </div>

        </div>
      </header>

      <div style={{ display: "grid", gap: "1.5rem" }}>
        <section
          style={{
            display: "grid",
            gap: "1rem",
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "1rem",
            padding: "1.25rem",
          }}
        >
          <div
            style={{
              display: "grid",
              gap: "1rem",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              alignItems: "start",
            }}
          >
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <div>
                <label
                  htmlFor="ward-select"
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    color: FORM_TEXT,
                    fontWeight: 700,
                  }}
                >
                  Ward Scope
                </label>
                <select
                  id="ward-select"
                  value={effectiveSelectedWardPcode}
                  onChange={handleWardChange}
                  disabled={
                    !activeLmPcode || wardsLoading || wardRows.length === 0
                  }
                  style={{
                    width: "100%",
                    minWidth: "180px",
                    padding: "0.75rem 0.9rem",
                    borderRadius: "0.75rem",
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                  }}
                >
                  <option value="">Select ward</option>
                  {wardRows.map((ward) => (
                    <option key={ward.wardPcode} value={ward.wardPcode}>
                      {getWardLabel(ward)} ({ward.wardPcode})
                    </option>
                  ))}
                </select>
              </div>

              {selectedSession ? (
                <div style={{ color: "#475569" }}>
                  <span
                    style={{
                      display: "block",
                      fontWeight: 700,
                      marginBottom: "0.4rem",
                    }}
                  >
                    Cycle ID
                  </span>
                  <span>{safeText(selectedSession.cycleId)}</span>
                </div>
              ) : null}
            </div>

            <div style={{ display: "grid", gap: "0.75rem" }}>
              <div>
                <label
                  htmlFor="session-select"
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    color: FORM_TEXT,
                    fontWeight: 700,
                  }}
                >
                  Staging Session
                </label>
                <select
                  id="session-select"
                  value={hasWardSelection ? selectedSessionIdEffective : ""}
                  onChange={handleSessionChange}
                  disabled={
                    !hasWardSelection ||
                    sessionsLoading ||
                    sessions.length === 0
                  }
                  style={{
                    width: "100%",
                    minWidth: "220px",
                    padding: "0.75rem 0.9rem",
                    borderRadius: "0.75rem",
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                  }}
                >
                  <option value="">
                    {!hasWardSelection
                      ? "Select ward first"
                      : sessions.length === 0
                        ? "No staging sessions"
                        : "-- Select a session --"}
                  </option>
                  {hasWardSelection
                    ? sessions.map((session) => (
                        <option key={session.id} value={session.id}>
                          {getStagingSessionLabel(session)}
                        </option>
                      ))
                    : null}
                </select>
                {isUsingCycleSessionFallback && sessionsErrorMessage ? (
                  <p style={{ margin: "0.5rem 0 0", color: "#92400e" }}>
                    Using controller active staging IDs. Session callable
                    returned: {sessionsErrorMessage}
                  </p>
                ) : sessionsErrorMessage ? (
                  <p style={{ margin: "0.5rem 0 0", color: "#b91c1c" }}>
                    {sessionsErrorMessage}
                  </p>
                ) : cyclesErrorMessage ? (
                  <p style={{ margin: "0.5rem 0 0", color: "#b91c1c" }}>
                    {cyclesErrorMessage}
                  </p>
                ) : null}
              </div>

              {selectedSession ? (
                <div style={{ color: "#475569" }}>
                  <span
                    style={{
                      display: "block",
                      fontWeight: 700,
                      marginBottom: "0.4rem",
                    }}
                  >
                    Date Generated
                  </span>
                  <span>{formatSessionGeneratedAt(selectedSession)}</span>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "1rem",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "1rem 1.25rem",
              borderBottom: "1px solid #e2e8f0",
            }}
          >
            <div>
              <p style={{ margin: 0, fontWeight: 700, color: "#0f172a" }}>
                Staging rows
              </p>
              <p style={{ margin: "0.35rem 0 0", color: "#64748b" }}>
                {rowsSummaryText}
              </p>
            </div>

          </div>

          <div style={{ overflowX: rowsOpening ? "hidden" : "auto" }}>
            {rowsErrorMessage ? (
              <div
                style={{
                  margin: "1rem",
                  padding: "1rem",
                  background: "#fee2e2",
                  border: "1px solid #fca5a5",
                  borderRadius: "0.75rem",
                  color: "#991b1b",
                }}
              >
                Failed to load staging rows: {rowsErrorMessage}
              </div>
            ) : null}

            {rowsOpening ? (
              <LoadingSpinner
                title="Opening MREAD staging..."
                message="Waiting for the mread_staging rows Firestore stream."
              />
            ) : null}

            {!rowsOpening ? (
              <IrepsTable
                key={`${activeLmPcode}:${effectiveSelectedWardPcode}:${selectedSessionIdEffective}`}
                title="MREAD Staging"
                rows={tableRows}
                columns={registryColumns}
                filters={tableFilters}
                onFiltersChange={setTableFilters}
                filteredRows={filteredRows}
                defaultSort={DEFAULT_TABLE_SORT}
                rowKey={row => row.rowId}
                emptyText={canLoadRows ? "No rows match the current column filters." : selectedSession ? "Select a ward scope above to view table rows." : "Select a staging session above to view table rows."}
                stickyHeader
                maxHeight="70vh"
                downloads={{
                  fileBaseName: "mread_staging",
                  scope: {
                    lmPcode: activeLmPcode || selectedSession?.lmPcode,
                    wardPcode: effectiveSelectedWardPcode
                  }
                }}
              />
            ) : null}
          </div>

        </section>
      </div>

      {selectedMeterRow ? (
        <SharedMeterHistoryModal
          row={selectedMeterRow}
          registryRows={registryMreadRows}
          onClose={() => setSelectedMeterRow(null)}
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
};

const readingValueStackStyle = {
  display: "grid",
  gap: "0.18rem",
};

const readingMetaStyle = {
  color: "#64748b",
  fontSize: "0.72rem",
  fontWeight: 500,
};

const meterNoButtonStyle = {
  border: 0,
  background: "transparent",
  padding: 0,
  font: "inherit",
  fontWeight: 800,
  cursor: "pointer",
};

const mutedTextStyle = {
  margin: "0.25rem 0 0",
  color: "#64748b",
};

const loadingBlockStyle = {
  minHeight: "160px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "1rem",
  textAlign: "left",
};

const spinnerStyle = {
  width: "34px",
  height: "34px",
  borderRadius: "999px",
  border: "4px solid rgba(148, 163, 184, 0.25)",
  borderTopColor: "#2563eb",
  animation: "ireps-spin 0.9s linear infinite",
};
