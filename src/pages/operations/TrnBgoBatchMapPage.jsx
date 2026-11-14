import LoadingIndicator from "../../components/LoadingIndicator";
/* eslint-disable no-unused-vars -- JSX component tags are consumed by the JSX transform. */
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { APIProvider, Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import {
  useGetTcUploadByIdQuery,
  useGetTcUploadsQuery,
  useGetTcRowsByTcIdQuery,
} from "../../redux/tcApi";
import { useGetWardBoundariesByLmQuery } from "../../redux/mapWardsApi";

const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-ZA") : "0";
}

function resolveWorkbase(auth = {}, geoState = {}) {
  const candidate =
    auth?.activeWorkbase ||
    auth?.profile?.access?.activeWorkbase ||
    auth?.profile?.activeWorkbase ||
    auth?.activeLm ||
    (Array.isArray(auth?.workbases) && auth.workbases[0]) ||
    (Array.isArray(auth?.profile?.access?.workbases) && auth.profile.access.workbases[0]) ||
    geoState?.selectedLm ||
    null;

  const pcode = String(
    candidate?.lmPcode ||
      candidate?.pcode ||
      candidate?.id ||
      candidate?.localMunicipalityId ||
      "",
  ).trim();

  const lmName = String(
    candidate?.name ||
      candidate?.lmName ||
      candidate?.id ||
      candidate?.pcode ||
      "NAv",
  ).trim();

  return {
    lmPcode: pcode === "NAv" ? "" : pcode,
    lmName,
  };
}

function extractRowLatLng(row) {
  const candidates = [
    row.ast?.gps,
    row.ast?.location?.gps,
    row.premise?.location?.gps,
    row.premise?.gps,
    row.gps,
    row.input?.gps,
  ];

  for (const cand of candidates) {
    if (!cand) continue;
    if (typeof cand.lat === "number" && typeof cand.lng === "number") {
      return { lat: cand.lat, lng: cand.lng };
    }
    if (typeof cand.latitude === "number" && typeof cand.longitude === "number") {
      return { lat: cand.latitude, lng: cand.longitude };
    }
    if (Array.isArray(cand) && cand.length >= 2) {
      const lat = Number(cand[0]);
      const lng = Number(cand[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
    if (typeof cand === "string") {
      const parts = cand.split(",").map((s) => Number(s.trim()));
      if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
        return { lat: parts[0], lng: parts[1] };
      }
    }
  }

  return null;
}

// Inner component with access to GoogleMap instance via useMap()
function BatchMapCanvas({
  meters,
  wardGeometry,
  selectedMeterId,
  onSelectMeter,
}) {
  const map = useMap();
  const markersRef = useRef(new Map());
  const infoWindowRef = useRef(null);
  const wardPolygonRef = useRef(null);

  // Initialize InfoWindow
  useEffect(() => {
    if (!infoWindowRef.current && window.google?.maps?.InfoWindow) {
      infoWindowRef.current = new window.google.maps.InfoWindow();
    }
    return () => {
      infoWindowRef.current?.close();
      infoWindowRef.current = null;
    };
  }, []);

  // Render ward boundary polygon if available
  useEffect(() => {
    if (!map || !window.google?.maps) return;

    if (wardPolygonRef.current) {
      wardPolygonRef.current.setMap(null);
      wardPolygonRef.current = null;
    }

    if (wardGeometry && Array.isArray(wardGeometry.coordinates)) {
      try {
        const paths = wardGeometry.coordinates[0].map((coord) => ({
          lat: coord[1],
          lng: coord[0],
        }));

        wardPolygonRef.current = new window.google.maps.Polygon({
          paths,
          strokeColor: "#2563eb",
          strokeOpacity: 0.8,
          strokeWeight: 2,
          fillColor: "#3b82f6",
          fillOpacity: 0.08,
          map,
        });
      } catch (e) {
        console.warn("Failed to render ward boundary polygon:", e);
      }
    }

    return () => {
      if (wardPolygonRef.current) {
        wardPolygonRef.current.setMap(null);
        wardPolygonRef.current = null;
      }
    };
  }, [map, wardGeometry]);

  // Render meter marker pins and fit bounds
  useEffect(() => {
    if (!map || !window.google?.maps) return;

    // Clear existing markers
    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current.clear();

    const bounds = new window.google.maps.LatLngBounds();
    let plottedCount = 0;

    meters.forEach((meter) => {
      if (!meter.latLng) return;

      bounds.extend(meter.latLng);
      plottedCount += 1;

      const isSelected = meter.id === selectedMeterId;
      const isConnected = meter.meterStatus === "CONNECTED";

      const marker = new window.google.maps.Marker({
        position: meter.latLng,
        map,
        title: `Meter: ${meter.meterNo}`,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: isSelected ? 10 : 7,
          fillColor: isSelected ? "#ef4444" : isConnected ? "#16a34a" : "#d97706",
          fillOpacity: 0.95,
          strokeColor: "#ffffff",
          strokeWeight: isSelected ? 3 : 2,
        },
      });

      marker.addListener("click", () => {
        onSelectMeter(meter.id);
        const infoWindow = infoWindowRef.current;
        if (!infoWindow) return;

        infoWindow.setContent(`
          <div style="font-family: inherit; font-size: 13px; color: #0f172a; padding: 4px 6px; min-width: 220px;">
            <div style="font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; margin-bottom: 2px;">
              Meter ${meter.rowNo}
            </div>
            <strong style="font-size: 15px; color: #1d4ed8; font-family: monospace;">${meter.meterNo}</strong>
            <div style="margin-top: 6px; font-size: 12px; line-height: 1.4;">
              <div><strong>Address:</strong> ${meter.premiseAddress}</div>
              <div><strong>ERF:</strong> ${meter.erfNo || "NAv"}</div>
              <div><strong>Type / Phase:</strong> ${meter.meterType} · ${meter.meterPhase}</div>
              <div><strong>Account:</strong> ${meter.linkedAccountNo}</div>
              <div><strong>Status:</strong> <span style="font-weight: 700; color: ${isConnected ? "#15803d" : "#b45309"};">${meter.meterStatus}</span></div>
            </div>
          </div>
        `);
        infoWindow.open({ anchor: marker, map, shouldFocus: false });
      });

      markersRef.current.set(meter.id, marker);
    });

    if (plottedCount > 0) {
      if (plottedCount === 1) {
        map.setCenter(bounds.getCenter());
        map.setZoom(17);
      } else {
        map.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });
      }
    }

    return () => {
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current.clear();
    };
  }, [map, meters, selectedMeterId, onSelectMeter]);

  // Handle programmatic selection from the side list
  useEffect(() => {
    if (!map || !selectedMeterId) return;
    const marker = markersRef.current.get(selectedMeterId);
    if (!marker) return;

    map.panTo(marker.getPosition());
    map.setZoom(18);

    const meter = meters.find((m) => m.id === selectedMeterId);
    if (!meter) return;

    const infoWindow = infoWindowRef.current;
    if (infoWindow) {
      const isConnected = meter.meterStatus === "CONNECTED";
      infoWindow.setContent(`
        <div style="font-family: inherit; font-size: 13px; color: #0f172a; padding: 4px 6px; min-width: 220px;">
          <div style="font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; margin-bottom: 2px;">
            Meter ${meter.rowNo}
          </div>
          <strong style="font-size: 15px; color: #1d4ed8; font-family: monospace;">${meter.meterNo}</strong>
          <div style="margin-top: 6px; font-size: 12px; line-height: 1.4;">
            <div><strong>Address:</strong> ${meter.premiseAddress}</div>
            <div><strong>ERF:</strong> ${meter.erfNo || "NAv"}</div>
            <div><strong>Type / Phase:</strong> ${meter.meterType} · ${meter.meterPhase}</div>
            <div><strong>Account:</strong> ${meter.linkedAccountNo}</div>
            <div><strong>Status:</strong> <span style="font-weight: 700; color: ${isConnected ? "#15803d" : "#b45309"};">${meter.meterStatus}</span></div>
          </div>
        </div>
      `);
      infoWindow.open({ anchor: marker, map, shouldFocus: false });
    }
  }, [selectedMeterId, map, meters]);

  return null;
}

export default function TrnBgoBatchMapPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialBatchId = searchParams.get("batchId") || "";

  const auth = useAuth();
  const { geoState } = useGeo();
  const { lmPcode, lmName } = useMemo(
    () => resolveWorkbase(auth, geoState),
    [auth, geoState],
  );

  // Stream existing TRN uploads directly from tc_uploads
  const {
    data: uploads = [],
    isLoading: isUploadsLoading,
  } = useGetTcUploadsQuery({ limit: 500 });

  const [selectedBatchId, setSelectedBatchId] = useState(initialBatchId);
  const [selectedMeterId, setSelectedMeterId] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (initialBatchId && initialBatchId !== selectedBatchId) {
      setSelectedBatchId(initialBatchId);
    } else if (!initialBatchId && uploads.length > 0 && !selectedBatchId) {
      setSelectedBatchId(uploads[0].id);
    }
  }, [initialBatchId, uploads, selectedBatchId]);

  const activeBatch = useMemo(() => {
    return uploads.find((u) => u.id === selectedBatchId) || null;
  }, [uploads, selectedBatchId]);

  // Stream constituent meter rows
  const {
    data: tcRows = [],
    isLoading: isRowsLoading,
  } = useGetTcRowsByTcIdQuery(selectedBatchId, {
    skip: !selectedBatchId,
  });

  // Query ward boundary if batch has wardPcode
  const { data: wards = [], isLoading: areWardsLoading } = useGetWardBoundariesByLmQuery(
    { lmPcode: activeBatch?.lmPcode || lmPcode },
    { skip: !(activeBatch?.lmPcode || lmPcode) }
  );

  const wardGeometry = useMemo(() => {
    if (!activeBatch?.wardPcode || !Array.isArray(wards)) return null;
    const wardDoc = wards.find((w) => w.id === activeBatch.wardPcode || w.wardPcode === activeBatch.wardPcode);
    return wardDoc?.geometry || null;
  }, [wards, activeBatch]);

  // Process rows and coordinates
  const meters = useMemo(() => {
    return tcRows.map((r, index) => {
      const latLng = extractRowLatLng(r);
      return {
        id: r.id || `row_${index + 1}`,
        rowNo: r.rowNo ?? index + 1,
        meterNo: r.input?.meterNo || r.meterNo || r.ast?.meterNo || "NAv",
        meterType: r.input?.meterType || r.ast?.meterType || "NAv",
        meterPhase: r.input?.meterPhase || r.ast?.meterPhase || "NAv",
        premiseAddress: r.premise?.address || r.input?.premiseAddress || "NAv",
        erfNo: r.premise?.erfNo || r.input?.erfNo || "NAv",
        linkedAccountNo: r.input?.linkedAccountNo || r.input?.accountNo || "NAv",
        actionReason: r.input?.actionReason || r.input?.reason || "NAv",
        meterStatus: String(r.ast?.statusState || r.ast?.meterStatus || r.input?.meterStatus || "CONNECTED").toUpperCase(),
        latLng,
        hasGps: Boolean(latLng),
      };
    });
  }, [tcRows]);

  const filteredMeters = useMemo(() => {
    if (!searchQuery.trim()) return meters;
    const q = searchQuery.toLowerCase();
    return meters.filter(
      (m) =>
        m.meterNo.toLowerCase().includes(q) ||
        m.premiseAddress.toLowerCase().includes(q) ||
        m.erfNo.toLowerCase().includes(q) ||
        m.linkedAccountNo.toLowerCase().includes(q)
    );
  }, [meters, searchQuery]);

  const plottedCount = meters.filter((m) => m.hasGps).length;

  const defaultCenter = useMemo(() => {
    const firstPlotted = meters.find((m) => m.hasGps);
    if (firstPlotted) return firstPlotted.latLng;
    return { lat: -28.16, lng: 30.30 }; // Endumeni (ZA5241) default
  }, [meters]);

  const handleSelectBatch = (e) => {
    const newId = e.target.value;
    setSelectedBatchId(newId);
    setSelectedMeterId(null);
    setSearchParams(newId ? { batchId: newId } : {});
  };

  return (
    <section style={styles.page}>
      {/* Top Header */}
      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>
            <Link to="/operations/trn-bgo" style={styles.breadcrumbLink}>
              Operations / TRN BGO Register
            </Link>{" "}
            / Batch Map
          </p>
          <div style={styles.titleHelpRow}>
            <h2 style={styles.title}>TRN BGO Batch Map</h2>
            <div style={styles.lmHeaderPill}>
              <span style={styles.lmHeaderDot} />
              <span style={styles.lmHeaderLabel}>Active Municipality:</span>
              <strong style={styles.lmHeaderValue}>{lmName || lmPcode || "All"}</strong>
              {lmPcode ? <span style={styles.lmHeaderPcode}>({lmPcode})</span> : null}
            </div>
          </div>
          <p style={styles.subtitle}>
            Spatial distribution of constituent meters in permanent transaction batch{" "}
            <strong>{selectedBatchId || "No Batch Selected"}</strong>.
          </p>
        </div>

        <div style={styles.headerActions}>
          <Link to="/operations/trn-bgo" style={styles.secondaryLinkButton}>
            ← Back to TRN BGO Register
          </Link>
          {selectedBatchId ? (
            <>
              <Link
                to={`/operations/trn-bgo/allocation?batchId=${encodeURIComponent(selectedBatchId)}`}
                style={styles.secondaryLinkButton}
              >
                👥 Allocate Batch
              </Link>
              <Link
                to={`/operations/trn-bgo-rows?batchId=${encodeURIComponent(selectedBatchId)}`}
                style={styles.secondaryLinkButton}
              >
                📋 BGO Rows
              </Link>
            </>
          ) : null}
        </div>
      </div>

      {isUploadsLoading || isRowsLoading || areWardsLoading ? <LoadingIndicator>Loading batch map data…</LoadingIndicator> : null}
      {/* Map + Side Panel Container */}
      <div style={styles.mapContainer}>
        {/* Map Canvas */}
        <div style={styles.mapCanvasWrapper}>
          {googleMapsApiKey ? (
            <APIProvider apiKey={googleMapsApiKey}>
              <GoogleMap
                style={{ width: "100%", height: "100%" }}
                defaultCenter={defaultCenter}
                defaultZoom={15}
                gestureHandling="greedy"
                fullscreenControl={false}
              >
                <BatchMapCanvas
                  meters={meters}
                  wardGeometry={wardGeometry}
                  selectedMeterId={selectedMeterId}
                  onSelectMeter={setSelectedMeterId}
                />
              </GoogleMap>
            </APIProvider>
          ) : (
            <div style={styles.missingApiKey}>Google Maps API Key not configured.</div>
          )}

          {/* Toggle sidebar button */}
          <button
            type="button"
            onClick={() => setIsSidebarOpen((prev) => !prev)}
            style={styles.toggleSidebarBtn}
            title={isSidebarOpen ? "Collapse Meters List" : "Expand Meters List"}
          >
            {isSidebarOpen ? "Hide List ▶" : "◀ Show Meters List"}
          </button>
        </div>

        {/* Collapsible Meters Sidebar */}
        {isSidebarOpen ? (
          <aside style={styles.sidebar}>
            {/* Batch metadata */}
            <div style={styles.sidebarHeader}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                  Selected Batch
                </label>
                <select
                  value={selectedBatchId}
                  onChange={handleSelectBatch}
                  style={styles.sidebarSelect}
                >
                  {uploads.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.id} ({b.totalRows || 0} meters)
                    </option>
                  ))}
                </select>
              </div>

              {activeBatch ? (
                <div style={styles.sidebarMetaRow}>
                  <div>
                    <span style={styles.metaLabel}>Ward</span>
                    <strong style={styles.metaValue}>{activeBatch.wardPcode || "NAv"}</strong>
                  </div>
                  <div>
                    <span style={styles.metaLabel}>Plotted</span>
                    <strong style={styles.metaValue}>
                      {plottedCount} of {meters.length}
                    </strong>
                  </div>
                  <div>
                    <span style={styles.metaLabel}>Status</span>
                    <span
                      style={{
                        ...styles.statusBadge,
                        background: activeBatch.bgoStatus === "ALLOCATED" ? "#ecfdf5" : "#fffbeb",
                        color: activeBatch.bgoStatus === "ALLOCATED" ? "#047857" : "#b45309",
                      }}
                    >
                      {activeBatch.bgoStatus || "UNALLOCATED"}
                    </span>
                  </div>
                </div>
              ) : null}

              {/* Search filter */}
              <input
                type="text"
                placeholder="Search meter, address, ERF..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={styles.searchInput}
              />
            </div>

            {/* Meters List */}
            <div style={styles.metersList}>
              {isRowsLoading ? <LoadingIndicator>Loading constituent meters…</LoadingIndicator> : filteredMeters.length === 0 ? (
                <div style={{ padding: 16, color: "#64748b", fontSize: 13, textAlign: "center" }}>
                  No constituent meters match your search.
                </div>
              ) : (
                filteredMeters.map((m) => {
                  const isSelected = m.id === selectedMeterId;
                  const isConnected = m.meterStatus === "CONNECTED";
                  return (
                    <div
                      key={m.id}
                      onClick={() => setSelectedMeterId(m.id)}
                      style={{
                        ...styles.meterCard,
                        ...(isSelected ? styles.meterCardSelected : null),
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={styles.meterRowBadge}>#{m.rowNo}</span>
                        <strong style={{ fontFamily: "monospace", fontSize: 14, color: "#1d4ed8" }}>
                          {m.meterNo}
                        </strong>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 800,
                            padding: "2px 6px",
                            borderRadius: 4,
                            background: isConnected ? "#ecfdf5" : "#fef2f2",
                            color: isConnected ? "#047857" : "#b91c1c",
                          }}
                        >
                          {m.meterStatus}
                        </span>
                      </div>

                      <div style={{ fontSize: 12, color: "#334155", marginTop: 4, lineHeight: 1.3 }}>
                        <div>{m.premiseAddress}</div>
                        <div style={{ color: "#64748b", fontSize: 11 }}>ERF: {m.erfNo || "NAv"}</div>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginTop: 6,
                          fontSize: 11,
                          color: "#64748b",
                        }}
                      >
                        <span>{m.meterType}</span>
                        <span style={{ color: m.hasGps ? "#16a34a" : "#dc2626", fontWeight: 700 }}>
                          {m.hasGps ? "📍 On Map" : "⚠️ No GPS"}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}

const styles = {
  page: {
    padding: "24px 32px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    background: "#f8fafc",
    height: "100vh",
    boxSizing: "border-box",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 16,
    flexShrink: 0,
  },
  eyebrow: {
    margin: "0 0 4px",
    fontSize: 12,
    fontWeight: 600,
    color: "#64748b",
  },
  breadcrumbLink: {
    color: "#2563eb",
    textDecoration: "none",
  },
  titleHelpRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
    margin: "0 0 4px",
  },
  title: {
    margin: 0,
    fontSize: 22,
    fontWeight: 800,
    color: "#0f172a",
  },
  lmHeaderPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 8px",
    borderRadius: 9999,
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    fontSize: 12,
  },
  lmHeaderDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#2563eb",
  },
  lmHeaderLabel: {
    color: "#64748b",
    fontWeight: 500,
  },
  lmHeaderValue: {
    color: "#1d4ed8",
    fontWeight: 700,
  },
  lmHeaderPcode: {
    color: "#64748b",
    fontFamily: "monospace",
    fontSize: 11,
  },
  subtitle: {
    margin: 0,
    fontSize: 13,
    color: "#64748b",
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
  },
  secondaryLinkButton: {
    padding: "7px 12px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#334155",
    fontSize: 12,
    fontWeight: 600,
    textDecoration: "none",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.05)",
  },
  mapContainer: {
    flex: 1,
    display: "flex",
    borderRadius: 12,
    overflow: "hidden",
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    boxShadow: "0 2px 8px rgba(15, 23, 42, 0.08)",
    position: "relative",
    minHeight: 480,
  },
  mapCanvasWrapper: {
    flex: 1,
    position: "relative",
    height: "100%",
  },
  missingApiKey: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#64748b",
  },
  toggleSidebarBtn: {
    position: "absolute",
    top: 14,
    right: 14,
    zIndex: 10,
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#0f172a",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 2px 6px rgba(15, 23, 42, 0.15)",
  },
  sidebar: {
    width: 360,
    flexShrink: 0,
    borderLeft: "1px solid #e2e8f0",
    background: "#ffffff",
    display: "flex",
    flexDirection: "column",
    height: "100%",
  },
  sidebarHeader: {
    padding: "16px",
    borderBottom: "1px solid #e2e8f0",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    background: "#f8fafc",
  },
  sidebarSelect: {
    padding: "7px 10px",
    borderRadius: 6,
    border: "1px solid #cbd5e1",
    fontSize: 12,
    fontWeight: 600,
    color: "#0f172a",
    background: "#ffffff",
  },
  sidebarMetaRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontSize: 12,
  },
  metaLabel: {
    display: "block",
    fontSize: 10,
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
  },
  metaValue: {
    fontSize: 12,
    color: "#0f172a",
  },
  statusBadge: {
    padding: "2px 6px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 800,
  },
  searchInput: {
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid #cbd5e1",
    fontSize: 12,
  },
  metersList: {
    flex: 1,
    overflowY: "auto",
    padding: "12px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  meterCard: {
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    background: "#ffffff",
    cursor: "pointer",
    transition: "border-color 0.15s, background-color 0.15s",
  },
  meterCardSelected: {
    borderColor: "#3b82f6",
    background: "#eff6ff",
    boxShadow: "0 0 0 2px rgba(59, 130, 246, 0.2)",
  },
  meterRowBadge: {
    fontSize: 11,
    fontWeight: 800,
    color: "#64748b",
  },
};
