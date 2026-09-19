// Targeted Batch rules TB-R057 (1.3.55): the graphs of Batch Stats. Every bar and donut piece names
// itself and its number when the pointer rests on it; text wears ink colours, never a series colour.
import { useEffect, useRef, useState } from "react";

import { formatNumber, shares, tickLabelsShown, toCount } from "./batchStatsModel.js";

const INK = "#0f172a";
const MUTED = "#64748b";
const GRID = "#e2e8f0";
const AXIS = "#cbd5e1";

export function Dot({ color }) {
  return <span aria-hidden="true" style={{ ...styles.dot, background: color }} />;
}

// Part 1: one bar per batch type, on one scale from 0.
export function VerticalBars({ bars, scale, height = 220 }) {
  return (
    <div style={styles.vWrap}>
      <div style={{ ...styles.vPlot, height }}>
        {scale.ticks.map((tick) => (
          <div key={tick}>
            <div style={{ ...styles.vGrid, bottom: `${(tick / scale.max) * 100}%`, borderTop: `1px ${tick ? "dashed" : "solid"} ${tick ? GRID : AXIS}` }} />
            <span style={{ ...styles.vTick, bottom: `calc(${(tick / scale.max) * 100}% - 7px)` }}>{formatNumber(tick)}</span>
          </div>
        ))}
        <div style={styles.vBars}>
          {bars.map((bar) => (
            <div key={bar.key} style={styles.vColumn}>
              <strong style={styles.vValue}>{formatNumber(bar.value)}</strong>
              <div title={bar.title} style={{ ...styles.vBar, height: `${(toCount(bar.value) / scale.max) * 100}%`, background: bar.color }} />
            </div>
          ))}
        </div>
      </div>
      <div style={styles.vLabels}>
        {bars.map((bar) => <span key={bar.key} style={styles.vLabel}>{bar.label}</span>)}
      </div>
    </div>
  );
}

// The track's width in pixels, to show a value inside a segment only when it fits.
function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

// About the width of a number in 11px bold digits, with a little room.
const valueWidth = (value) => { const text = formatNumber(value); return text.replace(/,/g, "").length * 6.3 + (text.split(",").length - 1) * 3 + 6; };

// Horizontal stacked bars, every row on ONE shared scale. rows: [{ key, label, group, sub, gapTop, segments: [{ key, value, color, textColor, title }] }]
export function StackedBars({ rows, scale, labelWidth = 150 }) {
  const [wrapRef, wrapWidth] = useWidth();
  const [trackRef, trackWidth] = useWidth();
  // On a narrow chart (a phone) each label sits above its bar, so the bars keep their width.
  const narrow = wrapWidth > 0 && wrapWidth < 440;
  const columns = narrow ? "minmax(0, 1fr) 56px" : `min(${labelWidth}px, 34%) minmax(0, 1fr) 56px`;
  const tickShown = tickLabelsShown(scale.ticks, scale.max, trackWidth);
  const gridLines = scale.ticks.map((tick) => (
    <div key={tick} style={{ ...styles.hGrid, left: `${(tick / scale.max) * 100}%`, borderLeft: `1px ${tick ? "dashed" : "solid"} ${tick ? GRID : AXIS}` }} />
  ));
  return (
    <div ref={wrapRef} style={styles.hWrap}>
      {rows.map((row) => {
        const segments = row.segments.filter((segment) => toCount(segment.value) > 0);
        const total = row.segments.reduce((sum, segment) => sum + toCount(segment.value), 0);
        return (
          <div key={row.key} style={{ ...styles.hRow, gridTemplateColumns: columns, marginTop: row.gapTop || 0, rowGap: narrow ? 4 : 12 }}>
            <div style={{ ...styles.hLabel, fontWeight: row.sub ? 600 : 800, color: row.sub ? MUTED : INK, gridColumn: narrow ? "1 / -1" : "auto" }}>
              {row.group ? <span style={styles.hGroup}>{row.group}</span> : null}
              {row.label}
            </div>
            <div style={styles.hTrack}>
              {gridLines}
              <div style={{ ...styles.hBar, width: `${(total / scale.max) * 100}%` }}>
                {segments.map((segment) => {
                  const pixels = (toCount(segment.value) / scale.max) * trackWidth - 2;
                  return (
                    <div key={segment.key} title={segment.title} style={{ ...styles.hSegment, flexGrow: toCount(segment.value), background: segment.color, color: segment.textColor || "#ffffff" }}>
                      {trackWidth && pixels >= valueWidth(segment.value) ? formatNumber(segment.value) : ""}
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={styles.hTotal}>{formatNumber(total)}</div>
          </div>
        );
      })}
      <div style={{ ...styles.hRow, gridTemplateColumns: columns }}>
        {narrow ? null : <div />}
        <div ref={trackRef} style={styles.hAxis}>
          {scale.ticks.map((tick, index) => (tickShown[index] ? (
            <span
              key={tick}
              style={{
                ...styles.hTick,
                left: `${(tick / scale.max) * 100}%`,
                // The last tick is right-aligned, so it never runs past the chart.
                transform: `translateX(${index === 0 ? "0" : index === scale.ticks.length - 1 ? "-100%" : "-50%"})`,
              }}
            >
              {formatNumber(tick)}
            </span>
          ) : null))}
        </div>
        <div />
      </div>
    </div>
  );
}

// A donut from SVG circles, starting at the top, clockwise, with a 2px gap between pieces.
// parts: [{ key, label, value, color }]
export function Donut({ parts, size = 150, centre, caption, name }) {
  const stroke = size * 0.18;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = parts.reduce((sum, part) => sum + toCount(part.value), 0);
  const shown = parts.filter((part) => toCount(part.value) > 0);
  const gap = shown.length > 1 ? 2 : 0;
  // Each piece's length along the ring, and where it starts (the pieces before it).
  const lengths = shown.map((part) => (toCount(part.value) / total) * circumference);
  const starts = lengths.map((_, index) => lengths.slice(0, index).reduce((sum, length) => sum + length, 0));
  return (
    <div style={{ ...styles.donut, width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${name ? `${name}: ` : ""}${formatNumber(total)} ${caption}`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {total ? null : <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={GRID} strokeWidth={stroke} />}
          {shown.map((part, index) => {
            const dash = Math.max(lengths[index] - gap, Math.min(lengths[index], 1));
            return (
              <circle
                key={part.key}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={part.color}
                strokeWidth={stroke}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-starts[index]}
              >
                <title>{`${name ? `${name}, ` : ""}${part.label}: ${formatNumber(part.value)}`}</title>
              </circle>
            );
          })}
        </g>
      </svg>
      <div style={styles.donutCentre}>
        <strong style={{ ...styles.donutTotal, fontSize: size >= 150 ? 24 : 18 }}>{centre ?? formatNumber(total)}</strong>
        <span style={styles.donutCaption}>{caption}</span>
      </div>
    </div>
  );
}

export function Legend({ items }) {
  return (
    <div style={styles.legend}>
      {items.map((item) => (
        <span key={item.key} style={styles.legendItem}><Dot color={item.color} />{item.label}</span>
      ))}
    </div>
  );
}

// Each part's share, rounded so the list adds up to exactly 100.0%, with its label.
export function ShareList({ parts }) {
  const percents = shares(parts.map((part) => part.value));
  return (
    <div style={styles.shareList}>
      {parts.map((part, index) => (
        <span key={part.key} style={styles.shareItem}>
          <Dot color={part.color} />
          <strong style={styles.sharePercent}>{percents[index]}</strong>
          <span style={styles.shareLabel}>{part.label}</span>
        </span>
      ))}
    </div>
  );
}

const styles = {
  dot: { display: "inline-block", width: 10, height: 10, borderRadius: 999, flexShrink: 0 },
  vWrap: { paddingLeft: 44, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 },
  vPlot: { position: "relative", marginTop: 24 },
  vGrid: { position: "absolute", left: 0, right: 0 },
  vTick: { position: "absolute", left: -44, width: 36, textAlign: "right", fontSize: 11, color: MUTED, fontVariantNumeric: "tabular-nums" },
  vBars: { position: "absolute", inset: 0, display: "flex", justifyContent: "space-around", alignItems: "flex-end" },
  vColumn: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 6, flex: "0 1 110px", minWidth: 0, height: "100%" },
  vValue: { fontSize: 14, color: INK, fontVariantNumeric: "tabular-nums" },
  // flexShrink 0: the value label above a bar must never squash the bar, or it is no longer drawn to scale.
  vBar: { width: "80%", maxWidth: 88, borderRadius: "6px 6px 0 0", flexShrink: 0 },
  vLabels: { display: "flex", justifyContent: "space-around" },
  vLabel: { flex: "0 1 110px", minWidth: 0, textAlign: "center", fontSize: 12, fontWeight: 800, color: INK },
  hWrap: { display: "flex", flexDirection: "column", gap: 10, minWidth: 0 },
  hRow: { display: "grid", alignItems: "center", gap: 12 },
  hLabel: { fontSize: 13, lineHeight: 1.2, minWidth: 0, overflowWrap: "anywhere" },
  hGroup: { display: "block", fontWeight: 900, color: INK },
  hTrack: { position: "relative", height: 24, minWidth: 0 },
  hGrid: { position: "absolute", top: -5, bottom: -5 },
  // The white background shows through the 2px gaps between segments.
  hBar: { position: "absolute", left: 0, top: 0, bottom: 0, display: "flex", gap: 2, borderRadius: 4, overflow: "hidden", background: "#ffffff" },
  hSegment: { flexShrink: 1, flexBasis: 0, minWidth: 2, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", fontVariantNumeric: "tabular-nums", overflow: "hidden", whiteSpace: "nowrap" },
  hTotal: { fontSize: 13, fontWeight: 900, color: INK, textAlign: "right", fontVariantNumeric: "tabular-nums" },
  hAxis: { position: "relative", height: 14, minWidth: 0 },
  hTick: { position: "absolute", top: 0, fontSize: 11, color: MUTED, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  donut: { position: "relative", flexShrink: 0 },
  donutCentre: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, pointerEvents: "none" },
  donutTotal: { color: INK, fontVariantNumeric: "tabular-nums" },
  donutCaption: { fontSize: 11, color: MUTED, fontWeight: 700 },
  legend: { display: "flex", flexWrap: "wrap", gap: "8px 18px", fontSize: 12, color: MUTED, fontWeight: 700 },
  legendItem: { display: "inline-flex", alignItems: "center", gap: 6 },
  shareList: { display: "flex", flexDirection: "column", gap: 5, minWidth: 0 },
  shareItem: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: INK, fontVariantNumeric: "tabular-nums" },
  sharePercent: { width: 46, flexShrink: 0 },
  shareLabel: { color: MUTED, fontWeight: 700 },
};
