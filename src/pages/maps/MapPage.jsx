import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APIProvider, Map, useMap } from "@vis.gl/react-google-maps";
import { skipToken } from "@reduxjs/toolkit/query";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { useGetPremisesByWardQuery } from "../../redux/mapPremisesApi";

import { useAuth } from "../../auth/useAuth";
import { useGetLmBoundaryByIdQuery } from "../../redux/mapLmsApi";
import { useGetWardBoundariesByLmQuery } from "../../redux/mapWardsApi";
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
      wardBoundaries.find((ward) => ward.wardPcode === selectedWardPcode) ||
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
        const parsedGeometry = parseGeometry(ward.geometry);
        const paths = geoJsonPolygonToGooglePaths(parsedGeometry);

        if (!paths.length) return null;

        const isSelected = ward.wardPcode === selectedWardPcode;

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
              <strong>${ward.name || `Ward ${ward.wardNumber}`}</strong>
              <div>Ward ${ward.wardNumber}</div>
              <div>${ward.wardPcode}</div>
            </div>
          `,
        });

        polygon.addListener("click", (event) => {
          onSelectWard?.(ward.wardPcode);

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

          const infoWindow = new window.google.maps.InfoWindow({
            content: `
              <div style="font-family: Arial, sans-serif; min-width: 160px;">
                <strong>ERF ${erf.erfNo}</strong>
                <div>${erf.type}</div>
                <div>${erf.erfId}</div>
                <div>Premises: ${erf.premiseIds.length}</div>
              </div>
            `,
          });

          polygon.addListener("click", (event) => {
            onSelectErf?.(erf.erfId);

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
          title: `ERF ${erf.erfNo}`,
          label:
            showErfLabels && canShowErfLabels
              ? {
                  text: String(erf.erfNo),
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
          onSelectErf?.(erf.erfId);
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

function PremiseMarkersLayer({ premises, selectedPremiseId, onSelectPremise }) {
  const map = useMap();
  const clustererRef = useRef(null);
  const markersRef = useRef([]);

  const selectedPremise = useMemo(() => {
    return (
      premises.find((premise) => premise.premiseId === selectedPremiseId) ||
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

    const infoWindow = new window.google.maps.InfoWindow();

    const markers = premises.map((premise) => {
      const isSelected = premise.premiseId === selectedPremiseId;

      const marker = new window.google.maps.Marker({
        position: {
          lat: premise.lat,
          lng: premise.lng,
        },
        title: premise.address,
        label: {
          text: isSelected ? "P" : "p",
          fontWeight: "900",
        },
        zIndex: isSelected ? 90 : 70,
      });

      marker.addListener("click", () => {
        onSelectPremise?.(premise.premiseId);

        infoWindow.setContent(`
          <div style="font-family: Arial, sans-serif; min-width: 210px;">
            <strong>${premise.address}</strong>
            <div>Premise: ${premise.premiseId}</div>
            <div>ERF: ${premise.erfNo}</div>
            <div>Type: ${premise.propertyType}</div>
            ${
              premise.propertyName
                ? `<div>Name: ${premise.propertyName}</div>`
                : ""
            }
            ${premise.unitNo ? `<div>Unit: ${premise.unitNo}</div>` : ""}
            <hr />
            <div>Electricity meters: ${premise.electricityMeterCount}</div>
            <div>Water meters: ${premise.waterMeterCount}</div>
            <div>Total meters: ${premise.totalMeterCount}</div>
            <div>Occupancy: ${premise.occupancyStatus}</div>
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

export default function MapPage() {
  const { activeWorkbase } = useAuth();

  const [selectedWardPcode, setSelectedWardPcode] = useState("");

  const [selectedGeoFenceId, setSelectedGeoFenceId] = useState("");
  const [showGeoFences, setShowGeoFences] = useState(true);

  const activeLmPcode = getActiveLmPcode(activeWorkbase);

  const [selectedPremiseId, setSelectedPremiseId] = useState("");
  const [showPremises, setShowPremises] = useState(true);

  // Viewport state is managed here in the page component, and passed down to the ERF layer, which triggers the ERF query when the viewport changes. This is because the ERF data is the most viewport-sensitive, and we want to avoid unnecessary re-renders and re-queries of the LM boundary, ward boundaries, and geofences when the viewport changes.

  const [currentZoom, setCurrentZoom] = useState(10);
  const [viewportBounds, setViewportBounds] = useState(null);

  const [selectedErfId, setSelectedErfId] = useState("");

  const [showErfBoundaries, setShowErfBoundaries] = useState(true);
  const [showErfDots, setShowErfDots] = useState(true);
  const [showErfLabels, setShowErfLabels] = useState(true);

  // Viewport end

  const handleSelectWard = useCallback((wardPcode) => {
    setSelectedWardPcode(wardPcode);
    setSelectedGeoFenceId("");
    setSelectedErfId("");
    setSelectedPremiseId("");
  }, []);

  const {
    data: lmBoundary,
    isLoading,
    isFetching,
    error,
  } = useGetLmBoundaryByIdQuery(activeLmPcode || skipToken);

  const {
    data: wardBoundaries = [],
    isLoading: isWardsLoading,
    isFetching: isWardsFetching,
    error: wardsError,
  } = useGetWardBoundariesByLmQuery(activeLmPcode || skipToken);

  const {
    data: geoFences = [],
    isLoading: isGeoFencesLoading,
    isFetching: isGeoFencesFetching,
    error: geoFencesError,
  } = useGetGeoFencesByLmQuery(activeLmPcode || skipToken);

  const {
    data: wardPremises = [],
    isLoading: isPremisesLoading,
    isFetching: isPremisesFetching,
    error: premisesError,
  } = useGetPremisesByWardQuery(selectedWardPcode || skipToken);

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

  // const selectedErf =
  //   visibleErfs.find((erf) => erf.erfId === selectedErfId) || null;

  const visibleGeoFences = useMemo(() => {
    if (!selectedWardPcode) return geoFences;

    return geoFences.filter(
      (geoFence) => geoFence.wardPcode === selectedWardPcode,
    );
  }, [geoFences, selectedWardPcode]);

  const selectedPremise = useMemo(() => {
    return (
      wardPremises.find((premise) => premise.premiseId === selectedPremiseId) ||
      null
    );
  }, [wardPremises, selectedPremiseId]);

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
    isWardsLoading || isWardsFetching
      ? "Loading..."
      : wardsError
        ? "Error"
        : `${wardBoundaries.length} wards`;

  const geoFenceStatus =
    isGeoFencesLoading || isGeoFencesFetching
      ? "Loading..."
      : geoFencesError
        ? "Error"
        : `${visibleGeoFences.length} geofences`;

  // helpers

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

        <h1>iREPS Reporting Map</h1>

        <p className="muted">
          Reporting-only spatial command centre. No field operations, no
          creating premises, no creating meters, and no editing map data.
        </p>

        <div className="notice-panel">
          <strong>Current map sprint</strong>
          <p className="muted">
            LM boundary first. Then we add ward boundaries, then selected-ward
            ERFs, then premises, then meters.
          </p>
        </div>

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
          onSelectGeoFence={setSelectedGeoFenceId}
        />

        <div className="map-scope-card">
          <span>ERF Viewport Layer</span>

          <strong>
            Zoom {currentZoom.toFixed(1)} ·{" "}
            {currentZoom >= 17 ? "Active" : "Hidden"}
          </strong>

          <p className="muted">
            ERFs load only inside the current viewport when a ward is selected
            and zoom is 17 or higher.
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
              : isPremisesLoading || isPremisesFetching
                ? "Loading..."
                : premisesError
                  ? "Error"
                  : `${wardPremises.length} premises`}
          </strong>

          <select
            value={selectedPremiseId}
            onChange={(event) => setSelectedPremiseId(event.target.value)}
            disabled={!selectedWardPcode || !wardPremises.length}
          >
            <option value="">Select premise</option>

            {wardPremises.map((premise) => (
              <option key={premise.premiseId} value={premise.premiseId}>
                {premise.address} · ERF {premise.erfNo}
              </option>
            ))}
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
                onSelectGeoFence={setSelectedGeoFenceId}
              />
            ) : null}

            {showPremises && selectedWardPcode ? (
              <PremiseMarkersLayer
                premises={wardPremises}
                selectedPremiseId={selectedPremiseId}
                onSelectPremise={setSelectedPremiseId}
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
