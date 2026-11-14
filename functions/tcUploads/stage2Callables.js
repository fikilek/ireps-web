import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getAuth } from "firebase-admin/auth";
import { BULK_CONTRACT, bulkAuthority, createBulkGraph, previewBulk, digest, text } from "./stage2Core.js";
import { TC_TRN_TYPE_TO_CODE } from "./helpers.js";

export const onPreviewTrnBgoEligibilityCallable=onCall({timeoutSeconds:540,memory:"1GiB"},async request=>previewBulk({db:getFirestore(),uid:request.auth?.uid,data:request.data||{}}));
export const onPrepareTrnBgoSourceCallable=onCall({timeoutSeconds:120},async request=>{
  const db=getFirestore(),data=request.data||{},uid=request.auth?.uid;
  await bulkAuthority({db,uid,lmPcode:data.lmPcode});
  if(!TC_TRN_TYPE_TO_CODE[data.trnType] || !/^[A-Za-z0-9-]{16,80}$/.test(data.uploadId||"") || !/^[a-f0-9]{64}$/.test(data.hash||"") || !text(data.fileName))throw new HttpsError("invalid-argument","Invalid original source context.");
  const id=digest(`${uid}:${data.uploadId}`),ref=db.doc(`tc_source_files/${id}`);
  const source={id,uid,lmPcode:data.lmPcode,trnType:data.trnType,contractVersion:BULK_CONTRACT,hash:data.hash,fileName:data.fileName,path:`trn-bgo-source/${data.lmPcode}/${id}/source.csv`,headers:["rowNo","meterNo","meterPhase","meterType","linkedAccountNo","premiseAddress","premisePropertyType","wardNo","geofence","meterStatus","erfNo"]};
  await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(snap.exists){const old=snap.data();if(["uid","lmPcode","trnType","hash","fileName"].some(k=>old[k]!==source[k]))throw new HttpsError("already-exists","Upload identity is bound to another source.");}else tx.create(ref,{...source,createdAt:new Date().toISOString(),committed:false});});
  const file=getStorage().bucket().file(source.path);
  const [exists]=await file.exists();if(exists)return {sourceFileId:id,uploaded:true};
  const [uploadUrl]=await file.createResumableUpload({origin:request.rawRequest?.headers?.origin,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:"text/csv; charset=utf-8",metadata:{sourceFileId:id,ownerUid:uid,hash:source.hash}}});
  return {sourceFileId:id,uploadUrl,uploaded:false};
});
export const onCreateTrnBgoWardBatchesCallable=onCall({timeoutSeconds:540,memory:"1GiB"},async request=>{
  const db=getFirestore(),data=request.data||{},uid=request.auth?.uid;
  await bulkAuthority({db,uid,lmPcode:data.lmPcode});
  if(!/^[a-f0-9]{64}$/.test(data.sourceFileId||""))throw new HttpsError("invalid-argument","Prepare the original source before creating batches.");
  const ref=db.doc(`tc_source_files/${data.sourceFileId}`),snapshot=await ref.get(),source=snapshot.data();
  if(!source || source.uid!==uid || source.lmPcode!==data.lmPcode)throw new HttpsError("permission-denied","Original source is not authorized.");
  const file=getStorage().bucket().file(source.path),[metadata]=await file.getMetadata();
  const [bytes]=await getStorage().bucket().file(source.path,{generation:metadata.generation}).download();
  if(digest(bytes)!==source.hash)throw new HttpsError("failed-precondition","Original source integrity verification failed.");
  await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(!snap.exists||snap.data().cleanupOwned||snap.data().hash!==source.hash)throw new HttpsError("failed-precondition","Source unavailable.");if(snap.data().generation&&snap.data().generation!==metadata.generation)throw new HttpsError("failed-precondition","Original source generation changed.");tx.update(ref,{generation:metadata.generation,size:Number(metadata.size),bucket:metadata.bucket});});
  return createBulkGraph({db,uid,data,source:{...source,generation:metadata.generation},csv:bytes.toString("utf8")});
});
export const readTrnBgoSource=onRequest({cors:true,timeoutSeconds:540,memory:"512MiB"},async(req,res)=>{
  try {
    if(req.method!=="GET"){res.status(405).end();return;}
    const token=String(req.headers.authorization||"").replace(/^Bearer /,"");
    const auth=await getAuth().verifyIdToken(token,true); const id=text(req.query.id);
    if(!/^[a-f0-9]{64}$/.test(id))throw new Error("Invalid source identity");
    const db=getFirestore(),source=(await db.doc(`tc_source_files/${id}`).get()).data();
    if(!source?.committed||!source.generation)throw new Error("No committed archived source");
    await bulkAuthority({db,uid:auth.uid,lmPcode:source.lmPcode,write:false});
    const file=getStorage().bucket().file(source.path,{generation:source.generation});
    const [metadata]=await file.getMetadata();
    if(metadata.metadata?.hash!==source.hash)throw new Error("Original source integrity mismatch");
    res.set({"Content-Type":"text/csv; charset=utf-8","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"});
    const stream=file.createReadStream();stream.on("error",()=>{if(!res.headersSent)res.status(503).end();else res.destroy();});stream.pipe(res);
  } catch {res.status(403).json({message:"Archived source is unavailable or access is denied."});}
});
