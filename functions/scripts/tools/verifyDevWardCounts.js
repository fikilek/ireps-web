import fs from 'node:fs';
import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {rebuildWardRegistryForLm} from '../../registry/wardBuilder.js';
import {loadWardCounts} from '../../registry/wardCounters.js';
const project=process.argv.find(a=>a.startsWith('--project='))?.split('=')[1];
const lm=process.argv.find(a=>a.startsWith('--lm='))?.split('=')[1];
if(project!=='ireps2'||!lm)throw new Error('This DEV review tool requires --project=ireps2 and --lm=<municipality>');
initializeApp({credential:applicationDefault(),projectId:project});
const db=getFirestore();
const wards=await db.collection('wards').where('parents.localMunicipalityId','==',lm).get();
const summaries=await db.collection('registry_wards').where('localMunicipality.pcode','==',lm).get();
if(process.argv.includes('--apply')) {
 const path='ward-registry-backup-'+Date.now()+'.local';
 fs.writeFileSync(path,JSON.stringify({project,lm,at:new Date().toISOString(),rows:summaries.docs.map(d=>({id:d.id,data:d.data()}))},null,2),{flag:'wx'});
 console.log('Summary backup saved: '+path);
 console.log(await rebuildWardRegistryForLm(lm));
}
let failures=0;
for(const ward of wards.docs) {
 const actual=await loadWardCounts({db,lmPcode:lm,wardPcode:ward.id});
 const saved=await db.collection('registry_wards').doc(lm+'__'+ward.id).get();
 const row=saved.data();
 const matches=row?.calculation?.state==='READY' && Object.keys(actual).every(k=>actual[k]===row.counts?.[k]);
 console.log(JSON.stringify({ward:ward.id,state:row?.calculation?.state||'LEGACY_OR_MISSING',actual,matches}));
 if(!matches)failures++;
}
console.log(JSON.stringify({wards:wards.size,mismatches:failures,applied:process.argv.includes('--apply')}));
if(process.argv.includes('--apply')&&failures)process.exitCode=1;

await db.terminate();
