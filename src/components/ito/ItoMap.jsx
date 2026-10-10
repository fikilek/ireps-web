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

/**
 * Puts the camera where the office asked for it.
 *
 * Same behaviour as the FWR monitoring map (`FwrMonitoringPage.jsx:493`):
 * the camera is moved, then moved again on the next frame and once more
 * shortly after, because Google settles the map asynchronously and a single
 * setCenter can be undone by a fit that is still in flight. The request
 * carries a counter so pressing the control twice re-centres rather than
 * doing nothing.
 */
function Focus({ request, worker, home }) {
  const map = useMap();

  useEffect(() => {
    if (!map || !request?.n) return undefined;

    const target = request.target === "worker" ? worker : null;

    if (request.target === "worker" && !target) return undefined;

    const apply = () => {
      if (target) {
        map.setCenter(target);
        map.setZoom(17);
        return;
      }

      if (home.length === 1) {
        map.setCenter(home[0]);
        map.setZoom(18);
        return;
      }

      const bounds = new window.google.maps.LatLngBounds();

      home.forEach((point) => bounds.extend(point));
      map.fitBounds(bounds, 64);
    };

    apply();

    const frame = window.requestAnimationFrame(apply);
    const timer = window.setTimeout(apply, 180);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, request?.n]);

  return null;
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

export default function ItoMap({ meter, premise, erfPaths, workers = [], allocated = null }) {
  const [open, setOpen] = useState(false);
  // Owner, 10 October 2026: there was no way to see where the allocated man
  // actually is. The meter and the worker can be a long way apart - 502 km in
  // the owner's own test - so the map needs to be told which of the two to
  // look at, and to be able to come back.
  const [focus, setFocus] = useState({ target: "home", n: 0 });
  const [shown, setShown] = useState({
    erfs: true,
    premises: true,
    meters: true,
    workers: true,
  });

  const allocatedPoint = readPoint(allocated?.point);

  /**
   * The job: the ERF outline, the premise and the meter.
   *
   * Deliberately NOT the field workers. A man 502 km away would pull the
   * fit out to the whole province and the job would be a dot in the middle
   * of it, which is the opposite of what this is for.
   */
  const jobPoints = useMemo(() => {
    const list = [];

    if (Array.isArray(erfPaths)) {
      for (const point of erfPaths) {
        const at = readPoint(point);

        if (at) list.push(at);
      }
    }

    if (premise) list.push(premise);
    if (meter) list.push(meter);

    return list;
  }, [erfPaths, premise, meter]);

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
          <Focus request={focus} worker={readPoint(allocated?.point)} home={jobPoints.length ? jobPoints : points} />
        </GoogleMap>
      </APIProvider>

      {/* The map's control stack. Google draws its own fullscreen control at
          the top right; these sit under it in the same 40x40 white squares the
          geofence and Sales maps use (GeofencePlanningLayers.jsx:618), so the
          office meets one set of map controls across iREPS and not three. */}
      <button
        type="button"
        onClick={() => setFocus((current) => ({ target: "home", n: current.n + 1 }))}
        title="Fit the ERF, the premise and the meter"
        aria-label="Fit the ERF, the premise and the meter on the screen"
        style={{ ...styles.control, top: 60 }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#475569" strokeWidth="2" strokeLinejoin="round">
          <rect x="3.5" y="5" width="17" height="14" rx="2" />
          <circle cx="12" cy="12" r="2.2" fill="#b42318" stroke="none" />
        </svg>
      </button>

      <button
        type="button"
        onClick={() =>
          setFocus((current) => ({
            target: current.target === "worker" ? "home" : "worker",
            n: current.n + 1,
          }))
        }
        disabled={!allocatedPoint}
        title={
          !allocatedPoint
            ? allocated
              ? `iREPS has no position for ${allocated.name}`
              : "Allocate a field worker to see where he is"
            : focus.target === "worker"
              ? "Back to the meter"
              : `Centre on ${allocated.name}`
        }
        aria-label={
          focus.target === "worker"
            ? "Back to the meter"
            : "Centre the map on the allocated field worker"
        }
        style={{
          ...styles.control,
          top: 106,
          cursor: allocatedPoint ? "pointer" : "not-allowed",
        }}
      >
        {focus.target === "worker" ? (
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke={allocatedPoint ? "#1d4ed8" : "#cbd5e1"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21s-7-5.5-7-11a7 7 0 1 1 14 0c0 5.5-7 11-7 11z" />
            <circle cx="12" cy="10" r="2.5" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke={allocatedPoint ? "#1d4ed8" : "#cbd5e1"} strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="6.5" />
            <circle cx="12" cy="12" r="1.6" fill={allocatedPoint ? "#1d4ed8" : "#cbd5e1"} stroke="none" />
            <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
          </svg>
        )}
      </button>

      {open ? (
        <div style={styles.panel}>
          <div style={styles.panelHead}>
            <span style={styles.panelTitle}>Map layers</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close map layers"
              title="Close"
              style={styles.panelClose}
            >
              ×
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
          aria-label="Show map layers"
          title="Map layers"
          style={{ ...styles.control, top: 152 }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3 2 8l10 5 10-5-10-5Zm-7.5 8.2L2 12.5l10 5 10-5-2.5-1.3L12 15l-7.5-3.8Zm0 4.5L2 17l10 5 10-5-2.5-1.3L12 19.5l-7.5-3.8Z" fill="#475569" />
          </svg>
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
  // GeofencePlanningLayers.jsx:618 — the same square, shadow and radius as
  // every other iREPS map control, so they stack with Google's own.
  control: {
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
  },
  panel: {
    position: "absolute",
    right: 14,
    top: 152,
    zIndex: 55,
    width: 208,
    display: "grid",
    gap: 6,
    padding: 10,
    border: "1px solid #cbd5e1",
    borderRadius: 12,
    background: "rgba(255,255,255,0.96)",
    boxShadow: "0 10px 24px rgba(15,23,42,0.14)",
    color: "#0f172a",
    fontSize: 12,
  },
  panelHead: { display: "flex", alignItems: "center", gap: 8 },
  panelTitle: {
    flexGrow: 1,
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "#64748b",
  },
  panelClose: {
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
  switchRow: { display: "flex", alignItems: "center", gap: 9, padding: "4px 0" },
  switchLabel: { fontSize: 13 },
};
