/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
// DR-R001 3.3: the No Access number on the Meter Registry is a button, and
// this is what it opens — every visit to this meter that ended because nobody
// could reach it, newest first. When, who, what work, and the reason he gave.
//
// It reads the transactions and keeps nothing of its own.
import { useEffect } from "react";

import { useGetMeterNoAccessHistoryQuery } from "../../../redux/creditControlApi";

const MODAL_CSS = `
.na-modal-overlay {
  position: fixed; inset: 0; z-index: 1200;
  background: rgba(15, 23, 42, .55);
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
.na-modal-card {
  background: #fff; border-radius: 10px; width: min(760px, 100%);
  max-height: 86vh; display: flex; flex-direction: column;
  box-shadow: 0 18px 40px rgba(15, 23, 42, .25);
}
.na-modal-header {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 14px 18px; border-bottom: 1px solid #e2e8f0;
}
.na-modal-eyebrow { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #64748b; }
.na-modal-header h2 { margin: 2px 0 0; font-size: 18px; }
.na-modal-sub { font-size: 12.5px; color: #64748b; margin-top: 2px; }
.na-modal-close {
  border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 6px;
  padding: 4px 10px; cursor: pointer; font-size: 13px;
}
.na-modal-body { padding: 0; overflow: auto; }
.na-modal-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.na-modal-table th, .na-modal-table td {
  text-align: left; padding: 9px 14px; border-bottom: 1px solid #eef2f6; vertical-align: top;
}
.na-modal-table th {
  font-size: 11px; letter-spacing: .07em; text-transform: uppercase; color: #64748b;
  position: sticky; top: 0; background: #f8fafc;
}
.na-modal-when { font-variant-numeric: tabular-nums; white-space: nowrap; }
.na-modal-state { padding: 18px; color: #64748b; font-size: 14px; }
`;

function formatWhen(value) {
  if (!value || value === "NAv") return "NAv";

  if (typeof value === "string") return value.slice(0, 16).replace("T", " ");

  if (typeof value?.toDate === "function") {
    return value.toDate().toLocaleString();
  }

  return "NAv";
}

function formatWork(value) {
  return String(value || "NAv")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function MeterNoAccessHistoryModal({
  meterId,
  meterNo,
  premiseAddress,
  onClose,
}) {
  const {
    data: visits = [],
    isLoading,
    isFetching,
    error,
  } = useGetMeterNoAccessHistoryQuery(meterId, { skip: !meterId });

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose?.();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="na-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="meter-no-access-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <style>{MODAL_CSS}</style>

      <div className="na-modal-card">
        <header className="na-modal-header">
          <div>
            <div className="na-modal-eyebrow">No Access</div>
            <h2 id="meter-no-access-title">{meterNo || meterId}</h2>
            <div className="na-modal-sub">
              {premiseAddress || "NAv"}
              {visits.length ? ` · ${visits.length} visit${visits.length === 1 ? "" : "s"}` : ""}
            </div>
          </div>

          <button type="button" className="na-modal-close" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="na-modal-body">
          {isLoading || isFetching ? (
            <div className="na-modal-state">Reading this meter's visits…</div>
          ) : error ? (
            <div className="na-modal-state">
              The visits could not be read. {error?.error || ""}
            </div>
          ) : visits.length === 0 ? (
            <div className="na-modal-state">
              Nobody has been refused entry to this meter.
            </div>
          ) : (
            <table className="na-modal-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Field worker</th>
                  <th>Work</th>
                  <th>Reason given</th>
                </tr>
              </thead>
              <tbody>
                {visits.map((visit) => (
                  <tr key={visit.id}>
                    <td className="na-modal-when">{formatWhen(visit.when)}</td>
                    <td>{visit.worker}</td>
                    <td>{formatWork(visit.trnType)}</td>
                    <td>{visit.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
