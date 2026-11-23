import { FieldValue } from "firebase-admin/firestore";
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
  if(childIds.length>80)denied(`Selected Ward batches contain ${childIds.length} meters. Maximum per allocation action is 80.`);
  if(!childIds.length||new Set(childIds).size!==childIds.length)denied("Batch membership is empty or duplicated.");
  const childSnapshots=await tx.getAll(...childIds.map(id=>db.doc(`trns/${id}`)));
  const byId=new Map(childSnapshots.map(snap=>[snap.id,snap]));
  const children=[]; const notices=[];
  for(const parent of parents) {
   const p=parent.data();
   const isReallocate=data.targetType!=="UNALLOCATE"&&["ISSUED","ACCEPTED"].includes(p.workflow?.state);
   if(data.targetType==="UNALLOCATE") {
    if(!["ISSUED","ACCEPTED"].includes(p.workflow?.state))denied("Batch has no active allocation.");
    if(p.workflow?.issuedByUid!==uid&&actor.role!=="MNG")denied("Only the allocator or manager may unallocate this batch.");
    notices.push(...(await tx.get(db.collection("notifications").where("bgo.batchId","==",parent.id))).docs);
    if(!text(data.reason))denied("Record why this allocation is being withdrawn.");
    if(!data.expectedIssuedAt||data.expectedIssuedAt!==p.workflow.issuedAt)denied("Allocation changed. Reopen the current batch.");
   } else if(isReallocate) {
    if(Number(p.progress?.inProgress||0)>0||Number(p.progress?.completed||0)>0)denied("Field work has already started; this batch cannot be re-allocated.");
    notices.push(...(await tx.get(db.collection("notifications").where("bgo.batchId","==",parent.id))).docs);
   } else if(p.workflow?.state!=="READY_FOR_ALLOCATION"||p.assignment?.targets?.length)denied("Batch is not ready for allocation.");
   const snaps=(p.trnIds||[]).map(id=>byId.get(id));
   if(!snaps.length||snaps.some(s=>!s.exists||s.data().origin?.trnBgo?.batchId!==parent.id))denied("Batch membership is incomplete.");
   for(const child of snaps) {
    const trn=child.data();
    const trnState=trn.workflow?.state;
    if(isReallocate) {
     if(!["CREATED","ISSUED","ACCEPTED"].includes(trnState)||trn.workflow?.executionStartedAt||trn.workflow?.completedAt||trn.accessData?.access?.hasAccess==="no"||Number(trn.noAccessCount||0)>0) {
      denied("Field work has already started; this batch cannot be re-allocated.");
     }
     if(trnState!=="CREATED") {
      const cancelMove=canMoveAs(trnState,"cancel",actor.role);
      if(!cancelMove.ok)denied(cancelMove.message||"Field work has already started; this batch cannot be re-allocated.");
     }
     const allocMove=canMoveAs("CREATED","allocate",actor.role);
     if(!allocMove.ok)denied(allocMove.message||"Batch is not ready for allocation.");
     children.push({child,trn,to:allocMove.to});
    } else if (!target && trnState === "CREATED") {
     if(trn.workflow?.completedAt||trn.accessData?.access?.hasAccess==="no")denied("Field execution has already occurred.");
     children.push({child,trn,to:"CREATED",skipChildWrite:true});
    } else {
     const move=canMoveAs(trnState,target?"allocate":"cancel",actor.role);
     if(!move.ok || (!target&&(trn.workflow?.completedAt||trn.accessData?.access?.hasAccess==="no")))denied(move.message||"Field execution has already occurred.");
     children.push({child,trn,to:move.to});
    }
   }
  }
  const noticesToWrite=notices.filter(notice=>{const n=notice.data();return n.type==="BGO_BATCH_ISSUED"&&n.delivery?.status!=="DELIVERED"&&!n.delivery?.deliveredAt;});
  const childrenToWrite=children.filter(c=>!c.skipChildWrite);
  const plannedWrites=noticesToWrite.length+childrenToWrite.length*3+parents.length*(target?3:2);
  if(plannedWrites>500)denied(`Allocation requires ${plannedWrites} atomic writes (limit 500). Select fewer batches or meters.`);
  for (const notice of noticesToWrite) {
   tx.update(notice.ref,{"delivery.status":"CANCELLED","delivery.cancelledAt":now,"delivery.cancelledByUid":uid,"delivery.cancelReason":"TRN BGO batch unallocated"});
  }
  for(const {child,trn,to,skipChildWrite} of children) {
   if(skipChildWrite)continue;
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
export function explainChildDecisionBlocker(snap, batchId, action, role) {
  const t = snap.data();
  if (!t) return "One or more jobs in this batch no longer exist.";
  if (t.origin?.trnBgo?.batchId !== batchId) return "One or more jobs no longer belong to this batch.";
  const move = canMoveAs(t.workflow?.state, action === "ACCEPT" ? "accept" : "reject", role);
  if (move.ok) return null;
  if (t.workflow?.state === "CREATED" && t.workflow?.expiredAt) {
    return "This batch expired because it was not accepted within 72 hours. Ask the office to re-allocate it.";
  }
  return `Cannot ${action.toLowerCase()} batch: job ${snap.id} is currently ${t.workflow?.state || "UNKNOWN"}.`;
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
  for(const snap of children){const blocker=explainChildDecisionBlocker(snap,id,data.action,user.employment.role);if(blocker)denied(blocker);}
  for(const snap of children){const t=snap.data(),state=data.action==="ACCEPT"?"ACCEPTED":"CREATED";
   tx.update(snap.ref,{"workflow.state":state,"workflow.acceptedAt":state==="ACCEPTED"?now:null,"assignment.acceptedRejectedAt":now,"assignment.acceptedRejectedUid":uid,"assignment.targets":state==="ACCEPTED"?[target]:[],"metadata.updatedAt":now});
   tx.update(db.doc(`asts/${t.ast.astData.astId}`),{trnActiveLifecycle:buildTrnActiveLifecycle({trnId:snap.id,trnType:t.accessData.trnType,workflowState:state,assignedTo:state==="ACCEPTED"?target:{},updatedAt:now,updatedByUser:uid})});
   tx.create(snap.ref.collection("history").doc(),{event:data.action,workflowState:state,at:now,actorUid:uid,reason:data.rejectReason||null});
  }
  tx.update(parent.ref,{"workflow.state":expected,"workflow.acceptedAt":data.action==="ACCEPT"?now:null,"workflow.issuedAt":data.action==="ACCEPT"?p.workflow?.issuedAt||null:null,"workflow.issuedByUid":data.action==="ACCEPT"?p.workflow?.issuedByUid||null:null,"bgo.releaseState":data.action==="ACCEPT"?"RELEASED_TO_EXECUTION":null,"assignment.targets":data.action==="ACCEPT"?[target]:[],"bgo.targetId":data.action==="ACCEPT"?target.id:null,"bgo.targetType":data.action==="ACCEPT"?target.type||null:null,"bgo.targetName":data.action==="ACCEPT"?target.name||null:null,bgoStatus:data.action==="ACCEPT"?"ALLOCATED":"READY_FOR_ALLOCATION",allocatedTo:data.action==="ACCEPT"?target.name||null:null,allocatedAt:data.action==="ACCEPT"?p.allocatedAt||now:null,"metadata.updatedAt":now});
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
  const astRefs=children.map(snap=>db.doc(`asts/${snap.data().ast.astData.astId}`));
  const astSnaps=astRefs.length?await tx.getAll(...astRefs):[];
  const astById=new Map(astSnaps.map(s=>[s.id,s]));
  for(const snap of children){const trn=snap.data();const astId=trn.ast.astData.astId;const astSnap=astById.get(astId);tx.update(snap.ref,{"workflow.state":"DELETED","metadata.updatedAt":now});if(astSnap?.exists&&astSnap.data()?.trnActiveLifecycle?.trnId===snap.id){tx.update(astSnap.ref,{trnActiveLifecycle:FieldValue.delete(),"metadata.updatedAt":now,"metadata.updatedByUid":actor.uid,"metadata.updatedByUser":actor.name});}tx.create(snap.ref.collection("history").doc(),{event:"DELETED",at:now,actorUid:actor.uid});}
  tx.update(parent.ref,{"workflow.state":"DELETED",bgoStatus:"DELETED","metadata.updatedAt":now});tx.create(parent.ref.collection("history").doc(),{event:"DELETED",at:now,actorUid:actor.uid});
  return {success:true,tcId:id,message:"Ward batch and its unassigned transactions moved to Deleted. Original source retained."};
 });
}
