import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APIProvider, Map, useMap } from "@vis.gl/react-google-maps";
import { skipToken } from "@reduxjs/toolkit/query";
import { MarkerClusterer } from "@googlemaps/markerclusterer";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import { useWarehouse } from "@/context/WarehouseContext";

import { useGetLmBoundaryByIdQuery } from "../../redux/mapLmsApi";
import { useGetGeoFencesByLmQuery } from "../../redux/mapGeofencesApi";

import { useLazyGetVisibleErfsByWardViewportQuery } from "../../redux/mapErfsApi";

import DesktopGeoCascadingSelector from "../../features/maps/DesktopGeoCascadingSelector";

const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

const FALLBACK_CENTER = {
  lat: -26.461472069502317,
  lng: 28.50667220650696,
};

function getActiveLmPcode(activeWorkbase) {
  return (
    activeWorkbase?.lmPcode ||
    activeWorkbase?.pcode ||
    activeWorkbase?.id ||
    activeWorkbase?.localMunicipalityId ||
    null
  );
}

function getWardPcode(ward) {
  return ward?.id || ward?.pcode || ward?.wardPcode || "";
}

function getWardNumber(ward) {
  return ward?.code || ward?.wardNumber || "NAv";
}

function getGeoFenceWardPcode(geoFence) {
  return (
    geoFence?.wardPcode ||
    geoFence?.parents?.wardPcode ||
    geoFence?.parents?.wardId ||
    ""
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

function fitMapToBbox(map, bbox) {
  if (!map || !bbox || !window.google?.maps) return;

  const bounds = new window.google.maps.LatLngBounds();

  bounds.extend({
    lat: bbox.minLat,
    lng: bbox.minLng,
  });

  bounds.extend({
    lat: bbox.maxLat,
    lng: bbox.maxLng,
  });

  map.fitBounds(bounds, 36);
}

function getMapViewportBounds(map) {
  if (!map || !window.google?.maps) return null;

  const bounds = map.getBounds();

  if (!bounds) return null;

  const northEast = bounds.getNorthEast();
  const southWest = bounds.getSouthWest();

  return {
    north: northEast.lat(),
    east: northEast.lng(),
    south: southWest.lat(),
    west: southWest.lng(),
  };
}

function MapViewportTracker({ onViewportChange }) {
  const map = useMap();

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    function publishViewport() {
      const zoom = map.getZoom() || 0;
      const bounds = getMapViewportBounds(map);

      onViewportChange({
        zoom,
        bounds,
      });
    }

    publishViewport();

    const listener = map.addListener("idle", publishViewport);

    return () => {
      listener.remove();
    };
  }, [map, onViewportChange]);

  return null;
}

function fitMapToGeoFenceBbox(map, bbox) {
  if (!map || !bbox || !window.google?.maps) return;

  const bounds = new window.google.maps.LatLngBounds();

  bounds.extend({
    lat: bbox.minLatitude,
    lng: bbox.minLongitude,
  });

  bounds.extend({
    lat: bbox.maxLatitude,
    lng: bbox.maxLongitude,
  });

  map.fitBounds(bounds, 48);
}

function geoFencePointsToPath(points) {
  if (!Array.isArray(points)) return [];

  return [...points]
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    .map((point) => ({
      lat: point.latitude,
      lng: point.longitude,
    }));
}

function LmBoundaryLayer({ lmBoundary }) {
  const map = useMap();
  const polygonRef = useRef(null);

  const lmPaths = useMemo(() => {
    const parsedGeometry = parseGeometry(lmBoundary?.geometry);
    return geoJsonPolygonToGooglePaths(parsedGeometry);
  }, [lmBoundary?.geometry]);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    if (polygonRef.current) {
      polygonRef.current.setMap(null);
      polygonRef.current = null;
    }

    if (!lmPaths.length) return;

    const polygon = new window.google.maps.Polygon({
      paths: lmPaths,
      strokeColor: "#2563eb",
      strokeOpacity: 1,
      strokeWeight: 3,
      fillColor: "#2563eb",
      fillOpacity: 0.08,
      clickable: false,
      zIndex: 10,
    });

    polygon.setMap(map);
    polygonRef.current = polygon;

    fitMapToBbox(map, lmBoundary?.bbox);

    return () => {
      if (polygonRef.current) {
        polygonRef.current.setMap(null);
        polygonRef.current = null;
      }
    };
  }, [map, lmPaths, lmBoundary?.bbox]);

  return null;
}

function WardBoundariesLayer({
  wardBoundaries,
  selectedWardPcode,
  onSelectWard,
}) {
  const map = useMap();
  const polygonsRef = useRef([]);

  const selectedWard = useMemo(() => {
    return (
      wardBoundaries.find((ward) => getWardPcode(ward) === selectedWardPcode) ||
      null
    );
  }, [wardBoundaries, selectedWardPcode]);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    polygonsRef.current.forEach((polygon) => polygon.setMap(null));
    polygonsRef.current = [];

    if (!Array.isArray(wardBoundaries) || wardBoundaries.length === 0) {
      return;
    }

    const polygons = wardBoundaries
      .map((ward) => {
        const wardPcode = getWardPcode(ward);
        const parsedGeometry = parseGeometry(ward.geometry);
        const paths = geoJsonPolygonToGooglePaths(parsedGeometry);

        if (!paths.length) return null;

        const isSelected = wardPcode === selectedWardPcode;
        const wardNumber = getWardNumber(ward);

        const polygon = new window.google.maps.Polygon({
          paths,
          strokeColor: isSelected ? "#dc2626" : "#0f172a",
          strokeOpacity: isSelected ? 1 : 0.85,
          strokeWeight: isSelected ? 3 : 1.5,
          fillColor: isSelected ? "#dc2626" : "#64748b",
          fillOpacity: isSelected ? 0.12 : 0.04,
          clickable: true,
          zIndex: isSelected ? 30 : 20,
        });

        const infoWindow = new window.google.maps.InfoWindow({
          content: `
            <div style="font-family: Arial, sans-serif; min-width: 140px;">
              <strong>${ward.name || `Ward ${wardNumber}`}</strong>
              <div>Ward ${wardNumber}</div>
              <div>${wardPcode}</div>
            </div>
          `,
        });

        polygon.addListener("click", (event) => {
          onSelectWard?.(wardPcode);

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

    if (selectedWard?.bbox) {
      fitMapToBbox(map, selectedWard.bbox);
    }

    return () => {
      polygonsRef.current.forEach((polygon) => polygon.setMap(null));
      polygonsRef.current = [];
    };
  }, [
    map,
    wardBoundaries,
    selectedWardPcode,
    selectedWard?.bbox,
    onSelectWard,
  ]);

  return null;
}

function GeoFenceLayer({ geoFences, selectedGeoFenceId, onSelectGeoFence }) {
  const map = useMap();
  const polygonsRef = useRef([]);

  const selectedGeoFence = useMemo(() => {
    return (
      geoFences.find((geoFence) => geoFence.id === selectedGeoFenceId) || null
    );
  }, [geoFences, selectedGeoFenceId]);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    polygonsRef.current.forEach((polygon) => polygon.setMap(null));
    polygonsRef.current = [];

    if (!Array.isArray(geoFences) || geoFences.length === 0) {
      return;
    }

    const polygons = geoFences
      .map((geoFence) => {
        const path = geoFencePointsToPath(geoFence.points);

        if (!path.length) return null;

        const isSelected = geoFence.id === selectedGeoFenceId;

        const polygon = new window.google.maps.Polygon({
          paths: path,
          strokeColor: isSelected ? "#f97316" : "#7c3aed",
          strokeOpacity: 1,
          strokeWeight: isSelected ? 3 : 2,
          fillColor: isSelected ? "#f97316" : "#7c3aed",
          fillOpacity: isSelected ? 0.18 : 0.1,
          clickable: true,
          zIndex: isSelected ? 60 : 50,
        });

        const infoWindow = new window.google.maps.InfoWindow({
          content: `
            <div style="font-family: Arial, sans-serif; min-width: 180px;">
              <strong>${geoFence.name}</strong>
              <div>${geoFence.description || "NAv"}</div>
              <hr />
              <div>ERFs: ${geoFence.erfCount}</div>
              <div>Premises: ${geoFence.premiseCount}</div>
              <div>Meters: ${geoFence.meterCount}</div>
              <div style="margin-top: 6px; font-size: 11px; color: #64748b;">
                ${geoFence.id}
              </div>
            </div>
          `,
        });

        polygon.addListener("click", (event) => {
          onSelectGeoFence?.(geoFence.id);

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

    if (selectedGeoFence?.bbox) {
      fitMapToGeoFenceBbox(map, selectedGeoFence.bbox);
    }

    return () => {
      polygonsRef.current.forEach((polygon) => polygon.setMap(null));
      polygonsRef.current = [];
    };
  }, [
    map,
    geoFences,
    selectedGeoFenceId,
    selectedGeoFence?.bbox,
    onSelectGeoFence,
  ]);

  return null;
}

function ErfsViewportLayer({
  erfs,
  currentZoom,
  selectedErfId,
  onSelectErf,
  showErfBoundaries,
  showErfDots,
  showErfLabels,
}) {
  const map = useMap();
  const polygonsRef = useRef([]);
  const markersRef = useRef([]);

  const canShowErfGeometry = currentZoom >= 17;
  const canShowErfLabels = currentZoom >= 18;

  const selectedErf = useMemo(() => {
    return erfs.find((erf) => erf.erfId === selectedErfId) || null;
  }, [erfs, selectedErfId]);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    polygonsRef.current.forEach((polygon) => polygon.setMap(null));
    markersRef.current.forEach((marker) => marker.setMap(null));

    polygonsRef.current = [];
    markersRef.current = [];

    if (!canShowErfGeometry || !Array.isArray(erfs) || erfs.length === 0) {
      return;
    }

    if (selectedErf?.bbox) {
      fitMapToBbox(map, selectedErf.bbox);
    }

    const polygons = [];
    const markers = [];

    erfs.forEach((erf) => {
      const isSelected = erf.erfId === selectedErfId;

      if (showErfBoundaries) {
        const parsedGeometry = parseGeometry(erf.geometry);
        const paths = geoJsonPolygonToGooglePaths(parsedGeometry);

        if (paths.length) {
          const polygon = new window.google.maps.Polygon({
            paths,
            strokeColor: isSelected ? "#dc2626" : "#0284c7",
            strokeOpacity: 0.95,
            strokeWeight: isSelected ? 3 : 1,
            fillColor: isSelected ? "#dc2626" : "#38bdf8",
            fillOpacity: isSelected ? 0.14 : 0.04,
            clickable: true,
            zIndex: isSelected ? 90 : 70,
          });

          const premiseCount = Array.isArray(erf?.premiseIds)
            ? erf.premiseIds.length
            : 0;

          const infoWindow = new window.google.maps.InfoWindow({
            content: `
              <div style="font-family: Arial, sans-serif; min-width: 160px;">
                <strong>ERF ${erf.erfNo || "NAv"}</strong>
                <div>${erf.type || "NAv"}</div>
                <div>${erf.erfId || erf.id || "NAv"}</div>
                <div>Premises: ${premiseCount}</div>
              </div>
            `,
          });

          polygon.addListener("click", (event) => {
            onSelectErf?.(erf.erfId || erf.id);

            infoWindow.setPosition(event.latLng);
            infoWindow.open({
              map,
              shouldFocus: false,
            });
          });

          polygon.setMap(map);
          polygons.push(polygon);
        }
      }

      if (showErfDots && erf?.centroid?.lat && erf?.centroid?.lng) {
        const marker = new window.google.maps.Marker({
          position: {
            lat: erf.centroid.lat,
            lng: erf.centroid.lng,
          },
          map,
          title: `ERF ${erf.erfNo || "NAv"}`,
          label:
            showErfLabels && canShowErfLabels
              ? {
                  text: String(erf.erfNo || ""),
                  fontSize: "11px",
                  fontWeight: "700",
                }
              : undefined,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: isSelected ? 5 : 3,
            fillColor: isSelected ? "#dc2626" : "#0f172a",
            fillOpacity: 0.9,
            strokeColor: "#ffffff",
            strokeWeight: 1,
          },
          zIndex: isSelected ? 100 : 80,
        });

        marker.addListener("click", () => {
          onSelectErf?.(erf.erfId || erf.id);
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
  }, [
    map,
    erfs,
    currentZoom,
    selectedErfId,
    onSelectErf,
    showErfBoundaries,
    showErfDots,
    showErfLabels,
    canShowErfGeometry,
    canShowErfLabels,
    selectedErf?.bbox,
  ]);

  return null;
}

function flyToPoint(map, point, zoom = 19) {
  if (!map || !point) return;

  map.panTo({
    lat: point.lat,
    lng: point.lng,
  });

  map.setZoom(zoom);
}

function getPremiseId(premise) {
  return premise?.premiseId || premise?.id || "";
}

function getPremiseErfNo(premise) {
  return premise?.erfNo || premise?.erf?.erfNo || "NAv";
}

function getPremisePropertyParts(premise) {
  const propertyType = premise?.propertyType || {};

  return {
    type: propertyType?.type || "",
    name: propertyType?.name || "",
    unitNo: propertyType?.unitNo || "",
  };
}

function getMeterId(meter) {
  return (
    meter?.ast?.astData?.astId ||
    meter?.astData?.astId ||
    meter?.meterId ||
    meter?.id ||
    ""
  );
}

function getMeterNo(meter) {
  return (
    meter?.ast?.astData?.astNo ||
    meter?.astData?.astNo ||
    meter?.meterNo ||
    "NAv"
  );
}

function getMeterType(meter) {
  return (
    meter?.accessData?.meterType ||
    meter?.ast?.astData?.astType ||
    meter?.astData?.astType ||
    meter?.meterType ||
    "NAv"
  );
}

function getMeterPremiseId(meter) {
  return (
    meter?.accessData?.premise?.id ||
    meter?.premiseId ||
    meter?.premise?.id ||
    ""
  );
}

function getMeterPoint(meter) {
  const gps =
    meter?.ast?.location?.gps || meter?.location?.gps || meter?.gps || null;

  const lat = gps?.lat ?? gps?.latitude ?? null;
  const lng = gps?.lng ?? gps?.longitude ?? null;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return { lat, lng };
}

function getPremisePoint(premise) {
  const lat = premise?.lat ?? premise?.geometry?.centroid?.lat ?? null;
  const lng = premise?.lng ?? premise?.geometry?.centroid?.lng ?? null;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return { lat, lng };
}

function PremiseMarkersLayer({ premises, selectedPremiseId, onSelectPremise }) {
  const map = useMap();
  const clustererRef = useRef(null);
  const markersRef = useRef([]);

  const selectedPremise = useMemo(() => {
    return (
      premises.find((premise) => getPremiseId(premise) === selectedPremiseId) ||
      null
    );
  }, [premises, selectedPremiseId]);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    if (clustererRef.current) {
      clustererRef.current.clearMarkers();
      clustererRef.current = null;
    }

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];

    if (!Array.isArray(premises) || premises.length === 0) {
      return;
    }

    const hoverInfoWindow = new window.google.maps.InfoWindow({
      disableAutoPan: true,
    });

    const clickInfoWindow = new window.google.maps.InfoWindow();

    const markers = premises
      .filter(
        (premise) =>
          Number.isFinite(premise?.lat) && Number.isFinite(premise?.lng),
      )
      .map((premise) => {
        const premiseId = getPremiseId(premise);
        const premiseAddress = getPremiseAddressLabel(premise);
        const erfNo = getPremiseErfNo(premise);
        const propertyParts = getPremisePropertyParts(premise);
        console.log(`propertyParts`, propertyParts);
        const isSelected = premiseId === selectedPremiseId;

        const marker = new window.google.maps.Marker({
          position: {
            lat: premise.lat,
            lng: premise.lng,
          },
          label: {
            text: isSelected ? "P" : "p",
            fontWeight: "900",
          },
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: isSelected ? 8 : 5,
            fillColor: isSelected ? "#dc2626" : "#2563eb",
            fillOpacity: 0.92,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
          zIndex: isSelected ? 110 : 80,
        });

        marker.addListener("mouseover", () => {
          hoverInfoWindow.setContent(`
            <div style="font-family: Arial, sans-serif; min-width: 170px;">
              <strong>${premiseAddress}</strong>
              <div style="margin-top: 4px;">ERF ${erfNo}</div>
            </div>
          `);

          hoverInfoWindow.open({
            anchor: marker,
            map,
            shouldFocus: false,
          });
        });

        marker.addListener("mouseout", () => {
          hoverInfoWindow.close();
        });

        marker.addListener("click", () => {
          onSelectPremise?.(premiseId);

          hoverInfoWindow.close();

          clickInfoWindow.setContent(`
            <div style="font-family: Arial, sans-serif; min-width: 230px;">
              <strong style="font-size: 14px;">${premiseAddress}</strong>
              <div style="margin-top: 6px;">ERF: ${erfNo}</div>

              <div> 
                <span>
                
                  ${propertyParts.type ? `${propertyParts.type}` : ""}
                  ${propertyParts.name ? `- ${propertyParts.name}` : ""}
                  ${propertyParts.unitNo ? `- ${propertyParts.unitNo}` : ""}
                
                </span>
              </div>

              <hr />
              <div>Electricity meters: ${premise.electricityMeterCount || 0}</div>
              <div>Water meters: ${premise.waterMeterCount || 0}</div>
              <div>Occupancy: ${premise?.occupancy?.status || premise?.occupancyStatus || "NAv"}</div>
            </div>
          `);

          clickInfoWindow.open({
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

    if (selectedPremise) {
      flyToPoint(
        map,
        {
          lat: selectedPremise.lat,
          lng: selectedPremise.lng,
        },
        19,
      );
    }

    return () => {
      hoverInfoWindow.close();
      clickInfoWindow.close();

      if (clustererRef.current) {
        clustererRef.current.clearMarkers();
        clustererRef.current = null;
      }

      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
    };
  }, [map, premises, selectedPremiseId, selectedPremise, onSelectPremise]);

  return null;
}

function MeterMarkersLayer({ meters, selectedMeterId, onSelectMeter }) {
  const map = useMap();
  const clustererRef = useRef(null);
  const markersRef = useRef([]);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    if (clustererRef.current) {
      clustererRef.current.clearMarkers();
      clustererRef.current = null;
    }

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];

    if (!Array.isArray(meters) || meters.length === 0) return;

    const hoverInfoWindow = new window.google.maps.InfoWindow({
      disableAutoPan: true,
    });

    const clickInfoWindow = new window.google.maps.InfoWindow();

    const markers = meters
      .map((meter) => {
        const meterPoint = getMeterPoint(meter);
        if (!meterPoint) return null;

        const meterId = getMeterId(meter);
        const meterNo = getMeterNo(meter);
        const meterType = getMeterType(meter);
        const premiseId = getMeterPremiseId(meter);
        const isSelected = meterId === selectedMeterId;

        const marker = new window.google.maps.Marker({
          position: meterPoint,
          label: {
            text: meterType?.toLowerCase?.().startsWith("water") ? "W" : "E",
            fontWeight: "900",
            color: "#ffffff",
          },
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: isSelected ? 8 : 5,
            fillColor: meterType?.toLowerCase?.().startsWith("water")
              ? "#0284c7"
              : "#ca8a04",
            fillOpacity: 0.95,
            strokeColor: isSelected ? "#dc2626" : "#ffffff",
            strokeWeight: isSelected ? 3 : 2,
          },
          zIndex: isSelected ? 130 : 90,
        });

        marker.addListener("mouseover", () => {
          hoverInfoWindow.setContent(`
            <div style="font-family: Arial, sans-serif; min-width: 170px;">
              <strong>${meterNo}</strong>
              <div style="margin-top: 4px;">${meterType}</div>
            </div>
          `);

          hoverInfoWindow.open({
            anchor: marker,
            map,
            shouldFocus: false,
          });
        });

        marker.addListener("mouseout", () => {
          hoverInfoWindow.close();
        });

        marker.addListener("click", () => {
          onSelectMeter?.(meter);

          hoverInfoWindow.close();

          clickInfoWindow.setContent(`
            <div style="font-family: Arial, sans-serif; min-width: 230px;">
              <strong style="font-size: 14px;">${meterNo}</strong>
              <div style="margin-top: 6px;">Type: ${meterType}</div>
              <div>Premise: ${premiseId || "NAv"}</div>
              <div>Meter ID: ${meterId || "NAv"}</div>
            </div>
          `);

          clickInfoWindow.open({
            anchor: marker,
            map,
            shouldFocus: false,
          });
        });

        return marker;
      })
      .filter(Boolean);

    markersRef.current = markers;

    clustererRef.current = new MarkerClusterer({
      map,
      markers,
    });

    return () => {
      hoverInfoWindow.close();
      clickInfoWindow.close();

      if (clustererRef.current) {
        clustererRef.current.clearMarkers();
        clustererRef.current = null;
      }

      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
    };
  }, [map, meters, selectedMeterId, onSelectMeter]);

  return null;
}

function MeterPremiseConnectorLayer({ meters, premises, selectedMeterId }) {
  // console.log(`meters`, meters);
  // console.log(`premises`, premises);
  // console.log(`selectedMeterId`, selectedMeterId);

  const map = useMap();
  const linesRef = useRef([]);

  const premiseById = useMemo(() => {
    const lookup = new globalThis.Map();
    // const lookup = new Map();

    (premises || []).forEach((premise) => {
      const premiseId = getPremiseId(premise);
      if (premiseId) lookup.set(premiseId, premise);
    });

    return lookup;
  }, [premises]);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    linesRef.current.forEach((line) => line.setMap(null));
    linesRef.current = [];

    if (!Array.isArray(meters) || meters.length === 0) return;

    const lines = meters
      .map((meter) => {
        const meterId = getMeterId(meter);
        const meterPoint = getMeterPoint(meter);
        const premiseId = getMeterPremiseId(meter);
        const premise = premiseById.get(premiseId);
        const premisePoint = getPremisePoint(premise);

        if (!meterPoint || !premisePoint) return null;

        const isSelected = meterId === selectedMeterId;

        const line = new window.google.maps.Polyline({
          path: [premisePoint, meterPoint],
          strokeColor: isSelected ? "#dc2626" : "#475569",
          strokeOpacity: isSelected ? 0.95 : 0.45,
          strokeWeight: isSelected ? 3 : 1,
          zIndex: isSelected ? 120 : 60,
          clickable: false,
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
  }, [map, meters, premiseById, selectedMeterId]);

  return null;
}

function getPremiseAddressLabel(premise) {
  const address = premise?.address || {};

  const parts = [
    address?.strNo,
    address?.strName,
    address?.strType,
    address?.suburbName,
  ].filter(Boolean);

  return parts.length ? parts.join(" ") : "NAv";
}

export default function MapPage() {
  const { activeWorkbase } = useAuth();
  const { geoState, updateGeo } = useGeo();

  const { available, filtered, scope, sync, loading } = useWarehouse();
  console.log(`MapPage --filtered`, filtered);

  const activeLmPcode = scope?.lmPcode || getActiveLmPcode(activeWorkbase);

  // Phase 1 migration:
  // LM boundary remains map-specific.
  // Ward boundaries come from Warehouse.
  const wardBoundaries = useMemo(
    () => available?.wards || [],
    [available?.wards],
  );
  const selectedWardPcode =
    scope?.wardPcode || getWardPcode(geoState?.selectedWard);

  const mapPremises = useMemo(() => filtered?.prems || [], [filtered?.prems]);

  const mapMeters = useMemo(() => filtered?.meters || [], [filtered?.meters]);

  const selectedGeoFenceId = geoState?.selectedGeofence?.id || "";
  const [showGeoFences, setShowGeoFences] = useState(true);

  const [selectedPremiseId, setSelectedPremiseId] = useState("");
  const [showPremises, setShowPremises] = useState(true);

  const [showMeters, setShowMeters] = useState(true);
  const [showMeterLines, setShowMeterLines] = useState(true);
  const [selectedMeterId, setSelectedMeterId] = useState("");

  const [currentZoom, setCurrentZoom] = useState(10);
  const [viewportBounds, setViewportBounds] = useState(null);

  const [selectedErfId, setSelectedErfId] = useState("");

  const [showErfBoundaries, setShowErfBoundaries] = useState(true);
  const [showErfDots, setShowErfDots] = useState(true);
  const [showErfLabels, setShowErfLabels] = useState(true);

  const handleSelectWard = useCallback(
    (wardPcode) => {
      const ward =
        wardBoundaries.find((item) => getWardPcode(item) === wardPcode) || null;

      updateGeo({
        selectedWard: ward || {
          id: wardPcode,
          pcode: wardPcode,
          wardPcode,
          name: `Ward ${wardPcode}`,
        },
        selectedGeofence: null,
        lastSelectionType: "WARD",
      });

      setSelectedErfId("");
      setSelectedPremiseId("");
      setSelectedMeterId("");
    },
    [updateGeo, wardBoundaries],
  );

  const {
    data: lmBoundary,
    isLoading,
    isFetching,
    error,
  } = useGetLmBoundaryByIdQuery(activeLmPcode || skipToken);

  const {
    data: geoFences = [],
    isLoading: isGeoFencesLoading,
    isFetching: isGeoFencesFetching,
    error: geoFencesError,
  } = useGetGeoFencesByLmQuery(activeLmPcode || skipToken);

  const [
    fetchVisibleErfs,
    {
      data: erfViewportResult = { rows: [], wasLimited: false },
      isFetching: isErfsFetching,
      error: erfsError,
    },
  ] = useLazyGetVisibleErfsByWardViewportQuery();

  const handleViewportChange = useCallback(({ zoom, bounds }) => {
    setCurrentZoom(zoom);
    setViewportBounds(bounds);
  }, []);

  const canLoadViewportErfs =
    selectedWardPcode && viewportBounds && currentZoom >= 17;

  useEffect(() => {
    if (!canLoadViewportErfs) return;

    fetchVisibleErfs({
      wardPcode: selectedWardPcode,
      bounds: viewportBounds,
      maxRows: 800,
    });
  }, [
    canLoadViewportErfs,
    fetchVisibleErfs,
    selectedWardPcode,
    viewportBounds,
  ]);

  const visibleErfs = currentZoom >= 17 ? erfViewportResult.rows || [] : [];

  const visibleGeoFences = useMemo(() => {
    if (!selectedWardPcode) return geoFences;

    return geoFences.filter((geoFence) => {
      const geoFenceWardPcode = getGeoFenceWardPcode(geoFence);

      if (!geoFenceWardPcode) return true;

      return geoFenceWardPcode === selectedWardPcode;
    });
  }, [geoFences, selectedWardPcode]);

  const handleSelectGeoFence = useCallback(
    (geoFenceId) => {
      console.log(`geoFenceId`, geoFenceId);
      if (!geoFenceId) {
        updateGeo({
          selectedGeofence: null,
          lastSelectionType: null,
        });

        setSelectedPremiseId("");
        return;
      }

      const geoFence = visibleGeoFences.find(
        (item) => item?.id === geoFenceId,
      ) || {
        id: geoFenceId,
      };
      console.log(`geoFence`, geoFence);

      updateGeo({
        selectedGeofence: geoFence,
        lastSelectionType: "GEOFENCE",
      });

      setSelectedPremiseId("");
      setSelectedMeterId("");
    },
    [updateGeo, visibleGeoFences],
  );

  const handleSelectMeter = useCallback(
    (meter) => {
      const meterId = getMeterId(meter);
      setSelectedMeterId(meterId);

      updateGeo({
        selectedMeter: meter,
        lastSelectionType: "METER",
      });
    },
    [updateGeo],
  );

  const selectedPremise = useMemo(() => {
    return (
      mapPremises.find(
        (premise) => (premise?.premiseId || premise?.id) === selectedPremiseId,
      ) || null
    );
  }, [mapPremises, selectedPremiseId]);

  const mapCenter = lmBoundary?.centroid
    ? {
        lat: lmBoundary.centroid.lat,
        lng: lmBoundary.centroid.lng,
      }
    : FALLBACK_CENTER;

  const lmStatus =
    isLoading || isFetching
      ? "Loading..."
      : error
        ? "Error"
        : lmBoundary
          ? "Loaded"
          : "NAv";

  const wardStatus =
    sync?.wards?.status === "ready"
      ? `${wardBoundaries.length} wards`
      : sync?.wards?.status || "idle";

  const geoFenceStatus =
    isGeoFencesLoading || isGeoFencesFetching
      ? "Loading..."
      : geoFencesError
        ? "Error"
        : `${visibleGeoFences.length} geofences`;

  if (!googleMapsApiKey) {
    return (
      <section className="panel">
        <p className="eyebrow">Map</p>
        <h1>iREPS Reporting Map</h1>

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
    <section className="map-page">
      <div className="map-side-panel">
        <p className="eyebrow">Map</p>

        <DesktopGeoCascadingSelector
          activeLmPcode={activeLmPcode}
          lmBoundary={lmBoundary}
          lmStatus={lmStatus}
          wardBoundaries={wardBoundaries}
          wardStatus={wardStatus}
          selectedWardPcode={selectedWardPcode}
          onSelectWard={handleSelectWard}
          showGeoFences={showGeoFences}
          onToggleGeoFences={setShowGeoFences}
          geoFences={visibleGeoFences}
          geoFenceStatus={geoFenceStatus}
          selectedGeoFenceId={selectedGeoFenceId}
          onSelectGeoFence={handleSelectGeoFence}
        />

        <div className="map-scope-card">
          <span>ERF Viewport Layer</span>

          <strong>
            Zoom {currentZoom.toFixed(1)} ·{" "}
            {currentZoom >= 17 ? "Active" : "Hidden"}
          </strong>

          <p className="muted">
            ERFs still use the viewport layer for this step. Next migration will
            derive map ERFs from the Warehouse ERF list.
          </p>

          <label className="map-checkbox-row">
            <input
              type="checkbox"
              checked={showErfBoundaries}
              onChange={(event) => setShowErfBoundaries(event.target.checked)}
            />
            Show ERF boundaries
          </label>

          <label className="map-checkbox-row">
            <input
              type="checkbox"
              checked={showErfDots}
              onChange={(event) => setShowErfDots(event.target.checked)}
            />
            Show ERF dots
          </label>

          <label className="map-checkbox-row">
            <input
              type="checkbox"
              checked={showErfLabels}
              onChange={(event) => setShowErfLabels(event.target.checked)}
            />
            Show ERF numbers at zoom 18+
          </label>

          <p className="muted">
            {selectedWardPcode
              ? erfsError
                ? "ERF viewport query error. Check Firestore index."
                : isErfsFetching
                  ? "Loading visible ERFs..."
                  : `${visibleErfs.length} visible ERFs${
                      erfViewportResult.wasLimited
                        ? " · zoom in for fewer results"
                        : ""
                    }`
              : "Select a ward first."}
          </p>
        </div>

        <div className="map-scope-card">
          <span>Map Layers</span>

          <label className="map-checkbox-row">
            <input
              type="checkbox"
              checked={showErfBoundaries || showErfDots}
              onChange={(event) => {
                setShowErfBoundaries(event.target.checked);
                setShowErfDots(event.target.checked);
              }}
            />
            Show ERFs
          </label>

          <label className="map-checkbox-row">
            <input
              type="checkbox"
              checked={showPremises}
              onChange={(event) => setShowPremises(event.target.checked)}
              disabled={!selectedWardPcode}
            />
            Show premises
          </label>

          <label className="map-checkbox-row">
            <input
              type="checkbox"
              checked={showMeters}
              onChange={(event) => setShowMeters(event.target.checked)}
              disabled={!selectedWardPcode}
            />
            Show meters
          </label>

          <label className="map-checkbox-row">
            <input
              type="checkbox"
              checked={showMeterLines}
              onChange={(event) => setShowMeterLines(event.target.checked)}
              disabled={!selectedWardPcode || !showMeters}
            />
            Show meter-premise lines
          </label>

          <p className="muted">
            {mapPremises.length} premises · {mapMeters.length} meters
          </p>
        </div>

        <div className="map-scope-card">
          <span>Ward Premises</span>

          <label className="map-checkbox-row">
            <input
              type="checkbox"
              checked={showPremises}
              onChange={(event) => setShowPremises(event.target.checked)}
              disabled={!selectedWardPcode}
            />
            Show premises in selected ward
          </label>

          <strong>
            {!selectedWardPcode
              ? "Select ward"
              : loading
                ? "Loading..."
                : sync?.premises?.status === "error"
                  ? "Error"
                  : `${mapPremises.length} premises`}
          </strong>

          <select
            value={selectedPremiseId}
            onChange={(event) => setSelectedPremiseId(event.target.value)}
            disabled={!selectedWardPcode || !mapPremises.length}
          >
            <option value="">Select premise</option>

            {mapPremises.map((premise) => {
              const premiseId = premise?.premiseId || premise?.id || "";
              const addressLabel = getPremiseAddressLabel(premise);

              return (
                <option key={premiseId} value={premiseId}>
                  {addressLabel} · ERF {premise?.erfNo || "NAv"} Erf No
                </option>
              );
            })}
          </select>

          <p className="muted">
            {selectedPremise
              ? `${selectedPremise.address} · ${selectedPremise.propertyType} · ${selectedPremise.totalMeterCount} meters`
              : selectedWardPcode
                ? "Premises are clustered for the selected ward."
                : "Select a ward to load premises."}
          </p>
        </div>
      </div>

      <div className="map-canvas-panel">
        <APIProvider apiKey={googleMapsApiKey}>
          <Map
            defaultCenter={mapCenter}
            defaultZoom={10}
            mapTypeId="roadmap"
            gestureHandling="greedy"
            disableDefaultUI={false}
            style={{ width: "100%", height: "100%" }}
          >
            <LmBoundaryLayer lmBoundary={lmBoundary} />

            <WardBoundariesLayer
              wardBoundaries={wardBoundaries}
              selectedWardPcode={selectedWardPcode}
              onSelectWard={handleSelectWard}
            />

            {showGeoFences ? (
              <GeoFenceLayer
                geoFences={visibleGeoFences}
                selectedGeoFenceId={selectedGeoFenceId}
                onSelectGeoFence={handleSelectGeoFence}
              />
            ) : null}

            {showPremises && selectedWardPcode ? (
              <PremiseMarkersLayer
                premises={mapPremises}
                selectedPremiseId={selectedPremiseId}
                onSelectPremise={setSelectedPremiseId}
              />
            ) : null}

            {showMeterLines && showMeters && selectedWardPcode ? (
              <MeterPremiseConnectorLayer
                meters={mapMeters}
                premises={mapPremises}
                selectedMeterId={selectedMeterId}
              />
            ) : null}

            {showMeters && selectedWardPcode ? (
              <MeterMarkersLayer
                meters={mapMeters}
                selectedMeterId={selectedMeterId}
                onSelectMeter={handleSelectMeter}
              />
            ) : null}

            <MapViewportTracker onViewportChange={handleViewportChange} />

            <ErfsViewportLayer
              erfs={visibleErfs}
              currentZoom={currentZoom}
              selectedErfId={selectedErfId}
              onSelectErf={setSelectedErfId}
              showErfBoundaries={showErfBoundaries}
              showErfDots={showErfDots}
              showErfLabels={showErfLabels}
            />
          </Map>
        </APIProvider>
      </div>
    </section>
  );
}
