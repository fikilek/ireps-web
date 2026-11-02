// Electricity Meter Population Model (EMP-R001 v1.3.0)
// Pure computation and normalization for the Electricity Meter Dashboard (EMD).

export const EMD_COLORS = Object.freeze({
  onList: "#008300",
  foundInField: "#eda100",
  normal: "#2a78d6",
  targeted: "#eb6834",
  gps: "#1baf7a",
  noGps: "#4a3aa7",
  removed: "#dc2626",
});

export function formatNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0";
  return new Intl.NumberFormat("en-ZA").format(num);
}

export function formatPercent(value, total) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return "0.0%";
  return `${((value / total) * 100).toFixed(1)}%`;
}

export function formatMonthLabel(monthKey) {
  if (!monthKey || typeof monthKey !== "string") return "";
  const [yearStr, monthStr] = monthKey.split("-");
  const year = Number(yearStr);
  const monthNumber = Number(monthStr);
  if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) return monthKey;
  return new Intl.DateTimeFormat("en-ZA", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

export function normalizeElectricityPopulationDoc(raw = {}) {
  const data = raw || {};
  const month = String(data.month || "").trim();
  const lmPcode = String(data.lmPcode || "").trim();

  const onList = Math.max(0, Number(data.sources?.onList ?? data.onList) || 0);
  const foundInField = Math.max(0, Number(data.sources?.foundInField ?? data.foundInField) || 0);
  const totalMeters = Math.max(0, Number(data.totalMeters ?? (onList + foundInField)) || 0);

  const normal = Math.max(0, Number(data.categories?.normal ?? data.normal) || 0);
  const targeted = Math.max(0, Number(data.categories?.targeted ?? data.targeted) || 0);

  const targetedWithGps = Math.max(0, Number(data.targetedGps?.withGps ?? data.targetedWithGps ?? data.withGps) || 0);
  const targetedWithoutGps = Math.max(0, Number(data.targetedGps?.withoutGps ?? data.targetedWithoutGps ?? data.withoutGps) || Math.max(0, targeted - targetedWithGps));

  const movements = {
    unchanged: data.movements?.unchanged != null ? Number(data.movements.unchanged) : null,
    newMeters: data.movements?.new != null ? Number(data.movements.new) : (data.movements?.newMeters != null ? Number(data.movements.newMeters) : null),
    replacements: data.movements?.replacements != null ? Number(data.movements.replacements) : null,
    removed: data.movements?.removed != null ? Number(data.movements.removed) : null,
  };

  const onListShare = totalMeters > 0 ? (onList / totalMeters) * 100 : 0;
  const foundInFieldShare = totalMeters > 0 ? (foundInField / totalMeters) * 100 : 0;

  const normalShare = onList > 0 ? (normal / onList) * 100 : 0;
  const targetedShare = onList > 0 ? (targeted / onList) * 100 : 0;

  const withGpsShare = targeted > 0 ? (targetedWithGps / targeted) * 100 : 0;
  const withoutGpsShare = targeted > 0 ? (targetedWithoutGps / targeted) * 100 : 0;

  return {
    id: data.id || `${lmPcode}_${month}`,
    lmPcode,
    month,
    monthLabel: formatMonthLabel(month),
    totalMeters,
    onList,
    foundInField,
    onListShare,
    foundInFieldShare,
    normal,
    targeted,
    normalShare,
    targetedShare,
    targetedWithGps,
    targetedWithoutGps,
    withGpsShare,
    withoutGpsShare,
    movements,
    generatedAt: data.metadata?.generatedAt || data.generatedAt || null,
    updatedAt: data.metadata?.updatedAt || data.updatedAt || null,
    salesUpdatedAt: data.metadata?.salesUpdatedAt || data.salesUpdatedAt || null,
  };
}

export function pickActiveMonth(months = [], requested = "") {
  if (!Array.isArray(months) || months.length === 0) return "";
  const keys = months.map(m => (typeof m === "string" ? m : m.month)).filter(Boolean);
  if (requested && keys.includes(requested)) return requested;
  return keys.at(-1) || "";
}

export const EMD_HELP_STORIES = Object.freeze({
  "kpi-total": {
    badge: "Top KPI",
    title: "Total Meters",
    body: "<p><strong>Total Project Meters</strong> represents the authoritative master baseline count of all active electricity meters within this municipality.</p><p>It is the mathematical sum of all meters appearing on the monthly <strong>Prepaid Sales</strong> file plus unlisted meters <strong>Found in the field</strong> during physical auditing campaigns.</p>",
  },
  "kpi-unchanged": {
    badge: "Movement KPI",
    title: "Unchanged Meters",
    body: "<p><strong>Unchanged Meters</strong> are continuing active meters that were already present on the previous month's prepaid sales list and have had no change in operational serial number or tariff linkage.</p><p>This metric measures network and vending stability across consecutive billing cycles.</p>",
  },
  "kpi-new": {
    badge: "Movement KPI",
    title: "New Meters",
    body: "<p><strong>New Meters</strong> are electricity meters appearing on the municipal vending system for the very first time.</p><p>These reflect brand-new electrifications, newly energised customer connections, or initial network registrations during the selected month.</p>",
  },
  "kpi-replacements": {
    badge: "Movement KPI",
    title: "Replacements",
    body: "<p><strong>Replacements</strong> represent meter units installed at existing premises to replace older, damaged, faulty, or bypassed meters.</p><p>The system detects these when an existing customer account transitions from an old meter serial number to a new replacement serial number.</p>",
  },
  "kpi-removed": {
    badge: "Movement KPI",
    title: "Removed / Out of Service",
    body: "<p><strong>Removed Meters</strong> are physical meters that have been decommissioned, pulled from premises, or marked as out-of-service in the field.</p><p><em>Important:</em> These meters are excluded from the active Total Project Population count.</p>",
  },
  "card-donut": {
    badge: "Donut Analysis",
    title: "Normal vs Targeted",
    body: "<p>This breakdown divides the municipality's prepaid sales meters into two distinct operational groups:</p><ul><li><strong>Normal:</strong> Legitimate customers purchasing electricity regularly with zero leakage flags. These meters are not targeted for field audits.</li><li><strong>Targeted (CAT 1–8):</strong> Accounts flagged with revenue leakage anomalies (e.g. zero buyers, suspicious consumption drops, or tamper flags). These form our active field inspection campaigns.</li></ul>",
  },
  "card-scope": {
    badge: "Operational Scope",
    title: "Project Scope Breakdown",
    body: "<p>The three project scope bars summarize the operational journey of your meters:</p><p><strong>Bar 1 (Sales vs Field):</strong> Compares registered vendor list meters against untracked meters discovered by field workers on the ground.</p><p><strong>Bar 2 (Normal vs Targeted):</strong> Segregates meters into normal vs targeted field audit candidates.</p><p><strong>Bar 3 (Targeted GPS vs Non-GPS):</strong> Isolates the Targeted meters into those ready for direct map geofencing vs those requiring street address reconciliation.</p>",
  },
  "card-notes": {
    badge: "Mathematical Summary",
    title: "Key Notes & Audit Proofs",
    body: "<p>The Key Notes panel arranges the population into strict mathematical and operational relationships:</p><p><strong>1. Source:</strong> Prepaid Sales + Found in Field = Total Project Meters.</p><p><strong>2. Scope:</strong> Normal + Targeted = Prepaid Sales list.</p><p><strong>3. Target GPS:</strong> Targeted with GPS + Targeted without GPS = Total Targeted.</p>",
  },
});
