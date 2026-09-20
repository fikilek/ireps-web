/* eslint-disable no-unused-vars -- JSX tags are used by React. */
// Targeted Batch rules TB-R055.7 (1.3.63): TB Draft's Map Layers panel on the GPS Sales map, loading
// only near the work — within 50 m of the geofence being drawn, or, when nothing is being drawn,
// within 50 m of the area covering the ticked meters, and inside the Ward. Nothing loads until
// meters are ticked or a geofence is being drawn. The layer reads, drawing and labels are TB Draft's
// own (18.7), through TB Draft's own endpoint, so both maps read the same way and keep an area
// loaded for the same 10 minutes.
import { useMemo, useState } from "react";
import { useGetSalesBatchNearbyLayerQuery } from "../../../redux/salesTargetedBatchApi";
import { useGetWardBoundariesByLmQuery } from "../../../redux/mapWardsApi";
import { GeofencePlanningLayerControls, GeofencePlanningLayers } from "../../operations/GeofencePlanningLayers";
import { ExistingGeoFenceLayer, WardBoundaryPolygons } from "../../operations/geofence-map-layers";
import { geoJsonPolygonToGooglePaths, parseGeometry, wardNameLabelPoint } from "../../operations/geofence-map-helpers";
import { wardNumberFromPcode } from "../../../../functions/geofences/geofence-name.js";
import { NEARBY_LAYERS, combineNearbyLayers } from "../../../features/maps/sales-batch-nearby.js";
import { SALES_MAP_LAYER_COUNTS_NOTE, SALES_MAP_LAYER_NO_WORK, salesMapLayerArea } from "../models/salesMapLayersModel.js";

// Fixed values, so the map layers are not rebuilt on every render (as TB Draft).
const NO_METER_POINTS = Object.freeze([]);
const NO_GEOFENCES = Object.freeze([]);
const ignoreSelect = () => {};

// `renderOnMap` and `renderPanel` take whether a geofence is being drawn, which the drawing tool
// (it uses this hook's `planning` for its counts) knows only later in the render.
// `drawingPoints` are the points of the shape being drawn (empty when nothing is being drawn) and
// `tickedPoints` the GPS points of the meters ticked in the table: the work the layers stay near.
export function useSalesMapLayers({ lmPcode = "", wardPcode = "", wardGeofences = [], drawingPoints = NO_METER_POINTS, tickedPoints = NO_METER_POINTS }) {
  const [visibility, setVisibility] = useState({ erfs: false, sales: false, premises: false, assets: false, geofences: false, wards: false });
  const [salesStatusVisibility, setSalesStatusVisibility] = useState({ notStarted: true, inProgress: true, completed: true });
  // The area as text, so a new object for the same area never starts a new read.
  const areaKey = JSON.stringify(salesMapLayerArea({ drawingPoints, tickedPoints }));
  const bounds = useMemo(() => JSON.parse(areaKey), [areaKey]);
  const ready = Boolean(lmPcode && wardPcode && bounds);
  const layerRead = layer => [{ lmPcode, wardPcode, bounds, layer }, { skip: !ready || !visibility[layer] }];
  const { data: erfsLayer } = useGetSalesBatchNearbyLayerQuery(...layerRead("erfs"));
  const { data: salesLayer } = useGetSalesBatchNearbyLayerQuery(...layerRead("sales"));
  const { data: premisesLayer } = useGetSalesBatchNearbyLayerQuery(...layerRead("premises"));
  const { data: assetsLayer } = useGetSalesBatchNearbyLayerQuery(...layerRead("assets"));
  // With no work to be near, nothing counts: an earlier area's records are not this area's.
  const model = useMemo(() => combineNearbyLayers(ready ? { erfs: erfsLayer, sales: salesLayer, premises: premisesLayer, assets: assetsLayer } : {}),
    [ready, erfsLayer, salesLayer, premisesLayer, assetsLayer]);
  const requestedLayers = NEARBY_LAYERS.filter(layer => visibility[layer]);
  const layerStates = useMemo(() => (ready
    ? { erfs: erfsLayer?.state, sales: salesLayer?.state, premises: premisesLayer?.state, assets: assetsLayer?.state }
    : Object.fromEntries(NEARBY_LAYERS.map(layer => [layer, SALES_MAP_LAYER_NO_WORK]))),
  [ready, erfsLayer?.state, salesLayer?.state, premisesLayer?.state, assetsLayer?.state]);

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
    <GeofencePlanningLayers model={model} visibility={visibility} salesStatusVisibility={salesStatusVisibility} isCreateMode={isCreateMode} meterPoints={meterPoints}/>
    {visibility.wards ? <WardBoundaryPolygons wards={wardLayer}/> : null}
    <ExistingGeoFenceLayer geofences={visibility.geofences ? wardGeofences : NO_GEOFENCES} selectedGeoFenceId="" onSelectGeoFence={ignoreSelect} interactive={!isCreateMode} fitSelected={false}/>
  </>;
  const renderPanel = isCreateMode => <GeofencePlanningLayerControls model={model} visibility={visibility} salesStatusVisibility={salesStatusVisibility} isCreateMode={isCreateMode}
    onToggleLayer={layer => setVisibility(current => ({ ...current, [layer]: !current[layer] }))}
    onToggleSalesStatus={status => setSalesStatusVisibility(current => ({ ...current, [status]: !current[status] }))}
    salesLabel="Sales" layerStates={layerStates} requestedLayers={requestedLayers} uncountedLabel="—" uncountedLayers={ready ? [] : NEARBY_LAYERS}
    countsNote={SALES_MAP_LAYER_COUNTS_NOTE} geofencesCount={wardGeofences.length} showWards wardsCount={visibility.wards ? wardLayer.length : null} wardsLoading={wardsLoading}/>;
  // For the counts inside a shape being drawn: final only for ticked layers loaded for that area.
  const planning = useMemo(() => ({ model, visibility, ready, layerStates }), [model, visibility, ready, layerStates]);
  return { renderOnMap, renderPanel, planning };
}
