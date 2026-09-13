import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {buildRetainedSalesDraft,projectSalesDraft,confirmationIdentity,salesDraftIntent,salesDraftResolutionFailure,salesDraftMessage,salesDraftReturnPath} from "./sales-batch-draft-model.js";
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
 const {draft,live,ids}=fixture(2);draft.savedFence={id:"ordinaryAutoFenceId1",status:"ACTIVE",targetedBatch:{tbId:draft.id,salesIds:[ids[0]],linkState:"UNLINKED"}};live.fence=draft.savedFence;
 let result=projectSalesDraft(draft,live,{now:1000});assert.deepEqual(result.readyIds,[ids[0]]);assert.equal(Boolean(result.canCreate),true);assert.match(result.rows[1].reason,/saved population/);
 assert.equal(projectSalesDraft(draft,live,{now:2000}).readyIds.length,0);
 assert.equal(Boolean(projectSalesDraft(draft,{...live,ready:false},{now:1000}).canCreate),false);
 assert.equal(Boolean(projectSalesDraft(draft,{...live,fence:{...live.fence,targetedBatch:{...live.fence.targetedBatch,linkState:"LINKED"}}},{now:1000}).canCreate),false);
 assert.equal(Boolean(projectSalesDraft(draft,{...live,parent:{id:draft.id}},{now:1000}).canCreate),false);
});
test("confirmation identity observes retained rows and all live authorities; intent excludes commercial data",()=>{
 const {draft,live}=fixture(),initial=confirmationIdentity(draft,live),intent=salesDraftIntent(draft);
 assert.deepEqual(intent.salesIds,draft.retainedIds);assert.equal(Object.hasOwn(intent,"rows"),false);
 for(const key of ["sales","erfs","wards","fence","parent"]){const changed=structuredClone(live);changed[key]={changed:true};assert.notEqual(confirmationIdentity(draft,changed),initial);}
 assert.notEqual(confirmationIdentity({...draft,selection:{reason:"Changed"}},live),initial);
});

test("undeployed, offline and blocked resolver calls have plain matching row states without changing Sales or the draft", () => {
 const {draft,live}=fixture(2); draft.resolutions={};
 const before=structuredClone({draft,live});
 for(const error of [
  {code:"functions/internal",error:"internal",uncertain:true},
  {code:"functions/not-found",error:"NOT FOUND",uncertain:true},
  {code:"functions/unavailable",error:"offline",uncertain:true},
  {code:"functions/deadline-exceeded",error:"timeout",uncertain:true},
  {code:"functions/internal",error:"internal"}, new TypeError("Failed to fetch"), {},
 ]) {
  const failure=salesDraftResolutionFailure(error,draft.source.type);
  assert.equal(failure.reason,"Couldn't locate meters right now. Your draft is unchanged. Press Locate meters again.");
  const result=projectSalesDraft(draft,live,{now:1000,resolutionsCurrent:false,resolutionFailure:failure,geometry:f.ward.geometry});
  assert.equal(result.rows.length,2); assert.deepEqual(result.readyIds,[]);
  assert.equal(Boolean(result.canSave),false); assert.equal(Boolean(result.canCreate),false);
  for(const row of result.rows) {
   assert.equal(row.ready,false); assert.equal(row.code,"RESOLUTION_SERVICE_UNAVAILABLE"); assert.equal(row.reason,failure.reason);
   assert.doesNotMatch(row.reason,/Sales data changed|Needs manual ERFing/);
   assert.equal(Object.hasOwn(row,"erfLookup"),false);
  }
  assert.deepEqual({draft,live},before);
 }
});
test("waiting, pending, unavailable and successful recheck remain distinct even after a prior success", () => {
 const {draft,live}=fixture();
 const failure=salesDraftResolutionFailure({code:"functions/internal"},draft.source.type);
 assert.match(projectSalesDraft(draft,live,{now:1000,resolutionsCurrent:false}).rows[0].reason,/Not located yet/);
 const pending=projectSalesDraft(draft,live,{now:1000,resolving:true,resolutionFailure:failure});
 assert.equal(pending.rows[0].code,"RESOLUTION_PENDING"); assert.equal(pending.rows[0].reason,"Locating meters…");
 assert.deepEqual(pending.readyIds,[]);
 const failed=projectSalesDraft(draft,live,{now:1000,resolutionFailure:failure});
 assert.equal(failed.rows[0].code,"RESOLUTION_SERVICE_UNAVAILABLE"); assert.deepEqual(failed.readyIds,[]);
 const recovered=projectSalesDraft(draft,live,{now:1000});
 assert.deepEqual(recovered.readyIds,draft.retainedIds); assert.equal(recovered.rows[0].reason,"Ready");
});
test("service errors retain genuine policy reasons and completed lookup outcomes", () => {
 const {draft,live,ids}=fixture(2);
 live.sales[ids[0]].targetedBatchId="TGB_20260913_120001_AB12";
 const policyReason=projectSalesDraft(draft,live,{now:1000}).rows[0].reason;
 const failure=salesDraftResolutionFailure({code:"functions/internal"},draft.source.type);
 assert.equal(projectSalesDraft(draft,live,{now:1000,resolutionFailure:failure}).rows[0].reason,policyReason);
 draft.resolutions[ids[1]]={ready:false,code:"NO_EXACT_POSITION",reason:"Needs manual ERFing — NO_EXACT_POSITION"};
 assert.equal(projectSalesDraft(draft,live,{now:1000}).rows[1].reason,"Needs manual ERFing — NO_EXACT_POSITION");
 const denied=salesDraftResolutionFailure({code:"ACTOR_SCOPE_INVALID",error:"Select the authorized LM."},draft.source.type);
 assert.deepEqual(denied,{code:"ACTOR_SCOPE_INVALID",reason:"Select the authorized LM."});
 assert.match(salesDraftResolutionFailure({code:"functions/internal"},"PREPAID_SALES").reason,/^Couldn't locate meters right now/);
});

test("TB Draft translates provider and policy messages without changing internal codes or source records", () => {
 const {draft,live,ids}=fixture();
 for(const message of ["Geocoding is unavailable; no failed-lookup flag was written", "Resolution is incomplete", "Sales data changed; resolution must be reassessed", "Coordinates and ERF must be resolved", "Verified geocoding evidence is required", "Targeted Batch reference integrity is unresolved", "Recheck resolution", "Geocoded position"]) {
  draft.resolutions[ids[0]]={ready:false,code:"RESOLUTION_INCOMPLETE",reason:message};
  const before=structuredClone(draft);
  const row=projectSalesDraft(draft,live,{now:1000}).rows[0];
  assert.doesNotMatch(row.reason,/resolv|resolution|geocod/i);
  assert.equal(row.code,"RESOLUTION_INCOMPLETE");assert.deepEqual(draft,before);
  assert.doesNotMatch(salesDraftMessage(message),/resolv|resolution|geocod/i);
 }
 assert.equal(projectSalesDraft(fixture().draft,fixture().live,{now:2000}).rows[0].reason,"Location check expired. Press Locate meters again.");
 assert.equal(salesDraftReturnPath("PREPAID_SALES_NON_GPS"),"/sales/non-gps-batch-planning");
 assert.equal(salesDraftReturnPath("PREPAID_SALES"),"/sales/table");
});
