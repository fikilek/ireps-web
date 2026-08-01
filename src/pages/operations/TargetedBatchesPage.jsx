/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";

import { useAuth } from "../../auth/useAuth";
import {
  clearTargetedBatchDraft,
  prepareTargetedBatchDraft,
  recordTargetedBatchUploadAudit,
  selectTargetedBatchDraft,
  selectTargetedBatchUploadAudit,
} from "../../redux/targetedBatchDraftSlice";
import {
  buildTargetedBatchDraftId,
  getTargetedBatchDraftView,
  getTargetedBatchUploadAuditView,
  TARGETED_BATCH_FILE_DECISIONS,
  TARGETED_BATCH_SOURCE_TYPES,
  TARGETED_BATCH_UPLOAD_REGISTER_STATUSES,
} from "../../redux/targetedBatchDraftModel";
import TargetedBatchUploadModal from "./targeted-batches/TargetedBatchUploadModal";
import {
  formatDateTime,
  formatNumber,
} from "./targeted-batches/targetedBatchUtils";

const SOURCE_FILTER_OPTIONS = Object.values(TARGETED_BATCH_SOURCE_TYPES);
const STATUS_FILTER_OPTIONS = Object.values(
  TARGETED_BATCH_UPLOAD_REGISTER_STATUSES,
);

function getActiveLmPcode(activeWorkbase) {
  return (
    activeWorkbase?.lmPcode ||
    activeWorkbase?.pcode ||
    activeWorkbase?.id ||
    activeWorkbase?.localMunicipalityId ||
    null
  );
}

function getActiveWorkbaseName(activeWorkbase) {
  return (
    activeWorkbase?.name ||
    activeWorkbase?.lmName ||
    activeWorkbase?.id ||
    activeWorkbase?.pcode ||
    "NAv"
  );
}

function getSourceReference(upload) {
  if (upload?.source?.type === TARGETED_BATCH_SOURCE_TYPES.PREPAID_SALES) {
    const from = upload?.selection?.salesPeriodFrom || "NAv";
    const to = upload?.selection?.salesPeriodTo || "NAv";
    return `Sales ${from} to ${to}`;
  }

  return upload?.source?.fileName || "CSV TB upload";
}

function getUploadTotal(upload) {
  return Number(
    upload?.totalRows ??
      upload?.validation?.totalRows ??
      upload?.displayRows?.length ??
      0,
  );
}

function getUploadFileDecision(upload) {
  return upload?.fileDecision || upload?.validation?.fileDecision || null;
}

function SummaryCard({ label, value }) {
  return (
    <article style={styles.summaryCard}>
      <span style={styles.summaryLabel}>{label}</span>
      <strong style={styles.summaryValue}>{formatNumber(value)}</strong>
    </article>
  );
}

function Th({ children }) {
  return <th style={styles.th}>{children}</th>;
}

function Td({ children, colSpan }) {
  return (
    <td style={styles.td} colSpan={colSpan}>
      {children}
    </td>
  );
}

function HelpModal({ type, onClose }) {
  const content = {
    columns: {
      title: "TB Upload Register columns",
      body: "TB Rows opens the active row-level review. Final Report remains marked DRAFT. TB ID is the Targeted Batch identifier and Total is the number of rows read from the source file or selected from Prepaid Sales.",
    },
    fileRules: {
      title: "TB file rules",
      body: "The complete CSV file receives only ACCEPTED or REJECTED. File checks cover CSV type, readable structure, exact six-column header order, and the allowed row-count range. A rejected file must show its rejection reason and does not prepare TB rows.",
    },
    columnRules: {
      title: "TB row rules",
      body: "After a file is ACCEPTED, every row receives ACCEPT or REJECT. rowNo must be a positive whole number, meterNo is required, and duplicate rowNo or meterNo values are rejected. Every rejected row keeps its reason. Optional address, town, SG Code and action reason values may be blank.",
    },
    dictionary: {
      title: "TB Uploads dictionary",
      body: "TB means Targeted Batch. A TB Upload is a controlled list received from a CSV upload or selected from Prepaid Sales. The locked future Firestore collections are tb_uploads for the parent and tb_rows for all accepted-file candidate rows.",
    },
    dataFlow: {
      title: "TB Upload data flow",
      body: "CSV selected → complete file ACCEPTED or REJECTED → accepted-file rows assessed ACCEPT or REJECT → frontend Draft Review. This Package 3 register is Redux-only. Permanent tb_uploads and tb_rows writes belong to the later backend creation package.",
    },
  }[type] || {
    title: "TB Uploads help",
    body: "TB Uploads follows the controlled Targeted Batch workflow.",
  };

  return (
    <div
      style={styles.modalBackdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div style={styles.helpModalCard} role="dialog" aria-modal="true">
        <div style={styles.modalHeader}>
          <div>
            <p style={styles.eyebrow}>TB Uploads Help</p>
            <h3 style={styles.modalTitle}>{content.title}</h3>
          </div>
          <button type="button" style={styles.closeButton} onClick={onClose}>
            ×
          </button>
        </div>
        <p style={styles.helpText}>{content.body}</p>
      </div>
    </div>
  );
}

export default function TargetedBatchesPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { activeWorkbase } = useAuth();
  const storedDraft = useSelector(selectTargetedBatchDraft);
  const storedUploadAudit = useSelector(selectTargetedBatchUploadAudit);
  const draft = useMemo(
    () => getTargetedBatchDraftView(storedDraft),
    [storedDraft],
  );

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [activeHelpModal, setActiveHelpModal] = useState(null);
  const [sourceFilter, setSourceFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const activeLmPcode = getActiveLmPcode(activeWorkbase);
  const activeWorkbaseName = getActiveWorkbaseName(activeWorkbase);

  const uploads = useMemo(() => {
    const auditRows = storedUploadAudit
      .map((entry) => getTargetedBatchUploadAuditView(entry))
      .filter(Boolean);
    const byId = new Map(auditRows.map((entry) => [entry.id, entry]));

    if (draft) {
      const auditEntry = byId.get(draft.id);
      byId.set(draft.id, {
        ...auditEntry,
        ...draft,
        fileDecision:
          draft.validation?.fileDecision || auditEntry?.fileDecision || null,
        totalRows: draft.validation?.totalRows || draft.displayRows.length,
        acceptedRows:
          draft.validation?.acceptedRows ?? auditEntry?.acceptedRows ?? 0,
        rejectedRows:
          draft.validation?.rejectedRows ?? auditEntry?.rejectedRows ?? 0,
      });
    }

    return Array.from(byId.values()).sort((left, right) =>
      String(right?.createdAt || "").localeCompare(String(left?.createdAt || "")),
    );
  }, [storedUploadAudit, draft]);

  const filteredUploads = useMemo(() => {
    return uploads.filter((upload) => {
      if (sourceFilter && upload?.source?.type !== sourceFilter) return false;
      if (statusFilter && upload?.status !== statusFilter) return false;
      return true;
    });
  }, [uploads, sourceFilter, statusFilter]);

  const summary = useMemo(() => {
    const totalUploads = uploads.length;
    const drafts = uploads.filter((upload) => upload?.status === "DRAFT").length;
    const readyForBackend = uploads.filter(
      (upload) => upload?.status === "READY_FOR_BACKEND",
    ).length;
    const needsAttention = uploads.filter((upload) => {
      const fileDecision = getUploadFileDecision(upload);
      return (
        fileDecision === TARGETED_BATCH_FILE_DECISIONS.REJECTED ||
        Number(upload?.rejectedRows || upload?.validation?.rejectedRows || 0) > 0
      );
    }).length;

    return {
      totalUploads,
      drafts,
      readyForBackend,
      needsAttention,
    };
  }, [uploads]);

  function handleSubmitCsvBatch(result) {
    const fileAccepted =
      result?.fileDecision === TARGETED_BATCH_FILE_DECISIONS.ACCEPTED;

    if (fileAccepted && draft) {
      const replaceConfirmed = window.confirm(
        `A Targeted Batch draft (${draft.id}) is already active. Replace it with the accepted CSV file ${result.fileName}?`,
      );

      if (!replaceConfirmed) return;
    }

    const batchId = buildTargetedBatchDraftId();
    const source = {
      type: TARGETED_BATCH_SOURCE_TYPES.CSV_UPLOAD,
      label: "CSV Upload",
      sourceId: null,
      fileName: result.fileName,
    };
    const scope = {
      lmPcode: activeLmPcode || "",
      lmName: activeWorkbaseName,
    };

    dispatch(
      recordTargetedBatchUploadAudit({
        id: batchId,
        source,
        scope,
        fileDecision: result.fileDecision,
        totalRows: result.totalRows,
        acceptedRows: result.acceptedRows,
        rejectedRows: result.rejectedRows,
        rejectionReasons: result.errors,
        validation: result,
      }),
    );

    if (!fileAccepted) {
      setIsUploadModalOpen(false);
      return;
    }

    dispatch(
      prepareTargetedBatchDraft({
        id: batchId,
        source,
        scope,
        selection: {
          reason: "CSV targeted batch upload",
          salesPeriodFrom: null,
          salesPeriodTo: null,
        },
        authoritativeIds: {
          salesAllMeterIds: [],
          uploadRowIds: [],
        },
        displayRows: result.rows,
        validation: result,
      }),
    );

    setIsUploadModalOpen(false);
    navigate("/operations/targeted-batches/draft");
  }

  return (
    <section style={styles.page}>
      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Operations / TB Uploads</p>
          <div style={styles.titleHelpRow}>
            <h2 style={styles.title}>TB Uploads</h2>
            <div style={styles.titleHelpButtons}>
              <button
                type="button"
                style={styles.headerHelpButton}
                onClick={() => setActiveHelpModal("columns")}
              >
                ? Help Columns
              </button>
              <button
                type="button"
                style={styles.headerHelpButton}
                onClick={() => setActiveHelpModal("fileRules")}
              >
                ? Help File Rules
              </button>
              <button
                type="button"
                style={styles.headerHelpButton}
                onClick={() => setActiveHelpModal("columnRules")}
              >
                ? Help Column Rules
              </button>
              <button
                type="button"
                style={styles.headerHelpButton}
                onClick={() => setActiveHelpModal("dictionary")}
              >
                ? Help Dictionary
              </button>
              <button
                type="button"
                style={styles.headerHelpButton}
                onClick={() => setActiveHelpModal("dataFlow")}
              >
                ? Help Data Flow
              </button>
            </div>
          </div>
          <p style={styles.subtitle}>
            Upload and assess controlled Targeted Batch CSV files. Complete files
            receive ACCEPTED or REJECTED; accepted-file rows receive ACCEPT or
            REJECT with reasons retained for rejected rows.
          </p>
        </div>

        <div style={styles.headerActions}>
          <button
            type="button"
            style={{
              ...styles.primaryButton,
              ...(!activeLmPcode ? styles.disabledButton : null),
            }}
            onClick={() => setIsUploadModalOpen(true)}
            disabled={!activeLmPcode}
          >
            Upload TB File
          </button>

          <Link to="/sales" style={styles.secondaryLinkButton}>
            Go to Sales
          </Link>

          <Link to="/operations/tb-dashboard" style={styles.secondaryLinkButton}>
            Open TB Dashboard
          </Link>

          {draft ? (
            <Link
              to="/operations/targeted-batches/draft"
              style={styles.secondaryLinkButton}
            >
              Review Current Draft
            </Link>
          ) : null}
        </div>
      </div>

      {!activeLmPcode ? (
        <div style={styles.errorNotice}>
          Activate a Local Municipality workbase before uploading a TB file.
        </div>
      ) : null}

      <div style={styles.summaryGrid}>
        <SummaryCard label="Total Uploads" value={summary.totalUploads} />
        <SummaryCard label="Draft" value={summary.drafts} />
        <SummaryCard
          label="Ready for Backend"
          value={summary.readyForBackend}
        />
        <SummaryCard label="Needs Attention" value={summary.needsAttention} />
      </div>

      <div style={styles.panel}>
        <div style={styles.panelHeader}>
          <div>
            <h3 style={styles.panelTitle}>Upload Register</h3>
            <p style={styles.panelSubtitle}>
              Frontend session register for CSV outcomes and the active Targeted
              Batch draft. Permanent Firestore audit is introduced by the backend
              creation package.
            </p>
          </div>

          <div style={styles.draftStreamBadge}>Frontend register</div>
        </div>

        <div style={styles.filterRow}>
          <select
            style={styles.filterInput}
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
          >
            <option value="">All Sources</option>
            {SOURCE_FILTER_OPTIONS.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>

          <select
            style={styles.filterInput}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">All States</option>
            {STATUS_FILTER_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <Th>TB Rows</Th>
                <Th>Final Report (DRAFT)</Th>
                <Th>TB ID</Th>
                <Th>Total</Th>
              </tr>
            </thead>

            <tbody>
              {filteredUploads.length === 0 ? (
                <tr>
                  <Td colSpan={4}>
                    {uploads.length === 0
                      ? "No TB uploads found yet. Use Upload TB File or Go to Sales."
                      : "No TB uploads match the selected filters."}
                  </Td>
                </tr>
              ) : null}

              {filteredUploads.map((upload) => {
                const activeDraftRows = draft?.id === upload.id;
                const fileDecision = getUploadFileDecision(upload);
                const fileRejected =
                  fileDecision === TARGETED_BATCH_FILE_DECISIONS.REJECTED;
                const rejectionReason =
                  upload?.rejectionReasons?.[0] ||
                  upload?.validation?.errors?.[0] ||
                  null;

                return (
                  <tr key={upload.id}>
                    <Td>
                      {activeDraftRows && !fileRejected ? (
                        <Link
                          to={`/operations/targeted-batches/${encodeURIComponent(upload.id)}`}
                          style={styles.rowLinkButton}
                        >
                          TB Rows
                        </Link>
                      ) : (
                        <button
                          type="button"
                          style={{
                            ...styles.rowDraftButton,
                            ...styles.disabledButton,
                          }}
                          disabled
                          title={
                            fileRejected
                              ? "A rejected file does not prepare TB rows."
                              : "This frontend audit entry is not the active draft."
                          }
                        >
                          {fileRejected ? "No TB Rows" : "Rows unavailable"}
                        </button>
                      )}
                    </Td>

                    <Td>
                      <button
                        type="button"
                        style={{
                          ...styles.rowDraftButton,
                          ...styles.disabledButton,
                        }}
                        disabled
                        title="The TB Final Report page is still a draft."
                      >
                        Final Report (DRAFT)
                      </button>
                    </Td>

                    <Td>
                      <div style={styles.strongCell}>{upload.id || "NAv"}</div>
                      <div style={styles.secondaryCellText}>
                        {getSourceReference(upload)}
                      </div>
                      <div style={styles.secondaryCellText}>
                        {upload.scope?.lmPcode || "NAv"} ·{" "}
                        {upload.scope?.lmName || "NAv"}
                      </div>
                      <div style={styles.secondaryCellText}>
                        {upload.status || "DRAFT"}
                        {fileDecision ? ` · File ${fileDecision}` : ""} ·{" "}
                        {formatDateTime(upload.createdAt)}
                      </div>
                      {Number(upload?.rejectedRows || 0) > 0 ? (
                        <div style={styles.secondaryCellText}>
                          {formatNumber(upload.acceptedRows)} ACCEPT ·{" "}
                          {formatNumber(upload.rejectedRows)} REJECT
                        </div>
                      ) : null}
                      {rejectionReason ? (
                        <div style={styles.secondaryCellText}>
                          Reason: {rejectionReason}
                        </div>
                      ) : null}
                    </Td>

                    <Td>
                      <strong style={styles.totalCell}>
                        {formatNumber(getUploadTotal(upload))}
                      </strong>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {draft ? (
          <div style={styles.registerFooter}>
            <p style={styles.registerFooterText}>
              Clearing the active draft removes its working rows from Redux. A CSV
              file outcome already recorded in this frontend session remains in
              the Upload Register until the page state is reset.
            </p>
            <div style={styles.registerFooterActions}>
              <Link
                to="/operations/targeted-batches/draft"
                style={styles.reviewDraftLink}
              >
                Review Draft
              </Link>
              <button
                type="button"
                style={styles.clearDraftButton}
                onClick={() => dispatch(clearTargetedBatchDraft())}
              >
                Clear Draft
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {isUploadModalOpen ? (
        <TargetedBatchUploadModal
          onClose={() => setIsUploadModalOpen(false)}
          onSubmit={handleSubmitCsvBatch}
          hasExistingDraft={Boolean(draft)}
        />
      ) : null}

      {activeHelpModal ? (
        <HelpModal
          type={activeHelpModal}
          onClose={() => setActiveHelpModal(null)}
        />
      ) : null}
    </section>
  );
}

const styles = {
  page: {
    padding: 24,
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 18,
    flexWrap: "wrap",
  },
  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  titleHelpRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  title: {
    margin: "8px 0 6px",
    fontSize: 30,
    color: "#0f172a",
  },
  titleHelpButtons: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  headerHelpButton: {
    border: "1px solid #bfdbfe",
    borderRadius: 999,
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "6px 9px",
    fontSize: 11,
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  subtitle: {
    margin: 0,
    color: "#64748b",
    maxWidth: 780,
    lineHeight: 1.5,
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    flexWrap: "wrap",
  },
  primaryButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: 0,
    borderRadius: 14,
    background: "#2563eb",
    color: "#ffffff",
    padding: "12px 16px",
    fontWeight: 900,
    cursor: "pointer",
    textDecoration: "none",
  },
  secondaryLinkButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #2563eb",
    borderRadius: 14,
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "11px 16px",
    fontWeight: 900,
    cursor: "pointer",
    textDecoration: "none",
  },
  errorNotice: {
    marginBottom: 16,
    padding: 14,
    border: "1px solid #fecaca",
    borderRadius: 16,
    background: "#fef2f2",
    color: "#991b1b",
    fontSize: 13,
    fontWeight: 800,
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 12,
    marginBottom: 16,
  },
  summaryCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 16,
  },
  summaryLabel: {
    display: "block",
    fontSize: 12,
    fontWeight: 800,
    color: "#64748b",
    marginBottom: 8,
  },
  summaryValue: {
    fontSize: 28,
    color: "#0f172a",
  },
  panel: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 24,
    padding: 18,
  },
  panelHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14,
    flexWrap: "wrap",
  },
  panelTitle: {
    margin: 0,
    fontSize: 18,
    color: "#0f172a",
  },
  panelSubtitle: {
    margin: "6px 0 0",
    color: "#64748b",
    fontSize: 13,
  },
  draftStreamBadge: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    padding: "7px 10px",
    background: "#fef3c7",
    color: "#92400e",
    fontSize: 11,
    fontWeight: 900,
  },
  filterRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 14,
  },
  filterInput: {
    border: "1px solid #cbd5e1",
    borderRadius: 12,
    padding: "10px 12px",
    minWidth: 180,
    background: "#ffffff",
  },
  tableWrap: {
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: 760,
  },
  th: {
    textAlign: "left",
    fontSize: 11,
    color: "#475569",
    background: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
    padding: "12px 10px",
    whiteSpace: "nowrap",
  },
  td: {
    fontSize: 12,
    color: "#334155",
    borderBottom: "1px solid #f1f5f9",
    padding: "12px 10px",
    verticalAlign: "top",
  },
  rowLinkButton: {
    display: "inline-flex",
    alignItems: "center",
    border: "1px solid #bfdbfe",
    borderRadius: 999,
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "7px 10px",
    fontSize: 12,
    fontWeight: 900,
    textDecoration: "none",
    whiteSpace: "nowrap",
  },
  rowDraftButton: {
    display: "inline-flex",
    alignItems: "center",
    border: "1px solid #cbd5e1",
    borderRadius: 999,
    background: "#f8fafc",
    color: "#64748b",
    padding: "7px 10px",
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  strongCell: {
    color: "#0f172a",
    fontWeight: 900,
  },
  secondaryCellText: {
    marginTop: 4,
    color: "#64748b",
    fontSize: 11,
    whiteSpace: "normal",
  },
  totalCell: {
    color: "#0f172a",
    fontSize: 16,
  },
  registerFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingTop: 14,
    flexWrap: "wrap",
  },
  registerFooterText: {
    margin: 0,
    color: "#64748b",
    fontSize: 12,
  },
  registerFooterActions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  reviewDraftLink: {
    display: "inline-flex",
    alignItems: "center",
    border: "1px solid #bfdbfe",
    borderRadius: 999,
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 900,
    textDecoration: "none",
  },
  clearDraftButton: {
    border: "1px solid #fecaca",
    borderRadius: 999,
    background: "#fef2f2",
    color: "#991b1b",
    padding: "7px 10px",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
  },
  disabledButton: {
    opacity: 0.55,
    cursor: "not-allowed",
  },
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 23, 42, 0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    zIndex: 1000,
  },
  helpModalCard: {
    width: "min(720px, 100%)",
    background: "#ffffff",
    borderRadius: 24,
    border: "1px solid #e2e8f0",
    boxShadow: "0 30px 80px rgba(15, 23, 42, 0.35)",
    padding: 24,
  },
  modalHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 14,
  },
  modalTitle: {
    margin: "8px 0 6px",
    fontSize: 22,
    color: "#0f172a",
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    cursor: "pointer",
    fontSize: 24,
    lineHeight: 1,
  },
  helpText: {
    margin: 0,
    color: "#64748b",
    lineHeight: 1.6,
    fontSize: 14,
  },
};
