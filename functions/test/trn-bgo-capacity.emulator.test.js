import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { buildLifecycleInstructionTrnPayload, buildTrnActiveLifecycle } from "../meterLifecycle/helpers.js";
import { stripToDeclaredRoot } from "../transactions/trnShape.js";

const types = ["METER_DISCONNECTION", "METER_RECONNECTION", "METER_INSPECTION", "METER_REMOVAL", "METER_READING"];
test("200-meter / 200-Ward canonical graphs commit atomically beyond the removed 300-write ceiling", {skip: !process.env.FIRESTORE_EMULATOR_HOST}, async t => {
  assert.match(process.env.GCLOUD_PROJECT || "", /^demo-/);
  const app=initializeApp({projectId:process.env.GCLOUD_PROJECT}, `capacity-${Date.now()}`);
  t.after(()=>deleteApp(app)); const db=getFirestore(app); const now=new Date().toISOString();
  for (const type of types) await t.test(type, async()=>{
    const prefix=`capacity_${type}_${Date.now()}`; const writes=[];
    for(let i=0;i<200;i++) {
      const astId=`${prefix}_A${i}`, id=`${prefix}_T${i}`, batchId=`${prefix}_B${i}`, ward=`ZA5241${String(i).padStart(3,"0")}`;
      const ast={meterType:"electricity",accessData:{parents:{lmPcode:"ZA5241",wardPcode:ward},premise:{id:`P${i}`}},ast:{astData:{astId,astNo:`00${i}`,meter:{type:"conventional"}}},status:{state:type==="METER_RECONNECTION"?"DISCONNECTED":"CONNECTED"}};
      const trn=buildLifecycleInstructionTrnPayload({data:{id,astId,premiseId:`P${i}`,trnType:type,assignment:{instruction:{code:type}},origin:{channel:"OFFICE",source:"TRN_BGO"}},astDoc:ast,premiseData:{id:`P${i}`},now,actorUid:"U1",actorName:"Manager",allocating:false});
      stripToDeclaredRoot(trn);
      delete trn.assignment.instruction.reason;
      const marker=buildTrnActiveLifecycle({trnId:id,trnType:type,workflowState:"CREATED",assignedTo:{},updatedAt:now,updatedByUser:"Manager"});
      writes.push([`tc_uploads/${batchId}`,{id:batchId,trnType:type,wardPcode:ward,totalRows:1,trnIds:[id],metadata:trn.metadata}], [`tc_rows/${batchId}_R${String(i+1).padStart(6,"0")}`,{tcId:batchId,rowNo:i+1,meterNo:`00${i}`,trnId:id,astId}], [`trns/${id}`,trn], [`asts/${astId}`,{...ast,trnActiveLifecycle:marker}], [`trns/${id}/history/CREATED`,{event:"CREATED",workflowState:"CREATED",actorUid:"U1",at:now}], [`tc_uploads/${batchId}/history/CREATED`,{event:"CREATED",at:now}]);
    }
    const receipt=db.doc(`tc_upload_dedupe/${prefix}`);
    const bytes=Buffer.byteLength(JSON.stringify(writes));
    assert.ok(bytes<10*1024*1024);
    await db.runTransaction(async tx=>{assert.equal((await tx.get(receipt)).exists,false); for(const [path,data] of writes)tx.create(db.doc(path),data);tx.create(receipt,{complete:true,count:200,writeCount:writes.length+1});});
    assert.equal((await receipt.get()).data().writeCount,1201);
    assert.ok((await db.doc(writes.at(-1)[0]).get()).exists);
    const absent=db.doc(`tc_uploads/${prefix}_must_not_exist`);
    await assert.rejects(db.runTransaction(async tx=>{await tx.get(receipt);tx.create(absent,{partial:true});tx.create(receipt,{overwrite:true});}));
    assert.equal((await absent.get()).exists,false);
    t.diagnostic(`${type}: ${writes.length+1} writes, ${bytes} JSON payload bytes; emulator capacity only, hosted capacity still requires release verification.`);
  });
});

