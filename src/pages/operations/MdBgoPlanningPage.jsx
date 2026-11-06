/* eslint-disable no-unused-vars -- JSX component tags are consumed by the JSX transform. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { APIProvider, Map, useMap } from "@vis.gl/react-google-maps";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import { useGetLmBoundaryByIdQuery } from "../../redux/mapLmsApi";
import { useGetWardBoundariesByLmQuery } from "../../redux/mapWardsApi";
import { useGetErfsByWardQuery } from "../../redux/wardErfsApi";
import { useGetPremisesByWardQuery } from "../../redux/mapPremisesApi";
import { useGetAstsByLmPcodeWardPcodeQuery } from "../../redux/astsApi";
import {
  useGetGeoFencesByWardQuery,
  useCreateGeoFenceMutation,
} from "../../redux/geofencesApi";
import { useCreateBgoMutation } from "../../redux/bgoApi";

import {
  getGeoFencePath,
  geofenceLabelPoint,
  toUsableLatLng,
  fitMapToGeoFence,
} from "./geofence-map-helpers";

import { polygonFromPoints, strictlyInside } from "../../../functions/geofences/sales-batch-geometry.js";
import {
  composeGeofenceName,
  findDuplicateGeofence,
  duplicateGeofenceNameMessage,
  geofenceNamePart,
  wardNumberFromPcode,
} from "../../../functions/geofences/geofence-name.js";

const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const FALLBACK_CENTER = { lat: -28.168, lng: 30.236 };
const BGO_ERF_LIMIT = 60;

function resolveWorkbase(auth = {}, geoState = {}) {
  const candidate =
    auth?.activeWorkbase ||
    auth?.profile?.access?.activeWorkbase ||
    auth?.profile?.activeWorkbase ||
    auth?.activeLm ||
    (Array.isArray(auth?.workbases) && auth.workbases[0]) ||
    (Array.isArray(auth?.profile?.access?.workbases) && auth.profile.access.workbases[0]) ||
    geoState?.selectedLm ||
    null;

  const pcode = String(
    candidate?.lmPcode ||
      candidate?.pcode ||
      candidate?.id ||
      candidate?.localMunicipalityId ||
      "",
  ).trim();

  const lmName = String(
    candidate?.name ||
      candidate?.lmName ||
      candidate?.id ||
      candidate?.pcode ||
      "NAv",
  ).trim();

  return {
    lmPcode: pcode === "NAv" ? "" : pcode,
    lmName,
  };
}

function parseGeometry(geometry) {
  if (!geometry) return null;
  if (typeof geometry === "string") {
    try {
      return JSON.parse(geometry);
    } catch {
      return null;
    }
  }
  return geometry;
}

function geoJsonPolygonToGooglePaths(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    return (geometry.coordinates || []).map((ring) =>
      ring.map(([lng, lat]) => ({ lat, lng })),
    );
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates || []).flatMap((polygon) =>
      polygon.map((ring) => ring.map(([lng, lat]) => ({ lat, lng }))),
    );
  }
  return [];
}

function fitMapToBounds(map, paths = []) {
  if (!map || !window.google?.maps || !Array.isArray(paths) || paths.length === 0) return;
  const bounds = new window.google.maps.LatLngBounds();
  let count = 0;
  paths.forEach((ring) => {
    const pts = Array.isArray(ring) ? ring : [ring];
    pts.forEach((pt) => {
      const lat = Number(pt?.lat ?? pt?.latitude);
      const lng = Number(pt?.lng ?? pt?.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        bounds.extend({ lat, lng });
        count++;
      }
    });
  });
  if (count > 0) map.fitBounds(bounds, 36);
}

function fitMapToBbox(map, bbox) {
  if (!map || !window.google?.maps || !bbox) return;
  try {
    if (Array.isArray(bbox) && bbox.length >= 4) {
      const bounds = new window.google.maps.LatLngBounds(
        { lat: Number(bbox[1]), lng: Number(bbox[0]) },
        { lat: Number(bbox[3]), lng: Number(bbox[2]) },
      );
      map.fitBounds(bounds, 36);
    }
  } catch (err) {
    console.warn("Could not fit bbox:", err);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clearMapObjects(ref) {
  if (!ref.current) return;
  ref.current.forEach((item) => {
    if (typeof item.setMap === "function") item.setMap(null);
  });
  ref.current = [];
}

// Inner map child managing Google Maps drawing, layers, and viewport
function MdBgoMapInner({
  lmBoundary,
  wards = [],
  selectedWardPcode = "",
  onSelectWard,
  erfs = [],
  premises = [],
  meters = [],
  geofences = [],
  selectedGeofenceId = "",
  onSelectGeofence,
  showWardBoundariesLayer = true,
  showErfsLayer = true,
  showPremisesLayer = true,
  showMetersLayer = true,
  showGeofencesLayer = true,
  drawingPoints = [],
  isDrawing = false,
  onMapClick,
}) {
  const map = useMap();
  const infoWindowRef = useRef(null);

  const lmPolygonRef = useRef(null);
  const wardPolygonsRef = useRef([]);
  const erfPolygonsRef = useRef([]);
  const premiseMarkersRef = useRef([]);
  const meterMarkersRef = useRef([]);
  const geofencePolygonsRef = useRef([]);
  const draftPolylineRef = useRef(null);
  const draftPolygonRef = useRef(null);
  const draftMarkersRef = useRef([]);

  // Shared info window
  useEffect(() => {
    if (!map || !window.google?.maps) return;
    if (!infoWindowRef.current) {
      infoWindowRef.current = new window.google.maps.InfoWindow();
    }
    return () => {
      infoWindowRef.current?.close();
      infoWindowRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    if (isDrawing) infoWindowRef.current?.close();
  }, [isDrawing]);

  // Viewport management: Auto-fit to LM when no ward selected; fit to ward when ward selected
  useEffect(() => {
    if (!map || !window.google?.maps) return;

    if (!selectedWardPcode) {
      // Whole Municipality view
      const lmGeom = parseGeometry(lmBoundary?.geometry);
      const lmPaths = geoJsonPolygonToGooglePaths(lmGeom);
      if (lmPaths.length > 0) {
        fitMapToBounds(map, lmPaths);
      } else if (lmBoundary?.bbox) {
        fitMapToBbox(map, lmBoundary.bbox);
      } else if (wards.length > 0) {
        // Fallback: fit to all wards combined
        const allWardPaths = wards.flatMap((w) =>
          geoJsonPolygonToGooglePaths(parseGeometry(w.geometry)),
        );
        if (allWardPaths.length > 0) fitMapToBounds(map, allWardPaths);
      }
    } else {
      // Zoom into selected ward
      const activeWard = wards.find(
        (w) => (w.wardPcode || w.pcode || w.id) === selectedWardPcode,
      );
      if (activeWard?.geometry) {
        const wardPaths = geoJsonPolygonToGooglePaths(
          parseGeometry(activeWard.geometry),
        );
        if (wardPaths.length > 0) fitMapToBounds(map, wardPaths);
      }
    }
  }, [map, selectedWardPcode, lmBoundary, wards]);

  // Outer LM boundary polygon
  useEffect(() => {
    if (!map || !window.google?.maps) return;
    if (lmPolygonRef.current) lmPolygonRef.current.setMap(null);

    const lmGeom = parseGeometry(lmBoundary?.geometry);
    const lmPaths = geoJsonPolygonToGooglePaths(lmGeom);

    if (lmPaths.length > 0) {
      lmPolygonRef.current = new window.google.maps.Polygon({
        paths: lmPaths,
        strokeColor: "#0284c7",
        strokeOpacity: 0.9,
        strokeWeight: 3,
        fillColor: "#38bdf8",
        fillOpacity: 0.02,
        clickable: false,
        zIndex: 5,
      });
      lmPolygonRef.current.setMap(map);
    }

    return () => {
      if (lmPolygonRef.current) lmPolygonRef.current.setMap(null);
    };
  }, [map, lmBoundary]);

  // Ward boundaries layer (all wards in LM, highlighted if active)
  useEffect(() => {
    if (!map || !window.google?.maps) return;
    clearMapObjects(wardPolygonsRef);

    if (showWardBoundariesLayer && wards.length > 0) {
      const polys = [];

      wards.forEach((ward) => {
        const pcode = ward.wardPcode || ward.pcode || ward.id;
        const geom = parseGeometry(ward.geometry);
        const paths = geoJsonPolygonToGooglePaths(geom);
        if (paths.length === 0) return;

        const isSelected = pcode === selectedWardPcode;
        const wardNo = ward.wardNumber || wardNumberFromPcode(pcode);

        const poly = new window.google.maps.Polygon({
          paths,
          strokeColor: isSelected ? "#1d4ed8" : "#3b82f6",
          strokeOpacity: isSelected ? 1 : 0.7,
          strokeWeight: isSelected ? 3.5 : 1.5,
          fillColor: isSelected ? "#3b82f6" : "#60a5fa",
          fillOpacity: isSelected ? 0.12 : 0.04,
          clickable: !isDrawing,
          zIndex: isSelected ? 25 : 10,
        });

        if (!isDrawing) {
          poly.addListener("click", () => {
            if (typeof onSelectWard === "function") {
              onSelectWard(pcode);
            }
          });
        }

        poly.setMap(map);
        polys.push(poly);
      });

      wardPolygonsRef.current = polys;
    }

    return () => clearMapObjects(wardPolygonsRef);
  }, [map, wards, selectedWardPcode, showWardBoundariesLayer, isDrawing, onSelectWard]);

  // ERFs Layer (active ward only)
  useEffect(() => {
    if (!map || !window.google?.maps) return;
    clearMapObjects(erfPolygonsRef);

    if (Boolean(selectedWardPcode) && showErfsLayer && erfs.length > 0) {
      const polys = [];
      erfs.forEach((erf) => {
        const geom = parseGeometry(erf.geometry);
        const paths = geoJsonPolygonToGooglePaths(geom);
        if (paths.length > 0) {
          const poly = new window.google.maps.Polygon({
            paths,
            strokeColor: "#94a3b8",
            strokeOpacity: 0.7,
            strokeWeight: 1,
            fillColor: "#cbd5e1",
            fillOpacity: 0.1,
            clickable: false,
            zIndex: 30,
          });
          poly.setMap(map);
          polys.push(poly);
        }
      });
      erfPolygonsRef.current = polys;
    }

    return () => clearMapObjects(erfPolygonsRef);
  }, [map, selectedWardPcode, erfs, showErfsLayer]);

  // Premises Layer (active ward only)
  useEffect(() => {
    if (!map || !window.google?.maps) return;
    clearMapObjects(premiseMarkersRef);

    if (Boolean(selectedWardPcode) && showPremisesLayer && premises.length > 0) {
      const markers = [];

      premises.forEach((premise) => {
        const lat = Number(
          premise?.lat ??
            premise?.geometry?.centroid?.lat ??
            premise?.centroid?.lat,
        );
        const lng = Number(
          premise?.lng ??
            premise?.geometry?.centroid?.lng ??
            premise?.centroid?.lng,
        );
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const marker = new window.google.maps.Marker({
          position: { lat, lng },
          map,
          title: `Premise: ${premise.premiseAddress || premise.id}`,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 4,
            fillColor: "#2563eb",
            fillOpacity: 0.78,
            strokeColor: "#ffffff",
            strokeWeight: 1,
          },
          clickable: !isDrawing,
          zIndex: 40,
        });

        if (!isDrawing) {
          marker.addListener("click", () => {
            const infoWindow = infoWindowRef.current;
            if (!infoWindow) return;
            const address = premise.premiseAddress || "No Street Address";
            const id = premise.id || premise.premiseId || "NAv";
            const metersCount = premise.totalMeterCount ?? 0;
            infoWindow.setContent(`
              <div style="font-family: Arial, sans-serif; min-width: 180px; font-size: 13px;">
                <strong style="color: #0f172a; display: block; margin-bottom: 2px;">${escapeHtml(address)}</strong>
                <div style="color: #64748b; font-size: 11px;">Premise: ${escapeHtml(id)}</div>
                <div style="color: #2563eb; font-weight: 700; margin-top: 4px; font-size: 11px;">${metersCount} Known Meters</div>
              </div>
            `);
            infoWindow.open({ anchor: marker, map, shouldFocus: false });
          });
        }

        markers.push(marker);
      });

      premiseMarkersRef.current = markers;
    }

    return () => clearMapObjects(premiseMarkersRef);
  }, [map, selectedWardPcode, premises, showPremisesLayer, isDrawing]);

  // Meters (Assets) Layer (active ward only)
  useEffect(() => {
    if (!map || !window.google?.maps) return;
    clearMapObjects(meterMarkersRef);

    if (Boolean(selectedWardPcode) && showMetersLayer && meters.length > 0) {
      const markers = [];

      meters.forEach((meter) => {
        const lat = Number(
          meter?.ast?.location?.gps?.latitude ??
            meter?.ast?.location?.gps?.lat ??
            meter?.location?.gps?.latitude ??
            meter?.location?.gps?.lat ??
            meter?.gps?.latitude ??
            meter?.gps?.lat,
        );
        const lng = Number(
          meter?.ast?.location?.gps?.longitude ??
            meter?.ast?.location?.gps?.lng ??
            meter?.location?.gps?.longitude ??
            meter?.location?.gps?.lng ??
            meter?.gps?.longitude ??
            meter?.gps?.lng,
        );
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const meterNo = meter?.astData?.astNo || meter?.meterNo || meter?.id || "NAv";

        const marker = new window.google.maps.Marker({
          position: { lat, lng },
          map,
          title: `Meter: ${meterNo}`,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 4.5,
            fillColor: "#0f766e",
            fillOpacity: 0.85,
            strokeColor: "#ffffff",
            strokeWeight: 1,
          },
          clickable: !isDrawing,
          zIndex: 45,
        });

        if (!isDrawing) {
          marker.addListener("click", () => {
            const infoWindow = infoWindowRef.current;
            if (!infoWindow) return;
            const astId = meter?.id || "NAv";
            const phase = meter?.astData?.phase || "NAv";
            infoWindow.setContent(`
              <div style="font-family: Arial, sans-serif; min-width: 180px; font-size: 13px;">
                <strong style="color: #0f766e; display: block; margin-bottom: 2px;">Meter: ${escapeHtml(meterNo)}</strong>
                <div style="color: #64748b; font-size: 11px;">AST ID: ${escapeHtml(astId)}</div>
                <div style="color: #334155; font-size: 11px; margin-top: 2px;">Phase: ${escapeHtml(phase)}</div>
              </div>
            `);
            infoWindow.open({ anchor: marker, map, shouldFocus: false });
          });
        }

        markers.push(marker);
      });

      meterMarkersRef.current = markers;
    }

    return () => clearMapObjects(meterMarkersRef);
  }, [map, selectedWardPcode, meters, showMetersLayer, isDrawing]);

  // Existing Geofences (active ward only)
  useEffect(() => {
    if (!map || !window.google?.maps) return;
    clearMapObjects(geofencePolygonsRef);

    if (!selectedWardPcode || geofences.length === 0) return;

    // Filter which geofences to display based on layer toggle and selected geofence:
    // If showGeofencesLayer is true: render ALL geofences in the ward.
    // If showGeofencesLayer is false: render ONLY the selected geofence (if one is selected in dropdown).
    const fencesToRender = showGeofencesLayer
      ? geofences
      : selectedGeofenceId
        ? geofences.filter((gf) => gf.id === selectedGeofenceId)
        : [];

    if (fencesToRender.length === 0) return;

    const mapObjects = [];
    fencesToRender.forEach((gf) => {
      // 1. Primary path from getGeoFencePath (supports iREPS geometry.points [{latitude, longitude, order}])
      const pointPath = getGeoFencePath(gf);
      let paths = [];

      if (Array.isArray(pointPath) && pointPath.length >= 3) {
        paths = [pointPath];
      } else {
        // 2. Fallback to GeoJSON geometry coordinates
        const geom = parseGeometry(gf.geometry) || gf;
        if (geom && (geom.type === "Polygon" || geom.type === "MultiPolygon")) {
          paths = geoJsonPolygonToGooglePaths(geom);
        }
      }

      if (paths.length > 0) {
        const isSelected = gf.id === selectedGeofenceId;
        const poly = new window.google.maps.Polygon({
          paths,
          strokeColor: isSelected ? "#dc2626" : "#7c3aed",
          strokeOpacity: 0.95,
          strokeWeight: isSelected ? 4 : 2,
          fillColor: isSelected ? "#ef4444" : "#8b5cf6",
          fillOpacity: isSelected ? 0.35 : 0.18,
          clickable: !isDrawing,
          zIndex: isSelected ? 70 : 50,
        });

        if (!isDrawing) {
          poly.addListener("click", () => {
            if (typeof onSelectGeofence === "function") {
              onSelectGeofence(gf.id);
            }
          });
        }

        poly.setMap(map);
        mapObjects.push(poly);

        // Geofence Name Label marker
        const labelPoint = geofenceLabelPoint(gf);
        if (labelPoint) {
          const labelMarker = new window.google.maps.Marker({
            position: labelPoint,
            map,
            title: gf.name || gf.id,
            label: {
              text: String(gf.name || gf.id),
              className: "ireps-geofence-label",
              color: isSelected ? "#b91c1c" : "#6d28d9",
              fontWeight: "600",
              fontSize: "11px",
            },
            icon: {
              path: window.google.maps.SymbolPath.CIRCLE,
              scale: 1,
              fillOpacity: 0,
              strokeOpacity: 0,
            },
            clickable: false,
            zIndex: isSelected ? 75 : 55,
          });
          mapObjects.push(labelMarker);
        }

        if (isSelected) {
          fitMapToBounds(map, paths);
        }
      }
    });
    geofencePolygonsRef.current = mapObjects;

    return () => clearMapObjects(geofencePolygonsRef);
  }, [map, selectedWardPcode, geofences, selectedGeofenceId, showGeofencesLayer, isDrawing, onSelectGeofence]);

  // Active Draft Polygon / Points for Geofence drawing
  useEffect(() => {
    if (!map || !window.google?.maps) return;
    if (draftPolylineRef.current) draftPolylineRef.current.setMap(null);
    if (draftPolygonRef.current) draftPolygonRef.current.setMap(null);
    clearMapObjects(draftMarkersRef);

    if (drawingPoints.length > 0) {
      const markers = drawingPoints.map((pt, index) => {
        return new window.google.maps.Marker({
          position: pt,
          map,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: index === 0 ? 6 : 4,
            fillColor: index === 0 ? "#16a34a" : "#2563eb",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
          zIndex: 100,
        });
      });
      draftMarkersRef.current = markers;

      if (drawingPoints.length >= 3) {
        draftPolygonRef.current = new window.google.maps.Polygon({
          paths: drawingPoints,
          strokeColor: "#2563eb",
          strokeOpacity: 1,
          strokeWeight: 2,
          fillColor: "#3b82f6",
          fillOpacity: 0.2,
          zIndex: 90,
          clickable: false,
        });
        draftPolygonRef.current.setMap(map);
      } else {
        draftPolylineRef.current = new window.google.maps.Polyline({
          path: drawingPoints,
          strokeColor: "#2563eb",
          strokeOpacity: 1,
          strokeWeight: 2,
          zIndex: 90,
          clickable: false,
        });
        draftPolylineRef.current.setMap(map);
      }
    }

    return () => {
      if (draftPolylineRef.current) draftPolylineRef.current.setMap(null);
      if (draftPolygonRef.current) draftPolygonRef.current.setMap(null);
      clearMapObjects(draftMarkersRef);
    };
  }, [map, drawingPoints]);

  // Click listener for drawing
  useEffect(() => {
    if (!map) return;
    const listener = map.addListener("click", (event) => {
      if (isDrawing && event.latLng) {
        onMapClick({
          lat: event.latLng.lat(),
          lng: event.latLng.lng(),
        });
      }
    });

    return () => {
      google.maps.event.removeListener(listener);
    };
  }, [map, isDrawing, onMapClick]);

  return null;
}

export default function MdBgoPlanningPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const auth = useAuth();
  const { geoState } = useGeo();

  const { lmPcode, lmName } = useMemo(
    () => resolveWorkbase(auth, geoState),
    [auth, geoState],
  );

  // Authoritative Municipality Boundary
  const { data: lmBoundary } = useGetLmBoundaryByIdQuery(lmPcode, {
    skip: !lmPcode,
  });

  // Authoritative Ward Boundaries for LM
  const { data: wards = [] } = useGetWardBoundariesByLmQuery(lmPcode, {
    skip: !lmPcode,
  });

  // Selected Ward
  const [selectedWardPcode, setSelectedWardPcode] = useState(
    searchParams.get("wardPcode") || "",
  );

  const activeWard = useMemo(() => {
    if (!selectedWardPcode) return null;
    return wards.find(
      (w) => (w.wardPcode || w.pcode || w.id) === selectedWardPcode,
    );
  }, [wards, selectedWardPcode]);

  const wardNumber = useMemo(() => {
    if (!selectedWardPcode) return "";
    return activeWard?.wardNumber || wardNumberFromPcode(selectedWardPcode);
  }, [selectedWardPcode, activeWard]);

  // Update query params when ward changes
  const handleSelectWard = useCallback(
    (pcode) => {
      setSelectedWardPcode(pcode);
      setSelectedGeofenceId("");
      handleClearDrawing();
      const next = new URLSearchParams(searchParams);
      if (pcode) {
        next.set("wardPcode", pcode);
      } else {
        next.delete("wardPcode");
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // Collapsible Map Layers Panel (matching Sales GPS pattern)
  const [layersOpen, setLayersOpen] = useState(true);
  const [showWardBoundariesLayer, setShowWardBoundariesLayer] = useState(true);
  const [showErfsLayer, setShowErfsLayer] = useState(false);
  const [showPremisesLayer, setShowPremisesLayer] = useState(false);
  const [showMetersLayer, setShowMetersLayer] = useState(false);
  const [showGeofencesLayer, setShowGeofencesLayer] = useState(true);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingPoints, setDrawingPoints] = useState([]);
  const [drawWard, setDrawWard] = useState(null);

  // Selection & creation dialog states
  const [selectedGeofenceId, setSelectedGeofenceId] = useState(
    searchParams.get("focusGeofenceId") || "",
  );
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [geofenceNameInput, setGeofenceNameInput] = useState("");
  const [geofenceDescInput, setGeofenceDescInput] = useState("");
  const [formError, setFormError] = useState("");
  const [createdResult, setCreatedResult] = useState(null);
  const [savedGeofenceLanding, setSavedGeofenceLanding] = useState(null);

  // ERFs for selected ward (lazy-loaded when layer active or drawing)
  const shouldLoadErfs = Boolean(selectedWardPcode && lmPcode && (showErfsLayer || isDrawing));
  const { data: wardErfs = [], isLoading: isErfsLoading } = useGetErfsByWardQuery(
    { lmPcode, wardPcode: selectedWardPcode },
    { skip: !shouldLoadErfs },
  );

  // Premises for selected ward (lazy-loaded when layer active)
  const shouldLoadPremises = Boolean(selectedWardPcode && showPremisesLayer);
  const { data: wardPremises = [], isLoading: isPremisesLoading } = useGetPremisesByWardQuery(
    selectedWardPcode,
    { skip: !shouldLoadPremises },
  );

  // Meters (Assets) for selected ward (lazy-loaded when layer active)
  const shouldLoadMeters = Boolean(selectedWardPcode && lmPcode && showMetersLayer);
  const { data: wardMeters = [], isLoading: isMetersLoading } = useGetAstsByLmPcodeWardPcodeQuery(
    { lmPcode, wardPcode: selectedWardPcode },
    { skip: !shouldLoadMeters },
  );

  // Existing Geofences for selected ward
  const { data: wardGeofences = [] } = useGetGeoFencesByWardQuery(
    { lmPcode, wardPcode: selectedWardPcode },
    { skip: !lmPcode || !selectedWardPcode },
  );

  // Immediate zero-latency display: merges live Firestore geofences with newly completed geofence
  const displayGeofences = useMemo(() => {
    const list = [...wardGeofences];
    if (savedGeofenceLanding && savedGeofenceLanding.points?.length >= 3) {
      const exists = list.some(
        (g) => g.id === savedGeofenceLanding.id || g.name === savedGeofenceLanding.name
      );
      if (!exists) {
        list.unshift({
          id: savedGeofenceLanding.id || `gf-${Date.now()}`,
          name: savedGeofenceLanding.name,
          geometry: {
            type: "Polygon",
            points: savedGeofenceLanding.points,
          },
          counts: {
            erfs: savedGeofenceLanding.erfCount,
            premises: savedGeofenceLanding.premiseCount,
            meters: savedGeofenceLanding.meterCount,
          },
        });
      }
    }
    return list;
  }, [wardGeofences, savedGeofenceLanding]);

  // Mutations
  const [createGeoFence, { isLoading: isSavingGeofence }] = useCreateGeoFenceMutation();
  const [createBgo, { isLoading: isCreatingBgo }] = useCreateBgoMutation();

  const handleMapClick = useCallback((point) => {
    setDrawingPoints((pts) => [...pts, point]);
  }, []);

  const handleUndoPoint = () => {
    setDrawingPoints((pts) => pts.slice(0, -1));
  };

  function handleClearDrawing() {
    setDrawingPoints([]);
    setIsDrawing(false);
    setIsCreateModalOpen(false);
    setIsConfirmModalOpen(false);
    setDrawWard(null);
    setFormError("");
  }

  const handleSelectGeofence = useCallback(
    (geofenceId) => {
      setSelectedGeofenceId(geofenceId);
      if (!geofenceId) {
        setSavedGeofenceLanding(null);
        return;
      }
      const found = displayGeofences.find((g) => g.id === geofenceId);
      if (found) {
        setSavedGeofenceLanding({
          id: found.id,
          name: found.name,
          wardNumber,
          wardPcode: selectedWardPcode,
          erfCount: found.counts?.erfs ?? found.erfCount ?? 0,
          premiseCount: found.counts?.premises ?? found.premiseCount ?? 0,
          meterCount: found.counts?.meters ?? found.meterCount ?? 0,
          points: found.geometry?.points || found.points || [],
        });
      } else {
        setSavedGeofenceLanding(null);
      }
    },
    [displayGeofences, wardNumber, selectedWardPcode],
  );

  const handleCloseLanding = useCallback(() => {
    setSavedGeofenceLanding(null);
    setSelectedGeofenceId("");
  }, []);

  // Evaluate ERFs inside drawn polygon
  const evaluatedGeometry = useMemo(() => {
    if (drawingPoints.length < 3) return null;
    try {
      return polygonFromPoints(drawingPoints);
    } catch {
      return null;
    }
  }, [drawingPoints]);

  const erfsInside = useMemo(() => {
    if (!evaluatedGeometry || drawingPoints.length < 3) return [];
    return wardErfs.filter((erf) => {
      const lat = erf.centroid?.latitude ?? erf.centroid?.lat;
      const lng = erf.centroid?.longitude ?? erf.centroid?.lng;
      if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return false;
      try {
        return strictlyInside({ latitude: Number(lat), longitude: Number(lng) }, evaluatedGeometry);
      } catch {
        return false;
      }
    });
  }, [evaluatedGeometry, drawingPoints, wardErfs]);

  const isOverLimit = erfsInside.length > BGO_ERF_LIMIT;
  const canSave = drawingPoints.length >= 3 && evaluatedGeometry && erfsInside.length >= 1 && !isOverLimit;

  // Counter text
  const counterText = useMemo(() => {
    if (drawingPoints.length < 3) {
      return "Click at least 3 points on the map to outline a geofence.";
    }
    if (!evaluatedGeometry) {
      return "The shape crosses itself. Undo the last point or restart.";
    }
    const count = erfsInside.length;
    if (count > BGO_ERF_LIMIT) {
      return `Inside: ${count} ERFs. Too many: ${count} — the limit is ${BGO_ERF_LIMIT}.`;
    }
    if (count === 0) {
      return "Inside: 0 ERFs · Outline at least 1 ERF.";
    }
    return `Inside: ${count} ERF${count === 1 ? "" : "s"} · Ready to save geofence`;
  }, [drawingPoints.length, evaluatedGeometry, erfsInside.length]);

  const counterTone = useMemo(() => {
    if (drawingPoints.length < 3 || erfsInside.length === 0) return "#475569";
    if (isOverLimit || !evaluatedGeometry) return "#dc2626";
    return "#166534";
  }, [drawingPoints.length, erfsInside.length, isOverLimit, evaluatedGeometry]);

  const fullStandardName = useMemo(() => {
    return composeGeofenceName(wardNumber, geofenceNamePart(geofenceNameInput));
  }, [wardNumber, geofenceNameInput]);

  const duplicateWarning = useMemo(() => {
    const namePart = geofenceNamePart(geofenceNameInput);
    if (!namePart) return "";
    const duplicate = findDuplicateGeofence(fullStandardName, wardGeofences);
    return duplicate ? duplicateGeofenceNameMessage(duplicate) : "";
  }, [geofenceNameInput, fullStandardName, wardGeofences]);


  // Routine Step 1 -> Step 2: Validate name & Start Drawing
  const handleStartDrawing = () => {
    const namePart = geofenceNamePart(geofenceNameInput);
    if (!namePart) {
      setFormError(`Type a name after "Gf W${wardNumber}".`);
      return;
    }

    const duplicate = findDuplicateGeofence(fullStandardName, wardGeofences);
    if (duplicate) {
      setFormError(duplicateGeofenceNameMessage(duplicate));
      return;
    }

    setDrawWard({
      pcode: selectedWardPcode,
      number: wardNumber,
      name: activeWard?.name || activeWard?.wardName || `Ward ${wardNumber}`,
    });
    setDrawingPoints([]);
    setShowErfsLayer(true);
    setIsDrawing(true);
    setIsCreateModalOpen(false);
    setFormError("");
  };

  // Stage A: Save Geofence Only (Option 1 with clean post-save landing)
  const handleSaveGeofenceOnly = async () => {
    if (!canSave) return;
    setFormError("");

    const namePart = geofenceNamePart(geofenceNameInput);
    if (!namePart) {
      setFormError(`Type a name after "Gf W${wardNumber}".`);
      return;
    }

    const duplicate = findDuplicateGeofence(fullStandardName, wardGeofences);
    if (duplicate) {
      setFormError(duplicateGeofenceNameMessage(duplicate));
      return;
    }

    try {
      const fencePayload = {
        name: fullStandardName,
        description: geofenceDescInput.trim() || "No Description Given",
        parents: {
          countryPcode: "ZA",
          provincePcode: lmBoundary?.parents?.provinceId || lmBoundary?.parents?.provincePcode || "NAv",
          dmPcode: lmBoundary?.parents?.districtId || lmBoundary?.parents?.dmPcode || "NAv",
          lmPcode,
          wardPcode: selectedWardPcode,
        },
        points: drawingPoints.map((point, index) => ({
          latitude: point.lat,
          longitude: point.lng,
          order: index,
        })),
      };

      const result = await createGeoFence(fencePayload).unwrap();
      const savedGeofenceId = result?.geofenceId || result?.id || "";

      // 1. Ensure geofences layer is active so it immediately shows on the map
      setShowGeofencesLayer(true);

      // 2. Terminate drawing mode completely (clears vertices, removes red cancel button & toolbar, unlocks ward)
      handleClearDrawing();

      // 2. Select the newly saved geofence
      if (savedGeofenceId) {
        setSelectedGeofenceId(savedGeofenceId);
      }

      // 3. Open clean Geofence Landing Panel
      setSavedGeofenceLanding({
        id: savedGeofenceId,
        name: fullStandardName,
        wardNumber,
        wardPcode: selectedWardPcode,
        erfCount: erfsInside.length,
        premiseCount: wardPremises.length,
        meterCount: wardMeters.length,
        points: [...drawingPoints],
      });

      // 4. Close confirm modal
      setIsConfirmModalOpen(false);
    } catch (err) {
      setFormError(err?.data?.message || err?.message || "Could not save geofence.");
    }
  };

  // Stage B: Save Geofence & Create Batch
  const handleSaveAndCreateBatch = async () => {
    if (!canSave) return;
    setFormError("");

    const namePart = geofenceNamePart(geofenceNameInput);
    if (!namePart) {
      setFormError(`Type a name after "Gf W${wardNumber}".`);
      return;
    }

    const duplicate = findDuplicateGeofence(fullStandardName, wardGeofences);
    if (duplicate) {
      setFormError(duplicateGeofenceNameMessage(duplicate));
      return;
    }

    try {
      // 1. Save Geofence
      const fencePayload = {
        name: fullStandardName,
        description: geofenceDescInput.trim() || "No Description Given",
        lmPcode,
        wardPcode: selectedWardPcode,
        geometry: evaluatedGeometry,
      };
      const fenceResult = await createGeoFence(fencePayload).unwrap();
      const geofenceId = fenceResult?.id || fenceResult?.geoFenceId || "";

      // 2. Create BGO Batch
      const erfRefs = erfsInside.map((erf) => ({
        id: erf.id || erf.erfId,
        erfNo: erf.erfNo || erf.parcelNo || erf.id || "NAv",
        erfType: erf.type || erf.erfType || "FORMAL",
      }));

      const batchPayload = {
        batchMode: "BMD",
        sourceModule: "BULK_METER_DISCOVERY",
        trnType: "METER_DISCOVERY",
        operationType: "METER_DISCOVERY",
        operationCode: "MDIS",
        scope: {
          lmPcode,
          lmName,
          wardPcode: selectedWardPcode,
          wardName: activeWard?.name || activeWard?.wardName || `Ward ${wardNumber}`,
        },
        geofenceRef: {
          id: geofenceId,
          name: fullStandardName,
        },
        worklist: {
          type: "ERF_LIST",
          erfRefs,
        },
        summary: {
          erfCount: erfRefs.length,
          totalRows: erfRefs.length,
          premiseCount: wardPremises.length,
          meterCount: wardMeters.length,
        },
      };

      const batchResult = await createBgo(batchPayload).unwrap();
      const batchId = batchResult?.bgoBatchId || batchResult?.batchId || batchResult?.id || "";

      handleClearDrawing();
      setCreatedResult({
        type: "BATCH_CREATED",
        batchId,
        geofenceName: fullStandardName,
        geofenceId,
        erfCount: erfRefs.length,
      });
    } catch (err) {
      setFormError(err?.data?.message || err?.message || "Could not create batch.");
    }
  };

  return (
    <section style={styles.page}>
      <div style={styles.header}>
        <div>
          <div style={styles.backLinkWrap}>
            <Link to="/operations/bgo" style={styles.backLink}>
              ← Back to MD BGO Register
            </Link>
          </div>
          <p style={styles.eyebrow}>Operations / MD BGO Planning Map</p>
          <h2 style={styles.title}>MD BGO Ward Planning Map</h2>
          <p style={styles.subtitle}>
            Explore the municipal boundaries and wards. Select a ward to activate ERFs, premises, meters, and draw geofences up to 60 ERFs.
          </p>
        </div>
      </div>

      {/* Top Map Controls Bar */}
      <div style={styles.controlsBar}>
        <div style={styles.controlsGroup}>
          <label style={styles.controlLabel}>
            Ward
            <select
              value={selectedWardPcode}
              onChange={(e) => handleSelectWard(e.target.value)}
              style={{
                ...styles.select,
                ...(isDrawing ? styles.disabledSelect : null),
              }}
              disabled={isDrawing}
              title={isDrawing ? "Ward selector is locked while drawing. Batches belong to 1 ward only." : ""}
            >
              <option value="">Whole Municipality ({lmName || lmPcode})</option>
              {wards.map((w) => {
                const pcode = w.wardPcode || w.pcode || w.id;
                const no = w.wardNumber || wardNumberFromPcode(pcode);
                return (
                  <option key={pcode} value={pcode}>
                    Ward {no} ({pcode})
                  </option>
                );
              })}
            </select>
          </label>

          <label style={styles.controlLabel}>
            Geofence
            <select
              value={selectedGeofenceId}
              onChange={(e) => handleSelectGeofence(e.target.value)}
              style={styles.select}
              disabled={!selectedWardPcode}
            >
              <option value="">All geofences in ward</option>
              {displayGeofences.map((gf) => (
                <option key={gf.id} value={gf.id}>
                  {gf.name}
                </option>
              ))}
            </select>
          </label>

          {selectedWardPcode ? (
            <div style={styles.erfCountBadge}>
              Ward {wardNumber}: {displayGeofences.length} Geofence{displayGeofences.length === 1 ? "" : "s"}
              {showErfsLayer || isDrawing ? ` · ${isErfsLoading ? "Loading ERFs…" : wardErfs.length + " ERFs"}` : ""}
              {showPremisesLayer ? ` · ${isPremisesLoading ? "Loading Premises…" : wardPremises.length + " Premises"}` : ""}
              {showMetersLayer ? ` · ${isMetersLoading ? "Loading Meters…" : wardMeters.length + " Meters"}` : ""}
            </div>
          ) : (
            <div style={styles.lmCountBadge}>
              Whole Municipality: {wards.length} Wards · Select a ward to plan
            </div>
          )}
        </div>

        <div style={styles.controlsGroup}>
          <button
            type="button"
            style={{
              ...(isDrawing ? styles.drawingActiveButton : styles.drawFenceButton),
              ...(!selectedWardPcode && !isDrawing ? styles.disabledButton : null),
            }}
            disabled={!selectedWardPcode && !isDrawing}
            title={!selectedWardPcode ? "Select a ward first to draw a geofence" : ""}
            onClick={() => {
              if (isDrawing) {
                handleClearDrawing();
              } else {
                setGeofenceNameInput("");
                setGeofenceDescInput("");
                setFormError("");
                setIsCreateModalOpen(true);
              }
            }}
          >
            {isDrawing ? "Cancel Drawing" : "Draw batch geofence"}
          </button>
        </div>
      </div>

      {/* Drawing Toolbar Indicator */}
      {isDrawing ? (
        <div style={styles.drawingStatusBar}>
          <div style={styles.drawingStatusLeft}>
            <span style={styles.drawingCreatingBadge}>
              Creating: <strong>{fullStandardName}</strong>
            </span>
            <span style={styles.drawingPointsCount}>
              {drawingPoints.length} point{drawingPoints.length === 1 ? "" : "s"}
            </span>
            <div style={{ ...styles.drawingCountText, color: counterTone }}>
              <strong>{counterText}</strong>
            </div>
          </div>

          <div style={styles.drawingActions}>
            <button
              type="button"
              style={styles.drawingButton}
              onClick={handleUndoPoint}
              disabled={drawingPoints.length === 0}
            >
              Undo Point
            </button>
            <button
              type="button"
              style={styles.drawingButton}
              onClick={() => setDrawingPoints([])}
              disabled={drawingPoints.length === 0}
            >
              Restart
            </button>
            <button
              type="button"
              style={styles.drawingCancelButton}
              onClick={handleClearDrawing}
            >
              Cancel
            </button>
            <button
              type="button"
              style={{
                ...styles.drawingSaveButton,
                ...(!canSave ? styles.disabledButton : null),
              }}
              disabled={!canSave}
              onClick={() => {
                setFormError("");
                setIsConfirmModalOpen(true);
              }}
            >
              Save ({erfsInside.length})
            </button>
          </div>
        </div>
      ) : null}

      {/* Geofence Post-Save Clean Landing Panel */}
      {savedGeofenceLanding && !isDrawing ? (
        <div style={styles.landingCard}>
          <div style={styles.landingHeader}>
            <div style={styles.landingHeaderLeft}>
              <span style={styles.landingBadge}>● Geofence Saved · Unbatched</span>
              <h3 style={styles.landingTitle}>{savedGeofenceLanding.name}</h3>
              <p style={styles.landingSubtitle}>
                Encompasses <strong>{savedGeofenceLanding.erfCount} ERFs</strong> in Ward {savedGeofenceLanding.wardNumber}. Saved to database and ready for batch origination.
              </p>
            </div>
            <button
              type="button"
              style={styles.landingDismissButton}
              onClick={handleCloseLanding}
              title="Dismiss"
            >
              ×
            </button>
          </div>

          <div style={styles.landingActions}>
            <button
              type="button"
              style={styles.landingPrimaryButton}
              onClick={() => {
                alert(`Batch origination from saved geofence "${savedGeofenceLanding.name}" will be connected in next step.`);
              }}
            >
              Create MD BGO Batch from this Geofence Now →
            </button>

            <button
              type="button"
              style={styles.landingSecondaryButton}
              onClick={() => {
                setSavedGeofenceLanding(null);
                setGeofenceNameInput("");
                setGeofenceDescInput("");
                setFormError("");
                setIsCreateModalOpen(true);
              }}
            >
              + Draw Another Geofence in Ward {wardNumber}
            </button>

            <button
              type="button"
              style={styles.landingLinkButton}
              onClick={() => navigate("/operations/bgo")}
            >
              Return to MD BGO Register
            </button>
          </div>
        </div>
      ) : null}

      {/* Full-Width Auto-Opening Map Viewport */}
      <div style={styles.mapContainer}>
        {googleMapsApiKey ? (
          <APIProvider apiKey={googleMapsApiKey}>
            <Map
              defaultCenter={FALLBACK_CENTER}
              defaultZoom={12}
              style={styles.mapElement}
              gestureHandling="greedy"
              disableDefaultUI={false}
              mapTypeId="roadmap"
            >
              <MdBgoMapInner
                lmBoundary={lmBoundary}
                wards={wards}
                selectedWardPcode={selectedWardPcode}
                onSelectWard={handleSelectWard}
                erfs={wardErfs}
                premises={wardPremises}
                meters={wardMeters}
                geofences={displayGeofences}
                selectedGeofenceId={selectedGeofenceId}
                onSelectGeofence={handleSelectGeofence}
                showWardBoundariesLayer={showWardBoundariesLayer}
                showErfsLayer={showErfsLayer}
                showPremisesLayer={showPremisesLayer}
                showMetersLayer={showMetersLayer}
                showGeofencesLayer={showGeofencesLayer}
                drawingPoints={drawingPoints}
                isDrawing={isDrawing}
                onMapClick={handleMapClick}
              />
            </Map>

            {/* Floating Map Layers Control Panel */}
            {!layersOpen ? (
              <button
                type="button"
                onClick={() => setLayersOpen(true)}
                aria-label="Show map layers"
                title="Map layers"
                style={styles.layersOpenButton}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M12 3 2 8l10 5 10-5-10-5Zm-7.5 8.2L2 12.5l10 5 10-5-2.5-1.3L12 15l-7.5-3.8Zm0 4.5L2 17l10 5 10-5-2.5-1.3L12 19.5l-7.5-3.8Z"
                    fill="#475569"
                  />
                </svg>
              </button>
            ) : (
              <div style={styles.mapLayersBox}>
                <div style={styles.mapLayersHeader}>
                  <strong style={styles.mapLayersTitle}>MAP LAYERS</strong>
                  <button
                    type="button"
                    onClick={() => setLayersOpen(false)}
                    aria-label="Close map layers"
                    title="Close"
                    style={styles.layersCloseButton}
                  >
                    ×
                  </button>
                </div>

                {!selectedWardPcode ? (
                  <div style={styles.layersPrompt}>
                    Select a ward to activate ERFs, premises, meters & geofences.
                  </div>
                ) : null}

                <label
                  style={{
                    ...styles.layerCheckboxLabel,
                    ...(!selectedWardPcode ? styles.layerDisabled : null),
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showErfsLayer}
                    disabled={!selectedWardPcode}
                    onChange={(e) => setShowErfsLayer(e.target.checked)}
                  />
                  <span style={{ ...styles.legendDot, background: "#94a3b8" }} />
                  <span style={styles.layerLabelText}>ERFs</span>
                  <strong style={styles.layerCount}>{selectedWardPcode ? (showErfsLayer || isDrawing ? (isErfsLoading ? "Loading…" : wardErfs.length) : "Off") : "—"}</strong>
                </label>

                <label
                  style={{
                    ...styles.layerCheckboxLabel,
                    ...(!selectedWardPcode ? styles.layerDisabled : null),
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showPremisesLayer}
                    disabled={!selectedWardPcode}
                    onChange={(e) => setShowPremisesLayer(e.target.checked)}
                  />
                  <span style={{ ...styles.legendDot, background: "#2563eb" }} />
                  <span style={styles.layerLabelText}>Premises</span>
                  <strong style={styles.layerCount}>{selectedWardPcode ? (showPremisesLayer ? (isPremisesLoading ? "Loading…" : wardPremises.length) : "Off") : "—"}</strong>
                </label>

                <label
                  style={{
                    ...styles.layerCheckboxLabel,
                    ...(!selectedWardPcode ? styles.layerDisabled : null),
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showMetersLayer}
                    disabled={!selectedWardPcode}
                    onChange={(e) => setShowMetersLayer(e.target.checked)}
                  />
                  <span style={{ ...styles.legendDot, background: "#0f766e" }} />
                  <span style={styles.layerLabelText}>Meters</span>
                  <strong style={styles.layerCount}>{selectedWardPcode ? (showMetersLayer ? (isMetersLoading ? "Loading…" : wardMeters.length) : "Off") : "—"}</strong>
                </label>

                <label
                  style={{
                    ...styles.layerCheckboxLabel,
                    ...(!selectedWardPcode ? styles.layerDisabled : null),
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showGeofencesLayer}
                    disabled={!selectedWardPcode}
                    onChange={(e) => setShowGeofencesLayer(e.target.checked)}
                  />
                  <span style={{ ...styles.legendDot, background: "#8b5cf6" }} />
                  <span style={styles.layerLabelText}>Geofences (this Ward)</span>
                  <strong style={styles.layerCount}>
                    {selectedWardPcode ? displayGeofences.length : "—"}
                  </strong>
                </label>

                <label style={styles.layerCheckboxLabel}>
                  <input
                    type="checkbox"
                    checked={showWardBoundariesLayer}
                    onChange={(e) => setShowWardBoundariesLayer(e.target.checked)}
                  />
                  <span style={{ ...styles.legendDot, background: "#3b82f6" }} />
                  <span style={styles.layerLabelText}>Ward boundaries</span>
                  <strong style={styles.layerCount}>{wards.length}</strong>
                </label>
              </div>
            )}
          </APIProvider>
        ) : (
          <div style={styles.noApiKey}>
            Google Maps API Key not configured.
          </div>
        )}
      </div>

      {/* Pre-Drawing Modal: Enter Geofence Name & Lock Ward */}
      {isCreateModalOpen ? (
        <div style={styles.modalOverlay} role="presentation">
          <div style={styles.modalCard} role="dialog" aria-modal="true">
            <p style={styles.eyebrow}>Draw Targeted Batch Geofence</p>
            <h3 style={styles.modalTitle}>
              Targeted Batch: Ward {wardNumber}
            </h3>
            <p style={styles.modalSubtitle}>
              Batches belong to 1 ward only. Geofence names always start with "Gf W{wardNumber}" and must be unique in this ward.
            </p>

            <div style={styles.formGroup}>
              <label style={styles.label}>
                Geofence Name (Prefix Gf W{wardNumber} is fixed per GF-R001)
              </label>
              <div style={styles.prefixInputGroup}>
                <span style={styles.fixedPrefix}>Gf W{wardNumber}&nbsp;</span>
                <input
                  type="text"
                  placeholder="e.g. Albert Street North"
                  value={geofenceNameInput}
                  onChange={(e) => {
                    setGeofenceNameInput(e.target.value);
                    if (formError) setFormError("");
                  }}
                  style={styles.textInput}
                  autoFocus
                />
              </div>
              <div style={styles.previewNameText}>
                Full Name: <strong>{fullStandardName}</strong>
              </div>
            </div>

            {duplicateWarning ? (
              <div style={styles.modalError}>{duplicateWarning}</div>
            ) : null}

            <div style={styles.formGroup}>
              <label style={styles.label}>Description (Optional)</label>
              <input
                type="text"
                placeholder="Optional description / notes"
                value={geofenceDescInput}
                onChange={(e) => setGeofenceDescInput(e.target.value)}
                style={styles.textInput}
              />
            </div>

            {formError ? <div style={styles.modalError}>{formError}</div> : null}

            <div style={styles.modalActions}>
              <button
                type="button"
                style={styles.modalCancelButton}
                onClick={() => setIsCreateModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                style={{
                  ...styles.modalPrimaryButton,
                  ...(!geofenceNamePart(geofenceNameInput) || Boolean(duplicateWarning)
                    ? styles.disabledButton
                    : null),
                }}
                onClick={handleStartDrawing}
                disabled={!geofenceNamePart(geofenceNameInput) || Boolean(duplicateWarning)}
              >
                Start Drawing
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Confirm Modal: Save Geofence Only vs Save & Create Batch */}
      {isConfirmModalOpen ? (
        <div style={styles.modalOverlay} role="presentation">
          <div style={styles.modalCard} role="dialog" aria-modal="true">
            <p style={styles.eyebrow}>Confirm Geofence & Batch</p>
            <h3 style={styles.modalTitle}>
              Save Geofence: {fullStandardName}
            </h3>
            <p style={styles.modalSubtitle}>
              Encompasses {erfsInside.length} ERFs in Ward {wardNumber} (Batch Limit: {BGO_ERF_LIMIT} ERFs).
            </p>

            <div style={styles.confirmSummaryBox}>
              <div><strong>Ward:</strong> Ward {wardNumber} ({activeWard?.name || activeWard?.wardName || lmName})</div>
              <div><strong>Coverage:</strong> {erfsInside.length} ERFs · {wardPremises.length} Known Premises · {wardMeters.length} Meters</div>
              <div><strong>Points:</strong> {drawingPoints.length} polygon vertices</div>
            </div>

            {formError ? <div style={styles.modalError}>{formError}</div> : null}

            <div style={styles.modalActions}>
              <button
                type="button"
                style={styles.modalCancelButton}
                onClick={() => setIsConfirmModalOpen(false)}
                disabled={isSavingGeofence || isCreatingBgo}
              >
                Cancel
              </button>
              <button
                type="button"
                style={styles.modalSecondaryButton}
                onClick={handleSaveGeofenceOnly}
                disabled={isSavingGeofence || isCreatingBgo}
              >
                {isSavingGeofence ? "Saving..." : "Save Geofence Only"}
              </button>
              <button
                type="button"
                style={styles.modalPrimaryButton}
                onClick={async () => {
                  await handleSaveAndCreateBatch();
                  setIsConfirmModalOpen(false);
                }}
                disabled={isSavingGeofence || isCreatingBgo}
              >
                {isCreatingBgo ? "Creating Batch..." : "Save & Create Batch"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Creation Success Modal */}
      {createdResult ? (
        <div style={styles.modalOverlay} role="presentation">
          <div style={styles.modalCard} role="dialog" aria-modal="true">
            <p style={styles.eyebrow}>
              {createdResult.type === "BATCH_CREATED"
                ? "MD BGO Batch Created"
                : "Geofence Saved"}
            </p>
            <h3 style={styles.modalTitle}>
              {createdResult.type === "BATCH_CREATED"
                ? `Batch ${createdResult.batchId}`
                : createdResult.geofenceName}
            </h3>
            <p style={styles.modalSubtitle}>
              {createdResult.type === "BATCH_CREATED"
                ? `Created permanent batch for ${createdResult.geofenceName} with ${createdResult.erfCount} ERFs. Status: READY FOR ALLOCATION.`
                : `Geofence ${createdResult.geofenceName} saved successfully in Ward ${wardNumber}.`}
            </p>

            <div style={styles.modalActions}>
              {createdResult.type === "BATCH_CREATED" ? (
                <>
                  <button
                    type="button"
                    style={styles.modalSecondaryButton}
                    onClick={() => {
                      setCreatedResult(null);
                      navigate("/operations/bgo");
                    }}
                  >
                    Return to MD BGO Register
                  </button>
                  <button
                    type="button"
                    style={styles.modalPrimaryButton}
                    onClick={() => {
                      navigate(`/operations/bgo/allocation?batchId=${encodeURIComponent(createdResult.batchId)}`);
                    }}
                  >
                    Proceed to Allocate Batch →
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  style={styles.modalPrimaryButton}
                  onClick={() => setCreatedResult(null)}
                >
                  Continue Planning
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

const styles = {
  page: { padding: 24 },
  header: {
    marginBottom: 16,
  },
  backLinkWrap: {
    marginBottom: 8,
  },
  backLink: {
    color: "#2563eb",
    fontSize: 13,
    fontWeight: 800,
    textDecoration: "none",
  },
  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  title: {
    margin: "6px 0 4px",
    fontSize: 28,
    color: "#0f172a",
  },
  subtitle: {
    margin: 0,
    color: "#64748b",
    fontSize: 14,
  },
  controlsBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
    flexWrap: "wrap",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    padding: "10px 16px",
  },
  controlsGroup: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  controlLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: "#475569",
    fontSize: 13,
    fontWeight: 700,
  },
  select: {
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 13,
    background: "#ffffff",
    color: "#0f172a",
  },
  erfCountBadge: {
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 12px",
    borderRadius: 999,
    background: "#dcfce7",
    color: "#15803d",
    fontSize: 13,
    fontWeight: 800,
  },
  lmCountBadge: {
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 12px",
    borderRadius: 999,
    background: "#eff6ff",
    color: "#1d4ed8",
    fontSize: 13,
    fontWeight: 800,
  },
  drawFenceButton: {
    border: 0,
    borderRadius: 10,
    background: "#7c3aed",
    color: "#ffffff",
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer",
  },
  drawingActiveButton: {
    border: 0,
    borderRadius: 10,
    background: "#dc2626",
    color: "#ffffff",
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer",
  },
  drawingStatusBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
    padding: "10px 16px",
    borderRadius: 14,
    background: "#f8fafc",
    border: "1px solid #cbd5e1",
    flexWrap: "wrap",
  },
  drawingCountText: {
    fontSize: 14,
    fontWeight: 800,
  },
  drawingActions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  drawingButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    background: "#ffffff",
    color: "#334155",
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  drawingSaveButton: {
    border: 0,
    borderRadius: 8,
    background: "#2563eb",
    color: "#ffffff",
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: 800,
    cursor: "pointer",
  },
  disabledButton: {
    opacity: 0.5,
    pointerEvents: "none",
    cursor: "not-allowed",
  },
  mapContainer: {
    position: "relative",
    width: "100%",
    height: "calc(100vh - 280px)",
    minHeight: 520,
    borderRadius: 20,
    overflow: "hidden",
    border: "1px solid #cbd5e1",
  },
  mapElement: {
    width: "100%",
    height: "100%",
  },
  layersOpenButton: {
    position: "absolute",
    top: 14,
    right: 14,
    zIndex: 55,
    width: 40,
    height: 40,
    display: "grid",
    placeItems: "center",
    border: 0,
    borderRadius: 8,
    background: "#ffffff",
    boxShadow: "0 4px 12px rgba(15, 23, 42, 0.15)",
    cursor: "pointer",
    padding: 0,
  },
  mapLayersBox: {
    position: "absolute",
    top: 14,
    right: 14,
    width: 220,
    background: "rgba(255, 255, 255, 0.98)",
    borderRadius: 12,
    border: "1px solid #cbd5e1",
    boxShadow: "0 10px 24px rgba(15, 23, 42, 0.14)",
    padding: 12,
    zIndex: 55,
    display: "grid",
    gap: 8,
    fontSize: 12,
    color: "#0f172a",
  },
  mapLayersHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  mapLayersTitle: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "#0f172a",
  },
  layersCloseButton: {
    width: 22,
    height: 22,
    border: 0,
    borderRadius: 4,
    background: "transparent",
    color: "#475569",
    fontSize: 18,
    lineHeight: "22px",
    padding: 0,
    cursor: "pointer",
  },
  layersPrompt: {
    fontSize: 11,
    color: "#64748b",
    lineHeight: 1.4,
    padding: "4px 0",
    borderBottom: "1px solid #f1f5f9",
  },
  layerCheckboxLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    color: "#334155",
    fontWeight: 600,
    cursor: "pointer",
  },
  layerDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  layerLabelText: {
    flex: 1,
  },
  layerCount: {
    fontSize: 11,
    color: "#475569",
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    flex: "0 0 auto",
  },
  noApiKey: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#dc2626",
    fontSize: 15,
    fontWeight: 700,
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 23, 42, 0.45)",
    backdropFilter: "blur(2px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    padding: 16,
  },
  modalCard: {
    background: "#ffffff",
    borderRadius: 20,
    padding: 24,
    maxWidth: 520,
    width: "100%",
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
  },
  modalTitle: {
    margin: "6px 0 8px",
    fontSize: 20,
    color: "#0f172a",
  },
  modalSubtitle: {
    margin: "0 0 16px",
    color: "#64748b",
    fontSize: 14,
    lineHeight: 1.5,
  },
  formGroup: {
    marginBottom: 14,
  },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 700,
    color: "#475569",
    marginBottom: 6,
  },
  prefixInputGroup: {
    display: "flex",
    alignItems: "center",
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    padding: "0 10px",
    background: "#f8fafc",
  },
  fixedPrefix: {
    color: "#2563eb",
    fontWeight: 900,
    fontSize: 13,
  },
  textInput: {
    flex: 1,
    border: 0,
    background: "transparent",
    padding: "10px 0",
    fontSize: 13,
    color: "#0f172a",
    outline: "none",
  },
  previewNameText: {
    marginTop: 6,
    fontSize: 12,
    color: "#64748b",
  },
  modalError: {
    padding: 10,
    borderRadius: 8,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
    fontSize: 12,
    marginBottom: 14,
  },
  modalActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 18,
    flexWrap: "wrap",
  },
  modalCancelButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    background: "#ffffff",
    color: "#475569",
    padding: "8px 16px",
    fontWeight: 800,
    cursor: "pointer",
  },
  modalSecondaryButton: {
    border: "1px solid #2563eb",
    borderRadius: 10,
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "8px 16px",
    fontWeight: 800,
    cursor: "pointer",
  },
  modalPrimaryButton: {
    border: 0,
    borderRadius: 10,
    background: "#2563eb",
    color: "#ffffff",
    padding: "8px 16px",
    fontWeight: 800,
    cursor: "pointer",
  },
  drawingStatusLeft: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  drawingCreatingBadge: {
    fontSize: 13,
    color: "#0f172a",
    background: "#f1f5f9",
    padding: "4px 10px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
  },
  drawingPointsCount: {
    fontSize: 12,
    color: "#64748b",
  },
  drawingCancelButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    background: "#ffffff",
    color: "#64748b",
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  textareaInput: {
    width: "100%",
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
    color: "#0f172a",
    outline: "none",
    boxSizing: "border-box",
  },
  modalNote: {
    color: "#64748b",
    fontSize: 12,
    margin: "10px 0 0",
    lineHeight: 1.4,
  },
  confirmSummaryBox: {
    padding: 12,
    background: "#f8fafc",
    borderRadius: 10,
    border: "1px solid #e2e8f0",
    marginBottom: 14,
    display: "grid",
    gap: 6,
    fontSize: 13,
    color: "#334155",
  },
  disabledSelect: {
    background: "#f1f5f9",
    cursor: "not-allowed",
    opacity: 0.7,
  },
  landingCard: {
    background: "#ffffff",
    border: "2px solid #10b981",
    borderRadius: 14,
    padding: 16,
    margin: "0 0 16px 0",
    boxShadow: "0 10px 15px -3px rgba(16, 185, 129, 0.1), 0 4px 6px -4px rgba(16, 185, 129, 0.1)",
  },
  landingHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  landingHeaderLeft: {
    flex: 1,
  },
  landingBadge: {
    display: "inline-block",
    fontSize: 11,
    fontWeight: 800,
    color: "#065f46",
    background: "#d1fae5",
    padding: "3px 8px",
    borderRadius: 999,
    marginBottom: 6,
    letterSpacing: "0.03em",
  },
  landingTitle: {
    margin: "0 0 4px 0",
    fontSize: 18,
    fontWeight: 800,
    color: "#0f172a",
  },
  landingSubtitle: {
    margin: 0,
    fontSize: 13,
    color: "#475569",
    lineHeight: 1.4,
  },
  landingDismissButton: {
    background: "transparent",
    border: 0,
    fontSize: 22,
    lineHeight: 1,
    color: "#94a3b8",
    cursor: "pointer",
    padding: "0 4px",
  },
  landingActions: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 14,
    flexWrap: "wrap",
  },
  landingPrimaryButton: {
    border: 0,
    borderRadius: 10,
    background: "#059669",
    color: "#ffffff",
    padding: "10px 18px",
    fontWeight: 800,
    fontSize: 13,
    cursor: "pointer",
    boxShadow: "0 2px 4px rgba(5, 150, 105, 0.2)",
  },
  landingSecondaryButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    background: "#ffffff",
    color: "#0f172a",
    padding: "10px 18px",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  },
  landingLinkButton: {
    border: 0,
    background: "transparent",
    color: "#2563eb",
    padding: "10px 14px",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    textDecoration: "underline",
  },
};