import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {normalizePermanentSalesBatchRow,normalizeTargetedBatchHeader} from "../../src/pages/sales/models/salesTargetedBatchReadModel.js";
import {canonicalTargetedBatchRowState} from "../targetedBatches/lifecycle.js";
test("canonical readers use nested lifecycle, parent acceptance and stable noncontiguous row slots",()=>{
 for(const [execution,acceptance,expected]of [["NOT_STARTED","WAITING","ALLOCATED"],["NOT_STARTED","ACCEPTED","ACCEPTED"],["IN_PROGRESS","ACCEPTED","IN_PROGRESS"],["COMPLETED","ACCEPTED","COMPLETED"]]){
  const raw={schemaVersion:"0.3.0",id:"ROW3",rowNo:3,salesAllMeterId:"00123",decision:{status:"ACCEPT"},allocation:{status:"ALLOCATED"},execution:{status:execution},refs:{erfId:"ERF1"},status:"CREATED"},parent={acceptance:{status:acceptance}};
  assert.equal(canonicalTargetedBatchRowState(raw,parent),expected);const row=normalizePermanentSalesBatchRow(raw,"ROW3",parent);assert.equal(row.status,expected);assert.equal(row.rowNo,3);assert.equal(row.fieldAcceptanceStatus,acceptance);
 }
});
test("missing and invalid canonical lifecycle/counts remain explicitly unavailable",()=>{
 const raw={schemaVersion:"0.3.0",id:"ROW1",rowNo:1,allocation:{status:"made-up"},decision:{status:"made-up"},refs:{erfId:null}};
 const row=normalizePermanentSalesBatchRow(raw);assert.equal(row.allocationStatus,"UNAVAILABLE");assert.equal(row.rowDecision,"UNAVAILABLE");assert.ok(row.integrityIssues.length);
 const header=normalizeTargetedBatchHeader("TB",{schemaVersion:"0.3.0",allocation:{status:"allocated"},execution:{status:"made-up"}});
 assert.equal(header.allocation.status,"UNAVAILABLE");assert.equal(header.execution.status,"UNAVAILABLE");assert.equal(header.progress.total,null);assert.ok(header.integrityIssues.length);
});
test("generic geofence side-effect queries retain ACTIVE-only guards",()=>{
 const index=fs.readFileSync(new URL("../index.js",import.meta.url),"utf8");
 const queries=[...index.matchAll(/\.collection\("geo_fences"\)[\s\S]{0,260}?\.get\(\)/g)];
 assert.ok(queries.filter(match=>!match[0].includes(".doc(")).length>=2);for(const match of queries.filter(match=>!match[0].includes(".doc(")))assert.match(match[0],/\.where\("status", "==", "ACTIVE"\)/);
 const informal=fs.readFileSync(new URL("../informal-erfs/submitInformalErfCallable.js",import.meta.url),"utf8");assert.match(informal,/\.where\("status", "==", "ACTIVE"\)/);
});

test("generic count recomputation excludes BATCH_ONLY even if an old reference names it",async()=>{
 const source=fs.readFileSync(new URL("../index.js",import.meta.url),"utf8"),start=source.indexOf("async function recomputeGeoFenceCountsForIds("),end=source.indexOf("async function syncAstGeoFenceMembership(",start);
 let reads=0,writes=0;
 const recompute=new Function("logger","recomputeGeoFenceCounts",`return (${source.slice(start,end).trim()})`)({warn(){},info(){}},()=>{throw new Error("BATCH_ONLY must not request counts");});
 const db={collection:()=>({doc:()=>({get:async()=>{reads++;return{exists:true,data:()=>({status:"BATCH_ONLY",parents:{lmPcode:"ZA5241",wardPcode:"ZA5241001"}})};},update:()=>{writes++;}})})};
 await recompute({db,geoFenceIds:["SALES_TGB_20260913_120000_AB12"]});assert.equal(reads,1);assert.equal(writes,0);
});
