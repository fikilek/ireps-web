import { useEffect } from "react";
import { useMap } from "@vis.gl/react-google-maps";

// Targeted Batch rules TB-R055.7: reports the area on screen each time the map comes to rest.
export default function SalesMapViewport({ onChange }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return undefined;
    const report = () => {
      const bounds = map.getBounds();
      if (!bounds) return;
      const north = bounds.getNorthEast(), south = bounds.getSouthWest();
      onChange({ south: south.lat(), west: south.lng(), north: north.lat(), east: north.lng(), zoom: map.getZoom() });
    };
    const listener = map.addListener("idle", report);
    report();
    return () => listener.remove();
  }, [map, onChange]);
  return null;
}
