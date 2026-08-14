import {
  hasUsableSalesGps,
  isSalesWithoutUsableGps,
} from "./salesGpsModel.js";

export const NGP_CLASSIFICATIONS = Object.freeze({
  DISCOVERED: "DISCOVERED",
  EXCEPTION: "EXCEPTION",
  ALREADY_BATCHED: "ALREADY_BATCHED",
  OUTSTANDING: "OUTSTANDING",
});

export const NGP_SELECTION_MAX = 20;

const INVALID_TEXT_VALUES = new Set(["", "NAV", "N/A", "NA", "NULL"]);

export function normalizePlanningKey(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

function displayText(value) {
  return String(value ?? "").trim();
}

function isMeaningfulPlanningText(value) {
  return !INVALID_TEXT_VALUES.has(displayText(value).toUpperCase());
}

export function formatAuthoritativeAddress(row = {}) {
  const strNo = String(row?.adr?.strNo ?? "");
  const strName = String(row?.adr?.strName ?? "");
  const strType = String(row?.adr?.strType ?? "");
  const displayedType = strType.trim() === "-" ? "" : strType;

  return [strNo, strName, displayedType]
    .filter((value) => String(value).trim() !== "")
    .join(" ");
}

export function formatStreetLabel(row = {}) {
  const strName = String(row?.adr?.strName ?? "");
  const strType = String(row?.adr?.strType ?? "");
  const displayedType = strType.trim() === "-" ? "" : strType;

  return [strName, displayedType]
    .filter((value) => String(value).trim() !== "")
    .join(" ");
}

export function compareNaturalValues(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function compareStreetNumbers(left, right) {
  const leftNumber = displayText(left?.adr?.strNo ?? left);
  const rightNumber = displayText(right?.adr?.strNo ?? right);
  const primary = compareNaturalValues(leftNumber, rightNumber);

  if (primary !== 0) return primary;

  return compareNaturalValues(left?.meterNo, right?.meterNo);
}

function getAddressExceptionReasons(row = {}) {
  const reasons = [];

  if (!isMeaningfulPlanningText(row?.town)) {
    reasons.push("Town / Area is missing");
  }

  if (!isMeaningfulPlanningText(row?.adr?.strNo)) {
    reasons.push("Street number is missing");
  }

  if (!isMeaningfulPlanningText(row?.adr?.strName)) {
    reasons.push("Street name is missing");
  }

  return reasons;
}

function getTbReferenceIntegrityReasons(row = {}) {
  const integrity = row?.tbRefsIntegrity;

  if (integrity?.valid !== false) return [];

  const issues = Array.isArray(integrity?.issues) ? integrity.issues : [];

  if (issues.length === 0) {
    return ["Targeted Batch reference data is invalid"];
  }

  return issues.map(
    (issue) => `Targeted Batch reference integrity issue: ${String(issue)}`,
  );
}

function getNormalizedTbRefs(row = {}) {
  return Array.isArray(row?.tbRefs) ? row.tbRefs : [];
}

export function hasCompletedMeterDiscovery(row = {}) {
  if (row?.tbRefsIntegrity?.valid === false) return false;

  return getNormalizedTbRefs(row).some((reference) => {
    const status = String(reference?.fieldWork?.status || "")
      .trim()
      .toUpperCase();
    const outcomeCode = String(reference?.fieldWork?.outcomeCode || "")
      .trim()
      .toUpperCase();

    return status === "COMPLETED" && outcomeCode === "METER_DISCOVERED";
  });
}

export function classifyNonGpsSalesRow(row = {}) {
  if (hasUsableSalesGps(row)) {
    return {
      classification: null,
      exceptionReasons: [],
      selectable: false,
    };
  }

  if (hasCompletedMeterDiscovery(row)) {
    return {
      classification: NGP_CLASSIFICATIONS.DISCOVERED,
      exceptionReasons: [],
      selectable: false,
    };
  }

  const exceptionReasons = [
    ...getAddressExceptionReasons(row),
    ...getTbReferenceIntegrityReasons(row),
  ];

  if (exceptionReasons.length > 0) {
    return {
      classification: NGP_CLASSIFICATIONS.EXCEPTION,
      exceptionReasons,
      selectable: false,
    };
  }

  if (getNormalizedTbRefs(row).length > 0) {
    return {
      classification: NGP_CLASSIFICATIONS.ALREADY_BATCHED,
      exceptionReasons: [],
      selectable: false,
    };
  }

  return {
    classification: NGP_CLASSIFICATIONS.OUTSTANDING,
    exceptionReasons: [],
    selectable: true,
  };
}

function buildTarget(row) {
  const classification = classifyNonGpsSalesRow(row);
  const townKey = normalizePlanningKey(row?.town);
  const streetNameKey = normalizePlanningKey(row?.adr?.strName);

  return {
    row,
    id: String(row?.id || ""),
    meterNo: String(row?.meterNo || ""),
    accountNumber: String(row?.accountNumber || ""),
    town: String(row?.town || ""),
    townKey,
    streetNameKey,
    streetKey:
      townKey && streetNameKey ? `${townKey}::${streetNameKey}` : "",
    streetLabel: formatStreetLabel(row),
    canonicalAddress: formatAuthoritativeAddress(row),
    classification: classification.classification,
    exceptionReasons: classification.exceptionReasons,
    selectable: classification.selectable,
  };
}

function incrementCounters(counters, classification) {
  counters.total += 1;

  if (classification === NGP_CLASSIFICATIONS.OUTSTANDING) {
    counters.outstanding += 1;
  } else if (classification === NGP_CLASSIFICATIONS.ALREADY_BATCHED) {
    counters.alreadyBatched += 1;
  } else if (classification === NGP_CLASSIFICATIONS.DISCOVERED) {
    counters.discovered += 1;
  }
}

function createCounters() {
  return {
    total: 0,
    outstanding: 0,
    alreadyBatched: 0,
    discovered: 0,
  };
}

export function buildNonGpsBatchPlanningModel(rows = []) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const gpsSummary = sourceRows.reduce(
    (summary, row) => {
      summary.total += 1;

      if (hasUsableSalesGps(row)) summary.usableGps += 1;
      else summary.noGps += 1;

      return summary;
    },
    { total: 0, usableGps: 0, noGps: 0 },
  );

  const targets = sourceRows.filter(isSalesWithoutUsableGps).map(buildTarget);
  const classifiedExceptions = targets.filter(
    (target) => target.classification === NGP_CLASSIFICATIONS.EXCEPTION,
  );
  const streetEligibleTargets = targets.filter(
    (target) =>
      target.classification !== NGP_CLASSIFICATIONS.EXCEPTION &&
      target.townKey &&
      target.streetNameKey &&
      target.streetKey,
  );
  const unplacedTargets = targets
    .filter(
      (target) =>
        target.classification !== NGP_CLASSIFICATIONS.EXCEPTION &&
        (!target.townKey || !target.streetNameKey || !target.streetKey),
    )
    .map((target) => ({
      ...target,
      visibilityReasons: [
        "Planning location is incomplete; shown here to preserve complete No-GPS visibility",
      ],
    }));
  const exceptions = [
    ...classifiedExceptions.map((target) => ({
      ...target,
      visibilityReasons: target.exceptionReasons,
    })),
    ...unplacedTargets,
  ];
  const townsByKey = new Map();

  streetEligibleTargets.forEach((target) => {
    let town = townsByKey.get(target.townKey);

    if (!town) {
      town = {
        key: target.townKey,
        town: target.town,
        counters: createCounters(),
        streetsByKey: new Map(),
      };
      townsByKey.set(target.townKey, town);
    }

    let street = town.streetsByKey.get(target.streetKey);

    if (!street) {
      street = {
        key: target.streetKey,
        townKey: target.townKey,
        town: target.town,
        streetNameKey: target.streetNameKey,
        streetLabel: target.streetLabel,
        counters: createCounters(),
        targets: [],
      };
      town.streetsByKey.set(target.streetKey, street);
    }

    street.targets.push(target);
    incrementCounters(street.counters, target.classification);
    incrementCounters(town.counters, target.classification);
  });

  const towns = Array.from(townsByKey.values())
    .map((town) => {
      const streets = Array.from(town.streetsByKey.values())
        .map((street) => ({
          ...street,
          targets: [...street.targets].sort((left, right) =>
            compareStreetNumbers(left.row, right.row),
          ),
        }))
        .sort((left, right) =>
          compareNaturalValues(left.streetLabel, right.streetLabel),
        );

      return {
        key: town.key,
        town: town.town,
        counters: town.counters,
        streetCount: streets.length,
        streets,
      };
    })
    .sort((left, right) => compareNaturalValues(left.town, right.town));

  const streetPlanningTargets = towns.flatMap((town) =>
    town.streets.flatMap((street) => street.targets),
  );
  const reconciles = reconcileNgpVisibility(
    targets,
    streetPlanningTargets,
    exceptions,
  );

  return {
    gpsSummary,
    noGpsTargets: targets,
    streetEligibleTargets,
    streetPlanningTargets,
    classifiedExceptions,
    unplacedTargets,
    exceptions,
    towns,
    counts: {
      noGps: targets.length,
      streetEligible: streetEligibleTargets.length,
      exceptions: classifiedExceptions.length,
    },
    visibilityCounts: {
      streetPlanning: streetPlanningTargets.length,
      exceptions: classifiedExceptions.length,
      unplaced: unplacedTargets.length,
      exceptionView: exceptions.length,
    },
    reconciles,
  };
}

export function reconcileNgpVisibility(
  noGpsTargets = [],
  streetPlanningTargets = [],
  exceptionViewTargets = [],
) {
  const source = Array.isArray(noGpsTargets) ? noGpsTargets : [];
  const streetVisible = Array.isArray(streetPlanningTargets)
    ? streetPlanningTargets
    : [];
  const exceptionVisible = Array.isArray(exceptionViewTargets)
    ? exceptionViewTargets
    : [];
  const sourceRows = new Set(source.map((target) => target?.row));
  const streetRows = streetVisible.map((target) => target?.row);
  const exceptionRows = exceptionVisible.map((target) => target?.row);
  const allVisibleRows = [...streetRows, ...exceptionRows];
  const visibleRowSet = new Set(allVisibleRows);

  return (
    allVisibleRows.length === source.length &&
    visibleRowSet.size === sourceRows.size &&
    [...sourceRows].every((row) => visibleRowSet.has(row))
  );
}

export function validateNgpSelection(targets = []) {
  const selectedTargets = Array.isArray(targets) ? targets : [];

  if (selectedTargets.length < 1) {
    return {
      ok: false,
      code: "NGP_SELECTION_EMPTY",
      message: "Select at least one Outstanding target.",
    };
  }

  if (selectedTargets.length > NGP_SELECTION_MAX) {
    return {
      ok: false,
      code: "NGP_SELECTION_TOO_LARGE",
      message: `Select no more than ${NGP_SELECTION_MAX} Outstanding targets.`,
    };
  }

  if (
    selectedTargets.some(
      (target) => target?.classification !== NGP_CLASSIFICATIONS.OUTSTANDING,
    )
  ) {
    return {
      ok: false,
      code: "NGP_SELECTION_NOT_OUTSTANDING",
      message: "Only Outstanding targets may be selected.",
    };
  }

  const streetKeys = new Set(
    selectedTargets.map((target) => String(target?.streetKey || "")),
  );

  if (streetKeys.size !== 1 || streetKeys.has("")) {
    return {
      ok: false,
      code: "NGP_SELECTION_MULTIPLE_STREETS",
      message: "A Non GPS planning selection must stay within one street.",
    };
  }

  return {
    ok: true,
    code: "NGP_SELECTION_READY",
    message: `${selectedTargets.length} Outstanding target${
      selectedTargets.length === 1 ? "" : "s"
    } selected.`,
  };
}
