/* eslint-disable no-unused-vars -- JSX tags are used by React. */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../auth/useAuth";
import { useSalesReadScope } from "../../redux/salesApi";
import { useGetPermanentSalesBatchesQuery } from "../../redux/salesTargetedBatchApi";
import { useGetGeoFencesByLmQuery } from "../../redux/mapGeofencesApi";
import { prepareTargetedBatchDraft, saveSalesDraftFence, selectTargetedBatchDraft } from "../../redux/targetedBatchDraftSlice";
import { BATCH_GEOFENCE_STATUS, buildBatchGeofenceRows, isBatchGeofenceGap, salesDraftForGeofence } from "./models/batchGeofenceModel.js";
import { getActiveLmPcode, getActiveWorkbaseName } from "./salesUtils";

// Targeted Batch rules TB-R044: every batch with its geofence and every geofence with its batch.
const COLUMNS = [
  ["status", "Status", row => row.status],
  ["batchId", "Batch ID", row => row.batch?.id || (row.plannedBatchId ? `${row.plannedBatchId} (not created)` : "")],
  ["batchCreated", "Batch created", row => shortDate(row.batch?.createdAt)],
  ["batchBy", "Batch by", row => row.batch?.createdBy || ""],
  ["batchMeters", "Batch meters", row => row.batch ? String(row.batch.meters ?? "") : ""],
  ["source", "Source", row => row.batch?.source || ""],
  ["geofence", "Geofence", row => row.geofence?.name || ""],
  ["kind", "Kind", row => row.geofence?.kind || ""],
  ["geofenceCreated", "Geofence created", row => shortDate(row.geofence?.createdAt)],
  ["geofenceBy", "Geofence by", row => row.geofence?.createdBy || ""],
  ["savedFor", "Meters it was saved for", row => row.geofence?.batchMeters != null ? String(row.geofence.batchMeters) : ""],
  ["salesMeters", "Sales meters in it", row => row.geofence?.salesMeters != null ? String(row.geofence.salesMeters) : ""],
  ["assets", "Assets in it", row => row.geofence?.assets != null ? String(row.geofence.assets) : ""],
];
function shortDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("en-ZA", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
const STATUS_COLORS = { [BATCH_GEOFENCE_STATUS.LINKED]: "#166534", [BATCH_GEOFENCE_STATUS.NO_GEOFENCE]: "#b45309", [BATCH_GEOFENCE_STATUS.BATCH_NOT_CREATED]: "#b91c1c",
  [BATCH_GEOFENCE_STATUS.BATCH_REMOVED]: "#64748b", [BATCH_GEOFENCE_STATUS.AREA]: "#475569" };

export default function BatchesGeofencesPage() {
  const { activeWorkbase, uid } = useAuth();
  const lmPcode = getActiveLmPcode(activeWorkbase) || "", lmName = getActiveWorkbaseName(activeWorkbase);
  const readScope = useSalesReadScope(lmPcode);
  const dispatch = useDispatch(), navigate = useNavigate(), openDraft = useSelector(selectTargetedBatchDraft);
  const { data: permanent } = useGetPermanentSalesBatchesQuery({ lmPcode }, { skip: !lmPcode });
  const { data: geofences, isLoading: geofencesLoading } = useGetGeoFencesByLmQuery(lmPcode, { skip: !lmPcode });
  const rows = useMemo(() => buildBatchGeofenceRows({ batches: permanent?.batches || [], geofences: geofences || [], uid }), [permanent?.batches, geofences, uid]);
  const [filters, setFilters] = useState({}), [gapsOnly, setGapsOnly] = useState(false);
  const [opening, setOpening] = useState(""), [message, setMessage] = useState("");
  const visible = rows.filter(row => (!gapsOnly || isBatchGeofenceGap(row))
    && COLUMNS.every(([key, , value]) => !filters[key] || value(row).toLowerCase().includes(filters[key].toLowerCase())));
  const gaps = rows.filter(isBatchGeofenceGap).length;
  const loading = Boolean(lmPcode) && ((!permanent?.ready && !permanent?.error) || geofencesLoading);

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
    <section style={styles.header}>
      <div>
        <p style={styles.eyebrow}>Sales Planning</p>
        <h1 style={styles.title}>Batches &amp; Geofences</h1>
        <p style={styles.subtitle}>{lmPcode || "NAv"} · {lmName} · Every batch with its geofence and every geofence with its batch. A blank side is a gap.</p>
      </div>
      <div style={styles.headerActions}>
        <Link to="/sales/table" style={styles.linkButton}>GPS Sales Table</Link>
        <Link to="/sales/non-gps-batch-planning" style={styles.linkButton}>Non-GPS Sales Table</Link>
      </div>
    </section>
    {!lmPcode ? <p style={styles.notice}>Activate a Local Municipality workbase first.</p> : null}
    {permanent?.error ? <p role="alert" style={styles.error}>Couldn't load the batches: {permanent.error}</p> : null}
    {message ? <p role="alert" style={styles.error}>{message}</p> : null}
    <section style={styles.toolbar}>
      <span><strong>{rows.length}</strong> rows · <strong>{gaps}</strong> gaps</span>
      <label style={styles.toggle}><input type="checkbox" checked={gapsOnly} onChange={event => setGapsOnly(event.target.checked)}/> Gaps only</label>
      <button type="button" style={styles.plainButton} onClick={() => { setFilters({}); setGapsOnly(false); }}>Clear All Filters</button>
      {loading ? <span role="status">Loading batches and geofences…</span> : null}
    </section>
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>{COLUMNS.map(([key, label]) => <th key={key} style={styles.th}>{label}</th>)}<th style={styles.th}>Action</th></tr>
          <tr>{COLUMNS.map(([key, label]) => <th key={key} style={styles.filterCell}>
            <input aria-label={`Filter ${label}`} style={styles.filter} value={filters[key] || ""} onChange={event => setFilters(current => ({ ...current, [key]: event.target.value }))}/>
          </th>)}<th style={styles.filterCell}/></tr>
        </thead>
        <tbody>
          {visible.map(row => <tr key={row.key}>
            {COLUMNS.map(([key, , value]) => <td key={key} style={key === "status" ? { ...styles.td, color: STATUS_COLORS[row.status], fontWeight: 800 } : styles.td}>{value(row)}</td>)}
            <td style={styles.td}>
              {row.canCreateBatch ? <button type="button" style={styles.primaryButton} disabled={Boolean(opening)} onClick={() => createItsBatch(row)}>
                {opening === row.key ? "Opening TB Draft…" : "Create its batch"}</button> : <span style={styles.muted}>{row.note}</span>}
            </td>
          </tr>)}
          {!visible.length && !loading ? <tr><td style={styles.td} colSpan={COLUMNS.length + 1}>No rows match.</td></tr> : null}
        </tbody>
      </table>
    </div>
  </div>;
}

const button = { display: "inline-flex", alignItems: "center", minHeight: 36, borderRadius: 10, padding: "0 12px", fontSize: 12, fontWeight: 900, textDecoration: "none", cursor: "pointer" };
const styles = {
  page: { display: "grid", gap: 16, padding: 24, minWidth: 0 },
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" },
  eyebrow: { margin: 0, color: "#2563eb", fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em" },
  title: { margin: "4px 0 0", color: "#0f172a", fontSize: 30, lineHeight: 1.15 },
  subtitle: { maxWidth: 760, margin: "8px 0 0", color: "#64748b", fontSize: 14, fontWeight: 600, lineHeight: 1.6 },
  headerActions: { display: "flex", gap: 10, flexWrap: "wrap" },
  linkButton: { ...button, border: "1px solid #cbd5e1", background: "#ffffff", color: "#0f172a" },
  primaryButton: { ...button, border: "1px solid #2563eb", background: "#2563eb", color: "#ffffff", whiteSpace: "nowrap" },
  plainButton: { ...button, border: "1px solid #cbd5e1", background: "#ffffff", color: "#0f172a" },
  toolbar: { display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", color: "#334155", fontSize: 14 },
  toggle: { display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 800 },
  notice: { margin: 0, borderRadius: 14, border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e", padding: 14, fontWeight: 800 },
  error: { margin: 0, borderRadius: 14, border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", padding: 14, fontWeight: 800 },
  tableWrap: { overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 14, background: "#ffffff" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "10px 12px", background: "#f1f5f9", color: "#0f172a", fontWeight: 900, whiteSpace: "nowrap", borderBottom: "1px solid #e2e8f0" },
  filterCell: { padding: "6px 8px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" },
  filter: { width: "100%", minWidth: 90, boxSizing: "border-box", padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 8 },
  td: { padding: "10px 12px", borderBottom: "1px solid #f1f5f9", color: "#0f172a", verticalAlign: "top" },
  muted: { color: "#64748b", fontSize: 12 },
};
