// Which transaction the ITO button offers, when it may be launched, and how a
// meter's count for it is read. `DR-R001` 3.2.
//
// No JSX here on purpose: these are the rules, and the rules are tested. The
// icons live with the component that draws them.

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
    code: "INSP",
    name: "Inspection",
    countKey: "inspections",
    available: alwaysAvailable,
    refusal: () => "",
  },
  {
    work: "remove",
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
