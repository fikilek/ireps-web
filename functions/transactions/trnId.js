// NA-R005 (1.10.0) — what a transaction id is allowed to look like, in one place.
//
// Agreed by the owner, 3 October 2026. Work that reached the meter keeps the shape the format
// reference has always declared; a no access says so in the id and keeps the work after it:
//
//   work done:  TRN_MDIS_{timestamp}_{meterType}_{wardPcode}_{erfNo}
//   no access:  TRN_MDIS_{YYMMDD}_{HHMMSSmmm}_{tail}_{meterCat}_{wardPcode}_{erfNo}_NA
//
// WHY THIS MODULE EXISTS. The validators tested `startsWith("TRN_MDIS_")` and
// `startsWith("TRN_MINST_")`, so the first no access built under NA-R005 would have been
// REFUSED on arrival with INVALID_TRN_ID - the rule written, the schema written, the phone
// changed, and the server throwing it away. One place decides the shape, so the next change
// to it cannot reach one half and not the other.

/** The prefix a transaction of this kind carries when the worker reached the meter. */
export function accessTrnPrefix(workPrefix) {
  return String(workPrefix || "").trim();
}

/** The prefix the same kind of work carries when the worker could NOT reach the meter. */
export const NO_ACCESS_TRN_SUFFIX = "_NA";

/** Does this id say the worker could not reach the meter? NA-R005: the suffix, last. */
export function isNoAccessTrnId(trnId) {
  return String(trnId || "").trim().endsWith(NO_ACCESS_TRN_SUFFIX);
}

/**
 * Does this id belong to this kind of work, whether or not the worker got in?
 *
 * `hasAccess` is not consulted: an id is checked for what it IS, not for what the payload
 * beside it claims. A payload saying "yes" with a no access id is caught by the access checks,
 * not by pretending the id is wrong.
 */
export function isTrnIdForWork(trnId, workPrefix) {
  const id = String(trnId || "").trim();
  if (!id || !workPrefix) return false;

  // NA-R005 (1.12.0): a no access keeps the work's own prefix and adds `_NA` at the END, so
  // one prefix test covers both. An earlier draft put NA in FRONT; this is the settled shape.
  return id.startsWith(accessTrnPrefix(workPrefix));
}

/** What to tell a caller whose id is neither shape. */
export function trnIdShapeMessage(workPrefix) {
  return `TRN id must start with ${accessTrnPrefix(workPrefix)}`;
}
