// Adapted A07: compare the actual approved main baseline; 40f1a17 is historical only.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SourceTextModule, SyntheticModule, createContext } from "node:vm";
import { classifySalesWorkStatus, buildSalesTbRefCorrelationKey, inspectSalesTbRefsIntegrity, SALES_WORK_STATUSES } from "../../../functions/salesAllMeters/sales-batch-policy.js";
const root=fileURLToPath(new URL("../../../",import.meta.url));
const code=execFileSync("git",["-c",`safe.directory=${root.replaceAll("\\","/").replace(/\/$/,"")}`,"show","54ef7e2:src/pages/sales/models/salesTableWorkStatusModel.js"],{cwd:root,encoding:"utf8"});
const context=createContext({}), module=new SourceTextModule(code,{context});
const dependencies={"./salesStatusModel.js":{SALES_STATUSES:SALES_WORK_STATUSES},"./salesTbRefsIntegrityModel.js":{buildSalesTbRefCorrelationKey}};
await module.link(name=>{assert.ok(dependencies[name]);const values=dependencies[name];return new SyntheticModule(Object.keys(values),function(){for(const [key,value]of Object.entries(values))this.setExport(key,value);},{context});});await module.evaluate();
const old=module.namespace.classifySalesTableWorkStatus;
const reference={id:"TGB_20260913_120000_AB12",date:{seconds:1,nanoseconds:0},rowId:"ROW1",fieldWork:{status:"IN_PROGRESS",updatedAt:{seconds:1,nanoseconds:0}}};
for(const [name,row,expected]of [
 ["visible-first",{masterVisibility:"VISIBLE",tbRefs:null},"COMPLETED"],
 ["valid-progress",{masterVisibility:"INVISIBLE",tbRefs:[reference]},"IN_PROGRESS"],
 ["clean-unstarted",{masterVisibility:"INVISIBLE",tbRefs:[]},"NOT_STARTED"],
 ["malformed-plus-valid",{masterVisibility:"INVISIBLE",tbRefs:[null,reference]},"IN_PROGRESS"],
 ["duplicates-unclassifiable",{masterVisibility:"INVISIBLE",tbRefs:[reference,reference]},"NOT_STARTED"],
])test(`54ef7e2 normalized baseline parity: ${name}`,()=>{const normalized={...row,tbRefsIntegrity:inspectSalesTbRefsIntegrity(row.tbRefs)};assert.equal(old(normalized),expected);assert.equal(classifySalesWorkStatus(normalized),expected);});
test("intentional v4.2 changes: raw authority and no trusted cached classification",()=>{
 const raw={master:{visibility:"VISIBLE"},tbRefs:[]};assert.equal(old(raw),"NOT_STARTED");assert.equal(classifySalesWorkStatus(raw),"COMPLETED");
 const uncached={tbRefs:[reference]};assert.equal(old(uncached),"NOT_STARTED");assert.equal(classifySalesWorkStatus(uncached),"IN_PROGRESS");
 const invalid={tbRefs:[{...reference,date:null}],tbRefsIntegrity:{entriesByKey:{[buildSalesTbRefCorrelationKey(reference)]:{classifiable:true}}}};
 assert.equal(old(invalid),"IN_PROGRESS");assert.equal(classifySalesWorkStatus(invalid),"NOT_STARTED");
});
