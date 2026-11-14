export const BULK_CONTRACT = "TRN_BGO_11COL_REASON_FREE_V1";
const verified = new WeakSet();
export const isVerifiedBulk = data => Boolean(data && verified.has(data));
export function adoptBulkInstruction(data, stored) {
  data.origin = structuredClone(stored.origin);
  data.assignment = structuredClone(stored.assignment);
  verified.add(data);
}
export async function verifyBulkInstruction({db,reader,id,astId,trnType}) {
  const read=ref=>reader?reader.get(ref):ref.get();
  const stored=(await read(db.doc(`trns/${id}`))).data();
  const link=stored?.origin?.trnBgo;
  if(!link)return null;
  const denied=()=>{throw Object.assign(new Error("The stored bulk instruction lineage cannot be verified."),{irepsCode:"INVALID_BULK_LINEAGE"});};
  if(link.contractVersion!==BULK_CONTRACT || stored.id!==id || (astId&&stored.ast?.astData?.astId!==astId) || (trnType&&stored.accessData?.trnType!==trnType))denied();
  if([link.batchId,link.rowId,link.sourceFileId,link.requestId].some(v=>!v||String(v).includes("/")))denied();
  const [parent,row,source,receipt]=await Promise.all([read(db.doc(`tc_uploads/${link.batchId}`)),read(db.doc(`tc_rows/${link.rowId}`)),read(db.doc(`tc_source_files/${link.sourceFileId}`)),read(db.doc(`tc_upload_dedupe/V2_${link.requestId}`))]);
  if(!parent.exists||!row.exists||!source.data()?.committed||!receipt.data()?.result?.success||parent.data().contractVersion!==BULK_CONTRACT||parent.data().sourceFileId!==link.sourceFileId||row.data().trnId!==id||row.data().tcId!==link.batchId||row.data().requestId!==link.requestId||!parent.data().trnIds?.includes(id)||!receipt.data().result.batches?.some(b=>b.tcId===link.batchId))denied();
  return stored;
}

// Recheck authorization within the same transaction as execution/No Access.
// Cached phone context and an earlier preview cannot retain a revoked grant.
export async function verifyBulkExecution({db,reader,uid,id,astId,trnType}) {
 const stored=await verifyBulkInstruction({db,reader,id,astId,trnType});
 if(!stored)return null;
 const read=ref=>reader?reader.get(ref):ref.get();
 const user=(await read(db.doc(`users/${uid}`))).data()||{};
 const link=stored.origin.trnBgo;
 const parent=(await read(db.doc(`tc_uploads/${link.batchId}`))).data()||{};
 const target=parent.assignment?.targets?.[0];
 const pc=v=>typeof v==="string"?v:v?.lmPcode||v?.pcode||v?.id;
 const grants=[user.access?.activeWorkbase,...(user.access?.workbases||[])].map(pc);
 const deny=()=>{throw Object.assign(new Error("This bulk instruction is not currently accepted and assigned to your active municipality and team or service provider."),{irepsCode:"INSTRUCTION_NOT_ASSIGNED"});};
 if(user.accountStatus!=="ACTIVE"||!["FWR","SPV"].includes(user.employment?.role)||!grants.includes(parent.lmPcode)||parent.workflow?.state!=="ACCEPTED"||!["TEAM","SP"].includes(target?.type)||!target.id||stored.assignment?.targets?.[0]?.id!==target.id||stored.assignment?.targets?.[0]?.type!==target.type)deny();
 const current=(await read(db.doc(`${target.type==="TEAM"?"teams":"serviceProviders"}/${target.id}`))).data();
 if(!current||String(current.team?.status||current.status||current.lifecycleStatus).toUpperCase()!=="ACTIVE")deny();
 if(target.type==="SP") {if(user.employment?.serviceProvider?.id!==target.id)deny();}
 else if(![...(current.memberUids||[]),...(current.scope?.memberUserIds||[])].includes(uid))deny();
 return stored;
}

// Response/projection only: canonical work/access facts remain the stored truth.
export function deriveBulkExecutionOutcome(trn) {
 if(!trn?.origin?.trnBgo||!trn.workflow?.completedAt)return null;
 if(trn.accessData?.access?.hasAccess==="no")return {outcome:"NO_ACCESS",success:false};
 if(trn.accessData?.access?.hasAccess!=="yes")return null;
 if(trn.accessData.trnType==="METER_READING") {
  const reading=String(trn.meterReading?.reading??trn.meterReading?.tokenReading??"").trim();
  return {outcome:reading?"SUCCESSFUL_READING":"UNSUCCESSFUL_READING",success:Boolean(reading)};
 }
 return {outcome:"SUCCESS",success:true};
}
