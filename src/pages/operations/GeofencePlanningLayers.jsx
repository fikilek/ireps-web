/* eslint-disable no-unused-vars -- JSX tags are used by React. */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";

import {
  SALES_STATUSES,
  getSalesStatusLabel,
} from "../sales/models/salesStatusModel.js";
import {
  ERF_LABEL_BELOW_ICON_OFFSET,
  SALES_ICON_SCALE,
  SALES_STATUS_GLYPHS,
  erfIdsUnderMeterIcons,
} from "./geofence-map-icons.js";

const ERF_LABEL_MIN_ZOOM = 17;

const SALES_STATUS_META = Object.freeze({
  [SALES_STATUSES.NOT_STARTED]: {
    label: getSalesStatusLabel(SALES_STATUSES.NOT_STARTED),
    color: "#475569",
  },
  [SALES_STATUSES.IN_PROGRESS]: {
    label: getSalesStatusLabel(SALES_STATUSES.IN_PROGRESS),
    color: "#f59e0b",
  },
  [SALES_STATUSES.COMPLETED]: {
    label: getSalesStatusLabel(SALES_STATUSES.COMPLETED),
    color: "#16a34a",
  },
  [SALES_STATUSES.INTEGRITY_EXCEPTION]: {
    label: getSalesStatusLabel(SALES_STATUSES.INTEGRITY_EXCEPTION),
    color: "#dc2626",
  },
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clearMapObjects(ref) {
  ref.current.forEach((item) => item.setMap(null));
  ref.current = [];
}

function useCurrentZoom(defaultZoom = 14) {
  const map = useMap();
  const [zoom, setZoom] = useState(defaultZoom);

  useEffect(() => {
    if (!map || !window.google?.maps) return undefined;

    const update = () => setZoom(Number(map.getZoom() || defaultZoom));
    update();

    const listener = map.addListener("zoom_changed", update);
    return () => listener.remove();
  }, [map, defaultZoom]);

  return zoom;
}

function statusIsVisible(status, salesStatusVisibility) {
  if (status === SALES_STATUSES.INTEGRITY_EXCEPTION) return true;
  if (status === SALES_STATUSES.NOT_STARTED) {
    return salesStatusVisibility.notStarted;
  }
  if (status === SALES_STATUSES.IN_PROGRESS) {
    return salesStatusVisibility.inProgress;
  }
  if (status === SALES_STATUSES.COMPLETED) {
    return salesStatusVisibility.completed;
  }
  return false;
}

export function GeofencePlanningLayers({
  model,
  visibility,
  salesStatusVisibility,
  isCreateMode,
  meterPoints = [],
}) {
  const map = useMap();
  const zoom = useCurrentZoom(14);
  const infoWindowRef = useRef(null);
  const erfPolygonsRef = useRef([]);
  const erfLabelsRef = useRef([]);
  const salesMarkersRef = useRef([]);
  const premiseMarkersRef = useRef([]);
  const assetMarkersRef = useRef([]);

  const salesMarkers = useMemo(() => {
    if (!visibility.sales) return [];

    return (model?.salesRecords || []).flatMap((record) => {
      if (!statusIsVisible(record.status, salesStatusVisibility)) return [];

      return (record.candidates || []).map((candidate) => ({
        ...candidate,
        salesId: record.id,
        meterNo: record.meterNo,
        status: record.status,
        integrityIssues: record.integrityIssues,
      }));
    });
  }, [model?.salesRecords, salesStatusVisibility, visibility.sales]);

  useEffect(() => {
    if (!map || !window.google?.maps) return undefined;

    if (!infoWindowRef.current) {
      infoWindowRef.current = new window.google.maps.InfoWindow();
    }

    return () => {
      infoWindowRef.current?.close();
      infoWindowRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    if (isCreateMode) infoWindowRef.current?.close();
  }, [isCreateMode]);

  useEffect(() => {
    if (!map || !window.google?.maps) return undefined;

    clearMapObjects(erfPolygonsRef);
    if (!visibility.erfs) return undefined;

    const polygons = [];

    (model?.erfs || []).forEach((erf) => {
      (erf.paths || []).forEach((path) => {
        if (!Array.isArray(path) || path.length < 3) return;

        const polygon = new window.google.maps.Polygon({
          paths: path,
          strokeColor: "#0284c7",
          strokeOpacity: 0.7,
          strokeWeight: 1,
          fillColor: "#38bdf8",
          fillOpacity: 0.035,
          clickable: !isCreateMode,
          zIndex: 35,
        });

        if (!isCreateMode) {
          polygon.addListener("click", (event) => {
            const infoWindow = infoWindowRef.current;
            if (!infoWindow) return;

            infoWindow.setContent(`
              <div style="font-family: Arial, sans-serif; min-width: 170px;">
                <strong>ERF ${escapeHtml(erf.erfNo)}</strong>
                <div>${escapeHtml(erf.id)}</div>
              </div>
            `);
            infoWindow.setPosition(event.latLng);
            infoWindow.open({ map, shouldFocus: false });
          });
        }

        polygon.setMap(map);
        polygons.push(polygon);
      });
    });

    erfPolygonsRef.current = polygons;

    return () => clearMapObjects(erfPolygonsRef);
  }, [isCreateMode, map, model?.erfs, visibility.erfs]);

  useEffect(() => {
    if (!map || !window.google?.maps) return undefined;

    clearMapObjects(erfLabelsRef);
    if (!visibility.erfs || zoom < ERF_LABEL_MIN_ZOOM) return undefined;

    // Rules 18.7: the ERF number only, placed on the centroid (no separate centroid
    // symbol), small and light on an off-white label (.ireps-erf-label in index.css)
    // so it stays readable on every map type, including satellite. Where a meter
    // icon sits on the centroid, the label moves just below the icon.
    const covered = erfIdsUnderMeterIcons(model?.erfs, [
      ...salesMarkers.map((item) => item.point),
      ...(meterPoints || []),
    ]);
    const labels = (model?.erfs || [])
      .filter((erf) => Boolean(erf.point))
      .map((erf) =>
        new window.google.maps.Marker({
          position: erf.point,
          map,
          title: `ERF ${erf.erfNo}`,
          label: {
            text: String(erf.erfNo || "E"),
            className: "ireps-erf-label",
            color: "#334155",
            fontWeight: "400",
            fontSize: "10px",
          },
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 1,
            fillOpacity: 0,
            strokeOpacity: 0,
            ...(covered.has(erf.id)
              ? { labelOrigin: new window.google.maps.Point(0, ERF_LABEL_BELOW_ICON_OFFSET) }
              : {}),
          },
          clickable: false,
          zIndex: 42,
        }),
      );

    erfLabelsRef.current = labels;
    return () => clearMapObjects(erfLabelsRef);
  }, [map, model?.erfs, visibility.erfs, zoom, salesMarkers, meterPoints]);

  useEffect(() => {
    if (!map || !window.google?.maps) return undefined;

    clearMapObjects(salesMarkersRef);

    const markers = salesMarkers.map((item) => {
      const meta = SALES_STATUS_META[item.status] || SALES_STATUS_META.INTEGRITY_EXCEPTION;
      const glyph = SALES_STATUS_GLYPHS[item.status];
      const marker = new window.google.maps.Marker({
        position: item.point,
        map,
        title: `${item.meterNo} • ${meta.label}`,
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
              scale: 7,
              fillColor: meta.color,
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
            },
        clickable: !isCreateMode,
        zIndex:
          item.status === SALES_STATUSES.INTEGRITY_EXCEPTION ? 132 : 112,
      });

      if (!isCreateMode) {
        marker.addListener("click", () => {
          const infoWindow = infoWindowRef.current;
          if (!infoWindow) return;

          const integrity = item.integrityIssues?.length
            ? `<div style="margin-top:6px;color:#b91c1c;">${escapeHtml(
                item.integrityIssues.join(", "),
              )}</div>`
            : "";

          infoWindow.setContent(`
            <div style="font-family: Arial, sans-serif; min-width: 220px;">
              <strong>${escapeHtml(item.meterNo)}</strong>
              <div>Sales: ${escapeHtml(item.salesId)}</div>
              <div>Sales Status: ${escapeHtml(meta.label)}</div>
              <div>Candidate ERF: ${escapeHtml(item.erfNumber || item.erfId || "NAv")}</div>
              ${integrity}
            </div>
          `);
          infoWindow.open({ anchor: marker, map, shouldFocus: false });
        });
      }

      return marker;
    });

    salesMarkersRef.current = markers;

    return () => clearMapObjects(salesMarkersRef);
  }, [isCreateMode, map, salesMarkers]);

  useEffect(() => {
    if (!map || !window.google?.maps) return undefined;

    clearMapObjects(premiseMarkersRef);
    if (!visibility.premises) return undefined;

    const markers = (model?.premises || []).map((premise) => {
      const marker = new window.google.maps.Marker({
        position: premise.point,
        map,
        title: `Premise: ${premise.address}`,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 4,
          fillColor: "#2563eb",
          fillOpacity: 0.76,
          strokeColor: "#ffffff",
          strokeWeight: 1,
        },
        clickable: !isCreateMode,
        zIndex: 118,
      });

      if (!isCreateMode) {
        marker.addListener("click", () => {
          const infoWindow = infoWindowRef.current;
          if (!infoWindow) return;

          infoWindow.setContent(`
            <div style="font-family: Arial, sans-serif; min-width: 210px;">
              <strong>${escapeHtml(premise.address)}</strong>
              <div>Premise: ${escapeHtml(premise.id)}</div>
            </div>
          `);
          infoWindow.open({ anchor: marker, map, shouldFocus: false });
        });
      }

      return marker;
    });

    premiseMarkersRef.current = markers;
    return () => clearMapObjects(premiseMarkersRef);
  }, [isCreateMode, map, model?.premises, visibility.premises]);

  useEffect(() => {
    if (!map || !window.google?.maps) return undefined;

    clearMapObjects(assetMarkersRef);
    if (!visibility.assets) return undefined;

    const markers = (model?.generalAssets || []).map((asset) => {
      const marker = new window.google.maps.Marker({
        position: asset.point,
        map,
        title: `Asset: ${asset.meterNo}`,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 5,
          fillColor: "#0f766e",
          fillOpacity: 0.8,
          strokeColor: "#ffffff",
          strokeWeight: 1,
        },
        clickable: !isCreateMode,
        zIndex: 124,
      });

      if (!isCreateMode) {
        marker.addListener("click", () => {
          const infoWindow = infoWindowRef.current;
          if (!infoWindow) return;

          infoWindow.setContent(`
            <div style="font-family: Arial, sans-serif; min-width: 210px;">
              <strong>${escapeHtml(asset.meterNo)}</strong>
              <div>AST: ${escapeHtml(asset.id)}</div>
            </div>
          `);
          infoWindow.open({ anchor: marker, map, shouldFocus: false });
        });
      }

      return marker;
    });

    assetMarkersRef.current = markers;
    return () => clearMapObjects(assetMarkersRef);
  }, [isCreateMode, map, model?.generalAssets, visibility.assets]);

  return null;
}

export function SalesStatusGlyph({ status, size = 14 }) {
  const glyph = SALES_STATUS_GLYPHS[status];
  if (!glyph) return null;
  return (
    <svg width={size} height={size} viewBox="-1.25 -1.25 2.5 2.5" aria-hidden="true" style={{ flex: "0 0 auto" }}>
      <path d={glyph.path} fill={glyph.color} stroke="rgba(15,23,42,0.35)" strokeWidth="0.12" />
    </svg>
  );
}

function ToggleRow({ checked, label, count, onChange, dotColor = null, glyphStatus = null, disabled = false }) {
  return (
    <label style={toggleRowStyle}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      {glyphStatus ? <SalesStatusGlyph status={glyphStatus} /> : null}
      {!glyphStatus && dotColor ? (
        <span style={{ ...legendDotStyle, background: dotColor }} aria-hidden="true" />
      ) : null}
      <span style={{ flex: 1 }}>{label}</span>
      <strong>{count}</strong>
    </label>
  );
}

export function GeofencePlanningLayerControls({
  model,
  visibility,
  salesStatusVisibility,
  onToggleLayer,
  onToggleSalesStatus,
  isCreateMode,
  salesLabel = "Sales (excluding Normal)",
  layerStates, requestedLayers = [], disabled = false,
}) {
  const summary = model?.salesSummary || {
    total: 0,
    notStarted: 0,
    inProgress: 0,
    completed: 0,
    integrityExceptions: 0,
  };
  const [open, setOpen] = useState(true);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Show map layers"
        title="Map layers"
        style={{ ...layersOpenButtonStyle, top: isCreateMode ? 92 : 60 }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3 2 8l10 5 10-5-10-5Zm-7.5 8.2L2 12.5l10 5 10-5-2.5-1.3L12 15l-7.5-3.8Zm0 4.5L2 17l10 5 10-5-2.5-1.3L12 19.5l-7.5-3.8Z" fill="#475569" />
        </svg>
      </button>
    );
  }

  return (
    <div
      style={{
        ...controlPanelStyle,
        top: isCreateMode ? 92 : 14,
      }}
    >
      <div style={controlHeaderStyle}>
        <strong style={controlTitleStyle}>Map Layers</strong>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close map layers" title="Close" style={layersCloseButtonStyle}>×</button>
      </div>
      {layerStates !== undefined && <div role="status">{["erfs", "sales", "premises", "assets"].map(layer => <div key={layer}>{layer}: {requestedLayers.includes(layer) ? layerStates?.[layer] || "Loading nearby records…" : "Off · not loaded"}</div>)}</div>}

      <ToggleRow disabled={disabled}
        checked={visibility.erfs}
        label="ERFs"
        count={model?.erfs?.length || 0}
        onChange={() => onToggleLayer("erfs")}
      />

      <ToggleRow disabled={disabled}
        checked={visibility.sales}
        label={salesLabel}
        count={summary.total + summary.integrityExceptions}
        onChange={() => onToggleLayer("sales")}
      />

      {visibility.sales ? (
        <div style={salesSubgroupStyle}>
          <ToggleRow disabled={disabled}
            checked={salesStatusVisibility.notStarted}
            label={SALES_STATUS_META[SALES_STATUSES.NOT_STARTED].label}
            count={summary.notStarted}
            glyphStatus={SALES_STATUSES.NOT_STARTED}
            onChange={() => onToggleSalesStatus("notStarted")}
          />
          <ToggleRow disabled={disabled}
            checked={salesStatusVisibility.inProgress}
            label={SALES_STATUS_META[SALES_STATUSES.IN_PROGRESS].label}
            count={summary.inProgress}
            glyphStatus={SALES_STATUSES.IN_PROGRESS}
            onChange={() => onToggleSalesStatus("inProgress")}
          />
          <ToggleRow disabled={disabled}
            checked={salesStatusVisibility.completed}
            label={SALES_STATUS_META[SALES_STATUSES.COMPLETED].label}
            count={summary.completed}
            glyphStatus={SALES_STATUSES.COMPLETED}
            onChange={() => onToggleSalesStatus("completed")}
          />
          {summary.integrityExceptions > 0 ? (
            <div style={integrityExceptionStyle}>
              <span
                style={{
                  ...legendDotStyle,
                  background:
                    SALES_STATUS_META[SALES_STATUSES.INTEGRITY_EXCEPTION]
                      .color,
                }}
              />
              Integrity exceptions: <strong>{summary.integrityExceptions}</strong>
            </div>
          ) : null}
        </div>
      ) : null}

      <ToggleRow disabled={disabled}
        checked={visibility.premises}
        label="Premises"
        count={model?.premises?.length || 0}
        onChange={() => onToggleLayer("premises")}
      />

      <ToggleRow disabled={disabled}
        checked={visibility.assets}
        label="Assets"
        count={model?.assets?.length || 0}
        onChange={() => onToggleLayer("assets")}
      />
    </div>
  );
}

const controlPanelStyle = {
  position: "absolute",
  right: 14,
  zIndex: 55,
  width: 208,
  maxHeight: "calc(100% - 120px)",
  overflowY: "auto",
  display: "grid",
  gap: 6,
  padding: 10,
  border: "1px solid #cbd5e1",
  borderRadius: 12,
  background: "rgba(255,255,255,0.96)",
  boxShadow: "0 10px 24px rgba(15,23,42,0.14)",
  color: "#0f172a",
  fontSize: 12,
};

const controlTitleStyle = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const controlHeaderStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};

const layersCloseButtonStyle = {
  width: 22,
  height: 22,
  border: 0,
  borderRadius: 4,
  background: "transparent",
  color: "#475569",
  fontSize: 18,
  lineHeight: "22px",
  padding: 0,
  cursor: "pointer",
};

// Sized and styled like Google's own map buttons, below the full-screen button.
const layersOpenButtonStyle = {
  position: "absolute",
  right: 10,
  zIndex: 55,
  width: 40,
  height: 40,
  display: "grid",
  placeItems: "center",
  border: 0,
  borderRadius: 2,
  background: "#ffffff",
  boxShadow: "rgba(0, 0, 0, 0.3) 0 1px 4px -1px",
  cursor: "pointer",
  padding: 0,
};

const toggleRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  minHeight: 24,
  cursor: "pointer",
};

const salesSubgroupStyle = {
  display: "grid",
  gap: 3,
  marginLeft: 18,
  paddingLeft: 8,
  borderLeft: "2px solid #e2e8f0",
};

const legendDotStyle = {
  width: 8,
  height: 8,
  borderRadius: 999,
  flex: "0 0 auto",
};

const integrityExceptionStyle = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  color: "#b91c1c",
  padding: "3px 0",
};
