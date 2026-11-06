/* eslint-disable no-unused-vars -- JSX component tags are consumed by the JSX transform. */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import {
  useGetTcUploadsQuery,
  useDeleteTcUploadMutation,
} from "../../redux/tcApi";
import IrepsTable from "../../components/table/IrepsTable";

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-ZA") : "0";
}

function resolveWorkbase(auth = {}, geoState = {}) {
  const candidate =
    auth?.activeWorkbase ||
    auth?.profile?.access?.activeWorkbase ||
    auth?.profile?.activeWorkbase ||
    auth?.activeLm ||
    (Array.isArray(auth?.workbases) && auth.workbases[0]) ||
    (Array.isArray(auth?.profile?.access?.workbases) && auth.profile.access.workbases[0]) ||
    geoState?.selectedLm ||
    null;

  const pcode = String(
    candidate?.lmPcode ||
      candidate?.pcode ||
      candidate?.id ||
      candidate?.localMunicipalityId ||
      "",
  ).trim();

  const lmName = String(
    candidate?.name ||
      candidate?.lmName ||
      candidate?.id ||
      candidate?.pcode ||
      "NAv",
  ).trim();

  return {
    lmPcode: pcode === "NAv" ? "" : pcode,
    lmName,
  };
}

function getTrnTypeInfo(trnTypeRaw = "") {
  const opType = String(trnTypeRaw || "").toUpperCase();

  if (opType.includes("DISCONNECT") || opType === "MDCN") {
    return { label: "Meter Disconnection", code: "MDCN", bg: "#fef2f2", text: "#b91c1c", border: "#fecaca" };
  }
  if (opType.includes("RECONNECT") || opType === "MRCN") {
    return { label: "Meter Reconnection", code: "MRCN", bg: "#ecfdf5", text: "#047857", border: "#a7f3d0" };
  }
  if (opType.includes("INSPECT") || opType === "MINS") {
    return { label: "Meter Inspection", code: "MINS", bg: "#f5f3ff", text: "#6d28d9", border: "#ddd6fe" };
  }
  if (opType.includes("READ") || opType === "MRDG") {
    return { label: "Meter Reading", code: "MRDG", bg: "#f0f9ff", text: "#0369a1", border: "#bae6fd" };
  }
  if (opType.includes("REMOV") || opType === "MREM") {
    return { label: "Meter Removal", code: "MREM", bg: "#fff7ed", text: "#c2410c", border: "#fed7aa" };
  }
  return { label: opType || "Transaction", code: "TRN", bg: "#f8fafc", text: "#334155", border: "#e2e8f0" };
}

function getBgoStatusBadge(statusRaw = "") {
  const status = String(statusRaw || "").toUpperCase();
  if (status === "READY_FOR_BGO") {
    return { label: "READY FOR BGO", bg: "#ecfdf5", text: "#047857", border: "#a7f3d0" };
  }
  if (status === "USED" || status === "ALLOCATED") {
    return { label: "ALLOCATED", bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe" };
  }
  if (status === "PARTIALLY_USED") {
    return { label: "PARTIAL ALLOCATION", bg: "#fef3c7", text: "#b45309", border: "#fde68a" };
  }
  if (status === "NOT_READY") {
    return { label: "NOT READY", bg: "#fef2f2", text: "#b91c1c", border: "#fecaca" };
  }
  return { label: status || "STAGED", bg: "#f1f5f9", text: "#475569", border: "#cbd5e1" };
}

function SummaryCard({ label, value }) {
  return (
    <div style={styles.summaryCard}>
      <span style={styles.summaryCardLabel}>{label}</span>
      <strong style={styles.summaryCardValue}>{formatNumber(value)}</strong>
    </div>
  );
}

export default function TrnBgoRegisterPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const { geoState } = useGeo();

  const { lmPcode, lmName } = useMemo(
    () => resolveWorkbase(auth, geoState),
    [auth, geoState],
  );

  // Stream existing TRN uploads directly from tc_uploads (mirroring BGO Dashboard stream)
  const {
    data: uploads = [],
    isLoading: isUploadsLoading,
    error: uploadsError,
  } = useGetTcUploadsQuery({ limit: 500 });

  const [deleteTcUpload, { isLoading: isDeletingUpload }] = useDeleteTcUploadMutation();

  // Selection ticks
  const [tickedBatchIds, setTickedBatchIds] = useState(new Set());
  const toggleTick = (id) => {
    setTickedBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearTicks = () => setTickedBatchIds(new Set());

  // Delete modal state
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [actionNotice, setActionNotice] = useState("");

  // Summary KPIs across existing TRN candidate batches
  const summary = useMemo(() => {
    let readyForBgo = 0;
    let allocated = 0;
    let inProgress = 0;
    let totalMeters = 0;

    uploads.forEach((item) => {
      const bgoStatus = String(item.bgoStatus || "").toUpperCase();
      const readyRows = Number(item.readyRows || 0);
      const totalRows = Number(item.totalRows || 0);

      totalMeters += totalRows;

      if (bgoStatus === "USED" || bgoStatus === "ALLOCATED") {
        allocated += 1;
      } else if (bgoStatus === "READY_FOR_BGO" || readyRows > 0) {
        readyForBgo += 1;
      } else if (bgoStatus === "PARTIALLY_USED") {
        allocated += 1;
      } else {
        inProgress += 1;
      }
    });

    return {
      totalBatches: uploads.length,
      readyForAllocation: readyForBgo,
      allocated,
      inProgress,
      totalMeters,
    };
  }, [uploads]);

  const handleOpenDelete = (batch) => {
    setDeleteCandidate(batch);
    setDeleteError("");
  };

  const handleCloseDelete = () => {
    setDeleteCandidate(null);
    setDeleteError("");
  };

  const handleConfirmDelete = async () => {
    if (!deleteCandidate) return;
    setDeleteError("");
    try {
      const result = await deleteTcUpload({
        tcId: deleteCandidate.id,
      }).unwrap();

      if (result?.success) {
        setActionNotice(`Batch ${deleteCandidate.id} was deleted successfully.`);
        handleCloseDelete();
      } else {
        setDeleteError(result?.message || "Failed to delete batch.");
      }
    } catch (err) {
      setDeleteError(err?.data?.message || err?.message || "Failed to delete batch.");
    }
  };

  // IrepsTable column definitions
  const columns = useMemo(() => [
    {
      key: "select",
      label: "[ ]",
      width: 44,
      filter: null,
      sortable: false,
      export: false,
      render: (batch) => (
        <input
          type="checkbox"
          checked={tickedBatchIds.has(batch.id)}
          onChange={() => toggleTick(batch.id)}
          aria-label={`Select batch ${batch.id}`}
        />
      ),
    },
    {
      key: "map",
      label: "Map",
      width: 52,
      filter: null,
      sortable: false,
      export: false,
      render: (batch) => (
        <Link
          to={`/operations/tc-uploads/${batch.id}/bgo`}
          style={styles.mapLinkButton}
          title="View BGO Geofences"
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" />
            <path d="M9 3v15" />
            <path d="M15 6v15" />
          </svg>
        </Link>
      ),
    },
    {
      key: "batchId",
      label: "Batch ID",
      sortable: true,
      filter: "text",
      value: (batch) => batch.id || "",
      sortValue: (batch) => batch.id || "",
      render: (batch) => (
        <strong style={styles.strongCell}>{batch.id}</strong>
      ),
    },
    {
      key: "trnType",
      label: "TRN Type",
      sortable: true,
      filter: "select",
      value: (batch) => getTrnTypeInfo(batch.trnType).label,
      sortValue: (batch) => getTrnTypeInfo(batch.trnType).label,
      render: (batch) => {
        const info = getTrnTypeInfo(batch.trnType);
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "4px 8px",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 700,
              background: info.bg,
              color: info.text,
              border: `1px solid ${info.border}`,
            }}
          >
            {info.label}
          </span>
        );
      },
    },
    {
      key: "fileName",
      label: "File Name",
      sortable: true,
      filter: "text",
      value: (batch) => batch.fileName || "",
      sortValue: (batch) => batch.fileName || "",
      render: (batch) => (
        <span style={styles.fileNameCell} title={batch.fileName}>
          {batch.fileName || "NAv"}
        </span>
      ),
    },
    {
      key: "bgoRows",
      label: "BGO Rows",
      width: 96,
      filter: null,
      sortable: false,
      export: false,
      render: (batch) => (
        <Link
          to={`/operations/trn-bgo-rows?batchId=${encodeURIComponent(batch.id)}`}
          style={styles.rowLinkButton}
          title="Inspect BGO child transaction rows"
        >
          BGO Rows
        </Link>
      ),
    },
    {
      key: "allocation",
      label: "Allocation",
      width: 96,
      filter: null,
      sortable: false,
      export: false,
      render: (batch) => {
        const canAllocate = Number(batch.readyRows || 0) > 0 || batch.bgoStatus === "READY_FOR_BGO";
        return (
          <Link
            to={`/operations/tc-uploads/${batch.id}/bgo`}
            style={{
              ...styles.allocateButton,
              ...(!canAllocate ? { opacity: 0.5, pointerEvents: "none" } : null),
            }}
            title={canAllocate ? "Open allocation board" : "Batch not ready for allocation"}
          >
            Allocate
          </Link>
        );
      },
    },
    {
      key: "bgoStatus",
      label: "BGO Status",
      sortable: true,
      filter: "select",
      value: (batch) => getBgoStatusBadge(batch.bgoStatus).label,
      sortValue: (batch) => batch.bgoStatus || "",
      render: (batch) => {
        const badge = getBgoStatusBadge(batch.bgoStatus);
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "4px 8px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 800,
              background: badge.bg,
              color: badge.text,
              border: `1px solid ${badge.border}`,
            }}
          >
            {badge.label}
          </span>
        );
      },
    },
    {
      key: "readyRows",
      label: "Ready Meters",
      sortable: true,
      filter: "text",
      value: (batch) => String(batch.readyRows ?? 0),
      sortValue: (batch) => Number(batch.readyRows || 0),
      render: (batch) => (
        <strong style={styles.readyCell}>{formatNumber(batch.readyRows)}</strong>
      ),
    },
    {
      key: "totalRows",
      label: "Total Meters",
      sortable: true,
      filter: "text",
      value: (batch) => String(batch.totalRows ?? 0),
      sortValue: (batch) => Number(batch.totalRows || 0),
      render: (batch) => (
        <strong style={styles.totalCell}>{formatNumber(batch.totalRows)}</strong>
      ),
    },
    {
      key: "lmPcode",
      label: "LM",
      sortable: true,
      filter: "select",
      value: (batch) => batch.lmPcode || "NAv",
      sortValue: (batch) => batch.lmPcode || "",
      render: (batch) => (
        <div style={styles.strongCell}>{batch.lmPcode || "NAv"}</div>
      ),
    },
    {
      key: "delete",
      label: "Delete BGO",
      width: 96,
      filter: null,
      sortable: false,
      export: false,
      render: (batch) => (
        <button
          type="button"
          style={styles.deleteBatchButton}
          onClick={() => handleOpenDelete(batch)}
          title="Delete this batch upload"
        >
          Delete
        </button>
      ),
    },
  ], [tickedBatchIds]);

  return (
    <section style={styles.page}>
      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Operations / TRN BGO Register</p>
          <div style={styles.titleHelpRow}>
            <h2 style={styles.title}>TRN BGO Register</h2>
          </div>
          <p style={styles.subtitle}>
            View permanent Transaction batches originating from uploaded meter lists.
            TRN BGO batches originate from existing meters grouped into geofences.
          </p>
        </div>

        <div style={styles.headerActions}>
          <Link
            to="/operations/trn-bgo/upload"
            style={styles.primaryButton}
          >
            Upload & Create TRN BGO
          </Link>

          <Link
            to="/operations/trn-bgo/allocation"
            style={styles.secondaryLinkButton}
          >
            Allocation Board ({tickedBatchIds.size})
          </Link>

          <Link
            to="/operations/bgo-dashboard"
            style={styles.secondaryLinkButton}
          >
            TRN BGO Dashboard
          </Link>

          {tickedBatchIds.size > 0 ? (
            <button
              type="button"
              style={styles.clearTicksButton}
              onClick={clearTicks}
              title="Clear selected batches"
            >
              Clear ticks
            </button>
          ) : null}
        </div>
      </div>

      {uploadsError ? (
        <div style={styles.errorNotice}>
          Failed to load TRN BGO batches: {uploadsError?.data?.message || uploadsError?.message}
        </div>
      ) : null}

      {actionNotice ? (
        <div style={styles.successNotice}>
          {actionNotice}
        </div>
      ) : null}

      <div style={styles.summaryGrid}>
        <SummaryCard label="Total Batches" value={summary.totalBatches} />
        <SummaryCard label="Ready for Allocation" value={summary.readyForAllocation} />
        <SummaryCard label="Allocated" value={summary.allocated} />
        <SummaryCard label="Total Meters" value={summary.totalMeters} />
      </div>

      <div style={styles.tablePanel}>
        <IrepsTable
          title="Permanent Transaction Batches"
          columns={columns}
          rows={uploads}
          rowKey={(batch) => batch.id}
          defaultSort={{ key: "createdAt", direction: "desc" }}
          emptyText={
            uploads.length === 0
              ? "No permanent TRN BGO Batches were found."
              : "No permanent TRN BGO Batches match the current filters."
          }
          loading={isUploadsLoading}
          loadingText="Loading TRN BGO Batches..."
          downloads={{
            registryName: "TRN BGO Register",
            fileBaseName: "trn_bgo_register",
            columns: columns.filter((col) => col.export !== false),
          }}
        />
      </div>

      {/* Delete Batch Modal */}
      {deleteCandidate ? (
        <div style={styles.modalOverlay} role="dialog" aria-modal="true">
          <div style={styles.modalBox}>
            <h3 style={styles.modalTitle}>Delete TRN BGO Batch</h3>
            <p style={styles.modalText}>
              Are you sure you want to delete batch <strong>{deleteCandidate.id}</strong> ({deleteCandidate.fileName})?
              This will remove the uploaded batch and all associated rows.
            </p>

            {deleteError ? (
              <div style={styles.modalErrorNotice}>{deleteError}</div>
            ) : null}

            <div style={styles.modalActions}>
              <button
                type="button"
                style={styles.modalCancelButton}
                onClick={handleCloseDelete}
                disabled={isDeletingUpload}
              >
                Cancel
              </button>
              <button
                type="button"
                style={styles.modalDeleteButton}
                onClick={handleConfirmDelete}
                disabled={isDeletingUpload}
              >
                {isDeletingUpload ? "Deleting..." : "Delete Batch"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

const styles = {
  page: {
    padding: 24,
    background: "#f8fafc",
    minHeight: "100vh",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
    gap: 16,
    flexWrap: "wrap",
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: 800,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    margin: "0 0 4px",
  },
  titleHelpRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: 900,
    color: "#0f172a",
    margin: 0,
  },
  subtitle: {
    fontSize: 13,
    color: "#64748b",
    margin: "4px 0 0",
  },
  headerActions: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
  },
  primaryButton: {
    display: "inline-flex",
    alignItems: "center",
    padding: "8px 16px",
    borderRadius: 8,
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 800,
    fontSize: 13,
    textDecoration: "none",
    border: 0,
  },
  secondaryLinkButton: {
    display: "inline-flex",
    alignItems: "center",
    padding: "8px 16px",
    borderRadius: 8,
    background: "#ffffff",
    color: "#0f172a",
    fontWeight: 700,
    fontSize: 13,
    textDecoration: "none",
    border: "1px solid #cbd5e1",
  },
  clearTicksButton: {
    display: "inline-flex",
    alignItems: "center",
    padding: "8px 12px",
    borderRadius: 8,
    background: "#fee2e2",
    color: "#991b1b",
    fontWeight: 700,
    fontSize: 12,
    border: "1px solid #fecaca",
    cursor: "pointer",
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: 16,
    marginBottom: 20,
  },
  summaryCard: {
    background: "#ffffff",
    padding: "16px 20px",
    borderRadius: 14,
    border: "1px solid #e2e8f0",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
  },
  summaryCardLabel: {
    fontSize: 12,
    fontWeight: 800,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  summaryCardValue: {
    fontSize: 26,
    fontWeight: 900,
    color: "#0f172a",
  },
  tablePanel: {
    background: "#ffffff",
    borderRadius: 14,
    border: "1px solid #e2e8f0",
    overflow: "hidden",
    boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
  },
  strongCell: {
    color: "#0f172a",
    fontWeight: 700,
  },
  fileNameCell: {
    maxWidth: 240,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "#334155",
    display: "block",
  },
  readyCell: {
    color: "#166534",
    fontSize: 14,
    fontWeight: 900,
  },
  totalCell: {
    color: "#0f172a",
    fontSize: 14,
    fontWeight: 900,
  },
  rowLinkButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 12px",
    borderRadius: 8,
    background: "#eff6ff",
    color: "#2563eb",
    fontWeight: 800,
    fontSize: 12,
    textDecoration: "none",
    border: "1px solid #bfdbfe",
  },
  allocateButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 12px",
    borderRadius: 8,
    background: "#f0fdf4",
    color: "#166534",
    fontWeight: 800,
    fontSize: 12,
    textDecoration: "none",
    border: "1px solid #bbf7d0",
  },
  mapLinkButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    borderRadius: 8,
    background: "#f1f5f9",
    color: "#334155",
    textDecoration: "none",
    border: "1px solid #cbd5e1",
  },
  deleteBatchButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 10px",
    borderRadius: 8,
    background: "#ffffff",
    color: "#ef4444",
    border: "1px solid #fecaca",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  errorNotice: {
    background: "#fef2f2",
    color: "#991b1b",
    border: "1px solid #fecaca",
    borderRadius: 10,
    padding: "12px 16px",
    marginBottom: 16,
    fontSize: 13,
  },
  successNotice: {
    background: "#f0fdf4",
    color: "#166534",
    border: "1px solid #bbf7d0",
    borderRadius: 10,
    padding: "12px 16px",
    marginBottom: 16,
    fontSize: 13,
  },
  loadingNotice: {
    padding: 32,
    textAlign: "center",
    color: "#64748b",
    fontSize: 14,
    fontWeight: 700,
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 23, 42, 0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    padding: 16,
  },
  modalBox: {
    background: "#ffffff",
    borderRadius: 20,
    padding: 24,
    maxWidth: 480,
    width: "100%",
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
  },
  modalTitle: {
    margin: "0 0 12px",
    fontSize: 18,
    fontWeight: 900,
    color: "#0f172a",
  },
  modalText: {
    margin: "0 0 20px",
    color: "#475569",
    fontSize: 14,
    lineHeight: 1.5,
  },
  modalActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 12,
  },
  modalCancelButton: {
    padding: "10px 16px",
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#475569",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  },
  modalDeleteButton: {
    padding: "10px 16px",
    borderRadius: 10,
    border: 0,
    background: "#ef4444",
    color: "#ffffff",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  },
  modalErrorNotice: {
    background: "#fef2f2",
    color: "#991b1b",
    border: "1px solid #fecaca",
    borderRadius: 8,
    padding: "8px 12px",
    marginBottom: 16,
    fontSize: 12,
  },
};
