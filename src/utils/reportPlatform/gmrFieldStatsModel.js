// Field Stats (GMR 1.2.0 section 10, schema 1.1.0 section 5).
//
// The top of the sheet is Zamo's Field Stats, unchanged: METER AUDIT and
// NORMALISATION per field worker, then METER STATUS per team, counting the
// month's Meter Discovery records. The extra counts the rules add sit below
// the Teams block. Counts come only from Field Data rows.

export const GMR_NAV = "NAv";

const TRN_TYPE_ORDER = [
  "Meter Discovery",
  "Meter Inspection",
  "Meter Disconnection",
  "Meter Reconnection",
  "Meter Reading",
  "Meter Removal",
  "Meter Installation",
  "Meter Commissioning",
];

// MA-R001 section 1: every finding and its details, in the order the field
// team reads them. Each line is one detail.
const METER_STATUS_ORDER = [
  ["Illegally Connected", ["Straight Connection (Meter Bypassed)", "Bridge Wire On The Meter"]],
  ["Meter Damaged", ["Meter Number Not Clearly Visible", "Meter Burnt", "Meter Button(s) Not Working", "Meter Broken"]],
  ["Meter Faulty", [
    "Not Accepting Sgc Tokens",
    "Meter Display Blank",
    "Negative Credit Units",
    "Zero Reading - Conventional Meter",
    "Meter Wheel Not Moving",
    "Meter Wheel Running In Reverse",
  ]],
  ["Meter Ok", ["Operationally Ok", "Bridge Suspicion", "Bypass Suspicion"]],
].flatMap(([finding, details]) => details.map((detail) => meterStatusLabel(finding, detail)));

const NO_ACCESS_LABEL = "No Access";
const NOT_AVAILABLE = GMR_NAV;

// Zamo's fixed METER AUDIT lines, written as the field records them; anything
// else recorded follows them, which is where No Access appears.
const ZAMO_METER_STATUS_ORDER = ["Illegally Connected", "Meter Damaged", "Meter Faulty", "Meter Ok"];

const ILLEGAL_CONNECTION = "Illegally Connected";

// The owner's layout: NONE first, then each finding that called for work with
// what was done, and a healthy meter's own fix last.
const NORMALISATION_FINDING_ORDER = ["Meter Ok", "Illegally Connected", "Meter Damaged", "Meter Faulty"];

// A visit with no access has no normalisation to report, so its Field Data
// column reads NAv. The block still counts it under No Access, which is what
// the words mean: the worker could not reach the meter.
function normalisationLine(row = {}) {
  return row?.hasAccess === false ? NO_ACCESS_LABEL : zamoLabel(row?.normalisation);
}

function normalisationRank(label, rows) {
  const first = rows.find((row) => normalisationLine(row) === label) || {};
  const didWork = (first.normalisationActions || []).some(
    (action) => text(action) && text(action) !== "None",
  );
  const [finding] = String(label).split(" - ");
  const findingRank = NORMALISATION_FINDING_ORDER.indexOf(finding);

  // The owner's order: the healthy meters first, then each finding that called
  // for work, then a healthy meter's own fix, and No Access last of all.
  const healthy = findingRank === 0;
  const group = label === NO_ACCESS_LABEL
    ? 9
    : healthy ? (didWork ? 5 : 0) : findingRank === -1 ? 4 : findingRank;
  // Within a finding: the work done, then nothing done with a reason, then
  // nothing done and nothing said.
  const kind = didWork ? 0 : text(first.noActionReason) ? 1 : 2;
  return [group, kind, label];
}

// The value exactly as the field recorded it. The report never rewrites what
// was submitted (owner, 25 September 2026).
function zamoLabel(value) {
  const label = text(value);
  return label && label !== NOT_AVAILABLE && label !== GMR_NAV ? label : NOT_AVAILABLE;
}

function zamoMeterStatus(row) {
  if (row?.hasAccess === false) return NO_ACCESS_LABEL;
  const primary = zamoLabel(row?.primaryFinding);
  return primary !== NOT_AVAILABLE ? primary : zamoLabel(row?.findingDetail);
}

// Zamo's Field Stats, exactly as before: the month's Meter Discovery records,
// field workers by name, teams from team history (GMR-R020).
// GMR-R013 (1.11.0): a no-access record is not on Field Data any more, and it
// is still the period's work, so every count here reads both lists.
export function gmrWorkRows(dataset = {}) {
  const payable = Array.isArray(dataset?.fieldRows) ? dataset.fieldRows : [];
  const noAccess = Array.isArray(dataset?.noAccessRows) ? dataset.noAccessRows : [];
  return [...payable, ...noAccess];
}

export function buildZamoFieldStats(dataset = {}) {
  // The owner's layout, 25 September 2026, plus the one thing he added to it:
  // a NO ACCESS line. The blocks count every Meter Discovery record of the
  // period, whether or not a meter was captured.
  const rows = gmrWorkRows(dataset).filter((row) => row?.trnType === "METER_DISCOVERY");
  const workerOfRow = (row) => text(row?.fieldWorkerName) || NOT_AVAILABLE;
  const teamOfRow = (row) => text(row?.team) || "Unassigned";
  const workers = [...new Set(rows.map(workerOfRow))].sort((left, right) => left.localeCompare(right));
  const teams = [...new Set(rows.map(teamOfRow))].sort((left, right) => left.localeCompare(right));
  const statuses = withExtras(ZAMO_METER_STATUS_ORDER, rows.map(zamoMeterStatus));
  const normalisations = [...new Set(rows.map(normalisationLine))]
    .map((label) => ({ label, rank: normalisationRank(label, rows) }))
    .sort((left, right) =>
      left.rank[0] - right.rank[0] || left.rank[1] - right.rank[1] || left.rank[2].localeCompare(right.rank[2]))
    .map((item) => item.label);

  const tally = (keys, keyOf, labelOf, labels) => {
    const table = new Map(labels.map((label) => [label, new Map(keys.map((key) => [key, 0]))]));
    rows.forEach((row) => {
      const counts = table.get(labelOf(row));
      counts.set(keyOf(row), (counts.get(keyOf(row)) || 0) + 1);
    });
    return table;
  };
  const totals = (keys, keyOf) => {
    const counts = new Map(keys.map((key) => [key, 0]));
    rows.forEach((row) => counts.set(keyOf(row), (counts.get(keyOf(row)) || 0) + 1));
    return counts;
  };

  return {
    records: rows.length,
    workers,
    teams,
    statuses,
    normalisations,
    statusByWorker: tally(workers, workerOfRow, zamoMeterStatus, statuses),
    normalisationByWorker: tally(workers, workerOfRow, normalisationLine, normalisations),
    statusByTeam: tally(teams, teamOfRow, zamoMeterStatus, statuses),
    workerTotals: totals(workers, workerOfRow),
    teamTotals: totals(teams, teamOfRow),
  };
}
const FINDING_TRN_TYPES = new Set(["METER_DISCOVERY", "METER_INSPECTION"]);

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function meterStatusLabel(finding, detail) {
  const findingText = upper(finding) || upper(GMR_NAV);
  const detailText = upper(detail);
  return detailText ? `${findingText} - ${detailText}` : findingText;
}

function withExtras(order, observed) {
  const extra = [...new Set(observed)]
    .filter((label) => label && !order.includes(label))
    .sort((left, right) => left.localeCompare(right));
  return [...order, ...extra];
}

export function gmrMeterStatusLine(row = {}) {
  if (!row?.hasAccess) return NO_ACCESS_LABEL;
  return meterStatusLabel(row?.primaryFinding, row?.findingDetail);
}

// Workers are told apart by user, not by display name.
function workerOf(row) {
  const uid = text(row?.fieldWorkerUid);
  if (uid) return `uid:${uid}`;
  const name = text(row?.fieldWorkerName);
  return name ? `name:${name}` : GMR_NAV;
}

function buildWorkerLabels(rows, workers) {
  const nameByKey = new Map();
  rows.forEach((row) => {
    const key = workerOf(row);
    if (!nameByKey.has(key) || nameByKey.get(key) === GMR_NAV) {
      nameByKey.set(key, text(row?.fieldWorkerName) || GMR_NAV);
    }
  });
  const count = new Map();
  workers.forEach((key) => count.set(nameByKey.get(key), (count.get(nameByKey.get(key)) || 0) + 1));
  return new Map(
    workers.map((key) => {
      const name = nameByKey.get(key) || GMR_NAV;
      const clash = count.get(name) > 1 && key.startsWith("uid:");
      return [key, clash ? `${name} (${key.slice(4, 10)})` : name];
    }),
  );
}

function teamOf(row) {
  return text(row?.team) || "Unassigned";
}

function countLine(label, rows, workers, teams, include) {
  const byWorker = new Map(workers.map((worker) => [worker, 0]));
  const byTeam = new Map(teams.map((team) => [team, 0]));
  let total = 0;

  rows.forEach((row) => {
    if (!include(row)) return;
    byWorker.set(workerOf(row), (byWorker.get(workerOf(row)) || 0) + 1);
    byTeam.set(teamOf(row), (byTeam.get(teamOf(row)) || 0) + 1);
    total += 1;
  });

  return { label, byWorker, byTeam, total };
}

export function buildGmrFieldStatsModel(dataset = {}) {
  const rows = gmrWorkRows(dataset);
  const unplaced = Array.isArray(dataset?.unplaced) ? dataset.unplaced : [];
  // GMR-R040: captures that claimed a meter and produced none. They are gone
  // from rows already; the report still has to say so.
  const droppedCaptures = Array.isArray(dataset?.droppedCaptures) ? dataset.droppedCaptures : [];
  const workerKeys = [...new Set(rows.map(workerOf))];
  const provisional = buildWorkerLabels(rows, workerKeys);
  const workers = workerKeys.sort(
    (left, right) => provisional.get(left).localeCompare(provisional.get(right)) || left.localeCompare(right),
  );
  const workerLabels = buildWorkerLabels(rows, workers);
  const teams = [...new Set(rows.map(teamOf))].sort((left, right) => left.localeCompare(right));
  const line = (label, include) => countLine(label, rows, workers, teams, include);

  const findingRows = rows.filter((item) => FINDING_TRN_TYPES.has(item?.trnType));
  const actedRows = findingRows.filter((item) => item?.hasAccess);

  const statusLabels = withExtras(
    [...METER_STATUS_ORDER, NO_ACCESS_LABEL],
    findingRows.map(gmrMeterStatusLine),
  );
  const reasons = [...new Set(actedRows.map((item) => upper(item?.noActionReason)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const typeLabels = withExtras(TRN_TYPE_ORDER, rows.map((item) => text(item?.trnTypeLabel)));

  const blocks = [
    {
      key: "METER_STATUS_DETAIL",
      title: "METER STATUS DETAIL",
      column: "METER STATUS DETAIL",
      lines: statusLabels.map((label) =>
        line(label, (item) => FINDING_TRN_TYPES.has(item?.trnType) && gmrMeterStatusLine(item) === label)),
      total: line("TOTAL: METER DISCOVERY AND INSPECTION RECORDS", (item) => FINDING_TRN_TYPES.has(item?.trnType)),
    },
    {
      // GMR-R031: where the action that follows the finding was not taken, why.
      key: "NO_ACTION",
      title: "NO ACTION TAKEN",
      column: "REASON FOR NOT ACTING",
      lines: reasons.map((reason) =>
        line(reason, (item) => FINDING_TRN_TYPES.has(item?.trnType) && item?.hasAccess && upper(item?.noActionReason) === reason)),
      total: line("TOTAL: NO ACTION TAKEN", (item) =>
        FINDING_TRN_TYPES.has(item?.trnType) && item?.hasAccess && Boolean(text(item?.noActionReason))),
    },
    {
      key: "TRANSACTIONS",
      title: "TRANSACTIONS",
      column: "TRANSACTION TYPE",
      lines: typeLabels.map((label) => line(upper(label), (item) => text(item?.trnTypeLabel) === label)),
      total: line("TOTAL: PAYABLE TRANSACTIONS", () => true),
    },
    {
      key: "DISCONNECTIONS",
      title: "DISCONNECTIONS CALLED FOR",
      column: "DISCONNECTION",
      lines: [
        line("CALLED FOR", (item) => Boolean(text(item?.followUpRequired))),
        line("COMPLETED", (item) => text(item?.followUpStatus) === "Completed"),
        line("NOT STARTED", (item) => text(item?.followUpStatus) === "Not Started"),
        line("NO DISCONNECTION RECORD", (item) => text(item?.followUpStatus) === "No disconnection record"),
      ],
      total: null,
    },
    {
      key: "OUTSIDE_BATCHES",
      title: "OUTSIDE BATCHES (AD HOC)",
      column: "TRANSACTION TYPE",
      lines: typeLabels.map((label) =>
        line(upper(label), (item) => text(item?.trnTypeLabel) === label && text(item?.batchId) === "AD HOC")),
      total: line("TOTAL: AD HOC TRANSACTIONS", (item) => text(item?.batchId) === "AD HOC"),
    },
  ];

  // Only rows judged against the vending list carry Yes or No (an electricity
  // meter with a real meter number).
  const judged = rows.filter((item) => item?.hasAccess && ["Yes", "No"].includes(item?.onVendingList));
  const electricityFound = judged.filter((item) => item?.trnType === "METER_DISCOVERY");
  const distinctMeters = (items) => new Set(items.map((item) => text(item?.fieldFoundMeterNo))).size;
  const unresolvedWorkers = new Set(
    rows.filter((item) => ["Unassigned", "Multiple"].includes(teamOf(item))).map(workerOf),
  );


  // GMR-R019 (1.7.0): all work is done through batches except where there is an
  // illegal connection. A worker who finds one while working a batch may
  // capture it there and then, and that capture carries no batch — so it is
  // counted on its own line and never against the work that has no business
  // being outside a batch (owner, 26 September 2026).
  const withoutBatch = rows.filter((item) => text(item?.batchId) === "AD HOC");
  const illegalWithoutBatch = withoutBatch.filter((item) => zamoMeterStatus(item) === ILLEGAL_CONNECTION);

  // GMR-R041: every exception is named once here, and both the control line and
  // the Exceptions sheet read from the same list, so the count and the rows
  // behind it can never disagree.
  const otherWithoutBatch = withoutBatch.filter((item) => zamoMeterStatus(item) !== ILLEGAL_CONNECTION);
  const offVendingRows = electricityFound.filter((item) => item?.onVendingList === "No");
  const visibilityRows = judged.filter(
    (item) =>
      (item?.visibility === "Invisible" && item?.onVendingList === "Yes") ||
      (item?.visibility === "Visible" && item?.onVendingList === "No"),
  );
  const noSalesCategoryRows = actedRows.filter(
    (item) => item?.meterType === "ELECTRICITY" && !text(item?.salesCategory),
  );
  const missingEvidenceRows = rows.filter(
    (item) =>
      item?.hasAccess &&
      (!text(item?.gpsCoordinates) ||
        !(item?.photoUrls || []).length ||
        (FINDING_TRN_TYPES.has(item?.trnType) && item?.meterType === "ELECTRICITY" && !(item?.normalisationActions || []).length)),
  );
  const unresolvedTeamRows = rows.filter((item) => ["Unassigned", "Multiple"].includes(teamOf(item)));
  const masterGapRows = rows.filter((item) => item?.meterInMaster === false);

  function missingEvidenceText(item) {
    const missing = [];
    if (!text(item?.gpsCoordinates)) missing.push("GPS");
    if (!(item?.photoUrls || []).length) missing.push("a photograph");
    if (FINDING_TRN_TYPES.has(item?.trnType) && item?.meterType === "ELECTRICITY" && !(item?.normalisationActions || []).length) {
      missing.push("a normalisation answer");
    }
    return `The record has no ${missing.join(", no ")}.`;
  }

  const exception = (kind, counted, item, explanation, overrides = {}) => ({
    kind,
    counted,
    trnId: text(item?.trnId) || GMR_NAV,
    trnTypeLabel: text(item?.trnTypeLabel) || GMR_NAV,
    captureDate: item?.captureDate || null,
    fieldWorkerName: text(item?.fieldWorkerName) || GMR_NAV,
    meterNo: text(item?.fieldFoundMeterNo) || GMR_NAV,
    explanation,
    ...overrides,
  });

  // In the order of the control lines, so the sheet and the counts read the
  // same way down the page.
  const exceptions = [
    ...unplaced.map((item) =>
      exception("Submitted but not on Field Data", "No", item, text(item?.reason) || "It could not be placed in the period.", {
        trnTypeLabel: text(item?.trnType) || GMR_NAV,
        meterNo: GMR_NAV,
      })),
    ...otherWithoutBatch.map((item) =>
      exception("Work with no batch", "Yes", item,
        "The work was not issued through a batch, and it is not an illegal connection found along the way.")),
    ...offVendingRows.map((item) =>
      exception("Meter not on the vending list", "Yes", item,
        "The meter was found in the field but its number is not on the vending provider's list.")),
    ...visibilityRows.map((item) =>
      exception("Visibility disagrees with Sales", "Yes", item,
        `The meter is marked ${text(item?.visibility)} while the vending list says ${text(item?.onVendingList)}.`)),
    ...noSalesCategoryRows.map((item) =>
      exception("No Sales Category", "Yes", item,
        "An electricity record with access and no Sales Category.")),
    ...missingEvidenceRows.map((item) =>
      exception("Missing GPS, photograph or normalisation", "Yes", item, missingEvidenceText(item))),
    ...unresolvedTeamRows.map((item) =>
      exception("Team could not be resolved", "Yes", item,
        `The worker's team at the time of the work reads ${teamOf(item)}.`)),
    ...droppedCaptures.map((item) =>
      exception("A meter was claimed but not created", "No", item,
        text(item?.reason) || "The capture says a meter was created, but the meter is not there.", {
          meterNo: text(item?.claimedMeterNo) || GMR_NAV,
        })),
    ...masterGapRows.map((item) =>
      exception("Meter not in meter master", "Yes", item,
        "The meter is in the assets collection, but its number is not in meter master.")),
  ];

  // GMR-R044: the summary says why the numbers are what they are, instead of
  // leaving a reader to work it out. Every line counts the same lists the
  // sheets are built from.
  const payableRows = Array.isArray(dataset?.fieldRows) ? dataset.fieldRows : [];
  const noAccessRows = Array.isArray(dataset?.noAccessRows) ? dataset.noAccessRows : [];
  const countByType = (list) => [...list.reduce((counts, row) => {
    const label = text(row?.trnTypeLabel) || text(row?.trnType) || GMR_NAV;
    return counts.set(label, (counts.get(label) || 0) + 1);
  }, new Map())]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([label, count]) => ({ label, count }));

  const typeCounts = countByType(payableRows);

  // A no access is an outcome on a transaction, not a transaction type, so the
  // period's no-access records are spread across the types. The blocks above
  // count Meter Discovery records; without this split a reader sees 11 there
  // and 15 here and has to work out why (owner, 30 September 2026).
  const noAccessByType = [...noAccessRows.reduce((counts, item) => {
    const label = text(item?.trnTypeLabel) || text(item?.trnType) || GMR_NAV;
    return counts.set(label, (counts.get(label) || 0) + 1);
  }, new Map())]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([label, count]) => ({
      label: upper(label) === "METER DISCOVERY"
        ? "    METER DISCOVERY - THE NO ACCESS LINE IN THE BLOCKS ABOVE"
        : `    ${upper(label)}`,
      count,
    }));

  const mdPayable = payableRows.filter((item) => item?.trnType === "METER_DISCOVERY").length;
  const mdNoAccess = noAccessRows.filter((item) => item?.trnType === "METER_DISCOVERY").length;

  const summaryLines = [
    { label: "TRANSACTIONS WHERE THE METER WAS REACHED, EVERY TYPE", count: payableRows.length },
    ...typeCounts.map((item) => ({ label: `    ${upper(item.label)}`, count: item.count })),
    { label: "NO ACCESS THIS PERIOD, EVERY TYPE - LISTED ON THE NO ACCESS SHEET", count: noAccessRows.length },
    ...noAccessByType,
    { label: "ALL TRANSACTIONS THIS PERIOD", count: payableRows.length + noAccessRows.length },
    { label: "ROWS ON FIELD DATA - MD", count: mdPayable },
    { label: "METER AUDIT TOTAL - FIELD DATA - MD PLUS ITS NO ACCESS", count: mdPayable + mdNoAccess },
    {
      label: "TRANSACTIONS NOT LISTED IN THIS REPORT (EVERY TYPE BUT METER DISCOVERY)",
      count: rows.length - mdPayable - mdNoAccess,
    },
    { label: "EXCEPTIONS NOT COUNTED, NO METER CREATED", count: droppedCaptures.length },
  ];

  return {
    workers,
    workerLabels,
    teams,
    blocks,
    summaryLines,
    droppedCaptures,
    exceptions,
    payableTotal: rows.length,
  };
}
