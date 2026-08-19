import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { quickDownloadExcel } from "../utils/downloads/quickDownloadExcel";

function formatNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toLocaleString() : "0";
}

function getScopeLabel(scope = {}) {
  const lmLabel = scope.lmName || scope.lmPcode || "NAv";
  const wardLabel = scope.wardLabel || scope.wardPcode || "NAv";
  return `${lmLabel} / ${wardLabel}`;
}

function QuickDownloadModal({
  registryName,
  rowsLabel,
  rowCount,
  scope,
  onClose,
  onDownload,
}) {
  const hasRows = rowCount > 0;

  return (
    <div
      style={styles.overlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        style={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-download-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={styles.header}>
          <div>
            <p style={styles.eyebrow}>Quick Download</p>
            <h2 id="quick-download-title" style={styles.title}>
              {hasRows ? "Export current screen rows" : "Nothing to download"}
            </h2>
            <p style={styles.subtitle}>
              {hasRows
                ? "Download the currently visible registry rows to Excel."
                : "Your current filters returned no visible rows."}
            </p>
          </div>

          <button type="button" style={styles.closeButton} onClick={onClose}>
            ✕
          </button>
        </div>

        <div style={styles.body}>
          {hasRows ? (
            <>
              <div style={styles.noticeBox}>
                <strong>You are about to download what you see on this screen.</strong>
                <p style={styles.noticeText}>
                  Your active ward selection, column filters, date filter, and sorting order will be applied.
                  Rows outside the current filtered view will not be included.
                </p>
              </div>

              <div style={styles.summaryBox}>
                <div style={styles.summaryLine}>
                  <span>Registry</span>
                  <strong>{registryName}</strong>
                </div>
                <div style={styles.summaryLine}>
                  <span>Scope</span>
                  <strong>{getScopeLabel(scope)}</strong>
                </div>
                <div style={styles.summaryLine}>
                  <span>Rows to export</span>
                  <strong>
                    {formatNumber(rowCount)} {rowsLabel || "rows"}
                  </strong>
                </div>
                <div style={styles.summaryLine}>
                  <span>File type</span>
                  <strong>Excel (.xlsx)</strong>
                </div>
              </div>

              <p style={styles.footerNote}>
                This is a frontend Quick Download only. No backend download job will be created.
              </p>
            </>
          ) : (
            <div style={styles.noticeBoxWarning}>
              <strong>There are no visible rows to download.</strong>
              <p style={styles.noticeText}>
                Clear filters or change your ward/date selection, then try again.
              </p>
            </div>
          )}
        </div>

        <div style={styles.footer}>
          <button type="button" style={styles.cancelButton} onClick={onClose}>
            {hasRows ? "Cancel" : "Close"}
          </button>

          {hasRows ? (
            <button type="button" style={styles.downloadButton} onClick={onDownload}>
              Download Excel
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FullDownloadModal({
  rowCount,
  isEnabled,
  status,
  errorMessage,
  onClose,
  onGenerate,
}) {
  const hasRows = rowCount > 0;
  const isRunning = status === "RUNNING";
  const isComplete = status === "COMPLETE" || status === "COMPLETE_WITH_WARNING";

  let title = "Coming in the next sprint";
  let subtitle =
    "Full Download will create a backend compiled file and list it on the Generated Reports page.";
  let body = (
    <div style={styles.noticeBox}>
      <strong>Full Download is not active yet.</strong>
      <p style={styles.noticeText}>
        It will run as a backend job, store the compiled file temporarily, and expire it automatically after 3 days.
      </p>
    </div>
  );

  if (isEnabled && !hasRows) {
    title = "Nothing to generate";
    subtitle = "Your current filters returned no report rows.";
    body = (
      <div style={styles.noticeBoxWarning}>
        <strong>There are no rows available for Full Download.</strong>
        <p style={styles.noticeText}>
          Clear filters or change the report scope, then try again.
        </p>
      </div>
    );
  } else if (isEnabled && isComplete) {
    title = "Managed report ready";
    subtitle = "The canonical User Activity Excel report was created successfully.";
    body = (
      <>
        <div style={styles.noticeBox}>
          <strong>
            {errorMessage
              ? "The managed Excel artifact was stored successfully."
              : "The same Excel artifact was stored and downloaded."}
          </strong>
          <p style={styles.noticeText}>
            The managed copy is available to Generated Reports and will expire automatically after 3 days.
          </p>
        </div>

        {errorMessage ? (
          <div style={{ ...styles.noticeBoxWarning, marginTop: "1rem" }}>
            <strong>Browser download did not start.</strong>
            <p style={styles.noticeText}>{errorMessage}</p>
          </div>
        ) : null}
      </>
    );
  } else if (isEnabled) {
    title = isRunning ? "Creating managed report..." : "Create managed report";
    subtitle =
      "Full Download creates one canonical Excel artifact for managed storage and browser download.";
    body = (
      <>
        <div style={styles.noticeBox}>
          <strong>
            {isRunning
              ? "The User Activity report is being prepared."
              : "One report generation will serve both destinations."}
          </strong>
          <p style={styles.noticeText}>
            The same Excel bytes will be stored temporarily in Report Platform and downloaded to this browser.
            The managed copy expires automatically after 3 days.
          </p>
        </div>

        {errorMessage ? (
          <div style={{ ...styles.noticeBoxWarning, marginTop: "1rem" }}>
            <strong>Full Download could not be completed.</strong>
            <p style={styles.noticeText}>{errorMessage}</p>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div
      style={styles.overlay}
      role="presentation"
      onMouseDown={(event) => {
        if (!isRunning && event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        style={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="full-download-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={styles.header}>
          <div>
            <p style={styles.eyebrow}>Full Download</p>
            <h2 id="full-download-title" style={styles.title}>
              {title}
            </h2>
            <p style={styles.subtitle}>{subtitle}</p>
          </div>

          <button
            type="button"
            style={styles.closeButton}
            onClick={onClose}
            disabled={isRunning}
          >
            ✕
          </button>
        </div>

        <div style={styles.body}>{body}</div>

        <div style={styles.footer}>
          {isEnabled && hasRows && !isComplete ? (
            <>
              <button
                type="button"
                style={styles.cancelButton}
                onClick={onClose}
                disabled={isRunning}
              >
                Cancel
              </button>

              <button
                type="button"
                style={styles.downloadButton}
                onClick={onGenerate}
                disabled={isRunning}
              >
                {isRunning ? "Generating..." : "Generate Excel"}
              </button>
            </>
          ) : (
            <button type="button" style={styles.downloadButton} onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DownloadButtons({
  registryName = "Registry",
  rowsLabel = "rows",
  visibleRows = [],
  columns = [],
  fileBaseName = "registry_download",
  scope = {},
  onFullDownload = null,
}) {
  const [activeModal, setActiveModal] = useState(null);
  const [fullDownloadStatus, setFullDownloadStatus] = useState("IDLE");
  const [fullDownloadError, setFullDownloadError] = useState("");

  const modalRoot = useMemo(() => {
    if (typeof document === "undefined") return null;
    return document.body;
  }, []);

  useEffect(() => {
    if (!activeModal || typeof document === "undefined") return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape" && fullDownloadStatus !== "RUNNING") {
        setActiveModal(null);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [activeModal, fullDownloadStatus]);

  const closeModal = () => {
    if (fullDownloadStatus === "RUNNING") return;
    setActiveModal(null);
  };

  const openFullDownloadModal = () => {
    setFullDownloadStatus("IDLE");
    setFullDownloadError("");
    setActiveModal("FD");
  };

  const handleQuickDownload = () => {
    quickDownloadExcel({
      rows: visibleRows,
      columns,
      fileBaseName,
      registryName,
      scope,
    });

    closeModal();
  };

  const handleFullDownload = async () => {
    if (typeof onFullDownload !== "function" || visibleRows.length === 0) return;

    setFullDownloadStatus("RUNNING");
    setFullDownloadError("");

    try {
      const result = await onFullDownload();

      if (result?.downloaded === false) {
        setFullDownloadStatus("COMPLETE_WITH_WARNING");
        setFullDownloadError(
          "The report remains safely stored in Report Platform. You can retrieve it from Generated Reports.",
        );
        return;
      }

      setFullDownloadStatus("COMPLETE");
    } catch {
      setFullDownloadStatus("ERROR");
      setFullDownloadError(
        "The managed report was not created. Please try again.",
      );
    }
  };

  const isFullDownloadEnabled = typeof onFullDownload === "function";

  return (
    <>
      <div style={styles.buttonGroup} aria-label="Registry download actions">
        <button
          type="button"
          style={styles.iconButton}
          onClick={() => setActiveModal("QD")}
          title="Quick Download"
          aria-label="Quick Download current screen rows"
        >
          <span style={styles.iconGlyph}>⇩</span>
          <span>QD</span>
        </button>

        <button
          type="button"
          style={isFullDownloadEnabled ? styles.iconButton : styles.iconButtonDisabled}
          onClick={openFullDownloadModal}
          title={isFullDownloadEnabled ? "Full Download" : "Full Download coming soon"}
          aria-label={
            isFullDownloadEnabled
              ? "Create managed Full Download"
              : "Full Download coming soon"
          }
        >
          <span style={styles.iconGlyph}>☁</span>
          <span>FD</span>
        </button>
      </div>

      {modalRoot && activeModal === "QD"
        ? createPortal(
            <QuickDownloadModal
              registryName={registryName}
              rowsLabel={rowsLabel}
              rowCount={visibleRows.length}
              scope={scope}
              onClose={closeModal}
              onDownload={handleQuickDownload}
            />,
            modalRoot,
          )
        : null}

      {modalRoot && activeModal === "FD"
        ? createPortal(
            <FullDownloadModal
              rowCount={visibleRows.length}
              isEnabled={isFullDownloadEnabled}
              status={fullDownloadStatus}
              errorMessage={fullDownloadError}
              onClose={closeModal}
              onGenerate={handleFullDownload}
            />,
            modalRoot,
          )
        : null}
    </>
  );
}

const styles = {
  buttonGroup: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35rem",
  },
  iconButton: {
    border: "1px solid #0f172a",
    background: "#0f172a",
    color: "#ffffff",
    borderRadius: "0.75rem",
    padding: "0.45rem 0.6rem",
    fontSize: "0.78rem",
    fontWeight: 900,
    display: "inline-flex",
    alignItems: "center",
    gap: "0.28rem",
    cursor: "pointer",
    lineHeight: 1,
  },
  iconButtonDisabled: {
    border: "1px solid #cbd5e1",
    background: "#f1f5f9",
    color: "#475569",
    borderRadius: "0.75rem",
    padding: "0.45rem 0.6rem",
    fontSize: "0.78rem",
    fontWeight: 900,
    display: "inline-flex",
    alignItems: "center",
    gap: "0.28rem",
    cursor: "pointer",
    lineHeight: 1,
  },
  iconGlyph: {
    fontSize: "0.92rem",
    lineHeight: 1,
  },
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    background: "rgba(15, 23, 42, 0.46)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1rem",
  },
  card: {
    width: "min(640px, 100%)",
    maxHeight: "calc(100vh - 2rem)",
    overflow: "auto",
    background: "#ffffff",
    borderRadius: "1.2rem",
    boxShadow: "0 28px 70px rgba(15, 23, 42, 0.34)",
    border: "1px solid rgba(148, 163, 184, 0.32)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "1.2rem 1.25rem 0.85rem",
    borderBottom: "1px solid #e2e8f0",
  },
  eyebrow: {
    margin: 0,
    color: "#64748b",
    fontSize: "0.72rem",
    fontWeight: 900,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
  },
  title: {
    margin: "0.18rem 0 0",
    fontSize: "1.32rem",
    color: "#0f172a",
  },
  subtitle: {
    margin: "0.35rem 0 0",
    color: "#64748b",
    lineHeight: 1.45,
  },
  closeButton: {
    width: "2.1rem",
    height: "2.1rem",
    border: "1px solid #cbd5e1",
    borderRadius: "999px",
    background: "#ffffff",
    color: "#0f172a",
    cursor: "pointer",
    fontWeight: 900,
  },
  body: {
    padding: "1.2rem 1.25rem",
  },
  noticeBox: {
    border: "1px solid #cbd5e1",
    background: "#f8fafc",
    borderRadius: "1rem",
    padding: "1rem",
    color: "#0f172a",
  },
  noticeBoxWarning: {
    border: "1px solid #f59e0b",
    background: "#fffbeb",
    borderRadius: "1rem",
    padding: "1rem",
    color: "#92400e",
  },
  noticeText: {
    margin: "0.5rem 0 0",
    color: "inherit",
    lineHeight: 1.55,
  },
  summaryBox: {
    marginTop: "1rem",
    border: "1px solid #e2e8f0",
    borderRadius: "1rem",
    overflow: "hidden",
  },
  summaryLine: {
    display: "grid",
    gridTemplateColumns: "11rem 1fr",
    gap: "1rem",
    padding: "0.75rem 0.9rem",
    borderBottom: "1px solid #e2e8f0",
    color: "#475569",
  },
  footerNote: {
    margin: "1rem 0 0",
    color: "#64748b",
    lineHeight: 1.45,
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.75rem",
    padding: "0.9rem 1.25rem 1.15rem",
    borderTop: "1px solid #e2e8f0",
  },
  cancelButton: {
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#0f172a",
    borderRadius: "0.85rem",
    padding: "0.62rem 0.9rem",
    cursor: "pointer",
    fontWeight: 800,
  },
  downloadButton: {
    border: "1px solid #0f172a",
    background: "#0f172a",
    color: "#ffffff",
    borderRadius: "0.85rem",
    padding: "0.62rem 0.9rem",
    cursor: "pointer",
    fontWeight: 900,
  },
};
