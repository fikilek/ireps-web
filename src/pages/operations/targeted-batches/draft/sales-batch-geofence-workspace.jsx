/* eslint-disable no-unused-vars -- JSX tags are used by React. */
import { useMemo, useState } from "react";
import { APIProvider, Map as GoogleMap } from "@vis.gl/react-google-maps";
import { useGetGeoFencesByWardQuery } from "../../../../redux/geofencesApi";
import { useGetSalesBatchNearbyQuery } from "../../../../redux/salesTargetedBatchApi";
import { GeofenceToolbar, GeofenceDrawingBar, GeofenceDialogs } from "../../geofence-shared-ui";
import { DraftGeoFenceLayer, ExistingGeoFenceLayer } from "../../geofence-map-layers";
import { GeofencePlanningLayerControls, GeofencePlanningLayers, SalesStatusGlyph } from "../../GeofencePlanningLayers";
import { SALES_STATUSES } from "../../../sales/models/salesStatusModel.js";
import { buildGeofencePlanningDraftStats } from "../../geofencePlanningModel";
import { mapShellStyle, wardSelectWrapStyle } from "../../geofence-ui-styles";
import { geofenceKind, getGeoFencePath, pathsOverlap } from "../../geofence-map-helpers";
import { NEARBY_LAYERS, emptyNearbyModel, locatedMeterBounds, mapPoint } from "../../../../features/maps/sales-batch-nearby.js";
import { salesDraftWardLabel, salesDraftMessage } from "./sales-batch-draft-model";
import SalesBatchMapLayers from "./sales-batch-map-layers";

export default function SalesBatchGeofenceWorkspace({ draft, model, live, drawing, busy, locating, saving, onSave, highlightedId, onHighlight }) {
  const lmPcode = draft.scope.lmPcode, wardPcode = model.wards.length === 1 ? model.wards[0] : "";
  const ward = live?.wards?.[wardPcode], wardLabel = wardPcode ? salesDraftWardLabel(wardPcode, ward) : "Keep one Ward to create a geofence";
  const scopeReady = Boolean(wardPcode && ward && live?.ready);
  const saved = draft.savedFence?.status === "ACTIVE" && Boolean(draft.savedFence.targetedBatch);
  const pendingFence = Boolean(draft.savedFence?.id && !draft.savedFence.status);
  const [mapTypeId, setMapTypeId] = useState("roadmap"), [selectedGeoFence, setSelectedGeoFence] = useState(null);
  const [listModalOpen, setListModalOpen] = useState(false), [createModalOpen, setCreateModalOpen] = useState(false), [confirmCreateModalOpen, setConfirmCreateModalOpen] = useState(false), [createSuccess, setCreateSuccess] = useState(null);
  const [draftName, setDraftName] = useState(""), [draftDescription, setDraftDescription] = useState(""), [error, setError] = useState("");
  const [visibility, setVisibility] = useState({ erfs: false, sales: false, premises: false, assets: false, geofences: false });
  const [salesStatusVisibility, setSalesStatusVisibility] = useState({ notStarted: true, inProgress: true, completed: true });
  const isCreateMode = drawing.drawing && !saved && !pendingFence;
  const draftPoints = drawing.points, draftPolygonReady = draftPoints.length >= 3, canSaveDraft = Boolean(draftName.trim() && model.canSave && !busy);
  const createState = { isLoading: saving };
  const bounds = useMemo(() => locatedMeterBounds(model.rows), [model.rows]);
  const meterPoints = useMemo(() => model.rows.map(row => mapPoint(row.point)).filter(Boolean), [model.rows]);
  const layers = NEARBY_LAYERS.filter(layer => visibility[layer] || isCreateMode);
  const { data: nearby } = useGetSalesBatchNearbyQuery({ lmPcode, wardPcode, bounds, wardGeometry: ward?.geometry, layers }, { skip: !scopeReady || !bounds || !layers.length });
  const planningModel = nearby?.model || emptyNearbyModel();
  const { data: geofences = [], isLoading: geofencesLoading } = useGetGeoFencesByWardQuery({ lmPcode, wardPcode }, { skip: !scopeReady });
  const draftPreviewStats = useMemo(() => buildGeofencePlanningDraftStats({ draftPoints, ...planningModel }), [draftPoints, planningModel]);
  const draftInside = <span>Draft meters inside: <strong>{model.readyIds.length} of {model.rows.length}</strong></span>;
  const completeness = <div role="status">{layers.map(layer => <span key={layer} style={{ display: "block" }}>{layer}: {nearby?.states?.[layer] || "Loading nearby records…"}</span>)}</div>;
  const handleCancelDraft = () => { drawing.clear(); setConfirmCreateModalOpen(false); setDraftName(""); setDraftDescription(""); setError(""); };
  const handleStartDrawing = () => {
    if (!scopeReady || saved || pendingFence || busy) return;
    if (!draftName.trim()) { setError("Geofence name is required."); return; }
    drawing.clear(); drawing.setDrawing(true); setSelectedGeoFence(null); setCreateModalOpen(false); setError("");
  };
  const handleConfirmCreate = async () => {
    if (!canSaveDraft) return;
    try {
      await onSave({ name: draftName.trim(), description: draftDescription.trim() || "NAv", parents: { lmPcode, wardPcode,
        countryPcode: "ZA", provincePcode: lmPcode.slice(0, 3), dmPcode: lmPcode.slice(0, -1) }, points: draftPoints.map((point, order) => ({ latitude: point.lat, longitude: point.lng, order })) });
      setCreateSuccess({ name: draftName.trim(), wardLabel, stats: draftPreviewStats, isTcContext: false });
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
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  return <div style={{ minWidth: 0 }}>
    <GeofenceToolbar wardControl={<div style={wardSelectWrapStyle}>Ward: <strong>{wardLabel}</strong></div>}
      {...{ geofencesLoading, geofences, setListModalOpen, handleOpenCreateModal, scopeReady, setMapTypeId, mapTypeId, selectedGeoFence, setSelectedGeoFence }} createDisabled={saved || pendingFence || busy}/>
    {error && <p role="alert">{error}</p>}
    <GeofenceDrawingBar {...{ isCreateMode, draftName, draftPoints, draftPolygonReady, draftPreviewStats, canSaveDraft, createState, handleCancelDraft, handleOpenCreateConfirm, draftInside, completeness }} inline
      handleUndoPoint={() => { if (!busy) drawing.undo(); }} handleRestartDraft={() => { if (!busy) drawing.setPoints([]); }}/>
    <p>Layers show the area near the batch (50 m margin), within its Ward. Draft meters are always shown.</p>
    <div style={{ ...mapShellStyle, height: 560 }}>
      {!key ? <p>Google Maps key missing</p> : !bounds ? <p role="status">{locating || !live?.ready || !Object.keys(draft.resolutions).length ? "Locating meters…" : "No draft meters could be located. Press Locate meters again."}</p> : <APIProvider apiKey={key}>
        <GoogleMap defaultCenter={{ lat: (bounds.minLat + bounds.maxLat) / 2, lng: (bounds.minLng + bounds.maxLng) / 2 }} defaultZoom={18} mapTypeId={mapTypeId} gestureHandling="greedy" disableDefaultUI={false} onClick={handleMapClick} style={{ width: "100%", height: "100%" }}>
          <GeofencePlanningLayers model={planningModel} {...{ visibility, salesStatusVisibility, isCreateMode, meterPoints }}/>
          <ExistingGeoFenceLayer geofences={mapFences} selectedGeoFenceId={selectedGeoFence?.id || ""} onSelectGeoFence={setSelectedGeoFence} interactive={!isCreateMode} fitSelected={false}/>
          {isCreateMode && <DraftGeoFenceLayer draftPoints={draftPoints}/>}
          <SalesBatchMapLayers rows={model.rows} highlightedId={highlightedId} onHighlight={onHighlight}/>
        </GoogleMap>
      </APIProvider>}
      {bounds && <GeofencePlanningLayerControls model={planningModel} {...{ visibility, salesStatusVisibility }}
        onToggleLayer={layer => setVisibility(current => ({ ...current, [layer]: !current[layer] }))} onToggleSalesStatus={status => setSalesStatusVisibility(current => ({ ...current, [status]: !current[status] }))}
        salesLabel="Sales" layerStates={nearby?.states || {}} requestedLayers={layers} disabled={!scopeReady} geofencesCount={geofences.length}/>}
    </div>
    <p style={legendStyle}>Your draft's meters: G = position from address · S = Sales GPS; a thick outline marks a meter left out of the batch.
      Nearby GPS Sales: <SalesStatusGlyph status={SALES_STATUSES.NOT_STARTED}/> Not Started · <SalesStatusGlyph status={SALES_STATUSES.IN_PROGRESS}/> In Progress · <SalesStatusGlyph status={SALES_STATUSES.COMPLETED}/> Completed.
      Hover a meter or row to highlight both.</p>
    <GeofenceDialogs {...{ listModalOpen, wardLabel, setListModalOpen, selectedGeoFence, setSelectedGeoFence, createModalOpen, setCreateModalOpen, draftName, setDraftName, draftDescription, setDraftDescription, handleStartDrawing, confirmCreateModalOpen, setConfirmCreateModalOpen, draftPreviewStats, createState, handleConfirmCreate, createSuccess, setCreateSuccess, draftInside, completeness }} overlaps={overlapsNote} visibleGeofences={geofences} lockedWard/>
  </div>;
}

const legendStyle = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, margin: "8px 0 0", color: "#334155", fontSize: 13, lineHeight: 1.5 };
