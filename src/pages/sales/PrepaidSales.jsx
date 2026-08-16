/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useDispatch } from "react-redux";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGetDemoSalesByLmPcodeQuery } from "../../redux/demoSalesApi";
import { prepareTargetedBatchDraft } from "../../redux/targetedBatchDraftSlice";
import { quickDownloadExcel } from "../../utils/downloads/quickDownloadExcel";
import SalesMetersTable from "./components/SalesMetersTable";
import {
  SALES_GPS_FILTERS as GPS_FILTERS,
  hasUsableSalesGps,
  matchesSalesGpsFilter,
} from "./models/salesGpsModel";
import { buildSalesTargetedBatchDraftPlan } from "../operations/targeted-batches/targetedBatchUtils";
import {
  buildMonthKeys,
  formatNumber,
  getActiveLmPcode,
  getActiveWorkbaseName,
  getMonthLabel,
} from "./salesUtils";

function SalesLoadingState() {
  return (
    <section style={styles.loadingPanel} aria-live="polite" aria-busy="true">
      <style>
        {`
          @keyframes irepsSalesSpinner {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>

      <div style={styles.loadingSpinner} aria-hidden="true" />

      <div>
        <h2 style={styles.loadingTitle}>Loading prepaid sales...</h2>
        <p style={styles.loadingText}>
          Connecting to the live Sales stream and preparing meter records.
        </p>
      </div>
    </section>
  );
}

function SummaryCard({ label, value, subtitle, active, onClick }) {
  const interactive = typeof onClick === "function";

  return (
    <button
      type="button"
      style={{
        ...styles.summaryCard,
        ...(interactive ? styles.summaryCardInteractive : null),
        ...(active ? styles.summaryCardActive : null),
      }}
      onClick={onClick}
      disabled={!interactive}
    >
      <span style={styles.summaryLabel}>{label}</span>
      <strong style={styles.summaryValue}>{value}</strong>
      {subtitle ? <span style={styles.summarySubtitle}>{subtitle}</span> : null}
    </button>
  );
}

function TargetBatchModal({
  selectedCount,
  scopeError,
  onClose,
  onDownload,
  onOpenTargetedBatch,
}) {
  return (
    <div
      style={styles.modalOverlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div style={styles.modalCard} role="dialog" aria-modal="true">
        <div style={styles.modalHeader}>
          <div>
            <p style={styles.modalEyebrow}>Targeted Field Work</p>
            <h2 style={styles.modalTitle}>Create Target Batch</h2>
          </div>

          <button
            type="button"
            style={styles.modalCloseButton}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div style={styles.modalBody}>
          <div style={styles.modalCountBox}>
            <span>Selected meters</span>
            <strong>{formatNumber(selectedCount)}</strong>
          </div>

          {scopeError ? (
            <div style={styles.modalErrorBox} role="alert">
              {scopeError}
            </div>
          ) : null}

          <p style={styles.modalText}>
            iREPS will apply the Targeted Batch rules locally, resolve the ward
            carried by each selected Sales row, and prepare one proposed batch
            per ward. The selection is preserved across all filtered pages.
          </p>

          <p style={styles.modalText}>
            TB Draft opens only when every selected meter can be placed into a
            ward-compliant proposed batch. The backend confirms and enforces the
            same plan when permanent batches are created.
          </p>
        </div>

        <div style={styles.modalFooter}>
          <button
            type="button"
            style={styles.secondaryButton}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            style={styles.secondaryButton}
            onClick={onDownload}
          >
            Download Selected
          </button>
          <button
            type="button"
            style={styles.primaryButton}
            onClick={onOpenTargetedBatch}
          >
            Review Targeted Batch
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PrepaidSales() {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const { activeWorkbase, role } = useAuth();
  const activeLmPcode = getActiveLmPcode(activeWorkbase);
  const activeWorkbaseName = getActiveWorkbaseName(activeWorkbase);

  const dashboardMapContext = useMemo(() => {
    const params = new URLSearchParams(location.search);

    return {
      tbId: String(params.get("tbId") || "").trim(),
      openMap:
        String(params.get("view") || "")
          .trim()
          .toLowerCase() === "map",
    };
  }, [location.search]);

  const [gpsFilter, setGpsFilter] = useState(GPS_FILTERS.ALL);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isTargetBatchModalOpen, setIsTargetBatchModalOpen] = useState(false);
  const [targetBatchScopeError, setTargetBatchScopeError] = useState("");

  const {
    data: salesRows = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useGetDemoSalesByLmPcodeQuery(activeLmPcode || skipToken);

  useEffect(() => {
    setGpsFilter(GPS_FILTERS.ALL);
    setSelectedIds(new Set());
    setIsTargetBatchModalOpen(false);
    setTargetBatchScopeError("");
  }, [activeLmPcode]);

  const monthKeys = useMemo(() => buildMonthKeys(salesRows), [salesRows]);
  const latestMonthKey = monthKeys[0] || "2026-02";
  const earliestMonthKey = monthKeys[monthKeys.length - 1] || "2023-12";

  const gpsSummary = useMemo(() => {
    return salesRows.reduce(
      (accumulator, row) => {
        accumulator.totalMeters += 1;

        if (hasUsableSalesGps(row)) accumulator.withGps += 1;
        else accumulator.withoutGps += 1;

        return accumulator;
      },
      {
        totalMeters: 0,
        withGps: 0,
        withoutGps: 0,
      },
    );
  }, [salesRows]);

  const gpsFilteredRows = useMemo(
    () => salesRows.filter((row) => matchesSalesGpsFilter(row, gpsFilter)),
    [gpsFilter, salesRows],
  );

  const selectedRows = useMemo(() => {
    if (selectedIds.size === 0) return [];
    return gpsFilteredRows.filter((row) => selectedIds.has(row.id));
  }, [gpsFilteredRows, selectedIds]);

  const selectedDownloadColumns = useMemo(() => {
    return [
      { header: "Meter Number", value: (row) => row.meterNo || "NAv" },
      { header: "Address", value: (row) => row.addressLine1 || "NAv" },
      { header: "Town", value: (row) => row.town || "NAv" },
      { header: "SG Code", value: (row) => row.sgCode || "NAv" },
      { header: "Erf No", value: (row) => row.erfNo || "NAv" },
      {
        header: "Total Sales (R)",
        value: (row) => Number(row.totalSalesC || 0) / 100,
      },
      ...monthKeys.map((monthKey) => ({
        header: `${getMonthLabel(monthKey)} (R)`,
        value: (row) => Number(row?.monthlySalesC?.[monthKey] || 0) / 100,
      })),
    ];
  }, [monthKeys]);

  function setGpsStatusFilter(nextGpsFilter) {
    if (nextGpsFilter === gpsFilter) return;

    setGpsFilter(nextGpsFilter);
    setSelectedIds(new Set());
    setIsTargetBatchModalOpen(false);
    setTargetBatchScopeError("");
  }

  function handleOpenTargetedBatch() {
    setTargetBatchScopeError("");

    if (!activeLmPcode) {
      setTargetBatchScopeError(
        "Targeted Batch creation is blocked because there is no active Local Municipality workbase.",
      );
      return;
    }

    if (selectedRows.length === 0) {
      setTargetBatchScopeError(
        "Targeted Batch creation is blocked because no Sales meters are selected.",
      );
      return;
    }

    const selectedRowsWithoutGps = selectedRows.filter(
      (row) => !hasUsableSalesGps(row),
    );

    if (selectedRowsWithoutGps.length > 0) {
      setTargetBatchScopeError(
        `Targeted Batch creation is blocked because ${formatNumber(
          selectedRowsWithoutGps.length,
        )} selected meter${
          selectedRowsWithoutGps.length === 1 ? " does" : "s do"
        } not have usable GPS coordinates. Select the WITH GPS card before preparing a batch.`,
      );
      return;
    }

    const mismatchedRows = selectedRows.filter(
      (row) => String(row?.lmPcode || "").trim() !== activeLmPcode,
    );

    if (mismatchedRows.length > 0) {
      setTargetBatchScopeError(
        `Targeted Batch creation is blocked because ${formatNumber(
          mismatchedRows.length,
        )} selected meter${
          mismatchedRows.length === 1 ? "" : "s"
        } do not belong to the active LM ${activeLmPcode}. Clear the selection and reload Sales.`,
      );
      return;
    }

    const selectionReason = "Selected from Prepaid Sales filters";

    const draftPlan = buildSalesTargetedBatchDraftPlan({
      rows: selectedRows,
      selectionReason,
      lmPcode: activeLmPcode,
      lmName: activeWorkbaseName,
    });

    if (!draftPlan.ok) {
      const failureMessages = (draftPlan.failures || [])
        .slice(0, 5)
        .map((failure) => failure.message)
        .join(" ");
      const remainingFailures = Math.max(
        0,
        Number(draftPlan.failures?.length || 0) - 5,
      );

      setTargetBatchScopeError(
        `${draftPlan.message} ${failureMessages}${
          remainingFailures > 0
            ? ` A further ${formatNumber(remainingFailures)} row(s) also failed.`
            : ""
        }`,
      );
      return;
    }

    dispatch(
      prepareTargetedBatchDraft({
        id: draftPlan.proposedBatches[0]?.tbId,
        creationGroup: draftPlan.creationGroup,
        proposedBatches: draftPlan.proposedBatches,
        source: {
          type: "PREPAID_SALES",
          label: "Prepaid Sales",
          sourceId: null,
          fileName: null,
        },
        scope: {
          lmPcode: activeLmPcode || "",
          lmName: activeWorkbaseName,
        },
        selection: {
          reason: selectionReason,
          salesPeriodFrom: earliestMonthKey,
          salesPeriodTo: latestMonthKey,
        },
        authoritativeIds: {
          salesAllMeterIds: draftPlan.salesAllMeterIds,
          uploadRowIds: [],
        },
        displayRows: draftPlan.displayRows,
        validation: {
          ...draftPlan.validation,
          duplicateRowNos: [],
          duplicateMeterNos: [],
          invalidRowDetails: [],
        },
      }),
    );

    setIsTargetBatchModalOpen(false);
    navigate("/operations/targeted-batches/draft");
  }

  function handleDownloadSelected() {
    if (selectedRows.length === 0) return;

    quickDownloadExcel({
      rows: selectedRows,
      columns: selectedDownloadColumns,
      fileBaseName: "selected_prepaid_sales_meters",
      registryName: "Selected Prepaid Sales Meters",
      scope: {
        lmName: activeWorkbaseName,
        lmPcode: activeLmPcode || "NAv",
        wardLabel: "Targeted Meter Selection",
      },
    });

    setIsTargetBatchModalOpen(false);
  }

  return (
    <div style={styles.page}>
      <section style={styles.hero}>
        <div>
          <div style={styles.heroEyebrowRow}>
            <p style={styles.heroEyebrow}>Sales Table</p>
          </div>

          <h1 style={styles.heroTitle}>
            Meter vending performance and targeted field-work identification
          </h1>

          <p style={styles.heroSubtitle}>
            {activeLmPcode || "NAv"} · {activeWorkbaseName} · Data period:{" "}
            {getMonthLabel(earliestMonthKey)} to {getMonthLabel(latestMonthKey)}
          </p>
        </div>

        <div style={styles.heroActions}>
          <button
            type="button"
            style={styles.ngpButton}
            onClick={() => navigate("/sales/non-gps-batch-planning")}
          >
            Non GPS Batch Planning
          </button>
          <div style={styles.roleBadge}>{role || "NAv"}</div>
          <button
            type="button"
            style={styles.refreshButton}
            onClick={() => refetch()}
            disabled={!activeLmPcode || isFetching}
          >
            {isFetching ? "Refreshing..." : "Refresh Sales"}
          </button>
        </div>
      </section>

      {!activeLmPcode ? (
        <section style={styles.statePanel}>
          <h2>No active workbase</h2>
          <p>
            Activate a Local Municipality workbase before opening Prepaid Sales.
          </p>
        </section>
      ) : null}

      {error ? (
        <section style={{ ...styles.statePanel, ...styles.errorPanel }}>
          <h2>Could not load prepaid sales</h2>
          <p>
            Check Firestore access to sales-all-meters and confirm that the
            records contain lmPcode {activeLmPcode}.
          </p>
        </section>
      ) : null}

      {isLoading ? <SalesLoadingState /> : null}

      {!isLoading && activeLmPcode && !error && salesRows.length === 0 ? (
        <section style={styles.statePanel}>
          <h2>No prepaid sales found</h2>
          <p>No Sales All meters were returned for {activeLmPcode}.</p>
        </section>
      ) : null}

      {salesRows.length > 0 ? (
        <>
          <section style={styles.summaryGrid}>
            <SummaryCard
              label="Total Meters"
              value={formatNumber(gpsSummary.totalMeters)}
              subtitle="Show all sales meters"
              active={gpsFilter === GPS_FILTERS.ALL}
              onClick={() => setGpsStatusFilter(GPS_FILTERS.ALL)}
            />
            <SummaryCard
              label="With GPS"
              value={formatNumber(gpsSummary.withGps)}
              subtitle="Click to filter"
              active={gpsFilter === GPS_FILTERS.WITH_GPS}
              onClick={() => setGpsStatusFilter(GPS_FILTERS.WITH_GPS)}
            />
            <SummaryCard
              label="Without GPS"
              value={formatNumber(gpsSummary.withoutGps)}
              subtitle="Click to filter"
              active={gpsFilter === GPS_FILTERS.WITHOUT_GPS}
              onClick={() => setGpsStatusFilter(GPS_FILTERS.WITHOUT_GPS)}
            />
          </section>

          <SalesMetersTable
            rows={gpsFilteredRows}
            monthKeys={monthKeys}
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            initialTbId={dashboardMapContext.tbId}
            initialShowGpsMap={dashboardMapContext.openMap}
          />

          {selectedRows.length > 0 ? (
            <section style={styles.selectionBar}>
              <div>
                <strong style={styles.selectionCount}>
                  {formatNumber(selectedRows.length)} meters selected
                </strong>
                <span style={styles.selectionHint}>
                  Selection is retained while paging and filtering.
                </span>
              </div>

              <div style={styles.selectionActions}>
                <button
                  type="button"
                  style={styles.secondaryButton}
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear Selection
                </button>
                <button
                  type="button"
                  style={styles.secondaryButton}
                  onClick={handleDownloadSelected}
                >
                  Download Selected
                </button>
                <button
                  type="button"
                  style={styles.primaryButton}
                  onClick={() => {
                    setTargetBatchScopeError("");
                    setIsTargetBatchModalOpen(true);
                  }}
                >
                  Create Target Batch
                </button>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {isTargetBatchModalOpen ? (
        <TargetBatchModal
          selectedCount={selectedRows.length}
          scopeError={targetBatchScopeError}
          onClose={() => {
            setTargetBatchScopeError("");
            setIsTargetBatchModalOpen(false);
          }}
          onDownload={handleDownloadSelected}
          onOpenTargetedBatch={handleOpenTargetedBatch}
        />
      ) : null}
    </div>
  );
}

const styles = {
  page: {
    display: "grid",
    gap: "1rem",
    padding: "1rem 1.25rem 5.5rem",
  },
  hero: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "1rem",
    padding: "1.15rem",
    borderRadius: "1rem",
    background: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)",
    color: "#ffffff",
    boxShadow: "0 16px 32px rgba(15, 23, 42, 0.16)",
    flexWrap: "wrap",
  },
  heroEyebrowRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.55rem",
  },
  heroEyebrow: {
    margin: 0,
    color: "#bfdbfe",
    fontSize: "0.74rem",
    fontWeight: 900,
    letterSpacing: "0.11em",
    textTransform: "uppercase",
  },
  heroTitle: {
    maxWidth: "760px",
    margin: "0.4rem 0 0",
    fontSize: "1.5rem",
    lineHeight: 1.25,
  },
  heroSubtitle: {
    margin: "0.55rem 0 0",
    color: "#cbd5e1",
    fontSize: "0.9rem",
  },
  heroActions: {
    display: "flex",
    alignItems: "center",
    gap: "0.55rem",
    flexWrap: "wrap",
  },
  ngpButton: {
    border: "1px solid rgba(255, 255, 255, 0.32)",
    borderRadius: "0.7rem",
    padding: "0.55rem 0.75rem",
    background: "rgba(255, 255, 255, 0.1)",
    color: "#ffffff",
    fontWeight: 850,
    cursor: "pointer",
  },
  roleBadge: {
    borderRadius: "999px",
    padding: "0.42rem 0.7rem",
    background: "rgba(255, 255, 255, 0.12)",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    fontSize: "0.75rem",
    fontWeight: 900,
  },
  refreshButton: {
    border: "1px solid rgba(255, 255, 255, 0.32)",
    borderRadius: "0.7rem",
    padding: "0.55rem 0.75rem",
    background: "rgba(255, 255, 255, 0.1)",
    color: "#ffffff",
    fontWeight: 850,
    cursor: "pointer",
  },
  loadingPanel: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    marginTop: "1rem",
    padding: "1.4rem 1.5rem",
    border: "1px solid rgba(37, 99, 235, 0.2)",
    borderRadius: "1rem",
    background: "#ffffff",
    boxShadow: "0 12px 28px rgba(15, 23, 42, 0.05)",
  },
  loadingSpinner: {
    width: "2.35rem",
    height: "2.35rem",
    flex: "0 0 auto",
    border: "4px solid #dbeafe",
    borderTopColor: "#2563eb",
    borderRadius: "999px",
    animation: "irepsSalesSpinner 0.8s linear infinite",
  },
  loadingTitle: {
    margin: 0,
    color: "#0f172a",
    fontSize: "1.08rem",
  },
  loadingText: {
    margin: "0.3rem 0 0",
    color: "#64748b",
    fontSize: "0.88rem",
  },
  statePanel: {
    padding: "1.25rem",
    borderRadius: "1rem",
    background: "#ffffff",
    border: "1px solid rgba(148, 163, 184, 0.28)",
    color: "#475569",
  },
  errorPanel: {
    borderColor: "rgba(220, 38, 38, 0.3)",
    background: "#fef2f2",
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: "0.8rem",
  },
  summaryCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    minHeight: "112px",
    padding: "0.95rem",
    borderRadius: "0.95rem",
    border: "1px solid rgba(148, 163, 184, 0.26)",
    background: "#ffffff",
    color: "#0f172a",
    textAlign: "left",
    boxShadow: "0 12px 26px rgba(15, 23, 42, 0.05)",
  },
  summaryCardInteractive: {
    cursor: "pointer",
  },
  summaryCardActive: {
    border: "2px solid #2563eb",
    background: "#eff6ff",
  },
  summaryLabel: {
    color: "#64748b",
    fontSize: "0.78rem",
    fontWeight: 850,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  summaryValue: {
    marginTop: "0.45rem",
    fontSize: "1.55rem",
    lineHeight: 1.1,
  },
  summarySubtitle: {
    marginTop: "auto",
    paddingTop: "0.45rem",
    color: "#64748b",
    fontSize: "0.75rem",
  },
  selectionBar: {
    position: "fixed",
    right: "1.25rem",
    bottom: "1rem",
    left: "calc(250px + 1.25rem)",
    zIndex: 40,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "0.85rem 1rem",
    borderRadius: "0.95rem",
    background: "#0f172a",
    color: "#ffffff",
    boxShadow: "0 20px 40px rgba(15, 23, 42, 0.28)",
    flexWrap: "wrap",
  },
  selectionCount: {
    display: "block",
    fontSize: "0.95rem",
  },
  selectionHint: {
    display: "block",
    marginTop: "0.2rem",
    color: "#cbd5e1",
    fontSize: "0.75rem",
  },
  selectionActions: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  primaryButton: {
    border: "1px solid #2563eb",
    borderRadius: "0.7rem",
    padding: "0.55rem 0.75rem",
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 850,
    cursor: "pointer",
  },
  secondaryButton: {
    border: "1px solid rgba(148, 163, 184, 0.5)",
    borderRadius: "0.7rem",
    padding: "0.55rem 0.75rem",
    background: "#ffffff",
    color: "#0f172a",
    fontWeight: 850,
    cursor: "pointer",
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 100,
    display: "grid",
    placeItems: "center",
    padding: "1rem",
    background: "rgba(15, 23, 42, 0.68)",
  },
  modalCard: {
    width: "min(560px, 100%)",
    borderRadius: "1rem",
    background: "#ffffff",
    boxShadow: "0 28px 70px rgba(15, 23, 42, 0.34)",
    overflow: "hidden",
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "1rem",
    padding: "1rem 1.1rem",
    borderBottom: "1px solid #e2e8f0",
  },
  modalEyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: "0.7rem",
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  modalTitle: {
    margin: "0.2rem 0 0",
    color: "#0f172a",
  },
  modalCloseButton: {
    border: 0,
    background: "transparent",
    color: "#64748b",
    fontSize: "1rem",
    cursor: "pointer",
  },
  modalBody: {
    display: "grid",
    gap: "0.8rem",
    padding: "1rem 1.1rem",
  },
  modalCountBox: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0.8rem",
    borderRadius: "0.8rem",
    background: "#eff6ff",
    color: "#1e3a8a",
    fontWeight: 850,
  },
  modalErrorBox: {
    padding: "0.75rem 0.8rem",
    border: "1px solid #fecaca",
    borderRadius: "0.7rem",
    background: "#fef2f2",
    color: "#b91c1c",
    fontSize: "0.82rem",
    fontWeight: 800,
    lineHeight: 1.45,
  },
  modalText: {
    margin: 0,
    color: "#475569",
    lineHeight: 1.55,
  },
  modalFooter: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.55rem",
    padding: "1rem 1.1rem",
    borderTop: "1px solid #e2e8f0",
  },
};
