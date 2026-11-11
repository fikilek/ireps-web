/* eslint-disable no-unused-vars -- JSX tags are consumed by the JSX transform. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { useGeo } from "../../context/GeoContext";
import { useGetMdBgoDashboardQuery } from "../../redux/bgoApi";
import { buildMdBgoDashboard, mdBgoChartScale, resolveMdBgoDashboardWorkbase } from "./md-bgo/mdBgoDashboardModel.js";
import "./md-bgo/mdBgoDashboard.css";

const number = value => value == null ? "NAv" : value.toLocaleString("en-ZA");
const percentage = value => value == null ? "NAv" : `${value.toFixed(1)}%`;
const workLegend = [
  { key: "notStarted", label: "Not Started", color: "var(--md-not-started)" },
  { key: "inProgress", label: "In Progress", color: "var(--md-in-progress)" },
  { key: "completed", label: "Completed", color: "var(--md-completed)" },
];

export function Donut({ label, segments, total, centre, caption }) {
  let cursor = 0;
  const stops = segments.map(segment => {
    const start = cursor;
    cursor += total > 0 ? 100 * segment.value / total : 0;
    return `${segment.color} ${start}% ${cursor}%`;
  });
  const background = total > 0 ? `conic-gradient(${stops.join(",")})` : "var(--md-unbatched)";
  return <div className="md-donut" style={{ background }} role="img" aria-label={label}>
    <div className="md-donut-centre"><strong>{centre}</strong><span>{caption}</span></div>
  </div>;
}

export function ReadFailure({ error, title = "MD BGO Dashboard could not be loaded" }) {
  const dialog = useRef(null);
  useEffect(() => {
    if (error && !dialog.current.open) dialog.current.showModal();
    if (!error && dialog.current.open) dialog.current.close();
  }, [error]);
  return <dialog ref={dialog} className="md-dashboard-dialog" aria-labelledby="md-dashboard-failure-title">
    <h2 id="md-dashboard-failure-title">{title}</h2>
    <p>{error}</p><form method="dialog"><button type="submit">OK</button></form>
  </dialog>;
}

export default function MdBgoDashboardPage() {
  const auth = useAuth();
  const { geoState } = useGeo();
  const { lmPcode, lmName } = resolveMdBgoDashboardWorkbase(auth, geoState);
  const { currentData: source, error: queryError } = useGetMdBgoDashboardQuery({ lmPcode }, { skip: !lmPcode });
  const [selection, setSelection] = useState({ lmPcode: "", id: "" });
  const model = useMemo(() => source?.ready ? buildMdBgoDashboard(source) : null, [source]);
  const selected = model?.batches.find(batch => selection.lmPcode === lmPcode && batch.id === selection.id) || model?.batches[0];
  const scale = mdBgoChartScale(model?.batches || []);
  const error = source?.error || queryError?.error || "";

  return <section className="md-dashboard">
    <header className="md-dashboard-header">
      <div><p className="md-eyebrow">Operations / MD BGO</p><h2>MD BGO Dashboard</h2><p className="md-intro">Municipal coverage. Batch workload. Field progress.</p></div>
      <div className="md-header-actions"><span className="md-scope">{lmName}</span><Link to="/operations/bgo/dashboard/map">Map Dashboard</Link><Link to="/operations/bgo">Back to MD BGO Register</Link></div>
    </header>
    {!lmPcode ? <p className="md-notice">Select an active municipality to view its dashboard.</p> : error ? <p className="md-notice md-error" role="alert">MD BGO data could not be loaded. {error}</p> : !model ? <p className="md-notice" role="status">Loading live MD BGO coverage and work progress…</p> : <>
      <div className="md-overview">
        <section className="md-chart-panel" aria-label="Municipal ERF coverage">
          <h3>Municipal ERF coverage</h3><p className="md-subtitle">ERFs included in an MD BGO batch</p>
          {model.coverage.error ? <div className="md-coverage-unavailable" role="status"><strong>Coverage unavailable</strong><p>{model.coverage.error}</p><p>Batched ERFs: {number(model.erfs)}</p></div> : <div className="md-ring-layout">
            <Donut label={`${number(model.erfs)} batched and ${number(model.coverage.unbatched)} unbatched ERFs; ${percentage(model.coverage.percent)} batched`} total={model.coverage.total} centre={percentage(model.coverage.percent)} caption="batched" segments={[{ value: model.erfs, color: "var(--md-blue)" }, { value: model.coverage.unbatched, color: "var(--md-unbatched)" }]} />
            <div className="md-legend"><div><i style={{ background: "var(--md-blue)" }} /><span>Batched ERFs</span><strong>{number(model.erfs)}</strong></div><div><i style={{ background: "var(--md-unbatched)" }} /><span>Not batched</span><strong>{number(model.coverage.unbatched)}</strong></div></div>
          </div>}
          <div className="md-panel-foot"><span>Municipal ERFs <strong>{number(model.coverage.total)}</strong></span><span>Distinct ERFs counted once</span></div>
        </section>
        <section className="md-chart-panel" aria-label="Overall fieldwork progress">
          <h3>Overall fieldwork progress</h3><p className="md-subtitle">All work rows across {number(model.batchCount)} batches</p>
          <div className="md-ring-layout"><Donut label={`${number(model.total)} work rows: ${number(model.notStarted)} not started, ${number(model.inProgress)} in progress, ${number(model.completed)} completed`} total={model.total} centre={number(model.total)} caption="total work rows" segments={[workLegend[2], workLegend[1], workLegend[0]].map(item => ({ ...item, value: model[item.key] }))} />
            <div className="md-legend">{workLegend.map(item => <div key={item.key}><i style={{ background: item.color }} /><span>{item.label}</span><strong>{number(model[item.key])}</strong></div>)}</div>
          </div><div className="md-panel-foot"><span>Completed <strong>{percentage(model.completion)}</strong></span><span>{number(model.notStarted)} + {number(model.inProgress)} + {number(model.completed)} = {number(model.total)}</span></div>
        </section>
      </div>
      <div className="md-discovery" aria-label="Aggregated batch and discovery totals">{[[model.batchCount, "MD BGO batches"], [model.erfs, "Distinct ERFs in batches"], [model.premises, "Registered premises"], [model.meters, "Discovered meters"]].map(([value, label]) => <div key={label}><strong>{number(value)}</strong><span>{label}</span></div>)}</div>
      <section className="md-chart-panel md-batch-panel">
        <div className="md-batch-heading"><div><h3>Progress by batch</h3><p className="md-subtitle">Select a batch to see its allocation and progress.</p></div><div className="md-chart-key">{workLegend.map(item => <span key={item.key}><i style={{ background: item.color }} />{item.label}</span>)}</div></div>
        {!selected ? <p className="md-notice">No MD BGO batches exist for {lmName}.</p> : <div className="md-batch-grid"><div>
          <div className="md-batch-bars" aria-label="Batch workload chart">{model.batches.map(batch => <button key={batch.id} type="button" className="md-batch-choice" aria-pressed={selected.id === batch.id} aria-label={`${batch.name}: ${batch.total} total rows, ${batch.notStarted} not started, ${batch.inProgress} in progress, ${batch.completed} completed; allocated to ${batch.team}`} onClick={() => setSelection({ lmPcode, id: batch.id })}>
            <span className="md-bar-head"><strong>{batch.name}</strong><span>{number(batch.total)} rows</span></span>
            <span className="md-bar-track">{workLegend.map(item => <span key={item.key} style={{ background: item.color, width: `${100 * batch[item.key] / scale.max}%` }} title={`${item.label}: ${number(batch[item.key])}`}>{batch[item.key] / scale.max >= 0.08 ? number(batch[item.key]) : ""}</span>)}</span>
            <span className="md-bar-meta"><span>{batch.team}{batch.wardPcode ? ` · Ward ${Number(batch.wardPcode.slice(-3))}` : ""}</span><span>{number(batch.notStarted)} not started · {number(batch.inProgress)} in progress · {number(batch.completed)} completed</span></span>
          </button>)}</div>
          <div className="md-axis" aria-hidden="true">{scale.ticks.map(tick => <span key={tick}>{number(tick)}</span>)}</div><div className="md-axis-title">Work rows · shared scale</div>
        </div><section className="md-batch-detail" aria-label="Selected batch" aria-live="polite">
          <div className="md-eyebrow">Selected Batch</div><h3>{selected.name}</h3><p className="md-batch-id">{selected.id}</p><span className="md-status">{selected.status}</span>
          <div className="md-assigned"><span>Allocated To</span><strong>{selected.team}</strong></div>
          <div className="md-completion"><span>Work completed</span><strong>{percentage(selected.completion)}</strong></div><div className="md-mini-track" role="progressbar" aria-label="Selected batch completion" aria-valuenow={selected.completion} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${selected.completion}%` }} /></div>
          <dl className="md-detail-work">{[["Total work rows", selected.total], ...workLegend.map(item => [item.label, selected[item.key]])].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{number(value)}</dd></div>)}</dl>
          <div className="md-detail-counts">{[[selected.erfs, "ERFs"], [selected.premises, "Premises"], [selected.meters, "Meters"]].map(([value, label]) => <div key={label}><strong>{number(value)}</strong><span>{label}</span></div>)}</div>
          <div className="md-detail-actions"><Link to={`/operations/md-bgo-rows?batchId=${encodeURIComponent(selected.id)}&wardPcode=${encodeURIComponent(selected.wardPcode)}&lmPcode=${encodeURIComponent(lmPcode)}`}>Open BGO Rows</Link><Link to={`/operations/bgo/${encodeURIComponent(selected.id)}/map`}>Batch Map</Link></div>
        </section></div>}
      </section>
    </>}
    <ReadFailure error={error} />
  </section>;
}
