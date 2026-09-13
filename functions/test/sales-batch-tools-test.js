import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {assessNoAccessEvidence} from "../scripts/tools/targeted-batches/verifySalesTargetedBatchNoAccessReadonly.js";
const entries=["scripts/tools/endumeni-reset/fast-dev-reset.js","scripts/tools/endumeni-reset/endumeni-reset.js","scripts/tools/targeted-batches/02_delete_batches_and_clean_demo_sales_dev.js","tools/targetedBatches/repairTargetedBatchErfRefs.js"];
for(const entry of entries)for(const flags of [[],["apply","--apply","--historical-dev-inventory","--project-id","ireps2","--service-account","does-not-exist.json"]])test(`retired entry fails before credential access: ${entry} ${flags.length?"bypass flags":"normal"}`,()=>{
 const result=spawnSync(process.execPath,[fileURLToPath(new URL(`../${entry}`,import.meta.url)),...flags],{encoding:"utf8",timeout:10000,env:{...process.env,GOOGLE_APPLICATION_CREDENTIALS:"does-not-exist.json"}});
 assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/MAINTENANCE_RETIRED/);assert.doesNotMatch(result.stdout+result.stderr,/ENOENT|default credentials|ENOTFOUND/);
});
const stamp={seconds:1,nanoseconds:0},tbId="TGB_20260913_120000_AB12";
const fixture=()=>({parent:{id:tbId,execution:{status:"IN_PROGRESS"}},row:{id:"ROW1",tbId,salesAllMeterId:"00123",execution:{status:"IN_PROGRESS"},refs:{erfId:"ERF1",premiseId:null}},sales:{targetedBatchId:tbId,tbRefs:[{id:tbId,date:stamp,rowId:"ROW1",fieldWork:{status:"IN_PROGRESS",updatedAt:stamp,noAccess:[{date:"2026-09-13",time:"10:00:00",user:"FWR"}]}}]},history:{eventType:"BATCHED",tbId,salesId:"00123"},fence:{status:"ACTIVE",targetedBatch:{linkState:"LINKED",tbId}},visits:[{targetedBatchContext:{tbId,rowId:"ROW1",salesDocId:"00123",erfId:"ERF1"},accessData:{access:{hasAccess:"no",reason:"Locked gate"}},location:{gps:{lat:-28.5,lng:30.5}},capturedAt:stamp,media:[{tag:"noAccessPhoto",url:"gs://mock/photo.jpg"}]}],expectedVisits:1});
test("canonical readonly verification needs actual photo, numeric GPS, reason and exact variable counts",()=>{
 const good=fixture();assert.equal(assessNoAccessEvidence(good).passed,true);
 for(const mutate of [f=>f.visits[0].location.gps.lat=null,f=>f.visits[0].media[0].url="",f=>f.visits[0].accessData.access.reason="",f=>f.expectedVisits=2,f=>f.history=null,f=>f.fence.targetedBatch.linkState="UNLINKED",f=>f.row.refs.premiseId="MISSING"]){const value=fixture();mutate(value);assert.equal(assessNoAccessEvidence(value).passed,false);}
 const legacy=assessNoAccessEvidence({...fixture(),historical:true,history:null,fence:null});assert.equal(legacy.canonicalApproval,false);assert.equal(legacy.executableApproval,false);
 assert.throws(()=>assessNoAccessEvidence({...fixture(),parent:{...good.parent,schemaVersion:"0.3.0"},historical:true}),/cannot approve canonical/);
});
