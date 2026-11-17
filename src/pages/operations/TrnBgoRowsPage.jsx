/* eslint-disable no-unused-vars -- JSX component tags are consumed by the JSX transform. */
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import { useGetAstsByLmPcodeWardPcodeQuery } from "../../redux/astsApi";
import {
  useGetBgoBatchesByLmQuery,
  useGetBgoRowsByBatchIdQuery,
} from "../../redux/bgoApi";
import {
  useGetTcUploadByIdQuery,
  useGetTcRowsByTcIdQuery,
  useGetTrnBgoChildTrnsByBatchIdQuery,
} from "../../redux/tcApi";
import {
  buildTrnBgoDisplayRows,
  buildTrnBgoRowsSummary,
  formatBatchAllocatedTo,
  trnBgoRowSearchValue,
} from "./trnBgoRowsView";
import IrepsTable from "../../components/table/IrepsTable";
import DataActionButton, { ErfActionIcon, MeterActionIcon } from "../../components/table/DataActionButton";
import BoundaryMapModal from "../registries/components/BoundaryMapModal";
import MeterDeepDetailsModal from "../registries/components/MeterDeepDetailsModal";
import { formatSastDateTime } from "../../utils/formatSastDateTime.js";

const TRN_BGO_COLUMN_OPTIONS = [
  { key: "meterType", label: "Meter Type" },
  { key: "meterPhase", label: "Meter Phase" },
  { key: "meterStatus", label: "Meter State" },
  { key: "rowStatus", label: "Row Status" },
  { key: "naCount", label: "NA Count" },
  { key: "activeTrnId", label: "TRN ID" },
  { key: "address", label: "Address" },
  { key: "erfNo", label: "Erf No" },
  { key: "wardNo", label: "Ward" },
  { key: "geofenceName", label: "Geofence" },
  { key: "updatedAt", label: "Last Activity" },
];

const TRN_BGO_DEFAULT_VISIBILITY = Object.fromEntries(
  TRN_BGO_COLUMN_OPTIONS.map((opt) => [opt.key, true]),
);

function prettyState(value) {
  const s = String(value || "").trim();
  return s ? s.replaceAll("_", " ") : "NAv";
}

function formatWardScope(batch) {
  const pcode = String(batch?.wardPcode || batch?.scope?.wardPcode || batch?.wardNo || "").trim();
  const explicitName = String(batch?.wardName || batch?.scope?.wardName || "").trim();
  if (explicitName && explicitName !== "NAv") {
    return pcode ? `${explicitName} (${pcode})` : explicitName;
  }
  const match = pcode.match(/(\d{1,3})$/);
  if (match && pcode) {
    return `Ward ${Number(match[1])} (${pcode})`;
  }
  return pcode || "NAv";
}

function SummaryCards({ summary, selected, onSelect }) {
  const items = [
    ["Total Rows", "total", ""],
    ["Not Started", "notStarted", "NOT STARTED"],
    ["In Progress", "inProgress", "IN PROGRESS"],
    ["Completed", "completed", "COMPLETED"],
  ];
  return (
    <div
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 10 }}
      role="group"
      aria-label="Filter rows by status"
    >
      {items.map(([label, key, filterValue]) => (
        <button
          key={key}
          type="button"
          aria-pressed={selected === filterValue}
          onClick={() => onSelect(filterValue)}
          style={{
            textAlign: "left",
            background: selected === filterValue ? "#eff6ff" : "white",
            border: selected === filterValue ? "1px solid #2563eb" : "1px solid #e2e8f0",
            borderRadius: 14,
            padding: 14,
            cursor: "pointer",
            font: "inherit",
          }}
        >
          <span style={{ display: "block", color: "#64748b", fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>
            {label}
          </span>
          <strong style={{ display: "block", marginTop: 6, color: "#0f172a", fontSize: 23 }}>
            {summary[key].toLocaleString("en-ZA")}
          </strong>
          <span style={{ display: "block", color: "#475569", fontSize: 11, marginTop: 4 }}>
            {selected === filterValue ? "Selected" : filterValue ? "Filter rows" : "All statuses"}
          </span>
        </button>
      ))}
    </div>
  );
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-ZA") : "0";
}

function resolveWorkbase(auth = {}, geoState = {}) {
  const candidate =
    auth?.activeWorkbase ||
    auth?.profile?.access?.activeWorkbase ||
    auth?.profile?.activeWorkbase ||
    auth?.activeLm ||
    (Array.isArray(auth?.workbases) && auth.workbases[0]) ||
    (Array.isArray(auth?.profile?.access?.workbases) && auth.profile.access.workbases[0]) ||
    geoState?.selectedLm ||
    null;

  const pcode = String(
    candidate?.lmPcode ||
      candidate?.pcode ||
      candidate?.id ||
      candidate?.localMunicipalityId ||
      "",
  ).trim();

  const lmName = String(
    candidate?.name ||
      candidate?.lmName ||
      candidate?.id ||
      candidate?.pcode ||
      "NAv",
  ).trim();

  return {
    lmPcode: pcode === "NAv" ? "" : pcode,
    lmName,
  };
}

export default function TrnBgoRowsPage() {
  const [searchParams] = useSearchParams();
  const batchId = searchParams.get("batchId") || "";
  const wardPcodeParam = searchParams.get("wardPcode") || "";
  const lmPcodeParam = searchParams.get("lmPcode") || "";

  const auth = useAuth();
  const { geoState } = useGeo();
  const { lmPcode: resolvedLmPcode, lmName: resolvedLmName } = useMemo(
    () => resolveWorkbase(auth, geoState),
    [auth, geoState],
  );
  const activeLmPcode = lmPcodeParam || resolvedLmPcode;

  // Stream TC upload metadata (for candidate / staged uploads)
  const { data: tcUpload, isLoading: isTcUploadLoading } = useGetTcUploadByIdQuery(
    batchId,
    { skip: !batchId },
  );

  // Stream BGO batches list (for converted batches)
  const { data: allBatches = [], isLoading: areBatchesLoading } = useGetBgoBatchesByLmQuery(
    { lmPcode: activeLmPcode },
    { skip: !activeLmPcode },
  );

  const bgoBatch = useMemo(() => {
    return allBatches.find((b) => b.id === batchId) || null;
  }, [allBatches, batchId]);

  const activeBatch = tcUpload || bgoBatch || null;

  // Stream rows from tc_rows
  const {
    data: tcRows = [],
    isLoading: isTcRowsLoading,
    error: tcRowsError,
  } = useGetTcRowsByTcIdQuery(batchId, {
    skip: !batchId,
  });

  // Stream rows from bgo_rows (for converted batches)
  const {
    data: bgoRows = [],
    isLoading: isBgoRowsLoading,
    error: bgoRowsError,
  } = useGetBgoRowsByBatchIdQuery(
    { bgoBatchId: batchId },
    { skip: !batchId || isTcRowsLoading || tcRows.length > 0 },
  );

  const { data: childTrns = [] } = useGetTrnBgoChildTrnsByBatchIdQuery(batchId, { skip: !batchId });
  const batchWardPcode = String(activeBatch?.wardPcode || activeBatch?.scope?.wardPcode || "").trim();
  const { data: asts = [] } = useGetAstsByLmPcodeWardPcodeQuery(
    { lmPcode: activeLmPcode, wardPcode: batchWardPcode },
    { skip: !activeLmPcode || !batchWardPcode },
  );
  const rawRows = tcRows.length > 0 ? tcRows : bgoRows;
  const isLoading = isTcUploadLoading || isTcRowsLoading || (!tcUpload && areBatchesLoading) || (tcRows.length === 0 && isBgoRowsLoading);
  const rowsError = tcRowsError || bgoRowsError;

  // Normalize rows for IrepsTable (joining live child TRN truth onto tc_rows)
  const displayRows = useMemo(
    () => buildTrnBgoDisplayRows({ rawRows, childTrns, asts, activeBatch }),
    [rawRows, childTrns, asts, activeBatch],
  );
  const summary = useMemo(() => buildTrnBgoRowsSummary(displayRows), [displayRows]);
  const [filters, setFilters] = useState({});
  const [mapView, setMapView] = useState(null);
  const [selectedMeterId, setSelectedMeterId] = useState(null);
  const [columnVisibility, setColumnVisibility] = useState(TRN_BGO_DEFAULT_VISIBILITY);
  const [showColumnControls, setShowColumnControls] = useState(false);
  const selectedRowStatus = filters.rowStatus || "";
  const filterRows = (value) => setFilters((current) => ({ ...current, rowStatus: current.rowStatus === value ? "" : value }));

  // IrepsTable column definitions
  const allColumns = useMemo(() => [
    {
      key: "meterNo",
      label: "Meter No",
      width: 160,
      filter: "text",
      sortable: true,
      value: (r) => r.meterNo,
      sortValue: (r) => r.meterNo,
      render: (r) =>
        r.astId ? (
          <DataActionButton
            icon={<MeterActionIcon />}
            title="Open meter details"
            onClick={() => setSelectedMeterId(r.astId)}
          >
            {r.meterNo}
          </DataActionButton>
        ) : (
          <span style={styles.meterNoCell}>{r.meterNo}</span>
        ),
    },
    {
      key: "meterType",
      label: "Meter Type",
      width: 120,
      sortable: true,
      filter: "select",
      value: (r) => r.meterType,
      sortValue: (r) => r.meterType,
    },
    {
      key: "meterPhase",
      label: "Meter Phase",
      width: 120,
      sortable: true,
      filter: "select",
      value: (r) => r.meterPhase,
      sortValue: (r) => r.meterPhase,
    },
    {
      key: "meterStatus",
      label: "Meter State",
      width: 120,
      filter: "select",
      sortable: true,
      value: (r) => r.meterStatus,
      sortValue: (r) => r.meterStatus,
      render: (r) => {
        const isConn = r.meterStatus === "CONNECTED";
        return (
          <span
            style={{
              ...styles.badge,
              background: isConn ? "#ecfdf5" : "#fef2f2",
              color: isConn ? "#047857" : "#b91c1c",
              border: `1px solid ${isConn ? "#a7f3d0" : "#fecaca"}`,
            }}
          >
            {r.meterStatus}
          </span>
        );
      },
    },
    {
      key: "rowStatus",
      label: "Row Status",
      minWidth: 135,
      filter: "select",
      sortable: true,
      value: (r) => r.rowStatus,
      sortValue: (r) => r.rowStatus,
      render: (r) => {
        const isCompleted = r.rowStatus === "COMPLETED";
        const isInProgress = r.rowStatus === "IN PROGRESS";
        return (
          <span
            style={{
              display: "inline-flex",
              borderRadius: 999,
              padding: "5px 9px",
              fontSize: 11,
              fontWeight: 800,
              whiteSpace: "nowrap",
              background: isCompleted ? "#dcfce7" : isInProgress ? "#fef3c7" : "#dbeafe",
              color: isCompleted ? "#166534" : isInProgress ? "#92400e" : "#1e40af",
            }}
          >
            {r.rowStatus}
          </span>
        );
      },
    },
    {
      key: "naCount",
      label: "NA Count",
      width: 95,
      filter: "select",
      sortable: true,
      value: (r) => String(r.naCount ?? 0),
      sortValue: (r) => Number(r.naCount ?? 0),
      render: (r) => (
        <span
          style={{
            fontWeight: 700,
            fontSize: 12,
            color: r.naCount > 0 ? "#b45309" : "#64748b",
          }}
        >
          {r.naCount ?? 0}
        </span>
      ),
    },
    {
      key: "activeTrnId",
      label: "TRN ID",
      width: 220,
      filter: "text",
      sortable: true,
      value: (r) => r.activeTrnId,
      sortValue: (r) => r.activeTrnId,
      render: (r) => {
        if (!r.activeTrnId || r.activeTrnId === "None") {
          return <span style={{ color: "#94a3b8", fontSize: 12 }}>None</span>;
        }
        return <span style={styles.activeTrnCode}>{r.activeTrnId}</span>;
      },
    },
    {
      key: "address",
      label: "Address",
      width: 300,
      minWidth: 280,
      filter: "text",
      sortable: true,
      value: (r) => r.address,
      sortValue: (r) => r.address,
      render: (r) => <div style={styles.addressLine}>{r.address}</div>,
    },
    {
      key: "erfNo",
      label: "Erf No",
      width: 120,
      filter: "text",
      sortable: true,
      value: (r) => r.erfNo,
      sortValue: (r) => r.erfNo,
      render: (r) =>
        r.erfId ? (
          <DataActionButton
            compact
            title="Where this ERF is"
            icon={<ErfActionIcon />}
            onClick={() => setMapView({ erfId: r.erfId, erfNo: r.erfNo, wardPcode: r.wardNo !== "NAv" ? r.wardNo : batchWardPcode })}
          >
            {r.erfNo}
          </DataActionButton>
        ) : (
          <span style={{ fontSize: 12, fontWeight: 600 }}>{r.erfNo}</span>
        ),
    },
    {
      key: "wardNo",
      label: "Ward",
      width: 110,
      filter: "select",
      sortable: true,
      value: (r) => r.wardNo,
      sortValue: (r) => r.wardNo,
      render: (r) => <span style={{ fontSize: 12 }}>{r.wardNo}</span>,
    },
    {
      key: "geofenceName",
      label: "Geofence",
      width: 240,
      minWidth: 220,
      filter: "select",
      sortable: true,
      value: (r) => r.geofenceName,
      sortValue: (r) => r.geofenceName,
      render: (r) => <div style={styles.geofenceLine}>{r.geofenceName}</div>,
    },
    {
      key: "updatedAt",
      label: "Last Activity",
      width: 155,
      filter: "date",
      sortable: true,
      sortEmptyLast: true,
      value: (r) => r.updatedAt || "",
      sortValue: (r) => (r.updatedAt ? Date.parse(r.updatedAt) || 0 : 0),
      render: (r) => formatSastDateTime(r.updatedAt),
    },
  ], [batchWardPcode]);

  const columns = useMemo(
    () => allColumns.filter((col) => col.key === "meterNo" || columnVisibility[col.key] !== false),
    [allColumns, columnVisibility],
  );

  const toggleColumn = (key) => {
    if (columnVisibility[key]) {
      setFilters((current) => {
        if (!current[key]) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
    setColumnVisibility((current) => ({ ...current, [key]: !current[key] }));
  };

  const columnControls = showColumnControls ? (
    <div style={{ padding: "12px 14px", borderTop: "1px solid #e2e8f0", background: "#f8fafc" }}>
      <div style={{ color: "#64748b", fontSize: 12, marginBottom: 10 }}>Always visible: Meter No</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 18px" }}>
        {TRN_BGO_COLUMN_OPTIONS.map((option) => (
          <label key={option.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={Boolean(columnVisibility[option.key])}
              onChange={() => toggleColumn(option.key)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <section style={styles.page}>
      <div style={styles.header}>
        <div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 10 }}>
            <Link to="/operations/trn-bgo" style={{ color: "#1d4ed8", fontWeight: 800, textDecoration: "none" }}>
              ← Back to TRN BGO Register
            </Link>
            <span style={{ color: "#64748b", fontSize: 12, fontWeight: 800, letterSpacing: ".08em" }}>
              OPERATIONS / TRN BGO ROWS
            </span>
          </div>
          <div style={styles.titleHelpRow}>
            <h2 style={styles.title}>TRN BGO Batch Rows</h2>
            <div style={styles.lmHeaderPill}>
              <span style={styles.lmHeaderDot} />
              <span style={styles.lmHeaderLabel}>Local Municipality:</span>
              <strong style={styles.lmHeaderValue}>{resolvedLmName || activeLmPcode || "Active LM"}</strong>
              {activeLmPcode ? <span style={styles.lmHeaderPcode}>({activeLmPcode})</span> : null}
            </div>
          </div>
          <p style={styles.subtitle}>
            Batch ID: <strong>{batchId || "No Batch Selected"}</strong> · {displayRows.length} total constituent rows with live meter and TRN status
          </p>
        </div>

        <div style={styles.headerActions}>
          <Link
            to="/operations/trn-bgo/upload"
            style={styles.secondaryLinkButton}
          >
            Upload & Create TRN BGO
          </Link>
          <Link to="/operations/trn-bgo/dashboard" style={styles.secondaryLinkButton}>
            TRN BGO Dashboard
          </Link>
        </div>
      </div>

      {activeBatch ? (
        <div style={styles.batchBanner}>
          <div style={styles.bannerItem}>
            <span style={styles.bannerLabel}>Operation</span>
            <strong style={styles.bannerValue}>
              {prettyState(activeBatch.trnType || activeBatch.operationType || "METER_DISCONNECTION")}
            </strong>
          </div>
          <div style={styles.bannerItem}>
            <span style={styles.bannerLabel}>File Name</span>
            <strong style={styles.bannerValue}>
              {activeBatch.fileName || activeBatch.sourceUpload?.fileName || "NAv"}
            </strong>
          </div>
          <div style={styles.bannerItem}>
            <span style={styles.bannerLabel}>Ward Scope</span>
            <strong style={styles.bannerValue}>
              {formatWardScope(activeBatch)}
            </strong>
          </div>
          <div style={styles.bannerItem}>
            <span style={styles.bannerLabel}>Total Meters</span>
            <strong style={styles.bannerValue}>
              {formatNumber(activeBatch.totalRows || displayRows.length)}
            </strong>
          </div>
          <div style={styles.bannerItem}>
            <span style={styles.bannerLabel}>BGO Status</span>
            <strong style={styles.bannerValue}>
              {prettyState(activeBatch.bgoStatus || activeBatch.workflow?.state || "NAv")}
            </strong>
          </div>
          <div style={styles.bannerItem}>
            <span style={styles.bannerLabel}>Allocated To</span>
            <strong style={styles.bannerValue}>
              {formatBatchAllocatedTo(activeBatch, childTrns)}
            </strong>
          </div>
        </div>
      ) : null}

      {rowsError ? (
        <div style={styles.errorNotice}>
          Failed to load rows: {rowsError?.data?.message || rowsError?.message || "Unknown error"}
        </div>
      ) : null}

      <SummaryCards summary={summary} selected={selectedRowStatus} onSelect={filterRows} />

      <div style={styles.panel}>
        <IrepsTable showLoadingSpinner
          rows={displayRows}
          stickyColumnKeys={["meterNo"]}
          filters={filters}
          onFiltersChange={setFilters}
          searchValue={trnBgoRowSearchValue}
          toolbar={
            <button
              type="button"
              aria-expanded={showColumnControls}
              onClick={() => setShowColumnControls((current) => !current)}
              style={{
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                padding: "6px 10px",
                color: "#1d4ed8",
                background: "white",
                font: "inherit",
                cursor: "pointer",
              }}
            >
              {showColumnControls ? "Hide Column Controls" : "Show / Hide Columns"}
            </button>
          }
          columnControls={columnControls}
          downloads={{
            registryName: `TRN BGO Batch Rows ${batchId || ""}`.trim(),
            fileBaseName: `trn_bgo_rows_${(batchId || "batch").toLowerCase()}`,
            scope: { lmName: resolvedLmName, lmPcode: activeLmPcode, batchId },
          }}
          columns={columns}
          loading={isLoading}
          emptyText="No constituent meters found for this batch."
          title="BGO Rows"
          pageSizeOptions={[10, 25, 50, 100]}
          defaultPageSize={25}
        />
      </div>
      {mapView ? (
        <BoundaryMapModal
          mode="ERF"
          erfId={mapView.erfId}
          erfNo={mapView.erfNo}
          wardPcode={mapView.wardPcode}
          onClose={() => setMapView(null)}
        />
      ) : null}
      {selectedMeterId ? (
        <MeterDeepDetailsModal meterId={selectedMeterId} onClose={() => setSelectedMeterId(null)} />
      ) : null}
    </section>
  );
}

const styles = {
  page: {
    padding: "24px 32px",
    display: "flex",
    flexDirection: "column",
    gap: 20,
    background: "#f8fafc",
    minHeight: "100vh",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  eyebrow: {
    margin: "0 0 6px",
    fontSize: 12,
    fontWeight: 700,
    color: "#64748b",
  },
  breadcrumbLink: {
    color: "#2563eb",
    textDecoration: "none",
  },
  titleHelpRow: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    margin: "0 0 6px",
  },
  title: {
    margin: 0,
    fontSize: 24,
    fontWeight: 900,
    color: "#0f172a",
    letterSpacing: "-0.02em",
  },
  subtitle: {
    margin: 0,
    fontSize: 13,
    color: "#475569",
  },
  lmHeaderPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 12px",
    borderRadius: 9999,
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    fontSize: 12,
    color: "#1e40af",
  },
  lmHeaderDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#2563eb",
  },
  lmHeaderLabel: {
    fontWeight: 600,
    color: "#475569",
  },
  lmHeaderValue: {
    fontWeight: 800,
    color: "#0f172a",
  },
  lmHeaderPcode: {
    color: "#64748b",
    fontWeight: 600,
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  primaryButton: {
    display: "inline-flex",
    alignItems: "center",
    padding: "8px 16px",
    borderRadius: 8,
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 700,
    fontSize: 13,
    textDecoration: "none",
    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
  },
  secondaryLinkButton: {
    display: "inline-flex",
    alignItems: "center",
    padding: "8px 14px",
    borderRadius: 8,
    background: "#ffffff",
    color: "#334155",
    fontWeight: 700,
    fontSize: 13,
    textDecoration: "none",
    border: "1px solid #cbd5e1",
  },
  batchBanner: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 12,
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: "16px 20px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
  },
  bannerItem: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 0,
  },
  bannerLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  bannerValue: {
    fontSize: 13,
    fontWeight: 800,
    color: "#0f172a",
    overflowWrap: "anywhere",
  },
  panel: {
    background: "#ffffff",
    borderRadius: 14,
    border: "1px solid #e2e8f0",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    overflow: "hidden",
  },
  errorNotice: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
    borderRadius: 10,
    padding: "12px 16px",
    fontSize: 13,
    fontWeight: 600,
  },
  meterNoCell: {
    fontFamily: "monospace",
    fontWeight: 800,
    fontSize: 13,
    color: "#0f172a",
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 8px",
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 800,
  },
  reasonCodeBadge: {
    fontSize: 11,
    fontWeight: 800,
    color: "#b91c1c",
    marginBottom: 2,
    fontFamily: "monospace",
  },
  activeTrnCode: {
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: 700,
    color: "#1d4ed8",
  },
  activeTrnState: {
    display: "inline-block",
    fontSize: 10,
    fontWeight: 800,
    color: "#b45309",
    marginTop: 2,
  },
  addressLine: {
    fontWeight: 600,
    fontSize: 13,
    color: "#0f172a",
  },
  geofenceLine: {
    fontWeight: 700,
    fontSize: 12,
    color: "#0f172a",
  },
  subtleLine: {
    fontSize: 11,
    color: "#64748b",
    marginTop: 1,
  },
};
