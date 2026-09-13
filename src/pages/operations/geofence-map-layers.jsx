import { getGeoFencePath, fitMapToGeoFence, GEOFENCE_KIND_COLORS, geofenceKind, geofenceLabelPoint } from "./geofence-map-helpers";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
import { useEffect, useMemo, useRef } from "react";
import { useMap } from "@vis.gl/react-google-maps";
export function ExistingGeoFenceLayer({
  geofences,
  selectedGeoFenceId,
  onSelectGeoFence,
  interactive = true,
  fitSelected = true,
}) {
  const map = useMap();
  const polygonsRef = useRef([]);

  const selectedGeoFence = useMemo(() => {
    return (
      (geofences || []).find(
        (geoFence) => geoFence.id === selectedGeoFenceId,
      ) || null
    );
  }, [geofences, selectedGeoFenceId]);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    polygonsRef.current.forEach((polygon) => polygon.setMap(null));
    polygonsRef.current = [];
    const infoWindows = [];
    const labels = [];

    const polygons = (geofences || [])
      .map((geoFence) => {
        const path = getGeoFencePath(geoFence);

        if (path.length < 3) return null;

        const selected = selectedGeoFenceId === geoFence.id;
        // Rules 18.7 (1.3.3): area geofences green, batch geofences purple, selected red.
        const kind = geofenceKind(geoFence);
        const kindColor = GEOFENCE_KIND_COLORS[kind];

        const polygon = new window.google.maps.Polygon({
          paths: path,
          strokeColor: selected ? "#dc2626" : kindColor,
          strokeOpacity: 1,
          strokeWeight: selected ? 4 : 2,
          fillColor: selected ? "#dc2626" : kindColor,
          fillOpacity: selected ? 0.18 : 0.12,
          clickable: interactive,
          zIndex: selected ? 80 : 60,
        });

        const labelPoint = geofenceLabelPoint(geoFence);
        if (labelPoint) {
          labels.push(new window.google.maps.Marker({
            position: labelPoint,
            map,
            title: geoFence.name || geoFence.id,
            label: {
              text: String(geoFence.name || geoFence.id),
              className: "ireps-geofence-label",
              color: selected ? "#b91c1c" : kindColor,
              fontWeight: "600",
              fontSize: "11px",
            },
            icon: { path: window.google.maps.SymbolPath.CIRCLE, scale: 1, fillOpacity: 0, strokeOpacity: 0 },
            clickable: false,
            zIndex: 90,
          }));
        }

        if (interactive) {
          const kindLine = kind === "batch"
            ? `Batch geofence · ${escapeHtml(geoFence.targetedBatch?.tbId || "NAv")}`
            : "Area geofence";
          const infoWindow = new window.google.maps.InfoWindow({
            content: `
              <div style="font-family: Arial, sans-serif; min-width: 200px;">
                <strong>${escapeHtml(geoFence.name || geoFence.id)}</strong>
                <div style="margin-top: 4px; color: ${kindColor};">${kindLine}</div>
                <div style="margin-top: 4px;">${escapeHtml(geoFence.description || "NAv")}</div>
                <hr />
                <div>ERFs: ${Number(geoFence?.counts?.erfs) || 0}</div>
                <div>Premises: ${Number(geoFence?.counts?.premises) || 0}</div>
                <div>Meters: ${Number(geoFence?.counts?.meters) || 0}</div>
              </div>
            `,
          });

          infoWindows.push(infoWindow);

          polygon.addListener("click", (event) => {
            onSelectGeoFence?.(geoFence);

            infoWindow.setPosition(event.latLng);
            infoWindow.open({
              map,
              shouldFocus: false,
            });
          });
        }

        polygon.setMap(map);

        return polygon;
      })
      .filter(Boolean);

    polygonsRef.current = polygons;

    return () => {
      infoWindows.forEach((infoWindow) => infoWindow.close());
      labels.forEach((label) => label.setMap(null));
      polygonsRef.current.forEach((polygon) => polygon.setMap(null));
      polygonsRef.current = [];
    };
  }, [map, geofences, selectedGeoFenceId, onSelectGeoFence, interactive]);

  useEffect(() => {
    if (!map || !selectedGeoFence || !fitSelected) return;

    const timer = setTimeout(() => {
      fitMapToGeoFence(map, selectedGeoFence, 88);
    }, 120);

    return () => clearTimeout(timer);
  }, [map, selectedGeoFence, fitSelected]);

  return null;
}

export function DraftGeoFenceLayer({ draftPoints }) {
  const map = useMap();
  const polygonRef = useRef(null);
  const markersRef = useRef([]);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    if (polygonRef.current) {
      polygonRef.current.setMap(null);
      polygonRef.current = null;
    }

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];

    const markers = draftPoints.map((point, index) => {
      const marker = new window.google.maps.Marker({
        position: point,
        map,
        label: {
          text: String(index + 1),
          color: "#ffffff",
          fontWeight: "900",
        },
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: "#2563eb",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
        zIndex: 170,
        clickable: false,
      });

      return marker;
    });

    markersRef.current = markers;

    if (draftPoints.length >= 3) {
      const polygon = new window.google.maps.Polygon({
        paths: draftPoints,
        strokeColor: "#2563eb",
        strokeOpacity: 1,
        strokeWeight: 3,
        fillColor: "#2563eb",
        fillOpacity: 0.22,
        clickable: false,
        zIndex: 160,
      });

      polygon.setMap(map);
      polygonRef.current = polygon;
    }

    return () => {
      if (polygonRef.current) {
        polygonRef.current.setMap(null);
        polygonRef.current = null;
      }

      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
    };
  }, [map, draftPoints]);

  return null;
}

