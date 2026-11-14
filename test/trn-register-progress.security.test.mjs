import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {collection,query,where,doc,setDoc,updateDoc,getDocs,onSnapshot} from 'firebase/firestore';
import {trnBgoProgress} from '../src/redux/trnBgoProgress.js';
test('real TRN progress query streams initial and changed canonical states; unsigned/disabled users denied',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-trn-register-counts',firestore:{host:'127.0.0.1',port:18185,rules:await fs.readFile(new URL('../firestore.rules',import.meta.url),'utf8')}});
 try{await env.withSecurityRulesDisabled(async context=>{const db=context.firestore();await setDoc(doc(db,'users/M1'),{accountStatus:'ACTIVE',employment:{role:'MNG'}});await setDoc(doc(db,'users/D1'),{accountStatus:'DISABLED'});await setDoc(doc(db,'trns/T1'),{origin:{trnBgo:{batchId:'B1'}},workflow:{state:'CREATED'}})});
 const db=env.authenticatedContext('M1').firestore();const q=database=>query(collection(database,'trns'),where('origin.trnBgo.batchId','in',['B1']));let stop;let current;let resolveUpdate;const changed=new Promise(resolve=>{resolveUpdate=resolve});
 await new Promise((resolve,reject)=>{stop=onSnapshot(q(db),snap=>{current=trnBgoProgress(snap.docs.map(d=>({...d.data(),id:d.id})));if(current.B1?.inProgressRows===1)resolveUpdate();resolve()},reject)});assert.equal(current.B1.notStartedRows,1);
 await env.withSecurityRulesDisabled(context=>updateDoc(doc(context.firestore(),'trns/T1'),{'workflow.state':'IN_PROGRESS'}));await Promise.race([changed,new Promise((_,reject)=>setTimeout(()=>reject(Error('Stream did not update')),10000))]);assert.equal(current.B1.notStartedRows,0);assert.equal(current.B1.inProgressRows,1);stop();await assertFails(getDocs(q(env.unauthenticatedContext().firestore())));await assertFails(getDocs(q(env.authenticatedContext('D1').firestore())));
 }finally{await env.cleanup()}
});
