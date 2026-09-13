import { useEffect, useRef } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { mapPoint } from "../../../../features/maps/sales-batch-nearby.js";
import { DRAFT_HIGHLIGHT_COLOR, DRAFT_HIGHLIGHT_WIDTH } from "./targetedBatchDraftReviewStyles.js";

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
  // Draft rows are rebuilt whenever any draft data changes. Redraw the markers only
  // when something they show changes, not on every rebuild (rules 18.7, 1.3.4).
  const markerKey = JSON.stringify(rows.flatMap(row => {
    const point = mapPoint(row.point);
    return point ? [{ salesId: row.salesId, point, status: row.salesWorkStatus || null, ready: Boolean(row.ready), source: row.pointSource || null, meterNo: row.meterNo || "", reason: row.reason || "" }] : [];
  }));
  useEffect(() => {
    if (!map || !window.google?.maps) return;
    const listeners = [], currentMarkers = markers.current;
    for (const item of JSON.parse(markerKey)) {
      // The draft's own meters are always lettered circles (G/S); the triangle, star
      // and square belong to nearby Sales status icons (rules 18.7).
      const icon = { path: window.google.maps.SymbolPath.CIRCLE,
        fillColor: item.status === "IN_PROGRESS" ? "#b45309" : item.status === "COMPLETED" ? "#0f766e" : "#2563eb", fillOpacity: 1, strokeColor: item.ready ? "white" : "#7c2d12", strokeWeight: item.ready ? 2 : 4, scale: 13 };
      const marker = new window.google.maps.Marker({ map, position: item.point, title: `${item.meterNo} · ${item.source === "GEOCODED" ? "Position from address" : "Sales GPS"} · ${item.reason}`, label: { text: item.source === "GEOCODED" ? "G" : "S", color: "white" }, icon, zIndex: 200 });
      listeners.push(marker.addListener("mouseover", () => onHighlight(item.salesId)), marker.addListener("mouseout", () => onHighlight(null)));
      currentMarkers.set(item.salesId, { marker, icon });
    }
    return () => { listeners.forEach(listener => listener.remove()); currentMarkers.forEach(({ marker }) => marker.setMap(null)); currentMarkers.clear(); };
  }, [map, markerKey, onHighlight]);
  useEffect(() => {
    markers.current.forEach(({ marker, icon }, id) => { const selected = id === highlightedId; marker.setIcon(selected ? { ...icon, scale: 19, strokeColor: DRAFT_HIGHLIGHT_COLOR, strokeWeight: DRAFT_HIGHLIGHT_WIDTH } : icon); marker.setZIndex(selected ? 1000 : 200); });
  }, [highlightedId, markerKey]);
  return null;
}
