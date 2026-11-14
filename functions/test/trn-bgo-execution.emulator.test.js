import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {onMeterLifecycleTrnCallable} from '../meterLifecycle/callables.js';
import {createBulkGraph,BULK_CONTRACT,digest} from '../tcUploads/stage2Core.js';
import {allocateTcBatches,decideTcBatch} from '../tcUploads/allocation.js';
import {OFFICIAL_HEADERS} from '../tcUploads/stage1Validation.js';
import {serializeCsv} from '../tcUploads/sourceCsv.js';
import {TRN_DECLARED_ROOT_KEYS} from '../transactions/trnShape.js';
test('all five created bulk instructions allocate, accept and execute real No Access with current scope and immutable lineage',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async t=>{
 assert.match(process.env.GCLOUD_PROJECT||'',/^demo-/);
 const app=initializeApp({projectId:process.env.GCLOUD_PROJECT});t.after(()=>deleteApp(app));const db=getFirestore(app);
 const {buildNoAccessPayload}=await import(pathToFileURL(path.join(process.env.IREPS_MOBILE_ROOT,'src/features/meters/noAccessCapture.js')));
 const stamp=Date.now(),office=`M_${stamp}`,worker=`F_${stamp}`,teamId=`T_${stamp}`,lmPcode='ZA5241',wardPcode='ZA5241006';
 await Promise.all([
  db.doc(`users/${office}`).set({accountStatus:'ACTIVE',employment:{role:'MNG',serviceProvider:{id:'MNC1'}},access:{workbases:[lmPcode]}}),
  db.doc(`users/${worker}`).set({accountStatus:'ACTIVE',profile:{name:'Worker'},employment:{role:'FWR',serviceProvider:{id:'MNC1'}},access:{workbases:[lmPcode]}}),
  db.doc(`teams/${teamId}`).set({status:'ACTIVE',name:'Team',ownership:{mncServiceProviderId:'MNC1'},scope:{memberUserIds:[worker]},memberUids:[worker]}),
  db.doc(`wards/${wardPcode}`).set({parents:{localMunicipalityId:lmPcode},name:'Ward 6'})]);
 for(const [index,trnType] of ['METER_DISCONNECTION','METER_RECONNECTION','METER_INSPECTION','METER_REMOVAL','METER_READING'].entries())await t.test(trnType,async()=>{
  const astId=`TRN_MDIS_${stamp}_${index}`,premiseId=`P_${stamp}_${index}`,erfId=`E_${stamp}_${index}`,meterNo=`00${stamp}${index}`;
  const ast={meterType:'electricity',status:{state:trnType==='METER_RECONNECTION'?'DISCONNECTED':'CONNECTED'},accessData:{premise:{id:premiseId},erfId,erfNo:'1',parents:{lmPcode,wardPcode}},ast:{astData:{astId,astNo:meterNo,meter:{type:'conventional'}},location:{gps:{lat:-28,lng:30}}},geofenceRefs:[{id:'G1',name:'Geo'}]};
  await Promise.all([db.doc(`asts/${astId}`).set(ast),db.doc(`trns/${astId}`).set({id:astId,accessData:{trnType:'METER_DISCOVERY',access:{hasAccess:'yes'}},ast:ast.ast}),db.doc(`meter_master/${meterNo}`).set({refs:{asts:{id:astId}}}),db.doc(`premises/${premiseId}`).set({id:premiseId,erfId,erfNo:'1',parents:{lmPcode,wardPcode},address:{strNo:'1',strName:'Main',strType:'Street'},services:{electricityMeters:[{trnId:astId}]}}),db.doc(`ireps_erfs/${erfId}`).set({admin:{localMunicipality:{pcode:lmPcode},ward:{pcode:wardPcode}}})]);
  const row=OFFICIAL_HEADERS.map(h=>h==='rowNo'?'1':h==='meterNo'?meterNo:'');
  const csv=serializeCsv([OFFICIAL_HEADERS,row]),source={id:digest(`${stamp}:${trnType}`),uid:office,lmPcode,trnType,contractVersion:BULK_CONTRACT,hash:digest(csv),generation:'1',fileName:'original.csv'};
  await db.doc(`tc_source_files/${source.id}`).set(source);
  const created=await createBulkGraph({db,uid:office,data:{lmPcode,trnType,selectedRowNos:['1'],keep:{}},source,csv});
  const batchId=created.batches[0].tcId,parent=(await db.doc(`tc_uploads/${batchId}`).get()).data(),id=parent.trnIds[0];
  await allocateTcBatches({db,request:{auth:{uid:office},data:{batchIds:[batchId],targetType:'TEAM',targetId:teamId}}});
  await decideTcBatch({db,request:{auth:{uid:worker},data:{batchId,action:'ACCEPT'}}});
  const payload=buildNoAccessPayload({trnId:id,capturedAt:new Date().toISOString(),actor:{uid:worker,name:'Worker'},context:{trnType,astId,premiseId,erfId,erfNo:'1',instructionTrnId:id},value:{reasonCode:'Property Locked'},media:[{tag:'noAccessPhoto',url:'https://example.test/photo.jpg'}]});
  const send=()=>onMeterLifecycleTrnCallable.run({data:structuredClone(payload),auth:{uid:worker,token:{role:'FWR',name:'Worker'}}});
  await db.doc(`users/${worker}`).update({'access.workbases':[]});assert.equal((await send()).success,false);
  assert.equal((await db.doc(`trns/${id}`).get()).data().workflow.state,'ACCEPTED');
  await db.doc(`users/${worker}`).update({'access.workbases':[lmPcode]});
  const result=await send();assert.equal(result.success,true,JSON.stringify(result));
  const saved=(await db.doc(`trns/${id}`).get()).data();assert.equal(saved.workflow.state,'COMPLETED');assert.equal(saved.origin.trnBgo.batchId,batchId);assert.equal(saved.assignment.instruction.reason,undefined);
  assert.ok(Object.keys(saved).every(key=>TRN_DECLARED_ROOT_KEYS.includes(key)));
  assert.equal((await send()).idempotent,true);
  assert.equal((await db.doc(`asts/${astId}`).get()).data().status.state,ast.status.state);
 });
});
