import { createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { OFFICIAL_HEADERS, validateSourceRows, resolveDuplicates, meterKey } from "./stage1Validation.js";
import { parseCsv } from "./sourceCsv.js";
import { validateStage1Upload } from "./stage1Matching.js";
import { checkMeterRegistration } from "../meterLifecycle/registrationGuard.js";
import { buildLifecycleInstructionTrnPayload, buildTrnActiveLifecycle, validateLifecycleInstructionEligibility } from "../meterLifecycle/helpers.js";
import { stripToDeclaredRoot } from "../transactions/trnShape.js";
import { TC_TRN_TYPE_TO_CODE, buildTcUploadId, buildTcRowId, getEligibilityResult, normalizeGeoFenceRefs, getAstSummary } from "./helpers.js";
import { STATES_HOLDING_THE_METER } from "../meterLifecycle/trnStateMachine.js";

export const BULK_CONTRACT = "TRN_BGO_11COL_REASON_FREE_V1";
export const text = value => String(value ?? "").trim();
export const digest = value => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
const fail = (code,message) => { throw new HttpsError(code,message); };
const pcode = value => typeof value === "string" ? value : value?.lmPcode || value?.pcode || value?.id || "";
export async function bulkAuthority({db,reader,uid,lmPcode,write=true}) {
  if (!uid) fail("unauthenticated","Sign in to use TRN BGO.");
  const read=ref=>reader?reader.get(ref):ref.get();
  const snap=await read(db.doc(`users/${uid}`)); const profile=snap.data()||{}; const role=profile.employment?.role;
  const grants=[profile.access?.activeWorkbase,...(profile.access?.workbases||[])].map(pcode);
  if(profile.accountStatus!=="ACTIVE" || !grants.includes(lmPcode) || !(write?["MNG","SPV"]:["SPU","ADM","MNG","SPV"]).includes(role)) fail("permission-denied","An active authorized office account and municipality are required.");
  const providerId=text(profile.employment?.serviceProvider?.id);
  if(write && role==="SPV") {
    if(!providerId) fail("permission-denied","Municipal Managing Contractor relationship is required.");
    const provider=(await read(db.doc(`serviceProviders/${providerId}`))).data()||{};
    if(provider.status!=="ACTIVE" || !(provider.clients||[]).some(c=>c.clientType==="LM"&&c.relationshipType==="MNC"&&c.id===lmPcode)) fail("permission-denied","Only the municipal Managing Contractor may originate this work.");
  }
  return {uid,profile,role,providerId,name:profile.profile?.displayName||[profile.profile?.name,profile.profile?.surname].filter(Boolean).join(" ")||uid};
}
export function parseSource(csv) {
  const {rows:matrix,positions}=parseCsv(csv.replace(/^\uFEFF/,""));
  if(!matrix[0] || matrix[0].length!==11 || OFFICIAL_HEADERS.some((h,i)=>matrix[0][i]!==h)) fail("invalid-argument","Use the official eleven-column source template, in its exact order.");
  return validateSourceRows(matrix.slice(1).flatMap((cells,i)=>{
    if(cells.every(v=>!String(v).trim()))return [];
    if(cells.length>11)fail("invalid-argument",`Source row ${positions[i+1]} has extra columns.`);
    return [{...Object.fromEntries(OFFICIAL_HEADERS.map((h,j)=>[h,String(cells[j]??"")])),sourcePosition:positions[i+1]}];
  }));
}
export async function inspectBulkRow({db,reader,row,astId,trnType,lmPcode}) {
  const read=ref=>reader?reader.get(ref):ref.get();
  if(!astId)return {eligible:false,message:"Meter was not found in ASTS."};
  const astSnap=await read(db.doc(`asts/${astId}`)); const ast=astSnap.data()||{};
  const premiseId=text(ast.accessData?.premise?.id); if(!astSnap.exists||!premiseId)return {eligible:false,message:"Meter has no authoritative premise."};
  const premiseSnap=await read(db.doc(`premises/${premiseId}`)); const premise=premiseSnap.data()||{};
  const wardPcode=text(ast.accessData?.parents?.wardPcode); const premiseWard=text(premise.parents?.wardPcode);
  if(ast.accessData?.parents?.lmPcode!==lmPcode || premise.parents?.lmPcode!==lmPcode || !wardPcode || (premiseWard && premiseWard!==wardPcode))return {eligible:false,message:"Authoritative municipality/Ward binding is missing or contradictory."};
  const ward=(await read(db.doc(`wards/${wardPcode}`))).data();
  const wardLm=text(ward?.parents?.localMunicipalityId||ward?.parents?.lmPcode||ward?.lmPcode||ward?.parentPcode||ward?.localMunicipality?.pcode);
  if(!ward || wardLm!==lmPcode)return {eligible:false,message:"The authoritative Ward does not belong to the selected municipality."};
  const refs=normalizeGeoFenceRefs(ast.geofenceRefs);
  if(!refs.length)return {eligible:false,message:"Matched meter has no geofenceRefs."};
  const canonical=validateLifecycleInstructionEligibility({trnType,astDoc:ast});
  const existing=getEligibilityResult({trnType,astData:ast});
  if(!canonical.ok||!existing.eligible)return {eligible:false,message:canonical.message||existing.message};
  const registration=await checkMeterRegistration({db,astId,reader});
  if(!registration.ok)return {eligible:false,message:registration.message};
  const query=db.collection("trns").where("ast.astData.astId","==",astId).where("accessData.trnType","==",trnType).where("workflow.state","in",STATES_HOLDING_THE_METER).limit(1);
  const active=await read(query);
  if(!active.empty)return {eligible:false,message:`Active ${trnType} job ${active.docs[0].id} already exists.`};
  return {eligible:true,message:"Eligible.",row,astId,ast,premiseId,premise,wardPcode,wardName:text(ward.name||ward.wardName||wardPcode),geofenceRefs:refs};
}
export async function previewBulk({db,uid,data}) {
  const matched=await validateStage1Upload({db,uid,data});
  const astMap=new Map(matched.meterAstEntries); const rows=resolveDuplicates(validateSourceRows(data.rows),data.keep);
  const eligibility=await Promise.all(rows.map(async row=>{
    const ast=astMap.get(meterKey(row.meterNo)); const decision=await inspectBulkRow({db,row,astId:ast?.id,trnType:data.trnType,lmPcode:data.lmPcode});
    return [String(row.rowNo),{eligible:decision.eligible,message:decision.message,wardPcode:decision.wardPcode||null}];
  }));
  return {...matched,eligibility};
}
export function buildBulkTrn({entry,id,trnType,lineage,actor,now}) {
  const payload=buildLifecycleInstructionTrnPayload({data:{id,trnType,astId:entry.astId,premiseId:entry.premiseId,assignment:{instruction:{code:trnType},targets:[]},origin:{channel:"OFFICE",source:"TRN_BGO"}},astDoc:entry.ast,premiseData:entry.premise,now,actorUid:actor.uid,actorName:actor.name,allocating:false});
  stripToDeclaredRoot(payload); payload.origin.trnBgo={contractVersion:BULK_CONTRACT,...lineage};
  delete payload.assignment.instruction.reason;
  return payload;
}
export async function createBulkGraph({db,uid,data,source,csv,clock=()=>new Date(),wait=ms=>new Promise(r=>setTimeout(r,ms))}) {
  const {lmPcode,trnType}=data;
  if(!TC_TRN_TYPE_TO_CODE[trnType])fail("invalid-argument","Unsupported TRN BGO type.");
  if(source.uid!==uid || source.lmPcode!==lmPcode || source.trnType!==trnType || source.contractVersion!==BULK_CONTRACT || source.hash!==digest(csv))fail("permission-denied","Source identity or integrity does not match this request.");
  await bulkAuthority({db,uid,lmPcode});
  const allRows=parseSource(csv); const resolved=resolveDuplicates(allRows,data.keep||{});
  const requested=data.selectedRowNos;
  if(!Array.isArray(requested)||!requested.length||new Set(requested.map(String)).size!==requested.length)fail("invalid-argument","Select distinct eligible source rows.");
  const selected=requested.map(key=>resolved.find(r=>String(r.rowNo)===String(key)));
  if(selected.some(r=>!r))fail("invalid-argument","Selection contains a missing or dropped original source row.");
  const identity={uid,lmPcode,trnType,sourceFileId:source.id,sourceHash:source.hash,keep:Object.fromEntries(Object.entries(data.keep||{}).sort(([a],[b])=>a.localeCompare(b))),rows:selected.map(r=>String(r.rowNo)).sort((a,b)=>Number(a)-Number(b))};
  const fingerprint=digest(identity); const receiptRef=db.doc(`tc_upload_dedupe/V2_${fingerprint}`);
  const receipt=await receiptRef.get();
  if(receipt.exists)return receipt.data().result;
  const matching=await validateStage1Upload({db,uid,data:{...data,rows:allRows,fileName:source.fileName}}); const lookup=new Map(matching.meterAstEntries);
  const astIds=selected.map(r=>lookup.get(meterKey(r.meterNo))?.id);
  if(astIds.some(id=>!id)||new Set(astIds).size!==astIds.length)fail("failed-precondition","Selected meters must resolve to distinct authoritative assets.");
  const trnIds=[]; const seen=new Set();
  for(let i=0;i<selected.length;i++) {
    let ms=clock().getTime();
    while(seen.has(ms)){await wait(1);ms=clock().getTime();}
    seen.add(ms);trnIds.push(`TRN_${TC_TRN_TYPE_TO_CODE[trnType]}_${ms}_${lookup.get(meterKey(selected[i].meterNo))?.meterType==="electricity"?"ELC":lookup.get(meterKey(selected[i].meterNo))?.meterType==="water"?"WTR":"NAv"}_${text(lookup.get(meterKey(selected[i].meterNo))?.accessData?.parents?.wardPcode).replace(/[^A-Za-z0-9]/g,"").slice(0,12)}_${text(lookup.get(meterKey(selected[i].meterNo))?.accessData?.erfNo).replace(/[^A-Za-z0-9]/g,"").slice(0,12)||"NAv"}`);
  }
  for(let attempt=0;attempt<4;attempt++) {
    const date=clock(),now=date.toISOString();
    try { return await db.runTransaction(async tx=>{
      const previous=await tx.get(receiptRef); if(previous.exists)return previous.data().result;
      const actor=await bulkAuthority({db,reader:tx,uid,lmPcode});
      const srcSnap=await tx.get(db.doc(`tc_source_files/${source.id}`)); const stored=srcSnap.data();
      if(!stored || stored.hash!==source.hash || stored.generation!==source.generation || stored.cleanupOwned)fail("failed-precondition","Source changed or is unavailable.");
      const entries=await Promise.all(selected.map((row,i)=>inspectBulkRow({db,reader:tx,row,astId:astIds[i],trnType,lmPcode})));
      const bad=entries.find(e=>!e.eligible);if(bad)fail("failed-precondition",bad.message);
      const wardGroups=new Map();entries.forEach((entry,i)=>{if(!wardGroups.has(entry.wardPcode))wardGroups.set(entry.wardPcode,[]);wardGroups.get(entry.wardPcode).push({...entry,trnId:trnIds[i]});});
      const groups=[...wardGroups].map(([wardPcode,items])=>({wardPcode,items,tcId:buildTcUploadId({date,lmPcode,wardPcode,trnCode:TC_TRN_TYPE_TO_CODE[trnType]})}));
      const ids=await Promise.all([...groups.map(g=>db.doc(`tc_uploads/${g.tcId}`)),...trnIds.map(id=>db.doc(`trns/${id}`))].map(ref=>tx.get(ref)));
      if(ids.some(s=>s.exists))throw Object.assign(new Error("Identifier collision"),{bulkCollision:true});
      const batches=groups.map(g=>({tcId:g.tcId,wardPcode:g.wardPcode,wardLabel:g.items[0].wardName,meterCount:g.items.length,trnType,trnCode:TC_TRN_TYPE_TO_CODE[trnType],lmPcode}));
      const result={success:true,code:"TRN_BGO_BATCHES_CREATED",createdBatchCount:groups.length,totalMeters:entries.length,batches,sourceFileId:source.id,message:`Created ${groups.length} Ward batch(es) and ${entries.length} transactions.`};
      for(const group of groups) {
        const metadata={createdAt:now,createdByUid:uid,createdByUser:actor.name,updatedAt:now,updatedByUid:uid,updatedByUser:actor.name};
        const rowIds=group.items.map(e=>buildTcRowId({tcId:group.tcId,rowNo:e.row.rowNo}));
        tx.create(db.doc(`tc_uploads/${group.tcId}`),{id:group.tcId,contractVersion:BULK_CONTRACT,requestId:fingerprint,sourceFileId:source.id,fileName:source.fileName,trnType,trnCode:TC_TRN_TYPE_TO_CODE[trnType],lmPcode,wardPcode:group.wardPcode,wardName:group.items[0].wardName,operationType:trnType,scope:{lmPcode,wardPcode:group.wardPcode},bgo:{batchMode:"TRN",createsChildTrnsUpfront:true},totalRows:group.items.length,readyRows:group.items.length,validRows:group.items.length,foundRows:group.items.length,trnIds:group.items.map(e=>e.trnId),rowIds,workflow:{state:"READY_FOR_ALLOCATION"},bgoStatus:"READY_FOR_ALLOCATION",writeState:"READY",assignment:{targets:[]},metadata});
        tx.create(db.doc(`tc_uploads/${group.tcId}/history/CREATED`),{event:"CREATED",at:now,actorUid:uid,actorName:actor.name,requestId:fingerprint});
        for(const entry of group.items) {
          const rowId=buildTcRowId({tcId:group.tcId,rowNo:entry.row.rowNo});
          const lineage={requestId:fingerprint,batchId:group.tcId,rowId,sourceFileId:source.id,sourceRowNo:entry.row.rowNo,sourcePosition:entry.row.sourcePosition};
          const trn=buildBulkTrn({entry,id:entry.trnId,trnType,lineage,actor,now});
          tx.create(db.doc(`trns/${entry.trnId}`),trn);
          tx.create(db.doc(`tc_rows/${rowId}`),{id:rowId,tcId:group.tcId,contractVersion:BULK_CONTRACT,...lineage,lmPcode,wardPcode:group.wardPcode,rowNo:entry.row.rowNo,astId:entry.astId,premiseId:entry.premiseId,trnId:entry.trnId,input:Object.fromEntries(OFFICIAL_HEADERS.map(h=>[h,entry.row[h]])),frontend:{valid:true},backend:{matched:true,eligible:true,notFound:false},geofenceRefs:entry.geofenceRefs,ast:{...getAstSummary({astId:entry.astId,astData:entry.ast,meterNo:entry.row.meterNo}),gps:entry.ast.gps||entry.ast.location?.gps||null},premise:{id:entry.premiseId,address:entry.premise.address||null,addressText:entry.premise.addressText||null,propertyType:entry.premise.propertyType||null,parents:entry.premise.parents||{},gps:entry.premise.gps||entry.premise.location?.gps||null,erfNo:entry.premise.erfNo||null},bgo:{ready:true,used:false,readinessState:"READY_FOR_BGO"},metadata});
          tx.update(db.doc(`asts/${entry.astId}`),{trnActiveLifecycle:buildTrnActiveLifecycle({trnId:entry.trnId,trnType,workflowState:"CREATED",assignedTo:{},updatedAt:now,updatedByUser:actor.name}),"metadata.updatedAt":now,"metadata.updatedByUid":uid,"metadata.updatedByUser":actor.name});
          tx.create(db.doc(`trns/${entry.trnId}/history/CREATED`),{event:"CREATED",workflowState:"CREATED",at:now,actorUid:uid,actorName:actor.name,...lineage});
        }
      }
      tx.update(srcSnap.ref,{committed:true,archivedAt:stored.archivedAt||now,batchIds:[...new Set([...(stored.batchIds||[]),...batches.map(b=>b.tcId)])]});
      tx.create(receiptRef,{fingerprint,contractVersion:BULK_CONTRACT,uid,lmPcode,sourceFileId:source.id,createdAt:now,result});
      return result;
    }); } catch(error) {
      if(!error.bulkCollision)throw error;
      const saved=await receiptRef.get();if(saved.exists)return saved.data().result;
      if(attempt===3)fail("unavailable","Identifier contention. Retry the same request safely.");
      const second=Math.floor(date.getTime()/1000);while(Math.floor(clock().getTime()/1000)<=second)await wait(25);
    }
  }
}
