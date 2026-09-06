import { isCalendarMonth, previousCalendarMonth } from "../../../utils/calendarMonth.js";

export function getDefaultSalesMonth(now = new Date()) {
  return previousCalendarMonth(now, "Africa/Johannesburg");
}

// An explicit invalid selection must never silently choose a different month.
export function resolveSalesMonthSelection(search = "", now = new Date()) {
  const values = new URLSearchParams(search).getAll("month");
  if (!values.length) return { valid: true, month: getDefaultSalesMonth(now), explicit: false };
  return values.length === 1 && isCalendarMonth(values[0])
    ? { valid: true, month: values[0], explicit: true }
    : { valid: false, month: null, explicit: true };
}

export function salesCategorySearch(month) {
  if (!isCalendarMonth(month)) throw new Error("Select a valid Sales month.");
  return `?month=${month}`;
}
