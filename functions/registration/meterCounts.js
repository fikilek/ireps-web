// A meter is created carrying its three counts, all at zero.
//
// collection-shape-rules/asts.md 10.1 and DR-SCH-009. The reason the field is
// written at creation rather than appearing when the first work lands:
// ABSENT AND ZERO ARE DIFFERENT FACTS, and a reader cannot tell them apart.
//
// On 7 October 2026 a count that never reached the screen rendered as 0 and
// looked exactly like a meter nothing had ever happened to. It stayed hidden
// because of that. Once every meter carries the field, a missing `counts` can
// only mean something is wrong, and the register can say so instead of
// printing a plausible number — which is the owner's NAv rule applied to a
// number rather than to a word.
//
// One well: every path that creates a meter calls this, so there is no second
// place to forget. The three that do today are the registration writer, the
// Meter Discovery trigger and the Meter Installation callable.
export function newMeterCounts() {
  return { disconnections: 0, reconnections: 0, noAccess: 0 };
}

// One string standing for all three numbers, so a trigger can tell in one
// comparison whether any of them moved. `UI-R008`: the registry row is a copy,
// and the copy has to be rebuilt whenever the fact changes — not only when one
// of a short list of other fields happens to change as well.
export function readMeterCountsFingerprint(data) {
  const counts = data?.counts || {};
  const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

  return [
    number(counts.disconnections),
    number(counts.reconnections),
    number(counts.noAccess),
  ].join("/");
}
