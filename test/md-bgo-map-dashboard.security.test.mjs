import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertFails } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { subscribeMdBgoMapDashboard, mdBgoMapDashboardQueries } from "../src/redux/mdBgoMapDashboardStream.js";
import { mdBgoDashboardQueries } from "../src/redux/mdBgoDashboardStream.js";
import { buildMdBgoMapDashboard } from "../src/pages/operations/md-bgo/mdBgoMapDashboardModel.js";
let env;
const geometry={type:"Polygon",coordinates:[[[30,-29],[31,-29],[31,-28],[30,-28],[30,-29]]]};
const points=[{latitude:-29,longitude:30},{latitude:-29,longitude:31},{latitude:-28,longitude:31},{latitude:-28,longitude:30}];
before(async()=>{assert.ok(process.env.FIRESTORE_EMULATOR_HOST,"Emulator required");env=await initializeTestEnvironment({projectId:"demo-ireps-qa",firestore:{host:"127.0.0.1",port:8087,rules:await readFile(new URL("../firestore.rules",import.meta.url),"utf8")}})});
after(async()=>env?.cleanup());
beforeEach(async()=>{
 await env.clearFirestore();await env.withSecurityRulesDisabled(async context=>{const db=context.firestore();await Promise.all([
  setDoc(doc(db,"users/manager"),{accountStatus:"ACTIVE",employment:{role:"MNG"}}),setDoc(doc(db,"users/inactive"),{accountStatus:"DISABLED",employment:{role:"MNG"}}),
  setDoc(doc(db,"lms/LM"),{name:"Municipality",geometry:JSON.stringify(geometry)}),
  setDoc(doc(db,"wards/W001"),{pcode:"W001",code:1,parents:{localMunicipalityId:"LM"},geometry:JSON.stringify(geometry)}),
  setDoc(doc(db,"registry_wards/S001"),{localMunicipality:{pcode:"LM"},ward:{pcode:"W001"},calculation:{state:"READY"},counts:{totalErfs:10}}),
  setDoc(doc(db,"geo_fences/fence"),{name:"Fence",status:"ACTIVE",parents:{lmPcode:"LM",wardPcode:"W001"},geometry:{points}}),
  setDoc(doc(db,"ireps_erfs/E1"),{admin:{localMunicipality:{pcode:"LM"},ward:{pcode:"W001"}},centroid:{lat:-28.5,lng:30.5},geometry:"discarded polygon"}),
  setDoc(doc(db,"bgo_batches/batch"),{operationType:"METER_DISCOVERY",workflow:{state:"IN_PROGRESS"},scope:{lmPcode:"LM",wardPcode:"W001"},geofenceRef:{id:"fence"},worklist:{erfRefs:["E1"]}}),
  setDoc(doc(db,"bgo_rows/row"),{bgoBatchId:"batch",scope:{lmPcode:"LM",wardPcode:"W001"},erf:{id:"E1"},workflow:{state:"READY_FOR_ALLOCATION"}})
 ])});
});
function watch(uid="manager",lm="LM"){
 const values=[],waiters=[];const stop=subscribeMdBgoMapDashboard(env.authenticatedContext(uid).firestore(),lm,value=>{values.push(value);waiters.forEach(w=>{if(w.matches(value)){waiters.splice(waiters.indexOf(w),1);w.resolve(value)}})});
 const until=matches=>{const found=values.find(matches);if(found)return Promise.resolve(found);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("Map stream timed out")),12000);waiters.push({matches,resolve:value=>{clearTimeout(timer);resolve(value)}})})};return {stop,until,values};
}
test("production map subscriber receives all seven server-confirmed sources as active manager",async()=>{
 const s=watch();try{const value=await s.until(v=>v.ready);assert.equal(value.error,"");for(const key of ["batches","rows","wards","summaries","geofences","erfs"])assert.equal(value[key].length,1);assert.equal(value.lm.id,"LM");assert.equal(value.erfs[0].geometry,undefined);const m=buildMdBgoMapDashboard(value);assert.equal(m.lm.summary.erfs,10);assert.equal(m.fences[0].summary.erfs,1);assert.equal(m.fences[0].summary.batched,1)}finally{s.stop()}
});
test("live premise/meter work updates reach municipal, ward and geofence models without extra ERF coverage",async()=>{
 const s=watch();try{await s.until(v=>v.ready);await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),"bgo_rows/unitB"),{bgoBatchId:"batch",scope:{lmPcode:"LM",wardPcode:"W001"},erf:{id:"E1"},refs:{premiseId:"B"},workflow:{state:"IN_PROGRESS"}}));const m=buildMdBgoMapDashboard(await s.until(v=>v.ready&&v.rows.length===2));for(const a of [m.lm,m.wards[0],m.fences[0]]){assert.equal(a.summary.total,2);assert.equal(a.summary.premises,1);assert.equal(a.summary.batched,1)}await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),"bgo_rows/unitB"),{"refs.meterId":"M1","workflow.state":"COMPLETED"}));const done=buildMdBgoMapDashboard(await s.until(v=>v.ready&&v.rows.some(r=>r.refs?.meterId==="M1")));assert.equal(done.fences[0].summary.meters,1);assert.equal(done.fences[0].summary.completed,1)}finally{s.stop()}
});
test("centroid and geofence-boundary edits stream to coverage and source geometry",async()=>{
 const s=watch();try{await s.until(v=>v.ready);await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),"ireps_erfs/E1"),{centroid:{lat:-27,lng:32}}));assert.equal(buildMdBgoMapDashboard(await s.until(v=>v.ready&&v.erfs[0].centroid.lng===32)).fences[0].summary.erfs,0);
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),"geo_fences/fence"),{"geometry.points":[{latitude:-27.5,longitude:31.5},{latitude:-27.5,longitude:32.5},{latitude:-26.5,longitude:32.5},{latitude:-26.5,longitude:31.5}]}));assert.equal(buildMdBgoMapDashboard(await s.until(v=>v.ready&&v.geofences[0].geometry.points[0].longitude===31.5)).fences[0].summary.erfs,1);
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),"lms/LM"),{name:"Updated Municipality"}));assert.equal(buildMdBgoMapDashboard(await s.until(v=>v.ready&&v.lm.name==="Updated Municipality")).lm.name,"Updated Municipality");
 await env.withSecurityRulesDisabled(c=>deleteDoc(doc(c.firestore(),"geo_fences/fence")));assert.equal(buildMdBgoMapDashboard(await s.until(v=>v.ready&&!v.geofences.length)).fences.length,0)
 }finally{s.stop()}
});
test("all seven exact map queries deny inactive/anonymous clients and errors surface",async()=>{
 for(const db of [env.unauthenticatedContext().firestore(),env.authenticatedContext("inactive").firestore()])for(const q of Object.values({...mdBgoDashboardQueries(db,"LM"),...mdBgoMapDashboardQueries(db,"LM")}))await assertFails(q.type==="document"?getDoc(q):getDocs(q));
 const s=watch("inactive");try{const value=await s.until(v=>Boolean(v.error));assert.equal(value.ready,false);assert.match(value.error,/permission-denied/)}finally{s.stop()}
});
test("missing LM fails visibly and cleanup prevents subsequent publishes",async()=>{
 const missing=watch("manager","OTHER");try{const failure=await missing.until(v=>Boolean(v.error));assert.equal(failure.ready,false);assert.match(failure.error,/not found/)}finally{missing.stop()}
 const s=watch();await s.until(v=>v.ready);s.stop();const count=s.values.length;await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),"lms/LM"),{name:"After cleanup"}));await new Promise(r=>setTimeout(r,100));assert.equal(s.values.length,count);
});

