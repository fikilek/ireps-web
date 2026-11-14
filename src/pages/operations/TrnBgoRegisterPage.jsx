/* eslint-disable no-unused-vars -- JSX component tags are consumed by the JSX transform. */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import {
  useGetTcUploadsQuery,
  useGetTrnBgoProgressQuery,
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

export function getBatchAllocationStatus(batch) {
  const bgoStatus = String(batch?.bgoStatus || "").toUpperCase();
  const workflowState = String(batch?.workflowState || batch?.workflow?.state || "").toUpperCase();
  const hasTarget = Array.isArray(batch?.assignment?.targets) && batch.assignment.targets.length > 0;
  const hasTeamOrSp = Boolean(batch?.teamId || batch?.spId || batch?.allocatedTo || batch?.assignedTeamId);

  const isAllocated =
    bgoStatus === "USED" ||
    bgoStatus === "ALLOCATED" ||
    bgoStatus === "PARTIALLY_USED" ||
    workflowState === "ALLOCATED" ||
    workflowState === "IN_PROGRESS" ||
    workflowState === "ISSUED" ||
    hasTarget ||
    hasTeamOrSp;

  if (isAllocated) {
    return {
      label: "Allocated",
      bg: "#eff6ff",
      text: "#1d4ed8",
      border: "#bfdbfe",
    };
  }

  return {
    label: "Unallocated",
    bg: "#fef3c7",
    text: "#b45309",
    border: "#fde68a",
  };
}

const KPI_HELP_DETAILS = {
  totalBatches: {
    title: "Total Batches",
    meaning: "The total number of Transaction Bulk Geofence Origination (TRN BGO) batches currently loaded in the register.",
    criteria: "Aggregates all permanent transaction batches originating from external uploads or meter selections, spanning all lifecycle states.",
    nextAction: "Use the top action bar to upload new meter batches or monitor existing batches across all Local Municipalities.",
  },
  unallocated: {
    title: "Unallocated",
    meaning: "Batches that are staged or validated and ready for field assignment, but have not yet been allocated to an operational TEAM or Service Provider (SP).",
    criteria: "Batches with status 'READY_FOR_BGO' or 'READY_FOR_ALLOCATION' where team and SP assignments are empty.",
    nextAction: "Click 'Allocate' on any row or open the 'Allocation Board' to assign these batches to available field teams or contractors.",
  },
  allocated: {
    title: "Allocated",
    meaning: "Batches that have been officially issued and assigned to an active operational TEAM or Service Provider.",
    criteria: "Batches with status 'ALLOCATED', 'USED', or 'PARTIALLY_USED', with assigned team/SP and active child transactions dispatched to mobile field workers.",
    nextAction: "Monitor live field progress on the TRN BGO Dashboard or inspect individual row completion in BGO Rows.",
  },
  completed: {
    title: "Completed",
    meaning: "Batches where field execution has finished and all constituent child transactions have been executed.",
    criteria: "Batches with status 'COMPLETED' or where 100% of child transactions have reached their terminal completion or closure state.",
    nextAction: "Review final completion reports, verify audit records, and confirm meter reconciliation.",
  },
};

function SummaryCard({ label, value, metersCount, onHelpClick }) {
  return (
    <div style={styles.summaryCard}>
      <div style={styles.summaryCardHeader}>
        <span style={styles.summaryCardLabel}>{label}</span>
        <button
          type="button"
          style={styles.helpButton}
          onClick={onHelpClick}
          aria-label={`Learn more about ${label}`}
          title={`Click to learn what ${label} means`}
        >
          ?
        </button>
      </div>

      <div style={styles.summaryCardBody}>
        <strong style={styles.summaryCardValue}>{formatNumber(value)}</strong>
      </div>

      <div style={styles.summaryCardFooter}>
        <span style={styles.metersPill} title={`Total meters in ${label.toLowerCase()} batches`}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          {formatNumber(metersCount)} {metersCount === 1 ? "Meter" : "Meters"}
        </span>
      </div>
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
    data: sourceUploads = [],
    isLoading: isUploadsLoading,
    error: uploadsError,
  } = useGetTcUploadsQuery({ limit: 500 });

  const batchIds = sourceUploads.filter(batch => batch.contractVersion).map(batch => batch.id).sort();
  const { currentData: progress } = useGetTrnBgoProgressQuery({ batchIds });
  const uploads = useMemo(() => sourceUploads.map(batch => {
    if (!batch.contractVersion) return { ...batch, notStartedRows: Math.max(0, Number(batch.totalRows || 0) - Number(batch.inProgressRows || 0) - Number(batch.completedRows || 0)) };
    const counts = progress?.ready && !progress.error ? progress.counts[batch.id] : null;
    return { ...batch, notStartedRows: counts?.notStartedRows ?? null,
      ...(counts ? { inProgressRows: counts.inProgressRows, completedRows: counts.completedRows } : {}) };
  }), [sourceUploads, progress]);

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

  // KPI Help Modal state
  const [activeHelpKpi, setActiveHelpKpi] = useState(null);

  // Summary KPIs across existing TRN candidate batches
  // 1. Total Batches (with total meters)
  // 2. Unallocated (with unallocated meters)
  // 3. Allocated (with allocated meters)
  // 4. Completed (with completed meters)
  const summary = useMemo(() => {
    let unallocatedBatches = 0;
    let unallocatedMeters = 0;

    let allocatedBatches = 0;
    let allocatedMeters = 0;

    let completedBatches = 0;
    let completedMeters = 0;

    let totalBatches = uploads.length;
    let totalMeters = 0;

    uploads.forEach((item) => {
      const totalRows = Number(item.totalRows || 0);
      const inProgress = Number(item.inProgressRows || 0);
      const completed = Number(item.completedRows || 0);
      const isCompletedBatch = (totalRows > 0 && completed >= totalRows) ||
        String(item.workflowState || item.workflow?.state || item.bgoStatus || "").toUpperCase() === "COMPLETED";

      totalMeters += totalRows;

      if (isCompletedBatch) {
        completedBatches += 1;
        completedMeters += totalRows;
      } else {
        const alloc = getBatchAllocationStatus(item);
        if (alloc.label === "Allocated") {
          allocatedBatches += 1;
          allocatedMeters += totalRows;
        } else {
          unallocatedBatches += 1;
          unallocatedMeters += totalRows;
        }
      }
    });

    return {
      totalBatches,
      totalMeters,
      unallocatedBatches,
      unallocatedMeters,
      allocatedBatches,
      allocatedMeters,
      completedBatches,
      completedMeters,
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
    const inProgress = Number(deleteCandidate.inProgressRows || 0);
    const completed = Number(deleteCandidate.completedRows || 0);
    if (inProgress > 0 || completed > 0) {
      setDeleteError(
        `Cannot delete batch: field execution has commenced (${inProgress} in progress, ${completed} completed).`
      );
      return;
    }
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
          to={`/operations/trn-bgo/map?batchId=${encodeURIComponent(batch.id)}`}
          style={styles.mapLinkButton}
          title="View Batch Map"
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
        batch.sourceFileId ? <Link to={`/operations/trn-bgo/source/${batch.sourceFileId}`} style={styles.fileNameCell}>{batch.fileName}</Link> :
        <span style={styles.fileNameCell} title={batch.fileName}>{batch.fileName || "NAv"}</span>
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
        const alloc = getBatchAllocationStatus(batch);
        const isAllocated = alloc.label === "Allocated";
        return (
          <Link
            to={`/operations/trn-bgo/allocation?batchId=${encodeURIComponent(batch.id)}`}
            style={{
              ...styles.allocateButton,
              ...(isAllocated
                ? {
                    background: "#ecfdf5",
                    borderColor: "#a7f3d0",
                    color: "#047857",
                  }
                : null),
            }}
            title={isAllocated ? `Allocated to ${batch.allocatedTo || "Team/SP"}` : "Allocate this batch"}
          >
            {isAllocated ? "Allocated" : "Allocate"}
          </Link>
        );
      },
    },
    {
      key: "bgoStatus",
      label: "BGO Status",
      sortable: true,
      filter: "select",
      value: (batch) => getBatchAllocationStatus(batch).label,
      sortValue: (batch) => getBatchAllocationStatus(batch).label,
      render: (batch) => {
        const badge = getBatchAllocationStatus(batch);
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
      key: "totalRows",
      label: "Total",
      sortable: true,
      filter: "text",
      value: (batch) => String(batch.totalRows ?? 0),
      sortValue: (batch) => Number(batch.totalRows || 0),
      render: (batch) => (
        <strong style={styles.totalCell}>{formatNumber(batch.totalRows)}</strong>
      ),
    },
    {
      key: "notStartedRows",
      label: "Not Started",
      sortable: true,
      filter: "text",
      value: (batch) => batch.notStartedRows == null ? "NAv" : String(batch.notStartedRows),
      sortValue: (batch) => batch.notStartedRows,
      sortEmptyLast: true,
      render: (batch) => <strong style={styles.totalCell}>{batch.notStartedRows == null ? "NAv" : formatNumber(batch.notStartedRows)}</strong>,
    },
    {
      key: "inProgressRows",
      label: "In Progress",
      sortable: true,
      filter: "text",
      value: (batch) => String(batch.inProgressRows ?? 0),
      sortValue: (batch) => Number(batch.inProgressRows || 0),
      render: (batch) => (
        <strong
          style={{
            color: Number(batch.inProgressRows || 0) > 0 ? "#b45309" : "#64748b",
            fontWeight: 800,
          }}
        >
          {formatNumber(batch.inProgressRows)}
        </strong>
      ),
    },
    {
      key: "completedRows",
      label: "Completed",
      sortable: true,
      filter: "text",
      value: (batch) => String(batch.completedRows ?? 0),
      sortValue: (batch) => Number(batch.completedRows || 0),
      render: (batch) => (
        <strong
          style={{
            color: Number(batch.completedRows || 0) > 0 ? "#15803d" : "#64748b",
            fontWeight: 800,
          }}
        >
          {formatNumber(batch.completedRows)}
        </strong>
      ),
    },
    {
      key: "wardPcode",
      label: "Ward",
      sortable: true,
      filter: "text",
      value: (batch) => batch.wardPcode || batch.scope?.wardPcode || "NAv",
      sortValue: (batch) => batch.wardPcode || batch.scope?.wardPcode || "",
      render: (batch) => (
        <div style={styles.strongCell}>{batch.wardPcode || batch.scope?.wardPcode || "NAv"}</div>
      ),
    },
    {
      key: "delete",
      label: "Delete BGO",
      width: 96,
      filter: null,
      sortable: false,
      export: false,
      render: (batch) => {
        const inProgress = Number(batch.inProgressRows || 0);
        const completed = Number(batch.completedRows || 0);
        const canDelete = inProgress === 0 && completed === 0;

        return (
          <button
            type="button"
            style={{
              ...styles.deleteBatchButton,
              ...(!canDelete
                ? {
                    opacity: 0.45,
                    cursor: "not-allowed",
                    background: "#f1f5f9",
                    color: "#94a3b8",
                    borderColor: "#e2e8f0",
                  }
                : null),
            }}
            disabled={!canDelete}
            onClick={() => {
              if (canDelete) handleOpenDelete(batch);
            }}
            title={
              canDelete
                ? "Delete this batch upload"
                : `Cannot delete: ${inProgress} meters in progress, ${completed} completed`
            }
          >
            Delete
          </button>
        );
      },
    },
  ], [tickedBatchIds]);

  return (
    <section style={styles.page}>
      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Operations / TRN BGO Register</p>
          <div style={styles.titleHelpRow}>
            <h2 style={styles.title}>TRN BGO Register</h2>
            <div style={styles.lmHeaderPill}>
              <span style={styles.lmHeaderDot} />
              <span style={styles.lmHeaderLabel}>Local Municipality:</span>
              <strong style={styles.lmHeaderValue}>{lmName || lmPcode || "Active Municipality"}</strong>
              {lmPcode ? <span style={styles.lmHeaderPcode}>({lmPcode})</span> : null}
            </div>
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

      {/* 4 Standardized KPI Summary Cards */}
      <div style={styles.summaryGrid}>
        <SummaryCard
          label="Total Batches"
          value={summary.totalBatches}
          metersCount={summary.totalMeters}
          onHelpClick={() => setActiveHelpKpi(KPI_HELP_DETAILS.totalBatches)}
        />
        <SummaryCard
          label="Unallocated"
          value={summary.unallocatedBatches}
          metersCount={summary.unallocatedMeters}
          onHelpClick={() => setActiveHelpKpi(KPI_HELP_DETAILS.unallocated)}
        />
        <SummaryCard
          label="Allocated"
          value={summary.allocatedBatches}
          metersCount={summary.allocatedMeters}
          onHelpClick={() => setActiveHelpKpi(KPI_HELP_DETAILS.allocated)}
        />
        <SummaryCard
          label="Completed"
          value={summary.completedBatches}
          metersCount={summary.completedMeters}
          onHelpClick={() => setActiveHelpKpi(KPI_HELP_DETAILS.completed)}
        />
      </div>

      <div style={styles.tablePanel}>
        {progress?.error ? <p role="alert">{progress.error}</p> : null}
        <IrepsTable showLoadingSpinner
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
          loading={isUploadsLoading || (batchIds.length > 0 && !progress?.ready)}
          loadingText="Loading TRN BGO Batches..."
          downloads={{
            registryName: "TRN BGO Register",
            fileBaseName: "trn_bgo_register",
            columns: columns.filter((col) => col.export !== false),
          }}
        />
      </div>

      {/* KPI Help Modal */}
      {activeHelpKpi ? (
        <div style={styles.modalOverlay} role="dialog" aria-modal="true">
          <div style={styles.helpModalBox}>
            <div style={styles.modalHeaderRow}>
              <div>
                <span style={styles.modalEyebrow}>TRN BGO KPI Explainer</span>
                <h3 style={styles.helpModalTitle}>{activeHelpKpi.title}</h3>
              </div>
              <button
                type="button"
                style={styles.closeModalButton}
                onClick={() => setActiveHelpKpi(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div style={styles.helpContentSection}>
              <div style={styles.helpSection}>
                <h4 style={styles.helpSubheading}>What does this KPI represent?</h4>
                <p style={styles.helpText}>{activeHelpKpi.meaning}</p>
              </div>

              <div style={styles.helpSection}>
                <h4 style={styles.helpSubheading}>Lifecycle & Inclusion Criteria</h4>
                <p style={styles.helpText}>{activeHelpKpi.criteria}</p>
              </div>

              <div style={styles.helpSection}>
                <h4 style={styles.helpSubheading}>Next Operational Action</h4>
                <p style={styles.helpText}>{activeHelpKpi.nextAction}</p>
              </div>
            </div>

            <div style={styles.modalActions}>
              <button
                type="button"
                style={styles.modalPrimaryButton}
                onClick={() => setActiveHelpKpi(null)}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 16,
    marginBottom: 20,
  },
  summaryCard: {
    background: "#ffffff",
    padding: "16px 18px",
    borderRadius: 14,
    border: "1px solid #e2e8f0",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    minHeight: 110,
    boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
  },
  summaryCardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  summaryCardLabel: {
    fontSize: 12,
    fontWeight: 800,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  helpButton: {
    width: 22,
    height: 22,
    borderRadius: "50%",
    border: "1px solid #cbd5e1",
    background: "#f8fafc",
    color: "#64748b",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    transition: "all 0.15s ease",
  },
  summaryCardBody: {
    margin: "8px 0",
  },
  summaryCardValue: {
    fontSize: 28,
    fontWeight: 900,
    color: "#0f172a",
    lineHeight: 1,
  },
  summaryCardFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  metersPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "4px 8px",
    borderRadius: 6,
    background: "#f1f5f9",
    color: "#334155",
    fontSize: 12,
    fontWeight: 800,
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
  lmHeaderPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 12px",
    borderRadius: 9999,
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    fontSize: 12,
    color: "#1e40af",
  },
  lmHeaderDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#2563eb",
  },
  lmHeaderLabel: {
    fontWeight: 600,
    color: "#475569",
  },
  lmHeaderValue: {
    fontWeight: 800,
    color: "#0f172a",
  },
  lmHeaderPcode: {
    color: "#64748b",
    fontWeight: 600,
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
  helpModalBox: {
    background: "#ffffff",
    borderRadius: 20,
    padding: 24,
    maxWidth: 520,
    width: "100%",
    boxShadow: "0 25px 30px -5px rgba(0, 0, 0, 0.15)",
  },
  modalHeaderRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 16,
  },
  modalEyebrow: {
    fontSize: 11,
    fontWeight: 800,
    color: "#2563eb",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  modalTitle: {
    margin: "0 0 12px",
    fontSize: 18,
    fontWeight: 900,
    color: "#0f172a",
  },
  helpModalTitle: {
    margin: "4px 0 0",
    fontSize: 20,
    fontWeight: 900,
    color: "#0f172a",
  },
  closeModalButton: {
    background: "transparent",
    border: 0,
    fontSize: 24,
    lineHeight: 1,
    color: "#94a3b8",
    cursor: "pointer",
    padding: "2px 6px",
    borderRadius: 6,
  },
  helpContentSection: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    marginBottom: 20,
  },
  helpSection: {
    background: "#f8fafc",
    padding: 12,
    borderRadius: 10,
    border: "1px solid #e2e8f0",
  },
  helpSubheading: {
    margin: "0 0 6px",
    fontSize: 12,
    fontWeight: 800,
    color: "#334155",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },
  helpText: {
    margin: 0,
    fontSize: 13,
    color: "#475569",
    lineHeight: 1.5,
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
  modalPrimaryButton: {
    padding: "10px 20px",
    borderRadius: 10,
    border: 0,
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 800,
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
