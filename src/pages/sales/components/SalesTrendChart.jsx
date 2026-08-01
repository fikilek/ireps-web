/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useMemo } from "react";

import {
  formatCompactCurrencyFromCents,
  formatNumber,
  getMonthLabel,
} from "../salesUtils";

function buildPoints(values, width, height, padding) {
  const maximumValue = Math.max(...values, 0);
  const safeMaximum = maximumValue > 0 ? maximumValue : 1;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const divisor = Math.max(values.length - 1, 1);

  return values.map((value, index) => ({
    x: padding.left + (index / divisor) * plotWidth,
    y: padding.top + plotHeight - (Number(value || 0) / safeMaximum) * plotHeight,
    value: Number(value || 0),
  }));
}

function formatAxisValue(value, mode) {
  if (mode === "UNITS") return formatNumber(Math.round(value));
  return formatCompactCurrencyFromCents(value);
}

export default function SalesTrendChart({
  rows = [],
  monthKeys = [],
  mode,
  onModeChange,
}) {
  const trend = useMemo(() => {
    const chronologicalMonths = [...monthKeys].reverse();

    const values = chronologicalMonths.map((monthKey) => {
      return rows.reduce((sum, row) => {
        if (mode === "UNITS") {
          return sum + Number(row?.monthlyUnits?.[monthKey] || 0);
        }

        return sum + Number(row?.monthlySalesC?.[monthKey] || 0);
      }, 0);
    });

    return { chronologicalMonths, values };
  }, [rows, monthKeys, mode]);

  const width = 1000;
  const height = 285;
  const padding = { top: 22, right: 24, bottom: 52, left: 86 };
  const points = buildPoints(trend.values, width, height, padding);
  const polylinePoints = points.map((point) => `${point.x},${point.y}`).join(" ");
  const maximumValue = Math.max(...trend.values, 0);
  const horizontalGuides = [0, 0.25, 0.5, 0.75, 1];
  const labelEvery = Math.max(1, Math.ceil(trend.chronologicalMonths.length / 9));

  return (
    <section style={styles.panel}>
      <div style={styles.headerRow}>
        <div>
          <p style={styles.eyebrow}>Monthly Sales Trend</p>
          <h2 style={styles.title}>December 2023 to February 2026</h2>
          <p style={styles.subtitle}>
            Municipality-wide prepaid vending performance across the loaded sales meters.
          </p>
        </div>

        <div style={styles.toggleGroup} aria-label="Sales trend measure">
          <button
            type="button"
            style={{
              ...styles.toggleButton,
              ...(mode === "SALES" ? styles.toggleButtonActive : null),
            }}
            onClick={() => onModeChange("SALES")}
          >
            Sales Rands
          </button>
          <button
            type="button"
            style={{
              ...styles.toggleButton,
              ...(mode === "UNITS" ? styles.toggleButtonActive : null),
            }}
            onClick={() => onModeChange("UNITS")}
          >
            Units
          </button>
        </div>
      </div>

      <div style={styles.chartWrap}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Monthly prepaid ${mode === "UNITS" ? "units" : "sales value"} trend`}
          style={styles.chart}
        >
          {horizontalGuides.map((ratio) => {
            const y =
              padding.top +
              (1 - ratio) * (height - padding.top - padding.bottom);
            const guideValue = maximumValue * ratio;

            return (
              <g key={ratio}>
                <line
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y}
                  y2={y}
                  stroke="rgba(148, 163, 184, 0.35)"
                  strokeWidth="1"
                />
                <text
                  x={padding.left - 12}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="12"
                  fill="#64748b"
                >
                  {formatAxisValue(guideValue, mode)}
                </text>
              </g>
            );
          })}

          <polyline
            points={polylinePoints}
            fill="none"
            stroke="#2563eb"
            strokeWidth="4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {points.map((point, index) => (
            <circle
              key={`${trend.chronologicalMonths[index]}-${point.x}`}
              cx={point.x}
              cy={point.y}
              r="4"
              fill="#ffffff"
              stroke="#2563eb"
              strokeWidth="3"
            >
              <title>
                {getMonthLabel(trend.chronologicalMonths[index], "long")}: {" "}
                {formatAxisValue(point.value, mode)}
              </title>
            </circle>
          ))}

          {trend.chronologicalMonths.map((monthKey, index) => {
            const shouldShow =
              index % labelEvery === 0 ||
              index === trend.chronologicalMonths.length - 1;
            if (!shouldShow) return null;

            return (
              <text
                key={monthKey}
                x={points[index]?.x || padding.left}
                y={height - 20}
                textAnchor="middle"
                fontSize="12"
                fill="#64748b"
              >
                {getMonthLabel(monthKey)}
              </text>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

const styles = {
  panel: {
    background: "#ffffff",
    border: "1px solid rgba(148, 163, 184, 0.26)",
    borderRadius: "1rem",
    padding: "1rem",
    boxShadow: "0 14px 30px rgba(15, 23, 42, 0.06)",
  },
  headerRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "1rem",
    flexWrap: "wrap",
  },
  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: "0.72rem",
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  title: {
    margin: "0.2rem 0 0",
    color: "#0f172a",
    fontSize: "1.1rem",
  },
  subtitle: {
    margin: "0.35rem 0 0",
    color: "#64748b",
    fontSize: "0.86rem",
  },
  toggleGroup: {
    display: "inline-flex",
    alignItems: "center",
    padding: "0.2rem",
    background: "#f1f5f9",
    borderRadius: "0.75rem",
  },
  toggleButton: {
    border: 0,
    borderRadius: "0.6rem",
    padding: "0.52rem 0.75rem",
    background: "transparent",
    color: "#475569",
    fontWeight: 800,
    cursor: "pointer",
  },
  toggleButtonActive: {
    background: "#ffffff",
    color: "#1d4ed8",
    boxShadow: "0 5px 12px rgba(15, 23, 42, 0.1)",
  },
  chartWrap: {
    width: "100%",
    overflowX: "auto",
    marginTop: "0.75rem",
  },
  chart: {
    width: "100%",
    minWidth: "760px",
    height: "auto",
    display: "block",
  },
};
