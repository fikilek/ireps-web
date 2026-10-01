import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { buildExcelArtifact } from "../../utils/reportPlatform/buildExcelArtifact.js";
import { usersTableColumns, usersTableSearchValue } from "./usersTableModel.js";
import { filterIrepsTableRows, sortIrepsTableRows, paginateIrepsTableRows, irepsTableSelectOptions, irepsTableDownloadColumns, irepsTableFilterActive } from "../../components/table/irepsTableModel.js";

const rows = [
  { id: "1", surname: "Zulu", name: "Amy", displayName: "Amy Zulu", email: "amy@example.com", role: "FWR", teams: ["Alpha", "Beta"], accountStatus: "ENABLED" },
  { id: "2", surname: "Adams", name: "Ben", displayName: "Ben Adams", email: "ben@example.com", role: "SPV", teams: ["Beta"], accountStatus: "ACTIVE" },
  { id: "3", surname: "NAv", name: "Cara", displayName: "Cara", email: "cara@example.com", role: "FWR", teams: [], accountStatus: "DISABLED" },
];
const columns = usersTableColumns();
const ids = rows => rows.map(row => row.id);

test("individual team membership, None and search combine without partial dropdown matches", () => {
  assert.deepEqual(ids(filterIrepsTableRows(rows, columns, { filters: { teams: "Beta" } })), ["1", "2"]);
  assert.deepEqual(ids(filterIrepsTableRows(rows, columns, { filters: { teams: "None" } })), ["3"]);
  assert.deepEqual(filterIrepsTableRows(rows, columns, { filters: { teams: "Bet" } }), []);
  assert.deepEqual(ids(filterIrepsTableRows(rows, columns, { filters: { teams: "Beta", role: "FWR", $search: "AMY@" }, searchValue: usersTableSearchValue })), ["1"]);
  assert.deepEqual(irepsTableSelectOptions(rows, columns.find(c => c.key === "teams")), ["Alpha", "Beta", "None"]);
});

test("canonical account statuses retain their values behind readable labels", () => {
  const options = [{value:"ACTIVE",label:"Enabled"},{value:"ENABLED",label:"Enabled"}];
  const configured = usersTableColumns({options:{accountStatus:options}});
  assert.deepEqual(irepsTableSelectOptions(rows, configured.find(c=>c.key==='accountStatus')), options);
  assert.deepEqual(ids(filterIrepsTableRows(rows, configured, {filters:{accountStatus:'ACTIVE'}})), ['2']);
});

test("unknown teams do not become None or remove users while membership is unavailable", () => {
  const pending = usersTableColumns({teamsUnavailable:true});
  const team = pending.find(c=>c.key==='teams');
  assert.deepEqual(ids(filterIrepsTableRows(rows, pending, {filters:{teams:'None'}})), ['1','2','3']);
  assert.equal(team.exportValue(rows[0]), 'NAv');
  assert.equal(irepsTableFilterActive(team,'None'), true, 'Clear Filters remains available for retained filter state');
});

test("missing values stay last in both directions and never match literal NAv", () => {
  assert.deepEqual(ids(sortIrepsTableRows(rows, columns, {key:'surname',direction:'asc'})), ['2','1','3']);
  assert.deepEqual(ids(sortIrepsTableRows(rows, columns, {key:'surname',direction:'desc'})), ['1','2','3']);
  assert.deepEqual(filterIrepsTableRows(rows, columns, {filters:{surname:'nav'}}), []);
});

test("filtered/sorted export population is independent of pagination, and clearing restores users", () => {
  const many = Array.from({length:12},(_,i)=>({...rows[0],id:String(i),surname:`User ${i+1}`}));
  const filtered = filterIrepsTableRows(many, columns, {filters:{teams:'Alpha'}});
  const sorted = sortIrepsTableRows(filtered, columns, {key:'surname',direction:'desc'});
  assert.equal(paginateIrepsTableRows(sorted,1,5).rows.length,5);
  assert.equal(sorted.length,12);
  assert.equal(sorted[0].surname,'User 12');
  const exported=irepsTableDownloadColumns(columns);
  assert.equal(exported.length,8);
  assert.equal(exported.find(c=>c.key==='teams').value(rows[0]),'Alpha, Beta');
  assert.equal(exported.find(c=>c.key==='accountStatus').value(rows[1]),'Enabled');
  assert.equal(filterIrepsTableRows(many, columns, {filters:{}}).length,12);
});

test("Users Excel contains the eight approved columns and filtered users in sort order", () => {
  const visible = sortIrepsTableRows(
    filterIrepsTableRows(rows, columns, {filters:{teams:'Beta'}}),
    columns, {key:'surname',direction:'asc'},
  );
  const artifact = buildExcelArtifact({rows:visible,columns:irepsTableDownloadColumns(columns),fileName:'users.xlsx',sheetName:'Users'});
  const workbook=XLSX.read(artifact.bytes,{type:'array'});
  const sheet=XLSX.utils.sheet_to_json(workbook.Sheets.Users,{header:1});
  assert.deepEqual(sheet[0],['Surname','Name','Email','Role','Service Provider','Team','Account Status','Onboarding Status']);
  assert.deepEqual(sheet.slice(1).map(row=>row[0]),['Adams','Zulu']);
  assert.deepEqual(sheet.slice(1).map(row=>row[5]),['Beta','Alpha, Beta']);
  assert.equal(sheet[1][6],'Enabled');
});
