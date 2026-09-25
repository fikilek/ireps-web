/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
// Targeted Batch rules TB-R061 (1.3.64): the Meter Location window draws the ERF the meter sits on,
// puts the meter's point on it with its work status in words, and names the address, Ward, batch
// and premise. It only reads. Where a detail cannot be read it says so in plain words.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { APIProvider, Map, useMap } from "@vis.gl/react-google-maps";
import { skipToken } from "@reduxjs/toolkit/query";

import { useGetErfBoundaryByIdQuery } from "../../../redux/mapErfsApi";
import { useGetPermanentSalesBatchesQuery } from "../../../redux/salesTargetedBatchApi";
import { useBatchGeofence } from "./use-batch-geofence.js";
import {
  ERF_FOCUS_BOUNDARY_STYLE,
  ERF_LABEL_STYLE,
  geoJsonPolygonToGooglePaths,
  parseGeometry,
  toUsableLatLng,
} from "../../operations/geofence-map-helpers";
import { SALES_ICON_SCALE, SALES_STATUS_GLYPHS } from "../../operations/geofence-map-icons.js";
import {
  erfPlaceTitle,
  erfShapeNote,
  meterAddressText,
  meterBatchLines,
  meterBatchTarget,
  meterLocationPlaces,
  meterLocationSubtitle,
  meterPremise,
  meterStatusCode,
  meterStatusText,
  meterTownText,
  meterWardText,
} from "./meter-location-model.js";

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

function asText(value, fallback = "NAv") {
  return String(value ?? "").trim() || fallback;
}

// One ERF document, read exactly as the registry map reads a single ERF (ireps_erfs by ID).
// Never a Ward-wide read: only the ERFs this meter's candidates name.
function ErfBoundaryReader({ erfId, onResult }) {
  const { data, isFetching, isError } = useGetErfBoundaryByIdQuery(erfId || skipToken);

  useEffect(() => {
    onResult(erfId, {
      erfId,
      boundary: data || null,
      loading: Boolean(isFetching),
      failed: Boolean(isError) || (!isFetching && !data),
    });
  }, [erfId, data, isFetching, isError, onResult]);

  return null;
}

function erfPaths(state) {
  return geoJsonPolygonToGooglePaths(parseGeometry(state?.boundary?.geometry)).filter(
    (ring) => Array.isArray(ring) && ring.length >= 3,
  );
}

// The ERFs drawn and the meter's point on them, in the GPS Sales map's colours and label style.
function MeterLocationLayers({ places, boundaries, meterNo, statusCode, statusLabel, addressLine }) {
  const map = useMap();

  useEffect(() => {
    if (!map || !window.google?.maps) return undefined;

    const objects = [];
    const infoWindow = new window.google.maps.InfoWindow();
    const bounds = new window.google.maps.LatLngBounds();
    let boundsHasShape = false;
    let boundsHasPoint = false;

    places.forEach((place, index) => {
      const state = boundaries[place.erfId];
      const erfLabel = asText(place.erfNumber, asText(place.erfId));

      erfPaths(state).forEach((ring) => {
        const polygon = new window.google.maps.Polygon({
          paths: ring,
          ...ERF_FOCUS_BOUNDARY_STYLE,
          clickable: true,
          zIndex: 35,
        });

        polygon.addListener("click", (event) => {
          infoWindow.setContent(`
            <div style="font-family: Arial, sans-serif; min-width: 180px;">
              <strong>ERF ${escapeHtml(erfLabel)}</strong>
              <div>${escapeHtml(place.erfId || "NAv")}</div>
            </div>
          `);
          infoWindow.setPosition(event.latLng);
          infoWindow.open({ map, shouldFocus: false });
        });

        polygon.setMap(map);
        objects.push(polygon);
        ring.forEach((point) => {
          bounds.extend(point);
          boundsHasShape = true;
        });
      });

      const labelPoint = toUsableLatLng(state?.boundary?.centroid);
      if (labelPoint) {
        bounds.extend(labelPoint);
        boundsHasPoint = true;
        objects.push(
          new window.google.maps.Marker({
            position: labelPoint,
            map,
            title: `ERF ${erfLabel}`,
            label: { text: erfLabel, ...ERF_LABEL_STYLE },
            icon: {
              path: window.google.maps.SymbolPath.CIRCLE,
              scale: 1,
              fillOpacity: 0,
              strokeOpacity: 0,
            },
            clickable: false,
            zIndex: 42,
          }),
        );
      }

      if (!place.point) return;

      const glyph = SALES_STATUS_GLYPHS[statusCode];
      const marker = new window.google.maps.Marker({
        position: place.point,
        map,
        title: `${asText(meterNo)} • ${statusLabel}`,
        label:
          places.length > 1
            ? { text: String(index + 1), color: "#ffffff", fontWeight: "900", fontSize: "11px" }
            : undefined,
        icon: glyph
          ? {
              path: glyph.path,
              scale: SALES_ICON_SCALE,
              fillColor: glyph.color,
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
            }
          : {
              path: window.google.maps.SymbolPath.CIRCLE,
              scale: 10,
              fillColor: "#2563eb",
              fillOpacity: 0.95,
              strokeColor: "#ffffff",
              strokeWeight: 3,
            },
        zIndex: 112,
      });

      marker.addListener("click", () => {
        infoWindow.setContent(`
          <div style="font-family: Arial, sans-serif; min-width: 220px;">
            <strong>${escapeHtml(meterNo)}</strong>
            <div style="margin-top: 6px;">Work status: ${escapeHtml(statusLabel)}</div>
            <div>ERF ${escapeHtml(erfLabel)}</div>
            <div>${escapeHtml(addressLine)}</div>
            <div>${place.point.lat.toFixed(6)}, ${place.point.lng.toFixed(6)}</div>
          </div>
        `);
        infoWindow.open({ anchor: marker, map, shouldFocus: false });
      });

      objects.push(marker);
      bounds.extend(place.point);
      boundsHasPoint = true;
    });

    // The whole ERF when there is an outline, the two or more candidates when there are several,
    // otherwise close in on the one place there is.
    const pointCount = places.filter((place) => place.point).length;

    if (boundsHasShape || pointCount > 1) {
      map.fitBounds(bounds, 48);
    } else if (pointCount === 1) {
      map.panTo(places.find((place) => place.point).point);
      map.setZoom(19);
    } else if (boundsHasPoint) {
      map.panTo(bounds.getCenter());
      map.setZoom(19);
    }

    return () => {
      infoWindow.close();
      objects.forEach((object) => object.setMap(null));
    };
  }, [map, places, boundaries, meterNo, statusCode, statusLabel, addressLine]);

  return null;
}

// The batch this meter is in and the premise it has, read exactly as the Targeted Batch window
// reads them, so there is one way of getting them.
function MeterBatchAndPremise({ row, tbId, batchNote }) {
  const lmPcode = row?.lmPcode || "";
  const salesId = row?.id || row?.meterNoNormalized || row?.meterNo || "";
  const { data } = useGetPermanentSalesBatchesQuery(
    lmPcode && tbId ? { lmPcode, tbId } : skipToken,
    { skip: !lmPcode || !tbId },
  );
  const batch = data?.batch || null;
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const geofence = useBatchGeofence(lmPcode, batch?.geofenceId);
  const batchRow = rows.find((item) => item?.sourceSalesAllMeterId === salesId) || null;

  const { note, lines } = meterBatchLines({ tbId, batch, geofence, ready: Boolean(data?.ready) });
  const premise = meterPremise({ row, tbId, batchRow });

  return (
    <>
      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Batch</h3>
        {batchNote ? <p style={styles.note}>{batchNote}</p> : null}
        {note ? <p style={styles.note}>{note}</p> : null}
        {lines.length ? (
          <dl style={styles.detailGrid}>
            {lines.map(([label, value]) => (
              <div key={label} style={styles.detailItem}>
                <dt style={styles.detailLabel}>{label}</dt>
                <dd style={styles.detailValue}>{asText(value)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </section>

      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Premise</h3>
        {premise.has ? (
          <dl style={styles.detailGrid}>
            <div style={styles.detailItem}>
              <dt style={styles.detailLabel}>Premise ID</dt>
              <dd style={styles.detailValue}>{premise.id}</dd>
            </div>
            {premise.address ? (
              <div style={styles.detailItem}>
                <dt style={styles.detailLabel}>Premise address</dt>
                <dd style={styles.detailValue}>{premise.address}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {premise.note ? <p style={styles.note}>{premise.note}</p> : null}
      </section>
    </>
  );
}

function MeterLocationContent({ row, onClose }) {
  const [boundaries, setBoundaries] = useState({});

  const handleBoundary = useCallback((erfId, next) => {
    setBoundaries((current) => {
      const previous = current[erfId];
      if (
        previous &&
        previous.boundary === next.boundary &&
        previous.loading === next.loading &&
        previous.failed === next.failed
      ) {
        return current;
      }
      return { ...current, [erfId]: next };
    });
  }, []);

  const places = useMemo(() => meterLocationPlaces(row), [row]);
  const erfIds = useMemo(
    () => Array.from(new Set(places.map((place) => place.erfId).filter(Boolean))),
    [places],
  );

  const statusCode = meterStatusCode(row);
  const statusLabel = meterStatusText(row);
  const addressLine = meterAddressText(row);
  const townLine = meterTownText(row);
  const wardLine = meterWardText(row);
  const batchTarget = meterBatchTarget(row);

  const mapCenter = useMemo(() => {
    const point = places.find((place) => place.point)?.point;
    return point || FALLBACK_CENTER;
  }, [places]);

  const hasAnyPoint = places.some((place) => place.point);

  return (
    <>
      {erfIds.map((erfId) => (
        <ErfBoundaryReader key={erfId} erfId={erfId} onResult={handleBoundary} />
      ))}

      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Meter Location</p>
          <h2 id="meter-location-modal-title" style={styles.title}>
            Meter {row.meterNo || "NAv"}
          </h2>
          <p style={styles.subtitle}>
            {statusLabel} · {meterLocationSubtitle(places)}
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
        {places.length === 0 ? (
          <div style={styles.emptyState}>
            <h3 style={styles.emptyTitle}>Nothing to draw yet</h3>
            <p style={styles.emptyText}>
              This meter has no ERF and no coordinates on its Sales record, so there is no place to
              show on the map.
            </p>
          </div>
        ) : !googleMapsApiKey ? (
          <div style={styles.emptyState}>
            <h3 style={styles.emptyTitle}>Google Maps key missing</h3>
            <p style={styles.emptyText}>
              Add VITE_GOOGLE_MAPS_API_KEY to the web environment and restart Vite.
            </p>
          </div>
        ) : (
          <div style={styles.mapWrap}>
            <APIProvider apiKey={googleMapsApiKey}>
              <Map
                defaultCenter={mapCenter}
                defaultZoom={hasAnyPoint && places.length === 1 ? 19 : 13}
                mapTypeId="roadmap"
                gestureHandling="greedy"
                disableDefaultUI={false}
                style={{ width: "100%", height: "100%" }}
              >
                <MeterLocationLayers
                  places={places}
                  boundaries={boundaries}
                  meterNo={row.meterNo || "NAv"}
                  statusCode={statusCode}
                  statusLabel={statusLabel}
                  addressLine={addressLine}
                />
              </Map>
            </APIProvider>
          </div>
        )}

        <section style={styles.section}>
          <h3 style={styles.sectionTitle}>This meter</h3>
          <dl style={styles.detailGrid}>
            <div style={styles.detailItem}>
              <dt style={styles.detailLabel}>Work status</dt>
              <dd style={styles.detailValue}>{statusLabel}</dd>
            </div>
            <div style={styles.detailItem}>
              <dt style={styles.detailLabel}>Street address</dt>
              <dd style={styles.detailValue}>{addressLine}</dd>
            </div>
            <div style={styles.detailItem}>
              <dt style={styles.detailLabel}>Town</dt>
              <dd style={styles.detailValue}>{townLine}</dd>
            </div>
            <div style={styles.detailItem}>
              <dt style={styles.detailLabel}>Ward</dt>
              <dd style={styles.detailValue}>{wardLine}</dd>
            </div>
          </dl>
        </section>

        <MeterBatchAndPremise row={row} tbId={batchTarget.tbId} batchNote={batchTarget.note} />

        {places.length > 0 ? (
          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>
              {places.length === 1 ? "The ERF" : "The ERF candidates"}
            </h3>
            <div style={styles.candidateList}>
              {places.map((place, index) => {
                const state = boundaries[place.erfId];
                const drawn = erfPaths(state).length > 0;

                return (
                  <div key={place.key} style={styles.candidateCard}>
                    <strong style={styles.candidateTitle}>
                      {erfPlaceTitle(place, index, places.length)}
                    </strong>
                    <span>{place.wardNumber ? `Ward ${place.wardNumber}` : wardLine}</span>
                    <span>{place.erfId || "No ERF ID"}</span>
                    <span>
                      {place.point
                        ? `${place.point.lat.toFixed(6)}, ${place.point.lng.toFixed(6)}`
                        : "No coordinates on this candidate."}
                    </span>
                    <span style={styles.shapeNote}>
                      {erfShapeNote({ erfId: place.erfId, drawn, loading: state ? state.loading : true })}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>

      <div style={styles.footer}>
        <button type="button" style={styles.doneButton} onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}

export default function MeterLocationModal({ row, onClose }) {
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
        <MeterLocationContent
          key={row.id || row.meterNoNormalized || row.meterNo}
          row={row}
          onClose={onClose}
        />
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
    height: "min(48vh, 440px)",
    minHeight: "320px",
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
  section: {
    marginTop: "0.9rem",
    paddingTop: "0.8rem",
    borderTop: "1px solid #e2e8f0",
  },
  sectionTitle: {
    margin: 0,
    color: "#334155",
    fontSize: "0.82rem",
  },
  note: {
    margin: "0.45rem 0 0",
    color: "#64748b",
    fontSize: "0.82rem",
  },
  detailGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "0.65rem",
    margin: "0.6rem 0 0",
  },
  detailItem: {
    minWidth: 0,
    padding: "0.6rem",
    borderRadius: "0.65rem",
    background: "#f8fafc",
  },
  detailLabel: {
    color: "#64748b",
    fontSize: "0.68rem",
    fontWeight: 850,
    textTransform: "uppercase",
  },
  detailValue: {
    margin: "0.2rem 0 0",
    color: "#0f172a",
    fontSize: "0.8rem",
    fontWeight: 750,
    overflowWrap: "anywhere",
  },
  candidateList: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: "0.65rem",
    marginTop: "0.6rem",
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
  shapeNote: {
    color: "#64748b",
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
