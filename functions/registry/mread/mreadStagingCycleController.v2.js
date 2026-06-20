// functions/src/mreadStagingCycleController.v2.js
// Pure controller helpers for MREAD staging cycle status.
// Source of truth: cycle windows + backend/current date. Stored status is not trusted.

const DEFAULT_TIMEZONE = "Africa/Johannesburg";
const PUBLIC_STATUSES = Object.freeze({
  CLOSED: "CLOSED",
  DRAFT: "DRAFT",
  OPEN: "OPEN",
});

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isDateOnlyString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function toLocalDateKey(value = new Date(), timezone = DEFAULT_TIMEZONE) {
  if (isDateOnlyString(value)) return String(value);

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value supplied to MREAD controller: ${value}`);
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
  return String(left).localeCompare(String(right));
}

function getCycleStartDate(cycle = {}) {
  return cycle?.window?.startDate || cycle?.startDate || null;
}

function getCycleEndDate(cycle = {}) {
  return cycle?.window?.endDate || cycle?.endDate || null;
}

function getCycleSortKey(cycle = {}) {
  const startDate = getCycleStartDate(cycle) || "9999-12-31";
  const cycleId = cycle?.cycleId || cycle?.id || "";
  return `${startDate}__${cycleId}`;
}

function normalizeCycleForController(cycle = {}) {
  const startDate = getCycleStartDate(cycle);
  const endDate = getCycleEndDate(cycle);

  if (!startDate || !endDate) {
    throw new Error(
      `Cycle ${cycle?.cycleId || cycle?.id || "UNKNOWN"} is missing window.startDate or window.endDate`,
    );
  }

  return {
    ...cycle,
    cycleId: cycle?.cycleId || cycle?.id,
    window: {
      ...(cycle?.window || {}),
      startDate,
      endDate,
    },
  };
}

function isDateInsideCycle(dateKey, cycle = {}) {
  const startDate = getCycleStartDate(cycle);
  const endDate = getCycleEndDate(cycle);

  return (
    compareDateKeys(startDate, dateKey) <= 0 &&
    compareDateKeys(dateKey, endDate) <= 0
  );
}

function summarizeRows(rows = []) {
  return rows.reduce(
    (acc, row) => {
      acc.total += 1;
      if (row.status === PUBLIC_STATUSES.CLOSED) acc.closed += 1;
      if (row.status === PUBLIC_STATUSES.DRAFT) acc.draft += 1;
      if (row.status === PUBLIC_STATUSES.OPEN) acc.open += 1;
      return acc;
    },
    { total: 0, closed: 0, draft: 0, open: 0 },
  );
}

export function computeMreadStagingCycleControllerState(
  cycles = [],
  { asOfDate = new Date(), timezone = DEFAULT_TIMEZONE } = {},
) {
  const asOfDateKey = toLocalDateKey(asOfDate, timezone);
  const sortedCycles = cycles
    .map(normalizeCycleForController)
    .sort((left, right) => getCycleSortKey(left).localeCompare(getCycleSortKey(right)));

  const liveIndex = sortedCycles.findIndex((cycle) =>
    isDateInsideCycle(asOfDateKey, cycle),
  );

  if (liveIndex < 0) {
    throw new Error(
      `MREAD_LIVE_CYCLE_NOT_FOUND: no configured cycle window contains ${asOfDateKey}`,
    );
  }

  const draftIndex = liveIndex - 1;

  if (draftIndex < 0) {
    throw new Error(
      `MREAD_DRAFT_CYCLE_NOT_AVAILABLE: live cycle ${sortedCycles[liveIndex]?.cycleId} has no previous configured cycle`,
    );
  }

  const baselineIndex = draftIndex - 1;
  const liveCycle = sortedCycles[liveIndex];
  const activeDraft = sortedCycles[draftIndex];
  const baselineCycle = baselineIndex >= 0 ? sortedCycles[baselineIndex] : null;

  const rows = sortedCycles.map((cycle, index) => {
    const status =
      index < draftIndex
        ? PUBLIC_STATUSES.CLOSED
        : index === draftIndex
          ? PUBLIC_STATUSES.DRAFT
          : PUBLIC_STATUSES.OPEN;

    return {
      ...cycle,
      storedStatus: cycle?.storedStatus || cycle?.status || "NAv",
      computedStatus: status,
      status,
      controller: {
        asOfDate: asOfDateKey,
        timezone,
        rule: "LIVE_MINUS_ONE_DRAFT",
        statusSource: "COMPUTED_FROM_CYCLE_WINDOW",
      },
    };
  });

  const counts = summarizeRows(rows);

  return {
    asOfDate: asOfDateKey,
    timezone,
    rule: "LIVE_MINUS_ONE_DRAFT",
    statusSource: "COMPUTED_FROM_CYCLE_WINDOW",
    liveCycle: rows[liveIndex],
    activeDraft: rows[draftIndex],
    baselineCycle: baselineIndex >= 0 ? rows[baselineIndex] : null,
    rows,
    summary: {
      ...counts,
      activeDraft: activeDraft
        ? {
            cycleId: activeDraft.cycleId,
            cycleLabel: activeDraft.cycleLabel,
            window: activeDraft.window,
          }
        : null,
      liveCycle: liveCycle
        ? {
            cycleId: liveCycle.cycleId,
            cycleLabel: liveCycle.cycleLabel,
            window: liveCycle.window,
          }
        : null,
      baselineCycle: baselineCycle
        ? {
            cycleId: baselineCycle.cycleId,
            cycleLabel: baselineCycle.cycleLabel,
            window: baselineCycle.window,
          }
        : null,
      asOfDate: asOfDateKey,
      timezone,
      rule: "LIVE_MINUS_ONE_DRAFT",
      statusSource: "COMPUTED_FROM_CYCLE_WINDOW",
    },
  };
}

export function assertMreadStagingDraftCycle(
  cycleId,
  cycles = [],
  options = {},
) {
  const controllerState = computeMreadStagingCycleControllerState(cycles, options);
  const activeDraftId = controllerState?.activeDraft?.cycleId;

  if (!cycleId || cycleId !== activeDraftId) {
    const error = new Error(
      `MREAD_STAGING_NOT_DRAFT: requested cycle ${cycleId || "NAv"} is not the current controller DRAFT cycle ${activeDraftId || "NAv"}`,
    );
    error.code = "MREAD_STAGING_NOT_DRAFT";
    error.controller = {
      requestedCycleId: cycleId || null,
      activeDraftCycleId: activeDraftId || null,
      asOfDate: controllerState.asOfDate,
      liveCycleId: controllerState?.liveCycle?.cycleId || null,
      baselineCycleId: controllerState?.baselineCycle?.cycleId || null,
    };
    throw error;
  }

  return controllerState;
}

export { DEFAULT_TIMEZONE, PUBLIC_STATUSES };
