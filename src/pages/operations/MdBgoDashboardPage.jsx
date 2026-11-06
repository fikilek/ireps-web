/* eslint-disable no-unused-vars -- JSX component tags are consumed by the JSX transform. */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import { useWarehouse } from "@/context/WarehouseContext";
import { useGetBgoBatchesByLmQuery } from "../../redux/bgoApi";
import { useGetPremisesByLmPcodeQuery } from "../../redux/mapPremisesApi";
import { useGetAstsByLmPcodeQuery } from "../../redux/astsApi";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

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

  const name = String(
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

function isMdBgoBatch(batch = {}) {
  const batchMode = String(
    batch?.batchMode || batch?.raw?.bgo?.batchMode || batch?.bgo?.batchMode || "",
  ).toUpperCase();
  const opType = String(
    batch?.operationType || batch?.trnType || batch?.raw?.operationType || "",
  ).toUpperCase();
  return batchMode === "BMD" || opType === "METER_DISCOVERY";
}

function getBatchWorkflowState(batch = {}) {
  const workflowState = String(
    batch?.workflowState || batch?.raw?.workflow?.state || "",
  ).toUpperCase();
  const targetId = String(
    batch?.targetId || batch?.target?.id || batch?.raw?.bgo?.targetId || "",
  ).trim();

  if (workflowState === "COMPLETED") return "COMPLETED";
  if (workflowState === "IN_PROGRESS") return "IN_PROGRESS";
  if (workflowState === "ALLOCATED" || (targetId && workflowState === "ISSUED")) return "ALLOCATED";
  return "READY_FOR_ALLOCATION";
}

function getBatchErfRefs(batch = {}) {
  return asArray(
    batch?.raw?.worklist?.erfRefs ||
      batch?.worklist?.erfRefs ||
      batch?.erfRefs,
  );
}

function getBatchErfCount(batch = {}) {
  const count =
    batch?.summary?.erfCount ??
    batch?.summary?.totalRows ??
    batch?.raw?.summary?.erfCount ??
    getBatchErfRefs(batch).length;
  return Number(count) || 0;
}

function getBatchWardLabel(batch = {}) {
  const wardName = batch?.scope?.wardName;
  const wardPcode = batch?.scope?.wardPcode || "";
  const match = wardPcode.match(/(\d{1,3})$/);
  const wardNo = match ? String(Number(match[1])) : "";
  if (wardNo) return `Ward ${wardNo}`;
  return wardName || "NAv";
}

function getBatchWardPcode(batch = {}) {
  return String(batch?.scope?.wardPcode || batch?.raw?.scope?.wardPcode || "").trim();
}

function SummaryCard({ label, value, tone = "default" }) {
  const toneColors = {
    default: { border: "#e2e8f0", text: "#0f172a" },
    ready: { border: "#bfdbfe", text: "#1d4ed8" },
    allocated: { border: "#fed7aa", text: "#c2410c" },
    progress: { border: "#e9d5ff", text: "#7e22ce" },
    complete: { border: "#bbf7d0", text: "#15803d" },
  };

  const currentTone = toneColors[tone] || toneColors.default;

  return (
    <article
      style={{
        ...styles.summaryCard,
        borderTop: `3px solid ${currentTone.text}`,
      }}
    >
      <span style={styles.summaryLabel}>{label}</span>
      <strong style={{ ...styles.summaryValue, color: currentTone.text }}>
        {formatNumber(value)}
      </strong>
    </article>
  );
}

export default function MdBgoDashboardPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const { geoState } = useGeo();

  const { lmPcode, lmName } = useMemo(
    () => resolveWorkbase(auth, geoState),
    [auth, geoState],
  );

  const [selectedWardFilter, setSelectedWardFilter] = useState("ALL");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState("ALL");

  // Fetch batches for LM
  const {
    data: allBatches = [],
    isLoading: isBatchesLoading,
    error: batchesError,
  } = useGetBgoBatchesByLmQuery(
    { lmPcode, limit: 1000 },
    { skip: !lmPcode },
  );

  // Filter strictly to MD BGO batches
  const mdBatches = useMemo(() => {
    return allBatches.filter(isMdBgoBatch);
  }, [allBatches]);

  // Fetch live premises and meters to compute discovery metrics
  const { data: livePremises = [], isLoading: isPremisesLoading } =
    useGetPremisesByLmPcodeQuery({ lmPcode }, { skip: !lmPcode });

  const { data: liveMeters = [], isLoading: isMetersLoading } =
    useGetAstsByLmPcodeQuery({ lmPcode, limit: 5000 }, { skip: !lmPcode });

  // Compute live discoveries per MD batch
  const liveStatsByBatchId = useMemo(() => {
    const premises = asArray(livePremises);
    const meters = asArray(liveMeters);

    return mdBatches.reduce((acc, batch) => {
      const batchId = batch.id || batch.batchId;
      const erfRefs = getBatchErfRefs(batch);
      const erfIds = new Set(
        erfRefs.map((r) => r.id || r.erfId || r).filter(Boolean),
      );

      if (!batchId || erfIds.size === 0) {
        acc[batchId] = {
          totalErfs: erfRefs.length,
          discoveredPremises: 0,
          discoveredMeters: 0,
        };
        return acc;
      }

      const matchingPremises = premises.filter((p) =>
        erfIds.has(p.erfId || p.erfRef?.id || p.id),
      );
      const premiseIds = new Set(matchingPremises.map((p) => p.id).filter(Boolean));

      const matchingMeters = meters.filter((m) => {
        const mErfId = m.erfId || m.erfRef?.id;
        const mPremiseId = m.premiseId || m.premiseRef?.id;
        return (mErfId && erfIds.has(mErfId)) || (mPremiseId && premiseIds.has(mPremiseId));
      });

      acc[batchId] = {
        totalErfs: erfRefs.length,
        discoveredPremises: matchingPremises.length,
        discoveredMeters: matchingMeters.length,
      };

      return acc;
    }, {});
  }, [mdBatches, livePremises, liveMeters]);

  // Wards available from batches
  const availableWards = useMemo(() => {
    const map = new Map();
    mdBatches.forEach((batch) => {
      const pcode = getBatchWardPcode(batch);
      if (pcode && !map.has(pcode)) {
        map.set(pcode, getBatchWardLabel(batch));
      }
    });
    return Array.from(map.entries()).map(([pcode, label]) => ({ pcode, label }));
  }, [mdBatches]);

  // Overall KPIs
  const kpis = useMemo(() => {
    let ready = 0;
    let allocated = 0;
    let inProgress = 0;
    let completed = 0;
    let totalErfs = 0;
    let totalPremises = 0;
    let totalMeters = 0;

    mdBatches.forEach((b) => {
      const state = getBatchWorkflowState(b);
      if (state === "READY_FOR_ALLOCATION") ready += 1;
      else if (state === "ALLOCATED") allocated += 1;
      else if (state === "IN_PROGRESS") inProgress += 1;
      else if (state === "COMPLETED") completed += 1;

      const stats = liveStatsByBatchId[b.id] || {};
      totalErfs += getBatchErfCount(b);
      totalPremises += stats.discoveredPremises || 0;
      totalMeters += stats.discoveredMeters || 0;
    });

    return {
      totalBatches: mdBatches.length,
      ready,
      allocated,
      inProgress,
      completed,
      totalErfs,
      totalPremises,
      totalMeters,
    };
  }, [mdBatches, liveStatsByBatchId]);

  // Filtered batches for display
  const filteredBatches = useMemo(() => {
    return mdBatches.filter((batch) => {
      if (selectedWardFilter !== "ALL" && getBatchWardPcode(batch) !== selectedWardFilter) {
        return false;
      }
      if (selectedStatusFilter !== "ALL" && getBatchWorkflowState(batch) !== selectedStatusFilter) {
        return false;
      }
      return true;
    });
  }, [mdBatches, selectedWardFilter, selectedStatusFilter]);

  return (
    <section style={styles.page}>
      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Operations / MD BGO Dashboard</p>
          <h2 style={styles.title}>MD BGO Dashboard</h2>
          <p style={styles.subtitle}>
            Dedicated Meter Discovery dashboard tracking cadastral ERF sweeps, geofence
            coverage, discovered premises, and registered meters.
          </p>
        </div>

        <div style={styles.headerActions}>
          <Link to="/operations/bgo" style={styles.secondaryLinkButton}>
            MD BGO Register
          </Link>
          <Link to="/operations/bgo/plan" style={styles.primaryButton}>
            Plan & Create MD BGO
          </Link>
          <Link to="/operations/bgo/allocation" style={styles.secondaryLinkButton}>
            Allocation Board
          </Link>
        </div>
      </div>

      <div style={styles.scopeBanner}>
        <div>
          <strong>Active Local Municipality:</strong> {lmName} ({lmPcode || "NAv"})
        </div>
        <div style={styles.streamBadge}>LIVE MD BGO METRICS</div>
      </div>

      {/* KPI Cards */}
      <div style={styles.kpiGrid}>
        <SummaryCard label="Total MD Batches" value={kpis.totalBatches} tone="default" />
        <SummaryCard label="Ready for Allocation" value={kpis.ready} tone="ready" />
        <SummaryCard label="Allocated / In Progress" value={kpis.allocated + kpis.inProgress} tone="allocated" />
        <SummaryCard label="Targeted ERFs" value={kpis.totalErfs} tone="default" />
        <SummaryCard label="Discovered Premises" value={kpis.totalPremises} tone="progress" />
        <SummaryCard label="Discovered Meters" value={kpis.totalMeters} tone="complete" />
      </div>

      {/* Filter Row */}
      <div style={styles.filterBar}>
        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>Ward:</label>
          <select
            value={selectedWardFilter}
            onChange={(e) => setSelectedWardFilter(e.target.value)}
            style={styles.selectInput}
          >
            <option value="ALL">All Wards ({availableWards.length})</option>
            {availableWards.map((w) => (
              <option key={w.pcode} value={w.pcode}>
                {w.label}
              </option>
            ))}
          </select>
        </div>

        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>Workflow State:</label>
          <select
            value={selectedStatusFilter}
            onChange={(e) => setSelectedStatusFilter(e.target.value)}
            style={styles.selectInput}
          >
            <option value="ALL">All States</option>
            <option value="READY_FOR_ALLOCATION">Ready for Allocation</option>
            <option value="ALLOCATED">Allocated</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="COMPLETED">Completed</option>
          </select>
        </div>
      </div>

      {/* Batch Cards Grid */}
      {isBatchesLoading ? (
        <div style={styles.emptyStateNotice}>Loading Meter Discovery batches...</div>
      ) : filteredBatches.length === 0 ? (
        <div style={styles.emptyStateNotice}>
          <h3>No Meter Discovery Batches Found</h3>
          <p style={{ marginTop: 8, color: "#64748b" }}>
            No MD BGO batches exist for {lmName} matching the selected criteria.
          </p>
          <Link
            to="/operations/bgo/plan"
            style={{ ...styles.primaryButton, display: "inline-block", marginTop: 16 }}
          >
            Draw Geofence & Create Batch
          </Link>
        </div>
      ) : (
        <div style={styles.cardGrid}>
          {filteredBatches.map((batch) => {
            const batchId = batch.id || batch.batchId;
            const state = getBatchWorkflowState(batch);
            const stats = liveStatsByBatchId[batchId] || {};
            const targetName = batch.targetName || batch.target?.name || "Unallocated";
            const targetType = batch.targetType || batch.target?.type || "";

            return (
              <article key={batchId} style={styles.batchCard}>
                <div style={styles.batchCardHeader}>
                  <div>
                    <h4 style={styles.batchIdTitle}>{batchId}</h4>
                    <p style={styles.batchGeofenceSubtitle}>
                      {batch.geofenceName || batch.geofenceRef?.name || "Geofence NAv"} • {getBatchWardLabel(batch)}
                    </p>
                  </div>
                  <span
                    style={{
                      ...styles.stateBadge,
                      ...(state === "READY_FOR_ALLOCATION"
                        ? styles.stateBadgeReady
                        : state === "ALLOCATED"
                          ? styles.stateBadgeAllocated
                          : state === "IN_PROGRESS"
                            ? styles.stateBadgeProgress
                            : styles.stateBadgeCompleted),
                    }}
                  >
                    {state.replaceAll("_", " ")}
                  </span>
                </div>

                <div style={styles.batchAssignmentRow}>
                  <strong>Allocated To:</strong>{" "}
                  {targetType ? `${targetType} • ` : ""}
                  {targetName}
                </div>

                <div style={styles.metricRow}>
                  <div style={styles.metricCol}>
                    <span style={styles.metricLabel}>ERFs</span>
                    <strong style={styles.metricVal}>{formatNumber(stats.totalErfs || getBatchErfCount(batch))}</strong>
                  </div>
                  <div style={styles.metricCol}>
                    <span style={styles.metricLabel}>Premises</span>
                    <strong style={styles.metricVal}>{formatNumber(stats.discoveredPremises || 0)}</strong>
                  </div>
                  <div style={styles.metricCol}>
                    <span style={styles.metricLabel}>Meters</span>
                    <strong style={styles.metricVal}>{formatNumber(stats.discoveredMeters || 0)}</strong>
                  </div>
                </div>

                <div style={styles.batchCardFooter}>
                  <Link
                    to="/operations/bgo"
                    style={styles.cardActionLink}
                  >
                    View in Register →
                  </Link>
                  <Link
                    to="/operations/bgo/allocation"
                    style={styles.cardActionLink}
                  >
                    Allocation Board →
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

const styles = {
  page: {
    padding: "24px 32px",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
    backgroundColor: "#f8fafc",
    minHeight: "100vh",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: "16px",
  },
  eyebrow: {
    fontSize: "12px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#2563eb",
    margin: 0,
  },
  title: {
    fontSize: "28px",
    fontWeight: 800,
    color: "#0f172a",
    margin: "4px 0 0",
  },
  subtitle: {
    fontSize: "14px",
    color: "#64748b",
    margin: "6px 0 0",
    maxWidth: "700px",
  },
  headerActions: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    flexWrap: "wrap",
  },
  primaryButton: {
    backgroundColor: "#2563eb",
    color: "#ffffff",
    padding: "10px 18px",
    borderRadius: "8px",
    fontWeight: 700,
    fontSize: "13px",
    textDecoration: "none",
    border: "none",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    boxShadow: "0 1px 2px rgba(37,99,235,0.2)",
  },
  secondaryLinkButton: {
    backgroundColor: "#ffffff",
    color: "#2563eb",
    padding: "10px 18px",
    borderRadius: "8px",
    fontWeight: 700,
    fontSize: "13px",
    textDecoration: "none",
    border: "1px solid #bfdbfe",
    display: "inline-flex",
    alignItems: "center",
  },
  scopeBanner: {
    backgroundColor: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: "10px",
    padding: "12px 20px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: "14px",
    color: "#1e3a8a",
  },
  streamBadge: {
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.06em",
    backgroundColor: "#2563eb",
    color: "#ffffff",
    padding: "4px 10px",
    borderRadius: "999px",
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "16px",
  },
  summaryCard: {
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    padding: "16px 20px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
  },
  summaryLabel: {
    fontSize: "12px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "#64748b",
  },
  summaryValue: {
    fontSize: "26px",
    fontWeight: 800,
  },
  filterBar: {
    display: "flex",
    gap: "20px",
    alignItems: "center",
    backgroundColor: "#ffffff",
    padding: "12px 20px",
    borderRadius: "10px",
    border: "1px solid #e2e8f0",
    flexWrap: "wrap",
  },
  filterGroup: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  filterLabel: {
    fontSize: "13px",
    fontWeight: 600,
    color: "#475569",
  },
  selectInput: {
    padding: "6px 12px",
    borderRadius: "6px",
    border: "1px solid #cbd5e1",
    fontSize: "13px",
    color: "#0f172a",
    backgroundColor: "#f8fafc",
  },
  cardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
    gap: "20px",
  },
  batchCard: {
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
  },
  batchCardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "10px",
  },
  batchIdTitle: {
    fontSize: "15px",
    fontWeight: 700,
    color: "#0f172a",
    margin: 0,
  },
  batchGeofenceSubtitle: {
    fontSize: "13px",
    color: "#64748b",
    margin: "4px 0 0",
  },
  stateBadge: {
    fontSize: "10px",
    fontWeight: 800,
    letterSpacing: "0.05em",
    padding: "4px 8px",
    borderRadius: "6px",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  stateBadgeReady: {
    backgroundColor: "#dbeafe",
    color: "#1d4ed8",
  },
  stateBadgeAllocated: {
    backgroundColor: "#fef3c7",
    color: "#92400e",
  },
  stateBadgeProgress: {
    backgroundColor: "#f3e8ff",
    color: "#6b21a8",
  },
  stateBadgeCompleted: {
    backgroundColor: "#dcfce7",
    color: "#166534",
  },
  batchAssignmentRow: {
    fontSize: "13px",
    color: "#334155",
    backgroundColor: "#f8fafc",
    padding: "8px 12px",
    borderRadius: "6px",
  },
  metricRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: "10px",
    backgroundColor: "#f1f5f9",
    padding: "10px",
    borderRadius: "8px",
    textAlign: "center",
  },
  metricCol: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  metricLabel: {
    fontSize: "11px",
    fontWeight: 600,
    color: "#64748b",
    textTransform: "uppercase",
  },
  metricVal: {
    fontSize: "16px",
    fontWeight: 700,
    color: "#0f172a",
  },
  batchCardFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: "10px",
    borderTop: "1px solid #f1f5f9",
    fontSize: "12px",
  },
  cardActionLink: {
    color: "#2563eb",
    fontWeight: 600,
    textDecoration: "none",
  },
  emptyStateNotice: {
    backgroundColor: "#ffffff",
    border: "1px dashed #cbd5e1",
    borderRadius: "12px",
    padding: "48px 24px",
    textAlign: "center",
    color: "#0f172a",
  },
};
