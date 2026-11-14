import BatchMapLayerControl from "./BatchMapLayerControl";
/* eslint-disable no-unused-vars -- JSX tags are consumed by React. */
import { useEffect, useMemo, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import SalesTargetedBatchMap from "../../sales/components/SalesTargetedBatchMap";
import { batchMapLayers } from "./bgoBatchLayersModel.js";
function FenceBoundaries({ boundaries }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !window.google?.maps) return;
    const layer = new window.google.maps.Data({ map });
    boundaries.forEach((geometry, index) => layer.addGeoJson({ type: "Feature", id: index, properties: {}, geometry }));
    layer.setStyle({ fillColor: "#7c3aed", fillOpacity: 0.06, strokeColor: "#7c3aed", strokeWeight: 2, clickable: false });
    return () => layer.setMap(null);
  }, [map, boundaries]);
  return null;
}
export default function BgoBatchMap({ erfs, premises, meters, geofence, geofences }) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState({ erfs: true, premises: true, meters: true });
  const fences = useMemo(() => geofences || (geofence ? [geofence] : []), [geofences, geofence]);
  const layers = useMemo(() => batchMapLayers({ erfs, premises, meters, geofences: fences }), [erfs, premises, meters, fences]);
  const boundary = useMemo(() => layers.boundaries.flatMap(geometry => (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates).flatMap(polygon => polygon.flatMap(ring => ring.map(([lng, lat]) => ({ lat, lng }))))), [layers.boundaries]);
  return <div style={{ position: "relative" }}>
    {!layers.boundaries.length ? <p role="status">The batch geofence boundary is unavailable. No assets are shown outside a verified batch boundary.</p> : null}
    <SalesTargetedBatchMap erfs={layers.erfs} premises={layers.premises} meters={layers.meters} batchBoundary={boundary} visibleLayers={visible}>
      <FenceBoundaries boundaries={layers.boundaries} />
    </SalesTargetedBatchMap>
    <BatchMapLayerControl open={open} setOpen={setOpen} visible={visible} setVisible={setVisible} counts={{ erfs: layers.erfs.length, premises: layers.premises.length, meters: layers.meters.length }} />
  </div>;
}
