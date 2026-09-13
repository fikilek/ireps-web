import { useAuth } from "../../auth/useAuth";
import { useGetPermanentSalesBatchesQuery } from "../../redux/salesTargetedBatchApi";
/* eslint-disable no-unused-vars -- JSX component tags are consumed by the JSX transform. */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
  downloadTargetedBatchRows,
  formatDateTime,
  formatNumber,
} from "./targeted-batches/targetedBatchUtils";
import TargetedBatchRowsFilters from "./targeted-batches/rows/TargetedBatchRowsFilters";
import TargetedBatchRowsSummary from "./targeted-batches/rows/TargetedBatchRowsSummary";
import TargetedBatchRowsTable from "./targeted-batches/rows/TargetedBatchRowsTable";
import {
  buildTargetedBatchRowFilterOptions,
  buildTargetedBatchRows,
  buildTargetedBatchRowsSummary,
  filterTargetedBatchRows,
  TB_ROW_FILTER_DEFAULTS,
} from "./targeted-batches/rows/targetedBatchRowsModel";
import { tbRowsStyles as styles } from "./targeted-batches/rows/targetedBatchRowsStyles";

const DEFAULT_PAGE_SIZE = 5;

function timestampToIso(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (typeof value?.seconds === "number") {
    return new Date(value.seconds * 1000).toISOString();
  }
  return null;
}

function InfoItem({ label, value }) {
  return (
    <div style={styles.infoItem}>
      <span style={styles.infoLabel}>{label}</span>
      <strong style={styles.infoValue}>{value || "NAv"}</strong>
    </div>
  );
}

function BatchStatusBadge({ status }) {
  const readyStatuses = [
    "READY_FOR_ALLOCATION",
    "PARTIALLY_ALLOCATED",
    "ALLOCATED",
    "IN_PROGRESS",
    "COMPLETED",
  ];
  const ready = readyStatuses.includes(status);

  return (
    <span
      style={{
        ...styles.badge,
        background: ready ? "#dcfce7" : "#fef3c7",
        color: ready ? "#166534" : "#92400e",
      }}
    >
      {status || "NAv"}
    </span>
  );
}

export default function TargetedBatchDetailsPage() {
  const { tbId } = useParams();
  const decodedTbId = decodeURIComponent(tbId || "");

  const { activeWorkbase } = useAuth();
  const lmPcode = activeWorkbase?.lmPcode || activeWorkbase?.pcode || activeWorkbase?.id || activeWorkbase?.localMunicipalityId;
  const { data: permanent } = useGetPermanentSalesBatchesQuery({ lmPcode, tbId: decodedTbId }, { skip: !lmPcode || !decodedTbId });
  const batch = permanent?.batch || null, permanentRows = permanent?.rows;
  const isLoading = !permanent?.ready && !permanent?.error, loadError = permanent?.error || "";
  const [filters, setFilters] = useState({ ...TB_ROW_FILTER_DEFAULTS });
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState(1);

  const rows = useMemo(
    () =>
      batch
        ? buildTargetedBatchRows({
            ...batch,
            rows: permanentRows || [],
          })
        : [],
    [batch, permanentRows],
  );
  const summary = useMemo(() => buildTargetedBatchRowsSummary(rows), [rows]);
  const filterOptions = useMemo(
    () => buildTargetedBatchRowFilterOptions(rows),
    [rows],
  );
  const filteredRows = useMemo(
    () => filterTargetedBatchRows(rows, filters),
    [rows, filters],
  );
  const totalPages = Math.max(Math.ceil(filteredRows.length / pageSize), 1);
  const safePage = Math.min(Math.max(currentPage, 1), totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pagedRows = filteredRows.slice(pageStart, pageStart + pageSize);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    setCurrentPage(1);
  }

  function resetFilters() {
    setFilters({ ...TB_ROW_FILTER_DEFAULTS });
    setCurrentPage(1);
  }

  if (isLoading) {
    return (
      <section style={styles.page}>
        <div style={styles.topActionRow}>
          <Link to="/operations/targeted-batches" style={styles.backLink}>
            ← Back to TB Register
          </Link>
        </div>
        <div style={styles.infoPanel}>
          Loading permanent Targeted Batch and TB Rows...
        </div>
      </section>
    );
  }

  if (loadError || !batch) {
    return (
      <section style={styles.page}>
        <div style={styles.topActionRow}>
          <Link to="/operations/targeted-batches" style={styles.backLink}>
            ← Back to TB Register
          </Link>
        </div>
        <div style={styles.errorNotice}>
          <strong>TB rows are not available</strong>
          <p style={styles.noticeText}>
            {loadError || "The permanent Targeted Batch could not be loaded."}
          </p>
        </div>
      </section>
    );
  }

  const encodedId = encodeURIComponent(batch.id);
  const allocationStatus = String(batch?.allocation?.status || "")
    .trim()
    .toUpperCase();
  const batchStatus = String(batch?.status || "")
    .trim()
    .toUpperCase();
  const isPermanentlyAllocated =
    allocationStatus === "ALLOCATED" || batchStatus === "ALLOCATED";

  return (
    <section style={styles.page}>
      <div style={styles.topActionRow}>
        <Link to="/operations/targeted-batches" style={styles.backLink}>
          ← Back to TB Register
        </Link>
        <Link
          to={`/operations/targeted-batches/${encodedId}/final-report`}
          style={styles.actionLink}
        >
          Final Report
        </Link>
        {isPermanentlyAllocated ? (
          <span
            style={{
              ...styles.allocationLink,
              opacity: 0.62,
              cursor: "not-allowed",
            }}
            role="link"
            aria-disabled="true"
            tabIndex={0}
            title="Allocation prohibited: this Targeted Batch is already allocated."
          >
            Allocated
          </span>
        ) : (
          <Link
            to={`/operations/targeted-batches/${encodedId}/allocation`}
            style={styles.allocationLink}
          >
            TB Allocation
          </Link>
        )}
      </div>

      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Operations / Targeted Batch / TB Rows</p>
          <h2 style={styles.title}>{batch.id}</h2>
          <p style={styles.subtitle}>
            Permanent TB Rows loaded from Firestore for this Targeted Batch.
          </p>
        </div>
        <BatchStatusBadge status={batch.status} />
      </div>

      <div style={styles.infoPanel}>
        <div style={styles.infoGrid}>
          <InfoItem label="Source" value={batch.source?.label} />
          <InfoItem
            label="LM"
            value={`${batch.scope?.lmPcode || "NAv"} · ${batch.scope?.lmName || "NAv"}`}
          />
          <InfoItem label="Created" value={formatDateTime(batch.createdAt)} />
          <InfoItem
            label="File / Source"
            value={batch.source?.fileName || "Prepaid Sales selection"}
          />
          <InfoItem
            label="Validation"
            value={batch.validation?.status || "NAv"}
          />
          <InfoItem
            label="Creation State"
            value={batch.creation?.state || "NAv"}
          />
          <InfoItem
            label="Total Rows"
            value={formatNumber(summary.total)}
          />
          <InfoItem
            label="Selection Reason"
            value={batch.selection?.reason || "NAv"}
          />
        </div>
      </div>

      <TargetedBatchRowsSummary summary={summary} />

      <div style={styles.panel}>
        <div style={styles.panelHeader}>
          <div>
            <h3 style={styles.panelTitle}>TB Rows</h3>
            <p style={styles.panelSubtitle}>
              {formatNumber(filteredRows.length)} of {formatNumber(rows.length)}
              {" "}permanent rows match the current filters.
            </p>
          </div>
          <div style={styles.panelActions}>
            <button
              type="button"
              style={styles.secondaryButton}
              onClick={resetFilters}
            >
              Clear Filters
            </button>
            <button
              type="button"
              style={styles.primaryButton}
              onClick={() =>
                downloadTargetedBatchRows({ batch, rows: filteredRows })
              }
              disabled={filteredRows.length === 0}
            >
              Download Filtered CSV
            </button>
          </div>
        </div>

        {rows.length === 0 ? (
          <div style={styles.errorNotice}>
            No permanent TB rows were found for this batch.
          </div>
        ) : (
          <>
            <TargetedBatchRowsFilters
              filters={filters}
              options={filterOptions}
              onChange={updateFilter}
            />

            <TargetedBatchRowsTable
              rows={pagedRows}
              totalRows={filteredRows.length}
              currentPage={safePage}
              pageSize={pageSize}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
              onPageSizeChange={(nextPageSize) => {
                setPageSize(nextPageSize);
                setCurrentPage(1);
              }}
            />
          </>
        )}
      </div>
    </section>
  );
}
