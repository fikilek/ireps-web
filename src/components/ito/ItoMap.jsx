/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
// The meter on the ground. `DR-R001` 3, step 5 of the A-to-Z.
//
// It shows the ERF, the premise and the meter at the same time, **with the
// line that joins the meter to its premise, because a meter is not always
// inside the ERF** — that line is the whole reason this map exists rather than
// a single pin. Around the meter is the 100 m ring, and inside it the field
// workers who are close enough to be drawn.
//
// The same Google map the rest of iREPS uses (`@vis.gl/react-google-maps`,
// `APIProvider` + `Map`), and the same way of drawing: a layer is a component
// that takes `useMap()` and puts shapes on it. Copied from the geofence maps
// rather than invented beside them.
import { useEffect, useMemo, useRef, useState } from "react";
import { APIProvider, Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";

import { ON_THE_MAP_RADIUS_M, readPoint } from "./geoDistance";

const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

function ErfLayer({ paths, show }) {
  const map = useMap();
  const shapeRef = useRef(null);

  useEffect(() => {
    if (!map || !window.google?.maps) return undefined;

    shapeRef.current?.setMap(null);
    shapeRef.current = null;

    if (!show || !paths || paths.length < 3) return undefined;

    shapeRef.current = new window.google.maps.Polygon({
      paths,
      map,
      strokeColor: "#1d4ed8",
      strokeWeight: 2.5,
      fillColor: "#1d4ed8",
      fillOpacity: 0.1,
      clickable: false,
    });

    return () => {
      shapeRef.current?.setMap(null);
      shapeRef.current = null;
    };
  }, [map, paths, show]);

  return null;
}

function PointsLayer({ meter, premise, showMeter, showPremise, workers, showWorkers }) {
  const map = useMap();
  const drawnRef = useRef([]);

  useEffect(() => {
    if (!map || !window.google?.maps) return undefined;

    drawnRef.current.forEach((shape) => shape.setMap(null));
    drawnRef.current = [];

    const google = window.google.maps;
    const drawn = [];

    if (showMeter && meter) {
      drawn.push(
        new google.Marker({
          position: meter,
          map,
          title: "Meter",
          icon: {
            path: google.SymbolPath.CIRCLE,
            scale: 9,
            fillColor: "#b42318",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2.5,
          },
        }),
      );

      // The ring that decides who is drawn at all.
      drawn.push(
        new google.Circle({
          center: meter,
          radius: ON_THE_MAP_RADIUS_M,
          map,
          strokeColor: "#1d4ed8",
          strokeOpacity: 0.65,
          strokeWeight: 1.5,
          fillOpacity: 0,
          clickable: false,
        }),
      );
    }

    if (showPremise && premise) {
      drawn.push(
        new google.Marker({
          position: premise,
          map,
          title: "Premise",
          icon: {
            path: google.SymbolPath.CIRCLE,
            scale: 7,
            fillColor: "#ffffff",
            fillOpacity: 1,
            strokeColor: "#1d4ed8",
            strokeWeight: 3,
          },
        }),
      );
    }

    // The line. A meter is not always inside the ERF, so the office must be
    // able to see which premise this meter belongs to.
    if (showMeter && showPremise && meter && premise) {
      drawn.push(
        new google.Polyline({
          path: [premise, meter],
          map,
          strokeColor: "#0f172a",
          strokeOpacity: 0,
          clickable: false,
          icons: [
            {
              icon: { path: "M 0,-1 0,1", strokeOpacity: 1, strokeWeight: 2, scale: 3 },
              offset: "0",
              repeat: "11px",
            },
          ],
        }),
      );
    }

    if (showWorkers) {
      for (const worker of workers || []) {
        if (!worker.point) continue;

        const at = readPoint(worker.point);

        if (!at) continue;

        drawn.push(
          new google.Marker({
            position: at,
            map,
            title: `${worker.name} · ${worker.distance}`,
            label: {
              text: initials(worker.name),
              color: "#ffffff",
              fontSize: "10px",
              fontWeight: "bold",
            },
            icon: {
              path: google.SymbolPath.CIRCLE,
              scale: 11,
              // A worker who has gone quiet is drawn in the warning colour, so
              // the office can see at a glance whose position is old.
              fillColor: worker.heardIsStale ? "#b45309" : "#15803d",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2.5,
            },
          }),
        );
      }
    }

    drawnRef.current = drawn;

    return () => {
      drawn.forEach((shape) => shape.setMap(null));
      drawnRef.current = [];
    };
  }, [map, meter, premise, showMeter, showPremise, workers, showWorkers]);

  return null;
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) return "?";

  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

function Fit({ points }) {
  const map = useMap();

  useEffect(() => {
    if (!map || !window.google?.maps || points.length === 0) return;

    if (points.length === 1) {
      map.setCenter(points[0]);
      map.setZoom(18);
      return;
    }

    const bounds = new window.google.maps.LatLngBounds();

    points.forEach((point) => bounds.extend(point));
    map.fitBounds(bounds, 64);
  }, [map, points]);

  return null;
}

const LAYERS = [
  { key: "erfs", label: "ERFs" },
  { key: "premises", label: "Premises" },
  { key: "meters", label: "Meters" },
  { key: "workers", label: "Field workers" },
];

export default function ItoMap({ meter, premise, erfPaths, workers = [] }) {
  const [open, setOpen] = useState(true);
  const [shown, setShown] = useState({
    erfs: true,
    premises: true,
    meters: true,
    workers: true,
  });

  const points = useMemo(() => {
    const list = [];

    if (meter) list.push(meter);
    if (premise) list.push(premise);

    for (const worker of workers) {
      const at = readPoint(worker.point);

      if (at) list.push(at);
    }

    return list;
  }, [meter, premise, workers]);

  if (!googleMapsApiKey) {
    return (
      <p style={styles.note}>
        The map cannot be drawn: this build has no Google Maps key. Everything
        else on this page works, and the worker list beside it is unaffected.
      </p>
    );
  }

  if (points.length === 0) {
    return (
      <p style={styles.note}>
        Nothing can be drawn: neither this meter nor its premise carries a
        position. That is a defect in the records, not in the map — the work can
        still be sent from the list beside this.
      </p>
    );
  }

  return (
    <div style={styles.shell}>
      <APIProvider apiKey={googleMapsApiKey}>
        <GoogleMap
          defaultCenter={points[0]}
          defaultZoom={18}
          mapTypeId="roadmap"
          gestureHandling="greedy"
          disableDefaultUI={false}
          style={styles.map}
        >
          <ErfLayer paths={erfPaths} show={shown.erfs} />
          <PointsLayer
            meter={meter}
            premise={premise}
            showMeter={shown.meters}
            showPremise={shown.premises}
            workers={workers}
            showWorkers={shown.workers}
          />
          <Fit points={points} />
        </GoogleMap>
      </APIProvider>

      {open ? (
        <div style={styles.layers}>
          <div style={styles.layersHead}>
            <span style={styles.label}>Map layers</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close the map layers box"
              style={styles.close}
            >
              ✕
            </button>
          </div>
          {LAYERS.map((layer) => (
            <div key={layer.key} style={styles.switchRow}>
              <input
                type="checkbox"
                id={`ito-layer-${layer.key}`}
                checked={shown[layer.key]}
                onChange={(event) =>
                  setShown((current) => ({ ...current, [layer.key]: event.target.checked }))
                }
              />
              <label htmlFor={`ito-layer-${layer.key}`} style={styles.switchLabel}>
                {layer.label}
              </label>
            </div>
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Show the map layers box"
          style={styles.layersIcon}
        >
          ☰
        </button>
      )}
    </div>
  );
}

const styles = {
  // The map fills whatever height its card has left, rather than sitting at a
  // fixed 360 px with white space under it. The card is a flex column and the
  // two columns stretch to the taller of them, so this takes up the slack the
  // worker list on the right creates.
  shell: {
    position: "relative",
    flex: "1 1 auto",
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    overflow: "hidden",
    background: "#e8eef4",
    minHeight: 360,
  },
  map: { width: "100%", height: "100%", minHeight: 360 },
  note: { margin: 0, fontSize: 13, lineHeight: 1.55, color: "#475569" },
  layers: {
    position: "absolute",
    top: 14,
    right: 14,
    width: 196,
    background: "rgba(255,255,255,0.97)",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: "12px 14px",
  },
  layersHead: { display: "flex", alignItems: "center", gap: 8, marginBottom: 9 },
  label: {
    flexGrow: 1,
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "#64748b",
  },
  close: {
    width: 22,
    height: 22,
    padding: 0,
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    color: "#475569",
    cursor: "pointer",
    lineHeight: 1,
  },
  layersIcon: {
    position: "absolute",
    top: 14,
    right: 14,
    width: 34,
    height: 34,
    background: "rgba(255,255,255,0.97)",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    color: "#475569",
    cursor: "pointer",
    fontSize: 15,
  },
  switchRow: { display: "flex", alignItems: "center", gap: 9, padding: "4px 0" },
  switchLabel: { fontSize: 13 },
};
