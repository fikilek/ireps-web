import test from "node:test";
import assert from "node:assert/strict";
import {operationObjectiveAchieved} from "../meterLifecycle/operationCompletion.js";
import {validateMeterReading, buildLifecycleTrnPayload} from "../meterLifecycle/helpers.js";
import {qaEligibility} from "../qa/model.js";
const asset={meterType:"electricity",status:{state:"CONNECTED"},ast:{astData:{meter:{type:"conventional"}},location:{gps:{lat:-28,lng:30}}}};
test("validation acceptance alone cannot complete an unachieved objective",()=>{
 for(const [trnType,flag] of Object.entries({METER_DISCONNECTION:"disconnectionPassed",METER_RECONNECTION:"reconnectionPassed",METER_REMOVAL:"removalPassed",METER_INSPECTION:"inspectionPassed"})){
  const data={accessData:{access:{hasAccess:"yes"}}};
  assert.equal(operationObjectiveAchieved({trnType,data,validation:{ok:true,[flag]:false}}),false);
  assert.equal(operationObjectiveAchieved({trnType,data,validation:{ok:true,[flag]:true}}),true);
  data.accessData.access.hasAccess="no";
  assert.equal(operationObjectiveAchieved({trnType,data,validation:{ok:true,[flag]:true}}),false);
 }
});
test("a recorded No Access visit is not operation-QA eligible",()=>{
 for(const trnType of ["METER_DISCOVERY","METER_DISCONNECTION","METER_INSPECTION","METER_READING"]){
  assert.equal(qaEligibility({workflow:{state:"COMPLETED"},accessData:{trnType,access:{hasAccess:"no"}}}).eligible,false);
 }
});
test("reading capture succeeds without touch but still requires valid form and evidence",()=>{
 for(const reading of [0,"0","-12","123"]){
  const data={id:"READ",origin:{channel:"FIELD"},accessData:{trnType:"METER_READING",access:{hasAccess:"no"}},meterReading:{reading,readingAt:"2026-11-22T08:00:00Z",readingGps:{lat:-28,lng:30}},media:[{tag:"meterReadingEvidence",url:"https://example.test/reading.jpg"}]};
  const validation=validateMeterReading({data,astDoc:asset});
  assert.equal(validation.ok,true,JSON.stringify(validation));
  assert.equal(operationObjectiveAchieved({trnType:"METER_READING",data,validation}),true);
  const saved=buildLifecycleTrnPayload({data,astDoc:asset,now:"2026-11-22T08:01:00Z",actorUid:"U",actorName:"Worker",statusState:"CONNECTED"});
  assert.equal(saved.meterReading.reading,String(reading));assert.equal(saved.accessData.access.hasAccess,"no");
  data.media=[];assert.equal(validateMeterReading({data,astDoc:asset}).ok,false);
 }
 const data={accessData:{trnType:"METER_READING",access:{hasAccess:"yes"}},meterReading:{noReadingReason:"Display faulty"}};
 const validation=validateMeterReading({data,astDoc:asset});
 assert.equal(operationObjectiveAchieved({trnType:"METER_READING",data,validation}),false);
});
