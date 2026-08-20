/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { httpsCallable } from "firebase/functions";

import { functions } from "../../../firebase";

import { useGetTrnByIdQuery } from "../../../redux/trnsApi";
import { buildQuickTrnPdfArtifact } from "../../../utils/reportPlatform/buildQuickTrnPdfArtifact";
import { persistGeneratedReport } from "../../../utils/reportPlatform/persistGeneratedReport";
import { authorizeGeneratedReportDownload } from "../../../utils/reportPlatform/generatedReportsClient";
import { sendGeneratedReportEmail } from "../../../utils/reportPlatform/generatedReportEmailClient";


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
  const [saveState, setSaveState] = useState({
    status: "idle",
    message: "",
  });
  const [shareState, setShareState] = useState({
    status: "idle",
    message: "",
  });
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailForm, setEmailForm] = useState({
    to: "",
    subject: `Quick TRN Report - ${trnId}`,
    message: "Please find the attached iREPS TRN Report.",
  });
  const [emailState, setEmailState] = useState({
    status: "idle",
    message: "",
  });
  const persistedReportRef = useRef(null);
  const persistencePromiseRef = useRef(null);

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
      if (event.key !== "Escape") return;

      if (emailOpen) {
        setEmailOpen(false);
        return;
      }

      onClose?.();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [emailOpen, onClose]);

  async function ensurePersistedReport() {
    if (!artifactBundle) {
      throw new Error("The canonical TRN PDF is not ready yet.");
    }

    if (persistedReportRef.current) return persistedReportRef.current;

    if (!persistencePromiseRef.current) {
      persistencePromiseRef.current = persistGeneratedReport(artifactBundle)
        .then((result) => {
          persistedReportRef.current = result;
          return result;
        })
        .finally(() => {
          persistencePromiseRef.current = null;
        });
    }

    return persistencePromiseRef.current;
  }

  function getPersistedReportId(result) {
    return result?.lifecycle?.reportId || result?.reportId || null;
  }

  async function handleSave() {
    if (!artifactBundle || saveState.status === "saving") return;

    setSaveState({ status: "saving", message: "Saving to Generated Reports..." });

    try {
      const result = await ensurePersistedReport();
      const reportId = getPersistedReportId(result);
      setSaveState({
        status: "saved",
        message: reportId
          ? `Saved to Generated Reports (${reportId}).`
          : "Saved to Generated Reports.",
      });
    } catch (error) {
      setSaveState({
        status: "error",
        message: error?.message || "The report could not be saved.",
      });
    }
  }

  async function getSecureShareLink() {
    const persistedReport = await ensurePersistedReport();
    const authorized = await authorizeGeneratedReportDownload(persistedReport);

    if (!authorized?.downloadUrl) {
      throw new Error("A secure report download link could not be created.");
    }

    const reportId = getPersistedReportId(persistedReport);
    setSaveState({
      status: "saved",
      message: reportId
        ? `Saved to Generated Reports (${reportId}).`
        : "Saved to Generated Reports.",
    });

    return authorized.downloadUrl;
  }

  function handleEmail() {
    if (!artifactBundle) return;

    setEmailForm({
      to: "",
      subject: `Quick TRN Report - ${trnId}`,
      message: "Please find the attached iREPS TRN Report.",
    });
    setEmailState({ status: "idle", message: "" });
    setEmailOpen(true);
  }

  async function handleSendEmail(event) {
    event.preventDefault();

    if (emailState.status === "sending" || emailState.status === "sent") return;

    const to = emailForm.to.trim();
    const subject = emailForm.subject.trim();

    if (!to || !subject) {
      setEmailState({
        status: "error",
        message: "Recipient and subject are required.",
      });
      return;
    }

    setEmailState({
      status: "sending",
      message: "Saving the exact PDF before email delivery...",
    });

    try {
      const persistedReport = await ensurePersistedReport();
      const reportId = getPersistedReportId(persistedReport);

      setSaveState({
        status: "saved",
        message: reportId
          ? `Saved to Generated Reports (${reportId}).`
          : "Saved to Generated Reports.",
      });
      setEmailState({
        status: "sending",
        message: "Sending PDF from reports@ireps.co.za...",
      });

      await sendGeneratedReportEmail({
        report: persistedReport,
        to,
        subject,
        message: emailForm.message,
      });

      setEmailState({
        status: "sent",
        message: `Email sent successfully to ${to}.`,
      });
      setShareState({
        status: "ready",
        message: `Email sent successfully to ${to}.`,
      });
    } catch (error) {
      setEmailState({
        status: "error",
        message: error?.message || "The report email could not be sent.",
      });
    }
  }

  async function handleWhatsApp() {
    if (!artifactBundle || shareState.status === "preparing") return;

    const shareWindow = window.open("about:blank", "_blank");

    setShareState({
      status: "preparing",
      message: "Preparing secure WhatsApp link...",
    });

    try {
      if (!shareWindow) {
        throw new Error("The browser blocked the WhatsApp window.");
      }

      const downloadUrl = await getSecureShareLink();
      const message = [
        `Quick TRN Report - ${trnId}`,
        "",
        downloadUrl,
        "",
        "This secure download link is temporary.",
      ].join("\n");

      shareWindow.location.href = `https://wa.me/?text=${encodeURIComponent(message)}`;
      setShareState({
        status: "ready",
        message: "WhatsApp opened with the secure PDF link.",
      });
    } catch (error) {
      shareWindow?.close();
      setShareState({
        status: "error",
        message: error?.message || "The report could not be prepared for WhatsApp.",
      });
    }
  }

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
                Reading the exact TRN and building one PDF artifact for preview,
                download and save.
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
            {saveState.message ? (
              <span
                style={
                  saveState.status === "error"
                    ? styles.errorMessage
                    : styles.statusMessage
                }
              >
                {saveState.message}
              </span>
            ) : null}
            {shareState.message ? (
              <span
                style={
                  shareState.status === "error"
                    ? styles.errorMessage
                    : styles.statusMessage
                }
              >
                {shareState.message}
              </span>
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
            <button
              type="button"
              style={styles.secondaryButton}
              disabled={!artifact}
              onClick={handleEmail}
              title="Email this exact PDF as an attachment"
            >
              ✉ Email
            </button>
            <button
              type="button"
              style={styles.secondaryButton}
              disabled={!artifact || shareState.status === "preparing"}
              onClick={handleWhatsApp}
              title="Share a temporary secure link to this exact PDF on WhatsApp"
            >
              WhatsApp
            </button>
            <button
              type="button"
              style={styles.primaryButton}
              disabled={!artifact || saveState.status === "saving"}
              onClick={handleSave}
            >
              {saveState.status === "saving" ? "Saving..." : "Save"}
            </button>
          </div>
        </footer>
      </section>

      {emailOpen ? (
        <div style={styles.emailOverlay} role="presentation">
          <form
            style={styles.emailDialog}
            onSubmit={handleSendEmail}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div style={styles.emailHeader}>
              <div>
                <div style={styles.emailEyebrow}>iREPS Report Delivery</div>
                <h3 style={styles.emailTitle}>Email Quick TRN Report</h3>
              </div>
              <button
                type="button"
                style={styles.emailCloseButton}
                onClick={() => setEmailOpen(false)}
                disabled={emailState.status === "sending"}
              >
                Close
              </button>
            </div>

            <div style={styles.emailBody}>
              <label style={styles.emailField}>
                <span style={styles.emailLabel}>To</span>
                <input
                  type="email"
                  value={emailForm.to}
                  onChange={(event) =>
                    setEmailForm((current) => ({ ...current, to: event.target.value }))
                  }
                  placeholder="recipient@example.com"
                  required
                  autoFocus
                  disabled={emailState.status === "sending" || emailState.status === "sent"}
                  style={styles.emailInput}
                />
              </label>

              <label style={styles.emailField}>
                <span style={styles.emailLabel}>Subject</span>
                <input
                  type="text"
                  value={emailForm.subject}
                  onChange={(event) =>
                    setEmailForm((current) => ({ ...current, subject: event.target.value }))
                  }
                  required
                  maxLength={200}
                  disabled={emailState.status === "sending" || emailState.status === "sent"}
                  style={styles.emailInput}
                />
              </label>

              <label style={styles.emailField}>
                <span style={styles.emailLabel}>Message</span>
                <textarea
                  value={emailForm.message}
                  onChange={(event) =>
                    setEmailForm((current) => ({ ...current, message: event.target.value }))
                  }
                  rows={5}
                  maxLength={5000}
                  disabled={emailState.status === "sending" || emailState.status === "sent"}
                  style={styles.emailTextarea}
                />
              </label>

              <div style={styles.emailNotice}>
                <strong>Automatic iREPS notice</strong>
                <span>
                  Please do not reply to this email. reports@ireps.co.za is an automated,
                  unsupervised reporting mailbox and incoming messages are not monitored.
                </span>
              </div>

              {emailState.message ? (
                <div
                  style={
                    emailState.status === "error"
                      ? styles.emailError
                      : emailState.status === "sent"
                        ? styles.emailSuccess
                        : styles.emailProgress
                  }
                >
                  {emailState.message}
                </div>
              ) : null}
            </div>

            <div style={styles.emailActions}>
              <button
                type="button"
                style={styles.secondaryButton}
                onClick={() => setEmailOpen(false)}
                disabled={emailState.status === "sending"}
              >
                {emailState.status === "sent" ? "Close" : "Cancel"}
              </button>
              <button
                type="submit"
                style={styles.primaryButton}
                disabled={emailState.status === "sending" || emailState.status === "sent"}
              >
                {emailState.status === "sending"
                  ? "Sending..."
                  : emailState.status === "sent"
                    ? "Sent"
                    : "Send"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
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
  emailOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 3600,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1rem",
    background: "rgba(15, 23, 42, 0.58)",
  },
  emailDialog: {
    width: "min(620px, 96vw)",
    overflow: "hidden",
    borderRadius: "0.9rem",
    background: "#ffffff",
    boxShadow: "0 24px 72px rgba(15, 23, 42, 0.4)",
  },
  emailHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "1rem 1.15rem",
    borderBottom: "1px solid #e2e8f0",
  },
  emailEyebrow: {
    color: "#2563eb",
    fontSize: "0.7rem",
    fontWeight: 900,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
  },
  emailTitle: {
    margin: "0.2rem 0 0",
    color: "#0f172a",
    fontSize: "1.2rem",
  },
  emailCloseButton: {
    border: 0,
    background: "transparent",
    color: "#475569",
    fontWeight: 850,
    cursor: "pointer",
  },
  emailBody: {
    display: "grid",
    gap: "0.9rem",
    padding: "1.05rem 1.15rem",
  },
  emailField: {
    display: "grid",
    gap: "0.35rem",
  },
  emailLabel: {
    color: "#334155",
    fontSize: "0.78rem",
    fontWeight: 850,
  },
  emailInput: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #cbd5e1",
    borderRadius: "0.6rem",
    padding: "0.68rem 0.75rem",
    color: "#0f172a",
    font: "inherit",
  },
  emailTextarea: {
    width: "100%",
    boxSizing: "border-box",
    resize: "vertical",
    border: "1px solid #cbd5e1",
    borderRadius: "0.6rem",
    padding: "0.68rem 0.75rem",
    color: "#0f172a",
    font: "inherit",
    lineHeight: 1.45,
  },
  emailNotice: {
    display: "grid",
    gap: "0.25rem",
    padding: "0.7rem 0.8rem",
    border: "1px solid #bfdbfe",
    borderRadius: "0.65rem",
    background: "#eff6ff",
    color: "#1e3a8a",
    fontSize: "0.76rem",
    lineHeight: 1.45,
  },
  emailProgress: {
    color: "#334155",
    fontSize: "0.8rem",
    fontWeight: 750,
  },
  emailSuccess: {
    color: "#166534",
    fontSize: "0.8rem",
    fontWeight: 800,
  },
  emailError: {
    color: "#b91c1c",
    fontSize: "0.8rem",
    fontWeight: 800,
  },
  emailActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.55rem",
    padding: "0.9rem 1.15rem",
    borderTop: "1px solid #e2e8f0",
    background: "#f8fafc",
  },
};
