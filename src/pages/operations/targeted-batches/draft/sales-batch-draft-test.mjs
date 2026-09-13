import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {buildRetainedSalesDraft,projectSalesDraft,confirmationIdentity,salesDraftIntent} from "./sales-batch-draft-model.js";
const f=JSON.parse(fs.readFileSync(new URL("../../../../../functions/test/fixtures/sales-batch-fixtures.json",import.meta.url),"utf8"));
function fixture(n=1){
 const ids=Array.from({length:n},(_,i)=>`00${123+i}`),rows=ids.map(id=>({...f.sales,id,meterNo:id,meterNoNormalized:id,master:{...f.sales.master,id}}));
 const draft=buildRetainedSalesDraft({source:{type:"PREPAID_SALES_NON_GPS"},scope:f.scope,selection:{reason:"Review"},rows,scopeKey:"A:ZA5241"},f.tbId);
 const live={ready:true,sales:Object.fromEntries(rows.map(row=>[row.id,row])),erfs:{ERF1:f.erf},wards:{ZA5241001:f.ward},fence:null,parent:null};
 for(const id of ids)draft.resolutions[id]={ready:true,proof:`PROOF-${id}`,expiresAt:2000,point:{latitude:-28.5,longitude:30.5},erfId:"ERF1",scope:f.scope};
 return {draft,live,ids};
}
test("one retained draft permits 1/30, rejects empty/31/duplicates; no automatic removal",()=>{
 assert.equal(fixture(30).draft.retainedIds.length,30);assert.throws(()=>fixture(0));assert.throws(()=>fixture(31));
 const {draft,live,ids}=fixture(2),before=JSON.stringify(draft);
 delete live.sales[ids[0]];live.sales[ids[1]].targetedBatchId="TGB_20260913_120001_AB12";
 const projected=projectSalesDraft(draft,live,{now:1000});assert.equal(projected.rows.length,2);assert.equal(projected.readyIds.length,0);
 assert.match(projected.rows[0].reason,/no longer available/);assert.equal(JSON.stringify(draft),before);
});
test("mixed retained Wards block Save/Create even when one meter is ineligible",()=>{
 const {draft,live,ids}=fixture(2);draft.resolutions[ids[1]].scope={...f.scope,wardPcode:"ZA5241002"};live.sales[ids[1]].targetedBatchId="TGB_20260913_120001_AB12";
 const result=projectSalesDraft(draft,live,{now:1000,geometry:f.ward.geometry});assert.equal(result.wards.length,2);assert.equal(Boolean(result.canSave),false);assert.equal(Boolean(result.canCreate),false);assert.match(result.gate,/multiple Wards/);
});
test("saved allowlist cannot grow; expiration/live failure/consumed fence block action",()=>{
 const {draft,live,ids}=fixture(2);draft.savedFence={id:`SALES_${draft.id}`,savedSalesIds:[ids[0]]};live.fence={id:draft.savedFence.id,linkState:"UNLINKED"};
 let result=projectSalesDraft(draft,live,{now:1000});assert.deepEqual(result.readyIds,[ids[0]]);assert.equal(Boolean(result.canCreate),true);assert.match(result.rows[1].reason,/saved population/);
 assert.equal(projectSalesDraft(draft,live,{now:2000}).readyIds.length,0);
 assert.equal(Boolean(projectSalesDraft(draft,{...live,ready:false},{now:1000}).canCreate),false);
 assert.equal(Boolean(projectSalesDraft(draft,{...live,fence:{...live.fence,linkState:"LINKED"}},{now:1000}).canCreate),false);
 assert.equal(Boolean(projectSalesDraft(draft,{...live,parent:{id:draft.id}},{now:1000}).canCreate),false);
});
test("confirmation identity observes retained rows and all live authorities; intent excludes commercial data",()=>{
 const {draft,live}=fixture(),initial=confirmationIdentity(draft,live),intent=salesDraftIntent(draft);
 assert.deepEqual(intent.salesIds,draft.retainedIds);assert.equal(Object.hasOwn(intent,"rows"),false);
 for(const key of ["sales","erfs","wards","fence","parent"]){const changed=structuredClone(live);changed[key]={changed:true};assert.notEqual(confirmationIdentity(draft,changed),initial);}
 assert.notEqual(confirmationIdentity({...draft,selection:{reason:"Changed"}},live),initial);
});
