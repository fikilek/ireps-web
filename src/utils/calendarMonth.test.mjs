import test from "node:test";
import assert from "node:assert/strict";
import { previousCalendarMonth } from "./calendarMonth.js";

test("previous month uses Johannesburg calendar, including its midnight and January", () => {
  for (const [instant, expected] of [
    ["2026-09-06T12:00:00Z", "2026-08"],
    ["2026-08-31T21:59:59Z", "2026-07"],
    ["2026-08-31T22:00:00Z", "2026-08"],
    ["2026-01-01T00:00:00Z", "2025-12"],
  ]) assert.equal(previousCalendarMonth(new Date(instant)), expected);
});
