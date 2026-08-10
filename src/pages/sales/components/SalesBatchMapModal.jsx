import { useMemo } from "react";
import { skipToken } from "@reduxjs/toolkit/query";

import { useGetTargetedBatchMapByIdQuery } from "../../../redux/salesTargetedBatchApi";
import SalesTargetedBatchMap from "./SalesTargetedBatchMap";

function cleanText(value) {
  return String(value ?? "").trim();
}

function isValidPoint(value) {
  return (
    Number.isFinite(value?.lat) &&
    Number.isFinite(value?.lng) &&
    value.lat >= -90 &&
    value.lat <= 90 &&
    value.lng >= -180 &&
    value.lng <= 180
  );
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function SummaryItem({ label, value }) {
  return (
    <div style={styles.summaryItem}>
      <span style={styles.summaryLabel}>{label}</span>
      <strong style={styles.summaryValue}>{value || "NAv"}</strong>
    </div>
  );
}

export default function SalesBatchMapModal({
  tbId = "",
  lmPcode = "",
  focusedMeterId = "",
  focusedMeterNumber = "",
  onClose,
}) {
  const normalizedTbId = cleanText(tbId);
  const normalizedLmPcode = cleanText(lmPcode);
  const normalizedFocusedMeterId = cleanText(focusedMeterId);
  const canOpenStream = Boolean(
    normalizedTbId && normalizedLmPcode && normalizedFocusedMeterId,
  );

  const {
    data: mapStream,
    isError: isMapQueryError,
    error: mapQueryError,
  } = useGetTargetedBatchMapByIdQuery(
    canOpenStream
      ? {
          tbId: normalizedTbId,
          lmPcode: normalizedLmPcode,
        }
      : skipToken,
  );

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

  const focusedMeter = useMemo(
    () =>
      meters.find(
        (meter) =>
          cleanText(meter?.id) === normalizedFocusedMeterId ||
          cleanText(meter?.entityId) === normalizedFocusedMeterId,
      ) || null,
    [meters, normalizedFocusedMeterId],
  );

  const focusedPremise = useMemo(
    () =>
      premises.find(
        (premise) =>
          cleanText(premise?.id) ===
          cleanText(focusedMeter?.linkedPremiseId),
      ) || null,
    [focusedMeter?.linkedPremiseId, premises],
  );

  const focusedErf = useMemo(
    () =>
      erfs.find(
        (erf) =>
          cleanText(erf?.id) === cleanText(focusedMeter?.linkedErfId),
      ) || null,
    [erfs, focusedMeter?.linkedErfId],
  );

  const hasFocusedMeterGps = isValidPoint(focusedMeter?.point);
  const hasFocusedPremiseGps = isValidPoint(focusedPremise?.point);
  const canDrawConnection =
    Boolean(focusedMeter && focusedPremise) &&
    hasFocusedMeterGps &&
    hasFocusedPremiseGps;

  const connectionIssue = useMemo(() => {
    if (!focusedMeter) return "";

    if (!cleanText(focusedMeter?.linkedPremiseId)) {
      return "The selected Field Meter has no linked premise ID.";
    }

    if (!focusedPremise) {
      return "The linked premise was not resolved in this Targeted Batch.";
    }

    if (!hasFocusedMeterGps && !hasFocusedPremiseGps) {
      return (
        "The Field Meter and linked premise locations are unavailable. " +
        "No connection line can be drawn."
      );
    }

    if (!hasFocusedMeterGps) {
      return (
        "The Field Meter location is unavailable. " +
        "No connection line can be drawn."
      );
    }

    if (!hasFocusedPremiseGps) {
      return (
        "The linked premise location is unavailable. " +
        "No connection line can be drawn."
      );
    }

    return "";
  }, [
    focusedMeter,
    focusedPremise,
    hasFocusedMeterGps,
    hasFocusedPremiseGps,
  ]);

  const streamStatus = cleanText(mapStream?.sync?.status);
  const streamReady =
    !canOpenStream ||
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

  return (
    <div
      style={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <section
        style={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sales-batch-map-modal-title"
      >
        <header style={styles.header}>
          <div>
            <p style={styles.eyebrow}>Targeted Batch Field Meter</p>
            <h2 id="sales-batch-map-modal-title" style={styles.title}>
              Field Meter {focusedMeterNumber || "NAv"}
            </h2>
            <p style={styles.subtitle}>
              The complete Targeted Batch remains visible while the selected
              Field Meter, linked premise and linked ERF are highlighted.
            </p>
          </div>

          <button
            type="button"
            style={styles.closeButton}
            onClick={onClose}
            aria-label="Close Batch Map"
            title="Close Batch Map"
          >
            ×
          </button>
        </header>

        <div style={styles.summaryGrid}>
          <SummaryItem label="Targeted Batch" value={normalizedTbId} />
          <SummaryItem
            label="Field Meter"
            value={focusedMeter?.number || focusedMeterNumber || "NAv"}
          />
          <SummaryItem
            label="Linked Premise"
            value={focusedPremise?.id || focusedMeter?.linkedPremiseId || "NAv"}
          />
          <SummaryItem
            label="Linked ERF"
            value={
              focusedErf?.number ||
              focusedErf?.id ||
              focusedMeter?.linkedErfId ||
              "NAv"
            }
          />
        </div>

        {!canOpenStream ? (
          <div style={styles.errorState}>
            <strong>Batch Map context is incomplete.</strong>
            <span>
              The Targeted Batch, LM or Field Meter identity is unavailable.
            </span>
          </div>
        ) : null}

        {canOpenStream && !streamReady ? (
          <div style={styles.loadingState}>
            <span style={styles.spinner} />
            Loading the complete live Targeted Batch Map...
          </div>
        ) : null}

        {canOpenStream && streamReady && streamError ? (
          <div style={styles.errorState}>
            <strong>Targeted Batch Map stream failed.</strong>
            <span>
              {streamError?.message ||
                "The live Targeted Batch Map stream could not be opened."}
            </span>
          </div>
        ) : null}

        {canOpenStream &&
        streamReady &&
        !streamError &&
        !focusedMeter ? (
          <div style={styles.warningState}>
            <strong>The selected Field Meter was not resolved.</strong>
            <span>
              The complete batch is shown, but this meter is not present in
              the canonical Batch Map membership returned by the live stream.
            </span>
          </div>
        ) : null}

        {canOpenStream &&
        streamReady &&
        !streamError &&
        focusedMeter &&
        canDrawConnection ? (
          <div style={styles.connectionReadyState}>
            <strong>Premise-to-Field-Meter connection shown.</strong>
            <span>
              The line starts at the linked premise and ends at the selected
              Field Meter.
            </span>
          </div>
        ) : null}

        {canOpenStream &&
        streamReady &&
        !streamError &&
        focusedMeter &&
        connectionIssue ? (
          <div style={styles.warningState}>
            <strong>Premise-to-Field-Meter line unavailable.</strong>
            <span>{connectionIssue}</span>
          </div>
        ) : null}

        {canOpenStream && streamReady && !streamError ? (
          <>
            <div style={styles.populationNote}>
              Showing the full batch population: {formatNumber(erfs.length)}
              {" ERF(s), "}
              {formatNumber(premises.length)} premise(s) and {" "}
              {formatNumber(meters.length)} Field Meter(s).
            </div>

            <SalesTargetedBatchMap
              erfs={erfs}
              premises={premises}
              meters={meters}
              focusedMeterId={normalizedFocusedMeterId}
              height={560}
            />
          </>
        ) : null}
      </section>
    </div>
  );
}

const styles = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 1200,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 22,
    background: "rgba(15, 23, 42, 0.68)",
  },

  card: {
    width: "min(1460px, 96vw)",
    maxHeight: "94vh",
    overflowY: "auto",
    borderRadius: 20,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    boxShadow: "0 28px 80px rgba(15, 23, 42, 0.34)",
    padding: 18,
    display: "grid",
    gap: 14,
  },

  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 18,
  },

  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },

  title: {
    margin: "4px 0 0",
    color: "#0f172a",
    fontSize: 24,
    lineHeight: 1.15,
  },

  subtitle: {
    margin: "7px 0 0",
    color: "#64748b",
    fontSize: 12,
    fontWeight: 700,
  },

  closeButton: {
    width: 38,
    height: 38,
    flex: "0 0 auto",
    borderRadius: 11,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#0f172a",
    fontSize: 24,
    lineHeight: 1,
    cursor: "pointer",
  },

  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: 10,
  },

  summaryItem: {
    minWidth: 0,
    display: "grid",
    gap: 4,
    borderRadius: 12,
    border: "1px solid #dbeafe",
    background: "#eff6ff",
    padding: "10px 12px",
  },

  summaryLabel: {
    color: "#64748b",
    fontSize: 9,
    fontWeight: 900,
    textTransform: "uppercase",
  },

  summaryValue: {
    color: "#0f172a",
    fontSize: 11,
    overflowWrap: "anywhere",
  },

  populationNote: {
    borderRadius: 11,
    background: "#f8fafc",
    color: "#475569",
    padding: "9px 12px",
    fontSize: 11,
    fontWeight: 800,
  },

  loadingState: {
    display: "inline-flex",
    alignItems: "center",
    gap: 9,
    borderRadius: 12,
    background: "#f8fafc",
    color: "#475569",
    padding: 14,
    fontSize: 12,
    fontWeight: 800,
  },

  spinner: {
    width: 16,
    height: 16,
    borderRadius: "50%",
    border: "2px solid #bfdbfe",
    borderTopColor: "#2563eb",
    animation: "spin 0.8s linear infinite",
  },

  errorState: {
    display: "grid",
    gap: 4,
    borderRadius: 12,
    border: "1px solid #fecaca",
    background: "#fef2f2",
    color: "#991b1b",
    padding: 14,
    fontSize: 12,
  },

  connectionReadyState: {
    display: "grid",
    gap: 4,
    borderRadius: 12,
    border: "1px solid #c4b5fd",
    background: "#f5f3ff",
    color: "#5b21b6",
    padding: 14,
    fontSize: 12,
  },

  warningState: {
    display: "grid",
    gap: 4,
    borderRadius: 12,
    border: "1px solid #fed7aa",
    background: "#fff7ed",
    color: "#9a3412",
    padding: 14,
    fontSize: 12,
  },
};
