import LoadingIndicator from "../../components/LoadingIndicator";
import { useGetTcUploadsQuery, useGetTcRowsByTcIdQuery, useGetTrnBgoProgressQuery, useAllocateTrnBgoWardBatchesMutation } from "../../redux/tcApi";
import { buildTrnAllocationMeterPins, buildTrnAllocationModel } from "./md-bgo/trnAllocationModel";
/* eslint-disable no-unused-vars -- JSX tags are used by React. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";
import { APIProvider, InfoWindow, Map as GoogleMap, Marker, useMap } from "@vis.gl/react-google-maps";

import { db } from "../../firebase";
import { useAuth } from "../../auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import { useAllocateMdBgoBatchesTogetherMutation, useGetBgoBatchesByLmQuery } from "../../redux/bgoApi";
import { useGetGeoFencesByLmQuery } from "../../redux/geofencesApi";
import { useGetWardBoundariesByLmQuery } from "../../redux/mapWardsApi";
import { useGetTargetedBatchAllocationDirectoryQuery } from "../../redux/salesTargetedBatchApi";
import { subscribeTrnBgoMap } from "./md-bgo/trnBgoMapStream.js";
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

function FitMeterPins({ pins, selectedBatchId, request, wards }) {
  const map = useMap();
  const fitted = useRef("");
  const pinKey = pins.map((p) => `${p.id}:${p.position.lat.toFixed(5)},${p.position.lng.toFixed(5)}`).join("|");
  useEffect(() => {
    if (!map || !window.google?.maps) return;
    const fitKey = `${selectedBatchId}:${request}:${pinKey}`;
    if (fitted.current === fitKey) return;
    if (pins.length === 1) {
      map.panTo(pins[0].position);
      map.setZoom(17);
      fitted.current = fitKey;
      return;
    }
    if (pins.length > 1) {
      const bounds = new window.google.maps.LatLngBounds();
      pins.forEach((p) => bounds.extend(p.position));
      map.fitBounds(bounds, 64);
      fitted.current = fitKey;
      return;
    }
    if (!selectedBatchId && wards.length) {
      const bounds = new window.google.maps.LatLngBounds();
      wards.forEach((w) => (w.paths?.[0] || []).forEach((pt) => bounds.extend(pt)));
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, 40);
        fitted.current = fitKey;
      }
    }
  }, [map, pins, selectedBatchId, request, pinKey, wards]);
  return null;
}

function TrnMeterPins({ pins, selectedPin, onSelectPin }) {
  return (
    <>
      {pins.map((pin) => (
        <Marker
          key={pin.id}
          position={pin.position}
          title={`${pin.meterNo} · ${pin.meterStatus}`}
          onClick={() => onSelectPin(pin)}
        />
      ))}
      {selectedPin ? (
        <InfoWindow position={selectedPin.position} onCloseClick={() => onSelectPin(null)}>
          <div style={{ display: "grid", gap: 4, fontSize: 12, color: "#0f172a", minWidth: 180 }}>
            <strong style={{ fontSize: 13 }}>Meter {selectedPin.meterNo}</strong>
            <div><span style={{ color: "#64748b" }}>State:</span> <strong>{selectedPin.meterStatus}</strong></div>
            <div><span style={{ color: "#64748b" }}>Erf No:</span> {selectedPin.erfNo}</div>
            <div><span style={{ color: "#64748b" }}>Address:</span> {selectedPin.address}</div>
          </div>
        </InfoWindow>
      ) : null}
    </>
  );
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
  const [bbFilter, setBbFilter] = useState("ALL"); const [bbSearch, setBbSearch] = useState(""); const [activePin, setActivePin] = useState(null);
  const [fitRequest, setFitRequest] = useState(0); const [message, setMessage] = useState(""); const [windowView, setWindowView] = useState(null); const [busy, setBusy] = useState(false);
  const deepLinkBatch = text(searchParams.get("batchId"));
  const bulkBatchIds = useMemo(
    () => (bulkMode ? batches.filter((b) => b?.contractVersion && b?.id).map((b) => b.id).sort() : EMPTY),
    [bulkMode, batches],
  );
  const { currentData: trnProgress = {} } = useGetTrnBgoProgressQuery(
    { batchIds: bulkBatchIds },
    { skip: !bulkMode || !bulkBatchIds.length },
  );
  const model = useMemo(
    () => (bulkMode ? buildTrnAllocationModel({ batches, wards: lmWards, progressByBatchId: trnProgress }) : buildMdBgoAllocationModel({ batches, geofences })),
    [batches, geofences, bulkMode, lmWards, trnProgress],
  );
  const selectedBulkBatchId = bulkMode ? (selectedIds[0] || "") : "";
  const selectedBulkItem = useMemo(() => (bulkMode && selectedBulkBatchId ? model.items.find((item) => item.bgoBatchId === selectedBulkBatchId) || null : null), [bulkMode, selectedBulkBatchId, model.items]);
  const { data: bulkTcRows = EMPTY, isLoading: isBulkRowsLoading } = useGetTcRowsByTcIdQuery(selectedBulkBatchId, { skip: !bulkMode || !selectedBulkBatchId });
  const [bulkMapState, setBulkMapState] = useState(null);
  useEffect(() => {
    if (!bulkMode || !selectedBulkBatchId || !lmPcode) return undefined;
    return subscribeTrnBgoMap(db, { batchId: selectedBulkBatchId, lmPcode }, (value) => {
      setBulkMapState({ ...value, batchId: selectedBulkBatchId });
    });
  }, [bulkMode, selectedBulkBatchId, lmPcode]);
  const activeBulkMap = bulkMapState?.batchId === selectedBulkBatchId ? bulkMapState : null;
  const bulkMapReady = Boolean(activeBulkMap?.ready) && !isBulkRowsLoading;
  const meterPins = useMemo(
    () =>
      bulkMode && selectedBulkBatchId
        ? buildTrnAllocationMeterPins({
            rawRows: bulkTcRows,
            asts: activeBulkMap?.meters || EMPTY,
            premises: activeBulkMap?.premises || EMPTY,
            erfs: activeBulkMap?.erfs || EMPTY,
          })
        : EMPTY,
    [bulkMode, selectedBulkBatchId, bulkTcRows, activeBulkMap],
  );
  const bbRows = useMemo(() => {
    if (!bulkMode) return EMPTY;
    const q = bbSearch.trim().toLowerCase();
    return model.items.filter((item) => {
      if (bbFilter === "READY" && item.state !== "READY") return false;
      if (bbFilter === "ALLOCATED" && item.state !== "ISSUED") return false;
      if (!q) return true;
      return `${item.bgoBatchId} ${item.allocatedTo} ${item.wardLabel}`.toLowerCase().includes(q);
    });
  }, [bulkMode, model.items, bbFilter, bbSearch]);
  const shown = useMemo(() => showAll ? model.items : model.items.filter(item => tickedIds.includes(item.bgoBatchId) || item.bgoBatchId === deepLinkBatch), [model.items, showAll, tickedIds, deepLinkBatch]);
  const selectionIds = selectedIds;
  const selection = useMemo(() => {
    if (!bulkMode) return mdBgoAllocationSelection(shown, selectionIds);
    const items = selectedBulkItem ? [selectedBulkItem] : [];
    const erfs = items.reduce((sum, item) => sum + Number(item.erfCount || 0), 0);
    const wardsSet = [...new Set(items.map((item) => item.wardLabel).filter(Boolean))];
    return { items, batches: items.length, erfs, wards: wardsSet, dropped: [] };
  }, [bulkMode, shown, selectionIds, selectedBulkItem]);
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

  const selectBulkBatch = useCallback((item) => {
    if (!item?.bgoBatchId) return;
    setSelectedIds([item.bgoBatchId]);
    setActivePin(null);
    setMessage(
      item.fieldworkStarted
        ? `${item.bgoBatchId}: field work has started; re-allocation is disabled.`
        : "",
    );
  }, []);
  const toggle = useCallback(item => {
    if (bulkMode) {
      setSelectedIds((current) => (current[0] === item.bgoBatchId ? [] : [item.bgoBatchId]));
      setActivePin(null);
      return;
    }
    setSelectedIds(current => { const next = toggleMdBgoSelection(current, item); setMessage(next.message); return next.ids; });
  }, [bulkMode]);
  const chooseTarget = candidate => { const value = buildTargetPayload(candidate); if (value) setTarget(value); };
  const handleTargetDrop = event => {
    event.preventDefault(); setDropFocused(false);
    let candidate = dragTarget;
    try { candidate = JSON.parse(event.dataTransfer.getData("application/json")) || candidate; } catch { /* use the dragged target chip */ }
    if (candidate) chooseTarget(candidate);
    setDragTarget(null);
  };
  const allocate = () => {
    if (!selection.batches || !target || locked) return;
    if (bulkMode && (selection.erfs > 200 || !selectedBulkItem?.canAllocate)) return;
    setWindowView({ kind: "confirm", selection, target });
  };
  const confirm = async () => {
    if (windowView?.kind !== "confirm" || busy) return;
    const live = bulkMode ? selection : mdBgoAllocationSelection(shown, selectionIds);
    if ((bulkMode && (live.erfs > 200 || !selectedBulkItem?.canAllocate)) || live.items.map(item => item.bgoBatchId).join(",") !== windowView.selection.items.map(item => item.bgoBatchId).join(",")) {
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
        <div style={styles.mapBar}>
          {bulkMode ? (
            <>
              <span>{model.items.length} batches · {model.counts.ready} ready · {model.counts.issued} allocated{selectedBulkBatchId ? ` · ${meterPins.length} meter(s) on map` : ""}</span>
              <button type="button" style={styles.smallButton} onClick={() => setFitRequest(value => value + 1)}>Fit to map</button>
            </>
          ) : (
            <>
              <span>{shown.length} shown · {shown.filter(item => item.state === "READY").length} ready · {shown.filter(item => item.state === "ISSUED").length} issued</span>
              <span style={styles.legend}><i style={{ ...styles.swatch, background: COLORS.READY.fill }} />Ready, click to select <i style={{ ...styles.swatch, background: COLORS.SELECTED.fill }} />Selected <i style={{ ...styles.swatch, background: COLORS.ISSUED.fill }} />Issued</span>
              <label><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} /> Show all batches</label>
              <button type="button" style={styles.smallButton} onClick={() => setFitRequest(value => value + 1)}>Fit to map</button>
            </>
          )}
        </div>
        <div style={styles.map}>{!key ? <p style={styles.status}>Google Maps key missing</p> : isLoading ? <p style={styles.status}><LoadingIndicator>Loading batches…</LoadingIndicator></p> : !bulkMode && !shown.length ? <p style={styles.status}>Choose Show all batches, or open allocation from the Register.</p> :
          <>
            <APIProvider apiKey={key}><GoogleMap defaultCenter={{ lat: -28.16, lng: 30.23 }} defaultZoom={12} gestureHandling="greedy" style={{ width: "100%", height: "100%" }}>
              <WardBoundaryPolygons wards={wards} />
              {bulkMode ? (
                <>
                  <TrnMeterPins pins={meterPins} selectedPin={activePin} onSelectPin={setActivePin} />
                  <FitMeterPins pins={meterPins} selectedBatchId={selectedBulkBatchId} request={fitRequest} wards={wards} />
                </>
              ) : (
                <>
                  <MdBgoAllocationPolygons items={shown} selectedIds={selectedIds} onToggle={toggle} />
                  <FitBatches items={shown} request={fitRequest} />
                </>
              )}
            </GoogleMap></APIProvider>
            {bulkMode && selectedBulkBatchId && !bulkMapReady ? (
              <div style={styles.mapOverlay} role="status" aria-live="polite">
                <LoadingIndicator>Loading meter locations…</LoadingIndicator>
              </div>
            ) : null}
          </>}</div>
        {bulkMode && selectedBulkBatchId && bulkMapReady && !meterPins.length ? (
          <p style={styles.note}>No meter GPS coordinates found for {selectedBulkBatchId}.</p>
        ) : null}
      </div>
      <div style={styles.sidebar}>
        <aside style={styles.window}>
          <h2 style={styles.windowTitle}>Allocation window</h2>
          <p style={styles.totals}>
            {selection.batches
              ? `${selection.batches} batch · ${selection.erfs} ${unitLabel} · ${selection.wards.join(", ")}`
              : bulkMode
                ? "Select a batch from Batches below."
                : "Click ready geofences on the map to add them here."}
          </p>
          {bulkMode && <p style={styles.totals}>Select 1 batch at a time (maximum 200 meters per allocation).</p>}
          <ul style={styles.list}>
            {selection.items.map((item) => (
              <li key={item.bgoBatchId} style={styles.listItem}>
                <span style={styles.listItemText}>
                  <strong style={styles.listItemTitle}>{item.name}</strong>
                  <small style={styles.listItemMeta}>
                    {`Ward ${item.wardLabel} · ${item.erfCount} ${unitLabel}`}
                    {item.allocatedTo && item.allocatedTo !== "Unallocated" ? ` · ${item.allocatedTo}` : ""}
                  </small>
                </span>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => toggle(item)}
                  aria-label={`Remove ${item.name}`}
                  style={styles.removeBtn}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div style={{ ...styles.dropZone, ...(dropFocused ? styles.dropFocused : {}) }} onDragOver={event => { event.preventDefault(); setDropFocused(true); }} onDragLeave={() => setDropFocused(false)} onDrop={handleTargetDrop}>
            {target ? (
              <span style={styles.dropZoneAssigned}>
                <span>Issuing to <strong>{target.name}</strong> ({target.type})</span>
                <button type="button" disabled={locked} onClick={() => setTarget(null)} style={styles.changeBtn}>
                  change
                </button>
              </span>
            ) : "Drag a TEAM or SP here, or click one below."}
          </div>
          <div style={styles.targets}>{allTargets.map(candidate => { const value = buildTargetPayload(candidate); if (!value) return null; const chosen = target?.type === value.type && target?.id === value.id; return <button key={`${value.type}:${value.id}`} type="button" disabled={locked} draggable={!locked} onDragStart={event => { setDragTarget(value); event.dataTransfer.setData("application/json", JSON.stringify(value)); event.dataTransfer.effectAllowed = "copy"; }} onDragEnd={() => { setDragTarget(null); setDropFocused(false); }} onClick={() => chooseTarget(candidate)} style={{ ...styles.target, ...(chosen ? styles.targetChosen : {}) }}><strong>{value.name}</strong><small>{value.type}</small></button>; })}</div>
          {message ? <p role="status" style={selectedBulkItem?.fieldworkStarted ? styles.warnMessage : styles.message}>{message}</p> : null}
          <button
            type="button"
            disabled={!selection.batches || !target || locked || (bulkMode && (selection.erfs > 200 || !selectedBulkItem?.canAllocate))}
            style={{ ...styles.allocate, ...((!selection.batches || !target || locked || (bulkMode && (selection.erfs > 200 || !selectedBulkItem?.canAllocate))) ? styles.disabled : {}) }}
            onClick={allocate}
          >
            {busy
              ? "Issuing…"
              : !selection.batches
                ? (bulkMode ? "Select a batch below" : "Select batches on the map")
                : (bulkMode && selectedBulkItem?.fieldworkStarted)
                  ? "Field work started (cannot re-allocate)"
                  : !target
                    ? "Choose a TEAM or SP"
                    : `${selectedBulkItem?.state === "ISSUED" ? "Re-allocate" : "Issue"} ${selection.batches} batch(es) · ${selection.erfs} ${unitLabel} to ${target.name}`}
          </button>
        </aside>

        {bulkMode ? (
          <section style={styles.batchesBox} aria-label="Batches">
            <div style={styles.bbHeader}>
              <h3 style={styles.bbTitle}>Batches ({bbRows.length})</h3>
              <div style={styles.bbPills}>
                {[["ALL", "All"], ["READY", "Ready"], ["ALLOCATED", "Allocated"]].map(([keyVal, label]) => (
                  <button
                    key={keyVal}
                    type="button"
                    onClick={() => setBbFilter(keyVal)}
                    style={{ ...styles.bbPill, ...(bbFilter === keyVal ? styles.bbPillActive : {}) }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <input
              type="search"
              value={bbSearch}
              onChange={(e) => setBbSearch(e.target.value)}
              placeholder="Search batch ID or allocated target..."
              style={styles.bbSearch}
            />
            <div style={styles.bbTableWrap}>
              <table style={styles.bbTable}>
                <thead>
                  <tr>
                    <th style={styles.bbTh} aria-label="Select" />
                    <th style={styles.bbTh}>Batch ID</th>
                    <th style={{ ...styles.bbTh, textAlign: "right" }}>Meters</th>
                    <th style={styles.bbTh}>Allocated To</th>
                    <th style={{ ...styles.bbTh, textAlign: "center", width: 42 }}>St</th>
                  </tr>
                </thead>
                <tbody>
                  {bbRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ ...styles.bbTd, textAlign: "center", color: "#64748b" }}>
                        No matching TRN BGO batches.
                      </td>
                    </tr>
                  ) : (
                    bbRows.map((item) => {
                      const isSelected = selectedBulkBatchId === item.bgoBatchId;
                      const isUnavailable = !item.canAllocate;
                      const statusIcon = item.workStatus === "COMPLETED" ? "✓" : item.workStatus === "IN_PROGRESS" ? "◐" : "○";
                      const statusStyle =
                        item.workStatus === "COMPLETED"
                          ? styles.bbStatusCp
                          : item.workStatus === "IN_PROGRESS"
                            ? styles.bbStatusIp
                            : styles.bbStatusNs;
                      return (
                        <tr
                          key={item.bgoBatchId}
                          onClick={() => selectBulkBatch(item)}
                          style={{
                            ...styles.bbRow,
                            ...(isUnavailable ? styles.bbRowDisabled : {}),
                            ...(isSelected ? styles.bbRowSelected : {}),
                          }}
                        >
                          <td style={styles.bbTd}>
                            <input
                              type="radio"
                              name="trn-bgo-bb-select"
                              checked={isSelected}
                              onChange={() => selectBulkBatch(item)}
                              aria-label={`Select ${item.bgoBatchId}`}
                            />
                          </td>
                          <td style={{ ...styles.bbTd, fontWeight: 700, wordBreak: "break-all", color: isUnavailable ? "#64748b" : "#0f172a" }}>{item.bgoBatchId}</td>
                          <td style={{ ...styles.bbTd, textAlign: "right", fontWeight: 700, color: isUnavailable ? "#64748b" : "#0f172a" }}>{item.erfCount}</td>
                          <td style={{ ...styles.bbTd, color: isUnavailable ? "#64748b" : item.allocatedTo === "Unallocated" ? "#64748b" : "#166534", fontWeight: 600 }}>
                            {item.allocatedTo}
                          </td>
                          <td style={{ ...styles.bbTd, textAlign: "center" }}>
                            <span
                              title={item.workStatusTooltip}
                              aria-label={item.workStatusTooltip}
                              style={{ ...styles.bbStatusIcon, ...statusStyle }}
                            >
                              {statusIcon}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
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
  mapBar: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, justifyContent: "space-between", fontSize: 13, color: "#334155", fontWeight: 700 }, legend: { display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontWeight: 600 }, swatch: { width: 12, height: 12, border: "1px solid #64748b", display: "inline-block" }, smallButton: { border: "1px solid #cbd5e1", borderRadius: 999, padding: "5px 10px", background: "#fff", color: "#1d4ed8", fontWeight: 800 }, map: { position: "relative", height: 620, borderRadius: 12, overflow: "hidden", background: "#f1f5f9" }, mapOverlay: { position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(248, 250, 252, 0.72)", backdropFilter: "blur(1px)", zIndex: 5, pointerEvents: "none" }, status: { display: "grid", placeItems: "center", height: "100%", color: "#475569" },
  window: { display: "flex", flexDirection: "column", gap: 10, border: "1px solid #dbe4f0", borderRadius: 16, padding: 14, background: "#fff", boxSizing: "border-box" },
  sidebar: { display: "grid", gap: 14, alignItems: "start" },
  batchesBox: { display: "grid", gap: 10, border: "1px solid #dbe4f0", borderRadius: 16, padding: 14, background: "#fff", boxSizing: "border-box" },
  bbHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  bbTitle: { margin: 0, fontSize: 16, fontWeight: 800, color: "#0f172a" },
  bbPills: { display: "inline-flex", gap: 6 },
  bbPill: { border: "1px solid #cbd5e1", borderRadius: 999, padding: "4px 10px", background: "#fff", color: "#334155", fontSize: 12, fontWeight: 700, cursor: "pointer" },
  bbPillActive: { borderColor: "#2563eb", background: "#eff6ff", color: "#1d4ed8" },
  bbSearch: { width: "100%", boxSizing: "border-box", border: "1px solid #cbd5e1", borderRadius: 8, padding: "7px 10px", fontSize: 12 },
  bbTableWrap: { maxHeight: 320, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 10 },
  bbTable: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  bbTh: { textAlign: "left", padding: "8px 10px", background: "#f8fafc", color: "#475569", fontWeight: 800, borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0 },
  bbRow: { cursor: "pointer", borderBottom: "1px solid #f1f5f9" },
  bbRowDisabled: { background: "#f8fafc", color: "#94a3b8", opacity: 0.72 },
  bbRowSelected: { background: "#eff6ff", opacity: 1 },
  bbTd: { padding: "8px 10px", verticalAlign: "middle", color: "#0f172a" },
  bbStatusIcon: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 999, fontSize: 13, fontWeight: 900, cursor: "help" },
  bbStatusNs: { background: "#dbeafe", color: "#1e40af" },
  bbStatusIp: { background: "#fef3c7", color: "#92400e" },
  bbStatusCp: { background: "#dcfce7", color: "#166534" },
  warnMessage: { margin: 0, color: "#b45309", fontSize: 13, fontWeight: 700 },
  windowTitle: { margin: 0, fontSize: 18 }, totals: { margin: 0, color: "#334155", fontSize: 13, fontWeight: 700 }, list: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6, maxHeight: 260, overflowY: "auto" },
  listItem: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 10px", fontSize: 13, background: "#f8fafc" },
  listItemText: { display: "grid", gap: 3, minWidth: 0 },
  listItemTitle: { fontSize: 12, fontWeight: 800, color: "#0f172a", wordBreak: "break-all" },
  listItemMeta: { fontSize: 12, color: "#475569", fontWeight: 600 },
  removeBtn: { border: "1px solid #cbd5e1", borderRadius: 6, width: 24, height: 24, display: "inline-grid", placeItems: "center", background: "#fff", color: "#475569", fontWeight: 700, cursor: "pointer", flexShrink: 0 },
  dropZoneAssigned: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  changeBtn: { border: "1px solid #93c5fd", borderRadius: 6, padding: "3px 8px", background: "#fff", color: "#1d4ed8", fontSize: 12, fontWeight: 700, cursor: "pointer" },
  dropZone: { border: "2px dashed #93c5fd", borderRadius: 10, padding: 10, color: "#1d4ed8", fontSize: 13, background: "#eff6ff" }, dropFocused: { borderColor: "#2563eb", boxShadow: "0 0 0 3px #bfdbfe" }, targets: { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6, overflowY: "auto", minHeight: 100 }, target: { display: "flex", justifyContent: "space-between", gap: 8, border: "1px solid #bfdbfe", borderRadius: 10, padding: 8, background: "#eff6ff", color: "#1e3a8a", textAlign: "left", cursor: "grab" }, targetChosen: { borderColor: "#1d4ed8", background: "#dbeafe", boxShadow: "0 0 0 2px #93c5fd" }, message: { margin: 0, color: "#166534", fontSize: 13, fontWeight: 700 }, allocate: { border: 0, borderRadius: 12, padding: 12, background: "#2563eb", color: "#fff", fontWeight: 900, cursor: "pointer" }, disabled: { background: "#94a3b8", cursor: "not-allowed" }, modalList: { listStyle: "none", display: "grid", gap: 6, padding: 0, maxHeight: 260, overflowY: "auto" }, modalNote: { color: "#334155", fontSize: 13 },
};
