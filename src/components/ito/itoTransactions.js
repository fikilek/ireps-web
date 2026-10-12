// Which transaction the ITO button offers, when it may be launched, and how a
// meter's count for it is read. `DR-R001` 3.2.
//
// No JSX here on purpose: these are the rules, and the rules are tested. The
// icons live with the component that draws them.

// ONE WELL for what a state MEANS. The five states and their reading
// live in the state machine, and the web imports it rather than keeping a
// copy - the same way the Sales maps import the geometry and policy
// modules from `functions/`. A second list is how a meter comes to be busy
// on one screen and free on another (`DR-R001` 5.9).
import {
  currentState,
  holdsTheMeter,
} from "../../../functions/meterLifecycle/trnStateMachine.js";

/**
 * What the column is called, in full (owner, 9 October 2026).
 *
 * Not "Launch a transaction", which described what the buttons do rather than
 * naming the thing. This IS Individual Transaction Origination, the name the
 * owner gave it, and the same name the rules and the dictionary use. One
 * thing, one word — a screen that calls it something of its own is how two
 * names for one thing start.
 */
export const ITO_COLUMN_LABEL = "Individual Transaction Origination";

const alwaysAvailable = () => true;
const inState = (...states) => (state) => states.includes(state);

/**
 * The five transactions the office can originate on one meter.
 *
 * `available` is not invented here. Four of the five are the rules iREPS
 * already enforces, read out of the code that enforces them:
 *
 *   disconnect  the meter is connected                 (helpers.js, astItem.js 671)
 *   reconnect   the meter is disconnected              (astItem.js 672)
 *   remove      not already removed or decommissioned  (astItem.js 675, helpers.js 3151)
 *   read        anything but decommissioned            (helpers.js 3163)
 *
 * The fifth is the owner's decision of 9 October 2026: **an inspection can be
 * started on any meter at any time**, a decommissioned one included, because a
 * record saying the meter is gone is exactly the record an inspection is sent
 * to test. `DR-R001` 6.2 — an inspection is also the only way to correct a
 * stale record, so a meter it could not be run on would be the one meter
 * nobody could ever put right.
 */
export const ITO_TRANSACTIONS = [
  {
    work: "disconnect",
    trnType: "METER_DISCONNECTION",
    code: "DCN",
    name: "Disconnection",
    countKey: "disconnections",
    available: inState("CONNECTED"),
    refusal: (state) =>
      state === "DISCONNECTED"
        ? "This meter is already disconnected"
        : "This meter is out of service",
  },
  {
    work: "reconnect",
    trnType: "METER_RECONNECTION",
    code: "RCN",
    name: "Reconnection",
    countKey: "reconnections",
    available: inState("DISCONNECTED"),
    refusal: (state) =>
      state === "CONNECTED"
        ? "This meter is already connected"
        : "This meter is out of service",
  },
  {
    work: "inspect",
    trnType: "METER_INSPECTION",
    code: "INSP",
    name: "Inspection",
    countKey: "inspections",
    available: alwaysAvailable,
    refusal: () => "",
  },
  {
    work: "remove",
    trnType: "METER_REMOVAL",
    code: "REM",
    name: "Removal",
    countKey: "removals",
    available: inState("FIELD", "CONNECTED", "DISCONNECTED"),
    refusal: (state) =>
      state === "REMOVED"
        ? "This meter has already been removed"
        : "This meter is out of service",
  },
  {
    work: "read",
    trnType: "METER_READING",
    code: "MREAD",
    name: "Meter reading",
    countKey: "readings",
    available: (state) => state !== "DECOMMISSIONED",
    refusal: () => "A decommissioned meter cannot be read",
  },
];

/**
 * The meter's count for one transaction, or `null` where the meter does not
 * carry that count at all.
 *
 * ABSENT AND ZERO ARE DIFFERENT FACTS. Zero says *this has never happened to
 * this meter*; absent says *iREPS does not know*. A meter in an environment
 * the backfill has not reached holds neither, and printing `0` for it would be
 * a plausible number covering a gap — the owner's NAv rule, applied to a
 * number instead of a word. The button draws `NAv` for null.
 */
export function readItoCount(row, key) {
  const value = row?.counts?.[key];

  if (typeof value !== "number" || !Number.isFinite(value)) return null;

  return Math.max(0, Math.trunc(value));
}

/**
 * How a count should read: `"some"`, `"none"` or `"unknown"`.
 *
 * Owner, 9 October 2026. Every count used to draw as a black disc, so the two
 * on a meter that meant something looked exactly like the three that did not.
 * A number above zero now takes the No Access chip's own colours, and **zero
 * recedes** — that second half is what makes it work. Left black, zero would
 * compete with the colour on every row, and a meter something has happened to
 * would still have to be read rather than seen.
 *
 * `"unknown"` is drawn with a dashed edge as well as its own colour, because
 * pale orange and pale amber are close enough to confuse at a glance. It
 * differs in SHAPE too, so a count iREPS does not hold can never be mistaken
 * for a meter nothing has happened to.
 */
export function itoCountState(count) {
  if (count === null) return "unknown";

  return count > 0 ? "some" : "none";
}

/**
 * The job already out on this meter of this kind, or `null`.
 *
 * `DR-R001` 5: more than one job may be out on a meter at once, but never two
 * of the same kind. The server refuses the second one - but it refused it
 * AFTER the office had filled in the whole ITO page, because the register
 * could not see the job was there. The front must know what the back knows.
 */
export function openJobForWork(row, transaction) {
  const open = row?.openJob;

  if (!open?.trnId) return null;
  if (String(open.trnType || "").toUpperCase() !== transaction.trnType) return null;

  // IT READS THE STATE, NOT MERELY THE PRESENCE OF AN ID. `DR-R001` 5.2 says
  // it in those words and names this reader: "Anything drawing a pending mark
  // from that marker - the ITO launch button's badge among them - reads the
  // state, not merely the presence of an id."
  //
  // A deleted job has let go of its meter (5.5), so it must not draw the mark
  // that says work is already out here. The delete clears the marker, which
  // makes this the braces rather than the belt - and the braces matter: the
  // clearing write reaches the registry row through a trigger, and rows in
  // every environment carry markers written before the five states landed.
  if (knownNotToHoldTheMeter(open.workflowState)) return null;

  return open;
}

/**
 * Is this a state iREPS KNOWS does not hold a meter?
 *
 * Deliberately not `!holdsTheMeter(...)`. That would also hide every state
 * the machine cannot place, and the bulk lane really does write one of those
 * - `WAITING_BATCH_ACCEPTANCE`. An unplaceable state is a fault to show, not
 * a job to hide.
 */
function knownNotToHoldTheMeter(state) {
  const placed = currentState(state);

  return Boolean(placed) && !holdsTheMeter(placed);
}

/**
 * Which transaction the ITO page is allocating, or `""`.
 *
 * `DR-R001` 5, owner 11 October 2026: the button on the meter's row creates
 * the work and the page allocates it, so the page does not make a
 * transaction - it is handed one.
 *
 * TWO WAYS IN, ONE ANSWER, and that is deliberate rather than a hedge. The
 * button has just created it and says which in the address, so that is read
 * first. A page reloaded or opened from a bookmark has no such address, and
 * the meter's own marker names the one job of this kind out on it - which by
 * `DR-R001` 5.2 is the same job, because a second of its kind cannot exist.
 * Both are read HERE so there is one answer and not two.
 *
 * Empty is a fault to show, not a gap to fill: an allocate with no
 * transaction behind it would create nothing and refuse at the last step,
 * after the office had filled in the whole form.
 */
export function allocatingTrnId({ fromUrl, meter, transaction } = {}) {
  const said = String(fromUrl || "").trim();

  if (said) return said;

  const marker = meter?.trnActiveLifecycle || null;
  const markedType = String(marker?.trnType || "").toUpperCase();

  // A job in the bin is not this page's to allocate. The machine refuses
  // `DELETED -> allocate` anyway, but it would refuse it at Send, after the
  // office had filled in the whole form - which is the fault this function
  // exists to prevent.
  if (knownNotToHoldTheMeter(marker?.workflowState)) return "";

  if (marker?.trnId && markedType === transaction?.trnType) {
    return String(marker.trnId).trim();
  }

  return "";
}

/**
 * What the mark on the launch button says, in words. `DR-R001` 5.2.
 *
 * It used to read the state out of the marker and lower-case it, which gave
 * the office "created, with NAv" the moment the button started creating jobs
 * nobody holds. A job waiting in the pool has no holder, and saying so is
 * different from printing the gap.
 */
export function describeOpenJob(openJob, transaction) {
  const work = String(transaction?.name || "job").toLowerCase();
  const placed = currentState(openJob?.workflowState);
  const who = String(openJob?.assignedToName || "").trim();
  const named = who && who.toUpperCase() !== "NAV" ? who : "";

  if (placed === "CREATED") {
    return `A ${work} is already waiting on this meter, with nobody on it yet. Open it in the TRN Registry.`;
  }

  if (placed === "ISSUED") {
    return named
      ? `A ${work} is already out on this meter, waiting for ${named} to accept it. Open it in the TRN Registry.`
      : `A ${work} is already out on this meter, waiting to be accepted. Open it in the TRN Registry.`;
  }

  if (placed === "ACCEPTED") {
    return named
      ? `A ${work} is already out on this meter and ${named} has taken it. Open it in the TRN Registry.`
      : `A ${work} is already out on this meter and has been taken. Open it in the TRN Registry.`;
  }

  // A state iREPS cannot place. It is shown as the fault it is rather than
  // dressed in one of the five (`UI-R008`).
  return `A ${work} on this meter carries a state iREPS does not know: ${
    String(openJob?.workflowState || "NAv")
  }. Open it in the TRN Registry.`;
}

/**
 * Which mark to draw. `!` means somebody has to answer; the quiet dot means
 * the job is in hand or waiting in the pool.
 */
export function openJobMark(openJob) {
  return currentState(openJob?.workflowState) === "ISSUED" ? "!" : "\u2022";
}
