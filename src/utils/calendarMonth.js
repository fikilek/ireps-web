const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isCalendarMonth(value) {
  return typeof value === "string" && MONTH.test(value);
}

export function calendarMonthInZone(now = new Date(), timeZone = "Africa/Johannesburg") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit",
  }).formatToParts(now);
  return `${parts.find(part => part.type === "year").value}-${parts.find(part => part.type === "month").value}`;
}

export function previousCalendarMonth(now = new Date(), timeZone = "Africa/Johannesburg") {
  const [year, month] = calendarMonthInZone(now, timeZone).split("-").map(Number);
  return `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, "0")}`;
}
