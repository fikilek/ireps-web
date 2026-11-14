import test from 'node:test';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {ref,uploadBytes,getBytes,deleteObject,listAll} from 'firebase/storage';
test('private archive prefix denies direct client read, list, create, replace and deletion', {skip:!process.env.FIREBASE_STORAGE_EMULATOR_HOST},async t=>{
 const [host,port]=process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(':');
 const env=await initializeTestEnvironment({projectId:'demo-trn-bgo-storage',storage:{host,port:Number(port),rules:readFileSync(new URL('../storage.rules',import.meta.url),'utf8')}});t.after(()=>env.cleanup());
 const path='trn-bgo-source/ZA5241/S1/source.csv';
 await env.withSecurityRulesDisabled(ctx=>uploadBytes(ref(ctx.storage(),path),new TextEncoder().encode('rowNo,meterNo\n1,000123')));
 for(const ctx of [env.authenticatedContext('M'),env.authenticatedContext('F'),env.unauthenticatedContext()]){
  const object=ref(ctx.storage(),path);
  await assertFails(getBytes(object));await assertFails(uploadBytes(object,new Uint8Array([1])));await assertFails(deleteObject(object));
  await assertFails(uploadBytes(ref(ctx.storage(),'trn-bgo-source/ZA5241/NEW/source.csv'),new Uint8Array([1])));
  await assertFails(listAll(ref(ctx.storage(),'trn-bgo-source/ZA5241')));
 }
 await env.withSecurityRulesDisabled(ctx=>uploadBytes(ref(ctx.storage(),'meters/fixture/photo.jpg'),new Uint8Array([1])));
 await assertSucceeds(getBytes(ref(env.authenticatedContext('M').storage(),'meters/fixture/photo.jpg')));
});
