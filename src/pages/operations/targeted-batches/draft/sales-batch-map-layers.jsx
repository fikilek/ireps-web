import { useEffect, useRef } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { mapPoint } from "../../../../features/maps/sales-batch-nearby.js";

export default function SalesBatchMapLayers({ rows, highlightedId, onHighlight }) {
  const map = useMap(), markers = useRef(new Map());
  const cameraKey = JSON.stringify(rows.flatMap(row => { const point = mapPoint(row.point); return point ? [[row.salesId, point.lat, point.lng]] : []; }));
  useEffect(() => {
    if (!map || !window.google?.maps) return;
    const coordinates = JSON.parse(cameraKey);
    if (!coordinates.length) return;
    const bounds = new window.google.maps.LatLngBounds();
    coordinates.forEach(([, lat, lng]) => bounds.extend({ lat, lng }));
    map.fitBounds(bounds, 48);
    const listener = map.addListener("idle", () => { if (map.getZoom() > 19) map.setZoom(19); listener.remove(); });
    return () => listener.remove();
  }, [map, cameraKey]);
  useEffect(() => {
    if (!map || !window.google?.maps) return;
    const listeners = [], currentMarkers = markers.current;
    for (const row of rows) {
      const position = mapPoint(row.point); if (!position) continue;
      const icon = { path: row.salesWorkStatus === "IN_PROGRESS" ? "M 0,-1 L 1,1 L -1,1 Z" : row.salesWorkStatus === "COMPLETED" ? "M -1,-1 L 1,-1 L 1,1 L -1,1 Z" : window.google.maps.SymbolPath.CIRCLE,
        fillColor: row.salesWorkStatus === "IN_PROGRESS" ? "#b45309" : row.salesWorkStatus === "COMPLETED" ? "#0f766e" : "#2563eb", fillOpacity: 1, strokeColor: row.ready ? "white" : "#7c2d12", strokeWeight: row.ready ? 2 : 4, scale: 13 };
      const marker = new window.google.maps.Marker({ map, position, title: `${row.meterNo} · ${row.pointSource === "GEOCODED" ? "Position from address" : "Sales GPS"} · ${row.reason}`, label: { text: row.pointSource === "GEOCODED" ? "G" : "S", color: "white" }, icon, zIndex: 200 });
      listeners.push(marker.addListener("mouseover", () => onHighlight(row.salesId)), marker.addListener("mouseout", () => onHighlight(null)));
      currentMarkers.set(row.salesId, { marker, icon });
    }
    return () => { listeners.forEach(listener => listener.remove()); currentMarkers.forEach(({ marker }) => marker.setMap(null)); currentMarkers.clear(); };
  }, [map, rows, onHighlight]);
  useEffect(() => {
    markers.current.forEach(({ marker, icon }, id) => { const selected = id === highlightedId; marker.setIcon(selected ? { ...icon, scale: 19, strokeColor: "#facc15", strokeWeight: 5 } : icon); marker.setZIndex(selected ? 1000 : 200); });
  }, [highlightedId, rows]);
  return null;
}
