/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSelector } from "react-redux";

import { getTargetedBatchDraftView } from "../../redux/targetedBatchDraftModel";
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

const DEFAULT_PAGE_SIZE = 25;

function InfoItem({ label, value }) {
  return (
    <div style={styles.infoItem}>
      <span style={styles.infoLabel}>{label}</span>
      <strong style={styles.infoValue}>{value || "NAv"}</strong>
    </div>
  );
}

function BatchStatusBadge({ status }) {
  const ready = status === "READY_FOR_BACKEND";
  return (
    <span
      style={{
        ...styles.badge,
        background: ready ? "#dcfce7" : "#fef3c7",
        color: ready ? "#166534" : "#92400e",
      }}
    >
      {status || "DRAFT"}
    </span>
  );
}

export default function TargetedBatchDetailsPage() {
  const { tbId } = useParams();
  const storedDraft = useSelector(
    (state) => state.targetedBatchDraft?.draft || null,
  );
  const draft = useMemo(
    () => getTargetedBatchDraftView(storedDraft),
    [storedDraft],
  );
  const [filters, setFilters] = useState({ ...TB_ROW_FILTER_DEFAULTS });
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState(1);

  const decodedTbId = decodeURIComponent(tbId || "");
  const draftMatchesRoute = draft?.id === decodedTbId;
  const rows = useMemo(
    () => (draftMatchesRoute ? buildTargetedBatchRows(draft) : []),
    [draft, draftMatchesRoute],
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

  if (!draftMatchesRoute) {
    return (
      <section style={styles.page}>
        <div style={styles.topActionRow}>
          <Link to="/operations/targeted-batches" style={styles.backLink}>
            ← Back to TB Uploads
          </Link>
        </div>
        <div style={styles.errorNotice}>
          <strong>TB rows are not available</strong>
          <p style={styles.noticeText}>
            The requested TB ID is not present in the current Redux draft. This
            frontend stage does not yet reload permanent tb_uploads and tb_rows
            documents after a browser refresh.
          </p>
        </div>
      </section>
    );
  }

  const encodedId = encodeURIComponent(draft.id);

  return (
    <section style={styles.page}>
      <div style={styles.topActionRow}>
        <Link to="/operations/targeted-batches" style={styles.backLink}>
          ← Back to TB Uploads
        </Link>
        <Link
          to={`/operations/targeted-batches/${encodedId}/dashboard`}
          style={styles.actionLink}
        >
          TB Dashboard
        </Link>
        <Link
          to={`/operations/targeted-batches/${encodedId}/final-report`}
          style={styles.actionLink}
        >
          Final Report
        </Link>
        <Link
          to={`/operations/targeted-batches/${encodedId}/allocation`}
          style={styles.allocationLink}
        >
          TB Allocation
        </Link>
      </div>

      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Operations / Targeted Batch / TB Rows</p>
          <h2 style={styles.title}>{draft.id}</h2>
          <p style={styles.subtitle}>
            Source-neutral candidate register showing exact row outcomes and
            row-level allocation, premise, Meter Discovery and completion
            references only.
          </p>
        </div>
        <BatchStatusBadge status={draft.status} />
      </div>

      <div style={styles.infoPanel}>
        <div style={styles.infoGrid}>
          <InfoItem label="Source" value={draft.source?.label} />
          <InfoItem
            label="LM"
            value={`${draft.scope?.lmPcode || "NAv"} · ${draft.scope?.lmName || "NAv"}`}
          />
          <InfoItem label="Created" value={formatDateTime(draft.createdAt)} />
          <InfoItem
            label="File / Source"
            value={draft.source?.fileName || "Prepaid Sales selection"}
          />
          <InfoItem
            label="File Decision"
            value={draft.validation?.fileDecision || "NAv"}
          />
          <InfoItem
            label="Frontend Validation"
            value={draft.validation?.passed ? "PASSED" : "FAILED"}
          />
          <InfoItem
            label="Total Rows"
            value={formatNumber(summary.total)}
          />
          <InfoItem
            label="Selection Reason"
            value={draft.selection?.reason || "NAv"}
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
              {" "}rows match the current filters. REJECT rows remain visible for
              audit and are not allocatable.
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
                downloadTargetedBatchRows({ batch: draft, rows: filteredRows })
              }
              disabled={filteredRows.length === 0}
            >
              Download Filtered CSV
            </button>
          </div>
        </div>

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
      </div>
    </section>
  );
}
