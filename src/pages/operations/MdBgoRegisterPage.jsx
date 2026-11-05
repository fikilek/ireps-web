/* eslint-disable no-unused-vars -- JSX component tags are consumed by the JSX transform. */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import { useWarehouse } from "@/context/WarehouseContext";
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

function getActiveLmPcode(activeWorkbase, selectedLm) {
  return String(
    selectedLm?.pcode ||
      selectedLm?.id ||
      activeWorkbase?.lmPcode ||
      activeWorkbase?.pcode ||
      activeWorkbase?.id ||
      activeWorkbase?.localMunicipalityId ||
      "",
  ).trim();
}

function getActiveWorkbaseName(activeWorkbase, selectedLm) {
  return String(
    selectedLm?.name ||
      selectedLm?.lmName ||
      activeWorkbase?.name ||
      activeWorkbase?.lmName ||
      activeWorkbase?.id ||
      "NAv",
  ).trim();
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

function getBatchErfCount(batch = {}) {
  const count =
    batch?.summary?.erfCount ??
    batch?.summary?.totalRows ??
    batch?.raw?.summary?.erfCount ??
    batch?.raw?.worklist?.erfRefs?.length ??
    0;
  return Number(count) || 0;
}

function isBmdBatch(batch = {}) {
  const batchMode = String(
    batch?.batchMode || batch?.raw?.bgo?.batchMode || batch?.bgo?.batchMode || "",
  ).toUpperCase();
  const opType = String(
    batch?.operationType || batch?.trnType || batch?.raw?.operationType || "",
  ).toUpperCase();
  return batchMode === "BMD" || opType === "METER_DISCOVERY";
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

export default function MdBgoRegisterPage() {
  const navigate = useNavigate();
  const { userProfile, role } = useAuth();
  const { activeWorkbase, selectedLm } = useWarehouse();

  const lmPcode = getActiveLmPcode(activeWorkbase, selectedLm);
  const lmName = getActiveWorkbaseName(activeWorkbase, selectedLm);

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
      else if (status === "ALLOCATED") allocated += 1;
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

  // Dropdown filter options
  const allocatedToOptions = useMemo(() => {
    const set = new Set();
    bmdBatches.forEach((batch) => {
      const name = batch?.targetName || batch?.target?.name;
      if (name && name !== "NAv") set.add(name);
    });
    return Array.from(set).sort();
  }, [bmdBatches]);

  const wardFilterOptions = useMemo(() => {
    const set = new Set();
    bmdBatches.forEach((batch) => {
      const label = getWardLabel(batch);
      if (label && label !== "NAv") set.add(label);
    });
    return Array.from(set).sort();
  }, [bmdBatches]);

  // Filtering
  const filteredBatches = useMemo(() => {
    return bmdBatches.filter((batch) => {
      if (batchIdFilter) {
        const id = String(batch.id || batch.batchId || "").toUpperCase();
        if (!id.includes(batchIdFilter.trim().toUpperCase())) return false;
      }

      if (allocationFilter) {
        const status = getAllocationStatus(batch);
        if (allocationFilter === "ALLOCATED" && status !== "ALLOCATED" && status !== "IN_PROGRESS" && status !== "COMPLETED") return false;
        if (allocationFilter === "NOT ALLOCATED" && status !== "READY_FOR_ALLOCATION") return false;
      }

      if (allocatedToFilter) {
        const name = String(batch?.targetName || batch?.target?.name || "");
        if (name !== allocatedToFilter) return false;
      }

      if (totalFilter) {
        const total = getBatchErfCount(batch);
        if (String(total) !== totalFilter.trim()) return false;
      }

      if (wardFilter) {
        const label = getWardLabel(batch);
        if (label !== wardFilter) return false;
      }

      if (geofenceFilter) {
        const name = String(batch?.geofenceName || batch?.geofenceRef?.name || "").toUpperCase();
        if (!name.includes(geofenceFilter.trim().toUpperCase())) return false;
      }

      if (createdByFilter) {
        const creator = String(batch?.metadata?.createdByUser || "").toUpperCase();
        if (!creator.includes(createdByFilter.trim().toUpperCase())) return false;
      }

      return true;
    });
  }, [
    bmdBatches,
    batchIdFilter,
    allocationFilter,
    allocatedToFilter,
    totalFilter,
    wardFilter,
    geofenceFilter,
    createdByFilter,
  ]);

  // Sorting
  const sortedBatches = useMemo(() => {
    const items = [...filteredBatches];
    const { key, direction } = sortConfig;
    const factor = direction === "asc" ? 1 : -1;

    items.sort((a, b) => {
      let left = "";
      let right = "";

      if (key === "batchId") {
        left = a?.id || "";
        right = b?.id || "";
      } else if (key === "allocation") {
        left = getAllocationStatus(a);
        right = getAllocationStatus(b);
      } else if (key === "allocatedTo") {
        left = a?.targetName || a?.target?.name || "";
        right = b?.targetName || b?.target?.name || "";
      } else if (key === "total") {
        left = getBatchErfCount(a);
        right = getBatchErfCount(b);
      } else if (key === "ward") {
        left = getWardLabel(a);
        right = getWardLabel(b);
      } else if (key === "geofence") {
        left = a?.geofenceName || a?.geofenceRef?.name || "";
        right = b?.geofenceName || b?.geofenceRef?.name || "";
      } else if (key === "createdBy") {
        left = a?.metadata?.createdByUser || "";
        right = b?.metadata?.createdByUser || "";
      } else if (key === "createdAt") {
        left = a?.metadata?.createdAt || a?.createdAt || "";
        right = b?.metadata?.createdAt || b?.createdAt || "";
      }

      return compareTableValues(left, right) * factor;
    });

    return items;
  }, [filteredBatches, sortConfig]);

  // Pagination slice
  const totalRows = sortedBatches.length;
  const totalPages = Math.ceil(totalRows / pageSize) || 1;
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pagedBatches = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return sortedBatches.slice(start, start + pageSize);
  }, [sortedBatches, safeCurrentPage, pageSize]);

  const handleSort = (key) => {
    setSortConfig((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  };

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
            Allocation Board ({tickedBatchIds.size})
          </Link>

          <Link
            to="/operations/bgo-dashboard"
            style={styles.secondaryLinkButton}
          >
            Open BGO Dashboard
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
                <h3 style={styles.panelTitle}>Permanent Meter Discovery Batches</h3>
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
                      label="Total"
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
                      <Td colSpan={11}>
                        {bmdBatches.length === 0
                          ? "No permanent MD BGO Batches were found for this Local Municipality."
                          : "No permanent MD BGO Batches match the selected filters."}
                      </Td>
                    </tr>
                  ) : null}

                  {pagedBatches.map((batch) => {
                    const status = getAllocationStatus(batch);
                    const isAllocated = status === "ALLOCATED" || status === "IN_PROGRESS" || status === "COMPLETED";
                    const isTicked = tickedBatchIds.has(batch.id);
                    const targetName = batch?.targetName || batch?.target?.name || "";
                    const totalErfs = getBatchErfCount(batch);
                    const wardNo = getWardNoFormatted(batch);
                    const wardPcode = batch?.scope?.wardPcode || "NAv";
                    const geofenceName = batch?.geofenceName || batch?.geofenceRef?.name || "NAv";
                    const createdBy = batch?.metadata?.createdByUser || batch?.createdByUser || "NAv";
                    const canDelete = status === "READY_FOR_ALLOCATION" || status === "ALLOCATED";

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
                            to={`/operations/bgo/plan?focusGeofenceId=${encodeURIComponent(batch.geofenceId || batch.geofenceRef?.id || "")}&wardPcode=${encodeURIComponent(wardPcode)}`}
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
                          <Link
                            to={`/operations/md-bgo-rows?batchId=${encodeURIComponent(batch.id)}&wardPcode=${encodeURIComponent(wardPcode)}&lmPcode=${encodeURIComponent(lmPcode)}`}
                            style={styles.rowLinkButton}
                          >
                            BGO Rows
                          </Link>
                        </Td>

                        <Td>
                          {isAllocated ? (
                            <Link
                              to={`/operations/bgo/allocation?batchId=${encodeURIComponent(batch.id)}`}
                              style={styles.unallocateButton}
                              title="View or modify allocation on Allocation Board"
                            >
                              Unallocate
                            </Link>
                          ) : (
                            <Link
                              to={`/operations/bgo/allocation?batchId=${encodeURIComponent(batch.id)}`}
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
                          <strong style={styles.totalCell}>{formatNumber(totalErfs)}</strong>
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
                            onClick={() => setDeleteCandidate(batch)}
                            title={canDelete ? "Delete this unaccepted BGO batch" : "Cannot delete active or in-progress batch"}
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
    marginTop: 12,
    marginBottom: 12,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
    textAlign: "left",
  },
  th: {
    padding: "12px 10px",
    borderBottom: "1px solid #cbd5e1",
    color: "#475569",
    fontWeight: 800,
    whiteSpace: "nowrap",
  },
  td: {
    padding: "12px 10px",
    borderBottom: "1px solid #f1f5f9",
    verticalAlign: "middle",
  },
  sortHeaderButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    border: 0,
    background: "transparent",
    color: "inherit",
    font: "inherit",
    fontWeight: 800,
    cursor: "pointer",
    padding: 0,
  },
  sortIndicator: {
    color: "#2563eb",
  },
  filterHeaderCell: {
    padding: "6px 10px 12px",
    borderBottom: "1px solid #e2e8f0",
  },
  columnFilterInput: {
    width: "100%",
    minWidth: 80,
    boxSizing: "border-box",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    padding: "6px 8px",
    fontSize: 12,
    background: "#ffffff",
    color: "#0f172a",
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
  totalCell: {
    fontWeight: 800,
    color: "#0f172a",
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
  paginationBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "10px 0",
    flexWrap: "wrap",
  },
  paginationSummary: {
    color: "#64748b",
    fontSize: 13,
  },
  paginationControls: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  pageSizeLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: "#475569",
    fontSize: 12,
    marginRight: 8,
  },
  pageSizeSelect: {
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    padding: "4px 8px",
    fontSize: 12,
    background: "#ffffff",
  },
  paginationButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    background: "#ffffff",
    color: "#334155",
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  pageIndicator: {
    color: "#0f172a",
    fontSize: 12,
    fontWeight: 700,
    padding: "0 4px",
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
};
