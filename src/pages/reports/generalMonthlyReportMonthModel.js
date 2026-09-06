import { previousCalendarMonth } from "../../utils/calendarMonth.js";

// Report selection is independent of Sales-page selection and governance.
export function getDefaultReportMonth(now = new Date()) {
  return previousCalendarMonth(now, "Africa/Johannesburg");
}
