/* eslint-disable no-unused-vars -- JSX tags are used by React. */
import { useMemo, useState } from "react";
import { APIProvider, Map as GoogleMap } from "@vis.gl/react-google-maps";
import { useGetGeoFencesByWardQuery } from "../../../../redux/geofencesApi";
import { useGetSalesBatchNearbyQuery } from "../../../../redux/salesTargetedBatchApi";
import { GeofenceToolbar, GeofenceDrawingBar, GeofenceDialogs } from "../../geofence-shared-ui";
import { DraftGeoFenceLayer, ExistingGeoFenceLayer } from "../../geofence-map-layers";
import { GeofencePlanningLayerControls, GeofencePlanningLayers } from "../../GeofencePlanningLayers";
import { buildGeofencePlanningDraftStats } from "../../geofencePlanningModel";
import { mapShellStyle, wardSelectWrapStyle } from "../../geofence-ui-styles";
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
  const [visibility, setVisibility] = useState({ erfs: false, sales: false, premises: false, assets: false });
  const [salesStatusVisibility, setSalesStatusVisibility] = useState({ notStarted: true, inProgress: true, completed: true });
  const isCreateMode = drawing.drawing && !saved && !pendingFence;
  const draftPoints = drawing.points, draftPolygonReady = draftPoints.length >= 3, canSaveDraft = Boolean(draftName.trim() && model.canSave && !busy);
  const createState = { isLoading: saving };
  const bounds = useMemo(() => locatedMeterBounds(model.rows), [model.rows]);
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
  const mapFences = useMemo(() => [...new Map([...(saved ? [draft.savedFence] : []), ...(selectedGeoFence ? [selectedGeoFence] : [])].map(fence => [fence.id, fence])).values()], [saved, draft.savedFence, selectedGeoFence]);
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
          <GeofencePlanningLayers model={planningModel} {...{ visibility, salesStatusVisibility, isCreateMode }}/>
          <ExistingGeoFenceLayer geofences={mapFences} selectedGeoFenceId={selectedGeoFence?.id || ""} onSelectGeoFence={setSelectedGeoFence} interactive={!isCreateMode} fitSelected={false}/>
          {isCreateMode && <DraftGeoFenceLayer draftPoints={draftPoints}/>}
          <SalesBatchMapLayers rows={model.rows} highlightedId={highlightedId} onHighlight={onHighlight}/>
        </GoogleMap>
      </APIProvider>}
      {bounds && <GeofencePlanningLayerControls model={planningModel} {...{ visibility, salesStatusVisibility }}
        onToggleLayer={layer => setVisibility(current => ({ ...current, [layer]: !current[layer] }))} onToggleSalesStatus={status => setSalesStatusVisibility(current => ({ ...current, [status]: !current[status] }))}
        salesLabel="Sales" layerStates={nearby?.states || {}} requestedLayers={layers} disabled={!scopeReady}/>}
    </div>
    <p>G = Position from address · S = Sales GPS. Circle / blue = Not Started; triangle / amber = In Progress; square / green = Completed. A thick outline marks a meter left out of the batch. Hover a meter or row to highlight both.</p>
    <GeofenceDialogs {...{ listModalOpen, wardLabel, setListModalOpen, selectedGeoFence, setSelectedGeoFence, createModalOpen, setCreateModalOpen, draftName, setDraftName, draftDescription, setDraftDescription, handleStartDrawing, confirmCreateModalOpen, setConfirmCreateModalOpen, draftPreviewStats, createState, handleConfirmCreate, createSuccess, setCreateSuccess, draftInside, completeness }} visibleGeofences={geofences} lockedWard/>
  </div>;
}
