// Targeted Batch rules TB-R061 (1.3.64): the Meter Location window draws the ERF the meter sits on
// and says its status, address, Ward, batch and premise in plain words.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  erfPlaceTitle,
  erfShapeNote,
  meterAddressText,
  meterBatchLines,
  meterBatchTarget,
  meterLocationPlaces,
  meterLocationSubtitle,
  meterPremise,
  meterStatusCode,
  meterStatusText,
  meterTownText,
  meterWardText,
} from "./meter-location-model.js";

const TB_ID = "TGB_20260914_085124_F2MH";

const candidate = (over = {}) => ({
  erfId: "ERF1",
  erfNumber: "1234",
  wardNumber: "6",
  latitude: -28.168,
  longitude: 30.236,
  hasValidGps: true,
  ...over,
});

test("every ERF candidate is still listed, and a saved ERF is drawn as well", () => {
  const places = meterLocationPlaces({
    erfCandidates: [candidate(), candidate({ erfId: "ERF2", erfNumber: "1235" })],
  });
  assert.equal(places.length, 2);
  assert.deepEqual(places.map((place) => place.erfId), ["ERF1", "ERF2"]);
  assert.deepEqual(places[0].point, { lat: -28.168, lng: 30.236 });
  assert.equal(places[0].source, "CANDIDATE");

  // A Non-GPS candidate keeps its place: its ERF can still be drawn from the ERF's own boundary.
  const noGps = meterLocationPlaces({
    erfCandidates: [candidate({ hasValidGps: false, latitude: null, longitude: null })],
  });
  assert.equal(noGps.length, 1);
  assert.equal(noGps[0].point, null);

  // TB-R041: the meter's saved ERF is never overridden by a candidate, and is drawn when it is
  // not one of them. It is not repeated when it is.
  const saved = meterLocationPlaces({ erfId: "ERF9", erfNo: "9000", erfCandidates: [candidate()] });
  assert.deepEqual(saved.map((place) => place.erfId), ["ERF1", "ERF9"]);
  assert.equal(saved[1].source, "SAVED");
  const alreadyThere = meterLocationPlaces({ erfId: "ERF1", erfCandidates: [candidate()] });
  assert.deepEqual(alreadyThere.map((place) => place.erfId), ["ERF1"]);

  assert.deepEqual(meterLocationPlaces({}), []);
  assert.deepEqual(meterLocationPlaces({ erfCandidates: [{ erfNumber: "1" }] }), []);
});

test("the window counts what it has in plain words", () => {
  assert.equal(meterLocationSubtitle([]), "No ERF and no coordinates yet");
  assert.equal(meterLocationSubtitle([{}]), "One ERF");
  assert.equal(meterLocationSubtitle([{}, {}, {}]), "3 ERF candidates");
  assert.equal(erfPlaceTitle({ erfNumber: "1234" }, 0, 1), "ERF 1234");
  assert.equal(erfPlaceTitle({ erfNumber: "1234" }, 1, 2), "2. ERF 1234");
  assert.equal(erfPlaceTitle({ source: "SAVED" }, 0, 1), "ERF NAv (the meter's saved ERF)");
});

test("an outline that cannot be read says so instead of leaving a blank", () => {
  assert.equal(erfShapeNote({ erfId: "", drawn: false, loading: true }), "This candidate has no ERF ID, so its outline cannot be drawn.");
  assert.equal(erfShapeNote({ erfId: "ERF1", drawn: true }), "Outline drawn on the map.");
  assert.equal(erfShapeNote({ erfId: "ERF1", loading: true }), "Reading the ERF's outline…");
  assert.equal(erfShapeNote({ erfId: "ERF1" }), "The ERF's outline could not be read.");
});

test("the meter's work status is the Sales table's own word, and never a fourth one", () => {
  assert.equal(meterStatusText({ salesWorkStatus: "NOT_STARTED" }), "Not Started");
  assert.equal(meterStatusText({ salesWorkStatus: "IN_PROGRESS" }), "In Progress");
  assert.equal(meterStatusText({ salesWorkStatus: "COMPLETED" }), "Completed");

  // Without the table's computed word it falls back to the one shared implementation (TB-R054):
  // a VISIBLE meter IS completed.
  assert.equal(meterStatusCode({ master: { visibility: "VISIBLE" } }), "COMPLETED");
  assert.equal(meterStatusText({ master: { visibility: "VISIBLE" } }), "Completed");
  assert.equal(meterStatusText({ master: { visibility: "INVISIBLE" } }), "Not Started");

  for (const row of [{}, { salesWorkStatus: "COMPLETED" }, { master: { visibility: "VISIBLE" } }]) {
    assert.ok(["Not Started", "In Progress", "Completed"].includes(meterStatusText(row)), "only the three statuses");
  }
});

test("the address, town and Ward, and plain words when the record has none", () => {
  assert.equal(meterAddressText({ addressLine1: "12 Mimosa Street" }), "12 Mimosa Street");
  assert.equal(meterAddressText({ adr: { strNo: "12", strName: "Mimosa", strType: "Street" } }), "12 Mimosa Street");
  assert.equal(meterAddressText({}), "This meter has no street address on its Sales record.");
  assert.equal(meterTownText({ town: "Osizweni" }), "Osizweni");
  assert.equal(meterTownText({}), "No town on this meter's Sales record.");
  assert.equal(meterWardText({ wardNumberLabel: "6" }), "Ward 6");
  assert.equal(meterWardText({ wardNumberLabel: "NAv" }), "No Ward on this meter's Sales record.");
  assert.equal(meterWardText({}), "No Ward on this meter's Sales record.");
});

test("the batch is read only when the meter is in one", () => {
  assert.deepEqual(meterBatchTarget({ targetedBatchId: TB_ID }), { tbId: TB_ID, note: "" });
  assert.deepEqual(meterBatchTarget({ targetedBatchId: null }), {
    tbId: "",
    note: "This meter is not in a Targeted Batch.",
  });
  assert.deepEqual(meterBatchTarget({ targetedBatchId: "nonsense" }), {
    tbId: "",
    note: "This meter's batch cannot be read: its Targeted Batch references are unresolved.",
  });
});

test("the batch names itself, its geofence and who it is allocated to", () => {
  assert.deepEqual(meterBatchLines({}), { note: "", lines: [] });

  assert.deepEqual(meterBatchLines({ tbId: TB_ID, batch: null, ready: false }), {
    note: "Reading the batch…",
    lines: [["TB ID", TB_ID]],
  });
  assert.deepEqual(meterBatchLines({ tbId: TB_ID, batch: null, ready: true }), {
    note: "This batch cannot be read. It may have been deleted.",
    lines: [["TB ID", TB_ID]],
  });

  const batch = {
    geofenceId: "GF1",
    status: "ALLOCATED",
    allocation: { targetType: "TEAM", targetId: "T1", targetName: "Kaiser Team" },
  };
  assert.deepEqual(meterBatchLines({ tbId: TB_ID, batch, geofence: { name: "Gf W6 Busuku" }, ready: true }), {
    note: "",
    lines: [
      ["TB ID", TB_ID],
      ["Geofence", "Gf W6 Busuku"],
      ["Allocated to", "Kaiser Team (Team)"],
    ],
  });

  // No geofence name yet: the ID, never a guessed name. No geofence at all: the shared words.
  assert.equal(meterBatchLines({ tbId: TB_ID, batch, ready: true }).lines[1][1], "GF1");
  assert.equal(meterBatchLines({ tbId: TB_ID, batch: { geofenceId: "" }, ready: true }).lines[1][1], "No geofence");
  assert.equal(meterBatchLines({ tbId: TB_ID, batch: { geofenceId: "GF1" }, ready: true }).lines[2][1], "Not allocated");
});

test("the premise, and plain words when the meter has none", () => {
  const row = { tbRefs: [{ id: TB_ID, fieldWork: { premiseId: "PRM_1" } }] };
  assert.deepEqual(meterPremise({ row, tbId: TB_ID }), {
    has: true,
    id: "PRM_1",
    address: "",
    note: "The premise's own address is not read in this window.",
  });

  assert.equal(meterPremise({ row, tbId: TB_ID, premiseAddress: "12 Mimosa Street" }).address, "12 Mimosa Street");
  assert.equal(meterPremise({ row, tbId: TB_ID, premiseAddress: "12 Mimosa Street" }).note, "");

  // The batch's own row carries it too, for a row whose Sales reference has not caught up.
  assert.equal(meterPremise({ row: {}, tbId: TB_ID, batchRow: { premiseId: "PRM_2" } }).id, "PRM_2");
  assert.equal(meterPremise({ row: {}, tbId: TB_ID, batchRow: { refs: { premiseId: "PRM_3" } } }).id, "PRM_3");

  const none = meterPremise({ row: {}, tbId: "" });
  assert.equal(none.has, false);
  assert.equal(none.id, "");
  assert.equal(
    none.note,
    "No premise recorded for this meter yet. A premise is made when the meter is found in the field.",
  );
});

test("the window draws the ERF with the shared helpers, reads one ERF at a time, and only reads", () => {
  const modal = fs.readFileSync(new URL("./MeterLocationModal.jsx", import.meta.url), "utf8");
  for (const needle of [
    // The GPS Sales map's own ERF drawing and label style, not new drawing code.
    "ERF_FOCUS_BOUNDARY_STYLE",
    "ERF_LABEL_STYLE",
    "geoJsonPolygonToGooglePaths",
    "parseGeometry",
    "SALES_STATUS_GLYPHS",
    // One ERF document at a time, by ID: never a Ward-wide read.
    "useGetErfBoundaryByIdQuery",
    // The same reads as the Targeted Batch window.
    "useGetPermanentSalesBatchesQuery",
    "useBatchGeofence",
    // What the window now says.
    "Work status",
    "Street address",
    ">Town<",
    ">Ward<",
    ">Batch<",
    ">Premise<",
  ]) assert.ok(modal.includes(needle), `the window is missing ${needle}`);

  // It only reads: no writes, and no callable.
  for (const banned of [
    "useMutation",
    "httpsCallable",
    "Mutation()",
    "setDoc",
    "updateDoc",
    // Never a coined status word, and no internal status codes on screen.
    "Untouched",
    "Outstanding",
    ">NOT_STARTED<",
    ">IN_PROGRESS<",
    ">COMPLETED<",
    "getVisibleErfsByWardViewport",
  ]) assert.ok(!modal.includes(banned), `the window must not contain ${banned}`);
});
