import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc} from 'firebase/firestore';
import {subscribeTrnBgoMap} from '../src/pages/operations/md-bgo/trnBgoMapStream.js';
import {subscribeTrnBgoRegisterDetails} from '../src/redux/trnBgoRegisterDetails.js';
import {batchMapLayers} from '../src/pages/operations/md-bgo/bgoBatchLayersModel.js';
test('TRN batch map streams only linked references, resolves ERFs/GPS/geofences and updates under real rules',async()=>{
 assert.ok(process.env.FIRESTORE_EMULATOR_HOST);const env=await initializeTestEnvironment({projectId:'demo-ireps-qa',firestore:{host:'127.0.0.1',port:8087,rules:await readFile(new URL('../firestore.rules',import.meta.url),'utf8')}});const admin=fn=>env.withSecurityRulesDisabled(c=>fn(c.firestore()));let stop;
 try{await env.clearFirestore();await admin(async db=>{for(const [path,value] of Object.entries({
 'users/manager':{accountStatus:'ACTIVE',employment:{role:'MNG'},access:{workbases:['ZA5241']}},'users/disabled':{accountStatus:'DISABLED'},
 'tc_uploads/B1':{id:'B1',contractVersion:'TRN_BGO_11COL_REASON_FREE_V1',lmPcode:'ZA5241',scope:{lmPcode:'ZA5241',wardPcode:'W1'}},
 'tc_rows/r1':{id:'r1',tcId:'B1',rowNo:1,lmPcode:'ZA5241',astId:'m1',premiseId:'p1',geofenceRefs:[{id:'g1'}]},
 'premises/p1':{erfId:'e1',gps:{lat:1,lng:1}},'asts/m1':{gps:{lat:1,lng:1},accessData:{premise:{id:'p1'}},ast:{astData:{astNo:'001'}}},
 'ireps_erfs/e1':{geometry:JSON.stringify({type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]]]})},
 'wards/W1':{parents:{localMunicipalityId:'ZA5241'},name:'Ward one'},
 'geo_fences/context':{parents:{lmPcode:'ZA5241',wardPcode:'W1'}},'geo_fences/otherWard':{parents:{lmPcode:'ZA5241',wardPcode:'W2'}},
 'geo_fences/g1':{parents:{lmPcode:'ZA5241'},geometry:{points:[{lat:0,lng:0},{lat:0,lng:10},{lat:10,lng:10},{lat:10,lng:0}]}},
 'asts/unrelated':{gps:{lat:1,lng:1}},'premises/unrelated':{gps:{lat:1,lng:1}}
 }))await setDoc(doc(db,path),value)});
 const open=db=>{let latest;const waiting=new Set();const off=subscribeTrnBgoMap(db,{batchId:'B1',lmPcode:'ZA5241'},value=>{latest=value;for(const w of waiting)if(w.match(value))w.resolve(value)});return {off,wait:match=>latest&&match(latest)?Promise.resolve(latest):new Promise((resolve,reject)=>{const w={match,resolve:value=>{clearTimeout(timer);waiting.delete(w);resolve(value)}};const timer=setTimeout(()=>{waiting.delete(w);reject(Error('Map timeout: '+JSON.stringify(latest)))},15000);waiting.add(w)})}};
 const detailsDb=env.authenticatedContext('manager').firestore();let detailStop;
 const detailValues=[];let receiveDetail;
 const nextDetail=predicate=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Details timeout')),10000);receiveDetail=value=>{if(predicate(value)){clearTimeout(timer);resolve(value)}};const existing=detailValues.find(predicate);if(existing){clearTimeout(timer);resolve(existing)}});
 try{detailStop=subscribeTrnBgoRegisterDetails(detailsDb,['B1'],value=>{detailValues.push(value);receiveDetail?.(value)});await nextDetail(v=>v.B1?.text==='g1');
 await admin(db=>updateDoc(doc(db,'tc_rows/r1'),{geofenceRefs:[{id:'g1',name:'Live fence'}]}));await nextDetail(v=>v.B1?.text==='Live fence');
 }finally{detailStop?.()}
 for(const identity of [env.unauthenticatedContext(),env.authenticatedContext('disabled')]){let off;try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Denied details timeout')),10000);off=subscribeTrnBgoRegisterDetails(identity.firestore(),['B1'],value=>{if(value.B1?.ready){clearTimeout(timer);assert.ok(value.B1.error);resolve()}})})}finally{off?.()}}
 const stream=open(env.authenticatedContext('manager').firestore());stop=stream.off;const loaded=await stream.wait(v=>v.ready&&!v.error&&v.erfs.length===1&&v.meters.length===1&&v.geofences.length===1);assert.deepEqual(loaded.wards.map(w=>w.id),['W1']);assert.deepEqual(loaded.wardGeofences.map(g=>g.id),['context']);
 await admin(db=>updateDoc(doc(db,'wards/W1'),{name:'Live ward'}));await stream.wait(v=>v.ready&&v.wards[0]?.name==='Live ward');
 assert.deepEqual(loaded.premises.map(p=>p.id),['p1']);assert.equal(batchMapLayers({...loaded}).meters.length,1);assert.equal(batchMapLayers({...loaded}).premises.length,1);
 await admin(db=>updateDoc(doc(db,'asts/m1'),{gps:{lat:15,lng:15}}));const changed=await stream.wait(v=>v.ready&&v.meters[0]?.point?.lat===15);assert.equal(batchMapLayers({...changed}).meters.length,0);stop();stop=null;
 for(const db of [env.unauthenticatedContext().firestore(),env.authenticatedContext('disabled').firestore()]){const denied=open(db);try{const value=await denied.wait(v=>v.ready&&v.error);assert.match(value.error,/permission/i)}finally{denied.off()}}
 }finally{stop?.();await env.cleanup()}
});
