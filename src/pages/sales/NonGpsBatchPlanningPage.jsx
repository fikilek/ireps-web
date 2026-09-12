/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useEffect, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGetSalesByLmPcodeQuery, useSalesReadScope } from "../../redux/salesApi";
import { prepareTargetedBatchDraft } from "../../redux/targetedBatchDraftSlice";
import { buildTargetedBatchDraftId } from "../../redux/targetedBatchDraftModel";
import { quickDownloadExcel } from "../../utils/downloads/quickDownloadExcel";
import NonGpsExceptions from "./components/NonGpsExceptions";
import NonGpsStreetDetail from "./components/NonGpsStreetDetail";
import NonGpsStreetPlanning from "./components/NonGpsStreetPlanning";
import {
  NGP_SELECTION_MAX,
  buildNgpTargetedBatchDraftPlan,
  buildNonGpsBatchPlanningModel,
  updateNgpStreetSelection,
  validateNgpSelection,
} from "./models/nonGpsBatchPlanningModel";
import {
  formatNumber,
  getActiveLmPcode,
  getActiveWorkbaseName,
} from "./salesUtils";

const VIEW_MODES = Object.freeze({
  PLANNING: "PLANNING",
  EXCEPTIONS: "EXCEPTIONS",
});

function SummaryCard({
  label,
  value,
  subtitle,
  active = false,
  onClick = null,
}) {
  const content = (
    <>
      <span style={styles.summaryLabel}>{label}</span>
      <strong style={styles.summaryValue}>{formatNumber(value || 0)}</strong>
      <span style={styles.summarySubtitle}>{subtitle}</span>
    </>
  );

  if (!onClick) {
    return <div style={styles.summaryCard}>{content}</div>;
  }

  return (
    <button
      type="button"
      style={{
        ...styles.summaryCard,
        ...styles.summaryCardButton,
        ...(active ? styles.summaryCardActive : null),
      }}
      onClick={onClick}
    >
      {content}
    </button>
  );
}

export default function NonGpsBatchPlanningPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { activeWorkbase, role } = useAuth();
  const activeLmPcode = getActiveLmPcode(activeWorkbase);
  const readScope = useSalesReadScope(activeLmPcode);
  const scopeKey = JSON.stringify(readScope);
  const activeWorkbaseName = getActiveWorkbaseName(activeWorkbase);
  const [viewMode, setViewMode] = useState(VIEW_MODES.PLANNING);
  const [selectedTownKey, setSelectedTownKey] = useState("");
  const [selectedStreetKey, setSelectedStreetKey] = useState("");
  const [searchText, setSearchText] = useState("");
  const [selection, setSelection] = useState({});
  const selectedIds = useMemo(() => selection.scope === scopeKey ? selection.ids : new Set(), [selection, scopeKey]);
  const setSelectedIds = next => setSelection(previous => ({
    scope: scopeKey,
    ids: typeof next === "function" ? next(previous.scope === scopeKey ? previous.ids : new Set()) : next,
  }));
  const [selectionError, setSelectionError] = useState("");

  const {
    data: salesRows = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useGetSalesByLmPcodeQuery(activeLmPcode ? { lmPcode: activeLmPcode } : skipToken);

  const planningModel = useMemo(
    () => buildNonGpsBatchPlanningModel(salesRows),
    [salesRows],
  );

  const selectedTown = useMemo(
    () =>
      planningModel.towns.find((town) => town.key === selectedTownKey) || null,
    [planningModel.towns, selectedTownKey],
  );

  const selectedStreet = useMemo(
    () =>
      selectedTown?.streets.find((street) => street.key === selectedStreetKey) ||
      null,
    [selectedStreetKey, selectedTown],
  );

  const selectedTargets = useMemo(
    () =>
      planningModel.streetPlanningTargets.filter(
        (target) =>
          target.batchable === true &&
          selectedIds.has(target.id),
      ),
    [planningModel.streetPlanningTargets, selectedIds],
  );

  const activeSelectedIds = useMemo(
    () => new Set(selectedTargets.map((target) => target.id)),
    [selectedTargets],
  );


  const batchabilityBySalesId = useMemo(
    () => new Map(planningModel.noGpsTargets.map((target) => [
      target.id,
      { row: target.row, batchable: target.batchable,
        reason: target.batchabilityReason, membership: target.membership },
    ])),
    [planningModel.noGpsTargets],
  );

  useEffect(() => {
    if (isLoading || error || selectedIds.size === 0) return;

    const nextSelectedIds = new Set(selectedIds);
    const removed = [];

    selectedIds.forEach((id) => {
      const current = batchabilityBySalesId.get(id);
      if (current?.batchable === true) return;

      nextSelectedIds.delete(id);
      removed.push({
        id,
        meterNo: current?.row?.meterNo || id,
        reason:
          current?.reason ||
          "Sales meter is no longer available in the current planning scope",
      });
    });

    if (removed.length === 0) return;

    // Persist live invalidation so removed IDs cannot silently reappear later.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelection({ scope: scopeKey, ids: nextSelectedIds });

    if (removed.length === 1) {
      setSelectionError(
        `Meter ${removed[0].meterNo} was removed from the selection because it is no longer batchable: ${removed[0].reason}.`,
      );
    } else {
      setSelectionError(
        `${removed.length} meters were removed from the selection because they are no longer batchable: ${removed
          .map((item) => `${item.meterNo} (${item.reason})`)
          .join("; ")}.`,
      );
    }
  }, [batchabilityBySalesId, error, isLoading, scopeKey, selectedIds]);

  const selectedDownloadColumns = useMemo(
    () => [
      { header: "Meter Number", value: (target) => target.meterNo || "NAv" },
      {
        header: "Address",
        value: (target) => target.canonicalAddress || "NAv",
      },
      { header: "Town / Area", value: (target) => target.town || "NAv" },
      {
        header: "Street",
        value: (target) => target.streetLabel || "NAv",
      },
      {
        header: "Sales Meter Status",
        value: (target) => target.salesWorkStatus || "NAv",
      },
    ],
    [],
  );

  const selectionValidation = useMemo(
    () => validateNgpSelection(selectedTargets),
    [selectedTargets],
  );

  function openPlanningView() {
    setViewMode(VIEW_MODES.PLANNING);
  }

  function openExceptionsView() {
    setViewMode(VIEW_MODES.EXCEPTIONS);
    setSelectedTownKey("");
    setSelectedStreetKey("");
    setSearchText("");
  }

  function openTown(townKey) {
    setSelectedTownKey(townKey);
    setSelectedStreetKey("");
    setSearchText("");
  }

  function openStreet(streetKey) {
    setSelectedStreetKey(streetKey);
    setSearchText("");
  }

  function backToTowns() {
    setSelectedTownKey("");
    setSelectedStreetKey("");
    setSearchText("");
  }

  function backToStreets() {
    setSelectedStreetKey("");
    setSearchText("");
  }

  function toggleTarget(target) {
    if (target?.batchable !== true) return;

    setSelectionError("");
    const nextSelectedIds = new Set(activeSelectedIds);

    if (nextSelectedIds.has(target.id)) {
      nextSelectedIds.delete(target.id);
      setSelectedIds(nextSelectedIds);
      return;
    }

    if (nextSelectedIds.size >= NGP_SELECTION_MAX) {
      setSelectionError(
        `One Non GPS Targeted Batch may contain at most ${NGP_SELECTION_MAX} meters. Deselect a meter before selecting another.`,
      );
      return;
    }

    nextSelectedIds.add(target.id);
    setSelectedIds(nextSelectedIds);
  }

  function toggleStreet(street) {
    setSelectionError("");

    const update = updateNgpStreetSelection({
      selectedIds: activeSelectedIds,
      streetTargets: street?.targets || [],
    });

    if (update.blockedByCapacity) {
      const requestedLabel =
        update.requestedCount === 1 ? "meter is" : "meters are";
      const slotsLabel =
        update.remainingCapacity === 1 ? "slot remains" : "slots remain";

      setSelectionError(
        `${update.requestedCount} batchable ${requestedLabel} available on ${street?.streetLabel || "this street"}, but only ${update.remainingCapacity} batch ${slotsLabel}. Select individual meters or reduce the current selection.`,
      );
      return;
    }

    setSelectedIds(update.selectedIds);
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setSelectionError("");
  }

  function downloadSelected() {
    if (selectedTargets.length === 0) return;

    quickDownloadExcel({
      rows: selectedTargets,
      columns: selectedDownloadColumns,
      fileBaseName: "selected_non_gps_sales_meters",
      registryName: "Selected Non GPS Sales Meters",
      scope: {
        lmName: activeWorkbaseName,
        lmPcode: activeLmPcode || "NAv",
        wardLabel: "Non GPS Targeted Meter Selection",
      },
    });
  }

  function createTargetBatch() {
    setSelectionError("");

    const draftPlan = buildNgpTargetedBatchDraftPlan({
      targets: selectedTargets,
      tbId: buildTargetedBatchDraftId(),
      lmPcode: activeLmPcode,
      lmName: activeWorkbaseName,
    });

    if (!draftPlan.ok) {
      setSelectionError(draftPlan.message || "The NGP batch selection is not valid.");
      return;
    }

    dispatch(prepareTargetedBatchDraft(draftPlan.draft));
    navigate("/operations/targeted-batches/draft");
  }

  return (
    <div style={styles.page}>
      <section style={styles.hero}>
        <div>
          <p style={styles.heroEyebrow}>Sales Planning</p>
          <h1 style={styles.heroTitle}>Non GPS Batch Planning</h1>
          <p style={styles.heroSubtitle}>
            {activeLmPcode || "NAv"} · {activeWorkbaseName} · Plan Sales meters
            without usable GPS by Town / Area and street.
          </p>
        </div>

        <div style={styles.heroActions}>
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
            Activate a Local Municipality workbase before opening Non GPS Batch
            Planning.
          </p>
        </section>
      ) : null}

      {error ? (
        <section style={{ ...styles.statePanel, ...styles.errorPanel }}>
          <h2>Could not load Sales data</h2>
          <p>
            Check Firestore access to sales-all-meters and confirm that records
            exist for {activeLmPcode}.
          </p>
        </section>
      ) : null}

      {isLoading ? (
        <section style={styles.statePanel} aria-live="polite" aria-busy="true">
          <h2>Loading Non GPS planning data...</h2>
          <p>Preparing the live No-GPS Sales population and street groups.</p>
        </section>
      ) : null}

      {!isLoading && activeLmPcode && !error && salesRows.length === 0 ? (
        <section style={styles.statePanel}>
          <h2>No Sales meters found</h2>
          <p>No sales-all-meters records were returned for {activeLmPcode}.</p>
        </section>
      ) : null}

      {salesRows.length > 0 ? (
        <>
          <section style={styles.summaryGrid}>
            <SummaryCard
              label="No GPS"
              value={planningModel.counts.noGps}
              subtitle="Sales meters without usable GPS"
            />
            <SummaryCard
              label="Street Eligible"
              value={planningModel.counts.streetEligible}
              subtitle="Available for Town / street planning"
              active={viewMode === VIEW_MODES.PLANNING}
              onClick={openPlanningView}
            />
            <SummaryCard
              label="Exceptions"
              value={planningModel.counts.exceptions}
              subtitle="Visible but not selectable"
              active={viewMode === VIEW_MODES.EXCEPTIONS}
              onClick={openExceptionsView}
            />
            {planningModel.visibilityCounts.unplaced > 0 ? (
              <SummaryCard
                label="Unplaced Resolved"
                value={planningModel.visibilityCounts.unplaced}
                subtitle="Classified records without a planning location"
              />
            ) : null}
          </section>

          {!planningModel.reconciles ? (
            <section role="alert" style={styles.reconciliationError}>
              Street Eligible + Exceptions does not reconcile to the complete
              No-GPS population. Treat this as a planning-data integrity issue.
            </section>
          ) : null}

          {selectionError && viewMode === VIEW_MODES.PLANNING ? (
            <section role="alert" style={styles.selectionError}>
              {selectionError}
            </section>
          ) : null}

          {viewMode === VIEW_MODES.EXCEPTIONS ? (
            <NonGpsExceptions exceptions={planningModel.exceptions} />
          ) : selectedStreet ? (
            <NonGpsStreetDetail
              key={scopeKey + selectedStreet.key}
              street={selectedStreet}
              lmPcode={activeLmPcode}
              selectedIds={activeSelectedIds}
              onToggleTarget={toggleTarget}
              onBack={backToStreets}
            />
          ) : (
            <NonGpsStreetPlanning
              towns={planningModel.towns}
              selectedTownKey={selectedTown?.key || ""}
              searchText={searchText}
              onSearchTextChange={setSearchText}
              onOpenTown={openTown}
              onBackToTowns={backToTowns}
              onOpenStreet={openStreet}
              selectedIds={activeSelectedIds}
              onToggleStreet={toggleStreet}
            />
          )}

          {viewMode === VIEW_MODES.PLANNING && selectedTargets.length > 0 ? (
            <section style={styles.selectionBar}>
              <div>
                <strong style={styles.selectionCount}>
                  {formatNumber(selectedTargets.length)} meters selected
                </strong>
                <span style={styles.selectionHint}>
                  Selection is retained while paging and filtering.
                </span>
              </div>

              <div style={styles.selectionActions}>
                <button
                  type="button"
                  style={styles.secondaryButton}
                  onClick={clearSelection}
                >
                  Clear Selection
                </button>
                <button
                  type="button"
                  style={styles.secondaryButton}
                  onClick={downloadSelected}
                >
                  Download Selected
                </button>
                <button
                  type="button"
                  style={styles.primaryButton}
                  disabled={!selectionValidation.ok}
                  onClick={createTargetBatch}
                >
                  Create Target Batch
                </button>
              </div>
            </section>
          ) : null}
        </>
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
  },
  heroEyebrow: {
    margin: 0,
    color: "#bfdbfe",
    fontSize: "0.72rem",
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  heroTitle: { margin: "0.2rem 0 0", fontSize: "1.7rem" },
  heroSubtitle: { margin: "0.45rem 0 0", color: "#dbeafe", fontSize: "0.9rem" },
  heroActions: { display: "flex", alignItems: "center", gap: "0.65rem" },
  roleBadge: {
    border: "1px solid rgba(255,255,255,0.3)",
    borderRadius: "999px",
    padding: "0.38rem 0.62rem",
    fontSize: "0.72rem",
    fontWeight: 900,
  },
  refreshButton: {
    border: "1px solid rgba(255,255,255,0.36)",
    borderRadius: "0.65rem",
    background: "rgba(255,255,255,0.12)",
    color: "#ffffff",
    padding: "0.58rem 0.75rem",
    fontWeight: 800,
    cursor: "pointer",
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: "0.8rem",
  },
  summaryCard: {
    display: "grid",
    gap: "0.2rem",
    padding: "0.95rem",
    border: "1px solid #dbe3ef",
    borderRadius: "0.9rem",
    background: "#ffffff",
    boxShadow: "0 6px 18px rgba(15, 23, 42, 0.05)",
  },
  summaryCardButton: {
    width: "100%",
    appearance: "none",
    textAlign: "left",
    font: "inherit",
    cursor: "pointer",
  },
  summaryCardActive: {
    borderColor: "#93c5fd",
    background: "#eff6ff",
  },
  summaryLabel: { color: "#64748b", fontSize: "0.75rem", fontWeight: 900 },
  summaryValue: { color: "#0f172a", fontSize: "1.55rem" },
  summarySubtitle: { color: "#64748b", fontSize: "0.78rem" },
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
  selectionError: {
    padding: "0.75rem 0.85rem",
    border: "1px solid #fecaca",
    borderRadius: "0.7rem",
    background: "#fef2f2",
    color: "#991b1b",
    fontSize: "0.84rem",
    fontWeight: 700,
  },
  statePanel: {
    padding: "1rem",
    border: "1px solid #dbe3ef",
    borderRadius: "0.9rem",
    background: "#ffffff",
    color: "#334155",
  },
  errorPanel: { borderColor: "#fecaca", background: "#fef2f2", color: "#991b1b" },
  reconciliationError: {
    padding: "0.8rem 0.9rem",
    border: "1px solid #fecaca",
    borderRadius: "0.8rem",
    background: "#fef2f2",
    color: "#991b1b",
    fontWeight: 700,
    fontSize: "0.84rem",
  },
};
