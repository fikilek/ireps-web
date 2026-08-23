import { useEffect, useMemo, useRef, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";

import {
  SALES_STATUSES,
  getSalesStatusLabel,
} from "../sales/models/salesStatusModel.js";

const ERF_LABEL_MIN_ZOOM = 17;

const SALES_STATUS_META = Object.freeze({
  [SALES_STATUSES.NOT_STARTED]: {
    label: getSalesStatusLabel(SALES_STATUSES.NOT_STARTED),
    color: "#64748b",
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

    const labels = (model?.erfs || [])
      .filter((erf) => Boolean(erf.point))
      .map((erf) =>
        new window.google.maps.Marker({
          position: erf.point,
          map,
          title: `ERF ${erf.erfNo}`,
          label: {
            text: String(erf.erfNo || "E"),
            color: "#0f172a",
            fontWeight: "800",
            fontSize: "11px",
          },
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

    erfLabelsRef.current = labels;
    return () => clearMapObjects(erfLabelsRef);
  }, [map, model?.erfs, visibility.erfs, zoom]);

  useEffect(() => {
    if (!map || !window.google?.maps) return undefined;

    clearMapObjects(salesMarkersRef);

    const markers = salesMarkers.map((item) => {
      const meta = SALES_STATUS_META[item.status] || SALES_STATUS_META.INTEGRITY_EXCEPTION;
      const marker = new window.google.maps.Marker({
        position: item.point,
        map,
        title: `${item.meterNo} • ${meta.label}`,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: item.status === SALES_STATUSES.INTEGRITY_EXCEPTION ? 5 : 4,
          fillColor: meta.color,
          fillOpacity: 0.92,
          strokeColor: "#ffffff",
          strokeWeight: 1,
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

function ToggleRow({ checked, label, count, onChange, dotColor = null }) {
  return (
    <label style={toggleRowStyle}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      {dotColor ? (
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
}) {
  const summary = model?.salesSummary || {
    total: 0,
    notStarted: 0,
    inProgress: 0,
    completed: 0,
    integrityExceptions: 0,
  };

  return (
    <div
      style={{
        ...controlPanelStyle,
        top: isCreateMode ? 92 : 14,
      }}
    >
      <strong style={controlTitleStyle}>Map Layers</strong>

      <ToggleRow
        checked={visibility.erfs}
        label="ERFs"
        count={model?.erfs?.length || 0}
        onChange={() => onToggleLayer("erfs")}
      />

      <ToggleRow
        checked={visibility.sales}
        label="Sales (excluding Normal)"
        count={summary.total + summary.integrityExceptions}
        onChange={() => onToggleLayer("sales")}
      />

      {visibility.sales ? (
        <div style={salesSubgroupStyle}>
          <ToggleRow
            checked={salesStatusVisibility.notStarted}
            label={SALES_STATUS_META[SALES_STATUSES.NOT_STARTED].label}
            count={summary.notStarted}
            dotColor={SALES_STATUS_META[SALES_STATUSES.NOT_STARTED].color}
            onChange={() => onToggleSalesStatus("notStarted")}
          />
          <ToggleRow
            checked={salesStatusVisibility.inProgress}
            label={SALES_STATUS_META[SALES_STATUSES.IN_PROGRESS].label}
            count={summary.inProgress}
            dotColor={SALES_STATUS_META[SALES_STATUSES.IN_PROGRESS].color}
            onChange={() => onToggleSalesStatus("inProgress")}
          />
          <ToggleRow
            checked={salesStatusVisibility.completed}
            label={SALES_STATUS_META[SALES_STATUSES.COMPLETED].label}
            count={summary.completed}
            dotColor={SALES_STATUS_META[SALES_STATUSES.COMPLETED].color}
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

      <ToggleRow
        checked={visibility.premises}
        label="Premises"
        count={model?.premises?.length || 0}
        onChange={() => onToggleLayer("premises")}
      />

      <ToggleRow
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
