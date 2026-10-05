import test from "node:test";
import assert from "node:assert/strict";
import { formatSastDateTime } from "../src/utils/formatSastDateTime.js";

test("ISO offsets, Date and Firestore timestamp shapes display the same SAST instant", () => {
  const date = new Date("2026-10-05T19:09:45.455Z");
  for (const value of [date.toISOString(), "2026-10-05T21:09:45.455+02:00", date,
    date.getTime(), { toDate: () => date }, { toMillis: () => date.getTime() },
    { seconds: Math.floor(date.getTime() / 1000), nanoseconds: 455000000 },
    { _seconds: Math.floor(date.getTime() / 1000), _nanoseconds: 455000000 }]) {
    assert.equal(formatSastDateTime(value), "2026-10-05 21:09:45");
  }
  assert.equal(date.toISOString(), "2026-10-05T19:09:45.455Z");
});

test("South African dates roll over at midnight independently of the viewer's timezone", () => {
  const original = process.env.TZ;
  try {
    for (const zone of ["UTC", "Africa/Johannesburg", "America/New_York"]) {
      process.env.TZ = zone;
      assert.equal(formatSastDateTime("2026-10-05T22:00:00Z"), "2026-10-06 00:00:00");
      assert.equal(formatSastDateTime("2026-12-31T23:15:00Z"), "2027-01-01 01:15:00");
      assert.equal(formatSastDateTime("2026-06-05T19:09:45Z"), "2026-06-05 21:09:45");
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("missing and malformed timestamps retain the registry's NAv fallback", () => {
  for (const value of [null, undefined, "", " ", "NAv", "invalid", {}, false, NaN,
    new Date(NaN), { toDate: () => new Date(NaN) }]) {
    assert.equal(formatSastDateTime(value), "NAv");
  }
});
