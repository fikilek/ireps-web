/* eslint-disable no-unused-vars -- JSX tags are consumed by the JSX transform. */
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import IrepsTable from "../../components/table/IrepsTable";
import DataActionButton, { ErfActionIcon, MeterActionIcon } from "../../components/table/DataActionButton";
import BoundaryMapModal from "../registries/components/BoundaryMapModal";
import MeterDeepDetailsModal from "../registries/components/MeterDeepDetailsModal";
import { useGetAstsByLmPcodeWardPcodeQuery } from "../../redux/astsApi";
import { useGetMdBgoBatchByIdQuery, useGetMdBgoRowsByBatchIdQuery } from "../../redux/bgoApi";
import { useGetPremisesByWardQuery } from "../../redux/mapPremisesApi";
import { buildMdBgoMeterRows, buildMdBgoRowsSummary, enrichMdBgoRows, mdBgoRowSearchValue } from "./md-bgo/mdBgoRowsModel.js";
import { MD_BGO_PREMISE_ADDRESS_WIDTH, MD_BGO_ROW_COLUMN_OPTIONS, MD_BGO_ROW_DEFAULT_VISIBILITY, mdBgoVisibleRowColumns, mdBgoMeterDetailsId, clearMdBgoHiddenColumnFilter } from "./md-bgo/mdBgoRowsPresentation.js";

const PROGRESS_OPTIONS = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "UNAVAILABLE"];
const PROGRESS_LABELS = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  UNAVAILABLE: "Unavailable",
};
const EMPTY_ROWS = Object.freeze([]);

const text = (value) => String(value ?? "").trim();
const shown = (value) => text(value) || "NAv";

function prettyState(value) {
  return shown(value).replaceAll("_", " ");
}

function StatusBadge({ value }) {
  const tone = value === "COMPLETED"
    ? { background: "#dcfce7", color: "#166534" }
    : value === "IN_PROGRESS"
      ? { background: "#fef3c7", color: "#92400e" }
      : value === "UNAVAILABLE"
        ? { background: "#f1f5f9", color: "#475569" }
        : { background: "#dbeafe", color: "#1e40af" };
  return <span style={{ ...tone, display: "inline-flex", borderRadius: 999, padding: "5px 9px", fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}>{prettyState(value)}</span>;
}

function SummaryCards({ summary, selected, onSelect }) {
  const items = [
    ["Total Rows", "total", ""],
    ["Not Started", "notStarted", "NOT_STARTED"],
    ["In Progress", "inProgress", "IN_PROGRESS"],
    ["Completed", "completed", "COMPLETED"],
  ];
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 10, marginBottom: 16 }} role="group" aria-label="Filter rows by progress">
    {items.map(([label, key, filterValue]) => <button key={key} type="button" aria-pressed={selected === filterValue} onClick={() => onSelect(filterValue)} style={{ textAlign: "left", background: selected === filterValue ? "#eff6ff" : "white", border: selected === filterValue ? "1px solid #2563eb" : "1px solid #e2e8f0", borderRadius: 14, padding: 14, cursor: "pointer", font: "inherit" }}>
      <span style={{ display: "block", color: "#64748b", fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>{label}</span>
      <strong style={{ display: "block", marginTop: 6, color: "#0f172a", fontSize: 23 }}>{summary[key].toLocaleString("en-ZA")}</strong>
      <span style={{ display: "block", color: "#475569", fontSize: 11, marginTop: 4 }}>{selected === filterValue ? "Selected" : filterValue ? "Filter rows" : "All statuses"}</span>
    </button>)}
  </div>;
}

export default function MdBgoRowsPage() {
  const [searchParams] = useSearchParams();
  const batchId = text(searchParams.get("batchId") || searchParams.get("bgoBatchId"));
  const { data: batchResult } = useGetMdBgoBatchByIdQuery(batchId, { skip: !batchId });
  const { data: rowResult } = useGetMdBgoRowsByBatchIdQuery(batchId, { skip: !batchId });
  const batch = batchResult?.batch || null;
  const rows = rowResult?.rows || EMPTY_ROWS;
  const scope = batch?.scope || {};
  const lmPcode = text(scope.lmPcode || searchParams.get("lmPcode"));
  const wardPcode = text(scope.wardPcode || searchParams.get("wardPcode"));
  const { data: premises = [], isLoading: premisesLoading } = useGetPremisesByWardQuery(wardPcode, { skip: !wardPcode });
  const { data: meters = [], isLoading: metersLoading } = useGetAstsByLmPcodeWardPcodeQuery({ lmPcode, wardPcode }, { skip: !lmPcode || !wardPcode });
  const [filters, setFilters] = useState({});
  const [mapView, setMapView] = useState(null);
  const [selectedMeterId, setSelectedMeterId] = useState(null);
  const [columnVisibility, setColumnVisibility] = useState(MD_BGO_ROW_DEFAULT_VISIBILITY);
  const [showColumnControls, setShowColumnControls] = useState(false);

  const enrichedRows = useMemo(() => buildMdBgoMeterRows(enrichMdBgoRows({ rows, premises, meters })), [rows, premises, meters]);
  const summary = useMemo(() => buildMdBgoRowsSummary(enrichedRows), [enrichedRows]);
  const selectedProgress = filters.progress || "";
  const allColumns = useMemo(() => [
    { key: "meterNo", label: "Meter No", filter: "text", value: (row) => row.meterNo,
      render: (row) => mdBgoMeterDetailsId(row) ? <DataActionButton icon={<MeterActionIcon />} title="Open meter details" onClick={() => setSelectedMeterId(mdBgoMeterDetailsId(row))}>{row.meterNo}</DataActionButton> : shown(row.meterNo),
    },
    {
      key: "erfNo", label: "Erf No", filter: "text", value: (row) => row.erfNo,
      render: (row) => row.erfId ? <DataActionButton compact title="Where this ERF is" icon={<ErfActionIcon />} onClick={() => setMapView({ erfId: row.erfId, erfNo: row.erfNo, wardPcode: row.scope?.wardPcode || wardPcode })}>{row.erfNo}</DataActionButton> : shown(row.erfNo),
    },
    {
      key: "premiseAddress", label: "Premise Address", filter: "text",
      width: MD_BGO_PREMISE_ADDRESS_WIDTH, minWidth: MD_BGO_PREMISE_ADDRESS_WIDTH,
      cellStyle: { boxSizing: "border-box", overflowWrap: "anywhere" }, headerStyle: { boxSizing: "border-box" },
      value: (row) => [row.premiseAddress, row.premiseId].filter(Boolean).join(" "),
      exportValue: (row) => [row.premiseAddress, row.premiseId].filter(Boolean).join("\n"),
      render: (row) => <div><div>{row.premiseAddress}</div>{row.premiseId ? <small style={{ display: "block", color: "#64748b", fontSize: 10, marginTop: 3, overflowWrap: "anywhere" }}>{row.premiseId}</small> : null}</div>,
    },
    { key: "propertyType", label: "Property Type", filter: "select", value: (row) => row.propertyType },
    { key: "propertyName", label: "Property Name", filter: "text", value: (row) => row.propertyName },
    { key: "unitNo", label: "Unit No", filter: "text", value: (row) => row.unitNo },
    { key: "progress", label: "Progress", filter: "select", filterOptions: PROGRESS_OPTIONS.map((value) => ({ value, label: PROGRESS_LABELS[value] })), value: (row) => row.progress, render: (row) => <StatusBadge value={row.progress} /> },
    { key: "sourceRowId", label: "BGO Row ID", filter: "text", value: (row) => row.sourceRowId },
  ], [wardPcode]);
  const columns = useMemo(() => mdBgoVisibleRowColumns(allColumns, columnVisibility), [allColumns, columnVisibility]);
  const toggleColumn = (key) => {
    if (columnVisibility[key]) setFilters(current => clearMdBgoHiddenColumnFilter(current, key));
    setColumnVisibility(current => ({ ...current, [key]: !current[key] }));
  };
  const columnControls = showColumnControls ? <div style={{ padding: "12px 14px", borderTop: "1px solid #e2e8f0", background: "#f8fafc" }}>
    <div style={{ color: "#64748b", fontSize: 12, marginBottom: 10 }}>Always visible: Meter No</div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 18px" }}>
      {MD_BGO_ROW_COLUMN_OPTIONS.map(option => <label key={option.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
        <input type="checkbox" checked={Boolean(columnVisibility[option.key])} onChange={() => toggleColumn(option.key)} />
        <span>{option.label}</span>
      </label>)}
    </div>
  </div> : null;
  const downloads = useMemo(() => ({
    registryName: "MD BGO Rows",
    fileBaseName: `md_bgo_rows_${batchId || "batch"}`,
    scope: { module: "MD BGO Rows", lmPcode, wardPcode, batchId },
    columns: columns.map((column) => ({ key: column.key, header: column.label, value: column.exportValue || column.value })),
  }), [batchId, columns, lmPcode, wardPcode]);
  const loading = Boolean(batchId) && (!batchResult?.ready || !rowResult?.ready || premisesLoading || metersLoading);
  const error = batchResult?.error || rowResult?.error || (batchResult?.ready && !batch ? "The selected MD BGO batch was not found." : "");
  const filterRows = (value) => setFilters((current) => ({ ...current, progress: current.progress === value ? "" : value }));

  if (!batchId) return <section style={{ padding: 24 }}><Link to="/operations/bgo">← Back to MD BGO Register</Link><p role="alert">A batch ID is required to show MD BGO Rows.</p></section>;

  return <main style={{ padding: 24 }}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 18 }}>
      <Link to="/operations/bgo" style={{ color: "#1d4ed8", fontWeight: 800, textDecoration: "none" }}>← Back to MD BGO Register</Link>
      <span style={{ color: "#64748b", fontSize: 12, fontWeight: 800, letterSpacing: ".08em" }}>OPERATIONS / MD BGO ROWS</span>
    </div>
    <header style={{ marginBottom: 18 }}>
      <h1 style={{ margin: "0 0 6px", color: "#0f172a", fontSize: 30 }}>MD BGO Rows</h1>
      <p style={{ margin: 0, color: "#64748b" }}>One row per discovered meter; ERF and premise work awaiting meter discovery shows NAv.</p>
    </header>
    {error ? <section role="alert" style={{ padding: 16, marginBottom: 16, border: "1px solid #fecaca", borderRadius: 12, color: "#991b1b", background: "#fef2f2" }}><strong>MD BGO rows could not be loaded.</strong><div>{error}</div></section> : null}
    <section aria-label="Batch Details" style={{ padding: 18, marginBottom: 16, border: "1px solid #e2e8f0", borderRadius: 16, background: "white" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
        <div style={{ minWidth: 0 }}><small style={{ display: "block", color: "#64748b", fontWeight: 800 }}>BATCH ID</small><strong style={{ display: "block", overflowWrap: "anywhere" }}>{batchId}</strong></div>
        <div style={{ minWidth: 0 }}><small style={{ display: "block", color: "#64748b", fontWeight: 800 }}>GEOFENCE</small><strong style={{ display: "block", overflowWrap: "anywhere" }}>{shown(batch?.geofenceRef?.name)}</strong></div>
        <div style={{ minWidth: 0 }}><small style={{ display: "block", color: "#64748b", fontWeight: 800 }}>WARD</small><strong style={{ display: "block", overflowWrap: "anywhere" }}>{shown(scope.wardName)}{scope.wardPcode ? ` (${scope.wardPcode})` : ""}</strong></div>
        <div style={{ minWidth: 0 }}><small style={{ display: "block", color: "#64748b", fontWeight: 800 }}>BATCH STATUS</small><strong style={{ display: "block", overflowWrap: "anywhere" }}>{prettyState(batch?.workflow?.state)}</strong></div>
        <div style={{ minWidth: 0 }}><small style={{ display: "block", color: "#64748b", fontWeight: 800 }}>ERFs IN BATCH</small><strong style={{ display: "block", overflowWrap: "anywhere" }}>{Number(batch?.summary?.erfCount ?? batch?.summary?.totalRows ?? rows.length).toLocaleString("en-ZA")}</strong></div>
      </div>
    </section>
    <SummaryCards summary={summary} selected={selectedProgress} onSelect={filterRows} />
    <IrepsTable
      title="BGO Rows"
      columns={columns}
      toolbar={<button type="button" aria-expanded={showColumnControls} onClick={() => setShowColumnControls(current => !current)} style={{ border: "1px solid #cbd5e1", borderRadius: 8, padding: "6px 10px", color: "#1d4ed8", background: "white", font: "inherit", cursor: "pointer" }}>{showColumnControls ? "Hide Column Controls" : "Show / Hide Columns"}</button>}
      columnControls={columnControls}
      rows={enrichedRows}
      rowKey={(row) => row.rowKey}
      filters={filters}
      onFiltersChange={setFilters}
      searchValue={mdBgoRowSearchValue}
      downloads={downloads}
      loading={loading}
      loadingText="Loading live batch rows and linked premise/meter details…"
      emptyText={rows.length ? "No BGO rows match the current filters." : "No permanent BGO rows were found for this batch."}
    />
    {mapView ? <BoundaryMapModal mode="ERF" erfId={mapView.erfId} erfNo={mapView.erfNo} wardPcode={mapView.wardPcode} onClose={() => setMapView(null)} /> : null}
    {selectedMeterId ? <MeterDeepDetailsModal meterId={selectedMeterId} onClose={() => setSelectedMeterId(null)} /> : null}
  </main>;
}
