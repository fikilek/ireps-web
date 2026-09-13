import { useEffect } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { normalizeBatchGeometry } from "../../../../../functions/geofences/sales-batch-geometry.js";
import { draftReviewStyles as styles, draftButtonStyle } from "./targetedBatchDraftReviewStyles";

export function SalesBatchDrawingControls({ drawing, saved, disabled, canSave, onSave }) {
  return <div style={styles.headerActions}>
    <button type="button" style={draftButtonStyle(disabled || saved)} disabled={disabled || saved} onClick={() => drawing.setDrawing(true)}>Draw</button>
    <button type="button" style={draftButtonStyle(disabled || saved || !drawing.points.length)} disabled={disabled || saved || !drawing.points.length} onClick={drawing.undo}>Undo</button>
    <button type="button" style={draftButtonStyle(disabled || saved || !drawing.points.length)} disabled={disabled || saved || !drawing.points.length} onClick={drawing.clear}>Clear</button>
    <button type="button" style={draftButtonStyle(disabled || saved || drawing.points.length < 3)} disabled={disabled || saved || drawing.points.length < 3} onClick={drawing.finish}>Complete</button>
    <button type="button" style={draftButtonStyle(disabled || saved || !drawing.complete || !canSave)} disabled={disabled || saved || !drawing.complete || !canSave} onClick={onSave}>Save geofence</button>
    <span>{saved ? "Saved geofence · population fixed" : drawing.drawing ? "Click the map to add vertices" : `${drawing.points.length} vertices`}</span>
    {drawing.error && <span role="alert">{drawing.error}</span>}
  </div>;
}

export default function SalesBatchMapLayers({ ward, rows, geometry, drawing, points = [], addPoint }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !ward?.geometry) return;
    const layer = new window.google.maps.Data({ map });
    try {
      const boundary = normalizeBatchGeometry(ward.geometry);
      layer.addGeoJson({ type: "Feature", properties: {}, geometry: boundary });
      layer.setStyle({ fillOpacity: 0, strokeColor: "#7c3aed", strokeWeight: 2, clickable: false });
      const bounds = new window.google.maps.LatLngBounds();
      const visit = value => { if (typeof value[0] === "number") bounds.extend({ lng: value[0], lat: value[1] }); else value.forEach(visit); };
      visit(boundary.coordinates); map.fitBounds(bounds, 35);
    } catch { /* Readiness surfaces invalid geometry; no substitute boundary. */ }
    return () => layer.setMap(null);
  }, [map, ward]);
  useEffect(() => {
    if (!map || !points.length) return;
    const line = new window.google.maps.Polyline({ map, path: points, strokeColor: "#0d9488", strokeWeight: 3, clickable: false });
    const vertices = points.map((position, i) => new window.google.maps.Marker({ map, position, title: `Vertex ${i + 1}`, label: String(i + 1), clickable: false }));
    return () => { line.setMap(null); vertices.forEach(marker => marker.setMap(null)); };
  }, [map, points]);
  useEffect(() => {
    if (!map || !geometry) return;
    const layer = new window.google.maps.Data({ map });
    layer.addGeoJson({ type: "Feature", properties: {}, geometry });
    layer.setStyle({ fillColor: "#0d9488", fillOpacity: 0.12, strokeColor: "#0d9488", strokeWeight: 3, clickable: false });
    return () => layer.setMap(null);
  }, [map, geometry]);
  useEffect(() => {
    if (!map) return;
    const markers = rows.filter(row => row.point).map(row => new window.google.maps.Marker({ map,
      position: { lat: row.point.latitude, lng: row.point.longitude },
      title: `${row.meterNo} · ${row.pointSource === "GEOCODED" ? "Position from address" : "Sales GPS"} · ${row.reason}`,
      label: { text: row.pointSource === "GEOCODED" ? "G" : "S", color: "white" },
      icon: { path: row.salesWorkStatus === "IN_PROGRESS" ? "M 0,-1 L 1,1 L -1,1 Z" : row.salesWorkStatus === "COMPLETED" ? "M -1,-1 L 1,-1 L 1,1 L -1,1 Z" : window.google.maps.SymbolPath.CIRCLE,
        fillColor: row.salesWorkStatus === "IN_PROGRESS" ? "#b45309" : row.salesWorkStatus === "COMPLETED" ? "#0f766e" : "#2563eb", fillOpacity: 1, strokeColor: row.ready ? "white" : "#7c2d12", strokeWeight: row.ready ? 2 : 4, scale: 13 },
    }));
    const centroids = [...new Map(rows.filter(row => row.centroid).map(row => [row.erfId, row])).values()].map(row => new window.google.maps.Marker({ map,
      position: { lat: row.centroid[1], lng: row.centroid[0] }, title: `ERF ${row.erfId} centroid · context only`, clickable: false,
      icon: { path: "M -1,0 L 1,0 M 0,-1 L 0,1", strokeColor: "#111827", strokeWeight: 2, scale: 8 },
    }));
    return () => [...markers, ...centroids].forEach(marker => marker.setMap(null));
  }, [map, rows]);
  useEffect(() => {
    if (!map || !drawing) return;
    const listener = map.addListener("click", event => { if (event.latLng) addPoint({ lat: event.latLng.lat(), lng: event.latLng.lng() }); });
    return () => listener.remove();
  }, [map, drawing, addPoint]);
  return null;
}
