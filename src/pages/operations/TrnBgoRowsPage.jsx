/* eslint-disable no-unused-vars -- JSX component tags are consumed by the JSX transform. */
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import {
  useGetBgoBatchesByLmQuery,
  useGetBgoRowsByBatchIdQuery,
} from "../../redux/bgoApi";
import {
  useGetTcUploadByIdQuery,
  useGetTcRowsByTcIdQuery,
  useGetTrnBgoChildTrnsByBatchIdQuery,
} from "../../redux/tcApi";
import { buildTrnBgoDisplayRows } from "./trnBgoRowsView";
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

export default function TrnBgoRowsPage() {
  const [searchParams] = useSearchParams();
  const batchId = searchParams.get("batchId") || "";
  const wardPcodeParam = searchParams.get("wardPcode") || "";
  const lmPcodeParam = searchParams.get("lmPcode") || "";

  const auth = useAuth();
  const { geoState } = useGeo();
  const { lmPcode: resolvedLmPcode, lmName: resolvedLmName } = useMemo(
    () => resolveWorkbase(auth, geoState),
    [auth, geoState],
  );
  const activeLmPcode = lmPcodeParam || resolvedLmPcode;

  // Stream TC upload metadata (for candidate / staged uploads)
  const { data: tcUpload, isLoading: isTcUploadLoading } = useGetTcUploadByIdQuery(
    batchId,
    { skip: !batchId },
  );

  // Stream BGO batches list (for converted batches)
  const { data: allBatches = [], isLoading: areBatchesLoading } = useGetBgoBatchesByLmQuery(
    { lmPcode: activeLmPcode },
    { skip: !activeLmPcode },
  );

  const bgoBatch = useMemo(() => {
    return allBatches.find((b) => b.id === batchId) || null;
  }, [allBatches, batchId]);

  const activeBatch = tcUpload || bgoBatch || null;

  // Stream rows from tc_rows
  const {
    data: tcRows = [],
    isLoading: isTcRowsLoading,
    error: tcRowsError,
  } = useGetTcRowsByTcIdQuery(batchId, {
    skip: !batchId,
  });

  // Stream rows from bgo_rows (for converted batches)
  const {
    data: bgoRows = [],
    isLoading: isBgoRowsLoading,
    error: bgoRowsError,
  } = useGetBgoRowsByBatchIdQuery(
    { bgoBatchId: batchId },
    { skip: !batchId || isTcRowsLoading || tcRows.length > 0 },
  );

  const { data: childTrns = [] } = useGetTrnBgoChildTrnsByBatchIdQuery(batchId, { skip: !batchId });
  const rawRows = tcRows.length > 0 ? tcRows : bgoRows;
  const isLoading = isTcUploadLoading || isTcRowsLoading || (!tcUpload && areBatchesLoading) || (tcRows.length === 0 && isBgoRowsLoading);
  const rowsError = tcRowsError || bgoRowsError;

  // Normalize rows for IrepsTable (joining live child TRN truth onto tc_rows)
  const displayRows = useMemo(
    () => buildTrnBgoDisplayRows({ rawRows, childTrns, activeBatch }),
    [rawRows, childTrns, activeBatch],
  );

  // IrepsTable column definitions
  const columns = useMemo(() => [
    {
      key: "rowNo",
      label: "#",
      width: 50,
      filter: null,
      sortable: true,
      value: (r) => String(r.rowNo),
      sortValue: (r) => r.rowNo,
      render: (r) => <strong>{r.rowNo}</strong>,
    },
    {
      key: "meterNo",
      label: "Meter No",
      width: 140,
      filter: "text",
      sortable: true,
      value: (r) => r.meterNo,
      sortValue: (r) => r.meterNo,
      render: (r) => (
        <span style={styles.meterNoCell}>
          {r.meterNo}
        </span>
      ),
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
      filter: "select",
      sortable: true,
      value: (r) => r.meterStatus,
      sortValue: (r) => r.meterStatus,
      render: (r) => {
        const isConn = r.meterStatus === "CONNECTED";
        return (
          <span
            style={{
              ...styles.badge,
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
      key: "validationState",
      label: "Validation",
      width: 110,
      filter: "select",
      sortable: true,
      value: (r) => r.validationState,
      sortValue: (r) => r.validationState,
      render: (r) => {
        const ok = r.isEligible;
        return (
          <span
            style={{
              ...styles.badge,
              background: ok ? "#f0fdf4" : "#fef2f2",
              color: ok ? "#15803d" : "#b91c1c",
              border: `1px solid ${ok ? "#bbf7d0" : "#fecaca"}`,
            }}
          >
            {r.validationState}
          </span>
        );
      },
    },
    {
      key: "readinessState",
      label: "BGO Readiness",
      width: 140,
      filter: "select",
      value: (r) => (r.isReady ? "Ready for BGO" : "Blocked"),
      sortValue: (r) => (r.isReady ? "Ready" : "Blocked"),
      render: (r) => (
        <span
          style={{
            ...styles.badge,
            background: r.isReady ? "#ecfdf5" : "#fff7ed",
            color: r.isReady ? "#047857" : "#c2410c",
            border: `1px solid ${r.isReady ? "#a7f3d0" : "#fed7aa"}`,
          }}
        >
          {r.isReady ? "READY FOR BGO" : "BLOCKED"}
        </span>
      ),
    },
    {
      key: "blockingMessage",
      label: "Reason / Exception",
      filter: "text",
      sortable: true,
      value: (r) => `${r.reasonCode ? r.reasonCode + " - " : ""}${r.blockingMessage}`,
      sortValue: (r) => r.blockingMessage,
      render: (r) => (
        <div>
          {r.reasonCode ? (
            <div style={styles.reasonCodeBadge}>
              {r.reasonCode}
            </div>
          ) : null}
          <div style={{ fontSize: 12, color: r.isReady ? "#059669" : "#334155" }}>
            {r.blockingMessage}
          </div>
        </div>
      ),
    },
    {
      key: "activeTrnId",
      label: "Active TRN ID",
      width: 180,
      filter: "text",
      sortable: true,
      value: (r) => r.activeTrnId,
      sortValue: (r) => r.activeTrnId,
      render: (r) => {
        if (!r.activeTrnId || r.activeTrnId === "None") {
          return <span style={{ color: "#94a3b8", fontSize: 12 }}>None</span>;
        }
        return (
          <div>
            <div style={styles.activeTrnCode}>
              {r.activeTrnId}
            </div>
            {r.activeTrnState ? (
              <span style={styles.activeTrnState}>
                State: {r.activeTrnState}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "address",
      label: "Address & ERF",
      filter: "text",
      sortable: true,
      value: (r) => `${r.address} ERF ${r.erfNo}`,
      sortValue: (r) => r.address,
      render: (r) => (
        <div>
          <div style={styles.addressLine}>{r.address}</div>
          <div style={styles.subtleLine}>ERF: {r.erfNo}</div>
        </div>
      ),
    },
    {
      key: "geofenceName",
      label: "Ward & Geofence",
      filter: "text",
      sortable: true,
      value: (r) => `${r.wardNo} ${r.geofenceName}`,
      sortValue: (r) => r.geofenceName,
      render: (r) => (
        <div>
          <div style={styles.geofenceLine}>{r.geofenceName}</div>
          <div style={styles.subtleLine}>Ward: {r.wardNo}</div>
        </div>
      ),
    },
    {
      key: "naCount",
      label: "NA Count",
      width: 95,
      filter: "select",
      sortable: true,
      value: (r) => String(r.naCount ?? 0),
      sortValue: (r) => Number(r.naCount ?? 0),
      render: (r) => (
        <span
          style={{
            fontWeight: 700,
            fontSize: 12,
            color: r.naCount > 0 ? "#b45309" : "#64748b",
          }}
        >
          {r.naCount ?? 0}
        </span>
      ),
    },
    {
      key: "updatedAt",
      label: "Updated At",
      width: 155,
      filter: "text",
      sortable: true,
      value: (r) => (r.updatedAt ? new Date(r.updatedAt).toLocaleString("en-ZA") : "NAv"),
      sortValue: (r) => (r.updatedAt ? Date.parse(r.updatedAt) || 0 : 0),
      render: (r) => (
        <span style={{ fontSize: 12, color: "#475569" }}>
          {r.updatedAt ? new Date(r.updatedAt).toLocaleString("en-ZA") : "NAv"}
        </span>
      ),
    },
    {
      key: "accountNo",
      label: "Account No",
      width: 110,
      filter: "text",
      sortable: true,
      value: (r) => r.accountNo,
      sortValue: (r) => r.accountNo,
      render: (r) => <span style={{ fontSize: 12 }}>{r.accountNo}</span>,
    },

  ], []);

  return (
    <section style={styles.page}>
      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>
            <Link to="/operations/trn-bgo" style={styles.breadcrumbLink}>
              Operations / TRN BGO Register
            </Link>{" "}
            / Batch Rows
          </p>
          <div style={styles.titleHelpRow}>
            <h2 style={styles.title}>TRN BGO Batch Rows</h2>
            <div style={styles.lmHeaderPill}>
              <span style={styles.lmHeaderDot} />
              <span style={styles.lmHeaderLabel}>Local Municipality:</span>
              <strong style={styles.lmHeaderValue}>{resolvedLmName || activeLmPcode || "Active LM"}</strong>
              {activeLmPcode ? <span style={styles.lmHeaderPcode}>({activeLmPcode})</span> : null}
            </div>
          </div>
          <p style={styles.subtitle}>
            Batch ID: <strong>{batchId || "No Batch Selected"}</strong> · {displayRows.length} total constituent rows with state machine diagnostics
          </p>
        </div>

        <div style={styles.headerActions}>
          <Link to="/operations/trn-bgo" style={styles.secondaryLinkButton}>
            ← Back to Register
          </Link>
          <Link
            to="/operations/trn-bgo/upload"
            style={styles.secondaryLinkButton}
          >
            Upload & Create TRN BGO
          </Link>
          <Link to="/operations/trn-bgo/dashboard" style={styles.secondaryLinkButton}>
            TRN BGO Dashboard
          </Link>
        </div>
      </div>

      {activeBatch ? (
        <div style={styles.batchBanner}>
          <div style={styles.bannerItem}>
            <span style={styles.bannerLabel}>Operation</span>
            <strong style={styles.bannerValue}>
              {activeBatch.trnType || activeBatch.operationType || "METER_DISCONNECTION"}
            </strong>
          </div>
          <div style={styles.bannerItem}>
            <span style={styles.bannerLabel}>File Name</span>
            <strong style={styles.bannerValue}>
              {activeBatch.fileName || activeBatch.sourceUpload?.fileName || "NAv"}
            </strong>
          </div>
          <div style={styles.bannerItem}>
            <span style={styles.bannerLabel}>Ward Scope</span>
            <strong style={styles.bannerValue}>
              {activeBatch.wardPcode || activeBatch.scope?.wardPcode || activeBatch.wardNo || "NAv"}
            </strong>
          </div>
          <div style={styles.bannerItem}>
            <span style={styles.bannerLabel}>Geofence</span>
            <strong style={styles.bannerValue}>
              {activeBatch.geofenceName ||
                activeBatch.geofenceRef?.name ||
                activeBatch.summary?.geofenceBreakdown?.[0]?.name ||
                "NAv"}
            </strong>
          </div>
          <div style={styles.bannerItem}>
            <span style={styles.bannerLabel}>Total Meters</span>
            <strong style={styles.bannerValue}>
              {formatNumber(activeBatch.totalRows || displayRows.length)}
            </strong>
          </div>
          <div style={styles.bannerItem}>
            <span style={styles.bannerLabel}>BGO Status</span>
            <strong style={styles.bannerValue}>
              {activeBatch.bgoStatus || activeBatch.workflow?.state || "NAv"}
            </strong>
          </div>
        </div>
      ) : null}

      {rowsError ? (
        <div style={styles.errorNotice}>
          Failed to load rows: {rowsError?.data?.message || rowsError?.message || "Unknown error"}
        </div>
      ) : null}

      <div style={styles.panel}>
        <IrepsTable showLoadingSpinner
          rows={displayRows}
          downloads={{
            registryName: `TRN BGO Batch Rows ${batchId || ""}`.trim(),
            fileBaseName: `trn_bgo_rows_${(batchId || "batch").toLowerCase()}`,
            scope: { lmName: resolvedLmName, lmPcode: activeLmPcode, batchId },
          }}
          columns={columns}
          loading={isLoading}
          emptyText="No constituent meters found for this batch."
          title={`Batch Rows: ${batchId || "All Rows"}`}
          pageSizeOptions={[10, 25, 50, 100]}
          defaultPageSize={25}
        />
      </div>
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
    gap: 16,
  },
  eyebrow: {
    margin: "0 0 6px",
    fontSize: 12,
    fontWeight: 700,
    color: "#64748b",
  },
  breadcrumbLink: {
    color: "#2563eb",
    textDecoration: "none",
  },
  titleHelpRow: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    margin: "0 0 6px",
  },
  title: {
    margin: 0,
    fontSize: 24,
    fontWeight: 900,
    color: "#0f172a",
    letterSpacing: "-0.02em",
  },
  subtitle: {
    margin: 0,
    fontSize: 13,
    color: "#475569",
  },
  lmHeaderPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 12px",
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
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  primaryButton: {
    display: "inline-flex",
    alignItems: "center",
    padding: "8px 16px",
    borderRadius: 8,
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 700,
    fontSize: 13,
    textDecoration: "none",
    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
  },
  secondaryLinkButton: {
    display: "inline-flex",
    alignItems: "center",
    padding: "8px 14px",
    borderRadius: 8,
    background: "#ffffff",
    color: "#334155",
    fontWeight: 700,
    fontSize: 13,
    textDecoration: "none",
    border: "1px solid #cbd5e1",
  },
  batchBanner: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 12,
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: "16px 20px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
  },
  bannerItem: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 0,
  },
  bannerLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  bannerValue: {
    fontSize: 13,
    fontWeight: 800,
    color: "#0f172a",
    overflowWrap: "anywhere",
  },
  panel: {
    background: "#ffffff",
    borderRadius: 14,
    border: "1px solid #e2e8f0",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    overflow: "hidden",
  },
  errorNotice: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
    borderRadius: 10,
    padding: "12px 16px",
    fontSize: 13,
    fontWeight: 600,
  },
  meterNoCell: {
    fontFamily: "monospace",
    fontWeight: 800,
    fontSize: 13,
    color: "#0f172a",
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 8px",
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 800,
  },
  reasonCodeBadge: {
    fontSize: 11,
    fontWeight: 800,
    color: "#b91c1c",
    marginBottom: 2,
    fontFamily: "monospace",
  },
  activeTrnCode: {
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: 700,
    color: "#1d4ed8",
  },
  activeTrnState: {
    display: "inline-block",
    fontSize: 10,
    fontWeight: 800,
    color: "#b45309",
    marginTop: 2,
  },
  addressLine: {
    fontWeight: 600,
    fontSize: 13,
    color: "#0f172a",
  },
  geofenceLine: {
    fontWeight: 700,
    fontSize: 12,
    color: "#0f172a",
  },
  subtleLine: {
    fontSize: 11,
    color: "#64748b",
    marginTop: 1,
  },
};
