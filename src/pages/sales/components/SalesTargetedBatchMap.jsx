import { useEffect, useMemo, useRef, useState } from "react";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { APIProvider, Map, useMap } from "@vis.gl/react-google-maps";

const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

const DEFAULT_CENTER = {
  lat: -30.5595,
  lng: 22.9375,
};
const DEFAULT_ZOOM = 5;
const ERF_LABEL_MIN_ZOOM = 17;
const NEUTRAL_METER_STATE_COLOR = "#475569";
const EMPTY_METER_STATE_COLORS = Object.freeze({});

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeUpper(value) {
  return cleanText(value).toUpperCase();
}

function escapeHtml(value) {
  return cleanText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isValidPoint(value) {
  return (
    Number.isFinite(value?.lat) &&
    Number.isFinite(value?.lng) &&
    value.lat >= -90 &&
    value.lat <= 90 &&
    value.lng >= -180 &&
    value.lng <= 180
  );
}

function visitGeometryCoordinates(value, visit) {
  if (!Array.isArray(value)) return;

  if (
    value.length >= 2 &&
    Number.isFinite(Number(value[0])) &&
    Number.isFinite(Number(value[1]))
  ) {
    const lng = Number(value[0]);
    const lat = Number(value[1]);

    if (
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    ) {
      visit({ lat, lng });
    }

    return;
  }

  value.forEach((child) => visitGeometryCoordinates(child, visit));
}

function getGeometryCenter(geometry) {
  if (!geometry?.coordinates) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let pointCount = 0;

  visitGeometryCoordinates(geometry.coordinates, ({ lat, lng }) => {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    pointCount += 1;
  });

  if (pointCount === 0) return null;

  return {
    lat: (minLat + maxLat) / 2,
    lng: (minLng + maxLng) / 2,
  };
}

function getErfLabelPoint(erf) {
  return isValidPoint(erf?.centroid)
    ? erf.centroid
    : getGeometryCenter(erf?.geometry);
}

function getMeterGlyphType(type) {
  const normalizedType = normalizeUpper(type);

  if (normalizedType.includes("WATER")) return "water";
  if (normalizedType.includes("ELECTRIC")) return "electricity";

  return "generic";
}

function getMeterStateColor(state, meterStateColors) {
  const normalizedState = normalizeUpper(state);
  const configuredColor = cleanText(meterStateColors?.[normalizedState]);

  return configuredColor || NEUTRAL_METER_STATE_COLOR;
}

function buildMeterMarkerSvg({
  type,
  state,
  focused = false,
  subdued = false,
  meterStateColors,
}) {
  const glyphType = getMeterGlyphType(type);
  const stateColor = getMeterStateColor(state, meterStateColors);

  const glyph =
    glyphType === "water"
      ? `<path d="M17 9c-3.8 5-6.3 8.4-6.3 12.1A6.3 6.3 0 0 0 17 27.4a6.3 6.3 0 0 0 6.3-6.3C23.3 17.4 20.8 14 17 9Z" fill="${stateColor}"/>`
      : glyphType === "electricity"
        ? `<path d="M18.6 8.5 11.8 19h5.1l-1.6 9.5 7.4-12h-5.2l1.1-8Z" fill="${stateColor}"/>`
        : `<circle cx="17" cy="18.5" r="4.5" fill="${stateColor}"/>`;

  const halo = focused
    ? '<circle cx="17" cy="18" r="16" fill="none" stroke="#2563eb" stroke-width="4" opacity="0.34"/>'
    : "";

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42" opacity="${subdued ? 0.38 : 1}">
      ${halo}
      <path d="M17 40 12.7 33h8.6L17 40Z" fill="${stateColor}"/>
      <rect x="6.5" y="3.5" width="21" height="30" rx="5.5" fill="#ffffff" stroke="${stateColor}" stroke-width="3"/>
      <rect x="10" y="7" width="14" height="22" rx="3.5" fill="#f8fafc"/>
      ${glyph}
    </svg>
  `;

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(34, 42),
    anchor: new window.google.maps.Point(17, 40),
  };
}

function fitMapToBatch(map, { erfs, premises, meters }) {
  if (!map || !window.google?.maps) return false;

  const bounds = new window.google.maps.LatLngBounds();
  let hasSpatialFeature = false;

  erfs.forEach((erf) => {
    visitGeometryCoordinates(erf?.geometry?.coordinates, (point) => {
      bounds.extend(point);
      hasSpatialFeature = true;
    });

    if (!erf?.geometry && isValidPoint(erf?.centroid)) {
      bounds.extend(erf.centroid);
      hasSpatialFeature = true;
    }
  });

  premises.forEach((premise) => {
    if (!isValidPoint(premise?.point)) return;
    bounds.extend(premise.point);
    hasSpatialFeature = true;
  });

  meters.forEach((meter) => {
    if (!isValidPoint(meter?.point)) return;
    bounds.extend(meter.point);
    hasSpatialFeature = true;
  });

  if (!hasSpatialFeature) return false;

  map.fitBounds(bounds, 56);

  const idleListener = window.google.maps.event.addListenerOnce(
    map,
    "idle",
    () => {
      const currentZoom = Number(map.getZoom() || 0);
      if (currentZoom > 20) map.setZoom(20);
    },
  );

  window.setTimeout(() => {
    window.google.maps.event.removeListener(idleListener);
  }, 1500);

  return true;
}

function BatchViewportLayer({ erfs, premises, meters, fitRequest }) {
  const map = useMap();
  const previousSignatureRef = useRef("");
  const previousFitRequestRef = useRef(0);

  const signature = useMemo(
    () =>
      [
        erfs.map((erf) => erf?.id).join("|"),
        premises.map((premise) => premise?.id).join("|"),
        meters.map((meter) => meter?.id).join("|"),
      ].join("::"),
    [erfs, premises, meters],
  );

  useEffect(() => {
    if (!map) return;

    const isFirstPopulation =
      Boolean(signature) && previousSignatureRef.current !== signature;
    const isManualFit = fitRequest > previousFitRequestRef.current;

    if (isFirstPopulation || isManualFit) {
      fitMapToBatch(map, { erfs, premises, meters });
    }

    previousSignatureRef.current = signature;
    previousFitRequestRef.current = fitRequest;
  }, [erfs, fitRequest, map, meters, premises, signature]);

  return null;
}

function ErfPolygonLayer({ erfs, focusedErfId = "" }) {
  const map = useMap();
  const dataLayerRef = useRef(null);

  useEffect(() => {
    if (!map || !window.google?.maps) return undefined;

    const dataLayer = new window.google.maps.Data({ map });
    dataLayerRef.current = dataLayer;

    const features = erfs
      .filter((erf) => erf?.geometry)
      .map((erf) => ({
        type: "Feature",
        id: erf.id,
        properties: {
          id: erf.id,
          number: erf.number || erf.id,
        },
        geometry: erf.geometry,
      }));

    if (features.length > 0) {
      dataLayer.addGeoJson({
        type: "FeatureCollection",
        features,
      });
    }

    dataLayer.setStyle((feature) => {
      const hasFocus = Boolean(cleanText(focusedErfId));
      const isFocused =
        hasFocus &&
        cleanText(feature.getProperty("id")) === cleanText(focusedErfId);

      return {
        clickable: true,
        fillColor: isFocused ? "#f59e0b" : "#60a5fa",
        fillOpacity: isFocused ? 0.3 : hasFocus ? 0.045 : 0.14,
        strokeColor: isFocused ? "#d97706" : "#2563eb",
        strokeOpacity: isFocused ? 1 : hasFocus ? 0.28 : 0.82,
        strokeWeight: isFocused ? 3.5 : hasFocus ? 1 : 1.5,
        zIndex: isFocused ? 30 : 10,
      };
    });

    const infoWindow = new window.google.maps.InfoWindow();
    const clickListener = dataLayer.addListener("click", (event) => {
      const number = event.feature.getProperty("number") || "NAv";
      const id = event.feature.getProperty("id") || "NAv";

      infoWindow.setContent(`
        <div style="font-family: Arial, sans-serif; min-width: 180px;">
          <strong>ERF ${escapeHtml(number)}</strong>
          <div style="margin-top: 5px;">ERF ID: ${escapeHtml(id)}</div>
        </div>
      `);
      infoWindow.setPosition(event.latLng);
      infoWindow.open({ map, shouldFocus: false });
    });

    return () => {
      infoWindow.close();
      window.google.maps.event.removeListener(clickListener);
      dataLayer.setMap(null);
      dataLayerRef.current = null;
    };
  }, [erfs, focusedErfId, map]);

  return null;
}

function ErfLabelsLayer({ erfs, focusedErfId = "" }) {
  const map = useMap();
  const overlaysRef = useRef([]);

  useEffect(() => {
    if (!map || !window.google?.maps) return undefined;

    class ErfLabelOverlay extends window.google.maps.OverlayView {
      constructor({ point, label, focused = false, subdued = false }) {
        super();
        this.point = point;
        this.label = label;
        this.focused = focused;
        this.subdued = subdued;
        this.div = null;
      }

      onAdd() {
        const div = document.createElement("div");
        div.textContent = this.label;
        div.style.position = "absolute";
        div.style.transform = "translate(-50%, -50%)";
        div.style.padding = "2px 5px";
        div.style.borderRadius = "5px";
        div.style.background = this.focused
          ? "rgba(255, 247, 237, 0.96)"
          : "rgba(255, 255, 255, 0.88)";
        div.style.border = this.focused
          ? "2px solid rgba(217, 119, 6, 0.92)"
          : "1px solid rgba(37, 99, 235, 0.55)";
        div.style.color = this.focused ? "#92400e" : "#1e3a8a";
        div.style.opacity = this.subdued ? "0.34" : "1";
        div.style.fontFamily = "Arial, sans-serif";
        div.style.fontSize = "10px";
        div.style.fontWeight = "800";
        div.style.lineHeight = "1";
        div.style.whiteSpace = "nowrap";
        div.style.pointerEvents = "none";
        div.style.boxShadow = "0 1px 2px rgba(15, 23, 42, 0.12)";
        this.div = div;
        this.getPanes()?.overlayLayer?.appendChild(div);
      }

      draw() {
        if (!this.div) return;

        const zoom = Number(map.getZoom() || 0);
        this.div.style.display =
          zoom >= ERF_LABEL_MIN_ZOOM ? "block" : "none";

        if (zoom < ERF_LABEL_MIN_ZOOM) return;

        const projection = this.getProjection();
        const pixel = projection?.fromLatLngToDivPixel(
          new window.google.maps.LatLng(this.point),
        );

        if (!pixel) return;

        this.div.style.left = `${pixel.x}px`;
        this.div.style.top = `${pixel.y}px`;
      }

      onRemove() {
        this.div?.remove();
        this.div = null;
      }
    }

    const overlays = erfs
      .map((erf) => {
        const point = getErfLabelPoint(erf);
        if (!isValidPoint(point)) return null;

        const hasFocus = Boolean(cleanText(focusedErfId));
        const isFocused =
          hasFocus && cleanText(erf?.id) === cleanText(focusedErfId);
        const overlay = new ErfLabelOverlay({
          point,
          label: cleanText(erf?.number || erf?.id || "ERF"),
          focused: isFocused,
          subdued: hasFocus && !isFocused,
        });
        overlay.setMap(map);
        return overlay;
      })
      .filter(Boolean);

    overlaysRef.current = overlays;

    const zoomListener = map.addListener("zoom_changed", () => {
      overlays.forEach((overlay) => overlay.draw());
    });

    return () => {
      window.google.maps.event.removeListener(zoomListener);
      overlays.forEach((overlay) => overlay.setMap(null));
      overlaysRef.current = [];
    };
  }, [erfs, focusedErfId, map]);

  return null;
}

function PremiseMarkersLayer({ premises, focusedPremiseId = "" }) {
  const map = useMap();
  const clustererRef = useRef(null);
  const markersRef = useRef([]);

  useEffect(() => {
    if (!map || !window.google?.maps) return undefined;

    const infoWindow = new window.google.maps.InfoWindow();
    const hasFocus = Boolean(cleanText(focusedPremiseId));
    const clusteredMarkers = [];
    const markers = premises
      .filter((premise) => isValidPoint(premise?.point))
      .map((premise) => {
        const isFocused =
          hasFocus &&
          cleanText(focusedPremiseId) === cleanText(premise?.id);
        const marker = new window.google.maps.Marker({
          position: premise.point,
          map,
          title: premise.address || premise.id,
          label: {
            text: "P",
            color: "#ffffff",
            fontSize: "10px",
            fontWeight: "900",
          },
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: isFocused ? 8 : 6,
            fillColor: isFocused ? "#7c3aed" : "#2563eb",
            fillOpacity: 0.96,
            strokeColor: isFocused ? "#ddd6fe" : "#ffffff",
            strokeWeight: isFocused ? 4 : 2,
          },
          opacity: hasFocus && !isFocused ? 0.34 : 1,
          zIndex: isFocused ? 240 : 120,
        });

        marker.addListener("click", () => {
          infoWindow.setContent(`
            <div style="font-family: Arial, sans-serif; min-width: 220px;">
              <strong>${escapeHtml(premise.address || "Premise")}</strong>
              <div style="margin-top: 6px;">Premise: ${escapeHtml(premise.id)}</div>
              <div>ERF: ${escapeHtml(premise.erfNumber || premise.erfId || "NAv")}</div>
              <div>Occupancy: ${escapeHtml(premise.occupancyState || "NAv")}</div>
            </div>
          `);
          infoWindow.open({ anchor: marker, map, shouldFocus: false });
        });

        if (!isFocused) clusteredMarkers.push(marker);
        return marker;
      });

    markersRef.current = markers;
    clustererRef.current = new MarkerClusterer({
      map,
      markers: clusteredMarkers,
    });

    return () => {
      infoWindow.close();
      clustererRef.current?.clearMarkers();
      clustererRef.current = null;
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
    };
  }, [focusedPremiseId, map, premises]);

  return null;
}

function MeterMarkersLayer({
  meters,
  focusedMeterId = "",
  meterStateColors,
}) {
  const map = useMap();
  const clustererRef = useRef(null);
  const markersRef = useRef([]);

  useEffect(() => {
    if (!map || !window.google?.maps) return undefined;

    const infoWindow = new window.google.maps.InfoWindow();
    const hasFocus = Boolean(cleanText(focusedMeterId));
    const clusteredMarkers = [];
    const markers = meters
      .filter((meter) => isValidPoint(meter?.point))
      .map((meter) => {
        const isFocused =
          hasFocus &&
          (cleanText(focusedMeterId) === cleanText(meter?.id) ||
            cleanText(focusedMeterId) === cleanText(meter?.entityId));
        const marker = new window.google.maps.Marker({
          position: meter.point,
          map,
          title: meter.number || meter.id,
          icon: buildMeterMarkerSvg({
            type: meter.type,
            state: meter.state,
            focused: isFocused,
            subdued: hasFocus && !isFocused,
            meterStateColors,
          }),
          opacity: hasFocus && !isFocused ? 0.38 : 1,
          zIndex: isFocused ? 300 : 160,
        });

        marker.addListener("click", () => {
          infoWindow.setContent(`
            <div style="font-family: Arial, sans-serif; min-width: 220px;">
              <strong>Field Meter ${escapeHtml(meter.number || "NAv")}</strong>
              <div style="margin-top: 6px;">Type: ${escapeHtml(meter.type || "NAv")}</div>
              <div>State: ${escapeHtml(meter.state || "NAv")}</div>
              <div>Premise: ${escapeHtml(meter.linkedPremiseId || "NAv")}</div>
              <div>ERF: ${escapeHtml(meter.linkedErfId || "NAv")}</div>
            </div>
          `);
          infoWindow.open({ anchor: marker, map, shouldFocus: false });
        });

        if (!isFocused) clusteredMarkers.push(marker);
        return marker;
      });

    markersRef.current = markers;
    clustererRef.current = new MarkerClusterer({
      map,
      markers: clusteredMarkers,
    });

    return () => {
      infoWindow.close();
      clustererRef.current?.clearMarkers();
      clustererRef.current = null;
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
    };
  }, [focusedMeterId, map, meterStateColors, meters]);

  return null;
}


function FocusConnectionLineLayer({ focusedMeter, focusedPremise }) {
  const map = useMap();

  useEffect(() => {
    if (
      !map ||
      !window.google?.maps ||
      !isValidPoint(focusedMeter?.point) ||
      !isValidPoint(focusedPremise?.point)
    ) {
      return undefined;
    }

    const line = new window.google.maps.Polyline({
      map,
      path: [focusedPremise.point, focusedMeter.point],
      geodesic: true,
      clickable: false,
      strokeColor: "#7c3aed",
      strokeOpacity: 0.96,
      strokeWeight: 4,
      zIndex: 220,
      icons: [
        {
          icon: {
            path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
            fillColor: "#7c3aed",
            fillOpacity: 1,
            scale: 3,
            strokeColor: "#7c3aed",
            strokeWeight: 1,
          },
          offset: "100%",
        },
      ],
    });

    return () => {
      line.setMap(null);
    };
  }, [focusedMeter, focusedPremise, map]);

  return null;
}

export default function SalesTargetedBatchMap({
  erfs = [],
  premises = [],
  meters = [],
  focusedMeterId = "",
  height = 620,
  meterStateColors = EMPTY_METER_STATE_COLORS,
}) {
  const [fitRequest, setFitRequest] = useState(0);

  const safeErfs = useMemo(
    () => (Array.isArray(erfs) ? erfs : []),
    [erfs],
  );
  const safePremises = useMemo(
    () => (Array.isArray(premises) ? premises : []),
    [premises],
  );
  const safeMeters = useMemo(
    () => (Array.isArray(meters) ? meters : []),
    [meters],
  );

  const focusedMeter = useMemo(
    () =>
      safeMeters.find(
        (meter) =>
          cleanText(meter?.id) === cleanText(focusedMeterId) ||
          cleanText(meter?.entityId) === cleanText(focusedMeterId),
      ) || null,
    [focusedMeterId, safeMeters],
  );

  const focusedPremiseId = cleanText(focusedMeter?.linkedPremiseId);
  const focusedPremise = useMemo(
    () =>
      safePremises.find(
        (premise) => cleanText(premise?.id) === focusedPremiseId,
      ) || null,
    [focusedPremiseId, safePremises],
  );
  const focusedErfId = cleanText(focusedMeter?.linkedErfId);
  const spatialFeatureCount =
    safeErfs.filter((erf) => erf?.geometry || isValidPoint(erf?.centroid))
      .length +
    safePremises.filter((premise) => isValidPoint(premise?.point)).length +
    safeMeters.filter((meter) => isValidPoint(meter?.point)).length;

  return (
    <section style={styles.panel}>
      <div style={styles.toolbar}>
        <div style={styles.legend}>
          <span style={styles.legendItem}>
            <span style={styles.erfLegend} /> ERF
          </span>
          <span style={styles.legendItem}>
            <span style={styles.premiseLegend}>P</span> Premise
          </span>
          <span style={styles.legendItem}>
            <span style={styles.meterLegend}>⚡</span> Electricity meter
          </span>
          <span style={styles.legendItem}>
            <span style={styles.waterLegend}>●</span> Water meter
          </span>
          <span style={styles.legendNote}>
            Meter state colours remain neutral until the canonical state palette
            is approved.
          </span>
        </div>

        <button
          type="button"
          style={{
            ...styles.fitButton,
            ...(spatialFeatureCount === 0 ? styles.disabledButton : null),
          }}
          disabled={spatialFeatureCount === 0}
          onClick={() => setFitRequest((current) => current + 1)}
        >
          Fit Batch
        </button>
      </div>

      {!googleMapsApiKey ? (
        <div style={styles.emptyState}>
          <strong>Google Maps key missing.</strong>
          <span>
            Add VITE_GOOGLE_MAPS_API_KEY to the web environment and restart
            Vite.
          </span>
        </div>
      ) : spatialFeatureCount === 0 ? (
        <div style={styles.emptyState}>
          <strong>No usable spatial features are available for this batch.</strong>
          <span>
            The spatial diagnostics above show whether ERF geometry, premise
            GPS or Field Meter GPS is missing.
          </span>
        </div>
      ) : (
        <div style={{ ...styles.mapWrap, height }}>
          <APIProvider apiKey={googleMapsApiKey}>
            <Map
              defaultCenter={DEFAULT_CENTER}
              defaultZoom={DEFAULT_ZOOM}
              mapTypeId="roadmap"
              gestureHandling="greedy"
              disableDefaultUI={false}
              style={{ width: "100%", height: "100%" }}
            >
              <BatchViewportLayer
                erfs={safeErfs}
                premises={safePremises}
                meters={safeMeters}
                fitRequest={fitRequest}
              />
              <ErfPolygonLayer erfs={safeErfs} focusedErfId={focusedErfId} />
              <ErfLabelsLayer
                erfs={safeErfs}
                focusedErfId={focusedErfId}
              />
              <FocusConnectionLineLayer
                focusedMeter={focusedMeter}
                focusedPremise={focusedPremise}
              />
              <PremiseMarkersLayer
                premises={safePremises}
                focusedPremiseId={focusedPremiseId}
              />
              <MeterMarkersLayer
                meters={safeMeters}
                focusedMeterId={focusedMeterId}
                meterStateColors={meterStateColors}
              />
            </Map>
          </APIProvider>
        </div>
      )}
    </section>
  );
}

const styles = {
  panel: {
    border: "1px solid #cbd5e1",
    borderRadius: 16,
    background: "#ffffff",
    overflow: "hidden",
    boxShadow: "0 12px 28px rgba(15, 23, 42, 0.08)",
  },

  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    flexWrap: "wrap",
    padding: "12px 14px",
    borderBottom: "1px solid #e2e8f0",
    background: "#f8fafc",
  },

  legend: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    color: "#475569",
    fontSize: 11,
    fontWeight: 800,
  },

  legendItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    whiteSpace: "nowrap",
  },

  legendNote: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: 700,
  },

  erfLegend: {
    width: 20,
    height: 12,
    border: "2px solid #2563eb",
    background: "rgba(96, 165, 250, 0.18)",
  },

  premiseLegend: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 18,
    height: 18,
    borderRadius: "50%",
    background: "#2563eb",
    color: "#ffffff",
    fontSize: 9,
    fontWeight: 900,
  },

  meterLegend: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 18,
    height: 22,
    border: "2px solid #475569",
    borderRadius: 5,
    background: "#ffffff",
    color: "#475569",
    fontSize: 11,
  },

  waterLegend: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 18,
    height: 22,
    border: "2px solid #475569",
    borderRadius: 5,
    background: "#ffffff",
    color: "#475569",
    fontSize: 10,
  },

  fitButton: {
    minHeight: 36,
    border: 0,
    borderRadius: 10,
    background: "#0f172a",
    color: "#ffffff",
    padding: "8px 13px",
    fontSize: 10,
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  disabledButton: {
    opacity: 0.45,
    cursor: "not-allowed",
  },

  mapWrap: {
    width: "100%",
    minHeight: 420,
    background: "#e2e8f0",
  },

  emptyState: {
    minHeight: 360,
    display: "grid",
    placeContent: "center",
    gap: 7,
    padding: 28,
    color: "#475569",
    textAlign: "center",
    background: "#f8fafc",
  },
};
