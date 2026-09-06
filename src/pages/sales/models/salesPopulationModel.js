// Movement classes partition the current supplier membership. Retired is a
// separate stock; exceptions overlap membership and are never added to totals.
import { isCalendarMonth } from "../../../utils/calendarMonth.js";
import { resolveSalesCategoryForMonth } from "./salesCategoryModel.js";

export function buildMonthlyPopulation(snapshots, month) {
  try {
    if (!Array.isArray(snapshots) || !isCalendarMonth(month)) throw new Error("Invalid population evidence");
    return buildPopulationMovements(snapshots, month);
  } catch (error) {
    return { status: "invalid", error: error.message, members: [], counts: null };
  }
}

function buildPopulationMovements(snapshots, month) {
  const history = snapshots.filter(item => item.month <= month).sort((a, b) => a.month.localeCompare(b.month));
  const current = history.at(-1);
  if (!current || current.month !== month) return null;
  const previous = history.at(-2);
  const prior = new Set(previous?.members || []);
  const known = new Set(history.slice(0, -1).flatMap(item => item.members));
  const members = new Set(current.members);
  const exceptionIds = new Set(current.exceptions.map(item => item.meterId).filter(id => typeof id === "string" && id));
  const replacements = new Set();
  const predecessors = new Set();
  for (const pair of current.replacements || []) {
    if (!prior.has(pair.predecessor) || members.has(pair.predecessor) || prior.has(pair.successor) || !members.has(pair.successor) || replacements.has(pair.successor) || predecessors.has(pair.predecessor)) throw new Error("Invalid replacement evidence");
    replacements.add(pair.successor); predecessors.add(pair.predecessor);
  }
  const counts = { baseline: 0, unchanged: 0, new: 0, reentry: 0, replacement: 0, activeExceptions: 0, retired: 0, active: members.size, exceptions: exceptionIds.size, unresolvedEvidence: current.exceptions.filter(item => !item.meterId).length };
  for (const id of members) {
    if (exceptionIds.has(id)) counts.activeExceptions++;
    else if (!previous) counts.baseline++;
    else if (prior.has(id)) counts.unchanged++;
    else if (known.has(id)) { counts.reentry++; counts.activeExceptions++; }
    else if (replacements.has(id)) counts.replacement++;
    else counts.new++;
  }
  counts.retired = [...known].filter(id => !members.has(id)).length;
  counts.newlyAbsent = [...prior].filter(id => !members.has(id)).length;
  if (counts.baseline + counts.unchanged + counts.new + counts.activeExceptions + counts.replacement !== counts.active) throw new Error("Population accounting mismatch");
  return { month, counts, members: [...members] };
}

// Membership is independent of Sales coverage. The movement model above stays
// available for its separately accepted dashboard stage; this view uses stock only.
export function buildSalesPopulationReadModel({ snapshots, month, lmPcode, provider = "contour", salesRows = [] }) {
  const unavailable = error => ({ status: "unavailable", error });
  const invalid = error => ({ status: "invalid", error });
  if (!isCalendarMonth(month)) return invalid("Select a valid population month.");
  if (snapshots === undefined) return unavailable("Verified population evidence is not available.");
  if (!Array.isArray(snapshots) || !Array.isArray(salesRows)) return invalid("Invalid population response.");
  if (snapshots.some(item => !item || !isCalendarMonth(item.month))) return invalid("Invalid snapshot month.");
  const matches = snapshots.filter(item => item.month === month);
  if (!matches.length) return unavailable("No verified population snapshot is published for this month.");
  if (matches.length !== 1) return invalid("Duplicate population snapshots.");
  const snapshot = matches[0];
  if (snapshot.lmPcode !== lmPcode || snapshot.provider !== provider) return invalid("Population snapshot scope mismatch.");
  const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
  if (snapshot.schemaVersion !== 1 || !sha(snapshot.sourceSha256) || snapshot.completeness?.complete !== true || !sha(snapshot.completeness?.evidenceSha256)) return invalid("Population completeness evidence is invalid.");
  const members = snapshot.members;
  if (!Array.isArray(members) || !members.length || members.some((id, index) => typeof id !== "string" || !/^[A-Z0-9]+$/.test(id) || (index > 0 && members[index - 1] >= id))) return invalid("Snapshot members must be sorted, unique canonical identities.");
  if (!Array.isArray(snapshot.exceptions) || !Array.isArray(snapshot.replacements)) return invalid("Invalid population evidence lists.");
  const canonicalId = value => typeof value === "string" && /^[A-Z0-9]+$/.test(value);
  if (snapshot.exceptions.some(item => !item || !(item.meterId === null || item.meterId === "" || canonicalId(item.meterId)) || typeof item.reason !== "string" || !item.reason.trim())) return invalid("Invalid population exception evidence.");
  const predecessorIds = new Set(), successorIds = new Set();
  for (const pair of snapshot.replacements) {
    if (!pair || !canonicalId(pair.predecessor) || !canonicalId(pair.successor) || predecessorIds.has(pair.predecessor) || successorIds.has(pair.successor) || members.includes(pair.predecessor) || !members.includes(pair.successor)) return invalid("Invalid replacement evidence.");
    predecessorIds.add(pair.predecessor); successorIds.add(pair.successor);
  }
  const byId = new Map();
  for (const row of salesRows) {
    if (!row || typeof row.id !== "string" || byId.has(row.id)) return invalid("Invalid or duplicate Sales identity.");
    byId.set(row.id, row);
  }
  let availableDocuments = 0, withGps = 0, withoutGps = 0, normalPopulation = 0, fieldTarget = 0, categoryAvailable = 0, latestMs = 0;
  for (const id of members) {
    const row = byId.get(id);
    if (!row) continue;
    if (row.lmPcode !== lmPcode) return invalid("Sales attribute scope mismatch.");
    availableDocuments++;
    if (row.gpsAvailable !== false && row.hasUsableGps === true) withGps++;
    if (row.gpsAvailable !== false && row.hasUsableGps === false) withoutGps++;
    const category = resolveSalesCategoryForMonth(row, month);
    if (category) {
      categoryAvailable++;
      const label = category.leakageCategory.toUpperCase().replace(/_/g, " ");
      if (label === "NORMAL" || label.startsWith("NORMAL ") || label.startsWith("NORMAL-") || label.includes("NO LEAKAGE FLAG")) normalPopulation++;
      else fieldTarget++;
    }
    latestMs = Math.max(latestMs, Number(row.updatedAtMs) || 0, Number(row.createdAtMs) || 0);
  }
  const total = members.length;
  const share = value => value / total * 100;
  return { status: "ready", snapshot, members, total, availableDocuments,
    missingDocuments: total - availableDocuments, documentCoverage: share(availableDocuments),
    withGps, withoutGps, gpsUnknown: total - withGps - withoutGps,
    categoryAvailable, categoryUnavailable: total - categoryAvailable,
    normalPopulation, fieldTarget, gpsCoverage: share(withGps), withoutGpsShare: share(withoutGps),
    normalShare: share(normalPopulation), fieldTargetShare: share(fieldTarget),
    scopeAxisMax: total, scopeTickOne: Math.round(total * .25), scopeTickTwo: Math.round(total * .5), scopeTickThree: Math.round(total * .75),
    latestUpdate: latestMs ? new Date(latestMs) : null,
  };
}
