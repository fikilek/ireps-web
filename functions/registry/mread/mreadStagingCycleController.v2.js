// functions/registry/mread/mreadStagingCycleController.v2.js
// Pure cycle-calendar helpers for MREAD staging snapshot generation.
// Source of truth: configured cycle windows + selected cycleId.

const DEFAULT_TIMEZONE = "Africa/Johannesburg";
const SYSTEM_NA = "NAv";

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isDateOnlyString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

export function toLocalDateKey(value = new Date(), timezone = DEFAULT_TIMEZONE) {
  if (isDateOnlyString(value)) return String(value);

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value supplied to MREAD cycle helper: ${value}`);
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(date)
    .reduce((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});

  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function compareDateKeys(left, right) {
  return String(left || "").localeCompare(String(right || ""));
}

function getCycleStartDate(cycle = {}) {
  return cycle?.window?.startDate || cycle?.startDate || null;
}

function getCycleEndDate(cycle = {}) {
  return cycle?.window?.endDate || cycle?.endDate || null;
}

function getCycleId(cycle = {}) {
  return cycle?.cycleId || cycle?.id || SYSTEM_NA;
}

export function normalizeMreadStagingCycle(cycle = {}) {
  const startDate = getCycleStartDate(cycle);
  const endDate = getCycleEndDate(cycle);
  const cycleId = getCycleId(cycle);

  if (!startDate || !endDate) {
    throw new Error(
      `MREAD_CYCLE_WINDOW_MISSING: ${cycleId} is missing window.startDate or window.endDate`,
    );
  }

  return {
    ...cycle,
    cycleId,
    window: {
      ...(cycle?.window || {}),
      startDate,
      endDate,
    },
  };
}

export function sortCyclesByWindowStartAsc(cycles = []) {
  return [...cycles].sort((left, right) => {
    const leftStart = getCycleStartDate(left) || "9999-12-31";
    const rightStart = getCycleStartDate(right) || "9999-12-31";
    const byStart = compareDateKeys(leftStart, rightStart);
    if (byStart !== 0) return byStart;
    return String(getCycleId(left)).localeCompare(String(getCycleId(right)));
  });
}

export function sortCyclesByWindowStartDesc(cycles = []) {
  return sortCyclesByWindowStartAsc(cycles).reverse();
}

export function isCycleFuture(cycle = {}, options = {}) {
  const timezone = options.timezone || DEFAULT_TIMEZONE;
  const asOfDate = toLocalDateKey(options.asOfDate || new Date(), timezone);
  const startDate = getCycleStartDate(cycle);
  return compareDateKeys(startDate, asOfDate) > 0;
}

export function isDateInsideCycle(cycle = {}, options = {}) {
  const timezone = options.timezone || DEFAULT_TIMEZONE;
  const asOfDate = toLocalDateKey(options.asOfDate || new Date(), timezone);
  const startDate = getCycleStartDate(cycle);
  const endDate = getCycleEndDate(cycle);

  return (
    compareDateKeys(startDate, asOfDate) <= 0 &&
    compareDateKeys(asOfDate, endDate) <= 0
  );
}

function summarizeRows(rows = []) {
  return rows.reduce(
    (acc, row) => {
      acc.total += 1;
      if (row.isFuture) acc.future += 1;
      else acc.available += 1;
      if (row.isCurrentCycle) acc.current += 1;
      return acc;
    },
    { total: 0, available: 0, future: 0, current: 0 },
  );
}

export function annotateMreadStagingCycles(cycles = [], options = {}) {
  const timezone = options.timezone || DEFAULT_TIMEZONE;
  const asOfDate = toLocalDateKey(options.asOfDate || new Date(), timezone);
  const sortedAsc = sortCyclesByWindowStartAsc(
    cycles.map(normalizeMreadStagingCycle),
  );

  const rowsAsc = sortedAsc.map((cycle, index) => {
    const baseCycle = index > 0 ? sortedAsc[index - 1] : null;
    const future = isCycleFuture(cycle, { asOfDate, timezone });
    const current = isDateInsideCycle(cycle, { asOfDate, timezone });

    return {
      ...cycle,
      isFuture: future,
      isCurrentCycle: current,
      availability: future ? "FUTURE" : "AVAILABLE",
      selectedCycle: {
        cycleId: cycle.cycleId,
        cycleLabel: cycle.cycleLabel || cycle.cycleId,
        billingPeriod: cycle.billingPeriod || SYSTEM_NA,
        window: cycle.window || null,
      },
      baseCycle: baseCycle
        ? {
            cycleId: baseCycle.cycleId,
            cycleLabel: baseCycle.cycleLabel || baseCycle.cycleId,
            billingPeriod: baseCycle.billingPeriod || SYSTEM_NA,
            window: baseCycle.window || null,
          }
        : null,
      cycleController: {
        asOfDate,
        timezone,
        rule: "SELECTED_CYCLE_BASE_CYCLE",
        availabilitySource: "COMPUTED_FROM_CYCLE_WINDOW",
      },
    };
  });

  const rows = sortCyclesByWindowStartDesc(rowsAsc);
  const currentCycle = rows.find((row) => row.isCurrentCycle) || null;

  return {
    asOfDate,
    timezone,
    rule: "SELECTED_CYCLE_BASE_CYCLE",
    availabilitySource: "COMPUTED_FROM_CYCLE_WINDOW",
    rows,
    summary: {
      ...summarizeRows(rows),
      currentCycle: currentCycle
        ? {
            cycleId: currentCycle.cycleId,
            cycleLabel: currentCycle.cycleLabel,
            window: currentCycle.window,
          }
        : null,
      asOfDate,
      timezone,
      rule: "SELECTED_CYCLE_BASE_CYCLE",
      availabilitySource: "COMPUTED_FROM_CYCLE_WINDOW",
    },
  };
}

export function findSelectedAndBaseCycle(cycleId, cycles = []) {
  const sortedAsc = sortCyclesByWindowStartAsc(
    cycles.map(normalizeMreadStagingCycle),
  );
  const selectedIndex = sortedAsc.findIndex(
    (cycle) => cycle.cycleId === cycleId || cycle.id === cycleId,
  );

  if (selectedIndex < 0) {
    throw new Error(`MREAD_SELECTED_CYCLE_NOT_FOUND: ${cycleId || SYSTEM_NA}`);
  }

  return {
    selectedCycle: sortedAsc[selectedIndex],
    baseCycle: selectedIndex > 0 ? sortedAsc[selectedIndex - 1] : null,
  };
}
