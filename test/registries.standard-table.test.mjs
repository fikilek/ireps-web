import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { filterIrepsTableRows, sortIrepsTableRows, paginateIrepsTableRows, irepsTableDownloadColumns, irepsTableBands } from "../src/components/table/irepsTableModel.js";

// Render the actual registry pages against the opt-in, read-only API fixtures.
// Capture their shared-table contract, not a duplicate of the page's logic.
let server, probe;
const modules = {};
const pages = ["Wards", "Erfs", "Premises", "Meters", "Accounts", "Trns", "Mread", "MreadStaging"];
before(async () => {
  server = await createServer({
    configFile: fileURLToPath(new URL("../dev/registries-preview.config.mjs", import.meta.url)),
    configLoader: "runner", mode: "dev", server: { middlewareMode: true },
    plugins: [{
      name: "capture-registry-table-contract", enforce: "pre",
      resolveId(source) {
        if (source === "virtual:registry-table-probe" || source === "../../components/table/IrepsTable") return "\0registry-table-probe";
      },
      load(id) {
        if (id === "\0registry-table-probe") return `export const tables=[]; export default function Table(props){tables.push(props);return null;} export function IrepsTableFilterInput(){return null;} export function IrepsTableFilterSelect(){return null;}`;
      },
      transform(code,id) {
        if (id.replaceAll("\\","/").endsWith("/AccountsRegistryPage.jsx")) return code + "\nexport {SimpleListTable};";
        if (id.replaceAll("\\","/").endsWith("/MreadRegistryPage.jsx")) return code + "\nexport {MreadStagingControllerModal};";
      },
    }],
  });
  probe = await server.ssrLoadModule("virtual:registry-table-probe");
  for (const page of pages) modules[page] = await server.ssrLoadModule(`/src/pages/registries/${page === "MreadStaging" ? page+"Page" : page+"RegistryPage"}.jsx`);
});
after(async () => { await server?.close(); });

function capture(Component, props = {}) {
  probe.tables.length = 0;
  renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Component,props)));
  return probe.tables.at(-1);
}
const pageTable = name => capture(modules[name].default);
const filter = (table, filters) => table.filterRows ? table.filterRows(table.rows,filters) : filterIrepsTableRows(table.rows,table.columns,{filters});

test("MREAD completion cells and downloads show SAST while sorting keeps the stored instant", () => {
  const table = pageTable("Mread");
  const column = table.columns.find(c => c.key === "completedAt");
  const cases = [
    ["2026-10-05T19:09:45.455Z", "2026-10-05 21:09:45"],
    ["2026-10-05T19:06:58.076Z", "2026-10-05 21:06:58"],
    ["2026-10-05T18:56:23.108Z", "2026-10-05 20:56:23"],
    ["2026-10-05T22:00:00.000Z", "2026-10-06 00:00:00"],
  ];
  for (const [completedAt, expected] of cases) {
    const row = { ...table.rows[0], completedAt };
    assert.equal(renderToStaticMarkup(column.render(row)), expected);
    assert.equal(column.sortValue(row), Date.parse(completedAt));
    const downloadColumns = table.downloads.columns.filter(c => c.header === "Completed At");
    assert.ok(downloadColumns.length > 0);
    for (const download of downloadColumns) {
      assert.equal(download.value(row), expected);
    }
    assert.equal(row.completedAt, completedAt);
  }
});

test("all eight actual pages supply loaded rows and unique columns to the shared table", () => {
  for (const name of pages) {
    const table = pageTable(name);
    assert.equal(table.rows.length,12,name);
    assert.equal(new Set(table.columns.map(c=>c.key)).size,table.columns.length,name);
    assert.equal(filter(table,{}).length,12,`${name}: Clear Filters restores loaded rows`);
    assert.equal(paginateIrepsTableRows(table.rows,1).rows.length,5,name);
    assert.ok(table.downloads.fileBaseName,name);
    assert.equal(table.downloads.onFullDownload,undefined,`${name}: preserve existing FD availability`);
  }
});

test("registry text, categorical and compound account filters preserve business matching", () => {
  assert.equal(filter(pageTable("Wards"),{wardNumber:"012"}).length,1);
  assert.equal(filter(pageTable("Erfs"),{erfType:"FORMAL"}).length,6);
  assert.equal(filter(pageTable("Premises"),{addressText:"premise-11"}).length,1);
  assert.equal(filter(pageTable("Meters"),{meterType:"water"}).length,6);
  const accounts = pageTable("Accounts");
  assert.equal(filter(accounts,{accountCountMode:"ZERO"}).length,0);
  assert.equal(filter(accounts,{accountSearch:"A11-2",accountCountMode:"MULTIPLE"}).length,1);
  assert.equal(filter(accounts,{meterSearch:"meter-11",meterCountMode:"MULTIPLE"}).length,1);
  assert.equal(filter(pageTable("Trns"),{trnId:"TRN-11"}).length,1);
  assert.equal(filter(pageTable("Mread"),{outcome:"NO_ACCESS"}).length,4);
  assert.equal(filter(pageTable("MreadStaging"),{meterType:"water"}).length,6);
});

test("clearing a select to its All option does not filter out the registry", () => {
  for (const name of pages) {
    const table=pageTable(name);
    for(const column of table.columns.filter(c=>c.filter==='select')) {
      assert.equal(filter(table,{[column.key]:""}).length,12,`${name}.${column.key}`);
      assert.equal(filter(table,{[column.key]:"ALL"}).length,12,`${name}.${column.key}`);
    }
  }
});

test("shared date dialogs retain inclusive registry date filtering", () => {
  for(const name of pages.filter(p=>p!=="MreadStaging")) {
    const table=pageTable(name), key=table.columns.find(c=>c.filter==='date').key;
    assert.deepEqual(filter(table,{[key]:{mode:"CUSTOM",startDate:"2026-09-03",endDate:"2026-09-05"}}).map(r=>r.id),["preview-2","preview-3","preview-4"],name);
  }
});

test("TRN has no column groups and hides TRN ID by default", () => {
  const table=pageTable("Trns");
  assert.equal(table.rowKey({trnId:"TRN-no-id"}),"TRN-no-id");
  const bands=irepsTableBands(table.columns,table.groups);
  assert.deepEqual(bands,[]);
  assert.equal(table.columns.some(c=>c.key==="trnId"),false);
  assert.equal(table.columns.length,16);
  assert.ok(table.columns.some(c=>!c.sortable && c.render));
});

test("numeric staging sorting keeps missing readings last in both directions", () => {
  const table=pageTable("MreadStaging");
  const rows=[{rowId:'missing',currentReading:null},{rowId:'ten',currentReading:10},{rowId:'two',currentReading:2}];
  assert.deepEqual(sortIrepsTableRows(rows,table.columns,{key:'currentReading',direction:'asc'}).map(r=>r.rowId),['two','ten','missing']);
  assert.deepEqual(sortIrepsTableRows(rows,table.columns,{key:'currentReading',direction:'desc'}).map(r=>r.rowId),['ten','two','missing']);
});

test("QD keeps all filtered rows in numeric sort order, independent of the visible page", () => {
  const table=pageTable("Erfs");
  const rows=sortIrepsTableRows(filter(table,{erfType:'FORMAL'}),table.columns,{key:'erfNo',direction:'desc'});
  assert.equal(rows.length,6);
  assert.equal(paginateIrepsTableRows(rows,1,5).rows.length,5);
  const exportColumns=table.downloads.columns;
  assert.deepEqual(rows.map(exportColumns[0].value),['111','109','107','105','103','101']);
  assert.equal(exportColumns.length,10);
});

test("linked-account IDs remain paired with their source account after sorting and paging", () => {
  const table=capture(modules.Accounts.SimpleListTable,{
    rows:[{accountNo:'B'},{accountNo:'A'}],
    columns:[{key:'accountNo',label:'Account No',render:r=>r.accountNo},{key:'accountMasterId',label:'Account Master ID',render:(_,i)=>['master-B','master-A'][i]}],
  });
  const sorted=sortIrepsTableRows(table.rows,table.columns,{key:'accountNo',direction:'asc'});
  const columns=irepsTableDownloadColumns(table.columns);
  assert.deepEqual(sorted.map(row=>columns.map(c=>c.value(row))),[['A','master-A'],['B','master-B']]);
  assert.equal(table.columns[1].render(paginateIrepsTableRows(sorted,2,1).rows[0]),'master-B');
});

test("reading-cycle selection and staging actions remain separate from table paging", () => {
  const table=capture(modules.Mread.MreadStagingControllerModal,{lmPcode:'ZA5241',onClose:()=>{}});
  assert.equal(table.rows.length,8);
  assert.equal(table.rowKey(table.rows[0]),'cycle-1');
  assert.equal(typeof table.onRowClick,'function');
  assert.equal(paginateIrepsTableRows(table.rows,2).rows.length,3);
  const action=table.columns.find(c=>c.key==='staging');
  assert.match(renderToStaticMarkup(action.render({...table.rows[0],isFuture:true})),/disabled=""/);
});
