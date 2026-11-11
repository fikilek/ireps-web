/* eslint-disable no-unused-vars -- JSX tags are consumed by the JSX transform. */
import { useEffect, useRef } from "react";
import { APIProvider, Map, useMap } from "@vis.gl/react-google-maps";
import { mdMapAreaColour } from "./mdBgoMapDashboardModel.js";

function BoundaryLayers({ model, mode, selectedKey, metric, fitRequest, onSelect, onError }) {
  const map = useMap();
  const layerRef = useRef(null);
  const areasRef = useRef(new globalThis.Map());
  const geometrySignature = JSON.stringify(model.areas.filter(area => area.geometry).map(area => ({ type: "Feature", id: area.key, properties: { key: area.key, kind: area.kind }, geometry: area.geometry })));

  useEffect(() => { areasRef.current = new globalThis.Map(model.areas.map(area => [area.key, area])); }, [model]);

  useEffect(() => {
    if (!map || !window.google?.maps) return undefined;
    const layer = new window.google.maps.Data({ map });
    const info = new window.google.maps.InfoWindow({ disableAutoPan: true });
    layerRef.current = layer;
    const listeners = [];
    try {
      layer.addGeoJson({ type: "FeatureCollection", features: JSON.parse(geometrySignature) });
      listeners.push(layer.addListener("click", event => { const key = event.feature.getProperty("key"); info.close(); onSelect(key); }));
      listeners.push(layer.addListener("mouseover", event => {
        const area = areasRef.current.get(event.feature.getProperty("key"));
        if (!area) return;
        const content = document.createElement("div");
        content.style.cssText = "font:12px Arial;color:#0f172a;max-width:240px";
        const heading = document.createElement("strong"); heading.textContent = area.name; content.append(heading);
        const detail = document.createElement("div"); detail.textContent = `${area.summary.batched} batched ERFs · ${area.summary.batchCount} batches · ${area.summary.total} work rows`; content.append(detail);
        info.setContent(content); info.setPosition(event.latLng); info.open({ map, shouldFocus: false });
      }));
      listeners.push(layer.addListener("mouseout", () => info.close()));
    } catch (error) { onError(error.message || "Map boundaries could not be drawn."); }
    return () => { listeners.forEach(listener => listener.remove()); info.close(); layer.setMap(null); if (layerRef.current === layer) layerRef.current = null; };
  }, [map, geometrySignature, onSelect, onError]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.setStyle(feature => {
      const area = model.areas.find(area => area.key === feature.getProperty("key"));
      if (!area) return { visible: false };
      const interactive = area.kind === mode;
      const selected = area.key === selectedKey;
      return { clickable: interactive, cursor: interactive ? "pointer" : "default", fillColor: mdMapAreaColour(area, metric), fillOpacity: interactive ? 0.4 : 0,
        strokeColor: selected ? "#245df4" : area.kind === "lm" ? "#1d4ed8" : area.kind === "wards" ? "#718a92" : "#547cb5",
        strokeOpacity: 1, strokeWeight: selected ? 3 : area.kind === "lm" ? 2.5 : 1, zIndex: selected && interactive ? 8 : area.kind === "geofences" ? 5 : area.kind === "wards" ? 3 : 1 };
    });
  }, [model, mode, selectedKey, metric, geometrySignature]);

  useEffect(() => {
    if (!map || !window.google?.maps || !layerRef.current) return;
    const bounds = new window.google.maps.LatLngBounds();
    const selected = JSON.parse(geometrySignature).find(feature => feature.id === selectedKey);
    const ids = fitRequest.lm ? [model.lm.key] : selected && selectedKey !== model.lm.key ? [selectedKey] : mode === "geofences" ? model.fences.filter(fence => fence.geometry).map(fence => fence.key) : [model.lm.key];
    layerRef.current.forEach(feature => { if (ids.includes(feature.getProperty("key"))) feature.getGeometry()?.forEachLatLng(point => bounds.extend(point)); });
    if (!bounds.isEmpty()) map.fitBounds(bounds, 48);
  // Metrics stream without refitting the reader's map. Refit only on navigation or geometry changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, geometrySignature, selectedKey, mode, fitRequest]);
  return null;
}

export default function MdBgoDashboardMap(props) {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  return !key ? <p role="alert">The map service is not configured.</p> : <APIProvider apiKey={key} onError={() => props.onError("The map service could not be loaded. Please reopen the page to retry.")}>
    <Map defaultCenter={{ lat: -28.16, lng: 30.3 }} defaultZoom={10} mapTypeId="roadmap" gestureHandling="greedy" disableDefaultUI={false} style={{ width: "100%", height: "100%" }}>
      <BoundaryLayers {...props} />
    </Map>
  </APIProvider>;
}
