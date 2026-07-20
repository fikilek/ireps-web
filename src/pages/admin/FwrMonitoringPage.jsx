import { useEffect, useMemo, useRef } from "react";
import { APIProvider, Map, useMap } from "@vis.gl/react-google-maps";
import { skipToken } from "@reduxjs/toolkit/query";
import { useOutletContext } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import { useWarehouse } from "@/context/WarehouseContext";
import { useGetLmBoundaryByIdQuery } from "../../redux/mapLmsApi";
import { useGetUsersDirectoryQuery } from "../../redux/usersApi";
import { useGetAvailableServiceProvidersQuery } from "../../redux/serviceProvidersApi";

const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

const FALLBACK_CENTER = {
  lat: -26.461472069502317,
  lng: 28.50667220650696,
};

const MONITORED_ROLES = new Set(["FWR", "SPV"]);
const GLOBAL_MONITORING_ROLES = new Set(["ADM", "SPU"]);

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

function MonitoringMapFocus({ lmBoundary, selectedWard }) {
  const map = useMap();

  useEffect(() => {
    const bbox = selectedWard?.bbox || lmBoundary?.bbox;
    fitMapToBbox(map, bbox);
  }, [map, lmBoundary?.bbox, selectedWard?.bbox]);

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
  statusDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: "#94a3b8",
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
          />
          <MonitoringMapFocus
            lmBoundary={lmBoundary}
            selectedWard={selectedWard}
          />
        </Map>
      </APIProvider>
    </div>
  );
}

export default function FwrMonitoringPage() {
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

  const summaryItems = useMemo(
    () => [
      { label: "Monitored users", value: monitoredUsers.length },
      { label: "Live", value: 0 },
      { label: "Stale", value: 0 },
      { label: "Offline", value: 0 },
    ],
    [monitoredUsers.length],
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
          : `${activeWorkbaseName} · ${wardBoundaries.length} wards`;

  const usersAreLoading =
    isUsersLoading ||
    isUsersFetching ||
    isServiceProvidersLoading ||
    isServiceProvidersFetching;

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
            <p style={styles.panelDescription}>{mapDescription}</p>
          </header>

          <ActiveWorkbaseMap
            lmBoundary={lmBoundary}
            wardBoundaries={wardBoundaries}
            selectedWardPcode={monitoringWardPcode}
            selectedWard={selectedWard}
          />
        </section>

        <section style={styles.panel}>
          <header style={styles.panelHeader}>
            <div style={styles.panelTitleRow}>
              <h3 style={styles.panelTitle}>USERS ({monitoredUsers.length})</h3>
              <span style={styles.panelChevron}>⌄</span>
            </div>
          </header>

          {usersAreLoading && monitoredUsers.length === 0 ? (
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
          ) : monitoredUsers.length === 0 ? (
            <div style={styles.emptyList}>
              <div>
                <strong>No monitored users found</strong>
                <p>No FWR or SPV(SUBC) users are available in this scope.</p>
              </div>
            </div>
          ) : (
            <div style={styles.userList}>
              {monitoredUsers.map((user) => {
                const userRole = normalizeRole(user?.role);
                const roleBadgeStyle = getRoleBadgeStyle(userRole);

                return (
                  <article key={user.uid || user.id} style={styles.userRow}>
                    <span style={styles.statusDot} />

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
                        <span style={styles.gpsPending}>No GPS yet</span>
                        <span>·</span>
                        <span style={styles.userLm}>{getUserLmName(user)}</span>
                      </div>
                    </div>

                    <span style={styles.userTime}>—</span>
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
