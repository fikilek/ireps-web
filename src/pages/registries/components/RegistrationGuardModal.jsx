/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
// DR-R001 3.1: a meter iREPS cannot account for never reaches a worker.
//
// This window says which link is broken, in words, with the meter number and
// the transaction id somebody needs to fix it. It never says "something went
// wrong", and it never lets the work through.
import { useEffect } from "react";

const MODAL_CSS = `
.guard-modal-overlay {
  position: fixed; inset: 0; z-index: 1200;
  background: rgba(15, 23, 42, .55);
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
.guard-modal-card {
  background: #fff; border-radius: 10px; width: min(620px, 100%);
  max-height: 86vh; display: flex; flex-direction: column;
  box-shadow: 0 18px 40px rgba(15, 23, 42, .25);
}
.guard-modal-header {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 14px 18px; border-bottom: 1px solid #e2e8f0;
}
.guard-modal-eyebrow { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #b45309; }
.guard-modal-header h2 { margin: 2px 0 0; font-size: 17px; }
.guard-modal-close {
  border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 6px;
  padding: 4px 10px; cursor: pointer; font-size: 13px;
}
.guard-modal-body { padding: 16px 18px; overflow: auto; display: grid; gap: 12px; }
.guard-modal-message { font-size: 14.5px; line-height: 1.5; margin: 0; }
.guard-modal-checks { border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
.guard-modal-check {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 9px 12px; border-top: 1px solid #eef2f6; font-size: 13.5px;
}
.guard-modal-check:first-child { border-top: 0; }
.guard-modal-check-label { display: flex; flex-direction: column; }
.guard-modal-check-detail { font-size: 11.5px; color: #64748b; word-break: break-all; }
.guard-modal-ok { color: #15803d; font-weight: 600; font-size: 12px; }
.guard-modal-bad { color: #b91c1c; font-weight: 600; font-size: 12px; }
.guard-modal-foot { font-size: 12.5px; color: #64748b; }
`;

// One line per check, in the order DR-R001 3.1 lists them.
const CHECK_LABELS = {
  METER_RECORD: "Meter record",
  REGISTRATION_TRN: "The registration that created it",
  REGISTRATION_KIND: "A Meter Discovery or a Meter Installation",
  REGISTRATION_NAMES_METER: "The registration names this meter",
  REGISTRATION_HAD_ACCESS: "The worker reached the meter that day",
  METER_MASTER: "Meter master holds this number",
  PREMISE_LINK: "The premise lists this meter",
};

export default function RegistrationGuardModal({
  meterNo,
  meterId,
  message,
  checks = [],
  onClose,
}) {
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
      className="guard-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="registration-guard-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <style>{MODAL_CSS}</style>

      <div className="guard-modal-card">
        <header className="guard-modal-header">
          <div>
            <div className="guard-modal-eyebrow">Cannot be worked on yet</div>
            <h2 id="registration-guard-title">{meterNo || meterId}</h2>
          </div>

          <button type="button" className="guard-modal-close" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="guard-modal-body">
          <p className="guard-modal-message">
            {message ||
              "iREPS cannot account for this meter, so no work can be sent to it."}
          </p>

          {checks.length ? (
            <div className="guard-modal-checks">
              {checks.map((check) => (
                <div className="guard-modal-check" key={check.key}>
                  <span className="guard-modal-check-label">
                    <span>{CHECK_LABELS[check.key] || check.key}</span>
                    {check.detail ? (
                      <span className="guard-modal-check-detail">
                        {check.detail}
                      </span>
                    ) : null}
                  </span>

                  <span className={check.ok ? "guard-modal-ok" : "guard-modal-bad"}>
                    {check.ok ? "ok" : "missing"}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="guard-modal-foot">
            Meter {meterNo || "NAv"} · {meterId || "NAv"}. Give these two to
            whoever fixes it: the work cannot be issued until the records agree.
          </div>
        </div>
      </div>
    </div>
  );
}
