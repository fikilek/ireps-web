import test from "node:test";
import assert from "node:assert/strict";
import { buildMdBgoMeterRows, buildMdBgoRowsSummary, enrichMdBgoRows, getMdBgoRowProgress, mdBgoRowSearchValue } from "./mdBgoRowsModel.js";
import { filterIrepsTableRows } from "../../../components/table/irepsTableModel.js";

test("MD BGO row progress uses only the canonical row state", () => {
  assert.equal(getMdBgoRowProgress("IN_PROGRESS"), "IN_PROGRESS");
  assert.equal(getMdBgoRowProgress("COMPLETED"), "COMPLETED");
  assert.equal(getMdBgoRowProgress("ISSUED"), "NOT_STARTED");
  assert.equal(getMdBgoRowProgress(""), "UNAVAILABLE");
});

test("MD BGO row summary counts each work row once", () => {
  assert.deepEqual(buildMdBgoRowsSummary([
    { workflow: { state: "READY_FOR_ALLOCATION" } },
    { workflow: { state: "IN_PROGRESS" } },
    { workflow: { state: "COMPLETED" } },
    { workflow: { state: "UNKNOWN" } },
  ]), { total: 4, notStarted: 1, inProgress: 1, completed: 1, unavailable: 1 });
});

test("premise rows keep their ERF identity and join premise and meter details", () => {
  const [seed, first, repeat] = enrichMdBgoRows({
    rows: [
      { id: "R1", rowNo: 1, erf: { id: "E1", erfNo: "100" }, workflow: { state: "ISSUED" } },
      { id: "R2", rowNo: 2, erf: { id: "E1", erfNo: "100" }, refs: { premiseId: "P1" }, workflow: { state: "IN_PROGRESS" } },
      { id: "R3", rowNo: 3, erf: { id: "E1", erfNo: "100" }, refs: { premiseId: "P2" }, workflow: { state: "COMPLETED" } },
    ],
    premises: [
      { id: "P1", premiseNo: "A", address: { strNo: "1", strName: "Main", strType: "Road" }, propertyType: { type: "Flat", unitNo: "1" } },
      { id: "P2", premiseNo: "B", propertyType: { type: "Flat", unitNo: "2" } },
    ],
    meters: [{ id: "M1", accessData: { premise: { id: "P1" } }, astData: { astNo: "12345" } }],
  });
  assert.equal(seed.premiseId, "");
  assert.equal(first.erfNo, "100");
  assert.equal(first.propertyType, "Flat");
  assert.equal(first.premiseAddress, "1 Main Road");
  assert.equal(first.meterNumbers, "12345");
  assert.equal(repeat.premiseNo, "B");
  assert.match(mdBgoRowSearchValue(first), /Main Road.*Flat.*12345/);
});

const workRows = [
  { id: "B_ROW_1", rowNo: 1, erf: { id: "E1", erfNo: "25" }, workflow: { state: "ISSUED" } },
  { id: "B_ROW_2", rowNo: 2, erf: { id: "E1", erfNo: "25" }, refs: { premiseId: "P1" }, workflow: { state: "IN_PROGRESS" } },
];
const premises = [{ id: "P1", address: { strNo: "25", strName: "Main" }, propertyType: { type: "Flat", unitNo: "1" } }];
const meter = (id, number) => ({ id, accessData: { premise: { id: "P1" } }, ast: { astData: { astNo: number } } });
const display = (meters = []) => buildMdBgoMeterRows(enrichMdBgoRows({ rows: workRows, premises, meters }));

test("meterless placeholders expand into separate meter rows with source identity intact", () => {
  const initial = display();
  assert.deepEqual(initial.map((row) => row.meterNo), ["NAv", "NAv"]);
  const found = display([meter("M1", "1001"), meter("M2", "1002")]);
  assert.deepEqual(found.map((row) => row.meterNo), ["NAv", "1001", "1002"]);
  assert.deepEqual(found.map((row) => row.sourceRowId), ["B_ROW_1", "B_ROW_2", "B_ROW_2"]);
  assert.equal(new Set(found.map((row) => row.rowKey)).size, 3);
  assert.equal(found[1].erfId, "E1");
  assert.equal(found[2].premiseId, "P1");
  assert.deepEqual(buildMdBgoRowsSummary(found), { total: 3, notStarted: 1, inProgress: 2, completed: 0, unavailable: 0 });
  assert.equal(workRows.length, 2, "display expansion must not create permanent work items");
});

test("meter keys survive arrival order and repeated snapshots without duplicate meters", () => {
  const a = display([meter("M1", "1001"), meter("M2", "1002"), meter("M1", "1001")]);
  const b = display([meter("M2", "1002"), meter("M1", "1001")]);
  assert.equal(a.length, 3);
  assert.deepEqual(a.map((row) => row.rowKey).sort(), b.map((row) => row.rowKey).sort());
  assert.equal(display([meter("M1", "1001")]).length, 2, "removed meters disappear without leaving an extra placeholder");
  assert.equal(display([meter("M3", "")])[1].meterNo, "NAv");
});

test("meter search isolates individual meters while retaining premise identity search", () => {
  const rows = display([meter("M1", "1001"), meter("M2", "1002")]);
  const columns = [{ key: "meterNo", filter: "text", value: (row) => row.meterNo }];
  const result = filterIrepsTableRows(rows, columns, { filters: { $search: "1002" }, searchValue: mdBgoRowSearchValue });
  assert.equal(result.length, 1);
  assert.equal(result[0].meterId, "M2");
  assert.equal(filterIrepsTableRows(rows, columns, { filters: { $search: "P1" }, searchValue: mdBgoRowSearchValue }).length, 2);
});
