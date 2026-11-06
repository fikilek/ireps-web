/* eslint-disable no-unused-vars -- JSX component tags are consumed by the JSX transform. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { APIProvider, Map, useMap } from "@vis.gl/react-google-maps";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";
import { useGetErfsByWardQuery } from "../../redux/wardErfsApi";
import {
  useGetGeoFencesByWardQuery,
  useCreateGeoFenceMutation,
} from "../../redux/geofencesApi";
import { useCreateBgoMutation } from "../../redux/bgoApi";

import { polygonFromPoints, strictlyInside } from "../../../functions/geofences/sales-batch-geometry.js";
import {
  composeGeofenceName,
  findDuplicateGeofence,
  duplicateGeofenceNameMessage,
  geofenceNamePart,
  wardNumberFromPcode,
} from "../../../functions/geofences/geofence-name.js";

const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const FALLBACK_CENTER = { lat: -28.168, lng: 30.236 };
const BGO_ERF_LIMIT = 30;

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

  const name = String(
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

function parseGeometry(geometry) {
  if (!geometry) return null;
  if (typeof geometry === "string") {
    try {
      return JSON.parse(geometry);
    } catch {
      return null;
    }
  }
  return geometry;
}

function geoJsonPolygonToGooglePaths(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    return (geometry.coordinates || []).map((ring) =>
      ring.map(([lng, lat]) => ({ lat, lng })),
    );
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates || []).flatMap((polygon) =>
      polygon.map((ring) => ring.map(([lng, lat]) => ({ lat, lng }))),
    );
  }
  return [];
}

function fitMapToBounds(map, paths = []) {
  if (!map || !window.google?.maps || paths.length === 0) return;
  const bounds = new window.google.maps.LatLngBounds();
  let count = 0;
  paths.forEach((ring) => {
    ring.forEach((pt) => {
      if (Number.isFinite(pt?.lat) && Number.isFinite(pt?.lng)) {
        bounds.extend(pt);
        count++;
      }
    });
  });
  if (count > 0) map.fitBounds(bounds, 36);
}

// Inner map child managing Google Maps drawing, layers, and viewport
function MdBgoMapInner({
  wardGeometry,
  erfs = [],
  geofences = [],
  selectedGeofenceId = "",
  showErfsLayer = true,
  showGeofencesLayer = true,
  showWardLayer = true,
  drawingPoints = [],
  isDrawing = false,
  onMapClick,
}) {
  const map = useMap();
  const wardPolygonRef = useRef(null);
  const erfPolygonsRef = useRef([]);
  const geofencePolygonsRef = useRef([]);
  const draftPolylineRef = useRef(null);
  const draftPolygonRef = useRef(null);
  const draftMarkersRef = useRef([]);

  // Ward boundary
  useEffect(() => {
    if (!map || !window.google?.maps) return;
    if (wardPolygonRef.current) wardPolygonRef.current.setMap(null);

    if (showWardLayer && wardGeometry) {
      const paths = geoJsonPolygonToGooglePaths(parseGeometry(wardGeometry));
      if (paths.length > 0) {
        wardPolygonRef.current = new window.google.maps.Polygon({
          paths,
          strokeColor: "#2563eb",
          strokeOpacity: 0.9,
          strokeWeight: 2.5,
          fillColor: "#3b82f6",
          fillOpacity: 0.04,
          clickable: false,
          zIndex: 10,
        });
        wardPolygonRef.current.setMap(map);
      }
    }

    return () => {
      if (wardPolygonRef.current) wardPolygonRef.current.setMap(null);
    };
  }, [map, wardGeometry, showWardLayer]);

  // ERFs Layer
  useEffect(() => {
    if (!map || !window.google?.maps) return;
    erfPolygonsRef.current.forEach((poly) => poly.setMap(null));
    erfPolygonsRef.current = [];

    if (showErfsLayer && erfs.length > 0) {
      const polys = [];
      erfs.forEach((erf) => {
        const geom = parseGeometry(erf.geometry);
        const paths = geoJsonPolygonToGooglePaths(geom);
        if (paths.length > 0) {
          const poly = new window.google.maps.Polygon({
            paths,
            strokeColor: "#94a3b8",
            strokeOpacity: 0.7,
            strokeWeight: 1,
            fillColor: "#cbd5e1",
            fillOpacity: 0.1,
            clickable: false,
            zIndex: 20,
          });
          poly.setMap(map);
          polys.push(poly);
        }
      });
      erfPolygonsRef.current = polys;
    }

    return () => {
      erfPolygonsRef.current.forEach((poly) => poly.setMap(null));
      erfPolygonsRef.current = [];
    };
  }, [map, erfs, showErfsLayer]);

  // Existing Geofences
  useEffect(() => {
    if (!map || !window.google?.maps) return;
    geofencePolygonsRef.current.forEach((poly) => poly.setMap(null));
    geofencePolygonsRef.current = [];

    if (showGeofencesLayer && geofences.length > 0) {
      const polys = [];
      geofences.forEach((gf) => {
        const geom = parseGeometry(gf.geometry);
        const paths = geoJsonPolygonToGooglePaths(geom);
        if (paths.length > 0) {
          const isSelected = gf.id === selectedGeofenceId;
          const poly = new window.google.maps.Polygon({
            paths,
            strokeColor: isSelected ? "#dc2626" : "#7c3aed",
            strokeOpacity: 0.9,
            strokeWeight: isSelected ? 3 : 2,
            fillColor: isSelected ? "#ef4444" : "#8b5cf6",
            fillOpacity: isSelected ? 0.25 : 0.14,
            clickable: true,
            zIndex: isSelected ? 70 : 40,
          });
          poly.setMap(map);
          polys.push(poly);
        }
      });
      geofencePolygonsRef.current = polys;
    }

    return () => {
      geofencePolygonsRef.current.forEach((poly) => poly.setMap(null));
      geofencePolygonsRef.current = [];
    };
  }, [map, geofences, selectedGeofenceId, showGeofencesLayer]);

  // Active Draft Polygon / Points
  useEffect(() => {
    if (!map || !window.google?.maps) return;
    if (draftPolylineRef.current) draftPolylineRef.current.setMap(null);
    if (draftPolygonRef.current) draftPolygonRef.current.setMap(null);
    draftMarkersRef.current.forEach((m) => m.setMap(null));
    draftMarkersRef.current = [];

    if (drawingPoints.length > 0) {
      // Points markers
      const markers = drawingPoints.map((pt, index) => {
        return new window.google.maps.Marker({
          position: pt,
          map,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: index === 0 ? 6 : 4,
            fillColor: index === 0 ? "#16a34a" : "#2563eb",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
          zIndex: 100,
        });
      });
      draftMarkersRef.current = markers;

      if (drawingPoints.length >= 3) {
        draftPolygonRef.current = new window.google.maps.Polygon({
          paths: drawingPoints,
          strokeColor: "#2563eb",
          strokeOpacity: 1,
          strokeWeight: 2,
          fillColor: "#3b82f6",
          fillOpacity: 0.2,
          zIndex: 90,
          clickable: false,
        });
        draftPolygonRef.current.setMap(map);
      } else {
        draftPolylineRef.current = new window.google.maps.Polyline({
          path: drawingPoints,
          strokeColor: "#2563eb",
          strokeOpacity: 1,
          strokeWeight: 2,
          zIndex: 90,
          clickable: false,
        });
        draftPolylineRef.current.setMap(map);
      }
    }

    return () => {
      if (draftPolylineRef.current) draftPolylineRef.current.setMap(null);
      if (draftPolygonRef.current) draftPolygonRef.current.setMap(null);
      draftMarkersRef.current.forEach((m) => m.setMap(null));
      draftMarkersRef.current = [];
    };
  }, [map, drawingPoints]);

  // Click listener
  useEffect(() => {
    if (!map) return;
    const listener = map.addListener("click", (event) => {
      if (isDrawing && event.latLng) {
        onMapClick({
          lat: event.latLng.lat(),
          lng: event.latLng.lng(),
        });
      }
    });

    return () => {
      google.maps.event.removeListener(listener);
    };
  }, [map, isDrawing, onMapClick]);

  return null;
}

export default function MdBgoPlanningPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const auth = useAuth();
  const { role } = auth || {};
  const { geoState } = useGeo();

  const { lmPcode, lmName } = useMemo(
    () => resolveWorkbase(auth, geoState),
    [auth, geoState],
  );

  // Wards
  const { data: wards = [], isLoading: isWardsLoading } = useGetRegistryWardsByLmQuery(
    lmPcode,
    { skip: !lmPcode },
  );

  const [selectedWardPcode, setSelectedWardPcode] = useState(
    searchParams.get("wardPcode") || "",
  );

  useEffect(() => {
    if (!selectedWardPcode && wards.length > 0) {
      setSelectedWardPcode(wards[0].pcode || wards[0].id || "");
    }
  }, [wards, selectedWardPcode]);

  const activeWard = useMemo(() => {
    return wards.find(
      (w) => (w.pcode || w.id || w.wardPcode) === selectedWardPcode,
    );
  }, [wards, selectedWardPcode]);

  const wardNumber = useMemo(() => {
    return wardNumberFromPcode(selectedWardPcode);
  }, [selectedWardPcode]);

  // ERFs for selected ward
  const { data: wardErfs = [], isLoading: isErfsLoading } = useGetErfsByWardQuery(
    { lmPcode, wardPcode: selectedWardPcode },
    { skip: !selectedWardPcode },
  );

  // Existing Geofences
  const { data: wardGeofences = [] } = useGetGeoFencesByWardQuery(
    selectedWardPcode,
    { skip: !selectedWardPcode },
  );

  const [selectedGeofenceId, setSelectedGeofenceId] = useState(
    searchParams.get("focusGeofenceId") || "",
  );

  // Layer toggles
  const [showErfsLayer, setShowErfsLayer] = useState(true);
  const [showGeofencesLayer, setShowGeofencesLayer] = useState(true);
  const [showWardLayer, setShowWardLayer] = useState(true);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingPoints, setDrawingPoints] = useState([]);

  // Mutations
  const [createGeoFence, { isLoading: isSavingGeofence }] = useCreateGeoFenceMutation();
  const [createBgo, { isLoading: isCreatingBgo }] = useCreateBgoMutation();

  // Dialog & creation states
  const [isNameModalOpen, setIsNameModalOpen] = useState(false);
  const [geofenceNameInput, setGeofenceNameInput] = useState("");
  const [geofenceDescInput, setGeofenceDescInput] = useState("");
  const [formError, setFormError] = useState("");
  const [createdResult, setCreatedResult] = useState(null);

  const handleMapClick = useCallback((point) => {
    setDrawingPoints((pts) => [...pts, point]);
  }, []);

  const handleUndoPoint = () => {
    setDrawingPoints((pts) => pts.slice(0, -1));
  };

  const handleClearDrawing = () => {
    setDrawingPoints([]);
    setIsDrawing(false);
    setIsNameModalOpen(false);
    setFormError("");
  };

  // Evaluate ERFs inside drawn polygon
  const evaluatedGeometry = useMemo(() => {
    if (drawingPoints.length < 3) return null;
    try {
      return polygonFromPoints(drawingPoints);
    } catch {
      return null;
    }
  }, [drawingPoints]);

  const erfsInside = useMemo(() => {
    if (!evaluatedGeometry || drawingPoints.length < 3) return [];
    return wardErfs.filter((erf) => {
      const lat = erf.centroid?.latitude ?? erf.centroid?.lat;
      const lng = erf.centroid?.longitude ?? erf.centroid?.lng;
      if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return false;
      try {
        return strictlyInside({ latitude: Number(lat), longitude: Number(lng) }, evaluatedGeometry);
      } catch {
        return false;
      }
    });
  }, [evaluatedGeometry, drawingPoints, wardErfs]);

  const isOverLimit = erfsInside.length > BGO_ERF_LIMIT;
  const canSave = drawingPoints.length >= 3 && evaluatedGeometry && erfsInside.length >= 1 && !isOverLimit;

  // Counter text
  const counterText = useMemo(() => {
    if (drawingPoints.length < 3) {
      return "Click at least 3 points on the map to outline a geofence.";
    }
    if (!evaluatedGeometry) {
      return "The shape crosses itself. Undo the last point or restart.";
    }
    const count = erfsInside.length;
    if (count > BGO_ERF_LIMIT) {
      return `Inside: ${count} ERFs. Too many: ${count} — the limit is ${BGO_ERF_LIMIT}.`;
    }
    if (count === 0) {
      return "Inside: 0 ERFs · Outline at least 1 ERF.";
    }
    return `Inside: ${count} ERF${count === 1 ? "" : "s"} · Ready to save geofence`;
  }, [drawingPoints.length, evaluatedGeometry, erfsInside.length]);

  const counterTone = useMemo(() => {
    if (drawingPoints.length < 3 || erfsInside.length === 0) return "#475569";
    if (isOverLimit || !evaluatedGeometry) return "#dc2626";
    return "#166534";
  }, [drawingPoints.length, erfsInside.length, isOverLimit, evaluatedGeometry]);

  const fullStandardName = useMemo(() => {
    return composeGeofenceName(wardNumber, geofenceNamePart(geofenceNameInput));
  }, [wardNumber, geofenceNameInput]);

  // Stage A: Save Geofence Only
  const handleSaveGeofenceOnly = async () => {
    if (!canSave) return;
    setFormError("");

    const namePart = geofenceNamePart(geofenceNameInput);
    if (!namePart) {
      setFormError(`Type a name after "Gf W${wardNumber}".`);
      return;
    }

    const duplicate = findDuplicateGeofence(fullStandardName, wardGeofences);
    if (duplicate) {
      setFormError(duplicateGeofenceNameMessage(duplicate));
      return;
    }

    try {
      const fencePayload = {
        name: fullStandardName,
        description: geofenceDescInput.trim() || "No Description Given",
        lmPcode,
        wardPcode: selectedWardPcode,
        geometry: evaluatedGeometry,
      };

      const result = await createGeoFence(fencePayload).unwrap();
      handleClearDrawing();
      setCreatedResult({
        type: "GEOFENCE_ONLY",
        geofenceName: fullStandardName,
        geofenceId: result?.id || result?.geoFenceId || "",
      });
    } catch (err) {
      setFormError(err?.data?.message || err?.message || "Could not save geofence.");
    }
  };

  // Stage B: Save Geofence & Create Batch
  const handleSaveAndCreateBatch = async () => {
    if (!canSave) return;
    setFormError("");

    const namePart = geofenceNamePart(geofenceNameInput);
    if (!namePart) {
      setFormError(`Type a name after "Gf W${wardNumber}".`);
      return;
    }

    const duplicate = findDuplicateGeofence(fullStandardName, wardGeofences);
    if (duplicate) {
      setFormError(duplicateGeofenceNameMessage(duplicate));
      return;
    }

    try {
      // 1. Save Geofence
      const fencePayload = {
        name: fullStandardName,
        description: geofenceDescInput.trim() || "No Description Given",
        lmPcode,
        wardPcode: selectedWardPcode,
        geometry: evaluatedGeometry,
      };
      const fenceResult = await createGeoFence(fencePayload).unwrap();
      const geofenceId = fenceResult?.id || fenceResult?.geoFenceId || "";

      // 2. Create BGO Batch
      const erfRefs = erfsInside.map((erf) => ({
        id: erf.id || erf.erfId,
        erfNo: erf.erfNo || erf.parcelNo || erf.id || "NAv",
        erfType: erf.type || erf.erfType || "FORMAL",
      }));

      const batchPayload = {
        batchMode: "BMD",
        sourceModule: "BULK_METER_DISCOVERY",
        trnType: "METER_DISCOVERY",
        operationType: "METER_DISCOVERY",
        operationCode: "MDIS",
        scope: {
          lmPcode,
          lmName,
          wardPcode: selectedWardPcode,
          wardName: activeWard?.name || activeWard?.wardName || `Ward ${wardNumber}`,
        },
        geofenceRef: {
          id: geofenceId,
          name: fullStandardName,
        },
        worklist: {
          type: "ERF_LIST",
          erfRefs,
        },
        summary: {
          erfCount: erfRefs.length,
          totalRows: erfRefs.length,
          premiseCount: 0,
          meterCount: 0,
        },
      };

      const batchResult = await createBgo(batchPayload).unwrap();
      const batchId = batchResult?.bgoBatchId || batchResult?.batchId || batchResult?.id || "";

      handleClearDrawing();
      setCreatedResult({
        type: "BATCH_CREATED",
        batchId,
        geofenceName: fullStandardName,
        geofenceId,
        erfCount: erfRefs.length,
      });
    } catch (err) {
      setFormError(err?.data?.message || err?.message || "Could not create batch.");
    }
  };

  return (
    <section style={styles.page}>
      <div style={styles.header}>
        <div>
          <div style={styles.backLinkWrap}>
            <Link to="/operations/bgo" style={styles.backLink}>
              ← Back to MD BGO Register
            </Link>
          </div>
          <p style={styles.eyebrow}>Operations / MD BGO Planning Map</p>
          <h2 style={styles.title}>MD BGO Ward Planning Map</h2>
          <p style={styles.subtitle}>
            Select a ward, draw a geofence with up to 30 ERFs, and create an MD BGO batch.
          </p>
        </div>
      </div>

      {/* Top Map Controls Row */}
      <div style={styles.controlsBar}>
        <div style={styles.controlsGroup}>
          <label style={styles.controlLabel}>
            Geofence
            <select
              value={selectedGeofenceId}
              onChange={(e) => setSelectedGeofenceId(e.target.value)}
              style={styles.select}
            >
              <option value="">All geofences</option>
              {wardGeofences.map((gf) => (
                <option key={gf.id} value={gf.id}>
                  {gf.name}
                </option>
              ))}
            </select>
          </label>

          <label style={styles.controlLabel}>
            Ward
            <select
              value={selectedWardPcode}
              onChange={(e) => {
                setSelectedWardPcode(e.target.value);
                setSelectedGeofenceId("");
                handleClearDrawing();
              }}
              style={styles.select}
            >
              {wards.map((w) => {
                const pcode = w.pcode || w.id || w.wardPcode;
                const no = wardNumberFromPcode(pcode);
                return (
                  <option key={pcode} value={pcode}>
                    Ward {no} ({pcode})
                  </option>
                );
              })}
            </select>
          </label>

          <div style={styles.erfCountBadge}>
            {wardErfs.length} ERFs
          </div>
        </div>

        <div style={styles.controlsGroup}>
          <button
            type="button"
            style={isDrawing ? styles.drawingActiveButton : styles.drawFenceButton}
            onClick={() => {
              if (isDrawing) {
                handleClearDrawing();
              } else {
                setDrawingPoints([]);
                setIsDrawing(true);
              }
            }}
          >
            {isDrawing ? "Cancel Drawing" : "Draw batch geofence"}
          </button>
        </div>
      </div>

      {/* Drawing Toolbar Indicator */}
      {isDrawing ? (
        <div style={styles.drawingStatusBar}>
          <div style={{ ...styles.drawingCountText, color: counterTone }}>
            <strong>{counterText}</strong>
          </div>

          <div style={styles.drawingActions}>
            <button
              type="button"
              style={styles.drawingButton}
              onClick={handleUndoPoint}
              disabled={drawingPoints.length === 0}
            >
              Undo Point
            </button>
            <button
              type="button"
              style={styles.drawingButton}
              onClick={() => setDrawingPoints([])}
              disabled={drawingPoints.length === 0}
            >
              Restart
            </button>
            <button
              type="button"
              style={{
                ...styles.drawingSaveButton,
                ...(!canSave ? styles.disabledButton : null),
              }}
              disabled={!canSave}
              onClick={() => {
                setGeofenceNameInput("");
                setGeofenceDescInput("");
                setFormError("");
                setIsNameModalOpen(true);
              }}
            >
              Save Geofence ({erfsInside.length})
            </button>
          </div>
        </div>
      ) : null}

      {/* Full-Width Auto-Opening Map Viewport */}
      <div style={styles.mapContainer}>
        {googleMapsApiKey ? (
          <APIProvider apiKey={googleMapsApiKey}>
            <Map
              defaultCenter={FALLBACK_CENTER}
              defaultZoom={14}
              style={styles.mapElement}
              gestureHandling="greedy"
              disableDefaultUI={false}
              mapTypeId="roadmap"
            >
              <MdBgoMapInner
                wardGeometry={activeWard?.geometry}
                erfs={wardErfs}
                geofences={wardGeofences}
                selectedGeofenceId={selectedGeofenceId}
                showErfsLayer={showErfsLayer}
                showGeofencesLayer={showGeofencesLayer}
                showWardLayer={showWardLayer}
                drawingPoints={drawingPoints}
                isDrawing={isDrawing}
                onMapClick={handleMapClick}
              />
            </Map>

            {/* Floating Map Layers Control */}
            <div style={styles.mapLayersBox}>
              <div style={styles.mapLayersHeader}>
                <strong>MAP LAYERS</strong>
              </div>
              <label style={styles.layerCheckboxLabel}>
                <input
                  type="checkbox"
                  checked={showErfsLayer}
                  onChange={(e) => setShowErfsLayer(e.target.checked)}
                />
                ERFs
              </label>
              <label style={styles.layerCheckboxLabel}>
                <input
                  type="checkbox"
                  checked={showGeofencesLayer}
                  onChange={(e) => setShowGeofencesLayer(e.target.checked)}
                />
                Geofences (whole Ward)
              </label>
              <label style={styles.layerCheckboxLabel}>
                <input
                  type="checkbox"
                  checked={showWardLayer}
                  onChange={(e) => setShowWardLayer(e.target.checked)}
                />
                Ward boundary
              </label>
            </div>
          </APIProvider>
        ) : (
          <div style={styles.noApiKey}>
            Google Maps API Key not configured.
          </div>
        )}
      </div>

      {/* Save Geofence & Create Batch Modal */}
      {isNameModalOpen ? (
        <div style={styles.modalOverlay} role="presentation">
          <div style={styles.modalCard} role="dialog" aria-modal="true">
            <p style={styles.eyebrow}>Save Geofence</p>
            <h3 style={styles.modalTitle}>
              Encompasses {erfsInside.length} ERFs (Limit: {BGO_ERF_LIMIT})
            </h3>

            <div style={styles.formGroup}>
              <label style={styles.label}>
                Geofence Name (Prefix Gf W{wardNumber} is fixed per GF-R001)
              </label>
              <div style={styles.prefixInputGroup}>
                <span style={styles.fixedPrefix}>Gf W{wardNumber}&nbsp;</span>
                <input
                  type="text"
                  placeholder="e.g. Albert Street North"
                  value={geofenceNameInput}
                  onChange={(e) => setGeofenceNameInput(e.target.value)}
                  style={styles.textInput}
                  autoFocus
                />
              </div>
              <div style={styles.previewNameText}>
                Full Name: <strong>{fullStandardName}</strong>
              </div>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Description (Optional)</label>
              <input
                type="text"
                placeholder="Optional notes"
                value={geofenceDescInput}
                onChange={(e) => setGeofenceDescInput(e.target.value)}
                style={styles.textInput}
              />
            </div>

            {formError ? <div style={styles.modalError}>{formError}</div> : null}

            <div style={styles.modalActions}>
              <button
                type="button"
                style={styles.modalCancelButton}
                onClick={() => setIsNameModalOpen(false)}
                disabled={isSavingGeofence || isCreatingBgo}
              >
                Cancel
              </button>
              <button
                type="button"
                style={styles.modalSecondaryButton}
                onClick={handleSaveGeofenceOnly}
                disabled={isSavingGeofence || isCreatingBgo}
              >
                {isSavingGeofence ? "Saving..." : "Save Geofence Only"}
              </button>
              <button
                type="button"
                style={styles.modalPrimaryButton}
                onClick={handleSaveAndCreateBatch}
                disabled={isSavingGeofence || isCreatingBgo}
              >
                {isCreatingBgo ? "Creating Batch..." : "Save & Create Batch"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Creation Success Modal */}
      {createdResult ? (
        <div style={styles.modalOverlay} role="presentation">
          <div style={styles.modalCard} role="dialog" aria-modal="true">
            <p style={styles.eyebrow}>
              {createdResult.type === "BATCH_CREATED"
                ? "MD BGO Batch Created"
                : "Geofence Saved"}
            </p>
            <h3 style={styles.modalTitle}>
              {createdResult.type === "BATCH_CREATED"
                ? `Batch ${createdResult.batchId}`
                : createdResult.geofenceName}
            </h3>
            <p style={styles.modalSubtitle}>
              {createdResult.type === "BATCH_CREATED"
                ? `Created permanent batch for ${createdResult.geofenceName} with ${createdResult.erfCount} ERFs. Status: READY FOR ALLOCATION.`
                : `Geofence ${createdResult.geofenceName} saved successfully in Ward ${wardNumber}.`}
            </p>

            <div style={styles.modalActions}>
              {createdResult.type === "BATCH_CREATED" ? (
                <>
                  <button
                    type="button"
                    style={styles.modalSecondaryButton}
                    onClick={() => {
                      setCreatedResult(null);
                      navigate("/operations/bgo");
                    }}
                  >
                    Return to MD BGO Register
                  </button>
                  <button
                    type="button"
                    style={styles.modalPrimaryButton}
                    onClick={() => {
                      navigate(`/operations/bgo/allocation?batchId=${encodeURIComponent(createdResult.batchId)}`);
                    }}
                  >
                    Proceed to Allocate Batch →
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  style={styles.modalPrimaryButton}
                  onClick={() => setCreatedResult(null)}
                >
                  Continue Planning
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

const styles = {
  page: { padding: 24 },
  header: {
    marginBottom: 16,
  },
  backLinkWrap: {
    marginBottom: 8,
  },
  backLink: {
    color: "#2563eb",
    fontSize: 13,
    fontWeight: 800,
    textDecoration: "none",
  },
  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  title: {
    margin: "6px 0 4px",
    fontSize: 28,
    color: "#0f172a",
  },
  subtitle: {
    margin: 0,
    color: "#64748b",
    fontSize: 14,
  },
  controlsBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
    flexWrap: "wrap",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    padding: "10px 16px",
  },
  controlsGroup: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  controlLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: "#475569",
    fontSize: 13,
    fontWeight: 700,
  },
  select: {
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 13,
    background: "#ffffff",
    color: "#0f172a",
  },
  erfCountBadge: {
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 12px",
    borderRadius: 999,
    background: "#dcfce7",
    color: "#15803d",
    fontSize: 13,
    fontWeight: 800,
  },
  drawFenceButton: {
    border: 0,
    borderRadius: 10,
    background: "#7c3aed",
    color: "#ffffff",
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer",
  },
  drawingActiveButton: {
    border: 0,
    borderRadius: 10,
    background: "#dc2626",
    color: "#ffffff",
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer",
  },
  drawingStatusBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
    padding: "10px 16px",
    borderRadius: 14,
    background: "#f8fafc",
    border: "1px solid #cbd5e1",
    flexWrap: "wrap",
  },
  drawingCountText: {
    fontSize: 14,
    fontWeight: 800,
  },
  drawingActions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  drawingButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    background: "#ffffff",
    color: "#334155",
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  drawingSaveButton: {
    border: 0,
    borderRadius: 8,
    background: "#2563eb",
    color: "#ffffff",
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: 800,
    cursor: "pointer",
  },
  disabledButton: {
    opacity: 0.5,
    pointerEvents: "none",
    cursor: "not-allowed",
  },
  mapContainer: {
    position: "relative",
    width: "100%",
    height: "calc(100vh - 280px)",
    minHeight: 520,
    borderRadius: 20,
    overflow: "hidden",
    border: "1px solid #cbd5e1",
  },
  mapElement: {
    width: "100%",
    height: "100%",
  },
  mapLayersBox: {
    position: "absolute",
    top: 14,
    right: 14,
    background: "#ffffff",
    borderRadius: 12,
    border: "1px solid #cbd5e1",
    boxShadow: "0 4px 12px rgba(15, 23, 42, 0.08)",
    padding: "10px 14px",
    zIndex: 50,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  mapLayersHeader: {
    fontSize: 11,
    color: "#64748b",
    letterSpacing: "0.05em",
    marginBottom: 4,
  },
  layerCheckboxLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    color: "#334155",
    fontWeight: 600,
    cursor: "pointer",
  },
  noApiKey: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#dc2626",
    fontSize: 15,
    fontWeight: 700,
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 23, 42, 0.45)",
    backdropFilter: "blur(2px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    padding: 16,
  },
  modalCard: {
    background: "#ffffff",
    borderRadius: 20,
    padding: 24,
    maxWidth: 520,
    width: "100%",
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
  },
  modalTitle: {
    margin: "6px 0 8px",
    fontSize: 20,
    color: "#0f172a",
  },
  modalSubtitle: {
    margin: "0 0 16px",
    color: "#64748b",
    fontSize: 14,
    lineHeight: 1.5,
  },
  formGroup: {
    marginBottom: 14,
  },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 700,
    color: "#475569",
    marginBottom: 6,
  },
  prefixInputGroup: {
    display: "flex",
    alignItems: "center",
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    padding: "0 10px",
    background: "#f8fafc",
  },
  fixedPrefix: {
    color: "#2563eb",
    fontWeight: 900,
    fontSize: 13,
  },
  textInput: {
    flex: 1,
    border: 0,
    background: "transparent",
    padding: "10px 0",
    fontSize: 13,
    color: "#0f172a",
    outline: "none",
  },
  previewNameText: {
    marginTop: 6,
    fontSize: 12,
    color: "#64748b",
  },
  modalError: {
    padding: 10,
    borderRadius: 8,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
    fontSize: 12,
    marginBottom: 14,
  },
  modalActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 18,
    flexWrap: "wrap",
  },
  modalCancelButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    background: "#ffffff",
    color: "#475569",
    padding: "8px 16px",
    fontWeight: 800,
    cursor: "pointer",
  },
  modalSecondaryButton: {
    border: "1px solid #2563eb",
    borderRadius: 10,
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "8px 16px",
    fontWeight: 800,
    cursor: "pointer",
  },
  modalPrimaryButton: {
    border: 0,
    borderRadius: 10,
    background: "#2563eb",
    color: "#ffffff",
    padding: "8px 16px",
    fontWeight: 800,
    cursor: "pointer",
  },
};
