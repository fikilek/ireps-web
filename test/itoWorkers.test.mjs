// Who the work can go to, and how far away he is. `DR-R001` 3 and 4.
//
// WHAT THESE GUARD. Not the arithmetic — haversine is not where this breaks.
// It breaks by putting a number on the screen that nothing holds. A worker
// whose phone has never reported must not read "0 m" and sort to the top as
// the nearest man available, and a count iREPS does not keep must not read "0
// jobs open" as though it had been checked. Under the owner's rule a gap shows
// as NAv and becomes a job to fix; it is never hidden behind a plausible
// value. Most of what follows is that rule, applied one field at a time.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ON_THE_MAP_RADIUS_M,
  formatDistance,
  isWithinRadius,
  metresBetween,
} from "../src/components/ito/geoDistance.js";
import {
  WORK_MAY_GO_TO,
  buildWorkerChoices,
  describeHeard,
  describeMovement,
  heardIsStale,
} from "../src/components/ito/itoWorkers.js";

const METER = { lat: -28.1667, lng: 30.25 }; // Dundee, Endumeni
const MINUTE = 60 * 1000;
const NOW = 1_791_600_000_000;

// ~90 m north of the meter: 0.00081 degrees of latitude.
const NEAR = { latitude: -28.16589, longitude: 30.25 };
// ~1.4 km east.
const FAR = { latitude: -28.1667, longitude: 30.26424 };

test("a point measured against itself is zero, and a known pair is right", () => {
  assert.equal(Math.round(metresBetween(METER, METER)), 0);

  const metres = metresBetween(METER, NEAR);

  assert.ok(metres > 85 && metres < 95, `expected about 90 m, got ${metres}`);
});

test("a missing or impossible position measures null, never zero", () => {
  // Zero would put the man on top of the meter and sort him first.
  for (const bad of [null, undefined, {}, { lat: null, lng: 30 }, { lat: "x", lng: "y" }]) {
    assert.equal(metresBetween(bad, METER), null);
    assert.equal(metresBetween(METER, bad), null);
  }

  assert.equal(metresBetween({ lat: 0, lng: 0 }, METER), null, "0,0 is an unset pair, not the Atlantic");
  assert.equal(metresBetween({ lat: 91, lng: 30 }, METER), null);
  assert.equal(metresBetween({ lat: -28, lng: 181 }, METER), null);
});

test("the office reads metres close up and kilometres far off, and NAv for nothing", () => {
  assert.equal(formatDistance(0), "0 m");
  assert.equal(formatDistance(64.4), "64 m");
  assert.equal(formatDistance(999), "999 m");
  assert.equal(formatDistance(1400), "1.4 km");
  assert.equal(formatDistance(11_000), "11 km");
  assert.equal(formatDistance(null), "NAv");
  assert.equal(formatDistance(Number.NaN), "NAv");
});

test("the ring that decides who is drawn on the map is 100 m", () => {
  assert.equal(ON_THE_MAP_RADIUS_M, 100);
  assert.equal(isWithinRadius(99), true);
  assert.equal(isWithinRadius(100), true);
  assert.equal(isWithinRadius(101), false);
  assert.equal(isWithinRadius(null), false, "no position is not inside the ring");
});

test("still, walking and driving come from the speed the phone sends", () => {
  assert.equal(describeMovement(0), "Still");
  assert.equal(describeMovement(0.4), "Still");
  assert.equal(describeMovement(1.2), "Walking, 4 km/h");
  assert.equal(describeMovement(7.8), "Driving, 28 km/h");
});

test("a speed the phone never sent reads NAv, not Still", () => {
  // "Still" would be iREPS asserting the man is standing. It does not know.
  for (const unknown of [null, undefined, "", "fast", Number.NaN]) {
    assert.equal(describeMovement(unknown), "NAv");
  }
});

test("how long ago he was heard, and never heard reads as never", () => {
  assert.equal(describeHeard(NOW - 40 * 1000, NOW), "heard 40 s ago");
  assert.equal(describeHeard(NOW - 6 * MINUTE, NOW), "heard 6 min ago");
  assert.equal(describeHeard(NOW - (2 * 60 + 14) * MINUTE, NOW), "heard 2 h 14 min ago");
  assert.equal(describeHeard(NOW - 26 * 60 * MINUTE, NOW), "heard 1 d ago");

  // Not "heard 0 s ago", which says the opposite of the truth.
  assert.equal(describeHeard(null, NOW), "never heard from");
  assert.equal(describeHeard(undefined, NOW), "never heard from");
});

test("a worker who has gone quiet is marked quiet, and still shows", () => {
  assert.equal(heardIsStale(NOW - 2 * MINUTE, NOW), false);
  assert.equal(heardIsStale(NOW - 60 * MINUTE, NOW), true);
  assert.equal(heardIsStale(null, NOW), true);
});

test("the work goes to a field worker, and a supervisor is one on the phone", () => {
  assert.deepEqual(WORK_MAY_GO_TO, ["FWR", "SPV"]);

  const { all } = buildWorkerChoices({
    users: [
      { uid: "a", displayName: "Peter M.", role: "FWR" },
      { uid: "b", displayName: "Tando S.", role: "SPV" },
      { uid: "c", displayName: "Mandy K.", role: "MNG" },
      { uid: "d", displayName: "Zamo N.", role: "ADM" },
      { uid: "e", displayName: "Nobody", role: "" },
    ],
    meterPoint: METER,
    nowMs: NOW,
  });

  assert.deepEqual(all.map((w) => w.name), ["Peter M.", "Tando S."]);
});

test("nearest first, and a worker with no position sorts last", () => {
  const { all, suggested, onTheMap } = buildWorkerChoices({
    users: [
      { uid: "far", displayName: "Nomusa B.", role: "FWR" },
      { uid: "none", displayName: "Jabu D.", role: "FWR" },
      { uid: "near", displayName: "Sipho N.", role: "FWR" },
    ],
    liveLocations: [
      { uid: "far", location: { ...FAR, speedMps: 7.8 }, capturedAtMs: NOW - 15 * 1000 },
      { uid: "near", location: { ...NEAR, speedMps: 0 }, capturedAtMs: NOW - 2 * MINUTE },
    ],
    meterPoint: METER,
    nowMs: NOW,
  });

  assert.deepEqual(all.map((w) => w.name), ["Sipho N.", "Nomusa B.", "Jabu D."]);
  assert.equal(suggested.name, "Sipho N.", "iREPS suggests the nearest");
  assert.deepEqual(onTheMap.map((w) => w.name), ["Sipho N."], "only inside 100 m is drawn");

  const jabu = all.at(-1);
  assert.equal(jabu.metres, null);
  assert.equal(jabu.distance, "NAv");
  assert.equal(jabu.movement, "NAv");
  assert.equal(jabu.heard, "never heard from");
  assert.equal(jabu.point, null, "he is not plotted anywhere");
});

test("the suggestion is never a worker nobody can place", () => {
  // Suggesting the man with no position would be iREPS recommending a guess.
  const { suggested, all } = buildWorkerChoices({
    users: [{ uid: "none", displayName: "Jabu D.", role: "FWR" }],
    liveLocations: [],
    meterPoint: METER,
    nowMs: NOW,
  });

  assert.equal(all.length, 1, "he is still offered");
  assert.equal(suggested, null, "but he is not suggested");
});

test("every worker is offered even when the meter itself has no position", () => {
  // A meter without coordinates is a defect in the meter, not a reason to
  // leave the office with nobody to send.
  const { all, onTheMap, suggested } = buildWorkerChoices({
    users: [{ uid: "a", displayName: "Peter M.", role: "FWR" }],
    liveLocations: [{ uid: "a", location: { ...NEAR, speedMps: 0 }, capturedAtMs: NOW }],
    meterPoint: null,
    nowMs: NOW,
  });

  assert.equal(all.length, 1);
  assert.equal(all[0].distance, "NAv");
  assert.deepEqual(onTheMap, []);
  assert.equal(suggested, null);
});

test("jobs open is NAv everywhere, because nothing holds it", () => {
  // The states exist (ISSUED, REASSIGNED, ACCEPTED, IN_PROGRESS) and so does
  // assignedTo, so it COULD be counted — but nothing counts it. Printing 0
  // would say "checked, and he has none"; NAv says "iREPS does not know", and
  // that is a job to fix rather than a number to trust.
  const { all } = buildWorkerChoices({
    users: [
      { uid: "a", displayName: "Peter M.", role: "FWR" },
      { uid: "b", displayName: "Sipho N.", role: "FWR" },
    ],
    liveLocations: [{ uid: "a", location: { ...NEAR, speedMps: 0 }, capturedAtMs: NOW }],
    meterPoint: METER,
    nowMs: NOW,
  });

  for (const worker of all) {
    assert.equal(worker.jobsOpen, null, `${worker.name} must not carry an invented count`);
  }
});

test("a subcontractor's worker is named as one", () => {
  const { all } = buildWorkerChoices({
    users: [
      { uid: "a", displayName: "Peter M.", role: "FWR", serviceProviderId: "RSTE" },
      { uid: "b", displayName: "Lindiwe Z.", role: "FWR", serviceProviderId: "SUBCO" },
      { uid: "c", displayName: "Andile G.", role: "FWR" },
    ],
    meterPoint: METER,
    nowMs: NOW,
    mainContractorId: "RSTE",
  });

  const by = Object.fromEntries(all.map((w) => [w.name, w.subcontractor]));

  assert.equal(by["Peter M."], false);
  assert.equal(by["Lindiwe Z."], true);
  assert.equal(by["Andile G."], false, "an unknown provider is not called a subcontractor");
});

test("a live position with no matching user is ignored, not drawn as a stranger", () => {
  const { all } = buildWorkerChoices({
    users: [{ uid: "a", displayName: "Peter M.", role: "FWR" }],
    liveLocations: [
      { uid: "a", location: { ...NEAR, speedMps: 0 }, capturedAtMs: NOW },
      { uid: "ghost", location: { ...FAR, speedMps: 0 }, capturedAtMs: NOW },
    ],
    meterPoint: METER,
    nowMs: NOW,
  });

  assert.equal(all.length, 1);
  assert.equal(all[0].name, "Peter M.");
});

test("nothing throws on an empty world", () => {
  const empty = buildWorkerChoices({});

  assert.deepEqual(empty.all, []);
  assert.deepEqual(empty.onTheMap, []);
  assert.equal(empty.suggested, null);
  assert.equal(empty.radiusM, 100);
});
