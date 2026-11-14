import LoadingIndicator from "../../components/LoadingIndicator";
import { useGetTcUploadsQuery, useAllocateTrnBgoWardBatchesMutation } from "../../redux/tcApi";
import { buildTrnAllocationModel, toggleTrnAllocationSelection } from "./md-bgo/trnAllocationModel";
/* eslint-disable no-unused-vars -- JSX tags are used by React. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";
import { APIProvider, Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import { useAllocateMdBgoBatchesTogetherMutation, useGetBgoBatchesByLmQuery } from "../../redux/bgoApi";
import { useGetGeoFencesByLmQuery } from "../../redux/geofencesApi";
import { useGetWardBoundariesByLmQuery } from "../../redux/mapWardsApi";
import { useGetTargetedBatchAllocationDirectoryQuery } from "../../redux/salesTargetedBatchApi";
import { WardBoundaryPolygons } from "./geofence-map-layers";
import { getGeoFencePath, geoJsonPolygonToGooglePaths, parseGeometry } from "./geofence-map-helpers";
import { getActorMncServiceProviderId, buildTargetPayload } from "./targeted-batches/allocation/targetedBatchAllocationUtils";
import { useMdBgoAllocationSelection } from "./md-bgo/allocationSelection";
import { buildMdBgoAllocationModel, MD_BGO_ALLOCATION_MAX, MD_BGO_ALLOCATION_STATES, mdBgoAllocationFailure, mdBgoAllocationSelection, toggleMdBgoSelection } from "./md-bgo/allocationModel";
import SubmitWindow from "../../components/submit/SubmitWindow.jsx";

const EMPTY = Object.freeze([]);
const COLORS = Object.freeze({ READY: { stroke: "#7c3aed", fill: "#c4b5fd", label: "#5b21b6" }, SELECTED: { stroke: "#3b0764", fill: "#8b5cf6", label: "#3b0764" }, ISSUED: { stroke: "#64748b", fill: "#cbd5e1", label: "#334155" }, UNAVAILABLE: { stroke: "#94a3b8", fill: "#e2e8f0", label: "#64748b" } });
const text = value => String(value ?? "").trim();

function activeLm(auth, geoState) {
  const workbase = auth?.activeWorkbase || auth?.profile?.access?.activeWorkbase || geoState?.selectedLm || {};
  return text(workbase.lmPcode || workbase.pcode || workbase.id || workbase.localMunicipalityId);
}

function LabelOverlayClass() {
  return class AllocationLabelOverlay extends window.google.maps.OverlayView {
    constructor({ point, lines, color, bold }) { super(); Object.assign(this, { point, lines, color, bold, div: null }); }
    onAdd() {
      const div = document.createElement("div"); div.className = "ireps-geofence-label ireps-allocation-label"; div.style.color = this.color; div.style.fontWeight = this.bold ? "800" : "600";
      this.lines.forEach(line => { const row = document.createElement("div"); row.textContent = line; div.appendChild(row); });
      this.div = div; this.getPanes()?.overlayLayer?.appendChild(div);
    }
    draw() { const pixel = this.div && this.getProjection()?.fromLatLngToDivPixel(new window.google.maps.LatLng(this.point)); if (pixel) { this.div.style.left = `${pixel.x}px`; this.div.style.top = `${pixel.y}px`; } }
    onRemove() { this.div?.remove(); this.div = null; }
  };
}

function batchLabelPoint(fence) {
  const path = getGeoFencePath(fence);
  if (!path.length) return null;
  return { lat: path.reduce((sum, point) => sum + Number(point.lat || 0), 0) / path.length, lng: path.reduce((sum, point) => sum + Number(point.lng || 0), 0) / path.length };
}

function MdBgoAllocationPolygons({ items, selectedIds, onToggle }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !window.google?.maps) return undefined;
    const LabelOverlay = LabelOverlayClass(); const shapes = [];
    items.forEach(item => {
      const path = getGeoFencePath(item.fence); if (path.length < 3) return;
      const selected = selectedIds.includes(item.bgoBatchId); const style = COLORS[selected ? "SELECTED" : item.state];
      for (const paths of item.fence.allocationPolygons || [path]) {
      const polygon = new window.google.maps.Polygon({ paths, strokeColor: style.stroke, strokeOpacity: 1, strokeWeight: selected ? 4 : 2,
        fillColor: style.fill, fillOpacity: selected ? 0.5 : 0.34, clickable: item.state === MD_BGO_ALLOCATION_STATES.READY, zIndex: selected ? 80 : 60, map });
      if (item.state === MD_BGO_ALLOCATION_STATES.READY) polygon.addListener("click", () => onToggle(item));
      shapes.push(polygon);
      }
      const point = batchLabelPoint(item.fence);
      if (point) { const overlay = new LabelOverlay({ point, lines: [item.name, `${item.erfCount} ${item.unitLabel || "ERFs"}`, ...(item.state === MD_BGO_ALLOCATION_STATES.ISSUED && item.targetName ? [item.targetName] : [])], color: style.label, bold: selected }); overlay.setMap(map); shapes.push(overlay); }
    });
    return () => shapes.forEach(shape => shape.setMap(null));
  }, [map, items, selectedIds, onToggle]);
  return null;
}

function FitBatches({ items, request }) {
  const map = useMap(); const fitted = useRef("");
  const key = items.map(item => item.bgoBatchId).join(",");
  useEffect(() => {
    const fitKey = `${request}:${key}`; if (!map || !window.google?.maps || !items.length || fitted.current === fitKey) return;
    const bounds = new window.google.maps.LatLngBounds(); items.forEach(item => getGeoFencePath(item.fence).forEach(point => bounds.extend(point)));
    map.fitBounds(bounds, 48); fitted.current = fitKey;
  }, [map, items, request, key]);
  return null;
}

export default function MdBgoAllocationPage({ bulkMode = false }) {
  const registerPath = bulkMode ? "/operations/trn-bgo" : "/operations/bgo";
  const allocationPath = bulkMode ? "/operations/trn-bgo/allocation" : "/operations/bgo/allocation";
  const bulkLabel = bulkMode ? "TRN BGO" : "MD BGO";
  const unitLabel = bulkMode ? "meters" : "ERFs";
  const auth = useAuth(); const { geoState } = useGeo(); const [searchParams] = useSearchParams(); const navigate = useNavigate();
  const lmPcode = activeLm(auth, geoState); const mncId = getActorMncServiceProviderId(auth);
  const { selectedIds: tickedIds, toggle: toggleRegisterTick } = useMdBgoAllocationSelection(bulkMode ? `TRN:${lmPcode}` : lmPcode);
  const mdBatches = useGetBgoBatchesByLmQuery({ lmPcode, limit: 1000 }, { skip: !lmPcode || bulkMode });
  const tcBatches = useGetTcUploadsQuery({ lmPcode, limit: 1000 }, { skip: !lmPcode || !bulkMode });
  const { data: batches = EMPTY, isLoading, error: batchError } = bulkMode ? tcBatches : mdBatches;
  const { data: geofences = EMPTY, isLoading: areGeofencesLoading } = useGetGeoFencesByLmQuery({ lmPcode }, { skip: !lmPcode });
  const { data: lmWards = EMPTY, isLoading: areWardsLoading } = useGetWardBoundariesByLmQuery(lmPcode, { skip: !lmPcode });
  const { data: directory, isLoading: isDirectoryLoading } = useGetTargetedBatchAllocationDirectoryQuery(mncId || skipToken);
  const [allocateTogether] = useAllocateMdBgoBatchesTogetherMutation();
  const [allocateBulk] = useAllocateTrnBgoWardBatchesMutation();
  const [selectedIds, setSelectedIds] = useState(() => text(searchParams.get("batchId")) ? [text(searchParams.get("batchId"))] : []); const [target, setTarget] = useState(null); const [dragTarget, setDragTarget] = useState(null); const [dropFocused, setDropFocused] = useState(false); const [showAll, setShowAll] = useState(false);
  const [fitRequest, setFitRequest] = useState(0); const [message, setMessage] = useState(""); const [windowView, setWindowView] = useState(null); const [busy, setBusy] = useState(false);
  const deepLinkBatch = text(searchParams.get("batchId"));
  const model = useMemo(() => bulkMode ? buildTrnAllocationModel({batches, wards:lmWards}) : buildMdBgoAllocationModel({ batches, geofences }), [batches, geofences, bulkMode, lmWards]);
  const shown = useMemo(() => showAll ? model.items : model.items.filter(item => tickedIds.includes(item.bgoBatchId) || item.bgoBatchId === deepLinkBatch), [model.items, showAll, tickedIds, deepLinkBatch]);
  const selectionIds = selectedIds;
  const selection = useMemo(() => mdBgoAllocationSelection(shown, selectionIds), [shown, selectionIds]);
  const teams = directory?.teams || EMPTY; const serviceProviders = directory?.serviceProviders || EMPTY;
  const locked = busy || Boolean(windowView);

  useEffect(() => {
    const batchId = text(searchParams.get("batchId"));
    if (!batchId || tickedIds.includes(batchId) || !model.items.some(item => item.bgoBatchId === batchId && item.state === MD_BGO_ALLOCATION_STATES.READY)) return;
    // The register's per-batch Allocate link selects and opens the same map flow.
    toggleRegisterTick(batchId);
  }, [searchParams, model.items, tickedIds, toggleRegisterTick]);

  useEffect(() => {
    if (!selection.dropped.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIds(current => current.filter(id => !selection.dropped.includes(id)));
    setMessage(`${selection.dropped.join(", ")} left the allocation window because they are no longer shown or ready.`);
  }, [selection.dropped]);

  const toggle = useCallback(item => {
    setSelectedIds(current => { const next = bulkMode ? toggleTrnAllocationSelection(current,item,model.items) : toggleMdBgoSelection(current, item); setMessage(next.message); return next.ids; });
  }, [bulkMode,model.items]);
  const chooseTarget = candidate => { const value = buildTargetPayload(candidate); if (value) setTarget(value); };
  const handleTargetDrop = event => {
    event.preventDefault(); setDropFocused(false);
    let candidate = dragTarget;
    try { candidate = JSON.parse(event.dataTransfer.getData("application/json")) || candidate; } catch { /* use the dragged target chip */ }
    if (candidate) chooseTarget(candidate);
    setDragTarget(null);
  };
  const allocate = () => { if (!selection.batches || !target || locked || (bulkMode && selection.erfs>200)) return; setWindowView({ kind: "confirm", selection, target }); };
  const confirm = async () => {
    if (windowView?.kind !== "confirm" || busy) return;
    const live = mdBgoAllocationSelection(shown, selectionIds);
    if ((bulkMode && live.erfs>200) || live.items.map(item => item.bgoBatchId).join(",") !== windowView.selection.items.map(item => item.bgoBatchId).join(",")) {
      setWindowView({ kind: "failed", selection: windowView.selection, target: windowView.target, title: "Nothing was allocated", tone: "error", lines: ["The batch selection changed while confirmation was open.", "Review the allocation window and try again."] }); return;
    }
    const { selection: submitted, target: chosen } = windowView; setWindowView({ kind: "allocating", selection: submitted, target: chosen }); setBusy(true);
    try {
      const result = bulkMode ? await allocateBulk({ batchIds: submitted.items.map(item=>item.bgoBatchId), targetType:chosen.type,targetId:chosen.id }).unwrap() : await allocateTogether({ bgoBatchIds: submitted.items.map(item => item.bgoBatchId), targetType: chosen.type, targetId: chosen.id }).unwrap();
      if (result.success === false) throw { data:result };
      setSelectedIds([]); navigate(allocationPath, { replace: true }); setWindowView({ kind: "done", selection: submitted, target: chosen, issuedIds: result.issuedBgoBatchIds || submitted.items.map(item => item.bgoBatchId), targetName: result.target?.name || chosen.name });
    } catch (failure) { setWindowView({ selection: submitted, target: chosen, ...mdBgoAllocationFailure(failure, submitted, chosen) }); }
    finally { setBusy(false); }
  };
  const closeWindow = () => {
    const view = windowView; if (!view || view.kind === "allocating") return;
    if (view.kind === "done") { navigate(registerPath); return; }
    if (view.kind === "failed" || view.kind === "uncertain") setMessage(view.lines?.[0] || view.title);
    setWindowView(null);
  };
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const wards = useMemo(() => lmWards.map(ward => ({ id: ward.wardPcode || ward.id, paths: geoJsonPolygonToGooglePaths(parseGeometry(ward.geometry)) })).filter(ward => ward.paths.length), [lmWards]);
  const allTargets = [...teams.map(item => ({ ...item, type: "TEAM" })), ...serviceProviders.map(item => ({ ...item, type: "SP" }))];

  return <section style={styles.page}>
    <Link to={registerPath} style={styles.back}>← Back to {bulkLabel} Register</Link>
    <header><p style={styles.eyebrow}>Operations / {bulkLabel} Register</p><h1 style={styles.title}>{bulkLabel} Allocation Map</h1>
      <p style={styles.subtitle}>Select ready {bulkLabel} batches on the map and issue their {unitLabel} work items together to one TEAM or SP (up to {MD_BGO_ALLOCATION_MAX} batches).</p></header>
    {areGeofencesLoading || areWardsLoading || isDirectoryLoading ? <LoadingIndicator>Loading allocation map and targets…</LoadingIndicator> : null}
    {model.readyNotOnMap ? <div style={styles.note}>{model.readyNotOnMap} ready batch(es) have no authoritative boundary and are unavailable on this map.</div> : null}
    {batchError ? <div role="alert" style={styles.error}>{batchError?.data?.message || batchError?.message || "MD BGO batches could not be loaded."}</div> : null}
    <div style={styles.layout}>
      <div style={styles.mapPane}>
        <div style={styles.mapBar}><span>{shown.length} shown · {shown.filter(item => item.state === "READY").length} ready · {shown.filter(item => item.state === "ISSUED").length} issued</span>
          <span style={styles.legend}><i style={{ ...styles.swatch, background: COLORS.READY.fill }} />Ready, click to select <i style={{ ...styles.swatch, background: COLORS.SELECTED.fill }} />Selected <i style={{ ...styles.swatch, background: COLORS.ISSUED.fill }} />Issued</span>
          <label><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} /> Show all batches</label>
          <button type="button" style={styles.smallButton} onClick={() => setFitRequest(value => value + 1)}>Fit to map</button>
        </div>
        <div style={styles.map}>{!key ? <p style={styles.status}>Google Maps key missing</p> : isLoading ? <p style={styles.status}><LoadingIndicator>Loading batches…</LoadingIndicator></p> : !shown.length ? <p style={styles.status}>Choose Show all batches, or open allocation from the Register.</p> :
          <APIProvider apiKey={key}><GoogleMap defaultCenter={{ lat: -28.16, lng: 30.23 }} defaultZoom={12} gestureHandling="greedy" style={{ width: "100%", height: "100%" }}>
            <WardBoundaryPolygons wards={wards} /><MdBgoAllocationPolygons items={shown} selectedIds={selectedIds} onToggle={toggle} /><FitBatches items={shown} request={fitRequest} />
          </GoogleMap></APIProvider>}</div>
      </div>
      <aside style={styles.window}>
        <h2 style={styles.windowTitle}>Allocation window</h2>
        <p style={styles.totals}>{selection.batches ? `${selection.batches} batch(es) · ${selection.erfs} ${unitLabel} · ${selection.wards.join(", ")}` : "Click ready geofences on the map to add them here."}</p>
        {bulkMode && <p style={styles.totals}>Maximum 15 Ward batches and 200 meters per allocation.</p>}
        <ul style={styles.list}>{selection.items.map(item => <li key={item.bgoBatchId} style={styles.listItem}><span><strong>{item.name}</strong><small>{item.wardLabel} · {item.erfCount} {unitLabel} · {item.bgoBatchId}</small></span><button type="button" disabled={locked} onClick={() => toggle(item)} aria-label={`Remove ${item.name}`}>×</button></li>)}</ul>
        <div style={{ ...styles.dropZone, ...(dropFocused ? styles.dropFocused : {}) }} onDragOver={event => { event.preventDefault(); setDropFocused(true); }} onDragLeave={() => setDropFocused(false)} onDrop={handleTargetDrop}>
          {target ? <>Issuing to <strong>{target.name}</strong> ({target.type}) <button type="button" disabled={locked} onClick={() => setTarget(null)}>change</button></> : "Drag a TEAM or SP here, or click one below."}
        </div>
        <div style={styles.targets}>{allTargets.map(candidate => { const value = buildTargetPayload(candidate); if (!value) return null; const chosen = target?.type === value.type && target?.id === value.id; return <button key={`${value.type}:${value.id}`} type="button" disabled={locked} draggable={!locked} onDragStart={event => { setDragTarget(value); event.dataTransfer.setData("application/json", JSON.stringify(value)); event.dataTransfer.effectAllowed = "copy"; }} onDragEnd={() => { setDragTarget(null); setDropFocused(false); }} onClick={() => chooseTarget(candidate)} style={{ ...styles.target, ...(chosen ? styles.targetChosen : {}) }}><strong>{value.name}</strong><small>{value.type}</small></button>; })}</div>
        {message ? <p role="status" style={styles.message}>{message}</p> : null}
        <button type="button" disabled={!selection.batches || !target || locked || (bulkMode && selection.erfs>200)} style={{ ...styles.allocate, ...(!selection.batches || !target || locked ? styles.disabled : {}) }} onClick={allocate}>{busy ? "Issuing…" : !selection.batches ? "Select batches on the map" : !target ? "Choose a TEAM or SP" : `Issue ${selection.batches} batch(es) · ${selection.erfs} ${unitLabel} to ${target.name}`}</button>
      </aside>
    </div>
    <AllocationWindow view={windowView} onConfirm={confirm} onClose={closeWindow} />
  </section>;
}

function AllocationWindow({ view, onConfirm, onClose }) {
  const unitLabel = view?.selection?.items?.[0]?.unitLabel || "ERFs";
  if (!view) return null;
  const { selection, target } = view;
  const rows = <ul style={styles.modalList}>{selection.items.map(item => <li key={item.bgoBatchId}><strong>{item.name}</strong><small>{item.wardLabel} · {item.erfCount} {unitLabel} · {item.bgoBatchId}</small></li>)}</ul>;
  if (view.kind === "confirm") return <SubmitWindow title={`Issue ${selection.batches} batch(es) to ${target.name}`} escapeAction={onClose} lines={[`The selected ${selection.items[0]?.unitLabel === "meters" ? "TRN BGO" : "MD BGO"} batches will be issued to ${target.type === "TEAM" ? "TEAM" : "SP"} ${target.name}.`]} actions={[{ label: "Issue batches", primary: true, onClick: onConfirm }, { label: "Cancel", onClick: onClose }]}>{rows}<p style={styles.modalNote}>All selected batches are validated and issued together, or none are changed.</p></SubmitWindow>;
  if (view.kind === "allocating") return <SubmitWindow title={`Issuing batches to ${target.name}…`} working lines={[`${selection.batches} batch(es) · ${selection.erfs} ${unitLabel}`, "Please wait while iREPS validates and issues the complete selection."]} />;
  if (view.kind === "done") return <SubmitWindow title={`${view.issuedIds.length} batch(es) issued to ${view.targetName}`} escapeAction={onClose} lines={["They now wait for the assigned TEAM or SP to accept them."]} actions={[{ label: "OK", primary: true, onClick: onClose }]}>{rows}</SubmitWindow>;
  return <SubmitWindow title={view.title} tone={view.tone} escapeAction={onClose} lines={view.lines} actions={[{ label: "OK", primary: true, onClick: onClose }]} />;
}

const styles = {
  page: { display: "grid", gap: 14 }, back: { color: "#2563eb", fontWeight: 800, fontSize: 13, textDecoration: "none" },
  eyebrow: { margin: 0, color: "#2563eb", fontSize: 12, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }, title: { margin: "4px 0 0", color: "#0f172a", fontSize: 30 }, subtitle: { maxWidth: 900, margin: "8px 0 0", color: "#64748b", fontSize: 14, lineHeight: 1.6 },
  note: { border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e", borderRadius: 12, padding: 12 }, error: { color: "#991b1b", background: "#fef2f2", padding: 12, borderRadius: 10 },
  layout: { display: "grid", gridTemplateColumns: "minmax(0, 1.7fr) minmax(300px, 1fr)", gap: 14, alignItems: "start" }, mapPane: { display: "grid", gap: 8, border: "1px solid #dbe4f0", borderRadius: 16, padding: 12, background: "#fff" },
  mapBar: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, justifyContent: "space-between", fontSize: 13, color: "#334155", fontWeight: 700 }, legend: { display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontWeight: 600 }, swatch: { width: 12, height: 12, border: "1px solid #64748b", display: "inline-block" }, smallButton: { border: "1px solid #cbd5e1", borderRadius: 999, padding: "5px 10px", background: "#fff", color: "#1d4ed8", fontWeight: 800 }, map: { height: 620, borderRadius: 12, overflow: "hidden", background: "#f1f5f9" }, status: { display: "grid", placeItems: "center", height: "100%", color: "#475569" },
  window: { display: "flex", flexDirection: "column", gap: 10, border: "1px solid #dbe4f0", borderRadius: 16, padding: 14, background: "#fff", position: "sticky", top: 12, maxHeight: "calc(100vh - 24px)", boxSizing: "border-box", overflow: "hidden" }, windowTitle: { margin: 0, fontSize: 18 }, totals: { margin: 0, color: "#334155", fontSize: 13, fontWeight: 700 }, list: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6, maxHeight: 260, overflowY: "auto" }, listItem: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, border: "1px solid #e2e8f0", borderRadius: 10, padding: "6px 10px", fontSize: 13 },
  dropZone: { border: "2px dashed #93c5fd", borderRadius: 10, padding: 10, color: "#1d4ed8", fontSize: 13, background: "#eff6ff" }, dropFocused: { borderColor: "#2563eb", boxShadow: "0 0 0 3px #bfdbfe" }, targets: { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6, overflowY: "auto", minHeight: 100 }, target: { display: "flex", justifyContent: "space-between", gap: 8, border: "1px solid #bfdbfe", borderRadius: 10, padding: 8, background: "#eff6ff", color: "#1e3a8a", textAlign: "left", cursor: "grab" }, targetChosen: { borderColor: "#1d4ed8", background: "#dbeafe", boxShadow: "0 0 0 2px #93c5fd" }, message: { margin: 0, color: "#166534", fontSize: 13, fontWeight: 700 }, allocate: { border: 0, borderRadius: 12, padding: 12, background: "#2563eb", color: "#fff", fontWeight: 900, cursor: "pointer" }, disabled: { background: "#94a3b8", cursor: "not-allowed" }, modalList: { listStyle: "none", display: "grid", gap: 6, padding: 0, maxHeight: 260, overflowY: "auto" }, modalNote: { color: "#334155", fontSize: 13 },
};
