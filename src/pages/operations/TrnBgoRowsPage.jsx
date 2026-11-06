/* eslint-disable no-unused-vars -- JSX component tags are consumed by the JSX transform. */
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import {
  useGetBgoBatchesByLmQuery,
  useGetBgoRowsByBatchIdQuery,
} from "../../redux/bgoApi";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

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

export default function TrnBgoRowsPage() {
  const [searchParams] = useSearchParams();
  const batchId = searchParams.get("batchId") || "";
  const wardPcodeParam = searchParams.get("wardPcode") || "";
  const lmPcodeParam = searchParams.get("lmPcode") || "";

  const auth = useAuth();
  const { geoState } = useGeo();
  const { lmPcode: resolvedLmPcode } = useMemo(
    () => resolveWorkbase(auth, geoState),
    [auth, geoState],
  );
  const activeLmPcode = lmPcodeParam || resolvedLmPcode;

  const { data: allBatches = [] } = useGetBgoBatchesByLmQuery(
    { lmPcode: activeLmPcode },
    { skip: !activeLmPcode },
  );

  const batch = useMemo(() => {
    return allBatches.find((b) => b.id === batchId) || null;
  }, [allBatches, batchId]);

  const {
    data: rows = [],
    isLoading: isRowsLoading,
    error: rowsError,
  } = useGetBgoRowsByBatchIdQuery(
    { bgoBatchId: batchId },
    { skip: !batchId },
  );

  const [meterFilter, setMeterFilter] = useState("");
  const [trnFilter, setTrnFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [addressFilter, setAddressFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const meterNo = String(row?.meterNo || row?.input?.meterNo || row?.ast?.astNo || "").toLowerCase();
      if (meterFilter && !meterNo.includes(meterFilter.toLowerCase())) return false;

      const trnId = String(row?.trnId || row?.refs?.trnId || row?.bgo?.trnId || "").toLowerCase();
      if (trnFilter && !trnId.includes(trnFilter.toLowerCase())) return false;

      const status = String(row?.status || row?.releaseState || row?.bgo?.releaseState || "").toLowerCase();
      if (statusFilter && !status.includes(statusFilter.toLowerCase())) return false;

      const address = String(row?.address || row?.premise?.address || row?.input?.premiseAddress || "").toLowerCase();
      if (addressFilter && !address.includes(addressFilter.toLowerCase())) return false;

      return true;
    });
  }, [rows, meterFilter, trnFilter, statusFilter, addressFilter]);

  const totalRows = filteredRows.length;
  const totalPages = Math.ceil(totalRows / pageSize) || 1;
  const safeCurrentPage = Math.min(Math.max(currentPage, 1), totalPages);

  const pagedRows = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, safeCurrentPage, pageSize]);

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
          <h2 style={styles.title}>TRN BGO Batch Rows</h2>
          <p style={styles.subtitle}>
            Batch ID: <strong>{batchId || "No Batch Selected"}</strong> · {rows.length} total meter candidate rows
          </p>
        </div>

        <div style={styles.headerActions}>
          <Link to="/operations/trn-bgo" style={styles.secondaryLinkButton}>
            Back to TRN BGO Register
          </Link>
          <Link
            to={`/operations/trn-bgo/allocation?batchId=${encodeURIComponent(batchId)}`}
            style={styles.primaryButton}
          >
            Allocation Board
          </Link>
          <Link to="/operations/trn-bgo/dashboard" style={styles.secondaryLinkButton}>
            TRN BGO Dashboard
          </Link>
        </div>
      </div>

      {batch ? (
        <div style={styles.batchBanner}>
          <div style={styles.bannerItem}>
            <span style={styles.bannerLabel}>Operation</span>
            <strong style={styles.bannerValue}>
              {batch.operationType || batch?.sourceUpload?.trnType || "NAv"}
            </strong>
          </div>
          <div style={styles.bannerItem}>
            <span style={styles.bannerLabel}>Ward</span>
            <strong style={styles.bannerValue}>
              {batch?.scope?.wardPcode || "NAv"}
            </strong>
          </div>
          <div style={styles.bannerItem}>
            <span style={styles.bannerLabel}>Geofence</span>
            <strong style={styles.bannerValue}>
              {batch?.geofenceName || batch?.geofenceRef?.name || "NAv"}
            </strong>
          </div>
          <div style={styles.bannerItem}>
            <span style={styles.bannerLabel}>Allocated Target</span>
            <strong style={styles.bannerValue}>
              {batch?.targetName || batch?.target?.name || "Not Allocated"}
            </strong>
          </div>
          <div style={styles.bannerItem}>
            <span style={styles.bannerLabel}>Workflow State</span>
            <strong style={styles.bannerValue}>
              {batch?.workflow?.state || batch?.workflowState || "NAv"}
            </strong>
          </div>
        </div>
      ) : null}

      <div style={styles.panel}>
        <div style={styles.filtersBar}>
          <input
            type="text"
            placeholder="Filter Meter No"
            value={meterFilter}
            onChange={(e) => {
              setMeterFilter(e.target.value);
              setCurrentPage(1);
            }}
            style={styles.filterInput}
          />
          <input
            type="text"
            placeholder="Filter TRN ID"
            value={trnFilter}
            onChange={(e) => {
              setTrnFilter(e.target.value);
              setCurrentPage(1);
            }}
            style={styles.filterInput}
          />
          <input
            type="text"
            placeholder="Filter Address"
            value={addressFilter}
            onChange={(e) => {
              setAddressFilter(e.target.value);
              setCurrentPage(1);
            }}
            style={styles.filterInput}
          />
        </div>

        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>#</th>
                <th style={styles.th}>Meter No</th>
                <th style={styles.th}>Child TRN ID</th>
                <th style={styles.th}>Release State</th>
                <th style={styles.th}>Address</th>
                <th style={styles.th}>ERF No</th>
                <th style={styles.th}>Account No</th>
                <th style={styles.th}>Action Reason</th>
              </tr>
            </thead>
            <tbody>
              {isRowsLoading ? (
                <tr>
                  <td colSpan={8} style={styles.loadingCell}>
                    Loading BGO Batch rows...
                  </td>
                </tr>
              ) : null}

              {!isRowsLoading && filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={styles.emptyCell}>
                    No rows match the specified criteria.
                  </td>
                </tr>
              ) : null}

              {!isRowsLoading
                ? pagedRows.map((row, idx) => {
                    const meterNo = row?.meterNo || row?.input?.meterNo || row?.ast?.astNo || "NAv";
                    const trnId = row?.trnId || row?.refs?.trnId || row?.bgo?.trnId || "NAv";
                    const releaseState = row?.releaseState || row?.bgo?.releaseState || row?.status || "WAITING";
                    const address = row?.address || row?.premise?.address || row?.input?.premiseAddress || "NAv";
                    const erfNo = row?.erfNo || row?.ast?.erfNo || row?.premise?.erfNo || "NAv";
                    const accountNo = row?.linkedAccountNo || row?.input?.linkedAccountNo || "NAv";
                    const actionReason = row?.actionReason || row?.input?.actionReason || "NAv";

                    return (
                      <tr key={row.id || idx}>
                        <td style={styles.td}>{(safeCurrentPage - 1) * pageSize + idx + 1}</td>
                        <td style={styles.td}>
                          <strong style={styles.meterText}>{meterNo}</strong>
                        </td>
                        <td style={styles.td}>
                          <span style={styles.trnText}>{trnId}</span>
                        </td>
                        <td style={styles.td}>
                          <span style={styles.badge}>{releaseState}</span>
                        </td>
                        <td style={styles.td}>{address}</td>
                        <td style={styles.td}>{erfNo}</td>
                        <td style={styles.td}>{accountNo}</td>
                        <td style={styles.td}>{actionReason}</td>
                      </tr>
                    );
                  })
                : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

const styles = {
  page: {
    padding: "24px 32px 64px",
    maxWidth: 1600,
    margin: "0 auto",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 24,
    marginBottom: 20,
    flexWrap: "wrap",
  },
  eyebrow: {
    margin: "0 0 6px",
    color: "#64748b",
    fontSize: 12,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  breadcrumbLink: {
    color: "#2563eb",
    textDecoration: "none",
  },
  title: {
    margin: "0 0 6px",
    fontSize: 28,
    fontWeight: 900,
    color: "#0f172a",
    letterSpacing: "-0.02em",
  },
  subtitle: {
    margin: 0,
    color: "#64748b",
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
    padding: "10px 16px",
    borderRadius: 12,
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 800,
    textDecoration: "none",
    fontSize: 13,
  },
  secondaryLinkButton: {
    display: "inline-flex",
    alignItems: "center",
    padding: "9px 14px",
    borderRadius: 12,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#475569",
    fontWeight: 800,
    textDecoration: "none",
    fontSize: 13,
  },
  batchBanner: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
    marginBottom: 20,
    padding: "16px 20px",
    background: "#f8fafc",
    borderRadius: 16,
    border: "1px solid #e2e8f0",
  },
  bannerItem: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  bannerLabel: {
    fontSize: 11,
    fontWeight: 800,
    textTransform: "uppercase",
    color: "#64748b",
    letterSpacing: "0.05em",
  },
  bannerValue: {
    fontSize: 15,
    fontWeight: 800,
    color: "#0f172a",
  },
  panel: {
    border: "1px solid #e2e8f0",
    borderRadius: 20,
    background: "#ffffff",
    padding: 20,
    boxShadow: "0 4px 16px rgba(15, 23, 42, 0.04)",
  },
  filtersBar: {
    display: "flex",
    gap: 12,
    marginBottom: 16,
    flexWrap: "wrap",
  },
  filterInput: {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    fontSize: 13,
    color: "#0f172a",
    minWidth: 200,
  },
  tableContainer: {
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    fontSize: 13,
  },
  th: {
    background: "#f8fafc",
    color: "#475569",
    fontWeight: 800,
    textAlign: "left",
    padding: "12px 14px",
    borderBottom: "2px solid #e2e8f0",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "12px 14px",
    borderBottom: "1px solid #f1f5f9",
    verticalAlign: "middle",
  },
  meterText: {
    color: "#0f172a",
    fontFamily: "monospace",
    fontSize: 14,
  },
  trnText: {
    color: "#475569",
    fontFamily: "monospace",
    fontSize: 12,
  },
  badge: {
    display: "inline-block",
    padding: "3px 8px",
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 800,
    background: "#f1f5f9",
    color: "#475569",
  },
  loadingCell: {
    padding: 32,
    textAlign: "center",
    color: "#64748b",
  },
  emptyCell: {
    padding: 32,
    textAlign: "center",
    color: "#64748b",
  },
};
