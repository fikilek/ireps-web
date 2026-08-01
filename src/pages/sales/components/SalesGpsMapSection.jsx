/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useEffect, useMemo, useRef, useState } from "react";
import { APIProvider, Map, useMap } from "@vis.gl/react-google-maps";

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

function getWardGpsPoints(rows = [], selectedWardNo = "") {
  if (!selectedWardNo) return [];

  const points = [];

  rows.forEach((row) => {
    const rowWardNumbers = Array.isArray(row?.wardNumbers)
      ? row.wardNumbers.map((value) => String(value || "").trim())
      : [];

    const candidates = Array.isArray(row?.erfCandidates)
      ? row.erfCandidates
      : [];

    candidates.forEach((candidate, candidateIndex) => {
      const latitude = Number(candidate?.latitude);
      const longitude = Number(candidate?.longitude);
      const candidateWardNo = String(candidate?.wardNumber || "").trim();
      const belongsToWard = candidateWardNo
        ? candidateWardNo === selectedWardNo
        : rowWardNumbers.includes(selectedWardNo);

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
        wardNo: candidateWardNo || selectedWardNo,
        erfNumber: candidate?.erfNumber || "NAv",
        erfId: candidate?.erfId || "NAv",
        latitude,
        longitude,
      });
    });
  });

  return points;
}

function SalesGpsMarkers({ points, fitRequest }) {
  const map = useMap();
  const markersRef = useRef([]);
  const infoWindowRef = useRef(null);

  useEffect(() => {
    if (!map || !window.google?.maps) return undefined;

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];

    if (infoWindowRef.current) {
      infoWindowRef.current.close();
    }

    if (points.length === 0) return undefined;

    const bounds = new window.google.maps.LatLngBounds();
    const infoWindow = new window.google.maps.InfoWindow();
    infoWindowRef.current = infoWindow;

    const markers = points.map((point) => {
      const position = {
        lat: point.latitude,
        lng: point.longitude,
      };

      bounds.extend(position);

      const marker = new window.google.maps.Marker({
        position,
        map,
        title: `Meter ${point.meterNo}`,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: "#2563eb",
          fillOpacity: 0.94,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
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

    if (points.length === 1) {
      map.panTo({
        lat: points[0].latitude,
        lng: points[0].longitude,
      });
      map.setZoom(18);
    } else {
      map.fitBounds(bounds, 48);
    }

    return () => {
      infoWindow.close();
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
      infoWindowRef.current = null;
    };
  }, [map, points]);

  useEffect(() => {
    if (
      !map ||
      !window.google?.maps ||
      points.length === 0 ||
      fitRequest === 0
    ) {
      return;
    }

    const bounds = new window.google.maps.LatLngBounds();

    points.forEach((point) => {
      bounds.extend({
        lat: point.latitude,
        lng: point.longitude,
      });
    });

    if (points.length === 1) {
      map.panTo({
        lat: points[0].latitude,
        lng: points[0].longitude,
      });
      map.setZoom(18);
    } else {
      map.fitBounds(bounds, 48);
    }
  }, [fitRequest, map, points]);

  return null;
}

export default function SalesGpsMapSection({
  rows = [],
  wardOptions = [],
  selectedWardNo = "",
  onSelectedWardNoChange,
}) {
  const [fitRequest, setFitRequest] = useState(0);

  const points = useMemo(
    () => getWardGpsPoints(rows, selectedWardNo),
    [rows, selectedWardNo],
  );

  const gpsMeterCount = useMemo(
    () => new Set(points.map((point) => point.meterId)).size,
    [points],
  );

  const mapCenter = points[0]
    ? { lat: points[0].latitude, lng: points[0].longitude }
    : FALLBACK_CENTER;

  return (
    <section style={styles.panel}>
      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Sales GPS Map</p>
          <h3 style={styles.title}>Meters with GPS by ward</h3>
          <p style={styles.subtitle}>
            Select one ward to display every Sales meter with a valid GPS
            candidate in that ward.
          </p>
        </div>

        <div style={styles.controls}>
          <label style={styles.wardLabel}>
            Ward
            <select
              value={selectedWardNo}
              onChange={(event) =>
                onSelectedWardNoChange?.(event.target.value)
              }
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
              ...(points.length === 0 ? styles.disabledButton : null),
            }}
            onClick={() => setFitRequest((current) => current + 1)}
            disabled={points.length === 0}
          >
            Fit Ward Meters
          </button>
        </div>
      </div>

      {!selectedWardNo ? (
        <div style={styles.emptyState}>
          <strong>Select a ward to display GPS meters on the map.</strong>
          <span>
            The map remains unloaded until a ward is selected.
          </span>
        </div>
      ) : points.length === 0 ? (
        <div style={styles.emptyState}>
          <strong>No usable GPS meters were found for Ward {selectedWardNo}.</strong>
          <span>
            Only Sales rows with valid ERF-candidate latitude and longitude are
            displayed.
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
                <SalesGpsMarkers points={points} fitRequest={fitRequest} />
              </Map>
            </APIProvider>
          </div>

          <div style={styles.footer}>
            <span>
              Ward {selectedWardNo}: {gpsMeterCount} GPS meter
              {gpsMeterCount === 1 ? "" : "s"}
            </span>
            <span>
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
