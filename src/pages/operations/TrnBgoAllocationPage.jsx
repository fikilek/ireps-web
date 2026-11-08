/* eslint-disable no-unused-vars -- JSX component tags are consumed by the JSX transform. */
import { useMemo, useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import {
  useGetTcUploadByIdQuery,
  useGetTcUploadsQuery,
  useGetTcRowsByTcIdQuery,
  useAllocateTrnBgoWardBatchesMutation,
} from "../../redux/tcApi";
import { useGetAvailableTeamsQuery } from "../../redux/teamsApi";
import { useGetAvailableServiceProvidersQuery } from "../../redux/serviceProvidersApi";
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

export default function TrnBgoAllocationPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialBatchId = searchParams.get("batchId") || "";

  const auth = useAuth();
  const { geoState } = useGeo();
  const { lmPcode, lmName } = useMemo(
    () => resolveWorkbase(auth, geoState),
    [auth, geoState],
  );

  // Stream existing TRN uploads directly from tc_uploads
  const {
    data: uploads = [],
    isLoading: isUploadsLoading,
  } = useGetTcUploadsQuery({ limit: 500 });

  const [selectedBatchId, setSelectedBatchId] = useState(initialBatchId);

  // Synchronize with URL query parameter
  useEffect(() => {
    if (initialBatchId && initialBatchId !== selectedBatchId) {
      setSelectedBatchId(initialBatchId);
    } else if (!initialBatchId && uploads.length > 0 && !selectedBatchId) {
      setSelectedBatchId(uploads[0].id);
    }
  }, [initialBatchId, uploads, selectedBatchId]);

  const activeBatch = useMemo(() => {
    return uploads.find((u) => u.id === selectedBatchId) || null;
  }, [uploads, selectedBatchId]);

  // Stream constituent meters for the selected batch
  const {
    data: tcRows = [],
    isLoading: isRowsLoading,
  } = useGetTcRowsByTcIdQuery(selectedBatchId, {
    skip: !selectedBatchId,
  });

  // Stream teams & service providers
  const { data: availableTeams = [] } = useGetAvailableTeamsQuery();
  const { data: availableServiceProviders = [] } = useGetAvailableServiceProvidersQuery();

  const [allocateBatches, { isLoading: isAllocating }] = useAllocateTrnBgoWardBatchesMutation();

  // Allocation form state
  const [targetType, setTargetType] = useState("TEAM"); // "TEAM" or "SP"
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [isUnallocateConfirmOpen, setIsUnallocateConfirmOpen] = useState(false);

  // Reset form when active batch changes
  useEffect(() => {
    setActionError("");
    setActionSuccess("");
    if (activeBatch) {
      const existingTarget = activeBatch.assignment?.targets?.[0];
      if (existingTarget?.type === "SP" || activeBatch.spId) {
        setTargetType("SP");
        setSelectedTargetId(existingTarget?.id || activeBatch.spId || "");
      } else {
        setTargetType("TEAM");
        setSelectedTargetId(existingTarget?.id || activeBatch.teamId || "");
      }
    }
  }, [activeBatch]);

  const isBatchAllocated = Boolean(
    activeBatch?.bgoStatus === "ALLOCATED" ||
    activeBatch?.workflowState === "ALLOCATED" ||
    activeBatch?.assignment?.targets?.length > 0 ||
    activeBatch?.teamId ||
    activeBatch?.spId
  );

  const allocatedTargetName =
    activeBatch?.allocatedTo ||
    activeBatch?.assignment?.targets?.[0]?.name ||
    activeBatch?.teamName ||
    activeBatch?.spName ||
    "Assigned";

  const inProgressRows = Number(activeBatch?.inProgressRows || 0);
  const completedRows = Number(activeBatch?.completedRows || 0);
  const canUnallocate = inProgressRows === 0 && completedRows === 0;

  const handleSelectBatch = (e) => {
    const newId = e.target.value;
    setSelectedBatchId(newId);
    setSearchParams(newId ? { batchId: newId } : {});
  };

  const handleAllocate = async () => {
    if (!selectedBatchId) return;
    const targetList = targetType === "TEAM" ? availableTeams : availableServiceProviders;
    const chosen = targetList.find((item) => item.id === selectedTargetId);
    if (!chosen) {
      setActionError(`Please select an active ${targetType === "TEAM" ? "Operational Team" : "Service Provider"}.`);
      return;
    }

    setActionError("");
    setActionSuccess("");

    try {
      const result = await allocateBatches({
        batchIds: [selectedBatchId],
        targetType,
        targetId: chosen.id,
        targetName: chosen.name || chosen.label || chosen.id,
      }).unwrap();

      if (result?.success) {
        setActionSuccess(`Batch ${selectedBatchId} allocated successfully to ${chosen.name || chosen.id}.`);
      } else {
        setActionError(result?.message || "Failed to allocate batch.");
      }
    } catch (err) {
      setActionError(err?.data?.message || err?.message || "Failed to allocate batch.");
    }
  };

  const handleUnallocate = async () => {
    if (!selectedBatchId || !canUnallocate) return;
    setActionError("");
    setActionSuccess("");

    try {
      const result = await allocateBatches({
        batchIds: [selectedBatchId],
        targetType: "UNALLOCATE",
        targetId: "UNALLOCATE",
      }).unwrap();

      if (result?.success) {
        setActionSuccess(`Batch ${selectedBatchId} was unallocated successfully.`);
        setIsUnallocateConfirmOpen(false);
      } else {
        setActionError(result?.message || "Failed to unallocate batch.");
      }
    } catch (err) {
      setActionError(err?.data?.message || err?.message || "Failed to unallocate batch.");
    }
  };

  // Format constituent meter rows for IrepsTable
  const displayRows = useMemo(() => {
    return tcRows.map((r, index) => ({
      id: r.id || `row_${index + 1}`,
      rowNo: r.rowNo ?? index + 1,
      meterNo: r.input?.meterNo || r.meterNo || r.ast?.meterNo || "NAv",
      meterType: r.input?.meterType || r.ast?.meterType || "NAv",
      meterPhase: r.input?.meterPhase || r.ast?.meterPhase || "NAv",
      premiseAddress: r.premise?.address || r.input?.premiseAddress || "NAv",
      erfNo: r.premise?.erfNo || r.input?.erfNo || "NAv",
      linkedAccountNo: r.input?.linkedAccountNo || r.input?.accountNo || "NAv",
      actionReason: r.input?.actionReason || r.input?.reason || "NAv",
      meterStatus: String(r.ast?.statusState || r.ast?.meterStatus || r.input?.meterStatus || "CONNECTED").toUpperCase(),
      wardNo: r.premise?.wardNo || r.input?.wardNo || activeBatch?.wardPcode || "NAv",
      geofence: r.geofenceRefs?.[0]?.name || r.input?.geofence || "NAv",
    }));
  }, [tcRows, activeBatch]);

  const columns = useMemo(() => [
    {
      key: "rowNo",
      label: "#",
      width: 50,
      sortable: true,
      filter: null,
      value: (r) => String(r.rowNo),
      sortValue: (r) => r.rowNo,
      render: (r) => <strong>{r.rowNo}</strong>,
    },
    {
      key: "meterNo",
      label: "Meter No",
      width: 140,
      sortable: true,
      filter: "text",
      value: (r) => r.meterNo,
      sortValue: (r) => r.meterNo,
      render: (r) => <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#1d4ed8" }}>{r.meterNo}</span>,
    },
    {
      key: "meterType",
      label: "Meter Type",
      width: 120,
      sortable: true,
      filter: "select",
      value: (r) => r.meterType,
      sortValue: (r) => r.meterType,
    },
    {
      key: "meterPhase",
      label: "Meter Phase",
      width: 120,
      sortable: true,
      filter: "select",
      value: (r) => r.meterPhase,
      sortValue: (r) => r.meterPhase,
    },
    {
      key: "meterStatus",
      label: "Meter State",
      width: 120,
      sortable: true,
      filter: "select",
      value: (r) => r.meterStatus,
      sortValue: (r) => r.meterStatus,
      render: (r) => {
        const isConn = r.meterStatus === "CONNECTED";
        return (
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 800,
              background: isConn ? "#ecfdf5" : "#fef2f2",
              color: isConn ? "#047857" : "#b91c1c",
              border: `1px solid ${isConn ? "#a7f3d0" : "#fecaca"}`,
            }}
          >
            {r.meterStatus}
          </span>
        );
      },
    },
    {
      key: "premiseAddress",
      label: "Address & ERF",
      sortable: true,
      filter: "text",
      value: (r) => `${r.premiseAddress} ERF ${r.erfNo}`,
      sortValue: (r) => r.premiseAddress,
      render: (r) => (
        <div>
          <div style={{ fontWeight: 600, fontSize: 13, color: "#0f172a" }}>{r.premiseAddress}</div>
          <div style={{ fontSize: 11, color: "#64748b" }}>ERF: {r.erfNo}</div>
        </div>
      ),
    },
    {
      key: "linkedAccountNo",
      label: "Linked Account",
      width: 130,
      sortable: true,
      filter: "text",
      value: (r) => r.linkedAccountNo,
      sortValue: (r) => r.linkedAccountNo,
    },
    {
      key: "actionReason",
      label: "Action Reason",
      width: 170,
      sortable: true,
      filter: "text",
      value: (r) => r.actionReason,
      sortValue: (r) => r.actionReason,
      render: (r) => <span style={{ fontSize: 12, color: "#475569" }}>{r.actionReason}</span>,
    },
  ], []);

  return (
    <section style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>
            <Link to="/operations/trn-bgo" style={styles.breadcrumbLink}>
              Operations / TRN BGO Register
            </Link>{" "}
            / Batch Allocation
          </p>
          <div style={styles.titleHelpRow}>
            <h2 style={styles.title}>TRN BGO Batch Allocation</h2>
            <div style={styles.lmHeaderPill}>
              <span style={styles.lmHeaderDot} />
              <span style={styles.lmHeaderLabel}>Active Municipality:</span>
              <strong style={styles.lmHeaderValue}>{lmName || lmPcode || "All"}</strong>
              {lmPcode ? <span style={styles.lmHeaderPcode}>({lmPcode})</span> : null}
            </div>
          </div>
          <p style={styles.subtitle}>
            Assign operational work orders for permanent transaction batches to active Field Teams or Service Providers.
          </p>
        </div>

        <div style={styles.headerActions}>
          <Link to="/operations/trn-bgo" style={styles.secondaryLinkButton}>
            ← Back to TRN BGO Register
          </Link>
          {selectedBatchId ? (
            <>
              <Link
                to={`/operations/trn-bgo/map?batchId=${encodeURIComponent(selectedBatchId)}`}
                style={styles.secondaryLinkButton}
              >
                🗺️ View in Map
              </Link>
              <Link
                to={`/operations/trn-bgo-rows?batchId=${encodeURIComponent(selectedBatchId)}`}
                style={styles.secondaryLinkButton}
              >
                📋 BGO Rows
              </Link>
            </>
          ) : null}
        </div>
      </div>

      {/* Batch Selector & Allocation Controls Card */}
      <div style={styles.controlCard}>
        <div style={styles.controlCardHeader}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 280 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase" }}>
              Selected TRN BGO Batch
            </label>
            <select
              value={selectedBatchId}
              onChange={handleSelectBatch}
              style={styles.selectInput}
              disabled={isAllocating}
            >
              {uploads.length === 0 ? (
                <option value="">No batches found in register</option>
              ) : (
                uploads.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.id} — {b.wardPcode || "Ward NAv"} ({b.totalRows || 0} meters) [
                    {b.bgoStatus === "ALLOCATED" ? "ALLOCATED" : "UNALLOCATED"}]
                  </option>
                ))
              )}
            </select>
          </div>

          {activeBatch ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={styles.statusPillBox}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                  Status
                </span>
                <span
                  style={{
                    padding: "4px 10px",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 800,
                    background: isBatchAllocated ? "#ecfdf5" : "#fffbeb",
                    color: isBatchAllocated ? "#047857" : "#b45309",
                    border: `1px solid ${isBatchAllocated ? "#a7f3d0" : "#fde68a"}`,
                  }}
                >
                  {isBatchAllocated ? `Allocated: ${allocatedTargetName}` : "Unallocated"}
                </span>
              </div>

              <div style={styles.statusPillBox}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                  Meters
                </span>
                <strong style={{ fontSize: 15, color: "#0f172a" }}>
                  {formatNumber(activeBatch.totalRows || displayRows.length)}
                </strong>
              </div>

              <div style={styles.statusPillBox}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                  Ward
                </span>
                <strong style={{ fontSize: 14, color: "#0f172a", fontFamily: "monospace" }}>
                  {activeBatch.wardPcode || "NAv"}
                </strong>
              </div>
            </div>
          ) : null}
        </div>

        {/* Action feedback */}
        {actionSuccess ? (
          <div style={styles.successBanner} role="status">
            ✓ {actionSuccess}
          </div>
        ) : null}
        {actionError ? (
          <div style={styles.errorBanner} role="alert">
            ✕ {actionError}
          </div>
        ) : null}

        {/* Allocation Controls */}
        {activeBatch ? (
          <div style={styles.allocationRow}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase" }}>
                Allocate To
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <label style={styles.radioLabel}>
                  <input
                    type="radio"
                    name="targetType"
                    value="TEAM"
                    checked={targetType === "TEAM"}
                    onChange={() => {
                      setTargetType("TEAM");
                      setSelectedTargetId("");
                    }}
                    disabled={isAllocating}
                  />
                  <span>Operational Team</span>
                </label>
                <label style={styles.radioLabel}>
                  <input
                    type="radio"
                    name="targetType"
                    value="SP"
                    checked={targetType === "SP"}
                    onChange={() => {
                      setTargetType("SP");
                      setSelectedTargetId("");
                    }}
                    disabled={isAllocating}
                  />
                  <span>Service Provider (SP)</span>
                </label>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 260, flex: 1 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase" }}>
                Select {targetType === "TEAM" ? "Operational Team" : "Service Provider"}
              </label>
              <select
                value={selectedTargetId}
                onChange={(e) => setSelectedTargetId(e.target.value)}
                style={styles.selectInput}
                disabled={isAllocating}
              >
                <option value="">
                  -- Choose {targetType === "TEAM" ? "Team" : "Service Provider"} --
                </option>
                {targetType === "TEAM"
                  ? availableTeams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name || t.label || t.id}
                      </option>
                    ))
                  : availableServiceProviders.map((sp) => (
                      <option key={sp.id} value={sp.id}>
                        {sp.name || sp.label || sp.id}
                      </option>
                    ))}
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
              <button
                type="button"
                onClick={handleAllocate}
                disabled={isAllocating || !selectedTargetId}
                style={{
                  ...styles.primaryButton,
                  ...(!selectedTargetId || isAllocating ? { opacity: 0.5, cursor: "not-allowed" } : null),
                }}
              >
                {isAllocating ? "Allocating..." : isBatchAllocated ? "Re-allocate Batch" : "Allocate Batch"}
              </button>

              {isBatchAllocated ? (
                <button
                  type="button"
                  onClick={() => setIsUnallocateConfirmOpen(true)}
                  disabled={isAllocating || !canUnallocate}
                  style={{
                    ...styles.dangerOutlineButton,
                    ...(!canUnallocate ? { opacity: 0.5, cursor: "not-allowed" } : null),
                  }}
                  title={
                    canUnallocate
                      ? "Unallocate batch back to unallocated state"
                      : `Cannot unallocate: field execution commenced (${inProgressRows} in progress, ${completedRows} completed).`
                  }
                >
                  Unallocate Batch
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* Constituent Meters Table */}
      <div style={styles.tablePanel}>
        <IrepsTable
          rows={displayRows}
          columns={columns}
          loading={isRowsLoading || isUploadsLoading}
          emptyText="No constituent meters found for this batch."
          title={`Batch Meters: ${selectedBatchId || "No Batch Selected"} (${displayRows.length})`}
          pageSizeOptions={[10, 25, 50, 100]}
          defaultPageSize={25}
          downloads={{
            registryName: `TRN BGO Batch ${selectedBatchId || ""}`.trim(),
            fileBaseName: `trn_bgo_${(selectedBatchId || "batch").toLowerCase()}`,
            scope: { lmName, lmPcode, batchId: selectedBatchId },
          }}
        />
      </div>

      {/* Unallocate confirmation modal */}
      {isUnallocateConfirmOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(15, 23, 42, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 480,
              background: "#ffffff",
              borderRadius: 12,
              padding: 24,
              boxShadow: "0 20px 40px rgba(15, 23, 42, 0.25)",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
              Unallocate Batch?
            </h3>
            <p style={{ margin: 0, fontSize: 14, color: "#475569", lineHeight: 1.5 }}>
              Are you sure you want to remove the allocation for batch{" "}
              <strong style={{ fontFamily: "monospace", color: "#0f172a" }}>{selectedBatchId}</strong>? The
              batch will be set back to <strong>Unallocated</strong> state.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setIsUnallocateConfirmOpen(false)}
                disabled={isAllocating}
                style={styles.secondaryButton}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUnallocate}
                disabled={isAllocating}
                style={styles.dangerButton}
              >
                {isAllocating ? "Unallocating..." : "Yes, Unallocate"}
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
    padding: "24px 32px",
    display: "flex",
    flexDirection: "column",
    gap: 20,
    background: "#f8fafc",
    minHeight: "100vh",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 16,
  },
  eyebrow: {
    margin: "0 0 4px",
    fontSize: 12,
    fontWeight: 600,
    color: "#64748b",
  },
  breadcrumbLink: {
    color: "#2563eb",
    textDecoration: "none",
  },
  titleHelpRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
    margin: "0 0 6px",
  },
  title: {
    margin: 0,
    fontSize: 24,
    fontWeight: 800,
    color: "#0f172a",
  },
  lmHeaderPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 9999,
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    fontSize: 12,
  },
  lmHeaderDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#2563eb",
  },
  lmHeaderLabel: {
    color: "#64748b",
    fontWeight: 500,
  },
  lmHeaderValue: {
    color: "#1d4ed8",
    fontWeight: 700,
  },
  lmHeaderPcode: {
    color: "#64748b",
    fontFamily: "monospace",
    fontSize: 11,
  },
  subtitle: {
    margin: 0,
    fontSize: 13,
    color: "#64748b",
    maxWidth: 800,
    lineHeight: 1.4,
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
  },
  secondaryLinkButton: {
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#334155",
    fontSize: 13,
    fontWeight: 600,
    textDecoration: "none",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.05)",
  },
  controlCard: {
    background: "#ffffff",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    padding: "20px 24px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    boxShadow: "0 1px 3px rgba(15, 23, 42, 0.05)",
  },
  controlCardHeader: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 16,
    paddingBottom: 16,
    borderBottom: "1px solid #f1f5f9",
  },
  statusPillBox: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  selectInput: {
    padding: "9px 12px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    fontSize: 13,
    fontWeight: 600,
    color: "#0f172a",
    background: "#ffffff",
  },
  allocationRow: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 20,
  },
  radioLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    fontWeight: 600,
    color: "#334155",
    cursor: "pointer",
  },
  primaryButton: {
    padding: "9px 20px",
    borderRadius: 8,
    border: "1px solid #15803d",
    background: "#16a34a",
    color: "#ffffff",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 1px 2px rgba(22, 163, 74, 0.2)",
  },
  dangerOutlineButton: {
    padding: "9px 16px",
    borderRadius: 8,
    border: "1px solid #fca5a5",
    background: "#fef2f2",
    color: "#dc2626",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },
  secondaryButton: {
    padding: "8px 16px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#475569",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  dangerButton: {
    padding: "8px 16px",
    borderRadius: 8,
    border: "1px solid #dc2626",
    background: "#dc2626",
    color: "#ffffff",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },
  successBanner: {
    padding: "10px 16px",
    borderRadius: 8,
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    color: "#15803d",
    fontSize: 13,
    fontWeight: 600,
  },
  errorBanner: {
    padding: "10px 16px",
    borderRadius: 8,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#dc2626",
    fontSize: 13,
    fontWeight: 600,
  },
  tablePanel: {
    background: "#ffffff",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    overflow: "hidden",
    boxShadow: "0 1px 3px rgba(15, 23, 42, 0.05)",
  },
};
