/* eslint-disable no-unused-vars -- JSX component tags are consumed by the JSX transform. */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import {
  useGetBgoBatchesByLmQuery,
  useGetMdBgoRowsByLmQuery,
  useDeleteUnacceptedBgoMutation,
  useUnallocateMdBgoBatchMutation,
} from "../../redux/bgoApi";
import { useMdBgoAllocationSelection } from "./md-bgo/allocationSelection";
import { buildMdBgoRegisterRow, getAllocationStatus, getMdBgoRowStatusCounts, isBmdBatch, mdBgoRegisterSearchValue } from "./md-bgo/mdBgoRegisterModel";
import IrepsTable from "../../components/table/IrepsTable";

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-ZA") : "0";
}

function valueOrNav(value) {
  const text = String(value ?? "").trim();
  return text || "NAv";
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

function SummaryCard({ label, value }) {
  return (
    <div style={styles.summaryCard}>
      <span style={styles.summaryCardLabel}>{label}</span>
      <strong style={styles.summaryCardValue}>{formatNumber(value)}</strong>
    </div>
  );
}

export default function MdBgoRegisterPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const { geoState } = useGeo();

  const { lmPcode, lmName } = useMemo(
    () => resolveWorkbase(auth, geoState),
    [auth, geoState],
  );

  const {
    data: allBatches = [],
    isLoading: isBatchesLoading,
    error: batchesLoadError,
  } = useGetBgoBatchesByLmQuery(
    { lmPcode },
    { skip: !lmPcode },
  );
  const { data: mdBgoRowsStream = { rows: [], ready: false, error: "" } } =
    useGetMdBgoRowsByLmQuery({ lmPcode }, { skip: !lmPcode });
  const mdBgoRowCountsByBatchId = useMemo(
    () => getMdBgoRowStatusCounts(mdBgoRowsStream.rows),
    [mdBgoRowsStream.rows],
  );

  const [deleteBgo, { isLoading: isDeletingBgo }] = useDeleteUnacceptedBgoMutation();
  const [unallocateBgo, { isLoading: isUnallocatingBgo }] = useUnallocateMdBgoBatchMutation();

  // MD-BGO-R017: register ticks persist per LM so the Allocation Map can show the same selection.
  const { selectedIds: tickedBatchIds, isTicked, toggle: toggleTick, clear: clearTicks } = useMdBgoAllocationSelection(lmPcode);

  // Delete modal state
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [unallocateCandidate, setUnallocateCandidate] = useState(null);
  const [unallocateReason, setUnallocateReason] = useState("");
  const [unallocateOutcome, setUnallocateOutcome] = useState(null);

  // Filter only BMD batches
  const bmdBatches = useMemo(() => {
    return allBatches.filter(isBmdBatch);
  }, [allBatches]);

  // Summary KPIs
  const summary = useMemo(() => {
    let ready = 0;
    let allocated = 0;
    let inProgress = 0;
    let completed = 0;

    bmdBatches.forEach((batch) => {
      const status = getAllocationStatus(batch);
      if (status === "READY_FOR_ALLOCATION") ready += 1;
      else if (status === "ALLOCATED" || status === "ALLOCATION_REVIEW") allocated += 1;
      else if (status === "IN_PROGRESS") inProgress += 1;
      else if (status === "COMPLETED") completed += 1;
    });

    return {
      totalBatches: bmdBatches.length,
      readyForAllocation: ready,
      allocated,
      inProgress,
      completed,
    };
  }, [bmdBatches]);

  const tableRows = useMemo(
    () => bmdBatches.map((batch) => buildMdBgoRegisterRow(batch, mdBgoRowCountsByBatchId, mdBgoRowsStream)),
    [bmdBatches, mdBgoRowCountsByBatchId, mdBgoRowsStream],
  );

  const handleDeleteBatch = async () => {
    if (!deleteCandidate || isDeletingBgo) return;
    setDeleteError("");

    const batchId = deleteCandidate.id || deleteCandidate.batchId;
    try {
      const response = await deleteBgo({ bgoBatchId: batchId, batchId }).unwrap();
      setActionNotice(response?.message || `Batch ${batchId} deleted successfully.`);
      setDeleteCandidate(null);
    } catch (err) {
      setDeleteError(err?.data?.message || err?.message || "Could not delete BGO batch.");
    }
  };

  const handleUnallocateBatch = async () => {
    if (!unallocateCandidate || isUnallocatingBgo) return;
    const raw = unallocateCandidate.raw || {};
    const issuedAt = raw.workflow?.issuedAt;
    const expectedIssuedAtMillis = typeof issuedAt?.toMillis === "function"
      ? issuedAt.toMillis()
      : issuedAt instanceof Date ? issuedAt.getTime() : Date.parse(issuedAt);
    if (!Number.isFinite(expectedIssuedAtMillis)) {
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
      const response = await unallocateBgo({
        bgoBatchId: unallocateCandidate.id,
        expectedTargetType: unallocateCandidate.targetType,
        expectedTargetId: unallocateCandidate.targetId,
        expectedIssuedAtMillis,
        requestId: unallocateCandidate.requestId,
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
        kind: err?.uncertain ? "uncertain" : "failure",
        batchId: unallocateCandidate.id,
        message: err?.uncertain
          ? "The result could not be confirmed. Check the batch in the MD BGO Register before trying again."
          : err?.data?.message || err?.message || "Could not unallocate this MD BGO batch.",
      });
      setUnallocateCandidate(null);
      setUnallocateReason("");
    }
  };

  const countCell = (value) => value == null ? (mdBgoRowsStream.error ? "NAv" : "…") : formatNumber(value);
  const columns = [
    {
      key: "selection", label: "[ ]", export: false,
      render: (batch) => <input type="checkbox" checked={isTicked(batch.id)} onChange={() => toggleTick(batch.id)} aria-label={`Select batch ${batch.id}`} />,
    },
    {
      key: "map", label: "Map", export: false,
      render: (batch) => <Link to={`/operations/bgo/${encodeURIComponent(batch.id)}/map`} style={styles.mapLinkButton} title="View MD BGO Batch Map" aria-label={`View MD BGO Batch Map for ${batch.id}`}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" /><path d="M9 3v15" /><path d="M15 6v15" />
        </svg>
      </Link>,
    },
    { key: "batchId", label: "Batch ID", filter: "text", value: (batch) => batch.id },
    {
      key: "rows", label: "BGO Rows", export: false,
      render: (batch) => <Link to={`/operations/md-bgo-rows?batchId=${encodeURIComponent(batch.id)}&wardPcode=${encodeURIComponent(batch.wardPcode)}&lmPcode=${encodeURIComponent(lmPcode)}`} style={styles.rowLinkButton}>BGO Rows</Link>,
    },
    {
      key: "allocation", label: "Allocation", filter: "select", value: (batch) => batch.allocation,
      filterOptions: [{ value: "NOT ALLOCATED", label: "Not Allocated" }, { value: "ALLOCATED", label: "Allocated" }],
      render: (batch) => batch.isAllocated ? <button
        type="button"
        style={{ ...styles.unallocateButton, ...((batch.fieldworkStarted || batch.unallocationIntentUnavailable) ? styles.disabledButton : null) }}
        disabled={batch.fieldworkStarted || batch.unallocationIntentUnavailable}
        title={batch.fieldworkStarted ? "Field work has started; this batch cannot be unallocated" : batch.unallocationIntentUnavailable ? "Allocation details are incomplete; contact an MNG" : "Unallocate this batch before field work starts"}
        onClick={() => {
          setUnallocateReason("");
          setUnallocateCandidate({
            ...batch, targetType: batch.intentTargetType, targetId: batch.intentTargetId,
            requestId: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          });
        }}
      >Unallocate</button> : <Link to={`/operations/bgo/allocation?batchId=${encodeURIComponent(batch.id)}`} style={styles.rowLinkButton} title="Allocate this batch on Allocation Board">Allocate</Link>,
    },
    { key: "allocatedTo", label: "Allocated To", filter: "select", value: (batch) => batch.allocatedTo },
    { key: "batchStatus", label: "Batch Status", filter: "select", value: (batch) => batch.batchStatus },
    { key: "total", label: "Total", filter: "text", value: (batch) => batch.total, sortValue: (batch) => batch.total, sortEmptyLast: true, render: (batch) => batch.total == null ? "NAv" : formatNumber(batch.total) },
    { key: "inProgress", label: "In Progress", filter: "text", value: (batch) => batch.inProgress, sortValue: (batch) => batch.inProgress, sortEmptyLast: true, filterDisabled: !mdBgoRowsStream.ready || Boolean(mdBgoRowsStream.error), render: (batch) => countCell(batch.inProgress) },
    { key: "completed", label: "Completed", filter: "text", value: (batch) => batch.completed, sortValue: (batch) => batch.completed, sortEmptyLast: true, filterDisabled: !mdBgoRowsStream.ready || Boolean(mdBgoRowsStream.error), render: (batch) => countCell(batch.completed) },
    { key: "ward", label: "Ward", filter: "select", value: (batch) => batch.ward, exportValue: (batch) => `${batch.ward} (${batch.wardPcode})`, render: (batch) => <div><div style={styles.strongCell}>{batch.wardNo}</div><div style={styles.mutedCell}>{batch.wardPcode}</div></div> },
    { key: "geofence", label: "Geofence", filter: "text", value: (batch) => batch.geofence },
    { key: "createdBy", label: "Created By", filter: "text", value: (batch) => batch.createdBy },
    {
      key: "delete", label: "Delete BGO", export: false,
      render: (batch) => <button type="button" style={{ ...styles.deleteBatchButton, ...(!batch.canDelete ? styles.disabledButton : null) }} disabled={!batch.canDelete} onClick={() => setDeleteCandidate(batch)} title={batch.canDelete ? "Delete this unaccepted BGO batch" : "Cannot delete active or in-progress batch"}>Delete BGO</button>,
    },
  ];

  return (
    <section style={styles.page}>
      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Operations / MD BGO Register</p>
          <div style={styles.titleHelpRow}>
            <h2 style={styles.title}>MD BGO Register</h2>
          </div>
          <p style={styles.subtitle}>
            View permanent Meter Discovery batches and open their permanent BGO Rows.
            MD BGO batches originate from cadastral ERFs grouped into geofences.
          </p>
        </div>

        <div style={styles.headerActions}>
          <Link
            to="/operations/bgo/plan"
            style={{
              ...styles.primaryButton,
              ...(!lmPcode ? styles.disabledButton : null),
            }}
          >
            Plan & Create MD BGO
          </Link>

          <Link
            to="/operations/bgo/allocation"
            style={styles.secondaryLinkButton}
          >
            Allocation Map ({tickedBatchIds.length})
          </Link>

          <Link
            to="/operations/bgo/dashboard"
            style={styles.secondaryLinkButton}
          >
            MD BGO Dashboard
          </Link>

        </div>
      </div>

      {!lmPcode ? (
        <div style={styles.errorNotice}>
          Activate a Local Municipality workbase before managing MD BGO batches.
        </div>
      ) : null}

      {batchesLoadError ? (
        <div style={styles.errorNotice}>
          <strong>MD BGO Register could not be loaded</strong>
          <div>{batchesLoadError?.data?.message || batchesLoadError?.message || "Unknown error"}</div>
        </div>
      ) : null}

      {actionNotice ? (
        <div style={styles.successNotice}>
          {actionNotice}
        </div>
      ) : null}

      {mdBgoRowsStream.error ? (
        <div role="alert" style={styles.errorNotice}>
          <strong>MD BGO row counts could not be loaded.</strong>
          <div>{mdBgoRowsStream.error}</div>
        </div>
      ) : null}

      {isBatchesLoading ? (
        <div style={styles.loadingNotice}>Loading MD BGO Batches...</div>
      ) : (
        <>
          <div style={styles.summaryGrid}>
            <SummaryCard label="Total Batches" value={summary.totalBatches} />
            <SummaryCard label="Ready for Allocation" value={summary.readyForAllocation} />
            <SummaryCard label="Allocated" value={summary.allocated} />
            <SummaryCard label="In Progress" value={summary.inProgress} />
          </div>

          <div style={styles.panel}>
            <div style={styles.panelHeader}>
              <div>
                <p style={styles.panelSubtitle}>
                  Permanent batches loaded from bgo_batches for {lmName} ({lmPcode}).
                </p>
              </div>

              <div style={styles.draftStreamBadge}>Permanent Firestore register</div>
            </div>

            <IrepsTable
              title="Permanent Meter Discovery Batches"
              columns={columns}
              rows={tableRows}
              rowKey={(batch) => batch.id}
              extraFiltersActive={tickedBatchIds.length > 0}
              onClearFilters={clearTicks}
              searchValue={mdBgoRegisterSearchValue}
              searchPlaceholder="Batch IDs, teams, wards, geofences, statuses, creators…"
              downloads={{ fileBaseName: "md_bgo_register", scope: { module: "MD BGO Register", lmPcode } }}
              emptyText="No permanent MD BGO batches match the current scope or filters."
            />
          </div>
        </>
      )}

      {/* Delete Confirmation Modal */}
      {deleteCandidate ? (
        <div style={styles.modalOverlay} role="presentation">
          <div style={styles.modalCard} role="dialog" aria-modal="true">
            <p style={styles.eyebrow}>Delete MD BGO Batch</p>
            <h2 style={styles.modalTitle}>{deleteCandidate.id}</h2>
            <p style={styles.modalSubtitle}>
              Are you sure you want to delete this MD BGO batch? This action permanently
              removes the batch and its unaccepted allocation from the register.
            </p>

            {deleteError ? (
              <div style={styles.modalError}>{deleteError}</div>
            ) : null}

            <div style={styles.modalActions}>
              <button
                type="button"
                style={styles.modalCancelButton}
                onClick={() => setDeleteCandidate(null)}
                disabled={isDeletingBgo}
              >
                Cancel
              </button>
              <button
                type="button"
                style={styles.modalDeleteButton}
                onClick={handleDeleteBatch}
                disabled={isDeletingBgo}
              >
                {isDeletingBgo ? "Deleting..." : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {unallocateCandidate ? (
        <div style={styles.modalOverlay} role="presentation">
          <div style={styles.modalCard} role="dialog" aria-modal="true" aria-labelledby="md-bgo-unallocate-title">
            <p style={styles.eyebrow}>Unallocate MD BGO Batch</p>
            <h2 id="md-bgo-unallocate-title" style={styles.modalTitle}>{unallocateCandidate.id}</h2>
            <p style={styles.modalSubtitle}>
              Take this batch back from <strong>{unallocateCandidate.targetName || unallocateCandidate.target?.name || "the assigned target"}</strong> and return it to Ready for Allocation. The batch and its ERF rows will be preserved.
            </p>
            {String(unallocateCandidate.raw?.workflow?.state || "").toUpperCase() === "ACCEPTED" ? (
              <div style={styles.unallocateWarning}>The team has accepted this batch. It may remain on their device until it reconnects; the server will refuse any later field submission.</div>
            ) : null}
            <label style={styles.reasonLabel} htmlFor="md-bgo-unallocate-reason">Reason for unallocation</label>
            <textarea
              id="md-bgo-unallocate-reason"
              value={unallocateReason}
              onChange={event => setUnallocateReason(event.target.value)}
              maxLength={1000}
              rows={4}
              style={styles.reasonInput}
              disabled={isUnallocatingBgo}
            />
            <div style={styles.modalActions}>
              <button type="button" style={styles.modalCancelButton} onClick={() => setUnallocateCandidate(null)} disabled={isUnallocatingBgo}>Cancel</button>
              <button type="button" style={styles.modalPrimaryButton} onClick={handleUnallocateBatch} disabled={isUnallocatingBgo || !unallocateReason.trim()}>
                {isUnallocatingBgo ? "Unallocating..." : "Confirm Unallocate"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {unallocateOutcome ? (
        <div style={styles.modalOverlay} role="presentation">
          <div style={styles.modalCard} role="dialog" aria-modal="true" aria-labelledby="md-bgo-unallocate-outcome-title">
            <p style={styles.eyebrow}>
              {unallocateOutcome.kind === "success"
                ? "Unallocation Successful"
                : unallocateOutcome.kind === "uncertain"
                  ? "Unallocation Not Confirmed"
                  : "Unallocation Failed"}
            </p>
            <h2 id="md-bgo-unallocate-outcome-title" style={styles.modalTitle}>{unallocateOutcome.batchId}</h2>
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
                  if (successful) navigate("/operations/bgo");
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
  loadingNotice: {
    padding: 24,
    textAlign: "center",
    color: "#64748b",
    fontSize: 15,
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
  summaryCardLabel: {
    display: "block",
    color: "#64748b",
    fontSize: 12,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: 6,
  },
  summaryCardValue: {
    display: "block",
    color: "#0f172a",
    fontSize: 26,
    fontWeight: 900,
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
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
  },
  modalTitle: {
    margin: "6px 0 8px",
    fontSize: 20,
    color: "#0f172a",
  },
  modalSubtitle: {
    margin: "0 0 16px",
    color: "#64748b",
    fontSize: 14,
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
};
