/* eslint-disable no-unused-vars -- JSX tags are used by React. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";
import { APIProvider, Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";

import { useAuth } from "../../auth/useAuth";
import {
  useAllocateSalesTargetedBatchesTogetherMutation,
  useGetTargetedBatchAllocationDirectoryQuery,
  useGetTargetedBatchAllocationMatrixByLmQuery,
  useGetTargetedBatchRowCountsByLmQuery,
} from "../../redux/salesTargetedBatchApi";
import { useGetGeoFencesByLmQuery } from "../../redux/geofencesApi";
import { useGetWardBoundariesByLmQuery } from "../../redux/mapWardsApi";
import { useGetUsersDirectoryQuery } from "../../redux/usersApi";
import { WardBoundaryPolygons } from "./geofence-map-layers";
import { geofenceLabelPoint, getGeoFencePath, geoJsonPolygonToGooglePaths, parseGeometry, pointsCentre, wardNameLabelPoint } from "./geofence-map-helpers";
import { wardNumberFromPcode } from "../../../functions/geofences/geofence-name.js";
import { buildOrganisationAllocationMatrixResult } from "./targeted-batches/allocation/allocationMatrixModel";
import { getReportingCountsState } from "../sales/models/salesReportingCountsModel.js";
import {
  ALLOCATION_MAP_MAX,
  ALLOCATION_MAP_STATES,
  allocateButtonLabel,
  allocationFailureView,
  allocationSelection,
  batchesText,
  metersText,
  buildAllocationMapModel,
  toggleAllocationSelection,
} from "./targeted-batches/allocation/allocationMapModel";
import { useAllocationMapSelection } from "./targeted-batches/allocation/allocationMapSelection";
import {
  buildTargetPayload,
  buildUsersById,
  enrichServiceProvidersWithMembers,
  enrichTeamsWithMembers,
  getActorMncServiceProviderId,
} from "./targeted-batches/allocation/targetedBatchAllocationUtils";
import BatchCreationModal from "./targeted-batches/draft/batch-creation-modal.jsx";

// Targeted Batch rules TB-R047 (1.3.31): the Allocation Map. Every batch geofence of the LM on one map
// (the one exception to one Ward per map), each labelled with its name and meter count. Clicking a ready
// geofence puts its batch in the allocation window; one TEAM or SP is allocated the whole selection in
// one all-or-nothing step.
const EMPTY = Object.freeze([]);
const NO_ROW_COUNTS = Object.freeze({});
const STATE_STYLES = Object.freeze({
  [ALLOCATION_MAP_STATES.READY]: { strokeColor: "#7c3aed", fillColor: "#c4b5fd", fillOpacity: 0.35, strokeWeight: 2, labelColor: "#5b21b6" },
  SELECTED: { strokeColor: "#3b0764", fillColor: "#8b5cf6", fillOpacity: 0.5, strokeWeight: 4, labelColor: "#3b0764" },
  [ALLOCATION_MAP_STATES.ALLOCATED]: { strokeColor: "#64748b", fillColor: "#cbd5e1", fillOpacity: 0.4, strokeWeight: 1.5, labelColor: "#334155" },
  [ALLOCATION_MAP_STATES.UNAVAILABLE]: { strokeColor: "#94a3b8", fillColor: "#e2e8f0", fillOpacity: 0.3, strokeWeight: 1, labelColor: "#64748b" },
});

function activeLm(workbase) {
  return String(workbase?.lmPcode || workbase?.pcode || workbase?.id || workbase?.localMunicipalityId || "").trim();
}

// 1.3.32: the label sits on its own overlay so the name, the meters and the TEAM or SP read on three
// rows instead of one long line (a Marker label is a single line).
function labelOverlayClass() {
  return class AllocationLabelOverlay extends window.google.maps.OverlayView {
    constructor({ point, lines, color, bold }) {
      super();
      Object.assign(this, { point, lines, color, bold, div: null });
    }

    onAdd() {
      const div = document.createElement("div");
      div.className = "ireps-geofence-label ireps-allocation-label";
      div.style.color = this.color;
      div.style.fontWeight = this.bold ? "800" : "600";
      this.lines.forEach(line => {
        const row = document.createElement("div");
        row.textContent = line;
        div.appendChild(row);
      });
      this.div = div;
      this.getPanes()?.overlayLayer?.appendChild(div);
    }

    draw() {
      const pixel = this.div && this.getProjection()?.fromLatLngToDivPixel(new window.google.maps.LatLng(this.point));
      if (!pixel) return;
      this.div.style.left = `${pixel.x}px`;
      this.div.style.top = `${pixel.y}px`;
    }

    onRemove() { this.div?.remove(); this.div = null; }
  };
}

function AllocationMapGeofences({ items, selectedIds, onToggle }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !window.google?.maps) return undefined;
    const LabelOverlay = labelOverlayClass();
    const drawn = [];
    for (const item of items) {
      const path = getGeoFencePath(item.fence);
      if (path.length < 3) continue;
      const selected = selectedIds.includes(item.tbId);
      const style = STATE_STYLES[selected ? "SELECTED" : item.state];
      const ready = item.state === ALLOCATION_MAP_STATES.READY;
      const polygon = new window.google.maps.Polygon({ paths: path, strokeColor: style.strokeColor, strokeOpacity: 1, strokeWeight: style.strokeWeight,
        fillColor: style.fillColor, fillOpacity: style.fillOpacity, clickable: ready, zIndex: selected ? 80 : ready ? 70 : 60, map });
      if (ready) polygon.addListener("click", () => onToggle(item));
      drawn.push(polygon);
      const labelPoint = geofenceLabelPoint(item.fence);
      if (labelPoint) {
        const overlay = new LabelOverlay({ point: labelPoint, lines: item.labelLines, color: style.labelColor, bold: selected });
        overlay.setMap(map);
        drawn.push(overlay);
      }
    }
    return () => drawn.forEach(shape => shape.setMap(null));
  }, [map, items, selectedIds, onToggle]);
  return null;
}

// Opens fitted to the batches on the map, and fits again when they change or "Fit to map" is pressed.
function FitAll({ items, fitRequest }) {
  const map = useMap();
  const fitted = useRef("");
  const shownKey = items.map(item => item.tbId).join(",");
  useEffect(() => {
    const key = `${fitRequest}:${shownKey}`;
    if (!map || !window.google?.maps || !items.length || fitted.current === key) return;
    const bounds = new window.google.maps.LatLngBounds();
    items.forEach(item => getGeoFencePath(item.fence).forEach(point => bounds.extend(point)));
    map.fitBounds(bounds, 48);
    fitted.current = key;
  }, [map, items, fitRequest, shownKey]);
  return null;
}

export default function TargetedBatchAllocationMapPage() {
  const authContext = useAuth();
  const lmPcode = activeLm(authContext.activeWorkbase);
  const mncId = getActorMncServiceProviderId(authContext);
  const [selectedIds, setSelectedIds] = useState([]);
  const [target, setTarget] = useState(null);
  const [dragTarget, setDragTarget] = useState(null);
  const [dropFocused, setDropFocused] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fitRequest, setFitRequest] = useState(0);
  const [showAll, setShowAll] = useState(false);
  // TB-R047 (1.3.37): confirm | allocating | done | failed | uncertain, each with the selection and target it was opened for.
  const [allocationWindow, setAllocationWindow] = useState(null);
  const [allocateTogether] = useAllocateSalesTargetedBatchesTogetherMutation();
  const { selectedIds: tickedIds } = useAllocationMapSelection(lmPcode);

  const { data: matrixStream } = useGetTargetedBatchAllocationMatrixByLmQuery(lmPcode || skipToken);
  const { data: geofences = EMPTY } = useGetGeoFencesByLmQuery({ lmPcode }, { skip: !lmPcode });
  const { data: lmWards } = useGetWardBoundariesByLmQuery(lmPcode, { skip: !lmPcode });
  const { data: directory } = useGetTargetedBatchAllocationDirectoryQuery(mncId || skipToken);
  const { data: users = EMPTY } = useGetUsersDirectoryQuery({ limit: 1000 });

  const batches = matrixStream?.batches || EMPTY;
  const model = useMemo(() => buildAllocationMapModel({ batches, geofences }), [batches, geofences]);
  // TB-R047 (1.3.32): the map draws the batches ticked in TB Register, unless "Show all batches" is on.
  const shown = useMemo(() => (showAll ? model.items : model.items.filter(item => tickedIds.includes(item.tbId))), [model.items, showAll, tickedIds]);
  const counts = useMemo(() => ({ ready: shown.filter(item => item.state === ALLOCATION_MAP_STATES.READY).length, allocated: shown.filter(item => item.state === ALLOCATION_MAP_STATES.ALLOCATED).length }), [shown]);
  const selection = useMemo(() => allocationSelection(shown, selectedIds), [shown, selectedIds]);

  // A selected batch leaves the window when it stops being ready (allocated by someone else) or when
  // its tick is taken off in TB Register.
  useEffect(() => {
    if (!selection.dropped.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIds(current => current.filter(id => !selection.dropped.includes(id)));
    const untickedOnly = selection.dropped.every(id => model.items.some(item => item.tbId === id && item.state === ALLOCATION_MAP_STATES.READY));
    setMessage(`${selection.dropped.join(", ")} ${selection.dropped.length === 1 ? "is" : "are"} ${untickedOnly ? "no longer ticked in TB Register" : "no longer ready"} and left the allocation window.`);
  }, [selection.dropped, model.items]);

  const usersById = useMemo(() => buildUsersById(users), [users]);
  const teams = useMemo(() => enrichTeamsWithMembers(directory?.teams || EMPTY, usersById), [directory?.teams, usersById]);
  const serviceProviders = useMemo(() => enrichServiceProvidersWithMembers(directory?.serviceProviders || EMPTY, users), [directory?.serviceProviders, users]);
  // TB-R045 (1.3.57): each TEAM / SP's workload is counted from the batch rows, as in the Allocation
  // Matrix and Sales Reporting; until every row is counted the chips show member counts instead.
  const { data: rowCountsStream, isError: rowCountsFailed } = useGetTargetedBatchRowCountsByLmQuery(lmPcode || skipToken);
  const countsState = getReportingCountsState({ hasWorkbase: Boolean(lmPcode), batchesStatus: matrixStream?.sync?.status, batchesFailed: Boolean(matrixStream?.sync?.error),
    rowCountSources: rowCountsStream?.sync?.sources, rowCountsFailed });
  const rowCountsByBatch = countsState === "ready" ? rowCountsStream?.countsByBatch || NO_ROW_COUNTS : null;
  const workloads = useMemo(() => (rowCountsByBatch
    ? new Map(buildOrganisationAllocationMatrixResult({ batches, rows: matrixStream?.rows || EMPTY, teams, serviceProviders, rowCountsByBatch }).organisations.map(item => [item.key, item.matrix]))
    : new Map()),
  [batches, matrixStream?.rows, teams, serviceProviders, rowCountsByBatch]);

  const wardLayer = useMemo(() => {
    const centre = pointsCentre(model.items.flatMap(item => getGeoFencePath(item.fence)));
    return (lmWards || []).flatMap(ward => {
      const pcode = ward.wardPcode || ward.id, paths = geoJsonPolygonToGooglePaths(parseGeometry(ward.geometry));
      if (!paths.length) return [];
      const number = wardNumberFromPcode(pcode);
      return [{ id: pcode, paths, label: number ? `Ward ${number}` : ward.name, labelPoint: wardNameLabelPoint(paths, centre, { centroid: ward.centroid }) }];
    });
  }, [lmWards, model.items]);

  const toggle = useMemo(() => item => {
    setSelectedIds(current => {
      const result = toggleAllocationSelection(current, item);
      setMessage(result.message);
      return result.selectedIds;
    });
    setError("");
  }, []);

  const chooseTarget = candidate => { const payload = buildTargetPayload(candidate); if (payload) { setTarget(payload); setError(""); } };
  const onDrop = event => {
    event.preventDefault(); setDropFocused(false);
    let dropped = dragTarget;
    try { dropped = JSON.parse(event.dataTransfer.getData("application/json")) || dropped; } catch { /* keep the dragged chip */ }
    chooseTarget(dropped); setDragTarget(null);
  };

  const canAllocate = Boolean(selection.batches && target && !busy && !allocationWindow);
  // While a window is open or the server works, nothing in the allocation window can change.
  const locked = busy || Boolean(allocationWindow);
  // TB-R047 (1.3.37): Allocate opens a confirmation window, never the browser's OK/Cancel box.
  const allocate = () => {
    if (!canAllocate) return;
    setError(""); setMessage("");
    setAllocationWindow({ kind: "confirm", selection, target });
  };
  const sameSelection = (a, b) => a.items.map(item => item.tbId).join() === b.items.map(item => item.tbId).join();
  const confirmAllocate = async () => {
    if (allocationWindow?.kind !== "confirm" || busy) return;
    const { selection, target } = allocationWindow;
    const live = allocationSelection(shown, selectedIds);
    if (!sameSelection(selection, live)) {
      const liveIds = live.items.map(item => item.tbId), left = selection.items.filter(item => !liveIds.includes(item.tbId));
      setAllocationWindow({ kind: "failed", selection, target, title: "Nothing was allocated", tone: "error", lines: [
        left.length ? `The selection changed while the confirmation was open: ${left.map(item => item.name).join(", ")} left the allocation window.` : "The selection changed while the confirmation was open.",
        "Check the allocation window, then press Allocate again."] });
      return;
    }
    setAllocationWindow({ kind: "allocating", selection, target });
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await allocateTogether({ tbIds: selection.items.map(item => item.tbId), targetType: target.type, targetId: target.id }).unwrap();
      setSelectedIds([]);
      setAllocationWindow({ kind: "done", selection, target, allocatedIds: result.tbIds, targetName: result.target?.name || target.name });
    } catch (failure) {
      setAllocationWindow({ selection, target, ...allocationFailureView({ failure, selection, target }) });
    } finally { setBusy(false); }
  };
  // The result is written next to the Allocate button only once its window closes (one announcement at a time).
  const closeAllocationWindow = () => {
    const view = allocationWindow;
    if (!view || view.kind === "allocating") return;
    if (view.kind === "done") setMessage(`${batchesText(view.allocatedIds.length)} allocated to ${view.targetName}. They now wait for ${view.targetName} to accept them.`);
    if (view.kind === "failed") setError(`Nothing was allocated. ${view.lines[0]}`);
    if (view.kind === "uncertain") setError("Allocation not confirmed. Check the map before allocating again.");
    setAllocationWindow(null);
  };

  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const loading = !matrixStream?.sync || matrixStream.sync.status === "syncing";
  const targetChip = candidate => {
    const payload = buildTargetPayload(candidate), workload = workloads.get(`${payload?.type}:${payload?.id}`);
    if (!payload) return null;
    const chosen = target && target.type === payload.type && target.id === payload.id;
    return (
      <button key={`${payload.type}:${payload.id}`} type="button" disabled={locked} draggable={!locked} onDragStart={event => { setDragTarget(payload); event.dataTransfer.setData("application/json", JSON.stringify(payload)); event.dataTransfer.effectAllowed = "copy"; }}
        onDragEnd={() => { setDragTarget(null); setDropFocused(false); }} onClick={() => chooseTarget(payload)} style={{ ...styles.chip, ...(chosen ? styles.chipChosen : null) }}
        title={`${payload.type} · drag onto the allocation window or click`}>
        <strong style={styles.chipName}>{payload.name}</strong>
        <small>{workload ? `${workload.assigned} assigned · ${workload.notStarted} not started` : `${payload.memberCount} member(s)`}</small>
      </button>
    );
  };

  return (
    <section style={styles.page}>
      <Link to="/operations/targeted-batches" style={styles.back}>← Back to TB Register</Link>
      <header>
        <p style={styles.eyebrow}>Operations / TB Register</p>
        <h1 style={styles.title}>Allocation Map</h1>
        <p style={styles.subtitle}>The batches you ticked in TB Register, across all Wards. Click the purple ones to put them in the allocation window, then allocate them together to one TEAM or SP (at most {ALLOCATION_MAP_MAX} at a time).</p>
      </header>
      {model.readyNotOnMap ? <div style={styles.note}>{model.readyNotOnMap} ready batch(es) have no geofence and are not on the map. Allocate them from TB Register as before.</div> : null}
      <div style={styles.layout}>
        <div style={styles.mapPane}>
          <div style={styles.mapBar}>
            <span>{shown.length} of {model.items.length} batches shown · {counts.ready} ready · {counts.allocated} allocated</span>
            <span style={styles.legend}>
              <i style={{ ...styles.swatch, background: STATE_STYLES.READY.fillColor, borderColor: STATE_STYLES.READY.strokeColor }} />Ready, click to select
              <i style={{ ...styles.swatch, background: STATE_STYLES.SELECTED.fillColor, borderColor: STATE_STYLES.SELECTED.strokeColor }} />Selected
              <i style={{ ...styles.swatch, background: STATE_STYLES.ALLOCATED.fillColor, borderColor: STATE_STYLES.ALLOCATED.strokeColor }} />Allocated
            </span>
            <label style={styles.switch}>
              <input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} />
              Show all batches
            </label>
            <button type="button" style={styles.smallButton} onClick={() => setFitRequest(value => value + 1)}>Fit to map</button>
          </div>
          <div style={styles.map}>
            {!key ? <p>Google Maps key missing</p> : loading ? <p style={styles.status}>Loading the batches…</p>
              : !model.items.length ? <p style={styles.status}>No batch geofences in this municipality yet.</p>
              : !shown.length ? (
                <p style={styles.status}>
                  Tick the batches you want in <Link to="/operations/targeted-batches" style={styles.back}>TB Register</Link>, or switch on “Show all batches”.
                </p>
              ) : (
              <APIProvider apiKey={key}>
                <GoogleMap defaultCenter={{ lat: -28.16, lng: 30.23 }} defaultZoom={13} gestureHandling="greedy" style={{ width: "100%", height: "100%" }}>
                  <WardBoundaryPolygons wards={wardLayer} />
                  <AllocationMapGeofences items={shown} selectedIds={selectedIds} onToggle={toggle} />
                  <FitAll items={shown} fitRequest={fitRequest} />
                </GoogleMap>
              </APIProvider>
            )}
          </div>
        </div>
        <aside style={{ ...styles.window, ...(dropFocused ? styles.windowDrop : null) }} onDragOver={event => { event.preventDefault(); setDropFocused(true); }} onDragLeave={() => setDropFocused(false)} onDrop={onDrop}>
          <h2 style={styles.windowTitle}>Allocation window</h2>
          <p style={styles.totals}>{selection.batches ? `${selection.batches} batch(es) · ${selection.meters} meter(s) · ${selection.wards.join(", ")}` : "Click ready geofences on the map to add them here."}</p>
          <ul style={styles.list}>
            {selection.items.map(item => (
              <li key={item.tbId} style={styles.listItem}>
                <span><strong>{item.name}</strong><small style={styles.muted}>{item.wardLabel} · {item.meters} meter(s) · {item.tbId}</small></span>
                <button type="button" aria-label={`Remove ${item.name}`} style={styles.remove} disabled={locked} onClick={() => toggle(item)}>×</button>
              </li>
            ))}
          </ul>
          <div style={styles.dropZone}>{target ? <span>Allocating to <strong>{target.name}</strong> ({target.type}) <button type="button" style={styles.clear} disabled={locked} onClick={() => setTarget(null)}>change</button></span> : "Drag a TEAM or SP here, or click one below."}</div>
          {/* TB-R047 (1.3.37): TEAMs and Service providers side by side, each column scrolling on its own. */}
          <div style={styles.targetColumns}>
            <section style={styles.targetColumn} aria-label="TEAMs">
              <strong style={styles.columnTitle}>TEAMs ({teams.length})</strong>
              <div style={styles.targetList}>{teams.length ? teams.map(targetChip) : <small style={styles.muted}>No TEAMs</small>}</div>
            </section>
            <section style={styles.targetColumn} aria-label="Service providers">
              <strong style={styles.columnTitle}>Service providers ({serviceProviders.length})</strong>
              <div style={styles.targetList}>{serviceProviders.length ? serviceProviders.map(targetChip) : <small style={styles.muted}>No SPs</small>}</div>
            </section>
          </div>
          {message ? <p role="status" style={styles.message}>{message}</p> : null}
          {error ? <p role="alert" style={styles.error}>{error}</p> : null}
          <button type="button" style={{ ...styles.allocate, ...(canAllocate ? null : styles.allocateDisabled) }} disabled={!canAllocate} onClick={allocate}>
            {busy ? "Allocating…" : allocateButtonLabel(selection, target)}
          </button>
        </aside>
      </div>
      <AllocationWindow view={allocationWindow} onConfirm={confirmAllocate} onClose={closeAllocationWindow} />
    </section>
  );
}

function BatchList({ items, allocatedIds = null }) {
  const listed = allocatedIds ? items.filter(item => allocatedIds.includes(item.tbId)) : items;
  return (
    <ul style={styles.windowList}>
      {listed.map(item => (
        <li key={item.tbId} style={styles.windowListItem}>
          <strong>{item.name}</strong>
          <small style={styles.muted}>{item.wardLabel} · {item.meters} meter(s) · {item.tbId}</small>
        </li>
      ))}
    </ul>
  );
}

// TB-R047 (1.3.37): confirm before, progress during, result after.
function AllocationWindow({ view, onConfirm, onClose }) {
  if (!view) return null;
  const { selection, target } = view;
  const totals = `${batchesText(selection.batches)} · ${metersText(selection.meters)} · ${selection.wards.join(", ")}`;
  if (view.kind === "confirm") {
    return (
      <BatchCreationModal title={allocateButtonLabel(selection, target)} escapeAction={onClose}
        lines={[`You are about to allocate ${batchesText(selection.batches)} (${metersText(selection.meters)}) to ${target.type === "TEAM" ? "TEAM" : "service provider"} ${target.name}.`]}
        actions={[{ label: "Allocate", primary: true, onClick: onConfirm }, { label: "Cancel", onClick: onClose }]}>
        <BatchList items={selection.items} />
        <p style={styles.windowTotals}>{totals}</p>
        <p style={styles.windowNote}>Each batch is allocated with the same checks as TB Allocation, all together or not at all.</p>
      </BatchCreationModal>
    );
  }
  if (view.kind === "allocating") {
    return <BatchCreationModal title={`Allocating ${batchesText(selection.batches)} to ${target.name}…`} working
      lines={[totals, "Please wait. Nothing is allocated until every batch passes its checks."]} />;
  }
  if (view.kind === "done") {
    return (
      <BatchCreationModal title={`${batchesText(view.allocatedIds.length)} allocated to ${view.targetName}`} escapeAction={onClose}
        lines={[`They now wait for ${view.targetName} to accept them.`]} actions={[{ label: "OK", primary: true, onClick: onClose }]}>
        <BatchList items={selection.items} allocatedIds={view.allocatedIds} />
      </BatchCreationModal>
    );
  }
  // failed or uncertain (TB-R047 1.3.37): what went wrong and what to do.
  return <BatchCreationModal title={view.title} tone={view.tone} escapeAction={onClose} lines={view.lines}
    actions={[{ label: "OK", primary: true, onClick: onClose }]} />;
}

const styles = {
  page: { display: "grid", gap: 14 },
  back: { color: "#2563eb", fontWeight: 800, fontSize: 13, textDecoration: "none" },
  eyebrow: { margin: 0, color: "#2563eb", fontSize: 12, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" },
  title: { margin: "4px 0 0", color: "#0f172a", fontSize: 30 },
  subtitle: { maxWidth: 900, margin: "8px 0 0", color: "#64748b", fontSize: 14, fontWeight: 600, lineHeight: 1.6 },
  note: { border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e", borderRadius: 12, padding: 12, fontSize: 13 },
  layout: { display: "grid", gridTemplateColumns: "minmax(0, 1.7fr) minmax(300px, 1fr)", gap: 14, alignItems: "start" },
  mapPane: { display: "grid", gap: 8, border: "1px solid #dbe4f0", borderRadius: 16, padding: 12, background: "#ffffff" },
  mapBar: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, justifyContent: "space-between", fontSize: 13, color: "#334155", fontWeight: 700 },
  legend: { display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontWeight: 600, color: "#475569" },
  swatch: { display: "inline-block", width: 12, height: 12, border: "2px solid", marginLeft: 6 },
  smallButton: { border: "1px solid #cbd5e1", borderRadius: 999, padding: "5px 10px", background: "#ffffff", color: "#1d4ed8", fontWeight: 800, cursor: "pointer" },
  switch: { display: "inline-flex", alignItems: "center", gap: 6, color: "#334155", fontWeight: 700, cursor: "pointer" },
  map: { height: 620, borderRadius: 12, overflow: "hidden", background: "#f1f5f9" },
  status: { display: "grid", placeItems: "center", height: "100%", margin: 0, color: "#475569" },
  window: { display: "flex", flexDirection: "column", gap: 10, border: "1px solid #dbe4f0", borderRadius: 16, padding: 14, background: "#ffffff", position: "sticky", top: 12, maxHeight: "calc(100vh - 24px)", boxSizing: "border-box", overflow: "hidden" },
  windowDrop: { borderColor: "#2563eb", boxShadow: "0 0 0 3px #bfdbfe" },
  windowTitle: { margin: 0, fontSize: 18, color: "#0f172a", flexShrink: 0 },
  totals: { margin: 0, color: "#334155", fontSize: 13, fontWeight: 700, flexShrink: 0 },
  list: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6, alignContent: "start", maxHeight: 260, minHeight: 0, flex: "0 1 auto", overflowY: "auto" },
  listItem: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, border: "1px solid #e2e8f0", borderRadius: 10, padding: "6px 10px", fontSize: 13 },
  muted: { display: "block", color: "#64748b", fontSize: 11 },
  remove: { border: "none", background: "#f1f5f9", borderRadius: 999, width: 26, height: 26, cursor: "pointer", fontSize: 16 },
  dropZone: { border: "2px dashed #93c5fd", borderRadius: 10, padding: 10, color: "#1d4ed8", fontSize: 13, background: "#eff6ff", flexShrink: 0 },
  clear: { marginLeft: 6, border: "none", background: "none", color: "#2563eb", textDecoration: "underline", cursor: "pointer", fontSize: 12 },
  targetColumns: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, alignItems: "stretch", flex: "1 1 auto", minHeight: 96 },
  targetColumn: { display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", gap: 6, minWidth: 0, minHeight: 0 },
  columnTitle: { display: "flex", alignItems: "flex-end", minHeight: 32, fontSize: 12, color: "#475569", letterSpacing: "0.02em" },
  targetList: { display: "grid", gap: 6, alignContent: "start", maxHeight: 280, minHeight: 0, overflowY: "auto", scrollbarGutter: "stable", paddingRight: 2 },
  chip: { display: "grid", gap: 2, width: "100%", textAlign: "left", border: "1px solid #bfdbfe", borderRadius: 10, padding: "6px 10px", background: "#eff6ff", color: "#1e3a8a", cursor: "grab", fontSize: 12 },
  chipName: { overflowWrap: "anywhere" },
  windowList: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6, maxHeight: 280, overflowY: "auto" },
  windowTotals: { margin: 0, color: "#0f172a", fontSize: 13, fontWeight: 800 },
  windowNote: { margin: 0, color: "#334155", fontSize: 13, lineHeight: 1.5 },
  windowListItem: { display: "grid", gap: 2, border: "1px solid #e2e8f0", borderRadius: 10, padding: "6px 10px", fontSize: 13 },
  chipChosen: { borderColor: "#1d4ed8", background: "#dbeafe", boxShadow: "0 0 0 2px #93c5fd" },
  message: { margin: 0, color: "#166534", fontSize: 13, fontWeight: 700, flexShrink: 0 },
  error: { margin: 0, color: "#991b1b", fontSize: 13, fontWeight: 700, flexShrink: 0 },
  allocate: { border: "none", borderRadius: 12, padding: "12px 14px", background: "#2563eb", color: "#ffffff", fontWeight: 900, fontSize: 14, cursor: "pointer", flexShrink: 0 },
  allocateDisabled: { background: "#94a3b8", cursor: "not-allowed" },
};
