/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useMemo, useState } from "react";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGetDemoSalesByLmPcodeQuery } from "../../redux/demoSalesApi";
import NonGpsExceptions from "./components/NonGpsExceptions";
import NonGpsStreetDetail from "./components/NonGpsStreetDetail";
import NonGpsStreetPlanning from "./components/NonGpsStreetPlanning";
import { buildNonGpsBatchPlanningModel } from "./models/nonGpsBatchPlanningModel";
import {
  formatNumber,
  getActiveLmPcode,
  getActiveWorkbaseName,
} from "./salesUtils";

const VIEW_MODES = Object.freeze({
  PLANNING: "PLANNING",
  EXCEPTIONS: "EXCEPTIONS",
});

function SummaryCard({ label, value, subtitle }) {
  return (
    <div style={styles.summaryCard}>
      <span style={styles.summaryLabel}>{label}</span>
      <strong style={styles.summaryValue}>{formatNumber(value || 0)}</strong>
      <span style={styles.summarySubtitle}>{subtitle}</span>
    </div>
  );
}

export default function NonGpsBatchPlanningPage() {
  const { activeWorkbase, role } = useAuth();
  const activeLmPcode = getActiveLmPcode(activeWorkbase);
  const activeWorkbaseName = getActiveWorkbaseName(activeWorkbase);
  const [viewMode, setViewMode] = useState(VIEW_MODES.PLANNING);
  const [selectedTownKey, setSelectedTownKey] = useState("");
  const [selectedStreetKey, setSelectedStreetKey] = useState("");
  const [searchText, setSearchText] = useState("");

  const {
    data: salesRows = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useGetDemoSalesByLmPcodeQuery(activeLmPcode || skipToken);

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
            />
            <SummaryCard
              label="Exceptions"
              value={planningModel.counts.exceptions}
              subtitle="Visible but not selectable"
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

          <section style={styles.tabs}>
            <button
              type="button"
              style={{
                ...styles.tabButton,
                ...(viewMode === VIEW_MODES.PLANNING
                  ? styles.tabButtonActive
                  : null),
              }}
              onClick={openPlanningView}
            >
              Street Planning
            </button>
            <button
              type="button"
              style={{
                ...styles.tabButton,
                ...(viewMode === VIEW_MODES.EXCEPTIONS
                  ? styles.tabButtonActive
                  : null),
              }}
              onClick={openExceptionsView}
            >
              Exceptions / Unplaced ({formatNumber(planningModel.visibilityCounts.exceptionView)})
            </button>
          </section>

          {viewMode === VIEW_MODES.EXCEPTIONS ? (
            <NonGpsExceptions exceptions={planningModel.exceptions} />
          ) : selectedStreet ? (
            <NonGpsStreetDetail street={selectedStreet} onBack={backToStreets} />
          ) : (
            <NonGpsStreetPlanning
              towns={planningModel.towns}
              selectedTownKey={selectedTown?.key || ""}
              searchText={searchText}
              onSearchTextChange={setSearchText}
              onOpenTown={openTown}
              onBackToTowns={backToTowns}
              onOpenStreet={openStreet}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

const styles = {
  page: {
    display: "grid",
    gap: "1rem",
    padding: "1rem 1.25rem 4rem",
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
  summaryLabel: { color: "#64748b", fontSize: "0.75rem", fontWeight: 900 },
  summaryValue: { color: "#0f172a", fontSize: "1.55rem" },
  summarySubtitle: { color: "#64748b", fontSize: "0.78rem" },
  tabs: { display: "flex", gap: "0.5rem", flexWrap: "wrap" },
  tabButton: {
    border: "1px solid #cbd5e1",
    borderRadius: "999px",
    background: "#ffffff",
    color: "#475569",
    padding: "0.5rem 0.75rem",
    fontWeight: 800,
    cursor: "pointer",
  },
  tabButtonActive: { background: "#dbeafe", color: "#1d4ed8", borderColor: "#93c5fd" },
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
