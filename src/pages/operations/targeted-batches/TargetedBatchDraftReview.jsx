/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useMemo, useState } from "react";

import {
  getTargetedBatchDraftIntegrity,
  getTargetedBatchDraftView,
  TARGETED_BATCH_DRAFT_STATUSES,
  TARGETED_BATCH_SOURCE_TYPES,
} from "../../../redux/targetedBatchDraftModel";
import { formatDateTime } from "./targetedBatchUtils";
import TargetedBatchDraftFilters, {
  EMPTY_DRAFT_FILTERS,
} from "./draft/TargetedBatchDraftFilters";
import TargetedBatchDraftSummary from "./draft/TargetedBatchDraftSummary";
import TargetedBatchDraftTable from "./draft/TargetedBatchDraftTable";
import { draftReviewStyles as styles } from "./draft/targetedBatchDraftReviewStyles";

const DEFAULT_PAGE_SIZE = 25;

function SourceBadge({ sourceType }) {
  const salesSource =
    sourceType === TARGETED_BATCH_SOURCE_TYPES.PREPAID_SALES;

  return (
    <span
      style={{
        ...styles.sourceBadge,
        ...(salesSource ? styles.salesBadge : styles.uploadBadge),
      }}
    >
      {salesSource ? "Prepaid Sales" : "CSV Upload"}
    </span>
  );
}

function normalizeSearchText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function rowMatchesSearch(row, searchText) {
  const query = normalizeSearchText(searchText);
  if (!query) return true;

  return [
    row?.salesAllMeterId,
    row?.sourceSalesAllMeterId,
    row?.meterNo,
    row?.meterNoNormalized,
    row?.accountNumber,
    row?.customerName,
    row?.addressLine1,
    row?.town,
    row?.standNumber,
    row?.actionReason,
  ].some((value) => normalizeSearchText(value).includes(query));
}

function buildOptions(rows, key, fallback) {
  return Array.from(
    new Set(
      rows
        .map((row) => String(row?.[key] || fallback).trim().toUpperCase())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

export default function TargetedBatchDraftReview({
  draft,
  onClear,
  onDownload,
  onConfirm,
  onReopen,
}) {
  const [filters, setFilters] = useState(EMPTY_DRAFT_FILTERS);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const currentDraft = useMemo(
    () => getTargetedBatchDraftView(draft),
    [draft],
  );
  const rows = currentDraft?.displayRows || [];
  const integrity = useMemo(
    () => getTargetedBatchDraftIntegrity(currentDraft),
    [currentDraft],
  );

  const summary = useMemo(() => {
    return rows.reduce(
      (result, row) => {
        const matchStatus = String(
          row?.astMatchStatus || "NOT_CHECKED",
        ).toUpperCase();

        if (matchStatus === "MATCHED") result.astMatched += 1;
        else if (matchStatus === "NOT_MATCHED") result.astNotMatched += 1;
        else result.astNotChecked += 1;

        result.totalSalesC += Number(row?.totalSalesC || 0);
        return result;
      },
      {
        astMatched: 0,
        astNotMatched: 0,
        astNotChecked: 0,
        totalSalesC: 0,
      },
    );
  }, [rows]);

  const astOptions = useMemo(
    () => buildOptions(rows, "astMatchStatus", "NOT_CHECKED"),
    [rows],
  );
  const trnOptions = useMemo(
    () => buildOptions(rows, "proposedTrnType", "NOT_SET"),
    [rows],
  );

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const astStatus = String(
        row?.astMatchStatus || "NOT_CHECKED",
      ).toUpperCase();
      const proposedTrnType = String(
        row?.proposedTrnType || "NOT_SET",
      ).toUpperCase();

      return (
        rowMatchesSearch(row, filters.searchText) &&
        (filters.astMatchStatus === "ALL" ||
          astStatus === filters.astMatchStatus) &&
        (filters.proposedTrnType === "ALL" ||
          proposedTrnType === filters.proposedTrnType)
      );
    });
  }, [rows, filters]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safeCurrentPage = Math.max(1, Math.min(currentPage, totalPages));
  const pageStartIndex = (safeCurrentPage - 1) * pageSize;
  const paginatedRows = filteredRows.slice(
    pageStartIndex,
    pageStartIndex + pageSize,
  );

  const readyForBackend =
    currentDraft?.status ===
    TARGETED_BATCH_DRAFT_STATUSES.READY_FOR_BACKEND;

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    setCurrentPage(1);
  }

  function clearFilters() {
    setFilters(EMPTY_DRAFT_FILTERS);
    setCurrentPage(1);
  }

  function changePage(nextPage) {
    const page = Number(nextPage);
    setCurrentPage(
      Math.max(1, Math.min(Number.isFinite(page) ? page : 1, totalPages)),
    );
  }

  function changePageSize(nextPageSize) {
    const size = Number(nextPageSize);
    setPageSize(Number.isFinite(size) && size > 0 ? size : DEFAULT_PAGE_SIZE);
    setCurrentPage(1);
  }

  if (!currentDraft) return null;

  return (
    <section style={styles.panel}>
      <div style={styles.header}>
        <div>
          <div style={styles.titleRow}>
            <p style={styles.eyebrow}>Targeted Batch Draft Review</p>
            <SourceBadge sourceType={currentDraft.source.type} />
          </div>
          <h2 style={styles.title}>{currentDraft.id}</h2>
          <p style={styles.subtitle}>
            {currentDraft.scope.lmPcode || "NAv"} ·{" "}
            {currentDraft.scope.lmName || "NAv"} · Created{" "}
            {formatDateTime(currentDraft.createdAt)}
          </p>
        </div>

        <div style={styles.headerActions}>
          <span
            style={{
              ...styles.statusBadge,
              ...(readyForBackend ? styles.readyStatus : styles.draftStatus),
            }}
          >
            {readyForBackend ? "Ready for Backend" : "Draft"}
          </span>
          <button type="button" style={styles.secondaryButton} onClick={onDownload}>
            Download Draft
          </button>
          <button type="button" style={styles.dangerButton} onClick={onClear}>
            Clear Draft
          </button>
        </div>
      </div>

      <TargetedBatchDraftSummary
        draft={currentDraft}
        totalRows={rows.length}
        summary={summary}
        integrity={integrity}
      />

      <TargetedBatchDraftFilters
        filters={filters}
        totalRows={rows.length}
        filteredRows={filteredRows.length}
        astOptions={astOptions}
        trnOptions={trnOptions}
        onChange={updateFilter}
        onClear={clearFilters}
      />

      <TargetedBatchDraftTable
        rows={paginatedRows}
        totalRows={filteredRows.length}
        currentPage={safeCurrentPage}
        pageSize={pageSize}
        totalPages={totalPages}
        onPageChange={changePage}
        onPageSizeChange={changePageSize}
      />

      <div style={styles.confirmPanel}>
        <div>
          <strong>
            {readyForBackend
              ? "Draft confirmed for the future backend creation step"
              : integrity.canConfirm
                ? "Review complete: the frontend draft can be confirmed"
                : "Resolve the draft blockers before confirmation"}
          </strong>
          <p style={styles.confirmText}>
            Confirmation changes Redux draft state only. Package 2 performs no
            Firestore write and does not create a Targeted Batch, TB rows, TRNs,
            premises, meters or allocations.
          </p>
        </div>

        {readyForBackend ? (
          <button type="button" style={styles.secondaryButton} onClick={onReopen}>
            Reopen Draft
          </button>
        ) : (
          <button
            type="button"
            style={{
              ...styles.primaryButton,
              ...(!integrity.canConfirm ? styles.disabledButton : null),
            }}
            onClick={onConfirm}
            disabled={!integrity.canConfirm}
          >
            Confirm Draft
          </button>
        )}
      </div>
    </section>
  );
}
