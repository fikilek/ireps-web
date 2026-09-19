import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  REASONS,
  STATUSES,
  axisMax,
  batchStatsErrorText,
  chartScale,
  formatNumber,
  formatReadAt,
  niceStep,
  otherReasonsText,
  reasonLabels,
  shares,
  shownReasons,
  splitText,
  statusCounts,
  teamTypeCells,
  tickLabelsShown,
  townLabel,
} from "./batchStatsModel.js";

// Targeted Batch rules TB-R057 (1.3.55): Batch Stats.
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const addsUp = (list) => Math.round(list.reduce((sum, value) => sum + Number(value.replace("%", "")) * 10, 0));

test("every donut's shares add up to exactly 100.0%", () => {
  assert.deepEqual(shares([34, 43]), ["44.2%", "55.8%"]);
  assert.deepEqual(shares([1, 1, 1]), ["33.4%", "33.3%", "33.3%"], "the first of equal remainders gets the tenth");
  assert.deepEqual(shares([224, 175, 605]), ["22.3%", "17.4%", "60.3%"]);
  assert.deepEqual(shares([0, 36, 145]), ["0.0%", "19.9%", "80.1%"]);
  for (const values of [[1, 2, 3, 4, 5, 6], [7, 0, 0], [999, 1, 1], [48, 144, 58, 103, 13, 0], [2, 3, 7]]) {
    assert.equal(addsUp(shares(values)), 1000, `adds up for ${values}`);
  }
});

test("no meters: every share is 0.0%", () => {
  assert.deepEqual(shares([0, 0, 0]), ["0.0%", "0.0%", "0.0%"]);
  assert.deepEqual(shares([]), []);
  assert.deepEqual(shares([null, undefined, -3]), ["0.0%", "0.0%", "0.0%"]);
});

test("the axis ends at the smallest multiple of the step at or above the value", () => {
  assert.equal(axisMax(43, 10), 50);
  assert.equal(axisMax(50, 10), 50);
  assert.equal(axisMax(1004, 200), 1200);
  assert.equal(axisMax(0, 50), 50, "at least one step");
});

test("the tick step follows the data: today's sizes give 10, 200, 50 and 500", () => {
  assert.equal(niceStep(43), 10, "Part 1: 34 GPS and 43 Non-GPS batches");
  assert.equal(niceStep(1004), 200, "Part 2: 1,004 meters in batches");
  assert.equal(niceStep(206), 50, "Part 3: the largest team bar");
  assert.equal(niceStep(1842), 500, "Part 4: the largest town");
  assert.equal(niceStep(0), 1);
  assert.equal(niceStep(3), 1);
  assert.equal(niceStep(120000), 20000);
  for (let value = 1; value < 50000; value += 37) {
    const { ticks } = chartScale([value]);
    assert.ok(ticks.length >= 2 && ticks.length <= 7, `${value}: ${ticks.length} ticks`);
    if (value >= 3) assert.ok(ticks.length >= 4, `${value}: at least 4 ticks`);
    assert.ok(ticks[ticks.length - 1] >= value, `${value}: the axis reaches the value`);
  }
});

test("one scale for a chart", () => {
  assert.deepEqual(chartScale([34, 43]), { max: 50, step: 10, ticks: [0, 10, 20, 30, 40, 50] });
  assert.deepEqual(chartScale([1004, 688, 316]).ticks, [0, 200, 400, 600, 800, 1000, 1200]);
  assert.deepEqual(chartScale([]), { max: 1, step: 1, ticks: [0, 1] });
});

test("a narrow chart writes only the axis numbers that fit, always the first and the last", () => {
  const ticks = [0, 200, 400, 600, 800, 1000, 1200];
  assert.deepEqual(tickLabelsShown(ticks, 1200, 0), ticks.map(() => true), "not measured yet: all");
  assert.deepEqual(tickLabelsShown(ticks, 1200, 600), ticks.map(() => true), "wide: all");
  const narrow = tickLabelsShown(ticks, 1200, 170);
  assert.equal(narrow[0], true);
  assert.equal(narrow[narrow.length - 1], true);
  assert.ok(narrow.filter(Boolean).length < ticks.length, "some are left out");
  assert.deepEqual(tickLabelsShown([0, 1], 1, 40), [true, true]);
});

test("status counts: Not Started / In Progress / Completed and their total", () => {
  assert.equal(splitText({ NOT_STARTED: 0, IN_PROGRESS: 36, COMPLETED: 145 }), "0 / 36 / 145");
  assert.equal(splitText({ NOT_STARTED: 1004, IN_PROGRESS: 0, COMPLETED: 12345 }), "1,004 / 0 / 12,345");
  assert.deepEqual(statusCounts({ NOT_STARTED: 2, COMPLETED: "3" }), { NOT_STARTED: 2, IN_PROGRESS: 0, COMPLETED: 3, total: 5 });
  assert.deepEqual(STATUSES.map((status) => status.label), ["Not Started", "In Progress", "Completed"]);
  assert.deepEqual(STATUSES.map((status) => status.color), ["#2563eb", "#b45309", "#0f766e"]);
});

test("a team's type with no meters shows none and 0", () => {
  const zero = { total: 0, NOT_STARTED: 0, IN_PROGRESS: 0, COMPLETED: 0 };
  const cells = teamTypeCells({
    batches: { total: 6, GPS: 6, NON_GPS: 0, OTHER: 0 },
    meters: { GPS: { total: 168, NOT_STARTED: 0, IN_PROGRESS: 14, COMPLETED: 154 }, NON_GPS: zero },
  });
  assert.deepEqual(cells, { batches: "6 (6 / 0)", gps: { text: "0 / 14 / 154", total: 168 }, nonGps: { text: "none", total: 0 } });
  assert.deepEqual(teamTypeCells({}).gps, { text: "none", total: 0 });
  assert.equal(teamTypeCells({ batches: { total: 5, GPS: 2, NON_GPS: 2, OTHER: 1 } }).batches, "5 (2 / 2, 1 other)");
});

test("numbers use commas; the read time is the browser's own time", () => {
  assert.equal(formatNumber(1004), "1,004");
  assert.equal(formatNumber(0), "0");
  assert.equal(formatNumber(undefined), "0");
  assert.equal(formatReadAt(new Date(2026, 8, 19, 18, 30, 12).toISOString()), "19 Sep 2026, 18:30");
  assert.equal(formatReadAt(new Date(2026, 0, 5, 7, 4).toISOString()), "5 Jan 2026, 07:04");
  assert.equal(formatReadAt(""), "");
  assert.equal(formatReadAt("not a date"), "");
});

test("the reason labels are the words of TB-R057", async () => {
  assert.deepEqual(REASONS.map((reason) => reason.key), ["GPS_INSIDE_FENCE", "GPS_NO_FENCE", "NON_GPS_READY", "NON_GPS_MANUAL_ERFING", "ADDRESS_MISSING", "OTHER"]);
  assert.deepEqual(REASONS.map((reason) => reason.color), ["#9085e9", "#4a3aa7", "#d55181", "#eda100", "#e34948", "#64748b"]);
  assert.equal(reasonLabels.GPS_INSIDE_FENCE, "GPS, inside a geofence already drawn");
  assert.equal(reasonLabels.GPS_NO_FENCE, "GPS, no geofence yet");
  assert.equal(reasonLabels.NON_GPS_READY, "Non-GPS, ERF known, not batched yet");
  assert.equal(reasonLabels.NON_GPS_MANUAL_ERFING, "Non-GPS, needs manual ERFing first");
  assert.equal(reasonLabels.ADDRESS_MISSING, "Street address or town missing");
  assert.equal(reasonLabels.OTHER, "Other reason");
  const rules = await read("../../../../../../ireps-rules/targeted-batches/targeted-batches-rules.md").catch(() => null);
  if (rules) for (const label of Object.values(reasonLabels)) assert.ok(rules.includes(`**${label}**`), `${label} is in the rules`);
});

test("Other reason shows only when a meter has another reason", () => {
  assert.equal(shownReasons({ OTHER: 0 }).length, 5);
  assert.equal(shownReasons({ OTHER: 2 }).length, 6);
  assert.equal(otherReasonsText([{ code: "X", label: "a GPS meter without exactly one ERF", count: 2 }, { code: "Y", label: "its ERF cannot be found", count: 1 }]),
    "Other reasons: a GPS meter without exactly one ERF (2); its ERF cannot be found (1).");
  assert.equal(otherReasonsText([{ code: "X", label: "its ERF cannot be found", count: 1 }]), "Other reason: its ERF cannot be found (1).");
  assert.equal(otherReasonsText([]), "");
  assert.equal(townLabel(null), "No town");
  assert.equal(townLabel(" "), "No town");
  assert.equal(townLabel("Dundee"), "Dundee");
});

test("a failed count says why in plain words, never a bare code", () => {
  assert.equal(batchStatsErrorText({ code: "functions/permission-denied", error: "The LM must be one of your workbases." }), "The LM must be one of your workbases.");
  assert.equal(batchStatsErrorText({ code: "functions/internal", error: "internal" }), "The count failed on the server. Try again.");
  assert.equal(batchStatsErrorText({ code: "functions/deadline-exceeded", error: "deadline-exceeded" }), "The count took too long and was stopped. Try again.");
  assert.equal(batchStatsErrorText({ code: "functions/unavailable", error: "unavailable" }), "The server could not be reached. Check the connection and try again.");
  assert.equal(batchStatsErrorText(undefined), "The count failed on the server. Try again.");
});

test("the page is wired in: API, route, page title and the TB Register button", async () => {
  const api = await read("../../../../redux/salesTargetedBatchApi.js");
  assert.match(api, /getBatchStatsByLm: rtkBuilder\.query\(\{ \.\.\.callSalesBatch\("getBatchStatsCallable"\), keepUnusedDataFor: 300 \}\),/);
  assert.match(api, /useGetFieldWorkSummaryByLmQuery, useGetBatchStatsByLmQuery \} = salesTargetedBatchApi;/);
  const routes = await read("../../../../routes/AppRoutes.jsx");
  const stats = routes.indexOf('path="/operations/targeted-batches/stats"');
  const rows = routes.indexOf('path="/operations/targeted-batches/:tbId"');
  assert.ok(stats > 0 && rows > stats, "before the TB Rows route");
  assert.match(routes.slice(stats, rows), /<RoleRoute allowedRoles=\{MANAGEMENT_ROLES\}>\s*<BatchStatsPage \/>/);
  const layout = await read("../../../../layouts/ConsoleLayout.jsx");
  const title = layout.indexOf('pathname === "/operations/targeted-batches/stats"');
  assert.ok(title > 0 && title < layout.indexOf('return "TB Rows";'), "Batch Stats is named before the TB Rows pattern");
  assert.match(layout, /pathname === "\/operations\/targeted-batches\/stats"\) \{\s*return "Batch Stats";/);
  const register = await read("../../TargetedBatchesPage.jsx");
  const matrix = register.indexOf('{isAllocationMatrixOpen ? "Hide Allocation Matrix" : "Show Allocation Matrix"}');
  const button = register.indexOf('<Link to="/operations/targeted-batches/stats" style={styles.secondaryLinkButton}>Batch Stats</Link>');
  const clear = register.indexOf("{ticked.selectedIds.length ? (", matrix);
  assert.ok(matrix > 0 && button > matrix && clear > button, "between Show Allocation Matrix and Clear ticks");
});

test("the page shows no numbers while counting or after a failure, and only the three statuses", async () => {
  const page = await read("../../BatchStatsPage.jsx");
  assert.match(page, /useGetBatchStatsByLmQuery\(lmPcode \? \{ lmPcode \} : skipToken, \{ refetchOnMountOrArgChange: true \}\)/);
  assert.match(page, /Counting the batches and meters…/);
  assert.match(page, /This can take up to a minute\./);
  assert.match(page, /Activate a Local Municipality workbase to see Batch Stats\./);
  assert.match(page, /Try again/);
  assert.match(page, /const showNumbers = Boolean\(lmPcode && stats && !isFetching && !isError\);/);
  const onScreen = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(onScreen, /Untouched|Pending|Open rows|VISIBLE|NOT_ALLOCATED|CAT[1-8]/, "no other status words and no internal codes");
  for (const heading of ["Team", "Batches (GPS / Non-GPS)", "GPS meters (Not Started / In Progress / Completed)", "Total GPS meters", "Non-GPS meters (Not Started / In Progress / Completed)", "Total Non-GPS meters"]) {
    assert.ok(page.includes(`"${heading}"`), `Part 3 column ${heading}`);
  }
});
