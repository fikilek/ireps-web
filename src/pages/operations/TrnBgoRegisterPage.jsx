/* eslint-disable no-unused-vars -- JSX component tags are consumed by the JSX transform. */
import LoadingIndicator from "../../components/LoadingIndicator";
import { batchCreator } from "../../redux/trnBgoRegisterDetails.js";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import {
  useAllocateTrnBgoWardBatchesMutation,
  useGetTcUploadsQuery,
  useGetTrnBgoProgressQuery,
  useGetTrnBgoRegisterDetailsQuery,
  useDeleteTcUploadMutation,
} from "../../redux/tcApi";
import {
  buildTrnBgoRegisterRow,
  trnBgoRegisterSearchValue,
} from "./trn-bgo/trnBgoRegisterModel";
import IrepsTable from "../../components/table/IrepsTable";

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-ZA") : "0";
}

function GeofenceCountPill({ batchId, detail }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const names = useMemo(() => {
    if (Array.isArray(detail?.names)) return detail.names;
    const text = String(detail?.text || "").trim();
    if (!text || text === "NAv") return [];
    return text.split(",").map((s) => s.trim()).filter(Boolean);
  }, [detail]);

  if (!names.length) {
    return (
      <span style={styles.mutedCell} title={detail?.error || undefined}>
        NAv
      </span>
    );
  }

  const updatePos = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 320;
    const maxLeft = Math.max(12, window.innerWidth - width - 12);
    setPos({
      top: Math.min(rect.bottom + 6, Math.max(12, window.innerHeight - 280)),
      left: Math.min(Math.max(12, rect.left), maxLeft),
    });
  };

  return (
    <span
      ref={anchorRef}
      style={styles.geofenceWrap}
      onMouseEnter={() => {
        updatePos();
        setOpen(true);
      }}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        style={styles.geofencePill}
        onFocus={() => {
          updatePos();
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        aria-label={`${names.length} geofences for batch ${batchId}`}
      >
        {names.length}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={`Geofences for ${batchId}`}
          style={{ ...styles.geofencePopover, top: pos.top, left: pos.left }}
        >
          <div style={styles.geofencePopoverHead}>
            <span style={styles.geofencePopoverTitle}>
              Geofences ({names.length})
            </span>
            <span style={styles.geofencePopoverSub}>{batchId}</span>
          </div>
          <ol style={styles.geofenceList}>
            {names.map((name) => (
              <li key={name} style={styles.geofenceListItem}>
                {name}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </span>
  );
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

function getBatchAllocationStatus(batch) {
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
    workflowState === "ACCEPTED" ||
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

  const batchIds = useMemo(
    () => sourceUploads.filter(batch => batch.contractVersion).map(batch => batch.id).sort(),
    [sourceUploads],
  );
  const allBatchIds = useMemo(
    () => sourceUploads.map(batch => batch.id).sort(),
    [sourceUploads],
  );
  const { currentData: progress } = useGetTrnBgoProgressQuery(
    { batchIds },
    { skip: !batchIds.length },
  );
  const { currentData: registerDetails } = useGetTrnBgoRegisterDetailsQuery(
    { batchIds: allBatchIds },
    { skip: !allBatchIds.length },
  );
  const uploads = useMemo(() => sourceUploads.map(batch => {
    if (!batch.contractVersion) return { ...batch, notStartedRows: Math.max(0, Number(batch.totalRows || 0) - Number(batch.inProgressRows || 0) - Number(batch.completedRows || 0)) };
    const counts = progress?.ready && !progress.error ? progress.counts[batch.id] : null;
    return {
      ...batch,
      notStartedRows: counts?.notStartedRows ?? null,
      inProgressRows: counts ? counts.inProgressRows : null,
      completedRows: counts ? counts.completedRows : null,
    };
  }), [sourceUploads, progress]);

  const [deleteTcUpload, { isLoading: isDeletingUpload }] = useDeleteTcUploadMutation();
  const [allocateTrnBgoWardBatches, { isLoading: isUnallocatingBgo }] = useAllocateTrnBgoWardBatchesMutation();

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

  // Delete & Unallocate modal state
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [unallocateCandidate, setUnallocateCandidate] = useState(null);
  const [unallocateReason, setUnallocateReason] = useState("");
  const [unallocateOutcome, setUnallocateOutcome] = useState(null);

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

  const tableRows = useMemo(
    () => uploads.map((batch) => buildTrnBgoRegisterRow(batch, registerDetails)),
    [uploads, registerDetails],
  );

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

  const handleUnallocateBatch = async () => {
    if (!unallocateCandidate || isUnallocatingBgo) return;
    const expectedIssuedAt =
      unallocateCandidate.raw?.workflow?.issuedAt || unallocateCandidate.workflow?.issuedAt;
    if (!expectedIssuedAt) {
      setUnallocateOutcome({
        kind: "failure",
        batchId: unallocateCandidate.id,
        message: "The allocation timestamp is unavailable. Refresh the register and reopen Unallocate.",
      });
      setUnallocateCandidate(null);
      setUnallocateReason("");
      return;
    }
    try {
      const response = await allocateTrnBgoWardBatches({
        batchIds: [unallocateCandidate.id],
        targetType: "UNALLOCATE",
        expectedIssuedAt,
        reason: unallocateReason,
      }).unwrap();
      setUnallocateOutcome({
        kind: "success",
        batchId: unallocateCandidate.id,
        message: response?.message || `Batch ${unallocateCandidate.id} is ready for allocation.`,
      });
      setUnallocateCandidate(null);
      setUnallocateReason("");
    } catch (err) {
      setUnallocateOutcome({
        kind: "failure",
        batchId: unallocateCandidate.id,
        message: err?.data?.message || err?.message || "Could not unallocate this TRN BGO batch.",
      });
      setUnallocateCandidate(null);
      setUnallocateReason("");
    }
  };

  const progressPendingOrError = batchIds.length > 0 && (!progress?.ready || Boolean(progress?.error));

  // IrepsTable column definitions (aligned with MdBgoRegisterPage + TRN Type & File Name)
  const columns = useMemo(() => {
    const countCell = (value) => value == null ? (progress?.error ? "NAv" : "…") : formatNumber(value);
    return [
    {
      key: "select",
      label: "[ ]",
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
      export: false,
      render: (batch) => (
        <Link
          to={`/operations/trn-bgo/map?batchId=${encodeURIComponent(batch.id)}`}
          style={styles.mapLinkButton}
          title="View TRN BGO Batch Map"
          aria-label={`View TRN BGO Batch Map for ${batch.id}`}
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
      filter: "text",
      value: (batch) => batch.id,
    },
    {
      key: "trnType",
      label: "TRN Type",
      filter: "select",
      value: (batch) => getTrnTypeInfo(batch.trnType).label,
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
              whiteSpace: "nowrap",
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
      filter: "text",
      value: (batch) => batch.fileName || "",
      render: (batch) => (
        batch.sourceFileId ? (
          <Link to={`/operations/trn-bgo/source/${batch.sourceFileId}`} style={styles.fileNameCell}>
            {batch.fileName}
          </Link>
        ) : (
          <span style={styles.fileNameCell} title={batch.fileName}>
            {batch.fileName || "NAv"}
          </span>
        )
      ),
    },
    {
      key: "bgoRows",
      label: "BGO Rows",
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
      filter: "select",
      value: (batch) => batch.allocation,
      filterOptions: [
        { value: "NOT ALLOCATED", label: "Not Allocated" },
        { value: "ALLOCATED", label: "Allocated" },
      ],
      render: (batch) => batch.isAllocated ? (
        <button
          type="button"
          style={{
            ...styles.unallocateButton,
            ...((batch.fieldworkStarted || batch.unallocationIntentUnavailable) ? styles.disabledButton : null),
          }}
          disabled={batch.fieldworkStarted || batch.unallocationIntentUnavailable}
          title={
            batch.fieldworkStarted
              ? "Field work has started; this batch cannot be unallocated"
              : batch.unallocationIntentUnavailable
                ? "Allocation details are incomplete or legacy; contact an MNG"
                : "Unallocate this batch before field work starts"
          }
          onClick={() => {
            setUnallocateReason("");
            setUnallocateCandidate(batch);
          }}
        >
          Unallocate
        </button>
      ) : (
        <Link
          to={`/operations/trn-bgo/allocation?batchId=${encodeURIComponent(batch.id)}`}
          style={styles.rowLinkButton}
          title="Allocate this batch on Allocation Board"
        >
          Allocate
        </Link>
      ),
    },
    {
      key: "allocatedTo",
      label: "Allocated To",
      filter: "select",
      value: (batch) => batch.allocatedTo,
    },
    {
      key: "batchStatus",
      label: "Batch Status",
      filter: "select",
      value: (batch) => batch.batchStatus,
    },
    {
      key: "totalRows",
      label: "Total",
      filter: "text",
      value: (batch) => batch.totalRows,
      sortValue: (batch) => Number(batch.totalRows || 0),
      sortEmptyLast: true,
      render: (batch) => batch.totalRows == null ? "NAv" : formatNumber(batch.totalRows),
    },
    {
      key: "notStartedRows",
      label: "Not Started",
      filter: "text",
      value: (batch) => batch.notStartedRows,
      sortValue: (batch) => batch.notStartedRows,
      sortEmptyLast: true,
      filterDisabled: progressPendingOrError,
      render: (batch) => countCell(batch.notStartedRows),
    },
    {
      key: "inProgressRows",
      label: "In Progress",
      filter: "text",
      value: (batch) => batch.inProgressRows,
      sortValue: (batch) => batch.inProgressRows,
      sortEmptyLast: true,
      filterDisabled: progressPendingOrError,
      render: (batch) => countCell(batch.inProgressRows),
    },
    {
      key: "completedRows",
      label: "Completed",
      filter: "text",
      value: (batch) => batch.completedRows,
      sortValue: (batch) => batch.completedRows,
      sortEmptyLast: true,
      filterDisabled: progressPendingOrError,
      render: (batch) => countCell(batch.completedRows),
    },
    {
      key: "ward",
      label: "Ward",
      filter: "select",
      value: (batch) => batch.ward,
      exportValue: (batch) => `${batch.ward} (${batch.wardPcode})`,
      render: (batch) => (
        <div>
          <div style={styles.strongCell}>{batch.wardNo}</div>
          <div style={styles.mutedCell}>{batch.wardPcode}</div>
        </div>
      ),
    },
    {
      key: "geofence",
      label: "Geofence",
      filter: "text",
      value: (batch) => registerDetails?.[batch.id]?.text || "NAv",
      render: (batch) => registerDetails?.[batch.id]?.ready ? (
        <GeofenceCountPill batchId={batch.id} detail={registerDetails[batch.id]} />
      ) : (
        <LoadingIndicator>Loading…</LoadingIndicator>
      ),
    },
    {
      key: "createdBy",
      label: "Created By",
      filter: "text",
      value: batchCreator,
      render: (batch) => <div>{batchCreator(batch)}</div>,
    },
    {
      key: "delete",
      label: "Delete BGO",
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
              ...(!canDelete ? styles.disabledButton : null),
            }}
            disabled={!canDelete}
            onClick={() => {
              if (canDelete) handleOpenDelete(batch);
            }}
            title={
              canDelete
                ? "Delete this unaccepted BGO batch"
                : "Cannot delete active or in-progress batch"
            }
          >
            Delete BGO
          </button>
        );
      },
    },
  ];
  }, [tickedBatchIds, registerDetails, progressPendingOrError, progress?.error]);

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
            TRN BGO batches originate from existing meters grouped by Ward.
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
        </div>
      </div>

      {uploadsError ? (
        <div style={styles.errorNotice}>
          <strong>TRN BGO Register could not be loaded</strong>
          <div>{uploadsError?.data?.message || uploadsError?.message || "Unknown error"}</div>
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

      <div style={styles.panel}>
        <div style={styles.panelHeader}>
          <div>
            <p style={styles.panelSubtitle}>
              Permanent batches loaded from tc_uploads for {lmName} ({lmPcode}).
            </p>
          </div>

          <div style={styles.draftStreamBadge}>Permanent Firestore register</div>
        </div>

        {progress?.error ? <p role="alert" style={styles.errorNotice}>{progress.error}</p> : null}
        <IrepsTable
          showLoadingSpinner
          title="Permanent Transaction Batches"
          columns={columns}
          stickyColumnKeys={["select", "map", "batchId"]}
          rows={tableRows}
          rowKey={(batch) => batch.id}
          defaultSort={{ key: "createdAt", direction: "desc" }}
          extraFiltersActive={tickedBatchIds.size > 0}
          onClearFilters={clearTicks}
          searchValue={trnBgoRegisterSearchValue}
          searchPlaceholder="Batch IDs, types, files, teams, wards, geofences, statuses, creators…"
          emptyText={
            uploads.length === 0
              ? "No permanent TRN BGO Batches were found."
              : "No permanent TRN BGO Batches match the current scope or filters."
          }
          loading={isUploadsLoading || (batchIds.length > 0 && !progress?.ready)}
          loadingText="Loading TRN BGO Batches..."
          downloads={{
            registryName: "TRN BGO Register",
            fileBaseName: "trn_bgo_register",
            scope: { module: "TRN BGO Register", lmPcode },
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
        <div style={styles.modalOverlay} role="presentation">
          <div style={styles.modalCard} role="dialog" aria-modal="true">
            <p style={styles.eyebrow}>Delete TRN BGO Batch</p>
            <h2 style={styles.modalTitle}>{deleteCandidate.id}</h2>
            <p style={styles.modalSubtitle}>
              Are you sure you want to delete batch <strong>{deleteCandidate.id}</strong> ({deleteCandidate.fileName})?
              This will remove the uploaded batch and all associated rows.
            </p>

            {deleteError ? (
              <div style={styles.modalError}>{deleteError}</div>
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
                {isDeletingUpload ? "Deleting..." : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Unallocate Batch Modal */}
      {unallocateCandidate ? (
        <div style={styles.modalOverlay} role="presentation">
          <div style={styles.modalCard} role="dialog" aria-modal="true" aria-labelledby="trn-bgo-unallocate-title">
            <p style={styles.eyebrow}>Unallocate TRN BGO Batch</p>
            <h2 id="trn-bgo-unallocate-title" style={styles.modalTitle}>{unallocateCandidate.id}</h2>
            <p style={styles.modalSubtitle}>
              Take this batch back from <strong>{unallocateCandidate.allocatedTo !== "NAv" ? unallocateCandidate.allocatedTo : "the assigned target"}</strong> and return it to Ready for Allocation. The batch and its meter rows will be preserved.
            </p>
            {String(unallocateCandidate.workflowState || unallocateCandidate.raw?.workflow?.state || "").toUpperCase() === "ACCEPTED" ? (
              <div style={styles.unallocateWarning}>The team has accepted this batch. It may remain on their device until it reconnects; the server will refuse any later field submission.</div>
            ) : null}
            <label style={styles.reasonLabel} htmlFor="trn-bgo-unallocate-reason">Reason for unallocation</label>
            <textarea
              id="trn-bgo-unallocate-reason"
              value={unallocateReason}
              onChange={(event) => setUnallocateReason(event.target.value)}
              maxLength={1000}
              rows={4}
              style={styles.reasonInput}
              disabled={isUnallocatingBgo}
            />
            <div style={styles.modalActions}>
              <button
                type="button"
                style={styles.modalCancelButton}
                onClick={() => setUnallocateCandidate(null)}
                disabled={isUnallocatingBgo}
              >
                Cancel
              </button>
              <button
                type="button"
                style={styles.modalPrimaryButton}
                onClick={handleUnallocateBatch}
                disabled={isUnallocatingBgo || !unallocateReason.trim()}
              >
                {isUnallocatingBgo ? "Unallocating..." : "Confirm Unallocate"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Unallocate Outcome Modal */}
      {unallocateOutcome ? (
        <div style={styles.modalOverlay} role="presentation">
          <div style={styles.modalCard} role="dialog" aria-modal="true" aria-labelledby="trn-bgo-unallocate-outcome-title">
            <p style={styles.eyebrow}>
              {unallocateOutcome.kind === "success"
                ? "Unallocation Successful"
                : "Unallocation Failed"}
            </p>
            <h2 id="trn-bgo-unallocate-outcome-title" style={styles.modalTitle}>{unallocateOutcome.batchId}</h2>
            <p style={styles.modalSubtitle}>
              {unallocateOutcome.kind === "success"
                ? "This batch is now Ready for Allocation."
                : unallocateOutcome.message}
            </p>
            <div style={styles.modalActions}>
              <button
                type="button"
                style={styles.modalPrimaryButton}
                onClick={() => {
                  const successful = unallocateOutcome.kind === "success";
                  setUnallocateOutcome(null);
                  if (successful) navigate("/operations/trn-bgo");
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

const styles = {
  page: { padding: 24 },
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
  disabledButton: {
    opacity: 0.5,
    pointerEvents: "none",
    cursor: "not-allowed",
  },
  errorNotice: {
    marginBottom: 16,
    padding: 14,
    border: "1px solid #fecaca",
    borderRadius: 16,
    background: "#fef2f2",
    color: "#991b1b",
    fontSize: 13,
  },
  successNotice: {
    marginBottom: 16,
    padding: 14,
    border: "1px solid #bbf7d0",
    borderRadius: 16,
    background: "#f0fdf4",
    color: "#166534",
    fontSize: 13,
    fontWeight: 700,
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
    marginBottom: 20,
  },
  summaryCard: {
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    background: "#ffffff",
    padding: "16px 18px",
    boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
  },
  summaryCardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  summaryCardLabel: {
    display: "block",
    color: "#64748b",
    fontSize: 12,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: 6,
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
  },
  summaryCardBody: {
    margin: "4px 0 8px",
  },
  summaryCardValue: {
    display: "block",
    color: "#0f172a",
    fontSize: 26,
    fontWeight: 900,
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
  panel: {
    border: "1px solid #e2e8f0",
    borderRadius: 24,
    background: "#ffffff",
    padding: 20,
    boxShadow: "0 4px 16px rgba(15, 23, 42, 0.04)",
  },
  panelHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 16,
    flexWrap: "wrap",
  },
  panelSubtitle: {
    margin: "4px 0 0",
    color: "#64748b",
    fontSize: 13,
  },
  draftStreamBadge: {
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 12px",
    borderRadius: 999,
    background: "#f1f5f9",
    color: "#475569",
    fontSize: 11,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  mapLinkButton: {
    width: 30,
    height: 30,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 auto",
    borderRadius: 9,
    border: "1px solid #93c5fd",
    background: "#eff6ff",
    color: "#1d4ed8",
    textDecoration: "none",
  },
  strongCell: {
    fontWeight: 700,
    color: "#0f172a",
  },
  mutedCell: {
    fontSize: 11,
    color: "#64748b",
  },
  fileNameCell: {
    maxWidth: 240,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "#1d4ed8",
    display: "block",
  },
  rowLinkButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #bfdbfe",
    borderRadius: 999,
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "5px 14px",
    fontWeight: 800,
    fontSize: 12,
    textDecoration: "none",
    whiteSpace: "nowrap",
  },
  unallocateButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #fde68a",
    borderRadius: 999,
    background: "#fffbeb",
    color: "#b45309",
    padding: "5px 14px",
    fontWeight: 800,
    fontSize: 12,
    textDecoration: "none",
    whiteSpace: "nowrap",
    cursor: "pointer",
  },
  deleteBatchButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #fca5a5",
    borderRadius: 999,
    background: "#ffffff",
    color: "#dc2626",
    padding: "5px 12px",
    fontWeight: 800,
    fontSize: 11,
    cursor: "pointer",
    whiteSpace: "nowrap",
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
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 23, 42, 0.45)",
    backdropFilter: "blur(2px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    padding: 16,
  },
  modalCard: {
    background: "#ffffff",
    borderRadius: 20,
    padding: 24,
    maxWidth: 480,
    width: "100%",
    boxSizing: "border-box",
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
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
    margin: "6px 0 8px",
    fontSize: 18,
    lineHeight: 1.3,
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    color: "#0f172a",
  },
  modalSubtitle: {
    margin: "0 0 16px",
    color: "#64748b",
    fontSize: 14,
    lineHeight: 1.5,
    overflowWrap: "anywhere",
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
  modalError: {
    padding: 10,
    borderRadius: 8,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
    fontSize: 12,
    marginBottom: 14,
  },
  modalActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
  },
  modalCancelButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    background: "#ffffff",
    color: "#475569",
    padding: "8px 16px",
    fontWeight: 800,
    cursor: "pointer",
  },
  modalDeleteButton: {
    border: 0,
    borderRadius: 10,
    background: "#dc2626",
    color: "#ffffff",
    padding: "8px 16px",
    fontWeight: 800,
    cursor: "pointer",
  },
  modalPrimaryButton: {
    border: 0,
    borderRadius: 10,
    background: "#2563eb",
    color: "#ffffff",
    padding: "8px 16px",
    fontWeight: 800,
    cursor: "pointer",
  },
  reasonLabel: { display: "block", marginBottom: 6, color: "#334155", fontSize: 13, fontWeight: 800 },
  reasonInput: { boxSizing: "border-box", width: "100%", border: "1px solid #cbd5e1", borderRadius: 10, padding: 10, marginBottom: 14, font: "inherit", resize: "vertical" },
  unallocateWarning: { padding: 10, borderRadius: 8, background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", fontSize: 12, lineHeight: 1.5, marginBottom: 14 },
  geofenceWrap: { position: "relative", display: "inline-flex", alignItems: "center" },
  geofencePill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 28,
    height: 24,
    padding: "0 9px",
    borderRadius: 999,
    border: "1px solid #bfdbfe",
    background: "#eff6ff",
    color: "#1d4ed8",
    fontSize: 12,
    fontWeight: 800,
    cursor: "pointer",
  },
  geofencePopover: {
    position: "fixed",
    zIndex: 1200,
    width: 320,
    maxHeight: 260,
    overflowY: "auto",
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: 12,
    boxShadow: "0 16px 32px rgba(15, 23, 42, 0.16)",
    padding: 12,
    display: "grid",
    gap: 8,
    textAlign: "left",
  },
  geofencePopoverHead: {
    display: "grid",
    gap: 2,
    paddingBottom: 6,
    borderBottom: "1px solid #e2e8f0",
  },
  geofencePopoverTitle: { fontSize: 12, fontWeight: 800, color: "#0f172a" },
  geofencePopoverSub: { fontSize: 11, color: "#64748b", wordBreak: "break-all" },
  geofenceList: {
    margin: 0,
    paddingLeft: 18,
    display: "grid",
    gap: 4,
    fontSize: 12,
    color: "#1e293b",
  },
  geofenceListItem: { lineHeight: 1.35 },
};
