import { useMemo, useState } from "react";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import {
  useListMreadStagingSessionsQuery,
  useListMreadStagingRowsQuery,
} from "../../redux/mreadStagingApi";
import DownloadButtons from "../../components/DownloadButtons";

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
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
  const { activeWorkbase, role } = useAuth();
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({
    wardPcode: "ALL",
    geofence: "ALL",
    meterKind: "ALL",
    meterType: "ALL",
    phase: "ALL",
    premiseType: "ALL",
  });
  const [pageHistory, setPageHistory] = useState([null]);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const sessionsArgs = useMemo(() => {
    const lmPcode = safeText(activeWorkbase?.lmPcode, "");
    if (role !== "SPU" && (!lmPcode || lmPcode === NAv)) {
      return skipToken;
    }
    return { lmPcode: lmPcode === NAv ? "" : lmPcode };
  }, [activeWorkbase?.lmPcode, role]);

  const sessionsQuery = useListMreadStagingSessionsQuery(sessionsArgs);
  const sessions = useMemo(
    () => sessionsQuery.data?.rows || [],
    [sessionsQuery.data?.rows],
  );

  const selectedSessionIdEffective = selectedSessionId || sessions[0]?.id || "";
  const selectedSession =
    sessions.find((session) => session.id === selectedSessionIdEffective) || null;

  markJsxOnlyComponentUsage(DownloadButtons);

  const cursor = pageHistory[pageHistory.length - 1];
  const rowsQuery = useListMreadStagingRowsQuery(
    selectedSessionIdEffective
      ? {
          stagingId: selectedSessionIdEffective,
          pageSize,
          cursor,
          wardPcode: filters.wardPcode,
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
  const totalRows = Number(rowsQuery.data?.totalRows || rows.length);

  const wardOptions = useMemo(() => buildOptions(rows, "wardPcode"), [rows]);
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
            View and inspect MREAD staging sessions. Select a session to display
            prepared staging rows in a registry-style table.
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
            lmPcode: selectedSession?.lmPcode,
            wardPcode: filters.wardPcode,
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
            gridTemplateColumns: "minmax(200px, 1fr) 1.5fr",
            alignItems: "end",
          }}
        >
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
              disabled={sessionsQuery.isLoading || sessions.length === 0}
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
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            }}
          >
            <label style={{ display: "grid", gap: "0.5rem" }}>
              <span style={{ fontWeight: 700, color: "#475569" }}>Ward</span>
              <select
                value={filters.wardPcode}
                onChange={handleFilterChange("wardPcode")}
                style={{
                  width: "100%",
                  padding: "0.75rem 0.9rem",
                  borderRadius: "0.75rem",
                  border: "1px solid #cbd5e1",
                }}
              >
                {wardOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: "0.5rem" }}>
              <span style={{ fontWeight: 700, color: "#475569" }}>
                Geofence
              </span>
              <select
                value={filters.geofence}
                onChange={handleFilterChange("geofence")}
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
              {selectedSession
                ? `${formatNumber(totalRows)} row(s) matching current filters`
                : "Choose a staging session to begin."}
            </p>
          </div>
          <div
            style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}
          >
            <button
              type="button"
              onClick={handlePreviousPage}
              disabled={pageHistory.length <= 1 || rowsQuery.isLoading}
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
              disabled={!nextCursor || rowsQuery.isLoading}
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
              {selectedSession ? (
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
                    Select a staging session above to view table rows.
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
