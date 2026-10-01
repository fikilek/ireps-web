/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
// The Meter Report, previewed and downloaded — one meter, everything iREPS
// holds about it, the way the Quick TRN Report does for one transaction.
import { useEffect, useMemo, useState } from "react";

import { useGetMeterDossierQuery } from "../../../redux/creditControlApi";
import { buildMeterPdfArtifact } from "../../../utils/reportPlatform/buildMeterPdfArtifact";

const MODAL_CSS = `
.mr-overlay {
  position: fixed; inset: 0; z-index: 1200;
  background: rgba(15, 23, 42, .6);
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
.mr-card {
  background: #fff; border-radius: 10px; width: min(900px, 100%);
  height: min(88vh, 900px); display: flex; flex-direction: column;
  box-shadow: 0 18px 40px rgba(15, 23, 42, .3);
}
.mr-header {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 14px 18px; border-bottom: 1px solid #e2e8f0;
}
.mr-eyebrow { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #64748b; }
.mr-header h2 { margin: 2px 0 0; font-size: 18px; }
.mr-sub { font-size: 12.5px; color: #64748b; margin-top: 2px; }
.mr-actions { display: flex; gap: 8px; align-items: center; }
.mr-button {
  border: 1px solid #1d4ed8; background: #1d4ed8; color: #fff; border-radius: 7px;
  padding: 7px 14px; cursor: pointer; font-size: 13px; font-weight: 700;
}
.mr-button[disabled] { background: #cbd5e1; border-color: #cbd5e1; cursor: not-allowed; }
.mr-close { border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 13px; }
.mr-body { flex: 1; min-height: 0; padding: 12px 18px 18px; display: flex; }
.mr-frame { flex: 1; width: 100%; border: 1px solid #e2e8f0; border-radius: 8px; }
.mr-state { padding: 18px; color: #64748b; font-size: 14px; }
`;

function downloadArtifact(artifact) {
  const objectUrl = URL.createObjectURL(
    new Blob([artifact.bytes], { type: "application/pdf" }),
  );
  const anchor = document.createElement("a");

  anchor.href = objectUrl;
  anchor.download = artifact.fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);

  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
}

export default function MeterReportPreviewModal({
  meterId,
  meterNo,
  premiseAddress,
  onClose,
}) {
  const [artifact, setArtifact] = useState(null);
  const [buildError, setBuildError] = useState(null);

  const {
    data: dossier,
    isLoading,
    isFetching,
    error,
  } = useGetMeterDossierQuery(meterId, { skip: !meterId });

  useEffect(() => {
    let cancelled = false;

    if (!dossier?.meter) return undefined;

    setArtifact(null);
    setBuildError(null);

    buildMeterPdfArtifact(dossier)
      .then((built) => {
        if (!cancelled) setArtifact(built);
      })
      .catch((reason) => {
        if (!cancelled) {
          setBuildError(reason?.message || String(reason));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dossier]);

  const objectUrl = useMemo(
    () =>
      artifact
        ? URL.createObjectURL(new Blob([artifact.bytes], { type: "application/pdf" }))
        : null,
    [artifact],
  );

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

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

  const busy = isLoading || isFetching || (!artifact && !buildError && !error);

  return (
    <div
      className="mr-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="meter-report-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <style>{MODAL_CSS}</style>

      <div className="mr-card">
        <header className="mr-header">
          <div>
            <div className="mr-eyebrow">Meter report</div>
            <h2 id="meter-report-title">{meterNo || meterId}</h2>
            <div className="mr-sub">
              {premiseAddress || "NAv"}
              {dossier?.transactions?.length
                ? ` · ${dossier.transactions.length} transaction${dossier.transactions.length === 1 ? "" : "s"}`
                : ""}
            </div>
          </div>

          <div className="mr-actions">
            <button
              type="button"
              className="mr-button"
              disabled={!artifact}
              onClick={() => artifact && downloadArtifact(artifact)}
            >
              Download
            </button>
            <button type="button" className="mr-close" onClick={onClose}>
              Close
            </button>
          </div>
        </header>

        <div className="mr-body">
          {error ? (
            <div className="mr-state">
              This meter could not be read. {error?.error || ""}
            </div>
          ) : buildError ? (
            <div className="mr-state">The report could not be made. {buildError}</div>
          ) : busy ? (
            <div className="mr-state">Making the report…</div>
          ) : (
            <iframe title="Meter report preview" src={objectUrl} className="mr-frame" />
          )}
        </div>
      </div>
    </div>
  );
}
