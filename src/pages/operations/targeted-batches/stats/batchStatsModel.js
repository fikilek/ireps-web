// Targeted Batch rules TB-R057 (1.3.55): Batch Stats display helpers. Pure (no React), so they are
// tested with node --test. The numbers themselves are counted by getBatchStatsCallable.

// Status colours are those of the GPS Sales map pins; only the three statuses are used.
export const STATUSES = Object.freeze([
  { key: "NOT_STARTED", label: "Not Started", color: "#2563eb" },
  { key: "IN_PROGRESS", label: "In Progress", color: "#b45309" },
  { key: "COMPLETED", label: "Completed", color: "#0f766e" },
]);

// The batch type is the one TB Register shows; Other is shown only when there is one.
export const BATCH_TYPES = Object.freeze([
  { key: "GPS", label: "GPS", color: "#4a3aa7" },
  { key: "NON_GPS", label: "Non-GPS", color: "#d55181" },
  { key: "OTHER", label: "Other", color: "#64748b" },
]);

// Part 4: why a CAT meter still to batch is not in a batch, in the order of the checks.
export const REASONS = Object.freeze([
  { key: "GPS_INSIDE_FENCE", label: "GPS, inside a geofence already drawn", color: "#9085e9", textColor: "#0f172a" },
  { key: "GPS_NO_FENCE", label: "GPS, no geofence yet", color: "#4a3aa7" },
  { key: "NON_GPS_READY", label: "Non-GPS, ERF known, not batched yet", color: "#d55181" },
  { key: "NON_GPS_MANUAL_ERFING", label: "Non-GPS, needs manual ERFing first", color: "#eda100", textColor: "#0f172a" },
  { key: "ADDRESS_MISSING", label: "Street address or town missing", color: "#e34948" },
  { key: "OTHER", label: "Other reason", color: "#64748b" },
]);

export const reasonLabels = Object.freeze(Object.fromEntries(REASONS.map((reason) => [reason.key, reason.label])));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const toCount = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0);
export const formatNumber = (value) => toCount(value).toLocaleString("en-US");
export const plural = (count, one, many) => (toCount(count) === 1 ? one : many);

// One status count ({ NOT_STARTED, IN_PROGRESS, COMPLETED }) with its total, never a missing number.
export function statusCounts(counts = {}) {
  const [notStarted, inProgress, completed] = STATUSES.map((status) => toCount(counts?.[status.key]));
  return { NOT_STARTED: notStarted, IN_PROGRESS: inProgress, COMPLETED: completed, total: notStarted + inProgress + completed };
}

// "0 / 36 / 145": Not Started / In Progress / Completed.
export const splitText = (counts) => STATUSES.map((status) => formatNumber(counts?.[status.key])).join(" / ");

// Shares in tenths of a percent by the largest-remainder method, so every donut adds up to exactly 100.0%.
export function shares(values = []) {
  const counts = values.map(toCount);
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (!total) return counts.map(() => "0.0%");
  const raw = counts.map((value) => (value * 1000) / total);
  const tenths = raw.map(Math.floor);
  let left = 1000 - tenths.reduce((sum, value) => sum + value, 0);
  raw
    .map((value, index) => ({ index, remainder: value - tenths[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .forEach(({ index }) => { if (left > 0) { tenths[index] += 1; left -= 1; } });
  return tenths.map((value) => `${(value / 10).toFixed(1)}%`);
}

// The smallest multiple of step at or above value, and never less than one step.
export const axisMax = (value, step) => Math.max(step, Math.ceil(toCount(value) / step) * step);

// A tick step of 1, 2 or 5 x 10^n giving about 4 to 7 ticks (never more than 6 steps from 0).
export function niceStep(value) {
  const max = toCount(value);
  for (let power = 1; ; power *= 10) {
    for (const base of [1, 2, 5]) {
      const step = base * power;
      if (Math.ceil(max / step) <= 6) return step;
    }
  }
}

// One scale for a chart: its largest value, the tick step and the ticks from 0.
export function chartScale(values = []) {
  const largest = Math.max(0, ...values.map(toCount));
  const step = niceStep(largest);
  const max = axisMax(largest, step);
  const ticks = [];
  for (let tick = 0; tick <= max; tick += step) ticks.push(tick);
  return { max, step, ticks };
}

// About the width in pixels of an 11px axis number.
const tickTextWidth = (tick) => { const text = formatNumber(tick); return text.replace(/,/g, "").length * 6.2 + (text.split(",").length - 1) * 3; };

// Which axis numbers to write on a narrow chart, so none overlap: always the first and the last
// (right-aligned), and the others only where they fit. Every tick keeps its grid line.
export function tickLabelsShown(ticks = [], max = 1, trackWidth = 0) {
  if (!trackWidth || ticks.length < 3) return ticks.map(() => true);
  const room = 8;
  const lastLeft = trackWidth - tickTextWidth(ticks[ticks.length - 1]);
  let previousRight = tickTextWidth(ticks[0]);
  return ticks.map((tick, index) => {
    if (index === 0 || index === ticks.length - 1) return true;
    const centre = (tick / max) * trackWidth;
    const half = tickTextWidth(tick) / 2;
    if (centre - half < previousRight + room || centre + half > lastLeft - room) return false;
    previousRight = centre + half;
    return true;
  });
}

// Part 3: a type with no meters shows "none", and its total 0.
export function teamTypeCells(team = {}) {
  const batches = team?.batches || {};
  const other = toCount(batches.OTHER);
  const cell = (counts) => {
    const status = statusCounts(counts);
    return { text: status.total ? splitText(status) : "none", total: status.total };
  };
  return {
    batches: `${formatNumber(batches.total)} (${formatNumber(batches.GPS)} / ${formatNumber(batches.NON_GPS)}${other ? `, ${formatNumber(other)} other` : ""})`,
    gps: cell(team?.meters?.GPS),
    nonGps: cell(team?.meters?.NON_GPS),
  };
}

// "19 Sep 2026, 18:30" in the browser's own time.
export function formatReadAt(iso) {
  const date = new Date(iso || "");
  if (!iso || Number.isNaN(date.getTime())) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const townLabel = (town) => String(town || "").trim() || "No town";

// The reasons to show: the five always, Other only when a meter has another reason.
export const shownReasons = (totals = {}) => REASONS.filter((reason) => reason.key !== "OTHER" || toCount(totals?.OTHER) > 0);

// "Other reason: … (12); … (3)." in the plain words the server sends.
export function otherReasonsText(otherReasons = []) {
  const list = (Array.isArray(otherReasons) ? otherReasons : [])
    .filter((reason) => toCount(reason?.count) > 0)
    .map((reason) => `${String(reason?.label || "").trim() || "a reason that could not be named"} (${formatNumber(reason.count)})`);
  return list.length ? `${list.length === 1 ? "Other reason" : "Other reasons"}: ${list.join("; ")}.` : "";
}

// A failed count in plain words; the server's own message when it sent one.
export function batchStatsErrorText(error) {
  const code = String(error?.code || "").replace(/^functions\//, "");
  const message = String(error?.error || error?.message || "").trim();
  if (code === "deadline-exceeded") return "The count took too long and was stopped. Try again.";
  if (code === "unavailable") return "The server could not be reached. Check the connection and try again.";
  if (code === "not-found") return "Batch Stats is not available on this server yet.";
  if (code === "internal" || !message || message === code || message.toLowerCase() === "internal") return "The count failed on the server. Try again.";
  return message;
}
