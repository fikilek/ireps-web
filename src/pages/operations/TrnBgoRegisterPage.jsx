/* eslint-disable no-unused-vars -- JSX component tags are consumed by the JSX transform. */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import {
  useGetBgoBatchesByLmQuery,
  useDeleteUnacceptedBgoMutation,
} from "../../redux/bgoApi";

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

function getWardLabel(batch = {}) {
  const wardName = batch?.scope?.wardName;
  const wardPcode = batch?.scope?.wardPcode || "";
  const match = wardPcode.match(/(\d{1,3})$/);
  const wardNo = match ? String(Number(match[1])) : "";

  if (wardNo) return `Ward ${wardNo}`;
  return wardName || "NAv";
}

function getWardNoFormatted(batch = {}) {
  const wardPcode = batch?.scope?.wardPcode || "";
  const match = wardPcode.match(/(\d{1,3})$/);
  if (!match) return "NAv";
  return match[1].padStart(3, "0");
}

function getBatchMeterCount(batch = {}) {
  const count =
    batch?.summary?.meterCount ??
    batch?.summary?.totalRows ??
    batch?.derivedExecutionSummary?.totalChildTrns ??
    batch?.batchReleaseSummary?.totalRows ??
    batch?.raw?.summary?.meterCount ??
    batch?.raw?.worklist?.meterRefs?.length ??
    batch?.raw?.refs?.trnIds?.length ??
    0;
  return Number(count) || 0;
}

function isTrnBatch(batch = {}) {
  const batchMode = String(
    batch?.batchMode || batch?.raw?.bgo?.batchMode || batch?.bgo?.batchMode || "",
  ).toUpperCase();
  const opType = String(
    batch?.operationType || batch?.trnType || batch?.raw?.operationType || "",
  ).toUpperCase();
  return batchMode !== "BMD" && opType !== "METER_DISCOVERY";
}

function getTrnTypeInfo(batch = {}) {
  const opType = String(
    batch?.operationType ||
      batch?.sourceUpload?.trnType ||
      batch?.assignment?.instruction?.code ||
      batch?.trnType ||
      "",
  ).toUpperCase();

  if (opType.includes("DISCONNECT") || opType === "MDCN") {
    return { label: "Disconnection", code: "MDCN", bg: "#fef2f2", text: "#b91c1c", border: "#fecaca" };
  }
  if (opType.includes("RECONNECT") || opType === "MRCN") {
    return { label: "Reconnection", code: "MRCN", bg: "#ecfdf5", text: "#047857", border: "#a7f3d0" };
  }
  if (opType.includes("INSPECT") || opType === "MINS") {
    return { label: "Inspection", code: "MINS", bg: "#f5f3ff", text: "#6d28d9", border: "#ddd6fe" };
  }
  if (opType.includes("READ") || opType === "MRDG") {
    return { label: "Reading", code: "MRDG", bg: "#f0f9ff", text: "#0369a1", border: "#bae6fd" };
  }
  if (opType.includes("REMOV") || opType === "MREM") {
    return { label: "Removal", code: "MREM", bg: "#fff7ed", text: "#c2410c", border: "#fed7aa" };
  }
  return { label: opType || "Transaction", code: "TRN", bg: "#f8fafc", text: "#334155", border: "#e2e8f0" };
}

function getAllocationStatus(batch = {}) {
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

  const {
    data: allBatches = [],
    isLoading: isBatchesLoading,
    error: batchesLoadError,
  } = useGetBgoBatchesByLmQuery(
    { lmPcode },
    { skip: !lmPcode },
  );

  const [deleteBgo, { isLoading: isDeletingBgo }] = useDeleteUnacceptedBgoMutation();

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
  const [allocationFilter, setAllocationFilter] = useState("");
  const [allocatedToFilter, setAllocatedToFilter] = useState("");
  const [totalFilter, setTotalFilter] = useState("");
  const [wardFilter, setWardFilter] = useState("");
  const [geofenceFilter, setGeofenceFilter] = useState("");
  const [createdByFilter, setCreatedByFilter] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "createdAt", direction: "desc" });

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  const resetToFirstPage = () => setCurrentPage(1);

  // Filter only TRN batches (strict category isolation per MD-BGO-R011 and TRN-BGO-R003)
  const trnBatches = useMemo(() => {
    return allBatches.filter(isTrnBatch);
  }, [allBatches]);

  // Summary KPIs
  const summary = useMemo(() => {
    let ready = 0;
    let allocated = 0;
    let inProgress = 0;
    let completed = 0;

    trnBatches.forEach((batch) => {
      const status = getAllocationStatus(batch);
      if (status === "READY_FOR_ALLOCATION") ready += 1;
      else if (status === "ALLOCATED") allocated += 1;
      else if (status === "IN_PROGRESS") inProgress += 1;
      else if (status === "COMPLETED") completed += 1;
    });

    return {
      totalBatches: trnBatches.length,
      readyForAllocation: ready,
      allocated,
      inProgress,
      completed,
    };
  }, [trnBatches]);

  // Unique dropdown options
  const wardFilterOptions = useMemo(() => {
    const set = new Set();
    trnBatches.forEach((b) => {
      const wardNo = getWardNoFormatted(b);
      if (wardNo && wardNo !== "NAv") set.add(wardNo);
    });
    return Array.from(set).sort();
  }, [trnBatches]);

  const trnTypeFilterOptions = useMemo(() => {
    const set = new Set();
    trnBatches.forEach((b) => {
      const info = getTrnTypeInfo(b);
      if (info.label) set.add(info.label);
    });
    return Array.from(set).sort();
  }, [trnBatches]);

  const allocatedToOptions = useMemo(() => {
    const set = new Set();
    trnBatches.forEach((b) => {
      const target = b?.targetName || b?.target?.name || "";
      if (target) set.add(target);
    });
    return Array.from(set).sort();
  }, [trnBatches]);

  // Filtered rows
  const filteredBatches = useMemo(() => {
    return trnBatches.filter((batch) => {
      if (batchIdFilter) {
        const id = String(batch.id || "").toLowerCase();
        if (!id.includes(batchIdFilter.toLowerCase())) return false;
      }

      if (trnTypeFilter) {
        const info = getTrnTypeInfo(batch);
        if (info.label !== trnTypeFilter) return false;
      }

      if (allocationFilter) {
        const status = getAllocationStatus(batch);
        if (allocationFilter === "ALLOCATED" && status !== "ALLOCATED" && status !== "IN_PROGRESS" && status !== "COMPLETED") return false;
        if (allocationFilter === "NOT ALLOCATED" && status !== "READY_FOR_ALLOCATION") return false;
      }

      if (allocatedToFilter) {
        const target = String(batch?.targetName || batch?.target?.name || "").toLowerCase();
        if (target !== allocatedToFilter.toLowerCase()) return false;
      }

      if (totalFilter) {
        const total = String(getBatchMeterCount(batch));
        if (!total.includes(totalFilter)) return false;
      }

      if (wardFilter) {
        const wardNo = getWardNoFormatted(batch);
        if (wardNo !== wardFilter) return false;
      }

      if (geofenceFilter) {
        const gf = String(batch?.geofenceName || batch?.geofenceRef?.name || "").toLowerCase();
        if (!gf.includes(geofenceFilter.toLowerCase())) return false;
      }

      if (createdByFilter) {
        const creator = String(batch?.metadata?.createdByUser || batch?.createdByUser || "").toLowerCase();
        if (!creator.includes(createdByFilter.toLowerCase())) return false;
      }

      return true;
    });
  }, [
    trnBatches,
    batchIdFilter,
    trnTypeFilter,
    allocationFilter,
    allocatedToFilter,
    totalFilter,
    wardFilter,
    geofenceFilter,
    createdByFilter,
  ]);

  // Sort
  const sortedBatches = useMemo(() => {
    const list = [...filteredBatches];
    const { key, direction } = sortConfig;
    const factor = direction === "asc" ? 1 : -1;

    list.sort((left, right) => {
      if (key === "batchId") return compareTableValues(left.id, right.id) * factor;
      if (key === "trnType") return compareTableValues(getTrnTypeInfo(left).label, getTrnTypeInfo(right).label) * factor;
      if (key === "allocation") return compareTableValues(getAllocationStatus(left), getAllocationStatus(right)) * factor;
      if (key === "allocatedTo") return compareTableValues(left?.targetName || left?.target?.name, right?.targetName || right?.target?.name) * factor;
      if (key === "total") return (getBatchMeterCount(left) - getBatchMeterCount(right)) * factor;
      if (key === "ward") return compareTableValues(getWardNoFormatted(left), getWardNoFormatted(right)) * factor;
      if (key === "geofence") return compareTableValues(left?.geofenceName || left?.geofenceRef?.name, right?.geofenceName || right?.geofenceRef?.name) * factor;
      if (key === "createdBy") return compareTableValues(left?.metadata?.createdByUser || left?.createdByUser, right?.metadata?.createdByUser || right?.createdByUser) * factor;
      return compareTableValues(left?.metadata?.createdAt, right?.metadata?.createdAt) * factor;
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
      const result = await deleteBgo({
        bgoBatchId: deleteCandidate.id,
        tcId: deleteCandidate.tcId || deleteCandidate?.refs?.tcUploadId || "",
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
            style={{
              ...styles.primaryButton,
              ...(!lmPcode ? styles.disabledButton : null),
            }}
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
            to="/operations/trn-bgo/dashboard"
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

      {!lmPcode ? (
        <div style={styles.errorNotice}>
          Activate a Local Municipality workbase before managing TRN BGO batches.
        </div>
      ) : null}

      {batchesLoadError ? (
        <div style={styles.errorNotice}>
          Failed to load TRN BGO Batches: {batchesLoadError?.data?.message || batchesLoadError?.message}
        </div>
      ) : null}

      {actionNotice ? (
        <div style={styles.successNotice}>
          {actionNotice}
        </div>
      ) : null}

      {isBatchesLoading ? (
        <div style={styles.loadingNotice}>Loading TRN BGO Batches...</div>
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
                <h3 style={styles.panelTitle}>Permanent Transaction Batches</h3>
                <p style={styles.panelSubtitle}>
                  Permanent batches loaded from bgo_batches for {lmName} ({lmPcode}).
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
                    <Th>BGO Rows</Th>
                    <SortableTh
                      label="Allocation"
                      sortKey="allocation"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <SortableTh
                      label="Allocated To"
                      sortKey="allocatedTo"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <SortableTh
                      label="Total Meters"
                      sortKey="total"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <SortableTh
                      label="Ward"
                      sortKey="ward"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <SortableTh
                      label="Geofence"
                      sortKey="geofence"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <SortableTh
                      label="Created By"
                      sortKey="createdBy"
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
                    <th style={styles.filterHeaderCell} />
                    <th style={styles.filterHeaderCell}>
                      <select
                        value={allocationFilter}
                        onChange={(e) => {
                          setAllocationFilter(e.target.value);
                          resetToFirstPage();
                        }}
                        style={styles.columnFilterInput}
                        aria-label="Filter Allocation"
                      >
                        <option value="">All</option>
                        <option value="NOT ALLOCATED">Not Allocated</option>
                        <option value="ALLOCATED">Allocated</option>
                      </select>
                    </th>
                    <th style={styles.filterHeaderCell}>
                      <select
                        value={allocatedToFilter}
                        onChange={(e) => {
                          setAllocatedToFilter(e.target.value);
                          resetToFirstPage();
                        }}
                        style={styles.columnFilterInput}
                        aria-label="Filter Allocated To"
                      >
                        <option value="">All</option>
                        {allocatedToOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </th>
                    <th style={styles.filterHeaderCell}>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={totalFilter}
                        onChange={(e) => {
                          setTotalFilter(e.target.value);
                          resetToFirstPage();
                        }}
                        placeholder="Filter"
                        style={styles.columnFilterInput}
                        aria-label="Filter Total"
                      />
                    </th>
                    <th style={styles.filterHeaderCell}>
                      <select
                        value={wardFilter}
                        onChange={(e) => {
                          setWardFilter(e.target.value);
                          resetToFirstPage();
                        }}
                        style={styles.columnFilterInput}
                        aria-label="Filter Ward"
                      >
                        <option value="">All Wards</option>
                        {wardFilterOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </th>
                    <th style={styles.filterHeaderCell}>
                      <input
                        type="text"
                        value={geofenceFilter}
                        onChange={(e) => {
                          setGeofenceFilter(e.target.value);
                          resetToFirstPage();
                        }}
                        placeholder="Filter Geofence"
                        style={styles.columnFilterInput}
                        aria-label="Filter Geofence"
                      />
                    </th>
                    <th style={styles.filterHeaderCell}>
                      <input
                        type="text"
                        value={createdByFilter}
                        onChange={(e) => {
                          setCreatedByFilter(e.target.value);
                          resetToFirstPage();
                        }}
                        placeholder="Filter Created By"
                        style={styles.columnFilterInput}
                        aria-label="Filter Created By"
                      />
                    </th>
                    <th style={styles.filterHeaderCell} />
                  </tr>
                </thead>

                <tbody>
                  {sortedBatches.length === 0 ? (
                    <tr>
                      <Td colSpan={12}>
                        {trnBatches.length === 0
                          ? "No permanent TRN BGO Batches were found for this Local Municipality."
                          : "No permanent TRN BGO Batches match the selected filters."}
                      </Td>
                    </tr>
                  ) : null}

                  {pagedBatches.map((batch) => {
                    const status = getAllocationStatus(batch);
                    const isAllocated = status === "ALLOCATED" || status === "IN_PROGRESS" || status === "COMPLETED";
                    const isTicked = tickedBatchIds.has(batch.id);
                    const targetName = batch?.targetName || batch?.target?.name || "";
                    const totalMeters = getBatchMeterCount(batch);
                    const wardNo = getWardNoFormatted(batch);
                    const wardPcode = batch?.scope?.wardPcode || "NAv";
                    const geofenceName = batch?.geofenceName || batch?.geofenceRef?.name || "NAv";
                    const createdBy = batch?.metadata?.createdByUser || batch?.createdByUser || "NAv";
                    const canDelete = status === "READY_FOR_ALLOCATION" || status === "ALLOCATED";
                    const trnType = getTrnTypeInfo(batch);

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
                            to={`/operations/geo-fences?focusGeofenceId=${encodeURIComponent(batch.geofenceId || batch.geofenceRef?.id || "")}`}
                            style={styles.mapLinkButton}
                            title="View Geofence Map"
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
                          <Link
                            to={`/operations/trn-bgo-rows?batchId=${encodeURIComponent(batch.id)}&wardPcode=${encodeURIComponent(wardPcode)}&lmPcode=${encodeURIComponent(lmPcode)}`}
                            style={styles.rowLinkButton}
                          >
                            BGO Rows
                          </Link>
                        </Td>

                        <Td>
                          {isAllocated ? (
                            <Link
                              to={`/operations/trn-bgo/allocation?batchId=${encodeURIComponent(batch.id)}`}
                              style={styles.unallocateButton}
                              title="View or modify allocation on Allocation Board"
                            >
                              Unallocate
                            </Link>
                          ) : (
                            <Link
                              to={`/operations/trn-bgo/allocation?batchId=${encodeURIComponent(batch.id)}`}
                              style={styles.rowLinkButton}
                              title="Allocate this batch on Allocation Board"
                            >
                              Allocate
                            </Link>
                          )}
                        </Td>

                        <Td>
                          {targetName ? (
                            <div style={styles.strongCell}>{targetName}</div>
                          ) : null}
                        </Td>

                        <Td>
                          <strong style={styles.totalCell}>{formatNumber(totalMeters)}</strong>
                        </Td>

                        <Td>
                          <div style={styles.strongCell}>{wardNo}</div>
                          <div style={styles.mutedCell}>{wardPcode}</div>
                        </Td>

                        <Td>
                          <div style={styles.strongCell}>{geofenceName}</div>
                        </Td>

                        <Td>
                          <div style={styles.strongCell}>{createdBy}</div>
                        </Td>

                        <Td>
                          <button
                            type="button"
                            style={{
                              ...styles.deleteBatchButton,
                              ...(!canDelete ? styles.disabledButton : null),
                            }}
                            disabled={!canDelete}
                            onClick={() => handleOpenDelete(batch)}
                            title={canDelete ? "Delete unaccepted BGO" : "Cannot delete active/executed batch"}
                          >
                            Delete BGO
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
              Are you sure you want to delete batch <strong>{deleteCandidate.id}</strong>?
              This will remove the permanent batch document and release any associated staged rows.
            </p>

            {deleteError ? (
              <div style={styles.errorNotice}>{deleteError}</div>
            ) : null}

            <div style={styles.modalActions}>
              <button
                type="button"
                style={styles.modalCancelButton}
                onClick={handleCloseDelete}
                disabled={isDeletingBgo}
              >
                Cancel
              </button>
              <button
                type="button"
                style={styles.modalDeleteButton}
                onClick={handleConfirmDelete}
                disabled={isDeletingBgo}
              >
                {isDeletingBgo ? "Deleting..." : "Delete Batch"}
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
  mutedCell: {
    color: "#64748b",
    fontSize: 12,
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
  unallocateButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 12px",
    borderRadius: 8,
    background: "#fef3c7",
    color: "#92400e",
    fontWeight: 800,
    fontSize: 12,
    textDecoration: "none",
    border: "1px solid #fde68a",
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
