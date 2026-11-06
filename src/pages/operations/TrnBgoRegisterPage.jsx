/* eslint-disable no-unused-vars -- JSX component tags are consumed by the JSX transform. */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import {
  useGetTcUploadsQuery,
  useDeleteTcUploadMutation,
} from "../../redux/tcApi";
import { useGetBgoBatchesByLmQuery } from "../../redux/bgoApi";

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100];

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

function compareTableValues(left, right) {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return String(left || "").localeCompare(String(right || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function SortableTh({ label, sortKey, sortConfig, onSort }) {
  const isActive = sortConfig.key === sortKey;
  const indicator = isActive ? (sortConfig.direction === "asc" ? " ▲" : " ▼") : "";

  return (
    <th style={styles.th}>
      <button
        type="button"
        style={styles.sortHeaderButton}
        onClick={() => onSort(sortKey)}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <span style={styles.sortIndicator}>{indicator}</span>
      </button>
    </th>
  );
}

function Th({ children }) {
  return <th style={styles.th}>{children}</th>;
}

function Td({ children, colSpan = 1 }) {
  return (
    <td style={styles.td} colSpan={colSpan}>
      {children}
    </td>
  );
}

function SummaryCard({ label, value }) {
  return (
    <div style={styles.summaryCard}>
      <span style={styles.summaryCardLabel}>{label}</span>
      <strong style={styles.summaryCardValue}>{formatNumber(value)}</strong>
    </div>
  );
}

function PaginationControls({
  currentPage,
  pageSize,
  totalPages,
  totalRows,
  onPageChange,
  onPageSizeChange,
}) {
  if (totalRows === 0) return null;

  const startRow = (currentPage - 1) * pageSize + 1;
  const endRow = Math.min(currentPage * pageSize, totalRows);

  return (
    <div style={styles.paginationBar}>
      <div style={styles.paginationSummary}>
        Showing {formatNumber(startRow)}-{formatNumber(endRow)} of {formatNumber(totalRows)}
      </div>

      <div style={styles.paginationControls}>
        <label style={styles.pageSizeLabel}>
          Rows per page
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            style={styles.pageSizeSelect}
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          style={styles.paginationButton}
          onClick={() => onPageChange(1)}
          disabled={currentPage <= 1}
        >
          First
        </button>
        <button
          type="button"
          style={styles.paginationButton}
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
        >
          Previous
        </button>

        <span style={styles.pageIndicator}>
          Page {currentPage} of {Math.max(1, totalPages)}
        </span>

        <button
          type="button"
          style={styles.paginationButton}
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
        >
          Next
        </button>
        <button
          type="button"
          style={styles.paginationButton}
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage >= totalPages}
        >
          Last
        </button>
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

  // Table filters & sorting
  const [batchIdFilter, setBatchIdFilter] = useState("");
  const [trnTypeFilter, setTrnTypeFilter] = useState("");
  const [fileFilter, setFileFilter] = useState("");
  const [bgoStatusFilter, setBgoStatusFilter] = useState("");
  const [lmFilter, setLmFilter] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "createdAt", direction: "desc" });

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const resetToFirstPage = () => setCurrentPage(1);

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

  // Dropdown options
  const trnTypeFilterOptions = useMemo(() => {
    const set = new Set();
    uploads.forEach((b) => {
      const info = getTrnTypeInfo(b.trnType);
      if (info.label) set.add(info.label);
    });
    return Array.from(set).sort();
  }, [uploads]);

  const lmFilterOptions = useMemo(() => {
    const set = new Set();
    uploads.forEach((b) => {
      if (b.lmPcode && b.lmPcode !== "NAv") set.add(b.lmPcode);
    });
    return Array.from(set).sort();
  }, [uploads]);

  // Filtered rows
  const filteredBatches = useMemo(() => {
    return uploads.filter((batch) => {
      if (batchIdFilter) {
        const id = String(batch.id || "").toLowerCase();
        if (!id.includes(batchIdFilter.toLowerCase())) return false;
      }

      if (trnTypeFilter) {
        const info = getTrnTypeInfo(batch.trnType);
        if (info.label !== trnTypeFilter) return false;
      }

      if (fileFilter) {
        const file = String(batch.fileName || "").toLowerCase();
        if (!file.includes(fileFilter.toLowerCase())) return false;
      }

      if (bgoStatusFilter) {
        const bgoStatus = String(batch.bgoStatus || "").toUpperCase();
        if (bgoStatusFilter === "READY_FOR_BGO" && bgoStatus !== "READY_FOR_BGO" && !(Number(batch.readyRows) > 0)) {
          return false;
        }
        if (bgoStatusFilter === "ALLOCATED" && bgoStatus !== "USED" && bgoStatus !== "PARTIALLY_USED") {
          return false;
        }
        if (bgoStatusFilter === "NOT_READY" && bgoStatus !== "NOT_READY") {
          return false;
        }
      }

      if (lmFilter) {
        if (batch.lmPcode !== lmFilter) return false;
      }

      return true;
    });
  }, [uploads, batchIdFilter, trnTypeFilter, fileFilter, bgoStatusFilter, lmFilter]);

  // Sort
  const sortedBatches = useMemo(() => {
    const list = [...filteredBatches];
    const { key, direction } = sortConfig;
    const factor = direction === "asc" ? 1 : -1;

    list.sort((left, right) => {
      if (key === "batchId") return compareTableValues(left.id, right.id) * factor;
      if (key === "trnType") return compareTableValues(getTrnTypeInfo(left.trnType).label, getTrnTypeInfo(right.trnType).label) * factor;
      if (key === "fileName") return compareTableValues(left.fileName, right.fileName) * factor;
      if (key === "status") return compareTableValues(left.bgoStatus, right.bgoStatus) * factor;
      if (key === "readyRows") return (Number(left.readyRows || 0) - Number(right.readyRows || 0)) * factor;
      if (key === "totalRows") return (Number(left.totalRows || 0) - Number(right.totalRows || 0)) * factor;
      if (key === "lmPcode") return compareTableValues(left.lmPcode, right.lmPcode) * factor;
      return compareTableValues(left.metadata?.createdAt, right.metadata?.createdAt) * factor;
    });

    return list;
  }, [filteredBatches, sortConfig]);

  // Pagination slice
  const totalRows = sortedBatches.length;
  const totalPages = Math.ceil(totalRows / pageSize) || 1;
  const safeCurrentPage = Math.min(Math.max(currentPage, 1), totalPages);

  const pagedBatches = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return sortedBatches.slice(start, start + pageSize);
  }, [sortedBatches, safeCurrentPage, pageSize]);

  const handleSort = (sortKey) => {
    setSortConfig((prev) => {
      if (prev.key === sortKey) {
        return { key: sortKey, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { key: sortKey, direction: "asc" };
    });
  };

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

      {isUploadsLoading ? (
        <div style={styles.loadingNotice}>Loading TRN BGO Batches...</div>
      ) : (
        <>
          <div style={styles.summaryGrid}>
            <SummaryCard label="Total Batches" value={summary.totalBatches} />
            <SummaryCard label="Ready for Allocation" value={summary.readyForAllocation} />
            <SummaryCard label="Allocated" value={summary.allocated} />
            <SummaryCard label="Total Meters" value={summary.totalMeters} />
          </div>

          <div style={styles.panel}>
            <div style={styles.panelHeader}>
              <div>
                <h3 style={styles.panelTitle}>Permanent Transaction Batches</h3>
                <p style={styles.panelSubtitle}>
                  Permanent batches loaded from Firestore tc_uploads and bgo_batches.
                </p>
              </div>

              <div style={styles.draftStreamBadge}>Permanent Firestore register</div>
            </div>

            <PaginationControls
              currentPage={safeCurrentPage}
              pageSize={pageSize}
              totalPages={totalPages}
              totalRows={totalRows}
              onPageChange={setCurrentPage}
              onPageSizeChange={(newSize) => {
                setPageSize(newSize);
                resetToFirstPage();
              }}
            />

            <div style={styles.tableContainer}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <Th>[ ]</Th>
                    <Th>Map</Th>
                    <SortableTh
                      label="Batch ID"
                      sortKey="batchId"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <SortableTh
                      label="TRN Type"
                      sortKey="trnType"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <SortableTh
                      label="File Name"
                      sortKey="fileName"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <Th>BGO Rows</Th>
                    <Th>Allocation</Th>
                    <SortableTh
                      label="BGO Status"
                      sortKey="status"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <SortableTh
                      label="Ready Meters"
                      sortKey="readyRows"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <SortableTh
                      label="Total Meters"
                      sortKey="totalRows"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <SortableTh
                      label="LM"
                      sortKey="lmPcode"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <Th>Delete BGO</Th>
                  </tr>

                  {/* Integrated Header Filters */}
                  <tr>
                    <th style={styles.filterHeaderCell} />
                    <th style={styles.filterHeaderCell} />
                    <th style={styles.filterHeaderCell}>
                      <input
                        type="text"
                        value={batchIdFilter}
                        onChange={(e) => {
                          setBatchIdFilter(e.target.value);
                          resetToFirstPage();
                        }}
                        placeholder="Filter Batch ID"
                        style={styles.columnFilterInput}
                        aria-label="Filter Batch ID"
                      />
                    </th>
                    <th style={styles.filterHeaderCell}>
                      <select
                        value={trnTypeFilter}
                        onChange={(e) => {
                          setTrnTypeFilter(e.target.value);
                          resetToFirstPage();
                        }}
                        style={styles.columnFilterInput}
                        aria-label="Filter TRN Type"
                      >
                        <option value="">All Types</option>
                        {trnTypeFilterOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </th>
                    <th style={styles.filterHeaderCell}>
                      <input
                        type="text"
                        value={fileFilter}
                        onChange={(e) => {
                          setFileFilter(e.target.value);
                          resetToFirstPage();
                        }}
                        placeholder="Filter File"
                        style={styles.columnFilterInput}
                        aria-label="Filter File"
                      />
                    </th>
                    <th style={styles.filterHeaderCell} />
                    <th style={styles.filterHeaderCell} />
                    <th style={styles.filterHeaderCell}>
                      <select
                        value={bgoStatusFilter}
                        onChange={(e) => {
                          setBgoStatusFilter(e.target.value);
                          resetToFirstPage();
                        }}
                        style={styles.columnFilterInput}
                        aria-label="Filter BGO Status"
                      >
                        <option value="">All</option>
                        <option value="READY_FOR_BGO">Ready for BGO</option>
                        <option value="ALLOCATED">Allocated</option>
                        <option value="NOT_READY">Not Ready</option>
                      </select>
                    </th>
                    <th style={styles.filterHeaderCell} />
                    <th style={styles.filterHeaderCell} />
                    <th style={styles.filterHeaderCell}>
                      <select
                        value={lmFilter}
                        onChange={(e) => {
                          setLmFilter(e.target.value);
                          resetToFirstPage();
                        }}
                        style={styles.columnFilterInput}
                        aria-label="Filter LM"
                      >
                        <option value="">All LMs</option>
                        {lmFilterOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </th>
                    <th style={styles.filterHeaderCell} />
                  </tr>
                </thead>

                <tbody>
                  {sortedBatches.length === 0 ? (
                    <tr>
                      <Td colSpan={12}>
                        {uploads.length === 0
                          ? "No permanent TRN BGO Batches were found."
                          : "No permanent TRN BGO Batches match the selected filters."}
                      </Td>
                    </tr>
                  ) : null}

                  {pagedBatches.map((batch) => {
                    const isTicked = tickedBatchIds.has(batch.id);
                    const trnType = getTrnTypeInfo(batch.trnType);
                    const bgoStatus = getBgoStatusBadge(batch.bgoStatus);
                    const canAllocate = Number(batch.readyRows || 0) > 0 || batch.bgoStatus === "READY_FOR_BGO";

                    return (
                      <tr key={batch.id}>
                        <Td>
                          <input
                            type="checkbox"
                            checked={isTicked}
                            onChange={() => toggleTick(batch.id)}
                            aria-label={`Select batch ${batch.id}`}
                          />
                        </Td>

                        <Td>
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
                        </Td>

                        <Td>
                          <div style={styles.strongCell}>{batch.id || "NAv"}</div>
                        </Td>

                        <Td>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              padding: "4px 8px",
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 700,
                              background: trnType.bg,
                              color: trnType.text,
                              border: `1px solid ${trnType.border}`,
                            }}
                          >
                            {trnType.label}
                          </span>
                        </Td>

                        <Td>
                          <div style={styles.fileNameCell} title={batch.fileName}>
                            {batch.fileName}
                          </div>
                        </Td>

                        <Td>
                          <Link
                            to={`/operations/tc-uploads/${batch.id}`}
                            style={styles.rowLinkButton}
                          >
                            BGO Rows
                          </Link>
                        </Td>

                        <Td>
                          <Link
                            to={`/operations/tc-uploads/${batch.id}/bgo`}
                            style={{
                              ...styles.allocateButton,
                              ...(!canAllocate ? styles.disabledButton : null),
                            }}
                            title={canAllocate ? "Open BGO allocation" : "No ready rows available for BGO"}
                          >
                            Allocate
                          </Link>
                        </Td>

                        <Td>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              padding: "4px 8px",
                              borderRadius: 6,
                              fontSize: 11,
                              fontWeight: 800,
                              background: bgoStatus.bg,
                              color: bgoStatus.text,
                              border: `1px solid ${bgoStatus.border}`,
                            }}
                          >
                            {bgoStatus.label}
                          </span>
                        </Td>

                        <Td>
                          <strong style={styles.readyCell}>{formatNumber(batch.readyRows)}</strong>
                        </Td>

                        <Td>
                          <strong style={styles.totalCell}>{formatNumber(batch.totalRows)}</strong>
                        </Td>

                        <Td>
                          <div style={styles.strongCell}>{batch.lmPcode || "NAv"}</div>
                        </Td>

                        <Td>
                          <button
                            type="button"
                            style={styles.deleteBatchButton}
                            onClick={() => handleOpenDelete(batch)}
                            title="Delete this batch upload"
                          >
                            Delete
                          </button>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <PaginationControls
              currentPage={safeCurrentPage}
              pageSize={pageSize}
              totalPages={totalPages}
              totalRows={totalRows}
              onPageChange={setCurrentPage}
              onPageSizeChange={(newSize) => {
                setPageSize(newSize);
                resetToFirstPage();
              }}
            />
          </div>
        </>
      )}

      {/* Delete Confirmation Modal */}
      {deleteCandidate ? (
        <div style={styles.modalOverlay}>
          <div style={styles.modalBox}>
            <h3 style={styles.modalTitle}>Delete TRN BGO Batch</h3>
            <p style={styles.modalText}>
              Are you sure you want to delete batch <strong>{deleteCandidate.id}</strong> ({deleteCandidate.fileName})?
              This will remove the uploaded batch and all associated rows.
            </p>

            {deleteError ? (
              <div style={styles.errorNotice}>{deleteError}</div>
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
  titleHelpRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
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
  clearTicksButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #cbd5e1",
    borderRadius: 14,
    background: "#ffffff",
    color: "#475569",
    padding: "11px 16px",
    fontWeight: 900,
    fontSize: "inherit",
    fontFamily: "inherit",
    cursor: "pointer",
    textDecoration: "none",
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
  panelTitle: {
    margin: 0,
    fontSize: 20,
    color: "#0f172a",
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
  tableContainer: {
    overflowX: "auto",
    marginBottom: 16,
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
  sortHeaderButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    background: "transparent",
    border: 0,
    padding: 0,
    margin: 0,
    font: "inherit",
    color: "inherit",
    fontWeight: "inherit",
    cursor: "pointer",
  },
  sortIndicator: {
    fontSize: 10,
    color: "#2563eb",
  },
  td: {
    padding: "14px",
    borderBottom: "1px solid #f1f5f9",
    verticalAlign: "middle",
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
  filterHeaderCell: {
    background: "#f8fafc",
    padding: "6px 10px",
    borderBottom: "1px solid #e2e8f0",
  },
  columnFilterInput: {
    width: "100%",
    boxSizing: "border-box",
    padding: "5px 8px",
    borderRadius: 6,
    border: "1px solid #cbd5e1",
    fontSize: 12,
    color: "#0f172a",
    background: "#ffffff",
  },
  paginationBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
    padding: "12px 0",
  },
  paginationSummary: {
    color: "#64748b",
    fontSize: 13,
  },
  paginationControls: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  pageSizeLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: "#475569",
    fontSize: 12,
    fontWeight: 700,
    marginRight: 8,
  },
  pageSizeSelect: {
    padding: "4px 8px",
    borderRadius: 6,
    border: "1px solid #cbd5e1",
    fontSize: 12,
    color: "#0f172a",
  },
  paginationButton: {
    padding: "6px 12px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#334155",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  pageIndicator: {
    color: "#475569",
    fontSize: 12,
    fontWeight: 700,
    padding: "0 4px",
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
};
