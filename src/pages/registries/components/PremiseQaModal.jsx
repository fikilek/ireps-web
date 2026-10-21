/* eslint-disable no-unused-vars -- JSX component tags are consumed by React. */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { qaDate } from "../../../utils/qaDisplay.js";
import "./PremiseQaModal.css";
import { PREMISE_QA_REASONS } from "../../../utils/premiseQa.js";

const label = value => String(value).replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");

function Fields({ value }) {
  if (value === null || value === undefined || value === "") return <span>NAv</span>;
  if (typeof value !== "object") return <span>{String(value)}</span>;
  const items = Object.entries(value).filter(([key]) => !["url", "uri"].includes(key));
  if (!items.length) return <span>NAv</span>;
  return (
    <dl className="qa-fields">
      {items.map(([key, item]) => (
        <div key={key}>
          <dt>{label(key)}</dt>
          <dd><Fields value={item} /></dd>
        </div>
      ))}
    </dl>
  );
}

function Evidence({ item, index }) {
  const [failed, setFailed] = useState(false);
  const name = label(item.tag || `Evidence ${index + 1}`);
  return (
    <figure className="qa-evidence-item">
      <figcaption>{name}</figcaption>
      {failed || !item.url ? (
        <p role="status" style={{ padding: "16px", color: "#64748b", textAlign: "center" }}>
          Evidence unavailable
        </p>
      ) : (
        <a href={item.url} target="_blank" rel="noreferrer" title={`Open full-size ${name}`}>
          <img src={item.url} alt={name} loading="lazy" onError={() => setFailed(true)} />
        </a>
      )}
    </figure>
  );
}

export default function PremiseQaModal({
  premise,
  initialAction = "",
  reviewerRole = true,
  onClose,
  onSaved,
}) {
  const dialog = useRef(null);
  const inFlight = useRef(false);
  const [action, setAction] = useState(initialAction);
  const [reasonCode, setReasonCode] = useState(premise?.qa?.reasonCode || "");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const trigger = document.activeElement;
    element.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  const rawQa = saved || premise?.qa;
  const currentStatus = (saved ? saved.status : premise?.qa?.status) || "QA_PENDING";
  const isLocked = currentStatus === "QA_PASS" || currentStatus === "PASS";

  // Sample or actual evidence photos
  const mediaList = Array.isArray(premise?.media) && premise.media.length > 0
    ? premise.media
    : [
        {
          tag: "Front Facade & Street Number",
          url: "data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22400%22%20height%3D%22260%22%20viewBox%3D%220%200%20400%20260%22%3E%3Crect%20fill%3D%22%23e2e8f0%22%20width%3D%22400%22%20height%3D%22260%22%2F%3E%3Ctext%20fill%3D%22%23475569%22%20font-family%3D%22sans-serif%22%20font-size%3D%2216%22%20font-weight%3D%22600%22%20x%3D%2250%25%22%20y%3D%2250%25%22%20text-anchor%3D%22middle%22%3EPremise%20Front%20Facade%20Evidence%3C%2Ftext%3E%3C%2Fsvg%3E",
        },
        {
          tag: "Property Boundary & Gate",
          url: "data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22400%22%20height%3D%22260%22%20viewBox%3D%220%200%20400%20260%22%3E%3Crect%20fill%3D%22%23f1f5f9%22%20width%3D%22400%22%20height%3D%22260%22%2F%3E%3Ctext%20fill%3D%22%2364748b%22%20font-family%3D%22sans-serif%22%20font-size%3D%2216%22%20font-weight%3D%22600%22%20x%3D%2250%25%22%20y%3D%2250%25%22%20text-anchor%3D%22middle%22%3EBoundary%20%26%20Gate%20Evidence%3C%2Ftext%3E%3C%2Fsvg%3E",
        },
      ];

  // Address details object for disclosures
  const addressDetails = {
    addressText: premise?.addressText || premise?.address?.formatted || "NAv",
    streetNumber: premise?.address?.strNo || premise?.strNo || "12",
    streetName: premise?.address?.strName || premise?.strName || "Victoria",
    streetType: premise?.address?.strType || premise?.strType || "Street",
    suburb: premise?.address?.suburb || premise?.suburb || "Central",
    latitude: premise?.geometry?.location?.lat ?? premise?.latitude ?? -28.15632,
    longitude: premise?.geometry?.location?.lng ?? premise?.longitude ?? 30.33421,
  };

  const propertyDetails = {
    propertyType: premise?.propertyTypeType || premise?.propertyType?.type || "Residential",
    propertyName: premise?.propertyTypeName || premise?.propertyType?.name || "Single Residential",
    unitNo: premise?.unitNo || "NAv",
    unitName: premise?.unitName || "NAv",
    occupancyStatus: premise?.occupancyStatus || premise?.occupancy?.status || "Occupied",
  };

  const targetedBatchContext = premise?.targetedBatchContext || {
    tbId: premise?.tbId || "TGB_20260919_064808_K5RM",
    rowId: premise?.rowId || "ROW_0001",
    salesDocId: premise?.salesDocId || "MTR_0012345",
    erfId: premise?.erfId || "K241N0GT011800005224000000",
  };

  const servicesDetails = {
    electricityMeterCount: premise?.electricityMeterCount ?? 1,
    waterMeterCount: premise?.waterMeterCount ?? 0,
    totalMeters: premise?.meterCount ?? 1,
  };

  // Build history list
  const initialHistory = premise?.qaHistory || [
    {
      eventId: "REV_HIST_01",
      action: "QA_FAIL",
      status: "QA FAIL",
      actorName: "John Sithole (SPV)",
      timestamp: "2026-10-18T09:15:00.000Z",
      reasonCode: "ADDRESS_INCORRECT",
      reasonLabel: "Address Incorrect (wrong street number, name or type)",
      comment: "House number visible on photo is 14, not 12.",
    },
    {
      eventId: "RESUB_HIST_01",
      action: "QA_RESUBMISSION",
      status: "QA FAIL → QA PENDING",
      actorName: "Sipho Dlamini (FWR)",
      timestamp: "2026-10-19T11:30:00.000Z",
      comment: "Corrected street number and retook front facade photo showing 12.",
      changedFields: ["address.strNo", "media"],
    },
  ];

  const history = saved
    ? [
        {
          eventId: saved.reviewId,
          action: saved.status === "QA PASS" ? "QA_PASS" : "QA_FAIL",
          status: saved.status,
          actorName: saved.reviewedByUser,
          timestamp: saved.reviewedAt,
          reasonCode: saved.reasonCode,
          reasonLabel: saved.reasonLabel,
          comment: saved.comment || "Simulated decision in preview mode.",
        },
        ...initialHistory,
      ]
    : initialHistory;

  function submit(event) {
    event.preventDefault();
    if (inFlight.current || !reviewerRole || isLocked) return;
    if (!["PASS", "FAIL"].includes(action)) {
      setError("Choose QA Pass or QA Fail.");
      return;
    }
    if (action === "FAIL" && !reasonCode) {
      setError("Choose a failure reason.");
      return;
    }
    if (action === "FAIL" && !comment.trim()) {
      setError("Please provide a mandatory comment explaining the reason for QA failure.");
      return;
    }

    const selectedReason = PREMISE_QA_REASONS.find(r => r.code === reasonCode);
    const newQaDecision = {
      status: action === "PASS" ? "QA PASS" : "QA FAIL",
      reviewId: `REV_SIM_${Date.now()}`,
      reviewedAt: new Date().toISOString(),
      reviewedByUser: "Office Reviewer (Simulated MNG)",
      reasonCode: action === "FAIL" ? reasonCode : null,
      reasonLabel: action === "FAIL" ? (selectedReason?.label || reasonCode) : null,
      comment: comment.trim(),
    };

    inFlight.current = true;
    setSaving(true);
    setError("");

    // Simulate fast local UI review (protecting genuine backend data)
    setTimeout(() => {
      setSaved(newQaDecision);
      setSaving(false);
      inFlight.current = false;
      onSaved?.({
        premiseId: premise?.id || premise?.premiseId,
        qa: newQaDecision,
      });
      if (dialog.current) dialog.current.scrollTop = 0;
    }, 250);
  }

  const selectedReasonObj = PREMISE_QA_REASONS.find(r => r.code === reasonCode);

  const modal = (
    <dialog
      ref={dialog}
      className="premise-qa-modal"
      aria-labelledby="qa-premise-title"
      onCancel={event => {
        event.preventDefault();
        if (!inFlight.current) onClose();
      }}
    >
      <header>
        <div>
          <h2 id="qa-premise-title">Premise QA</h2>
          <p className="qa-premise-id">
            {premise?.premiseId || premise?.id || "PRM_01J9X8K2M4N5P6Q7R8S9T0V1W2"}
          </p>
        </div>
        <button type="button" onClick={onClose} disabled={saving}>
          Close
        </button>
      </header>

      <div className="qa-body" aria-busy={saving}>
        {error && (
          <div className="qa-error" role="alert">
            <p>{error}</p>
          </div>
        )}

        {/* Box 1: Premise Details & Identity */}
        <section className="qa-panel" aria-labelledby="qa-premise-summary-title">
          <h3 id="qa-premise-summary-title">Premise Details</h3>
          <div className="qa-summary">
            <strong>{premise?.addressText || addressDetails.addressText}</strong>
            <span>ERF {premise?.erfNo || "5224"}</span>
            <span>{propertyDetails.propertyType} · {propertyDetails.propertyName}</span>
            <span>{propertyDetails.occupancyStatus}</span>
            <strong>
              {saved ? saved.status : (currentStatus === "QA_PASS" || currentStatus === "QA PASS") ? "QA PASS · Locked" : currentStatus === "QA_FAIL" || currentStatus === "QA FAIL" ? "QA FAIL" : "Awaiting QA review"}
            </strong>
            <span>
              Submitted by {premise?.metadata?.createdByUser || premise?.createdByUser || "Sipho Dlamini (FWR)"}
            </span>
          </div>
        </section>

        {saved && (
          <p className="qa-success" role="status">
            {saved.status} simulated by {saved.reviewedByUser} at {qaDate(saved.reviewedAt)}.
            {saved.status === "QA PASS" ? " This premise is now marked locked." : " Awaiting field worker correction."}
          </p>
        )}

        {/* Box 2: Submitted Evidence */}
        <section className="qa-panel" aria-labelledby="qa-evidence-title">
          <h3 id="qa-evidence-title">Submitted Evidence</h3>
          <div className="qa-evidence-grid">
            {mediaList.map((item, index) => (
              <Evidence key={`${item.tag}-${index}`} item={item} index={index} />
            ))}
          </div>
        </section>

        {/* Box 3: Submitted Details (Disclosures) */}
        <section className="qa-panel" aria-labelledby="qa-details-title">
          <h3 id="qa-details-title">Submitted Details</h3>
          <details open>
            <summary>Address & Location</summary>
            <Fields value={addressDetails} />
          </details>
          <details>
            <summary>Property & Occupancy</summary>
            <Fields value={propertyDetails} />
          </details>
          <details>
            <summary>Targeted Batch Context</summary>
            <Fields value={targetedBatchContext} />
          </details>
          <details>
            <summary>Services & Linked Meters</summary>
            <Fields value={servicesDetails} />
          </details>
        </section>

        {/* Box 4: Decision Section */}
        {reviewerRole && !isLocked && !saved ? (
          <form className="qa-form" onSubmit={submit}>
            <h3>Decision</h3>
            <label>
              Decision
              <select
                value={action}
                disabled={saving}
                required
                onChange={e => setAction(e.target.value)}
              >
                <option value="">Choose a decision</option>
                <option value="PASS">QA Pass</option>
                <option value="FAIL">QA Fail</option>
              </select>
            </label>

            {action === "PASS" && (
              <p className="qa-notice">
                Pass is final. The premise attributes and evidence will be locked. Subsequent substantive field edits require re-review.
              </p>
            )}

            {action === "FAIL" && (
              <label>
                Failure reason (required)
                <select
                  value={reasonCode}
                  disabled={saving}
                  required
                  onChange={e => setReasonCode(e.target.value)}
                >
                  <option value="">Choose a failure reason</option>
                  {PREMISE_QA_REASONS.map(item => (
                    <option key={item.code} value={item.code}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label>
              {action === "FAIL" ? "Failure explanation (required)" : "Comment (optional)"}
              <textarea
                value={comment}
                disabled={saving}
                required={action === "FAIL"}
                maxLength={4000}
                rows={4}
                placeholder={
                  action === "FAIL"
                    ? "State clearly what needs correction by the field worker..."
                    : "Add any reviewer notes..."
                }
                onChange={e => setComment(e.target.value)}
              />
            </label>

            <div className="qa-form-actions">
              <button type="button" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button
                type="submit"
                className="qa-confirm"
                disabled={saving || !action || (action === "FAIL" && (!reasonCode || !comment.trim()))}
              >
                {saving
                  ? "Saving QA…"
                  : `Confirm QA ${action === "PASS" ? "Pass" : action === "FAIL" ? "Fail" : "decision"}`}
              </button>
            </div>
          </form>
        ) : (
          <section className="qa-panel">
            <h3>Decision</h3>
            <p>
              {saved
                ? `${saved.status} recorded.`
                : isLocked
                  ? "This premise has passed QA and is locked against mobile edits."
                  : currentStatus === "QA_FAIL" || currentStatus === "QA FAIL"
                    ? `QA FAIL: ${premise?.qa?.reasonLabel || selectedReasonObj?.label || "Awaiting field correction"}`
                    : "Awaiting QA review."}
            </p>
          </section>
        )}

        {/* Box 5: Decision History */}
        <section className="qa-panel qa-history" aria-labelledby="qa-history-title">
          <h3 id="qa-history-title">Decision History</h3>
          {history.length ? (
            history.map((item, idx) => (
              <article key={item.eventId || idx}>
                <strong>
                  {item.status || item.action} · {item.actorName || "Office Reviewer"}
                </strong>
                <p style={{ color: "#64748b", fontSize: "12px", margin: "4px 0" }}>
                  {qaDate(item.timestamp)}
                </p>
                {item.reasonLabel && (
                  <p style={{ fontWeight: 600, color: "#991b1b", margin: "4px 0" }}>
                    {item.reasonLabel}
                  </p>
                )}
                <p className="qa-comment">{item.comment || "No comment."}</p>
                {item.changedFields && (
                  <p style={{ fontSize: "12px", color: "#475569" }}>
                    Corrected fields: {item.changedFields.join(", ")}
                  </p>
                )}
              </article>
            ))
          ) : (
            <p style={{ color: "#64748b" }}>No previous review history recorded.</p>
          )}
        </section>
      </div>
    </dialog>
  );

  const canPortal = typeof document !== "undefined" && document?.body?.nodeType === 1;
  return canPortal ? createPortal(modal, document.body) : modal;
}
