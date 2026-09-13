import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {creationPayload,assertMutationSizes} from "../targetedBatches/sales-batch-creation.js";
import {buildTargetedBatchParentDoc,buildTargetedBatchRowDoc} from "../targetedBatches/documentFactory.js";
const f=JSON.parse(fs.readFileSync(new URL("./fixtures/sales-batch-fixtures.json",import.meta.url),"utf8"));
test("factory snapshots fresh Sales and preserves identities without client authority",()=>{
 for(const source of ["PREPAID_SALES","PREPAID_SALES_NON_GPS"]){
  const payload=creationPayload({tbId:f.tbId,source,reason:"Reviewed selection"},f.scope,1,"ordinaryAutoFenceId1");
  const common={payload,creationDate:f.stamp,actorUid:f.actor.uid,actorName:f.actor.user};
  const parent=buildTargetedBatchParentDoc({...common,fingerprint:"A".repeat(64)});
  const before=JSON.stringify(f.sales),row=buildTargetedBatchRowDoc({...common,salesSource:f.sales,salesAllMeterId:"00123",rowNo:3,erfReference:{erfId:"ERF1",erfNo:"123"},draftRow:{meterNo:"FORGED",customerName:"FORGED",totalSalesC:999999,latitude:0}});
  assert.equal(parent.creation.state,"READY");assert.equal(parent.counts.totalRows,1);assert.equal(row.rowNo,3);
  assert.equal(row.meter.numberNormalized,"00123");assert.equal(row.customer.customerName,"Test Customer");
  assert.equal(row.salesSnapshot.totalSalesC,1000);assert.equal(row.tbId,parent.id);
  assert.deepEqual(row.refs,{erfId:"ERF1",premiseId:null,meterId:null,trnId:null});
  assert.equal(Object.hasOwn(row.location,"latitude"),false);assert.equal(JSON.stringify(f.sales),before);
 }
});
test("oversized individual document or aggregate mutation fails before transaction writes",()=>{
 assert.throws(()=>assertMutationSizes([{value:"x".repeat(900001)}]),/document/);
 assert.throws(()=>assertMutationSizes(Array.from({length:10},()=>({value:"x".repeat(850000)}))),/transaction/);
 assert.doesNotThrow(()=>assertMutationSizes(Array.from({length:92},()=>({value:"ordinary"}))));
});
