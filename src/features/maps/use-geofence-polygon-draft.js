import { useCallback, useState } from "react";
import { polygonFromPoints } from "../../../functions/geofences/sales-batch-geometry.js";

export function useGeofencePolygonDraft() {
  const [points, setPoints] = useState([]);
  const [drawing, setDrawing] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");
  const clear = useCallback(() => { setPoints([]); setComplete(false); setDrawing(false); setError(""); }, []);
  const addPoint = useCallback(point => { setPoints(current => current.length < 300 ? [...current, point] : current); setComplete(false); }, []);
  const finish = useCallback(() => {
    try { polygonFromPoints(points); setComplete(true); setDrawing(false); setError(""); }
    catch (failure) { setError(failure.message); }
  }, [points]);
  return { points, setPoints, drawing, setDrawing, complete, error, clear, addPoint, finish,
    undo: () => { setPoints(current => current.slice(0, -1)); setComplete(false); setError(""); } };
}
