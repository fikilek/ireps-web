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

const NO_ACCESS_LABEL = "NO ACCESS";
const NOT_AVAILABLE = "Not Available";

// Zamo's fixed METER AUDIT lines; anything else recorded follows them, which
// is where NO ACCESS appears (owner, 25 September 2026).
const ZAMO_METER_STATUS_ORDER = ["ILLEGALLY CONNECTED", "METER DAMAGED", "METER FAULTY", "METER OK"];

// The owner's layout: NONE first, then each finding that called for work with
// what was done, and a healthy meter's own fix last.
const NORMALISATION_FINDING_ORDER = ["ILLEGALLY CONNECTED", "METER DAMAGED", "METER FAULTY"];

function normalisationRank(label, rows) {
  const first = rows.find((row) => zamoLabel(row?.normalisation) === label) || {};
  const healthy = upper(first.primaryFinding) === "METER OK";
  const didWork = (first.normalisationActions || []).some(
    (action) => text(action) && text(action) !== "None",
  );
  const [finding] = String(label).split(" - ");
  const findingRank = NORMALISATION_FINDING_ORDER.indexOf(finding);

  // 0 NONE, 1-3 the findings that called for work, 4 a healthy meter's fix,
  // 5 NO ACCESS last.
  const group = label === "NO ACCESS"
    ? 5
    : healthy ? (didWork ? 4 : 0) : findingRank === -1 ? 3.5 : findingRank + 1;
  // Within a finding: the work done first, then a recorded reason, then NONE.
  const kind = didWork ? 0 : text(first.noActionReason) ? 1 : 2;
  return [group, kind, label];
}

function zamoLabel(value) {
  const label = upper(value);
  return label && label !== upper(NOT_AVAILABLE) && label !== upper(GMR_NAV) ? label : upper(NOT_AVAILABLE);
}

function zamoMeterStatus(row) {
  const primary = zamoLabel(row?.primaryFinding);
  return primary !== upper(NOT_AVAILABLE) ? primary : zamoLabel(row?.findingDetail);
}

// Zamo's Field Stats, exactly as before: the month's Meter Discovery records,
// field workers by name, teams from team history (GMR-R020).
export function buildZamoFieldStats(dataset = {}) {
  // The owner's layout, 25 September 2026, plus the one thing he added to it:
  // a NO ACCESS line. The blocks count every Meter Discovery record of the
  // period, whether or not a meter was captured.
  const rows = (Array.isArray(dataset?.fieldRows) ? dataset.fieldRows : [])
    .filter((row) => row?.trnType === "METER_DISCOVERY");
  const workerOfRow = (row) => text(row?.fieldWorkerName) || NOT_AVAILABLE;
  const teamOfRow = (row) => text(row?.team) || "Unassigned";
  const workers = [...new Set(rows.map(workerOfRow))].sort((left, right) => left.localeCompare(right));
  const teams = [...new Set(rows.map(teamOfRow))].sort((left, right) => left.localeCompare(right));
  const statuses = withExtras(ZAMO_METER_STATUS_ORDER, rows.map(zamoMeterStatus));
  const normalisations = [...new Set(rows.map((row) => zamoLabel(row?.normalisation)))]
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
    normalisationByWorker: tally(workers, workerOfRow, (row) => zamoLabel(row?.normalisation), normalisations),
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
  const rows = Array.isArray(dataset?.fieldRows) ? dataset.fieldRows : [];
  const unplaced = Array.isArray(dataset?.unplaced) ? dataset.unplaced : [];
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

  const controlLines = [
    { label: "SUBMITTED THIS MONTH BUT NOT ON FIELD DATA (MUST BE 0)", count: unplaced.length },
    { label: "TRANSACTIONS WITHOUT A BATCH (AD HOC)", count: rows.filter((item) => text(item?.batchId) === "AD HOC").length },
    { label: "METERS FOUND THAT ARE NOT ON THE VENDING LIST", count: distinctMeters(electricityFound.filter((item) => item?.onVendingList === "No")) },
    {
      label: "VISIBILITY MARK THAT DISAGREES WITH SALES",
      count: distinctMeters(
        judged.filter(
          (item) =>
            (item?.visibility === "Invisible" && item?.onVendingList === "Yes") ||
            (item?.visibility === "Visible" && item?.onVendingList === "No"),
        ),
      ),
    },
    {
      label: "TRANSACTIONS WITH NO SALES CATEGORY",
      count: actedRows.filter((item) => item?.meterType === "ELECTRICITY" && !text(item?.salesCategory)).length,
    },
    {
      label: "MISSING GPS, PHOTOGRAPH OR NORMALISATION ANSWER",
      count: rows.filter(
        (item) =>
          item?.hasAccess &&
          (!text(item?.gpsCoordinates) ||
            !(item?.photoUrls || []).length ||
            (FINDING_TRN_TYPES.has(item?.trnType) && item?.meterType === "ELECTRICITY" && !(item?.normalisationActions || []).length)),
      ).length,
    },
    { label: "WORKERS WHOSE TEAM COULD NOT BE RESOLVED", count: unresolvedWorkers.size },
  ];

  return {
    workers,
    workerLabels,
    teams,
    blocks,
    controlLines,
    payableTotal: rows.length,
  };
}
