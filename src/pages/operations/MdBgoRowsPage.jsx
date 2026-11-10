/* eslint-disable no-unused-vars -- JSX tags are consumed by the JSX transform. */
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import IrepsTable from "../../components/table/IrepsTable";
import { useGetAstsByLmPcodeWardPcodeQuery } from "../../redux/astsApi";
import { useGetMdBgoBatchByIdQuery, useGetMdBgoRowsByBatchIdQuery } from "../../redux/bgoApi";
import { useGetPremisesByWardQuery } from "../../redux/mapPremisesApi";
import { buildMdBgoRowsSummary, enrichMdBgoRows, mdBgoRowSearchValue } from "./md-bgo/mdBgoRowsModel.js";

const PROGRESS_OPTIONS = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "UNAVAILABLE"];
const PROGRESS_LABELS = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  UNAVAILABLE: "Unavailable",
};
const STATE_OPTIONS = ["READY_FOR_ALLOCATION", "ISSUED", "ALLOCATED", "ACCEPTED", "REJECTED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NAv"];
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

  const enrichedRows = useMemo(() => enrichMdBgoRows({ rows, premises, meters }), [rows, premises, meters]);
  const summary = useMemo(() => buildMdBgoRowsSummary(rows), [rows]);
  const selectedProgress = filters.progress || "";
  const columns = useMemo(() => [
    { key: "rowNo", label: "Row", group: "Row Details", filter: "text", value: (row) => row.rowNo, sortValue: (row) => row.rowNo },
    { key: "erfNo", label: "ERF", group: "Row Details", filter: "text", value: (row) => row.erfNo },
    { key: "premiseNo", label: "Premise No", group: "Premise", filter: "text", value: (row) => row.premiseNo },
    { key: "premiseId", label: "Premise ID", group: "Premise", filter: "text", value: (row) => row.premiseId || "NAv" },
    { key: "premiseAddress", label: "Premise Address", group: "Premise", filter: "text", value: (row) => row.premiseAddress },
    { key: "propertyType", label: "Property Type", group: "Premise", filter: "select", value: (row) => row.propertyType },
    { key: "propertyName", label: "Property Name", group: "Premise", filter: "text", value: (row) => row.propertyName },
    { key: "unitNo", label: "Unit No", group: "Premise", filter: "text", value: (row) => row.unitNo },
    { key: "meterNumbers", label: "Meters", group: "Meter Discovery", filter: "text", value: (row) => row.meterNumbers },
    { key: "progress", label: "Progress", group: "Meter Discovery", filter: "select", filterOptions: PROGRESS_OPTIONS.map((value) => ({ value, label: PROGRESS_LABELS[value] })), value: (row) => row.progress, render: (row) => <StatusBadge value={row.progress} /> },
    { key: "workflowState", label: "Row State", group: "Meter Discovery", filter: "select", filterOptions: STATE_OPTIONS.map((value) => ({ value, label: prettyState(value) })), value: (row) => row.workflowState, render: (row) => <StatusBadge value={row.workflowState} /> },
    { key: "rowKey", label: "BGO Row ID", group: "Row Details", filter: "text", value: (row) => row.rowKey },
  ], []);
  const downloads = useMemo(() => ({
    registryName: "MD BGO Rows",
    fileBaseName: `md_bgo_rows_${batchId || "batch"}`,
    scope: { module: "MD BGO Rows", lmPcode, wardPcode, batchId },
    columns: columns.map((column) => ({ key: column.key, header: column.label, value: column.value })),
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
      <p style={{ margin: 0, color: "#64748b" }}>One live work row per ERF or captured premise for this batch.</p>
    </header>
    {error ? <section role="alert" style={{ padding: 16, marginBottom: 16, border: "1px solid #fecaca", borderRadius: 12, color: "#991b1b", background: "#fef2f2" }}><strong>MD BGO rows could not be loaded.</strong><div>{error}</div></section> : null}
    <section aria-label="Batch Details" style={{ padding: 18, marginBottom: 16, border: "1px solid #e2e8f0", borderRadius: 16, background: "white" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
        <div><small style={{ display: "block", color: "#64748b", fontWeight: 800 }}>BATCH ID</small><strong>{batchId}</strong></div>
        <div><small style={{ display: "block", color: "#64748b", fontWeight: 800 }}>GEOFENCE</small><strong>{shown(batch?.geofenceRef?.name)}</strong></div>
        <div><small style={{ display: "block", color: "#64748b", fontWeight: 800 }}>WARD</small><strong>{shown(scope.wardName)}{scope.wardPcode ? ` (${scope.wardPcode})` : ""}</strong></div>
        <div><small style={{ display: "block", color: "#64748b", fontWeight: 800 }}>BATCH STATUS</small><strong>{prettyState(batch?.workflow?.state)}</strong></div>
        <div><small style={{ display: "block", color: "#64748b", fontWeight: 800 }}>ERFs IN BATCH</small><strong>{Number(batch?.summary?.erfCount ?? batch?.summary?.totalRows ?? rows.length).toLocaleString("en-ZA")}</strong></div>
      </div>
    </section>
    <SummaryCards summary={summary} selected={selectedProgress} onSelect={filterRows} />
    <IrepsTable
      title="BGO Rows"
      columns={columns}
      groups={[{ key: "Row Details", label: "Row Details" }, { key: "Premise", label: "Premise" }, { key: "Meter Discovery", label: "Meter Discovery" }]}
      rows={enrichedRows}
      rowKey={(row) => row.rowKey}
      defaultSort={{ key: "rowNo", direction: "asc" }}
      filters={filters}
      onFiltersChange={setFilters}
      searchValue={mdBgoRowSearchValue}
      downloads={downloads}
      loading={loading}
      loadingText="Loading live batch rows and linked premise/meter details…"
      emptyText={rows.length ? "No BGO rows match the current filters." : "No permanent BGO rows were found for this batch."}
    />
  </main>;
}
