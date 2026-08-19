/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { APIProvider, Map, useMap } from "@vis.gl/react-google-maps";
import { skipToken } from "@reduxjs/toolkit/query";

import { useGetErfBoundaryByIdQuery } from "../../../redux/mapErfsApi";
import { useGetWardBoundaryByPcodeQuery } from "../../../redux/mapWardsApi";

const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

const FALLBACK_CENTER = {
  lat: -26.461472069502317,
  lng: 28.50667220650696,
};

function isMeaningful(value) {
  if (value === 0 || value === false) return true;
  if (value === null || value === undefined) return false;

  const text = String(value).trim();
  if (!text) return false;

  return !["NAV", "N/AV", "N/A", "NA", "NULL", "UNDEFINED", "-"].includes(
    text.toUpperCase(),
  );
}

function parseGeometry(geometry) {
  if (!geometry) return null;

  if (typeof geometry === "string") {
    try {
      return JSON.parse(geometry);
    } catch (error) {
      console.error("BoundaryMapModal could not parse geometry:", error);
      return null;
    }
  }

  return geometry;
}

function normalizeRing(ring) {
  if (!Array.isArray(ring)) return [];

  return ring
    .map((coordinate) => {
      const [lng, lat] = Array.isArray(coordinate) ? coordinate : [];
      return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
        ? { lat: Number(lat), lng: Number(lng) }
        : null;
    })
    .filter(Boolean);
}

function geoJsonGeometryToPolygonPaths(geometry) {
  if (!geometry) return [];

  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    const polygonPaths = geometry.coordinates
      .map(normalizeRing)
      .filter((ring) => ring.length >= 3);

    return polygonPaths.length > 0 ? [polygonPaths] : [];
  }

  if (
    geometry.type === "MultiPolygon" &&
    Array.isArray(geometry.coordinates)
  ) {
    return geometry.coordinates
      .map((polygon) =>
        Array.isArray(polygon)
          ? polygon.map(normalizeRing).filter((ring) => ring.length >= 3)
          : [],
      )
      .filter((polygonPaths) => polygonPaths.length > 0);
  }

  return [];
}

function getCentroid(boundary) {
  const lat = Number(
    boundary?.centroid?.lat ?? boundary?.centroid?.latitude,
  );
  const lng = Number(
    boundary?.centroid?.lng ?? boundary?.centroid?.longitude,
  );

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return FALLBACK_CENTER;

  return { lat, lng };
}

function formatLookupError(error) {
  return (
    error?.error ||
    error?.data?.message ||
    error?.message ||
    "The authoritative boundary could not be loaded."
  );
}

function BoundaryLayer({ geometry, mode }) {
  const map = useMap();
  const polygonsRef = useRef([]);

  const polygonPathSets = useMemo(
    () => geoJsonGeometryToPolygonPaths(parseGeometry(geometry)),
    [geometry],
  );

  useEffect(() => {
    polygonsRef.current.forEach((polygon) => polygon.setMap(null));
    polygonsRef.current = [];

    if (
      !map ||
      !window.google?.maps ||
      polygonPathSets.length === 0
    ) {
      return undefined;
    }

    const bounds = new window.google.maps.LatLngBounds();

    const polygons = polygonPathSets.map((polygonPaths) => {
      polygonPaths.forEach((ring) => {
        ring.forEach((point) => bounds.extend(point));
      });

      const polygon = new window.google.maps.Polygon({
        paths: polygonPaths,
        strokeColor: mode === "ERF" ? "#2563eb" : "#0f766e",
        strokeOpacity: 1,
        strokeWeight: mode === "ERF" ? 4 : 3,
        fillColor: mode === "ERF" ? "#2563eb" : "#0f766e",
        fillOpacity: mode === "ERF" ? 0.14 : 0.1,
        clickable: false,
        zIndex: 20,
      });

      polygon.setMap(map);
      return polygon;
    });

    polygonsRef.current = polygons;

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, mode === "ERF" ? 64 : 42);
    }

    return () => {
      polygonsRef.current.forEach((item) => item.setMap(null));
      polygonsRef.current = [];
    };
  }, [map, mode, polygonPathSets]);

  return null;
}

function DetailPill({ label, value }) {
  return (
    <div style={styles.detailPill}>
      <span style={styles.detailLabel}>{label}</span>
      <strong style={styles.detailValue}>
        {isMeaningful(value) ? value : "NAv"}
      </strong>
    </div>
  );
}

export default function BoundaryMapModal({
  mode,
  trnId,
  erfId,
  erfNo,
  wardPcode,
  wardNo,
  onClose,
}) {
  const normalizedMode = mode === "WARD" ? "WARD" : "ERF";

  const erfArg =
    normalizedMode === "ERF" && isMeaningful(erfId) ? { erfId } : skipToken;
  const wardArg =
    normalizedMode === "WARD" && isMeaningful(wardPcode)
      ? { wardPcode }
      : skipToken;

  const {
    data: erfBoundary,
    isLoading: isErfLoading,
    isFetching: isErfFetching,
    error: erfError,
  } = useGetErfBoundaryByIdQuery(erfArg);

  const {
    data: wardBoundary,
    isLoading: isWardLoading,
    isFetching: isWardFetching,
    error: wardError,
  } = useGetWardBoundaryByPcodeQuery(wardArg);

  const boundary =
    normalizedMode === "ERF" ? erfBoundary : wardBoundary;
  const isLoading =
    normalizedMode === "ERF"
      ? isErfLoading || isErfFetching
      : isWardLoading || isWardFetching;
  const error = normalizedMode === "ERF" ? erfError : wardError;

  const parsedGeometry = useMemo(
    () => parseGeometry(boundary?.geometry),
    [boundary?.geometry],
  );
  const polygonPathSets = useMemo(
    () => geoJsonGeometryToPolygonPaths(parsedGeometry),
    [parsedGeometry],
  );
  const hasGeometry = polygonPathSets.length > 0;
  const mapCenter = getCentroid(boundary);

  const title =
    normalizedMode === "ERF"
      ? `ERF ${erfNo || boundary?.erfNo || "NAv"}`
      : `Ward ${wardNo || boundary?.wardNumber || "NAv"}`;

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event) {
      if (event.key === "Escape") onClose?.();
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  function handleBackdropMouseDown(event) {
    if (event.target === event.currentTarget) onClose?.();
  }

  return createPortal(
    <div
      style={styles.overlay}
      role="presentation"
      onMouseDown={handleBackdropMouseDown}
    >
      <section
        style={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="boundary-map-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header style={styles.header}>
          <div style={styles.headerText}>
            <div style={styles.eyebrow}>
              {normalizedMode === "ERF" ? "ERF Boundary" : "Ward Boundary"}
            </div>
            <h2 id="boundary-map-modal-title" style={styles.title}>
              {title}
            </h2>
            <div style={styles.contextLine}>
              <span>
                <strong>TRN:</strong> {trnId || "NAv"}
              </span>
              {normalizedMode === "ERF" ? (
                <>
                  <span>
                    <strong>ERF ID:</strong> {erfId || boundary?.erfId || "NAv"}
                  </span>
                  <span>
                    <strong>Ward:</strong> {wardNo || "NAv"}
                  </span>
                </>
              ) : (
                <span>
                  <strong>Ward PCode:</strong>{" "}
                  {wardPcode || boundary?.wardPcode || "NAv"}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            style={styles.closeButton}
            onClick={onClose}
            aria-label={`Close ${normalizedMode.toLowerCase()} boundary map`}
          >
            Close
          </button>
        </header>

        <div style={styles.body}>
          {isLoading ? (
            <div style={styles.stateCard}>
              <strong>Loading authoritative boundary...</strong>
              <span>
                Reading the {normalizedMode === "ERF" ? "ERF" : "ward"} geometry.
              </span>
            </div>
          ) : null}

          {!isLoading && error ? (
            <div style={styles.errorCard}>
              <strong>Unable to load boundary.</strong>
              <span>{formatLookupError(error)}</span>
            </div>
          ) : null}

          {!isLoading && !error && !boundary ? (
            <div style={styles.stateCard}>
              <strong>Boundary record not found.</strong>
              <span>
                No authoritative {normalizedMode === "ERF" ? "ERF" : "ward"}{" "}
                record matched the identifier carried by this TRN.
              </span>
            </div>
          ) : null}

          {!isLoading && !error && boundary && !hasGeometry ? (
            <div style={styles.stateCard}>
              <strong>Boundary geometry unavailable.</strong>
              <span>
                The authoritative record exists, but it does not contain usable
                Polygon or MultiPolygon geometry.
              </span>
            </div>
          ) : null}

          {!isLoading &&
          !error &&
          boundary &&
          hasGeometry &&
          !googleMapsApiKey ? (
            <div style={styles.stateCard}>
              <strong>Google Maps key missing.</strong>
              <span>
                VITE_GOOGLE_MAPS_API_KEY is required to display this boundary.
              </span>
            </div>
          ) : null}

          {!isLoading &&
          !error &&
          boundary &&
          hasGeometry &&
          googleMapsApiKey ? (
            <div style={styles.mapShell}>
              <APIProvider apiKey={googleMapsApiKey}>
                <Map
                  defaultCenter={mapCenter}
                  defaultZoom={normalizedMode === "ERF" ? 18 : 13}
                  mapTypeId="roadmap"
                  gestureHandling="greedy"
                  disableDefaultUI={false}
                  style={{ width: "100%", height: "100%" }}
                >
                  <BoundaryLayer
                    geometry={boundary.geometry}
                    mode={normalizedMode}
                  />
                </Map>
              </APIProvider>
            </div>
          ) : null}

          {!isLoading && !error && boundary ? (
            <div style={styles.detailsGrid}>
              {normalizedMode === "ERF" ? (
                <>
                  <DetailPill
                    label="ERF No"
                    value={boundary.erfNo || erfNo}
                  />
                  <DetailPill label="ERF ID" value={boundary.erfId || erfId} />
                  <DetailPill
                    label="Ward PCode"
                    value={boundary.wardPcode || wardPcode}
                  />
                  <DetailPill label="Type" value={boundary.type} />
                </>
              ) : (
                <>
                  <DetailPill
                    label="Ward No"
                    value={boundary.wardNumber || wardNo}
                  />
                  <DetailPill
                    label="Ward PCode"
                    value={boundary.wardPcode || wardPcode}
                  />
                  <DetailPill label="Ward Name" value={boundary.name} />
                  <DetailPill label="LM PCode" value={boundary.lmPcode} />
                </>
              )}
            </div>
          ) : null}
        </div>

        <footer style={styles.footer}>
          <span style={styles.sourceNote}>
            Boundary loaded from the authoritative{" "}
            {normalizedMode === "ERF" ? "ERF" : "ward"} collection using the
            identifier carried by this TRN.
          </span>
          <button type="button" style={styles.doneButton} onClick={onClose}>
            Close
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 3300,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1rem",
    background: "rgba(15, 23, 42, 0.68)",
    backdropFilter: "blur(2px)",
  },
  modal: {
    width: "min(1120px, 96vw)",
    maxHeight: "90vh",
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr) auto",
    background: "#ffffff",
    borderRadius: "1rem",
    boxShadow: "0 28px 80px rgba(15, 23, 42, 0.38)",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "1rem 1.25rem",
    borderBottom: "1px solid #e2e8f0",
    background: "#ffffff",
  },
  headerText: {
    minWidth: 0,
  },
  eyebrow: {
    marginBottom: "0.2rem",
    color: "#64748b",
    fontSize: "0.74rem",
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  title: {
    margin: 0,
    color: "#0f172a",
    fontSize: "1.45rem",
    lineHeight: 1.2,
  },
  contextLine: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.35rem 1rem",
    marginTop: "0.5rem",
    color: "#475569",
    fontSize: "0.86rem",
    overflowWrap: "anywhere",
  },
  closeButton: {
    flex: "0 0 auto",
    border: "1px solid #cbd5e1",
    borderRadius: "0.55rem",
    background: "#ffffff",
    color: "#0f172a",
    padding: "0.48rem 0.75rem",
    font: "inherit",
    fontWeight: 800,
    cursor: "pointer",
  },
  body: {
    minHeight: 0,
    overflowY: "auto",
    padding: "1rem 1.25rem",
    background: "#f8fafc",
  },
  mapShell: {
    width: "100%",
    height: "min(68vh, 650px)",
    minHeight: "430px",
    border: "1px solid #cbd5e1",
    borderRadius: "0.85rem",
    overflow: "hidden",
    background: "#e2e8f0",
  },
  stateCard: {
    display: "grid",
    gap: "0.35rem",
    padding: "1rem",
    border: "1px solid #cbd5e1",
    borderRadius: "0.75rem",
    background: "#ffffff",
    color: "#334155",
  },
  errorCard: {
    display: "grid",
    gap: "0.35rem",
    padding: "1rem",
    border: "1px solid #fecaca",
    borderRadius: "0.75rem",
    background: "#fef2f2",
    color: "#991b1b",
  },
  detailsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: "0.75rem",
    marginTop: "0.85rem",
  },
  detailPill: {
    display: "grid",
    gap: "0.2rem",
    minWidth: 0,
    padding: "0.7rem 0.8rem",
    border: "1px solid #e2e8f0",
    borderRadius: "0.65rem",
    background: "#ffffff",
  },
  detailLabel: {
    color: "#64748b",
    fontSize: "0.72rem",
    fontWeight: 850,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  detailValue: {
    color: "#0f172a",
    fontSize: "0.92rem",
    overflowWrap: "anywhere",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "0.8rem 1.25rem",
    borderTop: "1px solid #e2e8f0",
    background: "#ffffff",
  },
  sourceNote: {
    color: "#64748b",
    fontSize: "0.8rem",
  },
  doneButton: {
    flex: "0 0 auto",
    border: 0,
    borderRadius: "0.55rem",
    background: "#0f172a",
    color: "#ffffff",
    padding: "0.55rem 0.85rem",
    font: "inherit",
    fontWeight: 850,
    cursor: "pointer",
  },
};
