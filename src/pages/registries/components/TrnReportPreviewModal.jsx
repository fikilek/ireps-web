/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { httpsCallable } from "firebase/functions";

import { functions } from "../../../firebase";

import { useGetTrnByIdQuery } from "../../../redux/trnsApi";
import { buildQuickTrnPdfArtifact } from "../../../utils/reportPlatform/buildQuickTrnPdfArtifact";

const getQuickTrnMedia = httpsCallable(functions, "getQuickTrnMediaCallable");

function decodeBase64Bytes(value) {
  const binary = window.atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function loadQuickTrnMediaBytes({
  trnId,
  mediaIndex,
  source = "TRN",
}) {
  const action = source === "PREMISE" ? "PREMISE_MEDIA" : "TRN_MEDIA";
  const result = await getQuickTrnMedia({ trnId, mediaIndex, action });
  const payload = result?.data || {};
  const bytes = decodeBase64Bytes(payload.bytesBase64);

  if (!bytes.byteLength) {
    throw new Error("The Quick TRN media service returned no image bytes.");
  }

  return {
    bytes,
    contentType: payload.contentType || "application/octet-stream",
  };
}

async function loadQuickTrnPremiseContext({ trnId }) {
  const result = await getQuickTrnMedia({
    trnId,
    action: "PREMISE_CONTEXT",
  });

  return result?.data?.premise || null;
}

function PdfFrame({ artifact }) {
  const [objectUrl] = useState(() =>
    URL.createObjectURL(
      new Blob([artifact.bytes], {
        type: "application/pdf",
      }),
    ),
  );

  useEffect(() => {
    return () => URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  return (
    <iframe
      title="TRN report PDF preview"
      src={objectUrl}
      style={styles.previewFrame}
    />
  );
}

function downloadPdfArtifact(artifact) {
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

export default function TrnReportPreviewModal({ trnId, onClose }) {
  const [artifactBundle, setArtifactBundle] = useState(null);
  const [buildError, setBuildError] = useState(null);

  const {
    data: trn,
    isLoading,
    isFetching,
    error: trnError,
  } = useGetTrnByIdQuery(trnId);

  useEffect(() => {
    if (!trn) return undefined;

    let cancelled = false;

    async function buildReport() {
      const premise = await loadQuickTrnPremiseContext({ trnId });

      return buildQuickTrnPdfArtifact(trn, {
        premise,
        loadMediaBytes: ({ mediaIndex }) =>
          loadQuickTrnMediaBytes({
            trnId,
            mediaIndex,
            source: "TRN",
          }),
        loadPremiseMediaBytes: ({ mediaIndex }) =>
          loadQuickTrnMediaBytes({
            trnId,
            mediaIndex,
            source: "PREMISE",
          }),
      });
    }

    buildReport()
      .then((result) => {
        if (!cancelled) setArtifactBundle(result);
      })
      .catch((error) => {
        if (!cancelled) {
          setBuildError(error?.message || "The TRN PDF could not be generated.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [trn, trnId]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose?.();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function handleBackdropClick(event) {
    if (event.target === event.currentTarget) onClose?.();
  }

  const artifact = artifactBundle?.artifact || null;
  const isBusy = isLoading || isFetching || (trn && !artifactBundle && !buildError);
  const errorMessage =
    trnError?.error ||
    trnError?.data?.message ||
    buildError ||
    (!isBusy && !trn ? "The exact TRN could not be found." : "");

  if (typeof document === "undefined") return null;

  return createPortal(
    <div style={styles.backdrop} onMouseDown={handleBackdropClick} role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="trn-report-preview-title"
        style={styles.modal}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>TRN Report</div>
            <h2 id="trn-report-preview-title" style={styles.title}>
              Quick TRN Report
            </h2>
            <div style={styles.subtitle}>{trnId}</div>
          </div>

          <button type="button" style={styles.closeButton} onClick={onClose}>
            Close
          </button>
        </header>

        <div style={styles.body}>
          {isBusy ? (
            <div style={styles.stateCard}>
              <strong>Generating canonical TRN PDF...</strong>
              <span>
                Reading the exact TRN and building one PDF artifact for preview
                and download.
              </span>
            </div>
          ) : null}

          {!isBusy && errorMessage ? (
            <div style={styles.errorCard}>
              <strong>Unable to generate TRN report.</strong>
              <span>{errorMessage}</span>
            </div>
          ) : null}

          {artifact ? (
            <div style={styles.previewShell}>
              <PdfFrame key={artifact.fileName} artifact={artifact} />
            </div>
          ) : null}
        </div>

        <footer style={styles.footer}>
          <div style={styles.statusArea}>
            {artifact ? (
              <span style={styles.fileName}>{artifact.fileName}</span>
            ) : null}
          </div>

          <div style={styles.actions}>
            <button type="button" style={styles.secondaryButton} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              style={styles.secondaryButton}
              disabled={!artifact}
              onClick={() => artifact && downloadPdfArtifact(artifact)}
            >
              Download
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

const styles = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 3500,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1rem",
    background: "rgba(15, 23, 42, 0.72)",
    backdropFilter: "blur(2px)",
  },
  modal: {
    width: "min(1180px, 98vw)",
    height: "min(920px, 94vh)",
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr) auto",
    overflow: "hidden",
    borderRadius: "1rem",
    background: "#ffffff",
    boxShadow: "0 30px 90px rgba(15, 23, 42, 0.4)",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "1.15rem 1.35rem",
    background: "#0f172a",
    color: "#ffffff",
  },
  eyebrow: {
    color: "#93c5fd",
    fontSize: "0.72rem",
    fontWeight: 900,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
  },
  title: {
    margin: "0.25rem 0 0",
    fontSize: "1.55rem",
  },
  subtitle: {
    marginTop: "0.35rem",
    color: "#cbd5e1",
    fontSize: "0.8rem",
    overflowWrap: "anywhere",
  },
  closeButton: {
    border: "1px solid #475569",
    borderRadius: "0.7rem",
    padding: "0.65rem 1rem",
    background: "#1e293b",
    color: "#ffffff",
    fontWeight: 850,
    cursor: "pointer",
  },
  body: {
    minHeight: 0,
    overflow: "hidden",
    padding: "0.9rem",
    background: "#e2e8f0",
  },
  previewShell: {
    width: "100%",
    height: "100%",
    minHeight: "420px",
    borderRadius: "0.75rem",
    overflow: "hidden",
    background: "#ffffff",
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.15)",
  },
  previewFrame: {
    display: "block",
    width: "100%",
    height: "100%",
    border: 0,
    background: "#ffffff",
  },
  stateCard: {
    display: "grid",
    gap: "0.45rem",
    maxWidth: "560px",
    margin: "3rem auto",
    padding: "1.2rem",
    borderRadius: "0.8rem",
    background: "#ffffff",
    color: "#334155",
    textAlign: "center",
  },
  errorCard: {
    display: "grid",
    gap: "0.45rem",
    maxWidth: "620px",
    margin: "3rem auto",
    padding: "1.2rem",
    border: "1px solid #fecaca",
    borderRadius: "0.8rem",
    background: "#fef2f2",
    color: "#991b1b",
    textAlign: "center",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "0.85rem 1rem",
    borderTop: "1px solid #cbd5e1",
    background: "#ffffff",
  },
  statusArea: {
    display: "grid",
    gap: "0.2rem",
    minWidth: 0,
  },
  fileName: {
    color: "#475569",
    fontSize: "0.78rem",
    fontWeight: 750,
    overflowWrap: "anywhere",
  },
  statusMessage: {
    color: "#166534",
    fontSize: "0.76rem",
    fontWeight: 750,
  },
  errorMessage: {
    color: "#b91c1c",
    fontSize: "0.76rem",
    fontWeight: 750,
  },
  actions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "0.55rem",
    flexWrap: "wrap",
  },
  secondaryButton: {
    border: "1px solid #cbd5e1",
    borderRadius: "0.65rem",
    padding: "0.65rem 0.9rem",
    background: "#ffffff",
    color: "#0f172a",
    fontWeight: 850,
    cursor: "pointer",
  },
  primaryButton: {
    border: 0,
    borderRadius: "0.65rem",
    padding: "0.68rem 1rem",
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 900,
    cursor: "pointer",
  },
};
