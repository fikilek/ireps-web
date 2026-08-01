/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { APIProvider, Map, useMap } from "@vis.gl/react-google-maps";

const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function CandidateMarkers({ candidates }) {
  const map = useMap();
  const markersRef = useRef([]);

  useEffect(() => {
    if (!map || !window.google?.maps || candidates.length === 0) return;

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];

    const bounds = new window.google.maps.LatLngBounds();
    const infoWindow = new window.google.maps.InfoWindow();

    const markers = candidates.map((candidate, index) => {
      const position = {
        lat: candidate.latitude,
        lng: candidate.longitude,
      };

      bounds.extend(position);

      const marker = new window.google.maps.Marker({
        position,
        map,
        title: `ERF ${candidate.erfNumber || candidate.erfId || index + 1}`,
        label: {
          text: String(index + 1),
          color: "#ffffff",
          fontWeight: "900",
        },
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: "#2563eb",
          fillOpacity: 0.95,
          strokeColor: "#ffffff",
          strokeWeight: 3,
        },
      });

      marker.addListener("click", () => {
        infoWindow.setContent(`
          <div style="font-family: Arial, sans-serif; min-width: 210px;">
            <strong>ERF ${escapeHtml(candidate.erfNumber || "NAv")}</strong>
            <div style="margin-top: 6px;">Ward: ${escapeHtml(candidate.wardNumber || "NAv")}</div>
            <div>ERF ID: ${escapeHtml(candidate.erfId || "NAv")}</div>
            <div>Latitude: ${candidate.latitude.toFixed(6)}</div>
            <div>Longitude: ${candidate.longitude.toFixed(6)}</div>
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

    if (candidates.length === 1) {
      map.panTo({
        lat: candidates[0].latitude,
        lng: candidates[0].longitude,
      });
      map.setZoom(19);
    } else {
      map.fitBounds(bounds, 48);
    }

    return () => {
      infoWindow.close();
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
    };
  }, [map, candidates]);

  return null;
}

export default function MeterLocationModal({ row, onClose }) {
  const candidates = useMemo(() => {
    return (row?.erfCandidates || []).filter(
      (candidate) =>
        candidate?.hasValidGps === true &&
        Number.isFinite(candidate?.latitude) &&
        Number.isFinite(candidate?.longitude),
    );
  }, [row?.erfCandidates]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  if (typeof document === "undefined" || !row) return null;

  const mapCenter = candidates[0]
    ? { lat: candidates[0].latitude, lng: candidates[0].longitude }
    : { lat: -28.168, lng: 30.236 };

  return createPortal(
    <div
      style={styles.overlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        style={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="meter-location-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={styles.header}>
          <div>
            <p style={styles.eyebrow}>Meter Location</p>
            <h2 id="meter-location-modal-title" style={styles.title}>
              Meter {row.meterNo || "NAv"}
            </h2>
            <p style={styles.subtitle}>
              {candidates.length === 1
                ? "One ERF and GPS candidate"
                : `${candidates.length} ERF and GPS candidates`}
            </p>
          </div>

          <button
            type="button"
            style={styles.closeButton}
            onClick={onClose}
            aria-label="Close meter map"
          >
            ✕
          </button>
        </div>

        <div style={styles.body}>
          {candidates.length === 0 ? (
            <div style={styles.emptyState}>
              <h3 style={styles.emptyTitle}>No usable GPS location</h3>
              <p style={styles.emptyText}>
                This meter does not currently have an ERF candidate with valid
                latitude and longitude coordinates.
              </p>
            </div>
          ) : !googleMapsApiKey ? (
            <div style={styles.emptyState}>
              <h3 style={styles.emptyTitle}>Google Maps key missing</h3>
              <p style={styles.emptyText}>
                Add VITE_GOOGLE_MAPS_API_KEY to the web environment and restart
                Vite.
              </p>
            </div>
          ) : (
            <div style={styles.mapWrap}>
              <APIProvider apiKey={googleMapsApiKey}>
                <Map
                  defaultCenter={mapCenter}
                  defaultZoom={candidates.length === 1 ? 19 : 13}
                  mapTypeId="roadmap"
                  gestureHandling="greedy"
                  disableDefaultUI={false}
                  style={{ width: "100%", height: "100%" }}
                >
                  <CandidateMarkers candidates={candidates} />
                </Map>
              </APIProvider>
            </div>
          )}

          {candidates.length > 0 ? (
            <div style={styles.candidateList}>
              {candidates.map((candidate, index) => (
                <div
                  key={`${candidate.erfId || candidate.erfNumber}-${index}`}
                  style={styles.candidateCard}
                >
                  <strong style={styles.candidateTitle}>
                    {index + 1}. ERF {candidate.erfNumber || "NAv"}
                  </strong>
                  <span>Ward {candidate.wardNumber || "NAv"}</span>
                  <span>{candidate.erfId || "NAv"}</span>
                  <span>
                    {candidate.latitude.toFixed(6)}, {candidate.longitude.toFixed(6)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div style={styles.footer}>
          <button type="button" style={styles.doneButton} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 3200,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1rem",
    background: "rgba(15, 23, 42, 0.65)",
    backdropFilter: "blur(2px)",
  },
  card: {
    width: "min(980px, 100%)",
    maxHeight: "calc(100vh - 2rem)",
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr) auto",
    borderRadius: "1rem",
    background: "#ffffff",
    boxShadow: "0 28px 80px rgba(15, 23, 42, 0.36)",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "1rem",
    padding: "1rem 1.15rem",
    borderBottom: "1px solid #e2e8f0",
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
    fontSize: "1.25rem",
  },
  subtitle: {
    margin: "0.35rem 0 0",
    color: "#64748b",
    fontSize: "0.86rem",
  },
  closeButton: {
    border: 0,
    background: "transparent",
    color: "#64748b",
    cursor: "pointer",
    fontSize: "1rem",
    fontWeight: 900,
  },
  body: {
    minHeight: 0,
    padding: "1rem 1.15rem",
    overflowY: "auto",
  },
  mapWrap: {
    width: "100%",
    height: "min(56vh, 520px)",
    minHeight: "360px",
    overflow: "hidden",
    border: "1px solid #cbd5e1",
    borderRadius: "0.85rem",
  },
  emptyState: {
    padding: "2rem",
    border: "1px dashed #cbd5e1",
    borderRadius: "0.85rem",
    background: "#f8fafc",
    textAlign: "center",
  },
  emptyTitle: {
    margin: 0,
    color: "#0f172a",
  },
  emptyText: {
    margin: "0.5rem auto 0",
    maxWidth: "600px",
    color: "#64748b",
    lineHeight: 1.5,
  },
  candidateList: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: "0.65rem",
    marginTop: "0.8rem",
  },
  candidateCard: {
    display: "grid",
    gap: "0.22rem",
    padding: "0.7rem",
    border: "1px solid #e2e8f0",
    borderRadius: "0.7rem",
    color: "#475569",
    fontSize: "0.76rem",
  },
  candidateTitle: {
    color: "#0f172a",
    fontSize: "0.82rem",
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    padding: "0.9rem 1.15rem",
    borderTop: "1px solid #e2e8f0",
  },
  doneButton: {
    border: "1px solid #2563eb",
    borderRadius: "0.65rem",
    padding: "0.55rem 0.9rem",
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 900,
    cursor: "pointer",
  },
};
