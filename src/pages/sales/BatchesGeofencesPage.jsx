/* eslint-disable no-unused-vars -- JSX tags are used by React. */
import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../auth/useAuth";
import { useSalesReadScope } from "../../redux/salesApi";
import { useGetPermanentSalesBatchesQuery } from "../../redux/salesTargetedBatchApi";
import { useGetGeoFencesByLmQuery } from "../../redux/mapGeofencesApi";
import { prepareTargetedBatchDraft, saveSalesDraftFence, selectTargetedBatchDraft } from "../../redux/targetedBatchDraftSlice";
import DownloadButtons from "../../components/DownloadButtons";
import { DatetimeFilterButton, DatetimeFilterModal, EMPTY_DATETIME_FILTER } from "../../components/DatetimeFilter";
import { pageReturn } from "../../components/batch-map-path.js";
import { BATCH_GEOFENCE_COLUMNS, BATCH_GEOFENCE_GROUPS, BATCH_GEOFENCE_PAGE_SIZES, BATCH_GEOFENCE_STATUS, allBatchGeofenceColumns, batchGeofenceDownloadColumns, buildBatchGeofenceRows,
  defaultBatchGeofenceColumns, displayBatchGeofenceValue, filterBatchGeofenceRows, isBatchGeofenceGap, paginateBatchGeofenceRows, readBatchGeofenceColumns, salesDraftForGeofence,
  sortBatchGeofenceRows, batchGeofenceSelectOptions } from "./models/batchGeofenceModel.js";
import { getActiveLmPcode, getActiveWorkbaseName } from "./salesUtils";

// Targeted Batch rules TB-R044: every batch with its geofence and every geofence with its batch.
const COLUMNS_STORAGE_KEY = "ireps.batchesGeofences.columns.v1";
const DEFAULT_SORT = { key: "", direction: "asc" };
const ACTION = { key: "action", group: "link", label: "Action" };
const STATUS_COLORS = { [BATCH_GEOFENCE_STATUS.LINKED]: "#166534", [BATCH_GEOFENCE_STATUS.NO_GEOFENCE]: "#b45309", [BATCH_GEOFENCE_STATUS.BATCH_NOT_CREATED]: "#b91c1c",
  [BATCH_GEOFENCE_STATUS.BATCH_REMOVED]: "#64748b", [BATCH_GEOFENCE_STATUS.AREA]: "#475569" };
const GROUP_TINTS = { batch: { band: "#dbeafe", head: "#eff6ff", text: "#1e3a8a" }, link: { band: "#e2e8f0", head: "#f8fafc", text: "#0f172a" }, geofence: { band: "#ede9fe", head: "#f5f3ff", text: "#5b21b6" } };

function loadColumns() {
  try { return readBatchGeofenceColumns(JSON.parse(window.localStorage.getItem(COLUMNS_STORAGE_KEY) || "null")); }
  catch { return defaultBatchGeofenceColumns(); }
}
function saveColumns(columns) {
  try { window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(columns)); } catch { /* the choice just is not remembered */ }
}

export default function BatchesGeofencesPage() {
  const { activeWorkbase, uid } = useAuth();
  const lmPcode = getActiveLmPcode(activeWorkbase) || "", lmName = getActiveWorkbaseName(activeWorkbase);
  const readScope = useSalesReadScope(lmPcode);
  const back = pageReturn(useLocation().state, { path: "/sales/non-gps-batch-planning", label: "Non-GPS Sales Table" });
  const dispatch = useDispatch(), navigate = useNavigate(), openDraft = useSelector(selectTargetedBatchDraft);
  const { data: permanent } = useGetPermanentSalesBatchesQuery({ lmPcode }, { skip: !lmPcode });
  const { data: geofences, isLoading: geofencesLoading } = useGetGeoFencesByLmQuery(lmPcode, { skip: !lmPcode });
  const rows = useMemo(() => buildBatchGeofenceRows({ batches: permanent?.batches || [], geofences: geofences || [], uid }), [permanent?.batches, geofences, uid]);
  const [columns, setColumns] = useState(loadColumns), [chooserOpen, setChooserOpen] = useState(false);
  const [opening, setOpening] = useState(""), [message, setMessage] = useState("");
  const loading = Boolean(lmPcode) && ((!permanent?.ready && !permanent?.error) || geofencesLoading);
  const changeColumns = next => { setColumns(next); saveColumns(next); };

  async function createItsBatch(row) {
    if (opening) return;
    if (openDraft && !window.confirm("This replaces the TB Draft you have open. Continue?")) return;
    setOpening(row.key); setMessage("");
    try {
      const snapshots = await Promise.all(row.fence.targetedBatch.salesIds.map(id => getDoc(doc(db, "sales-all-meters", id))));
      const salesRows = snapshots.filter(snapshot => snapshot.exists()).map(snapshot => ({ ...snapshot.data(), id: snapshot.id }));
      const plan = salesDraftForGeofence({ fence: row.fence, salesRows, lmPcode, lmName, scopeKey: JSON.stringify(readScope) });
      if (!plan.ok) { setMessage(plan.message); return; }
      dispatch(prepareTargetedBatchDraft(plan.payload));
      dispatch(saveSalesDraftFence({ tbId: plan.payload.id, fence: { id: row.fence.id } }));
      navigate("/operations/targeted-batches/draft");
    } catch { setMessage("Couldn't read this geofence's meters right now. Try again."); }
    finally { setOpening(""); }
  }

  return <div style={styles.page}>
    <Link to={back.path} style={styles.backLink}>← Back to {back.label}</Link>
    <section style={styles.header}>
      <div>
        <p style={styles.eyebrow}>Sales Planning</p>
        <h1 style={styles.title}>Batches &amp; Geofences</h1>
        <p style={styles.subtitle}>{lmPcode || "NAv"} · {lmName} · Every batch with its geofence and every geofence with its batch. A blank side is a gap.</p>
      </div>
      <div style={styles.headerActions}>
        <div style={styles.chooserAnchor}>
          <button type="button" style={styles.linkButton} aria-expanded={chooserOpen} onClick={() => setChooserOpen(open => !open)}>Columns</button>
          {chooserOpen ? <ColumnsChooser columns={columns} onChange={changeColumns} onClose={() => setChooserOpen(false)}/> : null}
        </div>
        <Link to="/sales/table" style={styles.linkButton}>GPS Sales Table</Link>
        <Link to="/sales/non-gps-batch-planning" style={styles.linkButton}>Non-GPS Sales Table</Link>
      </div>
    </section>
    {!lmPcode ? <p style={styles.notice}>Activate a Local Municipality workbase first.</p> : null}
    {permanent?.error ? <p role="alert" style={styles.error}>Couldn't load the batches: {permanent.error}</p> : null}
    {message ? <p role="alert" style={styles.error}>{message}</p> : null}
    <BatchGeofenceTable key={lmPcode} rows={rows} columns={columns} loading={loading} opening={opening} onCreateBatch={createItsBatch} scope={{ lmPcode: lmPcode || "NAv", lmName }}/>
  </div>;
}

function ColumnsChooser({ columns, onChange, onClose }) {
  return <div role="dialog" aria-label="Show or hide columns" style={styles.chooser}>
    <div style={styles.chooserHead}><strong>Show columns</strong><button type="button" aria-label="Close" style={styles.closeButton} onClick={onClose}>×</button></div>
    {BATCH_GEOFENCE_GROUPS.map(group => <fieldset key={group.key} style={styles.chooserGroup}>
      <legend style={{ ...styles.chooserLegend, color: GROUP_TINTS[group.key].text }}>{group.label}</legend>
      {BATCH_GEOFENCE_COLUMNS.filter(column => column.group === group.key).map(column => <label key={column.key} style={styles.chooserItem}>
        <input type="checkbox" checked={Boolean(columns[column.key])} onChange={event => onChange({ ...columns, [column.key]: event.target.checked })}/> {column.label}
      </label>)}
      {group.key === "link" ? <span style={styles.muted}>Action is always shown.</span> : null}
    </fieldset>)}
    <div style={styles.chooserActions}>
      <button type="button" style={styles.plainButton} onClick={() => onChange(allBatchGeofenceColumns())}>Show all</button>
      <button type="button" style={styles.plainButton} onClick={() => onChange(defaultBatchGeofenceColumns())}>Back to default</button>
    </div>
  </div>;
}

// Registry table standard (ui-rules/registry-tables.md): filter, then sort, then page; every
// table-shaping change returns to page 1 in its handler. Keyed by LM, so a new LM starts fresh.
function BatchGeofenceTable({ rows, columns, loading, opening, onCreateBatch, scope }) {
  const [filters, setFilters] = useState({}), [gapsOnly, setGapsOnly] = useState(false);
  const [sort, setSort] = useState(DEFAULT_SORT), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(BATCH_GEOFENCE_PAGE_SIZES[0]);
  const [dateFilterFor, setDateFilterFor] = useState("");
  const options = useMemo(() => Object.fromEntries(BATCH_GEOFENCE_COLUMNS.filter(column => column.filter === "select").map(column => [column.key, batchGeofenceSelectOptions(rows, column)])), [rows]);
  const filtered = useMemo(() => filterBatchGeofenceRows(rows, { filters, gapsOnly }), [rows, filters, gapsOnly]);
  const sorted = useMemo(() => sortBatchGeofenceRows(filtered, sort), [filtered, sort]);
  const current = paginateBatchGeofenceRows(sorted, page, pageSize);
  const shown = [...BATCH_GEOFENCE_COLUMNS.filter(column => columns[column.key] && column.group === "batch"),
    ...BATCH_GEOFENCE_COLUMNS.filter(column => columns[column.key] && column.group === "link"), ACTION,
    ...BATCH_GEOFENCE_COLUMNS.filter(column => columns[column.key] && column.group === "geofence")];
  const bands = BATCH_GEOFENCE_GROUPS.map(group => ({ ...group, span: shown.filter(column => column.group === group.key).length })).filter(group => group.span);
  // A thick line where one group ends and the next begins, through the whole table.
  const divider = index => index > 0 && shown[index].group !== shown[index - 1].group ? styles.divider : null;
  const gaps = rows.filter(isBatchGeofenceGap).length;
  const setFilter = (key, value) => { setFilters(currentFilters => ({ ...currentFilters, [key]: value })); setPage(1); };
  const onSort = key => { setPage(1); setSort(currentSort => currentSort.key !== key ? { key, direction: "asc" } : currentSort.direction === "asc" ? { key, direction: "desc" } : DEFAULT_SORT); };
  const pagination = <Pagination page={current.page} pageSize={pageSize} totalPages={current.totalPages} totalRows={sorted.length}
    onPage={next => setPage(Math.max(1, Math.min(next, current.totalPages)))} onPageSize={size => { setPageSize(size); setPage(1); }}/>;

  return <>
    <section style={styles.toolbar}>
      <span><strong>{rows.length}</strong> rows · <strong>{gaps}</strong> gaps</span>
      <label style={styles.toggle}><input type="checkbox" checked={gapsOnly} onChange={event => { setGapsOnly(event.target.checked); setPage(1); }}/> Gaps only</label>
      <button type="button" style={styles.plainButton} onClick={() => { setFilters({}); setGapsOnly(false); setSort(DEFAULT_SORT); setPage(1); }}>Clear All Filters</button>
      <DownloadButtons registryName="Batches & Geofences" rowsLabel="rows" visibleRows={sorted} columns={batchGeofenceDownloadColumns()} fileBaseName="batches_geofences" scope={scope}/>
      {loading ? <span role="status">Loading batches and geofences…</span> : null}
    </section>
    {pagination}
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>{bands.map((group, index) => <th key={group.key} colSpan={group.span} style={{ ...styles.band, background: GROUP_TINTS[group.key].band, color: GROUP_TINTS[group.key].text, ...(index ? styles.divider : null) }}>{group.label}</th>)}</tr>
          <tr>{shown.map((column, index) => <th key={column.key} style={{ ...styles.th, background: GROUP_TINTS[column.group].head, ...divider(index) }}>
            {column === ACTION ? column.label : <button type="button" style={styles.sortButton} onClick={() => onSort(column.key)}>
              <span>{column.label}</span><span aria-hidden="true">{sort.key === column.key ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span></button>}
          </th>)}</tr>
          <tr>{shown.map((column, index) => <th key={column.key} style={{ ...styles.filterCell, ...divider(index) }}>
            {column === ACTION ? null
              : column.filter === "select" ? <select aria-label={`Filter ${column.label}`} style={styles.filter} value={filters[column.key] || ""} onChange={event => setFilter(column.key, event.target.value)}>
                <option value="">All</option>{options[column.key].map(option => <option key={option} value={option}>{option}</option>)}</select>
              : column.filter === "date" ? <DatetimeFilterButton filter={filters[column.key] || EMPTY_DATETIME_FILTER} fieldLabel={column.label} onClick={() => setDateFilterFor(column.key)}/>
              : <input aria-label={`Filter ${column.label}`} style={styles.filter} value={filters[column.key] || ""} onChange={event => setFilter(column.key, event.target.value)}/>}
          </th>)}</tr>
        </thead>
        <tbody>
          {current.rows.map((row, rowIndex) => <tr key={row.key} style={rowIndex % 2 ? styles.evenRow : styles.oddRow}>
            {shown.map((column, index) => <td key={column.key} style={{ ...styles.td, ...(column.key === "status" ? { color: STATUS_COLORS[row.status], fontWeight: 800 } : null), ...divider(index) }}>
              {column === ACTION ? (row.canCreateBatch ? <button type="button" style={styles.primaryButton} disabled={Boolean(opening)} onClick={() => onCreateBatch(row)}>
                {opening === row.key ? "Opening TB Draft…" : "Create its batch"}</button> : <span style={styles.muted}>{row.note}</span>)
                : displayBatchGeofenceValue(column, row)}
            </td>)}
          </tr>)}
          {!sorted.length && !loading ? <tr><td style={styles.td} colSpan={shown.length}>No rows match the current filters.</td></tr> : null}
          {!sorted.length && loading ? <tr><td style={styles.td} colSpan={shown.length}>Loading batches and geofences…</td></tr> : null}
        </tbody>
      </table>
    </div>
    {pagination}
    {dateFilterFor ? <DatetimeFilterModal filter={filters[dateFilterFor] || EMPTY_DATETIME_FILTER} fieldLabel={BATCH_GEOFENCE_COLUMNS.find(column => column.key === dateFilterFor).label}
      onApply={filter => { setFilter(dateFilterFor, filter); setDateFilterFor(""); }} onClear={() => { setFilter(dateFilterFor, EMPTY_DATETIME_FILTER); setDateFilterFor(""); }}
      onClose={() => setDateFilterFor("")}/> : null}
  </>;
}

function Pagination({ page, pageSize, totalPages, totalRows, onPage, onPageSize }) {
  if (!totalRows) return null;
  const start = (page - 1) * pageSize + 1, end = Math.min(page * pageSize, totalRows);
  return <div style={styles.paginationBar}>
    <span style={styles.muted}>Showing {start}-{end} of {totalRows} rows</span>
    <div style={styles.paginationControls}>
      <label style={styles.pageSizeLabel}>Rows per page
        <select value={pageSize} onChange={event => onPageSize(Number(event.target.value))} style={styles.pageSizeSelect}>
          {BATCH_GEOFENCE_PAGE_SIZES.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <button type="button" style={styles.plainButton} onClick={() => onPage(1)} disabled={page <= 1}>First</button>
      <button type="button" style={styles.plainButton} onClick={() => onPage(page - 1)} disabled={page <= 1}>Previous</button>
      <span>Page {page} of {totalPages}</span>
      <button type="button" style={styles.plainButton} onClick={() => onPage(page + 1)} disabled={page >= totalPages}>Next</button>
      <button type="button" style={styles.plainButton} onClick={() => onPage(totalPages)} disabled={page >= totalPages}>Last</button>
    </div>
  </div>;
}

const button = { display: "inline-flex", alignItems: "center", minHeight: 36, borderRadius: 10, padding: "0 12px", fontSize: 12, fontWeight: 900, textDecoration: "none", cursor: "pointer" };
const styles = {
  page: { display: "grid", gap: 14, padding: 24, minWidth: 0 },
  backLink: { justifySelf: "start", color: "#2563eb", fontSize: 13, fontWeight: 800, textDecoration: "none" },
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" },
  eyebrow: { margin: 0, color: "#2563eb", fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em" },
  title: { margin: "4px 0 0", color: "#0f172a", fontSize: 30, lineHeight: 1.15 },
  subtitle: { maxWidth: 760, margin: "8px 0 0", color: "#64748b", fontSize: 14, fontWeight: 600, lineHeight: 1.6 },
  headerActions: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start" },
  chooserAnchor: { position: "relative" },
  chooser: { position: "absolute", right: 0, top: 42, zIndex: 20, width: 280, display: "grid", gap: 10, padding: 14, borderRadius: 14, border: "1px solid #cbd5e1", background: "#ffffff", boxShadow: "0 12px 30px rgba(15, 23, 42, 0.18)" },
  chooserHead: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  closeButton: { border: "none", background: "transparent", fontSize: 18, cursor: "pointer", color: "#475569" },
  chooserGroup: { margin: 0, padding: "6px 10px 8px", border: "1px solid #e2e8f0", borderRadius: 10, display: "grid", gap: 4 },
  chooserLegend: { padding: "0 4px", fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em" },
  chooserItem: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#0f172a" },
  chooserActions: { display: "flex", gap: 8, flexWrap: "wrap" },
  linkButton: { ...button, border: "1px solid #cbd5e1", background: "#ffffff", color: "#0f172a" },
  primaryButton: { ...button, border: "1px solid #2563eb", background: "#2563eb", color: "#ffffff", whiteSpace: "nowrap" },
  plainButton: { ...button, border: "1px solid #cbd5e1", background: "#ffffff", color: "#0f172a" },
  toolbar: { display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", color: "#334155", fontSize: 14 },
  toggle: { display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 800 },
  notice: { margin: 0, borderRadius: 14, border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e", padding: 14, fontWeight: 800 },
  error: { margin: 0, borderRadius: 14, border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", padding: 14, fontWeight: 800 },
  paginationBar: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", fontSize: 14, color: "#334155" },
  paginationControls: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  pageSizeLabel: { display: "inline-flex", alignItems: "center", gap: 6 },
  pageSizeSelect: { padding: "4px 6px", borderRadius: 8, border: "1px solid #cbd5e1" },
  tableWrap: { overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 14, background: "#ffffff" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  band: { textAlign: "center", padding: "6px 12px", fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "1px solid #cbd5e1" },
  th: { textAlign: "left", padding: "6px 8px", color: "#0f172a", whiteSpace: "nowrap", borderBottom: "1px solid #e2e8f0" },
  sortButton: { display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid #cbd5e1", borderRadius: 999, background: "#ffffff", padding: "6px 10px", fontSize: 12, fontWeight: 900, cursor: "pointer", whiteSpace: "nowrap" },
  filterCell: { padding: "6px 8px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" },
  filter: { width: "100%", minWidth: 90, boxSizing: "border-box", padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 8 },
  // Rules TB-R044 (1.3.21): alternating shades with a line between rows.
  oddRow: { background: "#ffffff" },
  evenRow: { background: "#f1f5f9" },
  td: { padding: "10px 12px", borderBottom: "1px solid #cbd5e1", color: "#0f172a", verticalAlign: "top" },
  divider: { borderLeft: "3px solid #334155" },
  muted: { color: "#64748b", fontSize: 12 },
};
