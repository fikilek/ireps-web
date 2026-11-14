process.on('uncaughtException',error=>{console.error(JSON.stringify({code:error.code,message:error.message}));process.exitCode=1;});
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {initializeApp,applicationDefault,deleteApp} from '../../functions/node_modules/firebase-admin/lib/app/index.js';
import {getStorage} from '../../functions/node_modules/firebase-admin/lib/storage/index.js';
import {OFFICIAL_HEADERS} from '../../functions/tcUploads/stage1Validation.js';
assert.equal(process.env.TRN_BGO_HOSTED_STORAGE,'ireps2');
assert.ok(!process.env.FIREBASE_STORAGE_EMULATOR_HOST);
const bucketName=readFileSync(new URL('../../.env.dev.local',import.meta.url),'utf8').match(/^VITE_FIREBASE_STORAGE_BUCKET=(.+)$/m)[1].trim().replace(/^["']|["']$/g,'');
const app=initializeApp({projectId:'ireps2',credential:applicationDefault(),storageBucket:bucketName}),bucket=getStorage(app).bucket();
const run=randomUUID(),file=bucket.file(`trn-bgo-source/ZA5241/_verification_${run}/source.csv`),csv=OFFICIAL_HEADERS.join(',')+'\n1,000123'+','.repeat(9)+'\n',hash=createHash('sha256').update(csv).digest('hex');
try{
 if(process.env.TRN_BGO_STORAGE_OBJECTS_ONLY!=='1'){const [policy]=await bucket.getMetadata();console.log(JSON.stringify({bucket:bucketName,lifecycle:policy.lifecycle||null,retentionPolicy:policy.retentionPolicy||null}));}
 const [url]=await file.createResumableUpload({origin:'https://ireps2.web.app',preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'text/csv; charset=utf-8',metadata:{hash,verificationId:run}}});
 const reply=await fetch(url,{method:'PUT',headers:{Origin:'https://ireps2.web.app','Content-Type':'text/csv; charset=utf-8'},body:csv});
 assert.ok(reply.ok,`Resumable upload returned ${reply.status}`);
 assert.equal(reply.headers.get('access-control-allow-origin'),'https://ireps2.web.app');
 const [metadata]=await file.getMetadata();assert.equal(metadata.metadata.hash,hash);assert.ok(!metadata.metadata.firebaseStorageDownloadTokens);
 const [bytes]=await bucket.file(file.name,{generation:metadata.generation}).download();assert.equal(bytes.toString('utf8'),csv);
 await assert.rejects(file.save('replacement',{resumable:false,preconditionOpts:{ifGenerationMatch:0}}),error=>Number(error.code)===412);
 console.log('PASS: hosted resumable browser-origin transfer, create-only 412, pinned-generation fidelity, no durable download token.');
}finally{
 const [exists]=await file.exists();if(exists){const [metadata]=await file.getMetadata();assert.equal(metadata.metadata?.verificationId,run);await file.delete({ifGenerationMatch:metadata.generation});assert.equal((await file.exists())[0],false);}
 console.log('Owned synthetic Storage fixture removed.');await deleteApp(app);
}
