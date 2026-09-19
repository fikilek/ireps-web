/* eslint-disable no-unused-vars -- JSX tags are used by React. */
// Targeted Batch rules TB-R055.7 (1.3.49): TB Draft's Map Layers panel on the GPS Sales map, for the
// area on screen. The layer reads, drawing and labels are TB Draft's own (18.7); the reads use their
// own endpoint, which lets an area go 20 seconds after the screen leaves it.
import { useCallback, useMemo, useState } from "react";
import { useGetSalesMapNearbyLayerQuery } from "../../../redux/salesTargetedBatchApi";
import { useGetWardBoundariesByLmQuery } from "../../../redux/mapWardsApi";
import { GeofencePlanningLayerControls, GeofencePlanningLayers } from "../../operations/GeofencePlanningLayers";
import { ExistingGeoFenceLayer, WardBoundaryPolygons } from "../../operations/geofence-map-layers";
import { geoJsonPolygonToGooglePaths, parseGeometry, wardNameLabelPoint } from "../../operations/geofence-map-helpers";
import { wardNumberFromPcode } from "../../../../functions/geofences/geofence-name.js";
import { NEARBY_LAYERS, combineNearbyLayers } from "../../../features/maps/sales-batch-nearby.js";
import { SALES_MAP_LAYER_ZOOMED_OUT, salesMapLayerArea } from "../models/salesMapLayersModel.js";
import SalesMapViewport from "./sales-map-viewport.jsx";

// Fixed values, so the map layers are not rebuilt on every render (as TB Draft).
const NO_METER_POINTS = Object.freeze([]);
const NO_GEOFENCES = Object.freeze([]);
const ignoreSelect = () => {};
const sameView = (a, b) => Boolean(a && b) && ["south", "west", "north", "east", "zoom"].every(key => a[key] === b[key]);

// `renderOnMap` and `renderPanel` take whether a geofence is being drawn, which the drawing tool
// (it uses this hook's `planning` for its counts) knows only later in the render.
export function useSalesMapLayers({ lmPcode = "", wardPcode = "", wardGeofences = [] }) {
  const [visibility, setVisibility] = useState({ erfs: false, sales: false, premises: false, assets: false, geofences: false, wards: false });
  const [salesStatusVisibility, setSalesStatusVisibility] = useState({ notStarted: true, inProgress: true, completed: true });
  const [view, setView] = useState(null);
  const onViewportChange = useCallback(next => setView(current => (sameView(current, next) ? current : next)), []);
  // The grid area as text, so a new object for the same area never starts a new read.
  const areaKey = JSON.stringify(view ? salesMapLayerArea(view) : null);
  const bounds = useMemo(() => JSON.parse(areaKey), [areaKey]);
  const zoomedOut = Boolean(view) && !bounds;
  const ready = Boolean(lmPcode && wardPcode && bounds);
  const layerRead = layer => [{ lmPcode, wardPcode, bounds, layer }, { skip: !ready || !visibility[layer] }];
  const { data: erfsLayer } = useGetSalesMapNearbyLayerQuery(...layerRead("erfs"));
  const { data: salesLayer } = useGetSalesMapNearbyLayerQuery(...layerRead("sales"));
  const { data: premisesLayer } = useGetSalesMapNearbyLayerQuery(...layerRead("premises"));
  const { data: assetsLayer } = useGetSalesMapNearbyLayerQuery(...layerRead("assets"));
  // Zoomed out, nothing counts: an earlier area's records are not this area's.
  const model = useMemo(() => combineNearbyLayers(ready ? { erfs: erfsLayer, sales: salesLayer, premises: premisesLayer, assets: assetsLayer } : {}),
    [ready, erfsLayer, salesLayer, premisesLayer, assetsLayer]);
  const requestedLayers = NEARBY_LAYERS.filter(layer => visibility[layer]);
  const hasView = Boolean(view);
  const layerStates = useMemo(() => (zoomedOut || !hasView
    ? Object.fromEntries(NEARBY_LAYERS.map(layer => [layer, hasView ? SALES_MAP_LAYER_ZOOMED_OUT : "Waiting for the map…"]))
    : { erfs: erfsLayer?.state, sales: salesLayer?.state, premises: premisesLayer?.state, assets: assetsLayer?.state }),
  [zoomedOut, hasView, erfsLayer?.state, salesLayer?.state, premisesLayer?.state, assetsLayer?.state]);

  const { data: lmWards, isFetching: wardsFetching } = useGetWardBoundariesByLmQuery(lmPcode, { skip: !visibility.wards || !lmPcode });
  const wardLayer = useMemo(() => (lmWards || []).flatMap(ward => {
    const pcode = ward.wardPcode || ward.id, paths = geoJsonPolygonToGooglePaths(parseGeometry(ward.geometry));
    if (!paths.length) return [];
    const number = wardNumberFromPcode(pcode);
    return [{ id: pcode, paths, label: number ? `Ward ${number}` : ward.name, labelAbove: false, labelPoint: wardNameLabelPoint(paths, null, { centroid: ward.centroid }) }];
  }), [lmWards]);
  const wardsLoading = Boolean(visibility.wards && (wardsFetching || !lmWards?.length));

  // `meterPoints` are the map's red GPS pins ({ lat, lng }, a fixed list): an ERF number on a pin
  // moves just below it (1.3.50).
  const renderOnMap = (isCreateMode, meterPoints = NO_METER_POINTS) => <>
    <SalesMapViewport onChange={onViewportChange}/>
    <GeofencePlanningLayers model={model} visibility={visibility} salesStatusVisibility={salesStatusVisibility} isCreateMode={isCreateMode} meterPoints={meterPoints}/>
    {visibility.wards ? <WardBoundaryPolygons wards={wardLayer}/> : null}
    <ExistingGeoFenceLayer geofences={visibility.geofences ? wardGeofences : NO_GEOFENCES} selectedGeoFenceId="" onSelectGeoFence={ignoreSelect} interactive={!isCreateMode} fitSelected={false}/>
  </>;
  const renderPanel = isCreateMode => <GeofencePlanningLayerControls model={model} visibility={visibility} salesStatusVisibility={salesStatusVisibility} isCreateMode={isCreateMode}
    onToggleLayer={layer => setVisibility(current => ({ ...current, [layer]: !current[layer] }))}
    onToggleSalesStatus={status => setSalesStatusVisibility(current => ({ ...current, [status]: !current[status] }))}
    salesLabel="Sales" layerStates={layerStates} requestedLayers={requestedLayers} uncountedLabel="—" uncountedLayers={ready ? [] : NEARBY_LAYERS}
    countsNote="Counts are for the area on screen" geofencesCount={wardGeofences.length} showWards wardsCount={visibility.wards ? wardLayer.length : null} wardsLoading={wardsLoading}/>;
  // For the counts inside a shape being drawn: final only for loaded layers holding the whole shape.
  const planning = useMemo(() => ({ model, visibility, zoomedOut: !ready, layerStates, bounds }), [model, visibility, ready, layerStates, bounds]);
  return { renderOnMap, renderPanel, planning };
}
