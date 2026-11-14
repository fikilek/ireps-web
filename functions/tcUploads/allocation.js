import { buildBmdBgoNotificationRecord } from "../bgo/trnFactory.js";
import { HttpsError } from "firebase-functions/v2/https";
import { bulkAuthority, text, BULK_CONTRACT } from "./stage2Core.js";
import { readMdAllocationTarget } from "../bgo/mdAllocationPolicy.js";
import { isActorAllowedForBgoTarget } from "../bgo/acceptanceCallable.js";
import { canMoveAs } from "../meterLifecycle/trnStateMachine.js";
import { buildTrnActiveLifecycle } from "../meterLifecycle/helpers.js";
const denied=message=>{throw new HttpsError("failed-precondition",message);};
export async function allocateTcBatches({db,request}) {
 const uid=request.auth?.uid,data=request.data||{};
 const ids=data.batchIds||[];if(!ids.length||ids.length>15||new Set(ids).size!==ids.length||ids.some(id=>!id||String(id).includes("/")))denied("Select between 1 and 15 distinct Ward batches.");
 if(!["TEAM","SP","UNALLOCATE"].includes(data.targetType))denied("Select TEAM or SP.");
 const now=new Date().toISOString();
 return db.runTransaction(async tx=>{
  const parents=await tx.getAll(...ids.map(id=>db.doc(`tc_uploads/${id}`)));
  if(parents.some(p=>!p.exists||p.data().contractVersion!==BULK_CONTRACT))denied("Only current Ward batches can use this allocation operation.");
  const lm=parents[0].data().lmPcode;if(parents.some(p=>p.data().lmPcode!==lm))denied("Allocate within one municipality.");
  const actor=await bulkAuthority({db,reader:tx,uid,lmPcode:lm});
  if(!actor.providerId)denied("Your account has no Managing Contractor provider.");
  let target=null;
  if(data.targetType!=="UNALLOCATE") {
   if(!text(data.targetId))denied("Select an active TEAM or SP.");
   target=await readMdAllocationTarget({db,transaction:tx,targetType:data.targetType,targetId:data.targetId,actorMncId:actor.providerId});
  }
  const childIds=parents.flatMap(parent=>parent.data().trnIds||[]);
  if(childIds.length>200)denied(`Selected Ward batches contain ${childIds.length} meters. Maximum per allocation action is 200.`);
  if(!childIds.length||new Set(childIds).size!==childIds.length)denied("Batch membership is empty or duplicated.");
  const childSnapshots=await tx.getAll(...childIds.map(id=>db.doc(`trns/${id}`)));
  const byId=new Map(childSnapshots.map(snap=>[snap.id,snap]));
  const children=[]; const notices=[];
  for(const parent of parents) {
   const p=parent.data();
   if(data.targetType==="UNALLOCATE") {
    if(!["ISSUED","ACCEPTED"].includes(p.workflow?.state))denied("Batch has no active allocation.");
    if(p.workflow?.issuedByUid!==uid&&actor.role!=="MNG")denied("Only the allocator or manager may unallocate this batch.");
    notices.push(...(await tx.get(db.collection("notifications").where("bgo.batchId","==",parent.id))).docs);
    if(!text(data.reason))denied("Record why this allocation is being withdrawn.");
    if(!data.expectedIssuedAt||data.expectedIssuedAt!==p.workflow.issuedAt)denied("Allocation changed. Reopen the current batch.");
   } else if(p.workflow?.state!=="READY_FOR_ALLOCATION"||p.assignment?.targets?.length)denied("Batch is not ready for allocation.");
   const snaps=(p.trnIds||[]).map(id=>byId.get(id));
   if(!snaps.length||snaps.some(s=>!s.exists||s.data().origin?.trnBgo?.batchId!==parent.id))denied("Batch membership is incomplete.");
   for(const child of snaps) {
    const trn=child.data();const move=canMoveAs(trn.workflow?.state,target?"allocate":"cancel",actor.role);
    if(!move.ok || (!target&&(trn.workflow?.completedAt||trn.accessData?.access?.hasAccess==="no")))denied(move.message||"Field execution has already occurred.");
    children.push({child,trn,to:move.to});
   }
  }
  for (const notice of notices) {
   const n=notice.data();
   if(n.type==="BGO_BATCH_ISSUED"&&n.delivery?.status!=="DELIVERED"&&!n.delivery?.deliveredAt)tx.update(notice.ref,{"delivery.status":"CANCELLED","delivery.cancelledAt":now,"delivery.cancelledByUid":uid,"delivery.cancelReason":"TRN BGO batch unallocated"});
  }
  for(const {child,trn,to} of children) {
   tx.update(child.ref,{"workflow.state":to,"workflow.issuedAt":target?now:null,"workflow.issuedByUid":target?uid:null,"workflow.acceptedAt":null,"assignment.acceptedRejectedAt":null,"assignment.acceptedRejectedUid":null,"assignment.targets":target?[target]:[],"metadata.updatedAt":now,"metadata.updatedByUid":uid,"metadata.updatedByUser":actor.name});
   tx.update(db.doc(`asts/${trn.ast.astData.astId}`),{trnActiveLifecycle:buildTrnActiveLifecycle({trnId:child.id,trnType:trn.accessData.trnType,workflowState:to,assignedTo:target||{},updatedAt:now,updatedByUser:actor.name})});
   tx.create(child.ref.collection("history").doc(),{event:target?"ISSUED":"CANCELLED",workflowState:to,at:now,actorUid:uid,actorName:actor.name,reason:data.reason||null});
  }
  for(const parent of parents) {
   const p=parent.data();
   tx.update(parent.ref,{"workflow.state":target?"ISSUED":"READY_FOR_ALLOCATION","workflow.issuedAt":target?now:null,"workflow.issuedByUid":target?uid:null,"workflow.acceptedAt":null,"assignment.acceptedRejectedAt":null,"assignment.acceptedRejectedUid":null,"assignment.targets":target?[target]:[],"bgo.targetId":target?.id||null,"bgo.targetType":target?.type||null,"bgo.targetName":target?.name||null,"bgo.releaseState":target?"WAITING_BATCH_ACCEPTANCE":null,bgoStatus:target?"ALLOCATED":"READY_FOR_ALLOCATION",allocatedTo:target?.name||null,allocatedAt:target?now:null,"metadata.updatedAt":now});
   tx.create(parent.ref.collection("history").doc(),{event:target?"ISSUED":"CANCELLED",at:now,actorUid:uid,reason:data.reason||null});
   if(target) {
    const notice=buildBmdBgoNotificationRecord({bgoBatchId:parent.id,target,geofenceRef:{id:p.wardPcode,name:p.wardName||p.wardPcode},summary:{meterCount:p.totalRows},actorUid:uid,actorName:actor.name,now});
    notice.type="BGO_BATCH_ISSUED";notice.bgo.batchMode="TRN";notice.bgo.trnType=p.trnType;notice.message={title:"New TRN BGO batch issued",body:`${p.totalRows} meter transactions in ${p.wardName||p.wardPcode} issued to ${target.name}.`};
    tx.create(db.collection("notifications").doc(),notice);
   }
  }
  return {success:true,code:target?"TRN_BGO_BATCHES_ALLOCATED":"TRN_BGO_BATCHES_UNALLOCATED",batchIds:ids,target,message:target?"Ward batches allocated.":"Ward batches unallocated."};
 });
}
export async function decideTcBatch({db,request}) {
 const uid=request.auth?.uid,data=request.data||{},id=text(data.batchId||data.id);
 if(!uid||!id||id.includes("/")||!["ACCEPT","REJECT"].includes(data.action))denied("Invalid batch decision.");
 const now=new Date().toISOString();
 return db.runTransaction(async tx=>{
  const parent=await tx.get(db.doc(`tc_uploads/${id}`));const p=parent.data();
  const user=(await tx.get(db.doc(`users/${uid}`))).data()||{};
  if(!p||p.contractVersion!==BULK_CONTRACT||user.accountStatus!=="ACTIVE"||!["FWR","SPV"].includes(user.employment?.role))denied("Batch decision is not authorized.");
  const grants=[user.access?.activeWorkbase,...(user.access?.workbases||[])].map(value=>typeof value==="string"?value:value?.pcode||value?.id||value?.lmPcode);
  if(!grants.includes(p.lmPcode))denied("This municipality is not assigned to your account.");
  const target=p.assignment?.targets?.[0];
  if(!target||!["TEAM","SP"].includes(target.type))denied("Batch has no valid target.");
  const currentTarget=(await tx.get(db.collection(target.type==="TEAM"?"teams":"serviceProviders").doc(target.id))).data();
  if(!currentTarget||String(currentTarget.team?.status||currentTarget.status||currentTarget.lifecycleStatus).toUpperCase()!=="ACTIVE")denied("The allocated target is no longer active.");
  const readDb={collection:name=>({doc:key=>({get:()=>tx.get(db.collection(name).doc(key))})})};
  if(!await isActorAllowedForBgoTarget({db:readDb,actor:{uid,spId:user.employment?.serviceProvider?.id},target}))denied("This batch belongs to another TEAM or SP.");
  const expected=data.action==="ACCEPT"?"ACCEPTED":"READY_FOR_ALLOCATION";
  if(p.workflow?.state===expected)return {success:true,batchId:id,message:"Batch decision already recorded."};
  if(p.workflow?.state!=="ISSUED")denied("Batch is not awaiting acceptance.");
  if(data.action==="REJECT"&&!text(data.rejectReason))denied("Record why the batch was rejected.");
  const children=await Promise.all(p.trnIds.map(id=>tx.get(db.doc(`trns/${id}`))));
  for(const snap of children){const t=snap.data();if(!t||t.origin?.trnBgo?.batchId!==id||!canMoveAs(t.workflow?.state,data.action==="ACCEPT"?"accept":"reject",user.employment.role).ok)denied("One or more children cannot take this decision.");}
  for(const snap of children){const t=snap.data(),state=data.action==="ACCEPT"?"ACCEPTED":"CREATED";
   tx.update(snap.ref,{"workflow.state":state,"workflow.acceptedAt":state==="ACCEPTED"?now:null,"assignment.acceptedRejectedAt":now,"assignment.acceptedRejectedUid":uid,"assignment.targets":state==="ACCEPTED"?[target]:[],"metadata.updatedAt":now});
   tx.update(db.doc(`asts/${t.ast.astData.astId}`),{trnActiveLifecycle:buildTrnActiveLifecycle({trnId:snap.id,trnType:t.accessData.trnType,workflowState:state,assignedTo:state==="ACCEPTED"?target:{},updatedAt:now,updatedByUser:uid})});
   tx.create(snap.ref.collection("history").doc(),{event:data.action,workflowState:state,at:now,actorUid:uid,reason:data.rejectReason||null});
  }
  tx.update(parent.ref,{"workflow.state":expected,"workflow.acceptedAt":data.action==="ACCEPT"?now:null,"bgo.releaseState":data.action==="ACCEPT"?"RELEASED_TO_EXECUTION":null,"assignment.targets":data.action==="ACCEPT"?[target]:[],"bgo.targetId":data.action==="ACCEPT"?target.id:null,bgoStatus:data.action==="ACCEPT"?"ALLOCATED":"READY_FOR_ALLOCATION","metadata.updatedAt":now});
  tx.create(parent.ref.collection("history").doc(),{event:data.action,at:now,actorUid:uid,reason:data.rejectReason||null});
  return {success:true,batchId:id,message:data.action==="ACCEPT"?"Batch accepted.":"Batch rejected."};
 });
}

export async function deleteModernTc({db,request}) {
 const id=text(request.data?.tcId);if(!id||id.includes("/"))denied("Invalid Ward batch.");const now=new Date().toISOString();
 return db.runTransaction(async tx=>{
  const parent=await tx.get(db.doc(`tc_uploads/${id}`));const p=parent.data();if(!p||p.contractVersion!==BULK_CONTRACT)denied("Current Ward batch is required.");
  const actor=await bulkAuthority({db,reader:tx,uid:request.auth?.uid,lmPcode:p.lmPcode});
  if(p.workflow?.state==="DELETED")return {success:true,tcId:id,message:"Batch already deleted."};
  const children=await Promise.all(p.trnIds.map(id=>tx.get(db.doc(`trns/${id}`))));
  for(const snap of children)if(!snap.exists||!canMoveAs(snap.data().workflow?.state,"delete",actor.role).ok)denied("Only unassigned, unexecuted jobs may be deleted.");
  for(const snap of children){const trn=snap.data();tx.update(snap.ref,{"workflow.state":"DELETED","metadata.updatedAt":now});tx.update(db.doc(`asts/${trn.ast.astData.astId}`),{trnActiveLifecycle:buildTrnActiveLifecycle({trnId:snap.id,trnType:trn.accessData.trnType,workflowState:"DELETED",assignedTo:{},updatedAt:now,updatedByUser:actor.name})});tx.create(snap.ref.collection("history").doc(),{event:"DELETED",at:now,actorUid:actor.uid});}
  tx.update(parent.ref,{"workflow.state":"DELETED",bgoStatus:"DELETED","metadata.updatedAt":now});tx.create(parent.ref.collection("history").doc(),{event:"DELETED",at:now,actorUid:actor.uid});
  return {success:true,tcId:id,message:"Ward batch and its unassigned transactions moved to Deleted. Original source retained."};
 });
}
