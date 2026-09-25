// Targeted Batch rules TB-R065 (1.3.69): the words the Sales tables use for the meter found on site.
// The three values themselves come from the one shared rule (salesSiteMeter).
import { SAME_METER } from "../../../../functions/salesAllMeters/sales-batch-policy.js";

export const SAME_METER_TEXT = Object.freeze({
  [SAME_METER.YES]: "Yes",
  [SAME_METER.NO]: "No",
  [SAME_METER.NAV]: "NAv",
});

// NAv is a filter value of its own: most meters have not been visited, so Yes or No alone would hide them.
export const SAME_METER_FILTER_OPTIONS = Object.freeze([
  { value: SAME_METER.YES, label: "Yes" },
  { value: SAME_METER.NO, label: "No" },
  { value: SAME_METER.NAV, label: "NAv" },
]);

export function sameMeterText(value) {
  return SAME_METER_TEXT[value] || "NAv";
}

// A different meter on site sorts first, then the same meter, then the meters nobody has seen.
export function sameMeterSortRank(value) {
  return { [SAME_METER.NO]: 0, [SAME_METER.YES]: 1 }[value] ?? 2;
}
