import { useMemo } from "react";
import { skipToken } from "@reduxjs/toolkit/query";
import { useGetGeoFencesByLmQuery } from "../../../redux/mapGeofencesApi";

// Targeted Batch rules TB-R043: a batch's geofence, looked up by tb_uploads.geofenceId in the
// LM's active geofences (the list the app already keeps for its maps). Null when the batch
// has no geofence or the list has not arrived yet.
export function useBatchGeofence(lmPcode, geofenceId) {
  const { data } = useGetGeoFencesByLmQuery(lmPcode || skipToken);
  const id = String(geofenceId ?? "").trim();
  return useMemo(() => (id ? (data || []).find((fence) => fence?.id === id) || null : null), [data, id]);
}
