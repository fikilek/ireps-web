/* eslint-disable no-unused-vars -- JSX tags are used by React. */
import { useEffect, useMemo, useRef, useState } from "react";
import { APIProvider, Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";
import BusySpinner from "../../../../components/busy-spinner.jsx";
import { useGetGeoFencesByWardQuery } from "../../../../redux/geofencesApi";
import { useGetSalesBatchNearbyQuery } from "../../../../redux/salesTargetedBatchApi";
import { GeofenceToolbar, GeofenceDrawingBar, GeofenceDialogs } from "../../geofence-shared-ui";
import { DraftGeoFenceLayer, ExistingGeoFenceLayer, WardBoundaryPolygons } from "../../geofence-map-layers";
import { GeofencePlanningLayerControls, GeofencePlanningLayers, SalesStatusGlyph } from "../../GeofencePlanningLayers";
import { SALES_STATUSES } from "../../../sales/models/salesStatusModel.js";
import { buildGeofencePlanningDraftStats } from "../../geofencePlanningModel";
import { mapShellStyle, wardSelectWrapStyle } from "../../geofence-ui-styles";
import { geofenceKind, getGeoFencePath, pathsOverlap, pointsCentre, parseGeometry, geoJsonPolygonToGooglePaths, wardNameLabelPoint } from "../../geofence-map-helpers";
import { useGetWardBoundariesByLmQuery } from "../../../../redux/mapWardsApi";
import { composeGeofenceName, geofenceNamePart, wardNumberFromPcode } from "../../../../../functions/geofences/geofence-name.js";
import { NEARBY_LAYERS, emptyNearbyModel, locatedMeterBounds, mapPoint } from "../../../../features/maps/sales-batch-nearby.js";
import { salesDraftWardLabel, salesDraftMessage } from "./sales-batch-draft-model";
import { draftButtonStyle } from "./targetedBatchDraftReviewStyles";
import SalesBatchMapLayers from "./sales-batch-map-layers";

export default function SalesBatchGeofenceWorkspace({ draft, model, live, drawing, busy, locating, saving, onSave, onCreate, createDisabled = true, highlightedId, onHighlight }) {
  const lmPcode = draft.scope.lmPcode, wardPcode = model.wards.length === 1 ? model.wards[0] : "";
  const ward = live?.wards?.[wardPcode], wardLabel = wardPcode ? salesDraftWardLabel(wardPcode, ward) : "Keep one Ward to create a geofence";
  const scopeReady = Boolean(wardPcode && ward && live?.ready);
  const saved = draft.savedFence?.status === "ACTIVE" && Boolean(draft.savedFence.targetedBatch);
  const pendingFence = Boolean(draft.savedFence?.id && !draft.savedFence.status);
  const [mapTypeId, setMapTypeId] = useState("roadmap"), [selectedGeoFence, setSelectedGeoFence] = useState(null);
  const [listModalOpen, setListModalOpen] = useState(false), [createModalOpen, setCreateModalOpen] = useState(false), [confirmCreateModalOpen, setConfirmCreateModalOpen] = useState(false), [createSuccess, setCreateSuccess] = useState(null);
  const [draftName, setDraftName] = useState(""), [draftDescription, setDraftDescription] = useState(""), [error, setError] = useState("");
  const [visibility, setVisibility] = useState({ erfs: false, sales: false, premises: false, assets: false, geofences: false, wards: false });
  const [salesStatusVisibility, setSalesStatusVisibility] = useState({ notStarted: true, inProgress: true, completed: true });
  const isCreateMode = drawing.drawing && !saved && !pendingFence;
  // Geofences rules GF-R001: "Gf W<Ward number> <name>"; the start comes from the draft's Ward.
  const draftWardNumber = wardNumberFromPcode(wardPcode);
  const standardDraftName = composeGeofenceName(draftWardNumber, geofenceNamePart(draftName));
  const draftPoints = drawing.points, draftPolygonReady = draftPoints.length >= 3, canSaveDraft = Boolean(standardDraftName && model.canSave && !busy);
  const createState = { isLoading: saving };
  // The draft model is rebuilt whenever any draft data changes. Key the map inputs on
  // what the map actually shows, so markers and labels are not redrawn needlessly.
  const meterKey = JSON.stringify(model.rows.map(row => mapPoint(row.point)).filter(Boolean));
  const meterPoints = useMemo(() => JSON.parse(meterKey), [meterKey]);
  const bounds = useMemo(() => locatedMeterBounds(meterPoints.map(point => ({ point }))), [meterPoints]);
  // Rules 18.7 (1.3.8): the Wards layer shows every Ward in the LM. A Ward with draft
  // meters is named just above them; any other Ward inside itself, nearest the meters.
  // The same LM Ward query feeds the app's Ward lists, so it is usually already in memory.
  const { data: lmWards } = useGetWardBoundariesByLmQuery(lmPcode, { skip: !visibility.wards || !lmPcode });
  const wardsLoading = Boolean(visibility.wards && !lmWards?.length);
  const wardMeterKey = JSON.stringify(model.rows.flatMap(row => { const point = mapPoint(row.point); return point && row.scope?.wardPcode ? [[row.scope.wardPcode, point.lat, point.lng]] : []; }));
  const wardLayer = useMemo(() => {
    const pointsByWard = new Map();
    for (const [pcode, lat, lng] of JSON.parse(wardMeterKey)) pointsByWard.set(pcode, [...(pointsByWard.get(pcode) || []), { lat, lng }]);
    const batchCentre = pointsCentre([...pointsByWard.values()].flat());
    return (lmWards || []).flatMap(ward => {
      const pcode = ward.wardPcode || ward.id, paths = geoJsonPolygonToGooglePaths(parseGeometry(ward.geometry));
      if (!paths.length) return [];
      const own = pointsByWard.get(pcode), number = wardNumberFromPcode(pcode);
      return [{ id: pcode, paths, label: number ? `Ward ${number}` : ward.name, labelAbove: Boolean(own),
        labelPoint: own ? pointsCentre(own) : wardNameLabelPoint(paths, batchCentre, { centroid: ward.centroid }) }];
    });
  }, [lmWards, wardMeterKey]);
  const layers = NEARBY_LAYERS.filter(layer => visibility[layer] || isCreateMode);
  const { data: nearby } = useGetSalesBatchNearbyQuery({ lmPcode, wardPcode, bounds, wardGeometry: ward?.geometry, layers }, { skip: !scopeReady || !bounds || !layers.length });
  const emptyModel = useMemo(() => emptyNearbyModel(), []);
  const planningModel = nearby?.model || emptyModel;
  const { data: geofenceData, isLoading: geofencesLoading } = useGetGeoFencesByWardQuery({ lmPcode, wardPcode }, { skip: !scopeReady });
  const geofences = useMemo(() => geofenceData || [], [geofenceData]);
  const layersLoading = (layers.length > 0 && scopeReady && layers.some(layer => { const state = nearby?.states?.[layer]; return !state || /^Loading|waiting for the server/i.test(state); }))
    || Boolean(visibility.geofences && geofencesLoading) || wardsLoading;
  const draftPreviewStats = useMemo(() => buildGeofencePlanningDraftStats({ draftPoints, ...planningModel }), [draftPoints, planningModel]);
  const draftInside = <span>Draft meters inside: <strong>{model.readyIds.length} of {model.rows.length}</strong></span>;
  const completeness = <div role="status">{layers.map(layer => <span key={layer} style={{ display: "block" }}>{layer}: {nearby?.states?.[layer] || "Loading nearby records…"}</span>)}</div>;
  const handleCancelDraft = () => { drawing.clear(); setConfirmCreateModalOpen(false); setDraftName(""); setDraftDescription(""); setError(""); };
  const handleStartDrawing = () => {
    if (!scopeReady || saved || pendingFence || busy) return;
    if (!geofenceNamePart(draftName).trim()) { setError(`Type a name after "Gf W${draftWardNumber}".`); return; }
    drawing.clear(); drawing.setDrawing(true); setSelectedGeoFence(null); setCreateModalOpen(false); setError("");
  };
  const handleConfirmCreate = async () => {
    if (!canSaveDraft) return;
    try {
      await onSave({ name: standardDraftName, description: draftDescription.trim() || "NAv", parents: { lmPcode, wardPcode,
        countryPcode: "ZA", provincePcode: lmPcode.slice(0, 3), dmPcode: lmPcode.slice(0, -1) }, points: draftPoints.map((point, order) => ({ latitude: point.lat, longitude: point.lng, order })) });
      setCreateSuccess({ name: standardDraftName, wardLabel, stats: draftPreviewStats, isTcContext: false });
      handleCancelDraft();
    } catch (failure) { setError(salesDraftMessage(failure.message || failure.error || "Couldn't create the geofence. Try the same request again.")); }
  };
  const handleOpenCreateModal = () => { if (scopeReady && !saved && !pendingFence && !busy) { setCreateModalOpen(true); setError(""); } };
  const handleOpenCreateConfirm = () => { if (canSaveDraft) setConfirmCreateModalOpen(true); };
  const handleMapClick = event => { if (!isCreateMode || busy) return; const point = mapPoint(event.detail?.latLng); if (point) drawing.addPoint(point); };
  // Rules 18.7 (1.3.3): the Geofences layer shows every geofence in the Ward.
  const mapFences = useMemo(() => [...new Map([...(visibility.geofences ? geofences : []), ...(saved ? [draft.savedFence] : []), ...(selectedGeoFence ? [selectedGeoFence] : [])].map(fence => [fence.id, fence])).values()], [visibility.geofences, geofences, saved, draft.savedFence, selectedGeoFence]);
  // Rules 18.5 (1.3.3): Confirm Geofence lists overlapped geofences; information only.
  const overlapping = useMemo(() => draftPoints.length >= 3 ? geofences.filter(fence => fence.id !== draft.savedFence?.id && pathsOverlap(draftPoints, getGeoFencePath(fence))) : [], [draftPoints, geofences, draft.savedFence?.id]);
  const overlapsNote = <span>Overlaps: <strong>{overlapping.length ? overlapping.map(fence => `${fence.name || fence.id} (${geofenceKind(fence)})`).join(", ") : "none"}</strong></span>;
  // Rules TB-R040 (1.3.14): Create Batch sits next to Satellite, and the Geofence Created
  // window offers to go straight on to the batch.
  const createBatchButton = <button type="button" style={draftButtonStyle(createDisabled, true)} onClick={onCreate} disabled={createDisabled}>Create Batch</button>;
  const successAction = { label: "Now create the batch", waitingLabel: "Getting the batch ready…", waitingTitle: "The geofence is being linked to this draft", disabled: createDisabled,
    onClick: () => { setCreateSuccess(null); onCreate(); } };
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  return <div style={{ minWidth: 0 }}>
    <GeofenceToolbar wardControl={<div style={wardSelectWrapStyle}>Ward: <strong>{wardLabel}</strong></div>}
      {...{ geofencesLoading, geofences, setListModalOpen, handleOpenCreateModal, scopeReady, setMapTypeId, mapTypeId, selectedGeoFence, setSelectedGeoFence }} createDisabled={saved || pendingFence || busy} extraActions={createBatchButton}/>
    {error && <p role="alert">{error}</p>}
    <GeofenceDrawingBar {...{ isCreateMode, draftName, draftPoints, draftPolygonReady, draftPreviewStats, canSaveDraft, createState, handleCancelDraft, handleOpenCreateConfirm, draftInside, completeness }} inline
      handleUndoPoint={() => { if (!busy) drawing.undo(); }} handleRestartDraft={() => { if (!busy) drawing.setPoints([]); }}/>
    <p>Layers show the area near the batch (50 m margin), within its Ward. Draft meters are always shown.</p>
    <div style={{ ...mapShellStyle, height: 560 }}>
      {!key ? <p>Google Maps key missing</p> : !bounds ? (locating || !live?.ready || !Object.keys(draft.resolutions).length
        ? <div style={mapBusyStyle}><BusySpinner label="Locating meters…" size={20}/></div>
        : <p role="status">No draft meters could be located. Press Locate meters again.</p>) : <APIProvider apiKey={key}>
        <GoogleMap defaultCenter={{ lat: (bounds.minLat + bounds.maxLat) / 2, lng: (bounds.minLng + bounds.maxLng) / 2 }} defaultZoom={18} mapTypeId={mapTypeId} gestureHandling="greedy" disableDefaultUI={false} onClick={handleMapClick} style={{ width: "100%", height: "100%" }}>
          <GeofencePlanningLayers model={planningModel} {...{ visibility, salesStatusVisibility, isCreateMode, meterPoints }}/>
          {visibility.wards && <WardBoundaryPolygons wards={wardLayer}/>}
          <ExistingGeoFenceLayer geofences={mapFences} selectedGeoFenceId={selectedGeoFence?.id || ""} onSelectGeoFence={setSelectedGeoFence} interactive={!isCreateMode} fitSelected={false}/>
          {isCreateMode && <DraftGeoFenceLayer draftPoints={draftPoints}/>}
          <SalesBatchMapLayers rows={model.rows} highlightedId={highlightedId} onHighlight={onHighlight}/>
          <GeofencesLayerCamera active={Boolean(visibility.geofences)} geofences={geofences} meterPoints={meterPoints}/>
        </GoogleMap>
      </APIProvider>}
      {bounds && layersLoading && <div style={layersLoadingStripStyle}><BusySpinner label="Loading map layers…" size={14}/></div>}
      {bounds && <GeofencePlanningLayerControls model={planningModel} {...{ visibility, salesStatusVisibility }}
        onToggleLayer={layer => setVisibility(current => ({ ...current, [layer]: !current[layer] }))} onToggleSalesStatus={status => setSalesStatusVisibility(current => ({ ...current, [status]: !current[status] }))}
        salesLabel="Sales" layerStates={nearby?.states || {}} requestedLayers={layers} disabled={!scopeReady} geofencesCount={geofences.length} geofencesLoading={geofencesLoading} showWards wardsCount={visibility.wards ? wardLayer.length : null} wardsLoading={wardsLoading}/>}
    </div>
    <p style={legendStyle}>Your draft's meters: G = position from address · S = Sales GPS; a thick outline marks a meter left out of the batch.
      Nearby GPS Sales: <SalesStatusGlyph status={SALES_STATUSES.NOT_STARTED}/> Not Started · <SalesStatusGlyph status={SALES_STATUSES.IN_PROGRESS}/> In Progress · <SalesStatusGlyph status={SALES_STATUSES.COMPLETED}/> Completed.
      Hover a meter or row to highlight both.</p>
    <GeofenceDialogs {...{ listModalOpen, wardLabel, setListModalOpen, selectedGeoFence, setSelectedGeoFence, createModalOpen, setCreateModalOpen, draftName, setDraftName, draftDescription, setDraftDescription, handleStartDrawing, confirmCreateModalOpen, setConfirmCreateModalOpen, draftPreviewStats, createState, handleConfirmCreate, createSuccess, setCreateSuccess, draftInside, completeness }} overlaps={overlapsNote} visibleGeofences={geofences} lockedWard wardNumber={draftWardNumber} successAction={successAction}/>
  </div>;
}

const legendStyle = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, margin: "8px 0 0", color: "#334155", fontSize: 13, lineHeight: 1.5 };
const mapBusyStyle = { display: "grid", placeItems: "center", height: "100%", color: "#334155", fontSize: 15 };
const layersLoadingStripStyle = { position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 60, padding: "6px 12px", borderRadius: 999, background: "rgba(255,255,255,0.95)", boxShadow: "0 4px 12px rgba(15,23,42,0.18)", color: "#334155", fontSize: 13, pointerEvents: "none" };

// Rules 18.7 (1.3.4): switching the Geofences layer on fits the view to every Ward
// geofence plus the draft's meters; switching it off returns to the draft's meters.
// Only reacts to a change of the switch (and to the geofence list arriving after it
// was switched on), so panning and zooming are never overridden while you work.
function GeofencesLayerCamera({ active, geofences, meterPoints }) {
  const map = useMap();
  const previous = useRef({ active, fittedCount: -1 });
  useEffect(() => {
    if (!map || !window.google?.maps) return undefined;
    const state = previous.current;
    const switched = state.active !== active;
    const listArrived = active && !switched && state.fittedCount !== geofences.length;
    if (!switched && !listArrived) return undefined;
    state.active = active;
    state.fittedCount = active ? geofences.length : -1;
    const points = active ? [...geofences.flatMap(fence => getGeoFencePath(fence)), ...meterPoints] : meterPoints;
    if (!points.length) return undefined;
    const bounds = new window.google.maps.LatLngBounds();
    points.forEach(point => bounds.extend(point));
    map.fitBounds(bounds, 48);
    const listener = map.addListener("idle", () => { if (map.getZoom() > 19) map.setZoom(19); listener.remove(); });
    return () => listener.remove();
  }, [map, active, geofences, meterPoints]);
  return null;
}
