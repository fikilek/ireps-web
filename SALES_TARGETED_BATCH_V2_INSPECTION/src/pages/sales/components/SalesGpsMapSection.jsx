/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useEffect, useMemo, useRef, useState } from "react";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { APIProvider, Map, useMap } from "@vis.gl/react-google-maps";

import { useWarehouse } from "@/context/WarehouseContext";
import { useGetGeoFencesByWardQuery } from "../../../redux/geofencesApi";

const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const FALLBACK_CENTER = { lat: -28.168, lng: 30.236 };

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeWardNumber(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const numeric = Number(text.replace(/\D/g, ""));
  return Number.isFinite(numeric) ? String(numeric) : text.toUpperCase();
}

function getWardNumber(ward = {}) {
  return (
    ward?.code ||
    ward?.wardNumber ||
    ward?.wardNo ||
    ward?.wardNumberLabel ||
    ""
  );
}

function getWardPcode(ward = {}) {
  return ward?.id || ward?.pcode || ward?.wardPcode || "";
}

function getWardLmPcode(ward = {}) {
  return (
    ward?.parents?.lmPcode ||
    ward?.lmPcode ||
    ward?.localMunicipalityPcode ||
    ""
  );
}

function getRowLmPcode(rows = []) {
  return (
    rows.find((row) => String(row?.lmPcode || "").trim())?.lmPcode || ""
  );
}

function getRowGeofenceRefs(row = {}) {
  return Array.isArray(row?.geofenceRefs)
    ? row.geofenceRefs.filter((ref) => ref?.id)
    : [];
}

function parseGeometry(geometry) {
  if (!geometry) return null;

  if (typeof geometry === "string") {
    try {
      return JSON.parse(geometry);
    } catch (error) {
      console.error("Could not parse Sales GPS ward geometry:", error);
      return null;
    }
  }

  return geometry;
}

function geoJsonPolygonToGooglePaths(geometry) {
  if (!geometry) return [];

  if (geometry.type === "Polygon") {
    return geometry.coordinates.map((ring) =>
      ring.map(([lng, lat]) => ({ lat, lng })),
    );
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.flatMap((polygon) =>
      polygon.map((ring) => ring.map(([lng, lat]) => ({ lat, lng }))),
    );
  }

  return [];
}

function geofenceGeometryToGooglePaths(geometry) {
  const parsedGeometry = parseGeometry(geometry);

  if (!parsedGeometry) return [];

  if (Array.isArray(parsedGeometry?.points)) {
    const ring = parsedGeometry.points
      .map((point) => ({
        lat: Number(point?.latitude ?? point?.lat),
        lng: Number(point?.longitude ?? point?.lng),
      }))
      .filter(
        (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng),
      );

    return ring.length >= 3 ? [ring] : [];
  }

  return geoJsonPolygonToGooglePaths(parsedGeometry);
}

function fitMapToBbox(map, bbox) {
  if (!map || !bbox || !window.google?.maps) return false;

  const minLat = Number(bbox.minLat ?? bbox.minLatitude);
  const minLng = Number(bbox.minLng ?? bbox.minLongitude);
  const maxLat = Number(bbox.maxLat ?? bbox.maxLatitude);
  const maxLng = Number(bbox.maxLng ?? bbox.maxLongitude);

  if (![minLat, minLng, maxLat, maxLng].every(Number.isFinite)) {
    return false;
  }

  const bounds = new window.google.maps.LatLngBounds();

  bounds.extend({ lat: minLat, lng: minLng });
  bounds.extend({ lat: maxLat, lng: maxLng });

  map.fitBounds(bounds, 42);
  return true;
}

function fitMapToPaths(map, paths = []) {
  if (!map || !window.google?.maps || paths.length === 0) return false;

  const bounds = new window.google.maps.LatLngBounds();
  let pointCount = 0;

  paths.forEach((ring) => {
    ring.forEach((point) => {
      if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) return;
      bounds.extend(point);
      pointCount += 1;
    });
  });

  if (pointCount === 0) return false;

  map.fitBounds(bounds, 42);
  return true;
}

function getWardGpsPoints(rows = [], selectedWardNo = "") {
  if (!selectedWardNo) return [];

  const normalizedSelectedWard = normalizeWardNumber(selectedWardNo);
  const points = [];

  rows.forEach((row) => {
    const rowWardNumbers = Array.isArray(row?.wardNumbers)
      ? row.wardNumbers.map(normalizeWardNumber)
      : [];

    const candidates = Array.isArray(row?.erfCandidates)
      ? row.erfCandidates
      : [];

    candidates.forEach((candidate, candidateIndex) => {
      const latitude = Number(candidate?.latitude);
      const longitude = Number(candidate?.longitude);
      const candidateWardNo = normalizeWardNumber(candidate?.wardNumber);
      const belongsToWard = candidateWardNo
        ? candidateWardNo === normalizedSelectedWard
        : rowWardNumbers.includes(normalizedSelectedWard);

      if (
        candidate?.hasValidGps !== true ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        !belongsToWard
      ) {
        return;
      }

      points.push({
        id: `${row?.id || row?.meterNo || "meter"}_${
          candidate?.erfId || candidate?.erfNumber || candidateIndex
        }_${latitude}_${longitude}`,
        meterId: row?.id || row?.meterNo || `meter_${candidateIndex}`,
        meterNo: row?.meterNo || "NAv",
        accountNumber: row?.accountNumber || "NAv",
        customerName: row?.customerName || "NAv",
        addressLine1: row?.addressLine1 || "NAv",
        town: row?.town || "NAv",
        wardNo: candidate?.wardNumber || selectedWardNo,
        erfNumber: candidate?.erfNumber || "NAv",
        erfId: candidate?.erfId || "NAv",
        latitude,
        longitude,
      });
    });
  });

  return points;
}

function SalesWardBoundaryLayer({ wardBoundary, fitRequest, fitEnabled }) {
  const map = useMap();
  const polygonRef = useRef(null);

  const paths = useMemo(() => {
    return geoJsonPolygonToGooglePaths(
      parseGeometry(wardBoundary?.geometry),
    );
  }, [wardBoundary?.geometry]);

  useEffect(() => {
    if (!map || !window.google?.maps) return undefined;

    if (polygonRef.current) {
      polygonRef.current.setMap(null);
      polygonRef.current = null;
    }

    if (!wardBoundary || paths.length === 0) return undefined;

    const polygon = new window.google.maps.Polygon({
      paths,
      strokeColor: "#1d4ed8",
      strokeOpacity: 1,
      strokeWeight: 3,
      fillColor: "#2563eb",
      fillOpacity: 0.1,
      clickable: false,
      zIndex: 10,
    });

    polygon.setMap(map);
    polygonRef.current = polygon;

    if (fitEnabled) {
      if (!fitMapToBbox(map, wardBoundary?.bbox)) {
        fitMapToPaths(map, paths);
      }
    }

    return () => {
      if (polygonRef.current) {
        polygonRef.current.setMap(null);
        polygonRef.current = null;
      }
    };
  }, [fitEnabled, map, paths, wardBoundary]);

  useEffect(() => {
    if (
      !map ||
      !wardBoundary ||
      paths.length === 0 ||
      fitRequest === 0 ||
      !fitEnabled
    ) {
      return;
    }

    if (!fitMapToBbox(map, wardBoundary?.bbox)) {
      fitMapToPaths(map, paths);
    }
  }, [fitEnabled, fitRequest, map, paths, wardBoundary]);

  return null;
}

function SalesGeofenceBoundaryLayer({ geofence, fitRequest }) {
  const map = useMap();
  const polygonRef = useRef(null);

  const paths = useMemo(
    () => geofenceGeometryToGooglePaths(geofence?.geometry),
    [geofence?.geometry],
  );

  useEffect(() => {
    if (!map || !window.google?.maps) return undefined;

    if (polygonRef.current) {
      polygonRef.current.setMap(null);
      polygonRef.current = null;
    }

    if (!geofence || paths.length === 0) return undefined;

    const polygon = new window.google.maps.Polygon({
      paths,
      strokeColor: "#047857",
      strokeOpacity: 1,
      strokeWeight: 4,
      fillColor: "#10b981",
      fillOpacity: 0.18,
      clickable: false,
      zIndex: 20,
    });

    polygon.setMap(map);
    polygonRef.current = polygon;

    if (!fitMapToBbox(map, geofence?.geometry?.bbox)) {
      fitMapToPaths(map, paths);
    }

    return () => {
      if (polygonRef.current) {
        polygonRef.current.setMap(null);
        polygonRef.current = null;
      }
    };
  }, [geofence, map, paths]);

  useEffect(() => {
    if (!map || !geofence || paths.length === 0 || fitRequest === 0) {
      return;
    }

    if (!fitMapToBbox(map, geofence?.geometry?.bbox)) {
      fitMapToPaths(map, paths);
    }
  }, [fitRequest, geofence, map, paths]);

  return null;
}

function fitMapToPoints(map, points = []) {
  if (!map || !window.google?.maps || points.length === 0) return;

  if (points.length === 1) {
    map.panTo({
      lat: points[0].latitude,
      lng: points[0].longitude,
    });
    map.setZoom(18);
    return;
  }

  const bounds = new window.google.maps.LatLngBounds();

  points.forEach((point) => {
    bounds.extend({
      lat: point.latitude,
      lng: point.longitude,
    });
  });

  map.fitBounds(bounds, 48);
}

function SalesGpsMarkers({ points, fitRequest, fitPointsAutomatically }) {
  const map = useMap();
  const clustererRef = useRef(null);
  const markersRef = useRef([]);
  const infoWindowRef = useRef(null);

  useEffect(() => {
    if (!map || !window.google?.maps) return undefined;

    if (clustererRef.current) {
      clustererRef.current.clearMarkers();
      clustererRef.current = null;
    }

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];

    if (infoWindowRef.current) {
      infoWindowRef.current.close();
    }

    if (points.length === 0) return undefined;

    const infoWindow = new window.google.maps.InfoWindow();
    infoWindowRef.current = infoWindow;

    const markers = points.map((point) => {
      const marker = new window.google.maps.Marker({
        position: {
          lat: point.latitude,
          lng: point.longitude,
        },
        map,
        title: `Meter ${point.meterNo}`,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: "#dc2626",
          fillOpacity: 0.96,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
        zIndex: 40,
      });

      marker.addListener("click", () => {
        infoWindow.setContent(`
          <div style="font-family: Arial, sans-serif; min-width: 240px;">
            <strong>Meter ${escapeHtml(point.meterNo)}</strong>
            <div style="margin-top: 7px;">Account: ${escapeHtml(
              point.accountNumber,
            )}</div>
            <div>Customer: ${escapeHtml(point.customerName)}</div>
            <div>Address: ${escapeHtml(point.addressLine1)}</div>
            <div>Town: ${escapeHtml(point.town)}</div>
            <div>Ward: ${escapeHtml(point.wardNo)}</div>
            <div>ERF: ${escapeHtml(point.erfNumber)}</div>
          </div>
        `);

        infoWindow.open({
          anchor: marker,
          map,
          shouldFocus: false,
        });
      });

      return marker;
    });

    markersRef.current = markers;
    clustererRef.current = new MarkerClusterer({
      map,
      markers,
    });

    if (fitPointsAutomatically) {
      fitMapToPoints(map, points);
    }

    return () => {
      infoWindow.close();

      if (clustererRef.current) {
        clustererRef.current.clearMarkers();
        clustererRef.current = null;
      }

      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
      infoWindowRef.current = null;
    };
  }, [fitPointsAutomatically, map, points]);

  useEffect(() => {
    if (
      !map ||
      points.length === 0 ||
      fitRequest === 0 ||
      !fitPointsAutomatically
    ) {
      return;
    }

    fitMapToPoints(map, points);
  }, [fitPointsAutomatically, fitRequest, map, points]);

  return null;
}

export default function SalesGpsMapSection({
  rows = [],
  wardOptions = [],
  selectedWardNo = "",
  selectedGeofenceId = "",
  onSelectedWardNoChange,
  onSelectedGeofenceIdChange,
}) {
  const { available, sync } = useWarehouse();
  const [fitRequest, setFitRequest] = useState(0);

  const wardBoundaries = useMemo(
    () => available?.wards || [],
    [available?.wards],
  );

  const selectedWardBoundary = useMemo(() => {
    const normalizedSelectedWard = normalizeWardNumber(selectedWardNo);

    if (!normalizedSelectedWard) return null;

    return (
      wardBoundaries.find(
        (ward) =>
          normalizeWardNumber(getWardNumber(ward)) ===
          normalizedSelectedWard,
      ) || null
    );
  }, [selectedWardNo, wardBoundaries]);

  const selectedLmPcode =
    getWardLmPcode(selectedWardBoundary) || getRowLmPcode(rows);
  const selectedWardPcode = getWardPcode(selectedWardBoundary);

  const {
    data: wardGeofences = [],
    isFetching: isFetchingGeofences,
    isError: hasGeofenceLoadError,
  } = useGetGeoFencesByWardQuery(
    {
      lmPcode: selectedLmPcode,
      wardPcode: selectedWardPcode,
    },
    {
      skip:
        !selectedWardNo ||
        !selectedLmPcode ||
        !selectedWardPcode,
    },
  );

  const hasNoGeofenceSelected = selectedGeofenceId === "NONE";

  const activeSelectedGeofenceId = hasNoGeofenceSelected
    ? "NONE"
    : wardGeofences.some(
          (geofence) => geofence?.id === selectedGeofenceId,
        )
      ? selectedGeofenceId
      : "";

  const selectedGeofence =
    activeSelectedGeofenceId && activeSelectedGeofenceId !== "NONE"
      ? wardGeofences.find(
          (geofence) => geofence?.id === activeSelectedGeofenceId,
        ) || null
      : null;

  const mapRows = useMemo(() => {
    if (!activeSelectedGeofenceId) return rows;

    if (activeSelectedGeofenceId === "NONE") {
      return rows.filter((row) => getRowGeofenceRefs(row).length === 0);
    }

    return rows.filter((row) =>
      getRowGeofenceRefs(row).some(
        (ref) => ref?.id === activeSelectedGeofenceId,
      ),
    );
  }, [activeSelectedGeofenceId, rows]);

  const points = useMemo(
    () => getWardGpsPoints(mapRows, selectedWardNo),
    [mapRows, selectedWardNo],
  );

  const gpsMeterCount = useMemo(
    () => new Set(points.map((point) => point.meterId)).size,
    [points],
  );

  const mapCenter = points[0]
    ? { lat: points[0].latitude, lng: points[0].longitude }
    : FALLBACK_CENTER;

  const wardSyncStatus = sync?.wards?.status || "idle";
  const hasWardBoundary = Boolean(selectedWardBoundary);
  const hasSelectedGeofence = Boolean(selectedGeofence);
  const selectedGeofenceName =
    selectedGeofence?.name || selectedGeofence?.id || "";

  return (
    <section style={styles.panel}>
      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Sales GPS Map</p>
          <h3 style={styles.title}>Meters with GPS by ward</h3>
          <p style={styles.subtitle}>
            Select a ward, then optionally select one of its geofences to
            draw the polygon and display only its clustered Sales GPS meters.
          </p>
        </div>

        <div style={styles.controls}>
          {selectedWardNo ? (
            <label style={styles.wardLabel}>
              Geofence
              <select
                value={activeSelectedGeofenceId}
                onChange={(event) =>
                  onSelectedGeofenceIdChange?.(event.target.value)
                }
                style={styles.geofenceSelect}
                disabled={
                  !selectedWardPcode ||
                  isFetchingGeofences ||
                  hasGeofenceLoadError
                }
              >
                <option value="">
                  {isFetchingGeofences
                    ? "Loading geofences..."
                    : "All geofences"}
                </option>
                <option value="NONE">No geofence</option>
                {wardGeofences.map((geofence) => (
                  <option key={geofence.id} value={geofence.id}>
                    {geofence.name || geofence.id}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label style={styles.wardLabel}>
            Ward
            <select
              value={selectedWardNo}
              onChange={(event) => {
                onSelectedGeofenceIdChange?.("");
                onSelectedWardNoChange?.(event.target.value);
              }}
              style={styles.wardSelect}
            >
              <option value="">Select ward</option>
              {wardOptions.map((wardNo) => (
                <option key={wardNo} value={wardNo}>
                  Ward {wardNo}
                </option>
              ))}
            </select>
          </label>

          <span style={styles.countBadge}>
            {gpsMeterCount} GPS meter{gpsMeterCount === 1 ? "" : "s"}
          </span>

          <button
            type="button"
            style={{
              ...styles.fitButton,
              ...(!hasWardBoundary && points.length === 0
                ? styles.disabledButton
                : null),
            }}
            onClick={() => setFitRequest((current) => current + 1)}
            disabled={!hasWardBoundary && points.length === 0}
          >
            {hasSelectedGeofence ? "Fit Geofence" : "Fit Ward"}
          </button>
        </div>
      </div>

      {!selectedWardNo ? (
        <div style={styles.emptyState}>
          <strong>Select a ward to display its boundary and GPS meters.</strong>
          <span>
            The map remains unloaded until a ward is selected.
          </span>
        </div>
      ) : !googleMapsApiKey ? (
        <div style={styles.emptyState}>
          <strong>Google Maps key missing.</strong>
          <span>
            Add VITE_GOOGLE_MAPS_API_KEY to the web environment and restart
            Vite.
          </span>
        </div>
      ) : (
        <>
          {!hasWardBoundary ? (
            <div style={styles.warningState}>
              Ward {selectedWardNo} boundary is not available from the Warehouse
              ward layer. Ward sync status: {wardSyncStatus}.
            </div>
          ) : null}

          {hasGeofenceLoadError ? (
            <div style={styles.warningState}>
              Geofences could not be loaded for Ward {selectedWardNo}.
            </div>
          ) : null}

          {activeSelectedGeofenceId &&
          activeSelectedGeofenceId !== "NONE" &&
          !hasSelectedGeofence ? (
            <div style={styles.warningState}>
              The selected geofence is no longer available in Ward{" "}
              {selectedWardNo}.
            </div>
          ) : null}

          {points.length === 0 ? (
            <div style={styles.warningState}>
              {hasSelectedGeofence
                ? `No usable Sales GPS meters were found in ${selectedGeofenceName}.`
                : hasNoGeofenceSelected
                  ? "No usable Sales GPS meters without a geofence were found in this ward."
                  : `No usable GPS meters were found for Ward ${selectedWardNo}.`}
            </div>
          ) : null}

          <div style={styles.mapWrap}>
            <APIProvider apiKey={googleMapsApiKey}>
              <Map
                defaultCenter={mapCenter}
                defaultZoom={13}
                mapTypeId="roadmap"
                gestureHandling="greedy"
                disableDefaultUI={false}
                style={{ width: "100%", height: "100%" }}
              >
                <SalesWardBoundaryLayer
                  wardBoundary={selectedWardBoundary}
                  fitRequest={fitRequest}
                  fitEnabled={!hasSelectedGeofence}
                />
                <SalesGeofenceBoundaryLayer
                  geofence={selectedGeofence}
                  fitRequest={fitRequest}
                />
                <SalesGpsMarkers
                  points={points}
                  fitRequest={fitRequest}
                  fitPointsAutomatically={!hasWardBoundary && !hasSelectedGeofence}
                />
              </Map>
            </APIProvider>
          </div>

          <div style={styles.footer}>
            <span>
              Ward {selectedWardNo}:{" "}
              {hasWardBoundary ? "boundary loaded" : "boundary unavailable"}
              {hasSelectedGeofence
                ? ` · ${selectedGeofenceName}: polygon loaded`
                : hasNoGeofenceSelected
                  ? " · No geofence"
                  : ""}
            </span>
            <span>
              {gpsMeterCount} GPS meter{gpsMeterCount === 1 ? "" : "s"} ·{" "}
              {points.length} map point{points.length === 1 ? "" : "s"}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

const styles = {
  panel: {
    margin: "0 1rem 0.9rem",
    border: "1px solid #bfdbfe",
    borderRadius: "0.9rem",
    background: "#f8fbff",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "0.9rem 1rem",
    borderBottom: "1px solid #dbeafe",
    flexWrap: "wrap",
  },
  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: "0.7rem",
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  title: {
    margin: "0.2rem 0 0",
    color: "#0f172a",
    fontSize: "1rem",
  },
  subtitle: {
    margin: "0.35rem 0 0",
    color: "#64748b",
    fontSize: "0.82rem",
    lineHeight: 1.45,
  },
  controls: {
    display: "flex",
    alignItems: "flex-end",
    gap: "0.6rem",
    flexWrap: "wrap",
  },
  wardLabel: {
    display: "grid",
    gap: "0.28rem",
    color: "#475569",
    fontSize: "0.72rem",
    fontWeight: 850,
  },
  wardSelect: {
    minWidth: "150px",
    border: "1px solid #93c5fd",
    borderRadius: "0.65rem",
    padding: "0.52rem 0.65rem",
    background: "#ffffff",
    color: "#0f172a",
    fontWeight: 750,
  },
  geofenceSelect: {
    minWidth: "210px",
    border: "1px solid #6ee7b7",
    borderRadius: "0.65rem",
    padding: "0.52rem 0.65rem",
    background: "#ffffff",
    color: "#0f172a",
    fontWeight: 750,
  },
  countBadge: {
    alignSelf: "flex-end",
    borderRadius: "999px",
    padding: "0.52rem 0.7rem",
    background: "#dcfce7",
    color: "#166534",
    fontSize: "0.76rem",
    fontWeight: 900,
  },
  fitButton: {
    alignSelf: "flex-end",
    border: "1px solid #2563eb",
    borderRadius: "0.65rem",
    padding: "0.52rem 0.7rem",
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 850,
    cursor: "pointer",
  },
  disabledButton: {
    opacity: 0.48,
    cursor: "not-allowed",
  },
  mapWrap: {
    width: "100%",
    height: "min(54vh, 520px)",
    minHeight: "380px",
    background: "#e2e8f0",
  },
  emptyState: {
    minHeight: "180px",
    display: "grid",
    placeContent: "center",
    gap: "0.45rem",
    padding: "1.25rem",
    color: "#475569",
    textAlign: "center",
  },
  warningState: {
    padding: "0.65rem 1rem",
    borderBottom: "1px solid #fde68a",
    background: "#fffbeb",
    color: "#92400e",
    fontSize: "0.78rem",
    fontWeight: 750,
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    gap: "0.75rem",
    padding: "0.7rem 1rem",
    borderTop: "1px solid #dbeafe",
    color: "#475569",
    fontSize: "0.78rem",
    fontWeight: 750,
    flexWrap: "wrap",
  },
};
