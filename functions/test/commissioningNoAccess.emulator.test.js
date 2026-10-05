import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onCreateMeterCommissioningCallable } from "../commissioning/callable.js";
import { onMeterCommissioningTrnCreated } from "../commissioning/trigger.js";

test("Commissioning shared No Access through real callable and trigger", { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async t => {
  assert.match(process.env.GCLOUD_PROJECT || "", /^demo-/);
  assert.match(process.env.FIRESTORE_EMULATOR_HOST, /^(localhost|127\.0\.0\.1):\d+$/);
  const mobile = process.env.IREPS_MOBILE_ROOT || path.resolve("../ireps-mobile");
  const { buildNoAccessPayload } = await import(pathToFileURL(path.join(mobile, "src/features/meters/noAccessCapture.js")));
  const { buildNoAccessTrnId } = await import(pathToFileURL(path.join(mobile, "src/features/meters/meterDiscoveryTrnId.js")));
  const app = initializeApp({ projectId: process.env.GCLOUD_PROJECT });
  const db = getFirestore(app);
  t.after(() => deleteApp(app));
  const capturedAt = "2026-10-05T18:00:00.000Z";
  const appointment = { at: "2026-10-05T19:00:00.000Z", madeAt: capturedAt };
  let sequence = 0;
  const make = (returning = false, meterType = "electricity") => buildNoAccessPayload({
    trnId: buildNoAccessTrnId({trnType:"METER_COMMISSIONING", meterType, wardPcode:"ZA5241006", erfNo:"1", at:new Date(Date.parse(capturedAt) + sequence++)}),
    capturedAt, actor:{uid:"COMM_U1",name:"Worker"},
    context:{trnType:"METER_COMMISSIONING",astId:"COMM_A1",premiseId:"COMM_P1",erfId:"COMM_E1",erfNo:"1"},
    value:returning ? {reasonCode:"Return visit requested",appointment} : {reasonCode:"Property Locked"},
    media:returning ? [] : [{tag:"noAccessPhoto",url:"https://example.test/photo.jpg",uri:"file:///private/photo.jpg"}],
  });
  const send = data => onCreateMeterCommissioningCallable.run({data,auth:{uid:"COMM_U1",token:{role:"FWR",name:"Worker"}}});
  const asset = {meterType:"electricity",status:{state:"FIELD"},accessData:{erfId:"COMM_E1",premise:{id:"COMM_P1"}},
    ast:{astData:{astId:"COMM_A1",astNo:"123456",meter:{type:"prepaid"}},location:{gps:{lat:-28,lng:30}}}};
  await Promise.all([
    db.doc("asts/COMM_A1").set(asset),
    db.doc("premises/COMM_P1").set({erfId:"COMM_E1",address:{strNo:"1",strName:"Main",strType:"Street"},services:{electricity:{astId:"COMM_A1",status:"FIELD"}}}),
    db.doc("ireps_erfs/COMM_E1").set({admin:{localMunicipality:{pcode:"ZA5241"},ward:{pcode:"ZA5241006"}}}),
    db.doc("users/COMM_U1").set({employment:{role:"FWR",serviceProvider:{id:"COMM_SP1"}}}),
    db.doc("serviceProviders/COMM_SP1").set({profile:{registeredName:"Provider"}}),
  ]);
  for (const returning of [false,true]) {
    await t.test(returning ? "delayed return agreement is preserved without a photo" : "ordinary reason stores photo and a Commissioning visit", async () => {
      const data = make(returning);
      const before = (await db.doc("asts/COMM_A1").get()).data();
      assert.match(data.id,/^TRN_MCOM_.*_NA$/);
      const result = await send(data);
      assert.equal(result.success,true,JSON.stringify(result));
      const snap = await db.doc(`trns/${data.id}`).get();
      const trn = snap.data();
      assert.equal(trn.accessData.trnType,"METER_COMMISSIONING");
      assert.equal(trn.accessData.access.hasAccess,"no");
      assert.equal(trn.metadata.createdOnDevice,capturedAt);
      assert.equal(Object.keys(trn.metadata).length,12);
      assert.equal(trn.ast.astData.astId,"COMM_A1");
      assert.equal(trn.ast.astData.astNo,"123456");
      assert.equal(trn.meterType,"NA");
      assert.deepEqual(trn.status,{});
      assert.equal("commissioning" in trn,false);
      assert.deepEqual(trn.accessData.access.appointment,returning ? {...appointment,madeByUid:"COMM_U1",madeByUser:"Worker"} : null);
      assert.equal(trn.media.length,returning ? 0 : 1);
      if (!returning) assert.equal("uri" in trn.media[0],false);
      await onMeterCommissioningTrnCreated.run({params:{trnId:data.id},data:snap});
      assert.deepEqual((await db.doc("asts/COMM_A1").get()).data(),before);
      assert.deepEqual((await db.doc("premises/COMM_P1").get()).data().services,{electricity:{astId:"COMM_A1",status:"FIELD"}});
      const repeats = await Promise.all([send(data),send(data)]);
      assert.ok(repeats.every(r=>r.success && r.idempotent));
      assert.equal((await db.doc("premises/COMM_P1").get()).data().noAccessTrnIds.filter(id=>id===data.id).length,1);
      assert.deepEqual((await db.doc(`trns/${data.id}`).get()).data(),trn);
    });
  }
  await t.test("invalid evidence, appointment, geography and state cannot create a visit", async () => {
    for (const [code, returning, alter] of [
      ["NO_ACCESS_PHOTO_REQUIRED",false,p=>{p.media=[];}],
      ["NO_ACCESS_APPOINTMENT_REQUIRED",true,p=>{p.accessData.access.appointment=null;}],
      ["NO_ACCESS_GEOGRAPHY_MISMATCH",false,p=>{p.accessData.premise.id="COMM_P2";}],
    ]) {
      await db.doc("premises/COMM_P2").set({erfId:"COMM_E2"});
      const data=make(returning);alter(data);
      const result=await send(data);
      assert.equal(result.success,false);assert.equal(result.code,code,JSON.stringify(result));
      assert.equal((await db.doc(`trns/${data.id}`).get()).exists,false);
    }
    await db.doc("asts/COMM_A1").update({"status.state":"CONNECTED"});
    const data=make();const result=await send(data);
    assert.equal(result.code,"AST_NOT_FIELD",JSON.stringify(result));
    assert.equal((await db.doc(`trns/${data.id}`).get()).exists,false);
  });
  await t.test("water Commissioning uses the same No Access writer", async () => {
    await db.doc("asts/COMM_A1").set({...asset,meterType:"water"});
    const data=make(false,"water");const result=await send(data);
    assert.equal(result.success,true,JSON.stringify(result));
    assert.equal((await db.doc(`trns/${data.id}`).get()).data().accessData.trnType,"METER_COMMISSIONING");
    assert.equal((await db.doc("asts/COMM_A1").get()).data().status.state,"FIELD");
  });
  await t.test("accessible commissioning still requires checks and connects only after all pass", async () => {
    await db.doc("asts/COMM_A1").set(asset);
    const data = make();
    data.accessData.access = {hasAccess:"yes"};
    assert.equal((await send(data)).code,"INVALID_COMMISSIONING_DATA");
    data.commissioning = {
      vendingConfirmed:{answer:"no",notes:"Vending unavailable"},
      finalSwitchOnTested:{answer:"no",notes:"Supply unavailable"},
      keypadIssued:{answer:"no",notes:"Keypad unavailable"},
    };
    assert.equal((await send(data)).success,true);
    await onMeterCommissioningTrnCreated.run({params:{trnId:data.id},data:await db.doc(`trns/${data.id}`).get()});
    assert.equal((await db.doc("asts/COMM_A1").get()).data().status.state,"FIELD");
    data.id = make().id;
    for (const question of Object.values(data.commissioning)) question.answer="yes";
    data.media = ["vendingEvidence","finalSwitchOnEvidence","keypadIssuedEvidence"].map(tag=>({tag,url:`https://example.test/${tag}.jpg`}));
    assert.equal((await send(data)).success,true);
    await onMeterCommissioningTrnCreated.run({params:{trnId:data.id},data:await db.doc(`trns/${data.id}`).get()});
    assert.equal((await db.doc("asts/COMM_A1").get()).data().status.state,"CONNECTED");
  });
});
