import { useEffect } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { attachTrnMeterConnections } from "./trnMeterConnections.js";
export default function TrnMeterConnectionLayer({ connections }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !window.google?.maps) return;
    return attachTrnMeterConnections(window.google.maps, map, connections);
  }, [map, connections]);
  return null;
}
