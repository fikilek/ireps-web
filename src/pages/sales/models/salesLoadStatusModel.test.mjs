import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SALES_LOAD_SLOW_AFTER_MS, salesLoadElapsedText, salesLoadStatus } from "./salesLoadStatusModel.js";

// Web Data Copy rules WD-R001.6 and .7 (1.2.0): the wait says what is being read and how long it has
// been running; it stops only when the computer is offline, or after 10 minutes.
const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("the time reads plainly, in seconds and then minutes", () => {
  assert.equal(salesLoadElapsedText(0), "0 s");
  assert.equal(salesLoadElapsedText(999), "0 s");
  assert.equal(salesLoadElapsedText(12_400), "12 s");
  assert.equal(salesLoadElapsedText(59_999), "59 s");
  assert.equal(salesLoadElapsedText(60_000), "1 min");
  assert.equal(salesLoadElapsedText(72_000), "1 min 12 s");
  assert.equal(salesLoadElapsedText(600_000), "10 min");
  assert.equal(salesLoadElapsedText(-5), "0 s", "a clock that jumps back never shows a negative time");
});

test("the line names the municipality and counts up; the background-tab hint comes after 90 seconds", () => {
  const early = salesLoadStatus({ elapsedMs: 12_000, place: "Endumeni" });
  assert.equal(early.title, "Loading the Sales records");
  assert.equal(early.line, "Reading all Endumeni Sales records — 12 s so far.");
  assert.match(early.note, /once per site each time you sign in/);
  assert.equal(early.slowHint, "", "no hint while the load is still quick");
  const slow = salesLoadStatus({ elapsedMs: SALES_LOAD_SLOW_AFTER_MS, place: "Endumeni" });
  assert.equal(slow.line, "Reading all Endumeni Sales records — 1 min 30 s so far.");
  assert.match(slow.slowHint, /Keep this tab in front.*slows down a tab left in the background/);
  assert.equal(salesLoadStatus({ elapsedMs: 3_000 }).line, "Reading all Sales records — 3 s so far.", "no municipality yet");
  // WD-R001.6: the browser is given no count while a read runs, so no percentage is invented.
  for (const value of Object.values(salesLoadStatus({ elapsedMs: 120_000, place: "Endumeni" }))) assert.doesNotMatch(String(value), /%|\bMB\b|\bof\b \d/);
});

test("both Sales pages show the line, and the read waits 10 minutes but stops at once with no connection", async () => {
  const api = await read("../../../redux/salesApi.js");
  assert.match(api, /export const SALES_LOAD_TIME_LIMIT_MS = 600_000;/, "10 minutes, not 3");
  assert.match(api, /have not arrived after 10 minutes/);
  assert.match(api, /navigator\?\.onLine === false/);
  assert.match(api, /finish\(\{ error: SALES_LOAD_OFFLINE_ERROR \}\);/);
  assert.match(api, /no internet connection, so the Sales records cannot be read/);
  for (const path of ["../PrepaidSales.jsx", "../NonGpsBatchPlanningPage.jsx"]) {
    const page = await read(path);
    assert.match(page, /salesLoadStatus\(\{ elapsedMs, place \}\)/, path);
    assert.match(page, /setInterval\(\(\) => setNowMs\(Date\.now\(\)\), 1000\)/, `${path}: the seconds tick`);
    assert.match(page, /const elapsedMs = Math\.max\(0, nowMs - \(startedAtMs \|\| mountedAtMs\)\);/, `${path}: the time is counted from when the read started`);
    assert.match(page, /startedAtMs=\{salesReadStartedAtMs\(/, `${path}: the read's own start time`);
    assert.doesNotMatch(page, /aria-live="polite" aria-busy="true"/, `${path}: the ticking seconds are not read out every second`);
    assert.match(page, /return \(\) => clearInterval\(tick\);/, `${path}: the timer stops with the panel`);
    assert.match(page, /\{status\.slowHint \? <p style=\{styles\.loadingNote\}>\{status\.slowHint\}<\/p> : null\}/, path);
    assert.match(page, /rror\.error \|\| SALES_LOAD_TIMEOUT_ERROR\.error/, `${path}: the read's own words are shown`);
  }
  assert.doesNotMatch(await read("../PrepaidSales.jsx"), /Loading prepaid sales\.\.\.|Loading live Sales meters\./, "the silent spinner text is gone");
});
