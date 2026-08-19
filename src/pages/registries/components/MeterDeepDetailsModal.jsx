/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useEffect, useMemo, useState } from "react";

import { useGetTrnByIdQuery } from "../../../redux/trnsApi";

const NAV = "NAv";

function isMeaningful(value) {
  if (value === 0 || value === false) return true;
  if (value === null || value === undefined) return false;

  if (Array.isArray(value)) {
    return value.some((item) => isMeaningful(item));
  }

  if (typeof value === "object") {
    return Object.values(value).some((item) => isMeaningful(item));
  }

  const text = String(value).trim();
  if (!text) return false;

  return !["NAV", "N/AV", "N/A", "NA", "NULL", "UNDEFINED"].includes(
    text.toUpperCase(),
  );
}

function safeValue(value, fallback = NAV) {
  return isMeaningful(value) ? value : fallback;
}

function firstMeaningful(...values) {
  return values.find((value) => isMeaningful(value)) ?? null;
}

function formatLabel(value) {
  if (!isMeaningful(value)) return NAV;

  const text = String(value)
    .trim()
    .replace(/[_-]+/g, " ");

  return text
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function formatDisplayValue(value) {
  if (!isMeaningful(value)) return NAV;

  if (Array.isArray(value)) {
    return value.map((item) => formatLabel(item)).join(", ");
  }

  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);

  return String(value);
}

function formatYesNo(value) {
  if (!isMeaningful(value)) return NAV;

  const normalized = String(value).trim().toUpperCase();
  if (["YES", "TRUE", "Y", "1"].includes(normalized)) return "Yes";
  if (["NO", "FALSE", "N", "0"].includes(normalized)) return "No";

  return formatLabel(value);
}

function formatDateTime(value) {
  if (!isMeaningful(value)) return NAV;

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return value.slice(0, 19).replace("T", " ");
    }
    return value;
  }

  if (typeof value?.toDate === "function") {
    return value.toDate().toLocaleString();
  }

  if (typeof value?.seconds === "number") {
    return new Date(value.seconds * 1000).toLocaleString();
  }

  return String(value);
}

function getWardNo(wardPcode) {
  const match = String(wardPcode || "").match(/(\d{1,3})$/);
  if (!match) return NAV;

  const wardNo = Number(match[1]);
  return Number.isFinite(wardNo) ? wardNo : NAV;
}

function getTrnType(raw = {}, trn = {}) {
  return safeValue(raw.accessData?.trnType || raw.trnType || trn.trnType);
}

function hasMeterSnapshot(ast) {
  if (!ast || typeof ast !== "object") return false;

  return Boolean(
    isMeaningful(ast.astData?.astNo) ||
      isMeaningful(ast.astData?.astId) ||
      isMeaningful(ast.astData?.astManufacturer) ||
      isMeaningful(ast.astData?.astName) ||
      isMeaningful(ast.astData?.meter) ||
      isMeaningful(ast.anomalies) ||
      isMeaningful(ast.location) ||
      isMeaningful(ast.normalisation) ||
      isMeaningful(ast.ogs) ||
      isMeaningful(ast.meterReading),
  );
}

function getNormalisationValue(ast = {}) {
  return firstMeaningful(
    ast.normalisation?.actionText,
    ast.normalisation?.actionTaken,
  );
}

function buildIdentityFields(ast = {}, raw = {}) {
  const astData = ast.astData || {};
  const meter = astData.meter || {};

  return [
    { key: "meterNo", label: "Meter No", value: astData.astNo },
    { key: "astId", label: "AST ID", value: astData.astId },
    {
      key: "manufacturer",
      label: "Manufacturer",
      value: astData.astManufacturer,
    },
    {
      key: "model",
      label: "Meter Model / Name",
      value: astData.astName,
    },
    {
      key: "meterType",
      label: "Meter Type",
      value: raw.meterType,
      formatter: formatLabel,
    },
    {
      key: "category",
      label: "Meter Category",
      value: meter.category,
      formatter: formatLabel,
    },
    {
      key: "technology",
      label: "Meter Technology",
      value: meter.type,
      formatter: formatLabel,
    },
  ];
}

function buildElectricityFields(ast = {}) {
  const meter = ast.astData?.meter || {};

  return [
    { key: "phase", label: "Phase", value: meter.phase, formatter: formatLabel },
    {
      key: "cbSize",
      label: "Circuit Breaker Size",
      value: meter.cb?.size,
    },
    {
      key: "cbComment",
      label: "Circuit Breaker Comment",
      value: meter.cb?.comment,
    },
    { key: "sealNo", label: "Seal No", value: meter.seal?.sealNo },
    {
      key: "sealComment",
      label: "Seal Comment",
      value: meter.seal?.comment,
    },
    {
      key: "keypadSerialNo",
      label: "Keypad Serial No",
      value: meter.keypad?.serialNo,
    },
    {
      key: "keypadComment",
      label: "Keypad Comment",
      value: meter.keypad?.comment,
    },
  ];
}

function buildLocationFields(ast = {}) {
  return [
    {
      key: "placement",
      label: "Placement",
      value: ast.location?.placement,
      formatter: formatLabel,
    },
    { key: "latitude", label: "Latitude", value: ast.location?.gps?.lat },
    { key: "longitude", label: "Longitude", value: ast.location?.gps?.lng },
  ];
}

function buildFindingFields(ast = {}) {
  return [
    {
      key: "anomaly",
      label: "Anomaly",
      value: ast.anomalies?.anomaly,
    },
    {
      key: "anomalyDetail",
      label: "Anomaly Detail",
      value: ast.anomalies?.anomalyDetail,
      wide: true,
    },
    {
      key: "normalisation",
      label: "Normalisation",
      value: getNormalisationValue(ast),
      formatter: (value) =>
        Array.isArray(value) ? formatDisplayValue(value) : formatLabel(value),
    },
    {
      key: "offGridSupply",
      label: "Off-grid Supply",
      value: ast.ogs?.hasOffGridSupply,
      formatter: formatYesNo,
    },
  ];
}

function buildReadingFields(raw = {}, ast = {}, useCaptured = false) {
  const capturedReading = raw.inspection?.captured?.mreading || {};
  const rootReading = raw.meterReading || {};

  let reading = null;
  let readingAt = null;
  let noReadingReason = null;

  if (useCaptured && isMeaningful(capturedReading)) {
    reading = capturedReading.reading;
    readingAt = capturedReading.readingAt;
    noReadingReason = capturedReading.noReadingReason;
  } else if (rootReading && typeof rootReading === "object") {
    reading = rootReading.reading;
    readingAt = rootReading.readingAt;
    noReadingReason = rootReading.noReadingReason;
  }

  if (!isMeaningful(reading) && isMeaningful(ast.meterReading)) {
    if (typeof ast.meterReading === "object") {
      reading = ast.meterReading.reading;
      readingAt = firstMeaningful(readingAt, ast.meterReading.readingAt);
      noReadingReason = firstMeaningful(
        noReadingReason,
        ast.meterReading.noReadingReason,
      );
    } else {
      reading = ast.meterReading;
    }
  }

  return [
    { key: "reading", label: "Meter Reading", value: reading },
    {
      key: "readingAt",
      label: "Reading At",
      value: readingAt,
      formatter: formatDateTime,
    },
    {
      key: "noReadingReason",
      label: "No Reading Reason",
      value: noReadingReason,
      wide: true,
    },
  ];
}

function getComparableValue(value) {
  if (!isMeaningful(value)) return null;

  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim().toLowerCase())
      .filter(Boolean)
      .join("|");
  }

  return String(value).trim().toLowerCase();
}

function buildComparisonMap(ast = {}, raw = {}) {
  const fields = [
    ...buildIdentityFields(ast, raw),
    ...buildElectricityFields(ast),
    ...buildLocationFields(ast),
    ...buildFindingFields(ast),
  ];

  return new Map(fields.map((field) => [field.key, field.value]));
}

function hasAnyMeaningfulField(fields = []) {
  return fields.some((field) => isMeaningful(field.value));
}

function DetailField({ field, comparisonMap = null }) {
  const formatter = field.formatter || formatDisplayValue;
  const renderedValue = formatter(field.value);
  const comparisonValue = comparisonMap?.get(field.key);
  const isChanged =
    comparisonMap &&
    isMeaningful(field.value) &&
    isMeaningful(comparisonValue) &&
    getComparableValue(field.value) !== getComparableValue(comparisonValue);

  return (
    <div
      className={`trn-meter-modal-field${field.wide ? " trn-meter-modal-field-wide" : ""}`}
    >
      <div className="trn-meter-modal-field-label">{field.label}</div>
      <div className="trn-meter-modal-field-value-row">
        <div className="trn-meter-modal-field-value">{renderedValue}</div>
        {isChanged ? (
          <span className="trn-meter-modal-changed">Changed</span>
        ) : null}
      </div>
    </div>
  );
}

function DetailSection({ title, fields, comparisonMap = null }) {
  if (!hasAnyMeaningfulField(fields)) return null;

  return (
    <section className="trn-meter-modal-section">
      <h3>{title}</h3>
      <div className="trn-meter-modal-grid">
        {fields.map((field) => (
          <DetailField
            key={field.key}
            field={field}
            comparisonMap={comparisonMap}
          />
        ))}
      </div>
    </section>
  );
}

function SnapshotSections({ ast, raw, comparisonAst = null, reading = false, captured = false }) {
  const comparisonMap = useMemo(
    () =>
      comparisonAst && hasMeterSnapshot(comparisonAst)
        ? buildComparisonMap(comparisonAst, raw)
        : null,
    [comparisonAst, raw],
  );

  const identityFields = buildIdentityFields(ast, raw);
  const electricityFields = buildElectricityFields(ast);
  const locationFields = buildLocationFields(ast);
  const findingFields = buildFindingFields(ast);
  const readingFields = buildReadingFields(raw, ast, captured);

  return (
    <>
      <DetailSection
        title="Meter Identity"
        fields={identityFields}
        comparisonMap={comparisonMap}
      />
      <DetailSection
        title="Electricity Detail"
        fields={electricityFields}
        comparisonMap={comparisonMap}
      />
      <DetailSection
        title="Meter Location"
        fields={locationFields}
        comparisonMap={comparisonMap}
      />
      <DetailSection
        title="Findings"
        fields={findingFields}
        comparisonMap={comparisonMap}
      />
      {reading ? (
        <DetailSection title="Meter Reading" fields={readingFields} />
      ) : null}
    </>
  );
}

function TrnContext({ trn, raw }) {
  const access = raw.accessData?.access || {};
  const metadata = raw.metadata || trn.metadata || {};

  const fields = [
    { key: "trnId", label: "TRN ID", value: trn.trnId || raw.trnId || raw.id, wide: true },
    {
      key: "trnType",
      label: "TRN Type",
      value: getTrnType(raw, trn),
      formatter: formatLabel,
    },
    {
      key: "hasAccess",
      label: "Has Access",
      value: access.hasAccess,
      formatter: formatYesNo,
    },
    {
      key: "accessReason",
      label: "No Access Reason",
      value: access.reason,
      wide: true,
    },
    {
      key: "address",
      label: "Address",
      value: raw.accessData?.premise?.address,
      wide: true,
    },
    { key: "erfNo", label: "ERF No", value: raw.accessData?.erfNo },
    {
      key: "wardNo",
      label: "Ward No",
      value: getWardNo(raw.accessData?.parents?.wardPcode),
    },
    {
      key: "createdByUser",
      label: "Created By User",
      value: metadata.createdByUser,
    },
    {
      key: "createdAt",
      label: "Created At",
      value: metadata.createdAt,
      formatter: formatDateTime,
    },
  ];

  return <DetailSection title="TRN Context" fields={fields} />;
}

function LoadingState() {
  return (
    <div className="trn-meter-modal-state">
      <div className="trn-meter-modal-spinner" aria-hidden="true" />
      <strong>Loading meter details...</strong>
      <span>Reading the exact TRN document.</span>
    </div>
  );
}

export default function MeterDeepDetailsModal({ trnId, onClose }) {
  const [lastKnownOpen, setLastKnownOpen] = useState(false);
  const {
    data: trn,
    isLoading,
    isFetching,
    error,
  } = useGetTrnByIdQuery(trnId, { skip: !trnId });

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose?.();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    setLastKnownOpen(false);
  }, [trnId]);

  const raw = trn?.raw || {};
  const trnType = getTrnType(raw, trn || {});
  const isInspection = String(trnType).trim().toUpperCase() === "METER_INSPECTION";
  const topLevelAst = raw.ast && typeof raw.ast === "object" ? raw.ast : null;
  const capturedAst =
    raw.inspection?.captured?.ast &&
    typeof raw.inspection.captured.ast === "object"
      ? raw.inspection.captured.ast
      : null;
  const useCaptured = isInspection && hasMeterSnapshot(capturedAst);
  const primaryAst = useCaptured ? capturedAst : topLevelAst;
  const hasPrimarySnapshot = hasMeterSnapshot(primaryAst);
  const canShowLastKnown =
    isInspection && useCaptured && hasMeterSnapshot(topLevelAst);

  const headerMeterNo = safeValue(
    firstMeaningful(
      primaryAst?.astData?.astNo,
      topLevelAst?.astData?.astNo,
      trn?.astNo,
    ),
  );
  const headerMeterType = formatLabel(raw.meterType || trn?.meterType);
  const headerAstState = formatLabel(raw.status?.state || trn?.statusState);
  const headerTrnType = formatLabel(trnType);

  return (
    <div
      className="trn-meter-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trn-meter-details-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <style>{MODAL_CSS}</style>

      <div className="trn-meter-modal-card">
        <header className="trn-meter-modal-header">
          <div className="trn-meter-modal-title-wrap">
            <div className="trn-meter-modal-eyebrow">Meter Details</div>
            <div className="trn-meter-modal-title-line">
              <h2 id="trn-meter-details-title">{headerMeterNo}</h2>
              {useCaptured ? (
                <span className="trn-meter-modal-captured">Captured</span>
              ) : null}
            </div>
            <div className="trn-meter-modal-status-line">
              <span>{headerMeterType}</span>
              <span aria-hidden="true">•</span>
              <span>{headerAstState}</span>
              <span aria-hidden="true">•</span>
              <span>{headerTrnType}</span>
            </div>
            <div className="trn-meter-modal-trn-id">{trnId || NAV}</div>
          </div>

          <button
            type="button"
            className="trn-meter-modal-close"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <div className="trn-meter-modal-body">
          {isLoading || (isFetching && !trn) ? <LoadingState /> : null}

          {!isLoading && error ? (
            <div className="trn-meter-modal-state trn-meter-modal-state-error">
              <strong>Could not load meter details</strong>
              <span>
                The exact TRN document could not be read. Close this modal and
                try again.
              </span>
            </div>
          ) : null}

          {!isLoading && !error && !trn ? (
            <div className="trn-meter-modal-state">
              <strong>TRN not found</strong>
              <span>No canonical TRN document was returned for this TRN ID.</span>
            </div>
          ) : null}

          {!isLoading && !error && trn ? (
            <>
              {hasPrimarySnapshot ? (
                <>
                  {useCaptured ? (
                    <div className="trn-meter-modal-section-intro">
                      Captured Meter Details
                    </div>
                  ) : null}

                  <SnapshotSections
                    ast={primaryAst}
                    raw={raw}
                    comparisonAst={canShowLastKnown ? topLevelAst : null}
                    reading
                    captured={useCaptured}
                  />

                  {canShowLastKnown ? (
                    <section className="trn-meter-modal-last-known">
                      <button
                        type="button"
                        className="trn-meter-modal-last-known-toggle"
                        onClick={() => setLastKnownOpen((current) => !current)}
                        aria-expanded={lastKnownOpen}
                      >
                        <span aria-hidden="true">
                          {lastKnownOpen ? "▾" : "▸"}
                        </span>
                        <span>Last Known Meter Details</span>
                      </button>

                      {lastKnownOpen ? (
                        <div className="trn-meter-modal-last-known-body">
                          <SnapshotSections ast={topLevelAst} raw={raw} />
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                </>
              ) : (
                <div className="trn-meter-modal-state">
                  <strong>Meter details were not captured for this TRN.</strong>
                  <span>
                    The modal will not query another collection to manufacture
                    missing meter information.
                  </span>
                </div>
              )}

              <TrnContext trn={trn} raw={raw} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const MODAL_CSS = `
  .trn-meter-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: rgba(15, 23, 42, 0.58);
    box-sizing: border-box;
  }

  .trn-meter-modal-card {
    width: min(1120px, 96vw);
    max-height: 88vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: #ffffff;
    border-radius: 1.2rem;
    box-shadow: 0 24px 70px rgba(15, 23, 42, 0.28);
  }

  .trn-meter-modal-header {
    flex: 0 0 auto;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 1.15rem 1.25rem;
    border-bottom: 1px solid #e2e8f0;
    background: #ffffff;
    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
    z-index: 3;
  }

  .trn-meter-modal-title-wrap {
    min-width: 0;
  }

  .trn-meter-modal-eyebrow {
    margin-bottom: 0.2rem;
    color: #64748b;
    font-size: 0.72rem;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .trn-meter-modal-title-line {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    flex-wrap: wrap;
  }

  .trn-meter-modal-title-line h2 {
    margin: 0;
    color: #0f172a;
    font-size: clamp(1.45rem, 3vw, 2rem);
    overflow-wrap: anywhere;
  }

  .trn-meter-modal-captured,
  .trn-meter-modal-changed {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    font-size: 0.68rem;
    font-weight: 900;
    white-space: nowrap;
  }

  .trn-meter-modal-captured {
    padding: 0.28rem 0.55rem;
    background: #dbeafe;
    color: #1d4ed8;
  }

  .trn-meter-modal-status-line {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
    margin-top: 0.45rem;
    color: #475569;
    font-size: 0.86rem;
    font-weight: 750;
  }

  .trn-meter-modal-trn-id {
    margin-top: 0.4rem;
    color: #64748b;
    font-size: 0.77rem;
    font-weight: 700;
    overflow-wrap: anywhere;
  }

  .trn-meter-modal-close {
    flex: 0 0 auto;
    border: 1px solid rgba(148, 163, 184, 0.55);
    background: #f8fafc;
    color: #0f172a;
    border-radius: 999px;
    padding: 0.5rem 0.85rem;
    font-weight: 850;
    cursor: pointer;
  }

  .trn-meter-modal-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 1.25rem;
    background: #f8fafc;
  }

  .trn-meter-modal-section,
  .trn-meter-modal-last-known {
    margin-bottom: 1rem;
    border: 1px solid #e2e8f0;
    border-radius: 0.9rem;
    background: #ffffff;
    overflow: hidden;
  }

  .trn-meter-modal-section h3 {
    margin: 0;
    padding: 0.85rem 1rem;
    border-bottom: 1px solid #e2e8f0;
    color: #0f172a;
    background: #f8fafc;
    font-size: 0.82rem;
    font-weight: 900;
    letter-spacing: 0.035em;
    text-transform: uppercase;
  }

  .trn-meter-modal-section-intro {
    margin-bottom: 0.7rem;
    color: #1d4ed8;
    font-size: 0.78rem;
    font-weight: 900;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .trn-meter-modal-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0;
  }

  .trn-meter-modal-field {
    min-width: 0;
    padding: 0.85rem 1rem;
    border-bottom: 1px solid #eef2f7;
  }

  .trn-meter-modal-field:nth-child(odd) {
    border-right: 1px solid #eef2f7;
  }

  .trn-meter-modal-field-wide {
    grid-column: 1 / -1;
    border-right: 0 !important;
  }

  .trn-meter-modal-field-label {
    margin-bottom: 0.28rem;
    color: #64748b;
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.025em;
  }

  .trn-meter-modal-field-value-row {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .trn-meter-modal-field-value {
    min-width: 0;
    color: #0f172a;
    font-size: 0.92rem;
    font-weight: 750;
    overflow-wrap: anywhere;
    white-space: normal;
  }

  .trn-meter-modal-changed {
    padding: 0.2rem 0.45rem;
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    color: #475569;
  }

  .trn-meter-modal-last-known-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    border: 0;
    background: #ffffff;
    color: #0f172a;
    padding: 0.9rem 1rem;
    cursor: pointer;
    font-weight: 900;
    text-align: left;
  }

  .trn-meter-modal-last-known-body {
    padding: 0 0.9rem 0.9rem;
    border-top: 1px solid #e2e8f0;
    background: #f8fafc;
  }

  .trn-meter-modal-last-known-body .trn-meter-modal-section {
    margin-top: 0.9rem;
    margin-bottom: 0;
  }

  .trn-meter-modal-state {
    min-height: 11rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.55rem;
    padding: 1.5rem;
    margin-bottom: 1rem;
    border: 1px dashed #cbd5e1;
    border-radius: 0.9rem;
    background: #ffffff;
    color: #475569;
    text-align: center;
  }

  .trn-meter-modal-state strong {
    color: #0f172a;
  }

  .trn-meter-modal-state-error {
    border-style: solid;
  }

  .trn-meter-modal-spinner {
    width: 2rem;
    height: 2rem;
    border-radius: 999px;
    border: 4px solid rgba(148, 163, 184, 0.25);
    border-top-color: #2563eb;
    animation: trn-meter-modal-spin 0.9s linear infinite;
  }

  @keyframes trn-meter-modal-spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 720px) {
    .trn-meter-modal-overlay {
      padding: 0;
    }

    .trn-meter-modal-card {
      width: 100vw;
      height: 100dvh;
      max-height: 100dvh;
      border-radius: 0;
    }

    .trn-meter-modal-header {
      padding: 0.9rem 1rem;
    }

    .trn-meter-modal-body {
      padding: 0.85rem;
    }

    .trn-meter-modal-grid {
      grid-template-columns: 1fr;
    }

    .trn-meter-modal-field,
    .trn-meter-modal-field:nth-child(odd) {
      grid-column: auto;
      border-right: 0;
    }

    .trn-meter-modal-field-wide {
      grid-column: auto;
    }
  }
`;
