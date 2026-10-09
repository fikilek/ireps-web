// THE ONE WELL FOR A METER'S OWN COUNTS.
//
// A meter carries how many times each kind of work has actually been done on
// it, plus how many times nobody could reach it. `collection-shape-rules/asts.md`
// 10.1 and `DR-R001` 3.2.
//
// WHY THE FIELD IS WRITTEN AT CREATION rather than appearing when the first
// work lands: ABSENT AND ZERO ARE DIFFERENT FACTS, and a reader cannot tell
// them apart. On 7 October 2026 a count that never reached the screen rendered
// as 0 and looked exactly like a meter nothing had ever happened to. It stayed
// hidden for that reason. Once every meter carries the field, a missing
// `counts` can only mean something is wrong, and the register can say so
// instead of printing a plausible number — the owner's NAv rule applied to a
// number rather than to a word.
//
// WHY THE KEYS ARE A LIST AND NOT WRITTEN OUT WHEREVER THEY ARE NEEDED
// (9 October 2026). Until today three places each named the counts one at a
// time: the creator, the trigger's comparison, and the registry row rebuild.
// A fourth count added to two of the three would have been raised correctly
// and never drawn — which is the 7 October defect exactly, waiting to happen
// again. Everything below derives from `METER_COUNT_KEYS`, so a count added
// here appears in all three without anybody remembering to go and look.

/**
 * Every count a meter carries, in the order a reader meets them.
 *
 * Five kinds of work that were done, and one for work nobody could reach.
 * They are the five transactions the ITO button offers (owner, 9 October
 * 2026) — a Meter Discovery, Installation or Commissioning is not among them:
 * a registration is the meter's own origin and is always exactly one, and
 * commissioning is not issued from the ITO button.
 */
export const METER_COUNT_KEYS = Object.freeze([
  "disconnections",
  "reconnections",
  "inspections",
  "removals",
  "readings",
  "noAccess",
]);

/**
 * Which count a kind of work raises when it succeeds.
 *
 * `noAccess` is deliberately absent: it is not raised by a kind of work but by
 * an outcome, from the one No Access writer, whatever work was being attempted
 * (`noAccess/recordLifecycleNoAccess.js`). A disconnection nobody could reach
 * raises `noAccess` and NOT `disconnections`, because the meter was not
 * disconnected — which is what the count claims.
 */
export const COUNT_KEY_BY_TRN_TYPE = Object.freeze({
  METER_DISCONNECTION: "disconnections",
  METER_RECONNECTION: "reconnections",
  METER_INSPECTION: "inspections",
  METER_REMOVAL: "removals",
  METER_READING: "readings",
});

/**
 * The outcomes that mean the work was actually done.
 *
 * Nearly every kind of work writes `SUCCESS`. **A Meter Reading does not** — a
 * reading that was taken writes `SUCCESSFUL_READING`, and one attempted but
 * not readable writes `UNSUCCESSFUL_READING` (`meterLifecycle/helpers.js` 1222
 * and 1311).
 *
 * Found on 9 October 2026 while adding the reading count, by a test that had
 * been written to assert the opposite. Had the check stayed `outcome ===
 * "SUCCESS"`, `counts.readings` would have stayed at zero for ever on every
 * meter and nothing would have said so: the reading recorded, the register
 * showing nothing, and the number looking exactly like a meter nobody had read.
 * The same shape of silent failure as 7 October, caught before it shipped.
 */
export const WORK_DONE_OUTCOMES = Object.freeze(["SUCCESS", "SUCCESSFUL_READING"]);

/** Did this outcome mean the work happened? No Access and an unreadable reading did not. */
export function outcomeMeansWorkWasDone(outcome) {
  return WORK_DONE_OUTCOMES.includes(String(outcome || "").trim().toUpperCase());
}

/** The count a completed transaction of this kind raises, or null for one that raises none. */
export function meterCountKeyForTrnType(trnType) {
  const key = String(trnType || "").trim().toUpperCase();

  return COUNT_KEY_BY_TRN_TYPE[key] || null;
}

/** A new meter's counts: every one of them, at zero. */
export function newMeterCounts() {
  const counts = {};

  for (const key of METER_COUNT_KEYS) counts[key] = 0;

  return counts;
}

/**
 * A meter's counts as numbers, every key present.
 *
 * A count that is absent or unreadable comes back as 0 here, because this is
 * the copy-maker's reader and a Firestore number field has no third state. The
 * place that distinguishes absent from zero is the meter itself, where the
 * field either exists or does not.
 */
export function readMeterCounts(data) {
  const counts = data?.counts || {};
  const out = {};

  for (const key of METER_COUNT_KEYS) {
    const value = Number(counts[key]);
    out[key] = Number.isFinite(value) ? value : 0;
  }

  return out;
}

/**
 * One string standing for every count, so a trigger can tell in one comparison
 * whether any of them moved.
 *
 * `UI-R008`: the registry row is a copy, and the copy has to be rebuilt
 * whenever the fact changes — not only when one of a short list of other
 * fields happens to change as well.
 */
export function readMeterCountsFingerprint(data) {
  const counts = readMeterCounts(data);

  return METER_COUNT_KEYS.map((key) => counts[key]).join("/");
}
