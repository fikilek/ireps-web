/* eslint-disable no-unused-vars -- JSX tags are consumed by the JSX transform. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { useGeo } from "../../context/GeoContext";
import { db } from "../../firebase";
import { subscribeMdBgoMapDashboard } from "../../redux/mdBgoMapDashboardStream.js";
import { resolveMdBgoDashboardWorkbase } from "./md-bgo/mdBgoDashboardModel.js";
import { buildMdBgoMapDashboard } from "./md-bgo/mdBgoMapDashboardModel.js";
import MdBgoDashboardMap from "./md-bgo/MdBgoDashboardMap";
import { Donut, ReadFailure } from "./MdBgoDashboardPage";
import "./md-bgo/mdBgoMapDashboard.css";

const number = value => value == null ? "NAv" : value.toLocaleString("en-ZA");
const percent = value => value == null ? "NAv" : `${value.toFixed(1)}%`;
const modes = [["lm", "Municipality"], ["wards", "Wards"], ["geofences", "Geofences"]];
const work = [["notStarted", "Not Started", "var(--md-not-started)"], ["inProgress", "In Progress", "var(--md-in-progress)"], ["completed", "Completed", "var(--md-completed)"]];

function MapDashboard({ lmPcode, lmName, uid }) {
  const [source, setSource] = useState(null);
  const [mode, setMode] = useState("lm");
  const [selection, setSelection] = useState("");
  const [metric, setMetric] = useState("coverage");
  const [fitRequest, setFitRequest] = useState({ serial: 0, lm: false });
  const [mapError, setMapError] = useState("");
  const receiveMapError = useCallback(message => setMapError(message), []);
  useEffect(() => {
    if (!lmPcode || !uid) return undefined;
    return subscribeMdBgoMapDashboard(db, lmPcode, setSource);
  }, [lmPcode, uid]);
  const model = useMemo(() => source?.ready ? buildMdBgoMapDashboard(source) : null, [source]);
  const area = model?.areas.find(area => area.key === selection) || model?.lm;
  const summary = area?.summary;
  const options = mode === "wards" ? model?.wards : mode === "geofences" ? model?.fences : [];
  const error = source?.error || mapError || (!import.meta.env.VITE_GOOGLE_MAPS_API_KEY ? "The map service is not configured." : "");
  const onSelect = useCallback(key => { setSelection(key); setFitRequest(value => ({ serial: value.serial + 1, lm: false })); }, []);
  return <section className="md-dashboard md-map-dashboard">
    <header className="md-dashboard-header"><div><p className="md-eyebrow">Operations / MD BGO / Map Dashboard</p><h2>MD BGO Map Dashboard</h2><p className="md-intro">Explore coverage and fieldwork by municipality, ward or geofence.</p></div><div className="md-header-actions"><span className="md-scope">{lmName}</span><Link to="/operations/bgo/dashboard">Back to MD BGO Dashboard</Link></div></header>
    {!lmPcode ? <p className="md-notice">Select an active municipality to view its map.</p> : error ? <p role="alert" className="md-notice md-error">MD BGO Map Dashboard could not be loaded. {error}</p> : !model ? <p role="status" className="md-notice">Loading live boundaries and municipal ERF coverage…</p> : <>
      <div className="md-map-toolbar"><div className="md-map-modes" aria-label="Map aggregation mode">{modes.map(([key, label]) => <button key={key} type="button" aria-pressed={mode === key} onClick={() => { setMode(key); setSelection(""); setFitRequest(value => ({ serial: value.serial + 1, lm: false })); }}>{label}</button>)}</div>
        {mode !== "lm" ? <label>Area<select aria-label="Select map area" value={area.key === model.lm.key ? "" : area.key} onChange={event => onSelect(event.target.value)}><option value="">Whole municipality</option>{options.map(option => <option key={option.key} value={option.key}>{option.name}</option>)}</select></label> : null}
        <label>Colour by<select aria-label="Map shading" value={metric} onChange={event => setMetric(event.target.value)}><option value="coverage">Batch coverage</option><option value="completion">Work completion</option></select></label>
      </div>
      {model.diagnostics.missingBoundaries || model.diagnostics.missingLocations ? <p className="md-map-diagnostic" role="status">Spatial data: {model.diagnostics.missingBoundaries} missing boundaries; {model.diagnostics.missingLocations} ERFs without usable locations. Incomplete geofence coverage is shown as unavailable.</p> : null}
      <div className="md-map-workspace"><div className="md-map-canvas"><MdBgoDashboardMap model={model} mode={mode} selectedKey={area.key} metric={metric} fitRequest={fitRequest} onSelect={onSelect} onError={receiveMapError} />
        <div className="md-map-context"><strong>{lmName}{mode !== "lm" ? ` · ${modes.find(([key]) => key === mode)[1]}` : ""}</strong><span>{mode === "lm" ? "Municipal coverage overview" : `Click a ${mode === "wards" ? "ward" : "geofence"} boundary to select`}</span></div>
        <div className="md-map-mapfooter"><div className="md-map-legend"><strong>{metric === "coverage" ? "ERFs batched (%)" : "Work rows completed (%)"}</strong><div>{[["#e3e8ed", "0"], ["#b8d4fb", "1–25"], ["#72a5f1", "26–75"], ["#3877db", "76–100"], ["#94a3b8", "NAv"]].map(([color, label]) => <span key={label}><i style={{ background: color }} />{label}</span>)}</div><small>LM · Ward · Geofence boundaries</small></div><button type="button" onClick={() => setFitRequest(value => ({ serial: value.serial + 1, lm: true }))}>Fit LM</button></div>
      </div><section className="md-map-detail" aria-label="Selected area summary" aria-live="polite">
        <div className="md-map-detailtop"><span className="md-eyebrow">{area.kind === "lm" ? "Municipality" : area.kind === "wards" ? "Ward" : "Geofence"}</span>{area.key !== model.lm.key ? <button type="button" onClick={() => onSelect("")}>Clear selection</button> : null}</div>
        <h3>{area.name}</h3><p className="md-map-scope">{area.kind === "lm" ? `Local municipality · ${lmPcode}` : area.kind === "wards" ? `${lmName} · ${area.id}` : `${lmName}${area.wardPcode ? ` · Ward ${Number(area.wardPcode.slice(-3))}` : ""}`}</p>
        <h4>ERF coverage</h4>{summary.coverageError ? <p className="md-map-unavailable" role="status">{summary.coverageError}</p> : <div className="md-map-coverage"><Donut label={`${summary.batched} batched and ${summary.unbatched} unbatched ERFs`} total={summary.erfs} centre={percent(summary.coverage)} caption="batched" segments={[{ color: "var(--md-blue)", value: summary.batched }, { color: "var(--md-unbatched)", value: summary.unbatched }]} /><dl><div><dt>Batched</dt><dd>{number(summary.batched)}</dd></div><div><dt>Unbatched</dt><dd>{number(summary.unbatched)}</dd></div></dl></div>}
        <p className="md-map-total">Total ERFs <strong>{number(summary.erfs)}</strong></p>
        <div className="md-map-section"><div className="md-map-progresshead"><h4>Work progress</h4><span>{summary.total ? `${percent(summary.completion)} complete` : "No work rows"}</span></div><div className="md-map-progress" role="img" aria-label={`${summary.notStarted} not started, ${summary.inProgress} in progress, ${summary.completed} completed`}>{work.map(([key, label, color]) => <span key={key} style={{ background: color, width: `${summary.total ? 100 * summary[key] / summary.total : 0}%` }} title={`${number(summary[key])} ${label}`} />)}</div><div className="md-map-workkey">{work.map(([key, label, color]) => <span key={key}><i style={{ background: color }} />{number(summary[key])} {label}</span>)}</div></div>
        <div className="md-map-section"><h4>{summary.batchCount} {summary.batchCount === 1 ? "batch" : "batches"} · current states</h4><div className="md-map-states">{Object.entries(summary.statuses).map(([status, count]) => <div key={status}><span>{status}</span><div><i style={{ width: `${100 * count / summary.batchCount}%` }} /></div><strong>{count}</strong></div>)}{!summary.batchCount ? <span>No batch created</span> : null}</div></div>
        <div className="md-map-section md-map-entities">{[[summary.total, "Work rows"], [summary.premises, "Premises"], [summary.meters, "Meters"]].map(([value, label]) => <div key={label}><strong>{number(value)}</strong><span>{label}</span></div>)}</div>
        <div className="md-map-section"><h4>Allocation</h4><div className="md-map-allocations"><span>{summary.teams} {summary.teams === 1 ? "Team" : "Teams"}</span><span>{summary.sps} {summary.sps === 1 ? "SP" : "SPs"}</span></div><div className="md-map-targets">{summary.targets.length ? summary.targets.map(target => <span key={`${target.type}:${target.id}`}>{target.name}</span>) : "Unallocated"}</div></div>
        <div className="md-map-section"><h4>Related batches</h4><div className="md-map-related">{summary.related.map(batch => <div key={batch.id}><strong>{batch.name}</strong><span>{batch.status}</span><div><Link to={`/operations/md-bgo-rows?batchId=${encodeURIComponent(batch.id)}&wardPcode=${encodeURIComponent(batch.wardPcode)}&lmPcode=${encodeURIComponent(lmPcode)}`}>BGO Rows</Link><Link to={`/operations/bgo/${encodeURIComponent(batch.id)}/map`}>Batch Map</Link></div></div>)}{!summary.related.length ? <span>No related batches</span> : null}</div></div>
      </section></div>
    </>}
    <ReadFailure error={error} title="MD BGO Map Dashboard could not be loaded" />
  </section>;
}

export default function MdBgoMapDashboardPage() {
  const auth = useAuth();
  const { geoState } = useGeo();
  const { lmPcode, lmName } = resolveMdBgoDashboardWorkbase(auth, geoState);
  return <MapDashboard key={`${lmPcode}:${auth.uid}`} lmPcode={lmPcode} lmName={lmName} uid={auth.uid} />;
}
