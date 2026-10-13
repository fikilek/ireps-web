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
    <h3>Submitted evidence</h3>
    {unavailable > 0 && <p className="qa-notice" role="status">{unavailable} evidence file(s) could not be found. Consider this when deciding QA.</p>}
    {media.length || commentMedia.length ? <div className="qa-evidence-grid">{[...media, ...commentMedia].map((item, index) => <Evidence key={`${item.url}-${index}`} item={preservedItem(item)} index={index} />)}</div> : <p>No evidence attached.</p>}
    <h3>Submitted details</h3>
    {Object.entries(snapshot).filter(([key]) => ["accessData", "meterType", "status", "ast", "discovery", "installation", "inspection", "disconnection", "reconnection", "commissioning", "removal", "meterReading", "fieldComment"].includes(key)).map(([key, value]) => <details key={key} open={key === "accessData" || key === "fieldComment"}><summary>{label(key)}</summary><Fields value={value} /></details>)}
  </>;
}

export default function TrnQaModal({ trnId, initialAction = "", onClose, onSaved }) {
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
    if (action === "FAIL" && (!reasonCode || !comment.trim())) { setError("Choose a failure reason and explain why the transaction failed."); return; }
    const decision = { trnId, sourceVersion: context.sourceVersion, previousReviewId: context.previousReviewId, state: action, reasonCode: action === "FAIL" ? reasonCode : null, comment: comment.trim() };
    const signature = JSON.stringify(decision);
    if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
    inFlight.current = true; setSaving(true); setError("");
    try { const result = await saveReview({ ...decision, requestId: request.current.id }); setSaved(result.data.qa); dialog.current.scrollTop = 0; onSaved?.(); }
    catch (e) { setError(e.message || "The QA decision could not be saved. Retry with the same decision if the result is uncertain."); }
    finally { inFlight.current = false; setSaving(false); }
  }

  const decision = saved || context?.qa;
  return createPortal(<dialog ref={dialog} className="trn-qa-modal" aria-labelledby="qa-title" onCancel={event => { event.preventDefault(); if (!inFlight.current) onClose(); }}>
    <header><div><h2 id="qa-title">Transaction QA</h2><p className="qa-trn-id">{trnId}</p></div><button type="button" onClick={onClose} disabled={saving}>Close</button></header>
    <div className="qa-body" aria-busy={loading || saving}>
      {loading && <p role="status">Loading and protecting the submitted evidence…</p>}
      {error && <div className="qa-error" role="alert"><p>{error}</p><button type="button" disabled={saving} onClick={() => openVersion()}>Read current record again</button></div>}
      {context && <>
        <div className="qa-summary"><strong>{context.snapshot.ast?.astData?.astNo || "NAv"}</strong><span>{context.snapshot.accessData?.premise?.address || "NAv"}</span><span>{context.snapshot.accessData?.trnType || "NAv"}</span><strong>QA {QA_LABELS[decision?.state || context.state] || "Not eligible"}{decision?.state === "PASS" ? " · Locked" : ""}</strong><span>Submitted by {context.submitter.name}</span></div>
        {saved && <p className="qa-success" role="status">QA {QA_LABELS[saved.state]} saved by {saved.reviewedByUser} at {qaDate(saved.reviewedAt)}.{saved.state === "PASS" ? " This transaction is now permanently locked." : " It is awaiting correction."}</p>}
        {decision && <section className="qa-decision"><h3>Latest decision</h3><p>{decision.reviewedByUser} · {qaDate(decision.reviewedAt)}</p>{decision.reasonLabel && <p><strong>{decision.reasonLabel}</strong></p>}<p className="qa-comment">{decision.comment || "No comment."}</p></section>}
        {version && <p className="qa-notice">Viewing a preserved version. <button type="button" onClick={() => openVersion()}>Return to current review</button></p>}
        <Snapshot snapshot={context.snapshot} evidence={context.evidence} />
        {!context.mayReview && !version && !saved && <p className="qa-notice">{context.reason}</p>}
        {context.mayReview && !saved && <form className="qa-form" onSubmit={submit}>
          <h3>Confirm your decision</h3>
          <label>Decision<select value={action} disabled={saving} required onChange={e => setAction(e.target.value)}><option value="">Choose a decision</option><option value="PASS">QA Pass</option><option value="FAIL">QA Fail</option></select></label>
          {action === "PASS" && <p className="qa-notice">Pass is final. The submitted form, evidence and decision will be locked. A later problem requires a new transaction.</p>}
          {action === "FAIL" && <label>Failure reason<select value={reasonCode} disabled={saving} required onChange={e => setReasonCode(e.target.value)}><option value="">Choose a reason</option>{context.reasons.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>}
          <label>{action === "FAIL" ? "Explanation (required)" : "Comment (optional)"}<textarea value={comment} disabled={saving} required={action === "FAIL"} maxLength={4000} rows={4} onChange={e => setComment(e.target.value)} /></label>
          <div className="qa-form-actions"><button type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="qa-confirm" disabled={saving || !action || (action === "FAIL" && (!reasonCode || !comment.trim()))}>{saving ? "Saving QA…" : `Confirm QA ${QA_LABELS[action] || "decision"}`}</button></div>
        </form>}
        <section className="qa-history"><h3>Decision history</h3>{context.history.length ? context.history.map(item => <article key={item.id}><strong>QA {QA_LABELS[item.state]} · {item.reviewedByUser}</strong><p>{qaDate(item.reviewedAt)}</p>{item.reasonLabel && <p>{item.reasonLabel}</p>}<p className="qa-comment">{item.comment || "No comment."}</p><button type="button" disabled={saving} onClick={() => openVersion(item.sourceVersion)}>View reviewed version</button></article>) : <p>{saved ? "Close and reopen to view the saved history." : "No QA decisions yet."}</p>}</section>
      </>}
    </div>
  </dialog>, document.body);
}
