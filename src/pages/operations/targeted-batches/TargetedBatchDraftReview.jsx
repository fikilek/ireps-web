/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useMemo, useState } from "react";

import {
  getTargetedBatchDraftIntegrity,
  getTargetedBatchDraftView,
  TARGETED_BATCH_PLANNING_MODES,
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
    row?.sgCode,
    row?.erfNo,
    row?.wardPcode,
    row?.wardNumber,
    row?.proposedTbId,
    row?.actionReason,
    row?.rowDecision,
    row?.rowDecisionReason,
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
  isCreating = false,
  creationFeedback = null,
  onConfirm,
  onClear,
  onDownload,
}) {
  const [filters, setFilters] = useState(EMPTY_DRAFT_FILTERS);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const currentDraft = useMemo(
    () => getTargetedBatchDraftView(draft),
    [draft],
  );
  const rows = currentDraft?.displayRows || [];
  const csvSource =
    currentDraft?.source?.type === TARGETED_BATCH_SOURCE_TYPES.CSV_UPLOAD;
  const salesSource =
    currentDraft?.source?.type === TARGETED_BATCH_SOURCE_TYPES.PREPAID_SALES;
  const ngpSalesSource =
    salesSource &&
    currentDraft?.selection?.planningMode ===
      TARGETED_BATCH_PLANNING_MODES.NON_GPS_STREET;
  const proposedBatchCount = Array.isArray(currentDraft?.proposedBatches)
    ? currentDraft.proposedBatches.length
    : 0;
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
        const rowDecision = String(row?.rowDecision || "").toUpperCase();

        if (matchStatus === "MATCHED") result.astMatched += 1;
        else if (matchStatus === "NOT_MATCHED") result.astNotMatched += 1;
        else result.astNotChecked += 1;

        if (rowDecision === "ACCEPT") result.acceptedRows += 1;
        if (rowDecision === "REJECT") result.rejectedRows += 1;

        result.totalSalesC += Number(row?.totalSalesC || 0);
        return result;
      },
      {
        astMatched: 0,
        astNotMatched: 0,
        astNotChecked: 0,
        acceptedRows: 0,
        rejectedRows: 0,
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
      const rowDecision = String(row?.rowDecision || "NOT_SET").toUpperCase();

      return (
        rowMatchesSearch(row, filters.searchText) &&
        (!csvSource ||
          filters.rowDecision === "ALL" ||
          rowDecision === filters.rowDecision) &&
        (filters.astMatchStatus === "ALL" ||
          astStatus === filters.astMatchStatus) &&
        (filters.proposedTrnType === "ALL" ||
          proposedTrnType === filters.proposedTrnType)
      );
    });
  }, [rows, filters, csvSource]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safeCurrentPage = Math.max(1, Math.min(currentPage, totalPages));
  const pageStartIndex = (safeCurrentPage - 1) * pageSize;
  const paginatedRows = filteredRows.slice(
    pageStartIndex,
    pageStartIndex + pageSize,
  );

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
            <p style={styles.eyebrow}>TB Draft</p>
            <SourceBadge sourceType={currentDraft.source.type} />
          </div>
          <h2 style={styles.title}>
            {salesSource
              ? currentDraft?.creationGroup?.id || currentDraft.id
              : currentDraft.id}
          </h2>
          <p style={styles.subtitle}>
            {currentDraft.scope.lmPcode || "NAv"} ·{" "}
            {currentDraft.scope.lmName || "NAv"} · Created{" "}
            {formatDateTime(currentDraft.createdAt)}
          </p>
        </div>

        <div style={styles.headerActions}>
          <span style={{ ...styles.statusBadge, ...styles.draftStatus }}>
            Draft
          </span>
          <button type="button" style={styles.secondaryButton} onClick={onDownload}>
            Download Draft
          </button>
          <button
            type="button"
            style={{
              ...styles.dangerButton,
              ...(isCreating ? styles.disabledButton : null),
            }}
            onClick={onClear}
            disabled={isCreating}
          >
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
        showRowDecision={csvSource}
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
        showRowDecision={csvSource}
        showBatchGrouping={salesSource}
        onPageChange={changePage}
        onPageSizeChange={changePageSize}
      />

      <div style={styles.confirmPanel}>
        <div>
          <strong>
            {isCreating
              ? ngpSalesSource
                ? "Creating and verifying the permanent Targeted Batch"
                : "Creating and verifying the permanent Targeted Batches"
              : integrity.canConfirm
                ? ngpSalesSource
                  ? "Review complete: the NGP TB Draft is ready for permanent creation"
                  : "Review complete: the ward-compliant TB Draft is ready for permanent creation"
                : "Resolve the draft blockers before confirmation"}
          </strong>
          <p style={styles.confirmText}>
            {salesSource
              ? ngpSalesSource
                ? `Confirmation submits one NGP Targeted Batch containing ${rows.length} selected meter${
                    rows.length === 1 ? "" : "s"
                  }. The backend re-reads the authoritative Sales records, verifies that every target is still eligible for NGP batching, and creates the permanent tb_uploads parent, tb_rows and Sales tbRefs.`
                : `Confirmation submits ${proposedBatchCount} ward-compliant proposed batch${
                    proposedBatchCount === 1 ? "" : "es"
                  }. The backend re-reads Sales and ERF data, confirms the exact ward grouping, and creates one permanent tb_uploads parent per ward with its corresponding tb_rows and Sales tbRefs.`
              : "Confirmation creates the permanent Targeted Batch documents allowed by the accepted CSV workflow."}
            {" "}The temporary TB Draft is cleared only after the backend verifies every created Targeted Batch as READY.
          </p>

          {creationFeedback?.type === "error" ? (
            <div
              role="alert"
              style={{
                marginTop: 12,
                padding: "10px 12px",
                border: "1px solid #fecaca",
                borderRadius: 12,
                background: "#fef2f2",
                color: "#991b1b",
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              <strong>{creationFeedback.code}</strong>
              <div>{creationFeedback.message}</div>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          style={{
            ...styles.primaryButton,
            ...(!integrity.canConfirm || isCreating
              ? styles.disabledButton
              : null),
          }}
          disabled={!integrity.canConfirm || isCreating}
          onClick={onConfirm}
          title={
            integrity.canConfirm
              ? `Create and verify ${proposedBatchCount || 1} permanent Targeted Batch${
                  proposedBatchCount === 1 ? "" : "es"
                }`
              : integrity.blockers.join(" ")
          }
        >
          {isCreating
            ? "Creating Targeted Batches..."
            : salesSource && proposedBatchCount > 1
              ? `Create ${proposedBatchCount} Targeted Batches`
              : "Create Targeted Batch"}
        </button>
      </div>
    </section>
  );
}
