/* eslint-disable no-unused-vars -- Component tags are consumed by JSX; the repository uses the core ESLint rule. */
import { pageStyle, headerStyle, eyebrowStyle, wardSelectWrapStyle, wardSelectLabelStyle, wardSelectStyle, mapShellStyle } from "./geofence-ui-styles";
import { GeofenceToolbar, GeofenceDrawingBar, GeofenceDialogs } from "./geofence-shared-ui";
import { ExistingGeoFenceLayer, DraftGeoFenceLayer, WardBoundaryPolygons } from "./geofence-map-layers";
import { isUsableMapPoint, toUsableLatLng, normalizeBbox, fitMapToBbox, parseGeometry, geoJsonPolygonToGooglePaths } from "./geofence-map-helpers";
import { composeGeofenceName, geofenceNamePart, wardNumberFromPcode, findDuplicateGeofence, duplicateGeofenceNameMessage } from "../../../functions/geofences/geofence-name.js";
// src/pages/operations/GeoFencesPage.jsx

import { useEffect, useMemo, useRef, useState } from "react";
import { useGeofencePolygonDraft } from "../../features/maps/use-geofence-polygon-draft.js";
import { APIProvider, Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import { useWarehouse } from "@/context/WarehouseContext";

import { useGetAstsByLmPcodeWardPcodeQuery } from "../../redux/astsApi";
import { useGetPremisesByWardQuery } from "../../redux/mapPremisesApi";
import { useGetSalesCategoryViewQuery, useSalesReadScope } from "../../redux/salesApi";
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

function getWardCenter(ward) {
  const lat = Number(ward?.centroid?.lat ?? ward?.centroid?.latitude);
  const lng = Number(ward?.centroid?.lng ?? ward?.centroid?.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return FALLBACK_CENTER;

  return {
    lat,
    lng,
  };
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
  const wardPcode = getWardPcode(ward);
  const manualWardPcode = getWardPcode(manualWardFlightWard);

  // Drawn by the shared Ward boundary component, also used by the TB Draft Wards layer.
  const wardGeometry = ward?.geometry;
  const boundary = useMemo(() => {
    return wardGeometry ? [{ id: wardPcode, geometry: wardGeometry }] : [];
  }, [wardPcode, wardGeometry]);

  useEffect(() => {
    if (!map || !shouldFit) return;

    const timer = setTimeout(() => {
      fitMapToWard(map, ward, 56);
    }, 120);

    return () => clearTimeout(timer);
  }, [map, shouldFit, ward]);

  useEffect(() => {
    if (!map || !manualWardFlightKey || !manualWardFlightWard) return;

    const timer = setTimeout(() => {
      fitMapToWard(map, manualWardFlightWard, 56);
    }, 120);

    return () => clearTimeout(timer);
  }, [
    map,
    manualWardFlightKey,
    manualWardFlightWard,
  ]);

  return <WardBoundaryPolygons wards={boundary} />;
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

  const [geofenceKind, setGeofenceKind] = useState("ALL");
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
  const { points: draftPoints, setPoints: setDraftPoints } = useGeofencePolygonDraft();
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

  const visibleGeofences = geofences.filter(fence => geofenceKind === "ALL" || (geofenceKind === "BATCH") === Boolean(fence.targetedBatch));

  useEffect(() => {
    if (!focusGeofenceId || geofences.length === 0) return;

    const nextGeoFence =
      geofences.find((geoFence) => geoFence.id === focusGeofenceId) ||
      geofences.find((geoFence) => geoFence.name === focusGeofenceName) ||
      null;

    if (!nextGeoFence) return;
    if (selectedGeoFence?.id === nextGeoFence.id) return;

    // Preserve route-to-geofence synchronization when the external stream arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  const salesReadScope = useSalesReadScope(lmPcode);
  const salesScopeKey = JSON.stringify(salesReadScope);
  const [salesMonthSelection, setSalesMonthSelection] = useState({});
  const selectedSalesMonth = salesMonthSelection.scope === salesScopeKey ? salesMonthSelection.month : undefined;
  const { data: planningSalesRows = [], categoryMonth: salesCategoryMonth, error: planningSalesError, isLoading: planningSalesLoading } = useGetSalesCategoryViewQuery(
    { lmPcode, month: selectedSalesMonth },
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
  // Geofences rules GF-R001: "Gf W<Ward number> <name>"; the start comes from the Ward.
  const draftWardNumber = wardNumberFromPcode(wardPcode);
  const standardDraftName = composeGeofenceName(draftWardNumber, geofenceNamePart(draftName));
  const canSaveDraft =
    standardDraftName.length > 0 && draftPolygonReady && !createState.isLoading;

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

    if (!geofenceNamePart(draftName).trim()) {
      alert(`Type a name after "Gf W${draftWardNumber}".`);
      return;
    }

    // Geofences rules GF-R002: no two active geofences in a Ward share a name.
    const duplicate = findDuplicateGeofence(standardDraftName, geofences);
    if (duplicate) {
      alert(duplicateGeofenceNameMessage(duplicate));
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

    const duplicate = findDuplicateGeofence(standardDraftName, geofences);
    if (duplicate) {
      alert(duplicateGeofenceNameMessage(duplicate));
      return;
    }

    const successPayload = {
      name: standardDraftName,
      description: draftDescription.trim() || "NAv",
      wardLabel,
      stats: draftPreviewStats,
      isTcContext,
    };

    const payload = {
      name: standardDraftName,
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

        <GeofenceToolbar wardControl={<label style={wardSelectWrapStyle}>
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
          </label>}
          filterControl={<label>Type <select aria-label="Geofence type" value={geofenceKind} onChange={event => setGeofenceKind(event.target.value)}><option value="ALL">Area / Batch</option><option value="AREA">Area</option><option value="BATCH">Batch</option></select></label>}
          {...{ geofencesLoading, geofences, setListModalOpen, handleOpenCreateModal, scopeReady, setMapTypeId, mapTypeId, selectedGeoFence, setSelectedGeoFence, isTcContext, navigate, tcId }}/>

      </header>

      <div style={mapShellStyle}>
        <GeofenceDrawingBar {...{ isCreateMode, draftName, draftPoints, draftPolygonReady, draftPreviewStats, handleUndoPoint, handleRestartDraft, handleOpenCreateConfirm, canSaveDraft, createState, handleCancelDraft }}/>


        <div role="status">
          <label>Sales category month <input type="month" value={salesCategoryMonth || ""} onChange={event => setSalesMonthSelection({ scope: salesScopeKey, month: event.target.value })} /></label>
          {planningSalesError ? " Sales planning unavailable: Sales read failed." : planningSalesLoading ? " Loading Sales planning…" : ` ${planningSalesRows.filter(row => row.categoryAvailable).length} of ${planningSalesRows.length} Sales records have this month's category. Unavailable categories are excluded from targeting.`}
        </div>
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
              geofences={visibleGeofences}
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

      <GeofenceDialogs {...{ listModalOpen, wardLabel, setListModalOpen, visibleGeofences, selectedGeoFence, setSelectedGeoFence, createModalOpen, setCreateModalOpen, draftName, setDraftName, draftDescription, setDraftDescription, handleStartDrawing, confirmCreateModalOpen, setConfirmCreateModalOpen, draftPreviewStats, createState, handleConfirmCreate, createSuccess, setCreateSuccess }} wardNumber={draftWardNumber} existingGeofences={geofences}/>

    </section>
  );
}

/* =====================================================
   STYLES
   ===================================================== */
