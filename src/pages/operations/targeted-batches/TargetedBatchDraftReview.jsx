/* eslint-disable no-unused-vars -- JSX tags are used by React. */
import { useMemo, useState } from "react";
import TargetedBatchDraftTable from "./draft/TargetedBatchDraftTable";
import TargetedBatchDraftSummary from "./draft/TargetedBatchDraftSummary";
import SalesTargetedBatchMap from "../../sales/components/SalesTargetedBatchMap";
import SalesBatchMapLayers, { SalesBatchDrawingControls } from "./draft/sales-batch-map-layers";
import { draftReviewStyles as styles, draftButtonStyle } from "./draft/targetedBatchDraftReviewStyles";
import { normalizeBatchGeometry, pointCoordinates } from "../../../../functions/geofences/sales-batch-geometry.js";
import { classifySalesWorkStatus } from "../../../../functions/salesAllMeters/sales-batch-policy.js";
import { salesDraftMessage } from "./draft/sales-batch-draft-model";
import { salesBatchMapViewport } from "../../../features/maps/sales-batch-map-viewport";
const point = value => { try { const [lng,lat] = pointCoordinates(value); return {lat,lng}; } catch { return null; } };
export default function TargetedBatchDraftReview({ draft, model, live, lmBoundary, drawing, geometry, busy, onRemove, onSave, onCreate, onClear, onResolve, feedback }) {
  const [layers, setLayers] = useState({ erfs: true, premises: true, meters: true, sales: true });
  const [statuses, setStatuses] = useState({ NOT_STARTED: true, IN_PROGRESS: true, COMPLETED: true });
  const mapData = useMemo(() => ({
    erfs: (live?.wardErfs || []).flatMap(erf => { try { return [{ ...erf, geometry: normalizeBatchGeometry(erf.geometry), centroid: point(erf.centroid), erfNo: erf.sg?.parcelNo }]; } catch { return []; } }),
    premises: (live?.premises || []).map(row => ({ ...row, point: point(row.geometry?.centroid) })),
    meters: (live?.meters || []).map(row => {
      const linked = Object.values(live?.sales || {}).find(sales => sales?.master?.id === row.id && sales.master.visibility === "VISIBLE");
      return { ...row, point: point(row.ast?.location?.gps || row.location?.gps || row.gps), state: row.status?.state, type: row.ast?.type || row.type,
        salesWorkStatus: linked ? classifySalesWorkStatus(linked) : null, showSalesWorkStatus: true };
    }),
  }), [live]);
  const ward = model.wards.length === 1 ? live?.wards?.[model.wards[0]] : null;
  const viewport = useMemo(() => salesBatchMapViewport({ ward, lm: lmBoundary }), [ward, lmBoundary]);
  const missingGeometry = (live?.wardErfs?.length || 0) - mapData.erfs.length;
  const missingPoints = [...mapData.premises, ...mapData.meters].filter(row => !row.point).length;
  const showStatus = row => !row.salesWorkStatus || statuses[row.salesWorkStatus];
  return <section style={styles.panel}>
    <header style={styles.header}><div><p style={styles.eyebrow}>Sales Planning</p><h1 style={styles.title}>TB Draft</h1><p>{draft.id}</p></div>
      <div style={styles.headerActions}><button type="button" style={draftButtonStyle(busy)} onClick={onResolve} disabled={busy}>Locate meters again</button><button type="button" style={draftButtonStyle(busy || Boolean(draft.uncertainRequest))} onClick={onClear} disabled={busy || Boolean(draft.uncertainRequest)}>Clear draft</button>
        <button type="button" style={draftButtonStyle(busy || !model.canCreate, true)} onClick={onCreate} disabled={busy || !model.canCreate}>Create</button></div></header>
    <TargetedBatchDraftSummary draft={draft} model={model}/>
    {feedback && <p role="alert" style={styles.integrityPanel}>{salesDraftMessage(feedback)}</p>}
    {!live?.ready && <p role="status" style={styles.sourceNotice}>{salesDraftMessage(live?.error) || "Loading current Sales, ERF, Ward and geofence data…"}</p>}
    <div style={styles.twoPane}><TargetedBatchDraftTable rows={model.rows} disabled={busy || Boolean(draft.uncertainRequest)} onRemove={onRemove}/>
      <div style={styles.pane}><SalesBatchDrawingControls drawing={drawing} saved={Boolean(draft.savedFence)} disabled={busy || !live?.ready || model.wards.length !== 1} canSave={model.canSave} onSave={onSave}/>
        <div style={styles.headerActions}>{Object.keys(layers).map(key => <label key={key}><input type="checkbox" checked={layers[key]} onChange={event => setLayers(current => ({...current,[key]:event.target.checked}))}/>{key === "sales" ? "Retained Sales" : key}</label>)}</div>
        <div style={styles.headerActions} aria-label="Meter status visibility">{Object.keys(statuses).map(status => <label key={status}><input type="checkbox" checked={statuses[status]} onChange={event => setStatuses(current => ({ ...current, [status]: event.target.checked }))}/>{status.replaceAll("_", " ")}</label>)}</div>
        {(missingGeometry > 0 || missingPoints > 0) && <p role="status">Map incomplete: {missingGeometry} ERF geometries and {missingPoints} asset positions are unavailable. All retained meters remain in the table.</p>}
        <SalesTargetedBatchMap erfs={layers.erfs ? mapData.erfs : []} premises={layers.premises ? mapData.premises : []} meters={layers.meters ? mapData.meters.filter(showStatus) : []} hasDraftBoundary={Boolean(ward)} viewport={viewport} fitButtonStyle={draftButtonStyle()} height={560}>
          <SalesBatchMapLayers ward={ward} rows={layers.sales ? model.rows.filter(showStatus) : []} geometry={geometry} points={draft.savedFence ? [] : drawing.points} drawing={drawing.drawing && !draft.savedFence && !busy} addPoint={drawing.addPoint}/>
        </SalesTargetedBatchMap><p style={styles.subtitle}>G = Position from address · S = Sales GPS. Circle / blue = Not Started; triangle / amber = In Progress; square / green = Completed. A thick outline marks a retained meter left out of the batch. Crosses mark ERF centroids; purple is the Ward boundary. Contextual Field Meter icons show ? when linked Sales status is unavailable; these stay visible under status filters.</p>
      </div></div>
  </section>;
}
