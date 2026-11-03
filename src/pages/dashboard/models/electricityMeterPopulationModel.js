// Electricity Meter Population Model (EMP-R001 v1.4.0)
// Pure computation and normalization for the Electricity Meter Population (Original Vending) Dashboard.

export const EMD_COLORS = Object.freeze({
  buying: "#0f9f95",
  notBuying: "#f97316",
  normal: "#2563eb",
  targeted: "#ea580c",
  removed: "#dc2626",
});

export function formatNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0";
  return new Intl.NumberFormat("en-US").format(Math.round(num));
}

export function formatCurrencyRands(cents) {
  const numCents = Number(cents);
  if (!Number.isFinite(numCents)) return "R 0";
  const rands = Math.round(numCents / 100);
  return `R ${new Intl.NumberFormat("en-US").format(rands)}`;
}

export function formatUnitsKwh(units) {
  const numUnits = Number(units);
  if (!Number.isFinite(numUnits)) return "0 kWh";
  return `${new Intl.NumberFormat("en-US").format(Math.round(numUnits))} kWh`;
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

  const buying = Math.max(0, Number(data.purchases?.buying ?? data.buying) || 0);
  const notBuying = Math.max(0, Number(data.purchases?.notBuying ?? data.notBuying) || 0);
  const totalMeters = Math.max(
    0,
    Number(data.totalMeters ?? (buying + notBuying || data.sources?.onList || data.onList)) || 0,
  );

  const salesTotalC = Math.max(0, Number(data.purchases?.salesTotalC ?? data.salesTotalC) || 0);
  const unitsTotal = Math.max(0, Number(data.purchases?.unitsTotal ?? data.unitsTotal) || 0);

  const avgSalesPerBuyingMeterC =
    data.purchases?.avgSalesPerBuyingMeterC != null
      ? Number(data.purchases.avgSalesPerBuyingMeterC)
      : buying > 0
        ? Math.round(salesTotalC / buying)
        : 0;

  const avgUnitsPerBuyingMeter =
    data.purchases?.avgUnitsPerBuyingMeter != null
      ? Number(data.purchases.avgUnitsPerBuyingMeter)
      : buying > 0
        ? Number((unitsTotal / buying).toFixed(1))
        : 0;

  const buyingShare =
    data.purchases?.buyingShare != null
      ? Number(data.purchases.buyingShare)
      : totalMeters > 0
        ? Number(((buying / totalMeters) * 100).toFixed(1))
        : 0;

  const notBuyingShare =
    data.purchases?.notBuyingShare != null
      ? Number(data.purchases.notBuyingShare)
      : totalMeters > 0
        ? Number(((notBuying / totalMeters) * 100).toFixed(1))
        : 0;

  const normal = Math.max(0, Number(data.categories?.normal ?? data.normal) || 0);
  const targeted = Math.max(0, Number(data.categories?.targeted ?? data.targeted) || 0);
  const classifiedTotal = Math.max(
    0,
    Number(data.categories?.classifiedTotal ?? (normal + targeted)) || 0,
  );

  const normalShare =
    data.categories?.normalShare != null
      ? Number(data.categories.normalShare)
      : classifiedTotal > 0
        ? Number(((normal / classifiedTotal) * 100).toFixed(1))
        : 0;

  const targetedShare =
    data.categories?.targetedShare != null
      ? Number(data.categories.targetedShare)
      : classifiedTotal > 0
        ? Number(((targeted / classifiedTotal) * 100).toFixed(1))
        : 0;

  const movements = {
    unchanged: data.movements?.unchanged != null ? Number(data.movements.unchanged) : 0,
    newMeters:
      data.movements?.new != null
        ? Number(data.movements.new)
        : data.movements?.newMeters != null
          ? Number(data.movements.newMeters)
          : 0,
    replacements: data.movements?.replacements != null ? Number(data.movements.replacements) : 0,
    removed: data.movements?.removed != null ? Number(data.movements.removed) : 0,
  };

  return {
    id: data.id || `${lmPcode}_${month}`,
    lmPcode,
    month,
    monthLabel: data.monthLabel || formatMonthLabel(month),
    totalMeters,
    buying,
    notBuying,
    buyingShare,
    notBuyingShare,
    salesTotalC,
    unitsTotal,
    avgSalesPerBuyingMeterC,
    avgUnitsPerBuyingMeter,
    classifiedTotal,
    normal,
    targeted,
    normalShare,
    targetedShare,
    movements,
    generatedAt: data.metadata?.generatedAt || data.generatedAt || null,
    updatedAt: data.metadata?.updatedAt || data.updatedAt || null,
    salesUpdatedAt: data.metadata?.salesUpdatedAt || data.salesUpdatedAt || null,
  };
}

export function pickActiveMonth(months = [], requested = "") {
  if (!Array.isArray(months) || months.length === 0) return "";
  const keys = months.map((m) => (typeof m === "string" ? m : m.month)).filter(Boolean);
  if (requested && keys.includes(requested)) return requested;
  return keys.at(-1) || "";
}

export const EMD_HELP_STORIES = Object.freeze({
  "kpi-total": {
    badge: "Top KPI",
    title: "Total Meters (Original Vending List)",
    body: "<p><strong>Total Meters</strong> represents the active electricity meters appearing on the monthly supplier vending file for this municipality.</p><p>It is the sum of <strong>Buying Meters (&gt; R 0)</strong> and <strong>Not Buying Meters (R 0)</strong> in the selected vending month.</p>",
  },
  "kpi-unchanged": {
    badge: "Movement KPI",
    title: "Unchanged Meters",
    body: "<p><strong>Unchanged Meters</strong> are continuing active meters that were already present on the previous supplier vending snapshot and remain active in the current month.</p>",
  },
  "kpi-new": {
    badge: "Movement KPI",
    title: "New Meters",
    body: "<p><strong>New Meters</strong> are electricity meters appearing on the supplier vending list for the first time that are not linked as replacements of an existing baseline meter.</p>",
  },
  "kpi-replacements": {
    badge: "Movement KPI",
    title: "Replacements",
    body: "<p><strong>Replacements</strong> are newly added meters on the supplier vending list whose <code>PreviousMeterNumber</code> links to an existing baseline meter that exited the list.</p>",
  },
  "kpi-removed": {
    badge: "Movement KPI",
    title: "Removed / Out of Service",
    body: "<p><strong>Removed Meters</strong> are meters from the prior supplier vending list that dropped off the current vending file without being replaced.</p><p><em>Important:</em> These meters sit beside the other KPIs and are excluded from Total Meters.</p>",
  },
  "card-donut": {
    badge: "Vending Split",
    title: "Buying vs Not Buying",
    body: "<p>This breakdown divides the active monthly supplier vending list into two groups for the selected month:</p><ul><li><strong>Buying (&gt; R 0):</strong> Meters that purchased prepaid electricity tokens during the month.</li><li><strong>Not Buying (R 0):</strong> Meters on the supplier vending list with zero token purchases during the month — our primary focus for revenue recovery.</li></ul>",
  },
  "card-scope": {
    badge: "Vending & Targeting",
    title: "Vending & Targeting Profile",
    body: "<p>Summarizes monthly token purchase revenue and kWh consumption alongside two operational bars:</p><p><strong>Bar 1 (Buying vs Not Buying):</strong> Shows the proportion of active vending list meters purchasing tokens (&gt; R 0) vs zero-purchase meters (R 0) in the selected month.</p><p><strong>Bar 2 (Normal vs Targeted CAT 1–8):</strong> Shows Mpilo's 30-month purchase analysis split between Normal buyers and Targeted revenue-protection candidates (CAT 1–8).</p>",
  },
  "card-notes": {
    badge: "Monthly Summary",
    title: "Monthly Vending Summary",
    body: "<p>Presents the exact source figures from the monthly supplier vending and classification workbooks:</p><p><strong>1. Monthly Purchase Activity:</strong> Buying (&gt; R 0) + Not Buying (R 0) = Total Supplier List Meters.</p><p><strong>2. Token Revenue &amp; Units:</strong> Total Rands, total kWh, and average spend/kWh per buying meter.</p><p><strong>3. Mpilo Category Split:</strong> Normal Buyers + Targeted (CAT 1–8) = Classified Total.</p>",
  },
});
