import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  APIProvider,
  Map as GoogleMap,
  useMap,
} from "@vis.gl/react-google-maps";
import { skipToken } from "@reduxjs/toolkit/query";
import { useOutletContext } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import { useWarehouse } from "@/context/WarehouseContext";
import { useGetLmBoundaryByIdQuery } from "../../redux/mapLmsApi";
import { useGetUsersDirectoryQuery } from "../../redux/usersApi";
import { useGetAvailableServiceProvidersQuery } from "../../redux/serviceProvidersApi";
import { useGetFwrLiveLocationsQuery } from "../../redux/fwrLiveLocationsApi";

const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

const FALLBACK_CENTER = {
  lat: -26.461472069502317,
  lng: 28.50667220650696,
};

const MONITORED_ROLES = new Set(["FWR", "SPV"]);
const GLOBAL_MONITORING_ROLES = new Set(["ADM", "SPU"]);

const CLOCK_REFRESH_MS = 30 * 1000;
const USER_FOCUS_ZOOM = 17;

const EMPTY_LIVE_LOCATION_STATE = Object.freeze({
  locations: [],
  ready: false,
  streamError: null,
});

const MONITORING_VISUALS = Object.freeze({
  LIVE: {
    label: "Live",
    color: "#16a34a",
    softColor: "#dcfce7",
  },
  SIGNED_OUT: {
    label: "Signed out",
    color: "#64748b",
    softColor: "#e2e8f0",
  },
  NO_GPS: {
    label: "No GPS yet",
    color: "#94a3b8",
    softColor: "#f1f5f9",
  },
  LOADING: {
    label: "Loading GPS...",
    color: "#94a3b8",
    softColor: "#f1f5f9",
  },
  UNAVAILABLE: {
    label: "GPS unavailable",
    color: "#dc2626",
    softColor: "#fee2e2",
  },
});

function cleanId(value) {
  const result = String(value || "").trim();

  if (!result || result.toUpperCase() === "NAV") return "";
  return result;
}

function normalizeRole(value) {
  return String(value || "").trim().toUpperCase();
}

function getRoleLabel(role) {
  return normalizeRole(role) === "SPV" ? "SPV" : normalizeRole(role);
}

function useMonitoringClock() {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, CLOCK_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, []);

  return nowMs;
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;

  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function getLocationTimestampMs(locationDocument) {
  return (
    toFiniteNumber(locationDocument?.receivedAtMs) ||
    toFiniteNumber(locationDocument?.capturedAtMs)
  );
}

function hasValidGps(locationDocument) {
  const latitude = toFiniteNumber(locationDocument?.location?.latitude);
  const longitude = toFiniteNumber(locationDocument?.location?.longitude);

  return (
    latitude !== null &&
    longitude !== null &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function deriveMonitoringState({
  locationDocument,
  streamReady,
  streamError,
}) {
  if (!locationDocument) {
    if (streamError) return "UNAVAILABLE";
    if (!streamReady) return "LOADING";
    return "NO_GPS";
  }

  const backendStatus = String(
    locationDocument?.monitoringStatus || "ACTIVE",
  )
    .trim()
    .toUpperCase();

  if (backendStatus === "SIGNED_OUT") return "SIGNED_OUT";
  if (backendStatus === "ACTIVE") return "LIVE";

  return "UNAVAILABLE";
}

function getMonitoringVisual(state) {
  return MONITORING_VISUALS[state] || MONITORING_VISUALS.UNAVAILABLE;
}

function formatRelativeTime(timestampMs, nowMs) {
  const normalizedTimestamp = toFiniteNumber(timestampMs);
  if (!normalizedTimestamp) return "—";

  const elapsedMs = Math.max(0, nowMs - normalizedTimestamp);
  const elapsedSeconds = Math.floor(elapsedMs / 1000);

  if (elapsedSeconds < 10) return "now";
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;

  return new Date(normalizedTimestamp).toLocaleDateString();
}

function formatSpeed(speedMps) {
  const normalizedSpeed = toFiniteNumber(speedMps);
  if (normalizedSpeed === null) return "Speed NAv";

  const speedKmh = Math.max(0, normalizedSpeed * 3.6);
  return `${speedKmh.toFixed(speedKmh >= 10 ? 0 : 1)} km/h`;
}

function formatAccuracy(accuracyM) {
  const normalizedAccuracy = toFiniteNumber(accuracyM);
  if (normalizedAccuracy === null) return "NAv";

  return `${Math.round(normalizedAccuracy)} m`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildUserMarkerIcon({ initials, color, softColor, selected }) {
  if (!window.google?.maps) return null;

  const markerInitials = escapeHtml(
    String(initials || "?")
      .trim()
      .slice(0, 2)
      .toUpperCase(),
  );

  const cardFill = selected ? softColor : "#ffffff";
  const cardStroke = selected ? "#0f172a" : "#cbd5e1";
  const cardStrokeWidth = selected ? 2.5 : 1.25;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="82" height="56" viewBox="0 0 82 56">
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="150%" height="170%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#0f172a" flood-opacity="0.24"/>
        </filter>
      </defs>
      <g filter="url(#shadow)">
        <rect x="13" y="4" width="65" height="39" rx="14" fill="${cardFill}" stroke="${cardStroke}" stroke-width="${cardStrokeWidth}"/>
        <circle cx="22" cy="23.5" r="17" fill="${color}" stroke="#ffffff" stroke-width="2.5"/>
        <circle cx="22" cy="18.5" r="5.2" fill="#ffffff"/>
        <path d="M12.8 34.5c1.2-7.4 17.2-7.4 18.4 0" fill="#ffffff"/>
        <text x="50" y="28" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="800" fill="#0f172a">${markerInitials}</text>
        <path d="M17 42l5 10 5-10" fill="${color}" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
      </g>
    </svg>
  `;

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(82, 56),
    anchor: new window.google.maps.Point(22, 52),
  };
}

function getUserInitials(displayName) {
  const parts = String(displayName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function getUserLmName(user) {
  const raw = user?.raw || {};
  const workbases = raw?.access?.workbases || raw?.employment?.workbases || [];
  const firstWorkbase = Array.isArray(workbases) ? workbases[0] : null;
  const activeWorkbase =
    raw?.access?.activeWorkbase ||
    raw?.employment?.activeWorkbase ||
    raw?.activeWorkbase ||
    raw?.workbase ||
    firstWorkbase ||
    {};

  return (
    activeWorkbase?.lmName ||
    activeWorkbase?.name ||
    activeWorkbase?.lmPcode ||
    activeWorkbase?.pcode ||
    raw?.lmName ||
    raw?.lmPcode ||
    "LM NAv"
  );
}

function getRoleBadgeStyle(role) {
  if (normalizeRole(role) === "FWR") {
    return {
      background: "#f0fdf4",
      color: "#15803d",
      borderColor: "#86efac",
    };
  }

  return {
    background: "#eff6ff",
    color: "#1d4ed8",
    borderColor: "#93c5fd",
  };
}

function getActiveLmPcode(activeWorkbase) {
  return (
    activeWorkbase?.lmPcode ||
    activeWorkbase?.pcode ||
    activeWorkbase?.id ||
    activeWorkbase?.localMunicipalityId ||
    null
  );
}

function getActiveWorkbaseName(activeWorkbase) {
  return (
    activeWorkbase?.name ||
    activeWorkbase?.lmName ||
    activeWorkbase?.lmPcode ||
    activeWorkbase?.pcode ||
    activeWorkbase?.id ||
    "Active workbase"
  );
}

function getViewerServiceProviderId(serviceProvider, profile) {
  return cleanId(
    serviceProvider?.id ||
      serviceProvider?.serviceProviderId ||
      profile?.employment?.serviceProvider?.id ||
      profile?.employment?.serviceProviderId ||
      profile?.serviceProvider?.id ||
      profile?.serviceProviderId,
  );
}

function getWardPcode(ward) {
  return ward?.id || ward?.pcode || ward?.wardPcode || "";
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
      fillOpacity: 0.06,
      clickable: false,
      zIndex: 10,
    });

    polygon.setMap(map);
    polygonRef.current = polygon;

    return () => {
      if (polygonRef.current) {
        polygonRef.current.setMap(null);
        polygonRef.current = null;
      }
    };
  }, [map, lmPaths]);

  return null;
}

function MonitoringMapFocus({
  lmBoundary,
  selectedWard,
  selectedUserUid,
}) {
  const map = useMap();

  useEffect(() => {
    if (selectedUserUid) return;

    const bbox = selectedWard?.bbox || lmBoundary?.bbox;
    fitMapToBbox(map, bbox);
  }, [
    map,
    lmBoundary?.bbox,
    selectedUserUid,
    selectedWard?.bbox,
  ]);

  return null;
}

function WardBoundariesLayer({ wardBoundaries, selectedWardPcode }) {
  const map = useMap();
  const polygonsRef = useRef([]);

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
        const parsedGeometry = parseGeometry(ward?.geometry);
        const paths = geoJsonPolygonToGooglePaths(parsedGeometry);

        if (!paths.length) return null;

        const isSelected =
          Boolean(selectedWardPcode) && wardPcode === selectedWardPcode;

        const polygon = new window.google.maps.Polygon({
          paths,
          strokeColor: isSelected ? "#dc2626" : "#0f172a",
          strokeOpacity: isSelected ? 1 : 0.78,
          strokeWeight: isSelected ? 3 : 1.35,
          fillColor: isSelected ? "#dc2626" : "#64748b",
          fillOpacity: isSelected ? 0.12 : 0.025,
          clickable: false,
          zIndex: isSelected ? 30 : 20,
        });

        polygon.setMap(map);
        return polygon;
      })
      .filter(Boolean);

    polygonsRef.current = polygons;

    return () => {
      polygonsRef.current.forEach((polygon) => polygon.setMap(null));
      polygonsRef.current = [];
    };
  }, [map, wardBoundaries, selectedWardPcode]);

  return null;
}


function MonitoringUserFocus({
  selectedUser,
  focusRequestId,
}) {
  const map = useMap();

  const latitude = toFiniteNumber(
    selectedUser?.liveLocation?.location?.latitude,
  );
  const longitude = toFiniteNumber(
    selectedUser?.liveLocation?.location?.longitude,
  );

  useEffect(() => {
    if (!map || latitude === null || longitude === null) return;

    const position = { lat: latitude, lng: longitude };

    const applyCamera = () => {
      if (typeof map.moveCamera === "function") {
        map.moveCamera({
          center: position,
          zoom: USER_FOCUS_ZOOM,
        });
        return;
      }

      map.setCenter(position);
      map.setZoom(USER_FOCUS_ZOOM);
    };

    applyCamera();

    const animationFrameId = window.requestAnimationFrame(applyCamera);
    const timeoutId = window.setTimeout(applyCamera, 180);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.clearTimeout(timeoutId);
    };
  }, [
    focusRequestId,
    latitude,
    longitude,
    map,
    selectedUser?.uid,
  ]);

  return null;
}

function LiveLocationMarkersLayer({
  markerUsers,
  nowMs,
  selectedUserUid,
  onSelectUser,
}) {
  const map = useMap();
  const markersRef = useRef([]);
  const infoWindowRef = useRef(null);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    markersRef.current.forEach(({ marker, listener }) => {
      if (listener) window.google.maps.event.removeListener(listener);
      marker.setMap(null);
    });
    markersRef.current = [];

    if (infoWindowRef.current) {
      infoWindowRef.current.close();
      infoWindowRef.current = null;
    }

    if (!Array.isArray(markerUsers) || markerUsers.length === 0) return;

    const infoWindow = new window.google.maps.InfoWindow();
    infoWindowRef.current = infoWindow;

    const openUserInfoWindow = ({ user, marker, visual }) => {
      const lastUpdateText = formatRelativeTime(
        getLocationTimestampMs(user?.liveLocation),
        nowMs,
      );
      const speedText = formatSpeed(
        user?.liveLocation?.location?.speedMps,
      );
      const accuracyText = formatAccuracy(
        user?.liveLocation?.location?.accuracyM,
      );

      infoWindow.setContent(`
        <div style="min-width:210px;padding:2px 1px;font-family:Arial,sans-serif">
          <div style="font-size:14px;font-weight:800;color:#0f172a">
            ${escapeHtml(user?.displayName || "Field user")}
          </div>
          <div style="margin-top:3px;font-size:12px;color:#475569">
            ${escapeHtml(getRoleLabel(user?.role))} ·
            <strong style="color:${visual.color}">
              ${escapeHtml(visual.label)}
            </strong>
          </div>
          <div style="margin-top:8px;font-size:12px;color:#475569">
            Last update: ${escapeHtml(lastUpdateText)}
          </div>
          <div style="margin-top:3px;font-size:12px;color:#475569">
            Accuracy: ${escapeHtml(accuracyText)} ·
            Speed: ${escapeHtml(speedText)}
          </div>
        </div>
      `);
      infoWindow.open({
        anchor: marker,
        map,
      });
    };

    const nextMarkers = markerUsers.map((user) => {
      const latitude = toFiniteNumber(user?.liveLocation?.location?.latitude);
      const longitude = toFiniteNumber(user?.liveLocation?.location?.longitude);
      const visual = getMonitoringVisual(user?.monitoringState);
      const isSelected = cleanId(user?.uid) === cleanId(selectedUserUid);

      const marker = new window.google.maps.Marker({
        map,
        position: {
          lat: latitude,
          lng: longitude,
        },
        title: `${user?.displayName || "Field user"} · ${visual.label}`,
        zIndex: isSelected ? 100 : user?.monitoringState === "LIVE" ? 80 : 70,
        icon: buildUserMarkerIcon({
          initials: getUserInitials(user?.displayName),
          color: visual.color,
          softColor: visual.softColor,
          selected: isSelected,
        }),
      });

      const listener = marker.addListener("click", () => {
        onSelectUser?.(cleanId(user?.uid));
        openUserInfoWindow({ user, marker, visual });
      });

      return {
        uid: cleanId(user?.uid),
        user,
        visual,
        marker,
        listener,
      };
    });

    markersRef.current = nextMarkers;

    const selectedMarker = nextMarkers.find(
      (entry) => entry.uid === cleanId(selectedUserUid),
    );

    if (selectedMarker) {
      openUserInfoWindow(selectedMarker);
    }

    return () => {
      nextMarkers.forEach(({ marker, listener }) => {
        if (listener) window.google.maps.event.removeListener(listener);
        marker.setMap(null);
      });
      infoWindow.close();

      if (infoWindowRef.current === infoWindow) {
        infoWindowRef.current = null;
      }
    };
  }, [map, markerUsers, nowMs, onSelectUser, selectedUserUid]);

  return null;
}

const styles = {
  page: {
    padding: "1.5rem",
    display: "grid",
    gap: "1rem",
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "0.9rem",
  },
  summaryCard: {
    padding: "1rem",
    borderRadius: "1rem",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 4px 14px rgba(15, 23, 42, 0.05)",
  },
  summaryLabel: {
    margin: 0,
    color: "#64748b",
    fontSize: "0.78rem",
    fontWeight: 750,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  summaryValue: {
    margin: "0.35rem 0 0",
    color: "#0f172a",
    fontSize: "1.7rem",
    fontWeight: 900,
  },
  contentGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 2fr) minmax(300px, 1fr)",
    gap: "1rem",
    alignItems: "stretch",
  },
  panel: {
    minHeight: "520px",
    borderRadius: "1rem",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    overflow: "hidden",
  },
  panelHeader: {
    padding: "1rem",
    borderBottom: "1px solid #e2e8f0",
  },
  panelTitleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
  },
  panelTitle: {
    margin: 0,
    color: "#0f172a",
    fontSize: "1rem",
  },
  panelCount: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "2rem",
    minHeight: "1.6rem",
    padding: "0 0.55rem",
    borderRadius: "999px",
    background: "#e2e8f0",
    color: "#334155",
    fontSize: "0.75rem",
    fontWeight: 850,
  },
  panelDescription: {
    margin: "0.25rem 0 0",
    color: "#64748b",
    fontSize: "0.8rem",
  },
  mapShell: {
    width: "100%",
    height: "455px",
  },
  mapError: {
    minHeight: "455px",
    display: "grid",
    placeItems: "center",
    padding: "2rem",
    background: "#fff7ed",
    color: "#9a3412",
    textAlign: "center",
  },
  mapErrorText: {
    margin: "0.4rem 0 0",
    color: "#c2410c",
    lineHeight: 1.5,
  },
  userList: {
    height: "455px",
    overflowY: "auto",
    background: "#ffffff",
  },
  userRow: {
    display: "grid",
    gridTemplateColumns: "12px 42px minmax(0, 1fr) auto",
    alignItems: "center",
    gap: "0.65rem",
    minHeight: "66px",
    padding: "0.55rem 0.85rem",
    borderBottom: "1px solid #e2e8f0",
  },
  userRowInteractive: {
    cursor: "pointer",
    transition: "background-color 140ms ease, box-shadow 140ms ease",
  },
  userRowSelected: {
    background: "#eff6ff",
    boxShadow: "inset 4px 0 0 #2563eb",
  },
  statusDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: "#94a3b8",
  },
  statusText: {
    flexShrink: 0,
    fontWeight: 850,
  },
  speedText: {
    flexShrink: 0,
    color: "#475569",
    fontWeight: 700,
  },
  userAvatar: {
    width: "38px",
    height: "38px",
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    background: "#f8fafc",
    border: "2px solid #cbd5e1",
    color: "#64748b",
    fontSize: "0.72rem",
    fontWeight: 900,
  },
  userDetails: {
    minWidth: 0,
  },
  userNameRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.45rem",
    minWidth: 0,
  },
  userName: {
    margin: 0,
    overflow: "hidden",
    color: "#0f172a",
    fontSize: "0.84rem",
    fontWeight: 850,
    lineHeight: 1.25,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  roleBadge: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    minHeight: "1.15rem",
    padding: "0 0.34rem",
    borderRadius: "0.25rem",
    border: "1px solid",
    fontSize: "0.62rem",
    fontWeight: 900,
    lineHeight: 1,
  },
  userMetaRow: {
    marginTop: "0.28rem",
    display: "flex",
    alignItems: "center",
    gap: "0.45rem",
    minWidth: 0,
    color: "#64748b",
    fontSize: "0.72rem",
  },
  gpsPending: {
    flexShrink: 0,
    color: "#64748b",
    fontWeight: 750,
  },
  userLm: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  userTime: {
    alignSelf: "start",
    paddingTop: "0.1rem",
    color: "#64748b",
    fontSize: "0.72rem",
    fontWeight: 700,
  },
  panelChevron: {
    color: "#334155",
    fontSize: "1rem",
    fontWeight: 900,
  },
  emptyList: {
    minHeight: "455px",
    display: "grid",
    placeItems: "center",
    padding: "2rem",
    color: "#64748b",
    textAlign: "center",
  },
};

function ActiveWorkbaseMap({
  lmBoundary,
  wardBoundaries,
  selectedWardPcode,
  selectedWard,
  markerUsers,
  nowMs,
  selectedUser,
  selectedUserUid,
  focusRequestId,
  onSelectUser,
}) {
  if (!googleMapsApiKey) {
    return (
      <div style={styles.mapError}>
        <div>
          <strong>Google Maps key missing</strong>
          <p style={styles.mapErrorText}>
            Add VITE_GOOGLE_MAPS_API_KEY to .env.local, then restart Vite.
          </p>
        </div>
      </div>
    );
  }

  const mapCenter = lmBoundary?.centroid
    ? {
        lat: lmBoundary.centroid.lat,
        lng: lmBoundary.centroid.lng,
      }
    : FALLBACK_CENTER;

  return (
    <div style={styles.mapShell}>
      <APIProvider apiKey={googleMapsApiKey}>
        <GoogleMap
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
          />
          <MonitoringMapFocus
            lmBoundary={lmBoundary}
            selectedWard={selectedWard}
            selectedUserUid={selectedUserUid}
          />
          <MonitoringUserFocus
            selectedUser={selectedUser}
            focusRequestId={focusRequestId}
          />
          <LiveLocationMarkersLayer
            markerUsers={markerUsers}
            nowMs={nowMs}
            selectedUserUid={selectedUserUid}
            onSelectUser={onSelectUser}
          />
        </GoogleMap>
      </APIProvider>
    </div>
  );
}

export default function FwrMonitoringPage() {
  const nowMs = useMonitoringClock();
  const [selectedUserUid, setSelectedUserUid] = useState("");
  const [focusRequestId, setFocusRequestId] = useState(0);
  const { activeWorkbase, profile, role, serviceProvider } = useAuth();
  const { available, scope } = useWarehouse();
  const { monitoringWardPcode = "" } = useOutletContext() || {};

  const viewerRole = normalizeRole(role);
  const viewerServiceProviderId = getViewerServiceProviderId(
    serviceProvider,
    profile,
  );
  const activeLmPcode = getActiveLmPcode(activeWorkbase);
  const activeWorkbaseName = getActiveWorkbaseName(activeWorkbase);

  const warehouseMatchesActiveWorkbase =
    !scope?.lmPcode || scope.lmPcode === activeLmPcode;

  const wardBoundaries = useMemo(() => {
    if (!warehouseMatchesActiveWorkbase) return [];
    return available?.wards || [];
  }, [available?.wards, warehouseMatchesActiveWorkbase]);

  const selectedWard = useMemo(() => {
    if (!monitoringWardPcode) return null;

    return (
      wardBoundaries.find(
        (ward) => getWardPcode(ward) === monitoringWardPcode,
      ) || null
    );
  }, [monitoringWardPcode, wardBoundaries]);

  const {
    data: lmBoundary,
    isLoading: isLmLoading,
    isFetching: isLmFetching,
    error: lmError,
  } = useGetLmBoundaryByIdQuery(activeLmPcode || skipToken);

  const {
    data: users = [],
    isLoading: isUsersLoading,
    isFetching: isUsersFetching,
    isError: isUsersError,
  } = useGetUsersDirectoryQuery({ limit: 1000 });

  const {
    data: serviceProviders = [],
    isLoading: isServiceProvidersLoading,
    isFetching: isServiceProvidersFetching,
  } = useGetAvailableServiceProvidersQuery({ limit: 500 });

  const {
    data: liveLocationState = EMPTY_LIVE_LOCATION_STATE,
  } = useGetFwrLiveLocationsQuery({ limit: 5000 });

  const {
    locations: liveLocations = [],
    ready: liveLocationsReady = false,
    streamError: liveLocationsStreamError = null,
  } = liveLocationState;

  const childServiceProviderIds = useMemo(() => {
    if (viewerRole !== "MNG" || !viewerServiceProviderId) return new Set();

    return new Set(
      serviceProviders
        .filter(
          (provider) =>
            cleanId(provider?.parentServiceProviderId) ===
            viewerServiceProviderId,
        )
        .map((provider) => cleanId(provider?.id))
        .filter(Boolean),
    );
  }, [serviceProviders, viewerRole, viewerServiceProviderId]);

  const visibleUsers = useMemo(() => {
    if (GLOBAL_MONITORING_ROLES.has(viewerRole)) {
      return users;
    }

    if (!viewerServiceProviderId) {
      return [];
    }

    if (viewerRole === "MNG") {
      return users.filter((user) => {
        const userServiceProviderId = cleanId(user?.serviceProviderId);

        return (
          userServiceProviderId === viewerServiceProviderId ||
          childServiceProviderIds.has(userServiceProviderId)
        );
      });
    }

    if (viewerRole === "SPV") {
      return users.filter(
        (user) =>
          cleanId(user?.serviceProviderId) === viewerServiceProviderId,
      );
    }

    return [];
  }, [
    childServiceProviderIds,
    users,
    viewerRole,
    viewerServiceProviderId,
  ]);

  const monitoredUsers = useMemo(
    () =>
      visibleUsers.filter((user) =>
        MONITORED_ROLES.has(normalizeRole(user?.role)),
      ),
    [visibleUsers],
  );

  const liveLocationByUid = useMemo(
    () =>
      new Map(
        liveLocations
          .map((locationDocument) => [
            cleanId(locationDocument?.uid),
            locationDocument,
          ])
          .filter(([uid]) => Boolean(uid)),
      ),
    [liveLocations],
  );

  const enrichedUsers = useMemo(
    () =>
      monitoredUsers.map((user) => {
        const uid = cleanId(user?.uid || user?.id);
        const liveLocation = liveLocationByUid.get(uid) || null;
        const monitoringState = deriveMonitoringState({
          locationDocument: liveLocation,
          streamReady: liveLocationsReady,
          streamError: liveLocationsStreamError,
        });

        return {
          ...user,
          uid,
          liveLocation,
          monitoringState,
        };
      }),
    [
      liveLocationByUid,
      liveLocationsReady,
      liveLocationsStreamError,
      monitoredUsers,
    ],
  );

  const markerUsers = useMemo(
    () =>
      enrichedUsers.filter(
        (user) =>
          Boolean(user?.liveLocation) && hasValidGps(user?.liveLocation),
      ),
    [enrichedUsers],
  );

  const selectedUser = useMemo(
    () =>
      enrichedUsers.find(
        (user) => cleanId(user?.uid) === cleanId(selectedUserUid),
      ) || null,
    [enrichedUsers, selectedUserUid],
  );

  const selectAndFocusUser = useCallback((uid) => {
    const cleanUid = cleanId(uid);
    if (!cleanUid) return;

    setSelectedUserUid(cleanUid);
    setFocusRequestId((current) => current + 1);
  }, []);

  useEffect(() => {
    // A ward-selector change takes camera priority back from a selected user.
    setSelectedUserUid("");
  }, [monitoringWardPcode]);

  useEffect(() => {
    if (!selectedUserUid) return;
    if (selectedUser && hasValidGps(selectedUser?.liveLocation)) return;

    setSelectedUserUid("");
  }, [selectedUser, selectedUserUid]);

  const monitoringCounts = useMemo(
    () =>
      enrichedUsers.reduce(
        (counts, user) => {
          if (user.monitoringState === "LIVE") counts.live += 1;
          if (user.monitoringState === "SIGNED_OUT") {
            counts.signedOut += 1;
          }
          if (user.monitoringState === "NO_GPS") counts.noGps += 1;

          return counts;
        },
        {
          live: 0,
          signedOut: 0,
          noGps: 0,
        },
      ),
    [enrichedUsers],
  );

  const summaryItems = useMemo(
    () => [
      { label: "Monitored users", value: enrichedUsers.length },
      { label: "Live", value: monitoringCounts.live },
      { label: "Signed out", value: monitoringCounts.signedOut },
      { label: "No GPS yet", value: monitoringCounts.noGps },
    ],
    [enrichedUsers.length, monitoringCounts],
  );

  const mapDescription = !activeLmPcode
    ? "No active workbase is available for this user."
    : lmError
      ? `The ${activeWorkbaseName} boundary could not be loaded.`
      : isLmLoading || isLmFetching
        ? `Loading ${activeWorkbaseName} boundary and wards...`
        : selectedWard
          ? `${activeWorkbaseName} · ${
              selectedWard?.name || getWardPcode(selectedWard)
            } selected`
          : `${activeWorkbaseName} · ${wardBoundaries.length} wards · ${markerUsers.length} GPS markers`;

  const usersAreLoading =
    isUsersLoading ||
    isUsersFetching ||
    isServiceProvidersLoading ||
    isServiceProvidersFetching;

  const monitoringDescription = liveLocationsStreamError
    ? `${mapDescription} · GPS stream unavailable`
    : mapDescription;

  return (
    <section style={styles.page}>
      <div style={styles.summaryGrid}>
        {summaryItems.map((item) => (
          <article key={item.label} style={styles.summaryCard}>
            <p style={styles.summaryLabel}>{item.label}</p>
            <p style={styles.summaryValue}>{item.value}</p>
          </article>
        ))}
      </div>

      <div style={styles.contentGrid}>
        <section style={styles.panel}>
          <header style={styles.panelHeader}>
            <h3 style={styles.panelTitle}>Live field map</h3>
            <p style={styles.panelDescription}>{monitoringDescription}</p>
          </header>

          <ActiveWorkbaseMap
            lmBoundary={lmBoundary}
            wardBoundaries={wardBoundaries}
            selectedWardPcode={monitoringWardPcode}
            selectedWard={selectedWard}
            markerUsers={markerUsers}
            nowMs={nowMs}
            selectedUser={selectedUser}
            selectedUserUid={selectedUserUid}
            focusRequestId={focusRequestId}
            onSelectUser={selectAndFocusUser}
          />
        </section>

        <section style={styles.panel}>
          <header style={styles.panelHeader}>
            <div style={styles.panelTitleRow}>
              <h3 style={styles.panelTitle}>USERS ({enrichedUsers.length})</h3>
              <span style={styles.panelChevron}>⌄</span>
            </div>
          </header>

          {usersAreLoading && enrichedUsers.length === 0 ? (
            <div style={styles.emptyList}>
              <div>
                <strong>Loading users...</strong>
                <p>Reading the authorised field-user directory.</p>
              </div>
            </div>
          ) : isUsersError ? (
            <div style={styles.emptyList}>
              <div>
                <strong>Users could not be loaded</strong>
                <p>Check the browser console and Firestore access rules.</p>
              </div>
            </div>
          ) : enrichedUsers.length === 0 ? (
            <div style={styles.emptyList}>
              <div>
                <strong>No monitored users found</strong>
                <p>No FWR or SPV(SUBC) users are available in this scope.</p>
              </div>
            </div>
          ) : (
            <div style={styles.userList}>
              {enrichedUsers.map((user) => {
                const userRole = normalizeRole(user?.role);
                const roleBadgeStyle = getRoleBadgeStyle(userRole);
                const monitoringVisual = getMonitoringVisual(
                  user?.monitoringState,
                );
                const lastUpdateMs = getLocationTimestampMs(
                  user?.liveLocation,
                );
                const lastUpdateText = formatRelativeTime(lastUpdateMs, nowMs);
                const speedText = formatSpeed(
                  user?.liveLocation?.location?.speedMps,
                );
                const hasLocation = Boolean(user?.liveLocation);
                const canFocusUser = hasValidGps(user?.liveLocation);
                const isSelected =
                  cleanId(user?.uid) === cleanId(selectedUserUid);

                const focusUser = () => {
                  if (!canFocusUser) return;
                  selectAndFocusUser(user?.uid);
                };

                return (
                  <article
                    key={user.uid || user.id}
                    style={{
                      ...styles.userRow,
                      ...(canFocusUser ? styles.userRowInteractive : {}),
                      ...(isSelected ? styles.userRowSelected : {}),
                    }}
                    onClick={canFocusUser ? focusUser : undefined}
                    onKeyDown={
                      canFocusUser
                        ? (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              focusUser();
                            }
                          }
                        : undefined
                    }
                    role={canFocusUser ? "button" : undefined}
                    tabIndex={canFocusUser ? 0 : undefined}
                    title={
                      canFocusUser
                        ? `Zoom to ${user?.displayName || "field user"}`
                        : "No GPS location available"
                    }
                  >
                    <span
                      style={{
                        ...styles.statusDot,
                        background: monitoringVisual.color,
                        boxShadow:
                          user?.monitoringState === "LIVE"
                            ? `0 0 0 3px ${monitoringVisual.softColor}`
                            : "none",
                      }}
                    />

                    <div style={styles.userAvatar}>
                      {getUserInitials(user.displayName)}
                    </div>

                    <div style={styles.userDetails}>
                      <div style={styles.userNameRow}>
                        <h4 style={styles.userName}>{user.displayName}</h4>
                        <span
                          style={{
                            ...styles.roleBadge,
                            ...roleBadgeStyle,
                          }}
                        >
                          {getRoleLabel(userRole)}
                        </span>
                      </div>

                      <div style={styles.userMetaRow}>
                        <span
                          style={{
                            ...styles.statusText,
                            color: monitoringVisual.color,
                          }}
                        >
                          {monitoringVisual.label}
                        </span>

                        {hasLocation ? (
                          <>
                            <span>·</span>
                            <span style={styles.speedText}>{speedText}</span>
                          </>
                        ) : null}

                        <span>·</span>
                        <span style={styles.userLm}>{getUserLmName(user)}</span>
                      </div>
                    </div>

                    <span style={styles.userTime}>
                      {hasLocation ? lastUpdateText : "—"}
                    </span>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
