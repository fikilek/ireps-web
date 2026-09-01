/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useEffect, useMemo, useRef, useState } from "react";
import { skipToken } from "@reduxjs/toolkit/query";
import { APIProvider, Map, useMap } from "@vis.gl/react-google-maps";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import { useGetAstsByLmPcodeQuery } from "../../redux/astsApi";
import { useGetRegistryMetersByLmQuery } from "../../redux/registryMetersApi";
import { useGetGeoFencesByLmQuery } from "../../redux/mapGeofencesApi";
import { useGetSalesByLmPcodeQuery } from "../../redux/salesApi";
import {
  formatCompactCurrencyFromCents,
  formatNumber,
  getActiveLmPcode,
  getActiveWorkbaseName,
  getMonthLabel,
} from "../sales/salesUtils";
import {
  CUSTOMER_CATEGORIES_BASELINE_PRIMARY_MONTH_KEY,
  buildCustomerCategoriesDashboardModel,
  countInvisibleOperationalMeters,
} from "./customerCategoriesDashboardModel";

import "./CustomerCategoriesDashboardPage.css";

const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const CUSTOMER_CATEGORIES_MAP_CENTER = { lat: -28.168, lng: 30.236 };

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "0.0%";
}

function formatDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-ZA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(value);
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
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      </svg>
    );
  }

  if (name === "categories") {
    return (
      <svg {...common}>
        <rect x="4" y="4" width="6" height="6" rx="1.5" />
        <rect x="14" y="4" width="6" height="6" rx="1.5" />
        <rect x="4" y="14" width="6" height="6" rx="1.5" />
        <rect x="14" y="14" width="6" height="6" rx="1.5" />
      </svg>
    );
  }

  if (name === "sales") {
    return (
      <svg {...common}>
        <path d="M5 7h14M5 12h14M5 17h14" />
        <path d="M8 4v16M16 4v16" opacity=".45" />
      </svg>
    );
  }

  if (name === "gps") {
    return (
      <svg {...common}>
        <path d="M12 21s6-5.3 6-11A6 6 0 0 0 6 10c0 5.7 6 11 6 11Z" />
        <circle cx="12" cy="10" r="2.4" />
      </svg>
    );
  }

  if (name === "chart") {
    return (
      <svg {...common}>
        <path d="M4 20V10M10 20V5M16 20v-8M22 20H2" />
      </svg>
    );
  }

  if (name === "arrow") {
    return (
      <svg {...common}>
        <path d="M5 12h14" />
        <path d="m14 7 5 5-5 5" />
      </svg>
    );
  }

  if (name === "check") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 2.5 2.5L16.5 8.5" />
      </svg>
    );
  }

  return null;
}

function KpiCard({
  label,
  value,
  detail,
  icon,
  tone,
  secondaryLabel,
  secondaryValue,
  onClick,
  ariaLabel,
}) {
  const content = (
    <>
      <span className="customer-category-kpi__icon"><Icon name={icon} /></span>
      <div className="customer-category-kpi__copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      {secondaryLabel ? (
        <div className="customer-category-kpi__secondary" aria-hidden="true">
          <span>{secondaryLabel}</span>
          <strong>{secondaryValue}</strong>
        </div>
      ) : null}
      {onClick ? (
        <span className="customer-category-kpi__info" aria-hidden="true">i</span>
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={`customer-category-kpi customer-category-kpi--${tone} customer-category-kpi--interactive`}
        onClick={onClick}
        aria-label={ariaLabel || `Open information about ${label}`}
        title={`Open information about ${label}`}
      >
        {content}
      </button>
    );
  }

  return (
    <article className={`customer-category-kpi customer-category-kpi--${tone}`}>
      {content}
    </article>
  );
}

function DashboardKpiInfoModal({
  type,
  model,
  invisibleMeters,
  reconciliationUnavailable,
  onClose,
}) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const modalCopy = {
    fieldTarget: {
      eyebrow: "Sales population context",
      title: "Field Target",
      closeLabel: "Close Field Target information",
    },
    categories: {
      eyebrow: "Sales category context",
      title: "Customer Categories",
      closeLabel: "Close Customer Categories information",
    },
    baseline: {
      eyebrow: "Purchase baseline context",
      title: "June Baseline Purchases",
      closeLabel: "Close June Baseline Purchases information",
    },
    gps: {
      eyebrow: "Geography context",
      title: "GPS Readiness",
      closeLabel: "Close GPS Readiness information",
    },
  }[type];

  if (!modalCopy) return null;

  const titleId = `customer-category-${type}-info-title`;

  return (
    <div
      className="customer-category-info-modal__backdrop"
      onMouseDown={onClose}
      role="presentation"
    >
      <section
        className="customer-category-info-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="customer-category-info-modal__close"
          onClick={onClose}
          aria-label={modalCopy.closeLabel}
        >
          ×
        </button>

        <div className="customer-category-info-modal__heading">
          <span>{modalCopy.eyebrow}</span>
          <h3 id={titleId}>{modalCopy.title}</h3>
        </div>

        {type === "fieldTarget" ? (
          <>
            <div className="customer-category-info-modal__section">
              <div className="customer-category-info-modal__metric">
                <span>Field Target</span>
                <strong>{formatNumber(model.fieldTarget)}</strong>
              </div>
              <p>
                The Field Target consists of all authoritative Sales meters currently
                classified in CAT1, CAT2, CAT3, CAT4, CAT5, CAT6 or CAT8. Normal
                Sales meters are excluded.
              </p>
            </div>

            <div className="customer-category-info-modal__section">
              <div className="customer-category-info-modal__metric">
                <span>Invisible meters</span>
                <strong>{reconciliationUnavailable ? "—" : formatNumber(invisibleMeters)}</strong>
              </div>
              <p>
                Invisible meters are operational meters confirmed in both Meter
                Registry and AST/Assets, but with no authoritative Sales match. They
                are shown for operational reconciliation and are not included in the
                Field Target.
              </p>
              {reconciliationUnavailable ? (
                <small>
                  Operational reconciliation is temporarily unavailable. The Sales
                  Field Target remains unaffected.
                </small>
              ) : null}
            </div>
          </>
        ) : null}

        {type === "categories" ? (
          <>
            <div className="customer-category-info-modal__section">
              <div className="customer-category-info-modal__metric">
                <span>Customer Categories</span>
                <strong>{formatNumber(model.categoryCount)}</strong>
              </div>
              <p>
                The Field Target is classified into the authoritative non-Normal
                Sales categories shown below. Together they reconcile to the full
                Field Target population.
              </p>
            </div>

            <div className="customer-category-info-modal__section">
              <div className="customer-category-info-modal__section-title">
                Category composition
              </div>
              <div className="customer-category-info-modal__breakdown">
                {model.categories.map((category) => (
                  <div
                    className="customer-category-info-modal__breakdown-row"
                    key={category.key}
                  >
                    <span>{category.label}</span>
                    <strong>{formatNumber(category.count)}</strong>
                  </div>
                ))}
                <div className="customer-category-info-modal__breakdown-total">
                  <span>Field Target</span>
                  <strong>{formatNumber(model.fieldTarget)}</strong>
                </div>
              </div>
              <small>
                CAT7 is not present in the authoritative Sales taxonomy. CAT8 is
                retained as CAT8 and is not renumbered.
              </small>
            </div>
          </>
        ) : null}

        {type === "baseline" ? (
          <>
            <div className="customer-category-info-modal__section">
              <div className="customer-category-info-modal__metric">
                <span>June Baseline Purchases</span>
                <strong>{formatCompactCurrencyFromCents(model.baselinePrimarySalesC)}</strong>
              </div>
              <p>
                This is the total June 2026 purchase value for the {formatNumber(model.fieldTarget)}
                {" "}Field Target Sales meters. It provides the baseline reference for
                measuring future purchase recovery. Normal Sales meters are excluded.
              </p>
            </div>

            <div className="customer-category-info-modal__section">
              <div className="customer-category-info-modal__section-title">
                June baseline by category
              </div>
              <div className="customer-category-info-modal__breakdown">
                {model.categories.map((category) => (
                  <div
                    className="customer-category-info-modal__breakdown-row"
                    key={category.key}
                  >
                    <span>{category.label}</span>
                    <strong>
                      {formatCompactCurrencyFromCents(
                        category.monthSalesC?.[
                          CUSTOMER_CATEGORIES_BASELINE_PRIMARY_MONTH_KEY
                        ],
                      )}
                    </strong>
                  </div>
                ))}
                <div className="customer-category-info-modal__breakdown-total">
                  <span>Total June baseline</span>
                  <strong>{formatCompactCurrencyFromCents(model.baselinePrimarySalesC)}</strong>
                </div>
              </div>
              <small>
                This is a baseline measure of Sales purchases, not intervention
                revenue.
              </small>
            </div>
          </>
        ) : null}

        {type === "gps" ? (
          <>
            <div className="customer-category-info-modal__section">
              <div className="customer-category-info-modal__metric">
                <span>GPS Readiness</span>
                <strong>{formatPercent(model.gpsReadyShare)}</strong>
              </div>
              <p>
                GPS Ready means the authoritative Sales record contains usable
                coordinates for mapping and geographic analysis across the Field
                Target population.
              </p>
            </div>

            <div className="customer-category-info-modal__section">
              <div className="customer-category-info-modal__section-title">
                Field Target GPS position
              </div>
              <div className="customer-category-info-modal__breakdown">
                <div className="customer-category-info-modal__breakdown-row">
                  <span>With usable GPS</span>
                  <strong>
                    {formatNumber(model.gpsReady)} · {formatPercent(model.gpsReadyShare)}
                  </strong>
                </div>
                <div className="customer-category-info-modal__breakdown-row">
                  <span>Without usable GPS</span>
                  <strong>
                    {formatNumber(model.gpsWithout)} · {formatPercent(100 - model.gpsReadyShare)}
                  </strong>
                </div>
                <div className="customer-category-info-modal__breakdown-total">
                  <span>Field Target</span>
                  <strong>{formatNumber(model.fieldTarget)}</strong>
                </div>
              </div>
              <small>
                GPS readiness does not indicate whether fieldwork has started or
                whether a meter is completed.
              </small>
            </div>
          </>
        ) : null}

        <div className="customer-category-info-modal__actions">
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}

function CategoryComposition({ model, onSelectCategory }) {
  const maxCount = Math.max(1, ...model.categories.map((category) => category.count));

  return (
    <article className="customer-category-panel customer-category-panel--composition">
      <div className="customer-category-panel__title">
        <div>
          <span className="customer-category-panel__icon"><Icon name="chart" /></span>
          <div>
            <h3>Category Composition</h3>
            <p>All authoritative non-Normal Sales categories</p>
          </div>
        </div>
        <span className="customer-category-panel__badge">{formatNumber(model.fieldTarget)} meters</span>
      </div>

      <div className="customer-category-composition">
        <div className="customer-category-composition__rows">
          {model.categories.map((category) => (
            <button
              type="button"
              className="customer-category-composition__row"
              key={category.key}
              onClick={() => onSelectCategory(category)}
              title={`Open ${category.label} dashboard`}
            >
              <div className="customer-category-composition__label">
                <strong>{category.label}</strong>
                <span>View individual category dashboard</span>
              </div>
              <div className="customer-category-composition__bar">
                <span style={{ width: `${Math.max(2, (category.count / maxCount) * 100)}%` }} />
              </div>
              <strong>{formatNumber(category.count)}</strong>
              <span>{formatPercent(category.share)}</span>
              <i aria-hidden="true"><Icon name="arrow" /></i>
            </button>
          ))}
        </div>

      </div>
    </article>
  );
}

function PurchaseBaseline({ model }) {
  const maxSalesC = Math.max(
    1,
    ...model.categories.flatMap((category) =>
      model.baselineMonthKeys.map((monthKey) => Number(category.monthSalesC?.[monthKey] || 0)),
    ),
  );

  return (
    <article className="customer-category-panel customer-category-panel--purchases">
      <div className="customer-category-panel__title">
        <div>
          <span className="customer-category-panel__icon customer-category-panel__icon--blue"><Icon name="sales" /></span>
          <div>
            <h3>Purchase Baseline by Category</h3>
            <p>Apr–Jun 2026 Sales baseline before the recovery period</p>
          </div>
        </div>
      </div>

      <div className="customer-category-purchase-legend">
        {model.baselineMonthKeys.map((monthKey, index) => (
          <span key={monthKey}><i className={`month-tone-${index + 1}`} />{getMonthLabel(monthKey)}</span>
        ))}
      </div>

      <div className="customer-category-purchase-chart">
        {model.categories.map((category) => (
          <div className="customer-category-purchase-row" key={category.key}>
            <strong title={category.label}>{category.label}</strong>
            <div className="customer-category-purchase-bars">
              {model.baselineMonthKeys.map((monthKey, index) => {
                const value = Number(category.monthSalesC?.[monthKey] || 0);
                return (
                  <div key={monthKey} className="customer-category-purchase-bar-wrap" title={`${getMonthLabel(monthKey)} · ${formatCompactCurrencyFromCents(value)}`}>
                    <span
                      className={`customer-category-purchase-bar month-tone-${index + 1}`}
                      style={{ width: `${Math.max(value > 0 ? 2 : 0, (value / maxSalesC) * 100)}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <span>{formatCompactCurrencyFromCents(category.monthSalesC?.[CUSTOMER_CATEGORIES_BASELINE_PRIMARY_MONTH_KEY] || 0)}</span>
          </div>
        ))}
      </div>

      <div className="customer-category-purchase-note">
        <strong>June baseline</strong>
        <span>{formatCompactCurrencyFromCents(model.baselinePrimarySalesC)}</span>
      </div>
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
      console.error("Could not parse Customer Categories geofence geometry:", error);
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

function CustomerCategoriesGeofenceLayer({
  geofences,
  geofenceCounts,
  selectedGeofenceId,
  hoveredGeofenceId,
  onSelectGeofence,
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
              <div>Field Target meters: <strong>${escapeMapHtml(formatNumber(count))}</strong></div>
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
  }, [geofenceCounts, geofences, map, onSelectGeofence, selectedGeofenceId]);

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

  const mappedFieldTargetGeofences = useMemo(() => {
    const targetIds = new Set(model.topGeofences.map((geofence) => geofence.key));
    return (Array.isArray(geofences) ? geofences : []).filter(
      (geofence) => geofence?.id && targetIds.has(geofence.id),
    );
  }, [geofences, model.topGeofences]);

  const selectedGeofence = model.topGeofences.find(
    (geofence) => geofence.key === selectedGeofenceId,
  );

  return (
    <article className="customer-category-panel customer-category-panel--geography">
      <div className="customer-category-panel__title">
        <div>
          <span className="customer-category-panel__icon"><Icon name="gps" /></span>
          <div>
            <h3>Geography & GPS Readiness</h3>
            <p>Where Field Target meters are concentrated</p>
          </div>
        </div>
      </div>

      <div className="customer-category-geography">
        <div className="customer-category-geography__concentration">
          <span className="customer-category-geography__eyebrow">Geofences by ward</span>
          <div className="customer-category-geography__geofence-scroll">
            {groupedGeofences.length ? groupedGeofences.map((wardGroup) => (
              <div
                className="customer-category-geography__ward-group"
                key={wardGroup.key}
              >
                <div className="customer-category-geography__ward-heading">
                  {wardGroup.label}
                </div>
                {wardGroup.geofences.map((geofence) => (
                  <button
                    type="button"
                    className={`customer-category-geofence-row${selectedGeofenceId === geofence.key ? " is-selected" : ""}`}
                    key={geofence.key}
                    onMouseEnter={() => setHoveredGeofenceId(geofence.key)}
                    onMouseLeave={() =>
                      setHoveredGeofenceId((current) =>
                        current === geofence.key ? "" : current,
                      )
                    }
                    onFocus={() => setHoveredGeofenceId(geofence.key)}
                    onBlur={() =>
                      setHoveredGeofenceId((current) =>
                        current === geofence.key ? "" : current,
                      )
                    }
                    onClick={() =>
                      setSelectedGeofenceId((current) =>
                        current === geofence.key ? "" : geofence.key,
                      )
                    }
                    aria-pressed={selectedGeofenceId === geofence.key}
                    title={`Focus ${geofence.label} on map`}
                  >
                    <span>{geofence.label}</span>
                    <div><i style={{ width: `${Math.max(4, (geofence.count / maxGeofence) * 100)}%` }} /></div>
                    <strong>{formatNumber(geofence.count)}</strong>
                  </button>
                ))}
              </div>
            )) : (
              <p className="customer-category-empty-copy">No geofence references are available in the current Field Target stream.</p>
            )}
          </div>
          <small>Counts reflect Field Target Sales meter membership in each geofence.</small>
        </div>

        <div className="customer-category-geography__gps">
          <div>
            <span>With GPS</span>
            <strong>{formatNumber(model.gpsReady)}</strong>
            <small>{formatPercent(model.gpsReadyShare)} of Field Target</small>
          </div>
          <div>
            <span>Without GPS</span>
            <strong>{formatNumber(model.gpsWithout)}</strong>
            <small>{formatPercent(100 - model.gpsReadyShare)} of Field Target</small>
          </div>
          {model.topWards.length ? (
            <div className="customer-category-geography__ward">
              <span>Top ward</span>
              <strong>{model.topWards[0].label}</strong>
              <small>{formatNumber(model.topWards[0].count)} meter links</small>
            </div>
          ) : null}
        </div>
      </div>

      <div className="customer-category-geography-map">
        <div className="customer-category-geography-map__heading">
          <div>
            <strong>Field Target geofence density</strong>
            <span>Actual iREPS geofence polygons · stronger fill means more CAT meters</span>
          </div>
          {selectedGeofence ? (
            <button type="button" onClick={() => setSelectedGeofenceId("")}>
              {selectedGeofence.label} · {formatNumber(selectedGeofence.count)}
              <span aria-hidden="true">×</span>
            </button>
          ) : (
            <span className="customer-category-geography-map__all">All mapped geofences</span>
          )}
        </div>

        {!googleMapsApiKey ? (
          <div className="customer-category-geography-map__state">
            Google Maps key is not available in this web environment.
          </div>
        ) : geofencesError ? (
          <div className="customer-category-geography-map__state customer-category-geography-map__state--error">
            Geofence geometry could not be loaded for this workbase.
          </div>
        ) : isGeofencesLoading && mappedFieldTargetGeofences.length === 0 ? (
          <div className="customer-category-geography-map__state">
            Loading mapped geofences…
          </div>
        ) : mappedFieldTargetGeofences.length === 0 ? (
          <div className="customer-category-geography-map__state">
            No Field Target geofence polygons are available for this workbase.
          </div>
        ) : (
          <div className="customer-category-geography-map__canvas">
            <APIProvider apiKey={googleMapsApiKey}>
              <Map
                defaultCenter={CUSTOMER_CATEGORIES_MAP_CENTER}
                defaultZoom={11}
                mapTypeId="roadmap"
                gestureHandling="cooperative"
                disableDefaultUI={false}
                style={{ width: "100%", height: "100%" }}
              >
                <CustomerCategoriesGeofenceLayer
                  geofences={mappedFieldTargetGeofences}
                  geofenceCounts={geofenceCounts}
                  selectedGeofenceId={selectedGeofenceId}
                  hoveredGeofenceId={hoveredGeofenceId}
                  onSelectGeofence={setSelectedGeofenceId}
                />
              </Map>
            </APIProvider>
            {isGeofencesFetching ? (
              <span className="customer-category-geography-map__sync">Syncing geography…</span>
            ) : null}
          </div>
        )}

        <div className="customer-category-geography-map__legend" aria-label="Geofence density legend">
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

function getRecoveryToneClass(shortCode, index) {
  const match = String(shortCode || "").match(/^C([1-8])$/i);
  const toneNumber = match ? Number(match[1]) : ((index % 8) + 1);
  return `recovery-tone-${toneNumber}`;
}

function RecoveryJourney({ model }) {
  const recoveryScrollRef = useRef(null);
  const latestAvailableMonthKey = [...model.recoveryMonths]
    .reverse()
    .find((month) => month.isAvailable)?.key;

  useEffect(() => {
    const scrollContainer = recoveryScrollRef.current;
    if (!scrollContainer || !latestAvailableMonthKey) return;

    const latestMonth = scrollContainer.querySelector(
      `[data-recovery-month="${latestAvailableMonthKey}"]`,
    );

    if (!latestMonth) return;

    scrollContainer.scrollTo({
      left: Math.max(0, latestMonth.offsetLeft - 12),
      behavior: "auto",
    });
  }, [latestAvailableMonthKey, model.recoveryMonths.length]);

  return (
    <article className="customer-category-panel customer-category-panel--journey">
      <div className="customer-category-panel__title">
        <div>
          <span className="customer-category-panel__icon customer-category-panel__icon--blue"><Icon name="arrow" /></span>
          <div>
            <h3>Category Recovery Journey</h3>
            <p>Month-by-month shrink of non-Normal categories toward Normal</p>
          </div>
        </div>
      </div>

      <div className="customer-category-recovery">
        <div className="customer-category-recovery__body">
          <div
            className="customer-category-recovery__scroll"
            ref={recoveryScrollRef}
            aria-label="Recovery reporting months. Scroll horizontally to view additional months."
          >
            <div className="customer-category-recovery__scroll-content">
              <div className="customer-category-recovery__timeline" aria-label="Recovery reporting months">
                <span className="customer-category-recovery__timeline-line" aria-hidden="true" />
                {model.recoveryMonths.map((month) => (
                  <div
                    className={`customer-category-recovery__month-marker${month.isAvailable ? " is-actual" : ""}`}
                    key={month.key}
                  >
                    <i />
                    <strong>{month.label}</strong>
                  </div>
                ))}
                <span className="customer-category-recovery__timeline-arrow" aria-hidden="true">→</span>
              </div>

              <div className="customer-category-recovery__months">
                {model.recoveryMonths.map((month) => (
                  <section
                    className={`customer-category-recovery__month${month.isAvailable ? " is-actual" : " is-awaiting"}`}
                    key={month.key}
                    data-recovery-month={month.key}
                    aria-label={`${month.label} category snapshot`}
                  >
                    <div className="customer-category-recovery__summary">
                      <div className="revenue-total">
                        <span>Revenue</span>
                        <strong>{month.isAvailable ? formatCompactCurrencyFromCents(month.revenueC) : "—"}</strong>
                      </div>
                      <div className="normal-total">
                        <span>Normal</span>
                        <strong>{month.isAvailable ? formatNumber(month.normalCount) : "—"}</strong>
                      </div>
                    </div>

                    <div className="customer-category-recovery__rows">
                      {month.categories.map((category, categoryIndex) => {
                        const width = month.isAvailable
                          ? Math.max(
                            category.count > 0 ? 3 : 0,
                            (Number(category.count || 0) / model.recoveryMaxCategoryCount) * 100,
                          )
                          : 0;

                        return (
                          <div className="customer-category-recovery__row" key={category.key}>
                            <span
                              className={`customer-category-recovery__code ${getRecoveryToneClass(category.shortCode, categoryIndex)}`}
                              title={category.label}
                            >
                              {category.shortCode}
                            </span>
                            <div
                              className="customer-category-recovery__track"
                              title={month.isAvailable ? `${category.label}: ${formatNumber(category.count)}` : `${category.label}: awaiting data`}
                            >
                              {month.isAvailable ? (
                                <span
                                  className={getRecoveryToneClass(category.shortCode, categoryIndex)}
                                  style={{ width: `${width}%` }}
                                />
                              ) : (
                                <i />
                              )}
                            </div>
                            <strong>{month.isAvailable ? formatNumber(category.count) : ""}</strong>
                          </div>
                        );
                      })}
                    </div>

                    <div className="customer-category-recovery__month-footer">
                      {month.isAvailable ? (
                        <>
                          <span>Field Target</span>
                          <strong>{formatNumber(month.fieldTarget)}</strong>
                        </>
                      ) : (
                        <span>Awaiting data</span>
                      )}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </div>

          <aside className="customer-category-recovery__destination">
            <span><Icon name="check" /></span>
            <strong>Normal</strong>
            <small>Destination state<br />for all categories</small>
          </aside>
        </div>

        <div className="customer-category-recovery__legend" aria-label="Category key">
          {model.recoveryCategories.map((category, index) => (
            <span key={category.key} title={category.label}>
              <i className={getRecoveryToneClass(category.shortCode, index)} />
              {category.shortCode}
            </span>
          ))}
        </div>

        <div className="customer-category-recovery__note">
          <strong>Actual snapshot:</strong>
          <span> June uses the current authoritative Sales categories and June Sales revenue. July–September remain empty until authoritative monthly category snapshots are available.</span>
        </div>
      </div>
    </article>
  );
}

function LoadingState() {
  return (
    <section className="customer-category-state-card" aria-live="polite" aria-busy="true">
      <span className="customer-category-spinner" />
      <div>
        <h2>Loading Customer Categories...</h2>
        <p>Connecting to the live Sales stream for the active workbase.</p>
      </div>
    </section>
  );
}

export default function CustomerCategoriesDashboardPage() {
  const { activeWorkbase } = useAuth();
  const navigate = useNavigate();
  const [openKpiInfo, setOpenKpiInfo] = useState(null);
  const activeLmPcode = getActiveLmPcode(activeWorkbase);
  const activeWorkbaseName = getActiveWorkbaseName(activeWorkbase);

  const {
    data: salesRows = [],
    isLoading,
    isFetching,
    error,
  } = useGetSalesByLmPcodeQuery(activeLmPcode || skipToken);

  const {
    data: registryMeters = [],
    isLoading: isRegistryLoading,
    error: registryError,
  } = useGetRegistryMetersByLmQuery(activeLmPcode || skipToken);

  const {
    data: astRows = [],
    isLoading: isAstsLoading,
    error: astsError,
  } = useGetAstsByLmPcodeQuery(activeLmPcode || skipToken);

  const {
    data: mapGeofences = [],
    isLoading: isMapGeofencesLoading,
    isFetching: isMapGeofencesFetching,
    error: mapGeofencesError,
  } = useGetGeoFencesByLmQuery(activeLmPcode || skipToken);

  const model = useMemo(
    () => buildCustomerCategoriesDashboardModel(salesRows),
    [salesRows],
  );

  const invisibleMeters = useMemo(
    () => countInvisibleOperationalMeters(registryMeters, astRows),
    [registryMeters, astRows],
  );

  const reconciliationUnavailable = Boolean(registryError || astsError);
  const reconciliationLoading =
    !reconciliationUnavailable &&
    (isRegistryLoading || isAstsLoading) &&
    (registryMeters.length === 0 || astRows.length === 0);

  if (!activeLmPcode) {
    return (
      <div className="customer-categories-dashboard-page">
        <section className="customer-category-state-card">
          <div>
            <h2>No active workbase selected</h2>
            <p>Select an active workbase before opening Customer Categories.</p>
          </div>
        </section>
      </div>
    );
  }

  if (isLoading) {
    return <div className="customer-categories-dashboard-page"><LoadingState /></div>;
  }

  if (error) {
    return (
      <div className="customer-categories-dashboard-page">
        <section className="customer-category-state-card customer-category-state-card--error">
          <div>
            <h2>Could not load Customer Categories</h2>
            <p>The live Sales stream could not be loaded for {activeLmPcode}.</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="customer-categories-dashboard-page">
      <header className="customer-categories-header">
        <div>
          <p className="customer-categories-eyebrow">Dashboard · Customer Categories</p>
          <h2>Customer Categories Dashboard</h2>
          <p>
            Live view of all non-Normal Sales meters, category composition, baseline purchases and geographic readiness for {activeWorkbaseName}.
          </p>
        </div>
        <div className="customer-categories-header__status">
          <span className={isFetching ? "syncing" : ""} />
          <div>
            <strong>{isFetching ? "Syncing Sales" : "Live Sales"}</strong>
            <small>{formatDate()} · {activeLmPcode}</small>
          </div>
        </div>
      </header>

      <section className="customer-category-kpis" aria-label="Customer Category KPIs">
        <KpiCard
          label="Field Target"
          value={formatNumber(model.fieldTarget)}
          detail="All Categories excluding Normal"
          icon="target"
          tone="teal"
          secondaryLabel="Invisible"
          secondaryValue={
            reconciliationUnavailable
              ? "—"
              : reconciliationLoading
                ? "…"
                : formatNumber(invisibleMeters)
          }
          onClick={() => setOpenKpiInfo("fieldTarget")}
          ariaLabel={`Field Target ${formatNumber(model.fieldTarget)}. Open explanation of Field Target and Invisible meters.`}
        />
        <KpiCard
          label="Customer Categories"
          value={formatNumber(model.categoryCount)}
          detail="Authoritative non-Normal Sales categories"
          icon="categories"
          tone="blue"
          onClick={() => setOpenKpiInfo("categories")}
          ariaLabel={`Customer Categories ${formatNumber(model.categoryCount)}. Open category context.`}
        />
        <KpiCard
          label="June Baseline Purchases"
          value={formatCompactCurrencyFromCents(model.baselinePrimarySalesC)}
          detail="Field Target purchases · Jun 2026"
          icon="sales"
          tone="orange"
          onClick={() => setOpenKpiInfo("baseline")}
          ariaLabel={`June Baseline Purchases ${formatCompactCurrencyFromCents(model.baselinePrimarySalesC)}. Open purchase baseline context.`}
        />
        <KpiCard
          label="GPS Ready"
          value={formatPercent(model.gpsReadyShare)}
          detail={`${formatNumber(model.gpsReady)} of ${formatNumber(model.fieldTarget)} meters`}
          icon="gps"
          tone="teal"
          onClick={() => setOpenKpiInfo("gps")}
          ariaLabel={`GPS Ready ${formatPercent(model.gpsReadyShare)}. Open GPS readiness context.`}
        />
      </section>

      {model.fieldTarget === 0 ? (
        <section className="customer-category-state-card">
          <div>
            <h2>No non-Normal Sales categories found</h2>
            <p>The active Sales population contains no Field Target rows for {activeLmPcode}.</p>
          </div>
        </section>
      ) : (
        <>
          <section className="customer-categories-main-grid">
            <CategoryComposition
              model={model}
              onSelectCategory={(category) =>
                navigate(`/dashboard/customer-categories/${category.key}`)
              }
            />
            <PurchaseBaseline model={model} />
          </section>

          <section className="customer-categories-secondary-grid">
            <GeographyPanel
              model={model}
              geofences={mapGeofences}
              isGeofencesLoading={isMapGeofencesLoading}
              isGeofencesFetching={isMapGeofencesFetching}
              geofencesError={mapGeofencesError}
            />
            <RecoveryJourney model={model} />
          </section>
        </>
      )}

      {openKpiInfo ? (
        <DashboardKpiInfoModal
          type={openKpiInfo}
          model={model}
          invisibleMeters={invisibleMeters}
          reconciliationUnavailable={reconciliationUnavailable}
          onClose={() => setOpenKpiInfo(null)}
        />
      ) : null}

      <footer className="customer-categories-footer">
        <span>Authoritative source: live Sales · Category: leakageCategory · Normal excluded using Project Population parity.</span>
        <span>{model.reconcilesToFieldTarget ? "✓ Category reconciliation passed" : "⚠ Category reconciliation review required"}</span>
      </footer>
    </div>
  );
}
