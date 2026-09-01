/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useEffect, useMemo, useRef, useState } from "react";
import { skipToken } from "@reduxjs/toolkit/query";
import { APIProvider, Map, useMap } from "@vis.gl/react-google-maps";
import { useNavigate, useParams } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import { useGetGeoFencesByLmQuery } from "../../redux/mapGeofencesApi";
import { useGetSalesByLmPcodeQuery } from "../../redux/salesApi";
import { useGetRegistryTrnsByLmPcodeQuery } from "../../redux/trnsApi";
import {
  formatCompactCurrencyFromCents,
  formatNumber,
  getActiveLmPcode,
  getActiveWorkbaseName,
  getMonthLabel,
} from "../sales/salesUtils";
import { buildCustomerCategoryDashboardModel } from "./customerCategoryDashboardModel";

import "./CustomerCategoryDashboardPage.css";

const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const CUSTOMER_CATEGORY_DETAIL_MAP_CENTER = { lat: -28.168, lng: 30.236 };

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "0.0%";
}

function formatSignedPercent(value) {
  if (!Number.isFinite(value)) return "NAv";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(0)}%`;
}

function Icon({ name }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };

  if (name === "target") {
    return <svg {...common}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></svg>;
  }
  if (name === "pie") {
    return <svg {...common}><path d="M12 3v9h9" /><path d="M20.4 15A9 9 0 1 1 9 3.5" /></svg>;
  }
  if (name === "sales") {
    return <svg {...common}><path d="M5 7h14M5 12h14M5 17h14" /><path d="M8 4v16M16 4v16" opacity=".4" /></svg>;
  }
  if (name === "user") {
    return <svg {...common}><circle cx="12" cy="8" r="3" /><path d="M5.5 20c.8-4 3-6 6.5-6s5.7 2 6.5 6" /></svg>;
  }
  if (name === "gps") {
    return <svg {...common}><path d="M12 21s6-5.3 6-11A6 6 0 0 0 6 10c0 5.7 6 11 6 11Z" /><circle cx="12" cy="10" r="2.4" /></svg>;
  }
  if (name === "chart") {
    return <svg {...common}><path d="M4 20V10M10 20V5M16 20v-8M22 20H2" /></svg>;
  }
  if (name === "search") {
    return <svg {...common}><circle cx="10" cy="10" r="5.5" /><path d="m14.5 14.5 5 5" /></svg>;
  }
  if (name === "arrow") {
    return <svg {...common}><path d="M19 12H5" /><path d="m10 7-5 5 5 5" /></svg>;
  }
  if (name === "trend") {
    return <svg {...common}><path d="m4 17 5-5 4 3 7-8" /><path d="M15 7h5v5" /></svg>;
  }
  if (name === "list") {
    return <svg {...common}><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>;
  }
  if (name === "info") {
    return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></svg>;
  }

  return null;
}

function KpiCard({
  label,
  value,
  detail,
  icon,
  tone = "teal",
  onClick,
  ariaLabel,
}) {
  const content = (
    <>
      <span className="customer-category-detail-kpi__icon"><Icon name={icon} /></span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      {onClick ? (
        <span className="customer-category-detail-kpi__info" aria-hidden="true">i</span>
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={`customer-category-detail-kpi customer-category-detail-kpi--${tone} customer-category-detail-kpi--interactive`}
        onClick={onClick}
        aria-label={ariaLabel || `Open information about ${label}`}
        title={`Open information about ${label}`}
      >
        {content}
      </button>
    );
  }

  return (
    <article className={`customer-category-detail-kpi customer-category-detail-kpi--${tone}`}>
      {content}
    </article>
  );
}

function DetailKpiInfoModal({ type, model, trnsLoading, trnsError, onClose }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const modalCopy = {
    categoryTotal: {
      eyebrow: "Category population context",
      title: "Category Total",
      closeLabel: "Close Category Total information",
    },
    fieldTargetShare: {
      eyebrow: "Field Target share context",
      title: "% of Field Target",
      closeLabel: "Close Field Target share information",
    },
    purchases: {
      eyebrow: "Category purchase context",
      title: model.latestMonthKey ? `${getMonthLabel(model.latestMonthKey)} Purchases` : "Latest Month Purchases",
      closeLabel: "Close category purchase information",
    },
    fieldVisits: {
      eyebrow: "Field coverage context",
      title: "Field Visits",
      closeLabel: "Close Field Visits information",
    },
    gps: {
      eyebrow: "GPS readiness context",
      title: "GPS Ready",
      closeLabel: "Close GPS Ready information",
    },
  }[type];

  if (!modalCopy) return null;

  const titleId = `customer-category-detail-${type}-info-title`;
  const coverageUnavailable = Boolean(trnsError);
  const formatCoverageCount = (value) => (
    coverageUnavailable || trnsLoading ? "—" : formatNumber(value)
  );

  return (
    <div
      className="customer-category-detail-info-modal__backdrop"
      onMouseDown={onClose}
      role="presentation"
    >
      <section
        className="customer-category-detail-info-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="customer-category-detail-info-modal__close"
          onClick={onClose}
          aria-label={modalCopy.closeLabel}
        >
          ×
        </button>

        <div className="customer-category-detail-info-modal__heading">
          <span>{modalCopy.eyebrow}</span>
          <h3 id={titleId}>{modalCopy.title}</h3>
        </div>

        {type === "categoryTotal" ? (
          <>
            <div className="customer-category-detail-info-modal__section">
              <div className="customer-category-detail-info-modal__metric">
                <span>{model.categoryLabel}</span>
                <strong>{formatNumber(model.categoryTotal)}</strong>
              </div>
              <p>
                This is the current authoritative Sales population classified as {model.shortCode}.
                Normal meters and meters belonging to other customer categories are excluded.
              </p>
            </div>

            <div className="customer-category-detail-info-modal__section">
              <div className="customer-category-detail-info-modal__section-title">Field Target context</div>
              <div className="customer-category-detail-info-modal__breakdown">
                <div className="customer-category-detail-info-modal__breakdown-row">
                  <span>{model.shortCode} meters</span>
                  <strong>{formatNumber(model.categoryTotal)}</strong>
                </div>
                <div className="customer-category-detail-info-modal__breakdown-row">
                  <span>Total Field Target</span>
                  <strong>{formatNumber(model.fieldTarget)}</strong>
                </div>
                <div className="customer-category-detail-info-modal__breakdown-total">
                  <span>Share of Field Target</span>
                  <strong>{formatPercent(model.fieldTargetShare)}</strong>
                </div>
              </div>
            </div>
          </>
        ) : null}

        {type === "fieldTargetShare" ? (
          <>
            <div className="customer-category-detail-info-modal__section">
              <div className="customer-category-detail-info-modal__metric">
                <span>{model.shortCode} share of Field Target</span>
                <strong>{formatPercent(model.fieldTargetShare)}</strong>
              </div>
              <p>
                This percentage shows how much of the complete non-Normal Sales Field Target
                currently belongs to {model.shortCode}.
              </p>
            </div>

            <div className="customer-category-detail-info-modal__section">
              <div className="customer-category-detail-info-modal__section-title">Field Target calculation</div>
              <div className="customer-category-detail-info-modal__breakdown">
                <div className="customer-category-detail-info-modal__breakdown-row">
                  <span>{model.shortCode}</span>
                  <strong>{formatNumber(model.categoryTotal)} meters</strong>
                </div>
                <div className="customer-category-detail-info-modal__breakdown-row">
                  <span>Field Target</span>
                  <strong>{formatNumber(model.fieldTarget)} meters</strong>
                </div>
                <div className="customer-category-detail-info-modal__breakdown-total">
                  <span>{formatNumber(model.categoryTotal)} ÷ {formatNumber(model.fieldTarget)}</span>
                  <strong>{formatPercent(model.fieldTargetShare)}</strong>
                </div>
              </div>
              <p>
                The Field Target contains CAT1, CAT2, CAT3, CAT4, CAT5, CAT6 and CAT8 only.
                Normal Sales meters are excluded.
              </p>
            </div>
          </>
        ) : null}

        {type === "purchases" ? (
          <>
            <div className="customer-category-detail-info-modal__section">
              <div className="customer-category-detail-info-modal__metric">
                <span>{model.latestMonthKey ? getMonthLabel(model.latestMonthKey) : "Latest month"} purchases</span>
                <strong>{formatCompactCurrencyFromCents(model.latestMonthSalesC)}</strong>
              </div>
              <p>
                This is the total authoritative purchase value recorded for {model.shortCode}
                meters for the latest available Sales month.
              </p>
            </div>

            <div className="customer-category-detail-info-modal__section">
              <div className="customer-category-detail-info-modal__section-title">3-month category purchase context</div>
              <div className="customer-category-detail-info-modal__breakdown">
                {model.purchaseMonths.map((month) => (
                  <div className="customer-category-detail-info-modal__breakdown-row" key={month.key}>
                    <span>{getMonthLabel(month.key)}</span>
                    <strong>{formatCompactCurrencyFromCents(month.categorySalesC)}</strong>
                  </div>
                ))}
                <div className="customer-category-detail-info-modal__breakdown-total">
                  <span>Latest month vs previous month</span>
                  <strong>{formatSignedPercent(model.latestVsPreviousPercent)}</strong>
                </div>
              </div>
              <p>
                Purchase values shown here are category-specific; they are not total municipal
                purchase values. As authoritative historical category snapshots become available,
                each month will use that month's category population.
              </p>
            </div>
          </>
        ) : null}

        {type === "fieldVisits" ? (
          <>
            <div className="customer-category-detail-info-modal__section">
              <div className="customer-category-detail-info-modal__metric">
                <span>Field Visits</span>
                <strong>{formatCoverageCount(model.fieldCoverage.visited)}</strong>
              </div>
              <p>
                A Field Visit is counted where a TRN can be authoritatively linked by meter
                identity to a Sales meter currently in {model.shortCode}.
              </p>
              {coverageUnavailable ? (
                <small>The live TRN stream is currently unavailable, so field coverage values cannot be confirmed.</small>
              ) : null}
            </div>

            <div className="customer-category-detail-info-modal__section">
              <div className="customer-category-detail-info-modal__section-title">Coverage and findings</div>
              <div className="customer-category-detail-info-modal__breakdown">
                <div className="customer-category-detail-info-modal__breakdown-row">
                  <span>Category population</span>
                  <strong>{formatNumber(model.categoryTotal)}</strong>
                </div>
                <div className="customer-category-detail-info-modal__breakdown-row">
                  <span>Visited</span>
                  <strong>{formatCoverageCount(model.fieldCoverage.visited)}</strong>
                </div>
                <div className="customer-category-detail-info-modal__breakdown-row">
                  <span>Not Visited</span>
                  <strong>{formatCoverageCount(model.fieldCoverage.notVisited)}</strong>
                </div>
                <div className="customer-category-detail-info-modal__breakdown-row">
                  <span>Discoveries / Verifications</span>
                  <strong>{formatCoverageCount(model.fieldCoverage.discoveries)}</strong>
                </div>
                <div className="customer-category-detail-info-modal__breakdown-row">
                  <span>Meter OK</span>
                  <strong>{formatCoverageCount(model.fieldCoverage.meterOk)}</strong>
                </div>
                <div className="customer-category-detail-info-modal__breakdown-row">
                  <span>Meter Faulty</span>
                  <strong>{formatCoverageCount(model.fieldCoverage.meterFaulty)}</strong>
                </div>
                <div className="customer-category-detail-info-modal__breakdown-row">
                  <span>Meter Damaged</span>
                  <strong>{formatCoverageCount(model.fieldCoverage.meterDamaged)}</strong>
                </div>
                <div className="customer-category-detail-info-modal__breakdown-row">
                  <span>Illegally Connected</span>
                  <strong>{formatCoverageCount(model.fieldCoverage.illegallyConnected)}</strong>
                </div>
              </div>
              <p>
                Field Visits do not mean that a Sales meter is Completed. Sales completion is
                governed separately by the authoritative Sales + Meter Registry + AST reconciliation rule.
                Only No Access activity that can be authoritatively linked to the category is counted;
                unlinked No Access activity is not inferred.
              </p>
            </div>
          </>
        ) : null}

        {type === "gps" ? (
          <>
            <div className="customer-category-detail-info-modal__section">
              <div className="customer-category-detail-info-modal__metric">
                <span>GPS Ready</span>
                <strong>{formatPercent(model.gpsReadyShare)}</strong>
              </div>
              <p>
                {formatNumber(model.gpsReady)} of {formatNumber(model.categoryTotal)} {model.shortCode}
                meters have usable Sales GPS coordinates.
              </p>
            </div>

            <div className="customer-category-detail-info-modal__section">
              <div className="customer-category-detail-info-modal__section-title">GPS coverage</div>
              <div className="customer-category-detail-info-modal__breakdown">
                <div className="customer-category-detail-info-modal__breakdown-row">
                  <span>With GPS</span>
                  <strong>{formatNumber(model.gpsReady)} · {formatPercent(model.gpsReadyShare)}</strong>
                </div>
                <div className="customer-category-detail-info-modal__breakdown-row">
                  <span>Without GPS</span>
                  <strong>{formatNumber(model.gpsWithout)} · {formatPercent(100 - model.gpsReadyShare)}</strong>
                </div>
                <div className="customer-category-detail-info-modal__breakdown-total">
                  <span>Category Total</span>
                  <strong>{formatNumber(model.categoryTotal)}</strong>
                </div>
              </div>
              <p>
                GPS Ready means the Sales record contains usable coordinates for mapping and
                geofence analysis. It does not indicate whether fieldwork has started or whether
                the meter is Completed.
              </p>
            </div>
          </>
        ) : null}

        <div className="customer-category-detail-info-modal__actions">
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}

function PurchaseTrendPanel({ model }) {
  const meterCounts = model.purchaseMonths
    .map((month) => Number(month.categoryMeterCount))
    .filter((value, index) => model.purchaseMonths[index]?.categoryMeterCountAvailable && Number.isFinite(value));
  const maxMeterCount = Math.max(1, ...meterCounts);
  const maxCategorySalesC = Math.max(
    1,
    ...model.purchaseMonths.map((month) => Number(month.categorySalesC || 0)),
  );
  const maxMunicipalSalesC = Math.max(
    1,
    ...model.purchaseMonths.map((month) => Number(month.municipalSalesC || 0)),
  );

  const getHeight = (value, maxValue) =>
    Math.max(Number(value) > 0 ? 7 : 0, (Number(value || 0) / maxValue) * 100);

  return (
    <article className="customer-category-detail-panel customer-category-detail-panel--purchases">
      <div className="customer-category-detail-panel__title">
        <div>
          <span className="customer-category-detail-panel__icon customer-category-detail-panel__icon--blue"><Icon name="chart" /></span>
          <div>
            <h3>Purchase Trend &amp; Recovery</h3>
            <p>Rolling 3-month category population and purchases for {model.shortCode}</p>
          </div>
        </div>
      </div>

      {model.purchaseMonths.length ? (
        <>
          <div className="customer-category-detail-purchase-chart customer-category-detail-purchase-chart--grouped">
            <div className="customer-category-detail-purchase-groups">
              {model.purchaseMonths.map((month) => {
                const meterAvailable = month.categoryMeterCountAvailable;
                return (
                  <div className="customer-category-detail-purchase-group" key={month.key}>
                    <div className="customer-category-detail-purchase-group__bars">
                      <div className="customer-category-detail-purchase-series customer-category-detail-purchase-series--meters">
                        <strong>{meterAvailable ? formatNumber(month.categoryMeterCount) : "—"}</strong>
                        <div className={meterAvailable ? "" : "is-unavailable"}>
                          <i style={{ height: meterAvailable ? `${getHeight(month.categoryMeterCount, maxMeterCount)}%` : "0%" }} />
                        </div>
                      </div>
                      <div className="customer-category-detail-purchase-series customer-category-detail-purchase-series--category">
                        <strong>{formatCompactCurrencyFromCents(month.categorySalesC)}</strong>
                        <div>
                          <i style={{ height: `${getHeight(month.categorySalesC, maxCategorySalesC)}%` }} />
                        </div>
                      </div>
                      <div className="customer-category-detail-purchase-series customer-category-detail-purchase-series--municipal">
                        <strong>{formatCompactCurrencyFromCents(month.municipalSalesC)}</strong>
                        <div>
                          <i style={{ height: `${getHeight(month.municipalSalesC, maxMunicipalSalesC)}%` }} />
                        </div>
                      </div>
                    </div>
                    <span>{getMonthLabel(month.key)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="customer-category-detail-purchase-legend" aria-label="Purchase Trend legend">
            <span><i className="meters" />CAT meters</span>
            <span><i className="category" />CAT purchases</span>
            <span><i className="municipal" />Municipal prepaid purchases</span>
          </div>

          <aside className="customer-category-detail-purchase-summary customer-category-detail-purchase-summary--compact">
            <div>
              <span>Latest CAT meters</span>
              <small>{model.latestMonthKey ? getMonthLabel(model.latestMonthKey) : "NAv"}</small>
              <strong>{model.latestCategoryMeterCount === null ? "—" : formatNumber(model.latestCategoryMeterCount)}</strong>
            </div>
            <div>
              <span>Latest CAT purchases</span>
              <small>{model.latestMonthKey ? getMonthLabel(model.latestMonthKey) : "NAv"}</small>
              <strong>{formatCompactCurrencyFromCents(model.latestMonthSalesC)}</strong>
            </div>
            <div>
              <span>Latest municipal purchases</span>
              <small>{model.latestMonthKey ? getMonthLabel(model.latestMonthKey) : "NAv"}</small>
              <strong>{formatCompactCurrencyFromCents(model.latestMunicipalSalesC)}</strong>
            </div>
            <div className={Number(model.latestVsPreviousPercent) >= 0 ? "positive" : "negative"}>
              <span>CAT purchases vs previous month</span>
              <strong>{formatSignedPercent(model.latestVsPreviousPercent)}</strong>
            </div>
          </aside>

          <p className="customer-category-detail-purchase-note">
            CAT meter counts are shown only where the monthly category snapshot is authoritative. The current Sales category snapshot is anchored to its latest sales period; earlier monthly counts are not inferred. Municipal purchases use the full prepaid Sales population for the month.
          </p>
        </>
      ) : (
        <p className="customer-category-detail-empty">No monthly Sales values are available from Apr 2026 onward.</p>
      )}
    </article>
  );
}

function FieldCoveragePanel({ model, trnsLoading, trnsError }) {
  const maxCount = Math.max(1, model.categoryTotal);

  const renderCoverageRow = (row, className = "") => {
    const numericCount = Number(row.count);
    const hasCount = row.count !== null && row.count !== undefined && Number.isFinite(numericCount);
    const width = hasCount
      ? Math.max(numericCount > 0 ? 2 : 0, (numericCount / maxCount) * 100)
      : 0;

    return (
      <div
        className={`customer-category-detail-coverage-row${className ? ` ${className}` : ""}`}
        key={row.key}
      >
        <span>{row.label}</span>
        <div><i className={`tone-${row.tone}`} style={{ width: `${width}%` }} /></div>
        <strong>{hasCount ? formatNumber(numericCount) : "—"}</strong>
      </div>
    );
  };

  return (
    <article className="customer-category-detail-panel customer-category-detail-panel--coverage">
      <div className="customer-category-detail-panel__title">
        <div>
          <span className="customer-category-detail-panel__icon"><Icon name="user" /></span>
          <div>
            <h3>Field Coverage &amp; Findings</h3>
            <p>Meter-linked TRN activity for the current category population</p>
          </div>
        </div>
      </div>

      {trnsLoading ? (
        <div className="customer-category-detail-warning">
          <Icon name="info" />
          <span>Loading the live TRN stream for meter-linked field coverage.</span>
        </div>
      ) : trnsError ? (
        <div className="customer-category-detail-warning">
          <Icon name="info" />
          <span>The live TRN stream is unavailable. Sales-backed category metrics remain live.</span>
        </div>
      ) : (
        <div className="customer-category-detail-coverage-list">
          {model.fieldCoverage.rows.slice(0, 6).map((row) => renderCoverageRow(row))}
          <span className="customer-category-detail-coverage-heading">Meter Discovery findings</span>
          {model.fieldCoverage.rows.slice(6, 10).map((row) =>
            renderCoverageRow(row, "customer-category-detail-coverage-row--finding"),
          )}
          {model.fieldCoverage.rows.slice(10).map((row) =>
            renderCoverageRow(row, "customer-category-detail-coverage-row--outcome"),
          )}
        </div>
      )}

      <p className="customer-category-detail-footnote">
        Coverage is attributed only where a TRN carries a meter number matching a meter in this category. Meter Discovery findings use only the main anomaly value: Meter OK, Meter Faulty, Meter Damaged or Illegally Connected. Returned to Normal remains unavailable until historical category snapshots are authoritative.
      </p>
    </article>
  );
}

function escapeMapHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseMapGeometry(geometry) {
  if (!geometry) return null;

  if (typeof geometry === "string") {
    try {
      return JSON.parse(geometry);
    } catch (error) {
      console.error("Could not parse Individual Category geofence geometry:", error);
      return null;
    }
  }

  return geometry;
}

function geoJsonPolygonToGooglePaths(geometry) {
  if (!geometry) return [];

  if (geometry.type === "Polygon") {
    return geometry.coordinates.map((ring) =>
      ring.map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) })),
    );
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.flatMap((polygon) =>
      polygon.map((ring) =>
        ring.map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) })),
      ),
    );
  }

  return [];
}

function geofenceToGooglePaths(geofence = {}) {
  if (Array.isArray(geofence?.points)) {
    const ring = geofence.points
      .map((point) => ({
        lat: Number(point?.latitude ?? point?.lat),
        lng: Number(point?.longitude ?? point?.lng),
      }))
      .filter(
        (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng),
      );

    if (ring.length >= 3) return [ring];
  }

  return geoJsonPolygonToGooglePaths(parseMapGeometry(geofence?.geometry));
}

function getGeofenceWardPcode(geofence = {}) {
  return (
    geofence?.wardPcode ||
    geofence?.parents?.wardPcode ||
    geofence?.parents?.wardId ||
    ""
  );
}

function getGeofenceWardLabel(geofence = {}) {
  const explicit = String(
    geofence?.wardName || geofence?.wardNo || geofence?.wardNumber || "",
  ).trim();
  if (explicit) {
    return explicit.toUpperCase().startsWith("WARD")
      ? explicit
      : `Ward ${explicit}`;
  }

  const wardPcode = String(getGeofenceWardPcode(geofence)).trim();
  const match = wardPcode.match(/(\d{3})$/);
  return match ? `Ward ${match[1]}` : wardPcode || "Ward NAv";
}

function fitMapToGeofencePaths(map, pathGroups = []) {
  if (!map || !window.google?.maps || pathGroups.length === 0) return false;

  const bounds = new window.google.maps.LatLngBounds();
  let pointCount = 0;

  pathGroups.forEach((paths) => {
    paths.forEach((ring) => {
      ring.forEach((point) => {
        if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) return;
        bounds.extend(point);
        pointCount += 1;
      });
    });
  });

  if (pointCount === 0) return false;

  map.fitBounds(bounds, 30);
  return true;
}

function CustomerCategoryDetailGeofenceLayer({
  geofences,
  geofenceCounts,
  selectedGeofenceId,
  hoveredGeofenceId,
  onSelectGeofence,
  shortCode,
}) {
  const map = useMap();
  const polygonsRef = useRef([]);
  const infoWindowRef = useRef(null);

  useEffect(() => {
    if (!map || !window.google?.maps) return undefined;

    polygonsRef.current.forEach((polygon) => polygon.setMap(null));
    polygonsRef.current = [];

    if (infoWindowRef.current) {
      infoWindowRef.current.close();
      infoWindowRef.current = null;
    }

    if (!Array.isArray(geofences) || geofences.length === 0) return undefined;

    const maxCount = Math.max(
      1,
      ...geofences.map((geofence) => Number(geofenceCounts.get(geofence.id) || 0)),
    );
    const infoWindow = new window.google.maps.InfoWindow();
    infoWindowRef.current = infoWindow;
    const allPathGroups = [];
    let selectedPathGroups = null;

    const polygons = geofences.flatMap((geofence) => {
      const paths = geofenceToGooglePaths(geofence);
      if (paths.length === 0) return [];

      const count = Number(geofenceCounts.get(geofence.id) || 0);
      const density = Math.max(0, Math.min(1, count / maxCount));
      const baseFillOpacity = 0.1 + density * 0.38;
      const isSelected = geofence.id === selectedGeofenceId;
      const label = geofence?.name || geofence?.id || "Geofence";
      const wardLabel = getGeofenceWardLabel(geofence);

      allPathGroups.push(paths);
      if (isSelected) selectedPathGroups = [paths];

      return paths.map((ring) => {
        const polygon = new window.google.maps.Polygon({
          paths: ring,
          strokeColor: isSelected ? "#0f766e" : "#0f9f95",
          strokeOpacity: isSelected ? 1 : 0.82,
          strokeWeight: isSelected ? 4 : 2,
          fillColor: "#0f9f95",
          fillOpacity: isSelected ? Math.min(0.58, baseFillOpacity + 0.12) : baseFillOpacity,
          clickable: true,
          zIndex: isSelected ? 60 : 40,
        });

        polygon.__irepsGeofenceId = geofence.id;
        polygon.__irepsBaseFillOpacity = baseFillOpacity;

        polygon.addListener("mouseover", () => {
          polygon.setOptions({
            strokeWeight: isSelected ? 4 : 3,
            fillOpacity: Math.min(0.62, baseFillOpacity + 0.1),
          });
        });

        polygon.addListener("mouseout", () => {
          polygon.setOptions({
            strokeWeight: isSelected ? 4 : 2,
            fillOpacity: isSelected
              ? Math.min(0.58, baseFillOpacity + 0.12)
              : baseFillOpacity,
          });
        });

        polygon.addListener("click", (event) => {
          onSelectGeofence?.(geofence.id);
          infoWindow.setContent(`
            <div style="font-family: Arial, sans-serif; min-width: 190px;">
              <strong>${escapeMapHtml(label)}</strong>
              <div style="margin-top: 6px;">${escapeMapHtml(wardLabel)}</div>
              <div>${escapeMapHtml(shortCode)} meters: <strong>${escapeMapHtml(formatNumber(count))}</strong></div>
            </div>
          `);
          infoWindow.setPosition(event.latLng);
          infoWindow.open({ map, shouldFocus: false });
        });

        polygon.setMap(map);
        return polygon;
      });
    });

    polygonsRef.current = polygons;

    if (selectedPathGroups?.length) {
      fitMapToGeofencePaths(map, selectedPathGroups);
    } else {
      fitMapToGeofencePaths(map, allPathGroups);
    }

    return () => {
      infoWindow.close();
      polygonsRef.current.forEach((polygon) => polygon.setMap(null));
      polygonsRef.current = [];
      infoWindowRef.current = null;
    };
  }, [geofenceCounts, geofences, map, onSelectGeofence, selectedGeofenceId, shortCode]);

  useEffect(() => {
    polygonsRef.current.forEach((polygon) => {
      const geofenceId = polygon.__irepsGeofenceId || "";
      const baseFillOpacity = Number(polygon.__irepsBaseFillOpacity || 0.1);
      const isSelected = geofenceId === selectedGeofenceId;
      const isHovered = geofenceId === hoveredGeofenceId;

      polygon.setOptions({
        strokeColor: isSelected ? "#0f766e" : isHovered ? "#0b6f69" : "#0f9f95",
        strokeOpacity: isSelected || isHovered ? 1 : 0.82,
        strokeWeight: isSelected ? 4 : isHovered ? 4 : 2,
        fillOpacity: isSelected
          ? Math.min(0.58, baseFillOpacity + 0.12)
          : isHovered
            ? Math.min(0.66, baseFillOpacity + 0.18)
            : baseFillOpacity,
        zIndex: isSelected ? 60 : isHovered ? 55 : 40,
      });
    });
  }, [hoveredGeofenceId, selectedGeofenceId]);

  return null;
}

function GeographyPanel({
  model,
  geofences = [],
  isGeofencesLoading = false,
  isGeofencesFetching = false,
  geofencesError = null,
}) {
  const [selectedGeofenceId, setSelectedGeofenceId] = useState("");
  const [hoveredGeofenceId, setHoveredGeofenceId] = useState("");
  const maxGeofence = Math.max(
    1,
    ...model.topGeofences.map((geofence) => Number(geofence.count || 0)),
  );

  const geofenceMetaById = useMemo(
    () => new globalThis.Map(
      (Array.isArray(geofences) ? geofences : [])
        .filter((geofence) => geofence?.id)
        .map((geofence) => [geofence.id, geofence]),
    ),
    [geofences],
  );

  const groupedGeofences = useMemo(() => {
    const groups = new globalThis.Map();

    model.topGeofences.forEach((geofence) => {
      const source = geofenceMetaById.get(geofence.key);
      const sourceWardLabel = source ? getGeofenceWardLabel(source) : "";
      const sourceWardMatch = String(sourceWardLabel).match(/(\d{1,3})$/);
      const labelWardMatch = String(geofence.label || "").match(/\bW\s*0*(\d{1,3})\b/i);
      const wardNumber = sourceWardMatch
        ? Number(sourceWardMatch[1])
        : labelWardMatch
          ? Number(labelWardMatch[1])
          : null;
      const wardLabel = Number.isFinite(wardNumber)
        ? `Ward ${String(wardNumber).padStart(3, "0")}`
        : sourceWardLabel && sourceWardLabel !== "Ward NAv"
          ? sourceWardLabel
          : "Ward N/A";
      const groupKey = Number.isFinite(wardNumber)
        ? `ward-${String(wardNumber).padStart(3, "0")}`
        : `ward-other-${wardLabel}`;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          key: groupKey,
          label: wardLabel,
          sortOrder: Number.isFinite(wardNumber)
            ? wardNumber
            : Number.MAX_SAFE_INTEGER,
          geofences: [],
        });
      }

      groups.get(groupKey).geofences.push(geofence);
    });

    return Array.from(groups.values())
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          left.label.localeCompare(right.label, undefined, {
            numeric: true,
            sensitivity: "base",
          }),
      )
      .map((group) => ({
        ...group,
        geofences: [...group.geofences].sort((left, right) =>
          String(left.label || "").localeCompare(
            String(right.label || ""),
            undefined,
            { numeric: true, sensitivity: "base" },
          ),
        ),
      }));
  }, [geofenceMetaById, model.topGeofences]);

  const geofenceCounts = useMemo(
    () => new globalThis.Map(
      model.topGeofences.map((geofence) => [
        geofence.key,
        Number(geofence.count || 0),
      ]),
    ),
    [model.topGeofences],
  );

  const mappedCategoryGeofences = useMemo(() => {
    const targetIds = new Set(model.topGeofences.map((geofence) => geofence.key));
    return (Array.isArray(geofences) ? geofences : []).filter(
      (geofence) => geofence?.id && targetIds.has(geofence.id),
    );
  }, [geofences, model.topGeofences]);

  const selectedGeofence = model.topGeofences.find(
    (geofence) => geofence.key === selectedGeofenceId,
  );

  return (
    <article className="customer-category-detail-panel customer-category-detail-panel--geography">
      <div className="customer-category-detail-panel__title">
        <div>
          <span className="customer-category-detail-panel__icon"><Icon name="gps" /></span>
          <div>
            <h3>Geography &amp; Geofences</h3>
            <p>Where {model.shortCode} meters are concentrated</p>
          </div>
        </div>
      </div>

      <div className="customer-category-detail-geography">
        <div className="customer-category-detail-geofence-list">
          <span className="customer-category-detail-section-label">Geofences by ward</span>
          <div className="customer-category-detail-geofence-scroll">
            {groupedGeofences.length ? groupedGeofences.map((wardGroup) => (
              <div className="customer-category-detail-ward-group" key={wardGroup.key}>
                <div className="customer-category-detail-ward-heading">{wardGroup.label}</div>
                {wardGroup.geofences.map((geofence) => (
                  <button
                    type="button"
                    className={`customer-category-detail-geofence-row${selectedGeofenceId === geofence.key ? " is-selected" : ""}`}
                    key={geofence.key}
                    onMouseEnter={() => setHoveredGeofenceId(geofence.key)}
                    onMouseLeave={() => setHoveredGeofenceId((current) => current === geofence.key ? "" : current)}
                    onFocus={() => setHoveredGeofenceId(geofence.key)}
                    onBlur={() => setHoveredGeofenceId((current) => current === geofence.key ? "" : current)}
                    onClick={() => setSelectedGeofenceId((current) => current === geofence.key ? "" : geofence.key)}
                    aria-pressed={selectedGeofenceId === geofence.key}
                    title={`Focus ${geofence.label} on map`}
                  >
                    <span title={geofence.label}>{geofence.label}</span>
                    <div><i style={{ width: `${Math.max(4, (geofence.count / maxGeofence) * 100)}%` }} /></div>
                    <strong>{formatNumber(geofence.count)}</strong>
                  </button>
                ))}
              </div>
            )) : (
              <p className="customer-category-detail-empty">No geofence references are available for this category.</p>
            )}
          </div>
          <small>Counts reflect {model.shortCode} Sales meter membership in each geofence.</small>
        </div>

        <aside className="customer-category-detail-geography-summary">
          <div>
            <span>With GPS</span>
            <strong>{formatNumber(model.gpsReady)}</strong>
            <small>{formatPercent(model.gpsReadyShare)}</small>
          </div>
          <div>
            <span>Without GPS</span>
            <strong>{formatNumber(model.gpsWithout)}</strong>
            <small>{formatPercent(100 - model.gpsReadyShare)}</small>
          </div>
          {model.topWards[0] ? (
            <div>
              <span>Top Ward</span>
              <strong className="ward">{model.topWards[0].label}</strong>
              <small>{formatNumber(model.topWards[0].count)} meter links</small>
            </div>
          ) : null}
        </aside>
      </div>

      <div className="customer-category-detail-geography-map">
        <div className="customer-category-detail-geography-map__heading">
          <div>
            <strong>{model.shortCode} geofence density</strong>
            <span>Actual iREPS geofence polygons · stronger fill means more {model.shortCode} meters</span>
          </div>
          {selectedGeofence ? (
            <button type="button" onClick={() => setSelectedGeofenceId("")}>
              {selectedGeofence.label} · {formatNumber(selectedGeofence.count)}
              <span aria-hidden="true">×</span>
            </button>
          ) : (
            <span className="customer-category-detail-geography-map__all">All mapped geofences</span>
          )}
        </div>

        {!googleMapsApiKey ? (
          <div className="customer-category-detail-geography-map__state">
            Google Maps key is not available in this web environment.
          </div>
        ) : geofencesError ? (
          <div className="customer-category-detail-geography-map__state customer-category-detail-geography-map__state--error">
            Geofence geometry could not be loaded for this workbase.
          </div>
        ) : isGeofencesLoading && mappedCategoryGeofences.length === 0 ? (
          <div className="customer-category-detail-geography-map__state">
            Loading mapped geofences…
          </div>
        ) : mappedCategoryGeofences.length === 0 ? (
          <div className="customer-category-detail-geography-map__state">
            No {model.shortCode} geofence polygons are available for this workbase.
          </div>
        ) : (
          <div className="customer-category-detail-geography-map__canvas">
            <APIProvider apiKey={googleMapsApiKey}>
              <Map
                defaultCenter={CUSTOMER_CATEGORY_DETAIL_MAP_CENTER}
                defaultZoom={11}
                mapTypeId="roadmap"
                gestureHandling="cooperative"
                disableDefaultUI={false}
                style={{ width: "100%", height: "100%" }}
              >
                <CustomerCategoryDetailGeofenceLayer
                  geofences={mappedCategoryGeofences}
                  geofenceCounts={geofenceCounts}
                  selectedGeofenceId={selectedGeofenceId}
                  hoveredGeofenceId={hoveredGeofenceId}
                  onSelectGeofence={setSelectedGeofenceId}
                  shortCode={model.shortCode}
                />
              </Map>
            </APIProvider>
            {isGeofencesFetching ? (
              <span className="customer-category-detail-geography-map__sync">Syncing geography…</span>
            ) : null}
          </div>
        )}

        <div className="customer-category-detail-geography-map__legend" aria-label={`${model.shortCode} geofence density legend`}>
          <span>Lower density</span>
          <i style={{ opacity: 0.18 }} />
          <i style={{ opacity: 0.28 }} />
          <i style={{ opacity: 0.38 }} />
          <i style={{ opacity: 0.48 }} />
          <i style={{ opacity: 0.58 }} />
          <span>Higher density</span>
        </div>
      </div>
    </article>
  );
}

function OutcomesPanel({ model }) {
  return (
    <article className="customer-category-detail-panel customer-category-detail-panel--outcomes">
      <div className="customer-category-detail-panel__title">
        <div>
          <span className="customer-category-detail-panel__icon customer-category-detail-panel__icon--blue"><Icon name="trend" /></span>
          <div>
            <h3>Intervention Outcomes</h3>
            <p>What changed after field intervention in {model.shortCode}</p>
          </div>
        </div>
      </div>

      <div className="customer-category-detail-outcomes">
        {model.outcomes.map((row) => (
          <div key={row.key}>
            <span>{row.label}</span>
            <strong>—</strong>
          </div>
        ))}
      </div>

      <div className="customer-category-detail-outcomes-note">
        <Icon name="info" />
        <span>V1 does not fabricate outcomes. These metrics require authoritative historical category snapshots and agreed intervention-outcome rules.</span>
      </div>
    </article>
  );
}

function DrilldownPanel({ model }) {
  const items = [
    ["Meters in Category", `${formatNumber(model.categoryTotal)} current meters`],
    ["TRNs & Findings", `${formatNumber(model.fieldCoverage.linkedTrnCount)} linked TRNs`],
    ["Purchases by Month", `${formatNumber(model.purchaseMonths.length)} latest loaded months`],
    ["Geofence Performance", `${formatNumber(model.topGeofences.length)} referenced geofences`],
  ];

  return (
    <article className="customer-category-detail-panel customer-category-detail-panel--drilldown">
      <div className="customer-category-detail-panel__title">
        <div>
          <span className="customer-category-detail-panel__icon customer-category-detail-panel__icon--blue"><Icon name="search" /></span>
          <div>
            <h3>Detailed Drill-down</h3>
            <p>Operational routes prepared for the next phase</p>
          </div>
        </div>
      </div>

      <div className="customer-category-detail-drilldown-list">
        {items.map(([label, detail], index) => (
          <div key={label} className={`tone-${index + 1}`}>
            <span><Icon name="list" /></span>
            <div>
              <strong>{label}</strong>
              <small>{detail}</small>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function StateCard({ title, detail, error = false, onBack }) {
  return (
    <section className={`customer-category-detail-state${error ? " error" : ""}`}>
      <div>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
      {onBack ? <button type="button" onClick={onBack}>← All Categories</button> : null}
    </section>
  );
}

export default function CustomerCategoryDashboardPage() {
  const { activeWorkbase } = useAuth();
  const { categoryKey = "" } = useParams();
  const navigate = useNavigate();
  const [openKpiInfo, setOpenKpiInfo] = useState(null);
  const activeLmPcode = getActiveLmPcode(activeWorkbase);
  const activeWorkbaseName = getActiveWorkbaseName(activeWorkbase);

  const {
    data: salesRows = [],
    isLoading: salesLoading,
    isFetching: salesFetching,
    error: salesError,
  } = useGetSalesByLmPcodeQuery(activeLmPcode || skipToken);

  const {
    data: trnRows = [],
    isLoading: trnsLoading,
    isFetching: trnsFetching,
    error: trnsError,
  } = useGetRegistryTrnsByLmPcodeQuery(activeLmPcode || skipToken);

  const {
    data: mapGeofences = [],
    isLoading: isMapGeofencesLoading,
    isFetching: isMapGeofencesFetching,
    error: mapGeofencesError,
  } = useGetGeoFencesByLmQuery(activeLmPcode || skipToken);

  const model = useMemo(
    () => buildCustomerCategoryDashboardModel(salesRows, trnRows, categoryKey),
    [salesRows, trnRows, categoryKey],
  );

  const goBack = () => navigate("/dashboard/customer-categories");

  if (!activeLmPcode) {
    return <div className="customer-category-detail-page"><StateCard title="No active workbase selected" detail="Select an active workbase before opening an Individual Category Dashboard." onBack={goBack} /></div>;
  }

  if (salesLoading) {
    return <div className="customer-category-detail-page"><StateCard title="Loading Individual Category..." detail="Connecting to the live Sales stream for the active workbase." /></div>;
  }

  if (salesError) {
    return <div className="customer-category-detail-page"><StateCard error title="Could not load category" detail={`The live Sales stream could not be loaded for ${activeLmPcode}.`} onBack={goBack} /></div>;
  }

  if (!model.found) {
    return <div className="customer-category-detail-page"><StateCard title="Category not found" detail="This category is not present in the current authoritative non-Normal Sales population." onBack={goBack} /></div>;
  }

  const latestPurchaseLabel = model.latestMonthKey ? `${getMonthLabel(model.latestMonthKey)} Purchases` : "Latest Purchases";

  return (
    <div className="customer-category-detail-page">
      <header className="customer-category-detail-header">
        <div>
          <p className="customer-category-detail-eyebrow">Dashboard · Customer Categories · {model.shortCode}</p>
          <div className="customer-category-detail-title-row">
            <h2>{model.shortCode} Dashboard</h2>
            <button type="button" onClick={goBack}><Icon name="arrow" /> All Categories</button>
          </div>
          <p className="customer-category-detail-authoritative">{model.categoryLabel}</p>
          <p>Live view of category performance, purchases, field coverage, geography and recovery evidence for {activeWorkbaseName}.</p>
        </div>
        <div className="customer-category-detail-live">
          <span className={salesFetching || trnsFetching ? "syncing" : ""} />
          <div>
            <strong>{salesFetching || trnsFetching ? "Syncing" : "Live Sales + TRNs"}</strong>
            <small>{activeLmPcode}</small>
          </div>
        </div>
      </header>

      <section className="customer-category-detail-kpis" aria-label="Individual Category KPIs">
        <KpiCard
          label="Category Total"
          value={formatNumber(model.categoryTotal)}
          detail={`Meters in ${model.shortCode}`}
          icon="target"
          tone="teal"
          onClick={() => setOpenKpiInfo("categoryTotal")}
        />
        <KpiCard
          label="% of Field Target"
          value={formatPercent(model.fieldTargetShare)}
          detail={`Share of ${formatNumber(model.fieldTarget)}`}
          icon="pie"
          tone="blue"
          onClick={() => setOpenKpiInfo("fieldTargetShare")}
        />
        <KpiCard
          label={latestPurchaseLabel}
          value={formatCompactCurrencyFromCents(model.latestMonthSalesC)}
          detail="Current category meters"
          icon="sales"
          tone="orange"
          onClick={() => setOpenKpiInfo("purchases")}
        />
        <KpiCard
          label="Field Visits"
          value={trnsError ? "—" : trnsLoading ? "…" : formatNumber(model.fieldCoverage.visited)}
          detail="Meters with linked TRNs"
          icon="user"
          tone="teal"
          onClick={() => setOpenKpiInfo("fieldVisits")}
        />
        <KpiCard
          label="GPS Ready"
          value={formatPercent(model.gpsReadyShare)}
          detail={`${formatNumber(model.gpsReady)} usable GPS`}
          icon="gps"
          tone="teal"
          onClick={() => setOpenKpiInfo("gps")}
        />
      </section>

      <section className="customer-category-detail-main-grid">
        <PurchaseTrendPanel model={model} />
        <FieldCoveragePanel model={model} trnsLoading={trnsLoading} trnsError={trnsError} />
      </section>

      <section className="customer-category-detail-bottom-grid">
        <GeographyPanel
          model={model}
          geofences={mapGeofences}
          isGeofencesLoading={isMapGeofencesLoading}
          isGeofencesFetching={isMapGeofencesFetching}
          geofencesError={mapGeofencesError}
        />
        <OutcomesPanel model={model} />
        <DrilldownPanel model={model} />
      </section>

      {openKpiInfo ? (
        <DetailKpiInfoModal
          type={openKpiInfo}
          model={model}
          trnsLoading={trnsLoading}
          trnsError={trnsError}
          onClose={() => setOpenKpiInfo(null)}
        />
      ) : null}

      <footer className="customer-category-detail-footer">
        <span>Authoritative category source: live Sales · TRN coverage: live registry stream linked by meter number.</span>
        <span>{model.categoryLabel}</span>
      </footer>
    </div>
  );
}
