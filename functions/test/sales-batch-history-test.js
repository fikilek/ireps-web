import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {buildSalesBatchHistory,inspectSalesRemoval} from "../targetedBatches/sales-batch-history.js";
const tbId="TGB_20260913_120000_AB12",at={seconds:1,nanoseconds:0};
const input={type:"BATCHED",tbId,rowId:"ROW1",salesId:"00123",geofenceId:`SALES_${tbId}`,erfId:"ERF1",membershipSource:"SCALAR",actor:{uid:"U1",user:"Manager",role:"MNG"},at};
test("history keys conform to the external Markdown TB6 contract with stable event identity",()=>{
 const schema=fs.readFileSync(`${process.env.IREPS_SCHEMAS_ROOT||"C:/dev/ireps-schemas"}/sales-all-meters/sales-all-meters-schema.md`,"utf8");
 const event=buildSalesBatchHistory(input);
 for(const key of Object.keys(event))assert.ok(schema.includes('`'+key+'`'),key);
 assert.equal(event.id,`${tbId}__BATCHED`);assert.equal(event.membershipBefore,null);assert.equal(event.membershipAfter,tbId);
 assert.deepEqual(buildSalesBatchHistory(input),event);assert.equal(event.salesMeterStatus,"NOT_STARTED");
});
test("removal distinguishes scalar/legacy, never clears another membership or execution",()=>{
 const row={master:{visibility:"INVISIBLE"},targetedBatchId:tbId,tbRefs:[{id:tbId,date:at}]};
 assert.equal(inspectSalesRemoval(row,tbId).remainingRefs.length,0);
 const legacy={...row};delete legacy.targetedBatchId;assert.equal(inspectSalesRemoval(legacy,tbId).membership.source,"LEGACY_TBREFS");
 for(const bad of [{...row,targetedBatchId:null},{...row,targetedBatchId:"TGB_20260913_120001_AB12"},{...row,master:{visibility:"VISIBLE"}},{...row,tbRefs:[row.tbRefs[0],row.tbRefs[0]]},{...row,tbRefs:[{...row.tbRefs[0],rowId:"ROW1",fieldWork:{status:"IN_PROGRESS",updatedAt:at}}]}])assert.throws(()=>inspectSalesRemoval(bad,tbId));
 assert.throws(()=>buildSalesBatchHistory({...input,type:"REMOVED_FROM_BATCH"}),/reason/);
 const removed=buildSalesBatchHistory({...input,type:"REMOVED_FROM_BATCH",reason:"Unexecuted",removalAudit:{parentStatus:"CREATED"}});
 assert.equal(removed.membershipBefore,tbId);assert.equal(removed.membershipAfter,null);
});
