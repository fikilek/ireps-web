/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useMemo } from "react";

const PALETTE = [
  "#2563eb",
  "#16a34a",
  "#f59e0b",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#ea580c",
  "#4f46e5",
  "#64748b",
  "#0f766e",
  "#be123c",
];

function cleanText(value) {
  return String(value ?? "").trim();
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function truncate(value, maxLength = 36) {
  const text = cleanText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export function ChartCard({ title, subtitle, children, footer }) {
  return (
    <article style={styles.card}>
      <div style={styles.cardHeader}>
        <div>
          <h3 style={styles.title}>{title}</h3>
          {subtitle ? <p style={styles.subtitle}>{subtitle}</p> : null}
        </div>
      </div>

      <div style={styles.body}>{children}</div>

      {footer ? <p style={styles.footer}>{footer}</p> : null}
    </article>
  );
}

export function HorizontalBarChart({
  data = [],
  labelKey = "label",
  valueKey = "value",
  valueFormatter = formatNumber,
  emptyText = "No chart data is available.",
}) {
  const maxValue = Math.max(
    0,
    ...data.map((row) => Number(row?.[valueKey] || 0)),
  );

  if (!data.length || maxValue <= 0) {
    return <div style={styles.empty}>{emptyText}</div>;
  }

  return (
    <div style={styles.barList}>
      {data.map((row, index) => {
        const value = Number(row?.[valueKey] || 0);
        const width = maxValue > 0 ? (value / maxValue) * 100 : 0;

        return (
          <div key={`${row?.[labelKey]}-${index}`} style={styles.barRow}>
            <div style={styles.barTopLine}>
              <span title={cleanText(row?.[labelKey])} style={styles.barLabel}>
                {truncate(row?.[labelKey], 42)}
              </span>
              <strong style={styles.barValue}>{valueFormatter(value)}</strong>
            </div>

            <div style={styles.barTrack}>
              <div
                style={{
                  ...styles.barFill,
                  width: `${Math.max(width, value > 0 ? 1.5 : 0)}%`,
                  background: PALETTE[index % PALETTE.length],
                }}
                title={`${cleanText(row?.[labelKey])}: ${valueFormatter(value)}`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;

  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function describeArc(centerX, centerY, radius, startAngle, endAngle) {
  const start = polarToCartesian(centerX, centerY, radius, endAngle);
  const end = polarToCartesian(centerX, centerY, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    `M ${centerX} ${centerY}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}

export function PieChart({
  data = [],
  labelKey = "label",
  valueKey = "value",
  valueFormatter = formatNumber,
  emptyText = "No chart data is available.",
}) {
  const positiveData = data.filter((row) => Number(row?.[valueKey] || 0) > 0);
  const total = positiveData.reduce(
    (sum, row) => sum + Number(row?.[valueKey] || 0),
    0,
  );

  const arcs = useMemo(() => {
    let cursor = 0;

    return positiveData.map((row, index) => {
      const value = Number(row?.[valueKey] || 0);
      const sweep = total > 0 ? (value / total) * 360 : 0;
      const startAngle = cursor;
      const endAngle = cursor + sweep;
      cursor = endAngle;

      return {
        row,
        value,
        startAngle,
        endAngle,
        color: PALETTE[index % PALETTE.length],
      };
    });
  }, [positiveData, total, valueKey]);

  if (!positiveData.length || total <= 0) {
    return <div style={styles.empty}>{emptyText}</div>;
  }

  return (
    <div style={styles.pieLayout}>
      <svg
        viewBox="0 0 220 220"
        width="220"
        height="220"
        role="img"
        aria-label="Pie chart"
        style={styles.pieSvg}
      >
        {arcs.map((arc, index) => (
          <path
            key={`${arc.row?.[labelKey]}-${index}`}
            d={describeArc(110, 110, 98, arc.startAngle, arc.endAngle)}
            fill={arc.color}
            stroke="#ffffff"
            strokeWidth="2"
          >
            <title>
              {`${cleanText(arc.row?.[labelKey])}: ${valueFormatter(arc.value)} (${((arc.value / total) * 100).toFixed(1)}%)`}
            </title>
          </path>
        ))}

        <circle cx="110" cy="110" r="48" fill="#ffffff" />
        <text
          x="110"
          y="104"
          textAnchor="middle"
          style={styles.pieTotalLabel}
        >
          Total
        </text>
        <text
          x="110"
          y="127"
          textAnchor="middle"
          style={styles.pieTotalValue}
        >
          {formatNumber(total)}
        </text>
      </svg>

      <div style={styles.legend}>
        {arcs.map((arc, index) => (
          <div key={`${arc.row?.[labelKey]}-legend-${index}`} style={styles.legendRow}>
            <span
              style={{
                ...styles.legendSwatch,
                background: arc.color,
              }}
            />
            <span title={cleanText(arc.row?.[labelKey])} style={styles.legendLabel}>
              {truncate(arc.row?.[labelKey], 34)}
            </span>
            <strong style={styles.legendValue}>
              {((arc.value / total) * 100).toFixed(1)}%
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StackedBarChart({
  rows = [],
  categories = [],
  mode = "COUNT",
  emptyText = "No chart data is available.",
}) {
  const positiveRows = rows.filter((row) => Number(row?.total || 0) > 0);
  const maxTotal = Math.max(0, ...positiveRows.map((row) => Number(row.total || 0)));

  if (!positiveRows.length || !categories.length || maxTotal <= 0) {
    return <div style={styles.empty}>{emptyText}</div>;
  }

  return (
    <div style={styles.stackList}>
      {positiveRows.map((row) => (
        <div key={row.id} style={styles.stackRow}>
          <div style={styles.stackTopLine}>
            <span title={row.name} style={styles.stackLabel}>
              {truncate(row.name, 38)}
            </span>
            <strong style={styles.stackTotal}>{formatNumber(row.total)}</strong>
          </div>

          <div style={styles.stackTrack}>
            {categories.map((category, categoryIndex) => {
              const value = Number(row?.categories?.[category] || 0);
              const denominator = mode === "PERCENT" ? row.total : maxTotal;
              const width = denominator > 0 ? (value / denominator) * 100 : 0;

              if (width <= 0) return null;

              return (
                <div
                  key={`${row.id}-${category}`}
                  style={{
                    width: `${width}%`,
                    minWidth: width > 0 ? 2 : 0,
                    background: PALETTE[categoryIndex % PALETTE.length],
                  }}
                  title={`${category}: ${formatNumber(value)}${
                    mode === "PERCENT"
                      ? ` (${((value / row.total) * 100).toFixed(1)}%)`
                      : ""
                  }`}
                />
              );
            })}
          </div>
        </div>
      ))}

      <div style={styles.stackLegend}>
        {categories.map((category, index) => (
          <div key={category} style={styles.stackLegendItem}>
            <span
              style={{
                ...styles.legendSwatch,
                background: PALETTE[index % PALETTE.length],
              }}
            />
            <span title={category}>{truncate(category, 28)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  card: {
    minWidth: 0,
    borderRadius: 18,
    border: "1px solid #e2e8f0",
    background: "#ffffff",
    padding: 16,
    display: "grid",
    gap: 14,
  },

  cardHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },

  title: {
    margin: 0,
    color: "#0f172a",
    fontSize: 15,
  },

  subtitle: {
    margin: "4px 0 0",
    color: "#64748b",
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1.5,
  },

  body: {
    minWidth: 0,
  },

  footer: {
    margin: 0,
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: 700,
    lineHeight: 1.5,
  },

  empty: {
    minHeight: 180,
    display: "grid",
    placeItems: "center",
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: 800,
    textAlign: "center",
  },

  barList: {
    display: "grid",
    gap: 12,
  },

  barRow: {
    display: "grid",
    gap: 6,
  },

  barTopLine: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },

  barLabel: {
    minWidth: 0,
    color: "#334155",
    fontSize: 11,
    fontWeight: 800,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  barValue: {
    flexShrink: 0,
    color: "#0f172a",
    fontSize: 11,
  },

  barTrack: {
    height: 10,
    borderRadius: 999,
    background: "#e2e8f0",
    overflow: "hidden",
  },

  barFill: {
    height: "100%",
    borderRadius: 999,
  },

  pieLayout: {
    display: "grid",
    gridTemplateColumns: "minmax(220px, 0.9fr) minmax(220px, 1.1fr)",
    alignItems: "center",
    gap: 18,
  },

  pieSvg: {
    width: "100%",
    maxWidth: 260,
    height: "auto",
    justifySelf: "center",
  },

  pieTotalLabel: {
    fill: "#64748b",
    fontSize: 11,
    fontWeight: 800,
  },

  pieTotalValue: {
    fill: "#0f172a",
    fontSize: 18,
    fontWeight: 900,
  },

  legend: {
    display: "grid",
    gap: 8,
  },

  legendRow: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "12px minmax(0, 1fr) auto",
    alignItems: "center",
    gap: 8,
  },

  legendSwatch: {
    width: 10,
    height: 10,
    borderRadius: 3,
  },

  legendLabel: {
    color: "#475569",
    fontSize: 10,
    fontWeight: 700,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  legendValue: {
    color: "#0f172a",
    fontSize: 10,
  },

  stackList: {
    display: "grid",
    gap: 12,
  },

  stackRow: {
    display: "grid",
    gap: 6,
  },

  stackTopLine: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },

  stackLabel: {
    color: "#334155",
    fontSize: 11,
    fontWeight: 800,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  stackTotal: {
    color: "#0f172a",
    fontSize: 10,
  },

  stackTrack: {
    height: 16,
    display: "flex",
    borderRadius: 999,
    background: "#e2e8f0",
    overflow: "hidden",
  },

  stackLegend: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    paddingTop: 4,
  },

  stackLegendItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: "#64748b",
    fontSize: 9,
    fontWeight: 700,
  },
};
