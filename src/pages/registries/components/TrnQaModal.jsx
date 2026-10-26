/* eslint-disable no-unused-vars -- JSX component tags are consumed by React. */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../../firebase";
import { QA_LABELS } from "../../../../functions/qa/model.js";
import { qaDate } from "../../../utils/qaDisplay.js";
import "./TrnQaModal.css";

const readReview = httpsCallable(functions, "getTrnQaReview", { timeout: 120000 });
const saveReview = httpsCallable(functions, "saveTrnQaReview");
const label = value => String(value).replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
const workflowStateLabel = state => ({ "COMPLETED": "Completed", "QA FAIL": "QA Fail", "QA PASS": "QA Pass" })[state] || state || "NAv";

function Fields({ value }) {
  if (value === null || value === undefined || value === "") return <span>NAv</span>;
  if (typeof value !== "object") return <span>{String(value)}</span>;
  const items = Object.entries(value).filter(([key]) => !["url", "uri"].includes(key));
  if (!items.length) return <span>NAv</span>;
  return <dl className="qa-fields">{items.map(([key, item]) => <div key={key}><dt>{label(key)}</dt><dd><Fields value={item} /></dd></div>)}</dl>;
}

function Evidence({ item, index }) {
  const [failed, setFailed] = useState(false);
  const name = label(item.tag || `Evidence ${index + 1}`);
  const type = `${item.type || ""} ${item.tag || ""}`.toLowerCase();
  return <figure className="qa-evidence-item"><figcaption>{name}</figcaption>
    {failed || !item.url ? <p role="status">Evidence unavailable</p> : type.includes("video")
      ? <video controls preload="none" src={item.url} onError={() => setFailed(true)} />
      : type.includes("audio") || type.includes("voice")
        ? <audio controls preload="none" src={item.url} onError={() => setFailed(true)} />
        : <a href={item.url} target="_blank" rel="noreferrer" title={`Open full-size ${name}`}><img src={item.url} alt={name} loading="lazy" onError={() => setFailed(true)} /></a>}
  </figure>;
}

function Snapshot({ snapshot, evidence }) {
  const media = Array.isArray(snapshot.media) ? snapshot.media : [];
  const commentMedia = [];
  const collect = value => {
    if (!value || typeof value !== "object") return;
    if (value.url && !media.some(m => m.url === value.url)) commentMedia.push(value);
    Object.values(value).forEach(collect);
  };
  collect(snapshot.fieldComment);
  const unavailable = evidence.filter(item => !item.available).length;
  const preservedItem = item => {
    let path;
    try { path = decodeURIComponent(new URL(item.url).pathname.split("/o/")[1]); } catch { return item; }
    const saved = evidence.find(file => file.path === path);
    return saved ? { ...item, url: saved.available ? saved.preservedUrl : "" } : item;
  };
  return <>
    <section className="qa-panel" aria-labelledby="qa-evidence-title">
    <h3 id="qa-evidence-title">Submitted Evidence</h3>
    {unavailable > 0 && <p className="qa-notice" role="status">{unavailable} evidence file(s) could not be found. Consider this when deciding QA.</p>}
    {media.length || commentMedia.length ? <div className="qa-evidence-grid">{[...media, ...commentMedia].map((item, index) => <Evidence key={`${item.url}-${index}`} item={preservedItem(item)} index={index} />)}</div> : <p>No evidence attached.</p>}
    </section>
    <section className="qa-panel" aria-labelledby="qa-details-title">
    <h3 id="qa-details-title">Submitted Details</h3>
    {Object.entries(snapshot).filter(([key]) => ["accessData", "meterType", "status", "ast", "discovery", "installation", "inspection", "disconnection", "reconnection", "commissioning", "removal", "meterReading", "fieldComment"].includes(key)).map(([key, value]) => <details key={key}><summary>{label(key)}</summary><Fields value={value} /></details>)}
    </section>
  </>;
}

export default function TrnQaModal({
  trnId,
  initialAction = "",
  mode = "review",
  onClose,
  onSaved,
}) {
  const dialog = useRef(null);
  const inFlight = useRef(false);
  const request = useRef(null);
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(null);
  const [action, setAction] = useState(initialAction);
  const [reasonCode, setReasonCode] = useState("");
  const [comment, setComment] = useState("");
  const [version, setVersion] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    element.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { element.close(); document.body.style.overflow = overflow; if (trigger?.isConnected) trigger.focus(); };
  }, []);
  useEffect(() => {
    let disposed = false;
    readReview({ trnId, ...(version ? { version } : {}) }).then(result => {
      if (!disposed) setContext(result.data);
    }).catch(e => { if (!disposed) setError(e.message || "The review could not be loaded."); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [trnId, version, reload]);

  function openVersion(next = "") {
    setLoading(true); setError(""); setContext(null); setSaved(null); request.current = null;
    setVersion(next); setReload(x => x + 1);
  }

  async function submit(event) {
    event.preventDefault();
    if (inFlight.current || !context?.mayReview || saved) return;
    if (!["PASS", "FAIL"].includes(action)) { setError("Choose QA Pass or QA Fail."); return; }
    if (action === "FAIL" && !reasonCode) { setError("Choose a failure reason."); return; }
    const decision = { trnId, sourceVersion: context.sourceVersion, previousReviewId: context.previousReviewId, state: action, reasonCode: action === "FAIL" ? reasonCode : null, comment: comment.trim() };
    const signature = JSON.stringify(decision);
    if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
    inFlight.current = true; setSaving(true); setError("");
    try { const result = await saveReview({ ...decision, requestId: request.current.id }); setSaved(result.data.qa); dialog.current.scrollTop = 0; onSaved?.(); }
    catch (e) { setError(e.message || "The QA decision could not be saved. Retry with the same decision if the result is uncertain."); }
    finally { inFlight.current = false; setSaving(false); }
  }

  const decision = saved || context?.qa;
  const history = saved
    ? [{ ...saved, id: saved.reviewId }, ...(context?.history || []).filter(item => item.id !== saved.reviewId)]
    : context?.history || [];
  return createPortal(<dialog ref={dialog} className="trn-qa-modal" aria-labelledby="qa-title" onCancel={event => { event.preventDefault(); if (!inFlight.current) onClose(); }}>
    <header><div><h2 id="qa-title">{mode === "history" ? "TRN QA History" : "TRN QA"}</h2><p className="qa-trn-id">{trnId}</p></div><button type="button" onClick={onClose} disabled={saving}>Close</button></header>
    <div className="qa-body" aria-busy={loading || saving}>
      {loading && <p role="status">Loading and protecting the submitted evidence…</p>}
      {error && <div className="qa-error" role="alert"><p>{error}</p><button type="button" disabled={saving} onClick={() => openVersion()}>Read current record again</button></div>}
      {context && <>
        <section className="qa-panel" aria-labelledby="qa-meter-title"><h3 id="qa-meter-title">Meter Details</h3><div className="qa-summary"><strong>{context.snapshot.ast?.astData?.astNo || "NAv"}</strong><span>{context.snapshot.accessData?.premise?.address || "NAv"}</span><span>{context.snapshot.accessData?.trnType || "NAv"}</span><strong>QA {QA_LABELS[decision?.state || context.state] || "Not eligible"}{decision?.state === "PASS" ? " · Locked" : ""}</strong><span>Submitted by {context.submitter.name}</span></div></section>
        {saved && <p className="qa-success" role="status">QA {QA_LABELS[saved.state]} saved by {saved.reviewedByUser} at {qaDate(saved.reviewedAt)}.{saved.state === "PASS" ? " This transaction is now permanently locked." : " It is awaiting correction."}</p>}
        {version && <p className="qa-notice">Viewing a preserved version. <button type="button" onClick={() => openVersion()}>Return to current review</button></p>}
        <Snapshot snapshot={context.snapshot} evidence={context.evidence} />
        {mode !== "history" && context.mayReview && !saved && <form className="qa-form" onSubmit={submit}>
          <h3>Decision</h3>
          <label>Decision<select value={action} disabled={saving} required onChange={e => setAction(e.target.value)}><option value="">Choose a decision</option><option value="PASS">QA Pass</option><option value="FAIL">QA Fail</option></select></label>
          {action === "PASS" && <p className="qa-notice">Pass is final. The submitted form, evidence and decision will be locked. A later problem requires a new transaction.</p>}
          {action === "FAIL" && <label>Failure reason (required)<select value={reasonCode} disabled={saving} required onChange={e => setReasonCode(e.target.value)}><option value="">Choose a reason</option>{context.reasons.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>}
          <label>{action === "FAIL" ? "Explanation (optional)" : "Comment (optional)"}<textarea value={comment} disabled={saving} maxLength={4000} rows={4} onChange={e => setComment(e.target.value)} /></label>
          <div className="qa-form-actions"><button type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="qa-confirm" disabled={saving || !action || (action === "FAIL" && !reasonCode)}>{saving ? "Saving QA…" : `Confirm QA ${QA_LABELS[action] || "decision"}`}</button></div>
        </form>}
        {mode !== "history" && (!context.mayReview || saved) && <section className="qa-panel"><h3>Decision</h3><p>{saved ? `QA ${QA_LABELS[saved.state]} saved.` : version ? "Viewing a preserved version." : context.reason}</p></section>}
        <section className="qa-panel qa-history" aria-labelledby="qa-history-title"><h3 id="qa-history-title">Decision History</h3>
          {history.map(item => <article key={item.id}><strong>QA {QA_LABELS[item.state]} · {item.reviewedByUser}</strong><p>{qaDate(item.reviewedAt)}</p>{item.reasonLabel && <p>{item.reasonLabel}</p>}<p className="qa-comment">{item.comment || "No comment."}</p><button type="button" disabled={saving} onClick={() => openVersion(item.sourceVersion)}>View reviewed version</button></article>)}
          {!!context.amendments?.length && <><h4>Correction history</h4>{context.amendments.map(item => <article key={item.id}>
            <strong>{workflowStateLabel(item.previousState)} → {workflowStateLabel(item.state)} · {item.byUser}</strong>
            <p>{qaDate(item.at)}</p><p className="qa-comment">{item.explanation}</p>
            {item.takeoverReason && <p>Supervisor takeover: {item.takeoverReason}</p>}
            <p>Changed fields: {item.changedPaths.map(label).join(", ")}</p>
            {!!item.meterProjection?.retainedPaths?.length && <p>Newer or different meter facts retained: {item.meterProjection.retainedPaths.map(label).join(", ")}</p>}
            <button type="button" disabled={saving} onClick={() => openVersion(item.beforeVersion)}>Before correction</button>{" "}
            <button type="button" disabled={saving} onClick={() => openVersion(item.afterVersion)}>After correction</button>
          </article>)}</>}
        </section>
      </>}
    </div>
  </dialog>, document.body);
}

export function TrnQaHistoryModal(props) {
  return <TrnQaModal {...props} mode="history" />;
}
