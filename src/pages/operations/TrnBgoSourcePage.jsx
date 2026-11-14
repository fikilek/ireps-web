import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../../firebase";
import IrepsTable from "../../components/table/IrepsTable";
import { parseCsv } from "../../../functions/tcUploads/sourceCsv.js";
export default function TrnBgoSourcePage() {
 const {sourceFileId}=useParams();const [source,setSource]=useState(null),[rows,setRows]=useState([]),[error,setError]=useState("");
 useEffect(()=>{
  let active=true;let currentLm="";let revision=0;let abort=new AbortController();
  const stop=onSnapshot(doc(db,"tc_source_files",sourceFileId),async snap=>{
   const current=++revision;abort.abort();abort=new AbortController();const signal=abort.signal;setRows([]);setError("");
   if(!snap.exists()||!snap.data().committed){setSource(null);setRows([]);setError("Archived source is unavailable.");return;}
   const descriptor=snap.data();currentLm=descriptor.lmPcode;setSource(descriptor);
   try {
    const token=await auth.currentUser?.getIdToken();
    const endpoint=`https://us-central1-${db.app.options.projectId}.cloudfunctions.net/readTrnBgoSource?id=${encodeURIComponent(sourceFileId)}`;
    const reply=await fetch(endpoint,{headers:{Authorization:`Bearer ${token}`},signal});if(!reply.ok)throw new Error("Archived source is unavailable or access is denied.");
    const csv=await reply.text();const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(csv))),n=>n.toString(16).padStart(2,"0")).join("");
    if(hash!==descriptor.hash)throw new Error("Archived source integrity verification failed.");
    const parsed=parseCsv(csv.replace(/^\uFEFF/,""));
    if(![11,12].includes(descriptor.headers?.length)||JSON.stringify(parsed.rows[0])!==JSON.stringify(descriptor.headers))throw new Error("Archived source headers do not match its original contract.");
    if(active&&current===revision&&!signal.aborted)setRows(parsed.rows.slice(1).map((cells,index)=>({position:parsed.positions[index+1],...Object.fromEntries(descriptor.headers.map((h,i)=>[h,String(cells[i]??"")]))})));
   }catch(e){if(active&&current===revision&&e.name!=="AbortError"){setRows([]);setError(e.message);}}
  },()=>{revision++;abort.abort();setRows([]);setSource(null);setError("Archived source access is no longer authorized.");});
  const uid=auth.currentUser?.uid;
  const offProfile=uid?onSnapshot(doc(db,"users",uid),snap=>{
    const profile=snap.data();const pc=v=>typeof v==="string"?v:v?.lmPcode||v?.pcode||v?.id;
    const grants=[profile?.access?.activeWorkbase,...(profile?.access?.workbases||[])].map(pc);
    if(profile?.accountStatus!=="ACTIVE"||!["SPU","ADM","MNG","SPV"].includes(profile?.employment?.role)||(currentLm&&!grants.includes(currentLm))){revision++;abort.abort();setRows([]);setSource(null);setError("Archived source access is no longer authorized.");}
  },()=>{revision++;abort.abort();setRows([]);setSource(null);}):()=>{};
  const off=auth.onAuthStateChanged(user=>{if(!user){revision++;abort.abort();setRows([]);setSource(null);}});
  return()=>{active=false;abort.abort();stop();offProfile();off();};
 },[sourceFileId]);
 return <main style={{padding:28}}><Link to="/operations/trn-bgo">Back to TRN BGO Register</Link><h1>{source?.fileName||"Original source file"}</h1><p>Read-only original CSV · {rows.length} source records · {source?.lmPcode} · {source?.trnType}</p><p>Archived: {source?.archivedAt || source?.createdAt || "NAv"} · Original headers and file integrity verified before display.</p>{error?<p role="alert">{error}</p>:<IrepsTable rows={rows} rowKey={row=>row.position} columns={(source?.headers||[]).map(key=>({key,label:key,filter:"text",sortable:true,value:row=>row[key],render:row=><span>{row[key]}</span>}))} title="Original source records"/>}</main>;
}
