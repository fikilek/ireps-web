import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {initializeTestEnvironment,assertSucceeds,assertFails} from "@firebase/rules-unit-testing";
import {doc,setDoc,getDoc,query,collection,where,getDocs,onSnapshot,updateDoc} from "firebase/firestore";
test("actual authorized TC/source queries stream initial and later changes and deny foreign scope/mutation",{skip:!process.env.FIRESTORE_EMULATOR_HOST},async t=>{
 const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(":");
 const env=await initializeTestEnvironment({projectId:"demo-trn-bgo-rules",firestore:{host,port:Number(port),rules:readFileSync(new URL("../firestore.rules",import.meta.url),"utf8")}});t.after(()=>env.cleanup());
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();await Promise.all([
   setDoc(doc(db,"users/M"),{accountStatus:"ACTIVE",employment:{role:"MNG"},access:{workbases:[{id:"LM1",name:"Municipality One"}],activeWorkbase:{id:"LM2",name:"Municipality Two"}}}),
   setDoc(doc(db,"users/X"),{accountStatus:"ACTIVE",employment:{role:"MNG"},access:{workbases:["LM2"]}}),
   setDoc(doc(db,"users/F"),{accountStatus:"ACTIVE",employment:{role:"FWR",serviceProvider:{id:"SP1"}},access:{workbases:[{id:"LM1",name:"Municipality One"}],activeWorkbase:{id:"LM1",name:"Municipality One",geometry:{type:"Polygon"}}}}),
   setDoc(doc(db,"lms/LM1"),{name:"Municipality One"}),
   setDoc(doc(db,"teams/T1"),{scope:{memberUserIds:["F"]}}),
   setDoc(doc(db,"tc_uploads/B1"),{lmPcode:"LM1",totalRows:2,bgo:{targetType:"TEAM",targetId:"T1"},metadata:{createdAt:"2026-11-13"}}),
   setDoc(doc(db,"tc_rows/R1"),{tcId:"B1",input:{meterNo:"000123"}}),
   setDoc(doc(db,"tc_source_files/S1"),{committed:true,lmPcode:"LM1",headers:["rowNo","meterNo"]}),
   setDoc(doc(db,"tc_source_files/PENDING"),{committed:false,lmPcode:"LM1"})]);
 });
 const manager=env.authenticatedContext("M").firestore(),field=env.authenticatedContext("F").firestore(),foreign=env.authenticatedContext("X").firestore();
 await assertSucceeds(getDocs(query(collection(manager,"tc_uploads"),where("lmPcode","==","LM1"))));
 await assertSucceeds(getDocs(query(collection(field,"tc_uploads"),where("lmPcode","==","LM1"),where("bgo.targetId","==","T1"),where("bgo.targetType","==","TEAM"))));
 await assertSucceeds(getDocs(query(collection(manager,"tc_rows"),where("tcId","==","B1"))));
 await assertSucceeds(getDoc(doc(field,"tc_rows/R1")));await assertSucceeds(getDoc(doc(manager,"tc_source_files/S1")));
 await assertFails(getDoc(doc(foreign,"tc_uploads/B1")));await assertFails(getDoc(doc(foreign,"tc_source_files/S1")));await assertFails(getDoc(doc(manager,"tc_source_files/PENDING")));await assertFails(setDoc(doc(manager,"tc_uploads/B2"),{lmPcode:"LM1"}));await assertFails(setDoc(doc(manager,"tc_source_files/S1"),{committed:true}));
 await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),"tc_uploads/B1")));
 let stop;const changes=[];
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("stream did not receive update")),10000);stop=onSnapshot(query(collection(manager,"tc_uploads"),where("lmPcode","==","LM1")),snapshot=>{
  const count=snapshot.docs.find(d=>d.id==="B1")?.data().totalRows;changes.push(count);
  if(count===2)env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),"tc_uploads/B1"),{totalRows:3})).catch(reject);
  if(count===3){clearTimeout(timer);resolve();}
 },reject);});stop();assert.ok(changes.includes(2)&&changes.includes(3));
});
