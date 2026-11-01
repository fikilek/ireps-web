import { createHash } from "node:crypto";

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const shaPattern = /^[a-f0-9]{64}$/;
export function validatePublicationEnvelope(publication, lmPcode, provider, projectId) {
  if (publication?.schemaVersion !== 1 || publication.lmPcode !== lmPcode || publication.provider !== provider || (projectId && publication.projectId !== projectId)) throw new Error("Publication scope mismatch");
  const months = Object.keys(publication.months || {}).sort();
  if (!months.length || months.some(month => !monthPattern.test(month)) || publication.latestMonth !== months.at(-1)) throw new Error("Invalid governed month publication");
  if (lmPcode === "ZA5241" && provider === "contour" && months[0] !== "2026-06") throw new Error("Endumeni release requires the June 2026 baseline");
  for (let index = 1; index < months.length; index++) {
    const [year, number] = months[index - 1].split("-").map(Number);
    const next = `${year + (number === 12 ? 1 : 0)}-${String(number === 12 ? 1 : number + 1).padStart(2, "0")}`;
    if (months[index] !== next) throw new Error("Published month sequence has a gap");
  }
  return months;
}
export function validateSnapshot(bytes, expectedHash, lmPcode, provider, month, previousHash) {
  if (createHash("sha256").update(bytes).digest("hex") !== expectedHash) throw new Error("Snapshot hash mismatch");
  const snapshot = JSON.parse(bytes.toString("utf8"));
  if (snapshot.schemaVersion !== 1 || snapshot.lmPcode !== lmPcode || snapshot.provider !== provider || snapshot.month !== month || snapshot.previousSnapshotSha256 !== previousHash) throw new Error("Snapshot scope or chain mismatch");
  if (!shaPattern.test(snapshot.sourceSha256) || snapshot.completeness?.complete !== true || !shaPattern.test(snapshot.completeness?.evidenceSha256)) throw new Error("Membership completeness not proven");
  if (!Array.isArray(snapshot.members) || !snapshot.members.length || snapshot.members.some((id, index, list) => typeof id !== "string" || !/^[A-Z0-9]+$/.test(id) || (index > 0 && list[index - 1] >= id))) throw new Error("Membership must be sorted unique canonical IDs");
  if (!Array.isArray(snapshot.replacements) || !Array.isArray(snapshot.exceptions)) throw new Error("Missing exception/replacement evidence");
  const id = value => typeof value === "string" && /^[A-Z0-9]+$/.test(value);
  const predecessors = new Set(); const successors = new Set();
  for (const pair of snapshot.replacements) {
    if (!pair || !id(pair.predecessor) || !id(pair.successor) || pair.predecessor === pair.successor || predecessors.has(pair.predecessor) || successors.has(pair.successor) || !snapshot.members.includes(pair.successor) || snapshot.members.includes(pair.predecessor)) throw new Error("Invalid replacement evidence");
    predecessors.add(pair.predecessor); successors.add(pair.successor);
  }
  if (snapshot.exceptions.some(item => !item || !(item.meterId === null || item.meterId === "" || id(item.meterId)) || typeof item.reason !== "string" || !item.reason.trim())) throw new Error("Malformed population exception");
  return snapshot;
}
export function hasScopeAccess(user, lmPcode) {
  const assigned = Array.isArray(user?.access?.workbases) ? user.access.workbases : [];
  return assigned.some(item => (typeof item === "string" ? item : item?.id || item?.lmPcode || item?.pcode) === lmPcode);
}

export function validateVerificationReport(bytes, hash, projectId, month, snapshotSha256, snapshot) {
  if (createHash("sha256").update(bytes).digest("hex") !== hash) throw new Error("Verification report hash mismatch");
  const report = JSON.parse(bytes.toString("utf8"));
  const require = (condition, message) => { if (!condition) throw new Error(message); };
  const isCount = value => Number.isSafeInteger(value) && value >= 0;
  require(report?.projectId === projectId && report.collection === "sales-all-meters" && report.preflightOnly === false && report.status === "PASS" && report.result === "REFRESH_VERIFIED" && report.globalPreflight?.complete === true && report.globalPreflight?.gatePassed === true, "Month execution is not verified");
  const source = report.sourceEvidence;
  require(source?.governedMonth === month && source.populationSnapshotSha256 === snapshotSha256 && source.lmPcode === snapshot?.lmPcode && source.provider === snapshot?.provider && shaPattern.test(source.categoryPackageSha256), "Source evidence mismatch");
  const counters = ["rowsRead", "recordsInspected", "createdCount", "updatedCount", "unchangedCount", "conflictCount", "failedCount", "writeAttemptCount", "writeSuccessCount", "firestoreWrites"];
  require(counters.every(key => isCount(report[key])) && report.rowsRead > 0 && report.recordsInspected === report.rowsRead && report.conflictCount === 0 && report.failedCount === 0, "Invalid classification counters");
  require(report.createdCount + report.updatedCount + report.unchangedCount === report.rowsRead, "Classification does not balance");
  const writes = report.createdCount + report.updatedCount;
  require(report.writeAttemptCount === writes && report.writeSuccessCount === writes && report.firestoreWrites === writes, "Write accounting does not balance");
  const scope = source.scopeDocumentIds;
  const canonical = ids => Array.isArray(ids) && ids.every(id => typeof id === "string" && /^[A-Z0-9]+$/.test(id)) && new Set(ids).size === ids.length;
  require(canonical(scope) && scope.every((id, index) => index === 0 || scope[index - 1] < id) && scope.length === report.rowsRead && scope.length === source.scopeRecordCount && shaPattern.test(source.scopeDocumentIdsSha256) && createHash("sha256").update(JSON.stringify(scope)).digest("hex") === source.scopeDocumentIdsSha256, "Intended scope is incomplete");
  const exceptional = source.categoryExceptionDocumentIds || [];
  require(canonical(exceptional) && exceptional.every(id => !scope.includes(id)), "Category exceptions overlap intended writes");
  const covered = new Set([...scope, ...exceptional]);
  require(snapshot.members.every(id => covered.has(id)), "Unaccounted supplier member");
  const batch = report.batchEvidence;
  require(batch && batch.failedWriteWave == null && isCount(batch.writeWavesAttempted) && isCount(batch.writeWavesCommitted) && batch.writeWavesAttempted === batch.writeWavesCommitted && (writes === 0 ? batch.writeWavesCommitted === 0 : batch.writeWavesCommitted >= 1 && batch.writeWavesCommitted <= writes && writes <= 400 * batch.writeWavesCommitted), "Partial write waves");
  const verification = report.verification;
  require(verification?.status === "PASS" && verification.documentsVerified === report.rowsRead && shaPattern.test(verification.preservedProjectionBeforeSha256) && verification.preservedProjectionBeforeSha256 === verification.preservedProjectionAfterSha256 && verification.preservationVerifiedExistingDocuments === report.rowsRead - report.createdCount, "Post-write preservation is incomplete");
  require(report.recoveryEvidence?.complete === true && report.recoveryEvidence.records === report.rowsRead && shaPattern.test(report.recoveryEvidence.sha256), "Recovery evidence incomplete");
  const plan = report.planEvidence;
  require(plan?.complete === true && plan.records === report.rowsRead && shaPattern.test(plan.sha256) && plan.scopeDocumentIdsSha256 === source.scopeDocumentIdsSha256 && plan.categoryPackageSha256 === source.categoryPackageSha256, "Exact planned-write evidence incomplete");
  return report;
}

// ---------------------------------------------------------------------------
// Provider authorization.
//
// Endumeni v1 governs exactly one provider. The narrowest safe rule is an
// allow-list: a caller may not address an arbitrary provider partition. This
// deliberately does not introduce a per-user provider-access architecture.
// ---------------------------------------------------------------------------
export const GOVERNED_PROVIDERS = Object.freeze(["contour"]);

export function hasProviderAccess(provider) {
  return GOVERNED_PROVIDERS.includes(provider);
}

// ---------------------------------------------------------------------------
// Error classification. Every governance failure carries a machine-readable
// reason so the caller can distinguish invalid evidence from an unavailable
// backend, instead of reporting both as corrupted evidence.
// ---------------------------------------------------------------------------
export class GovernanceError extends Error {
  constructor(classification, reasonCode, message, details = {}) {
    super(message);
    this.name = "GovernanceError";
    this.classification = classification;
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

export const CLASSIFICATION = Object.freeze({
  INVALID_EVIDENCE: "INVALID_EVIDENCE",
  UNAVAILABLE: "UNAVAILABLE",
});

// A storage/network fault is availability, not integrity. 404 is neither: it
// means the object was never published.
export function classifyStorageError(error) {
  const code = Number(error?.code ?? error?.status);
  if (code === 404) return "ABSENT";
  if (Number.isFinite(code) && code >= 400 && code < 500 && code !== 408 && code !== 429) return "INVALID_EVIDENCE";
  return "UNAVAILABLE";
}

export function isMonthVerificationClaimed(entry) {
  return shaPattern.test(entry?.snapshotSha256)
    && shaPattern.test(entry?.verification?.reportSha256)
    && entry?.verification?.status === "PASS"
    && entry?.verification?.complete === true;
}

// Retained for callers and tests that require an all-or-nothing publication.
export function validatePublication(publication, lmPcode, provider, projectId) {
  const months = validatePublicationEnvelope(publication, lmPcode, provider, projectId);
  for (const month of months) {
    if (!isMonthVerificationClaimed(publication.months[month])) throw new Error("Month is not verified");
  }
  return months;
}

// ---------------------------------------------------------------------------
// Timeline. Month states are evaluated server-side against the Africa/
// Johannesburg calendar month so the browser clock can never decide them.
// No publication due date is invented: an unpublished month at or before the
// current calendar month is AWAITING_PUBLICATION, never OVERDUE.
// ---------------------------------------------------------------------------
export const MONTH_STATE = Object.freeze({
  VERIFIED: "VERIFIED",
  AWAITING_PUBLICATION: "AWAITING_PUBLICATION",
  FUTURE_DISABLED: "FUTURE_DISABLED",
  INVALID_EVIDENCE: "INVALID_EVIDENCE",
  MISSING_COMPARISON: "MISSING_COMPARISON",
});

export const GOVERNANCE_TIME_ZONE = "Africa/Johannesburg";

export function calendarMonthInZone(now = new Date(), timeZone = GOVERNANCE_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(now);
  return `${parts.find(part => part.type === "year").value}-${parts.find(part => part.type === "month").value}`;
}

export function nextCalendarMonth(month) {
  if (!monthPattern.test(month)) throw new Error("Invalid calendar month");
  const [year, number] = month.split("-").map(Number);
  return `${year + (number === 12 ? 1 : 0)}-${String(number === 12 ? 1 : number + 1).padStart(2, "0")}`;
}

/**
 * Build the governed month timeline.
 *
 * publishedMonths  every month present in the publication, ascending
 * verifiedMonths   the contiguous verified prefix actually proven this request
 * failure          { month, reasonCode, message } for the first month that failed
 * evaluationMonth  current Africa/Johannesburg calendar month
 *
 * Months after a failure are MISSING_COMPARISON: their comparison chain runs
 * through evidence that could not be verified, so they must never be computed.
 */
export function buildMonthTimeline({ publishedMonths = [], verifiedMonths = [], failure = null, evaluationMonth }) {
  if (!monthPattern.test(evaluationMonth || "")) throw new Error("Invalid evaluation month");
  const verified = new Set(verifiedMonths);
  const entries = publishedMonths.map(month => {
    if (verified.has(month)) return { month, state: MONTH_STATE.VERIFIED, reasonCode: null, published: true };
    if (failure && month === failure.month) {
      return { month, state: MONTH_STATE.INVALID_EVIDENCE, reasonCode: failure.reasonCode, published: true };
    }
    return {
      month,
      state: MONTH_STATE.MISSING_COMPARISON,
      reasonCode: failure ? `COMPARISON_BLOCKED_BY_${failure.month}` : "COMPARISON_UNAVAILABLE",
      published: true,
    };
  });

  // Always surface the next calendar month after the latest published month,
  // disabled while unpublished.
  const latestPublished = publishedMonths.at(-1);
  if (latestPublished) {
    const next = nextCalendarMonth(latestPublished);
    entries.push({
      month: next,
      state: next > evaluationMonth ? MONTH_STATE.FUTURE_DISABLED : MONTH_STATE.AWAITING_PUBLICATION,
      reasonCode: null,
      published: false,
    });
  }
  return entries;
}
