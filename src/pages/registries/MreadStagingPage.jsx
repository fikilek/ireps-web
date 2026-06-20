import { useMemo, useState } from "react";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import {
  useListMreadStagingSessionsQuery,
  useListMreadStagingRowsQuery,
} from "../../redux/mreadStagingApi";
import { useListMreadStagingCyclesQuery } from "../../redux/mreadStagingCyclesApi";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";
import { useGetWardBoundariesByLmQuery } from "../../redux/mapWardsApi";
import { useGeo } from "../../context/GeoContext";
import DownloadButtons from "../../components/DownloadButtons";

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const NAv = "NAv";
const DEFAULT_FILTERS = {
  geofence: "ALL",
  meterKind: "ALL",
  meterType: "ALL",
  phase: "ALL",
  premiseType: "ALL",
};

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
  if (typeof value === "string") return value.slice(0, 19).replace("T", " ");
  if (typeof value?.toDate === "function")
    return value.toDate().toLocaleString();
  if (typeof value?.seconds === "number")
    return new Date(value.seconds * 1000).toLocaleString();
  return NAv;
}

function markJsxOnlyComponentUsage(...components) {
  return components.length;
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

function sortSessions(left, right) {
  const leftDate = safeText(left?.generatedAt, "");
  const rightDate = safeText(right?.generatedAt, "");

  if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
  return safeText(left?.tableId, "").localeCompare(safeText(right?.tableId, ""));
}

function normalizeFilterValue(value) {
  const text = safeText(value, "").toUpperCase();
  return text === "ALL" || !text ? "ALL" : text;
}

function buildOptions(rows = [], field) {
  const options = new Set(["ALL"]);
  rows.forEach((row) => {
    const value = safeText(row?.[field], "");
    if (value && value !== NAv) options.add(value);
  });
  return Array.from(options).sort();
}

const TABLE_COLUMNS = [
  { key: "wardPcode", header: "Ward" },
  { key: "geofence", header: "Geofence" },
  { key: "meterNo", header: "Meter No" },
  { key: "meterKind", header: "Meter Kind" },
  { key: "meterType", header: "Meter Type" },
  { key: "phase", header: "Phase" },
  { key: "premiseType", header: "Premise Type" },
  { key: "premiseAddress", header: "Address" },
  { key: "currentReading", header: "Current" },
  { key: "prevReading", header: "Previous" },
  { key: "consumption", header: "Consumption" },
  { key: "successfulReads", header: "Successful" },
  { key: "unsuccessful", header: "Unsuccessful" },
  { key: "noAccess", header: "No Access" },
  { key: "mediaEvidence", header: "Media" },
];

export default function MreadStagingPage() {
  const { activeWorkbase } = useAuth();
  const { geoState, updateGeo } = useGeo();
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [selectedWardPcode, setSelectedWardPcode] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [pageHistory, setPageHistory] = useState([null]);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const activeLmPcode = safeText(getActiveLmPcode(activeWorkbase), "");

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
      (cyclesQuery.data?.rows || [])
        .map(buildSessionFromCycle)
        .filter(Boolean),
    [cyclesQuery.data?.rows],
  );
  const sessions = useMemo(() => {
    const byId = new Map();

    cycleSessions.forEach((session) => {
      byId.set(session.id, session);
    });
    callableSessions.forEach((session) => {
      byId.set(session.id, session);
    });

    return Array.from(byId.values()).sort(sortSessions);
  }, [callableSessions, cycleSessions]);
  const sessionsErrorMessage = sessionsQuery.error?.message || null;
  const cyclesErrorMessage = cyclesQuery.error?.message || null;
  const sessionsLoading = sessionsQuery.isLoading && cyclesQuery.isLoading;
  const isUsingCycleSessionFallback =
    callableSessions.length === 0 && cycleSessions.length > 0;

  const selectedSession =
    sessions.find((session) => session.id === selectedSessionId) ||
    sessions[0] ||
    null;
  const selectedSessionIdEffective = selectedSession?.id || "";
  const geoSelectedWardPcode = getWardPcode(geoState?.selectedWard);
  const effectiveSelectedWardPcode = selectedWardPcode || geoSelectedWardPcode;
  const selectedWard =
    wardRows.find((ward) => ward.wardPcode === effectiveSelectedWardPcode) ||
    geoState?.selectedWard ||
    null;

  markJsxOnlyComponentUsage(DownloadButtons);

  const cursor = pageHistory[pageHistory.length - 1];
  const rowsQuery = useListMreadStagingRowsQuery(
    selectedSessionIdEffective && effectiveSelectedWardPcode
      ? {
          lmPcode: activeLmPcode,
          stagingId: selectedSessionIdEffective,
          pageSize,
          cursor,
          wardPcode: effectiveSelectedWardPcode,
          geofence: filters.geofence,
          meterKind: filters.meterKind,
          meterType: filters.meterType,
          phase: filters.phase,
          premiseType: filters.premiseType,
          search,
        }
      : skipToken,
  );

  const rows = useMemo(
    () => rowsQuery.data?.rows || [],
    [rowsQuery.data?.rows],
  );
  const nextCursor = rowsQuery.data?.nextCursor || null;
  const totalRows = Number(rowsQuery.data?.totalRows ?? rows.length);
  const rowsErrorMessage = rowsQuery.error?.message || null;
  const canLoadRows = Boolean(selectedSession && effectiveSelectedWardPcode);
  const rowsSummaryText = !selectedSession
    ? "Choose a staging session to begin."
    : !effectiveSelectedWardPcode
      ? "Select a ward scope to load staging rows."
      : `${formatNumber(totalRows)} row(s) matching current filters`;

  const geofenceOptions = useMemo(() => buildOptions(rows, "geofence"), [rows]);
  const meterKindOptions = useMemo(
    () => buildOptions(rows, "meterKind"),
    [rows],
  );
  const meterTypeOptions = useMemo(
    () => buildOptions(rows, "meterType"),
    [rows],
  );
  const phaseOptions = useMemo(() => buildOptions(rows, "phase"), [rows]);
  const premiseTypeOptions = useMemo(
    () => buildOptions(rows, "premiseType"),
    [rows],
  );

  const handleSessionChange = (event) => {
    setSelectedSessionId(event.target.value);
    setFilters(DEFAULT_FILTERS);
    setSearch("");
    setPageHistory([null]);
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
    setFilters(DEFAULT_FILTERS);
    setSearch("");
    setPageHistory([null]);
  };

  const handleFilterChange = (field) => (event) => {
    setFilters((current) => ({
      ...current,
      [field]: normalizeFilterValue(event.target.value),
    }));
    setPageHistory([null]);
  };

  const handleSearchChange = (event) => {
    setSearch(event.target.value || "");
    setPageHistory([null]);
  };

  const handlePageSizeChange = (event) => {
    const size = Number(event.target.value);
    setPageSize(Number.isFinite(size) && size > 0 ? size : DEFAULT_PAGE_SIZE);
    setPageHistory([null]);
  };

  const handleNextPage = () => {
    if (!nextCursor) return;
    setPageHistory((history) => [...history, nextCursor]);
  };

  const handlePreviousPage = () => {
    setPageHistory((history) =>
      history.length > 1 ? history.slice(0, history.length - 1) : history,
    );
  };

  const pageNumber = pageHistory.length;

  return (
    <div style={{ display: "grid", gap: "1.5rem", padding: "1.5rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "1rem",
          alignItems: "flex-end",
        }}
      >
        <div>
          <p
            style={{
              margin: 0,
              color: "#334155",
              fontSize: "0.85rem",
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Registries
          </p>
          <h1 style={{ margin: "0.35rem 0 0", fontSize: "2rem" }}>
            MREAD Staging
          </h1>
          <p
            style={{
              margin: "0.75rem 0 0",
              color: "#475569",
              maxWidth: "54rem",
            }}
          >
            View and inspect MREAD staging sessions. Select a ward scope before
            loading prepared staging rows.
          </p>
        </div>

        <DownloadButtons
          registryName="MREAD Staging"
          rowsLabel="rows"
          visibleRows={rows}
          columns={TABLE_COLUMNS.map((column) => ({
            key: column.key,
            header: column.header,
          }))}
          fileBaseName="mread_staging"
          scope={{
            lmPcode: activeLmPcode || selectedSession?.lmPcode,
            wardPcode: effectiveSelectedWardPcode,
          }}
        />
      </div>

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
            gridTemplateColumns: "minmax(180px, 0.85fr) minmax(220px, 1fr) 1.5fr",
            alignItems: "end",
          }}
        >
          <div>
            <label
              htmlFor="ward-select"
              style={{
                display: "block",
                marginBottom: "0.5rem",
                color: "#475569",
                fontWeight: 700,
              }}
            >
              Ward Scope
            </label>
            <select
              id="ward-select"
              value={effectiveSelectedWardPcode}
              onChange={handleWardChange}
              disabled={!activeLmPcode || wardsLoading || wardRows.length === 0}
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

          <div>
            <label
              htmlFor="session-select"
              style={{
                display: "block",
                marginBottom: "0.5rem",
                color: "#475569",
                fontWeight: 700,
              }}
            >
              Staging Session
            </label>
            <select
              id="session-select"
              value={selectedSessionIdEffective}
              onChange={handleSessionChange}
              disabled={sessionsLoading || sessions.length === 0}
              style={{
                width: "100%",
                minWidth: "220px",
                padding: "0.75rem 0.9rem",
                borderRadius: "0.75rem",
                border: "1px solid #cbd5e1",
                background: "#ffffff",
              }}
            >
              <option value="">-- Select a session --</option>
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.tableId} ({session.windowDisplay || session.lmPcode})
                </option>
              ))}
            </select>
            {isUsingCycleSessionFallback && sessionsErrorMessage ? (
              <p style={{ margin: "0.5rem 0 0", color: "#92400e" }}>
                Using controller active staging IDs. Session callable returned:{" "}
                {sessionsErrorMessage}
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

          <div
            style={{
              display: "grid",
              gap: "0.75rem",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            }}
          >
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "1rem",
                padding: "1rem",
              }}
            >
              <p style={{ margin: 0, color: "#475569", fontSize: "0.8rem" }}>
                Session rows
              </p>
              <p
                style={{
                  margin: "0.5rem 0 0",
                  fontSize: "1.35rem",
                  fontWeight: 700,
                  color: "#0f172a",
                }}
              >
                {formatNumber(selectedSession?.rowCount ?? 0)}
              </p>
            </div>
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "1rem",
                padding: "1rem",
              }}
            >
              <p style={{ margin: 0, color: "#475569", fontSize: "0.8rem" }}>
                Successful reads
              </p>
              <p
                style={{
                  margin: "0.5rem 0 0",
                  fontSize: "1.35rem",
                  fontWeight: 700,
                  color: "#0f172a",
                }}
              >
                {formatNumber(selectedSession?.successfulReads ?? 0)}
              </p>
            </div>
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "1rem",
                padding: "1rem",
              }}
            >
              <p style={{ margin: 0, color: "#475569", fontSize: "0.8rem" }}>
                No access rows
              </p>
              <p
                style={{
                  margin: "0.5rem 0 0",
                  fontSize: "1.35rem",
                  fontWeight: 700,
                  color: "#0f172a",
                }}
              >
                {formatNumber(selectedSession?.noAccess ?? 0)}
              </p>
            </div>
          </div>
        </div>

        {selectedSession ? (
          <div
            style={{
              display: "grid",
              gap: "0.75rem",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            }}
          >
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
            <div style={{ color: "#475569" }}>
              <span
                style={{
                  display: "block",
                  fontWeight: 700,
                  marginBottom: "0.4rem",
                }}
              >
                Ward Scope
              </span>
              <span>
                {effectiveSelectedWardPcode
                  ? `${getWardLabel(selectedWard)} (${effectiveSelectedWardPcode})`
                  : "No ward selected"}
              </span>
            </div>
            <div style={{ color: "#475569" }}>
              <span
                style={{
                  display: "block",
                  fontWeight: 700,
                  marginBottom: "0.4rem",
                }}
              >
                Status
              </span>
              <span>{safeText(selectedSession.tableStatus)}</span>
            </div>
            <div style={{ color: "#475569" }}>
              <span
                style={{
                  display: "block",
                  fontWeight: 700,
                  marginBottom: "0.4rem",
                }}
              >
                Generated
              </span>
              <span>{formatDateTime(selectedSession.generatedAt)}</span>
            </div>
          </div>
        ) : null}
      </section>

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
            gridTemplateColumns: "1fr minmax(200px, 320px)",
          }}
        >
          <div
            style={{
              display: "grid",
              gap: "0.75rem",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            }}
          >
            <label style={{ display: "grid", gap: "0.5rem" }}>
              <span style={{ fontWeight: 700, color: "#475569" }}>
                Geofence
              </span>
              <select
                value={filters.geofence}
                onChange={handleFilterChange("geofence")}
                disabled={!canLoadRows}
                style={{
                  width: "100%",
                  padding: "0.75rem 0.9rem",
                  borderRadius: "0.75rem",
                  border: "1px solid #cbd5e1",
                }}
              >
                {geofenceOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: "0.5rem" }}>
              <span style={{ fontWeight: 700, color: "#475569" }}>
                Meter type
              </span>
              <select
                value={filters.meterType}
                onChange={handleFilterChange("meterType")}
                disabled={!canLoadRows}
                style={{
                  width: "100%",
                  padding: "0.75rem 0.9rem",
                  borderRadius: "0.75rem",
                  border: "1px solid #cbd5e1",
                }}
              >
                {meterTypeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: "0.5rem" }}>
              <span style={{ fontWeight: 700, color: "#475569" }}>
                Meter kind
              </span>
              <select
                value={filters.meterKind}
                onChange={handleFilterChange("meterKind")}
                disabled={!canLoadRows}
                style={{
                  width: "100%",
                  padding: "0.75rem 0.9rem",
                  borderRadius: "0.75rem",
                  border: "1px solid #cbd5e1",
                }}
              >
                {meterKindOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: "0.5rem" }}>
              <span style={{ fontWeight: 700, color: "#475569" }}>Phase</span>
              <select
                value={filters.phase}
                onChange={handleFilterChange("phase")}
                disabled={!canLoadRows}
                style={{
                  width: "100%",
                  padding: "0.75rem 0.9rem",
                  borderRadius: "0.75rem",
                  border: "1px solid #cbd5e1",
                }}
              >
                {phaseOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: "0.5rem" }}>
              <span style={{ fontWeight: 700, color: "#475569" }}>
                Premise type
              </span>
              <select
                value={filters.premiseType}
                onChange={handleFilterChange("premiseType")}
                disabled={!canLoadRows}
                style={{
                  width: "100%",
                  padding: "0.75rem 0.9rem",
                  borderRadius: "0.75rem",
                  border: "1px solid #cbd5e1",
                }}
              >
                {premiseTypeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ display: "grid", gap: "0.75rem" }}>
            <label style={{ display: "grid", gap: "0.5rem" }}>
              <span style={{ fontWeight: 700, color: "#475569" }}>
                Search rows
              </span>
              <input
                type="search"
                value={search}
                onChange={handleSearchChange}
                disabled={!canLoadRows}
                placeholder="Search meter, address, or geofence"
                style={{
                  width: "100%",
                  padding: "0.75rem 0.9rem",
                  borderRadius: "0.75rem",
                  border: "1px solid #cbd5e1",
                }}
              />
            </label>
            <div
              style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}
            >
              <span style={{ fontWeight: 700, color: "#475569" }}>
                Page size
              </span>
              <select
                value={pageSize}
                onChange={handlePageSizeChange}
                disabled={!canLoadRows}
                style={{
                  minWidth: "120px",
                  padding: "0.75rem 0.9rem",
                  borderRadius: "0.75rem",
                  border: "1px solid #cbd5e1",
                }}
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
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
          <div
            style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}
          >
            <button
              type="button"
              onClick={handlePreviousPage}
              disabled={!canLoadRows || pageHistory.length <= 1 || rowsQuery.isLoading}
              style={{
                padding: "0.65rem 0.95rem",
                borderRadius: "0.85rem",
                border: "1px solid #cbd5e1",
                background: "#f8fafc",
                cursor: pageHistory.length <= 1 ? "not-allowed" : "pointer",
              }}
            >
              Previous
            </button>
            <button
              type="button"
              onClick={handleNextPage}
              disabled={!canLoadRows || !nextCursor || rowsQuery.isLoading}
              style={{
                padding: "0.65rem 0.95rem",
                borderRadius: "0.85rem",
                border: "1px solid #0f172a",
                background: "#0f172a",
                color: "#ffffff",
                cursor: !nextCursor ? "not-allowed" : "pointer",
              }}
            >
              Next
            </button>
            <span style={{ color: "#475569" }}>Page {pageNumber}</span>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          {rowsErrorMessage ? (
            <div
              style={{
                marginBottom: "1rem",
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
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: "1120px",
            }}
          >
            <thead style={{ background: "#f8fafc" }}>
              <tr>
                {TABLE_COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    style={{
                      textAlign: "left",
                      padding: "0.95rem 1rem",
                      borderBottom: "1px solid #e2e8f0",
                      color: "#475569",
                      fontWeight: 700,
                      fontSize: "0.9rem",
                    }}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {canLoadRows ? (
                rows.length > 0 ? (
                  rows.map((row) => (
                    <tr
                      key={row.rowId}
                      style={{ borderBottom: "1px solid #e2e8f0" }}
                    >
                      <td style={cellStyle}>{safeText(row.wardPcode)}</td>
                      <td style={cellStyle}>{safeText(row.geofence)}</td>
                      <td style={cellStyle}>{safeText(row.meterNo)}</td>
                      <td style={cellStyle}>{safeText(row.meterKind)}</td>
                      <td style={cellStyle}>{safeText(row.meterType)}</td>
                      <td style={cellStyle}>{safeText(row.phase)}</td>
                      <td style={cellStyle}>{safeText(row.premiseType)}</td>
                      <td style={cellStyle}>{safeText(row.premiseAddress)}</td>
                      <td style={cellStyle}>
                        {formatNumber(row.currentReading)}
                      </td>
                      <td style={cellStyle}>{formatNumber(row.prevReading)}</td>
                      <td style={cellStyle}>{formatNumber(row.consumption)}</td>
                      <td style={cellStyle}>
                        {formatNumber(row.successfulReads)}
                      </td>
                      <td style={cellStyle}>
                        {formatNumber(row.unsuccessful)}
                      </td>
                      <td style={cellStyle}>{formatNumber(row.noAccess)}</td>
                      <td style={cellStyle}>
                        {formatNumber(row.mediaEvidence)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={TABLE_COLUMNS.length}
                      style={{
                        padding: "1.5rem",
                        color: "#64748b",
                        textAlign: "center",
                      }}
                    >
                      {rowsQuery.isLoading
                        ? "Loading staging rows..."
                        : "No rows match the current filter settings."}
                    </td>
                  </tr>
                )
              ) : (
                <tr>
                  <td
                    colSpan={TABLE_COLUMNS.length}
                    style={{
                      padding: "1.5rem",
                      color: "#64748b",
                      textAlign: "center",
                    }}
                  >
                    {selectedSession
                      ? "Select a ward scope above to view table rows."
                      : "Select a staging session above to view table rows."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const cellStyle = {
  padding: "0.95rem 1rem",
  color: "#0f172a",
  fontSize: "0.9rem",
  lineHeight: 1.4,
  whiteSpace: "nowrap",
};
