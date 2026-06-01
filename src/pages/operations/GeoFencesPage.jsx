// src/pages/operations/GeoFencesPage.jsx

import { useEffect, useMemo, useRef, useState } from "react";
import { APIProvider, Map, useMap } from "@vis.gl/react-google-maps";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import { useWarehouse } from "@/context/WarehouseContext";

import {
  useCreateGeoFenceMutation,
  useGetGeoFencesByWardQuery,
  useGetGeofenceMemberErfsByWardQuery,
  useGetGeofenceMemberMetersByWardQuery,
  useGetGeofenceMemberPremisesByWardQuery,
  useGetNoGeofenceMetersByWardQuery,
  useGetTcMetersForGeofenceQuery,
} from "../../redux/geofencesApi";

const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

const FALLBACK_CENTER = {
  lat: -26.461472069502317,
  lng: 28.50667220650696,
};

function isZeroZeroPoint(point) {
  const lat = Number(point?.lat ?? point?.latitude);
  const lng = Number(point?.lng ?? point?.longitude);

  return Number.isFinite(lat) && Number.isFinite(lng) && lat === 0 && lng === 0;
}

function isUsableMapPoint(point) {
  const lat = Number(point?.lat ?? point?.latitude);
  const lng = Number(point?.lng ?? point?.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;

  // iREPS operational geography is never at 0,0. Treat this as missing/bad GPS
  // so a single bad point cannot pull the map away from the selected geofence.
  if (lat === 0 && lng === 0) return false;

  return true;
}

function toUsableLatLng(point) {
  if (!isUsableMapPoint(point)) return null;

  return {
    lat: Number(point?.lat ?? point?.latitude),
    lng: Number(point?.lng ?? point?.longitude),
  };
}

function getActiveLmPcode(activeWorkbase, selectedLm) {
  return (
    selectedLm?.pcode ||
    selectedLm?.id ||
    activeWorkbase?.lmPcode ||
    activeWorkbase?.pcode ||
    activeWorkbase?.id ||
    activeWorkbase?.localMunicipalityId ||
    ""
  );
}

function getSelectedWardPcode(selectedWard) {
  return (
    selectedWard?.pcode ||
    selectedWard?.id ||
    selectedWard?.wardPcode ||
    selectedWard?.code ||
    ""
  );
}

function isMissingScopeValue(value) {
  const text = String(value || "")
    .trim()
    .toUpperCase();

  return (
    !text ||
    text === "NAV" ||
    text === "N/AV" ||
    text === "N/A" ||
    text === "NA" ||
    text === "NULL" ||
    text === "UNDEFINED"
  );
}

function sanitizeScopeValue(value) {
  return isMissingScopeValue(value) ? "" : String(value || "").trim();
}

function getWardPcodeFromFocusAstId(focusAstId, lmPcode) {
  const cleanFocusAstId = sanitizeScopeValue(focusAstId);
  const cleanLmPcode = sanitizeScopeValue(lmPcode);

  if (!cleanFocusAstId) return "";

  const parts = cleanFocusAstId.split("_").map((part) => part.trim());

  if (cleanLmPcode) {
    const wardFromLm = parts.find(
      (part) =>
        part.startsWith(cleanLmPcode) && part.length >= cleanLmPcode.length + 3,
    );

    if (wardFromLm) return wardFromLm;
  }

  const wardMatch = cleanFocusAstId.match(/ZA\d{7}/);

  return wardMatch?.[0] || "";
}

function getBooleanSearchParam(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase();

  return text === "true" || text === "1" || text === "yes";
}

function parseFocusPointFromSearchParams(searchParams) {
  const lat = Number(searchParams.get("focusLat"));
  const lng = Number(searchParams.get("focusLng"));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng };
}

function getFocusDisplayLabel({
  focusType,
  focusLabel,
  focusAstId,
  focusPremiseId,
  focusGeofenceId,
  focusGeofenceName,
}) {
  return (
    focusLabel ||
    focusGeofenceName ||
    focusAstId ||
    focusPremiseId ||
    focusGeofenceId ||
    focusType ||
    "NAv"
  );
}

function getWardPcode(ward) {
  return ward?.id || ward?.pcode || ward?.wardPcode || "";
}

function getWardLabel(ward, wardPcode) {
  return (
    ward?.name ||
    ward?.wardName ||
    ward?.label ||
    (ward?.code ? `Ward ${ward.code}` : "") ||
    wardPcode ||
    "NAv"
  );
}

function parseGeometry(geometry) {
  if (!geometry) return null;

  if (typeof geometry === "string") {
    try {
      return JSON.parse(geometry);
    } catch (error) {
      console.error("Could not parse geometry:", error);
      return null;
    }
  }

  return geometry;
}

function geoJsonPolygonToGooglePaths(geoJsonGeometry) {
  if (!geoJsonGeometry) return [];

  if (geoJsonGeometry.type === "Polygon") {
    return geoJsonGeometry.coordinates.map((ring) =>
      ring.map(([lng, lat]) => ({ lat, lng })),
    );
  }

  if (geoJsonGeometry.type === "MultiPolygon") {
    return geoJsonGeometry.coordinates.flatMap((polygon) =>
      polygon.map((ring) => ring.map(([lng, lat]) => ({ lat, lng }))),
    );
  }

  return [];
}

function normalizeBbox(bbox) {
  if (!bbox) return null;

  const minLat = Number(bbox.minLat ?? bbox.minLatitude);
  const maxLat = Number(bbox.maxLat ?? bbox.maxLatitude);
  const minLng = Number(bbox.minLng ?? bbox.minLongitude);
  const maxLng = Number(bbox.maxLng ?? bbox.maxLongitude);

  if (
    !Number.isFinite(minLat) ||
    !Number.isFinite(maxLat) ||
    !Number.isFinite(minLng) ||
    !Number.isFinite(maxLng)
  ) {
    return null;
  }

  if (minLat === 0 && maxLat === 0 && minLng === 0 && maxLng === 0) {
    return null;
  }

  if (minLat > maxLat || minLng > maxLng) {
    return null;
  }

  return {
    minLat,
    maxLat,
    minLng,
    maxLng,
  };
}

function fitMapToBbox(map, bbox, padding = 56) {
  if (!map || !bbox || !window.google?.maps) return;

  const cleanBbox = normalizeBbox(bbox);
  if (!cleanBbox) return;

  const bounds = new window.google.maps.LatLngBounds();

  bounds.extend({
    lat: cleanBbox.minLat,
    lng: cleanBbox.minLng,
  });

  bounds.extend({
    lat: cleanBbox.maxLat,
    lng: cleanBbox.maxLng,
  });

  map.fitBounds(bounds, padding);
}

function getWardCenter(ward) {
  const lat = Number(ward?.centroid?.lat ?? ward?.centroid?.latitude);
  const lng = Number(ward?.centroid?.lng ?? ward?.centroid?.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return FALLBACK_CENTER;

  return {
    lat,
    lng,
  };
}

function getGeoFencePath(geoFence) {
  const points = geoFence?.geometry?.points || geoFence?.points || [];

  if (!Array.isArray(points)) return [];

  return [...points]
    .sort((left, right) => Number(left?.order || 0) - Number(right?.order || 0))
    .map(toUsableLatLng)
    .filter(Boolean);
}

function getGeoFencePointCount(geoFence) {
  return getGeoFencePath(geoFence).length;
}

function fitMapToGeoFenceAndWarningMeters(
  map,
  geoFence,
  noGeofenceMeters = [],
  padding = 88,
) {
  if (!map || !geoFence || !window.google?.maps) return;

  const bounds = new window.google.maps.LatLngBounds();
  let hasAnyPoint = false;

  const geoFencePath = getGeoFencePath(geoFence);

  geoFencePath.forEach((point) => {
    const usablePoint = toUsableLatLng(point);

    if (!usablePoint) return;

    bounds.extend(usablePoint);
    hasAnyPoint = true;
  });

  noGeofenceMeters.forEach((meter) => {
    const usablePoint = toUsableLatLng(getMarkerPoint(meter));

    if (!usablePoint) return;

    bounds.extend(usablePoint);
    hasAnyPoint = true;
  });

  if (!hasAnyPoint) {
    const bbox = normalizeBbox(geoFence?.bbox || geoFence?.geometry?.bbox);

    if (bbox) {
      fitMapToBbox(map, bbox, padding);
    }

    return;
  }

  map.fitBounds(bounds, padding);
}

function getParentsFromScope({
  lmPcode,
  wardPcode,
  activeWorkbase,
  selectedLm,
}) {
  return {
    countryPcode:
      selectedLm?.parents?.countryId ||
      selectedLm?.parents?.countryPcode ||
      activeWorkbase?.parents?.countryPcode ||
      activeWorkbase?.parents?.countryId ||
      "ZA",

    provincePcode:
      selectedLm?.parents?.provinceId ||
      selectedLm?.parents?.provincePcode ||
      activeWorkbase?.parents?.provincePcode ||
      activeWorkbase?.parents?.provinceId ||
      "NAv",

    dmPcode:
      selectedLm?.parents?.districtId ||
      selectedLm?.parents?.dmPcode ||
      activeWorkbase?.parents?.dmPcode ||
      activeWorkbase?.parents?.districtId ||
      "NAv",

    lmPcode,
    wardPcode,
  };
}

function getMarkerPoint(item) {
  return item?.__point || item?.__gps || null;
}

function getMeterNo(item) {
  return item?.__meterNo || "NAv";
}

function formatPremiseAddress(premise) {
  const address = premise?.address || {};

  if (typeof address === "string") return address;

  const parts = [
    address?.strNo,
    address?.strName,
    address?.strType,
    address?.suburbName,
  ].filter(Boolean);

  return parts.length ? parts.join(" ") : premise?.__premiseId || premise?.id;
}

function getErfDisplayNo(erf) {
  return (
    erf?.__erfNo ||
    erf?.erfNo ||
    erf?.erf?.erfNo ||
    erf?.erf?.number ||
    erf?.sg?.erfNo ||
    erf?.sg?.parcelNo ||
    erf?.sg?.parcelNumber ||
    erf?.admin?.erfNo ||
    erf?.admin?.parcelNo ||
    "NAv"
  );
}

/* =====================================================
   ZOOM-AWARE MARKER ICONS
   ===================================================== */

function getMarkerZoomScale(zoom) {
  const safeZoom = Number.isFinite(Number(zoom)) ? Number(zoom) : 16;

  if (safeZoom <= 13) return 0.5;
  if (safeZoom <= 14) return 0.58;
  if (safeZoom <= 15) return 0.68;
  if (safeZoom <= 16) return 0.78;
  if (safeZoom <= 17) return 0.88;
  if (safeZoom <= 18) return 0.98;

  return 1.08;
}

function useCurrentMapZoom(defaultZoom = 14) {
  const map = useMap();
  const [zoom, setZoom] = useState(defaultZoom);

  useEffect(() => {
    if (!map || !window.google?.maps) return undefined;

    function updateZoom() {
      setZoom(Number(map.getZoom() || defaultZoom));
    }

    updateZoom();

    const listener = map.addListener("zoom_changed", updateZoom);

    return () => {
      listener.remove();
    };
  }, [map, defaultZoom]);

  return zoom;
}

function makeSvgMapIcon({ type, zoom }) {
  if (!window.google?.maps) return null;

  const zoomScale = getMarkerZoomScale(zoom);

  const premiseSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36">
      <path d="M12 1.5C6.2 1.5 1.5 6.2 1.5 12C1.5 20.4 12 34.5 12 34.5C12 34.5 22.5 20.4 22.5 12C22.5 6.2 17.8 1.5 12 1.5Z"
        fill="#2563eb" stroke="#ffffff" stroke-width="2"/>
      <circle cx="12" cy="12" r="4.5" fill="#ffffff"/>
    </svg>
  `;

  const meterSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
      <path d="M22 3L41 22L22 41L3 22Z"
        fill="#0f766e" stroke="#ffffff" stroke-width="3"/>
      <path d="M24.8 8L14 24H21L18.8 36L30 19H23L24.8 8Z"
        fill="#ffffff"/>
    </svg>
  `;

  if (type === "premise") {
    const width = Math.round(16 * zoomScale);
    const height = Math.round(24 * zoomScale);

    return {
      url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(premiseSvg)}`,
      scaledSize: new window.google.maps.Size(width, height),
      anchor: new window.google.maps.Point(width / 2, height - 1),
    };
  }

  const size = Math.round(28 * zoomScale);

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(meterSvg)}`,
    scaledSize: new window.google.maps.Size(size, size),
    anchor: new window.google.maps.Point(size / 2, size / 2),
  };
}

function getPremiseMatchId(premise) {
  return (
    premise?.__premiseId ||
    premise?.premiseId ||
    premise?.id ||
    premise?.accessData?.premise?.id ||
    premise?.premise?.id ||
    ""
  );
}

function getMeterPremiseMatchId(meter) {
  return (
    meter?.accessData?.premise?.id ||
    meter?.accessData?.premiseId ||
    meter?.ast?.accessData?.premise?.id ||
    meter?.ast?.accessData?.premiseId ||
    meter?.premiseId ||
    meter?.premise?.id ||
    ""
  );
}

/* =====================================================
   MAP LAYERS
   ===================================================== */

function WardBoundaryLayer({ ward, shouldFit }) {
  const map = useMap();
  const polygonRef = useRef(null);

  const paths = useMemo(() => {
    return geoJsonPolygonToGooglePaths(parseGeometry(ward?.geometry));
  }, [ward?.geometry]);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    if (polygonRef.current) {
      polygonRef.current.setMap(null);
      polygonRef.current = null;
    }

    if (!paths.length) return;

    const polygon = new window.google.maps.Polygon({
      paths,
      strokeColor: "#f59e0b",
      strokeOpacity: 1,
      strokeWeight: 3,
      fillColor: "#f59e0b",
      fillOpacity: 0.08,
      clickable: false,
      zIndex: 20,
    });

    polygon.setMap(map);
    polygonRef.current = polygon;

    if (shouldFit) {
      fitMapToBbox(map, ward?.bbox, 56);
    }

    return () => {
      if (polygonRef.current) {
        polygonRef.current.setMap(null);
        polygonRef.current = null;
      }
    };
  }, [map, paths, ward?.bbox, shouldFit]);

  return null;
}

function ExistingGeoFenceLayer({
  geofences,
  selectedGeoFenceId,
  onSelectGeoFence,
  noGeofenceMeters,
  includeWarningMetersInFit = true,
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

    const polygons = (geofences || [])
      .map((geoFence) => {
        const path = getGeoFencePath(geoFence);

        if (path.length < 3) return null;

        const selected = selectedGeoFenceId === geoFence.id;

        const polygon = new window.google.maps.Polygon({
          paths: path,
          strokeColor: selected ? "#dc2626" : "#10b981",
          strokeOpacity: 1,
          strokeWeight: selected ? 4 : 2,
          fillColor: selected ? "#dc2626" : "#10b981",
          fillOpacity: selected ? 0.18 : 0.15,
          clickable: true,
          zIndex: selected ? 80 : 60,
        });

        const infoWindow = new window.google.maps.InfoWindow({
          content: `
            <div style="font-family: Arial, sans-serif; min-width: 200px;">
              <strong>${geoFence.name || geoFence.id}</strong>
              <div style="margin-top: 4px;">${geoFence.description || "NAv"}</div>
              <hr />
              <div>ERFs: ${geoFence?.counts?.erfs || 0}</div>
              <div>Premises: ${geoFence?.counts?.premises || 0}</div>
              <div>Meters: ${geoFence?.counts?.meters || 0}</div>
            </div>
          `,
        });

        polygon.addListener("click", (event) => {
          onSelectGeoFence?.(geoFence);

          infoWindow.setPosition(event.latLng);
          infoWindow.open({
            map,
            shouldFocus: false,
          });
        });

        polygon.setMap(map);

        return polygon;
      })
      .filter(Boolean);

    polygonsRef.current = polygons;

    return () => {
      polygonsRef.current.forEach((polygon) => polygon.setMap(null));
      polygonsRef.current = [];
    };
  }, [map, geofences, selectedGeoFenceId, onSelectGeoFence]);

  useEffect(() => {
    if (!map || !selectedGeoFence) return;

    const timer = setTimeout(() => {
      fitMapToGeoFenceAndWarningMeters(
        map,
        selectedGeoFence,
        includeWarningMetersInFit ? noGeofenceMeters : [],
        88,
      );
    }, 120);

    return () => clearTimeout(timer);
  }, [map, selectedGeoFence, noGeofenceMeters, includeWarningMetersInFit]);

  return null;
}

function DraftGeoFenceLayer({ draftPoints }) {
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

function NoGeofenceMetersLayer({ meters }) {
  const map = useMap();
  const markersRef = useRef([]);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];

    const markers = (meters || [])
      .map((meter) => {
        const point = toUsableLatLng(getMarkerPoint(meter));

        if (!point) return null;

        const marker = new window.google.maps.Marker({
          position: {
            lat: point.lat,
            lng: point.lng,
          },
          map,
          title: `NO_GEOFENCE: ${getMeterNo(meter)}`,
          label: {
            text: "!",
            color: "#ffffff",
            fontWeight: "900",
            fontSize: "16px",
          },
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 13,
            fillColor: "#f97316",
            fillOpacity: 1,
            strokeColor: "#7c2d12",
            strokeWeight: 3,
          },
          zIndex: 999,
        });

        const infoWindow = new window.google.maps.InfoWindow({
          content: `
            <div style="font-family: Arial, sans-serif; min-width: 240px;">
              <strong>${getMeterNo(meter)}</strong>
              <div>AST: ${meter.__astId || meter.id || "NAv"}</div>
              <div style="margin-top: 6px; color: #b45309; font-weight: 800;">
                NO_GEOFENCE
              </div>
              <div style="margin-top: 4px; font-size: 12px; color: #64748b;">
                This meter is in the ward but is not inside any geofence.
              </div>
            </div>
          `,
        });

        marker.addListener("click", () => {
          infoWindow.open({
            anchor: marker,
            map,
            shouldFocus: false,
          });
        });

        return marker;
      })
      .filter(Boolean);

    markersRef.current = markers;

    return () => {
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
    };
  }, [map, meters]);

  return null;
}

function SelectedGeofencePremiseMeterLinesLayer({ premises, meters }) {
  const map = useMap();
  const linesRef = useRef([]);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    linesRef.current.forEach((line) => line.setMap(null));
    linesRef.current = [];

    const premiseById = new globalThis.Map();
    // const premiseById = new Map();

    (premises || []).forEach((premise) => {
      const premiseId = getPremiseMatchId(premise);
      const premisePoint = toUsableLatLng(getMarkerPoint(premise));

      if (!premiseId || !premisePoint) return;

      premiseById.set(premiseId, {
        premise,
        point: premisePoint,
      });
    });

    const lines = (meters || [])
      .map((meter) => {
        const premiseId = getMeterPremiseMatchId(meter);
        const meterPoint = toUsableLatLng(getMarkerPoint(meter));
        const premiseItem = premiseById.get(premiseId);

        if (!premiseItem || !meterPoint) return null;

        const line = new window.google.maps.Polyline({
          path: [
            {
              lat: premiseItem.point.lat,
              lng: premiseItem.point.lng,
            },
            {
              lat: meterPoint.lat,
              lng: meterPoint.lng,
            },
          ],
          geodesic: true,
          strokeColor: "#475569",
          strokeOpacity: 0.72,
          strokeWeight: 2,
          clickable: true,
          zIndex: 125,
        });

        const infoWindow = new window.google.maps.InfoWindow({
          content: `
            <div style="font-family: Arial, sans-serif; min-width: 220px;">
              <strong>Premise → Meter</strong>
              <div>Premise: ${
                premiseItem.premise.__premiseId ||
                premiseItem.premise.id ||
                "NAv"
              }</div>
              <div>Meter: ${getMeterNo(meter)}</div>
            </div>
          `,
        });

        line.addListener("click", (event) => {
          infoWindow.setPosition(event.latLng);
          infoWindow.open({
            map,
            shouldFocus: false,
          });
        });

        line.setMap(map);

        return line;
      })
      .filter(Boolean);

    linesRef.current = lines;

    return () => {
      linesRef.current.forEach((line) => line.setMap(null));
      linesRef.current = [];
    };
  }, [map, premises, meters]);

  return null;
}

function SelectedGeofenceMetersLayer({ meters }) {
  const map = useMap();
  const zoom = useCurrentMapZoom(14);
  const markersRef = useRef([]);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];

    const meterIcon = makeSvgMapIcon({ type: "meter", zoom });

    const markers = (meters || [])
      .map((meter) => {
        const point = toUsableLatLng(getMarkerPoint(meter));
        if (!point) return null;

        const marker = new window.google.maps.Marker({
          position: {
            lat: point.lat,
            lng: point.lng,
          },
          map,
          title: `Meter: ${getMeterNo(meter)}`,
          icon: meterIcon,
          zIndex: 145,
        });

        const infoWindow = new window.google.maps.InfoWindow({
          content: `
            <div style="font-family: Arial, sans-serif; min-width: 220px;">
              <strong>${getMeterNo(meter)}</strong>
              <div>AST: ${meter.__astId || meter.id || "NAv"}</div>
              <div style="margin-top: 6px; color: #0f766e; font-weight: 800;">
                Meter inside selected geofence
              </div>
            </div>
          `,
        });

        marker.addListener("click", () => {
          infoWindow.open({
            anchor: marker,
            map,
            shouldFocus: false,
          });
        });

        return marker;
      })
      .filter(Boolean);

    markersRef.current = markers;

    return () => {
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
    };
  }, [map, meters, zoom]);

  return null;
}

function SelectedGeofencePremisesLayer({ premises }) {
  const map = useMap();
  const zoom = useCurrentMapZoom(14);
  const markersRef = useRef([]);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];

    const premiseIcon = makeSvgMapIcon({ type: "premise", zoom });

    const markers = (premises || [])
      .map((premise) => {
        const point = toUsableLatLng(getMarkerPoint(premise));
        if (!point) return null;

        const address = formatPremiseAddress(premise);

        const marker = new window.google.maps.Marker({
          position: {
            lat: point.lat,
            lng: point.lng,
          },
          map,
          title: `Premise: ${address}`,
          icon: premiseIcon,
          zIndex: 150,
        });

        const infoWindow = new window.google.maps.InfoWindow({
          content: `
            <div style="font-family: Arial, sans-serif; min-width: 220px;">
              <strong>${address}</strong>
              <div>Premise: ${premise.__premiseId || premise.id || "NAv"}</div>
              <div style="margin-top: 6px; color: #2563eb; font-weight: 800;">
                Premise inside selected geofence
              </div>
            </div>
          `,
        });

        marker.addListener("click", () => {
          infoWindow.open({
            anchor: marker,
            map,
            shouldFocus: false,
          });
        });

        return marker;
      })
      .filter(Boolean);

    markersRef.current = markers;

    return () => {
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
    };
  }, [map, premises, zoom]);

  return null;
}

function SelectedGeofenceErfsLayer({ erfs }) {
  const map = useMap();
  const polygonsRef = useRef([]);
  const markersRef = useRef([]);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    polygonsRef.current.forEach((polygon) => polygon.setMap(null));
    markersRef.current.forEach((marker) => marker.setMap(null));

    polygonsRef.current = [];
    markersRef.current = [];

    const polygons = [];
    const markers = [];

    (erfs || []).forEach((erf) => {
      const erfNo = getErfDisplayNo(erf);
      const paths = geoJsonPolygonToGooglePaths(parseGeometry(erf?.geometry));

      paths.forEach((path) => {
        if (!path?.length) return;

        const polygon = new window.google.maps.Polygon({
          paths: path,
          strokeColor: "#0284c7",
          strokeOpacity: 0.95,
          strokeWeight: 1.5,
          fillColor: "#38bdf8",
          fillOpacity: 0.08,
          clickable: true,
          zIndex: 90,
        });

        const infoWindow = new window.google.maps.InfoWindow({
          content: `
            <div style="font-family: Arial, sans-serif; min-width: 180px;">
              <strong>ERF ${erfNo}</strong>
              <div>${erf.__erfId || erf.id || "NAv"}</div>
              <div>Inside selected geofence</div>
            </div>
          `,
        });

        polygon.addListener("click", (event) => {
          infoWindow.setPosition(event.latLng);
          infoWindow.open({
            map,
            shouldFocus: false,
          });
        });

        polygon.setMap(map);
        polygons.push(polygon);
      });

      const point = toUsableLatLng(getMarkerPoint(erf));

      if (point) {
        const marker = new window.google.maps.Marker({
          position: {
            lat: point.lat,
            lng: point.lng,
          },
          map,
          title: `ERF ${erfNo}`,
          label: {
            text: String(erfNo || "E").slice(0, 4),
            color: "#0f172a",
            fontWeight: "900",
          },
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 5,
            fillColor: "#bae6fd",
            fillOpacity: 0.95,
            strokeColor: "#0284c7",
            strokeWeight: 1,
          },
          zIndex: 95,
        });

        markers.push(marker);
      }
    });

    polygonsRef.current = polygons;
    markersRef.current = markers;

    return () => {
      polygonsRef.current.forEach((polygon) => polygon.setMap(null));
      markersRef.current.forEach((marker) => marker.setMap(null));

      polygonsRef.current = [];
      markersRef.current = [];
    };
  }, [map, erfs]);

  return null;
}

function TcFocusMeterLayer({ tcMeters, focusAstId }) {
  const map = useMap();
  const markerRef = useRef(null);

  const focusRow = useMemo(() => {
    if (!focusAstId) return null;

    return (
      (tcMeters || []).find((row) => row.__astId === focusAstId) ||
      (tcMeters || []).find((row) => row.id === focusAstId) ||
      null
    );
  }, [tcMeters, focusAstId]);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    if (markerRef.current) {
      markerRef.current.setMap(null);
      markerRef.current = null;
    }

    const point = toUsableLatLng(getMarkerPoint(focusRow));
    if (!point) return;

    const marker = new window.google.maps.Marker({
      position: {
        lat: point.lat,
        lng: point.lng,
      },
      map,
      title: getMeterNo(focusRow),
      label: {
        text: "TC",
        color: "#ffffff",
        fontWeight: "900",
      },
      icon: {
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: 12,
        fillColor: "#dc2626",
        fillOpacity: 0.95,
        strokeColor: "#ffffff",
        strokeWeight: 4,
      },
      zIndex: 220,
    });

    markerRef.current = marker;

    map.panTo({
      lat: point.lat,
      lng: point.lng,
    });

    map.setZoom(19);

    return () => {
      if (markerRef.current) {
        markerRef.current.setMap(null);
        markerRef.current = null;
      }
    };
  }, [map, focusRow]);

  return null;
}

function UrlFocusPointLayer({ focusType, point, label }) {
  const map = useMap();
  const markerRef = useRef(null);

  useEffect(() => {
    if (!map || !window.google?.maps || !point || !isUsableMapPoint(point)) return;

    if (markerRef.current) {
      markerRef.current.setMap(null);
      markerRef.current = null;
    }

    const normalizedFocusType = String(focusType || "FOCUS").toUpperCase();
    const isPremise = normalizedFocusType === "PREMISE";
    const markerLabel = isPremise ? "P" : "M";
    const markerColor = isPremise ? "#2563eb" : "#0f766e";

    const marker = new window.google.maps.Marker({
      position: {
        lat: point.lat,
        lng: point.lng,
      },
      map,
      title: label || normalizedFocusType,
      label: {
        text: markerLabel,
        color: "#ffffff",
        fontWeight: "900",
      },
      icon: {
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: 14,
        fillColor: markerColor,
        fillOpacity: 0.96,
        strokeColor: "#ffffff",
        strokeWeight: 4,
      },
      zIndex: 240,
    });

    const infoWindow = new window.google.maps.InfoWindow({
      content: `
        <div style="font-family: Arial, sans-serif; min-width: 220px;">
          <strong>${label || normalizedFocusType}</strong>
          <div style="margin-top: 6px; color: ${markerColor}; font-weight: 800;">
            BGO ${normalizedFocusType} focus
          </div>
        </div>
      `,
    });

    marker.addListener("click", () => {
      infoWindow.open({
        anchor: marker,
        map,
        shouldFocus: false,
      });
    });

    markerRef.current = marker;

    map.panTo({
      lat: point.lat,
      lng: point.lng,
    });

    map.setZoom(19);

    window.setTimeout(() => {
      infoWindow.open({
        anchor: marker,
        map,
        shouldFocus: false,
      });
    }, 350);

    return () => {
      if (markerRef.current) {
        markerRef.current.setMap(null);
        markerRef.current = null;
      }
    };
  }, [map, focusType, point, label]);

  return null;
}

/* =====================================================
   MODAL
   ===================================================== */

function Modal({ title, children, onClose, width = 720 }) {
  return (
    <div style={modalBackdropStyle}>
      <div style={{ ...modalCardStyle, maxWidth: width }}>
        <div style={modalHeaderStyle}>
          <h2 style={{ margin: 0 }}>{title}</h2>

          <button onClick={onClose} style={modalCloseButtonStyle}>
            ×
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}

/* =====================================================
   PAGE
   ===================================================== */

export default function GeoFencesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const { activeWorkbase } = useAuth();
  const { geoState } = useGeo();
  const { available } = useWarehouse();

  const selectedLm = geoState?.selectedLm || null;
  const selectedWard = geoState?.selectedWard || null;

  const queryLmPcode = sanitizeScopeValue(searchParams.get("lmPcode"));
  const queryWardPcode = sanitizeScopeValue(searchParams.get("wardPcode"));

  const tcId = sanitizeScopeValue(searchParams.get("tcId"));
  const focusType = sanitizeScopeValue(searchParams.get("focusType")).toUpperCase();
  const focusAstId = sanitizeScopeValue(searchParams.get("focusAstId"));
  const focusPremiseId = sanitizeScopeValue(searchParams.get("focusPremiseId"));
  const focusGeofenceId = sanitizeScopeValue(searchParams.get("focusGeofenceId"));
  const focusGeofenceName = sanitizeScopeValue(
    searchParams.get("focusGeofenceName"),
  );
  const focusLabel = sanitizeScopeValue(searchParams.get("focusLabel"));
  const fitGeofence = getBooleanSearchParam(searchParams.get("fitGeofence"));
  const focusPoint = parseFocusPointFromSearchParams(searchParams);
  const focusDisplayLabel = getFocusDisplayLabel({
    focusType,
    focusLabel,
    focusAstId,
    focusPremiseId,
    focusGeofenceId,
    focusGeofenceName,
  });
  const isTcContext = Boolean(tcId);

  const lmPcode =
    queryLmPcode ||
    sanitizeScopeValue(getActiveLmPcode(activeWorkbase, selectedLm));

  const wardPcodeFromFocusAstId = getWardPcodeFromFocusAstId(
    focusAstId,
    lmPcode,
  );

  const wardPcode =
    queryWardPcode ||
    wardPcodeFromFocusAstId ||
    sanitizeScopeValue(getSelectedWardPcode(selectedWard));

  const selectedWardDoc = useMemo(() => {
    return (
      (available?.wards || []).find(
        (ward) => getWardPcode(ward) === wardPcode,
      ) ||
      selectedWard ||
      null
    );
  }, [available?.wards, selectedWard, wardPcode]);

  const wardLabel = getWardLabel(selectedWardDoc, wardPcode);
  const mapCenter = getWardCenter(selectedWardDoc);

  const [mapTypeId, setMapTypeId] = useState("roadmap");
  const [selectedGeoFence, setSelectedGeoFence] = useState(null);

  const selectedGeoFenceId = selectedGeoFence?.id || "";

  const [listModalOpen, setListModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [isCreateMode, setIsCreateMode] = useState(false);

  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftPoints, setDraftPoints] = useState([]);

  const { data: geofences = [], isLoading: geofencesLoading } =
    useGetGeoFencesByWardQuery(
      { lmPcode, wardPcode },
      { skip: !lmPcode || !wardPcode },
    );

  useEffect(() => {
    if (!focusGeofenceId || geofences.length === 0) return;

    const nextGeoFence =
      geofences.find((geoFence) => geoFence.id === focusGeofenceId) ||
      geofences.find((geoFence) => geoFence.name === focusGeofenceName) ||
      null;

    if (!nextGeoFence) return;
    if (selectedGeoFence?.id === nextGeoFence.id) return;

    setSelectedGeoFence(nextGeoFence);
  }, [
    focusGeofenceId,
    focusGeofenceName,
    geofences,
    selectedGeoFence?.id,
  ]);

  const { data: noGeofenceMeters = [] } = useGetNoGeofenceMetersByWardQuery(
    { lmPcode, wardPcode },
    { skip: !lmPcode || !wardPcode },
  );

  const { data: selectedGeofenceMeters = [] } =
    useGetGeofenceMemberMetersByWardQuery(
      { lmPcode, wardPcode, geoFenceId: selectedGeoFenceId },
      { skip: !lmPcode || !wardPcode || !selectedGeoFenceId },
    );

  const { data: selectedGeofencePremises = [] } =
    useGetGeofenceMemberPremisesByWardQuery(
      { lmPcode, wardPcode, geoFenceId: selectedGeoFenceId },
      { skip: !lmPcode || !wardPcode || !selectedGeoFenceId },
    );

  const { data: selectedGeofenceErfs = [] } =
    useGetGeofenceMemberErfsByWardQuery(
      { lmPcode, wardPcode, geoFenceId: selectedGeoFenceId },
      { skip: !lmPcode || !wardPcode || !selectedGeoFenceId },
    );

  const { data: tcMeters = [] } = useGetTcMetersForGeofenceQuery(
    { tcId, lmPcode, wardPcode },
    { skip: !isTcContext || !tcId || !lmPcode || !wardPcode },
  );

  const [createGeoFence, createState] = useCreateGeoFenceMutation();

  const draftPolygonReady = draftPoints.length >= 3;
  const canSaveDraft =
    draftName.trim().length > 0 && draftPolygonReady && !createState.isLoading;

  const selectedStats = useMemo(() => {
    return {
      erfs: selectedGeofenceErfs.length,
      premises: selectedGeofencePremises.length,
      meters: selectedGeofenceMeters.length,
    };
  }, [
    selectedGeofenceErfs.length,
    selectedGeofencePremises.length,
    selectedGeofenceMeters.length,
  ]);

  function handleOpenCreateModal() {
    setCreateModalOpen(true);
  }

  function handleStartDrawing() {
    if (!draftName.trim()) {
      alert("Geofence name is required.");
      return;
    }

    setSelectedGeoFence(null);
    setDraftPoints([]);
    setCreateModalOpen(false);
    setIsCreateMode(true);
  }

  function handleMapClick(event) {
    if (!isCreateMode) return;

    const lat = Number(event?.detail?.latLng?.lat);
    const lng = Number(event?.detail?.latLng?.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    setDraftPoints((current) => [...current, { lat, lng }]);
  }

  function handleUndoPoint() {
    setDraftPoints((current) => current.slice(0, -1));
  }

  function handleRestartDraft() {
    setDraftPoints([]);
  }

  function handleCancelDraft() {
    setIsCreateMode(false);
    setDraftName("");
    setDraftDescription("");
    setDraftPoints([]);
  }

  async function handleSaveDraft() {
    if (!canSaveDraft) return;

    const payload = {
      name: draftName.trim(),
      description: draftDescription.trim() || "NAv",
      parents: getParentsFromScope({
        lmPcode,
        wardPcode,
        activeWorkbase,
        selectedLm,
      }),
      points: draftPoints.map((point, index) => ({
        latitude: point.lat,
        longitude: point.lng,
        order: index,
      })),
    };

    const result = await createGeoFence(payload);

    if (result?.error) {
      alert(result.error?.message || "Failed to create geofence.");
      return;
    }

    alert(
      isTcContext
        ? "Geofence created. iREPS will update ERFs, premises, meters and TC readiness automatically."
        : "Geofence created. iREPS will update ERFs, premises and meters automatically.",
    );

    handleCancelDraft();
  }

  if (!googleMapsApiKey) {
    return (
      <section className="panel">
        <h1>Geo Fences</h1>
        <div className="empty-state error-box">
          <h2>Google Maps key missing</h2>
          <p className="muted">
            Add VITE_GOOGLE_MAPS_API_KEY to .env.local, then restart Vite.
          </p>
        </div>
      </section>
    );
  }

  if (!lmPcode || !wardPcode) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Geo Fences</h1>

        <div
          style={{
            border: "1px solid #FDE68A",
            background: "#FFFBEB",
            borderRadius: 12,
            padding: 16,
            maxWidth: 780,
          }}
        >
          <h2 style={{ marginTop: 0 }}>LM/Ward scope required</h2>

          <p>
            Select a ward first, then open Geo-Fences again. Geo-Fences is
            LM/Ward scoped because every polygon must belong to one ward.
          </p>

          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button onClick={() => navigate("/ward-scope/map")}>
              Open Ward Map
            </button>

            <button onClick={() => navigate("/operations/tc-uploads")}>
              Open TC Uploads
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section style={pageStyle}>
      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>
            {isTcContext ? "TC Geofence Focus" : "Geofence Management"}
          </p>

          <h1 style={{ margin: 0 }}>Geo Fences</h1>

          <p style={{ margin: "6px 0 0", color: "#475569" }}>
            LM: <strong>{lmPcode}</strong> • Ward: <strong>{wardLabel}</strong>{" "}
            • Ward PCode: <strong>{wardPcode}</strong>
          </p>

          <p style={{ margin: "4px 0 0", color: "#64748B" }}>
            No-geofence meters: <strong>{noGeofenceMeters.length}</strong>
            {selectedGeoFence ? (
              <>
                {" "}
                • Selected geofence members:{" "}
                <strong>
                  {selectedStats.erfs} ERFs, {selectedStats.premises} premises,{" "}
                  {selectedStats.meters} meters
                </strong>
              </>
            ) : null}
          </p>

          {isTcContext ? (
            <p style={{ margin: "4px 0 0", color: "#64748B" }}>
              TC: <strong>{tcId}</strong> • Focus:{" "}
              <strong>{focusType || "AST"}</strong> •{" "}
              <strong>{focusDisplayLabel || "NAv"}</strong>
              {!queryWardPcode && wardPcodeFromFocusAstId ? (
                <> • Ward recovered from Focus AST</>
              ) : null}
            </p>
          ) : null}
        </div>

        <div style={headerActionsStyle}>
          <div style={countPillStyle}>
            <span>Geofences</span>
            <strong>{geofencesLoading ? "..." : geofences.length}</strong>
          </div>

          <button onClick={() => setListModalOpen(true)} style={buttonStyle}>
            Existing Geofences
          </button>

          <button onClick={handleOpenCreateModal} style={primaryButtonStyle}>
            Create Geofence
          </button>

          <button
            onClick={() =>
              setMapTypeId((current) =>
                current === "roadmap" ? "satellite" : "roadmap",
              )
            }
            style={buttonStyle}
          >
            {mapTypeId === "roadmap" ? "Satellite" : "Map"}
          </button>

          {selectedGeoFence ? (
            <button
              onClick={() => setSelectedGeoFence(null)}
              style={buttonStyle}
            >
              Clear Selection
            </button>
          ) : null}

          {isTcContext ? (
            <button
              onClick={() => navigate(`/operations/tc-uploads/${tcId}`)}
              style={buttonStyle}
            >
              Back to TC
            </button>
          ) : null}
        </div>
      </header>

      <div style={mapShellStyle}>
        {isCreateMode ? (
          <div style={drawingPanelStyle}>
            <strong>Creating: {draftName}</strong>

            <span>
              Points: {draftPoints.length}{" "}
              {draftPolygonReady ? "• Ready to save" : "• Minimum 3 required"}
            </span>

            <button
              onClick={handleUndoPoint}
              disabled={draftPoints.length === 0}
              style={buttonStyle}
            >
              Undo
            </button>

            <button
              onClick={handleRestartDraft}
              disabled={draftPoints.length === 0}
              style={buttonStyle}
            >
              Restart
            </button>

            <button
              onClick={handleSaveDraft}
              disabled={!canSaveDraft}
              style={{
                ...primaryButtonStyle,
                opacity: canSaveDraft ? 1 : 0.45,
              }}
            >
              {createState.isLoading ? "Saving..." : "Save"}
            </button>

            <button onClick={handleCancelDraft} style={buttonStyle}>
              Cancel
            </button>
          </div>
        ) : null}

        <APIProvider apiKey={googleMapsApiKey}>
          <Map
            defaultCenter={mapCenter}
            defaultZoom={14}
            mapTypeId={mapTypeId}
            gestureHandling="greedy"
            disableDefaultUI={false}
            onClick={handleMapClick}
            style={{ width: "100%", height: "100%" }}
          >
            <WardBoundaryLayer
              ward={selectedWardDoc}
              shouldFit={!selectedGeoFenceId && !focusAstId && !focusPoint}
            />

            <ExistingGeoFenceLayer
              geofences={geofences}
              selectedGeoFenceId={selectedGeoFenceId}
              onSelectGeoFence={setSelectedGeoFence}
              noGeofenceMeters={noGeofenceMeters}
              includeWarningMetersInFit={!fitGeofence}
            />

            {selectedGeoFenceId ? (
              <>
                <SelectedGeofenceErfsLayer erfs={selectedGeofenceErfs} />

                <SelectedGeofencePremiseMeterLinesLayer
                  premises={selectedGeofencePremises}
                  meters={selectedGeofenceMeters}
                />

                <SelectedGeofencePremisesLayer
                  premises={selectedGeofencePremises}
                />

                <SelectedGeofenceMetersLayer meters={selectedGeofenceMeters} />
              </>
            ) : null}

            <NoGeofenceMetersLayer meters={noGeofenceMeters} />

            {isTcContext && focusAstId && !focusPoint ? (
              <TcFocusMeterLayer tcMeters={tcMeters} focusAstId={focusAstId} />
            ) : null}

            {focusPoint ? (
              <UrlFocusPointLayer
                focusType={focusType}
                point={focusPoint}
                label={focusDisplayLabel}
              />
            ) : null}

            <DraftGeoFenceLayer draftPoints={draftPoints} />
          </Map>
        </APIProvider>
      </div>

      {listModalOpen ? (
        <Modal
          title={`Existing Geofences in ${wardLabel}`}
          onClose={() => setListModalOpen(false)}
          width={860}
        >
          {geofences.length === 0 ? (
            <p>No active geofences found in this ward.</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {geofences.map((geoFence) => (
                <div
                  key={geoFence.id}
                  style={{
                    border: "1px solid #E5E7EB",
                    borderRadius: 12,
                    padding: 12,
                    background:
                      selectedGeoFence?.id === geoFence.id
                        ? "#FEF3C7"
                        : "white",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div>
                      <strong>{geoFence.name || geoFence.id}</strong>

                      <p style={{ margin: "4px 0 0", color: "#64748B" }}>
                        {geoFence.description || "NAv"}
                      </p>
                    </div>

                    <button
                      onClick={() => {
                        setSelectedGeoFence(geoFence);
                        setListModalOpen(false);
                      }}
                      style={buttonStyle}
                    >
                      Show on map
                    </button>
                  </div>

                  <div style={modalCountsRowStyle}>
                    <span>ERFs: {geoFence?.counts?.erfs || 0}</span>
                    <span>Premises: {geoFence?.counts?.premises || 0}</span>
                    <span>Meters: {geoFence?.counts?.meters || 0}</span>
                    <span>Points: {getGeoFencePointCount(geoFence)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      ) : null}

      {createModalOpen ? (
        <Modal
          title="Create New Geofence"
          onClose={() => setCreateModalOpen(false)}
          width={620}
        >
          <label>
            Name
            <input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              placeholder="e.g. Ward 6 Block A"
              style={inputStyle}
            />
          </label>

          <label>
            Description
            <textarea
              value={draftDescription}
              onChange={(event) => setDraftDescription(event.target.value)}
              placeholder="Optional description"
              style={textareaStyle}
            />
          </label>

          <p style={{ color: "#64748B", fontSize: 13 }}>
            After clicking Start Drawing, click points directly on the map.
            Minimum 3 points are required.
          </p>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button
              onClick={() => setCreateModalOpen(false)}
              style={buttonStyle}
            >
              Cancel
            </button>

            <button onClick={handleStartDrawing} style={primaryButtonStyle}>
              Start Drawing
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

/* =====================================================
   STYLES
   ===================================================== */

const pageStyle = {
  height: "calc(100vh - 96px)",
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
  padding: "0 0 4px",
};

const eyebrowStyle = {
  margin: 0,
  color: "#64748B",
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const headerActionsStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  justifyContent: "flex-end",
};

const countPillStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid #E5E7EB",
  background: "white",
  borderRadius: 999,
  padding: "8px 12px",
  color: "#334155",
};

const buttonStyle = {
  border: "1px solid #CBD5E1",
  background: "white",
  color: "#0F172A",
  borderRadius: 10,
  padding: "9px 12px",
  fontWeight: 800,
  cursor: "pointer",
};

const primaryButtonStyle = {
  border: "1px solid #0F172A",
  background: "#0F172A",
  color: "white",
  borderRadius: 10,
  padding: "9px 12px",
  fontWeight: 800,
  cursor: "pointer",
};

const mapShellStyle = {
  position: "relative",
  flex: 1,
  minHeight: 520,
  border: "1px solid #E5E7EB",
  borderRadius: 16,
  overflow: "hidden",
  background: "#E2E8F0",
};

const drawingPanelStyle = {
  position: "absolute",
  top: 14,
  left: 14,
  right: 14,
  zIndex: 50,
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  background: "rgba(255,255,255,0.95)",
  border: "1px solid #E5E7EB",
  borderRadius: 14,
  padding: 12,
  boxShadow: "0 12px 30px rgba(15, 23, 42, 0.16)",
};

const modalBackdropStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 200,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(15, 23, 42, 0.45)",
  padding: 24,
};

const modalCardStyle = {
  width: "100%",
  maxHeight: "86vh",
  overflow: "auto",
  background: "white",
  borderRadius: 18,
  padding: 18,
  boxShadow: "0 24px 60px rgba(15, 23, 42, 0.28)",
};

const modalHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  marginBottom: 16,
};

const modalCloseButtonStyle = {
  border: "none",
  background: "#F1F5F9",
  color: "#0F172A",
  width: 34,
  height: 34,
  borderRadius: 17,
  fontSize: 24,
  lineHeight: "30px",
  cursor: "pointer",
};

const modalCountsRowStyle = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
  marginTop: 10,
  color: "#334155",
  fontSize: 13,
  fontWeight: 800,
};

const inputStyle = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  marginTop: 6,
  marginBottom: 12,
  padding: "10px 12px",
  border: "1px solid #CBD5E1",
  borderRadius: 10,
};

const textareaStyle = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  marginTop: 6,
  marginBottom: 12,
  padding: "10px 12px",
  border: "1px solid #CBD5E1",
  borderRadius: 10,
  minHeight: 84,
};
