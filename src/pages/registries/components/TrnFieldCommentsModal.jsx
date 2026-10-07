/* eslint-disable no-unused-vars -- JSX component tags are consumed by React. */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useGetTrnByIdQuery } from "../../../redux/trnsApi";
import { getFieldComments } from "../../../utils/fieldComments.js";
import FieldCommentIcon from "./FieldCommentIcon";
import "./TrnFieldCommentsModal.css";

function CommentMedia({ item, kind, index, onEnlarge }) {
  const [failed, setFailed] = useState(false);
  const label = `Field Comment ${kind === "photo" ? "Photo" : kind === "voice" ? "Voice Clip" : "Video"} ${index + 1}`;
  if (!item.url || failed) return <p className="fc-media-unavailable" role="status">{label} unavailable.</p>;
  if (kind === "photo") return (
    <button type="button" className="fc-photo-button" onClick={onEnlarge} aria-label={`Enlarge ${label}`}>
      <img src={item.url} alt={label} loading="lazy" onError={() => setFailed(true)} />
      <span>Enlarge photo {index + 1}</span>
    </button>
  );
  return (
    <div className="fc-player">
      <span className="fc-player-label">{label}</span>
      {kind === "voice"
        ? <audio controls preload="none" src={item.url} aria-label={label} onError={() => setFailed(true)} />
        : <video controls playsInline preload="none" src={item.url} aria-label={label} onError={() => setFailed(true)} />}
    </div>
  );
}

export function FieldCommentsContent({ comments, onEnlarge }) {
  return <div className="fc-content-grid">
    <section className="fc-text-section">
      <h3><FieldCommentIcon kind="text" />Field Comment Text</h3>
      <p className="fc-comment-text">{comments.text}</p>
    </section>
    {[
      ["photos", "photo", "Field Comment Photo"],
      ["voiceClips", "voice", "Field Comment Voice Clip"],
      ["videos", "video", "Field Comment Video"],
    ].map(([key, kind, label]) => <section key={key} className={`fc-${kind}-section`}>
      <h3><FieldCommentIcon kind={kind} />{label}</h3>
      {comments[key].length ? <div className="fc-media-list">{comments[key].map((item, index) => (
        <CommentMedia key={`${item.key}-${item.url}`} item={item} kind={kind} index={index} onEnlarge={() => onEnlarge(item, index)} />
      ))}</div> : <p className="fc-empty">NAv</p>}
    </section>)}
  </div>;
}

export default function TrnFieldCommentsModal({ trnId, onClose }) {
  const dialogRef = useRef(null);
  const backRef = useRef(null);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  const { currentData: trn, isLoading, isFetching, error, refetch } = useGetTrnByIdQuery(trnId, { refetchOnMountOrArgChange: true });
  const busy = isLoading || isFetching;
  const raw = trn?.raw || {};
  const comments = getFieldComments(raw);

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  useEffect(() => {
    if (selectedPhoto) backRef.current?.focus();
  }, [selectedPhoto]);

  function enlarge(item, index) {
    // Moving to the photo view unmounts the players, stopping playback.
    setPhotoFailed(false);
    setSelectedPhoto({ ...item, index });
  }

  function backToComments() {
    const photoIndex = selectedPhoto?.index;
    setSelectedPhoto(null);
    requestAnimationFrame(() => dialogRef.current?.querySelector(`[aria-label="Enlarge Field Comment Photo ${photoIndex + 1}"]`)?.focus());
  }

  function handleCancel(event) {
    event.preventDefault();
    if (selectedPhoto) backToComments();
    else onClose();
  }

  function handleBackdrop(event) {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }

  function handleTab(event) {
    if (event.key !== "Tab") return;
    // Native dialog makes the page inert; wrap at the endpoints as well so
    // sequential focus does not leave the dialog for the browser chrome.
    const controls = [...dialogRef.current.querySelectorAll("button:not(:disabled), audio[controls], video[controls]")].filter(element => element.getClientRects().length);
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  return createPortal(
    <dialog ref={dialogRef} className="trn-field-comments" aria-labelledby="trn-field-comments-title" onCancel={handleCancel} onClick={handleBackdrop} onKeyDown={handleTab}>
      <header className="fc-modal-header">
        <div>
          <h2 id="trn-field-comments-title">Field Comments</h2>
          {!busy && !error && trn ? <p className="fc-context"><strong>{raw.ast?.astData?.astNo || trn.astNo || "NAv"}</strong> · {raw.accessData?.premise?.address || "NAv"}</p> : null}
          <p className="fc-trn-id">{trnId}</p>
        </div>
        <button type="button" className="fc-close-button" aria-label="Close field comments" onClick={onClose}>Close</button>
      </header>
      <div className="fc-modal-body" aria-busy={busy}>
        {busy ? <p role="status">Loading field comments…</p> : error ? <div role="alert"><p>Unable to load field comments.</p><button className="fc-secondary-button" type="button" onClick={() => refetch()}>Retry</button></div> : !trn ? <p role="status">Transaction not found.</p> : selectedPhoto ? (
          <div className="fc-enlarged-photo">
            <button ref={backRef} type="button" className="fc-secondary-button" onClick={backToComments}>← Back to comments</button>
            <h3>Field Comment Photo {selectedPhoto.index + 1}</h3>
            {photoFailed ? <p role="status">Photo unavailable.</p> : <img src={selectedPhoto.url} alt={`Enlarged Field Comment Photo ${selectedPhoto.index + 1}`} onError={() => setPhotoFailed(true)} />}
          </div>
        ) : <FieldCommentsContent comments={comments} onEnlarge={enlarge} />}
      </div>
      <footer className="fc-modal-footer"><span>Read-only</span><button type="button" className="fc-primary-button" onClick={onClose}>Close</button></footer>
    </dialog>,
    document.body,
  );
}
