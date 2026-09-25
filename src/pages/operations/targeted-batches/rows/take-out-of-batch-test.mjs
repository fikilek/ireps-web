import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  TAKE_OUT_REASON_MAX,
  TAKE_OUT_ROLES,
  canSeeTakeOutOfBatch,
  canTakeRowOutOfBatch,
  takeOutBlockedReason,
  takeOutButtonLabel,
  takeOutConfirmWindow,
  takeOutFailureWindow,
  takeOutMeterLine,
  takeOutMeterNo,
  takeOutProgressWindow,
  takeOutResultWindow,
  takeOutSelection,
  takeOutStatusWords,
} from "./takeOutOfBatchModel.js";

// Targeted Batch rules TB-R060 (1.3.62): taking a meter out of a batch, from TB Rows.
// The wording and the enabling rules, and the wiring that puts them on the screen.
const read = path => readFile(new URL(path, import.meta.url), "utf8");
const BATCH = { id: "TGB_20260913_120000_AB12" };
const rowOf = (n, over = {}) => ({ rowKey: `TBR_${n}`, rowNo: String(n), meterNo: `0700000000${n}`, salesAllMeterId: `0700000000${n}`,
  address: `${n} Gray Street`, town: "Dundee", completionStatus: "NOT_STARTED", ...over });
const THREE = [rowOf(1), rowOf(2), rowOf(3)];
const CONTEXT = { rowCount: 3 };

test("only a supervisor or a manager sees the action", () => {
  assert.deepEqual(TAKE_OUT_ROLES, ["SPV", "MNG"]);
  assert.equal(canSeeTakeOutOfBatch("SPV"), true);
  assert.equal(canSeeTakeOutOfBatch("MNG"), true);
  assert.equal(canSeeTakeOutOfBatch("mng"), true);
  for (const role of ["FWR", "ADM", "SPU", "", null, undefined]) assert.equal(canSeeTakeOutOfBatch(role), false, `${role} must not see it`);
});

test("completed work is never released, and the batch's last meter cannot go", () => {
  assert.equal(takeOutBlockedReason(rowOf(1), CONTEXT), null);
  assert.equal(canTakeRowOutOfBatch(rowOf(1), CONTEXT), true);
  assert.equal(canTakeRowOutOfBatch(rowOf(1, { completionStatus: "IN_PROGRESS" }), CONTEXT), true, "a started row may be taken out");
  assert.match(takeOutBlockedReason(rowOf(1, { completionStatus: "COMPLETED" }), CONTEXT), /Completed work is never released\./);
  assert.match(takeOutBlockedReason(rowOf(1, { completionStatus: "INTEGRITY_ERROR" }), CONTEXT), /does not read properly/);
  assert.match(takeOutBlockedReason(rowOf(1, { salesAllMeterId: "", meterNoNormalized: "" }), CONTEXT), /no Sales meter number/);
  assert.match(takeOutBlockedReason(rowOf(1), { rowCount: 1 }), /Use Delete Batch to empty a batch\./);
  // No reason mentions a code or an internal word.
  for (const row of [rowOf(1, { completionStatus: "COMPLETED" }), rowOf(1, { completionStatus: "INTEGRITY_ERROR" })]) {
    assert.doesNotMatch(takeOutBlockedReason(row, CONTEXT), /tb_rows|execution|targetedBatchId/);
  }
});

test("the ticked meters are the ones that may go, by their canonical meter number", () => {
  assert.equal(takeOutMeterNo(rowOf(2)), "07000000002");
  assert.equal(takeOutMeterNo({ meterNoNormalized: "07000000009" }), "07000000009");
  const chosen = takeOutSelection(THREE, ["TBR_1", "TBR_3"], CONTEXT);
  assert.deepEqual(chosen.meterNos, ["07000000001", "07000000003"]);
  assert.equal(chosen.count, 2);
  // A ticked row that may not go is left out, and a tick for a row that is gone is ignored.
  const done = [rowOf(1, { completionStatus: "COMPLETED" }), rowOf(2), rowOf(3)];
  assert.deepEqual(takeOutSelection(done, ["TBR_1", "TBR_2"], CONTEXT).meterNos, ["07000000002"]);
  assert.deepEqual(takeOutSelection(THREE, ["TBR_9"], CONTEXT).meterNos, []);
  assert.equal(takeOutButtonLabel(0), "Take out of batch");
  assert.equal(takeOutButtonLabel(1), "Take 1 meter out of batch");
  assert.equal(takeOutButtonLabel(2), "Take 2 meters out of batch");
});

test("the confirmation names the meter and the batch, and needs the reason in the person's own words", () => {
  const one = takeOutConfirmWindow({ batch: BATCH, items: [rowOf(1)], reasonText: "" });
  assert.equal(one.title, "Take meter 07000000001 out of batch TGB_20260913_120000_AB12?");
  assert.equal(one.canConfirm, false);
  assert.match(one.reasonHint, /Say in your own words why the meter must come out of the batch\./);
  assert.match(one.lines[0], /will leave batch TGB_20260913_120000_AB12/);
  assert.match(one.lines[0], /free again/);
  assert.match(one.lines[1], /never released/);
  assert.match(one.lines[1], /Delete Batch/);
  assert.match(one.lines[2], /settled on its own/);

  const ready = takeOutConfirmWindow({ batch: BATCH, items: [rowOf(1)], reasonText: "  Batched by mistake.  " });
  assert.equal(ready.canConfirm, true);
  assert.equal(ready.reasonText, "Batched by mistake.");
  assert.equal(ready.reasonHint, "");

  const many = takeOutConfirmWindow({ batch: BATCH, items: THREE, reasonText: "Wrong Ward." });
  assert.equal(many.title, "Take 3 meters out of batch TGB_20260913_120000_AB12?");
  assert.deepEqual(many.meters, ["07000000001", "07000000002", "07000000003"]);
  assert.equal(many.canConfirm, true);

  // The three statuses are the only status words on the screen, and nothing else goes near it.
  assert.deepEqual(one.rows, [{ key: "TBR_1", meterNo: "07000000001", line: "Row 1 · 1 Gray Street · Dundee · Not Started" }]);
  assert.equal(takeOutStatusWords(rowOf(1, { completionStatus: "IN_PROGRESS" })), "In Progress");
  assert.equal(takeOutStatusWords(rowOf(1, { completionStatus: "COMPLETED" })), "Completed");
  assert.equal(takeOutMeterLine(rowOf(2, { completionStatus: "IN_PROGRESS" })), "Row 2 · 2 Gray Street · Dundee · In Progress");
  // A row carrying anything else shows no status at all, rather than a fourth word.
  for (const status of ["INTEGRITY_ERROR", "NOT_APPLICABLE", "REJECTED", "", null, undefined]) {
    const row = rowOf(3, { completionStatus: status });
    assert.equal(takeOutStatusWords(row), "", `${status} must not reach the screen`);
    assert.equal(takeOutMeterLine(row), "Row 3 · 3 Gray Street · Dundee");
  }
  const odd = takeOutConfirmWindow({ batch: BATCH, items: [rowOf(3, { completionStatus: "INTEGRITY_ERROR" })], reasonText: "Wrong Ward." });
  assert.equal(odd.rows[0].line, "Row 3 · 3 Gray Street · Dundee");
  for (const text of [odd.rows[0].line, ...odd.lines, odd.title]) {
    assert.doesNotMatch(text, /INTEGRITY_ERROR|NOT_STARTED|IN_PROGRESS|COMPLETED|untouched/, `no internal word on the screen: ${text}`);
  }
  // A row with nothing to say still reads plainly.
  assert.equal(takeOutMeterLine({}), "Row NAv · NAv · NAv");

  const tooLong = takeOutConfirmWindow({ batch: BATCH, items: [rowOf(1)], reasonText: "x".repeat(TAKE_OUT_REASON_MAX + 1) });
  assert.equal(tooLong.canConfirm, false);
  assert.match(tooLong.reasonHint, /longer than 500 characters/);
  // Nothing ticked: nothing to confirm.
  assert.equal(takeOutConfirmWindow({ batch: BATCH, items: [], reasonText: "Anything." }).canConfirm, false);
});

test("while it runs the window says so, and never goes silent", () => {
  const progress = takeOutProgressWindow({ batch: BATCH, items: THREE });
  assert.equal(progress.working, true);
  assert.equal(progress.title, "Taking 3 meters out of batch TGB_20260913_120000_AB12…");
  assert.match(progress.lines[0], /Please wait/);
  assert.match(progress.lines[1], /Do not close this window\./);
});

test("the result says how many went and names every meter that was refused", () => {
  const all = takeOutResultWindow({ batch: BATCH, items: [rowOf(1), rowOf(2)],
    result: { takenOut: [{ meterNo: "07000000001" }, { meterNo: "07000000002" }], refused: [] } });
  assert.equal(all.title, "2 meters taken out of batch TGB_20260913_120000_AB12");
  assert.equal(all.tone, "info");
  assert.match(all.lines[0], /07000000001, 07000000002 left batch TGB_20260913_120000_AB12/);
  assert.match(all.lines[0], /They are free again/);

  const some = takeOutResultWindow({ batch: BATCH, items: THREE,
    result: { takenOut: [{ meterNo: "07000000001" }], refused: [{ meterNo: "07000000002", code: "ROW_COMPLETED", message: "Meter 07000000002 is completed in batch TGB_20260913_120000_AB12. Completed work is never released." },
      { meterNo: "07000000003", code: "LAST_ROW", message: "Meter 07000000003 is the last meter in batch TGB_20260913_120000_AB12. Use Delete Batch to empty a batch." }] } });
  assert.equal(some.title, "1 meter of 3 taken out of batch TGB_20260913_120000_AB12");
  assert.equal(some.tone, "warning");
  assert.equal(some.lines.length, 3);
  assert.match(some.lines[1], /07000000002 stayed in the batch\. Meter 07000000002 is completed/);
  assert.match(some.lines[2], /Use Delete Batch to empty a batch\./);

  const none = takeOutResultWindow({ batch: BATCH, items: [rowOf(1)],
    result: { takenOut: [], refused: [{ meterNo: "07000000001", code: "METER_VISIBLE", message: "Meter 07000000001 has been found on site, so it is completed. Completed work is never released." }] } });
  assert.equal(none.title, "Nothing was taken out of batch TGB_20260913_120000_AB12");
  assert.equal(none.tone, "error");
  assert.match(none.lines[0], /found on site/);
  // An answer with nothing in it is still explained.
  assert.match(takeOutResultWindow({ batch: BATCH, items: [rowOf(1)], result: {} }).lines[0], /No meter was taken out and none was refused\./);
});

test("a failed request says nothing was changed, and an unconfirmed one says what is safe", () => {
  const failed = takeOutFailureWindow({ batch: BATCH, items: [rowOf(1)], failure: { code: "PERMISSION_DENIED", error: "Only a supervisor or a manager may take a meter out of a batch." } });
  assert.equal(failed.tone, "error");
  assert.equal(failed.title, "Nothing was taken out of batch TGB_20260913_120000_AB12");
  assert.match(failed.lines[0], /Only a supervisor or a manager/);
  assert.match(failed.lines[1], /1 meter stays in the batch\. Nothing was changed\./);

  const uncertain = takeOutFailureWindow({ batch: BATCH, items: THREE, failure: { uncertain: true } });
  assert.equal(uncertain.title, "The result was not confirmed");
  assert.match(uncertain.lines[0], /connection dropped/);
  assert.match(uncertain.lines[1], /Pressing Take out of batch again is safe\./);
});

test("TB Rows shows the action to SPV and MNG only, and uses the three windows", async () => {
  const page = await read("../../TargetedBatchDetailsPage.jsx");
  assert.match(page, /const canTakeOut = canSeeTakeOutOfBatch\(role\);/);
  assert.match(page, /const \{ activeWorkbase, role \} = useAuth\(\);/);
  assert.match(page, /\{canTakeOut \? \(/, "the button is only rendered for those roles");
  assert.match(page, /takeOut=\{\s*canTakeOut/, "the ticks are only rendered for those roles");
  // Confirm, then progress, then the result: never the browser's OK/Cancel box.
  assert.doesNotMatch(page, /window\.confirm\(/);
  assert.match(page, /setTakeOutView\(\{ kind: "confirm" \}\)/);
  assert.match(page, /setTakeOutView\(\{ kind: "working" \}\)/);
  assert.match(page, /setTakeOutView\(takeOutResultWindow\(\{ batch, items, result \}\)\)/);
  assert.match(page, /setTakeOutView\(takeOutFailureWindow\(\{ batch, items, failure \}\)\)/);
  // The batch and the meters the server is sent.
  assert.match(page, /takeMeterOutOfBatch\(\{\s*tbId: batch\.id,\s*meterNos: takeOutChosen\.meterNos,\s*reasonText: takeOutReason,\s*\}\)/);
  // Nothing can be closed or pressed twice while it runs.
  assert.match(page, /if \(takeOutBusy\) return;/);
  assert.match(page, /disabled=\{!takeOutChosen\.count \|\| takeOutBusy\}/);
});

test("the rows table ticks only the meters that may go, and says why when it cannot", async () => {
  const table = await read("./TargetedBatchRowsTable.jsx");
  assert.match(table, /takeOut \? <th style=\{styles\.th\} scope="col">Take out<\/th> : null/);
  assert.match(table, /colSpan=\{takeOut \? 19 : 18\}/, "the empty row still spans every column");
  assert.match(table, /disabled=\{Boolean\(takeOut\.blockedReason\(row\)\)\}/);
  assert.match(table, /title=\{takeOut\.blockedReason\(row\) \|\| "Take this meter out of the batch"\}/);
  assert.match(table, /aria-label=\{`Take meter \$\{row\.meterNo \|\| row\.rowNo\} out of the batch`\}/);
});

test("the confirmation window takes the reason, and the keyboard starts in it", async () => {
  const windows = await read("./TargetedBatchTakeOutWindows.jsx");
  // The meter list is printed from the window's own words: no row field reaches the screen raw.
  assert.match(windows, /\{view\.rows\.map\(\(row\) => \(/);
  assert.match(windows, /<small style=\{styles\.muted\}>\{row\.line\}<\/small>/);
  assert.doesNotMatch(windows, /completionStatus/, "the confirmation never prints a status code");
  assert.match(windows, /maxLength=\{TAKE_OUT_REASON_MAX\}/);
  assert.match(windows, /reasonRef\.current\?\.focus\(\)/);
  assert.match(windows, /Reason, in your own words \(required\)/);
  assert.match(windows, /disabled=\{!view\.canConfirm\}/);
  assert.match(windows, /<BatchCreationModal title=\{progress\.title\} working lines=\{progress\.lines\} \/>/);
  assert.match(windows, /actions=\{\[\{ label: "OK", primary: true, onClick: onClose \}\]\}/);
});

test("the batch's rows page calls the one endpoint, next to the other batch calls", async () => {
  const api = await read("../../../../redux/salesTargetedBatchApi.js");
  assert.match(api, /takeMeterOutOfBatch: rtkBuilder\.mutation\(callSalesBatch\("onTakeMeterOutOfBatchCallable"\)\)/);
  assert.match(api, /useTakeMeterOutOfBatchMutation/);
});
