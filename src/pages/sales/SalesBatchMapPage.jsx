import { useMemo } from "react";
import { skipToken } from "@reduxjs/toolkit/query";
import { Link, useParams } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import { useGetTargetedBatchMapByIdQuery } from "../../redux/salesTargetedBatchApi";
import SalesTargetedBatchMap from "./components/SalesTargetedBatchMap";

function cleanText(value) {
  return String(value ?? "").trim();
}

function getActiveLmPcode(activeWorkbase) {
  return cleanText(
    activeWorkbase?.lmPcode ||
      activeWorkbase?.pcode ||
      activeWorkbase?.id ||
      activeWorkbase?.localMunicipalityId,
  );
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function SummaryCard({ label, value, helper }) {
  return (
    <article style={styles.summaryCard}>
      <span style={styles.summaryLabel}>{label}</span>
      <strong style={styles.summaryValue}>{formatNumber(value)}</strong>
      <span style={styles.summaryHelper}>{helper}</span>
    </article>
  );
}

function CoverageRow({ label, found, referenced, spatial, spatialLabel }) {
  return (
    <div style={styles.coverageRow}>
      <strong>{label}</strong>
      <span>
        {formatNumber(found)} of {formatNumber(referenced)} found
      </span>
      <span>
        {formatNumber(spatial)} {spatialLabel}
      </span>
    </div>
  );
}

export default function SalesBatchMapPage() {
  const { tbId: routeTbId = "" } = useParams();
  const { activeWorkbase } = useAuth();

  const tbId = cleanText(routeTbId);
  const activeLmPcode = getActiveLmPcode(activeWorkbase);

  const {
    data: mapStream,
    isError: isMapQueryError,
    error: mapQueryError,
  } = useGetTargetedBatchMapByIdQuery(
    tbId && activeLmPcode
      ? {
          tbId,
          lmPcode: activeLmPcode,
        }
      : skipToken,
  );

  const batch = mapStream?.batch || null;
  const membership = mapStream?.membership || {};
  const diagnostics = mapStream?.diagnostics || {};
  const erfs = useMemo(
    () => (Array.isArray(mapStream?.erfs) ? mapStream.erfs : []),
    [mapStream?.erfs],
  );
  const premises = useMemo(
    () => (Array.isArray(mapStream?.premises) ? mapStream.premises : []),
    [mapStream?.premises],
  );
  const meters = useMemo(
    () => (Array.isArray(mapStream?.meters) ? mapStream.meters : []),
    [mapStream?.meters],
  );

  const streamStatus = cleanText(mapStream?.sync?.status);
  const streamReady =
    streamStatus === "ready" ||
    streamStatus === "error" ||
    isMapQueryError;
  const streamError =
    mapStream?.sync?.error ||
    (isMapQueryError
      ? {
          message:
            mapQueryError?.error ||
            mapQueryError?.data?.message ||
            "The live Targeted Batch Map stream could not be opened.",
        }
      : null);

  const missingReferenceCount =
    Number(diagnostics?.missingErfCount || 0) +
    Number(diagnostics?.missingPremiseCount || 0) +
    Number(diagnostics?.missingMeterCount || 0) +
    Number(diagnostics?.rowsMissingErfRef || 0) +
    Number(diagnostics?.rowsMissingPremiseRef || 0) +
    Number(diagnostics?.rowsMissingMeterRef || 0);

  return (
    <section style={styles.page}>
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Sales / Reporting / Batch Map</p>
          <h1 style={styles.title}>Targeted Batch Map</h1>
          <p style={styles.subtitle}>
            A live spatial overview containing only ERFs, premises and Field
            Meters referenced by this Targeted Batch.
          </p>
        </div>

        <div style={styles.headerActions}>
          <Link to="/sales/reporting" style={styles.secondaryButton}>
            Back to Reporting
          </Link>
          {tbId ? (
            <Link
              to={`/sales/reporting/${encodeURIComponent(tbId)}`}
              style={styles.primaryButton}
            >
              Open Report
            </Link>
          ) : null}
        </div>
      </header>

      {!tbId ? (
        <div style={styles.errorNotice}>
          A Targeted Batch ID was not supplied in the route.
        </div>
      ) : null}

      {!activeLmPcode ? (
        <div style={styles.notice}>
          Activate a Local Municipality workbase before opening a Targeted
          Batch Map.
        </div>
      ) : null}

      {tbId ? (
        <section style={styles.identityPanel}>
          <div>
            <span style={styles.identityLabel}>Targeted Batch</span>
            <strong style={styles.identityValue}>{tbId}</strong>
          </div>
          <div>
            <span style={styles.identityLabel}>Ward</span>
            <strong style={styles.identityValue}>
              {batch?.scope?.wardLabel || "NAv"}
            </strong>
          </div>
          <div>
            <span style={styles.identityLabel}>Allocation</span>
            <strong style={styles.identityValue}>
              {batch?.allocation?.targetLabel || "Unallocated"}
            </strong>
          </div>
          <div>
            <span style={styles.identityLabel}>Execution</span>
            <strong style={styles.identityValue}>
              {batch?.execution?.status || "NOT STARTED"}
            </strong>
          </div>
        </section>
      ) : null}

      <div style={styles.summaryGrid}>
        <SummaryCard
          label="Batch Rows"
          value={membership?.rowCount}
          helper="Canonical tb_rows membership"
        />
        <SummaryCard
          label="ERFs"
          value={erfs.length}
          helper={`${formatNumber(diagnostics?.erfsWithGeometry)} with geometry`}
        />
        <SummaryCard
          label="Premises"
          value={premises.length}
          helper={`${formatNumber(diagnostics?.premisesWithGps)} with GPS`}
        />
        <SummaryCard
          label="Field Meters"
          value={meters.length}
          helper={`${formatNumber(diagnostics?.metersWithGps)} with GPS`}
        />
      </div>

      {!streamReady && tbId && activeLmPcode ? (
        <div style={styles.loadingState}>
          <span style={styles.spinner} />
          Loading the live Targeted Batch spatial population...
        </div>
      ) : null}

      {streamReady && streamError ? (
        <div style={styles.errorNotice}>
          <strong>Targeted Batch Map stream failed.</strong>
          <span>
            {streamError?.message ||
              "The live Targeted Batch Map stream could not be opened."}
          </span>
        </div>
      ) : null}

      {streamReady && !streamError && diagnostics?.lmPcodeMatches === false ? (
        <div style={styles.errorNotice}>
          <strong>Workbase mismatch.</strong>
          <span>
            This batch belongs to {diagnostics?.batchLmPcode || "another LM"},
            while the active workbase is {diagnostics?.expectedLmPcode || "NAv"}.
          </span>
        </div>
      ) : null}

      {streamReady && !streamError && missingReferenceCount > 0 ? (
        <div style={styles.warningNotice}>
          <strong>Some batch assets are not spatially complete.</strong>
          <span>
            The map shows every referenced asset that could be resolved. No
            ward-wide, geofence or proximity fallback was used.
          </span>
        </div>
      ) : null}

      {streamReady && !streamError ? (
        <SalesTargetedBatchMap
          erfs={erfs}
          premises={premises}
          meters={meters}
          focusedMeterId=""
        />
      ) : null}

      {streamReady && !streamError ? (
      <section style={styles.coveragePanel}>
        <div style={styles.coverageHeader}>
          <div>
            <h2 style={styles.coverageTitle}>Spatial Coverage</h2>
            <p style={styles.coverageSubtitle}>
              Bounded diagnostics from the live Batch Map API.
            </p>
          </div>
          <span style={styles.liveBadge}>
            <span style={styles.liveDot} /> Live
          </span>
        </div>

        <div style={styles.coverageGrid}>
          <CoverageRow
            label="ERFs"
            found={diagnostics?.erfsFound}
            referenced={diagnostics?.erfRefs}
            spatial={diagnostics?.erfsWithGeometry}
            spatialLabel="with geometry"
          />
          <CoverageRow
            label="Premises"
            found={diagnostics?.premisesFound}
            referenced={diagnostics?.premiseRefs}
            spatial={diagnostics?.premisesWithGps}
            spatialLabel="with GPS"
          />
          <CoverageRow
            label="Field Meters"
            found={diagnostics?.metersFound}
            referenced={diagnostics?.meterRefs}
            spatial={diagnostics?.metersWithGps}
            spatialLabel="with GPS"
          />
        </div>

        <div style={styles.diagnosticFooter}>
          <span>
            Missing refs: ERF {formatNumber(diagnostics?.rowsMissingErfRef)} ·
            Premise {formatNumber(diagnostics?.rowsMissingPremiseRef)} · Meter{" "}
            {formatNumber(diagnostics?.rowsMissingMeterRef)}
          </span>
          <span>
            Unresolved IDs: ERF {formatNumber(diagnostics?.missingErfCount)} ·
            Premise {formatNumber(diagnostics?.missingPremiseCount)} · Meter{" "}
            {formatNumber(diagnostics?.missingMeterCount)}
          </span>
        </div>
      </section>
      ) : null}
    </section>
  );
}

const styles = {
  page: {
    display: "grid",
    gap: 18,
  },

  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 18,
    flexWrap: "wrap",
  },

  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
  },

  title: {
    margin: "5px 0 0",
    color: "#0f172a",
    fontSize: 28,
    lineHeight: 1.1,
  },

  subtitle: {
    maxWidth: 760,
    margin: "8px 0 0",
    color: "#64748b",
    fontSize: 13,
    lineHeight: 1.6,
  },

  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    flexWrap: "wrap",
  },

  primaryButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 38,
    borderRadius: 10,
    background: "#0f172a",
    color: "#ffffff",
    padding: "8px 14px",
    fontSize: 10,
    fontWeight: 900,
    textDecoration: "none",
  },

  secondaryButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 38,
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#334155",
    padding: "8px 14px",
    fontSize: 10,
    fontWeight: 900,
    textDecoration: "none",
  },

  identityPanel: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
    padding: 15,
    border: "1px solid #dbeafe",
    borderRadius: 14,
    background: "#eff6ff",
  },

  identityLabel: {
    display: "block",
    color: "#64748b",
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },

  identityValue: {
    display: "block",
    marginTop: 5,
    color: "#0f172a",
    fontSize: 12,
    fontWeight: 900,
    wordBreak: "break-word",
  },

  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 12,
  },

  summaryCard: {
    display: "grid",
    gap: 5,
    padding: 15,
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    background: "#ffffff",
    boxShadow: "0 8px 20px rgba(15, 23, 42, 0.05)",
  },

  summaryLabel: {
    color: "#64748b",
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },

  summaryValue: {
    color: "#0f172a",
    fontSize: 25,
    lineHeight: 1,
  },

  summaryHelper: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: 700,
  },

  notice: {
    padding: "12px 14px",
    borderRadius: 12,
    background: "#fff7ed",
    border: "1px solid #fed7aa",
    color: "#9a3412",
    fontSize: 12,
    fontWeight: 800,
  },

  warningNotice: {
    display: "grid",
    gap: 4,
    padding: "12px 14px",
    borderRadius: 12,
    background: "#fffbeb",
    border: "1px solid #fde68a",
    color: "#92400e",
    fontSize: 11,
  },

  errorNotice: {
    display: "grid",
    gap: 4,
    padding: "12px 14px",
    borderRadius: 12,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
    fontSize: 11,
  },

  loadingState: {
    display: "inline-flex",
    alignItems: "center",
    gap: 9,
    padding: "15px 16px",
    border: "1px solid #bfdbfe",
    borderRadius: 12,
    background: "#eff6ff",
    color: "#1e3a8a",
    fontSize: 12,
    fontWeight: 800,
  },

  spinner: {
    width: 17,
    height: 17,
    borderRadius: "50%",
    border: "2px solid #bfdbfe",
    borderTopColor: "#2563eb",
    animation: "spin 0.8s linear infinite",
  },

  coveragePanel: {
    border: "1px solid #e2e8f0",
    borderRadius: 15,
    background: "#ffffff",
    overflow: "hidden",
  },

  coverageHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "14px 16px",
    borderBottom: "1px solid #e2e8f0",
    background: "#f8fafc",
  },

  coverageTitle: {
    margin: 0,
    color: "#0f172a",
    fontSize: 15,
  },

  coverageSubtitle: {
    margin: "4px 0 0",
    color: "#64748b",
    fontSize: 10,
  },

  liveBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    background: "#dcfce7",
    color: "#166534",
    padding: "6px 9px",
    fontSize: 9,
    fontWeight: 900,
    textTransform: "uppercase",
  },

  liveDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#16a34a",
  },

  coverageGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 10,
    padding: 14,
  },

  coverageRow: {
    display: "grid",
    gap: 5,
    padding: 12,
    border: "1px solid #e2e8f0",
    borderRadius: 11,
    color: "#475569",
    fontSize: 10,
    background: "#ffffff",
  },

  diagnosticFooter: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    padding: "11px 14px",
    borderTop: "1px solid #e2e8f0",
    color: "#64748b",
    fontSize: 9,
    fontWeight: 800,
    background: "#f8fafc",
  },
};
