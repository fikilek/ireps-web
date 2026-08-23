// src/pages/operations/GeoFencesPage.jsx

import { useEffect, useMemo, useRef, useState } from "react";
import { APIProvider, Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import { useWarehouse } from "@/context/WarehouseContext";

import { useGetAstsByLmPcodeWardPcodeQuery } from "../../redux/astsApi";
import { useGetPremisesByWardQuery } from "../../redux/mapPremisesApi";
import { useGetSalesByLmPcodeQuery } from "../../redux/salesApi";
import { useGetErfsByWardQuery } from "../../redux/wardErfsApi";
import {
  GeofencePlanningLayerControls,
  GeofencePlanningLayers,
} from "./GeofencePlanningLayers";
import {
  buildGeofencePlanningDraftStats,
  buildGeofencePlanningModel,
} from "./geofencePlanningModel";

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

function fitMapToGeoFence(map, geoFence, padding = 88) {
  if (!map || !geoFence || !window.google?.maps) return;

  const bbox = normalizeBbox(geoFence?.bbox || geoFence?.geometry?.bbox);

  if (bbox) {
    fitMapToBbox(map, bbox, padding);
    return;
  }

  const bounds = new window.google.maps.LatLngBounds();
  let hasAnyPoint = false;

  const geoFencePath = getGeoFencePath(geoFence);

  geoFencePath.forEach((point) => {
    const usablePoint = toUsableLatLng(point);

    if (!usablePoint) return;

    bounds.extend(usablePoint);
    hasAnyPoint = true;
  });

  if (!hasAnyPoint) return;

  map.fitBounds(bounds, padding);
}

function fitMapToWard(map, ward, padding = 56) {
  if (!map || !ward || !window.google?.maps) return;

  const bbox = normalizeBbox(ward?.bbox || ward?.geometry?.bbox);

  if (bbox) {
    fitMapToBbox(map, bbox, padding);
    return;
  }

  const paths = geoJsonPolygonToGooglePaths(parseGeometry(ward?.geometry));
  const bounds = new window.google.maps.LatLngBounds();
  let hasAnyPoint = false;

  paths.flat().forEach((point) => {
    const usablePoint = toUsableLatLng(point);

    if (!usablePoint) return;

    bounds.extend(usablePoint);
    hasAnyPoint = true;
  });

  if (hasAnyPoint) {
    map.fitBounds(bounds, padding);
    return;
  }

  const center = getWardCenter(ward);

  if (!center || center === FALLBACK_CENTER) return;

  map.panTo(center);
  map.setZoom(14);
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

function WardBoundaryLayer({
  ward,
  shouldFit,
  manualWardFlightKey = 0,
  manualWardFlightWard = null,
}) {
  const map = useMap();
  const polygonRef = useRef(null);
  const wardPcode = getWardPcode(ward);
  const manualWardPcode = getWardPcode(manualWardFlightWard);

  const paths = useMemo(() => {
    return geoJsonPolygonToGooglePaths(parseGeometry(ward?.geometry));
  }, [ward?.geometry]);

  useEffect(() => {
    if (!map || !shouldFit) return;

    const timer = setTimeout(() => {
      fitMapToWard(map, ward, 56);
    }, 120);

    return () => clearTimeout(timer);
  }, [map, shouldFit, wardPcode, ward?.bbox, ward?.geometry]);

  useEffect(() => {
    if (!map || !manualWardFlightKey || !manualWardFlightWard) return;

    const timer = setTimeout(() => {
      fitMapToWard(map, manualWardFlightWard, 56);
    }, 120);

    return () => clearTimeout(timer);
  }, [
    map,
    manualWardFlightKey,
    manualWardPcode,
    manualWardFlightWard?.bbox,
    manualWardFlightWard?.geometry,
  ]);

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

    return () => {
      if (polygonRef.current) {
        polygonRef.current.setMap(null);
        polygonRef.current = null;
      }
    };
  }, [map, paths]);

  return null;
}

function ExistingGeoFenceLayer({
  geofences,
  selectedGeoFenceId,
  onSelectGeoFence,
  interactive = true,
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
          clickable: interactive,
          zIndex: selected ? 80 : 60,
        });

        if (interactive) {
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
      polygonsRef.current.forEach((polygon) => polygon.setMap(null));
      polygonsRef.current = [];
    };
  }, [map, geofences, selectedGeoFenceId, onSelectGeoFence, interactive]);

  useEffect(() => {
    if (!map || !selectedGeoFence) return;

    const timer = setTimeout(() => {
      fitMapToGeoFence(map, selectedGeoFence, 88);
    }, 120);

    return () => clearTimeout(timer);
  }, [map, selectedGeoFence]);

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

function NoGeofenceMetersLayer({ meters, interactive = true }) {
  const map = useMap();
  const markersRef = useRef([]);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];
    const infoWindows = [];

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
          clickable: interactive,
          zIndex: 999,
        });

        if (interactive) {
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

          infoWindows.push(infoWindow);

          marker.addListener("click", () => {
            infoWindow.open({
              anchor: marker,
              map,
              shouldFocus: false,
            });
          });
        }

        return marker;
      })
      .filter(Boolean);

    markersRef.current = markers;

    return () => {
      infoWindows.forEach((infoWindow) => infoWindow.close());
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
    };
  }, [map, meters, interactive]);

  return null;
}

function SelectedGeofencePremiseMeterLinesLayer({
  premises,
  meters,
  interactive = true,
}) {
  const map = useMap();
  const linesRef = useRef([]);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    linesRef.current.forEach((line) => line.setMap(null));
    linesRef.current = [];
    const infoWindows = [];

    const premiseById = new globalThis.Map();
    // const premiseById = new globalThis.Map();

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
          clickable: interactive,
          zIndex: 125,
        });

        if (interactive) {
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

          infoWindows.push(infoWindow);

          line.addListener("click", (event) => {
            infoWindow.setPosition(event.latLng);
            infoWindow.open({
              map,
              shouldFocus: false,
            });
          });
        }

        line.setMap(map);

        return line;
      })
      .filter(Boolean);

    linesRef.current = lines;

    return () => {
      infoWindows.forEach((infoWindow) => infoWindow.close());
      linesRef.current.forEach((line) => line.setMap(null));
      linesRef.current = [];
    };
  }, [map, premises, meters, interactive]);

  return null;
}

function SelectedGeofenceMetersLayer({ meters, interactive = true }) {
  const map = useMap();
  const zoom = useCurrentMapZoom(14);
  const markersRef = useRef([]);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];
    const infoWindows = [];

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
          clickable: interactive,
          zIndex: 145,
        });

        if (interactive) {
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

          infoWindows.push(infoWindow);

          marker.addListener("click", () => {
            infoWindow.open({
              anchor: marker,
              map,
              shouldFocus: false,
            });
          });
        }

        return marker;
      })
      .filter(Boolean);

    markersRef.current = markers;

    return () => {
      infoWindows.forEach((infoWindow) => infoWindow.close());
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
    };
  }, [map, meters, zoom, interactive]);

  return null;
}

function SelectedGeofencePremisesLayer({ premises, interactive = true }) {
  const map = useMap();
  const zoom = useCurrentMapZoom(14);
  const markersRef = useRef([]);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];
    const infoWindows = [];

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
          clickable: interactive,
          zIndex: 150,
        });

        if (interactive) {
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

          infoWindows.push(infoWindow);

          marker.addListener("click", () => {
            infoWindow.open({
              anchor: marker,
              map,
              shouldFocus: false,
            });
          });
        }

        return marker;
      })
      .filter(Boolean);

    markersRef.current = markers;

    return () => {
      infoWindows.forEach((infoWindow) => infoWindow.close());
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
    };
  }, [map, premises, zoom, interactive]);

  return null;
}

function SelectedGeofenceErfsLayer({ erfs, interactive = true }) {
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
    const infoWindows = [];

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
          clickable: interactive,
          zIndex: 90,
        });

        if (interactive) {
          const infoWindow = new window.google.maps.InfoWindow({
            content: `
              <div style="font-family: Arial, sans-serif; min-width: 180px;">
                <strong>ERF ${erfNo}</strong>
                <div>${erf.__erfId || erf.id || "NAv"}</div>
                <div>Inside selected geofence</div>
              </div>
            `,
          });

          infoWindows.push(infoWindow);

          polygon.addListener("click", (event) => {
            infoWindow.setPosition(event.latLng);
            infoWindow.open({
              map,
              shouldFocus: false,
            });
          });
        }

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
          clickable: interactive,
          zIndex: 95,
        });

        markers.push(marker);
      }
    });

    polygonsRef.current = polygons;
    markersRef.current = markers;

    return () => {
      infoWindows.forEach((infoWindow) => infoWindow.close());
      polygonsRef.current.forEach((polygon) => polygon.setMap(null));
      markersRef.current.forEach((marker) => marker.setMap(null));

      polygonsRef.current = [];
      markersRef.current = [];
    };
  }, [map, erfs, interactive]);

  return null;
}

function TcFocusMeterLayer({ tcMeters, focusAstId, interactive = true }) {
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
      clickable: interactive,
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
  }, [map, focusRow, interactive]);

  return null;
}

function UrlFocusPointLayer({
  focusType,
  point,
  label,
  interactive = true,
}) {
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
      clickable: interactive,
      zIndex: 240,
    });

    let openTimer = null;
    let infoWindow = null;

    if (interactive) {
      infoWindow = new window.google.maps.InfoWindow({
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

      openTimer = window.setTimeout(() => {
        infoWindow.open({
          anchor: marker,
          map,
          shouldFocus: false,
        });
      }, 350);
    }

    markerRef.current = marker;

    map.panTo({
      lat: point.lat,
      lng: point.lng,
    });

    map.setZoom(19);

    return () => {
      if (openTimer) window.clearTimeout(openTimer);
      infoWindow?.close();
      if (markerRef.current) {
        markerRef.current.setMap(null);
        markerRef.current = null;
      }
    };
  }, [map, focusType, point, label, interactive]);

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
  const { geoState, updateGeo } = useGeo();
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

  const scopeReady = Boolean(lmPcode && wardPcode);

  const selectedWardDoc = useMemo(() => {
    const wards = Array.isArray(available?.wards) ? available.wards : [];

    const matchingSelectedWard =
      getWardPcode(selectedWard) === wardPcode ? selectedWard : null;

    return (
      wards.find((ward) => getWardPcode(ward) === wardPcode) ||
      matchingSelectedWard ||
      null
    );
  }, [available, selectedWard, wardPcode]);

  const wardOptions = useMemo(() => {
    const wards = Array.isArray(available?.wards) ? available.wards : [];

    return [...wards]
      .filter((ward) => getWardPcode(ward))
      .sort((left, right) =>
        String(getWardLabel(left, getWardPcode(left))).localeCompare(
          String(getWardLabel(right, getWardPcode(right))),
          undefined,
          { numeric: true, sensitivity: "base" },
        ),
      );
  }, [available]);

  const wardLabel = getWardLabel(selectedWardDoc, wardPcode);
  const mapCenter = getWardCenter(selectedWardDoc);

  const [mapTypeId, setMapTypeId] = useState("roadmap");
  const [selectedGeoFence, setSelectedGeoFence] = useState(null);
  const [manualWardFlight, setManualWardFlight] = useState({
    key: 0,
    ward: null,
  });

  const selectedGeoFenceId = selectedGeoFence?.id || "";

  const [listModalOpen, setListModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [confirmCreateModalOpen, setConfirmCreateModalOpen] = useState(false);
  const [createSuccess, setCreateSuccess] = useState(null);
  const [isCreateMode, setIsCreateMode] = useState(false);

  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftPoints, setDraftPoints] = useState([]);
  const [planningLayerVisibility, setPlanningLayerVisibility] = useState({
    erfs: false,
    sales: false,
    premises: false,
    assets: false,
  });
  const [salesStatusVisibility, setSalesStatusVisibility] = useState({
    notStarted: false,
    inProgress: false,
    completed: false,
  });

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
    { skip: !scopeReady },
  );

  const { data: planningErfs = [] } = useGetErfsByWardQuery(
    { lmPcode, wardPcode },
    { skip: !scopeReady },
  );

  const { data: planningPremises = [] } = useGetPremisesByWardQuery(
    wardPcode,
    { skip: !scopeReady },
  );

  const { data: planningAssets = [] } = useGetAstsByLmPcodeWardPcodeQuery(
    { lmPcode, wardPcode },
    { skip: !scopeReady },
  );

  const { data: planningSalesRows = [] } = useGetSalesByLmPcodeQuery(
    lmPcode,
    { skip: !lmPcode },
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

  const planningModel = useMemo(() => {
    return buildGeofencePlanningModel({
      lmPcode,
      wardPcode,
      erfs: planningErfs,
      premises: planningPremises,
      assets: planningAssets,
      salesRows: planningSalesRows,
      noGeofenceMeters,
    });
  }, [
    lmPcode,
    wardPcode,
    planningErfs,
    planningPremises,
    planningAssets,
    planningSalesRows,
    noGeofenceMeters,
  ]);

  const draftPreviewStats = useMemo(() => {
    return buildGeofencePlanningDraftStats({
      draftPoints,
      erfs: planningModel.erfs,
      premises: planningModel.premises,
      assets: planningModel.assets,
      salesRecords: planningModel.salesRecords,
    });
  }, [draftPoints, planningModel]);

  function handleTogglePlanningLayer(layer) {
    setPlanningLayerVisibility((current) => ({
      ...current,
      [layer]: !current[layer],
    }));
  }

  function handleToggleSalesStatus(statusKey) {
    setSalesStatusVisibility((current) => ({
      ...current,
      [statusKey]: !current[statusKey],
    }));
  }

  function handleWardChange(event) {
    const nextWardPcode = sanitizeScopeValue(event?.target?.value);

    if (!nextWardPcode || nextWardPcode === wardPcode) return;

    const nextWard =
      wardOptions.find((ward) => getWardPcode(ward) === nextWardPcode) || null;

    if (!nextWard) return;

    updateGeo?.({
      selectedWard: nextWard,
      lastSelectionType: "WARD",
    });

    setManualWardFlight((current) => ({
      key: current.key + 1,
      ward: nextWard,
    }));

    setSelectedGeoFence(null);
    setListModalOpen(false);
    setCreateModalOpen(false);
    setConfirmCreateModalOpen(false);
    setCreateSuccess(null);
    setIsCreateMode(false);
    setDraftName("");
    setDraftDescription("");
    setDraftPoints([]);

    const nextSearchParams = new URLSearchParams(searchParams);

    nextSearchParams.set("lmPcode", lmPcode);
    nextSearchParams.set("wardPcode", nextWardPcode);

    // Keep tcId for TC repair flow, but clear one-meter/one-geofence focus.
    nextSearchParams.delete("focusType");
    nextSearchParams.delete("focusAstId");
    nextSearchParams.delete("focusPremiseId");
    nextSearchParams.delete("focusGeofenceId");
    nextSearchParams.delete("focusGeofenceName");
    nextSearchParams.delete("focusLabel");
    nextSearchParams.delete("focusLat");
    nextSearchParams.delete("focusLng");
    nextSearchParams.delete("fitGeofence");

    navigate({
      pathname: "/operations/geo-fences",
      search: `?${nextSearchParams.toString()}`,
    });
  }

  function handleOpenCreateModal() {
    if (!scopeReady) {
      alert("Select a ward first.");
      return;
    }

    setCreateModalOpen(true);
  }

  function handleStartDrawing() {
    if (!scopeReady) {
      alert("Select a ward first.");
      return;
    }

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
    setConfirmCreateModalOpen(false);
    setDraftName("");
    setDraftDescription("");
    setDraftPoints([]);
  }

  function handleOpenCreateConfirm() {
    if (!scopeReady) {
      alert("Select a ward first.");
      return;
    }

    if (!canSaveDraft) return;

    setConfirmCreateModalOpen(true);
  }

  async function handleConfirmCreate() {
    if (!scopeReady) {
      alert("Select a ward first.");
      return;
    }

    if (!canSaveDraft) return;

    const successPayload = {
      name: draftName.trim(),
      description: draftDescription.trim() || "NAv",
      wardLabel,
      stats: draftPreviewStats,
      isTcContext,
    };

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

    handleCancelDraft();
    setCreateSuccess(successPayload);
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

  return (
    <section style={pageStyle}>
      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>
            {isTcContext ? "TC Geofence Focus" : "Geofence Management"}
          </p>

          <h1 style={{ margin: 0 }}>Geo Fences</h1>

          <p style={{ margin: "6px 0 0", color: "#475569" }}>
            LM: <strong>{lmPcode || "NAv"}</strong> • Ward: {" "}
            <strong>{scopeReady ? wardLabel : "Select Ward"}</strong>
          </p>

          <p style={{ margin: "4px 0 0", color: "#64748B" }}>
            {scopeReady ? (
              <>
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
              </>
            ) : (
              <>Select a ward to load geofences and start drawing.</>
            )}
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
          <label style={wardSelectWrapStyle}>
            <span style={wardSelectLabelStyle}>Select Ward</span>
            <select
              value={wardPcode}
              onChange={handleWardChange}
              disabled={wardOptions.length === 0}
              style={wardSelectStyle}
            >
              {!wardPcode ? (
                <option value="">Select ward...</option>
              ) : null}

              {wardOptions.length === 0 ? (
                <option value="">No wards available</option>
              ) : (
                wardOptions.map((ward) => {
                  const optionWardPcode = getWardPcode(ward);

                  return (
                    <option key={optionWardPcode} value={optionWardPcode}>
                      {getWardLabel(ward, optionWardPcode)}
                    </option>
                  );
                })
              )}
            </select>
          </label>

          <div style={countPillStyle}>
            <span>Geofences</span>
            <strong>{geofencesLoading ? "..." : geofences.length}</strong>
          </div>

          <button onClick={() => setListModalOpen(true)} style={buttonStyle}>
            Existing Geofences
          </button>

          <button
            onClick={handleOpenCreateModal}
            disabled={!scopeReady}
            title={scopeReady ? "Create Geofence" : "Select a ward first"}
            style={{
              ...primaryButtonStyle,
              opacity: scopeReady ? 1 : 0.45,
              cursor: scopeReady ? "pointer" : "not-allowed",
            }}
          >
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

            <span style={drawingStatsStyle}>
              ERFs: <strong>{draftPreviewStats.erfs}</strong> • Sales:{" "}
              <strong>{draftPreviewStats.sales.total}</strong>{" "}
              (Not Started {draftPreviewStats.sales.notStarted}, In Progress{" "}
              {draftPreviewStats.sales.inProgress}, Completed{" "}
              {draftPreviewStats.sales.completed}) • Premises:{" "}
              <strong>{draftPreviewStats.premises}</strong> • Assets:{" "}
              <strong>{draftPreviewStats.assets}</strong>
              {draftPreviewStats.sales.integrityExceptions > 0 ? (
                <>
                  {" "}
                  • Sales integrity:{" "}
                  <strong>{draftPreviewStats.sales.integrityExceptions}</strong>
                </>
              ) : null}
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
              onClick={handleOpenCreateConfirm}
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

        <GeofencePlanningLayerControls
          model={planningModel}
          visibility={planningLayerVisibility}
          salesStatusVisibility={salesStatusVisibility}
          onToggleLayer={handleTogglePlanningLayer}
          onToggleSalesStatus={handleToggleSalesStatus}
          isCreateMode={isCreateMode}
        />

        <APIProvider apiKey={googleMapsApiKey}>
          <GoogleMap
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
              manualWardFlightKey={manualWardFlight.key}
              manualWardFlightWard={manualWardFlight.ward}
            />

            <ExistingGeoFenceLayer
              geofences={geofences}
              selectedGeoFenceId={selectedGeoFenceId}
              onSelectGeoFence={setSelectedGeoFence}
              interactive={!isCreateMode}
            />

            <GeofencePlanningLayers
              model={planningModel}
              visibility={planningLayerVisibility}
              salesStatusVisibility={salesStatusVisibility}
              isCreateMode={isCreateMode}
            />

            {selectedGeoFenceId ? (
              <>
                <SelectedGeofenceErfsLayer
                  erfs={selectedGeofenceErfs}
                  interactive={!isCreateMode}
                />

                <SelectedGeofencePremiseMeterLinesLayer
                  premises={selectedGeofencePremises}
                  meters={selectedGeofenceMeters}
                  interactive={!isCreateMode}
                />

                <SelectedGeofencePremisesLayer
                  premises={selectedGeofencePremises}
                  interactive={!isCreateMode}
                />

                <SelectedGeofenceMetersLayer
                  meters={selectedGeofenceMeters}
                  interactive={!isCreateMode}
                />
              </>
            ) : null}

            <NoGeofenceMetersLayer
              meters={noGeofenceMeters}
              interactive={!isCreateMode}
            />

            {isTcContext && focusAstId && !focusPoint ? (
              <TcFocusMeterLayer
                tcMeters={tcMeters}
                focusAstId={focusAstId}
                interactive={!isCreateMode}
              />
            ) : null}

            {focusPoint ? (
              <UrlFocusPointLayer
                focusType={focusType}
                point={focusPoint}
                label={focusDisplayLabel}
                interactive={!isCreateMode}
              />
            ) : null}

            <DraftGeoFenceLayer draftPoints={draftPoints} />
          </GoogleMap>
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

      {confirmCreateModalOpen ? (
        <Modal
          title="Confirm Geofence"
          onClose={() => setConfirmCreateModalOpen(false)}
          width={760}
        >
          <p style={confirmIntroStyle}>
            You are about to create this geofence. Please confirm the selected
            coverage.
          </p>

          <div style={countCardGridStyle}>
            <div style={countCardStyle}>
              <span style={countLabelStyle}>ERFs</span>
              <strong style={countValueStyle}>{draftPreviewStats.erfs}</strong>
            </div>

            <div style={countCardStyle}>
              <span style={countLabelStyle}>Sales</span>
              <strong style={countValueStyle}>{draftPreviewStats.sales.total}</strong>
              <span style={countDetailStyle}>
                Not Started {draftPreviewStats.sales.notStarted} • In Progress{" "}
                {draftPreviewStats.sales.inProgress} • Completed{" "}
                {draftPreviewStats.sales.completed}
              </span>
              {draftPreviewStats.sales.integrityExceptions > 0 ? (
                <span style={integrityDetailStyle}>
                  Integrity: {draftPreviewStats.sales.integrityExceptions}
                </span>
              ) : null}
            </div>

            <div style={countCardStyle}>
              <span style={countLabelStyle}>Premises</span>
              <strong style={countValueStyle}>{draftPreviewStats.premises}</strong>
            </div>

            <div style={countCardStyle}>
              <span style={countLabelStyle}>Assets</span>
              <strong style={countValueStyle}>{draftPreviewStats.assets}</strong>
            </div>
          </div>

          <div style={confirmDetailsStyle}>
            <div>
              <span style={confirmFieldLabelStyle}>Geofence Name</span>
              <strong>{draftName.trim()}</strong>
            </div>

            <div>
              <span style={confirmFieldLabelStyle}>Ward</span>
              <strong>{wardLabel}</strong>
            </div>
          </div>

          <div style={modalActionsStyle}>
            <button
              onClick={() => setConfirmCreateModalOpen(false)}
              disabled={createState.isLoading}
              style={buttonStyle}
            >
              Cancel
            </button>

            <button
              onClick={handleConfirmCreate}
              disabled={createState.isLoading}
              style={{
                ...primaryButtonStyle,
                opacity: createState.isLoading ? 0.55 : 1,
                cursor: createState.isLoading ? "not-allowed" : "pointer",
              }}
            >
              {createState.isLoading ? "Creating..." : "Confirm Create"}
            </button>
          </div>
        </Modal>
      ) : null}

      {createSuccess ? (
        <Modal
          title="Geofence Created"
          onClose={() => setCreateSuccess(null)}
          width={760}
        >
          <div style={successBoxStyle}>
            <strong>{createSuccess.name}</strong> was created successfully in{" "}
            <strong>{createSuccess.wardLabel}</strong>.
          </div>

          <div style={countCardGridStyle}>
            <div style={countCardStyle}>
              <span style={countLabelStyle}>ERFs planned</span>
              <strong style={countValueStyle}>{createSuccess.stats.erfs}</strong>
            </div>

            <div style={countCardStyle}>
              <span style={countLabelStyle}>Sales planned</span>
              <strong style={countValueStyle}>{createSuccess.stats.sales.total}</strong>
              <span style={countDetailStyle}>
                Not Started {createSuccess.stats.sales.notStarted} • In Progress{" "}
                {createSuccess.stats.sales.inProgress} • Completed{" "}
                {createSuccess.stats.sales.completed}
              </span>
            </div>

            <div style={countCardStyle}>
              <span style={countLabelStyle}>Premises planned</span>
              <strong style={countValueStyle}>{createSuccess.stats.premises}</strong>
            </div>

            <div style={countCardStyle}>
              <span style={countLabelStyle}>Assets planned</span>
              <strong style={countValueStyle}>{createSuccess.stats.assets}</strong>
            </div>
          </div>

          <p style={{ color: "#475569", marginTop: 16 }}>
            iREPS has submitted the geofence creation request. These are the
            planning-preview counts; authoritative ERF, premise, asset and Sales
            membership will update through the normal geofence membership process.
            {createSuccess.isTcContext
              ? " TC readiness will also update automatically."
              : ""}
          </p>

          <div style={modalActionsStyle}>
            <button
              onClick={() => setCreateSuccess(null)}
              style={primaryButtonStyle}
            >
              OK
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

const wardSelectWrapStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid #CBD5E1",
  background: "white",
  borderRadius: 10,
  padding: "6px 8px",
};

const wardSelectLabelStyle = {
  color: "#475569",
  fontSize: 12,
  fontWeight: 900,
  whiteSpace: "nowrap",
};

const wardSelectStyle = {
  border: "none",
  outline: "none",
  background: "transparent",
  color: "#0F172A",
  fontWeight: 900,
  cursor: "pointer",
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

const drawingStatsStyle = {
  color: "#334155",
  fontSize: 12,
  fontWeight: 700,
};

const countDetailStyle = {
  display: "block",
  marginTop: 4,
  color: "#475569",
  fontSize: 11,
  fontWeight: 800,
};

const integrityDetailStyle = {
  display: "block",
  marginTop: 4,
  color: "#b91c1c",
  fontSize: 11,
  fontWeight: 900,
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

const confirmIntroStyle = {
  color: "#475569",
  marginTop: 0,
  marginBottom: 16,
};

const countCardGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: 12,
  marginBottom: 18,
};

const countCardStyle = {
  border: "1px solid #E5E7EB",
  background: "#F8FAFC",
  borderRadius: 14,
  padding: "16px 14px",
  textAlign: "center",
};

const countLabelStyle = {
  display: "block",
  color: "#64748B",
  fontSize: 12,
  fontWeight: 900,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const countValueStyle = {
  display: "block",
  color: "#0F172A",
  fontSize: 30,
  lineHeight: "38px",
  marginTop: 4,
};

const confirmDetailsStyle = {
  display: "grid",
  gap: 12,
  borderTop: "1px solid #E5E7EB",
  paddingTop: 14,
};

const confirmFieldLabelStyle = {
  display: "block",
  color: "#64748B",
  fontSize: 12,
  fontWeight: 900,
  marginBottom: 4,
};

const modalActionsStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  marginTop: 20,
};

const successBoxStyle = {
  border: "1px solid #BBF7D0",
  background: "#F0FDF4",
  color: "#14532D",
  borderRadius: 14,
  padding: 14,
  marginBottom: 16,
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
